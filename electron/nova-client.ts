import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { createSocket } from 'node:dgram'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { basename } from 'node:path'
import WebSocket from 'ws'
import type { NovaFile, PrintJob, PrinterConfig, PrinterSnapshot } from '../src/shared/types.js'

const demoStartedAt = Date.now() - 52 * 60 * 1000

type EndpointMode = 'nova8081' | 'services' | 'sdcp3'

interface SdcpDiscoveryDevice {
  Id?: string
  Data?: {
    Name?: string
    MainboardIP?: string
    MainboardID?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

interface SdcpStatusResponse {
  Status?: Record<string, unknown>
  Data?: Record<string, unknown>
  [key: string]: unknown
}

function requestBuffer(url: URL, method = 'GET', timeout = 4500): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method,
      timeout,
      agent: false,
      family: 4,
      insecureHTTPParser: true,
      joinDuplicateHeaders: true,
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Accept-Encoding': 'identity',
        Connection: 'close',
        'User-Agent': 'Nova-Fleet/0.2.2',
      },
    }, (response) => {
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
  return buffer.toString('utf8').replace(/^\uFEFF/u, '').replace(/\0+$/u, '').trim()
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
  const fallbackPort = printer.protocol === 'sdcp3' ? 3030 : 8081
  return {
    host: (match ? match[1] : cleaned).trim(),
    port: match ? Number(match[2]) : Number(printer.port) || fallbackPort,
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
    beginPrintTime: number(pick(value, ['beginPrintTime'], 0)) || undefined,
    endPrintTime: number(pick(value, ['endPrintTime'], 0)) || undefined,
    layerTime: number(pick(value, ['layerTime'], 0)) || undefined,
    bottomLayersTime: number(pick(value, ['bottomLayersTime'], 0)) || undefined,
    numberOfBottomLayers: number(pick(value, ['numberOfBottomLayers'], 0)) || undefined,
    resinUsage: number(pick(value, ['resinUsage'], 0)),
    totalCost: number(pick(value, ['totalCost'], 0)),
    totalExposureTime: number(pick(value, ['totalExposureTime'], 0)) || undefined,
    zliftDistance: number(pick(value, ['zliftDistance'], 0)) || undefined,
    zliftSpeed: number(pick(value, ['zliftSpeed'], 0)) || undefined,
    errorDescription: string(pick(value, ['errorDescription'], '')) || undefined,
  }
}

function parseJsonObject(buffer: Buffer, label: string): Record<string, unknown> {
  const raw = text(buffer)
  const data = JSON.parse(raw)
  if (data && typeof data === 'object' && !Array.isArray(data)) return data as Record<string, unknown>
  throw new Error(`${label} JSON nesnesi değil.`)
}

function unwrapObject(value: Record<string, unknown>) {
  for (const key of ['data', 'result', 'printer', 'status', 'machine', 'device']) {
    const nested = nestedObject(value[key])
    if (nested) return { ...value, ...nested }
  }
  return value
}

function stateFromSdcp(value: Record<string, unknown>) {
  const raw = string(pick(value, ['state', 'status', 'printerStatus', 'machineStatus', 'printStatus'], '')).toLowerCase()
  if (['pause', 'paused'].some((item) => raw.includes(item))) return 'paused' as const
  if (['print', 'printing', 'busy', 'running', 'exposure', 'exposing'].some((item) => raw.includes(item))) return 'printing' as const
  if (['error', 'fault', 'failed'].some((item) => raw.includes(item))) return 'error' as const
  return 'online' as const
}

