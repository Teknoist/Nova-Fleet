import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { PrinterConfig, SavePrinterInput } from '../src/shared/types.js'

const starterPrinters: PrinterConfig[] = [
  { id: 'demo-lab-01', name: 'Reçine Lab 01', host: 'demo-1', port: 8081, model: 'Nova3D Elfin', location: 'Prototip Atölyesi', pollInterval: 10, enabled: true },
  { id: 'demo-lab-02', name: 'Reçine Lab 02', host: 'demo-2', port: 8081, model: 'Nova3D Bene4', location: 'Prototip Atölyesi', pollInterval: 12, enabled: true },
  { id: 'demo-studio', name: 'Tasarım Stüdyosu', host: 'demo-3', port: 8081, model: 'Nova3D Whale3', location: '2. Kat', pollInterval: 15, enabled: true },
]

function normalizeAddress(rawHost: string, rawPort: number) {
  const text = rawHost.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  const match = text.match(/^(.+?):(\d+)$/)
  return {
    host: (match ? match[1] : text).trim(),
    port: match ? Number(match[2]) : Number(rawPort) || 8081,
  }
}

export class PrinterStore {
  private get filePath() { return join(app.getPath('userData'), 'printers.json') }

  async list(): Promise<PrinterConfig[]> {
    try {
      return JSON.parse(await readFile(this.filePath, 'utf8')) as PrinterConfig[]
    } catch {
      await this.write(starterPrinters)
      return starterPrinters
    }
  }

  async get(id: string): Promise<PrinterConfig> {
    const printer = (await this.list()).find((item) => item.id === id)
    if (!printer) throw new Error('Yazıcı bulunamadı.')
    return printer
  }

  async save(input: SavePrinterInput): Promise<PrinterConfig> {
    const printers = await this.list()
    const address = normalizeAddress(input.host, Number(input.port))
    if (!address.host) throw new Error('Geçerli bir IP adresi veya sunucu adı girin.')
    const printer: PrinterConfig = {
      ...input,
      id: input.id || randomUUID(),
      name: input.name.trim() || 'İsimsiz yazıcı',
      host: address.host,
      port: address.port,
      pollInterval: Math.max(5, Number(input.pollInterval) || 10),
    }
    const index = printers.findIndex((item) => item.id === printer.id)
    if (index >= 0) printers[index] = printer
    else printers.push(printer)
    await this.write(printers)
    return printer
  }

  async remove(id: string): Promise<void> {
    await this.write((await this.list()).filter((item) => item.id !== id))
  }

  private async write(printers: PrinterConfig[]) {
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(printers, null, 2), 'utf8')
  }
}
