# Data Lifecycle and Archive Policy

How every persisted record in Learnault is classified, how long it is kept, what
happens to it when a subject asks to be erased, and which changes must leave an
audit trail.

The machine-readable source of truth is
[`src/audit/classification.ts`](../src/audit/classification.ts). This document
explains it. `tests/audit/classification.test.ts` fails if a model exists in
`prisma/schema.prisma` without a rule, so the two cannot drift apart.

---

## 1. Record classes

Every record is exactly one of four classes.

| Class | Meaning | Deletion |
| --- | --- | --- |
| **MUTABLE** | Updated in place. Where the history matters, it lives in audit events, not in the row. | Purged when retention expires |
| **ARCHIVABLE** | Withdrawn by stamping `archivedAt` rather than deleted, because something else still depends on it. Excluded from reads by default. | Purged some time after being archived |
| **DELETABLE** | Safe to hard-delete. Nothing else depends on it. | Deleted on expiry or erasure |
| **IMMUTABLE** | Append-only. Never updated. Deleted only by a retention purge, if at all. | Purge only |

The distinction that matters most in practice is **archivable vs deletable**. A
record is archivable when deleting it would strand another record: a `Completion`
needs the `Module` a learner actually took, and a `Referral` needs the
`ReferralCode` that created it. Deleting the parent would either cascade away
real history or leave a dangling reference. Archiving keeps the referent and
hides the row.

---

## 2. The lifecycle matrix

`Retention` is counted from the anchor column. "Indefinite" means nothing purges
it. `Audited` means mutations must go through
[`auditedMutation`](../src/audit/audited-mutation.ts).

### Identity

| Model | Class | Retention (anchor) | On erasure | Audited |
| --- | --- | --- | --- | --- |
| `User` | MUTABLE | Indefinite | **Anonymize** | Yes |
| `LearnerPreference` | MUTABLE | Indefinite | Cascade | Yes |
| `LearnerProfile` | ARCHIVABLE | 365d (`archivedAt`) | Cascade | Yes |
| `OnboardingProgress` | MUTABLE | Indefinite | Cascade | No |
| `NotificationPreference` | MUTABLE | Indefinite | Cascade | No |
| `DataExportRequest` | DELETABLE | **7d** (`completedAt`) | Delete | Yes |
| `AccountDeletionRequest` | MUTABLE | 7y (`createdAt`) | **Retain** | Yes |

`User` is anonymized rather than deleted. Money and credential rows outlive the
account (see below), and they need a valid referent — so the row survives as a
tombstone with every identifying column overwritten.

`AccountDeletionRequest` is retained *past the erasure it triggers*: it is the
evidence the request was honoured. That is only acceptable because it holds no
personal data beyond the user id.

`DataExportRequest` has the shortest retention of anything in the schema, because
its `artifact` column is a full-fidelity dump of one person's data — the
highest-value single row in the database.

### Money

| Model | Class | Retention (anchor) | On erasure | Audited |
| --- | --- | --- | --- | --- |
| `Transaction` | IMMUTABLE | 7y (`createdAt`) | Retain | Yes |
| `Wallet` | MUTABLE | Indefinite | Retain | Yes |
| `StellarFunding` | MUTABLE | 7y (`createdAt`) | Retain | Yes |
| `Referral` | IMMUTABLE | 7y (`createdAt`) | Retain | Yes |
| `ReferralCode` | ARCHIVABLE | 365d (`archivedAt`) | Cascade | Yes |

A ledger a subject can erase is not a ledger. Money rows survive erasure, which
is only defensible because they carry no personal data in-row — they reference a
user id whose row has been anonymized. `StellarFunding` is keyed by Stellar
public key rather than by user, so erasure severs the link by nulling
`User.walletAddress` without touching the funding row.

Corrections to `Transaction` are booked as new reversing entries. Nothing edits a
ledger row.

### Credentials

| Model | Class | Retention | On erasure | Audited |
| --- | --- | --- | --- | --- |
| `Credential` | IMMUTABLE | Indefinite | Retain | Yes |
| `Completion` | IMMUTABLE | Indefinite | **Delete** | Yes |

`Credential` is verifiable by third parties against the chain, so issuance is
permanent; revocation appends a revocation record rather than editing the row.

`Completion` is the one place these two diverge. It is immutable while the
account lives, but **deleted** on erasure, because a completion reveals what a
named learner studied — and that is personal data in a way an issued credential
identifier is not.

### Security

