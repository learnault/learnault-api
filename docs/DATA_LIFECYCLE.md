# Data Lifecycle Management Policy

## Overview

This document defines the soft-delete, archive, retention, erasure, and immutable audit behavior for sensitive data in the Learnault API. It ensures compliance with data protection regulations (GDPR, CCPA) while maintaining system integrity and audit trails.

---

## Data Classification

### 1. Mutable Data
Data that can be updated during normal operations.

**Examples:**
- User profiles (username, email, preferences)
- Learning preferences (difficulty, categories)
- Notification preferences
- Device tokens
- Module content (title, description)
- User status

**Retention:**
- Active until user account deletion or explicit data removal request
- Soft-deleted on account deletion (retained for 90 days)
- Hard-deleted after retention period

**Archive Behavior:**
- Archived when user account is deleted
- Excluded from active queries by default
- Can be restored during cooling-off period

---

### 2. Archivable Data
Data that should be hidden from active use but retained for compliance.

**Examples:**
- Deleted user accounts
- Inactive sessions (expired/revoked)
- Completed notification logs
- Failed webhook deliveries (after max retries)
- Expired OTP challenges
- Cancelled account deletion requests

**Retention:**
- Archived data retained for regulatory compliance period (typically 7 years)
- Automatically purged after retention period
- Not included in standard queries
- Accessible only through archive-specific queries or admin tools

**Archive Behavior:**
- Marked with `archivedAt` timestamp
- Soft-deleted flag set (`deletedAt`)
- Status field updated (e.g., "ARCHIVED")
- Excluded by default via Prisma middleware

---

### 3. Deletable Data
Data that can be permanently removed without regulatory implications.

**Examples:**
- Device tokens (revoked/expired)
- Temporary verification tokens (used/expired)
- Failed sync events
- Dead-letter notifications (after max retries)
- Session tokens (expired)

**Retention:**
- Deleted after expiration or revocation
- No archive period required
- Hard-deleted immediately or after short grace period (7-30 days)

**Archive Behavior:**
- May have brief soft-delete period (7 days) for operational recovery
- Permanently deleted via scheduled cleanup jobs

---

### 4. Immutable Data
Data that cannot be modified or deleted once created (audit trail).

**Examples:**
- Audit logs (all types)
- Financial transactions
- Credential issuance records
- Referral bonuses paid
- Module completions
- Data export requests (history)
- Account deletion requests (history)

**Retention:**
- Retained indefinitely for audit trail
- Never soft-deleted or archived
- Never modified after creation (append-only)
- Protected at database and application levels

**Archive Behavior:**
- Never archived
- Always included in audit queries
- May be moved to long-term storage (cold storage) after 1+ years

---

## Retention Policies

### Users
| Lifecycle Stage | Status | Retention Period | Action After Period |
|----------------|--------|------------------|---------------------|
| Active | ACTIVE | Indefinite | None |
| Deactivated | DEACTIVATED | 90 days | Account deletion warning |
| Pending Deletion | PENDING_DELETION | 30 days (cooling-off) | Execute deletion |
| Deleted | DELETED | 90 days (soft) | Hard delete & anonymize |
| Archived | ARCHIVED | 7 years | Permanent deletion |

**Cascade Behavior:**
- User deletion cascades to related data (preferences, sessions, tokens)
- Financial and audit data is retained (immutable)
- PII is redacted from retained records

---

### Financial Data (Money)
| Data Type | Retention Period | Archivable | Deletable |
|-----------|------------------|------------|-----------|
| Transactions | Indefinite | ❌ No | ❌ No |
| Referral bonuses | Indefinite | ❌ No | ❌ No |
| Reward distributions | Indefinite | ❌ No | ❌ No |
| Withdrawal records | Indefinite | ❌ No | ❌ No |

**Rationale:** Financial records are immutable for regulatory compliance and audit purposes.

---

### Credentials
| Data Type | Retention Period | Archivable | Deletable |
|-----------|------------------|------------|-----------|
| Issued credentials | Indefinite | ❌ No | ❌ No |
| Credential metadata | Indefinite | ❌ No | ❌ No |
| On-chain references | Indefinite | ❌ No | ❌ No |

