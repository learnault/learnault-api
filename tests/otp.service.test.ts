import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OtpService, normalizePhone } from '../src/services/otp.service'
import prisma from '../src/config/database'
import { getSmsProvider } from '../src/services/sms/sms-provider.factory'

vi.mock('../src/config/database', () => ({
  default: {
    otpChallenge: {
      updateMany: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock('../src/services/sms/sms-provider.factory', () => ({
  getSmsProvider: vi.fn(),
}))

vi.mock('../src/utils/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
  },
}))

describe('normalizePhone', () => {
  it('accepts E.164 phone numbers', () => {
    expect(normalizePhone('+2348012345678')).toBe('+2348012345678')
    expect(normalizePhone('  +14155552671  ')).toBe('+14155552671')
  })

  it('rejects numbers without a leading +', () => {
    expect(normalizePhone('2348012345678')).toBeNull()
  })

  it('rejects numbers that are too short or too long', () => {
    expect(normalizePhone('+1234567')).toBeNull()
    expect(normalizePhone('+1234567890123456')).toBeNull()
  })

  it('rejects non-numeric input', () => {
    expect(normalizePhone('+abc4567890')).toBeNull()
  })
})

describe('OtpService', () => {
  let otpService: OtpService
  let mockSend: ReturnType<typeof vi.fn>

  beforeEach(() => {
    otpService = new OtpService()
    mockSend = vi
      .fn()
      .mockResolvedValue({ success: true, providerMessageId: 'mock_1' })
    ;(getSmsProvider as any).mockReturnValue({ send: mockSend })
    vi.clearAllMocks()
    mockSend.mockResolvedValue({ success: true, providerMessageId: 'mock_1' })
    ;(getSmsProvider as any).mockReturnValue({ send: mockSend })
  })

  describe('requestChallenge', () => {
    it('revokes prior pending challenges and creates a fresh one', async () => {
      ;(prisma.otpChallenge.updateMany as any).mockResolvedValue({ count: 1 })
      ;(prisma.otpChallenge.create as any).mockResolvedValue({ id: 'c1' })

      await otpService.requestChallenge('+2348012345678', 'LOGIN', 'user1', {
        ip: '1.2.3.4',
      })

      expect(prisma.otpChallenge.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user1', purpose: 'LOGIN', status: 'PENDING' },
        data: { status: 'REVOKED' },
      })
      expect(prisma.otpChallenge.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user1',
            phone: '+2348012345678',
            purpose: 'LOGIN',
            requestIp: '1.2.3.4',
          }),
        }),
      )
      expect(mockSend).toHaveBeenCalledWith(
        '+2348012345678',
        expect.stringContaining('expires in 5 minutes'),
      )
    })

    it('never sends the raw code hash unhashed to the database', async () => {
      ;(prisma.otpChallenge.updateMany as any).mockResolvedValue({ count: 0 })
      ;(prisma.otpChallenge.create as any).mockResolvedValue({ id: 'c1' })

      await otpService.requestChallenge(
        '+2348012345678',
        'PHONE_VERIFICATION',
        'user1',
        {},
      )

      const createArgs = (prisma.otpChallenge.create as any).mock.calls[0][0]
      expect(createArgs.data.codeHash).toMatch(/^[0-9a-f]{64}$/)

      const smsBody = mockSend.mock.calls[0][1] as string
      const codeInSms = smsBody.match(/code is (\d{6})/)?.[1]
      expect(codeInSms).toBeTruthy()
      expect(createArgs.data.codeHash).not.toBe(codeInSms)
    })
  })

  describe('verifyChallenge', () => {
    function buildChallenge(overrides: Partial<any> = {}) {
      return {
        id: 'c1',
        userId: 'user1',
        phone: '+2348012345678',
        purpose: 'LOGIN',
        codeHash: 'deadbeef',
        status: 'PENDING',
        attempts: 0,
        maxAttempts: 5,
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        ...overrides,
      }
    }

    it('returns not_found when no pending challenge exists', async () => {
      ;(prisma.otpChallenge.findFirst as any).mockResolvedValue(null)

      const result = await otpService.verifyChallenge(
        '+2348012345678',
        '123456',
        'LOGIN',
      )

      expect(result).toEqual({ ok: false, reason: 'not_found' })
    })

    it('returns not_found when the challenge belongs to a different user (authenticated flow)', async () => {
      ;(prisma.otpChallenge.findFirst as any).mockResolvedValue(
        buildChallenge({ userId: 'someone-else' }),
      )

      const result = await otpService.verifyChallenge(
        '+2348012345678',
        '123456',
        'PHONE_VERIFICATION',
        'user1',
      )

      expect(result).toEqual({ ok: false, reason: 'not_found' })
    })

    it('marks the challenge expired and returns expired', async () => {
      ;(prisma.otpChallenge.findFirst as any).mockResolvedValue(
        buildChallenge({ expiresAt: new Date(Date.now() - 1000) }),
      )
      ;(prisma.otpChallenge.update as any).mockResolvedValue({})

      const result = await otpService.verifyChallenge(
        '+2348012345678',
        '123456',
        'LOGIN',
      )

      expect(result).toEqual({ ok: false, reason: 'expired' })
      expect(prisma.otpChallenge.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { status: 'EXPIRED' },
      })
    })

    it('locks a challenge that already exhausted its attempts', async () => {
      ;(prisma.otpChallenge.findFirst as any).mockResolvedValue(
        buildChallenge({ attempts: 5, maxAttempts: 5 }),
      )
      ;(prisma.otpChallenge.update as any).mockResolvedValue({})

      const result = await otpService.verifyChallenge(
        '+2348012345678',
        '123456',
        'LOGIN',
      )

      expect(result).toEqual({ ok: false, reason: 'locked' })
      expect(prisma.otpChallenge.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { status: 'LOCKED' },
      })
    })

    it('increments attempts on a wrong code without locking below the threshold', async () => {
      ;(prisma.otpChallenge.findFirst as any).mockResolvedValue(
        buildChallenge({ attempts: 1, maxAttempts: 5 }),
      )
      ;(prisma.otpChallenge.update as any).mockResolvedValue({})

      const result = await otpService.verifyChallenge(
        '+2348012345678',
        '000000',
        'LOGIN',
      )

      expect(result).toEqual({ ok: false, reason: 'mismatch' })
      expect(prisma.otpChallenge.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { attempts: 2 },
      })
    })

    it('locks out on the attempt that reaches maxAttempts', async () => {
      ;(prisma.otpChallenge.findFirst as any).mockResolvedValue(
        buildChallenge({ attempts: 4, maxAttempts: 5 }),
      )
      ;(prisma.otpChallenge.update as any).mockResolvedValue({})

      const result = await otpService.verifyChallenge(
        '+2348012345678',
        '000000',
        'LOGIN',
      )

      expect(result).toEqual({ ok: false, reason: 'locked' })
      expect(prisma.otpChallenge.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { attempts: 5, status: 'LOCKED' },
      })
    })

    it('consumes the challenge and returns ok on a correct code', async () => {
      const crypto = await import('crypto')
      const correctHash = crypto
        .createHash('sha256')
        .update('+2348012345678:123456')
        .digest('hex')

      ;(prisma.otpChallenge.findFirst as any).mockResolvedValue(
        buildChallenge({ codeHash: correctHash }),
      )
      ;(prisma.otpChallenge.update as any).mockResolvedValue({})

      const result = await otpService.verifyChallenge(
        '+2348012345678',
        '123456',
        'LOGIN',
      )

      expect(result).toEqual({ ok: true, userId: 'user1' })
      expect(prisma.otpChallenge.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { status: 'CONSUMED', consumedAt: expect.any(Date) },
      })
    })
  })
})
