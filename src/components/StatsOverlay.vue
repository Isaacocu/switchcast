<template>
  <div
    v-if="captureStore.showStats"
    class="absolute top-3 right-3 z-20 bg-black/70 backdrop-blur-sm rounded-lg border border-white/10 px-3 py-2 pointer-events-none"
  >
    <div class="font-mono-sm text-white/90 space-y-0.5">
      <div class="flex items-center justify-between gap-6">
        <span class="text-white/50">FPS</span>
        <span :class="fpsColorClass">{{ captureStore.stats.fps }}</span>
      </div>
      <div class="flex items-center justify-between gap-6">
        <span class="text-white/50">分辨率</span>
        <span>{{ captureStore.stats.resolution || '—' }}</span>
      </div>
      <div class="flex items-center justify-between gap-6">
        <span class="text-white/50">延迟</span>
        <span :class="latencyColorClass">{{ captureStore.stats.latency }}ms</span>
      </div>
      <div class="flex items-center justify-between gap-6">
        <span class="text-white/50">丢帧</span>
        <span>{{ captureStore.stats.droppedFrames }}</span>
      </div>
      <div class="flex items-center justify-between gap-6">
        <span class="text-white/50">码率</span>
        <span>{{ formatBitrate(captureStore.stats.bitrate) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useCaptureStore } from '@/stores/capture'

const captureStore = useCaptureStore()

/** FPS 颜色 — 根据帧率高低显示不同颜色 */
const fpsColorClass = computed(() => {
  const fps = captureStore.stats.fps
  if (fps >= 55) return 'text-green-400'
  if (fps >= 30) return 'text-yellow-400'
  return 'text-red-400'
})

/** 延迟颜色 — 根据延迟高低显示不同颜色 */
const latencyColorClass = computed(() => {
  const latency = captureStore.stats.latency
  if (latency <= 20) return 'text-green-400'
  if (latency <= 50) return 'text-yellow-400'
  return 'text-red-400'
})

/** 格式化码率显示 */
function formatBitrate(kbps: number): string {
  if (kbps === 0) return '—'
  if (kbps >= 1000) {
    return `${(kbps / 1000).toFixed(1)} Mbps`
  }
  return `${kbps} kbps`
}
</script>
