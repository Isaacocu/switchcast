<template>
  <div
    ref="containerRef"
    :class="['relative w-full h-full flex items-center justify-center overflow-hidden', nativeActive ? 'bg-transparent' : 'bg-black']"
  >
    <!-- 低延迟渲染画布（MediaStreamTrackProcessor 直渲，最新帧优先） -->
    <!-- 原生模式下隐藏，容器透明露出主进程 attach 的 Metal layer -->
    <canvas
      v-show="!nativeActive && lowLatencyActive"
      ref="canvasEl"
      class="max-w-full max-h-full object-contain"
    />

    <!-- 视频元素（MediaStreamTrackProcessor 不可用时的回退路径） -->
    <!-- 原生模式下隐藏，容器透明露出主进程 attach 的 Metal layer -->
    <video
      v-show="!nativeActive && !lowLatencyActive"
      ref="videoEl"
      class="max-w-full max-h-full object-contain"
      autoplay
      muted
      playsinline
    />

    <!-- 统计叠加层 -->
    <StatsOverlay />

    <!-- 加载中状态 -->
    <div
      v-if="captureStore.state === 'starting'"
      class="absolute inset-0 flex items-center justify-center bg-black/60 z-10 pointer-events-none"
    >
      <div class="flex flex-col items-center gap-3">
        <svg
          class="w-10 h-10 text-white/70 animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <circle cx="12" cy="12" r="10" stroke-opacity="0.25" />
          <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round" />
        </svg>
        <span class="text-white/60 text-sm">正在连接采集卡...</span>
      </div>
    </div>

    <!-- 错误状态 -->
    <div
      v-if="captureStore.error"
      class="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-10"
    >
      <svg class="w-10 h-10 text-red-400 mb-3" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
      </svg>
      <p class="text-red-300 text-sm mb-1 text-center px-4 max-w-xs">
        {{ captureStore.error.message }}
      </p>
      <p class="text-white/30 text-xs">错误代码：{{ captureStore.error.code }}</p>
    </div>

    <!-- 无信号占位提示 -->
    <div
      v-if="captureStore.state === 'idle' && !captureStore.currentStream && !captureStore.error"
      class="absolute inset-0 flex flex-col items-center justify-center z-10 pointer-events-none"
    >
      <svg class="w-16 h-16 text-white/15 mb-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14zM5 15h2v2H5zm0-4h2v2H5zm0-4h2v2H5zm12 8H9V7h8v8zm-2-6h-4v4h4v-4z" />
      </svg>
      <p class="text-white/30 text-sm">请选择采集设备并开始投屏</p>
    </div>

    <!-- 停止中状态 -->
    <div
      v-if="captureStore.state === 'stopping'"
      class="absolute inset-0 flex items-center justify-center bg-black/60 z-10 pointer-events-none"
    >
      <span class="text-white/60 text-sm">正在停止采集...</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useCaptureStore } from '@/stores/capture'
import { useSettingsStore } from '@/stores/settings'
import StatsOverlay from './StatsOverlay.vue'

const captureStore = useCaptureStore()
const settingsStore = useSettingsStore()

/** 视频元素引用（回退路径） */
const videoEl = ref<HTMLVideoElement | null>(null)

/** 低延迟渲染画布引用 */
const canvasEl = ref<HTMLCanvasElement | null>(null)

/** 容器元素引用（用于全屏，同时包含 canvas 和 video，两种模式都能全屏） */
const containerRef = ref<HTMLDivElement | null>(null)

/** 低延迟模式是否激活（控制 canvas / video 显示切换） */
const lowLatencyActive = ref(false)

/**
 * 原生采集渲染模式是否激活
 * 原生模式下视频由主进程 Metal layer 直渲窗口 NSView，
 * canvas/video 元素均隐藏，容器背景透明以露出 Metal 层。
 * 状态来源于 capture store（由 useCapture 在原生采集启停时设置）。
 */
const nativeActive = computed(() => captureStore.isNativeRender)

// Web Audio API 管线
let audioContext: AudioContext | null = null
let mediaStreamSource: MediaStreamAudioSourceNode | null = null
let delayNode: DelayNode | null = null
let gainNode: GainNode | null = null

