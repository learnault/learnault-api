import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/config/database', () => ({
  default: { $transaction: vi.fn() },
}))

vi.mock('../../src/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import prisma from '../../src/config/database'
import {
  AuditPolicyError,
  actorFromRequest,
  auditedArchive,
  auditedMutation,
  auditedRestore,
  systemActor,
  workerActor,
} from '../../src/audit/audited-mutation'
import { REDACTED } from '../../src/audit/redaction'
import { ActorType } from '../../src/audit/types'

/**
 * A stand-in transaction client. Records the order of operations, so a test can
 * assert the audit row was written inside the same transaction as the mutation
 * rather than after it.
 */
function fakeTransaction() {
  const calls: string[] = []
  const auditCreate = vi.fn(async () => {
    calls.push('audit')

    return {}
  })

  const tx = { auditEvent: { create: auditCreate } }

  vi.mocked(prisma.$transaction).mockImplementation((async (
    callback: (client: unknown) => Promise<unknown>,
  ) => callback(tx)) as never)

  return { calls, auditCreate, tx }
}

/** The audit row a fake transaction received. */
function auditRow(
  auditCreate: ReturnType<typeof vi.fn>,
): Record<string, unknown> {
  return (auditCreate.mock.calls[0][0] as { data: Record<string, unknown> })
    .data
}

describe('auditedMutation', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe('atomicity', () => {
    it('runs the mutation and the audit write in one transaction', async () => {
      const { calls, auditCreate } = fakeTransaction()

      await auditedMutation({
        action: 'account.deactivated',
        actor: { type: ActorType.USER, id: 'u-1', role: 'LEARNER' },
        target: { type: 'User', id: 'u-1' },
        mutate: async () => {
          calls.push('mutate')

          return { id: 'u-1' }
        },
      })

      expect(prisma.$transaction).toHaveBeenCalledOnce()
      expect(calls).toEqual(['mutate', 'audit'])
      expect(auditCreate).toHaveBeenCalledOnce()
    })

    it('hands the mutation the transaction client, not the global one', async () => {
      const { tx } = fakeTransaction()
      const seen: unknown[] = []

      await auditedMutation({
        action: 'user.updated',
        actor: { type: ActorType.USER, id: 'u-1' },
        target: { type: 'User', id: 'u-1' },
        mutate: async (client) => {
          seen.push(client)

          return null
        },
      })

      // A write through the global client would commit outside the transaction
      // and escape the audit's all-or-nothing guarantee.
      expect(seen).toEqual([tx])
    })

    it('propagates a failed audit write, so an unaudited change cannot land', async () => {
      const auditCreate = vi
        .fn()
        .mockRejectedValue(new Error('audit constraint'))
      vi.mocked(prisma.$transaction).mockImplementation((async (
        callback: (client: unknown) => Promise<unknown>,
      ) => callback({ auditEvent: { create: auditCreate } })) as never)

      await expect(
        auditedMutation({
          action: 'wallet.status_changed',
          actor: { type: ActorType.WORKER, id: 'provisioning' },
          target: { type: 'Wallet', id: 'w-1' },
          mutate: async () => ({ id: 'w-1' }),
        }),
      ).rejects.toThrow('audit constraint')
    })

    it('does not write an audit event when the mutation itself fails', async () => {
      const { auditCreate } = fakeTransaction()

      await expect(
        auditedMutation({
          action: 'wallet.status_changed',
          actor: { type: ActorType.WORKER, id: 'provisioning' },
          target: { type: 'Wallet', id: 'w-1' },
          mutate: async () => {
            throw new Error('lease lost')
          },
        }),
      ).rejects.toThrow('lease lost')

      // Auditing a change that never happened is as wrong as missing one.
      expect(auditCreate).not.toHaveBeenCalled()
    })

    it('returns the mutation result unchanged', async () => {
      fakeTransaction()

      const result = await auditedMutation({
        action: 'user.updated',
        actor: { type: ActorType.USER, id: 'u-1' },
        target: { type: 'User', id: 'u-1' },
        mutate: async () => ({ id: 'u-1', status: 'DEACTIVATED' }),
      })

      expect(result).toEqual({ id: 'u-1', status: 'DEACTIVATED' })
    })
  })

  describe('attribution', () => {
    it('records actor, action, target, reason, request id and source', async () => {
      const { auditCreate } = fakeTransaction()

      await auditedMutation({
        action: 'account.deactivated',
        actor: { type: ActorType.ADMIN, id: 'admin-1', role: 'ADMIN' },
        target: { type: 'User', id: 'learner-2' },
        reason: 'abuse report #91',
        requestId: 'req-1',
        correlationId: 'evt-7',
        source: 'api.admin.deactivate',
        mutate: async () => null,
      })

      expect(auditRow(auditCreate)).toMatchObject({
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorRole: 'ADMIN',
        action: 'account.deactivated',
        targetType: 'User',
        targetId: 'learner-2',
        reason: 'abuse report #91',
        requestId: 'req-1',
        correlationId: 'evt-7',
        source: 'api.admin.deactivate',
      })
    })

    it('resolves the target id from the result, for a create', async () => {
      const { auditCreate } = fakeTransaction()

      await auditedMutation({
        action: 'wallet.reserved',
        actor: { type: ActorType.USER, id: 'u-1' },
        target: { type: 'Wallet' },
        mutate: async () => ({ id: 'w-new' }),
        resolveTargetId: (result) => result.id,
      })

      expect(auditRow(auditCreate).targetId).toBe('w-new')
    })

    it('prefers an explicit target id over a resolved one', async () => {
      const { auditCreate } = fakeTransaction()

      await auditedMutation({
        action: 'wallet.updated',
        actor: { type: ActorType.USER, id: 'u-1' },
        target: { type: 'Wallet', id: 'w-explicit' },
        mutate: async () => ({ id: 'w-resolved' }),
        resolveTargetId: (result) => result.id,
      })

      expect(auditRow(auditCreate).targetId).toBe('w-explicit')
    })

    it('merges metadata resolved from the result', async () => {
      const { auditCreate } = fakeTransaction()

      await auditedMutation({
        action: 'wallet.status_changed',
        actor: { type: ActorType.WORKER, id: 'provisioning' },
        target: { type: 'Wallet', id: 'w-1' },
        metadata: { from: 'RESERVED' },
        mutate: async () => ({ status: 'ACTIVE' }),
        resolveMetadata: (result) => ({ to: result.status }),
      })

      expect(JSON.parse(auditRow(auditCreate).metadata as string)).toEqual({
        from: 'RESERVED',
        to: 'ACTIVE',
      })
    })

    it('redacts metadata before it reaches the row', async () => {
      const { auditCreate } = fakeTransaction()

      await auditedMutation({
        action: 'password.changed',
        actor: { type: ActorType.USER, id: 'u-1' },
        target: { type: 'User', id: 'u-1' },
        metadata: { newPassword: 'hunter2', method: 'reset-link' },
        mutate: async () => null,
      })

      const metadata = auditRow(auditCreate).metadata as string

      expect(metadata).not.toContain('hunter2')
      expect(JSON.parse(metadata)).toMatchObject({
        newPassword: REDACTED,
        method: 'reset-link',
      })
    })

    it('hashes the IP and coarsens the User-Agent it is given', async () => {
      const { auditCreate } = fakeTransaction()

      await auditedMutation({
        action: 'session.revoked',
        actor: { type: ActorType.USER, id: 'u-1' },
        target: { type: 'Session', id: 's-1' },
        ipAddress: '198.51.100.7',
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/121.0',
        mutate: async () => null,
      })

      const row = auditRow(auditCreate)

      expect(row.userAgentFamily).toBe('Firefox')
      expect(JSON.stringify(row)).not.toContain('198.51.100.7')
      expect(row.actorIpHash).toMatch(/^[0-9a-f]{32}$/)
    })

    it('stores null metadata when there is none, rather than an empty object', async () => {
      const { auditCreate } = fakeTransaction()

      await auditedMutation({
        action: 'session.revoked',
        actor: { type: ActorType.USER, id: 'u-1' },
        target: { type: 'Session', id: 's-1' },
        mutate: async () => null,
      })

      expect(auditRow(auditCreate).metadata).toBeNull()
    })
  })

  describe('policy enforcement', () => {
    it('requires a reason from an ADMIN actor', async () => {
      const { auditCreate } = fakeTransaction()
      const mutate = vi.fn()

      await expect(
        auditedMutation({
          action: 'account.deactivated',
          actor: { type: ActorType.ADMIN, id: 'admin-1', role: 'ADMIN' },
          target: { type: 'User', id: 'learner-2' },
          mutate,
        }),
      ).rejects.toThrow(AuditPolicyError)

      // Rejected before anything ran, so there is nothing to roll back.
      expect(mutate).not.toHaveBeenCalled()
      expect(auditCreate).not.toHaveBeenCalled()
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('treats a blank reason as no reason', async () => {
      fakeTransaction()

      await expect(
        auditedMutation({
          action: 'account.deactivated',
          actor: { type: ActorType.ADMIN, id: 'admin-1' },
          target: { type: 'User', id: 'learner-2' },
          reason: '   ',
          mutate: async () => null,
        }),
      ).rejects.toThrow(AuditPolicyError)
    })

    it('does not require a reason from a SYSTEM or WORKER actor', async () => {
      fakeTransaction()

      await expect(
        auditedMutation({
          action: 'export.purged',
          actor: systemActor('lifecycle-sweep'),
          target: { type: 'DataExportRequest', id: 'e-1' },
          mutate: async () => null,
        }),
      ).resolves.toBeNull()

      await expect(
        auditedMutation({
          action: 'wallet.provisioned',
          actor: workerActor('wallet-provisioning'),
          target: { type: 'Wallet', id: 'w-1' },
          mutate: async () => null,
        }),
      ).resolves.toBeNull()
    })

    it('rejects a USER or ADMIN actor with no id, which would be unattributable', async () => {
      fakeTransaction()

      await expect(
        auditedMutation({
          action: 'user.updated',
          actor: { type: ActorType.USER },
          target: { type: 'User', id: 'u-1' },
          mutate: async () => null,
        }),
      ).rejects.toThrow(/unattributable/)
    })

    it('rejects an empty action or target type', async () => {
      fakeTransaction()

      await expect(
        auditedMutation({
          action: '  ',
          actor: systemActor('sweep'),
          target: { type: 'User', id: 'u-1' },
          mutate: async () => null,
        }),
      ).rejects.toThrow(AuditPolicyError)

      await expect(
        auditedMutation({
          action: 'user.updated',
          actor: systemActor('sweep'),
          target: { type: '' },
          mutate: async () => null,
        }),
      ).rejects.toThrow(AuditPolicyError)
    })
  })
})

describe('auditedArchive', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('stamps the archive patch and audits it in one transaction', async () => {
    const { auditCreate } = fakeTransaction()
    let received: unknown

    await auditedArchive({
      model: 'Module',
      id: 'm-1',
      reason: 'superseded by v2',
      actor: { type: ActorType.ADMIN, id: 'admin-1', role: 'ADMIN' },
      archive: async (_tx, patch) => {
        received = patch

        return { id: 'm-1' }
      },
    })

    expect(received).toMatchObject({
      archivedById: 'admin-1',
      archivedReason: 'superseded by v2',
    })
    expect((received as { archivedAt: Date }).archivedAt).toBeInstanceOf(Date)

    expect(auditRow(auditCreate)).toMatchObject({
      action: 'module.archived',
      targetType: 'Module',
      targetId: 'm-1',
      reason: 'superseded by v2',
      recordClass: 'ARCHIVABLE',
    })
  })

  it('derives a snake_case action name from the model', async () => {
    const { auditCreate } = fakeTransaction()

    await auditedArchive({
      model: 'LearnerProfile',
      id: 'p-1',
      reason: 'account deactivated',
      actor: systemActor('lifecycle-sweep'),
      archive: async () => null,
    })

    expect(auditRow(auditCreate).action).toBe('learner_profile.archived')
  })

  it('refuses to archive a model the matrix does not classify as archivable', async () => {
    const archive = vi.fn()

    await expect(
      auditedArchive({
        model: 'Transaction',
        id: 't-1',
        reason: 'mistake',
        actor: { type: ActorType.ADMIN, id: 'admin-1', role: 'ADMIN' },
        archive,
      }),
    ).rejects.toThrow(/IMMUTABLE, not ARCHIVABLE/)

    expect(archive).not.toHaveBeenCalled()
  })

  it('refuses to archive an unclassified model', async () => {
    await expect(
      auditedArchive({
        model: 'SomeFutureModel',
        id: 'x-1',
        reason: 'because',
        actor: systemActor('sweep'),
        archive: async () => null,
      }),
    ).rejects.toThrow(/no rule in the lifecycle matrix/)
  })

  it('requires a reason regardless of actor type', async () => {
    // Unlike a plain audited mutation, an archive always needs one: the column
    // is NOT NULL-checked in the database and unreviewable without it.
    await expect(
      auditedArchive({
        model: 'Module',
        id: 'm-1',
        reason: '  ',
        actor: systemActor('sweep'),
        archive: async () => null,
      }),
    ).rejects.toThrow(/requires a reason/)
  })
})

describe('auditedRestore', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('clears the archive columns and audits the restore', async () => {
    const { auditCreate } = fakeTransaction()
    let received: unknown

    await auditedRestore({
      model: 'Module',
      id: 'm-1',
      reason: 'withdrawn in error',
      actor: { type: ActorType.ADMIN, id: 'admin-1', role: 'ADMIN' },
      restore: async (_tx, patch) => {
        received = patch

        return { id: 'm-1' }
      },
    })

    expect(received).toEqual({
      archivedAt: null,
      archivedById: null,
      archivedReason: null,
    })
    expect(auditRow(auditCreate).action).toBe('module.restored')
  })

  it('refuses to restore a non-archivable model', async () => {
    await expect(
      auditedRestore({
        model: 'User',
        id: 'u-1',
        reason: 'x',
        actor: systemActor('sweep'),
        restore: async () => null,
      }),
    ).rejects.toThrow(/MUTABLE, not ARCHIVABLE/)
  })
})

