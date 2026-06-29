import { app, BrowserWindow, ipcMain, systemPreferences } from 'electron'
import { join } from 'path'
import { registerCaptureIpc } from './ipc/capture'

// 跨平台判断
const isMac = process.platform === 'darwin'

// 允许无用户交互自动播放音频（Electron 默认可能需要用户交互）
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

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
    console.error('[SwitchCast] 媒体权限请求失败:', err)
  }
}

app.whenReady().then(async () => {
  // 注册窗口控制 IPC（仅注册一次）
  registerWindowIpc()

  // 请求 macOS 媒体访问权限
  await requestMediaAccess()

  // 注册采集 IPC handlers
  registerCaptureIpc(ipcMain)

  createWindow()

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
