/**
 * capture-addon TypeScript 类型声明
 *
 * 定义原生采集模块的 JS 接口类型。
 * 非 macOS 平台或加载失败时，addon 为 null。
 */

/** 采集统计数据（每秒上报一次） */
export interface CaptureStats {
  /** 当前帧率 */
  fps: number;
  /** 采集到渲染的端到端延迟（毫秒，来自 mach_absolute_time PTS 测量） */
  latency: number;
}

/** 创建采集会话的配置选项 */
export interface CaptureOptions {
  /** 设备唯一标识（由 listVideoDevices 枚举获取） */
  deviceID: string;
  /** 期望宽度（像素） */
  width: number;
  /** 期望高度（像素） */
  height: number;
  /** 期望帧率（fps） */
  frameRate: number;
}

/** 视频设备信息 */
export interface VideoDevice {
  /** 设备唯一标识（传给 create 的 deviceID） */
  deviceId: string;
  /** 设备可读名称 */
  label: string;
}

/** 原生采集模块接口 */
export interface NativeCaptureAddon {
  /**
   * 创建采集会话（AVCaptureSession + Metal 管线 + CAMetalLayer）
   * @param options 采集配置
   * @returns 是否创建成功
   */
  create(options: CaptureOptions): boolean;

  /**
   * 将 CAMetalLayer 附加到 Electron 窗口的 NSView
   * @param nsViewHandle 由 win.getNativeWindowHandle() 返回的 Buffer
   * @returns 是否附加成功
   */
  attachToWindow(nsViewHandle: Buffer): boolean;

  /**
   * 启动采集
   * @returns 是否启动成功
   */
  start(): boolean;

  /** 停止采集 */
  stop(): void;

  /**
   * 设置 Metal 层帧矩形（窗口大小变化时调用）
   * @param x X 坐标
   * @param y Y 坐标
   * @param width 宽度
   * @param height 高度
   */
  setFrameRect(x: number, y: number, width: number, height: number): void;

  /** 销毁所有资源（AVFoundation + Metal + CAMetalLayer + tsfn） */
  destroy(): void;

  /**
   * 注册事件回调
   * @param event 事件类型：'stats' 或 'error'
   * @param callback 事件回调函数
   */
  on(event: 'stats', callback: (stats: CaptureStats) => void): void;
  on(event: 'error', callback: (error: string) => void): void;

  /**
   * 枚举视频设备
   * @returns 设备列表（已由 JS 包装层从 JSON 字符串解析为数组）
   */
  listVideoDevices(): VideoDevice[];
}

/** 原生模块实例（非 macOS 或加载失败时为 null） */
declare const addon: NativeCaptureAddon | null;

export default addon;
