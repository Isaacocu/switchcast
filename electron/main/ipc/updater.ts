import { ipcMain, shell, BrowserWindow } from 'electron'
import { getUpdateChecker } from '../services/update-checker'
import { getMacInplaceUpdater } from '../services/mac-inplace-updater'
import { getLogger } from '../services/logger'
import type { UpdateProgress } from '../../../src/types/update'

/**
 * 注册应用更新相关的 IPC handlers
 *
 * 通道列表：
 * - update:check           — 检查更新（参数 { manual }），返回 { success, error?, info? }
 * - update:download        — 下载 + 解压暂存，进度经 update:progress 推送
 * - update:install         — 守卫检查通过后执行就地安装（退出应用）
 * - update:openReleasePage — 打开 GitHub Releases 页面（降级路径）
 * - update:getState        — 获取当前 UpdaterStatus
 *
 * 事件推送（主进程 → 渲染进程）：
 * - update:status   — UpdaterStatus（由 update-checker 广播）
 * - update:progress — { percent, received, total }，节流至每秒最多 4 次
 */

/** Release 页面（降级路径：无匹配资产 / Windows v1 引导手动下载） */
const RELEASE_PAGE_URL = 'https://github.com/Isaacocu/switchcast/releases/latest'

/** 进度推送最小间隔（250ms = 每秒最多 4 次） */
const PROGRESS_MIN_INTERVAL_MS = 250

/** 向所有窗口广播事件（失败静默） */
function broadcast(channel: string, payload: unknown): void {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(channel, payload)
    }
  } catch {
    /* 静默 */
  }
}

/**
 * 创建带节流的下载进度广播器
 * - onProgress 由下载流程高频调用，内部节流至每秒最多 4 次推送
 * - flush 在下载结束时强制推送最后一帧，保证 UI 收到 100%
 */
function createProgressBroadcaster(): {
  onProgress: (received: number, total: number) => void
  flush: () => void
} {
  let lastEmitTs = 0
  let lastPayload: UpdateProgress | null = null

  return {
    onProgress: (received: number, total: number) => {
      const percent = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0
      lastPayload = { percent, received, total: Math.max(total, 0) }
      const now = Date.now()
      if (now - lastEmitTs >= PROGRESS_MIN_INTERVAL_MS) {
        lastEmitTs = now
        broadcast('update:progress', lastPayload)
      }
    },
    flush: () => {
      if (lastPayload) {
        broadcast('update:progress', lastPayload)
        lastPayload = null
      }
    }
  }
}

export function registerUpdaterIpc(ipcMainInstance: typeof ipcMain): void {
  const checker = getUpdateChecker()
  const installer = getMacInplaceUpdater()
  const logger = getLogger()

  // 启动清理：上次更新遗留的 SwitchCast.app.old（仅 darwin，异步静默）
  if (process.platform === 'darwin') {
    try {
      installer.cleanupOld()
    } catch {
      /* 静默 */
    }
  }

  // 检查更新（manual=true 跳过 24h 节流，失败时返回 error 供 UI 展示）
  ipcMainInstance.handle('update:check', async (_event, payload?: { manual?: boolean }) => {
    const manual = !!payload?.manual
    try {
      const info = await checker.check(manual)
      return { success: true, info: info ?? null }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // 下载更新包 + 解压暂存（进度经 update:progress 推送）
  ipcMainInstance.handle('update:download', async () => {
    if (process.platform !== 'darwin') {
      return { success: false, error: '当前平台暂不支持就地更新，请前往 Release 页面手动下载' }
    }
    const info = checker.getLastInfo()
    if (!info?.downloadUrl) {
      return { success: false, error: '暂无下载地址，请先检查更新' }
    }

    checker.setPhase('downloading')
    const progress = createProgressBroadcaster()
    try {
      logger.info('updater', `开始下载更新包: ${info.downloadUrl}`)
      await installer.download(info.downloadUrl, progress.onProgress)
      progress.flush()

      logger.info('updater', '开始解压暂存（stage）')
      await installer.stage()

      checker.setPhase('ready')
      logger.info('updater', '更新包已就绪，等待用户确认安装')
      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('updater', `更新包下载/暂存失败: ${message}`)
      checker.setPhase('error', { error: message })
      return { success: false, error: message }
    }
  })

  // 就地安装（守卫检查不通过返回原因）
  ipcMainInstance.handle('update:install', async () => {
    try {
      const reason = installer.canInstall()
      if (reason) {
        return { success: false, error: reason }
      }
      await installer.install()
      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('updater', `就地安装失败: ${message}`)
      checker.setPhase('error', { error: message })
      return { success: false, error: message }
    }
  })

  // 打开 GitHub Release 页面（降级路径）
  ipcMainInstance.handle('update:openReleasePage', async () => {
    try {
      await shell.openExternal(RELEASE_PAGE_URL)
      return { success: true }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // 获取当前更新器状态
  ipcMainInstance.handle('update:getState', () => {
    return checker.getStatus()
  })
}
