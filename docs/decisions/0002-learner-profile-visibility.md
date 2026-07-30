# 0002 — Learner Public and Private Profile Schema

- **Status:** Accepted
- **Date:** 2026-07-30
- **Roadmap item:** Phase 1 / "Add Learner Public and Private Profile Schema" (issue #83)

## Context

Learner-facing account data was split across `User` (identity, credentials, account status/verification) and `LearnerPreference` (locale, accessibility, a coarse `profileVisibility` flag used only for search/preference purposes). There was no structured, consent-controlled profile — no bio, avatar, country, languages, interests, or goals — and no defined boundary for what an employer or the public may see versus what only the account owner may see.

## Decision

Add a `LearnerProfile` model (`prisma/schema.prisma`), one-to-one with `User`, holding only consent-controlled profile data:

- `displayName`, `bio`, `avatarUrl`, `country`, `timezone` — scalar fields.
- `languages`, `interests`, `goals` — `String[]` arrays, modeled consistently with the existing `LearnerPreference.preferredCategories` convention.
- `level` — bounded string (`beginner | intermediate | advanced | expert`).
- `visibility` — bounded string (`private | employer | public`), the single disclosure control for the whole profile. `country`, `level`, and `visibility` are indexed as the consented, searchable fields.

Account status/verification fields (`status`, `isVerified`, `phoneVerifiedAt`) already live on `User` from prior work and are deliberately **not** duplicated onto `LearnerProfile`. This decision's job is to guarantee they never leak through a profile response, not to re-model them.

### Visibility model

`visibility` is ranked `private (0) < employer (1) < public (2)` (`VISIBILITY_RANK` in `src/types/profile.types.ts`). A viewer at a given tier sees the full field set only if the profile's visibility rank is at or above that tier; otherwise they get a redacted stub (`{ id, visible: false }`). This keeps the rule in one place instead of scattered `if` checks in controllers.

### Serializers

Four pure functions in `src/services/profile-serializer.ts`, each taking the raw DB record and returning a fixed shape:

- `toOwnerProfile` — every profile field, always, plus a computed `completion` summary. Ignores `visibility` because the rule doesn't apply to the owner's own view.
- `toEmployerProfile` — full field set if `visibility >= employer`, else redacted stub.
- `toPublicProfile` — a narrower public-safe subset (excludes `timezone`, `languages`, `goals`) if `visibility === public`, else redacted stub.
- `toPrivateProfile` — internal/admin use only; joins the profile with `AccountPrivateFields` (`status`, `isVerified`, `phoneVerifiedAt`) from `User`. Never wired to a public or employer-facing route.

Being pure functions with no I/O, leakage is testable directly: `tests/profile-serializer.test.ts` asserts the employer and public views never carry `status`/`isVerified`/`phoneVerifiedAt`, and that redaction kicks in below each tier's visibility threshold.

### Completion

`computeProfileCompletion` (same file) is a pure function over eight tracked fields (`PROFILE_COMPLETION_FIELDS`) — every profile field except `level`, which always has a default and can never read as "empty". Completion is computed on read rather than stored, so it can never drift from the underlying data; the same input always produces the same percentage.

### Routes

- `GET/PATCH /users/me/profile` — owner view and partial update, mirroring the existing `LearnerPreference` endpoints' shape and auth.
- `GET /users/:id/profile` — optionally authenticated; returns the owner view if the caller is viewing themselves, the employer view if `req.user.role === 'employer'`, otherwise the public view.

## Out of scope

- Wiring `LearnerProfile` into the existing mock-backed `UserController` / `employer.controller.ts` candidate search — tracked separately by "Replace Mock User Helpers with Profile API".
- Change auditing on profile edits — tracked separately by "Add Auditable Data Lifecycle and Archive Policy"; `LearnerProfile` intentionally has no audit log of its own yet, unlike `LearnerPreference`'s privacy-impacting-field audit.
