# Learnault API Roadmap

This roadmap covers the complete backend required for an LMS, learn-to-earn ledger, credential platform, employer product, and partner programs. It replaces the current flat-module assumptions with an explicit curriculum and learning domain.

## Tracking rules

- `[x]` — implemented, persisted, authorized, documented, and verified.
- `[~]` — code exists but uses mocks, has incomplete domain coverage, lacks integration, or does not pass the full test/build gate.
- `[ ]` — pending.
- A phase closes only when every checklist item in that phase is `[x]`.
- An endpoint is not done until validation, authorization, pagination/idempotency where relevant, errors, OpenAPI, and tests are complete.

Status baseline: 17 July 2026. The present schema supports users, flat modules, one completion per module, credentials, transactions, referrals, sync events, webhooks, devices, and notifications. It does not yet model a complete LMS curriculum.

## Current implementation inventory

- [x] Express/TypeScript service, versioned router, Prisma/PostgreSQL setup, security headers, logging, and error middleware exist.
- [~] JWT registration/login exists with rotating refresh sessions, reuse detection, and logout; verification, recovery, session management, and wallet provisioning flows are partly present.
- [~] User routes exist, but user persistence helpers currently return mock users.
- [~] Flat module list/detail/start/complete routes exist without Course, LearningPath, Lesson, Quiz, Question, Attempt, Enrollment, or detailed Progress models.
- [~] Reward, credential, referral, offline-sync, notification, webhook, employer, Stellar, and Soroban services/routes exist at varying levels of completeness.
- [~] 155 tests currently pass, but seven suites fail to load in the local environment.

## Phase 0 — Backend architecture, data integrity, and delivery baseline

**Goal:** make the service reproducible and define conventions before expanding the data model.

### Service foundation

- [ ] Standardize module boundaries for identity, users, curriculum, learning, assessments, rewards, credentials, referrals, notifications, organizations, and blockchain integration.
- [ ] Adopt request/response DTO conventions, error codes, cursor/page pagination rules, date/decimal serialization, and API versioning policy.
- [ ] Add request IDs, actor context, structured audit context, health/readiness endpoints, and graceful shutdown.
- [ ] Add transaction boundaries and outbox/job patterns for operations that span database, queue, and blockchain/provider calls.
- [ ] Replace monetary `Float` fields with decimal or integer stroop/asset-unit values plus explicit asset and issuer fields.
- [ ] Replace unstructured string status/type fields with enums and legal state-transition checks.
- [ ] Add soft-delete/archive policy and immutable audit records for security-, money-, credential-, and content-sensitive changes.

### Reproducible development and CI

- [~] Repair dependency installation and Prisma client generation so all current suites load and pass from a clean checkout.
- [ ] Add Docker Compose for API, PostgreSQL, Redis, and local job worker dependencies.
- [ ] Add deterministic seed fixtures for all roles, curriculum states, learning states, rewards, and credentials.
- [ ] Add CI for install, format, lint, type-check, migration validation, unit tests, integration tests, coverage, and build.
- [ ] Add test database lifecycle and eliminate tests that depend on developer-local state or network timing.
- [~] Complete OpenAPI coverage and reconcile the checked-in API documentation with actual `/api/v1` routes.
- [ ] Add a multi-stage production image, environment validation, secrets contract, staging deployment, rollback, and smoke tests.

**Closure evidence:** a clean checkout boots the full local stack, applies migrations/seeds, passes every CI gate, and exposes accurate API documentation.

## Phase 1 — Identity, learner account, profile, and wallet provisioning

**Goal:** provide production-grade account primitives needed before learners enroll.

### Authentication and session models

