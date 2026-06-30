import { describe, expect, it } from 'vitest'
import { normalizeFile, normalizeJob } from './nova-client.js'

describe('Nova3D cevap normalizasyonu', () => {
  it('dosya adını ve uzantısını güvenli biçimde birleştirir', () => {
    expect(normalizeFile({ name: 'gearbox', extension: '.cws', size: 2048, modifiedDate: '2026-06-30' })).toEqual({
      name: 'gearbox', extension: 'cws', size: 2048, modifiedDate: '2026-06-30', fullName: 'gearbox.cws',
    })
    expect(normalizeFile({ name: 'ready.cws', extension: 'cws' }).fullName).toBe('ready.cws')
  })

  it('iş ilerlemesini katman sayılarından hesaplar ve yüzdeyi sınırlar', () => {
    expect(normalizeJob({ id: '42', totalSlices: 200, currentSlice: 50 }).progress).toBe(25)
    expect(normalizeJob({ totalSlices: 100, currentSlice: 120 }).progress).toBe(100)
    expect(normalizeJob({ totalSlices: 0, currentSlice: 3 }).progress).toBe(0)
  })
})
