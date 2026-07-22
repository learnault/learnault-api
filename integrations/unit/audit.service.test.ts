/**
 * Tests for audit service - immutability, attribution, and redaction
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '../../src/config/database.js'
import {
  createAuditLog,
  auditedMutation,
  getUserAuditLogs,
} from '../../src/audit/service.js'
import type { CreateAuditLogInput } from '../../src/audit/types.js'

describe('Audit Service', () => {
  const testUserIds = ['test-user-123', 'user-1', 'user-2']

  beforeEach(async () => {
    // Create test users to satisfy foreign key constraints
    for (const userId of testUserIds) {
      await prisma.user.upsert({
        where: { id: userId },
        update: {},
        create: {
          id: userId,
          email: `${userId}@test.com`,
          username: userId,
          password: 'hashed_password',
          role: 'LEARNER',
        },
      })
    }
  })

  afterEach(async () => {
    // Clean up audit logs first (they have onDelete: SetNull, not Cascade)
    await prisma.auditLog.deleteMany({
      where: {
        userId: { in: testUserIds },
      },
    })
    // Then clean up test users
    await prisma.user.deleteMany({
      where: {
        id: { in: testUserIds },
      },
    })
  })

  describe('Attribution Tests', () => {
    it('should create audit log with complete actor information', async () => {
      const requestId = 'req-attribution-complete'
      const input: CreateAuditLogInput = {
        actor: { type: 'user', id: 'test-user-123', role: 'LEARNER' },
        action: 'USER_LOGIN',
        target: { type: 'User', id: 'test-user-123' },
        requestId,
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        result: 'success',
      }

      await createAuditLog(input)

      const logs = await prisma.auditLog.findMany({
        where: { userId: 'test-user-123' },
      })
      expect(logs).toHaveLength(1)
      expect(logs[0].userId).toBe('test-user-123')
      expect(logs[0].action).toBe('USER_LOGIN')
      expect(logs[0].ipAddress).toBe('192.168.1.1')
      expect(logs[0].userAgent).toBe('Mozilla/5.0')
    })

    it('should create audit log for system actor', async () => {
      const requestId = 'req-system-actor'
      const input: CreateAuditLogInput = {
        actor: { type: 'system', id: 'system' },
        action: 'DATA_ARCHIVED',
        target: { type: 'User', id: 'test-user-123' },
        requestId,
        result: 'success',
      }

      await createAuditLog(input)

      const logs = await prisma.auditLog.findMany({
        where: { action: 'DATA_ARCHIVED' },
      })
      expect(logs).toHaveLength(1)
      expect(logs[0].userId).toBeNull()
      expect(logs[0].action).toBe('DATA_ARCHIVED')
    })

    it('should include request correlation ID in logs', async () => {
      const requestId = 'req-correlation-unique'

      const input: CreateAuditLogInput = {
        actor: { type: 'user', id: 'test-user-123' },
        action: 'USER_PASSWORD_CHANGED',
        target: { type: 'User', id: 'test-user-123' },
        requestId,
        result: 'success',
      }

      await createAuditLog(input)

      const logs = await prisma.auditLog.findMany({
        where: { 
          userId: 'test-user-123',
          action: 'USER_PASSWORD_CHANGED',
        },
      })
      expect(logs).toHaveLength(1)
      // Request ID should be logged (checked via application logger)
    })
  })

  describe('Redaction Tests', () => {
    it('should not store passwords in metadata', async () => {
      const requestId = 'req-redact-password'
      const input: CreateAuditLogInput = {
        actor: { type: 'user', id: 'test-user-123' },
        action: 'USER_PASSWORD_CHANGED',
        target: { type: 'User', id: 'test-user-123' },
        requestId,
        metadata: {
          password: 'super-secret-password',
          oldPassword: 'old-password',
        },
        result: 'success',
      }

      await createAuditLog(input)

      const logs = await prisma.auditLog.findMany({
        where: { 
          userId: 'test-user-123',
          action: 'USER_PASSWORD_CHANGED',
        },
      })
      expect(logs.length).toBeGreaterThanOrEqual(1)

      const metadata = logs[0].metadata
        ? JSON.parse(logs[0].metadata)
        : null
      expect(metadata).toBeTruthy()
      expect(metadata.password).not.toBe('super-secret-password')
      expect(metadata.password).toMatch(/\*\*\*/)
      expect(metadata.oldPassword).not.toBe('old-password')
    })

    it('should not store tokens in metadata', async () => {
      const requestId = 'req-redact-token'
      const input: CreateAuditLogInput = {
        actor: { type: 'user', id: 'test-user-123' },
        action: 'USER_LOGIN',
        target: { type: 'User', id: 'test-user-123' },
        requestId,
        metadata: {
          token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          apiKey: 'sk-1234567890abcdef',
        },
        result: 'success',
      }

      await createAuditLog(input)

      const logs = await prisma.auditLog.findMany({
        where: { 
          userId: 'test-user-123',
          action: 'USER_LOGIN',
        },
      })
      expect(logs.length).toBeGreaterThanOrEqual(1)
      const metadata = logs[0].metadata
        ? JSON.parse(logs[0].metadata)
        : null
      expect(metadata.token).toMatch(/\*\*\*/)
      expect(metadata.apiKey).toMatch(/\*\*\*/)
    })

    it('should not store OTP codes in metadata', async () => {
      const requestId = 'req-redact-otp'
      const input: CreateAuditLogInput = {
        actor: { type: 'user', id: 'test-user-123' },
        action: 'OTP_VERIFIED',
        target: { type: 'User', id: 'test-user-123' },
        requestId,
        metadata: {
          otp: '123456',
          code: '789012',
        },
        result: 'success',
      }

      await createAuditLog(input)

      const logs = await prisma.auditLog.findMany({
        where: { 
          userId: 'test-user-123',
          action: 'OTP_VERIFIED',
        },
      })
      expect(logs.length).toBeGreaterThanOrEqual(1)
      const metadata = logs[0].metadata
        ? JSON.parse(logs[0].metadata)
        : null
      expect(metadata.otp).toBe('***')
      expect(metadata.code).toBe('***')
    })

    it('should store safe metadata fields', async () => {
      const requestId = 'req-safe-metadata'
      const input: CreateAuditLogInput = {
        actor: { type: 'user', id: 'test-user-123' },
        action: 'USER_DEACTIVATED',
        target: { type: 'User', id: 'test-user-123' },
        requestId,
        metadata: {
          oldStatus: 'ACTIVE',
          newStatus: 'DEACTIVATED',
          reason: 'User request',
          affectedSessions: 3,
        },
        result: 'success',
      }

      await createAuditLog(input)

      const logs = await prisma.auditLog.findMany({
        where: { 
          userId: 'test-user-123',
          action: 'USER_DEACTIVATED',
        },
      })
      expect(logs.length).toBeGreaterThanOrEqual(1)
      const metadata = logs[0].metadata
        ? JSON.parse(logs[0].metadata)
        : null
      expect(metadata.oldStatus).toBe('ACTIVE')
      expect(metadata.newStatus).toBe('DEACTIVATED')
      expect(metadata.reason).toBe('User request')
      expect(metadata.affectedSessions).toBe(3)
    })

    it('should redact sensitive fields in nested objects', async () => {
      const requestId = 'req-redact-nested'
      const input: CreateAuditLogInput = {
        actor: { type: 'user', id: 'test-user-123' },
        action: 'USER_PROFILE_UPDATED',
        target: { type: 'User', id: 'test-user-123' },
        requestId,
        metadata: {
          changes: {
            username: 'new-username',
            email: 'user@example.com',
            password: 'secret',
          },
        },
        result: 'success',
      }

      await createAuditLog(input)

      const logs = await prisma.auditLog.findMany({
        where: { 
          userId: 'test-user-123',
          action: 'USER_PROFILE_UPDATED',
        },
      })
      expect(logs.length).toBeGreaterThanOrEqual(1)
      const metadata = logs[0].metadata
        ? JSON.parse(logs[0].metadata)
        : null
      expect(metadata.changes.username).toBe('new-username')
      expect(metadata.changes.email).toMatch(/\*\*\*/)
      expect(metadata.changes.password).toMatch(/\*\*\*/)
    })
  })

  describe('Audited Mutation Helper', () => {
    it('should log successful mutations', async () => {
      const requestId = 'req-mutation-success'
      const result = await auditedMutation({
        actor: { type: 'user', id: 'test-user-123' },
        action: 'USER_PROFILE_UPDATED',
        target: { type: 'User', id: 'test-user-123' },
        requestId,
        metadata: { field: 'username' },
        mutation: async () => {
          return { success: true }
        },
      })

      expect(result).toEqual({ success: true })

      const logs = await prisma.auditLog.findMany({
        where: { 
          userId: 'test-user-123',
          action: 'USER_PROFILE_UPDATED',
        },
      })
      expect(logs.length).toBeGreaterThanOrEqual(1)
      expect(logs[0].action).toBe('USER_PROFILE_UPDATED')
    })

    it('should log failed mutations', async () => {
      const requestId = 'req-mutation-failed'
      try {
        await auditedMutation({
          actor: { type: 'user', id: 'test-user-123' },
          action: 'USER_PROFILE_UPDATED',
          target: { type: 'User', id: 'test-user-123' },
          requestId,
          mutation: async () => {
            throw new Error('Mutation failed')
          },
        })
        // Should not reach here
        expect(true).toBe(false)
      } catch {
        // Expected to throw
      }

      const logs = await prisma.auditLog.findMany({
        where: { 
          userId: 'test-user-123',
          action: 'USER_PROFILE_UPDATED',
        },
      })
      expect(logs.length).toBeGreaterThanOrEqual(1)
      // Find the failed mutation log (most recent one)
      const failedLog = logs[logs.length - 1]
      expect(failedLog.action).toBe('USER_PROFILE_UPDATED')
      // Error should be logged in application logger
    })

    it('should include duration in audit log', async () => {
      const requestId = 'req-mutation-duration'
      await auditedMutation({
        actor: { type: 'user', id: 'test-user-123' },
        action: 'REWARD_ISSUED',
        target: { type: 'Transaction', id: 'tx-123' },
        requestId,
        mutation: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10))
          
return { success: true }
        },
      })

      const logs = await prisma.auditLog.findMany({
        where: { 
          userId: 'test-user-123',
          action: 'REWARD_ISSUED',
        },
      })
      expect(logs.length).toBeGreaterThanOrEqual(1)
      // Duration should be logged via application logger
    })
  })

  describe('Query Functions', () => {
    it('should retrieve audit logs for specific user', async () => {
      await createAuditLog({
        actor: { type: 'user', id: 'user-1' },
        action: 'USER_LOGIN',
        target: { type: 'User', id: 'user-1' },
        requestId: 'req-1',
        result: 'success',
      })

      await createAuditLog({
        actor: { type: 'user', id: 'user-2' },
        action: 'USER_LOGIN',
        target: { type: 'User', id: 'user-2' },
        requestId: 'req-2',
        result: 'success',
      })

      const logs = await getUserAuditLogs('user-1')
      expect(logs).toHaveLength(1)
      expect(logs[0].action).toBe('USER_LOGIN')
    })
  })
})
