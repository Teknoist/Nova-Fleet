import { contextBridge, ipcRenderer } from 'electron'
import type { NovaFleetApi, SavePrinterInput, UploadProgress } from '../src/shared/types.js'

const api: NovaFleetApi = {
  listPrinters: () => ipcRenderer.invoke('printers:list'),
  savePrinter: (input: SavePrinterInput) => ipcRenderer.invoke('printers:save', input),
  removePrinter: (id: string) => ipcRenderer.invoke('printers:remove', id),
  refreshPrinter: (id: string) => ipcRenderer.invoke('printers:refresh', id),
  refreshAll: () => ipcRenderer.invoke('printers:refresh-all'),
  chooseAndUpload: (id: string) => ipcRenderer.invoke('files:choose-upload', id),
  deleteFile: (id: string, fileName: string) => ipcRenderer.invoke('files:delete', id, fileName),
  printFile: (id: string, fileName: string) => ipcRenderer.invoke('files:print', id, fileName),
  controlJob: (id: string, jobId: string, action: 'toggle' | 'stop') => ipcRenderer.invoke('jobs:control', id, jobId, action),
  onUploadProgress: (callback: (progress: UploadProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: UploadProgress) => callback(progress)
    ipcRenderer.on('upload:progress', listener)
    return () => ipcRenderer.removeListener('upload:progress', listener)
  },
}

contextBridge.exposeInMainWorld('novaFleet', api)
