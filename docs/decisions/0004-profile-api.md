# 0004 — Replace Mock User Helpers with the Profile API

- **Status:** Accepted
- **Date:** 2026-08-28
- **Roadmap item:** Phase 1 / "Replace Mock User Helpers with Profile API"

## Context

`UserController` carried five private helpers that were never wired to a
database:

| Helper | What it did |
|---|---|
| `findUserById` | returned a hard-coded `test@example.com` / `testuser` record |
| `updateUserProfile` | echoed the request body back as a fake persisted user |
| `validatePassword` | returned `false`, unconditionally |
| `updateUserPassword` | `throw new Error('Not implemented')` |
| `updateUserWallet` | returned a fake user with the requested address |

Every `/users` route was therefore either a fixture or a 500. Worse, the fixture
described a schema that does not exist: `firstName`, `lastName`, `bio` and
`avatar` are not columns on `User`. `GET /users/me` and `GET /users/:id` served a
shape no query could ever produce, and the OpenAPI `User` / `PublicUser` /
`UpdateUserInput` components documented that shape as if it were real.

The persistence those routes needed had meanwhile been built by three earlier
issues: `LearnerProfile` with its visibility model and serializers
([0002](0002-learner-profile-visibility.md)), `OnboardingProgress` and
`ConsentRecord` ([0003](0003-onboarding-consent-persistence.md)), and the
audited-mutation helper (`src/audit/`). Both earlier ADRs explicitly deferred
wiring `UserController` to this issue.

## Decision

Delete the helpers and back every `/users` route with Prisma, through two
services and one schema module.

### Where the code lives

| Concern | Module |
|---|---|
| Owner-updatable field allow-list, password and wallet body schemas | `src/schemas/profile.schema.ts` |
| Profile reads/writes, the owner aggregate, the disclosure gate | `src/services/profile.service.ts` |
| Password change, wallet address | `src/services/user-account.service.ts` |
| Response shaping | `src/services/profile-serializer.ts` |
| Audit actor/context from a request | `src/utils/audit-context.ts` |

`UserController` holds HTTP concerns only: auth check, parse, map a result kind
to a status code. It does not import the Prisma client — a rule the mock scan
enforces (`tests/mock-user-scan.test.ts`), so the persistence and its audit
cannot drift apart again by someone adding "just one query" to the controller.

### `GET /users/me` — the owner aggregate

Returns account identity, profile, profile completion, onboarding state, and the
current consent record per purpose, in one read. Four round trips to render one
settings screen is the shape a client would otherwise be pushed into, and three
of the four are already needed to answer "what should this learner do next".

Two properties are deliberate:

- **The account field list is closed.** `toAccountSummary` copies eleven named
  fields rather than spreading the row, so `password` — and any column added to
  `User` later — has to be opted in to be disclosed. The `select` in the service
  is closed for the same reason; the serializer is the second line, because a
  `select` is easy to widen by accident and a spread would then carry the
  widening straight into the response.
- **Completion and outstanding onboarding steps are computed on read.**
  Consistent with `computeProfileCompletion` from 0002: a stored percentage can
  disagree with the row it summarises, a computed one cannot.

A tombstoned (`status = DELETED`) or missing account is a `404`, and no profile
row is created for it.

### `PATCH /users/me` — validated, audited, allow-listed

One Zod object (`updateProfileSchema`) is the allow-list, shared with
`PATCH /users/me/profile` so the two routes cannot diverge on what an owner may
write. `.strict()` is what enforces it: an unrecognised key is a `400` rather
than a silently dropped field. The fields deliberately *absent* are the point —
`id`, `userId`, the `archived*` columns, and every account field (`status`,
`isVerified`, `phoneVerifiedAt`, `role`, `email`, `password`, `walletAddress`).

The write goes through `auditedMutation`, so the profile change and its
`learner_profile.updated` event commit together. The event records **which**
fields changed, never their values: a bio in an append-only trail is PII that
cannot be scrubbed afterwards.

### `GET /users/:id` — consent-aware public read

The visibility threshold from 0002 still applies, with two further gates that can
only ever *narrow* disclosure (`isDisclosureAllowed`):

1. **Account status.** Only an `ACTIVE` account is disclosed, so deactivating
   drops third-party visibility immediately without the learner also having to
   flip `visibility` on the way out.
2. **Withdrawn `data_sharing` consent.** An explicit withdrawal overrides the
   `visibility` setting, so revoking consent takes effect even against a stale
   `visibility: public`.

**The absence of a `data_sharing` record does not block disclosure.** That
consent is optional (`REQUIRED_CONSENT_PURPOSES`), and setting `visibility` above
`private` is itself a deliberate disclosure choice; treating "never asked" as a
refusal would make the visibility control inoperative for every learner who
skipped an optional prompt. This is the one genuinely debatable call here, and it
is why the rule is a single named function with its own tests rather than an
`if` in a controller.

Every refusal returns the identical stub `{ id, visible: false }`. A
distinguishable refusal would leak the state it is refusing to disclose.

The read uses `findFirst`, not `findUnique`, so the archive-exclusion client
extension applies and an archived profile is invisible rather than merely
redacted (`src/audit/archive.ts` exempts `findUnique` on purpose).

