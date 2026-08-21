# Learnault API Reference

> **Live spec:** `GET /api-docs` (Swagger UI) or `GET /api-docs/swagger.json`

## Overview

The Learnault API is a JSON REST API for a decentralized learn-to-earn platform on Stellar.

| Item | Value |
|------|-------|
| Base URL (production) | `https://api.learnault.io/api/v1` |
| Base URL (local) | `http://localhost:3000/api/v1` || Auth scheme | JWT Bearer (`Authorization: Bearer <token>`) |
| Refresh scheme | Opaque rotating refresh token (`refreshToken` body or `refresh_token` cookie) |
| Content-Type | `application/json` |

---

## Authentication

Obtain a JWT from `POST /auth/login`. Pass it on every protected request:

```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

JWT payload contains `{ id, email, role }`. Roles are `learner`, `employer`, `admin`.

---

## Standard Response Envelopes

### Success

Varies by endpoint — see individual routes. Most use one of:

```json
{ "message": "...", "data": { ... } }
```
```json
{ "success": true, "data": { ... } }
```

### Error (all 4xx / 5xx)

```json
{
  "success": false,
  "error": {
    "message": "Resource not found",
    "code": 404
  }
}
```

Validation errors from the `validate()` middleware:

```json
{
  "message": "Validation failed",
  "errors": {
    "body": ["Invalid email format"],
    "params": ["Invalid ID format"]
  }
}
```

---

## Rate Limiting

Every response includes:

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 97
X-RateLimit-Reset: 2026-07-19T10:15:00.000Z
```

When exceeded (HTTP 429):

```http
Retry-After: 60
```

| Limiter | Applies to | Default window | Default max |
|---------|-----------|----------------|-------------|
| `authLimiter` | `/auth/login`, `/auth/resend-verification`, `/auth/forgot-password` | 15 min | 10 |
| `otpLimiter` | `/auth/otp/request`, `/auth/otp/verify` | 15 min | 5 |
| `employerLimiter` | All `/employer/*` routes | 15 min | 500 |
| `authenticatedLimiter` | All `/sync/*` routes | 15 min | 1000 |
| `generalLimiter` | Everything else | 15 min | 100 |

All values are overridable via environment variables (`RATE_LIMIT_*_WINDOW_MS`, `RATE_LIMIT_*_MAX`).

---

## Health

### `GET /health`

No authentication. Returns immediately.

```json
{ "status": "ok", "timestamp": "2026-07-19T10:00:00.000Z" }
```

---

## Auth — `/auth`

All auth routes are public (no JWT required) unless noted.

### `POST /auth/register`

Register a new user. Queues a verification email.

**Request body**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `email` | string (email) | ✅ | |
| `password` | string | ✅ | min 8 chars |
| `username` | string | ✅ | min 3 chars |
| `role` | `"learner"` \| `"employer"` | ❌ | default `"learner"` |

**Responses**

| Status | Meaning |
|--------|---------|
| 201 | User created; JWT and user object returned |
| 400 | Validation failed |
| 409 | Email or username already taken |

```json
{
  "message": "User registered successfully",
  "accessToken": "<jwt>",
  "refreshToken": "<opaque-token>",
  "expiresIn": 900,
  "tokenType": "Bearer",
  "user": { "id": "...", "email": "...", "username": "...", "role": "learner" }
}
```

---

### `POST /auth/login`

Rate-limited (10 req / 15 min).

**Request body:** `{ "email": "...", "password": "..." }`

**Responses:** 200 (same shape as register), 400, 401 (invalid credentials)

---

### `POST /auth/refresh`

Rotates a refresh token for a new access/refresh pair. The presented token
is consumed; a replayed (already-rotated) token revokes the whole session
family and returns `401 REFRESH_REUSE_DETECTED`.

**Request body:** `{ "refreshToken": "<opaque-token>" }` — or send the token
via an httpOnly `refresh_token` cookie.

```json
{
  "message": "Token refreshed successfully",
  "accessToken": "<new-jwt>",
  "refreshToken": "<new-opaque-token>",
  "expiresIn": 900,
  "tokenType": "Bearer"
}
```

**Responses:** 200 (rotated), 400 (missing token), 401 (`REFRESH_INVALID`,
`REFRESH_EXPIRED`, `REFRESH_REVOKED`, or `REFRESH_REUSE_DETECTED`)