function parseJsonObjectText(raw: string): Record<string, unknown> | undefined {
  try {
    const data = JSON.parse(raw.trim())
    return data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

function sdcpStatusCode(value: unknown) {
  if (Array.isArray(value)) return number(value[0])
  return number(value)
}

function sdcpStateFromCode(code: number) {
  if (code === 2) return 'printing' as const
  if (code >= 64) return 'error' as const
  return 'online' as const
}

function sdcpStatusText(code: number) {
  const map: Record<number, string> = {
    0: 'idle',
    1: 'homing',
    2: 'printing',
    4: 'file_checking',
  }
  return map[code] ?? `sdcp_status_${code}`
}

function normalizeSdcpJob(status: Record<string, unknown>, deviceId: string): PrintJob | undefined {
  const printInfo = nestedObject(status.PrintInfo) ?? nestedObject(status.printInfo)
  if (!printInfo) return undefined
  const statusCode = sdcpStatusCode(pick(status, ['CurrentStatus', 'currentStatus', 'Status'], 0))
  const currentSlice = number(pick(printInfo, ['CurrentLayer', 'currentLayer', 'CurrentSlice'], 0))
  const totalSlices = number(pick(printInfo, ['TotalLayer', 'totalLayer', 'TotalSlices'], 0))
  const currentTicks = number(pick(printInfo, ['CurrentTicks', 'currentTicks', 'ElapsedTime'], 0))
  const totalTicks = number(pick(printInfo, ['TotalTicks', 'totalTicks'], 0))
  const progress = totalSlices > 0
    ? Math.min(100, (currentSlice / totalSlices) * 100)
    : totalTicks > 0 ? Math.min(100, (currentTicks / totalTicks) * 100) : 0
  return {
    id: string(pick(printInfo, ['TaskId', 'taskId', 'Id', 'id'], deviceId || 'sdcp-current-job')),
    jobName: string(pick(printInfo, ['Filename', 'FileName', 'filename', 'Name'], 'SDCP print')),
    printInProgress: statusCode === 2,
    printPaused: false,
    status: sdcpStatusText(statusCode),
    thickness: number(pick(printInfo, ['LayerHeight', 'layerHeight', 'Thickness'], 0)),
    totalSlices,
    currentSlice,
    currentSliceTime: 0,
    averageSliceTime: totalSlices > 0 && totalTicks > 0 ? Math.round(totalTicks / totalSlices) : 0,
    elapsedTime: currentTicks,
    progress,
  }
}

function normalizeSdcpFile(value: Record<string, unknown>): NovaFile | undefined {
  const fileType = pick(value, ['type', 'Type'], undefined)
  if (fileType !== undefined && number(fileType) === 0) return undefined
  const rawPath = string(pick(value, ['name', 'Name', 'path', 'Path', 'Url', 'url'], ''))
  if (!rawPath) return undefined
  const fullName = rawPath.split('/').filter(Boolean).pop() ?? rawPath
  const dotIndex = fullName.lastIndexOf('.')
  const extension = dotIndex > -1 ? fullName.slice(dotIndex + 1) : string(pick(value, ['extension', 'Extension'], ''))
  const name = dotIndex > -1 ? fullName.slice(0, dotIndex) : fullName
  return {
    name,
    extension,
    size: number(pick(value, ['usedSize', 'UsedSize', 'size', 'Size', 'fileSize', 'FileSize'], 0)),
    modifiedDate: string(pick(value, ['modifiedDate', 'ModifiedDate', 'lastModified', 'LastModified', 'date', 'Date'], '')),
    fullName,
  }
}

function uniqueFiles(files: NovaFile[]) {
  const seen = new Set<string>()
  return files.filter((file) => {
    const key = `${file.fullName.toLowerCase()}:${file.size}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
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

  private sdcpUrls(printer: PrinterConfig, paths: string[]) {
    return paths.map((path) => ({ url: this.url(printer, path, 'sdcp3', true), mode: 'sdcp3' as EndpointMode }))
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
    if (printer.protocol === 'sdcp3') return this.sdcpSnapshot(printer)
    const started = performance.now()
    try {
      const fileResult = await this.requestFirst([
        { url: this.url(printer, '/file/list'), mode: 'nova8081' },
        { url: this.url(printer, '/file/list/'), mode: 'nova8081' },
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
        recentJobs: jobs.filter((job) => job !== activeJob).slice(0, 20),
        error: jobError || undefined,
        lastSeen: new Date().toISOString(),
      }
    } catch (error) {
      return { config: printer, state: 'offline', files: [], usedBytes: 0, error: error instanceof Error ? error.message : 'Bağlantı kurulamadı.' }
    }
  }

  private async sdcpSnapshot(printer: PrinterConfig): Promise<PrinterSnapshot> {
    const started = performance.now()
    try {
      const address = cleanAddress(printer)
      const device = await this.discoverSdcpDevice(address.host)
      const deviceData = device.Data ?? {}
      const mainboardId = string(deviceData.MainboardID, '')
      const deviceIp = string(deviceData.MainboardIP, address.host) || address.host
      const deviceId = string(device.Id, mainboardId || address.host)
      const status = await this.requestSdcpStatus(deviceId, mainboardId, deviceIp, address.port || 3030)
      const statusCode = sdcpStatusCode(pick(status, ['CurrentStatus', 'currentStatus', 'Status'], 0))
      const activeJob = normalizeSdcpJob(status, deviceId)
      let files: NovaFile[] = []
      let fileError = ''
      try {
        files = await this.listSdcpFiles(deviceId, mainboardId, deviceIp, address.port || 3030)
      } catch (error) {
        fileError = error instanceof Error ? error.message : 'SDCP dosya listesi alınamadı.'
      }
      return {
        config: { ...printer, model: string(deviceData.Name, printer.model || 'SDCP 3.0') },
        state: activeJob?.printPaused ? 'paused' : activeJob?.printInProgress ? 'printing' : sdcpStateFromCode(statusCode),
        latency: Math.round(performance.now() - started),
        firmware: string(pick(status, ['FirmwareVersion', 'firmwareVersion', 'Version'], '')) || undefined,
        printerInfo: `API: SDCP 3.0 WebSocket (${deviceIp}:3030)`,
        files,
        usedBytes: files.reduce((sum, file) => sum + file.size, 0),
        activeJob,
        recentJobs: [],
        error: fileError || undefined,
        lastSeen: new Date().toISOString(),
      }
    } catch (error) {
      return { config: printer, state: 'offline', files: [], usedBytes: 0, error: error instanceof Error ? error.message : 'SDCP 3.0 bağlantısı kurulamadı.' }
    }
  }

  private async discoverSdcpDevice(host: string): Promise<SdcpDiscoveryDevice> {
    return new Promise((resolve, reject) => {
      const socket = createSocket('udp4')
      const devices: Array<{ device: SdcpDiscoveryDevice; source: string }> = []
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        socket.close()
        const exact = devices.find((item) => item.source === host || item.device.Data?.MainboardIP === host)
        const selected = exact ?? (devices.length === 1 ? devices[0] : undefined)
        if (selected) resolve(selected.device)
        else reject(new Error('SDCP keşif yanıtı alınamadı. Windows Güvenlik Duvarı UDP 3000 ve TCP 3030 izinlerini kontrol et.'))
      }
      const timer = setTimeout(finish, 2200)
      socket.on('error', (error) => {
        clearTimeout(timer)
        if (!settled) {
          settled = true
          socket.close()
          reject(error)
        }
      })
      socket.on('message', (message, remote) => {
        const parsed = parseJsonObjectText(message.toString('utf8'))
        if (parsed?.Data && typeof parsed.Data === 'object') {
          devices.push({ device: parsed as SdcpDiscoveryDevice, source: remote.address })
          if (remote.address === host || (parsed as SdcpDiscoveryDevice).Data?.MainboardIP === host) {
            clearTimeout(timer)
            finish()
          }
        }
      })
      socket.bind(0, '0.0.0.0', () => {
        socket.setBroadcast(true)
        const payload = Buffer.from('M99999')
        socket.send(payload, 3000, '255.255.255.255')
        socket.send(payload, 3000, host)
      })
    })
  }

  private async listSdcpFiles(deviceId: string, mainboardId: string, host: string, port: number): Promise<NovaFile[]> {
    const paths = ['/local/', '/usb/', '/local', '/usb', '/']
    const files: NovaFile[] = []
    const errors: string[] = []
    for (const path of paths) {
      try {
        const result = await this.requestSdcpCommand(deviceId, mainboardId, host, port, 258, { Url: path }, `dosya listesi ${path}`)
        const list = pick(result, ['FileList', 'fileList', 'Files', 'files'], [])
        if (Array.isArray(list)) {
          for (const item of list) {
            const object = nestedObject(item)
            const file = object ? normalizeSdcpFile(object) : undefined
            if (file) files.push(file)
          }
        }
      } catch (error) {
        errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const unique = uniqueFiles(files)
    if (unique.length > 0) return unique
    if (errors.length > 0) throw new Error(`SDCP dosya listesi alınamadı: ${errors.join(' | ')}`)
    return []
  }

  private async requestSdcpCommand(
    deviceId: string,
    mainboardId: string,
    host: string,
    port: number,
    command: number,
    payload: Record<string, unknown>,
    label: string,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const url = `ws://${host}:${port || 3030}/websocket`
      const socket = new WebSocket(url)
      let settled = false
      const requestId = randomUUID().replaceAll('-', '')
      const cleanup = () => socket.close()
      const failTimer = setTimeout(() => {
        if (!settled) {
          settled = true
          cleanup()
          reject(new Error(`SDCP ${label} yanıtı gelmedi: ${url}`))
        }
      }, 6500)
      const finish = (result: Record<string, unknown>) => {
        if (settled) return
        settled = true
        clearTimeout(failTimer)
        cleanup()
        resolve(result)
      }
      const fail = (error: Error) => {
        if (settled) return
        settled = true
        clearTimeout(failTimer)
        cleanup()
        reject(error)
      }
      socket.on('open', () => {
        socket.send(JSON.stringify({
          Id: deviceId,
          Data: {
            Cmd: command,
            Data: payload,
            RequestID: requestId,
            MainboardID: mainboardId,
            TimeStamp: Math.floor(Date.now() / 1000),
            From: 0,
          },
          Topic: `sdcp/request/${mainboardId}`,
        }))
      })
      socket.on('message', (data) => {
        const parsed = parseJsonObjectText(data.toString())
        const envelope = nestedObject(parsed?.Data)
        if (!envelope) return
        const responseCmd = number(envelope.Cmd)
        const responseRequestId = string(envelope.RequestID, '')
        if (responseCmd !== command) return
        if (responseRequestId && responseRequestId !== requestId) return
        const responseData = nestedObject(envelope.Data) ?? envelope
        const ack = pick(responseData, ['Ack', 'ack'], undefined)
        if (ack !== undefined && number(ack) !== 0) {
          fail(new Error(`SDCP ${label} Ack=${number(ack)}`))
          return
        }
        finish(responseData)
      })
      socket.on('error', (error) => {
        fail(error)
      })
      socket.on('close', () => {
        fail(new Error(`SDCP ${label} bağlantısı kapandı: ${url}`))
      })
    })
  }

  private async requestSdcpStatus(deviceId: string, mainboardId: string, host: string, port: number): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const url = `ws://${host}:${port || 3030}/websocket`
      const socket = new WebSocket(url)
      let settled = false
      let pollTimer: ReturnType<typeof setInterval> | undefined
      const cleanup = () => {
        if (pollTimer) clearInterval(pollTimer)
        socket.close()
      }
      const failTimer = setTimeout(() => {
        if (!settled) {
          settled = true
          cleanup()
          reject(new Error(`SDCP WebSocket durum yanıtı gelmedi: ${url}`))
        }
      }, 5500)
      const sendStatusRequest = () => {
        if (socket.readyState !== WebSocket.OPEN) return
        socket.send(JSON.stringify({
          Id: deviceId,
          Data: {
            Cmd: 0,
            Data: {},
            RequestID: randomUUID().replaceAll('-', ''),
            MainboardID: mainboardId,
            TimeStamp: Math.floor(Date.now() / 1000),
            From: 0,
          },
          Topic: `sdcp/request/${mainboardId}`,
        }))
      }
      socket.on('open', () => {
        sendStatusRequest()
        pollTimer = setInterval(sendStatusRequest, 1000)
      })
      socket.on('message', (data) => {
        const parsed = parseJsonObjectText(data.toString())
        const status = nestedObject(parsed?.Status) ?? nestedObject((parsed as SdcpStatusResponse | undefined)?.Data?.Status)
        if (status && !settled) {
          settled = true
          clearTimeout(failTimer)
          cleanup()
          resolve(status)
        }
      })
      socket.on('error', (error) => {
        if (!settled) {
          settled = true
          clearTimeout(failTimer)
          cleanup()
          reject(error)
        }
      })
      socket.on('close', () => {
        if (!settled) {
          settled = true
          clearTimeout(failTimer)
          cleanup()
          reject(new Error(`SDCP WebSocket kapandı: ${url}`))
        }
      })
    })
  }

  private async legacyHttpSdcpSnapshot(printer: PrinterConfig): Promise<PrinterSnapshot> {
    const started = performance.now()
    try {
      const statusResult = await this.requestFirst(this.sdcpUrls(printer, [
        '/api/v1/status',
        '/api/v1/printer/status',
        '/api/v1/device/status',
        '/sdcp/status',
        '/printer/status',
        '/status',
      ]), 'GET', 7000)
      const status = unwrapObject(parseJsonObject(statusResult.body, 'SDCP durum'))
      let files: NovaFile[] = []
      let jobs: PrintJob[] = []
      let detailError = ''

      try {
        const fileResult = await this.requestFirst(this.sdcpUrls(printer, [
          '/api/v1/files',
          '/api/v1/printables',
          '/sdcp/files',
          '/files',
        ]), 'GET', 4500)
        files = parseJsonArray(fileResult.body, 'SDCP dosya listesi').map(normalizeFile)
      } catch (error) {
        detailError = error instanceof Error ? error.message : 'SDCP dosya listesi alınamadı.'
      }

      try {
        const jobResult = await this.requestFirst(this.sdcpUrls(printer, [
          '/api/v1/jobs',
          '/api/v1/print/status',
          '/api/v1/printJobs',
          '/sdcp/jobs',
          '/jobs',
        ]), 'GET', 4500)
        jobs = parseJsonArray(jobResult.body, 'SDCP iş listesi').map(normalizeJob)
      } catch {
        const maybeJob = nestedObject(status.job) ?? nestedObject(status.printJob) ?? nestedObject(status.currentJob)
        if (maybeJob) jobs = [normalizeJob(maybeJob)]
      }

      const activeJob = jobs.find((job) => job.printInProgress || job.printPaused)
      const model = string(pick(status, ['model', 'machineName', 'printerName', 'name'], printer.model || 'SDCP 3.0'))
      return {
        config: { ...printer, model },
        state: activeJob?.printPaused ? 'paused' : activeJob?.printInProgress ? 'printing' : stateFromSdcp(status),
        latency: Math.round(performance.now() - started),
        firmware: string(pick(status, ['firmware', 'firmwareVersion', 'version'], '')) || undefined,
        printerInfo: 'API: SDCP 3.0',
        files,
        usedBytes: files.reduce((sum, file) => sum + file.size, 0),
        activeJob,
        recentJobs: jobs.filter((job) => job !== activeJob).slice(0, 20),
        error: detailError || undefined,
        lastSeen: new Date().toISOString(),
      }
    } catch (error) {
      return { config: printer, state: 'offline', files: [], usedBytes: 0, error: error instanceof Error ? error.message : 'SDCP 3.0 bağlantısı kurulamadı.' }
    }
  }

  async command(printer: PrinterConfig, path: string) {
    if (printer.host.startsWith('demo-')) return
    if (printer.protocol === 'sdcp3') throw new Error('SDCP 3.0 yazıcılarda dosya/iş komutları henüz etkin değil; bağlantı ve durum izleme desteklenir.')
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
    if (printer.protocol === 'sdcp3') throw new Error('SDCP 3.0 dosya yükleme komutu henüz etkin değil; bu branch bağlantı ve durum izleme desteği ekler.')
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
        if (await this.uploadAppearsComplete(printer, fileName)) {
          onProgress(100)
          return
        }
      }
    }
    if (await this.uploadAppearsComplete(printer, fileName)) {
      onProgress(100)
      return
    }
    throw new Error(errors.join(' | ') || 'Yükleme başarısız.')
  }

  private async uploadAppearsComplete(printer: PrinterConfig, fileName: string) {
    for (const waitMs of [800, 2000]) {
      await delay(waitMs)
      try {
        const result = await this.requestFirst([
          { url: this.url(printer, '/file/list'), mode: 'nova8081' },
          { url: this.url(printer, '/file/list/'), mode: 'nova8081' },
          ...this.serviceUrls(printer, '/services/printables/list').map((url) => ({ url, mode: 'services' as EndpointMode })),
        ], 'GET', 7000)
        const expected = fileName.toLowerCase()
        const found = parseJsonArray(result.body, 'Dosya listesi')
          .map(normalizeFile)
          .some((file) => file.fullName.toLowerCase() === expected || `${file.name}.${file.extension}`.toLowerCase() === expected)
        if (found) return true
      } catch {
        /* Yazıcı upload sonrası kısa süre meşgul kalabiliyor; tekrar dene. */
      }
    }
    return false
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