// ==================== 低延迟渲染器 ====================
// MediaStreamTrackProcessor 直接读帧，三级绘制链：
// WebGL2（texImage2D 直传 GPU 纹理）→ canvas 2D（drawImage）→ video 元素
// canvas 2D 的 drawImage(VideoFrame) 在 macOS 上可能走 CPU 光栅化路径，
// WebGL texImage2D 可将 VideoFrame 直接上传 GPU 纹理（快 3-5ms）

let frameReader: ReadableStreamDefaultReader<VideoFrame> | null = null
let renderCtx: CanvasRenderingContext2D | null = null
let isLowLatencyMode = false

// WebGL2 渲染器状态
let glCtx: WebGL2RenderingContext | null = null
let glTexture: WebGLTexture | null = null
let usingWebGL = false

/** 最新待绘制帧（读取循环持续替换，绘制循环取用） */
let latestFrame: VideoFrame | null = null

/** 帧龄移动平均值（ms），指数移动平均避免抖动 */
let latencyEma = 0

/** drawLoop 帧计数（用于 FPS 统计，按实际绘制帧计数） */
let renderFrameCount = 0

/** 上次统计上报时间戳 */
let lastReportTime = 0

/** 弱机自适应：rendererFps 连续低于目标帧率 70% 的秒数 */
let lowFpsSeconds = 0

/**
 * 初始化 WebGL2 渲染器（全屏三角形 + 纹理采样）
 * 同一 canvas 元素首次 getContext 决定类型：先试 WebGL2，失败后再试 2D 天然兼容
 */
function initWebGLRenderer(canvas: HTMLCanvasElement): boolean {
  const gl = canvas.getContext('webgl2', {
    desynchronized: true,   // 绕过合成器 vsync
    alpha: false,
    antialias: false,       // 视频渲染无需抗锯齿
    depth: false,
    stencil: false,
    powerPreference: 'high-performance',
  })
  if (!gl) return false

  const vsSource = `#version 300 es
    // 全屏三角形（无需顶点缓冲，gl_VertexID 生成）
    out vec2 vUV;
    void main() {
      vec2 pos = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
      vUV = vec2(pos.x, 1.0 - pos.y);
      gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
    }`
  const fsSource = `#version 300 es
    precision mediump float;
    uniform sampler2D uTex;
    in vec2 vUV;
    out vec4 outColor;
    void main() { outColor = texture(uTex, vUV); }`

  const compile = (type: number, src: string) => {
    const sh = gl.createShader(type)!
    gl.shaderSource(sh, src)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn('[VideoView] shader 编译失败:', gl.getShaderInfoLog(sh))
      return null
    }
    return sh
  }
  const vs = compile(gl.VERTEX_SHADER, vsSource)
  const fs = compile(gl.FRAGMENT_SHADER, fsSource)
  if (!vs || !fs) return false

  const program = gl.createProgram()!
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false
  gl.useProgram(program)

  glTexture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, glTexture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

  glCtx = gl
  return true
}

/** WebGL 绘制一帧（VideoFrame 直接上传 GPU 纹理） */
function drawFrameWebGL(frame: VideoFrame) {
  const gl = glCtx!
  // viewport 每帧设置，分辨率变化时天然适配
  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height)
  gl.bindTexture(gl.TEXTURE_2D, glTexture)
  // texImage2D 直接接受 VideoFrame，GPU 路径上传
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
}

