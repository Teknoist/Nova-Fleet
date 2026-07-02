import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity, AlertTriangle, Boxes, Check, ChevronDown, CircleStop, Clock3, FileBox,
  Gauge, HardDrive, LayoutDashboard, LoaderCircle, MapPin, Pause, Play, Plus,
  Printer, RefreshCw, Search, Settings, Trash2, Upload, Wifi, WifiOff, X, Zap,
} from 'lucide-react'
import { api } from './lib/api'
import type { PrinterConfig, PrinterSnapshot, SavePrinterInput } from './shared/types'

type View = 'overview' | 'printers' | 'files' | 'jobs' | 'settings'
type Toast = { id: number; kind: 'success' | 'error'; text: string }

const statusLabel = { online: 'Hazır', offline: 'Çevrimdışı', printing: 'Yazdırıyor', paused: 'Duraklatıldı', error: 'Hata' }

function formatBytes(value: number) {
  if (!value) return '0 MB'
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(0)} KB`
  return `${(value / 1024 ** 2).toFixed(value > 1024 ** 3 ? 0 : 1)} MB`
}

function formatDuration(ms = 0) {
  const seconds = Math.floor(ms / 1000)
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}sa ${m}dk`
}

function Empty({ text }: { text: string }) {
  return <div className="empty"><FileBox size={28} /><p>{text}</p></div>
}

