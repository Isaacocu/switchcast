import { app } from 'electron'
import fs from 'fs'
import path from 'path'

/**
 * 诊断日志器 — 单例模式
 *
 * 写入 app.getPath('logs')/switchcast.log，异步 append（fs.promises.appendFile）。
 * - 单文件上限 ~1MB，滚动保留 3 份（switchcast.log / switchcast.1.log / switchcast.2.log）
 * - 格式：[ISO时间] [LEVEL] [scope] msg
 * - console 双写（info→console.log / warn→console.warn / error→console.error）
 * - 全部 try/catch 静默，写盘失败绝不影响主流程
 * - 禁止同步 IO（初始化时异步读一次文件大小判断是否需轮转）
 * - 写操作通过 Promise 链串行化，避免并发 append 交错
 */

/** 单文件大小上限（~1MB） */
const MAX_FILE_SIZE = 1024 * 1024

/** 归档份数（switchcast.1.log / switchcast.2.log，加上当前文件共 3 份） */
const MAX_ARCHIVES = 2

/** flush() 最长等待时间 */
const FLUSH_TIMEOUT_MS = 500

type LogLevel = 'INFO' | 'WARN' | 'ERROR'

class Logger {
  /** 当前日志文件完整路径（懒初始化） */
  private logFilePath = ''

  /** 日志目录（懒初始化） */
  private logDir = ''

  /** 当前文件已写字节数（初始化时异步读取一次） */
  private currentSize = 0

  /** 文件大小是否已探测 */
  private sizeProbed = false

  /** 串行化写操作的 Promise 链 */
  private writeChain: Promise<void> = Promise.resolve()

  info(scope: string, message: string): void {
    this.log('INFO', scope, message)
  }

  warn(scope: string, message: string): void {
    this.log('WARN', scope, message)
  }

  error(scope: string, message: string): void {
    this.log('ERROR', scope, message)
  }

  /**
   * 退出前尽力刷盘（限时 500ms，超时直接 resolve，绝不阻塞退出）
   */
  flush(): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => resolve(), FLUSH_TIMEOUT_MS)
      try {
        timer.unref?.()
      } catch {
        /* 忽略 */
      }
      this.writeChain.then(
        () => {
          clearTimeout(timer)
          resolve()
        },
        () => {
          clearTimeout(timer)
          resolve()
        }
      )
    })
  }

  /**
   * 记录一条日志：console 双写 + 异步落盘（失败静默）
   */
  private log(level: LogLevel, scope: string, message: string): void {
    const line = `[${new Date().toISOString()}] [${level}] [${scope}] ${message}`

    // console 双写（console 自身异常忽略）
    try {
      if (level === 'ERROR') console.error(line)
      else if (level === 'WARN') console.warn(line)
      else console.log(line)
    } catch {
      /* 静默 */
    }

    // 入队异步落盘，链上任何失败都不外溢
    this.writeChain = this.writeChain
      .then(() => this.writeLine(line))
      .catch(() => {
        /* 静默 */
      })
  }

  /**
   * 写一行到日志文件（含懒初始化与轮转判断）
   */
  private async writeLine(line: string): Promise<void> {
    try {
      if (!(await this.ensureReady())) return

      const byteLen = Buffer.byteLength(line, 'utf8')
      if (this.currentSize + byteLen > MAX_FILE_SIZE) {
        await this.rotate()
      }

      await fs.promises.appendFile(this.logFilePath, line + '\n', 'utf8')
      this.currentSize += byteLen + 1
    } catch {
      /* 静默：写盘失败绝不影响主流程 */
    }
  }

  /**
   * 懒初始化：解析日志路径并异步探测当前文件大小
   * @returns 是否可用（getPath 失败等场景返回 false，跳过落盘）
   */
  private async ensureReady(): Promise<boolean> {
    try {
      if (!this.logFilePath) {
        this.logDir = app.getPath('logs')
        this.logFilePath = path.join(this.logDir, 'switchcast.log')
      }
      if (!this.sizeProbed) {
        this.sizeProbed = true
        try {
          const stat = await fs.promises.stat(this.logFilePath)
          this.currentSize = stat.size
        } catch {
          // 文件不存在或不可读 → 从 0 计
          this.currentSize = 0
        }
      }
      return true
    } catch {
      return false
    }
  }

  /** 归档文件名：switchcast.1.log / switchcast.2.log */
  private archivePath(index: number): string {
    return path.join(this.logDir, `switchcast.${index}.log`)
  }

  /**
   * 轮转：switchcast.log → .1 → .2，超出 MAX_ARCHIVES 的删除
   * 全程异步，失败静默
   */
  private async rotate(): Promise<void> {
    try {
      // 删除最旧归档
      await fs.promises.rm(this.archivePath(MAX_ARCHIVES), { force: true }).catch(() => {
        /* 静默 */
      })
      // 依次后移归档
      for (let i = MAX_ARCHIVES - 1; i >= 1; i--) {
        await fs.promises
          .rename(this.archivePath(i), this.archivePath(i + 1))
          .catch(() => {
            /* 源文件不存在等场景静默 */
          })
      }
      // 当前文件 → .1；仅 rename 成功后才重置大小，失败时保留 currentSize
      // 避免轮转失败后计数归零导致文件无限增长
      try {
        await fs.promises.rename(this.logFilePath, this.archivePath(1))
        this.currentSize = 0
      } catch {
        /* 静默 */
      }
    } catch {
      /* 静默 */
    }
  }
}

/** 单例实例 */
let loggerInstance: Logger | null = null

/**
 * 获取日志器单例
 */
export function getLogger(): Logger {
  if (!loggerInstance) {
    loggerInstance = new Logger()
  }
  return loggerInstance
}