- [~] Complete email/password or email/PIN registration and login using real persisted users and normalized responses.
- [ ] Add `EmailVerificationToken`, `PasswordResetToken`, `RefreshSession`, and `LoginAttempt` models with expiry and revocation.
- [ ] Add email verification, resend, forgot-password, reset-password, refresh-token rotation, logout-one-session, and logout-all-session endpoints.
- [x] Add phone/OTP challenge and verification models/endpoints — retained in launch scope; see [`docs/decisions/0001-phone-otp-authentication.md`](docs/decisions/0001-phone-otp-authentication.md). Implemented with a hashed/expiring/attempt-limited `OtpChallenge` model, a provider-abstracted `SmsProvider` (mock only for now), and phone/IP/device abuse limits.
- [ ] Add session/device listing and revocation endpoints.
- [ ] Enforce verified-email, account status, role, password policy, token audience/issuer, and secret rotation rules.

### Learner and preference models

- [ ] Extend `User` with account status and verification fields; separate private identity from public profile data.
- [ ] Add `LearnerProfile` for display name, bio, avatar, country, timezone, languages, skill level, interests, goals, and profile visibility.
- [ ] Add onboarding state/version, consent records, terms/privacy versions, analytics consent, and data-sharing consent.
- [ ] Add account/profile read and update endpoints using Prisma; remove all mock user helpers.
- [ ] Add preferences endpoints for locale, timezone, low-data mode, accessibility, content, notifications, and privacy.
- [ ] Add avatar signed-upload/finalization/delete flow with validation and image processing.
- [ ] Add data export, account deactivation, deletion request, retention, and irreversible deletion workflows.

### Wallet provisioning

- [ ] Add `Wallet` and encrypted `WalletSecret`/key-reference models with network, custody type, public key, provisioning status, and recovery state.
- [ ] Generate a Stellar keypair after required consent, encrypt the secret through managed KMS/HSM, and never return it through ordinary APIs.
- [ ] Fund the account minimum through a controlled sponsorship account and persist transaction/failure/retry state.
- [ ] Add wallet provisioning status, public address, supported asset balance, and transaction history endpoints.
- [ ] Add self-custody export/migration workflow with step-up authentication, audit logging, and one-time secret handling.
- [ ] Test duplicate signup, retry after partial provisioning, KMS/provider failure, session theft, account deletion, and key-export paths.

**Closure evidence:** a verified learner completes onboarding, receives exactly one recoverable wallet, manages profile/settings/sessions, and all sensitive actions are audited.

## Phase 2 — Curriculum, content authoring, catalog, and learning paths

**Goal:** model and serve a real LMS curriculum before progress or rewards are connected.

### Curriculum data model

- [ ] Add `Category` and `Skill` models with slugs, localization, status, ordering, and many-to-many course relationships.
- [ ] Add `Course` with slug, title, summary, description, outcomes, prerequisites, difficulty, language, duration, image, instructor/issuer, status, publication/version, and visibility.
- [ ] Replace or migrate the flat `Module` model into ordered modules belonging to a course.
- [ ] Add ordered `Lesson` records with type, duration, status, preview flag, version, and completion requirement.
- [ ] Add typed `LessonBlock` records for rich text, heading, callout, image, audio, video, download, example, embed, and knowledge check.
- [ ] Add localized content tables/JSON with fallback rules rather than duplicating whole records unpredictably.
- [ ] Add `CoursePrerequisite`, `CourseSkill`, content version, publication, archive, and scheduled-release records.
- [ ] Add `LearningPath`, ordered `LearningPathCourse`, path outcomes, prerequisites, estimated duration, status, and path credential configuration.
- [ ] Add `Instructor/Issuer` profile and course ownership/editor relationships.

### Learner catalog APIs

- [ ] Implement `GET /categories` and `GET /categories/:slug` with course counts and localized metadata.
- [ ] Implement `GET /courses` with text search, category, skill, difficulty, language, duration, reward, status, sorting, and pagination.
- [ ] Implement `GET /courses/:slug` with outcomes, prerequisites, syllabus, rewards, credential preview, instructor, and learner-specific state.
- [ ] Implement `GET /courses/:courseId/curriculum` with ordered modules/lessons and locked/preview/completed state.
- [ ] Implement save/unsave course and `GET /users/me/saved-courses`.
- [ ] Implement `GET /learning-paths`, `GET /learning-paths/:slug`, path enrollment metadata, and learner-specific path progress.
- [ ] Implement recommendations as an explicit service with explainable rules and a safe fallback—not hard-coded controller arrays.

