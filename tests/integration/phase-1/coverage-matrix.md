# Phase 1 Integration Test Coverage Matrix

This document maps every Phase 1 acceptance criterion from the roadmap to specific test cases.

## Legend
- ✅ Fully covered with passing tests
- 🔶 Partially covered or stub implementation
- ❌ Not yet implemented
- 🧪 Requires manual/smoke testing

---

## 1. Authentication & Session Models

### Registration & Login
| Requirement | Test File | Test Case | Status |
|------------|-----------|-----------|--------|
| Email/password registration | `auth/register.test.ts` | "should register a new learner successfully" | ✅ |
| Password hashing | `auth/register.test.ts` | "should hash password before storing" | ✅ |
| Duplicate email rejection | `auth/register.test.ts` | "should return 409 for duplicate email" | ✅ |
| Duplicate username rejection | `auth/register.test.ts` | "should return 409 for duplicate username" | ✅ |
| Email/password login | `auth/login.test.ts` | "should login successfully with valid credentials" | ✅ |
| Invalid credentials handling | `auth/login.test.ts` | "should return 401 for invalid password" | ✅ |
| JWT token issuance | `auth/login.test.ts` | "should return JWT token with correct payload" | ✅ |
| LastLoginAt tracking | `auth/login.test.ts` | "should login successfully..." (implicit) | ✅ |

### Email Verification
| Requirement | Test File | Test Case | Status |
|------------|-----------|-----------|--------|
| Email verification token creation | `auth/register.test.ts` | "should register..." (implicit) | ✅ |
| Email verification endpoint | `auth/verification.test.ts` | "should verify email with valid token" | ✅ |
| Token expiry handling | `auth/verification.test.ts` | "should return 400 for expired token" | ✅ |
| Token revocation | `auth/verification.test.ts` | "should prevent token reuse" | ✅ |
| Resend verification | `auth/verification.test.ts` | "should resend verification email..." | ✅ |
| No information disclosure | `auth/verification.test.ts` | "should return 200 for non-existent email" | ✅ |

### Phone/OTP Authentication
| Requirement | Test File | Test Case | Status |
|------------|-----------|-----------|--------|
| OTP request for login | `auth/otp.test.ts` | "should send OTP for registered phone..." | ✅ |
| OTP request for verification | `auth/otp.test.ts` | "should send OTP when authenticated..." | ✅ |
| OTP code generation | `auth/otp.test.ts` | Covered in request tests | ✅ |
| OTP verification | `auth/otp.test.ts` | "should login successfully with valid OTP" | ✅ |
| OTP expiry (5 min) | `auth/otp.test.ts` | "should expire OTP after 5 minutes" | ✅ |
| OTP attempt limiting | `auth/otp.test.ts` | "should lock challenge after 5 failed..." | ✅ |
| Phone rate limiting | `auth/otp.test.ts` | "should enforce rate limiting per phone..." | ✅ |
| E.164 format validation | `auth/otp.test.ts` | "should return 400 for invalid phone..." | ✅ |
| SMS provider abstraction | Mock provider | SMS sent via `MockSmsProvider` | ✅ |
| Duplicate phone prevention | `auth/otp.test.ts` | "should return 409 if phone already..." | ✅ |

### Password Recovery
| Requirement | Test File | Test Case | Status |
|------------|-----------|-----------|--------|
| Forgot password request | `auth/password-recovery.test.ts` | "should send password reset email" | 🔶 |
| Reset password with token | `auth/password-recovery.test.ts` | "should reset password with valid token" | 🔶 |
| Token expiry (30 min) | `auth/password-recovery.test.ts` | "should reject expired reset token" | 🔶 |
| Session revocation on reset | `auth/password-recovery.test.ts` | "should revoke all sessions on reset" | 🔶 |
| Password policy enforcement | `auth/password-recovery.test.ts` | "should enforce password complexity" | 🔶 |

### Sessions & Token Management
| Requirement | Test File | Test Case | Status |
|------------|-----------|-----------|--------|
| Refresh token rotation | `auth/sessions.test.ts` | "should refresh token with valid refresh..." | 🔶 |
| Logout single session | `auth/sessions.test.ts` | "should logout and revoke current session" | 🔶 |
| Logout all sessions | `auth/sessions.test.ts` | "should logout all user sessions" | 🔶 |
| Session listing | `auth/sessions.test.ts` | "should list all active sessions" | 🔶 |
| Session revocation | `auth/sessions.test.ts` | "should revoke specific session" | 🔶 |
| Device tracking | Factories | Session factory tracks device info | ✅ |

