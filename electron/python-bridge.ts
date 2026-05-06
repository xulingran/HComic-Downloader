import { spawn, ChildProcess } from 'child_process'
import path from 'path'
import crypto from 'crypto'
import { app } from 'electron'

const REQUEST_TIMEOUT_MS = 30_000

interface PendingRequest {
  resolve: (value: any) => void
  reject: (reason: any) => void
  timer: NodeJS.Timeout
}

export class PythonBridge {
  private process: ChildProcess | null = null
  private pendingRequests = new Map<string, PendingRequest>()
  private buffer = ''

  constructor() {
    this.start()
  }

  private getPythonPath(): string {
    const isDev = !app.isPackaged
    const isWin = process.platform === 'win32'
    if (isDev) {
      return isWin ? 'python' : 'python3'
    }
    const exeName = isWin ? 'python.exe' : 'python3'
    return path.join(process.resourcesPath, 'python', exeName)
  }

  private getScriptPath(): string {
    const isDev = !app.isPackaged
    if (isDev) {
      return path.join(app.getAppPath(), 'python', 'ipc_server.py')
    }
    return path.join(process.resourcesPath, 'python', 'ipc_server.py')
  }

  private start() {
    const pythonPath = this.getPythonPath()
    const scriptPath = this.getScriptPath()

    this.process = spawn(pythonPath, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    })

    this.process.stdout?.on('data', (data: Buffer) => {
      this.buffer += data.toString()
      const lines = this.buffer.split('\n')
      this.buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.trim()) {
          try {
            const response = JSON.parse(line)
            const pending = this.pendingRequests.get(response.id)
            if (pending) {
              clearTimeout(pending.timer)
              this.pendingRequests.delete(response.id)
              if (response.error) {
                pending.reject(new Error(response.error.message))
              } else {
                pending.resolve(response.result)
              }
            }
          } catch (e) {
            console.error('Failed to parse IPC response:', e)
          }
        }
      }
    })

    this.process.stderr?.on('data', (data: Buffer) => {
      console.error('Python stderr:', data.toString())
    })

    this.process.on('exit', (code) => {
      for (const [id, pending] of this.pendingRequests) {
        clearTimeout(pending.timer)
        pending.reject(new Error(`Python process exited with code ${code}`))
      }
      this.pendingRequests.clear()
      this.process = null
    })

    this.process.on('error', (err) => {
      console.error('Failed to start Python process:', err)
    })
  }

  async call(method: string, params: any = {}): Promise<any> {
    if (!this.process) {
      throw new Error('Python process not running')
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
      this.process!.stdin?.write(JSON.stringify(request) + '\n')
    })
  }

  kill() {
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
