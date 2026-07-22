import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TokenService, hashToken, generateRawToken, TOKEN_LENGTH } from '../../../src/domain/auth'
import prisma from '../../../src/config/database'

vi.mock('../../../src/config/database', () => ({
  default: {
    verificationToken: {
      updateMany: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}))

describe('token utils', () => {
  it('generates a raw token of expected length', () => {
    const token = generateRawToken()
    expect(typeof token).toBe('string')
    expect(token.length).toBe(TOKEN_LENGTH * 2) // hex encoding doubles bytes
  })

  it('hashes a token deterministically', () => {
    const token = 'test-token'
    const hash1 = hashToken(token)
    const hash2 = hashToken(token)
    expect(hash1).toEqual(hash2)
    expect(hash1).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('TokenService', () => {
  let tokenService: TokenService

  beforeEach(() => {
    tokenService = new TokenService()
    vi.clearAllMocks()
  })

  describe('createToken', () => {
    it('revokes existing pending tokens and creates a new one', async () => {
      const mockId = 'token-123'
      ;(prisma.verificationToken.updateMany as any).mockResolvedValue({ count: 1 })
      ;(prisma.verificationToken.create as any).mockResolvedValue({ id: mockId })

      const result = await tokenService.createToken('user-1', 'EMAIL_VERIFICATION')

      expect(result.rawToken).toBeTruthy()
      expect(result.tokenId).toBe(mockId)
      expect(prisma.verificationToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', purpose: 'EMAIL_VERIFICATION', status: 'PENDING' },
        data: { status: 'REVOKED' },
      })
      expect(prisma.verificationToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/),
            purpose: 'EMAIL_VERIFICATION',
            expiresAt: expect.any(Date),
          }),
        })
      )
    })

    it('never stores the raw token', async () => {
      ;(prisma.verificationToken.updateMany as any).mockResolvedValue({ count: 0 })
      ;(prisma.verificationToken.create as any).mockResolvedValue({ id: 't1' })

      const result = await tokenService.createToken('u1', 'PASSWORD_RESET')
      const createCall = (prisma.verificationToken.create as any).mock.calls[0][0]
      expect(createCall.data.tokenHash).not.toBe(result.rawToken)
    })
  })

  describe('verifyToken', () => {
    it('returns invalid for non-existent token', async () => {
      ;(prisma.verificationToken.findFirst as any).mockResolvedValue(null)
      const rawToken = 'any-token'

      const result = await tokenService.verifyToken(rawToken, 'EMAIL_VERIFICATION')

      expect(result.ok).toBe(false)
      expect(result.reason).toBe('invalid')
    })

    it('returns revoked for already revoked tokens', async () => {
      const rawToken = 'some-token'
      ;(prisma.verificationToken.findFirst as any).mockResolvedValue({
        id: 't1',
        userId: 'u1',
        status: 'REVOKED',
        expiresAt: new Date(Date.now() + 3600000),
      })

      const result = await tokenService.verifyToken(rawToken, 'EMAIL_VERIFICATION')

      expect(result.ok).toBe(false)
      expect(result.reason).toBe('revoked')
    })

    it('returns expired and marks status when token is expired', async () => {
      const rawToken = 'token'
      ;(prisma.verificationToken.findFirst as any).mockResolvedValue({
        id: 't1',
        userId: 'u1',
        status: 'PENDING',
        expiresAt: new Date(Date.now() - 1000),
      })
      ;(prisma.verificationToken.update as any).mockResolvedValue({})

      const result = await tokenService.verifyToken(rawToken, 'PASSWORD_RESET')

      expect(result.ok).toBe(false)
      expect(result.reason).toBe('expired')
      expect(prisma.verificationToken.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { status: 'EXPIRED' },
      })
    })

    it('returns ok for valid pending token', async () => {
      const rawToken = 'valid-token'
      const tokenHash = hashToken(rawToken)
      ;(prisma.verificationToken.findFirst as any).mockResolvedValue({
        id: 't1',
        userId: 'u1',
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 3600000),
      })

      const result = await tokenService.verifyToken(rawToken, 'EMAIL_VERIFICATION')

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.userId).toBe('u1')
        expect(result.tokenId).toBe('t1')
      }
    })
  })

  describe('markTokenAsUsed', () => {
    it('updates token to used status', async () => {
      ;(prisma.verificationToken.update as any).mockResolvedValue({})
      await tokenService.markTokenAsUsed('t1')
      expect(prisma.verificationToken.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { status: 'USED', usedAt: expect.any(Date) },
      })
    })
  })
})
