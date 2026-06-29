<template>
  <Transition name="controls-fade">
    <div
      v-show="visible"
      ref="rootRef"
      class="absolute bottom-0 left-0 right-0 z-20 px-4 pb-3"
      @mouseenter="onMouseEnter"
      @mouseleave="onMouseLeave"
    >
      <div class="flex items-center justify-between gap-4 bg-black/60 backdrop-blur-md rounded-xl px-4 py-2.5 border border-white/5">
        <!-- 左侧：全屏 + 音量 -->
        <div class="flex items-center gap-2">
          <!-- 全屏按钮 -->
          <button
            class="w-8 h-8 flex items-center justify-center rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            :title="captureStore.isFullscreen ? '退出全屏' : '全屏'"
            @click="onToggleFullscreen"
          >
            <svg v-if="captureStore.isFullscreen" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <svg v-else class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 8V5a2 2 0 0 1 2-2h3m6 0h3a2 2 0 0 1 2 2v3m0 6v3a2 2 0 0 1-2 2h-3m-6 0H5a2 2 0 0 1-2-2v-3" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>

          <!-- 音量按钮 -->
          <button
            class="w-8 h-8 flex items-center justify-center rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            :title="isMuted ? '取消静音' : '静音'"
            @click="toggleMute"
          >
            <svg v-if="isMuted || volumePercent === 0" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 5L6 9H2v6h4l5 4V5z" stroke-linecap="round" stroke-linejoin="round" />
              <line x1="23" y1="9" x2="17" y2="15" stroke-linecap="round" />
              <line x1="17" y1="9" x2="23" y2="15" stroke-linecap="round" />
            </svg>
            <svg v-else class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 5L6 9H2v6h4l5 4V5z" stroke-linecap="round" stroke-linejoin="round" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>

          <!-- 音量滑块 -->
          <input
            type="range"
            min="0"
            max="100"
            :value="volumePercent"
            class="w-20"
            @input="onVolumeChange"
          />
        </div>

        <!-- 中间：录制 + 推流（Phase 4/5 占位，禁用状态） -->
        <div class="flex items-center gap-2">
          <!-- 录制按钮 -->
          <button
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-white/30 cursor-not-allowed"
            disabled
            title="录制功能将在 Phase 4 推出"
          >
            <span class="w-2.5 h-2.5 rounded-full bg-red-500/40"></span>
            录制
          </button>

          <!-- 推流按钮 -->
          <button
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-white/30 cursor-not-allowed"
            disabled
            title="推流功能将在 Phase 5 推出"
          >
            <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M23 7l-7 5 7 5V7z" stroke-linecap="round" stroke-linejoin="round" />
              <rect x="1" y="5" width="15" height="14" rx="2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            推流
          </button>
        </div>

        <!-- 右侧：设置 + 统计 -->
        <div class="flex items-center gap-2">
          <!-- 统计信息按钮 -->
          <button
            class="w-8 h-8 flex items-center justify-center rounded-md transition-colors"
            :class="captureStore.showStats ? 'text-primary bg-white/10' : 'text-white/70 hover:text-white hover:bg-white/10'"
            title="统计信息"
            @click="onToggleStats"
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="20" x2="18" y2="10" stroke-linecap="round" />
              <line x1="12" y1="20" x2="12" y2="4" stroke-linecap="round" />
              <line x1="6" y1="20" x2="6" y2="14" stroke-linecap="round" />
            </svg>
          </button>

          <!-- 设置按钮 -->
          <button
            class="w-8 h-8 flex items-center justify-center rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            title="设置"
            @click="onToggleSettings"
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useCaptureStore } from '@/stores/capture'
import { useSettingsStore } from '@/stores/settings'

const emit = defineEmits<{
  toggleSettings: []
}>()

const captureStore = useCaptureStore()
const settingsStore = useSettingsStore()

/** 根元素引用 */
const rootRef = ref<HTMLDivElement | null>(null)

/** 控制栏是否可见 */
const visible = ref(true)

/** 控制栏自动隐藏定时器 */
let hideTimer: ReturnType<typeof setTimeout> | null = null

/** 静音前的音量值（用于取消静音时恢复） */
let lastVolume = 1.0

/** 是否静音 */
const isMuted = computed(() => settingsStore.volume === 0)

/** 音量百分比（0-100） */
const volumePercent = computed(() => Math.round(settingsStore.volume * 100))

/** 切换全屏 */
function onToggleFullscreen() {
  captureStore.toggleFullscreen()
}

/** 切换统计叠加层 */
function onToggleStats() {
  captureStore.toggleStats()
}

/** 打开设置对话框 */
function onToggleSettings() {
  emit('toggleSettings')
}

/** 音量滑块变化 */
function onVolumeChange(e: Event) {
  const target = e.target as HTMLInputElement
  const percent = parseInt(target.value, 10)
  settingsStore.updateSettings({ volume: percent / 100 })
  if (percent > 0) {
    lastVolume = percent / 100
  }
}

/** 切换静音 */
function toggleMute() {
  if (isMuted.value) {
    // 恢复音量
    settingsStore.updateSettings({ volume: lastVolume || 1.0 })
  } else {
    lastVolume = settingsStore.volume
    settingsStore.updateSettings({ volume: 0 })
  }
}

/** 鼠标进入控制栏 — 取消隐藏定时器 */
function onMouseEnter() {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  visible.value = true
}

/** 鼠标离开控制栏 — 延迟隐藏 */
function onMouseLeave() {
  startHideTimer()
}

/** 父容器鼠标移动 — 显示控制栏并重置定时器 */
function onParentMouseMove() {
  visible.value = true
  if (hideTimer) {
    clearTimeout(hideTimer)
  }
  startHideTimer()
}

/** 父容器鼠标离开 — 立即隐藏 */
function onParentMouseLeave() {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  visible.value = false
}

/** 启动延迟隐藏定时器（3秒后隐藏） */
function startHideTimer() {
  hideTimer = setTimeout(() => {
    visible.value = false
  }, 3000)
}

onMounted(() => {
  // 监听父容器（视频区域）的鼠标事件
  const parent = rootRef.value?.parentElement
  if (parent) {
    parent.addEventListener('mousemove', onParentMouseMove)
    parent.addEventListener('mouseleave', onParentMouseLeave)
  }
  startHideTimer()
})

onBeforeUnmount(() => {
  if (hideTimer) {
    clearTimeout(hideTimer)
  }
  const parent = rootRef.value?.parentElement
  if (parent) {
    parent.removeEventListener('mousemove', onParentMouseMove)
    parent.removeEventListener('mouseleave', onParentMouseLeave)
  }
})
</script>
