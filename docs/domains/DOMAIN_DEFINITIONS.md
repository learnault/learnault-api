# Domain Definitions and Boundaries

## Domain Architecture Overview

This document defines the bounded contexts, responsibilities, public interfaces, and dependency rules for the Learnault API.

---

## 1. Identity & Access Domain

**Location:** `src/domains/identity/`

**Responsibility:**

- User authentication (registration, login, logout)
- Email verification and token management
- JWT token generation and validation
- Password management and security
- Session management

**Public Interface:**

- `POST /api/v1/auth/register` - Register new user
- `POST /api/v1/auth/login` - Authenticate user
- `POST /api/v1/auth/logout` - End user session
- `POST /api/v1/auth/verify-email` - Verify email with token
- `POST /api/v1/auth/resend-verification` - Resend verification email
- Service: `IdentityService.verifyToken(token: string): UserId`
- Service: `IdentityService.getUserRole(userId: string): Role`

**Domain Events Published:**

- `UserRegistered(userId, email, role, timestamp)`
- `EmailVerified(userId, timestamp)`
- `UserLoggedIn(userId, timestamp)`

**Allowed Dependencies:**

- Shared kernel (config, errors, logging, database)
- Messaging infrastructure (for email delivery)

**Forbidden Dependencies:**

- ❌ Cannot import from: users, learning, credentials, rewards, referrals, notifications domains
- ❌ Cannot directly call services from other domains

---

## 2. User Management Domain

**Location:** `src/domains/users/`

**Responsibility:**

- User profile management (view, update)
- Wallet address management
- User preferences
- User query and lookup (public profiles)

**Public Interface:**

- `GET /api/v1/users/me` - Get current user profile
- `PUT /api/v1/users/profile` - Update user profile
- `PUT /api/v1/users/wallet` - Update wallet address
- `GET /api/v1/users/:id` - Get public user profile
- `POST /api/v1/users/password` - Change password
- Service: `UserService.getUserById(userId: string): User`
- Service: `UserService.getUserWallet(userId: string): WalletAddress | null`

**Domain Events Published:**

- `UserProfileUpdated(userId, changes, timestamp)`
- `WalletAddressUpdated(userId, walletAddress, timestamp)`
- `PasswordChanged(userId, timestamp)`

**Allowed Dependencies:**

- Shared kernel (config, errors, logging, database)
- Identity domain (for authentication context)

**Forbidden Dependencies:**

- ❌ Cannot import from: learning, credentials, rewards, referrals domains
- ❌ User domain does NOT own user business logic from other domains

---

## 3. Learning Content Domain

**Location:** `src/domains/learning/`

**Responsibility:**

- Module/course content management
- Module metadata (title, description, difficulty, category)
- Learning progress tracking
- Module completion recording
- Curriculum structure

**Public Interface:**

- `GET /api/v1/modules` - List available modules
- `GET /api/v1/modules/:id` - Get module details
- `POST /api/v1/modules` - Create module (admin)
- `PUT /api/v1/modules/:id` - Update module (admin)
- `POST /api/v1/modules/:id/complete` - Mark module as completed
- `GET /api/v1/modules/:id/completions` - Get completion records
- Service: `LearningService.getModule(moduleId: string): Module`
- Service: `LearningService.recordCompletion(userId, moduleId, score): Completion`

**Domain Events Published:**

- `ModuleCreated(moduleId, title, difficulty, reward, timestamp)`
- `ModuleCompleted(userId, moduleId, score, timestamp)`
- `ProgressUpdated(userId, moduleId, progress, timestamp)`

**Allowed Dependencies:**

- Shared kernel (config, errors, logging, database)
- Identity domain (for authentication context)

**Forbidden Dependencies:**

- ❌ Cannot import from: rewards, credentials, referrals, notifications
- ❌ Does NOT orchestrate reward distribution or credential issuance
- ❌ Only publishes domain events; does not call downstream services

---

## 4. Credentials Domain

**Location:** `src/domains/credentials/`

**Responsibility:**

- Digital credential issuance
- Credential verification
- On-chain credential management
- Credential lifecycle (issued, revoked)
- Credential lookup and validation

**Public Interface:**

- `GET /api/v1/credentials` - List user's credentials
- `GET /api/v1/credentials/:id` - Get credential details
- `POST /api/v1/credentials/issue` - Issue new credential
- `GET /api/v1/credentials/:id/verify` - Verify credential authenticity
- Service: `CredentialService.issueCredential(userId, moduleId): Credential`
- Service: `CredentialService.verifyCredential(credentialId): boolean`

**Domain Events Published:**

- `CredentialIssued(credentialId, userId, moduleId, onChainId, timestamp)`
- `CredentialRevoked(credentialId, reason, timestamp)`
- `CredentialVerified(credentialId, verifierId, timestamp)`

**Allowed Dependencies:**

- Shared kernel (config, errors, logging, database)
- Identity domain (for authentication context)
- Blockchain infrastructure (for on-chain operations)

**Forbidden Dependencies:**

- ❌ Cannot import from: rewards, referrals, notifications, learning (except via events)

---

## 5. Rewards Domain

