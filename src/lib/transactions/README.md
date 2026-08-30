# Transaction Outbox Pattern

A production-grade implementation of the **Transactional Outbox Pattern** for reliable event delivery across PostgreSQL, asynchronous job queues, and external systems (blockchain, notifications, webhooks).

## Core Problem

In distributed systems, coordinating changes across multiple systems is inherently risky:

```
Client Request
    ↓
1. Update domain (User created)  ← Success
2. Emit domain event             ← Server crashes
3. Process event (send email)    ← Event never sent!
```

If the server crashes between steps 1-3, the event is lost. The user is created, but no welcome email is sent.

## Solution: Transactional Outbox

The outbox pattern ensures atomicity:

```
PostgreSQL Transaction
  ├─ Update domain (User created)
  └─ Write OutboxEvent row      ← Single atomic unit
         ↓ (committed to DB)
         ↓
Worker Process (in separate transaction)
  ├─ Lease OutboxEvent
  ├─ Create JobAttempts for delivery
  ├─ Send email
  ├─ Call blockchain
  └─ Mark event as PUBLISHED
```

**Key invariant**: Domain changes and outbox events are committed together. If the transaction rolls back, no event is emitted.

## Architecture

### Three Core Tables

#### 1. `outbox_events`

Immutable log of all domain events written atomically with domain changes.

```sql
CREATE TABLE outbox_events (
  id TEXT PRIMARY KEY,
  aggregateId TEXT,        -- UUID of root aggregate (User, Wallet, etc.)
  aggregateType TEXT,      -- e.g. "User", "Wallet"
  eventType TEXT,          -- e.g. "UserCreated", "WalletProvisioned"
  eventVersion INT,        -- Schema version for validation
  payload TEXT,            -- JSON event data
  status TEXT,             -- PENDING | PROCESSING | PUBLISHED | DEAD_LETTER | ROLLED_BACK
  publishedAt TIMESTAMP,
  source TEXT,             -- Where event was emitted (api.auth.register, worker.wallet-provisioning)
  causedBy TEXT,           -- FK to parent event if chain-reaction
  createdAt TIMESTAMP,
  updatedAt TIMESTAMP
);

-- Indexes for worker polling
CREATE INDEX on outbox_events(status, publishedAt);   -- Find PENDING events
CREATE INDEX on outbox_events(aggregateId, aggregateType); -- Trace aggregate history
```

**Status Lifecycle:**

- `PENDING` → Event emitted, waiting for workers to publish
- `PROCESSING` → Worker is publishing (JobAttempts being created)
- `PUBLISHED` → All deliveries succeeded
- `DEAD_LETTER` → Permanent failure after max retries
- `ROLLED_BACK` → Domain transaction rolled back; skip processing

#### 2. `job_attempts`

Tracks asynchronous work (email, blockchain, webhooks) with lease-based concurrency control.

```sql
CREATE TABLE job_attempts (
  id TEXT PRIMARY KEY,
  outboxEventId TEXT,         -- FK to OutboxEvent
  jobType TEXT,               -- e.g. "email.send", "stellar.transfer"
  jobName TEXT,               -- Human-readable for monitoring
  status TEXT,                -- PENDING | LEASED | COMPLETED | FAILED | DEAD_LETTER
  leaseToken TEXT UNIQUE,     -- Token held by worker (prevents concurrent processing)
  leasedUntil TIMESTAMP,      -- Lease expiration
  attempt INT,                -- 0-indexed attempt number
  maxAttempts INT,            -- Configurable per job type (default: 3)
  backoffMultiplier FLOAT,    -- Exponential backoff factor (default: 2.0)
  backoffBaseMs INT,          -- Base delay (default: 1000ms)
  availableAt TIMESTAMP,      -- When job becomes available (after backoff)
  lastError TEXT,             -- Last failure reason
  idempotencyKey TEXT UNIQUE, -- Worker-defined for idempotent jobs
  completedAt TIMESTAMP,
  result TEXT,                -- JSON result payload
  createdAt TIMESTAMP
);

-- Indexes for worker polling
CREATE INDEX on job_attempts(status, availableAt);    -- Find PENDING jobs ready to lease
CREATE INDEX on job_attempts(status, leasedUntil);    -- Find abandoned leases
```

**Status Lifecycle:**

- `PENDING` → Job waiting to be leased
- `LEASED` → Worker holds leaseToken; currently processing
- `COMPLETED` → Job succeeded; idempotency key set
- `FAILED` → Job failed; will retry after backoff (if attempts < maxAttempts)
- `DEAD_LETTER` → Permanent failure (attempts >= maxAttempts)

#### 3. `rolled_back_records`

Markers for rolled-back events to prevent workers from processing them.

