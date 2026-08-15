/**
 * 应用更新相关类型定义
 *
 * 供 preload（electron/preload/index.ts）、更新器主进程服务
 * （electron/main/services/update-checker.ts）与后续 UI 组件共同引用。
 */

/** 更新流程阶段 */
export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'error'
  | 'latest'

/** 一次检查结果 */
export interface UpdateInfo {
  /** 远端最新版本号（如 1.2.0） */
  version: string
  /** Release Notes（release.body，已截断至 2000 字） */
  releaseNotes?: string
  /** 匹配当前平台的资产下载地址（无匹配资产时为 undefined，触发降级） */
  downloadUrl?: string
  /** 是否支持就地安装（mac && packaged && 有匹配资产；Windows v1 为 false） */
  canInstallInPlace: boolean
}

/** 更新器当前状态（经 update:status 事件推送） */
export interface UpdaterStatus {
  phase: UpdatePhase
  latestVersion?: string
  releaseNotes?: string
  error?: string
  canInstallInPlace?: boolean
}

/** 下载进度（经 update:progress 事件推送，主进程侧节流至每秒最多 4 次） */
export interface UpdateProgress {
  percent: number
  received: number
  total: number
}