describe('actorFromRequest', () => {
  it('builds a USER actor from an authenticated learner request', () => {
    expect(
      actorFromRequest({
        actor: { id: 'u-1', role: 'LEARNER' },
        requestId: 'req-1',
        ip: '203.0.113.5',
        headers: { 'user-agent': 'curl/8.4.0' },
      }),
    ).toEqual({
      actor: { type: ActorType.USER, id: 'u-1', role: 'LEARNER' },
      requestId: 'req-1',
      ipAddress: '203.0.113.5',
      userAgent: 'curl/8.4.0',
    })
  })

  it('builds an ADMIN actor from a staff request', () => {
    // It is the actor's authority that decides the scrutiny, not the endpoint.
    expect(
      actorFromRequest({ actor: { id: 'a-1', role: 'ADMIN' } }).actor,
    ).toEqual({
      type: ActorType.ADMIN,
      id: 'a-1',
      role: 'ADMIN',
    })
  })

  it('falls back to ANONYMOUS for an unauthenticated request', () => {
    const context = actorFromRequest({ requestId: 'req-2' })

    expect(context.actor).toEqual({ type: ActorType.ANONYMOUS })
    expect(context.requestId).toBe('req-2')
  })

  it('nulls a missing request id, ip and User-Agent', () => {
    expect(actorFromRequest({})).toEqual({
      actor: { type: ActorType.ANONYMOUS },
      requestId: null,
      ipAddress: null,
      userAgent: null,
    })
  })

  it('ignores a non-string User-Agent header', () => {
    expect(
      actorFromRequest({ headers: { 'user-agent': ['a', 'b'] } }).userAgent,
    ).toBeNull()
  })
})

describe('actor constructors', () => {
  it('systemActor names the component', () => {
    expect(systemActor('lifecycle-sweep')).toEqual({
      type: ActorType.SYSTEM,
      id: 'lifecycle-sweep',
    })
  })

  it('workerActor names the worker', () => {
    expect(workerActor('wallet-provisioning')).toEqual({
      type: ActorType.WORKER,
      id: 'wallet-provisioning',
    })
  })
})