| Model | Class | Retention (anchor) | On erasure | Audited |
| --- | --- | --- | --- | --- |
| `AuditEvent` | IMMUTABLE | 7y (`occurredAt`) | Retain | n/a |
| `AuditLog` *(legacy)* | IMMUTABLE | 2y (`createdAt`) | Anonymize | n/a |
| `Session` | MUTABLE | 90d (`updatedAt`) | Delete | Yes |
| `RefreshToken` | MUTABLE | 90d (`updatedAt`) | Cascade | Yes |
| `VerificationToken` | MUTABLE | 30d (`createdAt`) | Delete | Yes |
| `OtpChallenge` | MUTABLE | 30d (`createdAt`) | Delete | Yes |
| `ManagedKeyReference` | IMMUTABLE | Indefinite | Retain | Yes |

Indefinite retention of security data is the failure mode this category exists to
prevent, so everything here is bounded — with one exception.
`ManagedKeyReference` is retained forever because it is an opaque KMS handle
(never key material), and destroying the handle orphans any funds held under that
key.

Session revocation is a status change, not an archive: a revoked session must
stay visible to the learner in device management until it is purged. Consumed
`RefreshToken` rows are kept for the same window so that replaying an
already-rotated token is still detectable as theft.

### Consent

| Model | Class | Retention (anchor) | On erasure | Audited |
| --- | --- | --- | --- | --- |
| `ConsentRecord` | IMMUTABLE | 7y (`createdAt`) | Retain | Yes |
| `PreferenceAuditLog` | IMMUTABLE | 7y (`createdAt`) | Retain | n/a |

Proof of consent must outlive the account it describes — otherwise a withdrawal
cannot be demonstrated after the fact. Withdrawal appends a new row; it never
edits the granting one.

### Content

| Model | Class | Retention (anchor) | On erasure | Audited |
| --- | --- | --- | --- | --- |
| `Module` | ARCHIVABLE | Indefinite (`archivedAt`) | Retain | Yes |
| `Avatar` | ARCHIVABLE | 365d (`archivedAt`) | Cascade | Yes |
| `AvatarVariant` | IMMUTABLE | 365d (`createdAt`) | Cascade | No |

`Module` is archived and never purged: completions and credentials reference the
module a learner actually took, so withdrawing content archives it permanently
rather than removing it.

### Operational

| Model | Class | Retention (anchor) | On erasure | Audited |
| --- | --- | --- | --- | --- |
| `WebhookEndpoint` | ARCHIVABLE | 365d (`archivedAt`) | Retain | Yes |
| `WebhookDelivery` | MUTABLE | 30d (`createdAt`) | Retain | No |
| `EmailDelivery` | MUTABLE | 30d (`createdAt`) | Delete | No |
| `NotificationLog` | MUTABLE | 30d (`createdAt`) | Delete | No |
| `DeviceToken` | DELETABLE | 90d (`updatedAt`) | Delete | No |
| `SyncEvent` | IMMUTABLE | 90d (`createdAt`) | Delete | No |
| `OutboxEvent` | MUTABLE | 30d (`createdAt`) | Retain | No |
| `JobAttempt` | MUTABLE | 30d (`createdAt`) | Cascade | No |
| `RolledBackRecord` | IMMUTABLE | 30d (`createdAt`) | Retain | No |
| `QueueLease` | MUTABLE | Indefinite | Retain | No |
| `WalletProvisioningJob` | MUTABLE | 90d (`updatedAt`) | Cascade | No |

`EmailDelivery` and `NotificationLog` hold rendered message bodies, which is
personal data — hence the short window and hard deletion on erasure.
`DeviceToken` is deleted rather than archived: an archived push token would still
be a live address. `QueueLease` holds one long-lived row per recurring queue
drain — a queue name, the current lease token, and the holder id — so there is
no user data to erase and nothing to age out.

---

## 3. Immutable audit events

`audit_events` is the audit spine. One row records **who** did **what** to
**which record**, **why**, and under **which request**.

| Column | Purpose |
| --- | --- |
| `actorType`, `actorId`, `actorRole` | Who acted. `USER`, `ADMIN`, `SYSTEM`, `WORKER`, `ANONYMOUS`. Role as held *at the time*. |
| `action` | Dotted name, e.g. `account.deactivated` |
| `targetType`, `targetId` | Which record changed |
| `recordClass` | Lifecycle class of the target, from the matrix |
| `reason` | Justification. Required for `ADMIN` actors |
| `requestId`, `correlationId`, `source` | Correlation to request logs, outbox events, and the code path |
| `metadata` | Redacted JSON context |
| `actorIpHash` | Keyed HMAC of the request IP — never the address |
| `userAgentFamily` | Coarse family (`Chrome`, `Android`) — never the raw UA |
| `occurredAt` | When |

