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

/**
 * @openapi
 * components:
 *   schemas:
 *     User:
 *       type: object
 *       required:
 *         - id
 *         - email
 *         - username
 *         - role
 *         - status
 *         - isActive
 *       properties:
 *         id: { type: string, format: uuid }
 *         email: { type: string, format: email }
 *         username: { type: string }
 *         firstName: { type: string }
 *         lastName: { type: string }
 *         bio: { type: string }
 *         avatar: { type: string, format: uri }
 *         walletAddress: { type: string }
 *         role: { $ref: '#/components/schemas/UserRole' }
 *         status: { $ref: '#/components/schemas/UserStatus' }
 *         isActive: { type: boolean }
 *         createdAt: { type: string, format: date-time }
 *         updatedAt: { type: string, format: date-time }
 *         lastLoginAt: { type: string, format: date-time }
 */
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

/**
 * @openapi
 * components:
 *   schemas:
 *     PublicUserInfo:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         username: { type: string }
 *         firstName: { type: string }
 *         lastName: { type: string }
 *         avatar: { type: string, format: uri }
 *         role: { $ref: '#/components/schemas/UserRole' }
 *         createdAt: { type: string, format: date-time }
 */
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

/**
 * @openapi
 * components:
 *   schemas:
 *     CreateUserData:
 *       type: object
 *       required: [email, username, password]
 *       properties:
 *         email: { type: string, format: email }
 *         username: { type: string }
 *         password: { type: string, format: password }
 *         firstName: { type: string }
 *         lastName: { type: string }
 *         role: { $ref: '#/components/schemas/UserRole' }
 */
export interface CreateUserData {
  email: string;
  username: string;
  password: string;
  firstName?: string;
  lastName?: string;
  role?: UserRole;
}

/**
 * @openapi
 * components:
 *   schemas:
 *     UpdateUserData:
 *       type: object
 *       properties:
 *         username: { type: string }
 *         firstName: { type: string }
 *         lastName: { type: string }
 *         bio: { type: string }
 *         avatar: { type: string, format: uri }
 */
export interface UpdateUserData {
  username?: string;
  firstName?: string;
  lastName?: string;
  bio?: string;
  avatar?: string;
}

/**
 * @openapi
 * components:
 *   schemas:
 *     ChangePasswordData:
 *       type: object
 *       required: [currentPassword, newPassword]
 *       properties:
 *         currentPassword: { type: string, format: password }
 *         newPassword: { type: string, format: password }
 */
export interface ChangePasswordData {
  currentPassword: string;
  newPassword: string;
}

/**
 * @openapi
 * components:
 *   schemas:
 *     UpdateWalletData:
 *       type: object
 *       required: [walletAddress]
 *       properties:
 *         walletAddress: { type: string }
 */
export interface UpdateWalletData {
  walletAddress: string;
}

/**
 * @openapi
 * components:
 *   schemas:
 *     UserRole:
 *       type: string
 *       enum: [admin, learner, instructor]
 *     UserStatus:
 *       type: string
 *       enum: [active, inactive, suspended, pending_verification]
 */
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
