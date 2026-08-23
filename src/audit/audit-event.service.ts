/**
 * Immutable audit event writer and reader.
 *
 * Every row records who did what to which record, why, and under which request.
 * Nothing here can update or delete an event: the only mutating methods are the
 * append path and the retention purge, and the database rejects anything else
 * (see the trigger in the auditable_data_lifecycle migration).
 */

import prisma from '../config/database'
import logger from '../utils/logger'
import { env } from '../config/env'
import { recordClassFor, retentionCutoff } from './classification.js'
import { hashIpAddress, serializeMetadata, userAgentFamily } from './redaction.js'
import {
  AuditEventInput,
  AuditEventQuery,
  AuditEventRecord,
  RecordClassValue,
} from './types.js'

/**
 * Postgres session variable that lets the retention purge — and only the
 * retention purge — delete audit rows. The trigger checks it by name.
 */
export const AUDIT_PURGE_SETTING = 'learnault.audit_purge'

/**
 * Fallback IP-hash secret for development and test, where a stable value across
 * restarts is more useful than a strong one. Never reached in production: an
 * unset secret there disables IP hashing outright rather than falling back to a
 * value that is public in this repository.
 */
const DEV_IP_HASH_SECRET = 'learnault-dev-audit-ip-hash'

/** Rows returned by a single {@link AuditEventService.list} call, by default. */
const DEFAULT_PAGE_SIZE = 50

/** Hard ceiling on a page, so a caller cannot pull the whole trail at once. */
const MAX_PAGE_SIZE = 200

/** Minimal shape this service needs from a Prisma client or transaction. */
type AuditEventWriter = {
  auditEvent: {
    create: (args: { data: AuditEventRow }) => unknown
  }
}

/** The row as it is written. Mirrors the AuditEvent model in the schema. */
export interface AuditEventRow {
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
}

