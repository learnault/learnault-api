// ── Enums ──────────────────────────────────────────────────

export enum UserRole {
  ADMIN = 'admin',
  LEARNER = 'learner',
  INSTRUCTOR = 'instructor',
}

export enum UserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SUSPENDED = 'suspended',
  PENDING_VERIFICATION = 'pending_verification',
}

// ── Core models ────────────────────────────────────────────

/**
 * Auth-facing user shape (see `LoginResponse` in api.types.ts).
 *
 * `firstName`, `lastName`, `bio` and `avatar` are **not** persisted columns —
 * they are leftovers from the mock user helpers. Learner-authored profile data
 * lives on `LearnerProfile` and is served by the profile API; see
 * `LearnerProfileRecord` in types/profile.types.ts and
 * docs/decisions/0002-learner-profile-visibility.md. Do not read them expecting
 * a value, and do not add new ones here.
 */
export interface User {
  id: string
  email: string
  username: string
  firstName?: string
  lastName?: string
  bio?: string
  avatar?: string
  walletAddress?: string
  role: UserRole
  status: UserStatus
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  lastLoginAt?: Date
}

export interface UserProfile extends User {
  totalCredentials: number
  totalPoints: number
  completedModules: number
}

// ── Request types ──────────────────────────────────────────

export interface CreateUserData {
  email: string
  username: string
  password: string
  firstName?: string
  lastName?: string
  role?: UserRole
}

// `UpdateUserData`, `ChangePasswordData`, `UpdateWalletData` and
// `PublicUserInfo` used to live here as the input/output shapes of the mock user
// helpers. Their replacements are inferred from the Zod schemas that actually
// validate the requests — `UpdateProfileInput`, `ChangePasswordInput`,
// `UpdateWalletInput` in src/schemas/profile.schema.ts — and `PublicProfileView`
// in types/profile.types.ts, so a shape and its validation can no longer drift.

export interface UpdateUserRoleData {
  role: UserRole
}

export interface UpdateUserStatusData {
  status: UserStatus
}

export interface UserFilterParams {
  role?: UserRole
  status?: UserStatus
  search?: string
  isActive?: boolean
}
