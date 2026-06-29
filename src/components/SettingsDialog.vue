<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="visible"
        class="fixed inset-0 z-50 flex items-center justify-center"
        @click.self="onClose"
      >
        <!-- 遮罩层 -->
        <div class="absolute inset-0 bg-black/70 backdrop-blur-sm" />

        <!-- 对话框 -->
        <Transition name="dialog-pop" appear>
          <div
            v-if="visible"
            class="relative bg-bg-secondary rounded-xl shadow-2xl border border-border-main w-[480px] max-h-[85vh] flex flex-col"
            @click.stop
          >
            <!-- 标题栏 -->
            <div class="flex items-center justify-between px-6 py-4 border-b border-border-main">
              <h2 class="text-lg font-semibold text-text-primary">设置</h2>
              <button
                class="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:text-text-primary hover:bg-white/10 transition-colors"
                @click="onClose"
              >
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18" stroke-linecap="round" />
                  <line x1="6" y1="6" x2="18" y2="18" stroke-linecap="round" />
                </svg>
              </button>
            </div>

            <!-- 内容区域 -->
            <div class="flex-1 overflow-y-auto px-6 py-5 space-y-6">

              <!-- ===== 视频设置 ===== -->
              <section>
                <h3 class="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">视频</h3>

                <!-- 分辨率 -->
                <div class="space-y-2">
                  <label class="text-sm text-text-primary">分辨率</label>
                  <div class="flex gap-2">
                    <select
                      v-model="resolutionPreset"
                      class="flex-1 bg-bg-card border border-border-main rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary transition-colors"
                      @change="onResolutionPresetChange"
                    >
                      <option value="1920x1080">1920 x 1080 (Full HD)</option>
                      <option value="1280x720">1280 x 720 (HD)</option>
                      <option value="custom">自定义</option>
                    </select>
                  </div>
                  <!-- 自定义分辨率输入 -->
                  <div v-if="resolutionPreset === 'custom'" class="flex items-center gap-2">
                    <input
                      type="number"
                      v-model.number="form.width"
                      min="320"
                      max="3840"
                      class="w-24 bg-bg-card border border-border-main rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary"
                      placeholder="宽"
                    />
                    <span class="text-text-secondary">×</span>
                    <input
                      type="number"
                      v-model.number="form.height"
                      min="240"
                      max="2160"
                      class="w-24 bg-bg-card border border-border-main rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary"
                      placeholder="高"
                    />
                    <span class="text-xs text-text-secondary">px</span>
                  </div>
                </div>

                <!-- 帧率 -->
                <div class="space-y-2 mt-4">
                  <label class="text-sm text-text-primary">帧率</label>
                  <div class="flex items-center gap-2">
                    <select
                      v-model="frameRatePreset"
                      class="flex-1 bg-bg-card border border-border-main rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary transition-colors"
                      @change="onFrameRatePresetChange"
                    >
                      <option value="30">30 fps</option>
                      <option value="60">60 fps</option>
                      <option value="custom">自定义</option>
                    </select>
                    <input
                      v-if="frameRatePreset === 'custom'"
                      type="number"
                      v-model.number="form.frameRate"
                      min="1"
                      max="120"
                      class="w-20 bg-bg-card border border-border-main rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary"
                      placeholder="fps"
                    />
                  </div>
                </div>
              </section>

              <!-- 分隔线 -->
              <div class="border-t border-border-main"></div>

              <!-- ===== 音频设置 ===== -->
              <section>
                <h3 class="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">音频</h3>

                <!-- 音量 -->
                <div class="space-y-2">
                  <div class="flex items-center justify-between">
                    <label class="text-sm text-text-primary">音量</label>
                    <span class="text-sm text-text-secondary font-mono-sm">{{ Math.round(form.volume * 100) }}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    :value="Math.round(form.volume * 100)"
                    class="w-full"
                    @input="onVolumeInput"
                  />
                </div>

                <!-- 音画同步偏移 -->
                <div class="space-y-2 mt-4">
                  <div class="flex items-center justify-between">
                    <label class="text-sm text-text-primary">音画同步偏移</label>
                    <span
                      class="text-sm font-mono-sm"
                      :class="form.syncOffset === 0 ? 'text-text-secondary' : 'text-primary'"
                    >
                      {{ form.syncOffset > 0 ? '+' : '' }}{{ form.syncOffset }}ms
                    </span>
                  </div>
                  <input
                    type="range"
                    min="-200"
                    max="200"
                    step="10"
                    v-model.number="form.syncOffset"
                    class="w-full"
                  />
                  <div class="flex justify-between text-xs text-text-secondary/50">
                    <span>-200ms（音频提前）</span>
                    <span>0ms</span>
                    <span>+200ms（音频延后）</span>
                  </div>
                </div>
              </section>

              <!-- 分隔线 -->
              <div class="border-t border-border-main"></div>

              <!-- ===== 录制设置（Phase 4 占位） ===== -->
              <section>
                <div class="flex items-center gap-2 mb-3">
                  <h3 class="text-xs font-semibold text-text-secondary uppercase tracking-wider">录制</h3>
                  <span class="text-[10px] px-1.5 py-0.5 rounded bg-text-secondary/20 text-text-secondary">Phase 4</span>
                </div>

                <div class="space-y-4 opacity-50 pointer-events-none">
                  <!-- 录制路径 -->
                  <div class="space-y-2">
                    <label class="text-sm text-text-primary">录制保存路径</label>
                    <div class="flex gap-2">
                      <input
                        type="text"
                        v-model="form.recordingPath"
                        placeholder="选择保存路径..."
                        class="flex-1 bg-bg-card border border-border-main rounded-md px-3 py-2 text-sm text-text-primary"
                        disabled
                      />
                      <button
                        class="px-3 py-2 text-sm text-text-secondary border border-border-main rounded-md"
                        disabled
                      >
                        浏览
                      </button>
                    </div>
                  </div>

                  <!-- 录制格式 -->
                  <div class="space-y-2">
                    <label class="text-sm text-text-primary">录制格式</label>
                    <div class="flex gap-2">
                      <button
                        v-for="fmt in ['mp4', 'webm']"
                        :key="fmt"
                        class="px-4 py-2 text-sm rounded-md border transition-colors"
                        :class="form.recordingFormat === fmt
                          ? 'border-primary text-primary bg-primary/10'
                          : 'border-border-main text-text-secondary'"
                        disabled
                      >
                        {{ fmt.toUpperCase() }}
                      </button>
                    </div>
                  </div>

                  <!-- 视频编码器 -->
                  <div class="space-y-2">
                    <label class="text-sm text-text-primary">视频编码器</label>
                    <div class="flex gap-2">
                      <button
                        v-for="codec in ['h264', 'h265']"
                        :key="codec"
                        class="px-4 py-2 text-sm rounded-md border transition-colors"
                        :class="form.recordingVideoCodec === codec
                          ? 'border-primary text-primary bg-primary/10'
                          : 'border-border-main text-text-secondary'"
                        disabled
                      >
                        {{ codec === 'h264' ? 'H.264' : 'H.265' }}
                      </button>
                    </div>
                  </div>

                  <!-- 视频码率 -->
                  <div class="space-y-2">
                    <div class="flex items-center justify-between">
                      <label class="text-sm text-text-primary">视频码率</label>
                      <span class="text-sm text-text-secondary font-mono-sm">{{ form.recordingVideoBitrate }} kbps</span>
                    </div>
                    <input
                      type="range"
                      min="1000"
                      max="20000"
                      step="500"
                      v-model.number="form.recordingVideoBitrate"
                      class="w-full"
                      disabled
                    />
                  </div>

                  <!-- 音频码率 -->
                  <div class="space-y-2">
                    <div class="flex items-center justify-between">
                      <label class="text-sm text-text-primary">音频码率</label>
                      <span class="text-sm text-text-secondary font-mono-sm">{{ form.recordingAudioBitrate }} kbps</span>
                    </div>
                    <input
                      type="range"
                      min="64"
                      max="320"
                      step="32"
                      v-model.number="form.recordingAudioBitrate"
                      class="w-full"
                      disabled
                    />
                  </div>
                </div>
              </section>
            </div>

            <!-- 底部按钮 -->
            <div class="flex items-center justify-end gap-3 px-6 py-4 border-t border-border-main">
              <button
                class="px-4 py-2 text-sm text-text-secondary hover:text-text-primary border border-border-main rounded-md transition-colors"
                @click="onClose"
              >
                取消
              </button>
              <button
                class="px-5 py-2 text-sm font-medium text-white bg-primary hover:bg-primary/90 rounded-md transition-colors"
                @click="onSave"
              >
                保存
              </button>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { reactive, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import type { AppSettings } from '@/types/capture'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const settingsStore = useSettingsStore()

/** 本地表单状态 — 对话框打开时从 store 同步 */
const form = reactive({
  width: 1920,
  height: 1080,
  frameRate: 60,
  volume: 1.0,
  syncOffset: 0,
  recordingPath: '',
  recordingFormat: 'mp4' as AppSettings['recordingFormat'],
  recordingVideoCodec: 'h264' as AppSettings['recordingVideoCodec'],
  recordingVideoBitrate: 8000,
  recordingAudioBitrate: 128,
})

/** 分辨率预设值 */
const resolutionPreset = ref('1920x1080')

/** 帧率预设值 */
const frameRatePreset = ref('60')

/** 从 store 同步表单数据 */
function syncFromStore() {
  form.width = settingsStore.width
  form.height = settingsStore.height
  form.frameRate = settingsStore.frameRate
  form.volume = settingsStore.volume
  form.syncOffset = settingsStore.syncOffset
  form.recordingPath = settingsStore.recordingPath
  form.recordingFormat = settingsStore.recordingFormat
  form.recordingVideoCodec = settingsStore.recordingVideoCodec
  form.recordingVideoBitrate = settingsStore.recordingVideoBitrate
  form.recordingAudioBitrate = settingsStore.recordingAudioBitrate

  // 推断分辨率预设
  if (form.width === 1920 && form.height === 1080) {
    resolutionPreset.value = '1920x1080'
  } else if (form.width === 1280 && form.height === 720) {
    resolutionPreset.value = '1280x720'
  } else {
    resolutionPreset.value = 'custom'
  }

  // 推断帧率预设
  if (form.frameRate === 30) {
    frameRatePreset.value = '30'
  } else if (form.frameRate === 60) {
    frameRatePreset.value = '60'
  } else {
    frameRatePreset.value = 'custom'
  }
}

/** 分辨率预设变化 */
function onResolutionPresetChange() {
  if (resolutionPreset.value === '1920x1080') {
    form.width = 1920
    form.height = 1080
  } else if (resolutionPreset.value === '1280x720') {
    form.width = 1280
    form.height = 720
  }
}

/** 帧率预设变化 */
function onFrameRatePresetChange() {
  if (frameRatePreset.value === '30') {
    form.frameRate = 30
  } else if (frameRatePreset.value === '60') {
    form.frameRate = 60
  }
}

/** 音量滑块输入 */
function onVolumeInput(e: Event) {
  const target = e.target as HTMLInputElement
  form.volume = parseInt(target.value, 10) / 100
}

/** 保存设置 */
function onSave() {
  settingsStore.updateSettings({
    width: form.width,
    height: form.height,
    frameRate: form.frameRate,
    volume: form.volume,
    syncOffset: form.syncOffset,
    recordingPath: form.recordingPath,
    recordingFormat: form.recordingFormat,
    recordingVideoCodec: form.recordingVideoCodec,
    recordingVideoBitrate: form.recordingVideoBitrate,
    recordingAudioBitrate: form.recordingAudioBitrate,
  })
  settingsStore.saveToStorage()
  emit('close')
}

/** 关闭对话框 */
function onClose() {
  emit('close')
}

/** ESC 键关闭 */
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.visible) {
    onClose()
  }
}

// 监听 visible 变化 — 打开时同步表单数据
watch(
  () => props.visible,
  (v) => {
    if (v) {
      syncFromStore()
    }
  }
)

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>
