import { contextBridge, ipcRenderer } from 'electron'
import type { CaptureConfig, CaptureState, CaptureError } from '../../src/types/capture'
import type { UpdateInfo, UpdaterStatus, UpdateProgress } from '../../src/types/update'

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
 * 原生采集 API — 通过 contextBridge 暴露给渲染进程
 *
 * 渲染进程通过 window.nativeCapture 访问以下方法：
 * - isAvailable()  查询原生采集模块是否可用（仅 macOS）
 * - attach(handle) 将 Metal layer attach 到指定 NSView
 * - onStats(cb)    注册原生采集统计回调（返回取消订阅函数）
 */
const nativeCaptureApi = {
  /** 查询原生采集模块是否可用 */
  isAvailable: (): Promise<boolean> => ipcRenderer.invoke('native:isAvailable'),

  /** 将原生 Metal layer attach 到指定 NSView */
  attach: (handle: Buffer): Promise<boolean> => ipcRenderer.invoke('native:attach', handle),

  /** 注册原生采集统计回调（fps/延迟），返回取消订阅函数 */
  onStats: (callback: (stats: { fps: number; latency: number }) => void): (() => void) => {
    const handler = (_event: unknown, stats: { fps: number; latency: number }) => callback(stats)
    ipcRenderer.on('capture:nativeStats', handler)
    return () => ipcRenderer.off('capture:nativeStats', handler)
  },
}

/**
 * Electron 平台信息 API
 */
const electronApi = {
  /** 获取当前操作系统的平台 */
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

/**
 * 诊断 API — 诊断报告导出 / Issue 反馈 / 日志目录 / 渲染进程错误上报
 *
 * 渲染进程通过 window.diagnostics 访问以下方法：
 * - exportReport()         导出诊断报告 zip
 * - openIssue()            打开预填环境信息的 GitHub Issue 页面
 * - openLogDir()           在 Finder/资源管理器中打开日志目录
 * - reportError(level,msg) 渲染进程错误上报（主进程侧限流）
 */
const diagnosticsApi = {
  /** 导出诊断报告 zip */
  exportReport: (): Promise<{ success: boolean; path?: string; error?: string }> => {
    return ipcRenderer.invoke('diagnostics:export')
  },

  /** 打开预填环境信息的 GitHub Issue 页面 */
  openIssue: (): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('diagnostics:openIssue')
  },

  /** 打开日志目录 */
  openLogDir: (): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('diagnostics:openLogDir')
  },

  /** 渲染进程错误上报（fire-and-forget，主进程侧同消息限流） */
  reportError: (level: 'info' | 'warn' | 'error', message: string): void => {
    ipcRenderer.send('log:renderer', { level, message })
  }
}

/**
 * 应用更新 API — 通过 contextBridge 暴露给渲染进程
 *
 * 渲染进程通过 window.updater 访问以下方法：
 * - check(manual)      检查更新（manual=true 跳过 24h 节流）
 * - download()         下载更新包并解压暂存（进度经 onProgress 推送）
 * - install()          就地安装（macOS，守卫检查不通过返回原因）
 * - openReleasePage()  打开 GitHub Release 页面（降级路径）
 * - getState()         获取当前更新器状态
 * - onStatus(cb)       注册更新状态回调（返回取消订阅函数）
 * - onProgress(cb)     注册下载进度回调（返回取消订阅函数）
 */
const updaterApi = {
  /** 检查更新 */
  check: (manual: boolean): Promise<{ success: boolean; error?: string; info?: UpdateInfo | null }> => {
    return ipcRenderer.invoke('update:check', { manual })
  },

  /** 下载更新包 + 解压暂存 */
  download: (): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('update:download')
  },

  /** 就地安装（macOS） */
  install: (): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('update:install')
  },

  /** 打开 GitHub Release 页面（降级路径） */
  openReleasePage: (): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('update:openReleasePage')
  },

  /** 获取当前更新器状态 */
  getState: (): Promise<UpdaterStatus> => {
    return ipcRenderer.invoke('update:getState')
  },

  /** 注册更新状态回调，返回取消订阅函数 */
  onStatus: (callback: (status: UpdaterStatus) => void): (() => void) => {
    const handler = (_event: unknown, status: UpdaterStatus) => callback(status)
    ipcRenderer.on('update:status', handler)
    return () => ipcRenderer.off('update:status', handler)
  },

  /** 注册下载进度回调（主进程侧节流至每秒最多 4 次），返回取消订阅函数 */
  onProgress: (callback: (progress: UpdateProgress) => void): (() => void) => {
    const handler = (_event: unknown, progress: UpdateProgress) => callback(progress)
    ipcRenderer.on('update:progress', handler)
    return () => ipcRenderer.off('update:progress', handler)
  }
}

/**
 * 应用静态信息 — version 经 sendSync 从主进程获取（主进程注册 app:getVersion），
 * platform / arch 在 preload 侧直接读取
 */
const appInfoApi = {
  /** 应用版本号（app.getVersion()） */
  version: ipcRenderer.sendSync('app:getVersion') as string,
  /** 操作系统平台 */
  platform: process.platform,
  /** CPU 架构 */
  arch: process.arch
}

// 暴露采集 API 到渲染进程
contextBridge.exposeInMainWorld('capture', captureApi)

// 暴露原生采集 API 到渲染进程
contextBridge.exposeInMainWorld('nativeCapture', nativeCaptureApi)

// 暴露 Electron 平台信息到渲染进程
contextBridge.exposeInMainWorld('electron', electronApi)

// 暴露窗口控制 API 到渲染进程
contextBridge.exposeInMainWorld('windowControls', windowApi)

// 暴露诊断 API 到渲染进程
contextBridge.exposeInMainWorld('diagnostics', diagnosticsApi)

// 暴露应用更新 API 到渲染进程
contextBridge.exposeInMainWorld('updater', updaterApi)

// 暴露应用静态信息到渲染进程
contextBridge.exposeInMainWorld('appInfo', appInfoApi)
