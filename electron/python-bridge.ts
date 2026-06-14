import { spawn, ChildProcess } from 'child_process'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { app } from 'electron'

const REQUEST_TIMEOUT_MS = 30_000
// 20MB: cover image data URIs (base64) and large URL lists can exceed 1MB
const MAX_BUFFER_SIZE = 20 * 1024 * 1024
const MAX_RESTARTS = 5

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
  private notificationHandlers = new Map<string, (params: unknown) => void>()

  /**
   * 致命错误回调：后端进程启动失败或重启超限时触发。
   * 由主进程注册，转发到渲染进程的致命错误横幅。
   */
  onFatal: ((payload: { message: string; detail?: string; kind?: string }) => void) | null = null

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
      this.handleProcessFailure('IPC response too large')
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
    this.buffer += data.toString()

    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() || ''

    for (const line of lines) {
      if (!this._processLine(line)) return
    }

    if (this.buffer.length > MAX_BUFFER_SIZE) {
      console.error('IPC buffer overflow, discarding incomplete message')
      this._clearPendingRequests('IPC buffer overflow')
      this.handleProcessFailure('IPC buffer overflow')
    }
  }

  private start() {
    const pythonPath = this.getPythonPath()
    const scriptPath = this.getScriptPath()
    const args = scriptPath ? [scriptPath] : []

    this.process = spawn(pythonPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    })
    const proc = this.process

    proc.stdout?.on('data', (data: Buffer) => this.handleStdoutData(data, proc))

    proc.stderr?.on('data', (data: Buffer) => {
      if (this.process !== proc) return
      // Python stderr 含 INFO/WARNING/ERROR 各级别，本身已带级别字样。
      // 用 console.log 转发（落盘为 info 级），避免把 INFO 误标成 error。
      // 真正的级别由 Python 日志里的 " - ERROR - " 等字样体现。
      // 逐行转发：确保 main.log 里每一行都带 [Python] 前缀，
      // 便于诊断报告按前缀过滤掉与 python.log 重复的转发副本。
      const text = data.toString()
      for (const line of text.split('\n')) {
        const trimmed = line.trimEnd()
        if (trimmed) console.log('[Python]', trimmed)
      }
    })

    proc.on('exit', (code) => {
      if (this.process !== proc) return
      this.handleProcessFailure(`Python process exited with code ${code}`)
    })

    proc.on('error', (err) => {
      if (this.process !== proc) return
      console.error('Failed to start Python process:', err)
      // 进入 handleProcessFailure 的重启循环。致命横幅仅在 restartCount 达到 MAX_RESTARTS
      // 时统一由 handleProcessFailure 发出（backend-restart-exceeded），不在每次 error 时弹，
      // 避免重试期间横幅被反复刷新、最终又被 restart-exceeded 覆盖。
      this.handleProcessFailure(`Python process error: ${err.message}`)
    })
  }

  private handleProcessFailure(message: string) {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer)
      pending.reject(new Error(message))
    }
    this.pendingRequests.clear()

    if (this.process) {
      const oldProc = this.process
      oldProc.stdout?.removeAllListeners('data')
      oldProc.stderr?.removeAllListeners('data')
      try { oldProc.kill() } catch { /* already dead */ }
      oldProc.removeAllListeners()
      this.process = null
    }

    if (!this.isShuttingDown && this.restartCount < MAX_RESTARTS) {
      this.restartCount++
      this.restartTimer = setTimeout(() => {
        this.start()
      }, 2000)
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
    const proc = this.process
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
    if (this.process) {
      this.process.kill()
      this.process = null
    }
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
