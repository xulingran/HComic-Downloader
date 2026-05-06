// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Use vi.hoisted to create mock functions accessible in hoisted vi.mock factories
const { mockSpawn } = vi.hoisted(() => ({
  mockSpawn: vi.fn()
}))

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal() as any
  return {
    ...actual,
    spawn: mockSpawn
  }
})

// Mock electron
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/mock/path'),
    getAppPath: vi.fn().mockReturnValue('/mock/project'),
    isPackaged: false
  }
}))

// Must import after mocks are set up
import { PythonBridge, getPythonBridge } from '../../../electron/python-bridge'

describe('PythonBridge', () => {
  let mockProcess: any
  let stdoutCallbacks: Function[]
  let stderrCallbacks: Function[]
  let exitCallbacks: Function[]
  let errorCallbacks: Function[]
  let stdinWriteData: string[]

  beforeEach(() => {
    mockSpawn.mockClear()
    stdoutCallbacks = []
    stderrCallbacks = []
    exitCallbacks = []
    errorCallbacks = []
    stdinWriteData = []

    mockProcess = {
      stdin: {
        write: vi.fn((data: string) => {
          stdinWriteData.push(data)
        })
      },
      stdout: {
        on: vi.fn((event: string, cb: Function) => {
          if (event === 'data') stdoutCallbacks.push(cb)
        })
      },
      stderr: {
        on: vi.fn((event: string, cb: Function) => {
          if (event === 'data') stderrCallbacks.push(cb)
        })
      },
      on: vi.fn((event: string, cb: Function) => {
        if (event === 'exit') exitCallbacks.push(cb)
        if (event === 'error') errorCallbacks.push(cb)
      }),
      kill: vi.fn()
    }

    mockSpawn.mockReturnValue(mockProcess)
  })

  describe('constructor and spawn', () => {
    it('should spawn python process with correct path in dev mode', () => {
      new PythonBridge()

      expect(mockSpawn).toHaveBeenCalledTimes(1)
      expect(mockSpawn).toHaveBeenCalledWith('python', [expect.stringContaining('ipc_server.py')], {
        stdio: ['pipe', 'pipe', 'pipe']
      })
    })

    it('should set up stdout, stderr, exit and error listeners', () => {
      new PythonBridge()

      expect(mockProcess.stdout.on).toHaveBeenCalledWith('data', expect.any(Function))
      expect(mockProcess.stderr.on).toHaveBeenCalledWith('data', expect.any(Function))
      expect(mockProcess.on).toHaveBeenCalledWith('exit', expect.any(Function))
      expect(mockProcess.on).toHaveBeenCalledWith('error', expect.any(Function))
    })
  })

  describe('call()', () => {
    let bridge: PythonBridge

    beforeEach(() => {
      bridge = new PythonBridge()
    })

    it('should send JSON-RPC formatted request via stdin', async () => {
      const callPromise = bridge.call('search', { query: 'test', mode: 'title', page: 1 })

      // Capture what was written to stdin
      expect(stdinWriteData.length).toBe(1)
      const written = JSON.parse(stdinWriteData[0].trim())
      expect(written).toMatchObject({
        jsonrpc: '2.0',
        method: 'search',
        params: { query: 'test', mode: 'title', page: 1 }
      })
      expect(written.id).toBeDefined()
      expect(typeof written.id).toBe('string')

      // Simulate response to resolve the promise (prevent unhandled rejection)
      const response = { jsonrpc: '2.0', id: written.id, result: { data: 'ok' } }
      stdoutCallbacks.forEach(cb => cb(Buffer.from(JSON.stringify(response) + '\n')))

      await callPromise
    })

    it('should resolve when stdout returns matching response', async () => {
      const callPromise = bridge.call('get_config')
      const written = JSON.parse(stdinWriteData[0].trim())
      const requestId = written.id

      // Simulate response
      const response = { jsonrpc: '2.0', id: requestId, result: { theme: 'dark' } }
      stdoutCallbacks.forEach(cb => cb(Buffer.from(JSON.stringify(response) + '\n')))

      const result = await callPromise
      expect(result).toEqual({ theme: 'dark' })
    })

    it('should reject on error response', async () => {
      const callPromise = bridge.call('search', { query: 'test' })
      const written = JSON.parse(stdinWriteData[0].trim())
      const requestId = written.id

      // Simulate error response
      const response = { jsonrpc: '2.0', id: requestId, error: { message: 'Search failed' } }
      stdoutCallbacks.forEach(cb => cb(Buffer.from(JSON.stringify(response) + '\n')))

      await expect(callPromise).rejects.toThrow('Search failed')
    })

    it('should reject pending requests when process exits', async () => {
      const callPromise = bridge.call('search', { query: 'test' })

      // Simulate process exit while request is pending
      exitCallbacks.forEach(cb => cb(1))

      await expect(callPromise).rejects.toThrow('Python process exited with code 1')
    })

    it('should reject with "Python process not running" when calling after process exits', async () => {
      // Simulate process exit
      exitCallbacks.forEach(cb => cb(0))

      await expect(bridge.call('search')).rejects.toThrow('Python process not running')
    })

    it('should reject when process was killed before call', async () => {
      bridge.kill()

      await expect(bridge.call('search')).rejects.toThrow('Python process not running')
    })

    it('should time out after 30 seconds', async () => {
      vi.useFakeTimers()

      const callPromise = bridge.call('search', { query: 'test' })

      // Advance time by 30 seconds
      vi.advanceTimersByTime(30000)

      await expect(callPromise).rejects.toThrow('Request timeout')

      vi.useRealTimers()
    })

    it('should not resolve with stale response after timeout', async () => {
      vi.useFakeTimers()

      const callPromise = bridge.call('search', { query: 'test' })
      const written = JSON.parse(stdinWriteData[0].trim())
      const requestId = written.id

      // Trigger timeout
      vi.advanceTimersByTime(30000)

      // Late response arrives after timeout - should be ignored
      const response = { jsonrpc: '2.0', id: requestId, result: { data: 'late' } }
      stdoutCallbacks.forEach(cb => cb(Buffer.from(JSON.stringify(response) + '\n')))

      await expect(callPromise).rejects.toThrow('Request timeout')

      vi.useRealTimers()
    })

    it('should handle multiple concurrent calls independently', async () => {
      const call1 = bridge.call('search', { query: 'test1' })
      const call2 = bridge.call('search', { query: 'test2' })

      const written1 = JSON.parse(stdinWriteData[0].trim())
      const written2 = JSON.parse(stdinWriteData[1].trim())

      // Respond to second call first (out of order)
      const response2 = { jsonrpc: '2.0', id: written2.id, result: { query: 'test2' } }
      stdoutCallbacks.forEach(cb => cb(Buffer.from(JSON.stringify(response2) + '\n')))

      const result2 = await call2
      expect(result2).toEqual({ query: 'test2' })

      // Then respond to first call
      const response1 = { jsonrpc: '2.0', id: written1.id, result: { query: 'test1' } }
      stdoutCallbacks.forEach(cb => cb(Buffer.from(JSON.stringify(response1) + '\n')))

      const result1 = await call1
      expect(result1).toEqual({ query: 'test1' })
    })

    it('should handle partial data received across multiple stdout events', async () => {
      const callPromise = bridge.call('get_config')
      const written = JSON.parse(stdinWriteData[0].trim())
      const requestId = written.id

      const response = { jsonrpc: '2.0', id: requestId, result: { ok: true } }
      const responseStr = JSON.stringify(response) + '\n'

      // Send first half
      const half = Math.floor(responseStr.length / 2)
      stdoutCallbacks.forEach(cb => cb(Buffer.from(responseStr.slice(0, half))))
      // Send second half
      stdoutCallbacks.forEach(cb => cb(Buffer.from(responseStr.slice(half))))

      const result = await callPromise
      expect(result).toEqual({ ok: true })
    })

    it('should ignore responses for unknown request IDs', async () => {
      const callPromise = bridge.call('get_config')
      const written = JSON.parse(stdinWriteData[0].trim())

      // Send response for a different, unknown ID
      const unknownResponse = { jsonrpc: '2.0', id: 'unknown-id', result: 'ignore' }
      stdoutCallbacks.forEach(cb => cb(Buffer.from(JSON.stringify(unknownResponse) + '\n')))

      // Now send the correct response
      const correctResponse = { jsonrpc: '2.0', id: written.id, result: { config: 'value' } }
      stdoutCallbacks.forEach(cb => cb(Buffer.from(JSON.stringify(correctResponse) + '\n')))

      const result = await callPromise
      expect(result).toEqual({ config: 'value' })
    })
  })

  describe('kill()', () => {
    it('should terminate the process', () => {
      const bridge = new PythonBridge()

      expect(mockSpawn).toHaveBeenCalledTimes(1)
      bridge.kill()

      expect(mockProcess.kill).toHaveBeenCalledTimes(1)
    })

    it('should not throw if called when no process exists', () => {
      const bridge = new PythonBridge()
      // Simulate exit
      exitCallbacks.forEach(cb => cb(0))

      // kill should not throw
      expect(() => bridge.kill()).not.toThrow()
    })

    it('should prevent further calls after kill', async () => {
      const bridge = new PythonBridge()
      bridge.kill()

      await expect(bridge.call('search')).rejects.toThrow('Python process not running')
    })

    it('should not auto-restart after explicit kill', () => {
      vi.useFakeTimers()
      const bridge = new PythonBridge()
      expect(mockSpawn).toHaveBeenCalledTimes(1)

      bridge.kill()
      vi.advanceTimersByTime(3000)

      // Should NOT have respawned
      expect(mockSpawn).toHaveBeenCalledTimes(1)
      vi.useRealTimers()
    })
  })

  describe('auto-restart', () => {
    it('should attempt restart after unexpected process exit', () => {
      vi.useFakeTimers()
      new PythonBridge()
      expect(mockSpawn).toHaveBeenCalledTimes(1)

      // Simulate unexpected exit
      exitCallbacks.forEach(cb => cb(1))
      vi.advanceTimersByTime(2000)

      expect(mockSpawn).toHaveBeenCalledTimes(2)
      vi.useRealTimers()
    })
  })

  describe('buffer overflow protection', () => {
    it('should discard buffer when it exceeds max size and remain functional', async () => {
      const bridge = new PythonBridge()

      // Send >1MB of garbage without newline
      const bigData = Buffer.from('x'.repeat(1024 * 1024 + 1))
      stdoutCallbacks.forEach(cb => cb(bigData))

      // Now send a valid request and response - should still work
      const callPromise = bridge.call('get_config')
      const written = JSON.parse(stdinWriteData[stdinWriteData.length - 1].trim())
      const response = { jsonrpc: '2.0', id: written.id, result: { ok: true } }
      stdoutCallbacks.forEach(cb => cb(Buffer.from(JSON.stringify(response) + '\n')))

      const result = await callPromise
      expect(result).toEqual({ ok: true })
    })
  })

  describe('getPythonBridge()', () => {
    it('should return a PythonBridge instance', () => {
      const bridge = getPythonBridge()
      expect(bridge).toBeInstanceOf(PythonBridge)
    })
  })
})
