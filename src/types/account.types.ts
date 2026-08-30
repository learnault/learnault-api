// ── Account lifecycle (export / deactivation / deletion) ───

export const AccountStatus = {
  ACTIVE: 'ACTIVE',
  DEACTIVATED: 'DEACTIVATED',
  PENDING_DELETION: 'PENDING_DELETION',
  DELETED: 'DELETED',
} as const

export type AccountStatusValue =
  (typeof AccountStatus)[keyof typeof AccountStatus]

export const ExportStatus = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  READY: 'ready',
  FAILED: 'failed',
  EXPIRED: 'expired',
} as const

export type ExportStatusValue = (typeof ExportStatus)[keyof typeof ExportStatus]

export const DeletionStatus = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  FAILED: 'failed',
} as const

export type DeletionStatusValue =
  (typeof DeletionStatus)[keyof typeof DeletionStatus]

export const AuditAction = {
  EXPORT_REQUESTED: 'EXPORT_REQUESTED',
  EXPORT_READY: 'EXPORT_READY',
  EXPORT_DOWNLOADED: 'EXPORT_DOWNLOADED',
  EXPORT_PURGED: 'EXPORT_PURGED',
  ACCOUNT_DEACTIVATED: 'ACCOUNT_DEACTIVATED',
  ACCOUNT_REACTIVATED: 'ACCOUNT_REACTIVATED',
  DELETION_REQUESTED: 'DELETION_REQUESTED',
  DELETION_CANCELLED: 'DELETION_CANCELLED',
  DELETION_COMPLETED: 'DELETION_COMPLETED',
  STEP_UP_FAILED: 'STEP_UP_FAILED',
} as const

export type AuditActionValue = (typeof AuditAction)[keyof typeof AuditAction]

export interface AuditEntry {
  userId: string
  action: AuditActionValue | string
  metadata?: Record<string, unknown>
  ipAddress?: string
  userAgent?: string
}

export interface RequestContext {
  ipAddress?: string
  userAgent?: string
}
