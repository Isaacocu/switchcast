import { ipcMain, BrowserWindow } from 'electron'
import { getCaptureManager } from '../services/capture-manager'
import type { CaptureConfig } from '../../../src/types/capture'

/**
 * 注册采集相关的 IPC handlers
 *
 * 通道列表：
 * - capture:listDevices — 枚举可用的视频/音频采集设备
 * - capture:start       — 启动采集（传入 CaptureConfig）
 * - capture:stop        — 停止采集
 *
 * 事件推送（主进程 → 渲染进程）：
 * - capture:state — 采集状态变更通知
 * - capture:error — 采集错误通知
 */
export function registerCaptureIpc(ipcMainInstance: typeof ipcMain): void {
  const captureManager = getCaptureManager()

  // 绑定主窗口引用，以便 captureManager 向渲染进程发送事件
  const updateMainWindow = (): void => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      captureManager.setMainWindow(win)
    }
  }

  // 枚举采集设备
  ipcMainInstance.handle('capture:listDevices', async () => {
    updateMainWindow()
    return await captureManager.listDevices()
  })

  // 启动采集
  ipcMainInstance.handle('capture:start', async (_event, config: CaptureConfig) => {
    updateMainWindow()
    try {
      await captureManager.start(config)
      return { success: true }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // 停止采集
  ipcMainInstance.handle('capture:stop', async () => {
    try {
      await captureManager.stop()
      return { success: true }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })
}
