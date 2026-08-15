import { app, net } from 'electron'
import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import { getLogger } from './logger'
import { getCaptureManager } from './capture-manager'

/**
 * macOS 就地更新器 — 单例模式（仅 darwin 使用）
 *
 * ad-hoc 签名下 electron-updater / Squirrel.Mac 的 designated requirement
 * 校验必然失败，因此采用自研 zip 换包方案：
 *   下载 zip → ditto 解压暂存（staging）+ codesign --verify 校验
 *   → 生成 install.sh（等待当前进程退出 → xattr 去隔离 → 双 rename 替换
 *   → 失败回滚 → open 新版本 → 尽力清理 .app.old）→ detached 启动脚本 → app.quit()
 *
 * 零新增 npm 依赖：net.request 下载 + child_process 执行系统命令。
 */

const execFileAsync = promisify(execFile)

/** 日志 scope */
const SCOPE = 'updater'

/** ditto 解压超时（ms） */
const DITTO_TIMEOUT_MS = 60 * 1000

/** codesign 校验超时（ms） */
const CODESIGN_TIMEOUT_MS = 30 * 1000

/** 安装包下载整体超时（ms，zip 约几十 MB，放宽到 10 分钟） */
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000

/** 下载进度回调 */
export type DownloadProgressCallback = (received: number, total: number) => void

class MacInplaceUpdater {
  /** stage() 成功后记录的暂存 .app 路径（install 时校验） */
  private stagedAppPath: string | null = null

  /** updates 目录：userData/updates */
  private get updatesDir(): string {
    return path.join(app.getPath('userData'), 'updates')
  }

  /** zip 暂存路径 */
  private get zipPath(): string {
    return path.join(this.updatesDir, 'SwitchCast-update.zip')
  }

  /** 解压暂存目录 */
  private get stagingDir(): string {
    return path.join(this.updatesDir, 'staging')
  }

  /**
   * 下载更新包（流式写入 userData/updates/SwitchCast-update.zip，先删除旧残留）
   * @param url 资产 browser_download_url
   * @param onProgress 进度回调（received/total，total 未知时为 -1；由调用方节流）
   * @returns zip 文件路径
   */
  async download(url: string, onProgress?: DownloadProgressCallback): Promise<string> {
    await fs.promises.mkdir(this.updatesDir, { recursive: true })
    // 清理旧残留（zip 与上次未安装的 staging）
    await fs.promises.rm(this.zipPath, { force: true }).catch(() => undefined)
    await fs.promises.rm(this.stagingDir, { recursive: true, force: true }).catch(() => undefined)
    this.stagedAppPath = null

    await new Promise<void>((resolve, reject) => {
      let settled = false
      let fileStream: fs.WriteStream | null = null
      const finish = (fn: () => void, destroyStream = false): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        // 失败收尾统一销毁写流，防止 fd 泄漏
        if (destroyStream) {
          try {
            fileStream?.destroy()
          } catch {
            /* 静默 */
          }
        }
        fn()
      }

      const request = net.request({ url, method: 'GET' })
      request.setHeader('User-Agent', 'SwitchCast-Updater')

      const timer = setTimeout(() => {
        finish(() => reject(new Error('更新包下载超时')), true)
        try {
          request.abort()
        } catch {
          /* 静默 */
        }
      }, DOWNLOAD_TIMEOUT_MS)

      let received = 0
      let total = -1

      request.on('response', (response) => {
        if (response.statusCode !== 200) {
          finish(() => reject(new Error(`更新包下载失败：HTTP ${response.statusCode}`)), true)
          try {
            request.abort()
          } catch {
            /* 静默 */
          }
          return
        }
        // content-length 可能为字符串或字符串数组
        const lenHeader = response.headers['content-length']
        const lenValue = Array.isArray(lenHeader) ? lenHeader[0] : lenHeader
        const parsedLen = lenValue ? parseInt(String(lenValue), 10) : NaN
        total = Number.isFinite(parsedLen) && parsedLen > 0 ? parsedLen : -1

        fileStream = fs.createWriteStream(this.zipPath)
        fileStream.on('error', (err) => {
          finish(() => reject(err), true)
          try {
            request.abort()
          } catch {
            /* 静默 */
          }
        })

        response.on('data', (chunk: Buffer) => {
          received += chunk.length
          fileStream?.write(chunk)
          try {
            onProgress?.(received, total)
          } catch {
            /* 进度回调异常不影响下载 */
          }
        })
        response.on('end', () => {
          fileStream?.end(() => {
            finish(() => resolve())
          })
        })
        response.on('error', (err) => {
          finish(() => reject(err instanceof Error ? err : new Error(String(err))), true)
        })
      })

      request.on('error', (err) => {
        finish(() => reject(err instanceof Error ? err : new Error(String(err))), true)
      })

      request.end()
    })