```sql
CREATE TABLE rolled_back_records (
  id TEXT PRIMARY KEY,
  recordType TEXT,   -- "OutboxEvent" or "JobAttempt"
  recordId TEXT,     -- ID of record that was rolled back
  reason TEXT,
  createdAt TIMESTAMP
);

CREATE INDEX on rolled_back_records(recordType, recordId);
CREATE INDEX on rolled_back_records(createdAt); -- For periodic cleanup
```

## Usage

### 1. Write Domain Changes + Events Atomically

```typescript
const outboxService = createOutboxService(prisma)

// In your controller or service:
const result = await prisma.$transaction(async (tx) => {
  // Make domain change
  const user = await tx.user.create({
    data: { email: 'user@example.com', role: 'LEARNER' },
  })

  // Write outbox event in same transaction
  const event = await outboxService.createEvent(tx, {
    aggregateId: user.id,
    aggregateType: 'User',
    eventType: 'UserCreated',
    eventVersion: 1,
    payload: { userId: user.id, email: user.email },
    source: 'api.auth.register',
  })

  // Define jobs that should process this event
  await outboxService.createJobAttempts(tx, event.id, [
    { jobType: 'email.send', jobName: 'Send welcome email' },
    { jobType: 'notification.push', jobName: 'Send push notification' },
  ])

  return { user, event }
})

// ✅ If transaction succeeds: user and event both persisted
// ✅ If transaction rolls back: neither user nor event are created
```

### 2. Worker Leases Jobs

```typescript
const jobLeaseService = createJobLeaseService(prisma)

async function emailWorker() {
  while (true) {
    // Lease a job (only one worker gets it)
    const lease = await jobLeaseService.leaseJob({
      jobType: 'email.send',
      maxLeaseMs: 30000, // Hold lease for 30 seconds
    })

    if (!lease) {
      // No jobs available; sleep and retry
      await sleep(5000)
      continue
    }

    try {
      // Process the job
      const emailPayload = lease.payload as any
      const txHash = await sendWelcomeEmail(emailPayload.email)

      // Mark as completed
      await jobLeaseService.completeJob(lease.jobId, lease.leaseToken, {
        success: true,
        idempotencyKey: `email_${lease.payload.userId}_${Date.now()}`,
        result: { messageId: txHash },
      })
    } catch (error) {
      // Mark as failed (will retry with exponential backoff)
      await jobLeaseService.failJob(lease.jobId, lease.leaseToken, error)
    }
  }
}
```

### 3. Automatic Lease Recovery

```typescript
// Run periodically (e.g., every 5 minutes) to reclaim abandoned leases
const jobLeaseService = createJobLeaseService(prisma)

async function leaseRecoverySchedule() {
  setInterval(
    async () => {
      const recovered = await jobLeaseService.recoverAbandonedLeases()
      logger.info(`Recovered ${recovered} abandoned leases`)
    },
    5 * 60 * 1000,
  )
}
```

### 4. Dead-Letter Handling

```typescript
// Get jobs that permanently failed
const deadLetterJobs = await jobLeaseService.getDeadLetterJobs(100)

for (const job of deadLetterJobs) {
  logger.warn(
    `Job ${job.id} failed after ${job.attempt} attempts:`,
    job.lastError,
  )

  // After operator fixes the issue:
  // await jobLeaseService.resetJobForRetry(job.id);
}
```

## Guarantees

### ✅ No Lost Events

Events are written in the same database transaction as domain changes. If the transaction commits, the event is guaranteed to be in `outbox_events` table and will be processed.

```
Domain Change + Event = Atomic Unit ✓
```

### ✅ No Duplicate Side Effects

Use idempotency keys to prevent duplicate processing:

```typescript
// First attempt fails after sending email but before marking complete
await sendEmail("user@example.com"); // ✓ Email sent
// ... crash ...

// Retry: worker checks idempotency key before re-sending
const existingEmail = await prisma.emailDelivery.findUnique({
  where: { idempotencyKey: "email_user_12345" },
});

if (existingEmail) {
  // Already sent; skip re-sending
  await jobLeaseService.completeJob(...);
} else {
  // Send email
  await sendEmail("user@example.com");
}
```

### ✅ Automatic Retry with Backoff

Exponential backoff prevents thundering herd:

```
Attempt 0: availableAt = now (first try)
Attempt 1: availableAt = now + 1000ms (1s backoff)
Attempt 2: availableAt = now + 2000ms (2s backoff)
Attempt 3: availableAt = now + 4000ms (4s backoff)
...
Attempt 4: availableAt = now + 8000ms (8s backoff)
  → After max attempts: DEAD_LETTER
```

Configuration per job type:

```typescript
await outboxService.createJobAttempts(tx, eventId, [
  {
    jobType: 'stellar.transfer',
    jobName: 'Transfer XLM',
    maxAttempts: 5,
    backoffBaseMs: 2000, // Start with 2 second delay
    backoffMultiplier: 2.0, // Double each time
  },
])
```

