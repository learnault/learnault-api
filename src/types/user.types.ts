// ── Enums ──────────────────────────────────────────────────

export enum UserRole {
  ADMIN = "admin",
  LEARNER = "learner",
  INSTRUCTOR = "instructor",
}

export enum UserStatus {
  ACTIVE = "active",
  INACTIVE = "inactive",
  SUSPENDED = "suspended",
  PENDING_VERIFICATION = "pending_verification",
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
  status: UserStatus;
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
  totalCredentials: number;
  totalPoints: number;
  completedModules: number;
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

export interface UpdateUserRoleData {
  role: UserRole;
}

export interface UpdateUserStatusData {
  status: UserStatus;
}

export interface UserFilterParams {
  role?: UserRole;
  status?: UserStatus;
  search?: string;
  isActive?: boolean;
}
