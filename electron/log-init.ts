import { homedir } from 'os'
import fs from 'fs'
import path from 'path'
import log from 'electron-log'

/** 日志目录：与 Python 后端共用 ~/.hcomic_downloader/logs/（方案甲） */
const LOG_DIR = path.join(homedir(), '.hcomic_downloader', 'logs')
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

/**
 * 初始化 electron-log：建立文件日志、轮转、未捕获异常捕获、console 拦截。
 *
 * 关键能力：
 * - Object.assign(console, log.functions) 让现有 17 处 console.* 零改造自动落盘
 * - errorHandler.startCatching() 捕获未处理的异常 / Promise rejection
 *
 * 必须在 app ready 前调用，越早越好（以捕获启动期异常）。
 */
export function initLogging(): void {
  // 确保日志目录存在（首次写入前创建）
  fs.mkdirSync(LOG_DIR, { recursive: true })

  // 文件输出：写入 ~/.hcomic_downloader/logs/main.log
  log.transports.file.resolvePathFn = () => path.join(LOG_DIR, 'main.log')
  log.transports.file.maxSize = MAX_FILE_SIZE
  log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}'

  // 终端输出保留（dev 时可见，与现有 console 行为一致）
  log.transports.console.format = '[{level}] {text}'

  // 捕获未处理的异常与 Promise rejection，避免静默丢失
  log.errorHandler.startCatching({ showDialog: false })

  // 接管 console.*：现有代码无需改动即自动落盘
  Object.assign(console, log.functions)

  log.info(`[log-init] logging initialized, log dir: ${LOG_DIR}`)
}

/** 日志目录路径（供 diagnostics 等模块复用） */
export function getLogDir(): string {
  return LOG_DIR
}
