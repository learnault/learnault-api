/**
 * Audit types and interfaces for immutable audit trail
 */

export type ActorType = 'user' | 'system' | 'admin';
export type AuditResult = 'success' | 'failure';

export interface AuditActor {
  type: ActorType;
  id: string;
  role?: string;
}

export interface AuditTarget {
  type: string;
  id: string;
}

export interface AuditMetadata {
  [key: string]: unknown;
}

export interface CreateAuditLogInput {
  actor: AuditActor;
  action: AuditAction;
  target: AuditTarget;
  reason?: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: AuditMetadata;
  result: AuditResult;
  error?: string;
  duration?: number;
}

/**
 * Comprehensive list of audited actions
 */
export type AuditAction =
  // Account Lifecycle
  | 'USER_REGISTERED'
  | 'USER_EMAIL_VERIFIED'
  | 'USER_PHONE_VERIFIED'
  | 'USER_LOGIN'
  | 'USER_LOGOUT'
  | 'USER_PASSWORD_CHANGED'
  | 'USER_PASSWORD_RESET_REQUESTED'
  | 'USER_PASSWORD_RESET_COMPLETED'
  | 'USER_PROFILE_UPDATED'
  | 'USER_DEACTIVATED'
  | 'USER_REACTIVATED'
  | 'USER_DELETION_REQUESTED'
  | 'USER_DELETION_CANCELLED'
  | 'USER_DELETED'
  | 'USER_ANONYMIZED'
  // Financial Events
  | 'REWARD_ISSUED'
  | 'REWARD_CLAIMED'
  | 'WITHDRAWAL_REQUESTED'
  | 'WITHDRAWAL_COMPLETED'
  | 'WITHDRAWAL_FAILED'
  | 'REFERRAL_BONUS_PAID'
  // Credential Events
  | 'CREDENTIAL_ISSUED'
  | 'CREDENTIAL_REVOKED'
  // Data Privacy Events
  | 'DATA_EXPORT_REQUESTED'
  | 'DATA_EXPORT_DOWNLOADED'
  | 'DATA_RETENTION_APPLIED'
  | 'DATA_ARCHIVED'
  | 'DATA_PURGED'
  // Security Events
  | 'LOGIN_FAILED'
  | 'OTP_SENT'
  | 'OTP_VERIFIED'
  | 'OTP_FAILED'
  | 'SESSION_REVOKED'
  | 'SUSPICIOUS_ACTIVITY_DETECTED'
  // Learning Events
  | 'MODULE_COMPLETED'
  | 'MODULE_STARTED'
  // Preference Events
  | 'PREFERENCES_UPDATED';

/**
 * Options for audited mutation helper
 */
export interface AuditedMutationOptions<T> {
  actor: AuditActor;
  action: AuditAction;
  target: AuditTarget;
  reason?: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: AuditMetadata;
  mutation: () => Promise<T>;
}

/**
 * Immutable models that cannot be modified after creation
 */
export const IMMUTABLE_MODELS = [
  'AuditLog',
  'Transaction',
  'Credential',
  'Completion',
  'PreferenceAuditLog',
] as const

export type ImmutableModel = (typeof IMMUTABLE_MODELS)[number];
