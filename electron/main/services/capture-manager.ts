import { BrowserWindow } from 'electron'
import type {
  DeviceList,
  CaptureConfig,
  CaptureState,
  CaptureError,
  CaptureStats
} from '../../../src/types/capture'

/**
 * 采集管理器 — 单例模式
 *
 * Phase 2 MVP：负责采集状态管理和设备信息转发。
 * 实际的 getUserMedia 调用发生在渲染进程中，
 * 主进程负责状态协调、配置记录和事件分发。
 *
 * 原生采集扩展（macOS）：当 captureMode 为 native 或 auto 时，
 * 优先加载 native/capture-addon 原生模块，通过 AVCaptureSession +
 * Metal 直接渲染到窗口 NSView，绕过 Chromium 采集管线以降低延迟。
 * 原生模块加载失败或启动异常时自动回退 WebView（getUserMedia）路径，
 * 现有 WebView 回退链不受影响。
 */
class CaptureManager {
  /** 当前采集状态 */
  private state: CaptureState = 'idle'

  /** 当前采集配置 */
  private config: CaptureConfig | null = null

  /** 采集统计信息 */
  private stats: CaptureStats | null = null

  /** 主窗口引用，用于向渲染进程发送事件 */
  private mainWindow: BrowserWindow | null = null

  /** 原生采集模块实例（macOS 加载成功后非 null，其他平台或加载失败为 null） */
  private nativeAddon: any = null

  /** 原生采集是否处于活动状态（create 成功且未 stop/崩溃） */
  private nativeActive: boolean = false

