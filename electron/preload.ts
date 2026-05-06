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

contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    invoke: (channel: string, ...args: any[]) => {
      if (!ALLOWED_INVOKE_CHANNELS.has(channel)) {
        throw new Error(`Invalid IPC channel: ${channel}`)
      }
      return ipcRenderer.invoke(channel, ...args)
    }
  }
})
