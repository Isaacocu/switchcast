import { app, dialog, BrowserWindow } from 'electron'
import os from 'os'
import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { getCaptureManager } from './capture-manager'
import { getLogger } from './logger'

const execFileAsync = promisify(execFile)

/** 崩溃报告收集范围：近 7 天 */
const CRASH_REPORT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** 崩溃报告最多收集份数 */
const CRASH_REPORT_MAX_COUNT = 5

/** 单个崩溃报告截断上限 200KB */
const CRASH_REPORT_MAX_BYTES = 200 * 1024

/** ditto 打包超时 */
const DITTO_TIMEOUT_MS = 15000

/** Issue URL 总长度上限 */
const ISSUE_URL_MAX_LENGTH = 4096

/**
 * 诊断服务 — 单例模式
 *
 * 提供系统信息采集、诊断报告导出（zip）、GitHub Issue 预填链接构建。
 * 所有外部依赖（文件系统 / ditto / 崩溃报告目录）均容错处理，
 * 任何失败都不影响应用主流程。
 */
class Diagnostics {
  /**
   * 采集系统与环境信息
   *
   * 注意：captureMode 设置项存储在渲染进程 localStorage（switchcast:settings，
   * 见 src/stores/settings.ts），主进程无法直接读取，此处仅标注 renderer-side；
   * 若最近一次采集携带了 captureMode（CaptureConfig 扩展字段），则一并记录。
   */
  async collectSystemInfo(): Promise<Record<string, string>> {
    const info: Record<string, string> = {}

    try {
      info['App Version'] = app.getVersion()
    } catch {
      info['App Version'] = 'unknown'
    }
    info['Electron'] = process.versions.electron || 'unknown'
    info['Chrome'] = process.versions.chrome || 'unknown'
    info['Node.js'] = process.versions.node || 'unknown'
    info['Platform'] = process.platform
    info['Arch'] = process.arch

    try {
      info['OS Release'] = os.release()
    } catch {
      info['OS Release'] = 'unknown'
    }
    try {
      info['CPU'] = os.cpus()[0]?.model || 'unknown'
    } catch {
      info['CPU'] = 'unknown'
    }
    try {
      info['Total Memory'] = `${(os.totalmem() / 1024 / 1024 / 1024).toFixed(1)} GB`
    } catch {
      info['Total Memory'] = 'unknown'
    }

    // captureMode：设置项位于渲染进程 localStorage，主进程拿不到
    info['Capture Mode'] = 'renderer-side (localStorage: switchcast:settings)'
    try {
      const cfg = getCaptureManager().getConfig()
      if (cfg) {
        const mode = (cfg as { captureMode?: string }).captureMode
        if (mode) info['Last Capture Mode'] = mode
      }
      info['Capture State'] = getCaptureManager().getState()
    } catch {
      /* 静默 */
    }

    // 原生模块可用性：已加载状态 + 安装探测（require.resolve 不执行模块）
    try {
      info['Native Addon Loaded'] = String(getCaptureManager().isNativeAvailable())
    } catch {
      info['Native Addon Loaded'] = 'unknown'
    }
    try {
      require.resolve('capture-addon')
      info['Native Addon Installed'] = process.platform === 'darwin' ? 'true' : 'true (macOS only)'
    } catch {
      info['Native Addon Installed'] = 'false'
    }

    try {
      info['Uptime'] = `${Math.floor(process.uptime())}s`
    } catch {
      /* 静默 */
    }

    return info
  }

