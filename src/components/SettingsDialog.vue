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

                <!-- 采集模式（仅 macOS 显示） -->
                <div v-if="isMac" class="space-y-2 mt-4">
                  <label class="text-sm text-text-primary">采集模式</label>
                  <select
                    v-model="form.captureMode"
                    class="w-full bg-bg-card border border-border-main rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary transition-colors"
                  >
                    <option value="auto">自动（推荐）</option>
                    <option value="native">原生加速</option>
                    <option value="webview">WebView</option>
                  </select>
                  <p class="text-xs text-text-secondary/70">原生加速使用 AVFoundation 直接采集，延迟更低但仅支持 macOS</p>
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

              <!-- ===== 软件更新 ===== -->
              <section>
                <h3 class="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">软件更新</h3>

                <!-- 当前版本 -->
                <div class="flex items-center justify-between">
                  <span class="text-sm text-text-primary">当前版本</span>
                  <span class="text-sm text-text-secondary font-mono-sm">v{{ appVersion }}</span>
                </div>

                <!-- 启动时检查更新开关 -->
                <label class="flex items-center justify-between mt-4 cursor-pointer">
                  <span class="text-sm text-text-primary">启动时检查更新</span>
                  <input type="checkbox" v-model="form.checkUpdatesOnLaunch" class="accent-primary w-4 h-4" />
                </label>
                <p class="text-xs text-text-secondary/70 mt-1">关闭后不展示自动发现的更新提示，仍可手动检查</p>

                <!-- 检查更新 -->
                <div class="mt-4 space-y-2">
                  <button
                    class="px-4 py-2 text-sm text-text-primary border border-border-main rounded-md hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    :disabled="busy.check || updaterStore.status.phase === 'checking' || updaterStore.status.phase === 'downloading'"
                    @click="onCheckUpdates"
                  >
                    {{ updaterStore.status.phase === 'checking' ? '检查中…' : '检查更新' }}
                  </button>

                  <!-- 状态行 -->
                  <div v-if="updaterStore.status.phase === 'latest'" class="text-sm text-text-secondary">
                    已是最新版本
                  </div>

                  <div v-else-if="updaterStore.status.phase === 'available'" class="space-y-2">
                    <div class="flex items-center gap-3">
                      <span class="text-sm text-primary">发现新版本 v{{ updaterStore.status.latestVersion }}</span>
                      <button
                        v-if="updaterStore.status.canInstallInPlace"
                        class="px-3 py-1.5 text-sm font-medium text-white bg-primary hover:bg-primary/90 rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        :disabled="busy.download"
                        @click="onDownload"
                      >
                        立即更新
                      </button>
                      <button
                        v-else
                        class="px-3 py-1.5 text-sm text-text-primary border border-border-main rounded-md hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        :disabled="busy.openRelease"
                        @click="onOpenReleasePage"
                      >
                        前往下载页
                      </button>
                    </div>
                  </div>

                  <div v-else-if="updaterStore.status.phase === 'downloading'" class="space-y-1.5">
                    <div class="w-full h-2 bg-bg-card border border-border-main rounded-full overflow-hidden">
                      <div
                        class="h-full bg-primary transition-all duration-300"
                        :style="{ width: progressPercent + '%' }"
                      ></div>
                    </div>
                    <span class="text-xs text-text-secondary font-mono-sm">正在下载 {{ progressPercent }}%</span>
                  </div>

                  <div v-else-if="updaterStore.status.phase === 'ready'" class="space-y-2">
                    <span class="text-sm text-text-secondary">更新已下载完成</span>
                    <button
                      class="px-3 py-1.5 text-sm font-medium text-white bg-primary hover:bg-primary/90 rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      :disabled="busy.install"
                      @click="onInstall"
                    >
                      更新并重启
                    </button>
                  </div>

                  <div v-else-if="updaterStore.status.phase === 'error'" class="space-y-2">
                    <span class="text-sm text-red-400 break-all">{{ updaterStore.status.error || '检查更新失败' }}</span>
                    <button
                      class="px-3 py-1.5 text-sm text-text-primary border border-border-main rounded-md hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      :disabled="busy.openRelease"
                      @click="onOpenReleasePage"
                    >
                      打开下载页
                    </button>
                  </div>

                  <!-- Release Notes（折叠显示） -->
                  <details
                    v-if="releaseNotesVisible"
                    class="text-xs text-text-secondary/80 bg-bg-card border border-border-main rounded-md"
                  >
                    <summary class="cursor-pointer px-3 py-2 select-none hover:text-text-primary transition-colors">
                      更新说明（v{{ updaterStore.status.latestVersion }}）
                    </summary>
                    <div class="px-3 pb-3 whitespace-pre-wrap break-words leading-relaxed max-h-40 overflow-y-auto">{{ releaseNotesText }}</div>
                  </details>

                  <!-- 诊断操作反馈（错误/成功提示） -->
                  <div v-if="updateActionError" class="text-xs text-red-400 break-all">{{ updateActionError }}</div>
                </div>
              </section>

              <!-- 分隔线 -->
              <div class="border-t border-border-main"></div>

              <!-- ===== 帮助与反馈 ===== -->
              <section>
                <h3 class="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">帮助与反馈</h3>

                <div class="flex flex-wrap items-center gap-2">
                  <button
                    class="px-4 py-2 text-sm text-text-primary border border-border-main rounded-md hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    :disabled="busy.exportReport"
                    @click="onExportReport"
                  >
                    {{ busy.exportReport ? '导出中…' : '导出诊断报告' }}
                  </button>
                  <button
                    class="px-4 py-2 text-sm text-text-primary border border-border-main rounded-md hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    :disabled="busy.openLogDir"
                    @click="onOpenLogDir"
                  >
                    打开日志目录
                  </button>
                  <button
                    class="px-4 py-2 text-sm text-text-primary border border-border-main rounded-md hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    :disabled="busy.openIssue"
                    @click="onOpenIssue"
                  >
                    前往 GitHub 反馈
                  </button>
                </div>

                <!-- 诊断报告导出成功：显示路径 + 提交 Issue 入口 -->
                <div v-if="reportPath" class="mt-3 space-y-1.5">
                  <p class="text-xs text-text-secondary break-all">报告已导出：{{ reportPath }}</p>
                  <button
                    class="px-3 py-1.5 text-sm font-medium text-white bg-primary hover:bg-primary/90 rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    :disabled="busy.openIssue"
                    @click="onOpenIssue"
                  >
                    前往 GitHub 提交 Issue
                  </button>
                </div>

                <!-- 诊断操作失败提示 -->
                <div v-if="diagError" class="mt-2 text-xs text-red-400 break-all">{{ diagError }}</div>
              </section>

              <!-- 录制功能将在 Phase 4 推出，本期不显示 UI -->
              <!-- 录制相关变量保留在 script 中，方便后续恢复 -->

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
import { computed, reactive, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { useCaptureStore } from '@/stores/capture'
import { useUpdaterStore } from '@/stores/updater'
import type { AppSettings } from '@/types/capture'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const settingsStore = useSettingsStore()
const captureStore = useCaptureStore()
const updaterStore = useUpdaterStore()

/** 是否为 macOS（采集模式选项仅 macOS 显示） */
const isMac = ref(window.electron?.platform === 'darwin')

/** 当前应用版本号 */
const appVersion = window.appInfo?.version || '未知'

/** 异步按钮忙碌标记 — 防止重复点击 */
const busy = reactive({
  check: false,
  download: false,
  install: false,
  openRelease: false,
  exportReport: false,
  openIssue: false,
  openLogDir: false,
})

/** 诊断报告导出路径（成功后显示） */
const reportPath = ref('')

/** 诊断操作错误信息 */
const diagError = ref('')

/** 更新操作错误信息（下载/安装/打开下载页失败） */
const updateActionError = ref('')

/** 下载进度百分比（整数显示） */
const progressPercent = computed(() =>
  Math.round(updaterStore.progress?.percent ?? 0)
)

/** Release Notes 截断预览（最多 5 行） */
const releaseNotesText = computed(() => {
  const notes = updaterStore.status.releaseNotes || ''
  const lines = notes.split('\n')
  return lines.length > 5 ? lines.slice(0, 5).join('\n') + '\n…' : notes
})

/** 是否显示 Release Notes 折叠块（available/ready 阶段且有内容） */
const releaseNotesVisible = computed(() => {
  const phase = updaterStore.status.phase
  return (phase === 'available' || phase === 'ready') && !!updaterStore.status.releaseNotes
})

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
  captureMode: 'auto' as AppSettings['captureMode'],
  checkUpdatesOnLaunch: true,
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
  form.captureMode = settingsStore.captureMode
  form.checkUpdatesOnLaunch = settingsStore.checkUpdatesOnLaunch

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

// ===== 软件更新 =====

/** 手动检查更新（manual=true 跳过 24h 节流） */
async function onCheckUpdates() {
  updateActionError.value = ''
  busy.check = true
  try {
    const res = await updaterStore.check(true)
    if (!res.success) {
      updateActionError.value = res.error || '检查更新失败'
    }
  } finally {
    busy.check = false
  }
}

/** 下载更新包 */
async function onDownload() {
  updateActionError.value = ''
  busy.download = true
  try {
    const res = await updaterStore.download()
    if (!res.success) {
      updateActionError.value = res.error || '下载失败'
    }
  } finally {
    busy.download = false
  }
}

/** 就地安装并重启（采集运行中需先确认中断投屏） */
async function onInstall() {
  updateActionError.value = ''
  if (captureStore.isCapturing) {
    const ok = window.confirm('更新将中断当前投屏，是否立即更新并重启？')
    if (!ok) return
  }
  busy.install = true
  try {
    const res = await updaterStore.install()
    if (!res.success) {
      updateActionError.value = res.error || '安装失败'
    }
  } finally {
    busy.install = false
  }
}

/** 打开 GitHub Release 下载页（降级路径） */
async function onOpenReleasePage() {
  updateActionError.value = ''
  busy.openRelease = true
  try {
    const res = await updaterStore.openReleasePage()
    if (!res.success) {
      updateActionError.value = res.error || '无法打开下载页'
    }
  } finally {
    busy.openRelease = false
  }
}

// ===== 帮助与反馈 =====

/** 导出诊断报告 */
async function onExportReport() {
  diagError.value = ''
  reportPath.value = ''
  if (!window.diagnostics?.exportReport) {
    diagError.value = '诊断服务不可用'
    return
  }
  busy.exportReport = true
  try {
    const res = await window.diagnostics.exportReport()
    if (res.success) {
      reportPath.value = res.path || ''
      // 成功但携带警示（如 zip 打包失败回退为目录导出），同步提示用户
      if (res.error) {
        diagError.value = res.error
      }
    } else {
      diagError.value = res.error || '导出诊断报告失败'
    }
  } catch (err) {
    diagError.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.exportReport = false
  }
}

/** 前往 GitHub 提交 Issue（预填环境信息） */
async function onOpenIssue() {
  diagError.value = ''
  if (!window.diagnostics?.openIssue) {
    diagError.value = '诊断服务不可用'
    return
  }
  busy.openIssue = true
  try {
    const res = await window.diagnostics.openIssue()
    if (!res.success) {
      diagError.value = res.error || '无法打开 GitHub 页面'
    }
  } catch (err) {
    diagError.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.openIssue = false
  }
}

/** 打开日志目录 */
async function onOpenLogDir() {
  diagError.value = ''
  if (!window.diagnostics?.openLogDir) {
    diagError.value = '诊断服务不可用'
    return
  }
  busy.openLogDir = true
  try {
    const res = await window.diagnostics.openLogDir()
    if (!res.success) {
      diagError.value = res.error || '无法打开日志目录'
    }
  } catch (err) {
    diagError.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.openLogDir = false
  }
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
    captureMode: form.captureMode,
    checkUpdatesOnLaunch: form.checkUpdatesOnLaunch,
  })
  settingsStore.saveToStorage()
  // 即时同步「启动时检查更新」开关到 updater store（无需重启生效）
  updaterStore.suppressAutoUpdate = !form.checkUpdatesOnLaunch
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

// 监听 visible 变化 — 打开时同步表单数据、清理上次的诊断反馈
watch(
  () => props.visible,
  (v) => {
    if (v) {
      syncFromStore()
      diagError.value = ''
      reportPath.value = ''
      updateActionError.value = ''
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
