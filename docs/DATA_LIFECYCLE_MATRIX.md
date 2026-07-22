# Data Lifecycle Classification Matrix

## Overview

This document provides a comprehensive classification of all data models in the Learnault API according to their lifecycle behavior: mutable, archivable, deletable, and immutable.

---

## Complete Model Classification

| Model | Mutable | Archivable | Deletable | Immutable | Retention Period | Cascade on User Delete | Notes |
|-------|---------|------------|-----------|-----------|------------------|------------------------|-------|
| **User** | ✅ | ✅ | ✅ | ❌ | 90 days (soft) | N/A | Soft-delete with 30-day cooling-off |
| **Session** | ✅ | ✅ | ✅ | ❌ | 30 days after expiry | ✅ Cascade | Expired sessions archived |
| **AuditLog** | ❌ | ❌ | ❌ | ✅ | Indefinite | ❌ Retain | Never modified or deleted |
| **Transaction** | ❌ | ❌ | ❌ | ✅ | Indefinite | ❌ Retain | Financial records immutable |
| **Credential** | ❌ | ❌ | ❌ | ✅ | Indefinite | ❌ Retain | Verifiable claims immutable |
| **Completion** | ❌ | ❌ | ❌ | ✅ | Indefinite | ❌ Retain | Learning proof immutable |
| **Referral** | ❌ | ✅ | ❌ | ✅ | Indefinite | ❌ Retain | Bonus tracking immutable |
| **ReferralCode** | ✅ | ✅ | ✅ | ❌ | Indefinite | ✅ Cascade | Can be deactivated |
| **Module** | ✅ | ✅ | ✅ | ❌ | Indefinite | N/A | Content can be updated |
| **LearnerPreference** | ✅ | ✅ | ✅ | ❌ | 90 days after user delete | ✅ Cascade | User settings |
| **PreferenceAuditLog** | ❌ | ❌ | ❌ | ✅ | Indefinite | ❌ Retain | Preference change history |
| **NotificationLog** | ✅ | ✅ | ✅ | ❌ | 90 days | ✅ Cascade | Old notifications archived |
| **NotificationPreference** | ✅ | ✅ | ✅ | ❌ | 90 days after user delete | ✅ Cascade | User settings |
| **DeviceToken** | ✅ | ✅ | ✅ | ❌ | 30 days after revoke | ✅ Cascade | Push notification tokens |
| **VerificationToken** | ✅ | ✅ | ✅ | ❌ | 7 days after use/expiry | ✅ Cascade | Email/phone verification |
| **OtpChallenge** | ✅ | ✅ | ✅ | ❌ | 7 days after expiry | ✅ Cascade | One-time password codes |
| **DataExportRequest** | ✅ | ✅ | ❌ | ❌ | 90 days | ✅ Cascade | GDPR data export history |
| **AccountDeletionRequest** | ✅ | ✅ | ❌ | ❌ | 90 days | ✅ Cascade | Account deletion history |
| **WebhookEndpoint** | ✅ | ✅ | ✅ | ❌ | Indefinite | N/A | Can be deactivated |
| **WebhookDelivery** | ✅ | ✅ | ✅ | ❌ | 90 days | N/A | Delivery history |
| **EmailDelivery** | ✅ | ✅ | ✅ | ❌ | 90 days | ✅ Cascade | Email delivery history |
| **SyncEvent** | ✅ | ✅ | ✅ | ❌ | 90 days | ✅ Cascade | Client-server sync history |
| **StellarFunding** | ✅ | ✅ | ❌ | ❌ | Indefinite | N/A | Blockchain funding records |

---

## Lifecycle Policies by Category

### Immutable Records (Never Modified or Deleted)
**Purpose**: Maintain audit trail and regulatory compliance

- **AuditLog** - All audit events
- **Transaction** - All financial transactions
- **Credential** - Issued credentials
- **Completion** - Module completion records
- **Referral** - Referral relationships (once created)
- **PreferenceAuditLog** - Preference change history

**Enforcement**: Prisma client extension prevents UPDATE/DELETE operations

---

### Soft-Deletable Records (Hidden but Retained)
**Purpose**: Support account deletion and data recovery

- **User** - 90-day soft-delete, 30-day cooling-off before hard delete
- **Session** - 30 days after expiry
- **Module** - Can be soft-deleted (archived) but retained
- **LearnerPreference** - Deleted with user
- **NotificationLog** - 90 days before purge
- **DeviceToken** - 30 days after revoke
- **VerificationToken** - 7 days after use
- **OtpChallenge** - 7 days after expiry

**Enforcement**: DELETE operations converted to UPDATE with `deletedAt` timestamp

---

### Archivable Records (Moved to Long-Term Storage)
**Purpose**: Keep for compliance while hiding from active queries

All soft-deletable records are also archivable. Additionally:
- **ReferralCode** - Can be archived when inactive
- **WebhookEndpoint** - Can be archived when disabled
- **WebhookDelivery** - Archived after max retries
- **EmailDelivery** - Archived after max retries

**Enforcement**: `archivedAt` timestamp, excluded from default queries

---

### Hard-Deletable Records (Permanently Removed)
**Purpose**: Remove data that's no longer needed