### Authoring and publication APIs

- [ ] Implement role-scoped CRUD for categories, skills, courses, modules, lessons, blocks, quizzes, assets, and learning paths.
- [ ] Implement reorder operations with conflict/version detection for modules, lessons, blocks, questions, and path courses.
- [ ] Implement draft preview, validation, review request, approve/reject, publish, schedule, unpublish, archive, clone, and version history.
- [ ] Add signed S3/IPFS asset upload, MIME/size validation, malware scanning, metadata, transcript/caption, and derivative processing.
- [ ] Validate that published courses have outcomes, at least one module/lesson, valid ordering, required assets, and a coherent completion policy.
- [ ] Add seed/import tooling for the first 5, then 10, then 25 reviewed courses/modules without bypassing validation.

**Closure evidence:** editors can create and publish a versioned course and learning path; unauthenticated and learner clients can discover their complete curriculum through documented APIs.

## Phase 3 — Enrollment, lesson delivery, progress, and assessment engine

**Goal:** implement the full learning lifecycle independently of blockchain rewards.

### Enrollment and access

- [ ] Add `CourseEnrollment` with learner, course version, status, enrolled/started/completed timestamps, source/program, and progress summary.
- [ ] Add `PathEnrollment` and derive ordered course availability from prerequisites.
- [ ] Implement course/path enroll, withdraw/archive, My Learning, resume, and enrollment-detail endpoints.
- [ ] Enforce course status, visibility, region/program eligibility, prerequisites, role, and tenant access.

### Lesson delivery and progress

- [ ] Implement lesson-detail delivery with only permitted content and signed/low-bandwidth asset variants.
- [ ] Add `LessonProgress` for started, last position, percent, explicit completion, client/server timestamps, and version.
- [ ] Add learner bookmark and private note models/endpoints scoped to lesson/content block.
- [ ] Implement start, heartbeat/save-position, complete, reopen, next-lesson, and resume endpoints.
- [ ] Calculate module/course/path progress deterministically from completion policy rather than trusting client percentages.
- [ ] Handle content-version changes without losing valid learner progress; define migration/review rules.

### Assessment model

- [ ] Add `Quiz` with pass mark, attempts, feedback mode, timing, randomization, availability, and completion behavior.
- [ ] Add `Question`, `QuestionOption`, explanation, points, tags, pool/group, and supported question-type models.
- [ ] Add immutable `QuizAttempt`, randomized `AttemptQuestion`, saved `AttemptAnswer`, score, status, started/submitted/expires timestamps, and attempt number.
- [ ] Keep correct answers and explanations out of start/save responses.
- [ ] Implement quiz start, retrieve/resume attempt, save answer, submit, result, review, and attempt-history endpoints.
- [ ] Score supported question types server-side, enforce time/attempt rules, and make submission idempotent.
- [ ] Define lesson/module/course completion from lesson requirements and quiz pass rules in one domain service.

### Learning verification

- [ ] Add integration tests for prerequisite locks, concurrent enrollments, duplicate starts, resume, version changes, quiz randomization, answer secrecy, timeout, retry, and completion.
- [ ] Add analytics events for enrollment, lesson start/progress/completion, quiz start/submit/pass/fail, and course completion through an outbox.
- [ ] Add moderation/report-content endpoints and content defect routing.

**Closure evidence:** a learner can enroll, consume ordered lessons, resume accurately, pass/fail/retry assessments, and complete a course with no reward or chain dependency.

## Phase 4 — Rewards, credentials, referrals, and Stellar reconciliation

**Goal:** attach exactly-once economic and credential outcomes to a proven LMS completion.

### Reward policy and ledger