**Location:** `src/domains/rewards/`

**Responsibility:**

- Reward calculation (base, streak, referral bonuses)
- Reward distribution via blockchain
- Balance tracking and management
- Withdrawal processing
- Transaction history

**Public Interface:**

- `GET /api/v1/rewards/balance` - Get user's reward balance
- `GET /api/v1/rewards/history` - Get transaction history
- `POST /api/v1/rewards/withdraw` - Process withdrawal
- `POST /api/v1/rewards/claim` - Claim module completion reward
- Service: `RewardService.claimReward(userId, moduleId, streakDays, referralCode): RewardResult`
- Service: `RewardService.getBalance(userId): Balance`

**Domain Events Published:**

- `RewardClaimed(userId, moduleId, amount, breakdown, txHash, timestamp)`
- `RewardDistributed(userId, amount, type, txHash, timestamp)`
- `WithdrawalProcessed(userId, amount, walletAddress, txHash, timestamp)`
- `BalanceUpdated(userId, available, pending, lifetime, timestamp)`

**Allowed Dependencies:**

- Shared kernel (config, errors, logging, database)
- Identity domain (for authentication context)
- Blockchain infrastructure (for payment processing)

**Forbidden Dependencies:**

- ❌ Cannot import from: learning, credentials, referrals, notifications domains
- ❌ Should receive module completion via events, not direct calls

---

## 6. Referrals Domain

**Location:** `src/domains/referrals/`

**Responsibility:**

- Referral code generation and management
- Referral tracking and attribution
- Referral bonus eligibility calculation
- Referral relationship management

**Public Interface:**

- `GET /api/v1/referrals/code` - Get user's referral code
- `POST /api/v1/referrals/code` - Generate referral code
- `POST /api/v1/referrals/apply` - Apply referral code
- `GET /api/v1/referrals/stats` - Get referral statistics
- Service: `ReferralService.getReferralCode(userId): ReferralCode`
- Service: `ReferralService.applyReferral(referreeId, code): Referral`
- Service: `ReferralService.getReferrerForUser(userId): string | null`

**Domain Events Published:**

- `ReferralCodeGenerated(userId, code, timestamp)`
- `ReferralApplied(referrerId, referreeId, code, timestamp)`
- `ReferralBonusEligible(referrerId, referreeId, amount, reason, timestamp)`

**Allowed Dependencies:**

- Shared kernel (config, errors, logging, database)
- Identity domain (for authentication context)

**Forbidden Dependencies:**

- ❌ Cannot import from: rewards, learning, credentials, notifications
- ❌ Does NOT directly trigger reward payment; publishes events instead

---

## 7. Notifications Domain

**Location:** `src/domains/notifications/`

**Responsibility:**

- Push notification delivery
- Device token registration and management
- Notification preferences management
- Notification queue and retry logic
- Notification templates and formatting

**Public Interface:**

- `POST /api/v1/notifications/register-device` - Register device token
- `PUT /api/v1/notifications/preferences` - Update notification preferences
- `GET /api/v1/notifications/preferences` - Get notification preferences
- `GET /api/v1/notifications/history` - Get notification history
- Service: `NotificationService.sendNotification(userId, type, title, body): void`

**Domain Events Published:**

- `NotificationSent(userId, type, title, timestamp)`
- `NotificationFailed(userId, type, error, timestamp)`
- `DeviceTokenRegistered(userId, token, platform, timestamp)`

**Allowed Dependencies:**

- Shared kernel (config, errors, logging, database)
- Identity domain (for authentication context)
- External: Firebase Admin SDK

**Forbidden Dependencies:**

- ❌ Cannot import from: rewards, learning, credentials, referrals, users
- ❌ Should be triggered by events or explicit calls, not direct imports

---

## 8. Organizations Domain

**Location:** `src/domains/organizations/`

**Responsibility:**

- Employer/organization management
- Organization profile and settings
- Organization-learner relationships
- Organization-issued credentials (future)
- Organization verification

**Public Interface:**

- `GET /api/v1/employer` - List employers
- `GET /api/v1/employer/:id` - Get employer details
- `POST /api/v1/employer` - Create employer (admin)
- `PUT /api/v1/employer/:id` - Update employer
- Service: `OrganizationService.getOrganization(orgId): Organization`

**Domain Events Published:**

- `OrganizationCreated(orgId, name, timestamp)`
- `OrganizationUpdated(orgId, changes, timestamp)`
- `OrganizationVerified(orgId, verifierId, timestamp)`

**Allowed Dependencies:**

- Shared kernel (config, errors, logging, database)
- Identity domain (for authentication context)

**Forbidden Dependencies:**

- ❌ Cannot import from other business domains

---

## 9. Synchronization Domain

**Location:** `src/domains/sync/`

**Responsibility:**

- Client-server synchronization
- Event deduplication (idempotency)
- Conflict resolution
- Offline-first support
- Sync event logging and replay

**Public Interface:**

- `POST /api/v1/sync/events` - Submit sync events
- `GET /api/v1/sync/status` - Get sync status
- Service: `SyncService.processSyncEvent(event): SyncResult`

**Domain Events Published:**

