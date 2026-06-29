import { defineStore } from 'pinia'
import type { AppSettings } from '@/types/capture'

/** localStorage 存储键 */
const STORAGE_KEY = 'switchcast:settings'

/** 默认设置 */
const defaultSettings: AppSettings = {
  videoDeviceId: '',
  audioDeviceId: '',
  width: 1920,
  height: 1080,
  frameRate: 60,
  volume: 1.0,
  syncOffset: 0,
  recordingPath: '',
  recordingFormat: 'mp4',
  recordingVideoCodec: 'h264',
  recordingVideoBitrate: 8000,
  recordingAudioBitrate: 128,
}

export const useSettingsStore = defineStore('settings', {
  state: (): AppSettings => ({
    ...defaultSettings,
  }),

  getters: {
    /** 分辨率标签，如 1920x1080@60fps */
    resolutionLabel(state): string {
      return `${state.width}x${state.height}@${state.frameRate}fps`
    },
  },

  actions: {
    /** 部分更新设置 */
    updateSettings(partial: Partial<AppSettings>) {
      Object.assign(this, partial)
    },

    /** 重置为默认值 */
    reset() {
      Object.assign(this, defaultSettings)
    },

    /** 从 localStorage 加载设置 */
    loadFromStorage() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<AppSettings>
          this.updateSettings(parsed)
        }
      } catch (err) {
        console.error('[settings] 加载设置失败:', err)
      }
    },

    /** 保存设置到 localStorage */
    saveToStorage() {
      try {
        const data: AppSettings = {
          videoDeviceId: this.videoDeviceId,
          audioDeviceId: this.audioDeviceId,
          width: this.width,
          height: this.height,
          frameRate: this.frameRate,
          volume: this.volume,
          syncOffset: this.syncOffset,
          recordingPath: this.recordingPath,
          recordingFormat: this.recordingFormat,
          recordingVideoCodec: this.recordingVideoCodec,
          recordingVideoBitrate: this.recordingVideoBitrate,
          recordingAudioBitrate: this.recordingAudioBitrate,
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
      } catch (err) {
        console.error('[settings] 保存设置失败:', err)
      }
    },
  },
})
