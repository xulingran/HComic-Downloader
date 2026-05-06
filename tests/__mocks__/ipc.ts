import { vi } from 'vitest'

export function createMockIpcInvoke(responses: Record<string, any> = {}) {
  return vi.fn().mockImplementation((channel: string, ...args: any[]) => {
    if (responses[channel] !== undefined) {
      if (typeof responses[channel] === 'function') {
        return Promise.resolve(responses[channel](...args))
      }
      return Promise.resolve(responses[channel])
    }
    return Promise.resolve(undefined)
  })
}

export function mockWindowElectron(invoke?: ReturnType<typeof createMockIpcInvoke>) {
  const mockInvoke = invoke || createMockIpcInvoke()

  Object.defineProperty(window, 'electron', {
    value: {
      ipcRenderer: {
        invoke: mockInvoke,
        on: vi.fn().mockReturnValue(vi.fn())
      }
    },
    writable: true,
    configurable: true
  })

  return { mockInvoke }
}
