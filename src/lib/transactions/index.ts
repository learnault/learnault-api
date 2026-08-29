/**
 * Transaction Outbox Pattern Module
 *
 * Provides primitives for reliable event delivery across PostgreSQL, job queues,
 * and external systems (blockchain, notifications, webhooks).
 *
 * Core concepts:
 * - OutboxEvent: Domain event written atomically with domain changes
 * - JobAttempt: Work queued for asynchronous processing
 * - Lease-based concurrency: Only one worker processes each job
 * - Exponential backoff: Retries with increasing delays
 * - Dead-lettering: Permanent failures for manual recovery
 * - Idempotent completion: Prevents duplicate side effects
 *
 * Export all types and services from this module
 */

export * from './types.js'
export * from './outbox.service.js'
export * from './job-lease.service.js'
export * from './event-schema.js'