Separating **actor** from **target** is the point: "an admin deactivated a
learner" is a materially different event from "a learner deactivated themselves",
and a single `userId` column cannot express the difference.

### Immutability is enforced by the database

Triggers in
[the migration](../prisma/migrations/20260824090000_auditable_data_lifecycle/migration.sql),
not by convention:

- **`UPDATE` is rejected unconditionally.** There is no escape hatch.
- **`DELETE` is rejected** unless the transaction has set
  `learnault.audit_purge`, which only `AuditEventService.purgeExpired()` does —
  and it deletes by timestamp, so the hatch cannot target one inconvenient event.
- **`TRUNCATE` is rejected** by a separate statement-level trigger, because
  `TRUNCATE` bypasses row-level triggers entirely.

`SET LOCAL` (not `SET`) scopes the purge permission to a single transaction, so
it cannot leak to a later request that picks up the same pooled connection.

### No foreign key to `User` — deliberately

A relation would need either `onDelete: Cascade`, letting erasure destroy the
trail, or `onDelete: SetNull`, mutating a row that must never change. `actorId`
and `targetId` are soft references instead.

### Erasure-safe by construction

Nothing in `audit_events` needs scrubbing when a subject is erased, because
nothing identifying is written in the first place. This is the resolution of the
central tension in the policy: **immutability and the right to erasure are only
compatible if the immutable store holds no personal data.**

The legacy `audit_logs` table predates this and does hold a raw IP and
User-Agent, so it is scrubbed on erasure and retained for two years rather than
seven. New code writes `audit_events`.

---

## 4. Redaction

Because audit rows cannot be scrubbed later, metadata is filtered on the way
*in*, by [`src/audit/redaction.ts`](../src/audit/redaction.ts). Two independent
passes run over every value:

1. **Key matching** — a field named `password`, `refreshToken`, `email`, … is
   replaced regardless of content.
2. **Value matching** — a value shaped like a Stellar seed, a Stellar public key,
   a JWT, a bearer credential, an email address, an E.164 number, an IPv4
   address, a 40+ character hex blob, or a PEM header is replaced *even under an
   innocuous key*, because callers nest secrets in unexpected places.

Structural caps then bound the whole object: depth 4, 20 array entries, 32 keys,
256 characters per string, 4 KB serialized.

Over-redaction is treated as its own failure. `statusCode`, `failureCode`,
`referralCode`, `amountStroops` and `requestId` are all allowed, because an audit
trail nobody can read is not reviewable. Notably `to` is *allowed*: it is the
obvious name for an email recipient, but also the standard name for the
destination of a status transition — and the value-level email pattern catches an
actual recipient anyway.

When anything is replaced, the row records a `_redacted` array of the paths.
A reader can see that redaction happened rather than guessing.

### IP hashing

`actorIpHash` is an **HMAC**, not a bare digest: the IPv4 space is small enough to
enumerate, so an unkeyed hash is reversible in seconds. The key is
`AUDIT_IP_HASH_SECRET`. Rotating it makes older hashes uncorrelatable with newer
ones, which is the intended trade-off. **If it is unset in production, the IP hash
is omitted entirely** rather than falling back to a value published in this
repository.

---

## 5. The audited mutation helper

```ts
import { auditedMutation, actorFromRequest } from '../audit'

const context = actorFromRequest(req)

const wallet = await auditedMutation({
  action: 'wallet.status_changed',
  actor: context.actor,
  target: { type: 'Wallet', id: walletId },
  reason: 'provisioning completed',
  requestId: context.requestId,
  ipAddress: context.ipAddress,
  userAgent: context.userAgent,
  source: 'worker.wallet-provisioning',
  metadata: { from: 'RESERVED', to: 'ACTIVE' },
  mutate: (tx) =>
    tx.wallet.update({ where: { id: walletId }, data: { status: 'ACTIVE' } }),
})
```

The mutation and its audit event **commit in one transaction**. An audit written
after a successful mutation leaves holes when the process dies in between; an
audit written before records changes that never happened.

Every write must go through the `tx` client the helper provides. A write through
the global client commits outside the transaction and escapes the guarantee.

Two consequences worth knowing:

- **A failed audit write rolls the mutation back.** A sensitive change that
  cannot be attributed is a change that should not land. This is the opposite of
  `auditEventService.record()`, which swallows failures and is for standalone
  events (a failed login, a rate-limit trip) where there is no state change to
  protect.