After soft-delete retention period:
- **User** - After 90 days soft-deleted
- **Session** - After 30 days soft-deleted
- **Module** - Admin decision
- **Notifications** - After 90 days
- **Tokens** - After 7-30 days
- **Webhook/Email Logs** - After 90 days

**Enforcement**: Background jobs purge based on retention policies

---

## Retention Schedules

### Immediate Deletion (< 7 days)
- Expired OTP challenges (7 days)
- Used verification tokens (7 days)

### Short-Term Retention (7-30 days)
- Revoked device tokens (30 days)
- Expired sessions (30 days)
- User account cooling-off period (30 days)

### Medium-Term Retention (90 days)
- Soft-deleted user accounts (90 days)
- Notification logs (90 days)
- Email delivery logs (90 days)
- Webhook delivery logs (90 days)
- Sync events (90 days)
- Data export requests (90 days)
- Account deletion requests (90 days)

### Long-Term Retention (Indefinite)
- All immutable records
- Financial transactions
- Credentials
- Completions
- Audit logs
- Preference audit logs

---

## Cascade Behavior on User Deletion

### Cascaded (Deleted with User)
- Sessions
- Device tokens
- Notification preferences
- Learner preferences
- Verification tokens
- OTP challenges
- Email deliveries
- Sync events
- Data export requests
- Account deletion requests

### Retained (Not Deleted)
- Transactions (immutable financial records)
- Credentials (verifiable claims)
- Completions (learning proof)
- Referrals (referral relationships)
- Audit logs (compliance)
- Preference audit logs (audit trail)

### Anonymized (PII Removed)
- Audit logs where user is actor (user ID pseudonymized)
- Transaction references (user ID retained but PII redacted)
- Completion references (user ID retained for stats)

---

## Automatic Lifecycle Jobs

### Daily Jobs (2 AM UTC)
1. **Archive Expired Data**
   - Archive deleted users after cooling-off period
   - Archive expired OTP challenges
   - Archive used verification tokens
   - Archive dead-letter notifications

2. **Purge Old Archives**
   - Permanently delete data past retention period
   - Log all purge operations in audit log

### Hourly Jobs
1. **Expire Stale Data**
   - Mark expired sessions as revoked
   - Mark expired OTP challenges as EXPIRED
   - Mark expired verification tokens as EXPIRED

---

## Query Behavior

### Default Queries (Exclude Deleted/Archived)
```typescript
// Automatically excludes deleted and archived records
const users = await prisma.user.findMany({})
```

### Explicit Deleted Query
```typescript
// Query only deleted records
const deletedUsers = await prisma.user.findMany({
  where: { deletedAt: { not: null } }
})
```

### Explicit Archived Query
```typescript
// Query only archived records
const archivedUsers = await prisma.user.findMany({
  where: { archivedAt: { not: null } }
})
```

### Include All (Admin)
```typescript
// Query all records including deleted/archived
const allUsers = await prisma.$queryRaw`
  SELECT * FROM users
`
```

---

## Data Export (GDPR Compliance)

### Included in User Data Export
- User profile and preferences
- Sessions (active and recent)
- Notifications sent to user
- Module completions
- Transactions (rewards, withdrawals)
- Credentials issued
- Referrals (as referrer or referee)
- Audit logs (where user is actor)
- Data export request history
- Account deletion request history

### Excluded from User Data Export
- Hashed passwords
- Session tokens
- OTP codes
- Internal system metadata
- Other users' data
- Aggregate statistics

---

## Privacy & Anonymization

### On Account Deletion
1. **PII Redacted**:
   - Email → `deleted_user_[hash]@example.com`
   - Phone → null
   - Username → `deleted_user_[hash]`
   - Wallet address → retained (blockchain)

2. **Retained for Compliance**:
   - Transaction records (user ID as foreign key)
   - Credential records (user ID as foreign key)
   - Completion records (user ID as foreign key)
   - Audit logs (user ID pseudonymized)

3. **Cascaded Deletion**:
   - All soft-deletable related records
   - Sessions, tokens, preferences

---

## Audit Trail Requirements

### Every Sensitive Mutation Includes
- **Actor**: Who performed the action (user, system, admin)
- **Action**: What was done (USER_DELETED, REWARD_ISSUED, etc.)
- **Target**: What was affected (User:123, Transaction:456)
- **Reason**: Why it was done (optional)
- **Request ID**: Correlation ID for tracing
- **Metadata**: Safe contextual data (no secrets, minimal PII)
- **Result**: Success or failure
- **Timestamp**: When it occurred
- **IP Address**: Where it came from (if applicable)
- **User Agent**: Client information (if applicable)

### Metadata Sanitization
- **Redacted**: passwords, tokens, OTP codes, API keys, secrets
- **Minimized**: email addresses, phone numbers (use user ID instead)
- **Preserved**: status changes, counts, public identifiers

---

## Implementation Status

✅ Schema updated with `deletedAt`, `archivedAt`, `archivedReason` columns  
✅ Prisma client extension created for lifecycle enforcement  
✅ Audit service implemented with sanitization  
✅ Soft-delete middleware active  
✅ Archive visibility middleware active  
✅ Immutability enforcement active  
⬜ Background lifecycle jobs (to be implemented)  
⬜ Admin archive management UI (future)  
⬜ Data export automation (partial - see existing implementation)

---

**Version:** 1.0  
**Last Updated:** 2026-07-22  
**Status:** ✅ Complete
