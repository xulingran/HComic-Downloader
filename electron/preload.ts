import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNEL_MAP } from '../shared/types'

const ALLOWED_INVOKE_CHANNELS = new Set<string>(Object.keys(IPC_CHANNEL_MAP))

contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    invoke: (channel: string, ...args: any[]) => {
      if (!ALLOWED_INVOKE_CHANNELS.has(channel)) {
        throw new Error(`Invalid IPC channel: ${channel}`)
      }
      return ipcRenderer.invoke(channel, ...args)
    }
  },
  openUrl: (url: string) => ipcRenderer.invoke('open-external', url),
  onDownloadProgress: (callback: (data: any) => void) => {
    const handler = (_: any, data: any) => callback(data)
    ipcRenderer.on('download:progress', handler)
    return () => {
      ipcRenderer.removeListener('download:progress', handler)
    }
  }
})