async function startLowLatencyRenderer(stream: MediaStream): Promise<boolean> {
  const videoTrack = stream.getVideoTracks()[0]
  if (!videoTrack) return false

  // 特性检测：MediaStreamTrackProcessor 需要 Chromium 94+（Electron 31 支持）
  if (typeof MediaStreamTrackProcessor === 'undefined') {
    console.warn('[VideoView] MediaStreamTrackProcessor 不可用，回退到 video 元素')
    return false
  }

  const canvas = canvasEl.value
  if (!canvas) return false

  // 设置画面提示为运动优先（减少 Chromium 内部平滑处理）
  videoTrack.contentHint = 'motion'

  const settings = videoTrack.getSettings()
  canvas.width = settings.width || 1920
  canvas.height = settings.height || 1080

  // 优先 WebGL2（texImage2D 直传 GPU 纹理，绕过 canvas 2D 可能的 CPU 光栅化）
  // 注意：同一 canvas 首次 getContext 决定类型，先试 WebGL2 失败再试 2D 天然兼容
  usingWebGL = initWebGLRenderer(canvas)
  if (usingWebGL) {
    console.info('[VideoView] 使用 WebGL2 渲染路径')
  } else {
    // 第二级回退：canvas 2D（desynchronized: true 绕过合成器 vsync 同步）
    renderCtx = canvas.getContext('2d', { desynchronized: true, alpha: false })
    if (!renderCtx) return false
    console.info('[VideoView] WebGL2 不可用，使用 canvas 2D 渲染路径')
  }

  try {
    const processor = new MediaStreamTrackProcessor({ track: videoTrack })
    frameReader = processor.readable.getReader()
  } catch (err) {
    console.warn('[VideoView] MediaStreamTrackProcessor 创建失败，回退到 video 元素:', err)
    teardownGLResources()
    renderCtx = null
    return false
  }

  isLowLatencyMode = true
  latencyEma = 0
  renderFrameCount = 0
  lowFpsSeconds = 0
  lastReportTime = performance.now()

  // 读取与绘制分离：读取循环持续吞帧（只保留最新帧），绘制循环按 rAF 节奏消费
  pumpFrames()
  drawLoop()
  return true
}

// 读取循环：持续读帧，旧帧未绘制就被新帧替换（丢弃积压帧）
async function pumpFrames() {
  while (frameReader && isLowLatencyMode) {
    let frame: VideoFrame | undefined
    try {
      const result = await frameReader.read()
      if (result.done || !result.value) break
      frame = result.value

      // 渲染器已停止：不再写入 latestFrame（由 finally 释放本帧），避免停止后残留泄漏
      if (!isLowLatencyMode) break

      // 最新帧优先：丢弃上一个未绘制的帧，避免绘制慢于帧到达时延迟累积
      if (latestFrame) {
        latestFrame.close()
      }
      latestFrame = frame
      frame = undefined  // 所有权移交 latestFrame，防止 finally 误关
    } catch (err) {
      console.warn('[VideoView] 帧读取中断:', err)
      break
    } finally {
      // 异常路径下确保帧被释放，否则帧池耗尽导致采集停止
      frame?.close()
    }
  }
}

// 绘制循环：始终绘制 latestFrame，绘制后立即释放
function drawLoop() {
  if (!isLowLatencyMode) return
  const frame = latestFrame
  if (frame && (usingWebGL ? glCtx : renderCtx)) {
    latestFrame = null
    try {
      if (usingWebGL) {
        // WebGL2 路径：VideoFrame 直接上传 GPU 纹理
        drawFrameWebGL(frame)
      } else {
        renderCtx!.drawImage(frame, 0, 0, renderCtx!.canvas.width, renderCtx!.canvas.height)
      }
      // 更新延迟统计（帧时间戳 → 当前时刻）
      updateFrameLatency(frame)
    } finally {
      // 绘制异常时也必须释放 VideoFrame
      frame.close()
    }
  }

  // 每秒向 store 上报一次真实帧龄延迟和渲染帧率（按实际绘制帧计数）
  const now = performance.now()
  const elapsed = now - lastReportTime
  if (elapsed >= 1000) {
    const fps = Math.round((renderFrameCount * 1000) / elapsed)
    captureStore.reportRenderStats(Math.round(latencyEma), fps)
    renderFrameCount = 0
    lastReportTime = now

    // 弱机自适应回退检测（可能停止渲染器，停止后不再调度 rAF）
    checkAdaptiveFallback(fps)
    if (!isLowLatencyMode) return
  }

  // 用 rAF 驱动绘制节奏（disable-frame-rate-limit 下 rAF 不受 60fps 上限约束）
  requestAnimationFrame(drawLoop)
}

/**
 * 弱机自适应回退 — canvas 光栅化在弱机上可能导致帧率反降
 * 连续 5 秒 rendererFps 低于目标帧率的 70% 时，自动回退 video 元素
 */
function checkAdaptiveFallback(currentFps: number) {
  const targetFps = settingsStore.frameRate || 60
  if (currentFps < targetFps * 0.7) {
    lowFpsSeconds++
    if (lowFpsSeconds >= 5) {
      console.warn('[VideoView] 低延迟渲染帧率不达标，自动回退 video 元素')
      fallbackToVideoElement()
    }
  } else {
    lowFpsSeconds = 0
  }
}

