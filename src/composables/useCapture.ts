import { onBeforeUnmount, watch } from 'vue'
import { useCaptureStore } from '@/stores/capture'
import { useSettingsStore } from '@/stores/settings'
import type { CaptureConfig, CaptureStats } from '@/types/capture'

/**
 * 采集逻辑 composable
 *
 * 封装 getUserMedia 采集、设备枚举、统计监控等核心逻辑。
 * 在渲染进程中调用 getUserMedia 采集 UVC 采集卡视频和 UAC 音频。
 *
 * 注意：IPC 状态变更和错误回调统一在 App.vue 中注册，
 * 此 composable 不再负责注册 IPC 监听器。
 */
export function useCapture() {
  const captureStore = useCaptureStore()
  const settingsStore = useSettingsStore()

  /** requestAnimationFrame ID */
  let rafId: number | null = null

  /** 帧计数器（用于计算 FPS） */
  let frameCount = 0

  /** 上次 FPS 计算时间戳 */
  let lastFpsTime = 0

  /** rAF 请求时间戳（用于延迟测量） */
  let rafRequestTime = 0

  /** 延迟累计值 */
  let latencySum = 0

  /** 延迟采样次数 */
  let latencyCount = 0

  /** 累计丢帧数 */
  let totalDroppedFrames = 0

  /**
   * 枚举采集设备
   * 调用 captureStore.fetchDevices() 获取设备列表
   */
  async function enumerateDevices() {
    await captureStore.fetchDevices()
  }

  /**
   * 启动采集
   *
   * 1. 从 settings 获取设备 ID、分辨率、帧率
   * 2. 调用 getUserMedia 采集视频和音频
   * 3. 将 MediaStream 设置到 capture store
   * 4. 调用 window.capture.start 通知主进程并检查返回值
   * 5. 开始统计监控（requestAnimationFrame 测量 FPS）
   */
  async function startCapture() {
    const { videoDeviceId, audioDeviceId, width, height, frameRate } = settingsStore

    if (!videoDeviceId) {
      captureStore.setError({ code: 'NO_DEVICE', message: '请先选择视频采集设备' })
      return
    }

    captureStore.updateState('starting')
    captureStore.setError(null)

    try {
      // 构建 getUserMedia 约束条件
      // audioDeviceId 为空（不采集音频）时 audio 设为 false，避免 OverconstrainedError
      const constraints: MediaStreamConstraints = {
        video: {
          deviceId: { exact: videoDeviceId },
          width: { ideal: width },
          height: { ideal: height },
          frameRate: { ideal: frameRate },
        },
        audio: audioDeviceId ? {
          deviceId: { exact: audioDeviceId },
          // 禁用 Chromium 默认开启的 WebRTC 音频处理 — 这些模块为 VoIP 通话设计，
          // 会误判游戏音频为回声/噪声导致消音，AGC 动态增益导致音量波动
          echoCancellation: false,   // 禁用回声消除
          noiseSuppression: false,   // 禁用噪声抑制
          autoGainControl: false,    // 禁用自动增益控制
          // 音频参数优化 — 与 UAC 采集卡输出匹配
          sampleRate: { ideal: 48000 },
          channelCount: { ideal: 2 },
          sampleSize: { ideal: 16 },
        } : false,
      }

      // 调用 getUserMedia 采集视频和音频流
      const stream = await navigator.mediaDevices.getUserMedia(constraints)

      // 将流设置到 store
      captureStore.setStream(stream)

      // 通知主进程采集已启动
      const config: CaptureConfig = {
        videoDeviceId,
        audioDeviceId,
        width,
        height,
        frameRate,
      }
      const result = await window.capture.start(config)
      if (!result.success) {
        // 主进程拒绝启动 — 清理 MediaStream 并设置错误状态
        captureStore.clearStream()
        captureStore.setError({
          code: 'START_FAILED',
          message: result.error || '主进程拒绝启动采集',
        })
        captureStore.updateState('error')
        return
      }

      // 更新状态为运行中
      captureStore.updateState('running')

      // 开始统计监控
      startStatsMonitor()
    } catch (err) {
      console.error('[capture] 启动采集失败:', err)
      captureStore.setError({
        code: 'START_FAILED',
        message: err instanceof Error ? err.message : '采集启动失败',
      })
      captureStore.updateState('error')
    }
  }

  /**
   * 停止采集
   *
   * 1. 停止 MediaStream 所有 track
   * 2. 调用 window.capture.stop 通知主进程
   * 3. 清空 store
   */
  async function stopCapture() {
    captureStore.updateState('stopping')

    // 停止统计监控
    stopStatsMonitor()

    // 停止 MediaStream 所有 track 并清空
    captureStore.clearStream()

    // 通知主进程停止采集
    try {
      await window.capture.stop()
    } catch (err) {
      console.error('[capture] 停止采集失败:', err)
    }

    // 重置统计信息
    captureStore.updateStats({
      fps: 0,
      resolution: '',
      latency: 0,
      droppedFrames: 0,
      bitrate: 0,
    })

    captureStore.updateState('idle')
  }

  /**
   * 延迟测量 — 记录请求帧时间戳 vs 收到帧时间戳
   * 返回最近一段时间的平均延迟（ms）
   */
  function measureLatency(): number {
    if (latencyCount === 0) return 0
    return Math.round(latencySum / latencyCount)
  }

  /**
   * 开始统计监控
   * 使用 requestAnimationFrame 循环更新 FPS、延迟、分辨率、丢帧数、码率
   */
  function startStatsMonitor() {
    frameCount = 0
    lastFpsTime = performance.now()
    latencySum = 0
    latencyCount = 0
    totalDroppedFrames = 0

    function requestNextFrame() {
      // 记录请求 rAF 的时间戳
      rafRequestTime = performance.now()
      rafId = requestAnimationFrame(onFrame)
    }

    function onFrame() {
      const now = performance.now()

      // 计算延迟：从请求 rAF 到回调触发的耗时
      const latency = now - rafRequestTime
      latencySum += latency
      latencyCount++

      frameCount++

      // 每秒更新一次统计信息
      const elapsed = now - lastFpsTime
      if (elapsed >= 1000) {
        const fps = Math.round((frameCount * 1000) / elapsed)

        // 从 MediaStreamTrack 获取分辨率信息
        const stream = captureStore.currentStream
        const videoTrack = stream?.getVideoTracks()[0]
        const trackSettings = videoTrack?.getSettings()
        const resolution = trackSettings?.width && trackSettings?.height
          ? `${trackSettings.width}x${trackSettings.height}`
          : captureStore.stats.resolution

        // 估算丢帧：目标帧率 - 实际帧率
        const targetFps = settingsStore.frameRate
        const droppedThisSecond = Math.max(0, targetFps - fps)
        totalDroppedFrames += droppedThisSecond

        // 估算码率（kbps）
        const bitrate = estimateBitrate(
          trackSettings?.width ?? 0,
          trackSettings?.height ?? 0,
          fps
        )

        const stats: Partial<CaptureStats> = {
          fps,
          resolution,
          latency: measureLatency(),
          droppedFrames: totalDroppedFrames,
          bitrate,
        }

        captureStore.updateStats(stats)

        // 重置每秒计数器
        frameCount = 0
        lastFpsTime = now
        latencySum = 0
        latencyCount = 0
      }

      requestNextFrame()
    }

    requestNextFrame()
  }

  /** 停止统计监控 */
  function stopStatsMonitor() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  }

  /**
   * 估算码率（kbps）
   * 基于分辨率和帧率进行粗略估算：每像素约 0.12 bit
   */
  function estimateBitrate(width: number, height: number, fps: number): number {
    if (width === 0 || height === 0 || fps === 0) return 0
    const pixels = width * height
    return Math.round((pixels * fps * 0.12) / 1000)
  }

  // 监听采集状态变化 — 当状态变为 error 或 idle 时自动停止统计监控
  watch(
    () => captureStore.state,
    (newState) => {
      if (newState === 'error' || newState === 'idle') {
        stopStatsMonitor()
      }
    }
  )

  // 组件卸载时清理资源
  onBeforeUnmount(() => {
    stopStatsMonitor()
  })

  return {
    enumerateDevices,
    startCapture,
    stopCapture,
  }
}
