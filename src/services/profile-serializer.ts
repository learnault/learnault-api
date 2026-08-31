import {
  AccountPrivateFields,
  AccountSummary,
  ConsentSummary,
  EmployerProfileView,
  LearnerProfileRecord,
  OnboardingSummary,
  OwnerAccountProfileView,
  OwnerProfileView,
  PrivateProfileView,
  PROFILE_COMPLETION_FIELDS,
  ProfileCompletion,
  PublicProfileView,
  VISIBILITY_RANK,
} from '../types/profile.types'
import { REQUIRED_ONBOARDING_STEPS } from '../types/onboarding.types'

function isFilled(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false
  }
  if (Array.isArray(value)) {
    return value.length > 0
  }
  if (typeof value === 'string') {
    return value.trim().length > 0
  }

  return true
}

export function computeProfileCompletion(
  profile: LearnerProfileRecord,
): ProfileCompletion {
  const missingFields = PROFILE_COMPLETION_FIELDS.filter(
    (field) => !isFilled(profile[field]),
  )
  const filledCount = PROFILE_COMPLETION_FIELDS.length - missingFields.length
  const percent = Math.round(
    (filledCount / PROFILE_COMPLETION_FIELDS.length) * 100,
  )

  return { percent, missingFields: [...missingFields] }
}

/**
 * Narrow a loaded row to the declared profile fields.
 *
 * The Prisma model also carries the archive bookkeeping columns (`archivedAt`,
 * `archivedById`, `archivedReason`), which are lifecycle machinery, not profile
 * data — they are not in `LearnerProfileRecord`, not in the documented
 * `LearnerProfile` schema, and a spread of the row would put them in the
 * response anyway, because TypeScript checks the declared type and not the
 * object that actually arrives at runtime.
 */
export function toProfileRecord(
  profile: LearnerProfileRecord,
): LearnerProfileRecord {
  return {
    id: profile.id,
    userId: profile.userId,
    displayName: profile.displayName,
    bio: profile.bio,
    avatarUrl: profile.avatarUrl,
    country: profile.country,
    timezone: profile.timezone,
    languages: profile.languages,
    level: profile.level,
    interests: profile.interests,
    goals: profile.goals,
    visibility: profile.visibility,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  }
}

export function toOwnerProfile(
  profile: LearnerProfileRecord,
): OwnerProfileView {
  return {
    ...toProfileRecord(profile),
    completion: computeProfileCompletion(profile),
  }
}

export function toEmployerProfile(
  profile: LearnerProfileRecord,
): EmployerProfileView {
  if (VISIBILITY_RANK[profile.visibility] < VISIBILITY_RANK.employer) {
    return { id: profile.id, visible: false }
  }

  return {
    id: profile.id,
    displayName: profile.displayName,
    bio: profile.bio,
    avatarUrl: profile.avatarUrl,
    country: profile.country,
    timezone: profile.timezone,
    languages: profile.languages,
    level: profile.level,
    interests: profile.interests,
    goals: profile.goals,
    visible: true,
  }
}

export function toPublicProfile(
  profile: LearnerProfileRecord,
): PublicProfileView {
  if (VISIBILITY_RANK[profile.visibility] < VISIBILITY_RANK.public) {
    return { id: profile.id, visible: false }
  }

  return {
    id: profile.id,
    displayName: profile.displayName,
    bio: profile.bio,
    avatarUrl: profile.avatarUrl,
    country: profile.country,
    level: profile.level,
    interests: profile.interests,
    visible: true,
  }
}

// Internal/administrative use only (e.g. audit tooling). Never route this
// view through a public or employer-facing endpoint.
export function toPrivateProfile(
  profile: LearnerProfileRecord,
  account: AccountPrivateFields,
): PrivateProfileView {
  return { ...toProfileRecord(profile), ...account }
}

// ── Consent-aware disclosure gate ──────────────────────────────────────────

/**
 * The consent purpose that governs showing a learner's profile to anyone other
 * than the learner. `data_sharing` is optional consent, so most learners have
 * no record for it at all — see {@link isDisclosureAllowed} for what that means.
 */
export const DISCLOSURE_CONSENT_PURPOSE = 'data_sharing'

/** The only account status whose profile is disclosed to a third party. */
export const DISCLOSABLE_ACCOUNT_STATUS = 'ACTIVE'

