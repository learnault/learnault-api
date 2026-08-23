/**
 * Auditable Data Lifecycle module.
 *
 * Four pieces, each answering one requirement of the policy:
 *
 *  - classification.ts — every model classified as mutable, archivable,
 *    deletable or immutable, with a retention window and an erasure behaviour.
 *  - audit-event.service.ts — the append-only audit trail.
 *  - audited-mutation.ts — the helper that makes a change and its audit event
 *    commit together.
 *  - archive.ts — soft deletion, and the rule that archived rows are excluded
 *    from reads by default.
 *  - redaction.ts — the filter that keeps secrets and unnecessary PII out of
 *    the trail, applied on the way in because immutable rows cannot be scrubbed.
 *
 * See docs/DATA_LIFECYCLE.md for the matrix and the reasoning behind it.
 */

export * from './types.js'
export * from './classification.js'
export * from './redaction.js'
export * from './archive.js'
export * from './audit-event.service.js'
export * from './audited-mutation.js'
