import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { basename } from 'node:path'
import type { NovaFile, PrintJob, PrinterConfig, PrinterSnapshot } from '../src/shared/types.js'

const demoStartedAt = Date.now() - 52 * 60 * 1000

type EndpointMode = 'nova8081' | 'services'

function requestBuffer(url: URL, method = 'GET', timeout = 4500): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, { method, timeout }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      response.on('end', () => {
        const body = Buffer.concat(chunks)
        if ((response.statusCode ?? 500) < 200 || (response.statusCode ?? 500) >= 300) {
          reject(new Error(`HTTP ${response.statusCode}: ${body.toString('utf8').slice(0, 160)}`))
        } else resolve(body)
      })
    })
    request.on('timeout', () => request.destroy(new Error('Bağlantı zaman aşımına uğradı.')))
    request.on('error', reject)
    request.end()
  })
}

function text(buffer: Buffer) {
  return buffer.toString('utf8').trim()
}

function parseJsonArray(buffer: Buffer, label: string): Record<string, unknown>[] {
  const raw = text(buffer)
  const data = JSON.parse(raw)
  if (Array.isArray(data)) return data as Record<string, unknown>[]
  if (data && typeof data === 'object') {
    const object = data as Record<string, unknown>
    for (const key of ['data', 'files', 'printables', 'printJobs', 'jobs', 'items']) {
      const value = object[key]
      if (Array.isArray(value)) return value as Record<string, unknown>[]
    }
  }
  throw new Error(`${label} JSON dizisi değil.`)
}

function bool(value: unknown) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') return ['true', '1', 'yes', 'printing', 'paused', 'active'].includes(value.toLowerCase())
  return false
}

function number(value: unknown) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function string(value: unknown, fallback = '') {
  return value === undefined || value === null ? fallback : String(value)
}

function pick<T>(value: Record<string, unknown> | undefined, keys: string[], fallback?: T) {
  if (value) for (const key of keys) if (value[key] !== undefined && value[key] !== null) return value[key] as T
  return fallback as T
}

