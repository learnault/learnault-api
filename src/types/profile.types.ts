export const LEARNER_LEVELS = ['beginner', 'intermediate', 'advanced', 'expert'] as const
export type LearnerLevel = typeof LEARNER_LEVELS[number]

export const PROFILE_VISIBILITIES = ['private', 'employer', 'public'] as const
export type ProfileVisibility = typeof PROFILE_VISIBILITIES[number]

// Ordered from most to least restrictive. A profile's `visibility` is the
// widest audience allowed to see its non-private fields; the owner can
// always see the full record regardless of this setting.
export const VISIBILITY_RANK: Record<ProfileVisibility, number> = {
  private: 0,
  employer: 1,
  public: 2,
}

export interface LearnerProfileRecord {
  id: string
  userId: string
  displayName: string | null
  bio: string | null
  avatarUrl: string | null
  country: string | null
  timezone: string | null
  languages: string[]
  level: LearnerLevel
  interests: string[]
  goals: string[]
  visibility: ProfileVisibility
  createdAt: Date
  updatedAt: Date
}

export interface UpdateLearnerProfileData {
  displayName?: string | null
  bio?: string | null
  avatarUrl?: string | null
  country?: string | null
  timezone?: string | null
  languages?: string[]
  level?: LearnerLevel
  interests?: string[]
  goals?: string[]
  visibility?: ProfileVisibility
}

// Private account fields, sourced from `User`, that must never appear in
// any profile serializer other than the internal/private one.
export interface AccountPrivateFields {
  status: string
  isVerified: boolean
  phoneVerifiedAt: Date | null
}

export interface ProfileCompletion {
  percent: number
  missingFields: string[]
}

export interface OwnerProfileView extends LearnerProfileRecord {
  completion: ProfileCompletion
}

export type EmployerProfileView =
  | (Pick<LearnerProfileRecord, 'id' | 'displayName' | 'bio' | 'avatarUrl' | 'country' | 'timezone' | 'languages' | 'level' | 'interests' | 'goals'> & { visible: true })
  | { id: string; visible: false }

export type PublicProfileView =
  | (Pick<LearnerProfileRecord, 'id' | 'displayName' | 'bio' | 'avatarUrl' | 'country' | 'level' | 'interests'> & { visible: true })
  | { id: string; visible: false }

export interface PrivateProfileView extends LearnerProfileRecord, AccountPrivateFields {}

// Fields counted toward profile-completion percentage. `level` is excluded
// because it always has a default value and can never read as "empty".
export const PROFILE_COMPLETION_FIELDS = [
  'displayName',
  'bio',
  'avatarUrl',
  'country',
  'timezone',
  'languages',
  'interests',
  'goals',
] as const
