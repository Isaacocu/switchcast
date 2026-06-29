import { contextBridge, ipcRenderer } from 'electron'
import type { CaptureConfig, CaptureState, CaptureError } from '../../src/types/capture'

/**
 * 采集 API — 通过 contextBridge 暴露给渲染进程
 *
 * 渲染进程通过 window.capture 访问以下方法：
 * - listDevices()    枚举可用的视频/音频采集设备
 * - start(config)    启动采集
 * - stop()           停止采集
 * - onStateChange()  注册采集状态变更回调（返回取消订阅函数）
 * - onError()        注册采集错误回调（返回取消订阅函数）
 */
const captureApi = {
  /** 枚举采集设备 */
  listDevices: (): Promise<{ video: Array<{ deviceId: string; label: string }>; audio: Array<{ deviceId: string; label: string }> }> => {
    return ipcRenderer.invoke('capture:listDevices')
  },

  /** 启动采集 */
  start: (config: CaptureConfig): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('capture:start', config)
  },

  /** 停止采集 */
  stop: (): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('capture:stop')
  },

  /** 注册采集状态变更回调，返回取消订阅函数 */
  onStateChange: (callback: (state: CaptureState) => void): (() => void) => {
    const handler = (_event: unknown, state: CaptureState) => callback(state)
    ipcRenderer.on('capture:state', handler)
    return () => ipcRenderer.off('capture:state', handler)
  },

  /** 注册采集错误回调，返回取消订阅函数 */
  onError: (callback: (error: CaptureError) => void): (() => void) => {
    const handler = (_event: unknown, error: CaptureError) => callback(error)
    ipcRenderer.on('capture:error', handler)
    return () => ipcRenderer.off('capture:error', handler)
  }
}

/**
 * Electron 平台信息 API
 */
const electronApi = {
  /** 获取当前操作系统平台 */
  platform: process.platform
}

/**
 * 窗口控制 API
 */
const windowApi = {
  minimize: (): void => {
    ipcRenderer.send('window:minimize')
  },
  maximize: (): void => {
    ipcRenderer.send('window:maximize')
  },
  close: (): void => {
    ipcRenderer.send('window:close')
  }
}

// 暴露采集 API 到渲染进程
contextBridge.exposeInMainWorld('capture', captureApi)

// 暴露 Electron 平台信息到渲染进程
contextBridge.exposeInMainWorld('electron', electronApi)

// 暴露窗口控制 API 到渲染进程
contextBridge.exposeInMainWorld('windowControls', windowApi)
