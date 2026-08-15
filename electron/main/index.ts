import { app, BrowserWindow, ipcMain, systemPreferences, crashReporter } from 'electron'
import { join } from 'path'
import { registerCaptureIpc } from './ipc/capture'
import { registerDiagnosticsIpc } from './ipc/diagnostics'
import { registerUpdaterIpc } from './ipc/updater'
import { getCaptureManager } from './services/capture-manager'
import { getUpdateChecker } from './services/update-checker'
import { getLogger } from './services/logger'

// 初始化诊断日志器（内部 console 双写，写盘失败静默，绝不影响主流程）
const logger = getLogger()

// 全局异常捕获 → 写入诊断日志后以错误码退出（保持崩溃即退出的默认语义，
// 避免带半损坏状态继续运行）
process.on('uncaughtException', (err) => {
  logger.error('main', `uncaughtException: ${err?.stack || err?.message || String(err)}`)
  void logger.flush().finally(() => process.exit(1))
})

process.on('unhandledRejection', (reason) => {
  const detail = reason instanceof Error ? reason.stack || reason.message : String(reason)
  logger.error('main', `unhandledRejection: ${detail}`)
})

// 渲染进程 / 子进程崩溃捕获（记录 reason 与 exitCode）
app.on('render-process-gone', (_event, _webContents, details) => {
  logger.error('main', `render-process-gone: reason=${details.reason} exitCode=${details.exitCode}`)
})

app.on('child-process-gone', (_event, details) => {
  logger.error(
    'main',
    `child-process-gone: type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`
  )
})

// 跨平台判断
const isMac = process.platform === 'darwin'

// 允许无用户交互自动播放音频（Electron 默认可能需要用户交互）
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

// 低延迟渲染优化
app.commandLine.appendSwitch('disable-frame-rate-limit')  // 解除帧率上限，帧到达立即处理
// 注意：disable-gpu-vsync 可进一步降低延迟，但可能导致画面撕裂，暂不默认开启
// app.commandLine.appendSwitch('disable-gpu-vsync')

// 视频采集使用 GPU 内存缓冲池，减少捕获管线 CPU 拷贝
app.commandLine.appendSwitch('video-capture-use-gpu-memory-buffer')

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0a0a0a',
    // 应用窗口图标（Windows 任务栏 / Linux 窗口图标）
    // 开发模式: 从项目根目录 build/ 读取；生产模式: 从 resources/ 读取
    icon: app.isPackaged
      ? join(process.resourcesPath, 'icon.png')
      : join(__dirname, '../../build/icon.png'),
    // macOS 使用 hiddenInset（原生红绿灯按钮），Windows 使用 hidden（自定义标题栏）
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    // Windows 上自动隐藏菜单栏（按 Alt 显示）
    autoHideMenuBar: !isMac,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  // 加载渲染进程
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/**
 * 注册窗口控制 IPC 监听器
 * 提取到 createWindow 外部，避免 macOS 重新激活窗口时重复注册
 */
function registerWindowIpc(): void {
  ipcMain.on('window:minimize', () => {
    BrowserWindow.getAllWindows()[0]?.minimize()
  })

  ipcMain.on('window:maximize', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    // Windows 全屏状态下点击最大化按钮应先退出全屏
    if (win.isFullScreen()) {
      win.setFullScreen(false)
    } else if (win.isMaximized()) {
      win.unmaximize()
    } else {
      win.maximize()
    }
  })

  ipcMain.on('window:close', () => {
    BrowserWindow.getAllWindows()[0]?.close()
  })
}

/**
 * 请求 macOS 媒体访问权限（摄像头和麦克风）
 * 在 app.whenReady() 时调用，确保采集卡视频和音频可以正常工作
 * Windows 不需要 askForMediaAccess，权限由系统直接管理
 */
async function requestMediaAccess(): Promise<void> {
  if (process.platform !== 'darwin') return
  try {
    const cameraStatus = systemPreferences.getMediaAccessStatus('camera')
    if (cameraStatus !== 'granted') {
      await systemPreferences.askForMediaAccess('camera')
    }
    const micStatus = systemPreferences.getMediaAccessStatus('microphone')
    if (micStatus !== 'granted') {
      await systemPreferences.askForMediaAccess('microphone')
    }
  } catch (err) {
    logger.error(
      'main',
      `媒体权限请求失败: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

app.whenReady().then(async () => {
  // 启动本地 Crashpad 崩溃收集（仅本地落盘，不上传）
  crashReporter.start({
    productName: 'SwitchCast',
    companyName: 'SwitchCast',
    uploadToServer: false
  })

  // 注册窗口控制 IPC（仅注册一次）
  registerWindowIpc()

  // 请求 macOS 媒体访问权限
  await requestMediaAccess()

  // 注册采集 IPC handlers
  registerCaptureIpc(ipcMain)

  // 注册诊断日志与报告导出 IPC handlers
  registerDiagnosticsIpc(ipcMain)

  // 注册应用更新 IPC handlers（含启动时 .app.old 残留清理）
  registerUpdaterIpc(ipcMain)

  // 应用版本号同步注入（preload 经 sendSync 获取，供 window.appInfo 使用）
  ipcMain.on('app:getVersion', (event) => {
    event.returnValue = app.getVersion()
  })

  createWindow()

  // 自动检查更新（仅打包环境）：延迟 10-20s fire-and-forget，
  // autoCheck 内部走 24h 节流；发现新版本经 update:status 推 available 给窗口
  if (app.isPackaged) {
    setTimeout(() => {
      void getUpdateChecker().autoCheck()
    }, 10000 + Math.random() * 10000)
  }

  // Phase 3: 原生模块在首次采集时按需加载，无需预初始化

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// 应用退出前清理原生采集模块（threadsafe function 必须 release，否则退出挂起）
app.on('before-quit', () => {
  try {
    getCaptureManager().destroy()
  } catch (err) {
    logger.warn('main', `原生模块清理失败: ${err instanceof Error ? err.message : String(err)}`)
  }
  // 尽力刷盘诊断日志（限时 500ms，不阻塞退出）
  void logger.flush()
})
