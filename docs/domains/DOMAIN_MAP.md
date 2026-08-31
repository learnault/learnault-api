# Learnault API Domain Map

## Visual Domain Architecture

```plaintext
┌─────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                │
│                     (Web App, Mobile App, CLI)                           │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                               │ HTTP/REST
                               ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                           API GATEWAY / ROUTES                           │
│                         (Express Router - /api/v1/)                      │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
              ┌────────────────┴────────────────┐
              │                                  │
              ↓                                  ↓
    ┏━━━━━━━━━━━━━━━━━┓              ┏━━━━━━━━━━━━━━━━━┓
    ┃  SHARED KERNEL  ┃              ┃ INFRASTRUCTURE  ┃
    ┃                 ┃              ┃                 ┃
    ┃  • Config       ┃              ┃  • Blockchain   ┃
    ┃  • Errors       ┃              ┃    (Stellar/    ┃
    ┃  • Middleware   ┃              ┃     Soroban)    ┃
    ┃  • Types        ┃              ┃  • Database     ┃
    ┃  • Utils        ┃              ┃    (Prisma)     ┃
    ┃  • Messaging    ┃              ┃  • Firebase     ┃
    ┗━━━━━━━━━━━━━━━━━┛              ┗━━━━━━━━━━━━━━━━━┛
              ↑                                  ↑
              │                                  │
              │ (All domains depend on these)   │
              │                                  │
┌─────────────┴──────────────────────────────────┴─────────────────────────┐
│                         BUSINESS DOMAINS LAYER                            │
│                                                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                   │
│  │   Identity   │  │    Users     │  │   Learning   │                   │
│  │   & Access   │  │  Management  │  │   Content    │                   │
│  ├──────────────┤  ├──────────────┤  ├──────────────┤                   │
│  │ • Register   │  │ • Profiles   │  │ • Modules    │                   │
│  │ • Login      │  │ • Wallet     │  │ • Progress   │                   │
│  │ • Verify     │  │ • Prefs      │  │ • Completion │                   │
│  │ • Tokens     │  │ • Lookup     │  │              │                   │
│  └──────────────┘  └──────────────┘  └──────────────┘                   │
│         │                 │                   │                          │
│         └─────────────────┴───────────────────┘                          │
│                           │                                               │
│                  ┌────────┴────────┐                                     │
│                  │ Domain Events    │                                     │
│                  └────────┬────────┘                                     │
│                           │                                               │
│         ┌─────────────────┼─────────────────┬──────────────┐            │
│         │                 │                 │              │            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐│
│  │ Credentials  │  │   Rewards    │  │  Referrals   │  │Notifications ││
│  ├──────────────┤  ├──────────────┤  ├──────────────┤  ├──────────────┤│
│  │ • Issue      │  │ • Calculate  │  │ • Codes      │  │ • Push       ││
│  │ • Verify     │  │ • Distribute │  │ • Track      │  │ • Device     ││
│  │ • On-chain   │  │ • Balance    │  │ • Bonuses    │  │   Tokens     ││
│  │              │  │ • Withdraw   │  │              │  │ • Prefs      ││
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘│
│                                                                           │
│  ┌──────────────┐  ┌──────────────┐                                     │
│  │Organizations │  │     Sync     │                                     │
│  ├──────────────┤  ├──────────────┤                                     │
│  │ • Employers  │  │ • Events     │                                     │
│  │ • Verify     │  │ • Idempotency│                                     │
│  │ • Relations  │  │ • Conflicts  │                                     │
│  └──────────────┘  └──────────────┘                                     │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## Domain Dependency Graph

### Allowed Dependencies (→ means "can call/use")

```plaintext
┌──────────────┐
│   Identity   │───────┐
└──────────────┘       │
                       ↓
                 ┌──────────────┐
                 │  Shared      │←────────── All Domains
                 │  Kernel      │
                 └──────────────┘
                       ↑
                       │
┌──────────────┐       │
│   Learning   │───────┘
└──────────────┘
       │
       │ (events)
       ↓
┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│   Rewards    │──────→│ Blockchain   │←──────│ Credentials  │
└──────────────┘       │ Infrastructure│       └──────────────┘
       │               └──────────────┘               │
       │ (events)                                     │ (events)
       ↓                                              ↓
