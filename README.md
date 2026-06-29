# SwitchCast

Nintendo Switch → Mac/Windows 有线投屏桌面软件，类似 OBS 的轻量级投屏工具。

## 功能

- 🎮 通过 USB HDMI 采集卡将 Switch 画面投屏到电脑
- 🔊 适配声音和画面（Web Audio API 管线，禁用 Chromium 音频处理）
- 📺 1080p60 全屏显示
- 📊 实时统计 OSD（FPS / 分辨率 / 延迟 / 丢帧）
- ⚙️ 设置持久化（分辨率 / 帧率 / 音量 / 音画同步偏移）
- 🔌 设备热插拔自动检测
- 🖥️ 跨平台支持（macOS + Windows）

## 技术栈

| 层级 | 技术 |
|------|------|
| UI 框架 | Electron 31 + Vue 3.4 + TypeScript 5.5 |
| 构建工具 | electron-vite 2.3 + Vite 5 |
| 状态管理 | Pinia 2.1 |
| 样式 | TailwindCSS 3.4 |
| 音频管线 | Web Audio API（AudioContext + GainNode） |
| 打包 | electron-builder 24 |

## 硬件要求

- Nintendo Switch（底座 HDMI 输出）
- USB HDMI 采集卡（UVC/UAC 协议，推荐 Elgato Cam Link 4K 或 Mirabox Capture Box）
- USB 3.0+ 接口

## 连接拓扑

```
Nintendo Switch (底座 HDMI 1.4b)
    │ HDMI 线缆
    ▼
USB HDMI 采集卡 (UVC + UAC)
    │ USB 3.0+ 线缆
    ▼
Mac / Windows PC
```

## 开发

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 构建
npm run build

# 打包（macOS + Windows）
npm run dist

# 仅打包 macOS
npm run dist:mac

# 仅打包 Windows
npm run dist:win
```

## 架构

```
┌─────────────────────────────────────────────┐
│        Electron Renderer (Vue 3 + TS)        │
│  VideoView · DevicePanel · ControlBar       │
│  SettingsDialog · StatsOverlay              │
├─────────────────────────────────────────────┤
│            IPC Bridge (preload)              │
├─────────────────────────────────────────────┤
│          Electron Main Process              │
│  CaptureManager · PermissionManager         │
├─────────────────────────────────────────────┤
│              Web Audio API                   │
│  MediaStreamSource → GainNode → Destination  │
└─────────────────────────────────────────────┘
```

## 音频处理

默认禁用 Chromium 的 WebRTC 音频处理模块（AEC/NS/AGC），避免游戏音频被误判为回声/噪声而消音。音频通过 Web Audio API 管线独立播放，绕过 `<video>` 元素的 media pipeline。

## 开发路线

- [x] Phase 1: 硬件验证
- [x] Phase 2: Electron WebView MVP
- [ ] Phase 3: Swift 原生采集升级（条件性）
- [ ] Phase 4: 录制功能（VideoToolbox 硬件编码）
- [ ] Phase 5: RTMP 推流
- [ ] Phase 6: 高级功能（滤镜 / 多源 / 快捷键）

## License

MIT