**Rationale:** Credentials are verifiable claims and must remain immutable.

---

### Security Events
| Data Type | Retention Period | Archivable | Deletable |
|-----------|------------------|------------|-----------|
| Audit logs | Indefinite | ❌ No | ❌ No |
| Login attempts | 1 year | ✅ Yes | ❌ No |
| Session tokens | 30 days after expiry | ✅ Yes | ✅ Yes |
| OTP challenges | 7 days after expiry | ✅ Yes | ✅ Yes |
| Verification tokens | 7 days after use | ✅ Yes | ✅ Yes |

**Rationale:** Security audit trail must be preserved; temporary tokens can be purged.

---

### Content Data
| Data Type | Retention Period | Archivable | Deletable |
|-----------|------------------|------------|-----------|
| Learning modules | Indefinite | ✅ Yes | ✅ Yes |
| Module completions | Indefinite | ❌ No | ❌ No |
| User preferences | 90 days after deletion | ✅ Yes | ✅ Yes |
| Notification logs | 90 days | ✅ Yes | ✅ Yes |
| Device tokens | 30 days after revoke | ✅ Yes | ✅ Yes |

**Rationale:** Content is mutable; completions are immutable proof of learning.

---

## Immutable Audit Events

All sensitive mutations are tracked with immutable audit events.

### Audit Event Schema

```typescript
interface AuditEvent {
  id: string              // UUID (generated)
  timestamp: DateTime     // Event time (auto-generated)
  actor: {
    type: string         // "user" | "system" | "admin"
    id: string           // User ID or "system"
    role?: string        // User role (if applicable)
  }
  action: string         // Action performed (see below)
  target: {
    type: string         // Resource type ("User", "Transaction", etc.)
    id: string           // Resource ID
  }
  reason?: string        // Optional reason (e.g., "GDPR request")
  requestId: string      // Request correlation ID
  ipAddress?: string     // IP address (if from HTTP request)
  userAgent?: string     // User agent (if from HTTP request)
  metadata: object       // Safe metadata (NO SECRETS, minimal PII)
  result: string         // "success" | "failure"
  error?: string         // Error message (if failed)
}
```

---

### Audited Actions

#### Account Lifecycle
- `USER_REGISTERED`
- `USER_EMAIL_VERIFIED`
- `USER_PHONE_VERIFIED`
- `USER_LOGIN`
- `USER_LOGOUT`
- `USER_PASSWORD_CHANGED`
- `USER_PASSWORD_RESET_REQUESTED`
- `USER_PASSWORD_RESET_COMPLETED`
- `USER_PROFILE_UPDATED`
- `USER_DEACTIVATED`
- `USER_REACTIVATED`
- `USER_DELETION_REQUESTED`
- `USER_DELETION_CANCELLED`
- `USER_DELETED`
- `USER_ANONYMIZED`

#### Financial Events
- `REWARD_ISSUED`
- `REWARD_CLAIMED`
- `WITHDRAWAL_REQUESTED`
- `WITHDRAWAL_COMPLETED`
- `WITHDRAWAL_FAILED`
- `REFERRAL_BONUS_PAID`

#### Credential Events
- `CREDENTIAL_ISSUED`
- `CREDENTIAL_REVOKED` (if supported)

#### Data Privacy Events
- `DATA_EXPORT_REQUESTED`
- `DATA_EXPORT_DOWNLOADED`
- `DATA_RETENTION_APPLIED`
- `DATA_ARCHIVED`
- `DATA_PURGED`

#### Security Events
- `LOGIN_FAILED`
- `OTP_SENT`
- `OTP_VERIFIED`
- `OTP_FAILED`
- `SESSION_REVOKED`
- `SUSPICIOUS_ACTIVITY_DETECTED`

---

### Metadata Guidelines

**✅ Safe to Include:**
- Resource IDs (non-sensitive)
- Status changes (old status → new status)
- Counts and aggregates
- Timestamps
- Public identifiers
- Request methods and paths (sanitized)