---

### `POST /auth/logout`

Logs out the current session by revoking its refresh-token family. Idempotent.

**Request body:** `{ "refreshToken": "<opaque-token>" }` — or via the
httpOnly `refresh_token` cookie.

**Response:** `200 { "message": "Logged out successfully", "revokedCount": 1 }`

---

### `POST /auth/logout/all`

Logs out every session for the user identified by the refresh token.
Idempotent.

**Request body:** `{ "refreshToken": "<opaque-token>" }` — or via the
httpOnly `refresh_token` cookie.

**Response:** `200 { "message": "All sessions logged out", "revokedCount": 3 }`

---

### `POST /auth/verify-email`

**Request body:** `{ "token": "<64-char hex string from email>" }`

| Status | Meaning |
|--------|---------|
| 200 | Verified (or already verified) |
| 400 | Invalid, expired, or revoked token |

---

### `POST /auth/resend-verification`

Rate-limited (10 req / 15 min). Always returns 200 to avoid leaking whether an account exists.

**Request body:** `{ "email": "..." }`

**Response:** `200 { "message": "If the account exists, a verification email has been sent." }`

---

### `POST /auth/forgot-password`

Rate-limited (10 req / 15 min). Token expires after 30 minutes. Always returns 200.

**Request body:** `{ "email": "..." }`

**Response:** `200 { "message": "If the account exists, a password reset email has been sent." }`

---

### `POST /auth/reset-password`

On success, all active sessions are revoked and all pending verification tokens are cancelled.

**Request body:** `{ "token": "<64-char hex>", "newPassword": "<min 8 chars>" }`

| Status | Meaning |
|--------|---------|
| 200 | Password reset |
| 400 | Invalid/expired token or weak password |

---

### `POST /auth/otp/request`

Requests a 6-digit SMS code. Behavior depends on whether a Bearer token is sent:

- **No token → `LOGIN`**: the phone must already be verified on an existing account. Always returns 200 with the same generic message, whether or not the phone is registered, to avoid leaking phone existence.
- **With token → `PHONE_VERIFICATION`**: attaches/verifies this phone number on the caller's own account.

Rate-limited by IP (`otpLimiter`), by phone (1/min cooldown, 5/hour), and — if `deviceId` is supplied — by device (10/hour). SMS is sent via a mocked provider (`SMS_PROVIDER=mock`) until a real carrier is integrated; see [`docs/decisions/0001-phone-otp-authentication.md`](decisions/0001-phone-otp-authentication.md).

**Request body**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `phone` | string | ✅ | E.164 format, e.g. `+2348012345678` |
| `deviceId` | string | ❌ | Used for device-level rate limiting |

**Responses**

| Status | Meaning |
|--------|---------|
| 200 | Code sent (or silently ignored for an unregistered/unverified `LOGIN` phone) |
| 400 | Validation failed or phone not in E.164 format |
| 409 | Phone already verified on a different account (`PHONE_VERIFICATION` only) |
| 429 | IP, phone, or device rate limit reached |

```json
{ "message": "If this phone number is registered, a verification code has been sent." }
```

---

### `POST /auth/otp/verify`

Verifies the code from `otp/request`. Codes are single-use, expire after 5 minutes, and the challenge locks after 5 wrong attempts (request a new code to retry).

- **No token → `LOGIN`**: on success, returns the same JWT/user shape as `POST /auth/login`, after the same account-status checks (deactivated/pending-deletion/deleted).
- **With token → `PHONE_VERIFICATION`**: on success, marks the phone verified on the caller's account.

**Request body:** `{ "phone": "+2348012345678", "code": "123456" }`

**Responses**

| Status | Meaning |
|--------|---------|
| 200 | Verified — login response or `{ "message": "Phone number verified successfully" }` |
| 400 | Invalid/expired code, or validation failed |
| 401 | Invalid credentials (tombstoned account; `LOGIN` only) |
| 403 | Account deactivated or pending deletion (`LOGIN` only) |
| 429 | Too many wrong attempts — challenge locked |

---

## Users — `/users`

### `GET /users/me` 🔒

Returns the authenticated user's full profile.

