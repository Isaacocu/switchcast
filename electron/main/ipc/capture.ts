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
 * 原生采集 IPC（新增）：
 * - native:isAvailable  — 查询原生采集模块是否可用
 * - native:attach       — 将 Metal layer attach 到指定 NSView
 *
 * 事件推送（主进程 → 渲染进程）：
 * - capture:state       — 采集状态变更通知
 * - capture:error       — 采集错误通知
 * - capture:nativeStats — 原生采集统计信息推送（fps/延迟）
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

  // ==================== 原生采集 IPC（新增，不影响现有通道） ====================

  // 查询原生采集模块是否可用（渲染进程据此决定是否走原生分支）
  ipcMainInstance.handle('native:isAvailable', () => {
    updateMainWindow()
    return captureManager.isNativeAvailable()
  })

  // 将原生 Metal layer attach 到指定 NSView（渲染进程传入句柄）
  // 注意：渲染进程通常无法获取 NSView，主流程由 capture-manager.start 自动 attach，
  // 此通道保留供需要时显式触发 attach 的场景
  ipcMainInstance.handle('native:attach', (_event, nsViewHandle: Buffer) => {
    return captureManager.attachToWindow(nsViewHandle)
  })
}
