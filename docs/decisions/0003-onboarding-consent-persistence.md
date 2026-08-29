# 0003 — Onboarding and Consent Persistence

- **Status:** Accepted
- **Date:** 2026-07-30
- **Roadmap item:** Phase 1 / "Add Onboarding and Consent Persistence" (issue #84)

## Context

There was no persisted onboarding state and no consent model. `LearnerPreference` already carries two booleans (`analyticsConsent`, `dataSharingConsent`) but they are overwritten in place on every update — there is no history, no policy version, and no distinction between consent that's required to use the service versus consent that's optional. Onboarding progress did not exist at all, so there was no way to resume a partially completed flow or to gate onboarding completion on required steps.

This issue is blocked by "Introduce Typed Status Enums and Transition Guards," which hasn't been built yet. Rather than wait, this change ships a minimal, scoped transition guard (`src/utils/transitions.ts`) sized to what onboarding and consent actually need. It's intentionally generic (`canTransition<S>(map, from, to)`) so the future typed-enum work can adopt or replace it without reshaping the models built here.

## Decision

### Onboarding (`OnboardingProgress`, 1:1 with `User`)

- `version` — the onboarding flow version a user started under, so a later flow redesign doesn't silently remap in-progress users.
- `currentStep`, `completedSteps[]` — a `String[]` set of finished steps, deduplicated on write.
- `status` — `in_progress | completed`.
- `startedAt`, `completedAt`, `createdAt`, `updatedAt`.

**Transition matrix** (`ONBOARDING_TRANSITIONS`):

| From | Allowed to |
|---|---|
| `in_progress` | `completed` |
| `completed` | *(none — terminal)* |

`saveStep` refuses to write once `status === 'completed'` (`already-completed` result), which is the transition guard in effect: once complete, the record cannot be reopened by any client action.

**Idempotent save/resume**: `saveStep` upserts by the user's single `OnboardingProgress` row and adds the step into `completedSteps` via `Set` dedup, so re-submitting the same step is a no-op beyond updating `currentStep`. `resume` (`GET /onboarding`) always returns the current row, creating a fresh `in_progress` record on first access — same upsert-on-read pattern as `LearnerPreference` — so resuming is deterministic regardless of how many times it's called.

**Completion requirements**: `REQUIRED_ONBOARDING_STEPS = [profile_basics, consent]` (`preferences` is optional). `complete()` checks, in order: all required steps present in `completedSteps`, then all required consent purposes currently granted (via `ConsentService.hasAllRequiredGranted`). Either failure blocks the state transition and reports which requirement was unmet.

### Consent (`ConsentRecord`, many-to-one with `User`)

Append-only: every grant or withdrawal action inserts a **new** row rather than mutating an existing one. The "current" state of a purpose is just its most recent row (`findFirst` ordered by `createdAt desc`, or `findMany` with `distinct: ['purpose']` for all purposes at once). This makes the history model the audit trail — there is no separate audit table to keep in sync, and it can't drift from what's queryable.

- `purpose` — `terms_of_service | privacy_policy | marketing_emails | analytics | data_sharing`.
- `required` — computed from `REQUIRED_CONSENT_PURPOSES` at write time and stored on the row, so historical rows keep the classification that was in effect when they were written even if the required set changes later.
- `policyVersion`, `status` (`granted | withdrawn`), `source` (`onboarding | settings | api`), `grantedAt`, `withdrawnAt`, `createdAt`.

**Transition matrix** (`CONSENT_TRANSITIONS`):

| From | Allowed to |
|---|---|
| `granted` | `withdrawn` |
| `withdrawn` | `granted` |

**Required vs. optional** is enforced in `ConsentService.withdraw`, on top of the raw transition check: withdrawal requires the latest record to be `granted` (`canTransition(CONSENT_TRANSITIONS, 'granted', 'withdrawn')`), and additionally rejects the withdrawal outright if `required` is true. Granting has no such restriction — re-granting (e.g., accepting a new `policyVersion`) is always allowed and simply appends a new row, which is also how "duplicate" grants are handled: calling `grant` twice with the same purpose is not an error, it's two audit entries.

## Out of scope

- The generic typed-status-enum framework this issue is nominally blocked on — `src/utils/transitions.ts` is a minimal stand-in, not that system.
- Migrating `LearnerPreference.analyticsConsent` / `dataSharingConsent` onto `ConsentRecord` — left as-is to avoid touching an unrelated feature; a future cleanup can retire those booleans once consumers move to the consent API.
- Wiring onboarding/consent into `UserController`'s mock helpers — tracked by "Replace Mock User Helpers with Profile API".

## Verification evidence

- **Migration**: `prisma/migrations/20260730130000_add_onboarding_and_consent/migration.sql`.
- **Transition matrix tests**: `tests/transitions.test.ts` (generic guard), exercised concretely in `tests/onboarding.service.test.ts` (`already-completed` refusal) and `tests/consent.service.test.ts` (`required-cannot-withdraw`, `not-granted`).
- **Consent-history tests**: `tests/consent.service.test.ts` — grant/withdraw sequencing, policy-version carry-forward on withdrawal, `hasAllRequiredGranted` across granted/withdrawn/never-addressed states.
- **Controller tests**: `tests/onboarding.controller.test.ts`, `tests/consent.controller.test.ts` — auth gating, validation, status-code mapping for each result kind.