**❌ Must Exclude:**
- Passwords (plain or hashed)
- API keys, tokens, secrets
- Email addresses (use user ID instead)
- Phone numbers (use user ID instead)
- Wallet private keys
- Session tokens
- OTP codes
- Credit card numbers
- Any PII not essential for audit

**Example Metadata:**
```json
{
  "oldStatus": "ACTIVE",
  "newStatus": "DEACTIVATED",
  "reason": "User request",
  "affectedSessions": 3
}
```

---

## Soft-Delete Implementation

### Database Schema Additions

All archivable tables include:
- `deletedAt?: DateTime` - Soft-delete timestamp (null = active)
- `archivedAt?: DateTime` - Archive timestamp (null = not archived)
- `archivedReason?: String` - Reason for archival

### Prisma Middleware

Automatically exclude archived/deleted records from queries:

```typescript
prisma.$use(async (params, next) => {
  // Exclude soft-deleted by default
  if (params.action === 'findUnique' || params.action === 'findMany') {
    params.args.where = {
      ...params.args.where,
      deletedAt: null,
    }
  }
  
  // Prevent updates to immutable tables
  if (IMMUTABLE_MODELS.includes(params.model) && params.action === 'update') {
    throw new ForbiddenError('Cannot modify immutable audit data')
  }
  
  return next(params)
})
```

---

## Audited Mutation Helper

Reusable helper for auditing all sensitive mutations:

```typescript
interface AuditedMutationOptions<T> {
  actor: AuditActor
  action: AuditAction
  target: AuditTarget
  reason?: string
  requestId: string
  ipAddress?: string
  userAgent?: string
  metadata?: Record<string, unknown>
  mutation: () => Promise<T>
}

async function auditedMutation<T>(
  options: AuditedMutationOptions<T>
): Promise<T> {
  const startTime = Date.now()
  
  try {
    const result = await options.mutation()
    
    await createAuditLog({
      ...options,
      result: 'success',
      duration: Date.now() - startTime,
    })
    
    return result
  } catch (error) {
    await createAuditLog({
      ...options,
      result: 'failure',
      error: error.message,
      duration: Date.now() - startTime,
    })
    
    throw error
  }
}
```

**Usage Example:**
```typescript
await auditedMutation({
  actor: { type: 'user', id: userId, role: user.role },
  action: 'USER_PASSWORD_CHANGED',
  target: { type: 'User', id: userId },
  requestId: req.requestId,
  ipAddress: req.ip,
  userAgent: req.headers['user-agent'],
  metadata: { method: 'password_reset_flow' },
  mutation: async () => {
    return prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    })
  },
})
```

---

## Lifecycle Management Jobs

### 1. Archive Expired Data Job
**Frequency:** Daily (2 AM UTC)

**Actions:**
- Archive deleted user accounts after cooling-off period
- Archive expired OTP challenges
- Archive used verification tokens
- Archive dead-letter notifications
- Archive revoked sessions

---

### 2. Purge Old Archives Job
**Frequency:** Weekly (Sundays at 3 AM UTC)

**Actions:**
- Permanently delete archived data older than retention period
- Permanently delete deletable data after grace period
- Log all purge operations in audit log

---

### 3. Expire Stale Data Job
**Frequency:** Hourly

**Actions:**
- Mark expired sessions as revoked
- Mark expired OTP challenges as expired
- Mark expired verification tokens as expired

---

## Testing Requirements

### 1. Immutability Tests
- ✅ Verify audit logs cannot be updated
- ✅ Verify financial records cannot be modified
- ✅ Verify credential records cannot be changed
- ✅ Verify completion records cannot be edited

### 2. Visibility Tests
- ✅ Verify archived records excluded by default
- ✅ Verify soft-deleted records excluded by default
- ✅ Verify archive queries return archived records
- ✅ Verify admin queries can access archived data

### 3. Attribution Tests
- ✅ Verify all mutations create audit log
- ✅ Verify audit log contains actor information
- ✅ Verify audit log contains request correlation ID
- ✅ Verify audit log contains safe metadata only

