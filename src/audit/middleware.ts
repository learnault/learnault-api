/**
 * Prisma client extensions for enforcing data lifecycle policies
 * Note: Prisma v7+ uses client extensions instead of middleware
 */

import { Prisma, PrismaClient } from '@prisma/client'
import { ForbiddenError } from '../utils/errors.js'
import { IMMUTABLE_MODELS } from './types.js'

/**
 * Soft-delete models list
 */
const SOFT_DELETE_MODELS = [
  'User',
  'Session',
  'Module',
  'LearnerPreference',
  'NotificationLog',
  'DeviceToken',
  'VerificationToken',
  'OtpChallenge',
] as const

/**
 * Archivable models list
 */
const ARCHIVABLE_MODELS = [
  'User',
  'Session',
  'Module',
  'LearnerPreference',
  'NotificationLog',
  'DeviceToken',
  'VerificationToken',
  'OtpChallenge',
] as const

/**
 * Data lifecycle extension for Prisma Client
 * Provides soft-delete, archive visibility, and immutability enforcement
 */
export function createDataLifecycleExtension() {
  return Prisma.defineExtension((client) => {
    return client.$extends({
      name: 'dataLifecycle',
      query: {
        // Apply immutability checks to all immutable models
        $allModels: {
          async update({ args, query, model }) {
            const allowCleanup = (args as any)?.allowAuditCleanup || process.env.ALLOW_AUDIT_CLEANUP === 'true'
            if (args && 'allowAuditCleanup' in (args as any)) {
              delete (args as any).allowAuditCleanup
            }
            if (!allowCleanup && IMMUTABLE_MODELS.includes(model as any)) {
              throw new ForbiddenError(
                `Cannot modify immutable model: ${model}. Audit data is append-only.`
              )
            }
            
            return query(args)
          },
          async updateMany({ args, query, model }) {
            const allowCleanup = (args as any)?.allowAuditCleanup || process.env.ALLOW_AUDIT_CLEANUP === 'true'
            if (args && 'allowAuditCleanup' in (args as any)) {
              delete (args as any).allowAuditCleanup
            }
            if (!allowCleanup && IMMUTABLE_MODELS.includes(model as any)) {
              throw new ForbiddenError(
                `Cannot modify immutable model: ${model}. Audit data is append-only.`
              )
            }
            
            return query(args)
          },
          async delete({ args, query, model }) {
            const allowCleanup = (args as any)?.allowAuditCleanup || process.env.ALLOW_AUDIT_CLEANUP === 'true'
            if (args && 'allowAuditCleanup' in (args as any)) {
              delete (args as any).allowAuditCleanup
            }
            if (!allowCleanup && IMMUTABLE_MODELS.includes(model as any)) {
              throw new ForbiddenError(
                `Cannot delete immutable model: ${model}. Audit data must be retained.`
              )
            }
            // Convert delete to soft-delete for soft-deletable models
            if (SOFT_DELETE_MODELS.includes(model as any)) {
              return (client as any)[model].update({
                ...args,
                data: { deletedAt: new Date() },
              })
            }
            
            return query(args)
          },
          async deleteMany({ args, query, model }) {
            const allowCleanup = (args as any)?.allowAuditCleanup || process.env.ALLOW_AUDIT_CLEANUP === 'true'
            if (args && 'allowAuditCleanup' in (args as any)) {
              delete (args as any).allowAuditCleanup
            }
            if (!allowCleanup && IMMUTABLE_MODELS.includes(model as any)) {
              throw new ForbiddenError(
                `Cannot delete immutable model: ${model}. Audit data must be retained.`
              )
            }
            // Convert deleteMany to updateMany for soft-delete
            if (SOFT_DELETE_MODELS.includes(model as any)) {
              return (client as any)[model].updateMany({
                ...args,
                data: { deletedAt: new Date() },
              })
            }
            
            return query(args)
          },
          async findUnique({ args, query, model }) {
            // Exclude soft-deleted and archived records
            if (SOFT_DELETE_MODELS.includes(model as any)) {
              args.where = { ...args.where, deletedAt: null }
            }
            if (ARCHIVABLE_MODELS.includes(model as any)) {
              args.where = { ...args.where, archivedAt: null }
            }
            
return query(args)
          },
          async findFirst({ args, query, model }) {
            if (SOFT_DELETE_MODELS.includes(model as any)) {
              args.where = { ...args.where, deletedAt: null }
            }
            if (ARCHIVABLE_MODELS.includes(model as any)) {
              args.where = { ...args.where, archivedAt: null }
            }
            
return query(args)
          },
          async findMany({ args, query, model }) {
            // Only apply if not explicitly querying deleted/archived
            if (
              SOFT_DELETE_MODELS.includes(model as any) &&
              !(args.where && 'deletedAt' in args.where)
            ) {
              args.where = { ...args.where, deletedAt: null }
            }
            if (
              ARCHIVABLE_MODELS.includes(model as any) &&
              !(args.where && 'archivedAt' in args.where)
            ) {
              args.where = { ...args.where, archivedAt: null }
            }
            
return query(args)
          },
          async count({ args, query, model }) {
            if (SOFT_DELETE_MODELS.includes(model as any)) {
              args.where = { ...args.where, deletedAt: null }
            }
            if (ARCHIVABLE_MODELS.includes(model as any)) {
              args.where = { ...args.where, archivedAt: null }
            }
            
return query(args)
          },
        },
      },
    })
  })
}

/**
 * Register data lifecycle extension to Prisma Client
 */
export function registerDataLifecycleMiddleware(
  prismaClient: PrismaClient
): PrismaClient {
  // In Prisma v7, extensions return a new client instance
  // The extension is applied in the database.ts file during client creation
  return prismaClient.$extends(createDataLifecycleExtension()) as any
}
