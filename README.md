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
