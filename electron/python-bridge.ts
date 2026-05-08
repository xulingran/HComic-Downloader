import { spawn, ChildProcess } from 'child_process'
import path from 'path'
import crypto from 'crypto'
import { app } from 'electron'

const REQUEST_TIMEOUT_MS = 30_000
const MAX_BUFFER_SIZE = 1024 * 1024
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
  private notificationHandlers = new Map<string, (params: any) => void>()

  constructor() {
    this.start()
  }

  private getPythonPath(): string {
    const isDev = !app.isPackaged
    const isWin = process.platform === 'win32'
    if (isDev) {
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

  private start() {
    const pythonPath = this.getPythonPath()
    const scriptPath = this.getScriptPath()
    const args = scriptPath ? [scriptPath] : []

    this.process = spawn(pythonPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const proc = this.process

    proc.stdout?.on('data', (data: Buffer) => {
      if (this.process !== proc) return
      this.buffer += data.toString()
      if (this.buffer.length > MAX_BUFFER_SIZE) {
        console.error('IPC buffer overflow, discarding')
        this.buffer = ''
        for (const [, pending] of this.pendingRequests) {
          clearTimeout(pending.timer)
          pending.reject(new Error('IPC response too large'))
        }
        this.pendingRequests.clear()
        this.handleProcessFailure('IPC buffer overflow')
        return
      }
      const lines = this.buffer.split('\n')
      this.buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.trim()) {
          try {
            const response = JSON.parse(line)
            if (response.id) {
              const pending = this.pendingRequests.get(response.id)
              if (pending) {
                clearTimeout(pending.timer)
                this.pendingRequests.delete(response.id)
                if (response.error) {
                  pending.reject(new Error(response.error.message))
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
        }
      }
    })

    proc.stderr?.on('data', (data: Buffer) => {
      if (this.process !== proc) return
      console.error('Python stderr:', data.toString())
    })

    proc.on('exit', (code) => {
      if (this.process !== proc) return
      this.handleProcessFailure(`Python process exited with code ${code}`)
    })

    proc.on('error', (err) => {
      if (this.process !== proc) return
      console.error('Failed to start Python process:', err)
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
    }
  }

  onNotification(method: string, params: any) {
    const handler = this.notificationHandlers.get(method)
    if (handler) {
      handler(params)
    }
  }

  setNotificationHandler(method: string, handler: (params: any) => void) {
    this.notificationHandlers.set(method, handler)
  }

  async call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const proc = this.process
    if (!proc) {
      throw new Error('Python process not running')
    }

    if (!proc.stdin?.writable) {
      throw new Error('Python process stdin not writable')
    }

    const id = crypto.randomUUID()
    const request = { jsonrpc: '2.0', id, method, params }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id)
          reject(new Error('Request timeout'))
        }
      }, REQUEST_TIMEOUT_MS)

      this.pendingRequests.set(id, { resolve, reject, timer })
      proc.stdin?.write(JSON.stringify(request) + '\n')
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
}

let bridge: PythonBridge | null = null

export function getPythonBridge(): PythonBridge {
  if (!bridge) {
    bridge = new PythonBridge()
  }
  return bridge
}