- `SyncEventReceived(userId, eventType, deviceId, timestamp)`
- `SyncEventApplied(userId, eventType, timestamp)`
- `SyncConflictDetected(userId, eventType, conflict, timestamp)`

**Allowed Dependencies:**

- Shared kernel (config, errors, logging, database)
- Identity domain (for authentication context)
- May coordinate with other domains via events

**Forbidden Dependencies:**

- ❌ Should not have hard dependencies on business domains
- ❌ Coordinates via events and interfaces, not direct imports

---

## 10. Blockchain Integration Infrastructure

**Location:** `src/infrastructure/blockchain/`

**Responsibility:**

- Stellar network integration
- Soroban smart contract interaction
- Payment processing
- Transaction signing and submission
- Blockchain state queries
- Wallet management

**Public Interface:**

- Service: `BlockchainService.sendPayment(params): PaymentResult`
- Service: `BlockchainService.getBalance(address): Balance`
- Service: `BlockchainService.submitTransaction(tx): TxResult`
- Service: `BlockchainService.issueOnChainCredential(data): OnChainId`

**Used By:**

- Rewards domain (for payment distribution)
- Credentials domain (for on-chain credential issuance)

**Allowed Dependencies:**

- Shared kernel (config, errors, logging)
- External: Stellar SDK, Soroban SDK

**Forbidden Dependencies:**

- ❌ Cannot import from any business domain
- ❌ Pure infrastructure; no business logic

---

## Shared Kernel

**Location:** `src/shared/`

**Components:**

1. **Configuration** (`src/shared/config/`)
   - Database client, environment variables, logging, external service configs

2. **Error Handling** (`src/shared/errors/`)
   - Error types, error middleware, error utilities

3. **Middleware** (`src/shared/middleware/`)
   - Authentication, validation, rate limiting, error handling

4. **Common Types** (`src/shared/types/`)
   - API response formats, pagination, common DTOs

5. **Utilities** (`src/shared/utils/`)
   - JWT, password hashing, date/number/string helpers

6. **Messaging Infrastructure** (`src/shared/messaging/`)
   - Email service (outbox pattern)
   - Webhook service (outbox pattern)
   - Event bus/dispatcher (future)

**Allowed Dependencies:**

- External libraries only
- No business domain imports

---

## Orchestration Ownership

### Module Completion Orchestration

**Owner:** Learning Content Domain

**Flow:**

1. Learning domain receives `POST /modules/:id/complete`
2. Learning domain records completion
3. Learning domain publishes `ModuleCompleted` event
4. Event subscribers react:
   - Rewards domain → claims reward
   - Credentials domain → issues credential
   - Notifications domain → sends notification

### Reward Distribution Orchestration

**Owner:** Rewards Domain

**Flow:**

1. Rewards domain receives `ModuleCompleted` event OR direct `/rewards/claim` request
2. Rewards domain calculates reward (queries referral status via service/event)
3. Rewards domain processes payment via blockchain infrastructure
4. Rewards domain publishes `RewardDistributed` event
5. Event subscribers react:
   - Notifications domain → sends reward notification
   - Referrals domain → processes referral bonus eligibility

### Credential Issuance Orchestration

**Owner:** Credentials Domain

**Flow:**

1. Credentials domain receives `ModuleCompleted` event OR direct `/credentials/issue` request
2. Credentials domain validates completion
3. Credentials domain issues credential via blockchain infrastructure
4. Credentials domain publishes `CredentialIssued` event
5. Event subscribers react:
   - Notifications domain → sends credential notification

### User Registration Orchestration

**Owner:** Identity Domain

**Flow:**

1. Identity domain receives `POST /auth/register`
2. Identity domain creates user record
3. Identity domain generates verification token
4. Identity domain queues verification email via messaging infrastructure
5. Identity domain publishes `UserRegistered` event
6. Event subscribers react:
   - Users domain → initializes default preferences
   - Referrals domain → checks for applied referral code

---

## Import Rules Summary

### Allowed Import Patterns

```plaintext
✅ Any domain → Shared Kernel
✅ Any domain → Infrastructure (database, blockchain, messaging)
✅ Any domain → Identity domain (for auth context)
✅ Domain A ← Domain B (only via events or explicit public service interfaces)
```

### Forbidden Import Patterns

```plaintext
❌ Domain A → Domain B directly (controller/service imports)
❌ Circular dependencies between domains
❌ Infrastructure → Business domains
❌ Shared kernel → Business domains
```

### Cross-Domain Communication

**Preferred Methods:**

1. **Domain Events** (async, decoupled) - Preferred
2. **Public Service Interfaces** (sync, when necessary) - Use sparingly
3. **Database queries** (read-only, via repository) - Acceptable for queries

**Anti-Patterns:**

- Direct controller-to-controller calls
- Direct service-to-service imports across domains
- Sharing internal domain models across boundaries

---

## Validation Strategy

1. **Static Analysis:** ESLint import boundary rules
2. **Architecture Tests:** Automated tests validating dependency rules
3. **Code Review:** Manual review of cross-domain interactions
4. **Documentation:** Keep this document up-to-date with changes
