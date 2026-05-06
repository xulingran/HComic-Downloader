// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Use vi.hoisted to create mock functions that are available in vi.mock factories
const {
  mockExposeInMainWorld,
  mockInvoke
} = vi.hoisted(() => ({
  mockExposeInMainWorld: vi.fn(),
  mockInvoke: vi.fn().mockResolvedValue('result')
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mockExposeInMainWorld },
  ipcRenderer: {
    invoke: mockInvoke
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
  })

  it('should call contextBridge.exposeInMainWorld with "electron" key', () => {
    expect(mockExposeInMainWorld).toHaveBeenCalledWith('electron', expect.any(Object))
  })

  it('should expose ipcRenderer.invoke that delegates to electron ipcRenderer.invoke', async () => {
    await exposedIpcRenderer.invoke('python:search', 'arg1', 'arg2')

    expect(mockInvoke).toHaveBeenCalledWith('python:search', 'arg1', 'arg2')
  })

  it('should throw on invalid invoke channel', () => {
    expect(() => exposedIpcRenderer.invoke('evil:channel', 'arg')).toThrow(
      'Invalid IPC channel: evil:channel'
    )
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('should only expose invoke method on ipcRenderer', () => {
    expect(typeof exposedIpcRenderer.invoke).toBe('function')
    expect(Object.keys(exposedIpcRenderer)).toEqual(['invoke'])
  })
})
