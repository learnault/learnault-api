// ── Enums ──────────────────────────────────────────────────

export enum UserRole {
  ADMIN = 'admin',
  LEARNER = 'learner',
  INSTRUCTOR = 'instructor',
}

export enum ProfileVisibility {
  PUBLIC = 'public',
  PRIVATE = 'private',
  MENTOR_ONLY = 'mentor_only',
}

// ── Core models ────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  username: string;
  firstName?: string;
  lastName?: string;
  bio?: string;
  avatar?: string;
  walletAddress?: string;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt?: Date;
}

export interface PublicUserInfo {
  id: string;
  username: string;
  firstName?: string;
  lastName?: string;
  avatar?: string;
  role: UserRole;
  createdAt: Date;
}

export interface UserProfile extends User {
  profile?: LearnerProfile | null;
  onboarding?: OnboardingState | null;
  totalCredentials: number;
  totalPoints: number;
  completedModules: number;
}

export interface LearnerProfile {
  id: string;
  userId: string;
  displayName?: string;
  country?: string;
  timezone?: string;
  languages: string[];
  skillLevel?: string;
  interests: string[];
  goals: string[];
  visibility: ProfileVisibility;
  consentGiven: boolean;
  consentAt?: Date;
}

export interface OnboardingState {
  id: string;
  userId: string;
  profileComplete: boolean;
  emailVerified: boolean;
  walletConnected: boolean;
  firstSessionBooked: boolean;
  firstCredentialEarned: boolean;
  consentProvided: boolean;
  completedSteps: string[];
  currentStep: string;
  dismissed: boolean;
}

// ── Request types ──────────────────────────────────────────

export interface CreateUserData {
  email: string;
  username: string;
  password: string;
  firstName?: string;
  lastName?: string;
  role?: UserRole;
}

export interface UpdateUserData {
  username?: string;
  firstName?: string;
  lastName?: string;
  bio?: string;
  avatar?: string;
}

export interface ChangePasswordData {
  currentPassword: string;
  newPassword: string;
}

export interface UpdateWalletData {
  walletAddress: string;
}

export interface ProfileUpdateData {
  displayName?: string;
  country?: string;
  timezone?: string;
  languages?: string[];
  skillLevel?: string;
  interests?: string[];
  goals?: string[];
  visibility?: ProfileVisibility;
  consentGiven?: boolean;
}

export interface UpdateUserRoleData {
  role: UserRole;
}

export interface UserFilterParams {
  role?: UserRole;
  search?: string;
  isActive?: boolean;
}

export interface ProfileCompletion {
  percentage: number;
  missingFields: string[];
}
