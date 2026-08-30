/**
 * Archive (soft-delete) semantics and the default-exclusion rule.
 *
 * An archivable record is withdrawn by stamping `archivedAt` instead of being
 * deleted, because something else still depends on it — a Completion needs the
 * Module a learner actually took, a Referral needs the code that created it.
 *
 * The cost of soft deletion is that every read has to remember to filter, and
 * one forgotten filter leaks withdrawn content. So the filter is not left to
 * callers: {@link archiveExclusionExtension} injects it into read queries, and
 * a caller that wants archived rows has to say so explicitly.
 */

import { modelsInClass } from './classification.js'
import { RecordClass } from './types.js'

/** Models carrying archive columns, derived from the lifecycle matrix. */
export const ARCHIVABLE_MODELS: ReadonlySet<string> = new Set(
  modelsInClass(RecordClass.ARCHIVABLE),
)

/**
 * Read operations that get the `archivedAt: null` filter injected.
 *
 * `findUnique` is deliberately absent. It resolves a single row by primary key,
 * where a silent filter turns a found row into `null` and reads as "deleted" to
 * calling code that has the id in hand. Point lookups therefore return archived
 * rows, and callers that care use {@link isArchived} or {@link assertActive}.
 *
 * Writes are absent for the same reason: an archive or a restore is a write
 * that must be able to see the row it is changing.
 */
const FILTERED_OPERATIONS: ReadonlySet<string> = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
])

/** Columns stamped when a record is archived. */
export interface ArchiveColumns {
  archivedAt: Date | null
  archivedById: string | null
  archivedReason: string | null
}

/** A record that may or may not be archived. */
type MaybeArchived = { archivedAt?: Date | null }

/**
 * Whether a `where` clause already talks about `archivedAt`, at the top level or
 * inside a boolean combinator. If it does, the caller has an opinion and the
 * extension leaves it alone.
 *
 * `hasOwnProperty` rather than a truthiness check, so `{ archivedAt: undefined }`
 * — which is how {@link includeArchived} opts out — counts as an opinion even
 * though Prisma itself ignores the undefined value.
 */
export function mentionsArchivedAt(where: unknown): boolean {
  if (!where || typeof where !== 'object') {
    return false
  }

  if (Array.isArray(where)) {
    return where.some(mentionsArchivedAt)
  }

  const clause = where as Record<string, unknown>

  if (Object.prototype.hasOwnProperty.call(clause, 'archivedAt')) {
    return true
  }

  return (['AND', 'OR', 'NOT'] as const).some(
    (combinator) =>
      Object.prototype.hasOwnProperty.call(clause, combinator) &&
      mentionsArchivedAt(clause[combinator]),
  )
}

/** One intercepted Prisma operation, as the client extension sees it. */
export interface QueryInterception<A = unknown, R = unknown> {
  model?: string
  operation: string
  args: A
  query: (args: A) => Promise<R>
}

/**
 * The interceptor behind {@link archiveExclusionExtension}: forwards the query
 * with `archivedAt: null` added when the model is archivable, the operation is a
 * read, and the caller has not already filtered on `archivedAt`.
 *
 * Exported as a plain function because `Prisma.defineExtension` returns an
 * opaque closure — the decision this makes is the whole soft-delete guarantee,
 * so it needs to be testable without a database.
 */
export async function excludeArchivedFromReads<R>({
  model,
  operation,
  args,
  query,
}: QueryInterception<unknown, R>): Promise<R> {
  if (
    !model ||
    !ARCHIVABLE_MODELS.has(model) ||
    !FILTERED_OPERATIONS.has(operation)
  ) {
    return query(args)
  }

  const typed = (args ?? {}) as { where?: Record<string, unknown> }

  if (mentionsArchivedAt(typed.where)) {
    return query(args)
  }

  return query({
    ...typed,
    where: { ...(typed.where ?? {}), archivedAt: null },
  })
}

/**
 * Prisma client extension that hides archived rows from list and aggregate
 * queries on archivable models.
 *
 * Applied once, in src/config/database.ts, so "exclude archived records by
 * default" holds for code that has never heard of this module.
 *
 * A plain object rather than `Prisma.defineExtension(...)`. `defineExtension`
 * only adds type inference this does not need, and importing the `Prisma`
 * namespace here would drag it into every module that reaches the Prisma client
 * — breaking any test that mocks `@prisma/client` without re-exporting it.
 */
export const archiveExclusionExtension = {
  name: 'archiveExclusion',
  query: {
    $allModels: {
      $allOperations: excludeArchivedFromReads,
    },
  },
} as const

/**
 * Restrict a `where` clause to live rows. Redundant for the operations the
 * extension already covers; useful for `findUnique` and for raw queries.
 */
export function activeOnly<W extends object>(
  where?: W,
): W & { archivedAt: null } {
  return { ...((where ?? {}) as W), archivedAt: null }
}

/** Restrict a `where` clause to archived rows only. */
export function archivedOnly<W extends object>(
  where?: W,
): W & { archivedAt: { not: null } } {
  return { ...((where ?? {}) as W), archivedAt: { not: null } }
}

/**
 * Opt out of default exclusion for one query.
 *
 * Sets `archivedAt` to `undefined`: Prisma ignores an undefined filter, while
 * the extension sees the key and stands down. Explicit at the call site, which
 * is the point — an unfiltered read of archivable data should be visible in
 * review.
 */
export function includeArchived<W extends object>(
  where?: W,
): W & { archivedAt: undefined } {
  return { ...((where ?? {}) as W), archivedAt: undefined }
}

/**
 * The `data` patch that archives a record. `reason` is required: an archive
 * with no stated reason is indistinguishable from an accident six months later.
 */
export function archivePatch(
  reason: string,
  archivedById?: string | null,
  now: Date = new Date(),
): ArchiveColumns {
  return {
    archivedAt: now,
    archivedById: archivedById ?? null,
    archivedReason: reason,
  }
}

/** The `data` patch that restores an archived record. */
export function restorePatch(): ArchiveColumns {
  return {
    archivedAt: null,
    archivedById: null,
    archivedReason: null,
  }
}

/** Whether a loaded record is archived. */
export function isArchived(record: MaybeArchived | null | undefined): boolean {
  return Boolean(record?.archivedAt)
}

/**
 * Narrow a point lookup to a live record, returning `null` for an archived one.
 * The counterpart to `findUnique` being exempt from the extension.
 */
export function assertActive<T extends MaybeArchived>(
  record: T | null,
): T | null {
  return record && !isArchived(record) ? record : null
}

/**
 * Cut-off before which archived rows of a model may be purged, or `null` when
 * archived rows of that model are kept indefinitely.
 *
 * Re-exported through the module's retention helper so callers do not need to
 * know that the anchor column differs per model.
 */
export function archivedPurgeCutoff(
  retentionDays: number | null,
  now: Date = new Date(),
): Date | null {
  if (retentionDays === null) {
    return null
  }

  return new Date(now.getTime() - retentionDays * 24 * 60 * 60_000)
}
