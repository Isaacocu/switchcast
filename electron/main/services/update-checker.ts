import { app, net, BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import { getLogger } from './logger'
import type { UpdateInfo, UpdaterStatus, UpdatePhase } from '../../../src/types/update'

/**
 * 更新检查器 — 单例模式
 *
 * 通过 GitHub Releases API 检查最新版本（latest 端点本身已排除 prerelease/draft）。
 * - 使用 Electron net.request（走系统代理），必须携带 User-Agent 头
 * - 请求超时 9s（setTimeout + request.abort()）
 * - 自动检查 24h 节流（userData/updater-state.json 记录 lastCheckTs）；手动检查跳过节流
 * - 失败（断网 / 403 限流 / 解析错误）统一 logger.warn 静默；manual=true 时向上抛错供 UI 展示
 * - 状态变化经 update:status 事件广播给所有窗口
 *
 * 说明：ad-hoc 签名下 electron-updater/Squirrel.Mac 的 designated requirement
 * 校验必然失败，因此 macOS 就地安装由 mac-inplace-updater 自研 zip 换包实现。
 */

/** GitHub Releases API — latest 端点（自动排除 prerelease / draft） */
const RELEASE_API_URL = 'https://api.github.com/repos/Isaacocu/switchcast/releases/latest'

/** 检查请求超时（ms） */
const REQUEST_TIMEOUT_MS = 9000

/** 自动检查节流间隔（24h） */
const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

/** Release Notes 截断长度 */
const RELEASE_NOTES_MAX_LEN = 2000

/** 更新器状态文件（userData/updater-state.json） */
interface UpdaterStateFile {
  lastCheckTs: number
  skippedVersion?: string
}

/** GitHub Release API 响应（仅声明用到的字段） */
interface GitHubRelease {
  tag_name?: string
  name?: string
  body?: string
  prerelease?: boolean
  draft?: boolean
  assets?: Array<{ name?: string; browser_download_url?: string }>
}

/**
 * 拆分版本号：主数字段 + prerelease 标签（支持 v 前缀）
 */
function splitVersion(version: string): { nums: number[]; pre: string } {
  const clean = version.trim().replace(/^v/i, '')
  const dashIdx = clean.indexOf('-')
  const main = dashIdx >= 0 ? clean.slice(0, dashIdx) : clean
  const pre = dashIdx >= 0 ? clean.slice(dashIdx + 1) : ''
  const nums = main.split('.').map((seg) => parseInt(seg, 10) || 0)
  return { nums, pre }
}

/**
 * prerelease 段比较：按 '.' 分段，数字段按数值比较（beta.10 > beta.2），
 * semver 规则：数字段优先级低于字符串段；前缀相同时段数少的更低（beta < beta.1）
 * @returns 负数 a < b，0 相等，正数 a > b
 */
function comparePreRelease(a: string, b: string): number {
  const segA = a.split('.')
  const segB = b.split('.')
  const len = Math.max(segA.length, segB.length)
  for (let i = 0; i < len; i++) {
    const sa = segA[i]
    const sb = segB[i]
    if (sa === undefined) return -1
    if (sb === undefined) return 1
    const na = /^\d+$/.test(sa) ? parseInt(sa, 10) : NaN
    const nb = /^\d+$/.test(sb) ? parseInt(sb, 10) : NaN
    if (!Number.isNaN(na) && !Number.isNaN(nb)) {
      if (na !== nb) return na - nb
    } else if (!Number.isNaN(na)) {
      return -1
    } else if (!Number.isNaN(nb)) {
      return 1
    } else {
      if (sa < sb) return -1
      if (sa > sb) return 1
    }
  }
  return 0
}

/**
 * 内置 semver 比较：数字段逐段比较；带 prerelease 的版本低于同数字段的正式版
 * （1.0.0-beta < 1.0.0；两者都带 prerelease 时按 '.' 分段比较）
 * @returns 负数 a < b，0 相等，正数 a > b
 */
export function compareVersions(a: string, b: string): number {
  const va = splitVersion(a)
  const vb = splitVersion(b)
  const len = Math.max(va.nums.length, vb.nums.length)
  for (let i = 0; i < len; i++) {
    const diff = (va.nums[i] ?? 0) - (vb.nums[i] ?? 0)
    if (diff !== 0) return diff
  }
  if (va.pre && !vb.pre) return -1
  if (!va.pre && vb.pre) return 1
  return comparePreRelease(va.pre, vb.pre)
}

/**
 * 按当前平台/架构匹配 Release 资产
 * - mac arm64 → name 含 `-arm64` 且以 `-mac.zip` 结尾
 * - mac x64   → 以 `-mac.zip` 结尾且不含 `arm64`
 * - win       → 以 `.exe` 结尾
 * 无匹配返回 null（触发降级：引导用户手动下载）
 */
export function pickAsset(
  assets: Array<{ name?: string; browser_download_url?: string }>
): { name?: string; browser_download_url?: string } | null {
  if (!Array.isArray(assets)) return null
  if (process.platform === 'darwin') {
    const isArm64 = process.arch === 'arm64'
    for (const asset of assets) {
      const name = asset?.name ?? ''
      if (isArm64 && name.includes('-arm64') && name.endsWith('-mac.zip')) return asset
      if (!isArm64 && name.endsWith('-mac.zip') && !name.includes('arm64')) return asset
    }
    return null
  }
  if (process.platform === 'win32') {
    return assets.find((asset) => (asset?.name ?? '').endsWith('.exe')) ?? null
  }
  return null
}

class UpdateChecker {
  /** 当前状态（经 update:status 广播） */
  private status: UpdaterStatus = { phase: 'idle' }

  /** 最近一次检查结果（供 download IPC 复用） */
  private lastInfo: UpdateInfo | null = null

  /** 状态文件路径（懒初始化） */
  private stateFilePath = ''

  /** 防止并发检查 */
  private checking = false

  /**
   * 检查更新
   * @param manual 手动检查：跳过 24h 节流，失败时抛错供 UI 展示
   * @returns 有新版本返回 UpdateInfo；已是最新 / 被节流 / 被跳过返回 null
   */
  async check(manual: boolean): Promise<UpdateInfo | null> {
    if (this.checking) {
      if (manual) throw new Error('正在检查更新，请稍候')
      return null
    }

    // 自动检查 24h 节流（手动检查跳过节流）
    if (!manual) {
      const state = this.loadState()
      if (Date.now() - state.lastCheckTs < AUTO_CHECK_INTERVAL_MS) {
        return null
      }
    }

    this.checking = true
    this.mergeStatus({ phase: 'checking', error: undefined })
    try {
      const release = await this.fetchLatestRelease()

      const latest = (release.tag_name ?? '').trim()
      if (!latest) throw new Error('远端版本号解析失败')
      // 版本号解析校验通过后才写入 lastCheckTs，避免畸形 tag 导致 24h 静默节流
      this.saveState({ ...this.loadState(), lastCheckTs: Date.now() })
      // 双保险：latest 端点已排除 prerelease/draft，此处再拦一次（回退 idle 避免 checking 锁死）
      if (release.prerelease || release.draft) {
        this.mergeStatus({ phase: 'idle', error: undefined })
        return null
      }

      if (compareVersions(latest, app.getVersion()) <= 0) {
        this.mergeStatus({ phase: 'latest', latestVersion: latest, error: undefined })
        return null
      }

      // 自动检查尊重用户跳过的版本
      if (!manual && this.loadState().skippedVersion === latest) {
        this.mergeStatus({ phase: 'idle' })
        return null
      }

      const asset = pickAsset(release.assets ?? [])
      const releaseNotes =
        typeof release.body === 'string' ? release.body.slice(0, RELEASE_NOTES_MAX_LEN) : undefined
      const info: UpdateInfo = {
        version: latest,
        releaseNotes,
        downloadUrl: asset?.browser_download_url || undefined,
        canInstallInPlace: process.platform === 'darwin' && app.isPackaged && !!asset
      }
      this.lastInfo = info
      this.mergeStatus({
        phase: 'available',
        latestVersion: latest,
        releaseNotes,
        canInstallInPlace: info.canInstallInPlace,
        error: undefined
      })
      getLogger().info('updater', `发现新版本 ${latest}（当前 ${app.getVersion()}），可就地安装=${info.canInstallInPlace}`)
      return info
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      getLogger().warn('updater', `更新检查失败${manual ? '（手动）' : ''}: ${message}`)
      if (manual) {
        this.mergeStatus({ phase: 'error', error: message })
        throw new Error(message)
      }
      // 自动检查失败静默：回退 idle，不打扰用户
      this.mergeStatus({ phase: 'idle', error: undefined })
      return null
    } finally {
      this.checking = false
    }
  }

  /**
   * 自动检查入口（fire-and-forget，内部已处理节流与静默）
   */
  autoCheck(): void {
    void this.check(false).catch(() => {
      /* check(false) 理论上不外抛，双保险 */
    })
  }

  /**
   * 获取当前状态快照
   */
  getStatus(): UpdaterStatus {
    return { ...this.status }
  }

  /**
   * 获取最近一次检查结果（download/install 流程复用）
   */
  getLastInfo(): UpdateInfo | null {
    return this.lastInfo
  }

  /**
   * 更新阶段状态并广播（供 IPC 层在下载/安装流程中推进阶段）
   */
  setPhase(phase: UpdatePhase, extra?: Partial<UpdaterStatus>): void {
    this.mergeStatus({ phase, ...extra })
  }

  /**
   * 记录用户跳过的版本（写入状态文件，供后续 UI 使用）
   */
  skipVersion(version: string): void {
    this.saveState({ ...this.loadState(), skippedVersion: version })
  }

  /**
   * 通过 GitHub API 拉取 latest release（net.request，带 User-Agent 与 9s 超时）
   */
  private fetchLatestRelease(): Promise<GitHubRelease> {
    return new Promise<GitHubRelease>((resolve, reject) => {
      let settled = false
      const finish = (fn: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        fn()
      }

      const request = net.request({ url: RELEASE_API_URL, method: 'GET' })
      request.setHeader('User-Agent', 'SwitchCast-Updater')
      request.setHeader('Accept', 'application/vnd.github+json')

      // 8-10s 超时：setTimeout + request.abort()
      const timer = setTimeout(() => {
        finish(() => reject(new Error('更新检查超时，请检查网络后重试')))
        try {
          request.abort()
        } catch {
          /* 静默 */
        }
      }, REQUEST_TIMEOUT_MS)

      request.on('response', (response) => {
        if (response.statusCode !== 200) {
          finish(() => reject(new Error(`GitHub API 返回 ${response.statusCode}（可能被限流）`)))
          return
        }
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
        })
        response.on('end', () => {
          finish(() => {
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as GitHubRelease)
            } catch {
              reject(new Error('更新信息解析失败'))
            }
          })
        })
        response.on('error', (err) => {
          finish(() => reject(err instanceof Error ? err : new Error(String(err))))
        })
      })

      request.on('error', (err) => {
        finish(() => reject(err instanceof Error ? err : new Error(String(err))))
      })

      request.end()
    })
  }

  /** 状态文件路径（userData/updater-state.json） */
  private getStateFilePath(): string {
    if (!this.stateFilePath) {
      this.stateFilePath = path.join(app.getPath('userData'), 'updater-state.json')
    }
    return this.stateFilePath
  }

  /** 读取状态文件（不存在 / 损坏时返回默认值） */
  private loadState(): UpdaterStateFile {
    try {
      const raw = fs.readFileSync(this.getStateFilePath(), 'utf8')
      const parsed = JSON.parse(raw) as Partial<UpdaterStateFile>
      return {
        lastCheckTs: typeof parsed.lastCheckTs === 'number' ? parsed.lastCheckTs : 0,
        skippedVersion: typeof parsed.skippedVersion === 'string' ? parsed.skippedVersion : undefined
      }
    } catch {
      return { lastCheckTs: 0 }
    }
  }

  /** 写入状态文件（失败静默） */
  private saveState(state: UpdaterStateFile): void {
    try {
      fs.writeFileSync(this.getStateFilePath(), JSON.stringify(state), 'utf8')
    } catch (err) {
      getLogger().warn(
        'updater',
        `更新状态文件写入失败: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  /** 合并状态并广播 update:status */
  private mergeStatus(partial: Partial<UpdaterStatus>): void {
    this.status = { ...this.status, ...partial }
    try {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('update:status', this.getStatus())
      }
    } catch {
      /* 静默：广播失败不影响主流程 */
    }
  }
}

/** 单例实例 */
let checkerInstance: UpdateChecker | null = null

/**
 * 获取更新检查器单例
 */
export function getUpdateChecker(): UpdateChecker {
  if (!checkerInstance) {
    checkerInstance = new UpdateChecker()
  }
  return checkerInstance
}
