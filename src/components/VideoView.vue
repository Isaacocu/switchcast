<template>
  <div
    ref="containerRef"
    class="relative w-full h-full bg-black flex items-center justify-center overflow-hidden"
  >
    <!-- 视频元素 -->
    <video
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
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useCaptureStore } from '@/stores/capture'
import { useSettingsStore } from '@/stores/settings'
import StatsOverlay from './StatsOverlay.vue'

const captureStore = useCaptureStore()
const settingsStore = useSettingsStore()

/** 视频元素引用 */
const videoEl = ref<HTMLVideoElement | null>(null)

/** 容器元素引用（用于全屏） */
const containerRef = ref<HTMLDivElement | null>(null)

// Web Audio API 管线
let audioContext: AudioContext | null = null
let mediaStreamSource: MediaStreamAudioSourceNode | null = null
let delayNode: DelayNode | null = null
let gainNode: GainNode | null = null

// 建立 Web Audio 管线：MediaStream → Source → Delay → Gain → Destination
function setupAudioPipeline(stream: MediaStream) {
  const audioTracks = stream.getAudioTracks()
  if (audioTracks.length === 0) return

  // 创建 AudioContext，指定 48000Hz 与 UAC 设备匹配，interactive 模式优化延迟
  audioContext = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' })

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

// 监听 currentStream 变化 — 设置 video.srcObject
watch(
  () => captureStore.currentStream,
  (stream) => {
    const video = videoEl.value
    if (!video) return

    if (stream) {
      video.srcObject = stream
      video.play().catch((err) => {
        console.warn('[VideoView] 自动播放被阻止:', err)
      })
      // 建立 Web Audio 管线，音频由 Web Audio API 接管
      setupAudioPipeline(stream)
    } else {
      video.srcObject = null
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

// 监听全屏状态 — 调用容器全屏 API
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

onMounted(() => {
  document.addEventListener('fullscreenchange', onFullscreenChange)

  // 音频由 Web Audio API 接管，video 元素始终静音
  // 保留 video.volume 设置以保持一致性
  const video = videoEl.value
  if (video) {
    video.volume = settingsStore.volume
    video.muted = true
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  // 清理 Web Audio 管线
  teardownAudioPipeline()
})
</script>