    getLogger().info(SCOPE, `更新包下载完成: ${this.zipPath}（${receivedSize(this.zipPath)}）`)
    return this.zipPath
  }

  /**
   * 解压暂存并校验签名
   * - 清空 staging → `ditto -xk zip staging`（60s 超时）
   * - 定位解压出的 SwitchCast.app
   * - `codesign --verify --deep` 校验（失败即弃并清理）
   * @returns 新 .app 的绝对路径
   */
  async stage(): Promise<string> {
    await fs.promises.rm(this.stagingDir, { recursive: true, force: true }).catch(() => undefined)
    await fs.promises.mkdir(this.stagingDir, { recursive: true })

    getLogger().info(SCOPE, '开始解压更新包（ditto）')
    try {
      await execFileAsync('ditto', ['-xk', this.zipPath, this.stagingDir], {
        timeout: DITTO_TIMEOUT_MS
      })
    } catch (err) {
      await this.cleanupStaging()
      throw new Error(`更新包解压失败: ${err instanceof Error ? err.message : String(err)}`)
    }

    const appPath = await this.findAppBundle(this.stagingDir, 0)
    if (!appPath) {
      await this.cleanupStaging()
      throw new Error('更新包中未找到 SwitchCast.app')
    }

    getLogger().info(SCOPE, `校验新版本签名: ${appPath}`)
    try {
      await execFileAsync('codesign', ['--verify', '--deep', appPath], {
        timeout: CODESIGN_TIMEOUT_MS
      })
    } catch (err) {
      await this.cleanupStaging()
      throw new Error(`更新包签名校验失败: ${err instanceof Error ? err.message : String(err)}`)
    }

    this.stagedAppPath = appPath
    getLogger().info(SCOPE, '更新包暂存完成，等待安装')
    return appPath
  }

  /**
   * 获取 stage() 产出的暂存 .app 路径（未就绪返回 null）
   */
  getStagedAppPath(): string | null {
    return this.stagedAppPath
  }

  /**
   * 安装守卫：逐项检查是否满足就地安装条件
   * @returns 满足返回 null；不满足返回原因字符串
   */
  canInstall(): string | null {
    if (process.platform !== 'darwin') {
      return '就地安装仅支持 macOS'
    }
    if (!app.isPackaged) {
      return '开发环境不支持就地安装'
    }
    const execPath = process.execPath
    // 严格匹配 bundle 结构 .app/Contents/，防止 execPath 位于名字含 .app 的父目录下误匹配
    if (!this.getCurrentAppBundlePath()) {
      return '当前未从应用包内运行'
    }
    if (execPath.includes('/Volumes/')) {
      return '应用正从磁盘镜像运行，请先拖入「应用程序」文件夹'
    }
    if (execPath.includes('/AppTranslocation/')) {
      return '应用处于 Gatekeeper 转译路径，请移动应用后重试'
    }
    const currentApp = this.getCurrentAppBundlePath()
    if (!currentApp) {
      return '无法定位当前应用包路径'
    }
    const parentDir = path.dirname(currentApp)
    try {
      fs.accessSync(parentDir, fs.constants.W_OK)
    } catch {
      return `应用所在目录不可写（${parentDir}），请检查权限`
    }
    return null
  }

  /**
   * 执行就地安装：生成 install.sh → detached 启动 → app.quit()
   * 安装前若采集运行中会自动停止并记日志
   */
  async install(newAppPath?: string): Promise<void> {
    const reason = this.canInstall()
    if (reason) {
      throw new Error(reason)
    }
    const stagedApp = newAppPath ?? this.stagedAppPath
    if (!stagedApp || !(await exists(stagedApp))) {
      throw new Error('更新包未就绪，请先下载更新')
    }

    // 安装前检查采集状态：运行中则自动停止
    try {
      const captureManager = getCaptureManager()
      const captureState = captureManager.getState()
      if (captureState === 'running' || captureState === 'starting') {
        getLogger().info(SCOPE, `采集运行中（${captureState}），安装前自动停止`)
        await captureManager.stop()
      }
    } catch (err) {
      getLogger().warn(SCOPE, `安装前停止采集失败: ${err instanceof Error ? err.message : String(err)}`)
    }

    const currentApp = this.getCurrentAppBundlePath()
    if (!currentApp) {
      throw new Error('无法定位当前应用包路径')
    }
    const oldApp = `${currentApp}.old`

    // 生成安装脚本
    const scriptPath = path.join(this.updatesDir, 'install.sh')
    await fs.promises.mkdir(this.updatesDir, { recursive: true })
    const script = this.buildInstallScript({
      pid: process.pid,
      newApp: stagedApp,
      targetApp: currentApp,
      oldApp
    })
    await fs.promises.writeFile(scriptPath, script, { mode: 0o755 })
    getLogger().info(SCOPE, `安装脚本已生成: ${scriptPath}（目标: ${currentApp}）`)

    // detached 启动脚本（不随本进程退出而终止），随后退出应用
    const child = spawn('/bin/bash', [scriptPath], { detached: true, stdio: 'ignore' })
    child.unref()
    getLogger().info(SCOPE, '安装脚本已启动，应用即将退出')
    app.quit()
  }

  /**
   * 启动清理：检测当前 .app 旁的 SwitchCast.app.old，存在则异步删除
   * （在 IPC 注册时调用一次，全程 try/catch 静默）
   */
  cleanupOld(): void {
    try {
      const currentApp = this.getCurrentAppBundlePath()
      if (!currentApp) return
      const oldApp = `${currentApp}.old`
      void fs.promises
        .stat(oldApp)
        .then(() => {
          getLogger().info(SCOPE, `发现旧版本残留，异步清理: ${oldApp}`)
          return fs.promises.rm(oldApp, { recursive: true, force: true })
        })
        .then(() => {
          getLogger().info(SCOPE, '旧版本残留清理完成')
        })
        .catch(() => {
          /* 不存在或清理失败均静默 */
        })
    } catch {
      /* 静默 */
    }
  }

  /**
   * 当前运行中的应用包路径（process.execPath 匹配 `.app/Contents/` bundle 结构边界，
   * 避免父目录名含 `.app` 时误匹配）
   */
  private getCurrentAppBundlePath(): string | null {
    const match = /^(.*?\.app)(?=\/Contents\/)/.exec(process.execPath)
    return match ? match[1] : null
  }

  /**
   * 在目录中递归查找 SwitchCast.app（限制深度，忽略隐藏目录）
   */
  private async findAppBundle(dir: string, depth: number): Promise<string | null> {
    if (depth > 3) return null
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch {
      return null
    }
    // 先找当前层的 .app
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.endsWith('.app')) {
        return path.join(dir, entry.name)
      }
    }
    // 再递归子目录（如 zip 内含顶层文件夹的情况）
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const found = await this.findAppBundle(path.join(dir, entry.name), depth + 1)
      if (found) return found
    }
    return null
  }

  /** 清理 staging 目录（静默） */
  private async cleanupStaging(): Promise<void> {
    await fs.promises.rm(this.stagingDir, { recursive: true, force: true }).catch(() => undefined)
    this.stagedAppPath = null
  }

  /**
   * 生成 install.sh 内容
   *
   * 流程：等待当前 PID 退出（kill -0 循环检测，上限 30s；超时仍存活则放弃安装）
   *   → xattr -dr com.apple.quarantine（|| true 容错）
   *   → 旧 .app mv 为 .app.old → 新 .app mv 入位
   *   → 入位失败则把 .app.old mv 回去（回滚）
   *   → open 新应用 → 尽力 rm -rf .app.old
   */
  private buildInstallScript(params: {
    pid: number
    newApp: string
    targetApp: string
    oldApp: string
  }): string {
    const { pid, newApp, targetApp, oldApp } = params
    return [
      '#!/bin/bash',
      '# SwitchCast 就地更新安装脚本（由主进程生成，请勿手动编辑）',
      'set -u',
      '',
      `PID=${pid}`,
      `NEW_APP=${shellQuote(newApp)}`,
      `TARGET_APP=${shellQuote(targetApp)}`,
      `OLD_APP=${shellQuote(oldApp)}`,
      '',
      '# 1. 等待当前应用进程退出（kill -0 检测，上限 30s）',
      'i=0',
      'while [ "$i" -lt 60 ]; do',
      '  if ! kill -0 "$PID" 2>/dev/null; then',
      '    break',
      '  fi',
      '  sleep 0.5',
      '  i=$((i + 1))',
      'done',
      '',
      '# 1.5 等待超时但进程仍存活：放弃本次安装（保持现状，不换包不 open），',
      '#     避免与原生模块退出挂起叠加导致双实例并存、下次启动误清理运行中的 .app.old',
      'if kill -0 "$PID" 2>/dev/null; then',
      '  exit 1',
      'fi',
      '',
      '# 2. 去除隔离属性（失败不阻断）',
      'xattr -dr com.apple.quarantine "$NEW_APP" 2>/dev/null || true',
      '',
      '# 3. 清理可能存在的历史 .app.old 残留',
      'if [ -e "$OLD_APP" ]; then',
      '  rm -rf "$OLD_APP" || true',
      'fi',
      '',
      '# 4. 旧版本移开；失败则放弃安装（保持现状）',
      'if ! mv "$TARGET_APP" "$OLD_APP"; then',
      '  exit 1',
      'fi',
      '',
      '# 5. 新版本入位；失败则回滚旧版本',
      'if ! mv "$NEW_APP" "$TARGET_APP"; then',
      '  mv "$OLD_APP" "$TARGET_APP" || true',
      '  exit 1',
      'fi',
      '',
      '# 6. 启动新版本',
      'open "$TARGET_APP" || true',
      '',
      '# 7. 尽力清理旧版本',
      'rm -rf "$OLD_APP" || true',
      'exit 0',
      ''
    ].join('\n')
  }
}

/** shell 单引号转义（路径含空格/特殊字符安全） */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** 路径是否存在（异步，出错视为不存在） */
async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.stat(filePath)
    return true
  } catch {
    return false
  }
}

/** 读取文件大小用于日志（出错返回 '?'） */
function receivedSize(filePath: string): string {
  try {
    const stat = fs.statSync(filePath)
    return `${Math.round(stat.size / 1024)}KB`
  } catch {
    return '?'
  }
}

/** 单例实例 */
let updaterInstance: MacInplaceUpdater | null = null

/**
 * 获取 macOS 就地更新器单例
 */
export function getMacInplaceUpdater(): MacInplaceUpdater {
  if (!updaterInstance) {
    updaterInstance = new MacInplaceUpdater()
  }
  return updaterInstance
}
