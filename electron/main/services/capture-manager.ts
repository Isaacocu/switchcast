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
   * 枚举可用设备
   *
   * 注意：getUserMedia 在渲染进程中执行，主进程无法直接枚举设备。
   * 此方法返回默认设备信息，实际设备列表由渲染进程通过
   * navigator.mediaDevices.enumerateDevices() 获取。
   */
  async listDevices(): Promise<DeviceList> {
    // Phase 2 MVP：返回空列表，渲染进程自行枚举
    // 后续 Phase 可通过系统原生 API 预枚举设备
    return {
      video: [],
      audio: []
    }
  }

  /**
   * 启动采集
   * 记录配置并将状态变更为 starting → running
   */
  async start(config: CaptureConfig): Promise<void> {
    if (this.state === 'running' || this.state === 'starting') {
      throw new Error(`无法启动采集：当前状态为 ${this.state}`)
    }

    this.config = config
    this.setState('starting')

    try {
      // Phase 2 MVP：状态由渲染进程通过 getUserMedia 实际启动后回调更新
      // 主进程记录配置后直接标记为 running
      this.setState('running')
    } catch (err) {
      this.emitError({
        code: 'START_FAILED',
        message: `采集启动失败: ${err instanceof Error ? err.message : String(err)}`
      })
      this.setState('error')
      throw err
    }
  }

  /**
   * 停止采集
   * 将状态变更为 stopping → idle
   */
  async stop(): Promise<void> {
    if (this.state === 'idle' || this.state === 'stopping') {
      return
    }

    this.setState('stopping')

    try {
      // Phase 2 MVP：渲染进程负责停止 MediaStream track
      this.config = null
      this.stats = null
      this.setState('idle')
    } catch (err) {
      this.emitError({
        code: 'STOP_FAILED',
        message: `采集停止失败: ${err instanceof Error ? err.message : String(err)}`
      })
      this.setState('error')
      throw err
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
   * 设置采集状态并通知渲染进程
   */
  private setState(newState: CaptureState): void {
    this.state = newState
    console.log(`[SwitchCast] 采集状态变更: ${newState}`)
    this.mainWindow?.webContents.send('capture:state', newState)
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
