# Domain Architecture Documentation

This directory contains comprehensive documentation for the Learnault API domain-driven architecture.

---

## Quick Links

| Document                                                  | Purpose                                                          |
| --------------------------------------------------------- | ---------------------------------------------------------------- |
| **[Implementation Summary](./IMPLEMENTATION_SUMMARY.md)** | 📋 Start here - Overview of deliverables and acceptance criteria |
| **[Domain Map](./DOMAIN_MAP.md)**                         | 🗺️ Visual diagrams, dependency graphs, and metrics               |
| **[Domain Definitions](./DOMAIN_DEFINITIONS.md)**         | 📚 Complete specifications for all 10 domains                    |
| **[Domain Inventory](./DOMAIN_INVENTORY.md)**             | 🔍 Analysis of current codebase and dependencies                 |
| **[Shared Kernel](./SHARED_KERNEL.md)**                   | 🛠️ Shared infrastructure specification                           |
| **[Request & Event Flows](./REQUEST_AND_EVENT_FLOWS.md)** | 🔄 Detailed flow diagrams for all features                       |
| **[Architecture](../ARCHITECTURE.md)**                    | 🏗️ Main architecture documentation                               |

---

## Reading Guide

### For New Developers

1. Start with **[Domain Map](./DOMAIN_MAP.md)** for visual overview
2. Read **[Domain Definitions](./DOMAIN_DEFINITIONS.md)** to understand boundaries
3. Check **[Request & Event Flows](./REQUEST_AND_EVENT_FLOWS.md)** for feature workflows

### For Architecture Review

1. Read **[Implementation Summary](./IMPLEMENTATION_SUMMARY.md)** for acceptance criteria
2. Review **[Domain Definitions](./DOMAIN_DEFINITIONS.md)** for boundary rules
3. Examine **[Domain Map](./DOMAIN_MAP.md)** for dependency graphs

### For Implementation

1. Read **[Shared Kernel](./SHARED_KERNEL.md)** for infrastructure setup
2. Check **[Domain Definitions](./DOMAIN_DEFINITIONS.md)** for your domain's responsibilities
3. Follow **[Request & Event Flows](./REQUEST_AND_EVENT_FLOWS.md)** for integration patterns

---

## Architecture Overview

### 10 Business Domains

1. **Identity & Access** - Authentication, registration, verification
2. **User Management** - Profiles, wallet addresses, preferences
3. **Learning Content** - Modules, completions, progress
4. **Credentials** - Digital credential issuance and verification
5. **Rewards** - Reward calculation, distribution, withdrawals
6. **Referrals** - Referral tracking and bonuses
7. **Notifications** - Push notifications and preferences
8. **Organizations** - Employer/organization management
9. **Synchronization** - Client-server sync and idempotency
10. **Blockchain Integration** - Stellar/Soroban infrastructure

### Shared Kernel

- Configuration (database, env, logging)
- Error handling (types, middleware)
- Middleware (auth, validation, rate limiting)
- Common types (API responses, pagination)
- Utilities (JWT, password, helpers)
- Messaging infrastructure (email, webhooks, events)

---

## Key Principles

1. **Clear Boundaries** - Each domain has defined responsibilities
2. **Loose Coupling** - Domains communicate via events, not direct imports
3. **Event-Driven** - Cross-domain coordination through domain events
4. **Shared Nothing** - Except shared kernel and infrastructure
5. **Testable** - Architecture tests enforce boundary rules

---

## Dependency Rules

### ✅ Allowed

```plaintext
Domain → Shared Kernel
Domain → Infrastructure
Domain → Identity (for auth context)
Domain A ← Domain B (via events only)
```

### ❌ Forbidden

```plaintext
Domain A → Domain B (direct import)
Infrastructure → Domain
Shared Kernel → Domain
Circular dependencies
```

---

## Architecture Tests

Automated tests enforce domain boundaries:

```bash
pnpm test integrations/architecture/domain-boundaries.test.ts
```

Tests verify:

- No forbidden cross-domain imports
- No circular dependencies
- Infrastructure isolation
- Shared kernel isolation
- File organization

---

## Current Status

**Phase 0:** ✅ Complete - Documentation & Planning

**Deliverables:**

- ✅ Domain inventory
- ✅ Domain definitions with boundaries
- ✅ Shared kernel specification
- ✅ Orchestration ownership
- ✅ Architecture tests
- ✅ Request and event flow documentation
- ✅ Visual domain map

**Next Phase:** Shared Kernel Extraction

---

## File Structure

```plaintext
docs/domains/
├── README.md                        # This file
├── IMPLEMENTATION_SUMMARY.md        # Overview and acceptance criteria
├── DOMAIN_MAP.md                    # Visual diagrams and graphs
├── DOMAIN_DEFINITIONS.md            # Complete domain specifications
├── DOMAIN_INVENTORY.md              # Current state analysis
├── SHARED_KERNEL.md                 # Shared infrastructure spec
└── REQUEST_AND_EVENT_FLOWS.md       # Feature flow diagrams
```

---

## Contributing

When adding new features:

1. Identify which domain owns the feature
2. Check **[Domain Definitions](./DOMAIN_DEFINITIONS.md)** for domain boundaries
3. Add business logic to domain service
4. Publish domain events for cross-domain coordination
5. Update domain documentation
6. Run architecture tests to verify boundaries

---

## Questions?

- Check the **[FAQ](./DOMAIN_DEFINITIONS.md#faq)** (coming soon)
- Open an issue for architecture questions
- Review the **[Implementation Summary](./IMPLEMENTATION_SUMMARY.md)** for context

---

**Last Updated:** 2026-07-18  
**Status:** Phase 0 Complete  
**Next:** Shared Kernel Extraction
