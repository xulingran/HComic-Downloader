import { contextBridge, ipcRenderer } from 'electron'

// Debug: Log when preload script loads
console.log('[Preload] Script starting...')

try {
  contextBridge.exposeInMainWorld('electron', {
    ipcRenderer: {
      invoke: (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args),
      on: (channel: string, callback: (...args: any[]) => void) => {
        ipcRenderer.on(channel, (_, ...args) => callback(...args))
        return () => ipcRenderer.removeAllListeners(channel)
      }
    }
  })
  console.log('[Preload] Electron API exposed successfully')
} catch (error) {
  console.error('[Preload] Failed to expose Electron API:', error)
}
