import {
  AccountPrivateFields,
  EmployerProfileView,
  LearnerProfileRecord,
  OwnerProfileView,
  PrivateProfileView,
  PROFILE_COMPLETION_FIELDS,
  ProfileCompletion,
  PublicProfileView,
  VISIBILITY_RANK,
} from '../types/profile.types'

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

export function computeProfileCompletion(profile: LearnerProfileRecord): ProfileCompletion {
  const missingFields = PROFILE_COMPLETION_FIELDS.filter(field => !isFilled(profile[field]))
  const filledCount = PROFILE_COMPLETION_FIELDS.length - missingFields.length
  const percent = Math.round((filledCount / PROFILE_COMPLETION_FIELDS.length) * 100)

  return { percent, missingFields: [...missingFields] }
}

export function toOwnerProfile(profile: LearnerProfileRecord): OwnerProfileView {
  return { ...profile, completion: computeProfileCompletion(profile) }
}

export function toEmployerProfile(profile: LearnerProfileRecord): EmployerProfileView {
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

export function toPublicProfile(profile: LearnerProfileRecord): PublicProfileView {
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
  account: AccountPrivateFields
): PrivateProfileView {
  return { ...profile, ...account }
}
