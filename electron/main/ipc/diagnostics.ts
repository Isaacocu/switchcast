import { ipcMain, shell, app, BrowserWindow } from 'electron'
import { getDiagnostics } from '../services/diagnostics'
import { getLogger } from '../services/logger'

/**
 * 注册诊断日志与报告导出相关的 IPC handlers
 *
 * 通道列表：
 * - diagnostics:export    — 导出诊断报告 zip（showSaveDialog → 打包）
 * - diagnostics:openIssue — 打开预填环境信息的 GitHub Issue 页面
 * - diagnostics:openLogDir— 在 Finder/资源管理器中打开日志目录
 * - log:renderer          — 渲染进程错误上报（ipcMain.on，同消息限流：每分钟最多 10 条）
 */

/** log:renderer 限流：相同 message 每分钟最多 10 条 */
const RENDERER_LOG_MAX_PER_MINUTE = 10

/** 限流 key 长度上限（取 message 前 200 字符，避免超长消息撑大限流表） */
const RENDERER_LOG_KEY_MAX_LEN = 200

/** message 落盘截断上限（4KB，避免单条巨型日志撑大磁盘） */
const RENDERER_LOG_MESSAGE_MAX_LEN = 4096

/** 限流表最大条目数（超出时清空，防止内存无限增长） */
const RENDERER_LOG_MAP_LIMIT = 500

/** 限流表：message → 当前分钟与计数 */
const rateLimitMap = new Map<string, { minute: number; count: number }>()

export function registerDiagnosticsIpc(ipcMainInstance: typeof ipcMain): void {
  const diagnostics = getDiagnostics()
  const logger = getLogger()

  // 导出诊断报告
  ipcMainInstance.handle('diagnostics:export', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return await diagnostics.exportReport(win)
  })

  // 打开预填环境信息的 GitHub Issue 页面
  ipcMainInstance.handle('diagnostics:openIssue', async () => {
    try {
      const url = await diagnostics.buildIssueUrl()
      await shell.openExternal(url)
      return { success: true }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // 打开日志目录
  ipcMainInstance.handle('diagnostics:openLogDir', async () => {
    try {
      const errorMessage = await shell.openPath(app.getPath('logs'))
      if (errorMessage) {
        return { success: false, error: errorMessage }
      }
      return { success: true }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // 渲染进程错误上报（同消息限流：每分钟最多 10 条，超出丢弃）
  ipcMainInstance.on('log:renderer', (_event, payload: { level?: string; message?: string }) => {
    try {
      const message =
        typeof payload?.message === 'string' ? payload.message : String(payload?.message ?? '')
      if (!message) return

      // 限流判断（key 取前 200 字符，避免超长消息导致限流表膨胀）
      const minute = Math.floor(Date.now() / 60000)
      const limitKey = message.slice(0, RENDERER_LOG_KEY_MAX_LEN)
      const entry = rateLimitMap.get(limitKey)
      if (entry && entry.minute === minute) {
        entry.count += 1
        if (entry.count > RENDERER_LOG_MAX_PER_MINUTE) return
      } else {
        if (rateLimitMap.size >= RENDERER_LOG_MAP_LIMIT) {
          rateLimitMap.clear()
        }
        rateLimitMap.set(limitKey, { minute, count: 1 })
      }

      // 落盘前截断至 4KB
      const safeMessage =
        message.length > RENDERER_LOG_MESSAGE_MAX_LEN
          ? `${message.slice(0, RENDERER_LOG_MESSAGE_MAX_LEN)}…（已截断）`
          : message

      const level = payload?.level
      if (level === 'warn') {
        logger.warn('renderer', safeMessage)
      } else if (level === 'info') {
        logger.info('renderer', safeMessage)
      } else {
        logger.error('renderer', safeMessage)
      }
    } catch {
      /* 静默：错误上报自身失败不影响任何流程 */
    }
  })
}