The owner gets the same public view as anyone else on this route. Their own full
record is at `GET /users/me` and `GET /users/:id/profile`, so there is exactly
one route whose output does not depend on who is asking — easier to reason about
than a route that sometimes returns private data.

### `PATCH /users/password` — real, and session-revoking

bcrypt verify, bcrypt hash, then **every session and refresh-token family for the
account is revoked in the same transaction as the password write**. Doing the
revocation afterwards, as a separate call, would leave a window where the
password has changed and the attacker's stolen session is still alive —
precisely when the victim believes they have locked them out.

A wrong current password is `401` (`code: STEP_UP_FAILED`), not `400`: it is a
failed re-authentication, and the body that carried it was well-formed. This
matches the step-up behaviour in `AccountController`.

### `PATCH /users/wallet` — real, unique, idempotent

Persists the learner's Stellar **public** key to `User.walletAddress`. Re-sending
the address on file is a no-op with no second audit event. An address claimed by
another account is a `409`; the check is done up front for a clear error *and*
again by catching Prisma's `P2002`, because two accounts claiming the same
address concurrently both pass the up-front read.

### Removed and deprecated

- The five mock helpers, and `PublicUserInfo` / `UpdateUserData` /
  `ChangePasswordData` / `UpdateWalletData` in `types/user.types.ts` — their
  replacements are inferred from the Zod schemas that actually validate the
  requests, so a shape and its validation can no longer drift.
- The OpenAPI `PublicUser` and `UpdateUserInput` components, replaced by
  `AccountSummary`, `LearnerProfile`, `ProfileCompletion`, `OnboardingSummary`,
  `ConsentSummary`, `OwnerAccountProfile`, `PublicProfile` and
  `UpdateProfileInput`. The "Preview / not-yet-implemented" banner is gone from
  `src/config/swagger.ts` and `docs/API.md`.
- `validateProfileUpdate` in `src/middleware/validation.middleware.ts` is
  **deprecated and unmounted**. It validates the mock-era
  `firstName`/`lastName`/`bio`/`avatar` body. It is left exported so its existing
  test suite keeps passing, with a comment saying not to wire it back up; the
  mock scan asserts no route imports it.

`User` in `types/user.types.ts` survives because `LoginResponse` refers to it,
with a comment marking the four non-persisted fields.

### Response envelope

`{ data }` on success, `{ error, details }` on validation failure — matching the
profile, preference, onboarding, consent and account controllers. Note this is
**not** the `createSuccessEnvelope` shape from `src/schemas/api.schema.ts`;
migrating the whole service onto that envelope is a separate Phase 0 item, and
half-migrating one route family would leave clients with two shapes on `/users`.

## Out of scope

- Wiring `LearnerProfile` into `employer.controller.ts` candidate search. 0002
  listed it under this issue, but that controller has no mock user helpers — it
  is a search-surface change, not a mock removal.
- Rejecting a wallet-address change when a managed custodial `Wallet` row already
  exists for the learner. `User.walletAddress` and `Wallet.publicKey` can
  currently disagree; reconciling them belongs with the wallet provisioning work,
  not here.
- Moving `/users` onto the `createSuccessEnvelope` / pagination envelope.

## Verification evidence

- **Mock scan:** `tests/mock-user-scan.test.ts` — 24 assertions over the seven
  source files, covering mock literals, the sentinel values the old helpers
  returned (`test@example.com`, `testuser`, `GABC123456789…`), not-implemented
  stubs, each removed helper by name, direct Prisma access from the controller,
  the deprecated middleware, and `password: true` in any profile select.
- **Redacted curl transcript:** `docs/evidence/profile-api-curl.txt` — 20
  requests against a running server on a dedicated test database, covering auth,
  the aggregate read, each rejected forbidden field, the public/private/redacted
  reads, step-up failure, and wallet validation/idempotence. Bearer tokens and
  passwords are redacted in the echoed commands.
- **Profile integration tests:** `tests/integration/profile-api.test.ts` — 51
  tests through the real Express app, real middleware, real JWT verification and
  a real database, asserting persisted rows and audit rows rather than mock
  calls. Skipped (not failed) when no test database is reachable.
- **Unit tests:** `tests/user.controller.test.ts` (55),
  `tests/profile.service.test.ts` (27), `tests/user-account.service.test.ts` (15),
  `tests/profile-serializer.test.ts` (33), `tests/profile.controller.test.ts` (20).
- **Audit tests:** transaction ordering (`['mutate', 'audit']`), actor
  attribution, request-id propagation, field-names-not-values metadata, rollback
  on a failed audit write, and refusal of an unattributable USER actor — in both
  the service unit tests and the integration suite.
- **OpenAPI:** `tests/contract/openapi.test.ts` — the document builds, every
  `$ref` resolves, all seven user operations are documented, the removed
  components are gone and the new ones present, the public-profile schema
  mentions no private field, security is `[]` on the public read and `bearerAuth`
  on the owner reads, `UpdateProfileInput` is `additionalProperties: false` and
  lists no account field, and the wallet route documents its `409`.
