/**
 * The reusable audited mutation.
 *
 * Wraps a state change and its audit event in one transaction, so the two
 * commit together or not at all. That is the whole point: an audit trail written
 * *after* a successful mutation is a trail with holes in it, because the process
 * can die in between, and a trail written *before* records changes that never
 * happened.
 *
 * Note the difference from `auditEventService.record`, which swallows failures.
 * Here a failed audit write rolls the mutation back. A sensitive change that
 * cannot be attributed is a change that should not land.
 */

import prisma from '../config/database'
import { auditEventService } from './audit-event.service.js'
import { lifecycleRuleFor } from './classification.js'
import { archivePatch, restorePatch } from './archive.js'
import { ActorType, AuditActor, AuditEventInput, AuditTarget } from './types.js'

/**
 * The client handed to a mutation body: the full Prisma client minus the
 * operations that cannot run inside an interactive transaction.
 *
 * Derived from the configured client rather than from `Prisma.TransactionClient`
 * so it stays correct as extensions are added in src/config/database.ts.
 */
export type AuditedTransactionClient = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends' | '$use'
>

/** Request-scoped context, as produced by {@link actorFromRequest}. */
export interface AuditContext {
  actor: AuditActor
  requestId?: string | null
  ipAddress?: string | null
  userAgent?: string | null
}

export interface AuditedMutationSpec<T> {
  /** Dotted action name, e.g. `"account.deactivated"`. */
  action: string
  /** Who is making the change. */
  actor: AuditActor
  /**
   * What is being changed. `id` may be omitted when it is only known after the
   * mutation runs — use {@link resolveTargetId} for that case.
   */
  target: AuditTarget
  /**
   * Why. Mandatory for ADMIN actors: a staff member changing another person's
   * record without a stated reason is the exact case an audit trail exists for.
   */
  reason?: string | null
  requestId?: string | null
  correlationId?: string | null
  /** Code path producing the change, e.g. `"api.account.deactivate"`. */
  source?: string | null
  /** Context for the event. Redacted before storage — never pass secrets. */
  metadata?: Record<string, unknown> | null
  ipAddress?: string | null
  userAgent?: string | null
  /**
   * The state change. Receives the transaction client and must perform every
   * write through it, or the write will not be covered by the audit's atomicity.
   */
  mutate: (tx: AuditedTransactionClient) => Promise<T>
  /** Derive the target id from the mutation result (e.g. for a create). */
  resolveTargetId?: (result: T) => string | null | undefined
  /** Derive extra metadata from the result (e.g. the status actually reached). */
  resolveMetadata?: (result: T) => Record<string, unknown> | null | undefined
}

/** Thrown when a spec violates the audit policy, before anything is written. */
export class AuditPolicyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuditPolicyError'
  }
}

/**
 * Run a mutation and append its audit event atomically, returning the mutation's
 * result.
 *
 * ```ts
 * const wallet = await auditedMutation({
 *   action: 'wallet.status_changed',
 *   actor: { type: ActorType.WORKER, id: 'wallet-provisioning' },
 *   target: { type: 'Wallet', id: walletId },
 *   source: 'worker.wallet-provisioning',
 *   metadata: { from: 'RESERVED', to: 'ACTIVE' },
 *   mutate: (tx) =>
 *     tx.wallet.update({ where: { id: walletId }, data: { status: 'ACTIVE' } }),
 * })
 * ```
 */
export async function auditedMutation<T>(spec: AuditedMutationSpec<T>): Promise<T> {
  assertPolicy(spec)

  return prisma.$transaction(async (tx) => {
    const result = await spec.mutate(tx as AuditedTransactionClient)

    const resolvedId = spec.resolveTargetId?.(result)
    const extraMetadata = spec.resolveMetadata?.(result)

    const event: AuditEventInput = {
      action: spec.action,
      actor: spec.actor,
      target: {
        type: spec.target.type,
        id: spec.target.id ?? resolvedId ?? null,
      },
      reason: spec.reason,
      requestId: spec.requestId,
      correlationId: spec.correlationId,
      source: spec.source,
      metadata:
        spec.metadata || extraMetadata
          ? { ...(spec.metadata ?? {}), ...(extraMetadata ?? {}) }
          : null,
      ipAddress: spec.ipAddress,
      userAgent: spec.userAgent,
    }

    await auditEventService.recordWithin(tx, event)

    return result
  })
}

/**
 * Archive a record and audit it, in one transaction.
 *
 * `model` is the Prisma model name; it is checked against the lifecycle matrix,
 * so archiving something the policy does not classify as ARCHIVABLE fails loudly
 * instead of writing an `archivedAt` to a column that may not exist.
 */
