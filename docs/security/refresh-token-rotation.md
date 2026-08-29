# Refresh Token Rotation, Transport & CSRF Policy

Reference implementation for **API Roadmap Phase 1: Implement Refresh
Rotation and Logout API** (#130). This replaces the old stateless logout with
stateful, rotating refresh sessions.

## 1. Token model

| Token | Type | Lifetime | Issued at | Sent back |
| --- | --- | --- | --- | --- |
| Access token | JWT (HS256, `kid`-pinned) | 15 min (`JWT_ACCESS_TTL_SECONDS`) | login, register, OTP-login, refresh | `Authorization: Bearer <token>` |
| Refresh token | opaque, 64-char base64url, 256-bit | 30 days (`REFRESH_TOKEN_TTL_SECONDS`) | login, register, OTP-login, refresh | JSON body `refreshToken` or `refresh_token` cookie |

The raw refresh token is **never persisted**. Only its SHA-256 hash is stored
in `refresh_tokens.tokenHash` (a unique index). This means a database leak
does not expose usable refresh tokens.

## 2. Rotation & family linkage

Every login/register/OTP-login creates a `Session` and a new **rotation
family** (a `familyId` plus the session's first `RefreshToken` row).

A successful `POST /auth/refresh` runs atomically:

1. Hash the presented refresh token and look it up.
2. Reject unless the row is `ACTIVE`, unexpired, and its session is
   unrevoked and unexpired.
3. Claim the token with a conditional update (`ACTIVE` → `ROTATED`); if
   `count === 0`, another request already consumed it — treat as reuse.
4. Mint a new `RefreshToken` in the **same family** (`ACTIVE`, new expiry),
   and advance the session's access token and `lastUsedAt` in one
   transaction.

The family is the set of rows sharing a `familyId`: one `ROTATED` (consumed)
token per rotation plus the single current `ACTIVE` token.

## 3. Reuse (replay) detection

Presenting a refresh token whose status is already `ROTATED` — or losing the
rotation race — is a strong signal of token theft. The service responds by
revoking the **entire family** and its parent session, and returns
`401 REFRESH_REUSE_DETECTED`. The victim must log in again; the attacker's
copy of the token is now worthless.

## 4. Logout

| Endpoint | Input | Effect |
| --- | --- | --- |
| `POST /auth/logout` | refresh token | revokes the session + its family (logout current) |
| `POST /auth/logout/all` | refresh token | revokes **every** session for the identified user (logout all) |

Both are idempotent and return `revokedCount`. Unknown tokens are a neutral
no-op (`revokedCount: 0`) so the response does not leak token validity.

## 5. Transport

- **Access token** — always `Authorization: Bearer <accessToken>`. This keeps
  every protected route unchanged and avoids CSRF exposure for state-changing
  API calls, because browsers never attach the header automatically.
- **Refresh token** — the client chooses one of:
  1. **JSON body** (`{ "refreshToken": "..." }`), the default for native
     apps and server-to-server clients.
  2. **httpOnly cookie** named `refresh_token`, recommended for browser
     clients that want the refresh token out of JavaScript's reach.

The refresh and logout endpoints accept the token from either source, body
first, then cookie.

## 6. CSRF policy

- **Body transport (recommended for APIs):** not CSRF-exposed. A cross-site
  attacker cannot force a victim's browser to submit a JSON body with the
  `Authorization` header; `SameSite` does not apply because no cookie is used.
- **Cookie transport (optional for browsers):** the cookie is sent
  automatically, so CSRF protection is required. Clients using cookie
  transport MUST:
  1. Set `SameSite=Strict` (or `Lax` with an explicit CSRF token), and
  2. Reject cross-site requests at the edge, e.g. verify `Origin` /
     `Sec-Fetch-Site` before forwarding `/auth/refresh` and `/auth/logout`.

The server does not set cookies itself; it only *reads* an existing
`refresh_token` cookie. This keeps the API contract transport-agnostic and
leaves cookie lifecycle (and its CSRF obligations) to the client/edge.

## 7. Failure matrix

| Condition | Result |
| --- | --- |
| Unknown token | `401 REFRESH_INVALID` |
| `ROTATED` token replayed | revoke family → `401 REFRESH_REUSE_DETECTED` |
| `REVOKED` token/session | `401 REFRESH_REVOKED` |
| Expired token or session | `401 REFRESH_EXPIRED` |
| Missing token | `400 refreshToken is required` |

## 8. Verification

Covered by `tests/refresh-token.service.test.ts` (rotation, reuse, race,
expiry, revocation, logout) and `tests/auth.controller.test.ts` (transport via
body and cookie, error codes).