```json
{
  "id": "uuid", "email": "...", "username": "...",
  "firstName": null, "lastName": null,
  "bio": null, "avatar": null, "walletAddress": null,
  "isActive": true, "createdAt": "...", "updatedAt": "..."
}
```

---

### `PATCH /users/me` 🔒

Update profile fields. All fields optional.

**Request body** (any subset of):

| Field | Type | Constraints |
|-------|------|-------------|
| `username` | string | 3–30 chars, alphanumeric + underscore |
| `firstName` | string | max 50 |
| `lastName` | string | max 50 |
| `bio` | string | max 500 |
| `avatar` | string (URL) | |

**Response:** `200` full user object (same as `GET /users/me`)

---

### `GET /users/:id`

Public — no auth needed. Returns a reduced public profile.

```json
{ "id": "...", "username": "...", "firstName": null, "lastName": null, "avatar": null, "role": "learner", "createdAt": "..." }
```

---

### `PATCH /users/password` 🔒

> ⚠️ **Preview** — the service implementation is stubbed. Will return `500` until completed.

**Request body:** `{ "currentPassword": "...", "newPassword": "..." }`

Password rules: min 8 chars, must contain uppercase, lowercase, digit, and special character (`@$!%*?&`). Must differ from current.

---

### `PATCH /users/wallet` 🔒

> ⚠️ **Preview** — the wallet update may not persist to the database until the service layer is completed.

**Request body:** `{ "walletAddress": "G..." }`

Address must match `^G[A-Z0-9]{55}$`.

---

## Modules — `/modules`

### `GET /modules`

Optional auth — when a valid token is provided, each module includes `userProgress`.

**Query parameters**

| Param | Type | Default |
|-------|------|---------|
| `page` | integer | 1 |
| `limit` | integer | 10 |
| `category` | string | — |
| `difficulty` | string | — |
| `search` | string | — |

**Response `200`**

```json
{
  "modules": [
    {
      "id": "...", "title": "...", "description": "...",
      "category": "finance", "difficulty": "beginner",
      "reward": 0.25, "createdAt": "...", "updatedAt": "...",
      "completionCount": 120,
      "userProgress": null
    }
  ],
  "pagination": { "page": 1, "limit": 10, "total": 45, "totalPages": 5, "hasNext": true, "hasPrev": false }
}
```

---

### `GET /modules/:id`

Optional auth. Same `userProgress` inclusion behaviour.

**Response `200`:** single module object (same fields as list item).  
**404** if not found.

---

### `POST /modules/:id/start` 🔒

Creates a progress record. Must be called before `complete`.

**Response `201`:**
```json
{ "message": "Module started successfully", "completionId": "...", "startedAt": "..." }
```

**400** if already started or completed.

---

### `POST /modules/:id/complete` 🔒

Submit quiz answers. Module must have been started first.

A score ≥ 70% qualifies for the XLM reward and triggers a push notification.

**Request body:**
```json
{
  "quizAnswers": [
    { "questionId": "q1", "answer": "B" }
  ]
}
```

**Response `200`:**
```json
{
  "message": "Module completed successfully",
  "score": 80,
  "isEligibleForReward": true,
  "reward": 0.25,
  "rewardTransaction": "<uuid>",
  "completedAt": "..."
}
```

---

## Credentials — `/credentials`

### `GET /credentials` 🔒

**Query parameters**

| Param | Type | Notes |
|-------|------|-------|
| `moduleId` | UUID | filter |
| `fromDate` | ISO datetime | filter |
| `toDate` | ISO datetime | filter |
| `page` | integer | default 1 |
| `limit` | integer | default 10, max 100 |

**Response `200`:**
```json
{
  "success": true,
  "data": [ { "id": "...", "moduleId": "...", "moduleName": "...", "onChainId": null, "issuedAt": "...", "shareableLink": "..." } ],
  "meta": { "page": 1, "limit": 10, "total": 5, "totalPages": 1, "hasNextPage": false, "hasPrevPage": false }
}
```

---

### `GET /credentials/verify/:onChainId`

