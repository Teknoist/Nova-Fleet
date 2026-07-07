import type { PrinterSnapshot } from '../src/shared/types.js'

export type CompletedPrint = {
  printerName: string
  jobName: string
}

type ActivePrint = CompletedPrint & { jobId: string }

const completedStatuses = ['completed', 'complete', 'finished', 'done']

export class PrintCompletionTracker {
  private active = new Map<string, ActivePrint>()

  observe(snapshot: PrinterSnapshot): CompletedPrint | undefined {
    const printerId = snapshot.config.id
    const previous = this.active.get(printerId)
    const current = snapshot.activeJob

    if (current) {
      this.active.set(printerId, {
        jobId: current.id,
        jobName: current.jobName,
        printerName: snapshot.config.name,
      })
    }

    if (!previous || previous.jobId === current?.id) return undefined
    if (snapshot.state === 'offline') return undefined

    const finished = snapshot.recentJobs?.find((job) => job.id === previous.jobId)
    if (!finished) return undefined

    if (!current) this.active.delete(printerId)
    const status = finished.status.trim().toLowerCase()
    if (!completedStatuses.some((value) => status.includes(value))) return undefined

    return { printerName: previous.printerName, jobName: previous.jobName }
  }
}
