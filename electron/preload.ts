import { contextBridge, ipcRenderer } from 'electron'

const ALLOWED_INVOKE_CHANNELS = new Set([
  'python:search',
  'python:download',
  'python:get-favourites',
  'python:get-config',
  'python:set-config',
  'python:get-downloads',
  'python:cancel-download',
  'python:get-statistics',
  'python:apply-auth',
  'python:verify-auth'
])

const ALLOWED_ON_CHANNELS = new Set<string>()

contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    invoke: (channel: string, ...args: any[]) => {
      if (!ALLOWED_INVOKE_CHANNELS.has(channel)) {
        throw new Error(`Invalid IPC channel: ${channel}`)
      }
      return ipcRenderer.invoke(channel, ...args)
    },
    on: (channel: string, callback: (...args: any[]) => void) => {
      if (!ALLOWED_ON_CHANNELS.has(channel)) {
        throw new Error(`Invalid IPC channel: ${channel}`)
      }
      const listener = (_: any, ...args: any[]) => callback(...args)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    }
  }
})