  /**
   * 绑定主窗口引用，用于发送状态变更和错误事件
   */
  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
  }

  /**
   * 获取当前采集状态
   */
  getState(): CaptureState {
    return this.state
  }

  /**
   * 获取当前采集配置
   */
  getConfig(): CaptureConfig | null {
    return this.config
  }

  /**
   * 原生采集模块是否可用（已成功加载）
   * 渲染进程通过 native:isAvailable IPC 查询，决定是否走原生分支
   */
  isNativeAvailable(): boolean {
    return this.nativeAddon !== null
  }

  /**
   * 加载原生采集模块（仅 macOS）
   * 幂等：已加载成功时直接返回 true，加载失败返回 false
   * 非 macOS 平台直接返回 false，不影响 WebView 回退路径
   */
  private loadNativeAddon(): boolean {
    if (process.platform !== 'darwin') return false
    if (this.nativeAddon !== null) return true
    try {
      // 原生模块路径基于编译后输出目录 out/main/，上溯两级到项目根
      const addon = require('capture-addon')
      if (addon) {
        this.nativeAddon = addon
        // 注册原生 stats 回调 — 推送到渲染进程供 OSD 显示
        this.nativeAddon.on('stats', (stats: { fps: number; latency: number }) => {
          this.emitStats(stats)
        })
        // 注册原生 error 回调 — crash 时标记失效并回退 WebView
        this.nativeAddon.on('error', (error: string) => {
          this.emitError({ code: 'NATIVE_ERROR', message: error })
          this.nativeActive = false
        })
        console.info('[capture-manager] 原生采集模块加载成功')
        return true
      }
    } catch (err) {
      console.warn('[capture-manager] 原生模块加载失败:', err)
    }
    return false
  }

  /**
   * 枚举可用设备
   *
   * 原生模式：通过原生模块枚举视频设备（AVFoundation，无需权限即可获取 label）。
   * 回退模式：返回空列表，渲染进程通过 navigator.mediaDevices.enumerateDevices() 自行枚举。
   */
  async listDevices(): Promise<DeviceList> {
    // 原生模块已加载或可加载时优先使用原生枚举
    if (this.nativeAddon || this.loadNativeAddon()) {
      try {
        const videoDevices = this.nativeAddon.listVideoDevices()
        return {
          video: videoDevices || [],
          audio: []  // 音频仍由渲染进程枚举（UAC 设备走 WebAudio 管线）
        }
      } catch (err) {
        console.warn('[capture-manager] 原生设备枚举失败，回退渲染进程枚举:', err)
      }
    }
    // 回退：渲染进程自行枚举
    return {
      video: [],
      audio: []
    }
  }

  /**
   * 启动采集
   *
   * 当 captureMode 为 native 或 auto 且原生模块可用时，走原生采集路径
   * （AVCaptureSession + Metal 直渲窗口 NSView，绕过 Chromium 管线）。
   * 原生启动失败时自动回退 WebView 路径（渲染进程 getUserMedia）。
   *
   * 注意：captureMode 字段属于 Task 14 的 CaptureConfig 扩展，
   * 此处通过 as any 读取，类型层暂不强制。
   */
  async start(config: CaptureConfig): Promise<{ success: boolean; error?: string }> {
    if (this.state === 'running' || this.state === 'starting') {
      throw new Error(`无法启动采集：当前状态为 ${this.state}`)
    }

    this.config = config
    this.setState('starting')

    // 读取 captureMode（Task 14 扩展字段，暂用 as any 绕过类型）
    const captureMode = (config as any).captureMode as 'auto' | 'native' | 'webview' | undefined
    const useNative = captureMode === 'native' || captureMode === 'auto'

    // 原生采集路径
    if (useNative && this.loadNativeAddon()) {
      try {
        const ok = this.nativeAddon.create({
          deviceID: config.videoDeviceId,
          width: config.width,
          height: config.height,
          frameRate: config.frameRate,
        })
        if (ok) {
          this.nativeActive = true
          // 自动 attach Metal layer 到主窗口 NSView
          // 渲染进程无法获取 NSView 句柄，由主进程通过 getNativeWindowHandle 自动完成
          this.attachToCurrentWindow()
          this.setState('running')
          return { success: true }
        }
      } catch (err) {
        console.warn('[capture-manager] 原生采集启动失败，回退 WebView:', err)
        this.nativeActive = false
      }
    }

    // 回退路径：仅记录状态，渲染进程走 getUserMedia（现有 WebView 路径不变）
    this.setState('running')
    return { success: true }
  }

  /**
   * 停止采集
   * 原生模式下停止 AVCaptureSession，无论何种模式都将状态置为 idle
   */
  async stop(): Promise<{ success: boolean; error?: string }> {
    // 原生模式：先停止原生采集
    if (this.nativeActive && this.nativeAddon) {
      try {
        this.nativeAddon.stop()
      } catch (e) {
        /* 忽略停止异常 */
      }
      this.nativeActive = false
    }

    if (this.state === 'idle' || this.state === 'stopping') {
      return { success: true }
    }

    this.setState('stopping')

    // 渲染进程负责停止 MediaStream track，主进程清理配置
    this.config = null
    this.stats = null
    this.setState('idle')
    return { success: true }
  }

  /**
   * 将原生 Metal layer attach 到指定 NSView
   * @param nsViewHandle NSView 的原生句柄（Buffer）
   * @returns attach 是否成功
   */
  attachToWindow(nsViewHandle: Buffer): boolean {
    if (!this.nativeAddon) return false
    try {
      return this.nativeAddon.attachToWindow(nsViewHandle)
    } catch (err) {
      console.warn('[capture-manager] attachToWindow 失败:', err)
      return false
    }
  }

  /**
   * 自动 attach 到当前主窗口的 NSView
   * 渲染进程无法获取 NSView 句柄，主进程通过 BrowserWindow.getNativeWindowHandle() 获取
   */
  private attachToCurrentWindow(): boolean {
    if (!this.nativeAddon || !this.mainWindow) return false
    try {
      const handle = this.mainWindow.getNativeWindowHandle()
      return this.nativeAddon.attachToWindow(handle)
    } catch (err) {
      console.warn('[capture-manager] 自动 attach 到窗口失败:', err)
      return false
    }
  }

  /**
   * 更新采集统计信息
   */
  updateStats(stats: CaptureStats): void {
    this.stats = stats
  }

  /**
   * 获取采集统计信息
   */
  getStats(): CaptureStats | null {
    return this.stats
  }

  /**
   * 销毁原生模块资源（应用退出时调用）
   */
  destroy(): void {
    if (this.nativeAddon) {
      try {
        this.nativeAddon.destroy()
      } catch (e) {
        /* 忽略销毁异常 */
      }
      this.nativeAddon = null
      this.nativeActive = false
    }
  }

  /**
   * 设置采集状态并通知渲染进程
   */
  private setState(newState: CaptureState): void {
    this.state = newState
    console.log(`[SwitchCast] 采集状态变更: ${newState}`)
    this.mainWindow?.webContents.send('capture:state', newState)
  }

  /**
   * 推送原生采集统计信息到渲染进程
   * 渲染进程通过 nativeCapture.onStats 监听 capture:nativeStats 事件
   */
  private emitStats(stats: { fps: number; latency: number }): void {
    this.mainWindow?.webContents.send('capture:nativeStats', stats)
  }

  /**
   * 发送错误事件到渲染进程
   */
  private emitError(error: CaptureError): void {
    console.error(`[SwitchCast] 采集错误 [${error.code}]: ${error.message}`)
    this.mainWindow?.webContents.send('capture:error', error)
  }
}

/** 单例实例 */
let captureManagerInstance: CaptureManager | null = null

/**
 * 获取采集管理器单例
 */
export function getCaptureManager(): CaptureManager {
  if (!captureManagerInstance) {
    captureManagerInstance = new CaptureManager()
  }
  return captureManagerInstance
}
