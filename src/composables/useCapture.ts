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
 * 采集模式（captureMode，Task 14 扩展字段）：
 * - native：强制走原生采集（macOS AVCaptureSession + Metal 直渲 NSView）
 * - auto  ：原生可用时走原生，否则回退 WebView（getUserMedia）
 * - webview：强制走 WebView（getUserMedia + Canvas/Video 渲染）
 *
 * 注意：IPC 状态变更和错误回调统一在 App.vue 中注册，
 * 此 composable 不再负责注册 IPC 监听器。
 */
export function useCapture() {
  const captureStore = useCaptureStore()
  const settingsStore = useSettingsStore()

  /** requestAnimationFrame ID */
  let rafId: number | null = null

  /** 帧计数器（回退模式下用 rAF 估算 FPS） */
  let frameCount = 0

  /** 上次 FPS 计算时间戳 */
  let lastFpsTime = 0

  /** 累计丢帧数 */
  let totalDroppedFrames = 0

  /** 原生采集 stats 回调取消订阅函数（停止/卸载时需调用） */
  let nativeStatsUnsub: (() => void) | null = null

  /**
   * 枚举采集设备
   * 调用 captureStore.fetchDevices() 获取设备列表
   */
  async function enumerateDevices() {
    await captureStore.fetchDevices()
  }

  /**
   * 启动原生采集（macOS AVCaptureSession + Metal 直渲窗口 NSView）
   *
   * 视频走原生模块（绕过 Chromium 采集管线以降低延迟），
   * 音频仍走 getUserMedia + Web Audio API（UAC 设备由 WebAudio 管线处理）。
   *
   * @returns 原生采集是否成功启动（失败时调用方回退 WebView）
   */
  async function startNativeCapture(): Promise<boolean> {
    // 原生采集模块不可用时直接回退
    if (!window.nativeCapture) return false
    const available = await window.nativeCapture.isAvailable()
    if (!available) {
      console.warn('[capture] 原生采集不可用，回退 WebView')
      return false
    }

    const { videoDeviceId, audioDeviceId, width, height, frameRate } = settingsStore

    // 音频仍走 getUserMedia（UAC 设备由 Web Audio API 管线处理，路径与 WebView 一致）
    // 先申请音频流，但暂不设置到 store（避免触发 VideoView watch 误走 WebView 分支）
    let audioStream: MediaStream | null = null
    if (audioDeviceId) {
      try {
        audioStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: audioDeviceId },
            // 禁用 WebRTC 音频处理（与 WebView 路径约束一致）
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            sampleRate: { ideal: 48000 },
            channelCount: { ideal: 2 },
            sampleSize: { ideal: 16 },
            // @ts-expect-error latency 为部分浏览器支持的约束
            latency: { ideal: 0 },
          },
          video: false,
        })
      } catch (err) {
        // 音频失败不阻止视频采集
        console.warn('[capture] 原生模式下音频采集失败，仅视频:', err)
      }
    }

    // 视频走原生：通过 IPC 通知主进程启动原生采集
    // 主进程 create 成功后自动 attach Metal layer 到窗口 NSView
    const config: CaptureConfig = {
      videoDeviceId,
      audioDeviceId,
      width,
      height,
      frameRate,
    }
    const result = await window.capture.start({ ...config, captureMode: 'native' } as any)
    if (!result.success) {
      console.warn('[capture] 主进程原生采集启动失败:', result.error)
      // 释放已申请的音频流，避免设备占用
      if (audioStream) audioStream.getTracks().forEach((t) => t.stop())
      return false
    }

    // 先标记原生渲染模式激活，确保 VideoView 的 currentStream watch
    // 回调执行时 nativeActive=true（走原生分支，仅建立音频管线，不启动 canvas/video 渲染器）
    captureStore.setNativeRender(true)

    // 设置音频流（触发 VideoView watch，原生分支下仅 setupAudioPipeline）
    if (audioStream) {
      captureStore.setStream(audioStream)
    }

    // 注册原生 stats 回调 — 原生模块上报真实帧率和延迟
    nativeStatsUnsub = window.nativeCapture.onStats((stats) => {
      captureStore.reportRenderStats(stats.latency, stats.fps)
      captureStore.setLowLatencyRender(true)
    })

    captureStore.updateState('running')
    return true
  }

  /**
   * 启动采集
   *
   * 采集模式分支：
   * 1. native / auto 且原生可用 → 走原生采集路径
   * 2. 原生失败或 webview 模式 → 走现有 getUserMedia 路径（WebView）
   *
   * 1. 从 settings 获取设备 ID、分辨率、帧率
   * 2. 调用 getUserMedia 采集视频和音频
   * 3. 将 MediaStream 设置到 capture store
   * 4. 调用 window.capture.start 通知主进程并检查返回值
   * 5. 开始统计监控
   */
  async function startCapture() {
    const { videoDeviceId, audioDeviceId, width, height, frameRate } = settingsStore

    if (!videoDeviceId) {
      captureStore.setError({ code: 'NO_DEVICE', message: '请先选择视频采集设备' })
      return
    }

    captureStore.updateState('starting')
    captureStore.setError(null)

    // 采集模式（Task 14 扩展字段，暂用 as any 读取，默认 auto）
    const mode = ((settingsStore as any).captureMode as 'auto' | 'native' | 'webview') || 'auto'

    // 原生分支：native 强制原生；auto 时原生可用则尝试
    if (mode === 'native' || (mode === 'auto' && await window.nativeCapture?.isAvailable())) {
      const ok = await startNativeCapture()
      if (ok) {
        // 原生采集成功 — 启动统计监控（分辨率/码率等仍需 rAF 汇总，FPS/延迟来自原生 stats）
        startStatsMonitor()
        return
      }
      console.warn('[capture] 原生采集失败，回退 WebView 路径')
      // 回退前清理原生模式下可能创建的音频流，避免占用设备
      captureStore.clearStream()
      captureStore.setNativeRender(false)
    }

    // ==================== WebView 回退路径（现有 getUserMedia 逻辑不变） ====================
    try {
      // 构建 getUserMedia 约束条件
      // audioDeviceId 为空（不采集音频）时 audio 设为 false，避免 OverconstrainedError
      const constraints: MediaStreamConstraints = {
        video: {
          deviceId: { exact: videoDeviceId },
          // 收紧分辨率/帧率约束区间，引导驱动协商采集卡原生格式（避免 MJPEG 转码路径）
          width: { min: Math.max(0, width - 16), ideal: width, max: width + 16 },
          height: { min: Math.max(0, height - 16), ideal: height, max: height + 16 },
          frameRate: { min: Math.max(1, frameRate - 5), ideal: frameRate, max: frameRate + 5 },
          // @ts-expect-error latency 为部分浏览器支持的约束
          latency: { ideal: 0 },  // 请求最低采集延迟
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
          // @ts-expect-error latency 为部分浏览器支持的约束
          latency: { ideal: 0 },  // 请求最低采集延迟
        } : false,
      }

      // 调用 getUserMedia 采集视频和音频流
      const stream = await navigator.mediaDevices.getUserMedia(constraints)

      // 采集格式诊断 — 输出实际协商结果（帮助确认是否命中 MJPEG 等转码路径）
      const vTrack = stream.getVideoTracks()[0]
      if (vTrack) {
        const s = vTrack.getSettings()
        console.info('[capture] 视频协商结果:', JSON.stringify({
          width: s.width, height: s.height, frameRate: s.frameRate,
          // @ts-expect-error 部分平台暴露
          latency: s.latency,
        }))
      }

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
   * 2. 调用 window.capture.stop 通知主进程（主进程会停止原生采集）
   * 3. 清理原生 stats 回调
   * 4. 清空 store
   */
  async function stopCapture() {
    captureStore.updateState('stopping')

    // 停止统计监控
    stopStatsMonitor()

    // 清理原生 stats 回调
    if (nativeStatsUnsub) {
      nativeStatsUnsub()
      nativeStatsUnsub = null
    }

    // 停止 MediaStream 所有 track 并清空
    captureStore.clearStream()

    // 通知主进程停止采集（主进程会停止原生 AVCaptureSession）
    try {
      await window.capture.stop()
    } catch (err) {
      console.error('[capture] 停止采集失败:', err)
    }

    // 重置原生渲染标记
    captureStore.setNativeRender(false)

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
   * 开始统计监控
   *
   * FPS / 延迟数据来源：
   * - 原生模式：nativeCapture.onStats 上报真实帧率和延迟（Metal layer 渲染管线）
   * - 低延迟模式：VideoView 渲染器每秒上报真实帧龄延迟和渲染帧率
   *   （帧龄 = 绘制时刻 - VideoFrame.timestamp 采集时刻，是真实的端内延迟）
   * - 回退模式（video 元素）：rAF 计数估算 FPS，延迟不可测，置 -1 由 OSD 显示 "—"
   * 此处 rAF 循环负责每秒汇总更新分辨率、丢帧数、码率等其余统计
   */
  function startStatsMonitor() {
    frameCount = 0
    lastFpsTime = performance.now()
    totalDroppedFrames = 0

    function onFrame() {
      const now = performance.now()

      frameCount++

      // 每秒更新一次统计信息
      const elapsed = now - lastFpsTime
      if (elapsed >= 1000) {
        // 低延迟/原生模式下 FPS 来自渲染器或原生 stats 的真实帧计数，回退模式用 rAF 估算
        const rafFps = Math.round((frameCount * 1000) / elapsed)
        const fps = captureStore.isLowLatencyRender ? captureStore.rendererFps : rafFps

        // 从 MediaStreamTrack 获取分辨率信息（原生模式无视频 track，回退到 settings 配置）
        const stream = captureStore.currentStream
        const videoTrack = stream?.getVideoTracks()[0]
        const trackSettings = videoTrack?.getSettings()
        const resolution = trackSettings?.width && trackSettings?.height
          ? `${trackSettings.width}x${trackSettings.height}`
          : captureStore.isNativeRender
            ? `${settingsStore.width}x${settingsStore.height}`
            : captureStore.stats.resolution

        // 估算丢帧：目标帧率 - 实际帧率
        const targetFps = settingsStore.frameRate
        const droppedThisSecond = Math.max(0, targetFps - fps)
        totalDroppedFrames += droppedThisSecond

        // 估算码率（kbps）— 原生模式无 track 时用 settings 分辨率
        const bitrate = estimateBitrate(
          trackSettings?.width ?? (captureStore.isNativeRender ? settingsStore.width : 0),
          trackSettings?.height ?? (captureStore.isNativeRender ? settingsStore.height : 0),
          fps
        )

        // 真实帧龄延迟仅低延迟/原生渲染器可测；回退模式下 video 元素内部无法读取帧龄，置 -1 表示不可测
        const latency = captureStore.isLowLatencyRender ? captureStore.rendererLatency : -1

        const stats: Partial<CaptureStats> = {
          fps,
          resolution,
          latency,
          droppedFrames: totalDroppedFrames,
          bitrate,
        }

        captureStore.updateStats(stats)

        // 重置每秒计数器
        frameCount = 0
        lastFpsTime = now
      }

      rafId = requestAnimationFrame(onFrame)
    }

    rafId = requestAnimationFrame(onFrame)
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
    // 清理原生 stats 回调
    if (nativeStatsUnsub) {
      nativeStatsUnsub()
      nativeStatsUnsub = null
    }
  })

  return {
    enumerateDevices,
    startCapture,
    stopCapture,
  }
}
