/**
 * The lifecycle matrix: one rule per persisted model.
 *
 * This file is the machine-readable source of truth behind
 * docs/DATA_LIFECYCLE.md. Adding a model to prisma/schema.prisma without adding
 * it here fails tests/audit/classification.test.ts, which is deliberate — an
 * unclassified record has no retention, no erasure behaviour and no audit
 * requirement, and that is exactly the state this policy exists to prevent.
 */

import {
  DataCategory,
  ErasureAction,
  LifecycleRule,
  RecordClass,
  RecordClassValue,
} from './types.js'

/** Retention windows, in days. Named so the intent survives the number. */
export const Retention = {
  /** Financial and consent records: statutory bookkeeping horizon. */
  SEVEN_YEARS: 2555,
  /** Security events: long enough for forensics on a late-discovered breach. */
  TWO_YEARS: 730,
  /** Archived content: reversible for a full release cycle before purge. */
  ONE_YEAR: 365,
  /** Operational journals worth keeping for trend analysis. */
  NINETY_DAYS: 90,
  /** Delivery queues and short-lived auth material. */
  THIRTY_DAYS: 30,
  /** Export artifacts containing full-fidelity personal data. */
  SEVEN_DAYS: 7,
  /** Retain indefinitely — nothing purges it. */
  INDEFINITE: null,
} as const