/**
 * Whether a profile may be shown to someone other than its owner, on grounds
 * other than the `visibility` setting.
 *
 * Two independent gates, both of which can only ever *narrow* disclosure:
 *
 *  1. **Account status.** A deactivated or pending-deletion account stops being
 *     visible to third parties immediately, without the learner having to also
 *     flip `visibility` on the way out.
 *  2. **Withdrawn data-sharing consent.** An explicit withdrawal wins over the
 *     `visibility` setting, so revoking consent takes effect even if a stale
 *     `visibility: public` is still on the row.
 *
 * The *absence* of a `data_sharing` record does not block disclosure. That
 * consent is optional (`REQUIRED_CONSENT_PURPOSES` in src/types/consent.types.ts),
 * and setting `visibility` above `private` is itself an explicit, deliberate
 * disclosure choice — treating "never asked" as a refusal would make the
 * visibility control silently inoperative for every learner who skipped an
 * optional prompt.
 */
export function isDisclosureAllowed(input: {
  accountStatus: string
  consents: readonly { purpose: string; status: string }[]
}): boolean {
  if (input.accountStatus !== DISCLOSABLE_ACCOUNT_STATUS) {
    return false
  }

  const dataSharing = input.consents.find(
    (consent) => consent.purpose === DISCLOSURE_CONSENT_PURPOSE,
  )

  return dataSharing?.status !== 'withdrawn'
}

/**
 * The redacted stub returned when disclosure is refused.
 *
 * Identical to the stub `toPublicProfile`/`toEmployerProfile` return below their
 * visibility threshold, and that is the point: a viewer cannot tell a private
 * profile from a withdrawn consent from a deactivated account. Distinguishable
 * refusals would leak the very state they refuse to disclose.
 */
export function redactedProfile(profileId: string): {
  id: string
  visible: false
} {
  return { id: profileId, visible: false }
}

// ── Owner account/profile aggregate ────────────────────────────────────────

/**
 * The owner's view of their own account row.
 *
 * Field-by-field rather than a spread, so the `password` column — and anything
 * else added to `User` later — cannot reach a response by being present on the
 * input object. The compiler enforces the shape; this enforces the contents.
 */
export function toAccountSummary(account: AccountSummary): AccountSummary {
  return {
    id: account.id,
    email: account.email,
    username: account.username,
    role: account.role,
    status: account.status,
    isVerified: account.isVerified,
    phoneVerifiedAt: account.phoneVerifiedAt,
    walletAddress: account.walletAddress,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    lastLoginAt: account.lastLoginAt,
  }
}

export function toOnboardingSummary(progress: {
  version: string
  status: string
  currentStep: string
  completedSteps: string[]
  startedAt: Date
  completedAt: Date | null
}): OnboardingSummary {
  return {
    version: progress.version,
    status: progress.status,
    currentStep: progress.currentStep,
    completedSteps: [...progress.completedSteps],
    // Computed rather than stored, for the same reason completion is: it can
    // then never disagree with `completedSteps`.
    requiredStepsRemaining: REQUIRED_ONBOARDING_STEPS.filter(
      (step) => !progress.completedSteps.includes(step),
    ),
    startedAt: progress.startedAt,
    completedAt: progress.completedAt,
  }
}

/**
 * Consent state, reduced to what a client needs to render a settings screen.
 *
 * `id`, `userId` and `source` are dropped: the aggregate is about the current
 * state of each purpose, and the full audit trail is served by the consent
 * history endpoint.
 */
export function toConsentSummary(record: {
  purpose: string
  status: string
  required: boolean
  policyVersion: string
  grantedAt: Date | null
  withdrawnAt: Date | null
}): ConsentSummary {
  return {
    purpose: record.purpose,
    status: record.status,
    required: record.required,
    policyVersion: record.policyVersion,
    grantedAt: record.grantedAt,
    withdrawnAt: record.withdrawnAt,
  }
}

export function toOwnerAccountProfile(input: {
  account: AccountSummary
  profile: LearnerProfileRecord
  onboarding: Parameters<typeof toOnboardingSummary>[0] | null
  consents: Parameters<typeof toConsentSummary>[0][]
  requiredConsentsGranted: boolean
}): OwnerAccountProfileView {
  return {
    account: toAccountSummary(input.account),
    profile: toProfileRecord(input.profile),
    completion: computeProfileCompletion(input.profile),
    onboarding: input.onboarding ? toOnboardingSummary(input.onboarding) : null,
    consents: input.consents.map(toConsentSummary),
    requiredConsentsGranted: input.requiredConsentsGranted,
  }
}
