# 0001 — Phone OTP Authentication Scope

- **Status:** Accepted
- **Date:** 2026-07-20
- **Roadmap item:** Phase 1 / Authentication and session models — "Add phone/OTP challenge and verification models/endpoints only if retained in launch scope, with provider mocks and abuse limits." (`ROADMAP.md`)

## Context

Before this decision, no phone OTP code existed in the repository: no route, controller, schema, Prisma model, or SMS service, and the `feat/phone-otp` branch had zero commits. The roadmap explicitly left the feature conditional pending a scope call. Two items were listed as dependencies:

- **Auth token / session persistence models** — not built as a discrete feature. `Session` exists in `prisma/schema.prisma` but login never writes to it (stateless JWT only); there is no `LoginAttempt` model.
- **Transaction outbox / job delivery foundation** — not built as a generic abstraction. Five domains (`EmailDelivery`, `NotificationLog`, `WebhookDelivery`, `StellarFunding`, `DataExportRequest`) each independently duplicate the same `status/attemptCount/maxAttempts/nextAttemptAt` retry shape.

## Decision

**Retain phone OTP in launch scope**, implemented as:

1. A **login/verification mechanism keyed by phone number**, not a replacement for email/password. Two use cases share one pair of endpoints, disambiguated by whether the caller is authenticated:
   - **Authenticated caller** → `PHONE_VERIFICATION`: attach and verify a phone number on the caller's own account.
   - **Unauthenticated caller** → `LOGIN`: sign in with a phone number that has already been verified on some account, receiving the same JWT shape as `POST /auth/login`.