### ✅ Abandoned Lease Recovery

If worker crashes while holding lease:

```
Timeline:
  12:00:00 - Worker A leases job, leasedUntil=12:00:30
  12:00:15 - Worker A crashes
  12:05:00 - LeaseRecovery runs, finds leasedUntil < now
  12:05:00 - Job status reverted to PENDING, leaseToken cleared
  12:05:00 - Worker B leases same job
```

### ✅ Graceful Shutdown

Workers drain in-flight work before exiting:

```typescript
// On SIGTERM signal:
async function gracefulShutdown() {
  console.log('Graceful shutdown: completing in-flight jobs...')

  // Worker loop checks this flag
  SHUTDOWN_REQUESTED = true

  // Wait for current batch to complete (max 30 seconds)
  await Promise.race([activeJobs.complete(), setTimeout(() => {}, 30000)])

  await prisma.$disconnect()
  process.exit(0)
}
```

## Event Schema Versioning

Use `EventSchemaRegistry` to validate event payloads:

```typescript
import { getEventSchemaRegistry, createEventSchema } from '@/lib/transactions'
import { z } from 'zod'

// Register schemas
const registry = getEventSchemaRegistry()

registry.register(
  createEventSchema(
    'UserCreated',
    1,
    z.object({
      userId: z.string().uuid(),
      email: z.string().email(),
      role: z.enum(['ADMIN', 'LEARNER', 'INSTRUCTOR']),
    }),
  ),
)

// Validate events
await registry.validate('UserCreated', 1, payload)
```

## Testing

Three comprehensive test suites cover:

### 1. Rollback Tests

- Verify rolled-back domain changes emit no events
- Workers skip ROLLED_BACK events
- Concurrent rollback + lease attempts are handled correctly

### 2. Duplicate Delivery Tests

- Idempotency keys prevent duplicate side effects
- Completed jobs are recognized and skipped
- External calls are made only once

### 3. Crash and Retry Tests

- Abandoned leases are recovered after expiration
- Exponential backoff prevents thundering herd
- Max attempts are enforced before dead-lettering
- Dead-letter jobs can be manually recovered

Run tests:

```bash
pnpm test src/lib/transactions/
```

## Performance Considerations

### Indexes

All tables are heavily indexed for worker polling:

```sql
-- Find PENDING jobs ready to lease
CREATE INDEX job_attempts_status_availableAt_idx
  ON job_attempts(status, availableAt);

-- Find abandoned leases
CREATE INDEX job_attempts_status_leasedUntil_idx
  ON job_attempts(status, leasedUntil);

-- Find PENDING events for publishing
CREATE INDEX outbox_events_status_publishedAt_idx
  ON outbox_events(status, publishedAt);
```

### Worker Polling

Workers query with `LIMIT` to avoid full-table scans:

```typescript
// Good: polling with LIMIT
const lease = await jobLeaseService.leaseJob({
  jobType: 'email.send',
  maxLeaseMs: 30000,
})

// This only scans first few rows before finding a PENDING job
```

### Cleanup

Periodically archive completed events and jobs:

```typescript
// After 30 days, archive published events
await prisma.outboxEvent.deleteMany({
  where: {
    status: 'PUBLISHED',
    publishedAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
  },
})
```

## Troubleshooting

### Jobs Stuck in LEASED Status

**Symptom**: Jobs not processing, stuck with old `leasedUntil` times.

**Cause**: Worker crashed without releasing lease.

**Fix**:

```typescript
const recovered = await jobLeaseService.recoverAbandonedLeases()
console.log(`Recovered ${recovered} abandoned leases`)
```

### Dead-Letter Accumulation

**Symptom**: Many jobs in DEAD_LETTER status.

**Cause**: Transient issue (network, database, service down) exhausted retries.

**Fix**:

1. Identify root cause from `job.lastError`
2. Fix underlying issue
3. Reset jobs for retry:
   ```typescript
   const deadLetterJobs = await jobLeaseService.getDeadLetterJobs(100)
   for (const job of deadLetterJobs) {
     await jobLeaseService.resetJobForRetry(job.id)
   }
   ```

### Events Never Published

**Symptom**: Events stuck in PENDING status.

**Cause**: No workers running for specific jobType.

**Fix**:

1. Verify worker is running: `ps aux | grep worker`
2. Check worker logs for errors
3. Manually check job status:
   ```typescript
   const jobs = await jobLeaseService.getJobsForEvent(eventId)
   console.log(jobs)
   ```

## References

- [Transactional Outbox Pattern - Chris Richardson](https://microservices.io/patterns/data/transactional-outbox.html)
- [Event Sourcing - Martin Fowler](https://martinfowler.com/eaaDev/EventSourcing.html)
- [Lease-based Concurrency Control](<https://en.wikipedia.org/wiki/Lease_(computer_science)>)