export class AuditEventService {
  /**
   * Append an audit event outside a transaction.
   *
   * Never throws — an observability failure must not take down the flow it is
   * observing. Use this only for events that stand alone (a failed login, a
   * rate-limit trip). Anything that accompanies a state change belongs in
   * `auditedMutation`, where the audit row and the change commit together.
   */
  async record(input: AuditEventInput): Promise<void> {
    try {
      await prisma.auditEvent.create({ data: this.toRow(input) })
    } catch (error) {
      // Log the action, never the metadata: the metadata is the part that may
      // have been rejected for being oversized or malformed.
      logger.error('[AuditEventService] Failed to append audit event', {
        action: input.action,
        targetType: input.target.type,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Build an `auditEvent.create` operation for a `prisma.$transaction([...])`
   * array, so the event commits atomically with the change it describes.
   */
  op(input: AuditEventInput) {
    return prisma.auditEvent.create({ data: this.toRow(input) })
  }

  /**
   * Append an audit event on a specific transaction client. Unlike
   * {@link record} this propagates failures, because inside a transaction a
   * rejected audit write must roll the mutation back rather than let an
   * unaudited change through.
   */
  async recordWithin(tx: AuditEventWriter, input: AuditEventInput): Promise<void> {
    await tx.auditEvent.create({ data: this.toRow(input) })
  }

  /**
   * Read the audit trail. Returns rows exactly as stored: the redaction that
   * matters already happened at write time, so there is nothing left to filter
   * on the way out.
   */
  async list(query: AuditEventQuery = {}): Promise<AuditEventRecord[]> {
    const take = Math.min(Math.max(query.take ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)

    const occurredAt =
      query.from || query.to
        ? { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) }
        : undefined

    const rows = await prisma.auditEvent.findMany({
      where: {
        ...(query.actorId ? { actorId: query.actorId } : {}),
        ...(query.actorType ? { actorType: query.actorType } : {}),
        ...(query.action ? { action: query.action } : {}),
        ...(query.targetType ? { targetType: query.targetType } : {}),
        ...(query.targetId ? { targetId: query.targetId } : {}),
        ...(query.requestId ? { requestId: query.requestId } : {}),
        ...(occurredAt ? { occurredAt } : {}),
      },
      orderBy: { occurredAt: 'desc' },
      take,
      skip: query.skip ?? 0,
    })

    return rows as AuditEventRecord[]
  }

  /** Every event touching one record, oldest first — the record's history. */
  async historyFor(
    targetType: string,
    targetId: string,
    take = DEFAULT_PAGE_SIZE
  ): Promise<AuditEventRecord[]> {
    const rows = await prisma.auditEvent.findMany({
      where: { targetType, targetId },
      orderBy: { occurredAt: 'asc' },
      take: Math.min(Math.max(take, 1), MAX_PAGE_SIZE),
    })

    return rows as AuditEventRecord[]
  }

  /**
   * Delete audit events past their retention window.
   *
   * This is the only sanctioned deletion path. It opens a transaction, sets the
   * purge session variable the immutability trigger checks, and deletes by
   * timestamp — so a purge can never be used to remove a *specific*
   * inconvenient event, only everything older than the cut-off.
   */
  async purgeExpired(now: Date = new Date()): Promise<number> {
    const cutoff = retentionCutoff('AuditEvent', now)

    if (!cutoff) {
      return 0
    }

    try {
      return await prisma.$transaction(async (tx) => {
        // SET LOCAL takes no bind parameters, hence the raw statement. The
        // setting name is a module constant and never caller-supplied.
        await tx.$executeRawUnsafe(`SET LOCAL "${AUDIT_PURGE_SETTING}" = 'on'`)

        const deleted = await tx.$executeRaw`
          DELETE FROM "audit_events" WHERE "occurredAt" < ${cutoff}
        `

        return deleted
      })
    } catch (error) {
      logger.error('[AuditEventService] Retention purge failed', {
        cutoff: cutoff.toISOString(),
        error: error instanceof Error ? error.message : String(error),
      })

      return 0
    }
  }

  /**
   * Build the row for an input: resolves the lifecycle class, redacts metadata,
   * hashes the IP and coarsens the User-Agent.
   *
   * Exposed so tests and callers can assert on exactly what would be persisted
   * without touching a database.
   */
  toRow(input: AuditEventInput): AuditEventRow {
    const recordClass: RecordClassValue =
      input.recordClass ?? recordClassFor(input.target.type)

    // No secret means no hash. An HMAC under an empty key is a plain digest,
    // and the IPv4 space is small enough that a plain digest is reversible.
    const ipHashSecret = this.ipHashSecret()

    return {
      actorType: input.actor.type,
      actorId: input.actor.id ?? null,
      actorRole: input.actor.role ?? null,
      action: input.action,
      recordClass,
      targetType: input.target.type,
      targetId: input.target.id ?? null,
      reason: input.reason ?? null,
      requestId: input.requestId ?? null,
      correlationId: input.correlationId ?? null,
      source: input.source ?? null,
      metadata: serializeMetadata(input.metadata),
      actorIpHash: ipHashSecret ? hashIpAddress(input.ipAddress, ipHashSecret) : null,
      userAgentFamily: userAgentFamily(input.userAgent),
    }
  }

  /**
   * Resolve the HMAC secret for IP hashing.
   *
   * Returns an empty string in production when unconfigured, which
   * {@link toRow} treats as "do not hash at all". Correlating events by source
   * is a convenience; storing a reversible IP hash is not an acceptable price
   * for it.
   */
  private ipHashSecret(): string {
    if (env.AUDIT_IP_HASH_SECRET) {
      return env.AUDIT_IP_HASH_SECRET
    }

    if (env.NODE_ENV === 'production') {
      if (!this.warnedAboutSecret) {
        this.warnedAboutSecret = true
        logger.warn(
          '[AuditEventService] AUDIT_IP_HASH_SECRET is not set; audit events will omit the source IP hash.'
        )
      }

      return ''
    }

    return DEV_IP_HASH_SECRET
  }

  private warnedAboutSecret = false
}

export const auditEventService = new AuditEventService()
