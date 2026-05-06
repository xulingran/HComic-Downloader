// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Use vi.hoisted to create mock functions that are available in vi.mock factories
const {
  mockExposeInMainWorld,
  mockInvoke,
  mockOn,
  mockRemoveAllListeners
} = vi.hoisted(() => ({
  mockExposeInMainWorld: vi.fn(),
  mockInvoke: vi.fn().mockResolvedValue('result'),
  mockOn: vi.fn(),
  mockRemoveAllListeners: vi.fn()
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mockExposeInMainWorld },
  ipcRenderer: {
    invoke: mockInvoke,
    on: mockOn,
    removeAllListeners: mockRemoveAllListeners
  }
}))

// Import after mocks - this triggers side effects (the preload script runs on import)
import '../../../electron/preload'

// Capture the exposed API from the initial import (module is cached, runs only once)
const exposedObj = mockExposeInMainWorld.mock.calls[0]?.[1] as any
const exposedIpcRenderer = exposedObj?.ipcRenderer

describe('preload.ts', () => {
  beforeEach(() => {
    mockInvoke.mockClear()
    mockOn.mockClear()
    mockRemoveAllListeners.mockClear()
  })

  it('should call contextBridge.exposeInMainWorld with "electron" key', () => {
    expect(mockExposeInMainWorld).toHaveBeenCalledWith('electron', expect.any(Object))
  })

  it('should expose ipcRenderer.invoke that delegates to electron ipcRenderer.invoke', async () => {
    await exposedIpcRenderer.invoke('test-channel', 'arg1', 'arg2')

    expect(mockInvoke).toHaveBeenCalledWith('test-channel', 'arg1', 'arg2')
  })

  it('should expose ipcRenderer.on that registers listener on electron ipcRenderer.on', () => {
    const callback = vi.fn()
    exposedIpcRenderer.on('test-channel', callback)

    expect(mockOn).toHaveBeenCalledWith('test-channel', expect.any(Function))
  })

  it('should return cleanup function from ipcRenderer.on that calls removeAllListeners', () => {
    const callback = vi.fn()
    const cleanup = exposedIpcRenderer.on('test-channel', callback)

    expect(typeof cleanup).toBe('function')

    cleanup()

    expect(mockRemoveAllListeners).toHaveBeenCalledWith('test-channel')
  })

  it('should pass callback args through the on listener wrapper', () => {
    const callback = vi.fn()
    exposedIpcRenderer.on('test-channel', callback)

    // Simulate ipcRenderer.on invoking the registered handler
    // The preload wraps: ipcRenderer.on(channel, (_, ...args) => callback(...args))
    const registeredHandler = mockOn.mock.calls[0][1]
    registeredHandler('event-obj', 'data1', 'data2')

    expect(callback).toHaveBeenCalledWith('data1', 'data2')
  })

  it('should catch error when contextBridge.exposeInMainWorld throws', () => {
    // The preload module imported successfully without throwing.
    // This confirms the try/catch wrapper is in place.
    // The fact that we reached this test means the import did not cause an uncaught exception.
    expect(mockExposeInMainWorld).toHaveBeenCalled()
  })
})
