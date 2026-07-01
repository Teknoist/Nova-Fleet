import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type {
  ActionResult, NovaFleetApi, PrinterConfig, PrinterSnapshot, SavePrinterInput, UploadProgress,
} from '../shared/types'

interface NovaFleetNativePlugin {
  requestLocalNetworkPermission(): Promise<{ granted: boolean }>
  listPrinters(): Promise<{ printers: PrinterConfig[] }>
  savePrinter(input: SavePrinterInput): Promise<{ printer: PrinterConfig }>
  removePrinter(input: { id: string }): Promise<ActionResult>
  refreshPrinter(input: { id: string }): Promise<{ snapshot: PrinterSnapshot }>
  refreshAll(): Promise<{ snapshots: PrinterSnapshot[] }>
  chooseAndUpload(input: { id: string }): Promise<ActionResult>
  deleteFile(input: { id: string; fileName: string }): Promise<ActionResult>
  printFile(input: { id: string; fileName: string }): Promise<ActionResult>
  controlJob(input: { id: string; jobId: string; action: 'toggle' | 'stop' }): Promise<ActionResult>
  addListener(eventName: 'uploadProgress', listener: (progress: UploadProgress) => void): Promise<PluginListenerHandle>
}

const native = registerPlugin<NovaFleetNativePlugin>('NovaFleet')
let permissionRequest: Promise<void> | undefined

async function ensureLocalNetworkPermission() {
  permissionRequest ??= native.requestLocalNetworkPermission().then(({ granted }) => {
    if (!granted) throw new Error('Yerel ağ izni verilmedi. Yazıcılara bağlanmak için Yakındaki cihazlar iznini açın.')
  })
  return permissionRequest
}

async function network<T>(operation: () => Promise<T>): Promise<T> {
  await ensureLocalNetworkPermission()
  return operation()
}

export const androidApi: NovaFleetApi = {
  listPrinters: async () => (await native.listPrinters()).printers,
  savePrinter: async (input) => (await native.savePrinter(input)).printer,
  removePrinter: (id) => native.removePrinter({ id }),
  refreshPrinter: (id) => network(async () => (await native.refreshPrinter({ id })).snapshot),
  refreshAll: () => network(async () => (await native.refreshAll()).snapshots),
  chooseAndUpload: (id) => network(() => native.chooseAndUpload({ id })),
  deleteFile: (id, fileName) => network(() => native.deleteFile({ id, fileName })),
  printFile: (id, fileName) => network(() => native.printFile({ id, fileName })),
  controlJob: (id, jobId, action) => network(() => native.controlJob({ id, jobId, action })),
  onUploadProgress: (callback) => {
    let active = true
    let handle: PluginListenerHandle | undefined
    void native.addListener('uploadProgress', callback).then((listener) => {
      if (active) handle = listener
      else void listener.remove()
    })
    return () => { active = false; if (handle) void handle.remove() }
  },
}