  /**
   * 导出诊断报告
   *
   * 流程：showSaveDialog → 临时目录（system-info.txt + logs/ + crash-reports/）
   * → ditto -c -k 打包 zip → 清理临时目录。
   * ditto 失败时回退为目录导出（保留临时目录）。
   */
  async exportReport(
    parentWindow: BrowserWindow | null
  ): Promise<{ success: boolean; path?: string; error?: string }> {
    const logger = getLogger()
    let tempDir = ''

    try {
      const defaultName = `SwitchCast-Diagnostics-${this.formatTimestamp(new Date())}.zip`
      const options: Electron.SaveDialogOptions = {
        title: '导出诊断报告',
        defaultPath: defaultName,
        filters: [{ name: 'Zip Archive', extensions: ['zip'] }]
      }
      const result = parentWindow
        ? await dialog.showSaveDialog(parentWindow, options)
        : await dialog.showSaveDialog(options)

      if (result.canceled || !result.filePath) {
        return { success: false, error: 'cancelled' }
      }
      const zipPath = result.filePath

      // 建临时目录
      tempDir = await fs.promises.mkdtemp(
        path.join(app.getPath('temp'), 'switchcast-diagnostics-')
      )

      // 1. system-info.txt（含采集清单说明）
      const info = await this.collectSystemInfo()
      await fs.promises.writeFile(
        path.join(tempDir, 'system-info.txt'),
        this.buildSystemInfoText(info),
        'utf8'
      )

      // 2. 拷贝应用日志
      await this.copyLogs(tempDir)

      // 3. 收集 macOS 系统崩溃报告（近 7 天、SwitchCast 相关）
      await this.collectCrashReports(tempDir)

      // 4. 收集 Crashpad 本地崩溃 dump（crashReporter.start uploadToServer:false 的产物）
      await this.collectCrashpadDumps(tempDir)

      // 5. ditto 打包
      try {
        await fs.promises.rm(zipPath, { force: true })
        await execFileAsync('ditto', ['-c', '-k', tempDir, zipPath], {
          timeout: DITTO_TIMEOUT_MS
        })
        await fs.promises.rm(tempDir, { recursive: true, force: true })
        logger.info('diagnostics', `诊断报告导出成功: ${zipPath}`)
        return { success: true, path: zipPath }
      } catch (zipErr) {
        // ditto 失败回退：只导出目录，保留临时目录
        logger.warn(
          'diagnostics',
          `ditto 打包失败，回退目录导出: ${zipErr instanceof Error ? zipErr.message : String(zipErr)}`
        )
        return {
          success: true,
          path: tempDir,
          error: 'zip 打包失败，已回退为目录导出'
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('diagnostics', `诊断报告导出失败: ${message}`)
      // 尽力清理临时目录
      if (tempDir) {
        await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {
          /* 静默 */
        })
      }
      return { success: false, error: message }
    }
  }

  /**
   * 构建 GitHub Issue 预填链接（含版本/平台/架构/系统摘要，总长 ≤ 4KB）
   */
  async buildIssueUrl(): Promise<string> {
    const info = await this.collectSystemInfo()

    const title = '[诊断反馈] '
    let body = [
      '## 环境信息（自动生成）',
      `- 版本: ${info['App Version']}`,
      `- 平台: ${info['Platform']} ${info['Arch']} / ${info['OS Release']}`,
      `- Electron: ${info['Electron']} / Chrome: ${info['Chrome']} / Node: ${info['Node.js']}`,
      `- CPU: ${info['CPU']} / 内存: ${info['Total Memory']}`,
      `- 原生模块: loaded=${info['Native Addon Loaded']} installed=${info['Native Addon Installed']}`,
      '',
      '## 问题描述',
      '（请在此描述遇到的问题、复现步骤与预期行为）',
      '',
      '> 请附上诊断报告 zip（设置 → 导出诊断报告），便于快速定位问题。'
    ].join('\n')

    let url = this.composeIssueUrl(title, body)
    // 超长时逐步截断 body 直至总长 ≤ 4KB
    while (url.length > ISSUE_URL_MAX_LENGTH && body.length > 100) {
      body = body.slice(0, Math.floor(body.length / 2))
      url = this.composeIssueUrl(title, body)
    }
    return url
  }

  // ==================== 内部工具 ====================

  private composeIssueUrl(title: string, body: string): string {
    return `https://github.com/Isaacocu/switchcast/issues/new?title=${encodeURIComponent(
      title
    )}&body=${encodeURIComponent(body)}`
  }

  /** YYYYMMDD-HHmmss */
  private formatTimestamp(date: Date): string {
    const pad = (n: number): string => String(n).padStart(2, '0')
    return (
      `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
      `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
    )
  }

  /** system-info.txt 文本（含采集清单说明） */
  private buildSystemInfoText(info: Record<string, string>): string {
    const lines: string[] = [
      'SwitchCast Diagnostics Report',
      `Generated: ${new Date().toISOString()}`,
      '',
      '== System Info ==',
      ...Object.entries(info).map(([key, value]) => `${key}: ${value}`),
      '',
      '== 采集清单说明 ==',
      'system-info.txt    本文件，应用与环境信息摘要',
      'logs/              应用日志（app.getPath("logs") 下 switchcast*.log，含轮转归档）',
      'crash-reports/     macOS 系统崩溃报告（~/Library/Logs/DiagnosticReports/，',
      '                   近 7 天、文件名含 SwitchCast 的 .ips/.crash，最多 5 份，单份截断 200KB）',
      'crashpad-dumps/    Crashpad 本地崩溃 dump（app.getPath("crashDumps") 及其 completed 子目录，',
      '                   近 7 天的 .dmp，最多 5 份，单份截断 200KB）',
      ''
    ]
    return lines.join('\n')
  }

  /** 拷贝 app.getPath('logs') 下 switchcast 相关日志到 tempDir/logs/，失败静默 */
  private async copyLogs(tempDir: string): Promise<void> {
    try {
      const logDir = app.getPath('logs')
      const entries = await fs.promises.readdir(logDir)
      const logFiles = entries.filter((name) => name.startsWith('switchcast') && name.endsWith('.log'))
      if (logFiles.length === 0) return

      const destDir = path.join(tempDir, 'logs')
      await fs.promises.mkdir(destDir, { recursive: true })
      for (const name of logFiles) {
        try {
          await fs.promises.copyFile(path.join(logDir, name), path.join(destDir, name))
        } catch {
          /* 单个文件失败静默跳过 */
        }
      }
    } catch {
      /* 静默 */
    }
  }

  /**
   * 收集 ~/Library/Logs/DiagnosticReports/ 近 7 天、文件名含 SwitchCast 的
   * .ips/.crash 崩溃报告（最多 5 个、每个截断 200KB），失败静默跳过
   */
  private async collectCrashReports(tempDir: string): Promise<void> {
    try {
      const reportDir = path.join(os.homedir(), 'Library', 'Logs', 'DiagnosticReports')
      const entries = await fs.promises.readdir(reportDir)
      const now = Date.now()

      const candidates: Array<{ name: string; mtimeMs: number }> = []
      for (const name of entries) {
        if (!name.includes('SwitchCast')) continue
        if (!name.endsWith('.ips') && !name.endsWith('.crash')) continue
        try {
          const stat = await fs.promises.stat(path.join(reportDir, name))
          if (now - stat.mtimeMs <= CRASH_REPORT_MAX_AGE_MS) {
            candidates.push({ name, mtimeMs: stat.mtimeMs })
          }
        } catch {
          /* 静默跳过 */
        }
      }

      candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)
      const picked = candidates.slice(0, CRASH_REPORT_MAX_COUNT)
      if (picked.length === 0) return

      const destDir = path.join(tempDir, 'crash-reports')
      await fs.promises.mkdir(destDir, { recursive: true })

      for (const { name } of picked) {
        try {
          const src = path.join(reportDir, name)
          const fh = await fs.promises.open(src, 'r')
          try {
            const buf = Buffer.alloc(CRASH_REPORT_MAX_BYTES)
            const { bytesRead } = await fh.read(buf, 0, buf.length, 0)
            await fs.promises.writeFile(path.join(destDir, name), buf.subarray(0, bytesRead))
          } finally {
            await fh.close().catch(() => {
              /* 静默 */
            })
          }
        } catch {
          /* 单个文件失败静默跳过 */
        }
      }
    } catch {
      /* 目录不存在（非 macOS）或不可读，静默 */
    }
  }

