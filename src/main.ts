import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './assets/styles/main.css'

/**
 * 渲染进程全局错误上报 → 主进程诊断日志（window.diagnostics.reportError）
 * 1s 窗口内相同消息去重；钩子自身 try/catch 静默，绝不影响应用运行
 */
let lastErrorMessage = ''
let lastErrorTime = 0

function reportRendererError(message: string): void {
  try {
    const now = Date.now()
    if (message === lastErrorMessage && now - lastErrorTime < 1000) return
    lastErrorMessage = message
    lastErrorTime = now
    window.diagnostics?.reportError('error', message)
  } catch {
    /* 静默 */
  }
}

window.onerror = (message, _source, _lineno, _colno, error) => {
  try {
    const detail = error?.stack ? `${message} | ${error.stack}` : String(message)
    reportRendererError(detail)
  } catch {
    /* 静默 */
  }
  return false
}

window.addEventListener('unhandledrejection', (event) => {
  try {
    const reason: unknown = event.reason
    const detail =
      reason instanceof Error ? reason.stack || reason.message : String(reason)
    reportRendererError(`unhandledrejection: ${detail}`)
  } catch {
    /* 静默 */
  }
})

const app = createApp(App)
app.use(createPinia())
app.mount('#app')
