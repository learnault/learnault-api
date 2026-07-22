/**
 * Audit Service - Immutable audit trail management
 */

import { prisma } from '../config/database.js'
import logger from '../config/logger.js'
import type {
  CreateAuditLogInput,
  AuditedMutationOptions,
} from './types.js'
import { sanitizeMetadata } from './utils.js'

/**
 * Create an immutable audit log entry
 */
export async function createAuditLog(
  input: CreateAuditLogInput
): Promise<void> {
  try {
    // Sanitize metadata to remove secrets and minimize PII
    const safeMetadata = input.metadata
      ? sanitizeMetadata(input.metadata)
      : null

    // Create audit log (immutable - cannot be updated or deleted)
    await prisma.auditLog.create({
      data: {
        userId: input.actor.type === 'user' ? input.actor.id : null,
        action: input.action,
        metadata: safeMetadata ? JSON.stringify(safeMetadata) : null,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    })

    // Log to application logger for operational visibility
    logger.info('Audit event recorded', {
      requestId: input.requestId,
      action: input.action,
      actor: `${input.actor.type}:${input.actor.id}`,
      target: `${input.target.type}:${input.target.id}`,
      result: input.result,
      duration: input.duration,
    })
  } catch (error) {
    // CRITICAL: Audit logging failure should be logged but not throw
    // to avoid breaking business operations
    logger.error('Failed to create audit log', {
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: input.requestId,
      action: input.action,
    })
  }
}

/**
 * Audited mutation helper - wraps mutations with automatic audit logging
 *
 * @example
 * ```typescript
 * const result = await auditedMutation({
 *   actor: { type: 'user', id: userId, role: 'LEARNER' },
 *   action: 'USER_PASSWORD_CHANGED',
 *   target: { type: 'User', id: userId },
 *   requestId: req.requestId,
 *   ipAddress: req.ip,
 *   userAgent: req.headers['user-agent'],
 *   metadata: { method: 'password_reset_flow' },
 *   mutation: async () => {
 *     return prisma.user.update({
 *       where: { id: userId },
 *       data: { password: hashedPassword },
 *     });
 *   },
 * });
 * ```
 */
export async function auditedMutation<T>(
  options: AuditedMutationOptions<T>
): Promise<T> {
  const startTime = Date.now()

  try {
    // Execute the mutation
    const result = await options.mutation()

    // Log success
    await createAuditLog({
      ...options,
      result: 'success',
      duration: Date.now() - startTime,
    })

    return result
  } catch (error) {
    // Log failure
    await createAuditLog({
      ...options,
      result: 'failure',
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: Date.now() - startTime,
    })

    // Re-throw to maintain error flow
    throw error
  }
}

/**
 * Get audit logs for a specific user (for user data export)
 */
export async function getUserAuditLogs(userId: string) {
  return prisma.auditLog.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      action: true,
      metadata: true,
      ipAddress: true,
      createdAt: true,
    },
  })
}

/**
 * Get audit logs for a specific action
 */
export async function getAuditLogsByAction(
  action: string,
  limit = 100,
  offset = 0
) {
  return prisma.auditLog.findMany({
    where: { action },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
    select: {
      id: true,
      userId: true,
      action: true,
      metadata: true,
      ipAddress: true,
      userAgent: true,
      createdAt: true,
    },
  })
}

/**
 * Get recent audit logs (for admin monitoring)
 */
export async function getRecentAuditLogs(limit = 100, offset = 0) {
  return prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
    select: {
      id: true,
      userId: true,
      action: true,
      metadata: true,
      ipAddress: true,
      userAgent: true,
      createdAt: true,
    },
  })
}

/**
 * Get audit log statistics (for monitoring)
 */
export async function getAuditStats(startDate: Date, endDate: Date) {
  const logs = await prisma.auditLog.findMany({
    where: {
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    },
    select: {
      action: true,
    },
  })

  // Count by action
  const countByAction = logs.reduce(
    (acc, log) => {
      acc[log.action] = (acc[log.action] || 0) + 1
      
return acc
    },
    {} as Record<string, number>
  )

  return {
    total: logs.length,
    countByAction,
    startDate,
    endDate,
  }
}
