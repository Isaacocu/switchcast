import { defineStore } from 'pinia'
import type { UpdateProgress, UpdaterStatus } from '@/types/update'

interface UpdaterStoreState {
  /** 更新器当前状态 */
  status: UpdaterStatus
  /** 下载进度（仅 downloading 阶段有效） */
  progress: UpdateProgress | null
  /**
   * 是否抑制「自动发现」的更新提示（由「启动时检查更新」开关驱动）。
   * 注意：主进程启动静默检查始终存在（24h 节流），该开关仅影响 UI 展示——
   * 关闭时自动发现的 available 状态推送会被过滤，手动检查不受影响。
   */
  suppressAutoUpdate: boolean
}

export const useUpdaterStore = defineStore('updater', {
  state: (): UpdaterStoreState => ({
    status: { phase: 'idle' },
    progress: null,
    suppressAutoUpdate: false,
  }),

  getters: {
    /** 是否处于忙碌阶段（用于按钮防重复点击） */
    isBusy(state): boolean {
      return state.status.phase === 'checking' || state.status.phase === 'downloading'
    },
  },

  actions: {
    /**
     * 接收主进程状态推送（由 App.vue 订阅 update:status 后调用）。
     * 开关关闭时过滤自动发现的更新提示：available（自动发现）被抑制为 idle；
     * checking/downloading/ready/error/latest 为手动操作或用户已主动下载的后续
     * 阶段，始终放行。
     */
    applyStatus(status: UpdaterStatus, isAuto = false) {
      if (this.suppressAutoUpdate && isAuto && status.phase === 'available') {
        // 保持 idle，UI 不展示自动发现的更新
        this.status = { phase: 'idle' }
        return
      }
      this.status = status
      // 非下载阶段清理进度，避免残留
      if (status.phase !== 'downloading') {
        this.progress = null
      }
    },

    /** 接收下载进度推送（由 App.vue 订阅 update:progress 后调用） */
    applyProgress(progress: UpdateProgress) {
      this.progress = progress
    },

    /**
     * 检查更新
     * @param manual true=用户手动触发（跳过 24h 节流），false=启动静默检查
     */
    async check(manual: boolean): Promise<{ success: boolean; error?: string }> {
      if (!window.updater?.check) {
        return { success: false, error: '更新服务不可用' }
      }
      if (manual) {
        this.status = { phase: 'checking' }
        this.progress = null
      }
      try {
        const res = await window.updater.check(manual)
        // info 在「已是最新/被 24h 节流」时为 null，用 getState() 区分 latest/idle
        if (res.success && !res.info && manual) {
          const state = await window.updater.getState()
          this.applyStatus(state, false)
        }
        return res
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        if (manual) {
          this.status = { phase: 'error', error }
        }
        return { success: false, error }
      }
    },

    /** 下载更新包（进度经 applyProgress 推送） */
    async download(): Promise<{ success: boolean; error?: string }> {
      if (!window.updater?.download) {
        return { success: false, error: '更新服务不可用' }
      }
      try {
        return await window.updater.download()
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    },

    /** 就地安装并重启 */
    async install(): Promise<{ success: boolean; error?: string }> {
      if (!window.updater?.install) {
        return { success: false, error: '更新服务不可用' }
      }
      try {
        return await window.updater.install()
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    },

    /** 打开 GitHub Release 下载页（降级路径） */
    async openReleasePage(): Promise<{ success: boolean; error?: string }> {
      if (!window.updater?.openReleasePage) {
        return { success: false, error: '更新服务不可用' }
      }
      try {
        return await window.updater.openReleasePage()
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  },
})
