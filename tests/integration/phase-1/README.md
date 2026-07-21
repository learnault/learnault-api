# Phase 1 Integration Test Suite

## Overview

This test suite provides **deterministic end-to-end coverage** for all Phase 1 account, profile, onboarding, session, and wallet behavior as defined in the API Roadmap.

## Test Organization

```
phase-1/
├── README.md                           # This file
├── factories/                          # Test data factories
│   ├── user.factory.ts                 # User creation helpers
│   ├── session.factory.ts              # Session/token helpers
│   └── wallet.factory.ts               # Wallet provisioning helpers
├── helpers/                            # Test utilities
│   ├── api-client.ts                   # Authenticated API client
│   ├── database.ts                     # DB lifecycle & cleanup
│   └── assertions.ts                   # Custom test assertions
├── auth/                               # Authentication & session tests
│   ├── register.test.ts                # Registration flows
│   ├── login.test.ts                   # Login (email & phone/OTP)
│   ├── verification.test.ts            # Email & phone verification
│   ├── password-recovery.test.ts       # Forgot/reset password
│   ├── sessions.test.ts                # Token refresh, logout, revocation
│   └── otp.test.ts                     # OTP challenge edge cases
├── profile/                            # Learner profile tests
│   ├── profile-crud.test.ts            # Read & update profile
│   ├── preferences.test.ts             # Preferences management
│   ├── onboarding.test.ts              # Onboarding state & consent
│   └── avatar.test.ts                  # Avatar upload (stubbed)
├── account-lifecycle/                  # Account status transitions
│   ├── deactivation.test.ts            # Deactivate & reactivate
│   ├── deletion.test.ts                # Deletion request, cancel, finalization
│   └── data-export.test.ts             # Data export workflows
├── wallet/                             # Wallet provisioning tests
│   ├── provisioning.test.ts            # Create wallet after consent
│   ├── concurrent-provisioning.test.ts # Race conditions
│   ├── kms-failure.test.ts             # KMS/funding failure paths
│   ├── balance.test.ts                 # Balance & history endpoints
│   └── export-authorization.test.ts    # Self-custody export
├── audit/                              # Cross-cutting concerns
│   ├── audit-logs.test.ts              # Audit trail verification
│   ├── idempotency.test.ts             # Idempotency key behavior
│   └── redaction.test.ts               # PII redaction on deletion
└── coverage-matrix.md                  # Requirement → test mapping
```

## Design Principles

### Deterministic & Isolated
- Each test creates its own user(s) with unique identifiers
- Database state is cleaned up after each test file
- No shared state between test cases
- Time-based behavior uses controlled clock manipulation where needed

### Secret-Free
- No real API keys, KMS credentials, or blockchain secrets
- Uses fake providers (mock SMS, mock KMS, testnet Horizon)
- Sensitive values never logged or committed

### Fast & Reliable
- Tests run against an isolated PostgreSQL database
- No external API dependencies (fakes for email, SMS, KMS)
- Tagged testnet smoke tests are separate from main suite

## Fake Providers

All external dependencies are mocked with deterministic behavior:

- **Email**: Captured in `EmailDelivery` table, no actual SMTP
- **SMS**: `MockSmsProvider` always succeeds, logs to database
- **KMS**: Returns predictable test keypairs, never hits real HSM
- **Horizon**: Uses Stellar testnet for smoke tests only
- **Storage**: In-memory or local file system for avatar uploads

## Running Tests

```bash
# Run all Phase 1 integration tests
pnpm test tests/integration/phase-1

# Run specific test file
pnpm test tests/integration/phase-1/auth/register.test.ts

# Run with coverage
pnpm test:coverage tests/integration/phase-1

# Watch mode for development
pnpm test:watch tests/integration/phase-1
```

## Coverage Matrix

See [coverage-matrix.md](./coverage-matrix.md) for the complete mapping of Phase 1 acceptance criteria to test cases.

## Acceptance Criteria

✅ Every Phase 1 criterion maps to at least one test  
✅ Critical auth/retry/failure paths are exercised  
✅ Tests are deterministic, isolated, and secret-free  
✅ Coverage matrix has no unexplained gaps  
✅ All tests pass in CI environment
