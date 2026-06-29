/// <reference types="vite/client" />
/// <reference types="electron-vite/node" />

import type { CaptureConfig, CaptureState, CaptureError, DeviceList } from './types/capture'

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

/** window.capture — 采集 API（由 preload contextBridge 暴露） */
interface CaptureApi {
  /** 枚举采集设备 */
  listDevices: () => Promise<DeviceList>
  /** 启动采集 */
  start: (config: CaptureConfig) => Promise<{ success: boolean; error?: string }>
  /** 停止采集 */
  stop: () => Promise<{ success: boolean; error?: string }>
  /** 注册采集状态变更回调，返回取消订阅函数 */
  onStateChange: (callback: (state: CaptureState) => void) => () => void
  /** 注册采集错误回调，返回取消订阅函数 */
  onError: (callback: (error: CaptureError) => void) => () => void
}

/** window.electron — Electron 平台信息（由 preload contextBridge 暴露） */
interface ElectronApi {
  /** 当前操作系统平台 */
  platform: string
}

/** window.windowControls — 窗口控制 API（由 preload contextBridge 暴露） */
interface WindowControlsApi {
  /** 最小化窗口 */
  minimize: () => void
  /** 最大化/还原窗口 */
  maximize: () => void
  /** 关闭窗口 */
  close: () => void
}

interface Window {
  /** 采集 API */
  capture: CaptureApi
  /** Electron 平台信息 */
  electron: ElectronApi
  /** 窗口控制 API */
  windowControls: WindowControlsApi
}

interface ImportMetaEnv {
  readonly [key: string]: any
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