/** 回退到 video 元素播放当前流（stopLowLatencyRenderer 内部会同步 lowLatencyActive，v-show 随之切换） */
function fallbackToVideoElement() {
  stopLowLatencyRenderer()
  const video = videoEl.value
  const stream = captureStore.currentStream
  if (video && stream) {
    video.srcObject = stream
    video.play().catch((err) => console.warn('[VideoView] 回退播放失败:', err))
  }
}

/**
 * 真实延迟测量 — 计算帧龄（采集时刻 → 绘制时刻）
 * VideoFrame.timestamp 是采集时刻的微秒时间戳（基于 performance.timeOrigin）
 */
function updateFrameLatency(frame: VideoFrame) {
  if (frame.timestamp) {
    // frame.timestamp 单位为微秒，帧龄不可能为负，钳为 0
    const frameAgeMs = Math.max(0, performance.now() - frame.timestamp / 1000)
    // 指数移动平均（α = 0.1）平滑延迟数值，避免抖动
    latencyEma = latencyEma === 0 ? frameAgeMs : latencyEma * 0.9 + frameAgeMs * 0.1
  }

  renderFrameCount++
}

/** 释放 WebGL 资源（WebGL context 无需显式销毁，随 canvas 生命周期回收） */
function teardownGLResources() {
  if (glCtx && glTexture) {
    glCtx.deleteTexture(glTexture)
  }
  glTexture = null
  glCtx = null
  usingWebGL = false
}

function stopLowLatencyRenderer() {
  isLowLatencyMode = false
  if (frameReader) {
    frameReader.cancel().catch(() => {})
    frameReader = null
  }
  // 释放残留的未绘制帧，避免 VideoFrame 泄漏
  if (latestFrame) {
    latestFrame.close()
    latestFrame = null
  }
  // 清理 WebGL 资源
  teardownGLResources()
  renderCtx = null
  lowLatencyActive.value = false
  captureStore.setLowLatencyRender(false)
}

// ==================== Web Audio 管线 ====================

// 建立 Web Audio 管线：MediaStream → Source → Delay → Gain → Destination
function setupAudioPipeline(stream: MediaStream) {
  const audioTracks = stream.getAudioTracks()
  if (audioTracks.length === 0) return

  // 创建 AudioContext，指定 48000Hz 与 UAC 设备匹配
  // latencyHint 传数字 0 请求尽可能小的输出缓冲（比 'interactive' 更激进）
  audioContext = new AudioContext({ sampleRate: 48000, latencyHint: 0 })

  // 从 MediaStream 创建音频源
  mediaStreamSource = audioContext.createMediaStreamSource(stream)

  // 创建 DelayNode 用于音画同步偏移（syncOffset 单位 ms，转换为秒）
  delayNode = audioContext.createDelay(1.0)  // 最大延迟 1 秒
  delayNode.delayTime.value = Math.max(0, settingsStore.syncOffset / 1000)  // ms → s，负值钳为 0

  // 创建 GainNode 用于音量控制
  gainNode = audioContext.createGain()
  gainNode.gain.value = settingsStore.volume

  // 连接管线：Source → Delay → Gain → Destination
  mediaStreamSource.connect(delayNode)
  delayNode.connect(gainNode)
  gainNode.connect(audioContext.destination)

  // <video> 元素静音，音频仅通过 Web Audio API 输出
  // 避免音频被 video 元素和 Web Audio API 同时播放
  if (videoEl.value) {
    videoEl.value.muted = true
  }

  // AudioContext 可能因 autoplay policy 被挂起，尝试恢复
  if (audioContext.state === 'suspended') {
    audioContext.resume().catch((err) => {
      console.warn('[VideoView] AudioContext 恢复失败:', err)
    })
  }
}

// 清理 Web Audio 管线
function teardownAudioPipeline() {
  if (mediaStreamSource) {
    mediaStreamSource.disconnect()
    mediaStreamSource = null
  }
  if (delayNode) {
    delayNode.disconnect()
    delayNode = null
  }
  if (gainNode) {
    gainNode.disconnect()
    gainNode = null
  }
  if (audioContext) {
    audioContext.close()
    audioContext = null
  }
}

