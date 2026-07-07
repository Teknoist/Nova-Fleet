import { describe, expect, it } from 'vitest'
import type { PrintJob, PrinterSnapshot } from '../src/shared/types'
import { PrintCompletionTracker } from './print-completion'

const job = (status = 'Printing'): PrintJob => ({
  id: 'job-1', jobName: 'model.CWS', printInProgress: status === 'Printing', printPaused: false,
  status, thickness: 0.05, totalSlices: 100, currentSlice: status === 'Completed' ? 100 : 50,
  currentSliceTime: 10_000, averageSliceTime: 10_000, elapsedTime: 500_000, progress: status === 'Completed' ? 100 : 50,
})

const snapshot = (activeJob?: PrintJob, recentJobs: PrintJob[] = [], state: PrinterSnapshot['state'] = activeJob ? 'printing' : 'online'): PrinterSnapshot => ({
  config: { id: 'printer-1', name: 'Office Printer', host: '192.168.1.50', port: 8081, model: 'Nova3D', location: '', pollInterval: 10, enabled: true },
  state, files: [], usedBytes: 0, activeJob, recentJobs,
})

describe('PrintCompletionTracker', () => {
  it('notifies exactly once when an observed active job completes', () => {
    const tracker = new PrintCompletionTracker()
    expect(tracker.observe(snapshot(job()))).toBeUndefined()
    expect(tracker.observe(snapshot(undefined, [job('Completed')]))).toEqual({ printerName: 'Office Printer', jobName: 'model.CWS' })
    expect(tracker.observe(snapshot(undefined, [job('Completed')]))).toBeUndefined()
  })

  it('does not report stopped jobs or temporary offline states as completed', () => {
    const tracker = new PrintCompletionTracker()
    tracker.observe(snapshot(job()))
    expect(tracker.observe(snapshot(undefined, [], 'offline'))).toBeUndefined()
    expect(tracker.observe(snapshot(undefined, [job('Stopped')]))).toBeUndefined()
  })
})