┌──────────────┐                               ┌──────────────┐
│ Notifications│←──────────────────────────────│   Referrals  │
└──────────────┘                               └──────────────┘
```

### Forbidden Dependencies (❌)

```plaintext
Identity ❌→ Learning, Rewards, Credentials, etc.
Learning ❌→ Rewards, Credentials, Notifications
Rewards  ❌→ Learning, Credentials, Referrals
Shared   ❌→ Any Domain
Infrastructure ❌→ Any Domain
```

---

## Communication Matrix

| Source Domain | Target Domain    | Communication Type | Purpose                 |
| ------------- | ---------------- | ------------------ | ----------------------- |
| Identity      | Shared/Messaging | Service Call       | Email delivery          |
| Identity      | Users            | Domain Event       | Profile init            |
| Identity      | Referrals        | Domain Event       | Referral check          |
| Learning      | Rewards          | Domain Event       | Trigger reward          |
| Learning      | Credentials      | Domain Event       | Trigger credential      |
| Learning      | Referrals        | Domain Event       | Bonus check             |
| Rewards       | Blockchain Infra | Service Call       | Payment                 |
| Rewards       | Notifications    | Domain Event       | Reward notification     |
| Credentials   | Blockchain Infra | Service Call       | On-chain store          |
| Credentials   | Notifications    | Domain Event       | Credential notification |
| Referrals     | Rewards          | Domain Event       | Bonus eligible          |
| All           | Shared Kernel    | Direct Import      | Config, errors, utils   |

---

## Domain Responsibilities Matrix

| Domain            | Core Responsibility                          | API Endpoints                                                                 | Database Models                                      | External Dependencies |
| ----------------- | -------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------- |
| **Identity**      | Authentication, registration, verification   | `/auth/register`, `/auth/login`, `/auth/verify-email`, `/auth/logout`         | User, VerificationToken, EmailDelivery               | None                  |
| **Users**         | Profile management, wallet addresses         | `/users/me`, `/users/profile`, `/users/wallet`, `/users/:id`                  | User (read/update)                                   | Identity (auth)       |
| **Learning**      | Modules, completions, progress               | `/modules`, `/modules/:id`, `/modules/:id/complete`                           | Module, Completion                                   | Identity (auth)       |
| **Credentials**   | Credential issuance, verification            | `/credentials`, `/credentials/issue`, `/credentials/:id/verify`               | Credential                                           | Blockchain            |
| **Rewards**       | Reward calculation, distribution, withdrawal | `/rewards/balance`, `/rewards/history`, `/rewards/withdraw`, `/rewards/claim` | Transaction                                          | Blockchain            |
| **Referrals**     | Referral tracking, code generation           | `/referrals/code`, `/referrals/apply`, `/referrals/stats`                     | ReferralCode, Referral                               | None                  |
| **Notifications** | Push notifications, device tokens            | `/notifications/register-device`, `/notifications/preferences`                | NotificationLog, DeviceToken, NotificationPreference | Firebase              |
| **Organizations** | Employer management                          | `/employer`, `/employer/:id`                                                  | (Future models)                                      | None                  |
| **Sync**          | Client-server sync, idempotency              | `/sync/events`, `/sync/status`                                                | SyncEvent                                            | None                  |

---

## Event Flow Map

### Primary Event Chains

#### 1. User Registration Chain

```plaintext
UserRegistered (Identity)
  ├─→ ProfileInitialized (Users)
  ├─→ ReferralChecked (Referrals)
  └─→ PreferencesCreated (Notifications)
```

#### 2. Module Completion Chain

```plaintext
ModuleCompleted (Learning)
  ├─→ RewardCalculated (Rewards)
  │     ├─→ PaymentProcessed (Blockchain)
  │     ├─→ RewardNotification (Notifications)
  │     └─→ ReferralBonusEligible (Referrals)
  │           └─→ BonusPaid (Rewards)
  │
  └─→ CredentialIssued (Credentials)
        ├─→ OnChainStored (Blockchain)
        └─→ CredentialNotification (Notifications)
```

#### 3. Withdrawal Chain

```plaintext
WithdrawalRequested (Rewards)
  ├─→ PaymentProcessed (Blockchain)
  ├─→ WithdrawalNotification (Notifications)
  └─→ BalanceUpdated (Rewards)
```

---

## File Organization Map

### Current Structure (Before Refactoring)

```plaintext
src/
├── controllers/          # 9 controllers (flat)
├── services/             # 6 services (flat)
├── routes/v1/            # 9 route files (flat)
├── types/                # 7 type files (flat)
├── schemas/              # 1 schema file
├── middleware/           # 5 middleware files
├── config/               # 5 config files
└── utils/                # 9 utility files
```

### Target Structure (Domain-Driven)

```plaintext
src/
├── domains/
│   ├── identity/
│   │   ├── controllers/auth.controller.ts
│   │   ├── services/auth.service.ts
│   │   ├── routes/auth.routes.ts
│   │   ├── schemas/auth.schema.ts
│   │   ├── types/auth.types.ts
│   │   └── index.ts
│   ├── users/
│   ├── learning/
│   ├── credentials/
│   ├── rewards/
│   ├── referrals/
│   ├── notifications/
│   ├── organizations/
│   └── sync/
├── shared/
│   ├── config/
│   ├── errors/
│   ├── middleware/
│   ├── types/
│   ├── utils/
│   └── messaging/
└── infrastructure/
    └── blockchain/
