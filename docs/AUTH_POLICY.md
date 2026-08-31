# Authentication & Account Security Policy

Reference implementation for **API Roadmap Phase 1: Harden Authentication
and Account Security Policy**. This is the policy matrix requested as
verification evidence for that issue.

## 1. Account status vs. access

| Status             |    Login (`/auth/login`, `/auth/otp/verify`)    | Authenticated routes (`authenticate` + `authorize`) |   `requireActiveAccount` routes   |
| ------------------ | :---------------------------------------------: | :-------------------------------------------------: | :-------------------------------: |
| `ACTIVE`           |                       ✅                        |                         ✅                          |                ✅                 |
| `DEACTIVATED`      |          ❌ 403 `ACCOUNT_DEACTIVATED`           |            ❌ 403 `ACCOUNT_DEACTIVATED`             |   ❌ 403 `ACCOUNT_DEACTIVATED`    |
| `PENDING_DELETION` |        ❌ 403 `ACCOUNT_PENDING_DELETION`        |          ❌ 403 `ACCOUNT_PENDING_DELETION`          | ❌ 403 `ACCOUNT_PENDING_DELETION` |
| `DELETED`          | ❌ 401 (indistinguishable from bad credentials) |             ❌ 401 `Account not found`              |    ❌ 401 `Account not found`     |

Status is always re-read from the database at request time — a JWT issued
before a status change stays _cryptographically_ valid until it expires,
but no longer grants access once the account is no longer `ACTIVE`.

`authorize(...roles)` and `requireActiveAccount` both enforce this table;
`authorize` additionally re-checks the caller's **role** against the
database rather than trusting the JWT's `role` claim, so a role change
(or a status change) takes effect on the very next request instead of
waiting for the old token to expire.

## 2. Operations requiring a verified email

| Operation                                    |       Verified email required?        |
| -------------------------------------------- | :-----------------------------------: |
| Register / log in                            | No — verification happens post-signup |
| Browse modules, view own profile/credentials |                  No                   |
| `POST /rewards/withdraw` (moves funds out)   |   **Yes** — `requireVerifiedEmail`    |
| `/employer/*` (accesses candidate PII)       |   **Yes** — `requireVerifiedEmail`    |

Rationale: verification is not required to _use_ the platform, only for
operations that move value out of it or expose other users' data to an
unverified identity. `requireVerifiedEmail` (in `auth.middleware.ts`) is
the single enforcement point; extending coverage to another route means
adding it to that route's middleware chain, not duplicating the check.

## 3. Password / hashing policy

- Strength (enforced in `auth.schema.ts` via `isStrongPassword`): 8+
  characters, at least one uppercase, one lowercase, one number, one
  symbol.
- Hashing: bcrypt via `utils/password.ts`, cost factor from
  `BCRYPT_SALT_ROUNDS` (default 12, valid range 10-15).
- Upgradable cost: `needsRehash()` compares a stored hash's embedded cost
  against the current configured cost. On successful login, a
  below-current-cost hash is transparently re-hashed and persisted — no
  forced reset, no user-visible change.
- No PIN concept exists in this codebase yet (no wallet-PIN feature is
  implemented); this policy applies to the password field only.

## 4. JWT policy

- Algorithm is pinned to `HS256`; tokens are rejected if the header claims
  anything else (`config/jwt.ts`, `verifyAccessToken`).
- Every token carries and every verification checks `iss` (`JWT_ISSUER`)
  and `aud` (`JWT_AUDIENCE`).
- Every token is signed with an explicit `kid` header (`JWT_KEY_ID`).
  Verification reads the `kid` and resolves the matching secret — the
  active one, or one listed in `JWT_PREVIOUS_KEYS` — so a key can be
  rotated by introducing a new `JWT_KEY_ID`/`JWT_SECRET` pair and moving
  the old pair into `JWT_PREVIOUS_KEYS` until its tokens expire.
- `JWT_SECRET` has **no fallback** outside `NODE_ENV=test`; the process
  throws on boot instead of signing with a guessable default.

## 5. Rate limits (`rate-limit.middleware.ts`, `env.ts`)

| Limiter                | Applies to                                                                                                    | Default                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `authLimiter`          | `/auth/register`, `/auth/login`, `/auth/resend-verification`, `/auth/forgot-password`, `/auth/reset-password` | 10 / 15 min / IP                 |
| `otpLimiter`           | `/auth/otp/request`, `/auth/otp/verify`                                                                       | 5 / 15 min / IP                  |
| Per-account OTP limits | `otp.service.ts` + `auth.controller.ts` (phone + device scoped)                                               | 5/hr per phone, 10/hr per device |
| `employerLimiter`      | `/employer/*`                                                                                                 | 500 / 15 min / IP                |
| `authenticatedLimiter` | authenticated, non-employer traffic                                                                           | 1000 / 15 min / IP               |
| `generalLimiter`       | everything else                                                                                               | 100 / 15 min / IP                |

All limiters set `X-RateLimit-Limit`, `X-RateLimit-Remaining`,
`X-RateLimit-Reset`, and — on a 429 — `Retry-After`, so clients get stable
retry information rather than a bare error.

## 6. Refresh token rotation & transport

Access tokens are short-lived (default 15 minutes); refresh tokens are
opaque and rotated on every use. The full design — family linkage, reuse
detection, logout, transport, and the CSRF policy — is documented in
[`docs/security/refresh-token-rotation.md`](security/refresh-token-rotation.md).

| Token                  | Transport                                                    | Lifetime                              | Storage                                        |
| ---------------------- | ------------------------------------------------------------ | ------------------------------------- | ---------------------------------------------- |
| Access token (JWT)     | `Authorization: Bearer <token>` header                       | 15 min (`JWT_ACCESS_TTL_SECONDS`)     | client memory only                             |
| Refresh token (opaque) | JSON body `refreshToken`, or httpOnly `refresh_token` cookie | 30 days (`REFRESH_TOKEN_TTL_SECONDS`) | SHA-256 hash only (`refresh_tokens.tokenHash`) |

- Refresh tokens are single-use: each successful `POST /auth/refresh`
  consumes the presented token and returns a new one in the same family.
- Presenting an already-consumed (ROTATED) token is treated as theft and
  revokes the entire family plus its parent session (reuse detection).
- `POST /auth/logout` revokes the current session; `POST /auth/logout/all`
  revokes every session for the identified user.

## 7. Explicitly out of scope here

- **PIN policy** — no PIN feature exists in the codebase.
- `user.controller.ts#changePassword` — its `validatePassword` /
  `updateUserPassword` helpers are pre-existing stubs (`mockUser`, `throw
new Error('Not implemented')`) unrelated to this change; it isn't wired
  to Prisma yet, so there's nothing here to harden without building that
  feature from scratch.
