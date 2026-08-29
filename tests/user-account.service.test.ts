import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ActorType } from '../src/audit/types'

const {
  mockUserFindUnique,
  mockUserFindFirst,
  mockTransaction,
  mockCompare,
  mockHash,
} = vi.hoisted(() => ({
  mockUserFindUnique: vi.fn(),
  mockUserFindFirst: vi.fn(),
  mockTransaction: vi.fn(),
  mockCompare: vi.fn(),
  mockHash: vi.fn(),
}))

vi.mock('../src/config/database', () => ({
  default: {
    user: { findUnique: mockUserFindUnique, findFirst: mockUserFindFirst },
    $transaction: mockTransaction,
  },
}))

vi.mock('bcryptjs', () => ({
  default: { compare: mockCompare, hash: mockHash },
}))

vi.mock('../src/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { UserAccountService } from '../src/services/user-account.service'

const context = {
  actor: { type: ActorType.USER, id: 'user1', role: 'LEARNER' },
  requestId: 'req-1',
  ipAddress: '203.0.113.7',
  userAgent: 'curl/8.0',
}

const VALID_ADDRESS = `G${'A'.repeat(55)}`
const OTHER_ADDRESS = `G${'B'.repeat(55)}`

/**
 * A stand-in transaction client covering the tables the mutation touches, so a
 * test can assert what ran inside the transaction and in what order.
 */
function fakeTransaction(options: { sessions?: { id: string }[]; updateResult?: unknown } = {}) {
  const calls: string[] = []
  const auditCreate = vi.fn(async () => {
    calls.push('audit')

    return {}
  })
  const userUpdate = vi.fn(async () => {
    calls.push('user.update')

    return options.updateResult ?? { id: 'user1' }
  })
  const sessionUpdateMany = vi.fn(async () => {
    calls.push('session.updateMany')

    return { count: options.sessions?.length ?? 0 }
  })
  const refreshTokenUpdateMany = vi.fn(async () => {
    calls.push('refreshToken.updateMany')

    return { count: 0 }
  })

  const tx = {
    auditEvent: { create: auditCreate },
    user: { update: userUpdate },
    session: {
      findMany: vi.fn(async () => options.sessions ?? []),
      updateMany: sessionUpdateMany,
    },
    refreshToken: { updateMany: refreshTokenUpdateMany },
  }

  mockTransaction.mockImplementation(
    async (callback: (client: unknown) => Promise<unknown>) => callback(tx)
  )

  return { calls, auditCreate, userUpdate, sessionUpdateMany, refreshTokenUpdateMany }
}

function auditRow(auditCreate: ReturnType<typeof vi.fn>): Record<string, unknown> {
  return (auditCreate.mock.calls[0][0] as { data: Record<string, unknown> }).data
}

describe('UserAccountService', () => {
  let service: UserAccountService

  beforeEach(() => {
    vi.clearAllMocks()
    mockHash.mockResolvedValue('$2b$12$newhash')
    service = new UserAccountService()
  })

  describe('changePassword', () => {
    const account = { id: 'user1', password: '$2b$12$oldhash', status: 'ACTIVE' }

    it('reports not-found for an unknown account', async () => {
      mockUserFindUnique.mockResolvedValue(null)

      expect(await service.changePassword('missing', 'old', 'New1!pass', context)).toEqual({
        kind: 'not-found',
      })
    })

    it('reports not-found for a tombstoned account', async () => {
      mockUserFindUnique.mockResolvedValue({ ...account, status: 'DELETED' })

      expect(await service.changePassword('user1', 'old', 'New1!pass', context)).toEqual({
        kind: 'not-found',
      })
    })

    it('rejects a wrong current password without writing anything', async () => {
      mockUserFindUnique.mockResolvedValue(account)
      mockCompare.mockResolvedValue(false)

      expect(await service.changePassword('user1', 'wrong', 'New1!pass', context)).toEqual({
        kind: 'invalid-password',
      })
      expect(mockTransaction).not.toHaveBeenCalled()
      expect(mockHash).not.toHaveBeenCalled()
    })

    it('stores a hash, never the plaintext', async () => {
      mockUserFindUnique.mockResolvedValue(account)
      mockCompare.mockResolvedValue(true)
      const { userUpdate } = fakeTransaction()

      await service.changePassword('user1', 'old', 'New1!pass', context)

      expect(mockHash).toHaveBeenCalledWith('New1!pass', expect.any(Number))
      expect(userUpdate).toHaveBeenCalledWith({
        where: { id: 'user1' },
        data: { password: '$2b$12$newhash' },
      })
    })

    it('revokes every live session and refresh token in the same transaction', async () => {
      mockUserFindUnique.mockResolvedValue(account)
      mockCompare.mockResolvedValue(true)
      const { calls, sessionUpdateMany, refreshTokenUpdateMany } = fakeTransaction({
        sessions: [{ id: 's1' }, { id: 's2' }],
      })

      const result = await service.changePassword('user1', 'old', 'New1!pass', context)

      expect(result).toEqual({ kind: 'changed', revokedSessionCount: 2 })
      expect(sessionUpdateMany).toHaveBeenCalledWith({
        where: { id: { in: ['s1', 's2'] } },
        data: { isRevoked: true, revokedAt: expect.any(Date) },
      })
      expect(refreshTokenUpdateMany).toHaveBeenCalledWith({
        where: { sessionId: { in: ['s1', 's2'] }, status: { not: 'REVOKED' } },
        data: { status: 'REVOKED' },
      })
      expect(calls).toEqual([
        'user.update',
        'session.updateMany',
        'refreshToken.updateMany',
        'audit',
      ])
      expect(mockTransaction).toHaveBeenCalledOnce()
    })

    it('succeeds with a zero count when there is nothing to revoke', async () => {
      mockUserFindUnique.mockResolvedValue(account)
      mockCompare.mockResolvedValue(true)
      const { sessionUpdateMany } = fakeTransaction({ sessions: [] })

      expect(await service.changePassword('user1', 'old', 'New1!pass', context)).toEqual({
        kind: 'changed',
        revokedSessionCount: 0,
      })
      expect(sessionUpdateMany).not.toHaveBeenCalled()
    })

    it('audits the change without recording either password', async () => {
      mockUserFindUnique.mockResolvedValue(account)
      mockCompare.mockResolvedValue(true)
      const { auditCreate } = fakeTransaction({ sessions: [{ id: 's1' }] })

      await service.changePassword('user1', 'old-secret', 'New1!pass', context)

      const row = auditRow(auditCreate)

      expect(row).toMatchObject({
        action: 'user.password_changed',
        actorType: ActorType.USER,
        actorId: 'user1',
        targetType: 'User',
        targetId: 'user1',
        requestId: 'req-1',
      })
      expect(row.metadata).toContain('revokedSessionCount')
      expect(JSON.stringify(row)).not.toContain('old-secret')
      expect(JSON.stringify(row)).not.toContain('New1!pass')
      expect(JSON.stringify(row)).not.toContain('newhash')
    })

    it('leaves the password unchanged when the audit write fails', async () => {
      mockUserFindUnique.mockResolvedValue(account)
      mockCompare.mockResolvedValue(true)
      mockTransaction.mockRejectedValue(new Error('audit trail unavailable'))

      await expect(
        service.changePassword('user1', 'old', 'New1!pass', context)
      ).rejects.toThrow('audit trail unavailable')
    })
  })

  describe('updateWalletAddress', () => {
    const account = { id: 'user1', status: 'ACTIVE', walletAddress: null }

    it('reports not-found for an unknown account', async () => {
      mockUserFindUnique.mockResolvedValue(null)

      expect(await service.updateWalletAddress('missing', VALID_ADDRESS, context)).toEqual({
        kind: 'not-found',
      })
    })

    it('reports not-found for a tombstoned account', async () => {
      mockUserFindUnique.mockResolvedValue({ ...account, status: 'DELETED' })

      expect(await service.updateWalletAddress('user1', VALID_ADDRESS, context)).toEqual({
        kind: 'not-found',
      })
    })

    it('is a no-op when the address is already the one on file', async () => {
      mockUserFindUnique.mockResolvedValue({ ...account, walletAddress: VALID_ADDRESS })

      expect(await service.updateWalletAddress('user1', VALID_ADDRESS, context)).toEqual({
        kind: 'unchanged',
        walletAddress: VALID_ADDRESS,
      })
      expect(mockTransaction).not.toHaveBeenCalled()
    })

    it('conflicts when the address is already claimed by another account', async () => {
      mockUserFindUnique.mockResolvedValue(account)
      mockUserFindFirst.mockResolvedValue({ id: 'user2' })

      expect(await service.updateWalletAddress('user1', VALID_ADDRESS, context)).toEqual({
        kind: 'conflict',
      })
      expect(mockUserFindFirst).toHaveBeenCalledWith({
        where: { walletAddress: VALID_ADDRESS, id: { not: 'user1' } },
        select: { id: true },
      })
      expect(mockTransaction).not.toHaveBeenCalled()
    })

    it('conflicts when a concurrent write wins the unique constraint', async () => {
      mockUserFindUnique.mockResolvedValue(account)
      mockUserFindFirst.mockResolvedValue(null)
      mockTransaction.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }))

      expect(await service.updateWalletAddress('user1', VALID_ADDRESS, context)).toEqual({
        kind: 'conflict',
      })
    })

    it('rethrows a failure that is not a unique-constraint violation', async () => {
      mockUserFindUnique.mockResolvedValue(account)
      mockUserFindFirst.mockResolvedValue(null)
      mockTransaction.mockRejectedValue(new Error('connection reset'))

      await expect(
        service.updateWalletAddress('user1', VALID_ADDRESS, context)
      ).rejects.toThrow('connection reset')
    })

    it('persists the address and audits it', async () => {
      mockUserFindUnique.mockResolvedValue({ ...account, walletAddress: OTHER_ADDRESS })
      mockUserFindFirst.mockResolvedValue(null)
      const { calls, auditCreate, userUpdate } = fakeTransaction()

      const result = await service.updateWalletAddress('user1', VALID_ADDRESS, context)

      expect(result).toEqual({ kind: 'updated', walletAddress: VALID_ADDRESS })
      expect(userUpdate).toHaveBeenCalledWith({
        where: { id: 'user1' },
        data: { walletAddress: VALID_ADDRESS },
      })
      expect(calls).toEqual(['user.update', 'audit'])
      expect(auditRow(auditCreate)).toMatchObject({
        action: 'user.wallet_address_changed',
        actorId: 'user1',
        targetType: 'User',
        targetId: 'user1',
      })
      expect(auditRow(auditCreate).metadata).toContain('hadPreviousAddress')
    })
  })
})