export async function auditedArchive<T>(input: {
  model: string
  id: string
  reason: string
  actor: AuditActor
  context?: Omit<AuditContext, 'actor'>
  correlationId?: string | null
  source?: string | null
  metadata?: Record<string, unknown> | null
  archive: (tx: AuditedTransactionClient, patch: ReturnType<typeof archivePatch>) => Promise<T>
}): Promise<T> {
  assertArchivable(input.model, 'archive')

  if (!input.reason?.trim()) {
    throw new AuditPolicyError(
      `Archiving ${input.model} requires a reason: an archive with no stated reason cannot be reviewed later.`
    )
  }

  const patch = archivePatch(input.reason, input.actor.id ?? null)

  return auditedMutation({
    action: `${camelToSnake(input.model)}.archived`,
    actor: input.actor,
    target: { type: input.model, id: input.id },
    reason: input.reason,
    requestId: input.context?.requestId,
    ipAddress: input.context?.ipAddress,
    userAgent: input.context?.userAgent,
    correlationId: input.correlationId,
    source: input.source,
    metadata: { ...(input.metadata ?? {}), archivedAt: patch.archivedAt },
    mutate: (tx) => input.archive(tx, patch),
  })
}

/** Restore an archived record and audit it, in one transaction. */
export async function auditedRestore<T>(input: {
  model: string
  id: string
  reason: string
  actor: AuditActor
  context?: Omit<AuditContext, 'actor'>
  correlationId?: string | null
  source?: string | null
  metadata?: Record<string, unknown> | null
  restore: (tx: AuditedTransactionClient, patch: ReturnType<typeof restorePatch>) => Promise<T>
}): Promise<T> {
  assertArchivable(input.model, 'restore')

  return auditedMutation({
    action: `${camelToSnake(input.model)}.restored`,
    actor: input.actor,
    target: { type: input.model, id: input.id },
    reason: input.reason,
    requestId: input.context?.requestId,
    ipAddress: input.context?.ipAddress,
    userAgent: input.context?.userAgent,
    correlationId: input.correlationId,
    source: input.source,
    metadata: input.metadata ?? null,
    mutate: (tx) => input.restore(tx, restorePatch()),
  })
}

/**
 * Build audit context from an Express request.
 *
 * Reads the actor from `req.actor` (set by the request-context middleware after
 * authentication) and falls back to an ANONYMOUS actor, so an unauthenticated
 * action is still attributable to a request rather than to nobody.
 *
 * The raw IP and User-Agent are carried through, but the audit writer hashes and
 * coarsens them before they reach the database.
 */
export function actorFromRequest(req: {
  actor?: { id: string; role: string } | undefined
  requestId?: string | undefined
  ip?: string | undefined
  headers?: Record<string, unknown> | undefined
}): AuditContext {
  const userAgent = req.headers?.['user-agent']

  return {
    actor: req.actor
      ? {
          // A staff role acting through the API is an ADMIN actor: it is the
          // actor's authority, not the endpoint, that decides how much scrutiny
          // the event deserves.
          type: req.actor.role === 'ADMIN' ? ActorType.ADMIN : ActorType.USER,
          id: req.actor.id,
          role: req.actor.role,
        }
      : { type: ActorType.ANONYMOUS },
    requestId: req.requestId ?? null,
    ipAddress: req.ip ?? null,
    userAgent: typeof userAgent === 'string' ? userAgent : null,
  }
}

/** A system actor, for sweeps and migrations with no human trigger. */
export function systemActor(component: string): AuditActor {
  return { type: ActorType.SYSTEM, id: component }
}

/** A worker actor, for queue-draining background work. */
export function workerActor(worker: string): AuditActor {
  return { type: ActorType.WORKER, id: worker }
}

function assertPolicy<T>(spec: AuditedMutationSpec<T>): void {
  if (!spec.action.trim()) {
    throw new AuditPolicyError('An audited mutation requires an action name.')
  }

  if (!spec.target.type.trim()) {
    throw new AuditPolicyError(
      `Audited mutation "${spec.action}" requires a target type (the Prisma model name).`
    )
  }

  if (spec.actor.type === ActorType.ADMIN && !spec.reason?.trim()) {
    throw new AuditPolicyError(
      `Audited mutation "${spec.action}" is performed by an ADMIN actor and therefore requires a reason.`
    )
  }

  if ((spec.actor.type === ActorType.USER || spec.actor.type === ActorType.ADMIN) && !spec.actor.id) {
    throw new AuditPolicyError(
      `Audited mutation "${spec.action}" has a ${spec.actor.type} actor with no id; the event would be unattributable.`
    )
  }
}

function assertArchivable(model: string, verb: string): void {
  const rule = lifecycleRuleFor(model)

  if (!rule) {
    throw new AuditPolicyError(
      `Cannot ${verb} ${model}: it has no rule in the lifecycle matrix (src/audit/classification.ts).`
    )
  }

  if (rule.recordClass !== 'ARCHIVABLE') {
    throw new AuditPolicyError(
      `Cannot ${verb} ${model}: the lifecycle matrix classifies it as ${rule.recordClass}, not ARCHIVABLE.`
    )
  }
}

/** `LearnerProfile` → `learner_profile`, for building default action names. */
function camelToSnake(model: string): string {
  return model.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
}
