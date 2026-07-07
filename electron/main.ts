import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SavePrinterInput } from '../src/shared/types.js'
import { NovaClient } from './nova-client.js'
import { PrintCompletionTracker } from './print-completion.js'
import { PrinterStore } from './store.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const store = new PrinterStore()
const client = new NovaClient()
const completionTracker = new PrintCompletionTracker()
const hasSingleInstanceLock = app.requestSingleInstanceLock()
let mainWindow: BrowserWindow | undefined

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function observePrintCompletion(snapshot: Awaited<ReturnType<NovaClient['snapshot']>>) {
  const completed = completionTracker.observe(snapshot)
  if (!completed || !Notification.isSupported()) return
  const english = !app.getLocale().toLowerCase().startsWith('tr')
  shell.beep()
  const notification = new Notification({
    title: english ? 'Print completed' : 'Baskı tamamlandı',
    body: english
      ? `${completed.jobName} finished on ${completed.printerName}.`
      : `${completed.jobName}, ${completed.printerName} üzerinde tamamlandı.`,
    silent: true,
  })
  notification.on('click', focusMainWindow)
  notification.show()
}

function errorHtml(title: string, detail: string) {
  return `<!doctype html><html lang="tr"><head><meta charset="UTF-8"><title>Nova Fleet</title><style>
    body{margin:0;background:#0d0f0f;color:#eef4ef;font-family:Segoe UI,Arial,sans-serif;display:grid;place-items:center;min-height:100vh}
    main{max-width:760px;padding:34px;border:1px solid #28322c;border-radius:14px;background:#131715;box-shadow:0 18px 70px rgba(0,0,0,.35)}
    h1{margin:0 0 12px;font-size:24px}p{color:#aab5ae;line-height:1.55}pre{white-space:pre-wrap;background:#0b0d0d;border:1px solid #252b27;border-radius:10px;padding:14px;color:#f2c069;overflow:auto}
  </style></head><body><main><h1>${title}</h1><p>Uygulama siyah ekranda kalmasın diye hata yakalayıcı devreye girdi.</p><pre>${detail.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))}</pre></main></body></html>`
}

async function loadRenderer(window: BrowserWindow) {
  window.webContents.on('render-process-gone', (_event, details) => {
    void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHtml('Renderer çöktü', JSON.stringify(details, null, 2)))}`)
  })
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHtml('Arayüz yüklenemedi', `${errorCode} - ${errorDescription}\n${validatedURL}`))}`)
  })
  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`)
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    await window.loadURL(process.env.VITE_DEV_SERVER_URL)
    return
  }

  const candidates = [
    join(__dirname, '../../dist/index.html'),
    join(app.getAppPath(), 'dist/index.html'),
  ]
  const indexFile = candidates.find((candidate) => existsSync(candidate))
  if (!indexFile) {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHtml('dist/index.html bulunamadı', candidates.join('\n')))}`)
    return
  }
  await window.loadFile(indexFile)
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#0d0f0f',
    titleBarStyle: 'hiddenInset',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  mainWindow = window
  window.on('closed', () => { if (mainWindow === window) mainWindow = undefined })
  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' } })
  void loadRenderer(window).catch((error) => {
    window.show()
    void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHtml('Nova Fleet başlatılamadı', error instanceof Error ? error.stack ?? error.message : String(error)))}`)
  })
}

function result(error: unknown) {
  return { ok: false, message: error instanceof Error ? error.message : 'Beklenmeyen bir hata oluştu.' }
}

ipcMain.handle('printers:list', () => store.list())
ipcMain.handle('printers:save', (_event, input: SavePrinterInput) => store.save(input))
ipcMain.handle('printers:remove', async (_event, id: string) => { try { await store.remove(id); return { ok: true } } catch (error) { return result(error) } })
ipcMain.handle('printers:refresh', async (_event, id: string) => {
  const snapshot = await client.snapshot(await store.get(id))
  observePrintCompletion(snapshot)
  return snapshot
})
ipcMain.handle('printers:refresh-all', async () => {
  const snapshots = await Promise.all((await store.list()).filter((printer) => printer.enabled).map((printer) => client.snapshot(printer)))
  snapshots.forEach(observePrintCompletion)
  return snapshots
})
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

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    focusMainWindow()
  })
  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('com.novafleet.desktop')
    createWindow()
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  })
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
