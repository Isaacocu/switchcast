/// <reference types="vite/client" />
/// <reference types="electron-vite/node" />

import type { CaptureConfig, CaptureState, CaptureError, DeviceList } from './types/capture'
import type { UpdateInfo, UpdaterStatus, UpdateProgress } from './types/update'

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

/** window.nativeCapture — 原生采集 API（由 preload contextBridge 暴露，仅 macOS 可用） */
interface NativeCaptureApi {
  /** 查询原生采集模块是否可用（已成功加载） */
  isAvailable: () => Promise<boolean>
  /** 将原生 Metal layer attach 到指定 NSView */
  attach: (handle: Buffer) => Promise<boolean>
  /** 注册原生采集统计回调（fps/延迟），返回取消订阅函数 */
  onStats: (callback: (stats: { fps: number; latency: number }) => void) => () => void
}

/** window.diagnostics — 诊断 API（由 preload contextBridge 暴露） */
interface DiagnosticsApi {
  /** 导出诊断报告 zip */
  exportReport: () => Promise<{ success: boolean; path?: string; error?: string }>
  /** 打开预填环境信息的 GitHub Issue 页面 */
  openIssue: () => Promise<{ success: boolean; error?: string }>
  /** 打开日志目录 */
  openLogDir: () => Promise<{ success: boolean; error?: string }>
  /** 渲染进程错误上报（主进程侧限流） */
  reportError: (level: 'info' | 'warn' | 'error', message: string) => void
}

/** window.updater — 应用更新 API（由 preload contextBridge 暴露） */
interface UpdaterApi {
  /** 检查更新（manual=true 跳过 24h 节流，失败时返回 error） */
  check: (manual: boolean) => Promise<{ success: boolean; error?: string; info?: UpdateInfo | null }>
  /** 下载更新包 + 解压暂存（进度经 onProgress 推送） */
  download: () => Promise<{ success: boolean; error?: string }>
  /** 就地安装（macOS，守卫检查不通过返回原因） */
  install: () => Promise<{ success: boolean; error?: string }>
  /** 打开 GitHub Release 页面（降级路径） */
  openReleasePage: () => Promise<{ success: boolean; error?: string }>
  /** 获取当前更新器状态 */
  getState: () => Promise<UpdaterStatus>
  /** 注册更新状态回调，返回取消订阅函数 */
  onStatus: (callback: (status: UpdaterStatus) => void) => () => void
  /** 注册下载进度回调（主进程侧节流至每秒最多 4 次），返回取消订阅函数 */
  onProgress: (callback: (progress: UpdateProgress) => void) => () => void
}

/** window.appInfo — 应用静态信息（由 preload contextBridge 暴露） */
interface AppInfo {
  /** 应用版本号（app.getVersion()） */
  version: string
  /** 操作系统平台 */
  platform: string
  /** CPU 架构 */
  arch: string
}

declare global {
  interface Window {
    /** 采集 API */
    capture: CaptureApi
    /** Electron 平台信息 */
    electron: ElectronApi
    /** 窗口控制 API */
    windowControls: WindowControlsApi
    /** 原生采集 API（仅 macOS 注入，其他平台为 undefined） */
    nativeCapture: NativeCaptureApi
    /** 诊断 API */
    diagnostics?: DiagnosticsApi
    /** 应用更新 API */
    updater: UpdaterApi
    /** 应用静态信息 */
    appInfo: AppInfo
  }

  // MediaStreamTrackProcessor (Insertable Streams API) 类型声明
  // Chromium 94+ 支持（Electron 31 满足），TS lib.dom 暂未收录
  class MediaStreamTrackProcessor<T = VideoFrame> {
    constructor(init: { track: MediaStreamTrack })
    readonly readable: ReadableStream<T>
  }
}

interface ImportMetaEnv {
  readonly [key: string]: any
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
