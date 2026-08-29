/**
 * Transaction Outbox Pattern Types
 *
 * Type definitions for transactional outbox primitives used to ensure reliable
 * event delivery across PostgreSQL, asynchronous job queues, and external systems
 * (blockchain, notifications, webhooks).
 */

/**
 * Outbox Event: Represents a domain event written atomically with domain changes
 * in a single PostgreSQL transaction.
 *
 * Key invariants:
 * - Events are immutable after creation
 * - Status transitions: PENDING → PROCESSING → PUBLISHED or DEAD_LETTER
 * - Rolled-back transactions are marked with ROLLED_BACK status to prevent processing
 */
export interface OutboxEvent {
  id: string
  aggregateId: string // UUID of root aggregate (e.g. userId, walletId)
  aggregateType: string // e.g. "User", "Wallet", "Completion"
  eventType: string // e.g. "UserCreated", "WalletProvisioned", "RewardClaimed"
  eventVersion: number // Schema version for event payload
  payload: unknown // Validated against eventVersion schema
  status: OutboxEventStatus
  publishedAt: Date | null
  source?: string // e.g. "api.reward.claim", "worker.wallet-provisioning"
  causedBy?: string // ID of OutboxEvent that triggered this one
  createdAt: Date
  updatedAt: Date
}

/**
 * Status of an OutboxEvent during its lifecycle
 */
export type OutboxEventStatus =
  | 'PENDING' // Waiting for worker to publish to job queues
  | 'PROCESSING' // Worker is publishing to job queues
  | 'PUBLISHED' // All job attempts have completed successfully
  | 'DEAD_LETTER' // Event or its jobs permanently failed
  | 'ROLLED_BACK' // Domain transaction rolled back; workers must skip

/**
 * Job Attempt: Represents one attempt to process a job related to an OutboxEvent
 *
 * Key invariants:
 * - One JobAttempt per (OutboxEvent, jobType) pair
 * - Lease-based concurrency: only one worker can hold leaseToken at a time
 * - Exponential backoff retry strategy with max attempts
 * - Idempotent completion prevents duplicate side effects
 * - Abandoned leases (leasedUntil in past) become retryable
 */
export interface JobAttempt {
  id: string
  outboxEventId: string // FK to OutboxEvent
  jobType: string // e.g. "wallet.provision", "email.send", "reward.distribute"
  jobName: string // Human-readable identifier for monitoring
  status: JobAttemptStatus
  leaseToken: string | null // Opaque token held by worker; null if not leased
  leasedUntil: Date | null // Lease expiration; null if not leased
  availableAt: Date // When job becomes available to lease (after backoff)
  attempt: number // 0-indexed attempt number
  maxAttempts: number // Configurable per job type
  backoffMultiplier: number // Exponential backoff factor (default: 2.0)
  backoffBaseMs: number // Base delay in milliseconds (default: 1000ms)
  lastError: string | null // Last failure reason or stack trace
  lastAttemptAt: Date | null // Timestamp of most recent attempt
  idempotencyKey: string | null // Worker-defined; prevents duplicate side effects
  completedAt: Date | null // Set when job succeeds
  result: unknown // JSON result payload (e.g. transaction hash)
  createdAt: Date
  updatedAt: Date
}

/**
 * Status of a JobAttempt during its lifecycle
 */
export type JobAttemptStatus =
  | 'PENDING' // Waiting to be leased by a worker
  | 'LEASED' // Worker holds leaseToken; currently processing
  | 'COMPLETED' // Job succeeded; idempotent completion marker set
  | 'FAILED' // Job failed; will retry after backoff
  | 'DEAD_LETTER' // Job permanently failed after max retries
  | 'ROLLED_BACK' // Associated domain transaction rolled back

/**
 * Rolled-back Record: Marker for rolled-back events and jobs
 *
 * When domain transaction rolls back, outbox events must be marked as ROLLED_BACK
 * to prevent workers from processing them. This marker is written in a separate
 * transaction to avoid circular dependencies.
 */
export interface RolledBackRecord {
  id: string
  recordType: 'OutboxEvent' | 'JobAttempt'
  recordId: string // ID of OutboxEvent or JobAttempt that was rolled back
  reason?: string
  createdAt: Date
}

/**
 * Configuration for job processing (retry, backoff, dead-lettering)
 */
export interface JobConfig {
  jobType: string
  jobName: string
  maxAttempts?: number // Default: 3
  backoffMultiplier?: number // Default: 2.0
  backoffBaseMs?: number // Default: 1000ms
}

/**
 * Event schema definition for versioning and validation
 */
export interface EventSchema {
  version: number
  eventType: string
  validate: (payload: unknown) => Promise<void> | void
}

/**
 * Result of a job processing attempt
 */
export interface JobResult {
  success: boolean
  idempotencyKey?: string // For idempotent jobs
  result?: unknown // JSON result payload
  error?: string // Error message if failed
  nextRetryAt?: Date // Suggested next retry time (overrides exponential backoff)
}

/**
 * Options for creating outbox events
 */
export interface CreateOutboxEventOptions {
  aggregateId: string
  aggregateType: string
  eventType: string
  eventVersion: number
  payload: unknown
  source?: string
  causedBy?: string
}

/**
 * Options for leasing a job
 */
export interface LeaseJobOptions {
  jobType: string
  maxLeaseMs?: number // How long to hold the lease (default: 30s)
}

/**
 * Result of leasing a job
 */
export interface LeaseJobResult {
  jobId: string
  leaseToken: string
  leasedUntil: Date
  attempt: number
  payload: unknown
}
