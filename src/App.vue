<template>
  <div class="flex flex-col h-screen w-screen bg-bg-primary text-text-primary overflow-hidden">
    <!-- ===== 自定义标题栏（跨平台，可拖拽） ===== -->
    <div
      class="titlebar flex items-center justify-between h-8 bg-bg-secondary border-b border-border-main select-none shrink-0"
      :class="{ 'pl-[72px]': isMac }"
    >
      <!-- 应用名称 -->
      <span class="text-sm font-semibold text-text-secondary pointer-events-none">
        SwitchCast
      </span>

      <!-- macOS: 右侧占位（平衡左侧红绿灯空间，使标题居中） -->
      <div v-if="isMac" class="w-[72px]"></div>

      <!-- Windows: 右侧窗口控制按钮 -->
      <div v-if="!isMac" class="flex items-center">
        <button
          class="titlebar-btn w-11 h-8 flex items-center justify-center hover:bg-white/10 text-text-secondary hover:text-text-primary transition-colors"
          title="最小化"
          @click="onMinimize"
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect y="4.5" width="10" height="1" fill="currentColor" />
          </svg>
        </button>
        <button
          class="titlebar-btn w-11 h-8 flex items-center justify-center hover:bg-white/10 text-text-secondary hover:text-text-primary transition-colors"
          title="最大化"
          @click="onMaximize"
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" stroke-width="1" fill="none" />
          </svg>
        </button>
        <button
          class="titlebar-btn w-11 h-8 flex items-center justify-center hover:bg-red-600 text-text-secondary hover:text-white transition-colors"
          title="关闭"
          @click="onClose"
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M0 0L10 10M10 0L0 10" stroke="currentColor" stroke-width="1" />
          </svg>
        </button>
      </div>
    </div>

    <!-- ===== 主区域 ===== -->
    <div class="flex flex-1 overflow-hidden">
      <!-- 左侧设备面板 -->
      <DevicePanel />

      <!-- 右侧视频区域 -->
      <div class="relative flex-1 overflow-hidden bg-black">
        <VideoView />
        <ControlBar @toggle-settings="showSettings = true" />
      </div>
    </div>

    <!-- ===== 设置对话框 ===== -->
    <SettingsDialog :visible="showSettings" @close="showSettings = false" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import DevicePanel from './components/DevicePanel.vue'
import VideoView from './components/VideoView.vue'
import ControlBar from './components/ControlBar.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import { useCaptureStore } from './stores/capture'
import { useSettingsStore } from './stores/settings'

const captureStore = useCaptureStore()
const settingsStore = useSettingsStore()

/** 是否显示设置对话框 */
const showSettings = ref(false)

/** 是否为 macOS（用于标题栏布局适配） */
const isMac = window.electron?.platform === 'darwin'

/** IPC 取消订阅函数 */
let unsubscribeState: (() => void) | null = null
let unsubscribeError: (() => void) | null = null

// ===== 窗口控制 =====
function onMinimize() {
  window.windowControls.minimize()
}

function onMaximize() {
  window.windowControls.maximize()
}

function onClose() {
  window.windowControls.close()
}

/** 设备热插拔监听 — 检测到设备变化时重新枚举 */
async function handleDeviceChange() {
  console.log('[capture] 检测到设备变化，重新枚举...')
  await captureStore.fetchDevices()
}

onMounted(async () => {
  // 1. 加载设置
  settingsStore.loadFromStorage()

  // 2. 注册设备热插拔监听
  navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange)

  // 3. 注册采集状态变更和错误回调（统一在此处注册，useCapture 不再重复注册）
  unsubscribeState = window.capture.onStateChange((state) => {
    captureStore.updateState(state)
  })
  unsubscribeError = window.capture.onError((error) => {
    captureStore.setError(error)
    captureStore.clearStream()
    captureStore.updateState('error')
  })

  // 4. 枚举设备（触发权限请求）
  await captureStore.fetchDevices()
})

onBeforeUnmount(() => {
  // 移除设备热插拔监听
  navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange)

  // 取消订阅 IPC 事件
  unsubscribeState?.()
  unsubscribeError?.()
})
</script>

<style scoped>
/* 标题栏可拖拽区域 */
.titlebar {
  -webkit-app-region: drag;
}

/* 标题栏按钮不可拖拽 */
.titlebar-btn {
  -webkit-app-region: no-drag;
}
</style>