- [ ] Add versioned `RewardPolicy` by course/difficulty/program with asset, base amount, streak/referral rules, caps, effective dates, and funding source.
- [ ] Replace generic `Transaction` with immutable ledger entries, transfer attempts, chain transaction hash/ledger, asset/issuer, idempotency key, and reversal linkage.
- [~] Refactor the existing reward service to consume verified course-completion events rather than trusting arbitrary module claims.
- [ ] Implement reward eligibility, reserve, submit, confirm, fail, retry, reconcile, reverse/adjust, and manual-review state transitions.
- [ ] Guarantee exactly-once reward issuance across duplicate API calls, offline sync, worker retries, and chain callbacks.
- [ ] Add balance/history/detail endpoints based on ledger and Horizon reconciliation.

### Credentials

- [ ] Expand credentials with course/path version, issuer, holder wallet, metadata hash/URI, contract/network, issue transaction, status, revocation, and expiry.
- [~] Refactor existing issue/verify endpoints to use Course Registry/Badge NFT deployment configuration and actual chain state.
- [ ] Implement credential list/detail, public verify, share token, visibility, revoke, and reissue endpoints.
- [ ] Reconcile badge/credential events and expose pending, valid, revoked, expired, mismatched, and unverified states.

### Referrals and streaks

- [~] Complete referral code creation/application using a defined qualification event such as first verified course completion.
- [ ] Add referral qualification, bonus ledger entry, caps, fraud review, cancellation, and payout status.
- [ ] Add `LearningActivityDay`, `Streak`, multiplier, grace/freeze, timezone, milestone, and rebuild logic.
- [ ] Add streak summary/calendar and leaderboard endpoints with opt-out and privacy controls.

### Blockchain workers

- [ ] Add durable jobs/outbox for account funding, rewards, credential issuance, event indexing, transaction finality, and repair.
- [ ] Add Horizon/Soroban cursors, deduplicated indexed events, reorg/finality policy, replay, and dead-letter handling.
- [ ] Add contract deployment/version registry and environment-specific addresses rather than free-form configuration.
- [ ] Complete end-to-end tests against local/testnet contracts for completion → reward → badge → API reconciliation.

**Closure evidence:** one eligible completion produces one finalized reward and credential; every database/chain discrepancy is detectable and repairable.

## Phase 5 — Offline sync, notifications, mobile money, and beta operations

**Goal:** make the learner system dependable in low-connectivity target markets.

### Offline synchronization

- [~] Evolve existing sync routes from generic JSON strings into typed progress, answer, and completion event schemas.
- [ ] Define per-device cursor/version, idempotency, ordering, conflict, stale-content, rejected-event, and retry semantics.
- [ ] Add batch download manifests and content-version/delta endpoints for offline courses.
- [ ] Prevent offline clients from receiving quiz answers and require authoritative submission validation.
- [ ] Test duplicate, delayed, reordered, tampered, cross-device, version-changed, and partially applied batches.

### Notifications

- [~] Repair and complete existing device, preference, queue, delivery, retry, and status implementations.
- [ ] Add in-app notification records/read state and push deep-link payloads.
- [ ] Trigger course, lesson, quiz, reward, credential, streak, referral, payout, and security notifications from domain events.
- [ ] Add quiet hours, locale-aware templates, channel preference, token invalidation, rate caps, and dead-letter review.

### Mobile-money payouts

- [ ] Add payout profile/destination, provider, country/currency, quote, fee, limit, KYC status, and beneficiary validation models.
- [ ] Integrate one approved mobile-money/off-ramp provider behind a provider interface and signed webhook verification.
- [ ] Implement quote, create, confirm, cancel, status, history, receipt, failure, retry, and reversal endpoints.
- [ ] Add KYC/AML/sanctions/fraud/manual-review controls and immutable payout audit logs.
- [ ] Reconcile provider, internal ledger, and Stellar transfer state with repair tooling.

### Beta reliability and security