Public — no auth needed. Looks up by `onChainId` first, falls back to credential UUID.

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "valid": true,
    "credential": { "id": "...", "holderName": "...", "moduleName": "...", "onChainId": "...", "issuedAt": "..." },
    "verification": { "verifiedAt": "...", "status": "verified", "message": "This credential is valid and has been verified on-chain" }
  }
}
```

**404** if not found.

---

### `GET /credentials/:id` 🔒

Returns full credential detail. Returns `401` if the credential belongs to another user.

---

## Rewards — `/rewards` 🔒

All reward routes require authentication.

### `GET /rewards/balance`

```json
{
  "success": true,
  "data": {
    "balance": { "available": 10.5, "pending": 2.0, "lifetime": 25.0 },
    "updatedAt": "..."
  }
}
```

---

### `GET /rewards/history`

**Query parameters**

| Param | Values | Default |
|-------|--------|---------|
| `type` | `module_reward`, `streak_bonus`, `referral_reward`, `withdrawal` | — |
| `status` | `pending`, `completed`, `failed` | — |
| `fromDate` | ISO datetime | — |
| `toDate` | ISO datetime | — |
| `limit` | 1–100 | 20 |
| `offset` | ≥ 0 | 0 |

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "transactions": [ { "id": "...", "type": "module_reward", "status": "completed", "amount": 0.25, "moduleId": "...", "stellarTxHash": null, "createdAt": "...", "completedAt": "..." } ],
    "pagination": { "total": 15, "limit": 20, "offset": 0, "hasMore": false }
  }
}
```

---

### `POST /rewards/withdraw`

**Request body:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `walletAddress` | string | ✅ | Stellar address matching `^G[A-Z0-9]{50,55}$` |
| `amount` | number | ✅ | XLM, must be > 0 |
| `memo` | string | ❌ | |

**Response `201`:**
```json
{
  "success": true,
  "message": "Withdrawal processed successfully",
  "data": { "transactionId": "...", "amount": 5.0, "stellarTxHash": "...", "status": "completed", "requestedAt": "...", "completedAt": "..." }
}
```

**400** for invalid address, zero/negative amount, or insufficient balance.

---

## Referrals — `/referrals` 🔒

All referral routes require authentication.

### `POST /referrals/code`

Generate (or retrieve existing) referral code for the authenticated user.

- Returns `200` if the user already has a code.
- Returns `201` if a new 8-character hex code was created.

```json
{ "success": true, "message": "...", "data": { "code": "A1B2C3D4" } }
```

---

### `POST /referrals/apply`

Apply a referral code. Cannot apply your own code or apply more than once.

**Request body:** `{ "code": "A1B2C3D4" }`

| Status | Meaning |
|--------|---------|
| 201 | Referral applied |
| 400 | Missing code, self-referral, or code not found |
| 409 | Already used a referral code |

---

### `GET /referrals/stats`

```json
{
  "success": true,
  "data": {
    "totalReferrals": 3,
    "activeReferrals": 2,
    "earnedBonuses": 10.0,
    "pendingBonuses": 5.0
  }
}
```

`activeReferrals` = referrees who have completed at least one module.  
`pendingBonuses` = (total − paid) × 5 XLM per referral.

---

## Notifications — `/notifications` 🔒

All notification routes require authentication.

### `POST /notifications/devices`

Register a Firebase device token for push notifications.

**Request body:**

| Field | Type | Required |
|-------|------|----------|
| `token` | string | ✅ |
| `platform` | `"ios"` \| `"android"` \| `"web"` | ✅ |

**Response `201`:** device token record.

---

### `PATCH /notifications/preferences`

At least one field must be provided.

**Request body** (any subset of):

| Field | Type |
|-------|------|
| `rewardReceipt` | boolean |
| `quizPassFail` | boolean |
| `streakReminders` | boolean |

---

### `GET /notifications/delivery-status`

**Query parameters:** `limit` (default 20, max 100), `status` (`pending` \| `success` \| `failed` \| `dead-letter`).

```json
{
  "data": [ { "id": "...", "type": "quizPassFail", "title": "Quiz Passed!", "body": "...", "status": "success", "error": null, "attemptCount": 1, "createdAt": "..." } ],
  "count": 1
}
```

---

## Sync — `/sync` 🔒

All sync routes require authentication and are subject to the `authenticatedLimiter` (1000 req / 15 min).

### `POST /sync/progress`

Upload batched offline progress events. Each event is deduplicated by `idempotencyKey`. Events with a stale `syncVersion` are skipped without error.

