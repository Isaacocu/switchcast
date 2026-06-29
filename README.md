# SwitchCast — Nintendo Switch 投屏软件 | Screen Casting & Game Capture

> Nintendo Switch → Mac / Windows 有线投屏桌面软件。通过 USB HDMI 采集卡将 Switch 游戏画面和声音实时投屏到电脑，轻量级 OBS 替代方案。

**SwitchCast** is a lightweight, open-source desktop application for casting Nintendo Switch gameplay to Mac and Windows PC via USB HDMI capture card. A minimal OBS alternative focused on pure screen casting with low latency, audio sync, and zero telemetry.

---

## 核心功能 | Features

- 🎮 **Switch 投屏** — 通过 USB HDMI 采集卡将 Nintendo Switch 画面实时投屏到 Mac / Windows
- 🔊 **音画同步** — Web Audio API 独立音频管线，支持音画同步偏移调节（DelayNode，-200ms ~ +200ms）
- 📺 **1080p60 高清** — 支持全高清 60fps 全屏显示
- 🚫 **纯净音频** — 禁用 Chromium 回声消除(AEC)/噪声抑制(NS)/自动增益(AGC)，游戏音频无消音无波动
- 📊 **实时统计** — FPS、分辨率、延迟、丢帧 OSD 叠加显示
- ⚙️ **设置持久化** — 分辨率、帧率、音量、音画同步偏移自动保存
- 🔌 **热插拔检测** — USB 采集卡插拔自动识别，无需重启
- 🖥️ **跨平台** — macOS (Apple Silicon arm64 + Intel x64) + Windows x64

## 搜索关键词 | Keywords

`Switch 投屏` `Switch 投屏软件` `Switch 屏幕投射` `Nintendo Switch capture` `Switch to PC` `Switch to Mac` `游戏投屏` `游戏采集` `OBS 替代` `OBS alternative` `采集卡软件` `HDMI capture` `USB capture card` `screen casting` `game capture` `low latency capture` `Electron desktop app`

## 技术栈 | Tech Stack

| 层级 | 技术 |
|------|------|
| 桌面框架 | Electron 31 + Vue 3.4 + TypeScript 5.5 |
| 构建工具 | electron-vite 2.3 + Vite 5 |
| 状态管理 | Pinia 2.1 |
| 样式 | TailwindCSS 3.4 |
| 音频管线 | Web Audio API（AudioContext → DelayNode → GainNode → Destination） |
| 视频采集 | getUserMedia (UVC/UAC protocol) |
| 打包分发 | electron-builder 24 |

## 硬件要求 | Requirements

| 组件 | 要求 |
|------|------|
| 游戏机 | Nintendo Switch（底座 HDMI 输出，1080p60） |
| 采集卡 | USB HDMI 采集卡（UVC/UAC 协议） |
| 推荐采集卡 | Elgato Cam Link 4K / Mirabox Capture Box / 廉价 UVC 采集棒 |
| 接口 | USB 3.0+（确保带宽充足） |
| 系统 | macOS 10.15+ 或 Windows 10/11 64-bit |

## 连接方式 | Setup

```
Nintendo Switch (底座 HDMI 1.4b 输出)
    │ HDMI 线缆
    ▼
USB HDMI 采集卡 (UVC + UAC, 即插即用无需驱动)
    │ USB 3.0+ 线缆
    ▼
Mac / Windows PC → SwitchCast 实时投屏
```

## 快速开始 | Quick Start

### 下载安装