---

## 2. Learner Account & Profile

### Profile Management
| Requirement | Test File | Test Case | Status |
|------------|-----------|-----------|--------|
| Get current user profile | `profile/profile-crud.test.ts` | "should return authenticated user profile" | 🔶 |
| Update profile fields | `profile/profile-crud.test.ts` | "should update profile successfully" | 🔶 |
| Public profile view | `profile/profile-crud.test.ts` | "should return public profile for any user" | 🔶 |
| Profile validation | `profile/profile-crud.test.ts` | "should validate profile field constraints" | 🔶 |
| Avatar upload | `profile/avatar.test.ts` | Stubbed - not yet implemented | ❌ |

### Preferences
| Requirement | Test File | Test Case | Status |
|------------|-----------|-----------|--------|
| Get preferences | `profile/preferences.test.ts` | "should return learner preferences" | 🔶 |
| Update preferences | `profile/preferences.test.ts` | "should update preferences partially" | 🔶 |
| Preference defaults | `profile/preferences.test.ts` | "should create preferences with defaults" | 🔶 |
| Privacy preference auditing | `profile/preferences.test.ts` | "should audit privacy-impacting changes" | 🔶 |
| Locale/timezone | `profile/preferences.test.ts` | Covered in update tests | 🔶 |
| Accessibility options | `profile/preferences.test.ts` | Covered in update tests | 🔶 |

### Onboarding & Consent
| Requirement | Test File | Test Case | Status |
|------------|-----------|-----------|--------|
| Onboarding state tracking | `profile/onboarding.test.ts` | Not yet implemented | ❌ |
| Terms/privacy consent | `profile/onboarding.test.ts` | Not yet implemented | ❌ |
| Analytics consent | `profile/onboarding.test.ts` | Not yet implemented | ❌ |
| Consent versioning | `profile/onboarding.test.ts` | Not yet implemented | ❌ |

---

## 3. Account Lifecycle

### Deactivation
| Requirement | Test File | Test Case | Status |
|------------|-----------|-----------|--------|
| Account deactivation | `account-lifecycle/deactivation.test.ts` | "should deactivate account successfully" | 🔶 |
| Session revocation on deactivate | `account-lifecycle/deactivation.test.ts` | "should revoke all sessions" | 🔶 |
| Reactivation | `account-lifecycle/deactivation.test.ts` | "should reactivate account" | 🔶 |
| Login blocked while deactivated | `auth/login.test.ts` | "should return 403 for deactivated..." | ✅ |

### Deletion
| Requirement | Test File | Test Case | Status |
|------------|-----------|-----------|--------|
| Deletion request | `account-lifecycle/deletion.test.ts` | "should create deletion request..." | ✅ |
| Cooling-off period (7 days) | `account-lifecycle/deletion.test.ts` | "should schedule deletion based on..." | ✅ |
| Cancel deletion | `account-lifecycle/deletion.test.ts` | "should cancel pending deletion..." | ✅ |
| Deletion status check | `account-lifecycle/deletion.test.ts` | "should return deletion request status" | ✅ |
| Finalization sweep | `account-lifecycle/deletion.test.ts` | "should finalize deletion after..." | ✅ |
| PII hard delete | `account-lifecycle/deletion.test.ts` | "should finalize deletion..." (implicit) | ✅ |
| Financial record retention | `account-lifecycle/deletion.test.ts` | "should retain financial records..." | ✅ |
| User tombstoning | `account-lifecycle/deletion.test.ts` | "should finalize deletion..." (implicit) | ✅ |
| Audit log redaction | `account-lifecycle/deletion.test.ts` | "should finalize deletion..." (implicit) | ✅ |
| Retry logic | `account-lifecycle/deletion.test.ts` | "should retry failed deletion..." | ✅ |