**Request body:**
```json
{
  "events": [
    {
      "idempotencyKey": "device-abc-mod-xyz-1",
      "deviceId": "device-abc",
      "moduleId": "<uuid>",
      "progressPercent": 60,
      "clientTimestamp": "2026-07-19T09:00:00.000Z",
      "syncVersion": 3
    }
  ]
}
```

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "results": [
      { "idempotencyKey": "device-abc-mod-xyz-1", "status": "applied" }
    ]
  }
}
```

Each result has `status`: `applied` | `skipped` | `rejected`, plus an optional `reason`.

---

### `POST /sync/completions`

Reconcile offline quiz/completion attempts. If the user already has a completion with an equal or higher score, the event is skipped. A higher score updates the existing record.

**Request body:**
```json
{
  "events": [
    {
      "idempotencyKey": "device-abc-comp-xyz-1",
      "deviceId": "device-abc",
      "moduleId": "<uuid>",
      "score": 85,
      "clientTimestamp": "2026-07-19T09:05:00.000Z",
      "syncVersion": 1
    }
  ]
}
```

Response shape identical to `POST /sync/progress`.

---

## Employer — `/employer` 🔒 (employer role required)

All employer routes require authentication with `role: employer`. An `employerLimiter` (500 req / 15 min) is applied.

Plan tier is read from the `x-employer-plan` request header. Valid values: `starter` (default), `pro`, `enterprise`.

### `GET /employer/search`

Search the learner talent pool.

**Query parameters**

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `page` | integer | 1 | |
| `limit` | integer | 20 | Capped by plan: starter ≤ 10, pro ≤ 50, enterprise ≤ 100 |
| `skills` | string | — | Comma-separated keywords, e.g. `finance,defi` |
| `location` | string | — | |
| `credentials` | `any` \| `verified` \| `none` | `any` | |
| `search` | string | — | Free-text search on username/email |

**Request header:** `x-employer-plan: starter | pro | enterprise`

**Response `200`:**
```json
{
  "candidates": [
    {
      "id": "...", "name": "alice42", "location": "lagos",
      "skills": ["finance", "defi"],
      "completions": 5, "averageScore": 82.4,
      "verifiedCredentialCount": 2
    }
  ],
  "pagination": { "page": 1, "limit": 10, "total": 3, "totalPages": 1, "hasNext": false, "hasPrev": false },
  "filters": { "skills": ["finance"], "location": null, "credentials": "any" },
  "plan": "starter"
}
```

**400** if `limit` exceeds plan maximum.

---

### `GET /employer/candidates/:id`

Full candidate profile with all verified credentials.

**403** if candidate profile is private or caller is not an employer.  
**404** if candidate not found or has no module completions.

---

### `POST /employer/contact`

Record a candidate outreach attempt. Requires **pro** or **enterprise** plan — **starter returns HTTP 402**.

**Request header:** `x-employer-plan: pro` (or `enterprise`)

**Request body:**

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `candidateId` | UUID | ✅ | |
| `subject` | string | ✅ | 3–120 chars |
| `message` | string | ✅ | 10–3000 chars |
| `channel` | `"platform"` \| `"email"` \| `"both"` | ❌ | default `"platform"` |

**Response `201`:**
```json
{
  "message": "Candidate outreach recorded",
  "outreach": { "id": "...", "candidateId": "...", "channel": "platform", "status": "recorded", "createdAt": "..." }
}
```

---

## Unimplemented / Stubbed Routes

The following routes are wired but not fully implemented:

| Route | Status |
|-------|--------|
| `PATCH /users/password` | Service method throws "Not implemented" — returns 500 |
| `PATCH /users/wallet` | Service method uses mock data — changes do not persist |

These are marked as **Preview** in the OpenAPI spec (`/api-docs`).

---

## Error Code Reference

| HTTP | Typical cause |
|------|--------------|
| 400 | Validation failed, malformed body, business rule violation |
| 401 | Missing, expired, or invalid JWT |
| 402 | Employer plan upgrade required |
| 403 | Authenticated but insufficient role or resource is private |
| 404 | Resource not found |
| 409 | Conflict (duplicate email, already applied referral, etc.) |
| 429 | Rate limit exceeded — see `Retry-After` header |
| 500 | Internal server error (includes not-yet-implemented stubs) |
