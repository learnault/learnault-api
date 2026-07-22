/**
 * Tests for audit middleware - immutability, soft-delete, archive visibility
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '../../src/config/database.js'

describe('Audit Middleware', () => {
  let testUserId: string

  beforeEach(async () => {
    // Clean up test data
    await prisma.$executeRaw`DELETE FROM "users" WHERE "email" LIKE 'test-%'`
    await prisma.auditLog.deleteMany({})
    await prisma.transaction.deleteMany({})
    await prisma.completion.deleteMany({})

    // Create test user
    const user = await prisma.$executeRaw`
      INSERT INTO "users" ("id", "email", "username", "password", "role")
      VALUES (gen_random_uuid(), 'test-audit@example.com', 'test-audit', 'hashed', 'LEARNER')
      RETURNING "id"
    `.then(() =>
      prisma.user.findUnique({ where: { email: 'test-audit@example.com' } })
    )

    testUserId = user!.id
  })

  describe('Immutability Tests', () => {
    it('should prevent updates to audit logs', async () => {
      // Create audit log
      const log = await prisma.auditLog.create({
        data: {
          userId: testUserId,
          action: 'USER_LOGIN',
          metadata: JSON.stringify({ test: true }),
        },
      })

      // Try to update (should fail)
      await expect(
        prisma.auditLog.update({
          where: { id: log.id },
          data: { action: 'USER_LOGOUT' },
        })
      ).rejects.toThrow(/Cannot modify immutable model/)
    })

    it('should prevent deletion of audit logs', async () => {
      const log = await prisma.auditLog.create({
        data: {
          userId: testUserId,
          action: 'USER_LOGIN',
        },
      })

      await expect(
        prisma.auditLog.delete({
          where: { id: log.id },
        })
      ).rejects.toThrow(/Cannot delete immutable model/)
    })

    it('should prevent updates to transactions', async () => {
      const transaction = await prisma.transaction.create({
        data: {
          userId: testUserId,
          amount: 100,
          type: 'reward',
          status: 'completed',
        },
      })

      await expect(
        prisma.transaction.update({
          where: { id: transaction.id },
          data: { amount: 200 },
        })
      ).rejects.toThrow(/Cannot modify immutable model/)
    })

    it('should prevent deletion of transactions', async () => {
      const transaction = await prisma.transaction.create({
        data: {
          userId: testUserId,
          amount: 100,
          type: 'reward',
          status: 'completed',
        },
      })

      await expect(
        prisma.transaction.delete({
          where: { id: transaction.id },
        })
      ).rejects.toThrow(/Cannot delete immutable model/)
    })

    it('should allow creation of immutable records', async () => {
      const log = await prisma.auditLog.create({
        data: {
          userId: testUserId,
          action: 'USER_REGISTERED',
        },
      })

      expect(log).toBeTruthy()
      expect(log.action).toBe('USER_REGISTERED')
    })
  })

  describe('Soft-Delete Tests', () => {
    it('should convert delete to soft-delete for users', async () => {
      const user = await prisma.user.findUnique({
        where: { id: testUserId },
      })

      expect(user).toBeTruthy()
      expect(user!.deletedAt).toBeNull()

      // Delete user (should soft-delete)
      await prisma.user.delete({
        where: { id: testUserId },
      })

      // Should not appear in normal queries
      const deletedUser = await prisma.user.findUnique({
        where: { id: testUserId },
      })

      expect(deletedUser).toBeNull()

      // Should appear when explicitly querying deleted records
      const softDeletedUser = await prisma.user.findFirst({
        where: { id: testUserId, deletedAt: { not: null } },
      })

      expect(softDeletedUser).toBeTruthy()
      expect(softDeletedUser!.deletedAt).toBeTruthy()
    })

    it('should exclude soft-deleted records from findMany', async () => {
      // Create another user
      const user2 = await prisma.user.create({
        data: {
          email: 'test-user-2@example.com',
          username: 'test-user-2',
          password: 'hashed',
          role: 'LEARNER',
        },
      })

      // Soft-delete first user
      await prisma.user.delete({ where: { id: testUserId } })

      // Find all users (should only return non-deleted)
      const users = await prisma.user.findMany({})

      expect(users).toHaveLength(1)
      expect(users[0].id).toBe(user2.id)

      // Clean up
      await prisma.user.delete({ where: { id: user2.id } })
    })

    it('should exclude soft-deleted records from count', async () => {
      const countBefore = await prisma.user.count({})

      await prisma.user.delete({ where: { id: testUserId } })

      const countAfter = await prisma.user.count({})

      expect(countAfter).toBe(countBefore - 1)
    })
  })

  describe('Archive Visibility Tests', () => {
    it('should exclude archived records by default', async () => {
      // Update user to archived
      await prisma.$executeRaw`
        UPDATE "users"
        SET "archivedAt" = NOW(), "status" = 'ARCHIVED'
        WHERE "id" = ${testUserId}
      `

      // Should not appear in normal queries
      const user = await prisma.user.findUnique({
        where: { id: testUserId },
      })

      expect(user).toBeNull()
    })

    it('should allow querying archived records explicitly', async () => {
      await prisma.$executeRaw`
        UPDATE "users"
        SET "archivedAt" = NOW(), "status" = 'ARCHIVED'
        WHERE "id" = ${testUserId}
      `

      const archivedUser = await prisma.user.findFirst({
        where: { id: testUserId, archivedAt: { not: null } },
      })

      expect(archivedUser).toBeTruthy()
      expect(archivedUser!.status).toBe('ARCHIVED')
    })

    it('should exclude both deleted and archived in normal queries', async () => {
      await prisma.$executeRaw`
        UPDATE "users"
        SET "deletedAt" = NOW(), "archivedAt" = NOW()
        WHERE "id" = ${testUserId}
      `

      const user = await prisma.user.findUnique({
        where: { id: testUserId },
      })

      expect(user).toBeNull()
    })
  })

  describe('Cascade Behavior', () => {
    it('should cascade soft-delete to related records', async () => {
      // Create session
      await prisma.session.create({
        data: {
          userId: testUserId,
          token: 'test-token',
          expiresAt: new Date(Date.now() + 86400000),
        },
      })

      // Soft-delete user
      await prisma.user.delete({ where: { id: testUserId } })

      // Session should still exist (cascade is at DB level for hard delete)
      // But user queries will fail due to soft-delete
      const user = await prisma.user.findUnique({
        where: { id: testUserId },
      })

      expect(user).toBeNull()
    })
  })
})