### Data Export
| Requirement | Test File | Test Case | Status |
|------------|-----------|-----------|--------|
| Request data export | `account-lifecycle/data-export.test.ts` | "should create export request" | 🔶 |
| Export generation | `account-lifecycle/data-export.test.ts` | "should generate complete export" | 🔶 |
| Export download | `account-lifecycle/data-export.test.ts` | "should download export artifact" | 🔶 |
| Export expiry | `account-lifecycle/data-export.test.ts` | "should expire old exports" | 🔶 |
| Export purge | `account-lifecycle/data-export.test.ts` | "should purge expired artifacts" | 🔶 |

---

## 4. Wallet Provisioning

| Requirement | Test File | Test Case | Status |
|------------|-----------|-----------|--------|
| Wallet consent | `wallet/provisioning.test.ts` | Not yet implemented | ❌ |
| Keypair generation | `wallet/provisioning.test.ts` | Not yet implemented | ❌ |
| KMS encryption | `wallet/provisioning.test.ts` | Not yet implemented | ❌ |
| Account funding | `wallet/provisioning.test.ts` | Not yet implemented | ❌ |
| Concurrent provisioning | `wallet/concurrent-provisioning.test.ts` | Not yet implemented | ❌ |
| KMS failure handling | `wallet/kms-failure.test.ts` | Not yet implemented | ❌ |
| Funding retry logic | `wallet/kms-failure.test.ts` | Not yet implemented | ❌ |
| Balance endpoint | `wallet/balance.test.ts` | Not yet implemented | ❌ |
| Transaction history | `wallet/balance.test.ts` | Not yet implemented | ❌ |
| Self-custody export | `wallet/export-authorization.test.ts` | Not yet implemented | ❌ |

---

## 5. Audit & Cross-Cutting Concerns

### Audit Logging
| Requirement | Test File | Test Case | Status |
|------------|-----------|-----------|--------|
| Registration audit | `auth/register.test.ts` | Verified with assertAuditLog | ✅ |
| Login audit | `auth/login.test.ts` | Verified with assertAuditLog | ✅ |
| Email verification audit | `auth/verification.test.ts` | Verified with assertAuditLog | ✅ |
| Password reset audit | `auth/password-recovery.test.ts` | Not yet verified | 🔶 |
| Deactivation audit | `account-lifecycle/deactivation.test.ts` | Not yet verified | 🔶 |
| Deletion audit | `account-lifecycle/deletion.test.ts` | Verified with assertAuditLog | ✅ |
| PII redaction | `audit/redaction.test.ts` | Covered in deletion tests | ✅ |

### Idempotency
| Requirement | Test File | Test Case | Status |
|------------|-----------|-----------|--------|
| Duplicate registration | `auth/register.test.ts` | "should return 409 for duplicate email" | ✅ |
| Duplicate deletion request | `account-lifecycle/deletion.test.ts` | "should return 409 for duplicate..." | ✅ |
| Token reuse prevention | `auth/verification.test.ts` | "should prevent token reuse" | ✅ |
| OTP reuse prevention | `auth/otp.test.ts` | "should prevent reuse of consumed OTP" | ✅ |
| Idempotency keys | `audit/idempotency.test.ts` | Generic idempotency testing | 🔶 |

### Rate Limiting
| Requirement | Test File | Test Case | Status |
|------------|-----------|-----------|--------|
| Login rate limiting | `auth/login.test.ts` | "should enforce rate limiting..." | ✅ |
| OTP rate limiting | `auth/otp.test.ts` | "should enforce rate limiting..." | ✅ |
| Verification resend limiting | `auth/verification.test.ts` | "should enforce rate limiting" | ✅ |

---

## Summary Statistics

- **Total Requirements**: ~85
- **Fully Covered (✅)**: ~45 (53%)
- **Partially Covered (🔶)**: ~25 (29%)
- **Not Implemented (❌)**: ~15 (18%)
- **Manual Testing (🧪)**: 0

## Critical Gaps

1. **Session Management**: Refresh token rotation, session listing/revocation
2. **Password Recovery**: Complete password reset flow
3. **Wallet Provisioning**: Entire wallet lifecycle (consent → generation → funding)
4. **Onboarding**: Consent tracking and onboarding state
5. **Avatar Upload**: File upload and processing flow

## Next Steps

1. Implement remaining auth endpoints (sessions, password recovery)
2. Complete wallet provisioning tests (requires wallet models)
3. Add onboarding/consent tracking tests
4. Verify all tests pass in CI environment
5. Add smoke tests against testnet for wallet funding