- [ ] Add Redis cache, session/idempotency store, job queues, distributed locks, and streak leaderboard.
- [~] Complete IP/user rate limits, then add OTP, auth, reward, quiz, sync, employer, and payout-specific limits.
- [ ] Add device risk signals and review queues without silently excluding shared-device households.
- [ ] Add metrics, traces, Sentry, dashboards, alerts, runbooks, backups, restore tests, load tests, and security scanning.
- [ ] Pass closed-beta security, privacy, reward-abuse, performance, and recovery gates for at least 500 learners.

**Closure evidence:** offline learning reconciles once, notifications are durable, supported payouts reconcile, and beta SLO/security gates pass.

## Phase 6 — Organizations, employers, partners, administration, and community

**Goal:** implement the revenue and operating domains described by the TRD.

### Organizations and subscriptions

- [ ] Add `Organization`, `OrganizationMember`, invitation, role/permission, verification, plan, subscription, entitlement, invoice, and usage models.
- [ ] Add organization CRUD, member/invitation, role, verification, subscription, billing-portal, and usage endpoints.
- [ ] Enforce tenant isolation and organization-scoped audit logs in repository/service tests.

### Employer talent product

- [~] Refactor existing employer search/profile/contact code onto real organization roles, persisted profiles, consent, and credentials.
- [ ] Implement indexed talent search by skill, course/path, credential, language, location, availability, and profile visibility.
- [ ] Add saved search, shortlist, private note, contact request/response, contact quota, and access-history models/endpoints.
- [ ] Add asynchronous talent-report CSV generation with scoped fields, expiry, auditing, and deletion.

### Partner and white-label programs

- [ ] Add partner program, cohort, enrollment/invitation/import, eligibility, curriculum assignment, schedule, branding, and custom-domain models.
- [ ] Add funded incentive budget, allocation, liability, refund, program completion, and impact metric models.
- [ ] Add partner program/cohort/learner/progress/reward/impact APIs with tenant isolation.

### Platform administration and community

- [ ] Add admin APIs for users, roles, content workflow, organizations, reports, rewards, payouts, credentials, treasury, and audit logs.
- [ ] Add study group, membership, post/comment, resource, event, moderation, report, block, and sanction models/endpoints.
- [ ] Add mentoring profile, availability, request, session, feedback, report, and block models/endpoints.
- [ ] Add retention/moderation policies and anti-harassment controls for community data.

**Closure evidence:** employer and partner paid workflows run on isolated organizations, administrators can operate the platform, and community safety controls are tested.

## Phase 7 — Advanced protocol integration, scale, and launch

**Goal:** connect quests, staking, governance, private proofs, and operate at Year 1 scale.

- [ ] Add quest/scholarship create, eligibility, proof, review, dispute, payout, refund, and indexed-event APIs.
- [ ] Add stake position, multiplier, lock, stake/unstake transaction preparation/status, and reconciliation APIs.
- [ ] Add governance proposal indexing, badge voting eligibility, vote submission/status, result, cancellation, and execution APIs.
- [ ] Add selective-disclosure/ZK proof request, consent, issuance, verification, expiry, and revocation APIs with data minimization.
- [ ] Add localization workflow, translated templates/content metadata, and voiceover delivery at scale.
- [ ] Complete independent application, infrastructure, KMS/wallet, payout, and contract-integration security reviews.
- [ ] Add horizontal API/worker scaling, connection pooling, Redis HA, queue backpressure, read/caching strategy, disaster recovery, and regional failover.
- [ ] Define and meet SLOs for API latency/availability, learning sync, reward finality, credential issuance, notifications, and payouts.
- [ ] Capacity-test 50,000 users, 10,000 MAU, 200,000 completions, and 30,000 credentials with measured cost and treasury exposure.
- [ ] Complete staged production launch, canary verification, incident rehearsal, post-launch review, and remediation.

**Closure evidence:** advanced workflows reconcile across all repositories, production SLOs hold at target load, and every roadmap item is `[x]`.
