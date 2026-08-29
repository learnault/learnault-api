import { describe, it, expect, vi, beforeEach } from 'vitest'
import { JobLeaseService } from '../../src/lib/transactions/job-lease.service'

function sqlOf(call: unknown[]): string {
  const [strings] = call as [TemplateStringsArray]

  return strings.join('?')
}

describe('JobLeaseService queue leases', () => {
  let queryRaw: ReturnType<typeof vi.fn>
  let executeRaw: ReturnType<typeof vi.fn>
  let service: JobLeaseService

  beforeEach(() => {
    queryRaw = vi.fn()
    executeRaw = vi.fn()
    service = new JobLeaseService({ $queryRaw: queryRaw, $executeRaw: executeRaw } as any)
  })

  describe('acquireQueueLease', () => {
    it('returns a token when the conditional upsert claims the queue', async () => {
      const leasedUntil = new Date(Date.now() + 60_000)
      queryRaw.mockResolvedValue([{ leasedUntil }])

      const lease = await service.acquireQueueLease({
        queueName: 'email',
        leaseMs: 60_000,
        owner: 'scheduler@host:1',
      })

      expect(lease).not.toBeNull()
      expect(lease!.queueName).toBe('email')
      expect(lease!.leasedUntil).toBe(leasedUntil)
      expect(lease!.leaseToken).toMatch(/^[0-9a-f-]{36}$/)
    })

    it('returns null when another holder still owns the lease', async () => {
      queryRaw.mockResolvedValue([])

      const lease = await service.acquireQueueLease({ queueName: 'email' })

      expect(lease).toBeNull()
    })

    it('gates the upsert on the database clock, not the caller clock', async () => {
      queryRaw.mockResolvedValue([{ leasedUntil: new Date() }])

      await service.acquireQueueLease({ queueName: 'webhook', leaseMs: 30_000 })

      const sql = sqlOf(queryRaw.mock.calls[0])
      expect(sql).toContain('ON CONFLICT ("queueName") DO UPDATE')
      expect(sql).toContain('"queue_leases"."leasedUntil" IS NULL')
      expect(sql).toContain('"queue_leases"."leasedUntil" <= now()')

      const values = queryRaw.mock.calls[0].slice(1)
      expect(values).toContain('webhook')
      expect(values).toContain('30000')
    })

    it('issues a distinct token per acquisition', async () => {
      queryRaw.mockResolvedValue([{ leasedUntil: new Date() }])

      const first = await service.acquireQueueLease({ queueName: 'email' })
      const second = await service.acquireQueueLease({ queueName: 'email' })

      expect(first!.leaseToken).not.toBe(second!.leaseToken)
    })
  })

  describe('renewQueueLease', () => {
    it('reports success only when the row still carries this token', async () => {
      executeRaw.mockResolvedValueOnce(1)
      await expect(service.renewQueueLease('email', 'token-a', 5_000)).resolves.toBe(true)

      executeRaw.mockResolvedValueOnce(0)
      await expect(service.renewQueueLease('email', 'stale-token')).resolves.toBe(false)

      const values = executeRaw.mock.calls[0].slice(1)
      expect(values).toContain('email')
      expect(values).toContain('token-a')
    })
  })

  describe('releaseQueueLease', () => {
    it('clears the lease scoped to the holding token', async () => {
      executeRaw.mockResolvedValue(1)

      await expect(service.releaseQueueLease('data-export', 'token-a')).resolves.toBe(true)

      const sql = sqlOf(executeRaw.mock.calls[0])
      expect(sql).toContain('"leaseToken" = NULL')
      expect(sql).toContain('"lastTickAt" = now()')
      expect(sql).toContain('AND "leaseToken" =')

      const values = executeRaw.mock.calls[0].slice(1)
      expect(values).toEqual(['data-export', 'token-a'])
    })

    it('does not release a lease a successor now holds', async () => {
      executeRaw.mockResolvedValue(0)

      await expect(service.releaseQueueLease('data-export', 'stale')).resolves.toBe(false)
    })
  })
})
