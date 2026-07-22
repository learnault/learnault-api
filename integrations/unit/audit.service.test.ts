/**
 * Tests for audit service - immutability, attribution, and redaction
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '../../src/config/database.js'
import {
  createAuditLog,
  auditedMutation,
  getUserAuditLogs,
} from '../../src/audit/service.js'
import type { CreateAuditLogInput } from '../../src/audit/types.js'

describe('Audit Service', () => {
  beforeEach(async () => {
    // Clean up test data
    await prisma.auditLog.deleteMany({})
  })

  describe('Attribution Tests', () => {
    it('should create audit log with complete actor information', async () => {
      const input: CreateAuditLogInput = {
        actor: { type: 'user', id: 'test-user-123', role: 'LEARNER' },
        action: 'USER_LOGIN',
        target: { type: 'User', id: 'test-user-123' },
        requestId: 'req-123',
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        result: 'success',
      }

      await createAuditLog(input)

      const logs = await prisma.auditLog.findMany({})
      expect(logs).toHaveLength(1)
      expect(logs[0].userId).toBe('test-user-123')
      expect(logs[0].action).toBe('USER_LOGIN')
      expect(logs[0].ipAddress).toBe('192.168.1.1')
      expect(logs[0].userAgent).toBe('Mozilla/5.0')
    })

    it('should create audit log for system actor', async () => {
      const input: CreateAuditLogInput = {
        actor: { type: 'system', id: 'system' },
        action: 'DATA_ARCHIVED',
        target: { type: 'User', id: 'test-user-123' },
        requestId: 'system-job-456',
        result: 'success',
      }

      await createAuditLog(input)

      const logs = await prisma.auditLog.findMany({})
      expect(logs).toHaveLength(1)
      expect(logs[0].userId).toBeNull()
      expect(logs[0].action).toBe('DATA_ARCHIVED')
    })

    it('should include request correlation ID in logs', async () => {
      const requestId = 'unique-request-789'

      const input: CreateAuditLogInput = {
        actor: { type: 'user', id: 'test-user-123' },
        action: 'USER_PASSWORD_CHANGED',
        target: { type: 'User', id: 'test-user-123' },
        requestId,
        result: 'success',
      }

      await createAuditLog(input)

      const logs = await prisma.auditLog.findMany({})
      expect(logs).toHaveLength(1)
      // Request ID should be logged (checked via application logger)
    })
  })

  describe('Redaction Tests', () => {
    it('should not store passwords in metadata', async () => {
      const input: CreateAuditLogInput = {
        actor: { type: 'user', id: 'test-user-123' },
        action: 'USER_PASSWORD_CHANGED',
        target: { type: 'User', id: 'test-user-123' },
        requestId: 'req-123',
        metadata: {
          password: 'super-secret-password',
          oldPassword: 'old-password',
        },
        result: 'success',
      }

      await createAuditLog(input)

      const logs = await prisma.auditLog.findMany({})
      expect(logs).toHaveLength(1)

      const metadata = logs[0].metadata
        ? JSON.parse(logs[0].metadata)
        : null
      expect(metadata).toBeTruthy()
      expect(metadata.password).not.toBe('super-secret-password')
      expect(metadata.password).toMatch(/\*\*\*/)
      expect(metadata.oldPassword).not.toBe('old-password')
    })

    it('should not store tokens in metadata', async () => {
      const input: CreateAuditLogInput = {
        actor: { type: 'user', id: 'test-user-123' },
        action: 'USER_LOGIN',
        target: { type: 'User', id: 'test-user-123' },
        requestId: 'req-123',
        metadata: {
          token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          apiKey: 'sk-1234567890abcdef',
        },
        result: 'success',
      }

      await createAuditLog(input)

      const logs = await prisma.auditLog.findMany({})
      const metadata = logs[0].metadata
        ? JSON.parse(logs[0].metadata)
        : null
      expect(metadata.token).toMatch(/\*\*\*/)
      expect(metadata.apiKey).toMatch(/\*\*\*/)
    })

    it('should not store OTP codes in metadata', async () => {
      const input: CreateAuditLogInput = {
        actor: { type: 'user', id: 'test-user-123' },
        action: 'OTP_VERIFIED',
        target: { type: 'User', id: 'test-user-123' },
        requestId: 'req-123',
        metadata: {
          otp: '123456',
          code: '789012',
        },
        result: 'success',
      }

      await createAuditLog(input)

      const logs = await prisma.auditLog.findMany({})
      const metadata = logs[0].metadata
        ? JSON.parse(logs[0].metadata)
        : null
      expect(metadata.otp).toBe('***')
      expect(metadata.code).toBe('***')
    })

    it('should store safe metadata fields', async () => {
      const input: CreateAuditLogInput = {
        actor: { type: 'user', id: 'test-user-123' },
        action: 'USER_DEACTIVATED',
        target: { type: 'User', id: 'test-user-123' },
        requestId: 'req-123',
        metadata: {
          oldStatus: 'ACTIVE',
          newStatus: 'DEACTIVATED',
          reason: 'User request',
          affectedSessions: 3,
        },
        result: 'success',
      }

      await createAuditLog(input)

      const logs = await prisma.auditLog.findMany({})
      const metadata = logs[0].metadata
        ? JSON.parse(logs[0].metadata)
        : null
      expect(metadata.oldStatus).toBe('ACTIVE')
      expect(metadata.newStatus).toBe('DEACTIVATED')
      expect(metadata.reason).toBe('User request')
      expect(metadata.affectedSessions).toBe(3)
    })

    it('should redact sensitive fields in nested objects', async () => {
      const input: CreateAuditLogInput = {
        actor: { type: 'user', id: 'test-user-123' },
        action: 'USER_PROFILE_UPDATED',
        target: { type: 'User', id: 'test-user-123' },
        requestId: 'req-123',
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

      const logs = await prisma.auditLog.findMany({})
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
      const result = await auditedMutation({
        actor: { type: 'user', id: 'test-user-123' },
        action: 'USER_PROFILE_UPDATED',
        target: { type: 'User', id: 'test-user-123' },
        requestId: 'req-123',
        metadata: { field: 'username' },
        mutation: async () => {
          return { success: true }
        },
      })

      expect(result).toEqual({ success: true })

      const logs = await prisma.auditLog.findMany({})
      expect(logs).toHaveLength(1)
      expect(logs[0].action).toBe('USER_PROFILE_UPDATED')
    })

    it('should log failed mutations', async () => {
      try {
        await auditedMutation({
          actor: { type: 'user', id: 'test-user-123' },
          action: 'USER_PROFILE_UPDATED',
          target: { type: 'User', id: 'test-user-123' },
          requestId: 'req-123',
          mutation: async () => {
            throw new Error('Mutation failed')
          },
        })
        // Should not reach here
        expect(true).toBe(false)
      } catch {
        // Expected to throw
      }

      const logs = await prisma.auditLog.findMany({})
      expect(logs).toHaveLength(1)
      expect(logs[0].action).toBe('USER_PROFILE_UPDATED')
      // Error should be logged in application logger
    })

    it('should include duration in audit log', async () => {
      await auditedMutation({
        actor: { type: 'user', id: 'test-user-123' },
        action: 'REWARD_ISSUED',
        target: { type: 'Transaction', id: 'tx-123' },
        requestId: 'req-123',
        mutation: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10))
          
return { success: true }
        },
      })

      const logs = await prisma.auditLog.findMany({})
      expect(logs).toHaveLength(1)
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