const RULES: readonly LifecycleRule[] = [
  // ── Identity ──────────────────────────────────────────────────────────────
  {
    model: 'User',
    table: 'users',
    recordClass: RecordClass.MUTABLE,
    category: DataCategory.IDENTITY,
    retentionDays: Retention.INDEFINITE,
    retentionAnchor: null,
    onErasure: ErasureAction.ANONYMIZE,
    audited: true,
    notes:
      'Anonymized in place rather than deleted, so retained money and credential rows keep a valid referent. The tombstone carries no personal data.',
  },
  {
    model: 'LearnerPreference',
    table: 'learner_preferences',
    recordClass: RecordClass.MUTABLE,
    category: DataCategory.IDENTITY,
    retentionDays: Retention.INDEFINITE,
    retentionAnchor: null,
    onErasure: ErasureAction.CASCADE,
    audited: true,
    notes:
      'Authoritative source for privacy-impacting preferences, so every change is audited. Prior values live in PreferenceAuditLog.',
  },
  {
    model: 'LearnerProfile',
    table: 'learner_profiles',
    recordClass: RecordClass.ARCHIVABLE,
    category: DataCategory.IDENTITY,
    retentionDays: Retention.ONE_YEAR,
    retentionAnchor: 'archivedAt',
    onErasure: ErasureAction.CASCADE,
    audited: true,
    notes:
      'Learner-authored profile. Archived on deactivation so employer-visible listings drop it immediately while the learner can still come back.',
  },
  {
    model: 'OnboardingProgress',
    table: 'onboarding_progress',
    recordClass: RecordClass.MUTABLE,
    category: DataCategory.IDENTITY,
    retentionDays: Retention.INDEFINITE,
    retentionAnchor: null,
    onErasure: ErasureAction.CASCADE,
    audited: false,
    notes: 'Step tracking only. Holds no personal data beyond the step names.',
  },
  {
    model: 'Avatar',
    table: 'avatars',
    recordClass: RecordClass.ARCHIVABLE,
    category: DataCategory.CONTENT,
    retentionDays: Retention.ONE_YEAR,
    retentionAnchor: 'archivedAt',
    onErasure: ErasureAction.CASCADE,
    audited: true,
    notes:
      'Learner-supplied image. Archived rather than deleted so a replaced avatar can be restored and so moderation decisions stay reviewable.',
  },
  {
    model: 'AvatarVariant',
    table: 'avatar_variants',
    recordClass: RecordClass.IMMUTABLE,
    category: DataCategory.CONTENT,
    retentionDays: Retention.ONE_YEAR,
    retentionAnchor: 'createdAt',
    onErasure: ErasureAction.CASCADE,
    audited: false,
    notes:
      'Derived renditions of an Avatar. Never edited — a new variant set replaces the old one. Purged with its parent avatar.',
  },

  // ── Consent ───────────────────────────────────────────────────────────────
  {
    model: 'ConsentRecord',
    table: 'consent_records',
    recordClass: RecordClass.IMMUTABLE,
    category: DataCategory.CONSENT,
    retentionDays: Retention.SEVEN_YEARS,
    retentionAnchor: 'createdAt',
    onErasure: ErasureAction.RETAIN,
    audited: true,
    notes:
      'Proof of consent must outlive the account it describes, otherwise a withdrawal cannot be demonstrated. Withdrawal appends a new row; it never edits the old one.',
  },
  {
    model: 'PreferenceAuditLog',
    table: 'preference_audit_logs',
    recordClass: RecordClass.IMMUTABLE,
    category: DataCategory.CONSENT,
    retentionDays: Retention.SEVEN_YEARS,
    retentionAnchor: 'createdAt',
    onErasure: ErasureAction.RETAIN,
    audited: false,
    notes:
      'Field-level history for privacy preferences. Append-only and self-auditing, so it needs no audit event of its own.',
  },

  // ── Security ──────────────────────────────────────────────────────────────
  {
    model: 'AuditEvent',
    table: 'audit_events',
    recordClass: RecordClass.IMMUTABLE,
    category: DataCategory.SECURITY,
    retentionDays: Retention.SEVEN_YEARS,
    retentionAnchor: 'occurredAt',
    onErasure: ErasureAction.RETAIN,
    audited: false,
    notes:
      'The audit spine. UPDATE is rejected outright by a database trigger; DELETE is permitted only to the retention purge. Retained through erasure because it stores no raw personal data.',
  },
  {
    model: 'AuditLog',
    table: 'audit_logs',
    recordClass: RecordClass.IMMUTABLE,
    category: DataCategory.SECURITY,
    retentionDays: Retention.TWO_YEARS,
    retentionAnchor: 'createdAt',
    onErasure: ErasureAction.ANONYMIZE,
    audited: false,
    notes:
      'Superseded by AuditEvent. Kept for the trail written before this policy landed; it holds raw IP and User-Agent, so erasure scrubs those columns rather than retaining the row untouched.',
  },
  {
    model: 'Session',
    table: 'sessions',
    recordClass: RecordClass.MUTABLE,
    category: DataCategory.SECURITY,
    retentionDays: Retention.NINETY_DAYS,
    retentionAnchor: 'updatedAt',
    onErasure: ErasureAction.DELETE,
    audited: true,
    notes:
      'Revocation is a status change, not an archive: a revoked session must stay visible to the learner in device management until it is purged.',
  },
  {
    model: 'RefreshToken',
    table: 'refresh_tokens',
    recordClass: RecordClass.MUTABLE,
    category: DataCategory.SECURITY,
    retentionDays: Retention.NINETY_DAYS,
    retentionAnchor: 'updatedAt',
    onErasure: ErasureAction.CASCADE,
    audited: true,
    notes:
      'Rotation family. Consumed rows are kept until purge so replay of an already-rotated token is still detectable as theft.',
  },
  {
    model: 'VerificationToken',
    table: 'verification_tokens',
    recordClass: RecordClass.MUTABLE,
    category: DataCategory.SECURITY,
    retentionDays: Retention.THIRTY_DAYS,
    retentionAnchor: 'createdAt',
    onErasure: ErasureAction.DELETE,
    audited: true,
    notes:
      'Single-use credential. Hard-deleted on erasure; the audit event records that it was issued and consumed.',
  },
  {
    model: 'OtpChallenge',
    table: 'otp_challenges',
    recordClass: RecordClass.MUTABLE,
    category: DataCategory.SECURITY,
    retentionDays: Retention.THIRTY_DAYS,
    retentionAnchor: 'createdAt',
    onErasure: ErasureAction.DELETE,
    audited: true,
    notes:
      'Holds a phone number and a code hash. Short retention because the lockout and rate-limit decisions it supports are themselves short-lived.',
  },
  {
    model: 'ManagedKeyReference',
    table: 'managed_key_references',
    recordClass: RecordClass.IMMUTABLE,
    category: DataCategory.SECURITY,
    retentionDays: Retention.INDEFINITE,
    retentionAnchor: null,
    onErasure: ErasureAction.RETAIN,
    audited: true,
    notes:
      'Opaque KMS handle — never key material. Retained because destroying the reference orphans any funds held under that key.',
  },

  // ── Money ─────────────────────────────────────────────────────────────────
  {
    model: 'Transaction',
    table: 'Transaction',
    recordClass: RecordClass.IMMUTABLE,
    category: DataCategory.MONEY,
    retentionDays: Retention.SEVEN_YEARS,
    retentionAnchor: 'createdAt',
    onErasure: ErasureAction.RETAIN,
    audited: true,
    notes:
      'Ledger entry. Corrections are booked as new reversing entries, never as edits. Carries no in-row personal data, so erasure keeps it.',
  },
  {
    model: 'Wallet',
    table: 'wallets',
    recordClass: RecordClass.MUTABLE,
    category: DataCategory.MONEY,
    retentionDays: Retention.INDEFINITE,
    retentionAnchor: null,
    onErasure: ErasureAction.RETAIN,
    audited: true,
    notes:
      'Custody state machine. Every status transition is audited because it changes who controls the funds.',
  },
  {
    model: 'WalletProvisioningJob',
    table: 'wallet_provisioning_jobs',
    recordClass: RecordClass.MUTABLE,
    category: DataCategory.OPERATIONAL,
    retentionDays: Retention.NINETY_DAYS,
    retentionAnchor: 'updatedAt',
    onErasure: ErasureAction.CASCADE,
    audited: false,
    notes:
      'Lease and retry bookkeeping for provisioning. The wallet it provisions carries the audit trail.',
  },
  {
    model: 'StellarFunding',
    table: 'stellar_fundings',
    recordClass: RecordClass.MUTABLE,
    category: DataCategory.MONEY,
    retentionDays: Retention.SEVEN_YEARS,
    retentionAnchor: 'createdAt',
    onErasure: ErasureAction.RETAIN,
    audited: true,
    notes:
      'Keyed by Stellar public key rather than by user, so erasure severs the link without touching the row.',
  },
  {
    model: 'ReferralCode',
    table: 'referral_codes',
    recordClass: RecordClass.ARCHIVABLE,
    category: DataCategory.MONEY,
    retentionDays: Retention.ONE_YEAR,
    retentionAnchor: 'archivedAt',
    onErasure: ErasureAction.CASCADE,
    audited: true,
    notes:
      'Retiring a code must not break the Referral rows pointing at it, so retirement archives the code instead of deleting it.',
  },
  {
    model: 'Referral',
    table: 'referrals',
    recordClass: RecordClass.IMMUTABLE,
    category: DataCategory.MONEY,
    retentionDays: Retention.SEVEN_YEARS,
    retentionAnchor: 'createdAt',
    onErasure: ErasureAction.RETAIN,
    audited: true,
    notes:
      'Records a bonus obligation between two accounts. Only the payout columns advance, and each advance is audited.',
  },

  // ── Credentials ───────────────────────────────────────────────────────────
  {
    model: 'Credential',
    table: 'Credential',
    recordClass: RecordClass.IMMUTABLE,
    category: DataCategory.CREDENTIAL,
    retentionDays: Retention.INDEFINITE,
    retentionAnchor: null,
    onErasure: ErasureAction.RETAIN,
    audited: true,
    notes:
      'A credential a third party may verify against the chain. Revocation appends a revocation record; the issuance row itself is permanent.',
  },
  {
    model: 'Completion',
    table: 'Completion',
    recordClass: RecordClass.IMMUTABLE,
    category: DataCategory.CREDENTIAL,
    retentionDays: Retention.INDEFINITE,
    retentionAnchor: null,
    onErasure: ErasureAction.DELETE,
    audited: true,
    notes:
      'Evidence behind a credential. Immutable while the account lives, but deleted on erasure because it reveals what a named learner studied.',
  },

  // ── Content ───────────────────────────────────────────────────────────────
  {
    model: 'Module',
    table: 'Module',
    recordClass: RecordClass.ARCHIVABLE,
    category: DataCategory.CONTENT,
    retentionDays: Retention.INDEFINITE,
    retentionAnchor: 'archivedAt',
    onErasure: ErasureAction.RETAIN,
    audited: true,
    notes:
      'Authored content, never purged: completions and credentials reference the module a learner actually took, so withdrawing it archives it.',
  },

  // ── Operational ───────────────────────────────────────────────────────────
  {
    model: 'SyncEvent',
    table: 'sync_events',
    recordClass: RecordClass.IMMUTABLE,
    category: DataCategory.OPERATIONAL,
    retentionDays: Retention.NINETY_DAYS,
    retentionAnchor: 'createdAt',
    onErasure: ErasureAction.DELETE,
    audited: false,
    notes:
      'Idempotency journal for offline clients. Append-only by construction; the unique key is what makes replay safe.',
  },
  {
    model: 'EmailDelivery',
    table: 'email_deliveries',
    recordClass: RecordClass.MUTABLE,
    category: DataCategory.OPERATIONAL,
    retentionDays: Retention.THIRTY_DAYS,
    retentionAnchor: 'createdAt',
    onErasure: ErasureAction.DELETE,
    audited: false,
    notes:
      'Outbox row holding a rendered message body, and therefore personal data. Deleted on erasure and purged aggressively.',
  },
  {
    model: 'NotificationLog',
    table: 'NotificationLog',
    recordClass: RecordClass.MUTABLE,
    category: DataCategory.OPERATIONAL,
    retentionDays: Retention.THIRTY_DAYS,
    retentionAnchor: 'createdAt',
    onErasure: ErasureAction.DELETE,
    audited: false,
    notes: 'Rendered push payload. Same reasoning as EmailDelivery.',
  },
  {
    model: 'NotificationPreference',
    table: 'NotificationPreference',
    recordClass: RecordClass.MUTABLE,
    category: DataCategory.IDENTITY,
    retentionDays: Retention.INDEFINITE,
    retentionAnchor: null,
    onErasure: ErasureAction.CASCADE,
    audited: false,
    notes:
      'Channel opt-ins. Privacy-impacting consent lives in ConsentRecord, not here.',
  },
  {
    model: 'DeviceToken',
    table: 'DeviceToken',
    recordClass: RecordClass.DELETABLE,
    category: DataCategory.OPERATIONAL,
    retentionDays: Retention.NINETY_DAYS,
    retentionAnchor: 'updatedAt',
    onErasure: ErasureAction.DELETE,
    audited: false,
    notes:
      'Push handle for one device. Stale handles are deleted, never archived — an archived token would still be a live address.',
  },
  {
    model: 'WebhookEndpoint',
    table: 'WebhookEndpoint',
    recordClass: RecordClass.ARCHIVABLE,
    category: DataCategory.OPERATIONAL,
    retentionDays: Retention.ONE_YEAR,
    retentionAnchor: 'archivedAt',
    onErasure: ErasureAction.RETAIN,
    audited: true,
    notes:
      'Partner configuration holding a signing secret. Archived so the delivery history keeps its endpoint; audited because changing the URL redirects learner data.',
  },
  {
    model: 'WebhookDelivery',
    table: 'WebhookDelivery',
    recordClass: RecordClass.MUTABLE,
    category: DataCategory.OPERATIONAL,
    retentionDays: Retention.THIRTY_DAYS,
    retentionAnchor: 'createdAt',
    onErasure: ErasureAction.RETAIN,
    audited: false,
    notes:
      'Attempt log with request and response bodies. Short retention keeps that payload exposure bounded.',
  },
  {
    model: 'DataExportRequest',
    table: 'data_export_requests',
    recordClass: RecordClass.DELETABLE,
    category: DataCategory.IDENTITY,
    retentionDays: Retention.SEVEN_DAYS,
    retentionAnchor: 'completedAt',
    onErasure: ErasureAction.DELETE,
    audited: true,
    notes:
      'The artifact is a full personal-data dump — the highest-value row in the schema. Shortest retention of anything here, and every state change is audited.',
  },
  {
    model: 'AccountDeletionRequest',
    table: 'account_deletion_requests',
    recordClass: RecordClass.MUTABLE,
    category: DataCategory.IDENTITY,
    retentionDays: Retention.SEVEN_YEARS,
    retentionAnchor: 'createdAt',
    onErasure: ErasureAction.RETAIN,
    audited: true,
    notes:
      'Evidence that an erasure request was honoured. Retained past the erasure it triggers, which is why it must hold no personal data beyond the user id.',
  },
  {
    model: 'OutboxEvent',
    table: 'outbox_events',
    recordClass: RecordClass.MUTABLE,
    category: DataCategory.OPERATIONAL,
    retentionDays: Retention.THIRTY_DAYS,
    retentionAnchor: 'createdAt',
    onErasure: ErasureAction.RETAIN,
    audited: false,
    notes:
      'Delivery status advances until PUBLISHED or DEAD_LETTER. The payload is domain data, not an audit record — audit events are written separately.',
  },
  {
    model: 'JobAttempt',
    table: 'job_attempts',
    recordClass: RecordClass.MUTABLE,
    category: DataCategory.OPERATIONAL,
    retentionDays: Retention.THIRTY_DAYS,
    retentionAnchor: 'createdAt',
    onErasure: ErasureAction.CASCADE,
    audited: false,
    notes: 'Lease and retry state. Purged with its outbox event.',
  },
  {
    model: 'RolledBackRecord',
    table: 'rolled_back_records',
    recordClass: RecordClass.IMMUTABLE,
    category: DataCategory.OPERATIONAL,
    retentionDays: Retention.THIRTY_DAYS,
    retentionAnchor: 'createdAt',
    onErasure: ErasureAction.RETAIN,
    audited: false,
    notes: 'Tombstone marking an event as unprocessable. Written once, then only read.',
  },
]

