/** 视频采集设备 */
export interface VideoDevice {
  deviceId: string
  label: string
}

/** 音频采集设备 */
export interface AudioDevice {
  deviceId: string
  label: string
}

/** 设备列表 */
export interface DeviceList {
  video: VideoDevice[]
  audio: AudioDevice[]
}

/** 采集配置 */
export interface CaptureConfig {
  videoDeviceId: string
  audioDeviceId: string
  width: number
  height: number
  frameRate: number
}

/** 采集统计信息 */
export interface CaptureStats {
  fps: number
  resolution: string
  latency: number
  droppedFrames: number
  bitrate: number
}

/** 采集状态 */
export type CaptureState = 'idle' | 'starting' | 'running' | 'stopping' | 'error'

/** 采集错误 */
export interface CaptureError {
  code: string
  message: string
}

/** 录制配置 */
export interface RecordingConfig {
  filePath: string
  format: 'mp4' | 'webm'
  videoCodec: 'h264' | 'h265' | 'vp8' | 'vp9'
  audioCodec: 'aac' | 'opus'
  videoBitrate: number  // kbps
  audioBitrate: number  // kbps
}

/** 直播推流配置 */
export interface StreamConfig {
  url: string
  streamKey: string
  videoBitrate: number
  audioBitrate: number
  keyframeInterval: number
}

/** 应用设置 */
export interface AppSettings {
  videoDeviceId: string
  audioDeviceId: string
  width: number
  height: number
  frameRate: number
  volume: number
  syncOffset: number  // ms
  recordingPath: string
  recordingFormat: 'mp4' | 'webm'
  recordingVideoCodec: 'h264' | 'h265'
  recordingVideoBitrate: number
  recordingAudioBitrate: number
}