// 监听 currentStream 变化 — 优先低延迟 canvas 直渲，失败回退 video 元素
// 原生模式下仅处理音频管线（视频由主进程 Metal layer 直渲，不经 canvas/video）
watch(
  () => captureStore.currentStream,
  async (stream) => {
    const video = videoEl.value

    // 切流前先停掉旧的低延迟渲染器
    stopLowLatencyRenderer()

    if (stream) {
      // 原生采集模式：视频由 Metal layer 直渲窗口 NSView，不启动 canvas/video 渲染器
      // 仅建立音频管线（音频路径与 WebView 一致），不覆盖 isLowLatencyRender/isNativeRender
      if (nativeActive.value) {
        lowLatencyActive.value = false
        setupAudioPipeline(stream)
        return
      }

      // 优先尝试低延迟渲染路径（MediaStreamTrackProcessor + WebGL2/Canvas）
      const ok = await startLowLatencyRenderer(stream)
      lowLatencyActive.value = ok
      captureStore.setLowLatencyRender(ok)

      if (!ok && video) {
        // 回退路径：video 元素直接播放 MediaStream
        video.srcObject = stream
        video.play().catch((err) => {
          console.warn('[VideoView] 自动播放被阻止:', err)
        })
      }

      // 建立 Web Audio 管线，音频由 Web Audio API 接管（路径不变）
      setupAudioPipeline(stream)
    } else {
      if (video) {
        video.srcObject = null
      }
      // 清理 Web Audio 管线
      teardownAudioPipeline()
    }
  }
)

// 监听音画同步偏移设置变化 — 通过 DelayNode 控制音频延迟
watch(
  () => settingsStore.syncOffset,
  (offset) => {
    if (delayNode && audioContext) {
      // 使用 setTargetAtTime 平滑过渡，避免延迟变化时的音频爆音
      // DelayNode delayTime 不能为负，负值钳为 0
      delayNode.delayTime.setTargetAtTime(Math.max(0, offset / 1000), audioContext.currentTime, 0.01)
    }
  }
)

// 监听音量设置变化 — 通过 GainNode 控制音量
watch(
  () => settingsStore.volume,
  (volume) => {
    if (gainNode) {
      // 使用 setTargetAtTime 实现平滑过渡，避免阶跃变化
      gainNode.gain.setTargetAtTime(volume, audioContext!.currentTime, 0.01)
    }
    // 同时保持 video.volume 同步（虽然 video 被 muted，但保持一致性）
    if (videoEl.value) {
      videoEl.value.volume = volume
      videoEl.value.muted = volume === 0
    }
  }
)

// 监听全屏状态 — 调用容器全屏 API（容器同时包含 canvas 和 video）
watch(
  () => captureStore.isFullscreen,
  async (isFullscreen) => {
    const el = containerRef.value
    if (!el) return

    try {
      if (isFullscreen && !document.fullscreenElement) {
        await el.requestFullscreen()
      } else if (!isFullscreen && document.fullscreenElement) {
        await document.exitFullscreen()
      }
    } catch (err) {
      console.warn('[VideoView] 全屏切换失败:', err)
      // 同步 store 状态
      captureStore.isFullscreen = !!document.fullscreenElement
    }
  }
)

// 监听系统全屏变化（如用户按 ESC 退出全屏）
function onFullscreenChange() {
  const isFs = !!document.fullscreenElement
  if (captureStore.isFullscreen !== isFs) {
    captureStore.isFullscreen = isFs
  }
}

onMounted(async () => {
  document.addEventListener('fullscreenchange', onFullscreenChange)

  // 音频由 Web Audio API 接管，video 元素始终静音
  // 保留 video.volume 设置以保持一致性
  const video = videoEl.value
  if (video) {
    video.volume = settingsStore.volume
    video.muted = true
  }

  // 原生采集可用性检测 — 渲染进程无法获取 NSView 句柄，
  // Metal layer 的 attach 由主进程在 capture-manager.start 时通过
  // getNativeWindowHandle 自动完成，渲染进程无需主动触发
  if (window.nativeCapture) {
    try {
      const available = await window.nativeCapture.isAvailable()
      if (available) {
        console.info('[VideoView] 原生采集模块可用，视频将走 Metal 直渲路径')
      }
    } catch (err) {
      console.warn('[VideoView] 原生采集可用性查询失败:', err)
    }
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  // 停止低延迟渲染器
  stopLowLatencyRenderer()
  // 清理 Web Audio 管线
  teardownAudioPipeline()
})
</script>
