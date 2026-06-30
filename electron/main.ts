import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SavePrinterInput } from '../src/shared/types.js'
import { NovaClient } from './nova-client.js'
import { PrinterStore } from './store.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const store = new PrinterStore()
const client = new NovaClient()

function createWindow() {
  const window = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#0d0f0f',
    titleBarStyle: 'hiddenInset',
    autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  window.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' } })
  if (process.env.VITE_DEV_SERVER_URL) void window.loadURL(process.env.VITE_DEV_SERVER_URL)
  else void window.loadFile(join(__dirname, '../../dist/index.html'))
}

function result(error: unknown) {
  return { ok: false, message: error instanceof Error ? error.message : 'Beklenmeyen bir hata oluştu.' }
}

ipcMain.handle('printers:list', () => store.list())
ipcMain.handle('printers:save', (_event, input: SavePrinterInput) => store.save(input))
ipcMain.handle('printers:remove', async (_event, id: string) => { try { await store.remove(id); return { ok: true } } catch (error) { return result(error) } })
ipcMain.handle('printers:refresh', async (_event, id: string) => client.snapshot(await store.get(id)))
ipcMain.handle('printers:refresh-all', async () => Promise.all((await store.list()).filter((printer) => printer.enabled).map((printer) => client.snapshot(printer))))
ipcMain.handle('files:delete', async (_event, id: string, fileName: string) => {
  try { await client.command(await store.get(id), `/file/delete/${encodeURIComponent(fileName)}`); return { ok: true, message: 'Dosya silindi.' } }
  catch (error) { return result(error) }
})
ipcMain.handle('files:print', async (_event, id: string, fileName: string) => {
  try { await client.command(await store.get(id), `/file/print/${encodeURIComponent(fileName)}`); return { ok: true, message: 'Yazdırma işi başlatıldı.' } }
  catch (error) { return result(error) }
})
ipcMain.handle('jobs:control', async (_event, id: string, jobId: string, action: 'toggle' | 'stop') => {
  try { await client.command(await store.get(id), `/job/${action}/${encodeURIComponent(jobId)}`); return { ok: true, message: action === 'stop' ? 'Yazdırma durduruldu.' : 'Yazdırma durumu değiştirildi.' } }
  catch (error) { return result(error) }
})
ipcMain.handle('files:choose-upload', async (event, id: string) => {
  const selection = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Nova3D dilim dosyaları', extensions: ['cws'] }, { name: 'Tüm dosyalar', extensions: ['*'] }] })
  if (selection.canceled || !selection.filePaths[0]) return { ok: false, message: 'Dosya seçilmedi.' }
  const filePath = selection.filePaths[0]
  try {
    await client.upload(await store.get(id), filePath, (percent) => event.sender.send('upload:progress', { printerId: id, fileName: filePath.split(/[\\/]/).pop() ?? '', percent }))
    return { ok: true, message: 'Dosya yazıcıya yüklendi.' }
  } catch (error) { return result(error) }
})

app.whenReady().then(() => { createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() }) })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