```

---

## Orchestration Ownership

| Workflow                  | Owner Domain  | Responsibility                                          |
| ------------------------- | ------------- | ------------------------------------------------------- |
| **User Registration**     | Identity      | Create user, generate token, queue email, publish event |
| **Module Completion**     | Learning      | Record completion, publish event                        |
| **Reward Distribution**   | Rewards       | Calculate, pay, record transaction (event handler)      |
| **Credential Issuance**   | Credentials   | Issue, store on-chain (event handler)                   |
| **Referral Bonus**        | Referrals     | Check eligibility, publish event (event handler)        |
| **Notification Delivery** | Notifications | Queue, deliver, retry (event handler)                   |

### Orchestration Rules

1. **Domain events are the coordination mechanism** - No direct service-to-service calls across domains
2. **Each domain owns its workflow** - A domain publishes events; other domains react
3. **Event handlers are idempotent** - Safe to process duplicate events
4. **Failures are isolated** - Event handler failure doesn't fail originating request

---

## Current vs. Target State

### Current Issues

1. ❌ **Direct cross-domain imports**
   - `reward.service.ts` imports `notification.service.ts`
   - `auth.controller.ts` imports `email.service.ts` directly

2. ❌ **No clear domain boundaries**
   - Controllers, services, routes in flat structure
   - No domain folders

3. ❌ **Tight coupling**
   - Services call other services directly
   - Hard to test in isolation

4. ❌ **Mixed concerns**
   - Config mixed with business logic
   - Infrastructure mixed with domains

### Target State

1. ✅ **Clear domain boundaries**
   - Each domain in separate folder
   - Clear ownership of features

2. ✅ **Event-driven communication**
   - Domains publish events
   - Event handlers react

3. ✅ **Loose coupling**
   - Domains communicate via events
   - Can test domains in isolation

4. ✅ **Separation of concerns**
   - Shared kernel extracted
   - Infrastructure separated
   - Business logic in domains

---

## Import Rules Summary

### ✅ Allowed Imports

```typescript
// Any domain can import from shared kernel
import { prisma } from '@/shared/config/database'
import { NotFoundError } from '@/shared/errors'
import { authenticate } from '@/shared/middleware/auth'

// Domains can use infrastructure
import { blockchainService } from '@/infrastructure/blockchain'

// Domains can import Identity for auth context
import { AuthRequest } from '@/domains/identity/types/auth.types'
```

### ❌ Forbidden Imports

```typescript
// Cross-domain service imports
import { RewardService } from '@/domains/rewards/reward.service' // ❌

// Shared kernel importing domains
// (in shared/messaging/email.service.ts)
import { User } from '@/domains/users/types/user.types' // ❌

// Infrastructure importing domains
// (in infrastructure/blockchain/stellar.service.ts)
import { Reward } from '@/domains/rewards/types/reward.types' // ❌
```

---

## Validation Strategy

### 1. Static Analysis (ESLint)

```bash
pnpm lint  # Check for import violations
```

### 2. Architecture Tests

```bash
pnpm test integrations/architecture/  # Run boundary tests
```

Tests verify:

- No forbidden cross-domain imports
- No circular dependencies
- Infrastructure isolation
- Shared kernel isolation

### 3. Code Review

- Manual review of PRs for architecture violations
- Check cross-domain communication uses events
- Verify new features follow domain structure

### 4. Documentation

- Keep this domain map updated
- Document new events and flows
- Update architecture diagrams

---

## Key Metrics

| Metric                     | Current                     | Target           |
| -------------------------- | --------------------------- | ---------------- |
| **Domain Boundaries**      | 0 (flat structure)          | 9 (enforced)     |
| **Forbidden Dependencies** | Many (direct service calls) | 0 (event-driven) |
| **Architecture Tests**     | 0                           | 5+ test suites   |
| **Domain Documentation**   | Minimal                     | Complete         |
| **Circular Dependencies**  | Unknown                     | 0 (tested)       |

---

## Next Steps

1. ✅ **Phase 0: Documentation** (Current)
   - Domain inventory
   - Domain definitions
   - Shared kernel specification
   - Architecture tests
   - Request and event flows

2. ⬜ **Phase 1: Shared Kernel Extraction**
   - Create `src/shared/` structure
   - Move config, errors, middleware, utils
   - Update all imports

3. ⬜ **Phase 2: Domain Folder Structure**
   - Create `src/domains/[domain]/` folders
   - Move controllers, services, routes, types
   - Update imports

4. ⬜ **Phase 3: Event Infrastructure**
   - Implement event bus
   - Define event types
   - Create event handlers

5. ⬜ **Phase 4: Refactor to Events**
   - Replace direct service calls with events
   - Implement event handlers
   - Remove forbidden dependencies

6. ⬜ **Phase 5: Repository Layer**
   - Add repository pattern
   - Abstract database access
   - Improve testability

---

## Success Criteria (Phase 0 - Complete)

- ✅ Every source file mapped to one domain or shared kernel
- ✅ Forbidden and circular dependencies identified
- ✅ Cross-domain ownership is unambiguous
- ✅ Architecture tests created and documented
- ✅ Domain map and documentation complete

---

## References

- [Domain Inventory](./DOMAIN_INVENTORY.md)
- [Domain Definitions](./DOMAIN_DEFINITIONS.md)
- [Shared Kernel](./SHARED_KERNEL.md)
- [Request and Event Flows](./REQUEST_AND_EVENT_FLOWS.md)
- [Architecture Overview](../ARCHITECTURE.md)

---

**Last Updated:** 2026-07-18  
**Status:** Phase 0 Complete - Documentation and Planning  
**Next Phase:** Shared Kernel Extraction