### 4. Redaction Tests
- ✅ Verify no passwords in audit logs
- ✅ Verify no tokens in audit logs
- ✅ Verify no OTP codes in audit logs
- ✅ Verify PII minimization in metadata

### 5. Retention Tests
- ✅ Verify soft-delete retention periods enforced
- ✅ Verify archive retention periods enforced
- ✅ Verify purge jobs execute correctly
- ✅ Verify cascade behavior on user deletion

---

## Lifecycle State Matrix

| Model | Mutable | Archivable | Deletable | Immutable | Retention Period | Cascade on User Delete |
|-------|---------|------------|-----------|-----------|------------------|------------------------|
| User | ✅ | ✅ | ✅ | ❌ | 90 days (soft) | N/A |
| Session | ✅ | ✅ | ✅ | ❌ | 30 days | ✅ Cascade |
| AuditLog | ❌ | ❌ | ❌ | ✅ | Indefinite | ❌ Retain |
| Transaction | ❌ | ❌ | ❌ | ✅ | Indefinite | ❌ Retain |
| Credential | ❌ | ❌ | ❌ | ✅ | Indefinite | ❌ Retain |
| Completion | ❌ | ❌ | ❌ | ✅ | Indefinite | ❌ Retain |
| Referral | ❌ | ✅ | ❌ | ✅ | Indefinite | ❌ Retain |
| Module | ✅ | ✅ | ✅ | ❌ | Indefinite | N/A |
| LearnerPreference | ✅ | ✅ | ✅ | ❌ | 90 days | ✅ Cascade |
| NotificationLog | ✅ | ✅ | ✅ | ❌ | 90 days | ✅ Cascade |
| DeviceToken | ✅ | ✅ | ✅ | ❌ | 30 days | ✅ Cascade |
| VerificationToken | ✅ | ✅ | ✅ | ❌ | 7 days | ✅ Cascade |
| OtpChallenge | ✅ | ✅ | ✅ | ❌ | 7 days | ✅ Cascade |
| DataExportRequest | ✅ | ✅ | ❌ | ❌ | 90 days | ✅ Cascade |
| AccountDeletionRequest | ✅ | ✅ | ❌ | ❌ | 90 days | ✅ Cascade |
| WebhookDelivery | ✅ | ✅ | ✅ | ❌ | 90 days | N/A |
| EmailDelivery | ✅ | ✅ | ✅ | ❌ | 90 days | ✅ Cascade |
| PreferenceAuditLog | ❌ | ❌ | ❌ | ✅ | Indefinite | ❌ Retain |

---

## Privacy & GDPR Compliance

### Right to Erasure
- User can request account deletion via API
- 30-day cooling-off period before execution
- PII is redacted from retained audit logs
- Immutable records (financial, credentials) retain pseudonymized reference

### Right to Data Portability
- User can request data export via API
- Export includes all personal data in machine-readable format (JSON)
- Export available for 7 days, then purged

### Right to Access
- User can view their own data via API
- Audit logs available to user (their own actions only)
- Admin can access full audit trail

---

## Migration Plan

1. ✅ Document data lifecycle policy (this file)
2. ⬜ Add soft-delete columns to archivable tables (migration)
3. ⬜ Implement Prisma middleware for soft-delete
4. ⬜ Create audit service with helper functions
5. ⬜ Add audit logging to sensitive mutations
6. ⬜ Implement lifecycle management jobs
7. ⬜ Add tests for immutability, visibility, attribution, redaction
8. ⬜ Update API documentation with lifecycle behavior
9. ⬜ Deploy and monitor

---

## References

- [GDPR Right to Erasure](https://gdpr-info.eu/art-17-gdpr/)
- [GDPR Right to Data Portability](https://gdpr-info.eu/art-20-gdpr/)
- [CCPA Data Deletion Requirements](https://oag.ca.gov/privacy/ccpa)
- [Prisma Soft Delete Guide](https://www.prisma.io/docs/concepts/components/prisma-client/middleware/soft-delete-middleware)

---

**Document Version:** 1.0  
**Last Updated:** 2026-07-22  
**Status:** ✅ Complete
