import { describe, it, expect } from 'vitest'
import { getWorkerSchemaName, buildWorkerDatabaseUrl } from '../helpers/db'

describe('Database cleanup utilities', () => {
  describe('getWorkerSchemaName', () => {
    it('returns schema name for given worker ID', () => {
      expect(getWorkerSchemaName('1')).toBe('test_w_1')
      expect(getWorkerSchemaName('42')).toBe('test_w_42')
    })

    it('uses VITEST_WORKER_ID env var when no argument given', () => {
      const prev = process.env.VITEST_WORKER_ID
      process.env.VITEST_WORKER_ID = '7'
      expect(getWorkerSchemaName()).toBe('test_w_7')
      process.env.VITEST_WORKER_ID = prev
    })

    it('strips non-numeric characters from worker ID', () => {
      expect(getWorkerSchemaName('worker_3')).toBe('test_w_3')
    })
  })

  describe('buildWorkerDatabaseUrl', () => {
    it('appends schema parameter to URL', () => {
      const url = buildWorkerDatabaseUrl(
        'postgresql://user:pass@localhost:5432/db',
        'test_w_1',
      )
      expect(url).toContain('schema=test_w_1')
    })

    it('preserves existing query parameters', () => {
      const url = buildWorkerDatabaseUrl(
        'postgresql://user:pass@localhost:5432/db?sslmode=require',
        'test_w_1',
      )
      expect(url).toContain('sslmode=require')
      expect(url).toContain('schema=test_w_1')
    })
  })
})
