import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { KmsSecretStore, SensitiveValue } from './kms/kms-secret-store'
import {
  WALLET_EXPORT_ACKNOWLEDGEMENT_VERSION,
  WalletExportError,
  type WalletExportAuditSink,
  type WalletExportAuthorizationRepository,
  type WalletExportStepUpAuthenticator,
} from '../types/wallet-self-custody-export.types'

const DEFAULT_AUTHORIZATION_TTL_MS = 5 * 60 * 1000

export interface WalletSelfCustodyExportOptions {
  now?: () => Date
  authorizationTtlMs?: number
}

/** Trusted orchestration boundary for one-time Stellar secret delivery. */
export class WalletSelfCustodyExportService {
  private readonly now: () => Date
  private readonly authorizationTtlMs: number

  constructor(
    private readonly repository: WalletExportAuthorizationRepository,
    private readonly stepUp: WalletExportStepUpAuthenticator,
    private readonly kms: KmsSecretStore,
    private readonly audit: WalletExportAuditSink,
    options: WalletSelfCustodyExportOptions = {},
  ) {
    this.now = options.now ?? (() => new Date())
    this.authorizationTtlMs =
      options.authorizationTtlMs ?? DEFAULT_AUTHORIZATION_TTL_MS
  }

  async authorize(input: {
    userId: string
    sessionId: string
    password: string
    acknowledgement: boolean
  }): Promise<{ authorizationToken: string; expiresAt: Date }> {
    if (!input.acknowledgement) {
      throw new WalletExportError('ACKNOWLEDGEMENT_REQUIRED')
    }

    const verified = await this.stepUp.verifyPassword(
      input.userId,
      input.password,
    )
    if (!verified) {
      await this.audit.record({
        userId: input.userId,
        action: 'WALLET_EXPORT_AUTHORIZATION_FAILED',
        metadata: { reason: 'step_up_failed' },
      })
      throw new WalletExportError('STEP_UP_FAILED')
    }

    const wallet = await this.repository.findEligibleWallet(input.userId)
    if (!wallet) throw new WalletExportError('WALLET_NOT_ELIGIBLE')

    const createdAt = this.now()
    const expiresAt = new Date(createdAt.getTime() + this.authorizationTtlMs)
    const authorizationToken = randomBytes(32).toString('base64url')
    await this.repository.saveAuthorization({
      id: randomUUID(),
      walletId: wallet.walletId,
      userId: input.userId,
      sessionId: input.sessionId,
      tokenDigest: digest(authorizationToken),
      acknowledgementVersion: WALLET_EXPORT_ACKNOWLEDGEMENT_VERSION,
      createdAt,
      expiresAt,
    })
    await this.audit.record({
      userId: input.userId,
      action: 'WALLET_EXPORT_AUTHORIZED',
      metadata: {
        walletId: wallet.walletId,
        acknowledgementVersion: WALLET_EXPORT_ACKNOWLEDGEMENT_VERSION,
        expiresAt: expiresAt.toISOString(),
      },
    })

    return { authorizationToken, expiresAt }
  }

  async exportOnce(input: {
    userId: string
    sessionId: string
    authorizationToken: string
  }): Promise<SensitiveValue> {
    const claimedAt = this.now()
    const claim = await this.repository.claimAuthorization({
      tokenDigest: digest(input.authorizationToken),
      userId: input.userId,
      sessionId: input.sessionId,
      now: claimedAt,
    })
    if (!claim) throw new WalletExportError('AUTHORIZATION_INVALID')

    let secret: SensitiveValue | null
    try {
      secret = await this.kms.loadStellarSecret(claim.opaqueReference)
    } catch {
      secret = null
    }
    if (!secret) {
      await this.repository.releaseClaim(claim.authorizationId)
      await this.recordFailure(input.userId, claim.walletId, 'kms_unavailable')
      throw new WalletExportError('KMS_SECRET_UNAVAILABLE')
    }

    const completed = await this.repository.completeMigration(
      claim.authorizationId,
      this.now(),
    )
    if (!completed) {
      await this.repository.releaseClaim(claim.authorizationId)
      await this.recordFailure(
        input.userId,
        claim.walletId,
        'transition_failed',
      )
      throw new WalletExportError('CUSTODY_TRANSITION_FAILED')
    }

    try {
      await this.kms.deleteStellarSecret(claim.opaqueReference)
    } catch {
      await this.recordFailure(
        input.userId,
        claim.walletId,
        'kms_delete_failed',
      )
      // The secret is deliberately not returned while the managed copy exists.
      throw new WalletExportError('KMS_DELETE_FAILED')
    }

    await this.audit.record({
      userId: input.userId,
      action: 'WALLET_EXPORT_COMPLETED',
      metadata: { walletId: claim.walletId, publicKey: claim.publicKey },
    })

    return secret
  }

  private async recordFailure(
    userId: string,
    walletId: string,
    reason: string,
  ): Promise<void> {
    await this.audit.record({
      userId,
      action: 'WALLET_EXPORT_FAILED',
      metadata: { walletId, reason },
    })
  }
}

export function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
