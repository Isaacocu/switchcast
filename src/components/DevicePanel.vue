<template>
  <aside class="w-[280px] shrink-0 h-full bg-bg-secondary border-r border-border-main flex flex-col">
    <!-- 标题栏 -->
    <div class="px-4 py-3 border-b border-border-main">
      <h2 class="text-sm font-semibold text-text-primary">采集设备</h2>
    </div>

    <!-- 设备列表区域 -->
    <div class="flex-1 overflow-y-auto p-4 space-y-5">
      <!-- 无设备提示 -->
      <div
        v-if="!captureStore.hasDevices && !isRefreshing"
        class="flex flex-col items-center justify-center py-12 text-center"
      >
        <svg class="w-12 h-12 text-white/15 mb-3" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 7h-3V5.5C16 4.12 14.88 3 13.5 3h-3C9.12 3 8 4.12 8 5.5V7H5c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2zm-9-1.5c0-.28.22-.5.5-.5h3c.28 0 .5.22.5.5V7h-4V5.5z" />
        </svg>
        <p class="text-text-secondary text-xs mb-1">未检测到采集设备</p>
        <p class="text-text-secondary/60 text-xs">请连接 USB 采集卡后点击刷新</p>
      </div>

      <!-- 视频设备选择 -->
      <div v-if="captureStore.hasDevices || isRefreshing">
        <label class="block text-xs font-medium text-text-secondary mb-1.5">
          视频设备
        </label>
        <select
          v-model="settingsStore.videoDeviceId"
          class="w-full bg-bg-card border border-border-main rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary transition-colors"
        >
          <option value="" disabled>请选择视频设备</option>
          <option
            v-for="device in captureStore.devices.video"
            :key="device.deviceId"
            :value="device.deviceId"
          >
            {{ device.label || '未命名设备' }}
          </option>
        </select>
        <p v-if="captureStore.devices.video.length === 0" class="text-xs text-text-secondary/50 mt-1">
          无可用视频设备
        </p>
      </div>

      <!-- 音频设备选择 -->
      <div v-if="captureStore.hasDevices || isRefreshing">
        <label class="block text-xs font-medium text-text-secondary mb-1.5">
          音频设备
        </label>
        <select
          v-model="settingsStore.audioDeviceId"
          class="w-full bg-bg-card border border-border-main rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary transition-colors"
        >
          <option value="">不采集音频</option>
          <option
            v-for="device in captureStore.devices.audio"
            :key="device.deviceId"
            :value="device.deviceId"
          >
            {{ device.label || '未命名设备' }}
          </option>
        </select>
        <p v-if="captureStore.devices.audio.length === 0" class="text-xs text-text-secondary/50 mt-1">
          无可用音频设备
        </p>
      </div>

      <!-- 当前采集信息 -->
      <div v-if="captureStore.isCapturing" class="bg-bg-card rounded-md p-3 space-y-1.5">
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
          <span class="text-xs text-text-primary font-medium">采集中</span>
        </div>
        <div class="flex items-center justify-between text-xs">
          <span class="text-text-secondary">分辨率</span>
          <span class="text-text-primary font-mono-sm">{{ settingsStore.resolutionLabel }}</span>
        </div>
        <div class="flex items-center justify-between text-xs">
          <span class="text-text-secondary">FPS</span>
          <span class="text-text-primary font-mono-sm">{{ captureStore.stats.fps }}</span>
        </div>
        <div class="flex items-center justify-between text-xs">
          <span class="text-text-secondary">延迟</span>
          <span class="text-text-primary font-mono-sm">{{ captureStore.stats.latency }}ms</span>
        </div>
      </div>

      <!-- 刷新设备按钮 -->
      <button
        class="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs text-text-secondary border border-border-main rounded-md hover:bg-bg-card hover:text-text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        :disabled="isRefreshing"
        @click="refreshDevices"
      >
        <svg
          class="w-3.5 h-3.5"
          :class="{ 'animate-spin': isRefreshing }"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M23 4v6h-6" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M1 20v-6h6" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        {{ isRefreshing ? '刷新中...' : '刷新设备' }}
      </button>
    </div>

    <!-- 底部操作区 -->
    <div class="p-4 border-t border-border-main">
      <button
        class="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        :class="captureStore.isCapturing
          ? 'bg-bg-card text-text-primary border border-border-main hover:bg-border-main'
          : 'bg-primary text-white hover:bg-primary/90'"
        :disabled="captureStore.state === 'starting' || captureStore.state === 'stopping'"
        @click="toggleCapture"
      >
        <!-- 停止图标 -->
        <svg
          v-if="captureStore.isCapturing"
          class="w-4 h-4"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <rect x="6" y="6" width="12" height="12" rx="1" />
        </svg>
        <!-- 开始图标 -->
        <svg
          v-else
          class="w-4 h-4"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M8 5v14l11-7z" />
        </svg>
        {{ captureStore.isCapturing ? '停止投屏' : '开始投屏' }}
      </button>
      <p
        v-if="!settingsStore.videoDeviceId && !captureStore.isCapturing"
        class="text-xs text-text-secondary/50 mt-2 text-center"
      >
        请先选择视频设备
      </p>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useCaptureStore } from '@/stores/capture'
import { useSettingsStore } from '@/stores/settings'
import { useCapture } from '@/composables/useCapture'

const captureStore = useCaptureStore()
const settingsStore = useSettingsStore()
const { enumerateDevices, startCapture, stopCapture } = useCapture()

/** 是否正在刷新设备 */
const isRefreshing = ref(false)

/** 刷新设备列表 */
async function refreshDevices() {
  isRefreshing.value = true
  try {
    await enumerateDevices()
  } finally {
    isRefreshing.value = false
  }
}

/** 切换采集状态 — 开始或停止 */
async function toggleCapture() {
  if (captureStore.isCapturing) {
    await stopCapture()
  } else {
    await startCapture()
  }
}
</script>
