import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { basename } from 'node:path'
import type { NovaFile, PrintJob, PrinterConfig, PrinterSnapshot } from '../src/shared/types.js'

const demoStartedAt = Date.now() - 52 * 60 * 1000

function requestBuffer(url: URL, method = 'GET', timeout = 4500): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, { method, timeout }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      response.on('end', () => {
        const body = Buffer.concat(chunks)
        if ((response.statusCode ?? 500) < 200 || (response.statusCode ?? 500) >= 300) {
          reject(new Error(`Yazıcı HTTP ${response.statusCode}: ${body.toString('utf8').slice(0, 160)}`))
        } else resolve(body)
      })
    })
    request.on('timeout', () => request.destroy(new Error('Bağlantı zaman aşımına uğradı.')))
    request.on('error', reject)
    request.end()
  })
}

export function normalizeFile(value: Record<string, unknown>): NovaFile {
  const name = String(value.name ?? '')
  const extension = String(value.extension ?? '').replace(/^\./, '')
  return {
    name,
    extension,
    size: Number(value.size ?? 0),
    modifiedDate: String(value.modifiedDate ?? ''),
    fullName: extension && !name.toLowerCase().endsWith(`.${extension.toLowerCase()}`) ? `${name}.${extension}` : name,
  }
}

export function normalizeJob(value: Record<string, unknown>): PrintJob {
  const totalSlices = Number(value.totalSlices ?? 0)
  const currentSlice = Number(value.currentSlice ?? 0)
  return {
    id: String(value.id ?? ''),
    jobName: String(value.jobName ?? 'İsimsiz iş'),
    printInProgress: Boolean(value.printInProgress),
    printPaused: Boolean(value.printPaused),
    status: String(value.status ?? ''),
    thickness: Number(value.thickness ?? 0),
    totalSlices,
    currentSlice,
    currentSliceTime: Number(value.currentSliceTime ?? 0),
    averageSliceTime: Number(value.averageSliceTime ?? 0),
    elapsedTime: Number(value.elapsedTime ?? 0),
    progress: totalSlices > 0 ? Math.min(100, (currentSlice / totalSlices) * 100) : 0,
  }
}

const demoFiles: NovaFile[] = [
  { name: 'gearbox_v12', extension: 'cws', size: 48_890_112, modifiedDate: '2026-06-30T09:42:00', fullName: 'gearbox_v12.cws' },
  { name: 'enclosure-final', extension: 'cws', size: 72_241_152, modifiedDate: '2026-06-29T16:18:00', fullName: 'enclosure-final.cws' },
  { name: 'calibration-matrix', extension: 'cws', size: 12_713_984, modifiedDate: '2026-06-26T11:05:00', fullName: 'calibration-matrix.cws' },
]

export class NovaClient {
  private url(printer: PrinterConfig, path: string) {
    return new URL(`http://${printer.host}:${printer.port}${path}`)
  }

  async snapshot(printer: PrinterConfig): Promise<PrinterSnapshot> {
    if (printer.host.startsWith('demo-')) return this.demoSnapshot(printer)
    const started = performance.now()
    try {
      // Nova firmware can lock up under aggressive polling; keep requests sequential.
      const fileData = JSON.parse((await requestBuffer(this.url(printer, '/file/list'))).toString('utf8')) as Record<string, unknown>[]
      const jobData = JSON.parse((await requestBuffer(this.url(printer, '/job/list/'))).toString('utf8')) as Record<string, unknown>[]
      const files = Array.isArray(fileData) ? fileData.map(normalizeFile) : []
      const jobs = Array.isArray(jobData) ? jobData.map(normalizeJob) : []
      const activeJob = jobs.find((job) => job.printInProgress || job.printPaused)
      return {
        config: printer,
        state: activeJob?.printPaused ? 'paused' : activeJob?.printInProgress ? 'printing' : 'online',
        latency: Math.round(performance.now() - started),
        files,
        usedBytes: files.reduce((sum, file) => sum + file.size, 0),
        activeJob,
        lastSeen: new Date().toISOString(),
      }
    } catch (error) {
      return { config: printer, state: 'offline', files: [], usedBytes: 0, error: error instanceof Error ? error.message : 'Bağlantı kurulamadı.' }
    }
  }

  async command(printer: PrinterConfig, path: string) {
    if (printer.host.startsWith('demo-')) return
    await requestBuffer(this.url(printer, path), 'GET', 10_000)
  }

  async upload(printer: PrinterConfig, filePath: string, onProgress: (percent: number) => void) {
    if (printer.host.startsWith('demo-')) {
      for (const percent of [12, 31, 54, 78, 100]) { onProgress(percent); await new Promise((resolve) => setTimeout(resolve, 120)) }
      return
    }
    const fileName = basename(filePath)
    const fileSize = (await stat(filePath)).size
    const url = this.url(printer, `/file/upload/${encodeURIComponent(fileName)}`)
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
    if (printer.host === 'demo-2') return { config: printer, state: 'online', latency: 18, firmware: '3.5.0', files: demoFiles.slice(1), usedBytes: demoFiles.slice(1).reduce((sum, item) => sum + item.size, 0), lastSeen: new Date().toISOString() }
    if (printer.host === 'demo-3') return { config: printer, state: 'offline', files: [], usedBytes: 0, error: 'Yazıcı ağda yanıt vermiyor.' }
    const elapsed = Date.now() - demoStartedAt
    const currentSlice = Math.min(1842, 920 + Math.floor(elapsed / 14_000))
    const activeJob: PrintJob = {
      id: 'demo-job-001', jobName: 'gearbox_v12.cws', printInProgress: true, printPaused: false,
      status: 'printing', thickness: 0.05, totalSlices: 1842, currentSlice,
      currentSliceTime: 14_000, averageSliceTime: 14_200, elapsedTime: elapsed,
      progress: (currentSlice / 1842) * 100,
    }
    return { config: printer, state: 'printing', latency: 24, firmware: '3.5.0', files: demoFiles, usedBytes: demoFiles.reduce((sum, item) => sum + item.size, 0), activeJob, lastSeen: new Date().toISOString() }
  }
}
