/**
 * Auditable Data Lifecycle — type definitions.
 *
 * The lifecycle policy answers four questions for every persisted record:
 *   1. What class is it? (mutable / archivable / deletable / immutable)
 *   2. How long do we keep it? (retention)
 *   3. What happens on a subject's erasure request?
 *   4. Must mutations of it be audited?
 *
 * See docs/DATA_LIFECYCLE.md for the authoritative matrix and rationale.
 */

/**
 * Lifecycle class of a record.
 *
 * - MUTABLE:    Updated in place. History, where it matters, lives in audit events.
 * - ARCHIVABLE: Soft-deleted by stamping `archivedAt`. Rows survive so dependent
 *               records keep their referent; reads exclude them by default.
 * - DELETABLE:  Safe to hard-delete once expired or on erasure. Holds no record
 *               that anything else depends on.
 * - IMMUTABLE:  Append-only. Never updated, and deleted only by a retention purge.
 */
export const RecordClass = {
  MUTABLE: 'MUTABLE',
  ARCHIVABLE: 'ARCHIVABLE',
  DELETABLE: 'DELETABLE',
  IMMUTABLE: 'IMMUTABLE',
} as const

export type RecordClassValue = (typeof RecordClass)[keyof typeof RecordClass]

/**
 * Data category, which is what actually drives the retention period. Records in
 * the same category are kept for the same reason (regulatory, contractual, or
 * operational) and therefore for the same length of time.
 */
export const DataCategory = {
  /** Account identity and profile data for a natural person. */
  IDENTITY: 'IDENTITY',
  /** Money movement: ledger entries, payouts, bonuses, funding. */
  MONEY: 'MONEY',
  /** Earned credentials and the completions that back them. */
  CREDENTIAL: 'CREDENTIAL',
  /** Authentication material and security-relevant events. */
  SECURITY: 'SECURITY',
  /** Proof of consent and privacy-preference history. */
  CONSENT: 'CONSENT',
  /** Authored learning content and learner-supplied media. */
  CONTENT: 'CONTENT',
  /** Queues, delivery logs, sync journals — infrastructure bookkeeping. */
  OPERATIONAL: 'OPERATIONAL',
} as const

export type DataCategoryValue = (typeof DataCategory)[keyof typeof DataCategory]

/**
 * What happens to a record when the subject's erasure request is finalized.
 *
 * - DELETE:    Row is hard-deleted.
 * - ANONYMIZE: Row survives with identifying columns overwritten (tombstone),
 *              so retained foreign keys stay valid.
 * - RETAIN:    Row is kept as-is because it carries no in-row PII and there is
 *              an overriding obligation to keep it (money, credentials).
 * - CASCADE:   Row disappears with its parent via a database cascade.
 */
export const ErasureAction = {
  DELETE: 'DELETE',
  ANONYMIZE: 'ANONYMIZE',
  RETAIN: 'RETAIN',
  CASCADE: 'CASCADE',
} as const

export type ErasureActionValue =
  (typeof ErasureAction)[keyof typeof ErasureAction]

/** One row of the lifecycle matrix. */
export interface LifecycleRule {
  /** Prisma model name. */
  model: string
  /** Physical table name, as the migrations create it. */
  table: string
  recordClass: RecordClassValue
  category: DataCategoryValue
  /**
   * Days a row is kept before a retention purge may remove it, counted from the
   * anchor column. `null` means "retain indefinitely" — nothing purges it.
   */
  retentionDays: number | null
  /** Column the retention clock runs from (e.g. `createdAt`, `archivedAt`). */
  retentionAnchor: string | null
  onErasure: ErasureActionValue
  /** Whether mutations of this record must go through an audited mutation. */
  audited: boolean
  /** Why this classification — read by reviewers, not by code. */
  notes: string
}

/** Who caused an audited change. */
export const ActorType = {
  /** An end user acting on their own data. */
  USER: 'USER',
  /** A staff operator acting on someone else's data. */
  ADMIN: 'ADMIN',
  /** An automated in-process action with no human trigger (sweeps, migrations). */
  SYSTEM: 'SYSTEM',
  /** A background worker draining a queue. */
  WORKER: 'WORKER',
  /** An unauthenticated caller (e.g. a failed login attempt). */
  ANONYMOUS: 'ANONYMOUS',
} as const

export type ActorTypeValue = (typeof ActorType)[keyof typeof ActorType]

export interface AuditActor {
  type: ActorTypeValue
  /** Opaque identifier. Omitted for SYSTEM and ANONYMOUS actors. */
  id?: string | null
  /** Role held at the time of the action, not the role held now. */
  role?: string | null
}

export interface AuditTarget {
  /** Prisma model name of the affected record, e.g. `"User"`. */
  type: string
  /** Primary key of the affected row, when there is a single one. */
  id?: string | null
}

/**
 * An audit event to be appended. Everything here is either non-identifying or
 * passed through the redaction filter before it reaches the database.
 */
export interface AuditEventInput {
  action: string
  actor: AuditActor
  target: AuditTarget
  /** Caller-supplied justification. Required for ADMIN actors by convention. */
  reason?: string | null
  /** `x-request-id`, correlating the event to request logs. */
  requestId?: string | null
  /** Outbox event or job id when the change was applied asynchronously. */
  correlationId?: string | null
  /** Code path that produced the event, e.g. `"api.account.deactivate"`. */
  source?: string | null
  /** Free-form context. Redacted before it is written — never pass secrets. */
  metadata?: Record<string, unknown> | null
  /** Raw request IP. Stored only as a keyed hash, never in the clear. */
  ipAddress?: string | null
  /** Raw User-Agent. Stored only as a coarse family label. */
  userAgent?: string | null
  /** Lifecycle class of the target, defaulted from the matrix when omitted. */
  recordClass?: RecordClassValue
}

/** The persisted shape of an audit event row. */
export interface AuditEventRecord {
  id: string
  actorType: string
  actorId: string | null
  actorRole: string | null
  action: string
  recordClass: string
  targetType: string
  targetId: string | null
  reason: string | null
  requestId: string | null
  correlationId: string | null
  source: string | null
  metadata: string | null
  actorIpHash: string | null
  userAgentFamily: string | null
  occurredAt: Date
}

/** Filter for reading the audit trail. */
export interface AuditEventQuery {
  actorId?: string
  actorType?: ActorTypeValue
  action?: string
  targetType?: string
  targetId?: string
  requestId?: string
  from?: Date
  to?: Date
  take?: number
  skip?: number
}
