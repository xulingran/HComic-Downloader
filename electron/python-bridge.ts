import { spawn, ChildProcess } from 'child_process'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { app } from 'electron'
import type { StartupProgressEvent } from '../shared/types'

const REQUEST_TIMEOUT_MS = 30_000
// 20MB: cover image data URIs (base64) and large URL lists can exceed 1MB
const MAX_BUFFER_SIZE = 20 * 1024 * 1024
const MAX_RESTARTS = 5
// 启动崩溃窗口：仅当后端进程在此时间内连续崩溃才计入 restartCount。
// 超出窗口的崩溃（如长时间运行后 OOM）视为运行期故障而非启动失败，
// 不应累积到 MAX_RESTARTS 触发"后端重启超限"致命横幅——否则一个本可
// 正常服务的后端会因偶发运行期崩溃被永久判死。每次 start() 重置窗口起点。
const STARTUP_CRASH_WINDOW_MS = 30_000
// 优雅关闭 RPC 的等待上限：给后端时间刷盘（断点续传、下载状态）再强制 kill。
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 2_000
// 故障后重启后端的延迟：给 OS 释放端口与文件锁的时间，避免立即 spawn 再次失败。
const BACKEND_RESTART_DELAY_MS = 2_000

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  timer: NodeJS.Timeout
}

export class PythonBridge {
  private process: ChildProcess | null = null
  private pendingRequests = new Map<string, PendingRequest>()
  private buffer = ''
  private restartTimer: NodeJS.Timeout | null = null
  private isShuttingDown = false
  private restartCount = 0
  /** 当前进程的启动时间戳，用于判定崩溃是否落在启动崩溃窗口内 */
  private processStartTime = 0
  private notificationHandlers = new Map<string, (params: unknown) => void>()
  private _readyResolve: (() => void) | null = null
  private _readyPromise: Promise<void> = Promise.resolve()

  /**
   * 致命错误回调：后端进程启动失败或重启超限时触发。
   * 由主进程注册，转发到渲染进程的致命错误横幅。
   */
  onFatal: ((payload: { message: string; detail?: string; kind?: string }) => void) | null = null

  /**
   * 启动进度回调：解析到 Python stderr 的 PROGRESS:<percent>:<label> 行时触发。
   * 由主进程注册，转发到渲染进程的 STARTUP_PROGRESS 通道驱动启动进度条。
   * 仅在 Python 初始化期间有效，ready 之后不再有意义（Python 已就绪）。
   */
  onStartupProgress: ((event: StartupProgressEvent) => void) | null = null

  constructor() {
    this.start()
  }

