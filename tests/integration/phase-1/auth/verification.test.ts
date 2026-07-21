import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createClient } from '../helpers/api-client'
import { cleanupDatabase } from '../helpers/database'
import { createUser } from '../factories/user.factory'
import { createVerificationToken, createExpiredVerificationToken } from '../factories/session.factory'
import { assertVerificationToken, assertAuditLog } from '../helpers/assertions'
import prisma from '../../../../src/config/database'

describe('Email Verification', () => {
  const client = createClient()

  beforeEach(async () => {
    await cleanupDatabase()
  })

  afterEach(async () => {
    await cleanupDatabase()
  })

  describe('POST /auth/verify-email', () => {
    it('should verify email with valid token', async () => {
      const { user } = await createUser({ isVerified: false })
      const { tokenValue } = await createVerificationToken(user.id, 'EMAIL_VERIFICATION', 'PENDING')

      const response = await client.post('/auth/verify-email', {
        token: tokenValue,
      })

      expect(response.status).toBe(200)
      expect(response.body.message).toContain('verified')

      // Verify user's email verification status
      const updatedUser = await prisma.user.findUnique({ where: { id: user.id } })
      expect(updatedUser!.isVerified).toBe(true)

      // Verify token marked as USED
      await assertVerificationToken(user.id, 'EMAIL_VERIFICATION', 'USED')

      // Verify audit log
      await assertAuditLog(user.id, 'EMAIL_VERIFIED')
    })

    it('should return 200 if email already verified', async () => {
      const { user } = await createUser({ isVerified: true })
      const { tokenValue } = await createVerificationToken(user.id, 'EMAIL_VERIFICATION', 'USED')

      const response = await client.post('/auth/verify-email', {
        token: tokenValue,
      })

      expect(response.status).toBe(200)
      expect(response.body.message).toContain('already verified')
    })

    it('should return 400 for invalid token format', async () => {
      const response = await client.post('/auth/verify-email', {
        token: 'invalid-token',
      })

      expect(response.status).toBe(400)
    })

    it('should return 400 for expired token', async () => {
      const { user } = await createUser({ isVerified: false })
      const { tokenValue } = await createExpiredVerificationToken(user.id, 'EMAIL_VERIFICATION')

      const response = await client.post('/auth/verify-email', {
        token: tokenValue,
      })

      expect(response.status).toBe(400)
      expect(response.body.error).toContain('expired')

      // Verify token marked as EXPIRED
      await assertVerificationToken(user.id, 'EMAIL_VERIFICATION', 'EXPIRED')
    })

    it('should return 400 for revoked token', async () => {
      const { user } = await createUser({ isVerified: false })
      const { tokenValue } = await createVerificationToken(user.id, 'EMAIL_VERIFICATION', 'REVOKED')

      const response = await client.post('/auth/verify-email', {
        token: tokenValue,
      })

      expect(response.status).toBe(400)
      expect(response.body.error).toContain('invalid')
    })

    it('should prevent token reuse', async () => {
      const { user } = await createUser({ isVerified: false })
      const { tokenValue } = await createVerificationToken(user.id, 'EMAIL_VERIFICATION', 'PENDING')

      // First verification
      const first = await client.post('/auth/verify-email', { token: tokenValue })
      expect(first.status).toBe(200)

      // Second verification with same token
      const second = await client.post('/auth/verify-email', { token: tokenValue })
      expect(second.status).toBe(400)
    })

    it('should handle token for non-existent user gracefully', async () => {
      const { user } = await createUser()
      const { tokenValue } = await createVerificationToken(user.id)
      
      // Delete the user
      await prisma.user.delete({ where: { id: user.id } })

      const response = await client.post('/auth/verify-email', {
        token: tokenValue,
      })

      expect(response.status).toBe(400)
    })
  })

  describe('POST /auth/resend-verification', () => {
    it('should resend verification email for unverified user', async () => {
      const { user } = await createUser({ isVerified: false })

      const response = await client.post('/auth/resend-verification', {
        email: user.email,
      })

      expect(response.status).toBe(200)
      expect(response.body.message).toContain('verification email has been sent')

      // Verify new token created
      const tokens = await prisma.verificationToken.findMany({
        where: { userId: user.id, type: 'EMAIL_VERIFICATION' },
        orderBy: { createdAt: 'desc' },
      })

      expect(tokens.length).toBeGreaterThan(0)
      expect(tokens[0].status).toBe('PENDING')
    })

    it('should return 200 for already verified user (no info disclosure)', async () => {
      const { user } = await createUser({ isVerified: true })

      const response = await client.post('/auth/resend-verification', {
        email: user.email,
      })

      expect(response.status).toBe(200)
    })

    it('should return 200 for non-existent email (no info disclosure)', async () => {
      const response = await client.post('/auth/resend-verification', {
        email: 'nonexistent@example.com',
      })

      expect(response.status).toBe(200)
      expect(response.body.message).toContain('If the account exists')
    })

    it('should enforce rate limiting', async () => {
      const { user } = await createUser({ isVerified: false })

      const requests = []
      for (let i = 0; i < 12; i++) {
        requests.push(
          client.post('/auth/resend-verification', { email: user.email })
        )
      }

      const responses = await Promise.all(requests)
      const rateLimited = responses.some(r => r.status === 429)
      expect(rateLimited).toBe(true)
    })

    it('should revoke previous pending tokens', async () => {
      const { user } = await createUser({ isVerified: false })
      const { token: firstToken } = await createVerificationToken(user.id, 'EMAIL_VERIFICATION', 'PENDING')

      // Resend verification
      await client.post('/auth/resend-verification', { email: user.email })

      // First token should be revoked
      const revokedToken = await prisma.verificationToken.findUnique({
        where: { id: firstToken.id },
      })
      expect(revokedToken!.status).toBe('REVOKED')
    })
  })
})