function App() {
  const [view, setView] = useState<View>('overview')
  const [snapshots, setSnapshots] = useState<PrinterSnapshot[]>([])
  const [configs, setConfigs] = useState<PrinterConfig[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshingId, setRefreshingId] = useState<string>()
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<PrinterConfig | 'new' | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [upload, setUpload] = useState<{ printerId: string; fileName: string; percent: number }>()

  const toast = useCallback((text: string, kind: Toast['kind'] = 'success') => {
    const id = Date.now(); setToasts((current) => [...current, { id, text, kind }])
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 3200)
  }, [])

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true)
    try {
      const [printerConfigs, printerSnapshots] = await Promise.all([api.listPrinters(), api.refreshAll()])
      setConfigs(printerConfigs)
      setSnapshots(printerSnapshots)
      setSelectedId((current) => current ?? printerSnapshots[0]?.config.id)
    } catch (error) { toast(error instanceof Error ? error.message : 'Yazıcılar yenilenemedi.', 'error') }
    finally { setLoading(false); setRefreshing(false) }
  }, [toast])

  const refreshOne = useCallback(async (id: string) => {
    setRefreshingId(id)
    try {
      const snapshot = await api.refreshPrinter(id)
      setSnapshots((current) => current.map((item) => item.config.id === id ? snapshot : item))
      toast(`${snapshot.config.name} dosya listesi yenilendi.`)
    } catch (error) { toast(error instanceof Error ? error.message : 'Yazıcı yenilenemedi.', 'error') }
    finally { setRefreshingId(undefined) }
  }, [toast])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => api.onUploadProgress(setUpload), [])
  useEffect(() => {
    const intervals = configs.filter((item) => item.enabled).map((item) => item.pollInterval)
    if (!intervals.length) return
    const timer = window.setInterval(() => void refresh(true), Math.max(5, Math.min(...intervals)) * 1000)
    return () => window.clearInterval(timer)
  }, [configs, refresh])

  const selected = snapshots.find((item) => item.config.id === selectedId)
  const filtered = snapshots.filter(({ config }) => `${config.name} ${config.model} ${config.location}`.toLowerCase().includes(search.toLowerCase()))
  const online = snapshots.filter((item) => item.state !== 'offline').length
  const printing = snapshots.filter((item) => item.state === 'printing' || item.state === 'paused').length
  const queuedFiles = snapshots.reduce((sum, item) => sum + item.files.length, 0)
  const averageProgress = printing ? snapshots.reduce((sum, item) => sum + (item.activeJob?.progress ?? 0), 0) / printing : 0

  async function runAction(action: () => Promise<{ ok: boolean; message?: string }>, refreshAfter = true) {
    try {
      const response = await action()
      toast(response.message ?? (response.ok ? 'İşlem tamamlandı.' : 'İşlem başarısız.'), response.ok ? 'success' : 'error')
      if (response.ok && refreshAfter) await refresh(true)
    } catch (error) {
      toast(error instanceof Error ? error.message : 'İşlem başarısız.', 'error')
    }
  }

  async function savePrinter(input: SavePrinterInput) {
    await api.savePrinter(input); setModal(null); toast(input.id ? 'Yazıcı güncellendi.' : 'Yazıcı filoya eklendi.'); await refresh()
  }

  async function removePrinter(config: PrinterConfig) {
    if (!window.confirm(`“${config.name}” yazıcısını filodan kaldırmak istiyor musunuz?`)) return
    await runAction(() => api.removePrinter(config.id)); setSelectedId(undefined)
  }

  const title = ({ overview: 'Filo genel bakış', printers: 'Yazıcılar', files: 'Dosya merkezi', jobs: 'Yazdırma işleri', settings: 'Ayarlar' } as const)[view]

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><Boxes size={19} /></div><div><strong>NOVA</strong><span>FLEET</span></div></div>
        <nav>
          <NavItem active={view === 'overview'} icon={<LayoutDashboard />} label="Genel bakış" onClick={() => setView('overview')} />
          <NavItem active={view === 'printers'} icon={<Printer />} label="Yazıcılar" count={snapshots.length} onClick={() => setView('printers')} />
          <NavItem active={view === 'files'} icon={<FileBox />} label="Dosyalar" onClick={() => setView('files')} />
          <NavItem active={view === 'jobs'} icon={<Activity />} label="İşler" count={printing || undefined} onClick={() => setView('jobs')} />
        </nav>
        <div className="sidebar-spacer" />
        <nav><NavItem active={view === 'settings'} icon={<Settings />} label="Ayarlar" onClick={() => setView('settings')} /></nav>
        <div className="network-card"><span className="pulse-dot" /><div><strong>Yerel ağ</strong><small>{online}/{snapshots.length} yazıcı erişilebilir</small></div></div>
        <div className="sidebar-version">NOVA FLEET · v0.2.1</div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div><p className="eyebrow">ÇALIŞMA ALANI / <span>{title.toUpperCase()}</span></p><h1>{title}</h1></div>
          <div className="top-actions">
            <button className="icon-button" title="Tümünü yenile" onClick={() => void refresh()} disabled={refreshing}><RefreshCw className={refreshing ? 'spin' : ''} size={18} /></button>
            <button className="primary-button" onClick={() => setModal('new')}><Plus size={17} /> Yazıcı ekle</button>
          </div>
        </header>

        {loading ? <div className="loading"><LoaderCircle className="spin" /><span>Filo taranıyor…</span></div> : (
          <div className="content">
            {view === 'overview' && <Overview snapshots={filtered} online={online} printing={printing} queuedFiles={queuedFiles} averageProgress={averageProgress} search={search} setSearch={setSearch} setSelected={(id) => { setSelectedId(id); setView('printers') }} uploadFile={(id) => void runAction(() => api.chooseAndUpload(id))} />}
            {view === 'printers' && <Printers snapshots={filtered} selected={selected} search={search} setSearch={setSearch} setSelectedId={setSelectedId} edit={(config) => setModal(config)} remove={removePrinter} uploadFile={(id) => void runAction(() => api.chooseAndUpload(id))} refreshFileList={(id) => void refreshOne(id)} refreshingId={refreshingId} printFile={(id, name) => void runAction(() => api.printFile(id, name))} deleteFile={(id, name) => { if (window.confirm(`“${name}” silinsin mi?`)) void runAction(() => api.deleteFile(id, name)) }} control={(id, jobId, action) => void runAction(() => api.controlJob(id, jobId, action))} />}
            {view === 'files' && <FilesView snapshots={snapshots} selectedId={selectedId} setSelectedId={setSelectedId} uploadFile={(id) => void runAction(() => api.chooseAndUpload(id))} refreshFileList={(id) => void refreshOne(id)} refreshingId={refreshingId} printFile={(id, name) => void runAction(() => api.printFile(id, name))} deleteFile={(id, name) => { if (window.confirm(`“${name}” silinsin mi?`)) void runAction(() => api.deleteFile(id, name)) }} />}
            {view === 'jobs' && <JobsView snapshots={snapshots} control={(id, jobId, action) => void runAction(() => api.controlJob(id, jobId, action))} />}
            {view === 'settings' && <SettingsView configs={configs} edit={setModal} />}
          </div>
        )}
      </main>
      <nav className="mobile-nav" aria-label="Mobil menü">
        <MobileNavItem active={view === 'overview'} icon={<LayoutDashboard />} label="Genel" onClick={() => setView('overview')} />
        <MobileNavItem active={view === 'printers'} icon={<Printer />} label="Yazıcılar" onClick={() => setView('printers')} />
        <MobileNavItem active={view === 'files'} icon={<FileBox />} label="Dosyalar" onClick={() => setView('files')} />
        <MobileNavItem active={view === 'jobs'} icon={<Activity />} label="İşler" onClick={() => setView('jobs')} />
        <MobileNavItem active={view === 'settings'} icon={<Settings />} label="Ayarlar" onClick={() => setView('settings')} />
      </nav>
      {modal && <PrinterModal value={modal === 'new' ? undefined : modal} close={() => setModal(null)} save={savePrinter} />}
      {upload && upload.percent < 100 && <div className="upload-toast"><Upload size={18} /><div><strong>{upload.fileName}</strong><span>Yükleniyor · %{upload.percent}</span><div className="mini-progress"><i style={{ width: `${upload.percent}%` }} /></div></div></div>}
      <div className="toast-stack">{toasts.map((item) => <div className={`toast ${item.kind}`} key={item.id}>{item.kind === 'success' ? <Check /> : <AlertTriangle />}<span>{item.text}</span></div>)}</div>
    </div>
  )
}