  private getPythonPath(): string {
    const isDev = !app.isPackaged
    const isWin = process.platform === 'win32'
    if (isDev) {
      const venvPath = path.join(app.getAppPath(), 'venv', isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python3')
      if (fs.existsSync(venvPath)) {
        return venvPath
      }
      return isWin ? 'python' : 'python3'
    }
    const exeName = isWin ? 'python.exe' : 'python'
    return path.join(process.resourcesPath, 'python', exeName)
  }

  private getScriptPath(): string | null {
    const isDev = !app.isPackaged
    if (isDev) {
      return path.join(app.getAppPath(), 'python', 'ipc_server.py')
    }
    return null
  }

  private _clearPendingRequests(reason: string): void {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer)
      pending.reject(new Error(reason))
    }
    this.pendingRequests.clear()
    this.buffer = ''
  }

  private _processLine(line: string): boolean {
    if (!line.trim()) return true
    if (line.length > MAX_BUFFER_SIZE) {
      console.error('IPC single message too large, discarding')
      this._clearPendingRequests('IPC response too large')
      // bufferOverflow: 进程正卡在写超大响应，再发 shutdown RPC 只会继续堆数据
      // 触发二次溢出。直接强 kill 重新拉起，跳过优雅关闭。
      this.handleProcessFailure('IPC response too large', 'bufferOverflow')
      return false
    }
    try {
      const response = JSON.parse(line)
      if (response.id) {
        const pending = this.pendingRequests.get(response.id)
        if (pending) {
          clearTimeout(pending.timer)
          this.pendingRequests.delete(response.id)
          if (response.error) {
            const err = new Error(response.error.message) as Error & { code?: number }
            if (typeof response.error.code === 'number') {
              err.code = response.error.code
            }
            pending.reject(err)
          } else {
            pending.resolve(response.result)
            this.restartCount = 0
          }
        }
      } else if (response.method) {
        this.onNotification(response.method, response.params)
      }
    } catch (e) {
      console.error('Failed to parse IPC response:', e)
    }
    return true
  }

  private handleStdoutData(data: Buffer, proc: ChildProcess) {
    if (this.process !== proc) return
    // 首次收到 stdout 数据 → Python 已启动并开始响应，标记就绪
    if (this._readyResolve !== null) {
      this._readyResolve()
      this._readyResolve = null
    }
    this.buffer += data.toString()

    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() || ''

    for (const line of lines) {
      if (!this._processLine(line)) return
    }

    if (this.buffer.length > MAX_BUFFER_SIZE) {
      console.error('IPC buffer overflow, discarding incomplete message')
      this._clearPendingRequests('IPC buffer overflow')
      // bufferOverflow: 进程正卡在写超大响应，再发 shutdown RPC 只会继续堆数据。
      this.handleProcessFailure('IPC buffer overflow', 'bufferOverflow')
    }
  }

  /**
   * 返回一个 Promise，在后端子进程就绪（stdin/stdout 管道可用）时 resolve。
   * IPC handler 在首次 `bridge.call()` 前应 await 此 Promise。
   */
  waitForReady(): Promise<void> {
    return this._readyPromise
  }

  private start() {
    const pythonPath = this.getPythonPath()
    const scriptPath = this.getScriptPath()
    const args = scriptPath ? [scriptPath] : []

    // 创建 pending promise：等首次 stdout 数据（Python 已启动并响应）时 resolve。
    // 不在 spawn 返回时 resolve —— Python 还在导入模块、初始化 Mixin。
    this._readyResolve = null
    this._readyPromise = new Promise((resolve) => {
      this._readyResolve = resolve
    })

    this.process = spawn(pythonPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    })
    const proc = this.process
    this.processStartTime = Date.now()

    proc.stdout?.on('data', (data: Buffer) => this.handleStdoutData(data, proc))

    proc.stderr?.on('data', (data: Buffer) => {
      if (this.process !== proc) return
      // Python stderr 含 INFO/WARNING/ERROR 各级别，本身已带级别字样。
      // 用 console.log 转发（落盘为 info 级），避免把 INFO 误标成 error。
      // 真正的级别由 Python 日志里的 " - ERROR - " 等字样体现。
      // 逐行转发：确保 main.log 里每一行都带 [Python] 前缀，
      // 便于诊断报告按前缀过滤掉与 python.log 重复的转发副本。
      //
      // 启动进度行例外：PROGRESS:<percent>:<label> 是协议数据而非日志，
      // 解析后调 onStartupProgress 转发到渲染进程，不写入 main.log。
      // 格式错误（非整数 percent、缺 label）降级为普通日志转发，不抛错。
      const text = data.toString()
      for (const line of text.split('\n')) {
        const trimmed = line.trimEnd()
        if (!trimmed) continue
        const progress = parseStartupProgressLine(trimmed)
        if (progress && this.onStartupProgress) {
          this.onStartupProgress(progress)
        } else {
          console.log('[Python]', trimmed)
        }
      }
    })

    proc.on('exit', (code) => {
      if (this.process !== proc) return
      // processExit: 进程已退出，优雅关闭无的放矢，直接走清理+重启。
      this.handleProcessFailure(`Python process exited with code ${code}`, 'processExit')
    })

    proc.on('error', (err) => {
      if (this.process !== proc) return
      console.error('Failed to start Python process:', err)
      // 进入 handleProcessFailure 的重启循环。致命横幅仅在 restartCount 达到 MAX_RESTARTS
      // 时统一由 handleProcessFailure 发出（backend-restart-exceeded），不在每次 error 时弹，
      // 避免重试期间横幅被反复刷新、最终又被 restart-exceeded 覆盖。
      // spawnError: 进程未真正起来，跳过优雅关闭。
      this.handleProcessFailure(`Python process error: ${err.message}`, 'spawnError')
    })
  }

  /**
   * 处理后端进程故障：拒绝所有 pending 请求、清理旧进程、按重启策略拉起新进程。
   *
   * @param reason 故障来源：
   *   - `bufferOverflow`：stdout 缓冲区溢出/单条响应过大。进程仍可能存活但卡在写
   *     超大响应，此时再发 shutdown RPC 只会继续堆数据触发二次溢出，故**跳过**
   *     优雅关闭，直接 kill 重启。
   *   - `processExit`：进程已 exit，优雅关闭无的放矢，直接清理。
   *   - `spawnError`：spawn 失败，进程未真正起来，直接清理。
   *   - 省略（默认）：缓冲区溢出主动触发重启之外的其他路径，按原行为尝试优雅关闭。
   */
  private async handleProcessFailure(
    message: string,
    reason: 'bufferOverflow' | 'processExit' | 'spawnError' | 'other' = 'other',
  ) {
    // 复用 _clearPendingRequests：与 _processLine 溢出路径对称，避免内联重复
    // for 循环（原代码在此 inline 了 pending reject 逻辑）。
    this._clearPendingRequests(message)

    if (this.process) {
      const oldProc = this.process
      oldProc.stdout?.removeAllListeners('data')
      oldProc.stderr?.removeAllListeners('data')
      // 仅在进程仍存活且属可优雅关闭的路径时尝试：发 shutdown RPC 给后端刷盘
      // （断点续传文件、下载状态）再强 kill。
      // - processExit：进程已 exit，oldProc.killed/exitCode/pid 为假，直接跳过。
      // - spawnError：进程未真正起来。
      // - bufferOverflow：进程可能仍存活但卡在写超大响应，shutdown RPC 只会触发
      //   二次溢出，跳过优雅关闭直接 kill 重启。
      const canGracefulShutdown = reason === 'other'
      if (canGracefulShutdown && !oldProc.killed && oldProc.exitCode === null && oldProc.pid != null) {
        try {
          await this._gracefulShutdown(oldProc)
        } catch {
          // 优雅关闭失败（进程无响应/RPC 超时）→ 兜底强制 kill
        }
      }
      try { oldProc.kill() } catch { /* already dead */ }
      oldProc.removeAllListeners()
      this.process = null
    }

    // 放弃旧 ready gate：_readyResolve=null 让 call() 跳过等待，直接走 "not running"。
    // _readyPromise 设为已 resolve（永远 pending 会让任何残留 await 挂起）。
    // 重启由 start() 重入时创建全新的 gate。
    this._readyResolve = null
    this._readyPromise = Promise.resolve()

    // 启动崩溃窗口判定：仅当进程在 STARTUP_CRASH_WINDOW_MS 内崩溃才计入
    // restartCount。长时间运行后的崩溃（如 OOM）是运行期故障，重置计数重新开始，
    // 避免一个本可正常服务的后端因偶发崩溃被永久判死为"重启超限"。
    const uptimeMs = Date.now() - this.processStartTime
    const isStartupCrash = uptimeMs < STARTUP_CRASH_WINDOW_MS
    if (!isStartupCrash) {
      this.restartCount = 0
    }

    if (!this.isShuttingDown && this.restartCount < MAX_RESTARTS) {
      this.restartCount++
      this.restartTimer = setTimeout(() => {
        this.start()
      }, BACKEND_RESTART_DELAY_MS)
    } else if (this.restartCount >= MAX_RESTARTS) {
      console.error(`Python bridge exceeded max restart attempts (${MAX_RESTARTS})`)
      // 致命：重启已超限，后端无法恢复
      this.onFatal?.({
        message: `后端服务异常（已重试 ${MAX_RESTARTS} 次仍失败）`,
        detail: `Python backend exceeded max restart attempts (${MAX_RESTARTS})`,
        kind: 'backend-restart-exceeded',
      })
    }
  }

  /**
   * 对仍存活的旧进程发送 shutdown RPC，让后端刷盘（断点续传文件、下载状态），
   * 随后等待最多 GRACEFUL_SHUTDOWN_TIMEOUT_MS 返回，超时后交由调用方强制 kill。
   *
   * 注意：Python `handle_shutdown` 仅取消任务/停队列/关 executor，**主循环不退出**，
   * 因此本方法几乎总是靠超时兜底——这里 onExit 分支是防御性的，目标不是真等到进程
   * 退出，而是给后端一个刷盘窗口再让调用方 kill 收尾。
   *
   * 直接走 proc.stdin 写入而非 this.call()，避免 this.process 已被替换导致的状态错乱。
   */
  private _gracefulShutdown(proc: ChildProcess): Promise<void> {
    return new Promise((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        proc.removeListener('exit', onExit)
        resolve()
      }
      const onExit = () => finish()
      proc.on('exit', onExit)

      const id = crypto.randomUUID()
      const request = { jsonrpc: '2.0', id, method: 'shutdown', params: {} }
      try {
        proc.stdin!.write(JSON.stringify(request) + '\n')
      } catch {
        finish()
        return
      }
      // 超时兜底：后端未在窗口内退出则交由调用方 kill()
      setTimeout(finish, GRACEFUL_SHUTDOWN_TIMEOUT_MS)
    })
  }

  onNotification(method: string, params: unknown) {
    const handler = this.notificationHandlers.get(method)
    if (handler) {
      handler(params)
    }
  }

  setNotificationHandler(method: string, handler: (params: unknown) => void) {
    this.notificationHandlers.set(method, handler)
  }

  async call(method: string, params: Record<string, unknown> = {}, timeoutMs?: number): Promise<unknown> {
    // 三种路径：
    // 1. 进程就绪且 stdin 可写 → 直接使用（热路径）。
    // 2. 进程尚未启动（this.process === null 且 ready gate 尚未 resolve）→ 等 ready。
    // 3. 进程对象存在但 stdin 不可写 → 立即抛错（进程在但坏了，等再久也没用）。
    let proc = this.process
    if (!proc) {
      // ready gate 尚未 resolve（_readyResolve 仍非空）说明进程还在启动中，等待 ready。
      // gate 已被 reject（进程 exit/kill）→ waitForReady 抛错，转成标准 "not running"。
      if (this._readyResolve !== null) {
        await this.waitForReady()
      }
      proc = this.process
    }
    if (!proc) {
      throw new Error('Python process not running')
    }
    if (!proc.stdin?.writable) {
      throw new Error('Python process stdin not writable')
    }

    // Guard: reject if process was replaced between the snapshot and here
    if (this.process !== proc) {
      throw new Error('Python process was replaced during call')
    }

    const id = crypto.randomUUID()
    const request = { jsonrpc: '2.0', id, method, params }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id)
          reject(new Error('Request timeout'))
        }
      }, timeoutMs ?? REQUEST_TIMEOUT_MS)

      this.pendingRequests.set(id, { resolve, reject, timer })
      try {
        proc.stdin!.write(JSON.stringify(request) + '\n')
      } catch (_err) {
        clearTimeout(timer)
        this.pendingRequests.delete(id)
        reject(new Error('Failed to write to Python process stdin'))
      }
    })
  }

  kill() {
    this.isShuttingDown = true
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    // 清理 pending 请求：调用方的 Promise 必须被 reject，否则会永久悬挂。
    // _clearPendingRequests 同时清空 buffer，与 _processLine 溢出路径对称。
    this._clearPendingRequests('Python bridge killed')
    if (this.process) {
      this.process.kill()
      this.process = null
    }
    // 放弃 ready gate：_readyResolve=null 让 call() 跳过等待，直接走 "not running"。
    // _readyPromise 设为已 resolve（永远 pending 会让任何残留 await 挂起）。
    this._readyResolve = null
    this._readyPromise = Promise.resolve()
  }

  async shutdown(): Promise<void> {
    if (!this.process) return
    try {
      await this.call('shutdown', {})
    } catch {
      // Shutdown RPC may fail if process is already dead
    }
    this.kill()
  }
}

let bridge: PythonBridge | null = null

export function getPythonBridge(): PythonBridge {
  if (!bridge) {
    bridge = new PythonBridge()
  }
  return bridge
}

/**
 * 解析 Python stderr 的启动进度行。
 *
 * 格式：`PROGRESS:<percent>:<label>`，percent 为 0-100 整数，label 为不含冒号的中文文案。
 * 解析成功返回 { percent, label }；格式不匹配（无前缀/percent 非整数/缺 label）返回 null，
 * 调用方据此降级为普通日志转发，不抛错中断启动。
 */
const PROGRESS_LINE_RE = /^PROGRESS:(\d+):(.+)$/

export function parseStartupProgressLine(line: string): StartupProgressEvent | null {
  const match = PROGRESS_LINE_RE.exec(line)
  if (!match) return null
  const percent = Number.parseInt(match[1], 10)
  const label = match[2]
  // percent 范围校验：0-100 整数（正则已保证是数字，这里防溢出）
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) return null
  // label 非空（正则 (.+) 已保证至少一个字符，双重防御）
  if (!label) return null
  return { percent, label }
}