前往 [Releases](https://github.com/Isaacocu/switchcast/releases) 页面下载对应平台的安装包：

| 平台 | 架构 | 文件 | 适用 |
|------|------|------|------|
| macOS | Apple Silicon | `SwitchCast-1.0.0-arm64.dmg` | M1/M2/M3/M4 芯片 |
| macOS | Intel | `SwitchCast-1.0.0-x64.dmg` | Intel 芯片 Mac |
| Windows | x64 | `SwitchCast-1.0.0-win-x64.exe` | 64 位 Windows 10/11 |

### 使用方法

1. Switch 放入底座，HDMI 连接到采集卡
2. 采集卡通过 USB 3.0+ 连接到电脑
3. 启动 SwitchCast，选择视频和音频设备
4. 点击"开始投屏"即可

### 开发构建

```bash
git clone https://github.com/Isaacocu/switchcast.git
cd switchcast
npm install
npm run dev          # 开发模式
npm run build        # 编译
npm run dist         # 打包全平台
npm run dist:mac     # 仅 macOS
npm run dist:win     # 仅 Windows
```

## 架构 | Architecture

```
┌─────────────────────────────────────────────────┐
│          Electron Renderer (Vue 3 + TS)          │
│  VideoView · DevicePanel · ControlBar           │
│  SettingsDialog · StatsOverlay                  │
├─────────────────────────────────────────────────┤
│              IPC Bridge (preload)                │
├─────────────────────────────────────────────────┤
│            Electron Main Process                │
│  CaptureManager · PermissionManager             │
├─────────────────────────────────────────────────┤
│                Web Audio API                     │
│  MediaStreamSource → DelayNode → GainNode        │
│                   → AudioDestination             │
└─────────────────────────────────────────────────┘
```

### 音频处理说明

SwitchCast 默认禁用 Chromium 的 WebRTC 音频处理模块（AEC/NS/AGC），这些模块为 VoIP 通话设计，会误判游戏音频为回声/噪声导致消音，或自动调整增益导致音量波动。音频通过 Web Audio API 独立管线播放，完全绕过 `<video>` 元素的 media pipeline，确保游戏音频原样输出。

## 开发路线 | Roadmap

- [x] Phase 1: 硬件验证
- [x] Phase 2: Electron WebView MVP（getUserMedia 采集 + Web Audio API 音频）
- [ ] Phase 3: 原生采集升级（AVFoundation/CoreAudio，进一步降低延迟）
- [ ] Phase 4: 录制功能（硬件编码，MP4 录制）
- [ ] Phase 5: RTMP 推流（直播推流到 B站/抖音/Twitch）
- [ ] Phase 6: 高级功能（画面滤镜 / 多源合成 / 全局快捷键）

## License

MIT License — 免费开源，任何人可自由使用、修改和分发。

---

## 声明

### 关于官方网站

本项目 **没有任何官方网站**。SwitchCast 是一个开源项目，唯一官方代码托管地址为 GitHub 仓库：https://github.com/Isaacocu/switchcast

- ❌ 本项目没有官网、没有域名、没有在线服务
- ❌ 任何自称"SwitchCast 官网""SwitchCast 官方下载站"的网站均与本项目无关
- ❌ 任何要求付费下载、注册账号、充值会员才能获取本软件的网站均为假冒
- ✅ 唯一可信的代码和发布渠道：本 GitHub 仓库的 [Releases](https://github.com/Isaacocu/switchcast/releases) 页面

如发现冒充本项目的网站或应用，请通过 GitHub Issues 反馈。

### 关于商标与版权

- "Nintendo Switch" 和 "Switch" 是任天堂株式会社（Nintendo Co., Ltd.）的注册商标
- "OBS" 和 "OBS Studio" 是 OBS Project 的商标
- "Elgato" 和 "Cam Link" 是 Corsair Memory, Inc. 的商标
- "macOS" 和 "Mac" 是 Apple Inc. 的商标
- "Windows" 是 Microsoft Corporation 的商标
- 本项目不隶属于上述任何公司或组织，也不被其认可或赞助
- 本项目中提及的上述商标仅用于说明兼容性和使用场景，不构成任何商业关联

### 关于软件性质

- 本项目是 **免费开源软件**，基于 MIT 协议发布，任何人可免费使用、修改和分发
- 本项目 **不收集任何用户数据**，不包含任何遥测、追踪或分析功能
- 本项目 **不联网传输任何音视频内容**，所有采集和显示均在本地完成
- 本项目仅作为投屏显示工具，不涉及任何内容的录制、存储、传输或分发
- 本项目不绕过、不破解任何 DRM/HDCP 保护机制，采集卡的 HDCP 处理由硬件自行完成

### 关于使用风险

- 本软件按"现状"（AS IS）提供，不附带任何明示或暗示的保证
- 用户应确保在使用本软件时遵守当地法律法规
- 用户应确保对所投屏的内容拥有合法的使用权利
- 因使用本软件产生的任何直接或间接损失，作者不承担法律责任
- 用户在使用采集卡设备时，应遵守设备制造商的使用条款

### 关于贡献

- 欢迎通过 Pull Request 贡献代码
- 提交贡献即表示同意以 MIT 协议开源您的贡献内容
- 请勿在代码中引入任何恶意、追踪或数据收集功能
- 请勿在 Issue 或 PR 中包含任何敏感信息（密钥、密码、个人信息等）

### 关于免责

- 本项目作者不对软件的可用性、准确性、可靠性或完整性作出任何保证
- 本项目作者不对因使用或无法使用本软件而造成的任何损失负责
- 本项目作者没有义务提供技术支持，但欢迎通过 Issues 进行社区交流
- 本声明可能随时更新，恕不另行通知

---

> ⚠️ **再次提醒**：本软件完全免费开源。任何收费版本、付费下载、广告推广版均不是本项目。如遇收费情况，请勿支付，并到 GitHub Issues 举报。
