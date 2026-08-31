export const WALLET_EXPORT_ACKNOWLEDGEMENT_VERSION = 'self-custody-v1'

export type WalletExportAuditAction =
  | 'WALLET_EXPORT_AUTHORIZED'
  | 'WALLET_EXPORT_AUTHORIZATION_FAILED'
  | 'WALLET_EXPORT_COMPLETED'
  | 'WALLET_EXPORT_FAILED'

export interface WalletExportCandidate {
  walletId: string
  userId: string
  opaqueReference: string
  publicKey: string
}

export interface WalletExportAuthorizationRecord {
  id: string
  walletId: string
  userId: string
  sessionId: string
  tokenDigest: string
  acknowledgementVersion: string
  createdAt: Date
  expiresAt: Date
}

export interface WalletExportClaim extends WalletExportCandidate {
  authorizationId: string
}

export interface WalletExportAuthorizationRepository {
  findEligibleWallet(userId: string): Promise<WalletExportCandidate | null>
  saveAuthorization(record: WalletExportAuthorizationRecord): Promise<void>
  claimAuthorization(input: {
    tokenDigest: string
    userId: string
    sessionId: string
    now: Date
  }): Promise<WalletExportClaim | null>
  completeMigration(
    authorizationId: string,
    completedAt: Date,
  ): Promise<boolean>
  releaseClaim(authorizationId: string): Promise<void>
}

export interface WalletExportStepUpAuthenticator {
  verifyPassword(userId: string, password: string): Promise<boolean>
}

export interface WalletExportAuditSink {
  record(input: {
    userId: string
    action: WalletExportAuditAction
    metadata: Record<string, unknown>
  }): Promise<void>
}

export type WalletExportErrorCode =
  | 'ACKNOWLEDGEMENT_REQUIRED'
  | 'STEP_UP_FAILED'
  | 'WALLET_NOT_ELIGIBLE'
  | 'AUTHORIZATION_INVALID'
  | 'KMS_SECRET_UNAVAILABLE'
  | 'CUSTODY_TRANSITION_FAILED'
  | 'KMS_DELETE_FAILED'

export class WalletExportError extends Error {
  constructor(readonly code: WalletExportErrorCode) {
    super(code)
    this.name = 'WalletExportError'
  }
}