function NavItem({ active, icon, label, count, onClick }: { active: boolean; icon: React.ReactNode; label: string; count?: number; onClick: () => void }) {
  return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}><span>{icon}</span>{label}{count !== undefined && <b>{count}</b>}</button>
}

function MobileNavItem({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return <button className={active ? 'active' : ''} onClick={onClick}><span>{icon}</span><small>{label}</small></button>
}

function Overview({ snapshots, online, printing, queuedFiles, averageProgress, search, setSearch, setSelected, uploadFile }: { snapshots: PrinterSnapshot[]; online: number; printing: number; queuedFiles: number; averageProgress: number; search: string; setSearch: (v: string) => void; setSelected: (id: string) => void; uploadFile: (id: string) => void }) {
  return <>
    <section className="metric-grid">
      <Metric icon={<Wifi />} label="Çevrimiçi" value={`${online}/${snapshots.length}`} note="Filo erişimi" tone="mint" />
      <Metric icon={<Zap />} label="Aktif baskı" value={String(printing)} note={printing ? `Ort. %${averageProgress.toFixed(0)} tamamlandı` : 'Bekleyen iş yok'} tone="amber" />
      <Metric icon={<FileBox />} label="Hazır dosya" value={String(queuedFiles)} note="Tüm yazıcılarda" tone="blue" />
      <Metric icon={<Gauge />} label="Erişim oranı" value={`${Math.round((online / Math.max(1, snapshots.length)) * 100)}%`} note="Anlık bağlantı" tone="purple" />
    </section>
    <section className="section-heading"><div><p className="section-kicker">CANLI DURUM</p><h2>Yazıcı filosu</h2></div><div className="search"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Yazıcı ara" /></div></section>
    <div className="printer-grid">{snapshots.map((snapshot) => <PrinterCard key={snapshot.config.id} snapshot={snapshot} open={() => setSelected(snapshot.config.id)} upload={() => uploadFile(snapshot.config.id)} />)}</div>
  </>
}

function Metric({ icon, label, value, note, tone }: { icon: React.ReactNode; label: string; value: string; note: string; tone: string }) {
  return <div className="metric"><div className={`metric-icon ${tone}`}>{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{note}</small></div></div>
}

function PrinterCard({ snapshot, open, upload }: { snapshot: PrinterSnapshot; open: () => void; upload: () => void }) {
  const { config, activeJob } = snapshot
  return <article className={`printer-card ${snapshot.state}`} onClick={open}>
    <div className="card-top"><div className="printer-art"><Printer /></div><div className="card-menu"><span className={`status ${snapshot.state}`}><i />{statusLabel[snapshot.state]}</span></div></div>
    <div className="printer-identity"><h3>{config.name}</h3><p>{config.model}</p><span><MapPin size={13} />{config.location || 'Konum belirtilmedi'}</span></div>
    {activeJob ? <div className="job-box"><div><span>{activeJob.jobName}</span><b>%{activeJob.progress.toFixed(1)}</b></div><div className="progress"><i style={{ width: `${activeJob.progress}%` }} /></div><div className="job-meta"><span>Katman {activeJob.currentSlice} / {activeJob.totalSlices}</span><span>~{formatDuration((activeJob.totalSlices - activeJob.currentSlice) * activeJob.averageSliceTime)}</span></div></div> : snapshot.state === 'offline' ? <div className="offline-box"><WifiOff size={17} /><span>{snapshot.error ?? 'Bağlantı kurulamadı'}</span></div> : <div className="ready-box"><div><span>Depolama</span><strong>{formatBytes(snapshot.usedBytes)}</strong></div><div><span>Dosyalar</span><strong>{snapshot.files.length}</strong></div><div><span>Gecikme</span><strong>{snapshot.latency} ms</strong></div></div>}
    <div className="card-footer"><span>{config.host}:{config.port}</span><button onClick={(e) => { e.stopPropagation(); upload() }} disabled={snapshot.state === 'offline'}><Upload size={15} /> Dosya yükle</button></div>
  </article>
}

function Printers({ snapshots, selected, search, setSearch, setSelectedId, edit, remove, uploadFile, refreshFileList, refreshingId, printFile, deleteFile, control }: { snapshots: PrinterSnapshot[]; selected?: PrinterSnapshot; search: string; setSearch: (v: string) => void; setSelectedId: (id: string) => void; edit: (c: PrinterConfig) => void; remove: (c: PrinterConfig) => void; uploadFile: (id: string) => void; refreshFileList: (id: string) => void; refreshingId?: string; printFile: (id: string, name: string) => void; deleteFile: (id: string, name: string) => void; control: (id: string, jobId: string, action: 'toggle' | 'stop') => void }) {
  return <div className="split-view"><section className="fleet-list"><div className="list-tools"><div className="search"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filoda ara" /></div></div>{snapshots.map((snapshot) => <button key={snapshot.config.id} className={`fleet-row ${selected?.config.id === snapshot.config.id ? 'selected' : ''}`} onClick={() => setSelectedId(snapshot.config.id)}><span className={`device-icon ${snapshot.state}`}><Printer /></span><span className="fleet-name"><strong>{snapshot.config.name}</strong><small>{snapshot.config.model} · {snapshot.config.host}</small></span><span className={`status ${snapshot.state}`}><i />{statusLabel[snapshot.state]}</span><ChevronDown className="row-arrow" size={16} /></button>)}</section>{selected ? <PrinterDetail snapshot={selected} edit={edit} remove={remove} uploadFile={uploadFile} refreshFileList={refreshFileList} refreshing={refreshingId === selected.config.id} printFile={printFile} deleteFile={deleteFile} control={control} /> : <div className="panel detail-placeholder"><Printer /><p>Detaylarını görmek için bir yazıcı seçin.</p></div>}</div>
}

function PrinterDetail({ snapshot, edit, remove, uploadFile, refreshFileList, refreshing, printFile, deleteFile, control }: { snapshot: PrinterSnapshot; edit: (c: PrinterConfig) => void; remove: (c: PrinterConfig) => void; uploadFile: (id: string) => void; refreshFileList: (id: string) => void; refreshing: boolean; printFile: (id: string, name: string) => void; deleteFile: (id: string, name: string) => void; control: (id: string, jobId: string, action: 'toggle' | 'stop') => void }) {
  const { config, activeJob } = snapshot
  return <section className="panel printer-detail"><div className="detail-header"><div className="detail-avatar"><Printer /></div><div><span className={`status ${snapshot.state}`}><i />{statusLabel[snapshot.state]}</span><h2>{config.name}</h2><p>{config.model} · {config.location}</p></div><div className="detail-actions"><button className="icon-button" title="Dosya listesini yenile" onClick={() => refreshFileList(config.id)} disabled={refreshing}><RefreshCw className={refreshing ? 'spin' : ''} size={17} /></button><button className="icon-button" onClick={() => edit(config)}><Settings size={17} /></button><button className="icon-button danger" onClick={() => remove(config)}><Trash2 size={17} /></button></div></div><div className="detail-stats"><div><span>Adres</span><strong>{config.host}:{config.port}</strong></div><div><span>Yanıt</span><strong>{snapshot.latency ? `${snapshot.latency} ms` : '—'}</strong></div><div><span>Firmware</span><strong>{snapshot.firmware ?? 'Bilinmiyor'}</strong></div><div><span>Dosya alanı</span><strong>{formatBytes(snapshot.usedBytes)}</strong></div></div>{snapshot.error && snapshot.state !== 'offline' && <div className="offline-box"><AlertTriangle size={17} /><span>{snapshot.error}</span></div>}{activeJob && <div className="active-job"><div className="active-job-head"><div><p className="section-kicker">AKTİF YAZDIRMA</p><h3>{activeJob.jobName}</h3></div><strong>%{activeJob.progress.toFixed(1)}</strong></div><div className="progress large"><i style={{ width: `${activeJob.progress}%` }} /></div><div className="job-stat-grid"><div><span>Katman</span><b>{activeJob.currentSlice} / {activeJob.totalSlices}</b></div><div><span>Katman kalınlığı</span><b>{activeJob.thickness} mm</b></div><div><span>Geçen süre</span><b>{formatDuration(activeJob.elapsedTime)}</b></div></div><div className="job-controls"><button className="secondary-button" onClick={() => control(config.id, activeJob.id, 'toggle')}>{snapshot.state === 'paused' ? <Play size={16} /> : <Pause size={16} />}{snapshot.state === 'paused' ? 'Sürdür' : 'Duraklat'}</button><button className="danger-button" onClick={() => control(config.id, activeJob.id, 'stop')}><CircleStop size={16} /> İşi durdur</button></div></div>}<div className="file-title"><div><p className="section-kicker">YAZICI DEPOSU</p><h3>Dosyalar <span>{snapshot.files.length}</span></h3></div><div className="toolbar-actions"><button className="secondary-button" onClick={() => refreshFileList(config.id)} disabled={refreshing}><RefreshCw className={refreshing ? 'spin' : ''} size={16} /> Dosya listesini yenile</button><button className="secondary-button" onClick={() => uploadFile(config.id)} disabled={snapshot.state === 'offline'}><Upload size={16} /> Yükle</button></div></div><FileTable snapshot={snapshot} printFile={printFile} deleteFile={deleteFile} /></section>
}

function FileTable({ snapshot, printFile, deleteFile }: { snapshot: PrinterSnapshot; printFile: (id: string, name: string) => void; deleteFile: (id: string, name: string) => void }) {
  if (!snapshot.files.length) return <Empty text={snapshot.state === 'offline' ? 'Yazıcı çevrimdışı.' : 'Bu yazıcıda dosya yok.'} />
  return <div className="file-table"><div className="file-row file-head"><span>Dosya</span><span>Boyut</span><span>Değiştirilme</span><span /></div>{snapshot.files.map((file) => <div className="file-row" key={file.fullName}><span className="file-name"><FileBox size={18} /><span><strong>{file.fullName}</strong><small>{file.extension.toUpperCase()} dilim dosyası</small></span></span><span>{formatBytes(file.size)}</span><span>{file.modifiedDate ? file.modifiedDate : '—'}</span><span className="file-actions"><button title="Yazdır" onClick={() => printFile(snapshot.config.id, file.fullName)}><Play size={15} /></button><button title="Sil" onClick={() => deleteFile(snapshot.config.id, file.fullName)}><Trash2 size={15} /></button></span></div>)}</div>
}

function FilesView({ snapshots, selectedId, setSelectedId, uploadFile, refreshFileList, refreshingId, printFile, deleteFile }: { snapshots: PrinterSnapshot[]; selectedId?: string; setSelectedId: (id: string) => void; uploadFile: (id: string) => void; refreshFileList: (id: string) => void; refreshingId?: string; printFile: (id: string, name: string) => void; deleteFile: (id: string, name: string) => void }) {
  const selected = snapshots.find((item) => item.config.id === selectedId) ?? snapshots[0]
  return <section className="panel files-page"><div className="page-toolbar"><div><p className="section-kicker">MERKEZİ DOSYA YÖNETİMİ</p><h2>Yazıcı deposu</h2></div><div className="toolbar-actions"><select value={selected?.config.id} onChange={(e) => setSelectedId(e.target.value)}>{snapshots.map((item) => <option key={item.config.id} value={item.config.id}>{item.config.name}</option>)}</select><button className="secondary-button" disabled={!selected || refreshingId === selected.config.id} onClick={() => selected && refreshFileList(selected.config.id)}><RefreshCw className={selected && refreshingId === selected.config.id ? 'spin' : ''} size={16} /> Dosya listesini yenile</button><button className="primary-button" disabled={!selected || selected.state === 'offline'} onClick={() => selected && uploadFile(selected.config.id)}><Upload size={16} /> Dosya yükle</button></div></div>{selected ? <FileTable snapshot={selected} printFile={printFile} deleteFile={deleteFile} /> : <Empty text="Filoda yazıcı bulunmuyor." />}</section>
}

function JobsView({ snapshots, control }: { snapshots: PrinterSnapshot[]; control: (id: string, jobId: string, action: 'toggle' | 'stop') => void }) {
  const jobs = snapshots.filter((item) => item.activeJob)
  return <><div className="jobs-hero"><div><p className="section-kicker">CANLI KUYRUK</p><h2>{jobs.length ? `${jobs.length} aktif yazdırma` : 'Filo şu anda boşta'}</h2><p>Tüm makinelerdeki işleri tek ekrandan izleyin ve yönetin.</p></div><Activity size={58} /></div><div className="job-list">{jobs.map((item) => { const job = item.activeJob!; return <div className="panel job-row-card" key={job.id}><div className="job-device"><span className={`device-icon ${item.state}`}><Printer /></span><div><strong>{item.config.name}</strong><small>{job.jobName}</small></div></div><div className="job-progress-inline"><div><span>Katman {job.currentSlice} / {job.totalSlices}</span><b>%{job.progress.toFixed(1)}</b></div><div className="progress"><i style={{ width: `${job.progress}%` }} /></div></div><div className="job-time"><Clock3 /><span>Kalan<strong>{formatDuration((job.totalSlices - job.currentSlice) * job.averageSliceTime)}</strong></span></div><div className="file-actions"><button onClick={() => control(item.config.id, job.id, 'toggle')}>{item.state === 'paused' ? <Play /> : <Pause />}</button><button onClick={() => control(item.config.id, job.id, 'stop')}><CircleStop /></button></div></div>})}{!jobs.length && <Empty text="Aktif yazdırma işi bulunmuyor." />}</div></>
}

function SettingsView({ configs, edit }: { configs: PrinterConfig[]; edit: (config: PrinterConfig) => void }) {
  return <div className="settings-grid"><section className="panel settings-card"><p className="section-kicker">BAĞLANTI POLİTİKASI</p><h2>Nova3D uyum modu</h2><p>Firmware 2.1.6 için /file/list bağlantı testi olarak kullanılır. /job/list/ hata verirse yazıcı çevrimdışı sayılmaz.</p><div className="setting-list"><span><Activity />İş listesi toleransı <b>Açık</b></span><span><Wifi />Yerel ağ bağlantısı <b>HTTP :8081</b></span><span><HardDrive />Ayar deposu <b>Yerel</b></span></div></section><section className="panel settings-card"><p className="section-kicker">FİLO AYARLARI</p><h2>Yazıcı profilleri</h2>{configs.map((config) => <button className="settings-printer" key={config.id} onClick={() => edit(config)}><Printer /><span><strong>{config.name}</strong><small>{config.host}:{config.port} · {config.pollInterval} sn</small></span><Settings /></button>)}</section></div>
}

function PrinterModal({ value, close, save }: { value?: PrinterConfig; close: () => void; save: (input: SavePrinterInput) => Promise<void> }) {
  const initial = useMemo<SavePrinterInput>(() => value ?? { name: '', host: '', port: 8081, model: 'Nova3D Bene4', location: '', pollInterval: 10, enabled: true }, [value])
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)
  const field = (key: keyof SavePrinterInput, next: string | number | boolean) => setForm((current) => ({ ...current, [key]: next }))
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !saving) close() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [close, saving])

  return <div className="modal-backdrop" role="presentation" onClick={(e) => e.target === e.currentTarget && close()}><form className="modal" role="dialog" aria-modal="true" aria-labelledby="printer-modal-title" onSubmit={(e) => { e.preventDefault(); setSaving(true); void save(form).finally(() => setSaving(false)) }}><div className="modal-head"><div><p className="section-kicker">{value ? 'PROFİLİ DÜZENLE' : 'FİLOYA EKLE'}</p><h2 id="printer-modal-title">{value ? value.name : 'Yeni yazıcı'}</h2></div><button type="button" className="icon-button" aria-label="Pencereyi kapat" onClick={close}><X /></button></div><div className="form-grid"><label className="full"><span>Görünen ad</span><input autoFocus autoComplete="off" required value={form.name} onChange={(e) => field('name', e.target.value)} placeholder="Örn. Bene4" /></label><label><span>IP adresi / sunucu</span><input autoComplete="off" inputMode="url" required value={form.host} onChange={(e) => field('host', e.target.value)} placeholder="192.168.0.125" /></label><label><span>Port</span><input inputMode="numeric" type="number" min="1" max="65535" value={form.port} onChange={(e) => field('port', Number(e.target.value))} /></label><label><span>Model</span><select value={form.model} onChange={(e) => field('model', e.target.value)}><option>Nova3D Elfin</option><option>Nova3D Bene4</option><option>Nova3D Whale3</option><option>L3130-K40-</option><option>Diğer Nova3D</option></select></label><label><span>Konum</span><input autoComplete="off" value={form.location} onChange={(e) => field('location', e.target.value)} placeholder="Örn. Prototip Atölyesi" /></label><label className="full"><span>Sorgulama aralığı</span><div className="range-row"><input type="range" min="5" max="60" value={form.pollInterval} onChange={(e) => field('pollInterval', Number(e.target.value))} /><b>{form.pollInterval} sn</b></div><small>Eski firmware sürümlerinde 10 saniye veya üzeri önerilir.</small></label></div><div className="modal-footer"><button type="button" className="secondary-button" onClick={close}>Vazgeç</button><button className="primary-button" disabled={saving}>{saving && <LoaderCircle className="spin" />} {value ? 'Değişiklikleri kaydet' : 'Yazıcıyı ekle'}</button></div></form></div>
}

export default App
