export type PrinterState = 'online' | 'offline' | 'printing' | 'paused' | 'error'
export type PrinterProtocol = 'nova' | 'sdcp3'

export interface PrinterConfig {
  id: string
  name: string
  host: string
  port: number
  protocol?: PrinterProtocol
  model: string
  location: string
  pollInterval: number
  enabled: boolean
}

export interface NovaFile {
  name: string
  extension: string
  size: number
  modifiedDate: string
  fullName: string
}

export interface PrintJob {
  id: string
  jobName: string
  printInProgress: boolean
  printPaused: boolean
  status: string
  thickness: number
  totalSlices: number
  currentSlice: number
  currentSliceTime: number
  averageSliceTime: number
  elapsedTime: number
  progress: number
  beginPrintTime?: number
  endPrintTime?: number
  layerTime?: number
  bottomLayersTime?: number
  numberOfBottomLayers?: number
  resinUsage?: number
  totalCost?: number
  totalExposureTime?: number
  zliftDistance?: number
  zliftSpeed?: number
  errorDescription?: string
}

export interface PrinterSnapshot {
  config: PrinterConfig
  state: PrinterState
  latency?: number
  firmware?: string
  printerInfo?: string
  files: NovaFile[]
  usedBytes: number
  activeJob?: PrintJob
  recentJobs?: PrintJob[]
  lastSeen?: string
  error?: string
}

export interface SavePrinterInput extends Omit<PrinterConfig, 'id'> { id?: string }

export interface ActionResult { ok: boolean; message?: string }

export interface UploadProgress { printerId: string; fileName: string; percent: number }

export interface NovaFleetApi {
  listPrinters: () => Promise<PrinterConfig[]>
  savePrinter: (input: SavePrinterInput) => Promise<PrinterConfig>
  removePrinter: (id: string) => Promise<ActionResult>
  refreshPrinter: (id: string) => Promise<PrinterSnapshot>
  refreshAll: () => Promise<PrinterSnapshot[]>
  chooseAndUpload: (id: string) => Promise<ActionResult>
  deleteFile: (id: string, fileName: string) => Promise<ActionResult>
  printFile: (id: string, fileName: string) => Promise<ActionResult>
  controlJob: (id: string, jobId: string, action: 'toggle' | 'stop') => Promise<ActionResult>
  onUploadProgress: (callback: (progress: UploadProgress) => void) => () => void
}
