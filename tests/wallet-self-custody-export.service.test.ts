import { describe, expect, it, vi } from 'vitest'
import { InMemoryEnvelopeKms } from '../src/services/kms/in-memory-envelope-kms'
import { SensitiveValue } from '../src/services/kms/kms-secret-store'
import {
  digest,
  WalletSelfCustodyExportService,
} from '../src/services/wallet-self-custody-export.service'
import type {
  WalletExportAuditSink,
  WalletExportAuthorizationRecord,
  WalletExportAuthorizationRepository,
  WalletExportCandidate,
  WalletExportClaim,
} from '../src/types/wallet-self-custody-export.types'

const USER_ID = 'learner-1'
const SESSION_ID = 'session-1'
const SECRET = 'SBY3Z7ONE-TIME-SECRET-TEST-VALUE'

class InMemoryAuthorizationRepository implements WalletExportAuthorizationRepository {
  candidate: WalletExportCandidate | null = null
  readonly authorizations = new Map<
    string,
    WalletExportAuthorizationRecord & {
      status: 'PENDING' | 'CLAIMED' | 'CONSUMED'
    }
  >()
  custody = 'MANAGED'
  walletStatus = 'ACTIVE'

  async findEligibleWallet(userId: string): Promise<WalletExportCandidate | null> {
    return this.candidate?.userId === userId &&
      this.custody === 'MANAGED' &&
      this.walletStatus === 'ACTIVE'
      ? this.candidate
      : null
  }

  async saveAuthorization(
    record: WalletExportAuthorizationRecord,
  ): Promise<void> {
    this.authorizations.set(record.id, { ...record, status: 'PENDING' })
  }

  async claimAuthorization(input: {
    tokenDigest: string
    userId: string
    sessionId: string
    now: Date
  }): Promise<WalletExportClaim | null> {
    const authorization = [...this.authorizations.values()].find(
      (candidate) =>
        candidate.tokenDigest === input.tokenDigest &&
        candidate.userId === input.userId &&
        candidate.sessionId === input.sessionId &&
        candidate.status === 'PENDING' &&
        candidate.expiresAt.getTime() > input.now.getTime(),
    )
    if (!authorization || !this.candidate) return null
    authorization.status = 'CLAIMED'

    return {
      ...this.candidate,
      authorizationId: authorization.id,
    }
  }

  async completeMigration(authorizationId: string): Promise<boolean> {
    const authorization = this.authorizations.get(authorizationId)
    if (!authorization || authorization.status !== 'CLAIMED') return false
    authorization.status = 'CONSUMED'
    this.custody = 'SELF_CUSTODY'
    this.walletStatus = 'MIGRATED'

    return true
  }

  async releaseClaim(authorizationId: string): Promise<void> {
    const authorization = this.authorizations.get(authorizationId)
    if (authorization?.status === 'CLAIMED') authorization.status = 'PENDING'
  }
}

class AuditRecorder implements WalletExportAuditSink {
  readonly entries: Array<{
    userId: string
    action: string
    metadata: Record<string, unknown>
  }> = []

  async record(input: {
    userId: string
    action: any
    metadata: Record<string, unknown>
  }): Promise<void> {
    this.entries.push(input)
  }
}

async function setup(now = new Date('2026-08-19T12:00:00.000Z')) {
  const repository = new InMemoryAuthorizationRepository()
  const kms = new InMemoryEnvelopeKms()
  const material = await kms.storeStellarSecret({
    idempotencyKey: 'wallet-1',
    publicKey: 'GEXPORTTESTPUBLICKEY',
    secret: new SensitiveValue(SECRET),
  })
  repository.candidate = {
    walletId: 'wallet-1',
    userId: USER_ID,
    opaqueReference: material.opaqueReference,
    publicKey: material.publicKey,
  }
  const stepUp = { verifyPassword: vi.fn(async () => true) }
  const audit = new AuditRecorder()
  const clock = { now }
  const service = new WalletSelfCustodyExportService(
    repository,
    stepUp,
    kms,
    audit,
    { now: () => clock.now, authorizationTtlMs: 60_000 },
  )

  return { repository, kms, stepUp, audit, clock, service }
}

async function authorize(service: WalletSelfCustodyExportService) {
  return service.authorize({
    userId: USER_ID,
    sessionId: SESSION_ID,
    password: 'fresh-password',
    acknowledgement: true,
  })
}