2. A **provider-abstracted SMS interface** (`SmsProvider`) with a `MockSmsProvider` as the only implementation. Sending is synchronous request/response (not an outbox job) because an OTP is only useful within its short expiry window — unlike email, there is no value in a multi-hour retry-with-backoff; a failed send just fails the request. `SMS_PROVIDER=mock` is the only supported value until a real provider (Twilio, Termii, Africa's Talking, etc.) is integrated; the factory throws on any other value instead of silently falling back.
3. A **hashed, expiring, attempt-limited challenge** (`OtpChallenge`) rather than reusing `VerificationToken`, because OTP needs numeric-code semantics (fixed length, attempt counter, phone-scoped lookup) that don't fit the existing token-link model.
4. **Phone + IP + device rate limits**, layered the same way the existing `forgotPassword`/`resendVerification` flows already do (IP via a route-level limiter, phone/device via in-memory windowed counters in the controller) — see "Dependency handling" below for why this is an acceptable substitute for a persisted device/session model.

### Why not exclude it

Phone-first login materially matters for Learnault's stated target market (low-connectivity, mobile-money-first regions per `ROADMAP.md` Phase 5), and product has not said otherwise. The blocking dependencies turned out to be softer than the roadmap phrasing implies — see below — so there is no technical reason to defer the whole feature.

### Threat model and mitigations

| Threat                                                                   | Mitigation                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SMS interception / SIM swap                                              | OTP is a convenience login path, not a step-up for high-value actions (wallet export, payouts are out of scope for this change); code expires in 5 minutes and is single-use.                                                                                       |
| Brute-force code guessing                                                | Codes are 6-digit (1,000,000 space), hashed (`sha256(phone:code)`, phone-peppered so a leaked hash table can't be replayed against another number), and the challenge locks after 5 wrong attempts, forcing a fresh request.                                        |
| Phone number enumeration via `LOGIN`                                     | Unauthenticated `otp/request` always returns the same generic 200 body regardless of whether the phone is registered/verified — mirrors the existing `forgotPassword` anti-enumeration pattern. No challenge row or SMS is created for unknown/unverified phones.   |
| Request flooding to exhaust SMS budget                                   | Three independent limits: per-IP (route middleware), per-phone (cooldown + hourly cap), per-device where a `deviceId` is supplied. A new request always revokes prior pending challenges for that user+purpose, so only one challenge can be outstanding at a time. |
| Phone takeover (attacker verifies a phone another user already verified) | `PHONE_VERIFICATION` checks for an existing _verified_ owner of the normalized number before creating a challenge and rejects with 409.                                                                                                                             |

### Cost rationale

SMS is the only paid-per-message channel in this API (email/push are effectively free at this scale). The combination of a 60-second phone cooldown, a 5-request/hour phone cap, single-outstanding-challenge-per-user, and IP-level limiting bounds worst-case spend per abusive actor to a small, fixed number of messages per hour regardless of how many times they hit the endpoint. `MockSmsProvider` is the default in every environment until a paid provider is deliberately wired in, so no cost is incurred by running the test suite, CI, or a fresh local checkout.

### Dependency handling

Rather than block on building the two prerequisite foundations first, this change accepts the codebase's existing informal patterns and does not attempt to generalize them:

- **Session persistence**: OTP login issues a stateless JWT via the same `generateToken` path `login()` already uses. It does not write to `Session`, because `login()` doesn't either — this stays consistent with current behavior rather than making OTP the first endpoint to diverge. Revisiting this is tracked by the roadmap's existing `RefreshSession`/`LoginAttempt` item, independent of OTP.
- **Outbox/job delivery**: OTP sends are synchronous, not queued, for the reason in point 2 above — there is nothing to generalize into a shared outbox here, since the durable-retry shape used by `EmailDelivery` etc. doesn't fit a 5-minute-lived code.

### Known limitation

Device-level rate limiting depends on the caller supplying an optional `deviceId` in the request body; there is no persisted device/session identity to fall back on, so a caller that omits it is only bounded by phone- and IP-level limits. This is acceptable for launch and should be revisited once a real device/session model exists.

## Verification evidence

Redacted request/response pairs (mock SMS provider, local dev server):

```sh
$ curl -s -X POST http://localhost:3000/api/v1/auth/otp/request \
    -H 'Content-Type: application/json' \
    -d '{"phone":"+2348012XXXXXX"}'
{"message":"If this phone number is registered, a verification code has been sent."}

$ curl -s -X POST http://localhost:3000/api/v1/auth/otp/verify \
    -H 'Content-Type: application/json' \
    -d '{"phone":"+2348012XXXXXX","code":"XXXXXX"}'
{"message":"Login successful","token":"<redacted-jwt>","user":{"id":"<redacted>","email":"...","username":"...","role":"learner"}}

# Authenticated phone-verification variant
$ curl -s -X POST http://localhost:3000/api/v1/auth/otp/request \
    -H 'Authorization: Bearer <redacted-jwt>' \
    -H 'Content-Type: application/json' \
    -d '{"phone":"+2348099XXXXXX"}'
{"message":"Verification code sent."}
```

Expiry, attempt-limit/lockout, consumption, and rate-limit behavior are covered by automated tests rather than manual timing:

- `tests/otp.service.test.ts` — hashed-challenge lifecycle: expiry (`marks the challenge expired and returns expired`), attempt increment/lockout (`increments attempts on a wrong code...`, `locks out on the attempt that reaches maxAttempts`), and single-use consumption (`consumes the challenge and returns ok on a correct code`).
- `tests/auth.controller.test.ts` (`requestOtp`/`verifyOtp` blocks) — anti-enumeration on `LOGIN`, phone conflict on `PHONE_VERIFICATION`, 429 on phone/device rate-limit exhaustion, and 429 propagation when a challenge is locked.

## Consequences

- `User` gains `phone` (unique, nullable) and `phoneVerifiedAt` fields.
- New `OtpChallenge` model and migration.
- New `POST /auth/otp/request` and `POST /auth/otp/verify` endpoints, documented in the OpenAPI spec and `docs/API.md`.
- `ROADMAP.md` line item is updated from conditional to resolved.