- **Policy is checked before anything runs.** An `ADMIN` actor without a reason,
  or a `USER`/`ADMIN` actor without an id, throws `AuditPolicyError` before the
  transaction opens.

`auditedArchive` and `auditedRestore` wrap the archive patch and its audit event
the same way, and refuse models the matrix does not classify as `ARCHIVABLE`.

---

## 6. Archived records are excluded by default

The cost of soft deletion is that every read must remember to filter, and one
forgotten filter leaks withdrawn content. So the filter is not left to callers:
`archiveExclusionExtension` in
[`src/audit/archive.ts`](../src/audit/archive.ts) is applied to the Prisma client
in [`src/config/database.ts`](../src/config/database.ts) and injects
`archivedAt: null` into reads on archivable models.

**Covered:** `findFirst`, `findFirstOrThrow`, `findMany`, `count`, `aggregate`,
`groupBy`.

**Not covered, deliberately:**

- **`findUnique` / `findUniqueOrThrow`** — a point lookup by primary key. A
  silent filter would turn a found row into `null`, which reads as "deleted" to
  code holding the id. Use `assertActive(record)` or `isArchived(record)` to
  decide explicitly.
- **Writes** — an archive or restore must be able to see the row it is changing.

To opt out for one query, use `includeArchived(where)`. It sets `archivedAt` to
`undefined`: Prisma ignores an undefined filter, while the extension sees the key
and stands down. The opt-out is therefore visible at the call site, which is the
point — an unfiltered read of archivable data should show up in review.

An archived row must always state a reason. This is enforced by a database
`CHECK` constraint per archivable table, not only by the helper, because
"archive" is a write that lands from several call sites and a row archived
without a reason is indistinguishable from an accident months later.

---

## 7. Erasure

`AccountLifecycleService.finalizeDeletion` applies the `On erasure` column of the
matrix after the cooling-off window (`DELETION_COOLING_OFF_DAYS`, default 30):

- **Delete** — sessions, tokens, OTP challenges, device tokens, sync events,
  notification and email deliveries, completions, export requests.
- **Anonymize** — the `User` row becomes a tombstone; legacy `audit_logs` rows
  have their IP, User-Agent and metadata scrubbed.
- **Retain** — money, credentials, consent proof, `audit_events`.
- **Cascade** — dependents removed by database cascade with their parent.

---

## 8. Adding a model

1. Add it to `prisma/schema.prisma`.
2. Add a rule to `src/audit/classification.ts` — class, category, retention,
   anchor, erasure behaviour, whether it is audited, and *why*.
3. If it is `ARCHIVABLE`, add `archivedAt`, `archivedById` and `archivedReason`,
   plus the `CHECK` constraint in the migration.
4. Add it to the matrix in this document.

Step 2 is not optional: `tests/audit/classification.test.ts` fails on an
unclassified model. An unclassified record has no retention, no erasure
behaviour and no audit requirement, which is exactly the state this policy exists
to prevent.

---

## 9. Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `AUDIT_IP_HASH_SECRET` | *(unset)* | HMAC key for `actorIpHash`. Unset in production omits the hash. |
| `DELETION_COOLING_OFF_DAYS` | `30` | Window before an erasure request is finalized |
| `EXPORT_TTL_DAYS` | `7` | Lifetime of an export artifact |
| `LIFECYCLE_SWEEP_INTERVAL_MS` | `0` (disabled) | Background sweep interval |

---

## 10. Tests

| File | Covers |
| --- | --- |
| `tests/audit/classification.test.ts` | Every schema model classified; retention, erasure and audit invariants per category |
| `tests/audit/redaction.test.ts` | Key and value deny-lists, structural caps, IP hashing, UA coarsening, over-redaction |
| `tests/audit/audit-event.service.test.ts` | Attribution, redaction on write, no mutating API, purge uses the session variable |
| `tests/audit/audited-mutation.test.ts` | Transaction atomicity, rollback on audit failure, policy enforcement, archive/restore |
| `tests/audit/archive.test.ts` | Default exclusion, the `findUnique` and write carve-outs, opt-out, patches |
| `tests/integration/audit-immutability.test.ts` | Database-level `UPDATE`/`DELETE`/`TRUNCATE` rejection and the archive `CHECK` constraints |

The integration test is skipped when no test database is reachable. Because
`tests/globalSetup.ts` prepares schemas with `prisma db push` — which never
executes migration SQL — that test applies the immutability DDL from the shipped
migration file itself, so it verifies the artifact that actually ships.