function nestedObject(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function cleanAddress(printer: PrinterConfig) {
  const cleaned = printer.host.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  const match = cleaned.match(/^(.+?):(\d+)$/)
  return {
    host: (match ? match[1] : cleaned).trim(),
    port: match ? Number(match[2]) : Number(printer.port) || 8081,
  }
}

function makeFileName(rawName: string, rawExtension: string) {
  const extension = rawExtension.replace(/^\./, '')
  if (!extension) {
    const parts = rawName.split('.')
    return { name: rawName, extension: parts.length > 1 ? parts.pop() ?? '' : '', fullName: rawName }
  }
  const fullName = rawName.toLowerCase().endsWith(`.${extension.toLowerCase()}`) ? rawName : `${rawName}.${extension}`
  const name = fullName.toLowerCase().endsWith(`.${extension.toLowerCase()}`) ? fullName.slice(0, -extension.length - 1) : rawName
  return { name, extension, fullName }
}

export function normalizeFile(value: Record<string, unknown>): NovaFile {
  const rawName = string(pick(value, ['name', 'fileName', 'filename', 'printableName', 'path'], ''))
  const rawExtension = string(pick(value, ['extension', 'type', 'fileType'], ''))
  const names = makeFileName(rawName, rawExtension)
  return {
    name: names.name,
    extension: names.extension,
    size: number(pick(value, ['size', 'fileSize', 'bytes'], 0)),
    modifiedDate: string(pick(value, ['modifiedDate', 'modified', 'lastModified', 'date'], '')),
    fullName: names.fullName,
  }
}

export function normalizeJob(value: Record<string, unknown>): PrintJob {
  const printer = nestedObject(value.printer)
  const totalSlices = number(pick(value, ['totalSlices', 'totalSlice', 'totalLayers', 'slices'], 0))
  const currentSlice = number(pick(value, ['currentSlice', 'slice', 'currentLayer', 'layer'], 0))
  const status = string(pick(value, ['status', 'state'], pick(printer, ['status', 'state'], '')))
  const statusLower = status.toLowerCase()
  const completeStatuses = ['completed', 'complete', 'finished', 'done', 'stopped', 'cancelled', 'canceled', 'failed', 'error']
  const isFinished = completeStatuses.some((item) => statusLower.includes(item))
  const rawPaused = pick(value, ['printPaused', 'paused', 'isPaused'], pick(printer, ['printPaused', 'paused', 'isPaused'], undefined))
  const rawInProgress = pick(value, ['printInProgress', 'printing', 'active', 'isPrinting'], pick(printer, ['printInProgress', 'printing', 'active', 'isPrinting'], undefined))
  const printPaused = !isFinished && (rawPaused !== undefined ? bool(rawPaused) : statusLower.includes('pause'))
  const statusLooksActive = ['printing', 'running', 'exposing', 'lifting', 'starting'].some((item) => statusLower.includes(item))
  const printInProgress = !isFinished && (rawInProgress !== undefined ? bool(rawInProgress) : statusLooksActive)
  return {
    id: string(pick(value, ['id', 'uuid', 'jobId', 'guid'], '')),
    jobName: string(pick(value, ['jobName', 'fileName', 'filename', 'name', 'printableName'], 'İsimsiz iş')),
    printInProgress,
    printPaused,
    status,
    thickness: number(pick(value, ['thickness', 'layerHeight', 'sliceHeight'], 0)),
    totalSlices,
    currentSlice,
    currentSliceTime: number(pick(value, ['currentSliceTime', 'sliceTime'], 0)),
    averageSliceTime: number(pick(value, ['averageSliceTime', 'avgSliceTime', 'estimatedSliceTime', 'lastNAverageSliceTime'], 0)),
    elapsedTime: number(pick(value, ['elapsedTime', 'elapsed'], 0)),
    progress: totalSlices > 0 ? Math.min(100, (currentSlice / totalSlices) * 100) : number(pick(value, ['progress', 'percentage'], 0)),
  }
}

const demoFiles: NovaFile[] = [
  { name: 'gearbox_v12', extension: 'cws', size: 48_890_112, modifiedDate: '2026-06-30T09:42:00', fullName: 'gearbox_v12.cws' },
  { name: 'enclosure-final', extension: 'cws', size: 72_241_152, modifiedDate: '2026-06-29T16:18:00', fullName: 'enclosure-final.cws' },
  { name: 'calibration-matrix', extension: 'cws', size: 12_713_984, modifiedDate: '2026-06-26T11:05:00', fullName: 'calibration-matrix.cws' },
]

export class NovaClient {
  private url(printer: PrinterConfig, path: string, mode: EndpointMode = 'nova8081', forcePort = false) {
    const address = cleanAddress(printer)
    const portPart = mode === 'nova8081' || forcePort ? `:${address.port || 8081}` : ''
    return new URL(`http://${address.host}${portPart}${path}`)
  }

  private serviceUrls(printer: PrinterConfig, path: string) {
    return [this.url(printer, path, 'services'), this.url(printer, path, 'services', true)]
  }

  private async requestFirst(candidates: { url: URL; mode: EndpointMode }[], method = 'GET', timeout = 4500) {
    const errors: string[] = []
    for (const candidate of candidates) {
      try {
        return { body: await requestBuffer(candidate.url, method, timeout), mode: candidate.mode }
      } catch (error) {
        errors.push(`${candidate.url.pathname}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    throw new Error(errors.join(' | ') || 'Yazıcı cevap vermedi.')
  }

  async snapshot(printer: PrinterConfig): Promise<PrinterSnapshot> {
    if (printer.host.startsWith('demo-')) return this.demoSnapshot(printer)
    const started = performance.now()
    try {
      const fileResult = await this.requestFirst([
        { url: this.url(printer, '/file/list'), mode: 'nova8081' },
        ...this.serviceUrls(printer, '/services/printables/list').map((url) => ({ url, mode: 'services' as EndpointMode })),
      ], 'GET', 7000)
      const files = parseJsonArray(fileResult.body, 'Dosya listesi').map(normalizeFile)
      let jobs: PrintJob[] = []
      let jobError = ''
      let firmware: string | undefined
      let model: string | undefined
      let printerInfo: string | undefined

      try {
        const jobResult = await this.requestFirst([
          { url: this.url(printer, '/job/list/'), mode: 'nova8081' },
          { url: this.url(printer, '/job/list'), mode: 'nova8081' },
          ...this.serviceUrls(printer, '/services/printJobs/list').map((url) => ({ url, mode: 'services' as EndpointMode })),
        ], 'GET', 4500)
        jobs = parseJsonArray(jobResult.body, 'İş listesi').map(normalizeJob)
      } catch (error) {
        jobError = error instanceof Error ? error.message : 'İş listesi alınamadı.'
      }

      try { firmware = text((await this.requestFirst([{ url: this.url(printer, '/setting/currentVersion'), mode: 'nova8081' }], 'GET', 3500)).body) || undefined }
      catch { /* optional endpoint */ }

      try {
        printerInfo = text((await this.requestFirst([
          { url: this.url(printer, '/setting/printerInfo'), mode: 'nova8081' },
          { url: this.url(printer, '/setting/model'), mode: 'nova8081' },
        ], 'GET', 3500)).body) || undefined
        model = printerInfo
      } catch { /* optional endpoint */ }

      const activeJob = jobs.find((job) => job.printInProgress || job.printPaused)
      return {
        config: { ...printer, model: model || printer.model },
        state: activeJob?.printPaused ? 'paused' : activeJob?.printInProgress ? 'printing' : 'online',
        latency: Math.round(performance.now() - started),
        firmware,
        printerInfo: printerInfo || `API: ${fileResult.mode === 'nova8081' ? 'Nova3D 8081' : 'Photonic3D services'}`,
        files,
        usedBytes: files.reduce((sum, file) => sum + file.size, 0),
        activeJob,
        error: jobError || undefined,
        lastSeen: new Date().toISOString(),
      }
    } catch (error) {
      return { config: printer, state: 'offline', files: [], usedBytes: 0, error: error instanceof Error ? error.message : 'Bağlantı kurulamadı.' }
    }
  }

  async command(printer: PrinterConfig, path: string) {
    if (printer.host.startsWith('demo-')) return
    const servicesFallback = this.commandFallbacks(printer, path)
    await this.requestFirst([{ url: this.url(printer, path), mode: 'nova8081' }, ...servicesFallback], 'GET', 10_000)
  }

  private commandFallbacks(printer: PrinterConfig, path: string) {
    const map: Array<[RegExp, string]> = [
      [/^\/file\/delete\/(.+)$/u, '/services/printables/delete/$1'],
      [/^\/file\/print\/(.+)$/u, '/services/printables/print/$1'],
      [/^\/job\/toggle\/(.+)$/u, '/services/printJobs/togglePause/$1'],
      [/^\/job\/stop\/(.+)$/u, '/services/printJobs/stopJob/$1'],
    ]
    for (const [pattern, replacement] of map) {
      const next = path.replace(pattern, replacement)
      if (next !== path) return this.serviceUrls(printer, next).map((url) => ({ url, mode: 'services' as EndpointMode }))
    }
    return []
  }

  async upload(printer: PrinterConfig, filePath: string, onProgress: (percent: number) => void) {
    if (printer.host.startsWith('demo-')) {
      for (const percent of [12, 31, 54, 78, 100]) { onProgress(percent); await new Promise((resolve) => setTimeout(resolve, 120)) }
      return
    }
    const fileName = basename(filePath)
    const fileSize = (await stat(filePath)).size
    const encoded = encodeURIComponent(fileName)
    const candidates = [
      this.url(printer, `/file/upload/${encoded}`),
      ...this.serviceUrls(printer, `/services/printables/uploadPrintableFile/${encoded}`),
    ]
    const errors: string[] = []
    for (const url of candidates) {
      try {
        await this.uploadTo(url, filePath, fileSize, onProgress)
        return
      } catch (error) {
        errors.push(`${url.pathname}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    throw new Error(errors.join(' | ') || 'Yükleme başarısız.')
  }

  private async uploadTo(url: URL, filePath: string, fileSize: number, onProgress: (percent: number) => void) {
    await new Promise<void>((resolve, reject) => {
      const request = httpRequest(url, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': fileSize }, timeout: 120_000 }, (response) => {
        response.resume()
        response.on('end', () => (response.statusCode ?? 500) < 300 ? resolve() : reject(new Error(`Yükleme HTTP ${response.statusCode} ile reddedildi.`)))
      })
      let uploaded = 0
      const stream = createReadStream(filePath)
      stream.on('data', (chunk) => { uploaded += chunk.length; onProgress(Math.round((uploaded / fileSize) * 100)) })
      stream.on('error', reject)
      request.on('timeout', () => request.destroy(new Error('Yükleme zaman aşımına uğradı.')))
      request.on('error', reject)
      stream.pipe(request)
    })
  }

  private demoSnapshot(printer: PrinterConfig): PrinterSnapshot {
    if (printer.host === 'demo-2') return { config: printer, state: 'online', latency: 18, firmware: '3.5.0', printerInfo: 'API: Nova3D 8081', files: demoFiles.slice(1), usedBytes: demoFiles.slice(1).reduce((sum, item) => sum + item.size, 0), lastSeen: new Date().toISOString() }
    if (printer.host === 'demo-3') return { config: printer, state: 'offline', files: [], usedBytes: 0, error: 'Yazıcı ağda yanıt vermiyor.' }
    const elapsed = Date.now() - demoStartedAt
    const currentSlice = Math.min(1842, 920 + Math.floor(elapsed / 14_000))
    const activeJob: PrintJob = {
      id: 'demo-job-001', jobName: 'gearbox_v12.cws', printInProgress: true, printPaused: false,
      status: 'printing', thickness: 0.05, totalSlices: 1842, currentSlice,
      currentSliceTime: 14_000, averageSliceTime: 14_200, elapsedTime: elapsed,
      progress: (currentSlice / 1842) * 100,
    }
    return { config: printer, state: 'printing', latency: 24, firmware: '3.5.0', printerInfo: 'API: Nova3D 8081', files: demoFiles, usedBytes: demoFiles.reduce((sum, item) => sum + item.size, 0), activeJob, lastSeen: new Date().toISOString() }
  }
}