const BY_MODEL: ReadonlyMap<string, LifecycleRule> = new Map(
  RULES.map((rule) => [rule.model, rule])
)

/** Every rule in the matrix, in declaration order. */
export function lifecycleRules(): readonly LifecycleRule[] {
  return RULES
}

/** The rule for a model, or `undefined` if the model is unclassified. */
export function lifecycleRuleFor(model: string): LifecycleRule | undefined {
  return BY_MODEL.get(model)
}

/**
 * Lifecycle class of a model. Unclassified models fall back to MUTABLE so a
 * missing rule degrades to the least surprising behaviour instead of throwing
 * from inside an audit write.
 */
export function recordClassFor(model: string): RecordClassValue {
  return BY_MODEL.get(model)?.recordClass ?? RecordClass.MUTABLE
}

/** Models whose mutations must go through an audited mutation. */
export function auditedModels(): readonly string[] {
  return RULES.filter((rule) => rule.audited).map((rule) => rule.model)
}

/** Whether mutations of a model must be audited. */
export function requiresAudit(model: string): boolean {
  return BY_MODEL.get(model)?.audited ?? false
}

/** Models in a given lifecycle class. */
export function modelsInClass(recordClass: RecordClassValue): readonly string[] {
  return RULES.filter((rule) => rule.recordClass === recordClass).map((rule) => rule.model)
}

/**
 * Cut-off before which a model's rows are eligible for a retention purge, or
 * `null` when the model is retained indefinitely.
 */
export function retentionCutoff(model: string, now: Date = new Date()): Date | null {
  const rule = BY_MODEL.get(model)
  if (!rule || rule.retentionDays === null) {
    return null
  }

  return new Date(now.getTime() - rule.retentionDays * 24 * 60 * 60_000)
}
