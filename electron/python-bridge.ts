import { spawn, ChildProcess } from 'child_process'
import path from 'path'
import { app } from 'electron'

interface PendingRequest {
  resolve: (value: any) => void
  reject: (reason: any) => void
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
    if (isDev) {
      return 'python'
    }
    return path.join(process.resourcesPath, 'python', 'python.exe')
  }

  private getScriptPath(): string {
    const isDev = !app.isPackaged
    if (isDev) {
      // In dev mode, __dirname is out/main/, so we need to go up to project root
      return path.join(__dirname, '..', '..', 'python', 'ipc_server.py')
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
              if (response.error) {
                pending.reject(new Error(response.error.message))
              } else {
                pending.resolve(response.result)
              }
              this.pendingRequests.delete(response.id)
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
      console.log(`Python process exited with code ${code}`)
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

    const id = Math.random().toString(36).slice(2)
    const request = { jsonrpc: '2.0', id, method, params }

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject })
      this.process!.stdin?.write(JSON.stringify(request) + '\n')

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id)
          reject(new Error('Request timeout'))
        }
      }, 30000)
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
