import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/config/database', () => ({
  default: {
    auditEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock('../../src/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import prisma from '../../src/config/database'
import logger from '../../src/utils/logger'
import {
  AUDIT_PURGE_SETTING,
  AuditEventService,
} from '../../src/audit/audit-event.service'
import { REDACTED } from '../../src/audit/redaction'
import { ActorType, RecordClass } from '../../src/audit/types'

describe('AuditEventService', () => {
  let service: AuditEventService

  beforeEach(() => {
    vi.resetAllMocks()
    service = new AuditEventService()
  })

  describe('attribution', () => {
    it('records actor, action, target, reason and request id', () => {
      const row = service.toRow({
        action: 'account.deactivated',
        actor: { type: ActorType.ADMIN, id: 'admin-1', role: 'ADMIN' },
        target: { type: 'User', id: 'user-9' },
        reason: 'support request #4821',
        requestId: 'req-abc',
        source: 'api.account.deactivate',
      })

      expect(row).toMatchObject({
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorRole: 'ADMIN',
        action: 'account.deactivated',
        targetType: 'User',
        targetId: 'user-9',
        reason: 'support request #4821',
        requestId: 'req-abc',
        source: 'api.account.deactivate',
      })
    })

    it('distinguishes the actor from the target, so acting-on-behalf-of is visible', () => {
      const row = service.toRow({
        action: 'account.deactivated',
        actor: { type: ActorType.ADMIN, id: 'admin-1', role: 'ADMIN' },
        target: { type: 'User', id: 'learner-2' },
        reason: 'abuse report',
      })

      // The whole point of separate columns: "an admin deactivated a learner"
      // is a different event from "a learner deactivated themselves".
      expect(row.actorId).toBe('admin-1')
      expect(row.targetId).toBe('learner-2')
      expect(row.actorId).not.toBe(row.targetId)
    })

    it('accepts a SYSTEM actor with no id', () => {
      const row = service.toRow({
        action: 'export.purged',
        actor: { type: ActorType.SYSTEM, id: 'lifecycle-sweep' },
        target: { type: 'DataExportRequest', id: 'exp-1' },
      })

      expect(row.actorType).toBe('SYSTEM')
      expect(row.actorRole).toBeNull()
    })

    it('stamps the lifecycle class of the target from the matrix', () => {
      expect(
        service.toRow({
          action: 'transaction.created',
          actor: { type: ActorType.WORKER, id: 'reward' },
          target: { type: 'Transaction', id: 't-1' },
        }).recordClass,
      ).toBe(RecordClass.IMMUTABLE)

      expect(
        service.toRow({
          action: 'module.archived',
          actor: { type: ActorType.ADMIN, id: 'a-1' },
          target: { type: 'Module', id: 'm-1' },
        }).recordClass,
      ).toBe(RecordClass.ARCHIVABLE)
    })

    it('lets an explicit record class override the matrix', () => {
      expect(
        service.toRow({
          action: 'thing.changed',
          actor: { type: ActorType.SYSTEM },
          target: { type: 'Unknown' },
          recordClass: RecordClass.DELETABLE,
        }).recordClass,
      ).toBe(RecordClass.DELETABLE)
    })

    it('nulls every optional field rather than leaving it undefined', () => {
      const row = service.toRow({
        action: 'login.failed',
        actor: { type: ActorType.ANONYMOUS },
        target: { type: 'User' },
      })

      expect(row).toEqual({
        actorType: 'ANONYMOUS',
        actorId: null,
        actorRole: null,
        action: 'login.failed',
        recordClass: RecordClass.MUTABLE,
        targetType: 'User',
        targetId: null,
        reason: null,
        requestId: null,
        correlationId: null,
        source: null,
        metadata: null,
        actorIpHash: null,
        userAgentFamily: null,
      })
    })
  })

  describe('redaction on write', () => {
    it('never stores a raw IP address', () => {
      const row = service.toRow({
        action: 'login.succeeded',
        actor: { type: ActorType.USER, id: 'u-1' },
        target: { type: 'Session', id: 's-1' },
        ipAddress: '203.0.113.42',
      })

      expect(row.actorIpHash).not.toBeNull()
      expect(row.actorIpHash).not.toContain('203')
      expect(JSON.stringify(row)).not.toContain('203.0.113.42')
    })

    it('never stores a raw User-Agent', () => {
      const row = service.toRow({
        action: 'login.succeeded',
        actor: { type: ActorType.USER, id: 'u-1' },
        target: { type: 'Session', id: 's-1' },
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.6099.109',
      })

      expect(row.userAgentFamily).toBe('Chrome')
      expect(JSON.stringify(row)).not.toContain('Windows NT')
      expect(JSON.stringify(row)).not.toContain('6099')
    })

    it('redacts metadata secrets before they reach the row', () => {
      const row = service.toRow({
        action: 'wallet.exported',
        actor: { type: ActorType.USER, id: 'u-1' },
        target: { type: 'Wallet', id: 'w-1' },
        metadata: {
          walletId: 'w-1',
          secretSeed:
            'SBQWY3DNPFWGSZTFNV4WQZLBOJ7SFQNDBQFXHTOYIY5QYVCSFRCFUKPP',
          email: 'learner@example.com',
        },
      })

      expect(row.metadata).not.toContain('SBQWY3DN')
      expect(row.metadata).not.toContain('learner@example.com')
      expect(row.metadata).toContain(REDACTED)
      expect(JSON.parse(row.metadata!).walletId).toBe('w-1')
    })

    it('keeps the metadata parseable as JSON', () => {
      const row = service.toRow({
        action: 'wallet.status_changed',
        actor: { type: ActorType.WORKER, id: 'provisioning' },
        target: { type: 'Wallet', id: 'w-1' },
        metadata: { from: 'RESERVED', to: 'ACTIVE', attempt: 2 },
      })

      expect(JSON.parse(row.metadata!)).toEqual({
        from: 'RESERVED',
        to: 'ACTIVE',
        attempt: 2,
      })
    })
  })

  describe('record', () => {
    it('appends the event', async () => {
      vi.mocked(prisma.auditEvent.create).mockResolvedValue({} as never)

      await service.record({
        action: 'account.deactivated',
        actor: { type: ActorType.USER, id: 'u-1', role: 'LEARNER' },
        target: { type: 'User', id: 'u-1' },
      })

      expect(prisma.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'account.deactivated',
          actorId: 'u-1',
          targetType: 'User',
        }),
      })
    })

    it('swallows a write failure — standalone auditing must not break the caller', async () => {
      vi.mocked(prisma.auditEvent.create).mockRejectedValue(
        new Error('db down'),
      )

      await expect(
        service.record({
          action: 'login.failed',
          actor: { type: ActorType.ANONYMOUS },
          target: { type: 'User' },
        }),
      ).resolves.toBeUndefined()

      expect(logger.error).toHaveBeenCalled()
    })

    it('does not log the metadata when a write fails', async () => {
      vi.mocked(prisma.auditEvent.create).mockRejectedValue(
        new Error('db down'),
      )

      await service.record({
        action: 'login.failed',
        actor: { type: ActorType.ANONYMOUS },
        target: { type: 'User' },
        metadata: { attemptedEmail: 'learner@example.com' },
      })

      // The rejected metadata is the least safe thing to route into logs.
      const logged = JSON.stringify(vi.mocked(logger.error).mock.calls)
      expect(logged).not.toContain('learner@example.com')
      expect(logged).toContain('login.failed')
    })
  })

  describe('recordWithin', () => {
    it('writes through the given transaction client', async () => {
      const create = vi.fn().mockResolvedValue({})
      const tx = { auditEvent: { create } }

      await service.recordWithin(tx, {
        action: 'user.anonymized',
        actor: { type: ActorType.SYSTEM, id: 'deletion-sweep' },
        target: { type: 'User', id: 'u-1' },
      })

      expect(create).toHaveBeenCalledOnce()
      // Not the module-level client: the event must land in the caller's
      // transaction or its atomicity guarantee is worthless.
      expect(prisma.auditEvent.create).not.toHaveBeenCalled()
    })

    it('propagates a failure so the surrounding transaction rolls back', async () => {
      const tx = {
        auditEvent: {
          create: vi.fn().mockRejectedValue(new Error('constraint')),
        },
      }

      await expect(
        service.recordWithin(tx, {
          action: 'user.anonymized',
          actor: { type: ActorType.SYSTEM, id: 'sweep' },
          target: { type: 'User', id: 'u-1' },
        }),
      ).rejects.toThrow('constraint')
    })
  })

  describe('immutability', () => {
    it('exposes no way to update or delete a single event', () => {
      const surface = [
        ...Object.getOwnPropertyNames(AuditEventService.prototype),
        ...Object.keys(service),
      ]

      // The database trigger is the real enforcement; this asserts the service
      // offers no API that would tempt a caller to try.
      expect(surface).not.toContain('update')
      expect(surface).not.toContain('delete')
      expect(surface).not.toContain('deleteMany')
      expect(surface).not.toContain('redact')
      expect(surface).not.toContain('scrub')
    })

    it('never calls a mutating Prisma operation on audit events', async () => {
      const auditEvent = prisma.auditEvent as unknown as Record<string, unknown>

      expect(auditEvent.update).toBeUndefined()
      expect(auditEvent.delete).toBeUndefined()
      expect(auditEvent.updateMany).toBeUndefined()
    })
  })

  describe('purgeExpired', () => {
    it('sets the purge session variable the trigger checks, then deletes by cutoff', async () => {
      const executeRawUnsafe = vi.fn().mockResolvedValue(0)
      const executeRaw = vi.fn().mockResolvedValue(12)

      vi.mocked(prisma.$transaction).mockImplementation((async (
        callback: (tx: unknown) => Promise<number>,
      ) =>
        callback({
          $executeRawUnsafe: executeRawUnsafe,
          $executeRaw: executeRaw,
        })) as never)

      const deleted = await service.purgeExpired(
        new Date('2026-08-24T00:00:00.000Z'),
      )

      expect(deleted).toBe(12)
      expect(executeRawUnsafe).toHaveBeenCalledWith(
        `SET LOCAL "${AUDIT_PURGE_SETTING}" = 'on'`,
      )
      expect(executeRaw).toHaveBeenCalledOnce()
    })

    it('deletes by timestamp only, so no single event can be targeted', async () => {
      const executeRaw = vi.fn().mockResolvedValue(0)

      vi.mocked(prisma.$transaction).mockImplementation((async (
        callback: (tx: unknown) => Promise<number>,
      ) =>
        callback({
          $executeRawUnsafe: vi.fn(),
          $executeRaw: executeRaw,
        })) as never)

      await service.purgeExpired(new Date('2026-08-24T00:00:00.000Z'))

      // The tagged-template call carries the SQL fragments as its first
      // argument; assert the predicate is the retention cutoff and nothing else.
      const fragments = (executeRaw.mock.calls[0][0] as string[]).join('?')

      expect(fragments).toContain('DELETE FROM "audit_events"')
      expect(fragments).toContain('"occurredAt" <')
      expect(fragments).not.toContain('"id"')
    })

    it('returns 0 and logs instead of throwing when the purge fails', async () => {
      vi.mocked(prisma.$transaction).mockRejectedValue(new Error('deadlock'))

      await expect(service.purgeExpired()).resolves.toBe(0)
      expect(logger.error).toHaveBeenCalled()
    })
  })

  describe('list', () => {
    it('filters by actor, target and window, newest first', async () => {
      vi.mocked(prisma.auditEvent.findMany).mockResolvedValue([] as never)

      const from = new Date('2026-08-01T00:00:00.000Z')
      const to = new Date('2026-08-24T00:00:00.000Z')

      await service.list({ actorId: 'admin-1', targetType: 'User', from, to })

      expect(prisma.auditEvent.findMany).toHaveBeenCalledWith({
        where: {
          actorId: 'admin-1',
          targetType: 'User',
          occurredAt: { gte: from, lte: to },
        },
        orderBy: { occurredAt: 'desc' },
        take: 50,
        skip: 0,
      })
    })

    it('omits absent filters rather than sending undefined predicates', async () => {
      vi.mocked(prisma.auditEvent.findMany).mockResolvedValue([] as never)

      await service.list()

      expect(prisma.auditEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      )
    })

    it('caps the page size so the whole trail cannot be pulled at once', async () => {
      vi.mocked(prisma.auditEvent.findMany).mockResolvedValue([] as never)

      await service.list({ take: 100_000 })

      expect(prisma.auditEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 200 }),
      )
    })

    it('rejects a non-positive page size', async () => {
      vi.mocked(prisma.auditEvent.findMany).mockResolvedValue([] as never)

      await service.list({ take: 0 })

      expect(prisma.auditEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 1 }),
      )
    })
  })

  describe('historyFor', () => {
    it('returns one record history oldest first', async () => {
      vi.mocked(prisma.auditEvent.findMany).mockResolvedValue([] as never)

      await service.historyFor('Wallet', 'w-1')

      expect(prisma.auditEvent.findMany).toHaveBeenCalledWith({
        where: { targetType: 'Wallet', targetId: 'w-1' },
        orderBy: { occurredAt: 'asc' },
        take: 50,
      })
    })
  })
})