  /**
   * 收集 app.getPath('crashDumps') 及其 completed 子目录下近 7 天的 .dmp
   * （crashReporter.start({uploadToServer:false}) 的产物，不会出现在
   * ~/Library/Logs/DiagnosticReports），最多 5 个、每个截断 200KB，失败静默
   */
  private async collectCrashpadDumps(tempDir: string): Promise<void> {
    try {
      const baseDir = app.getPath('crashDumps')
      const scanDirs = [baseDir, path.join(baseDir, 'completed')]
      const now = Date.now()

      const candidates: Array<{ full: string; name: string; mtimeMs: number }> = []
      for (const dir of scanDirs) {
        let entries: string[]
        try {
          entries = await fs.promises.readdir(dir)
        } catch {
          continue
        }
        for (const name of entries) {
          if (!name.endsWith('.dmp')) continue
          const full = path.join(dir, name)
          try {
            const stat = await fs.promises.stat(full)
            if (!stat.isFile()) continue
            if (now - stat.mtimeMs <= CRASH_REPORT_MAX_AGE_MS) {
              candidates.push({ full, name, mtimeMs: stat.mtimeMs })
            }
          } catch {
            /* 静默跳过 */
          }
        }
      }

      if (candidates.length === 0) return
      candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)
      const picked = candidates.slice(0, CRASH_REPORT_MAX_COUNT)

      const destDir = path.join(tempDir, 'crashpad-dumps')
      await fs.promises.mkdir(destDir, { recursive: true })

      for (const { full, name } of picked) {
        try {
          const fh = await fs.promises.open(full, 'r')
          try {
            const buf = Buffer.alloc(CRASH_REPORT_MAX_BYTES)
            const { bytesRead } = await fh.read(buf, 0, buf.length, 0)
            await fs.promises.writeFile(path.join(destDir, name), buf.subarray(0, bytesRead))
          } finally {
            await fh.close().catch(() => {
              /* 静默 */
            })
          }
        } catch {
          /* 单个文件失败静默跳过 */
        }
      }
    } catch {
      /* crashDumps 目录不可用，静默 */
    }
  }
}

/** 单例实例 */
let diagnosticsInstance: Diagnostics | null = null

/**
 * 获取诊断服务单例
 */
export function getDiagnostics(): Diagnostics {
  if (!diagnosticsInstance) {
    diagnosticsInstance = new Diagnostics()
  }
  return diagnosticsInstance
}
