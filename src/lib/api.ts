import { Capacitor } from '@capacitor/core'
import type { ActionResult, NovaFleetApi, PrinterConfig, PrinterSnapshot, SavePrinterInput } from '../shared/types'
import { androidApi } from './android-api'

const configs: PrinterConfig[] = [
  { id: 'preview-1', name: 'Reçine Lab 01', host: '192.168.1.84', port: 8081, model: 'Nova3D Elfin', location: 'Prototip Atölyesi', pollInterval: 10, enabled: true },
  { id: 'preview-2', name: 'Reçine Lab 02', host: '192.168.1.91', port: 8081, model: 'Nova3D Bene4', location: 'Prototip Atölyesi', pollInterval: 12, enabled: true },
  { id: 'preview-3', name: 'Tasarım Stüdyosu', host: '192.168.1.103', port: 8081, model: 'Nova3D Whale3', location: '2. Kat', pollInterval: 15, enabled: true },
]

const files = [
  { name: 'gearbox_v12', extension: 'cws', size: 48_890_112, modifiedDate: '2026-06-30T09:42:00', fullName: 'gearbox_v12.cws' },
  { name: 'enclosure-final', extension: 'cws', size: 72_241_152, modifiedDate: '2026-06-29T16:18:00', fullName: 'enclosure-final.cws' },
  { name: 'calibration-matrix', extension: 'cws', size: 12_713_984, modifiedDate: '2026-06-26T11:05:00', fullName: 'calibration-matrix.cws' },
]

function snapshots(): PrinterSnapshot[] {
  const progress = 57.8
  return [
    { config: configs[0], state: 'printing', latency: 24, firmware: '3.5.0', files, usedBytes: files.reduce((a, b) => a + b.size, 0), lastSeen: new Date().toISOString(), activeJob: { id: 'job-1', jobName: 'gearbox_v12.cws', printInProgress: true, printPaused: false, status: 'printing', thickness: .05, totalSlices: 1842, currentSlice: 1065, currentSliceTime: 14000, averageSliceTime: 14200, elapsedTime: 3_112_000, progress } },
    { config: configs[1], state: 'online', latency: 18, firmware: '3.5.0', files: files.slice(1), usedBytes: 84_955_136, lastSeen: new Date().toISOString() },
    { config: configs[2], state: 'offline', files: [], usedBytes: 0, error: 'Yazıcı ağda yanıt vermiyor.' },
  ]
}

const ok = (message: string): Promise<ActionResult> => Promise.resolve({ ok: true, message })

const previewApi: NovaFleetApi = {
  listPrinters: async () => configs,
  savePrinter: async (input: SavePrinterInput) => {
    const value = { ...input, id: input.id ?? `preview-${Date.now()}` } as PrinterConfig
    const index = configs.findIndex((item) => item.id === value.id)
    if (index >= 0) configs[index] = value; else configs.push(value)
    return value
  },
  removePrinter: async (id) => { const index = configs.findIndex((item) => item.id === id); if (index >= 0) configs.splice(index, 1); return { ok: true } },
  refreshPrinter: async (id) => snapshots().find((item) => item.config.id === id) ?? { config: configs.find((item) => item.id === id)!, state: 'online', files: [], usedBytes: 0 },
  refreshAll: async () => snapshots(),
  chooseAndUpload: () => ok('Önizleme modunda örnek yükleme tamamlandı.'),
  deleteFile: () => ok('Dosya silindi.'),
  printFile: () => ok('Yazdırma işi başlatıldı.'),
  controlJob: () => ok('Yazdırma durumu değiştirildi.'),
  onUploadProgress: () => () => undefined,
}

export const api: NovaFleetApi = window.novaFleet ?? (Capacitor.getPlatform() === 'android' ? androidApi : previewApi)
