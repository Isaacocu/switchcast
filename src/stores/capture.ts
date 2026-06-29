import { defineStore } from 'pinia'
import type {
  CaptureState,
  DeviceList,
  CaptureStats,
  CaptureError,
} from '@/types/capture'

interface CaptureStoreState {
  /** 采集状态 */
  state: CaptureState
  /** 可用设备列表 */
  devices: DeviceList
  /** 当前 MediaStream */
  currentStream: MediaStream | null
  /** 采集统计信息 */
  stats: CaptureStats
  /** 采集错误 */
  error: CaptureError | null
  /** 是否全屏 */
  isFullscreen: boolean
  /** 是否显示统计叠加层 */
  showStats: boolean
}

export const useCaptureStore = defineStore('capture', {
  state: (): CaptureStoreState => ({
    state: 'idle',
    devices: { video: [], audio: [] },
    currentStream: null,
    stats: {
      fps: 0,
      resolution: '',
      latency: 0,
      droppedFrames: 0,
      bitrate: 0,
    },
    error: null,
    isFullscreen: false,
    showStats: false,
  }),

  getters: {
    /** 是否正在采集 */
    isCapturing(state): boolean {
      return state.state === 'running'
    },

    /** 是否有可用设备 */
    hasDevices(state): boolean {
      return state.devices.video.length > 0 || state.devices.audio.length > 0
    },
  },

  actions: {
    /**
     * 枚举采集设备
     * 分开请求视频和音频权限（拒绝任一不影响另一类），
     * 再使用渲染进程原生 API enumerateDevices() 获取完整设备列表
     */
    async fetchDevices() {
      try {
        // 先请求视频权限（否则 label 为空）
        try {
          const videoStream = await navigator.mediaDevices.getUserMedia({ video: true })
          videoStream.getTracks().forEach((t) => t.stop())
        } catch {
          /* 忽略视频权限拒绝 */
        }

        // 再尝试请求音频权限
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true })
          audioStream.getTracks().forEach((t) => t.stop())
        } catch {
          /* 忽略音频权限拒绝 */
        }

        // 使用渲染进程原生 API 枚举设备
        const allDevices = await navigator.mediaDevices.enumerateDevices()
        this.devices = {
          video: allDevices
            .filter((d) => d.kind === 'videoinput')
            .map((d) => ({ deviceId: d.deviceId, label: d.label || '未命名视频设备' })),
          audio: allDevices
            .filter((d) => d.kind === 'audioinput')
            .map((d) => ({ deviceId: d.deviceId, label: d.label || '未命名音频设备' })),
        }
      } catch (err) {
        console.error('[capture] 设备枚举失败:', err)
      }
    },

    /** 更新采集状态 */
    updateState(state: CaptureState) {
      this.state = state
    },

    /** 设置错误信息 */
    setError(error: CaptureError | null) {
      this.error = error
    },

    /** 设置当前 MediaStream */
    setStream(stream: MediaStream | null) {
      this.currentStream = stream
    },

    /** 停止所有 track，清空当前 stream */
    clearStream() {
      if (this.currentStream) {
        this.currentStream.getTracks().forEach((track) => track.stop())
        this.currentStream = null
      }
    },

    /** 更新统计信息（支持部分更新） */
    updateStats(stats: Partial<CaptureStats>) {
      this.stats = { ...this.stats, ...stats }
    },

    /** 切换全屏状态 */
    toggleFullscreen() {
      this.isFullscreen = !this.isFullscreen
    },

    /** 切换统计叠加层显示 */
    toggleStats() {
      this.showStats = !this.showStats
    },
  },
})