describe('step-up self-custody export', () => {
  it('requires acknowledgement and fresh password verification', async () => {
    const { service, stepUp, repository } = await setup()
    await expect(
      service.authorize({
        userId: USER_ID,
        sessionId: SESSION_ID,
        password: 'fresh-password',
        acknowledgement: false,
      }),
    ).rejects.toMatchObject({ code: 'ACKNOWLEDGEMENT_REQUIRED' })

    stepUp.verifyPassword.mockResolvedValue(false)
    await expect(
      authorize(service),
    ).rejects.toMatchObject({ code: 'STEP_UP_FAILED' })
    expect(repository.authorizations.size).toBe(0)
  })

  it('persists only a digest and binds authorization to user and session', async () => {
    const { service, repository } = await setup()
    const result = await authorize(service)
    const stored = [...repository.authorizations.values()][0]

    expect(stored.tokenDigest).toBe(digest(result.authorizationToken))
    expect(JSON.stringify(stored)).not.toContain(result.authorizationToken)
    expect(stored).toMatchObject({ userId: USER_ID, sessionId: SESSION_ID })
  })

  it('rejects expired, cross-user, and cross-session authorizations uniformly', async () => {
    const { service, clock } = await setup()
    const first = await authorize(service)

    await expect(
      service.exportOnce({
        userId: 'other-user',
        sessionId: SESSION_ID,
        authorizationToken: first.authorizationToken,
      }),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_INVALID' })
    await expect(
      service.exportOnce({
        userId: USER_ID,
        sessionId: 'other-session',
        authorizationToken: first.authorizationToken,
      }),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_INVALID' })

    clock.now = new Date(first.expiresAt.getTime() + 1)
    await expect(
      service.exportOnce({
        userId: USER_ID,
        sessionId: SESSION_ID,
        authorizationToken: first.authorizationToken,
      }),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_INVALID' })
  })

  it('delivers once, migrates custody, destroys KMS material, and rejects replay', async () => {
    const { service, repository, kms, audit } = await setup()
    const authorization = await authorize(service)
    const secret = await service.exportOnce({
      userId: USER_ID,
      sessionId: SESSION_ID,
      authorizationToken: authorization.authorizationToken,
    })

    expect(secret.use((value) => value)).toBe(SECRET)
    expect(repository.custody).toBe('SELF_CUSTODY')
    expect(repository.walletStatus).toBe('MIGRATED')
    expect(kms.storedKeyCount).toBe(0)
    expect(JSON.stringify(audit.entries)).not.toContain(SECRET)
    await expect(
      service.exportOnce({
        userId: USER_ID,
        sessionId: SESSION_ID,
        authorizationToken: authorization.authorizationToken,
      }),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_INVALID' })
  })

  it('allows only one winner under concurrent replay attempts', async () => {
    const { service } = await setup()
    const authorization = await authorize(service)
    const attempts = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        service.exportOnce({
          userId: USER_ID,
          sessionId: SESSION_ID,
          authorizationToken: authorization.authorizationToken,
        }),
      ),
    )

    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1)
    expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(19)
  })

  it('does not deliver while managed KMS material cannot be deleted', async () => {
    const repository = new InMemoryAuthorizationRepository()
    const kms = new InMemoryEnvelopeKms({
      beforeDelete: () => {
        throw new Error(`provider failure ${SECRET}`)
      },
    })
    const material = await kms.storeStellarSecret({
      idempotencyKey: 'wallet-1',
      publicKey: 'GEXPORTTESTPUBLICKEY',
      secret: new SensitiveValue(SECRET),
    })
    repository.candidate = {
      walletId: 'wallet-1',
      userId: USER_ID,
      opaqueReference: material.opaqueReference,
      publicKey: material.publicKey,
    }
    const service = new WalletSelfCustodyExportService(
      repository,
      { verifyPassword: async () => true },
      kms,
      new AuditRecorder(),
    )
    const authorization = await authorize(service)

    await expect(
      service.exportOnce({
        userId: USER_ID,
        sessionId: SESSION_ID,
        authorizationToken: authorization.authorizationToken,
      }),
    ).rejects.toMatchObject({ code: 'KMS_DELETE_FAILED' })
    expect(kms.storedKeyCount).toBe(1)
  })
})
