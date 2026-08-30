import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Request, Response } from 'express'
import { ReferralController } from '../src/controllers/referral.controller'

vi.mock('../src/config/database', () => ({
  default: {
    referralCode: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    referral: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    completion: {
      count: vi.fn(),
    },
    transaction: {
      create: vi.fn(),
    },
  },
}))

import prisma from '../src/config/database'

const flushPromises = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0))

interface AuthRequest extends Request {
  user?: { id: string; email: string; role: string }
}

describe('ReferralController', () => {
  let controller: ReferralController
  let req: Partial<AuthRequest>
  let res: Partial<Response>
  let next: ReturnType<typeof vi.fn>

  beforeEach(() => {
    controller = new ReferralController()
    req = {
      user: { id: 'user-1', email: 'test@example.com', role: 'LEARNER' },
      body: {},
    }
    res = { json: vi.fn(), status: vi.fn().mockReturnThis() }
    next = vi.fn()
    vi.clearAllMocks()
  })

  describe('generateCode', () => {
    it('returns existing code if user already has one', async () => {
      vi.mocked(prisma.referralCode.findUnique).mockResolvedValue({
        id: 'rc-1',
        code: 'ABCD1234',
        userId: 'user-1',
        createdAt: new Date(),
        referrals: [],
      } as any)

      controller.generateCode(req as Request, res as Response, next)
      await flushPromises()

      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ data: { code: 'ABCD1234' } }),
      )
    })

    it('creates and returns a new code if none exists', async () => {
      vi.mocked(prisma.referralCode.findUnique)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
      vi.mocked(prisma.referralCode.create).mockResolvedValue({
        id: 'rc-2',
        code: 'NEWCODE1',
        userId: 'user-1',
        createdAt: new Date(),
      } as any)

      controller.generateCode(req as Request, res as Response, next)
      await flushPromises()

      expect(prisma.referralCode.create).toHaveBeenCalled()
      expect(res.status).toHaveBeenCalledWith(201)
    })

    it('throws UnauthorizedError when user is missing', async () => {
      req.user = undefined

      controller.generateCode(req as Request, res as Response, next)
      await flushPromises()

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'User ID not found' }),
      )
    })
  })

  describe('applyCode', () => {
    beforeEach(() => {
      req.body = { code: 'REFCODE1' }
    })

    it('throws BadRequestError when code is missing', async () => {
      req.body = {}

      controller.applyCode(req as Request, res as Response, next)
      await flushPromises()

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Referral code is required' }),
      )
    })

    it('throws NotFoundError for unknown code', async () => {
      vi.mocked(prisma.referralCode.findUnique).mockResolvedValue(null)

      controller.applyCode(req as Request, res as Response, next)
      await flushPromises()

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Referral code not found' }),
      )
    })

    it('throws BadRequestError on self-referral', async () => {
      vi.mocked(prisma.referralCode.findUnique).mockResolvedValue({
        id: 'rc-1',
        code: 'REFCODE1',
        userId: 'user-1',
        createdAt: new Date(),
      } as any)

      controller.applyCode(req as Request, res as Response, next)
      await flushPromises()

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Self-referrals are not allowed' }),
      )
    })

    it('throws ConflictError if user already used a referral code', async () => {
      vi.mocked(prisma.referralCode.findUnique).mockResolvedValue({
        id: 'rc-1',
        code: 'REFCODE1',
        userId: 'user-2',
        createdAt: new Date(),
      } as any)
      vi.mocked(prisma.referral.findUnique).mockResolvedValue({
        id: 'ref-1',
      } as any)

      controller.applyCode(req as Request, res as Response, next)
      await flushPromises()

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'You have already used a referral code',
        }),
      )
    })

    it('successfully applies a valid referral code', async () => {
      vi.mocked(prisma.referralCode.findUnique).mockResolvedValue({
        id: 'rc-1',
        code: 'REFCODE1',
        userId: 'user-2',
        createdAt: new Date(),
      } as any)
      vi.mocked(prisma.referral.findUnique).mockResolvedValue(null)
      vi.mocked(prisma.referral.findFirst).mockResolvedValue(null)
      vi.mocked(prisma.referral.create).mockResolvedValue({
        id: 'ref-new',
      } as any)

      controller.applyCode(req as Request, res as Response, next)
      await flushPromises()

      expect(prisma.referral.create).toHaveBeenCalled()
      expect(res.status).toHaveBeenCalledWith(201)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true }),
      )
    })
  })

  describe('getStats', () => {
    it('returns referral stats', async () => {
      vi.mocked(prisma.referral.findMany).mockResolvedValue([
        {
          id: 'ref-1',
          bonusPaid: true,
          bonusAmount: 5.0,
          referree: { completions: [{ id: 'c-1' }] },
        },
        {
          id: 'ref-2',
          bonusPaid: false,
          bonusAmount: null,
          referree: { completions: [] },
        },
      ] as any)

      controller.getStats(req as Request, res as Response, next)
      await flushPromises()

      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            totalReferrals: 2,
            activeReferrals: 1,
            earnedBonuses: 5.0,
          }),
        }),
      )
    })

    it('throws UnauthorizedError when user is missing', async () => {
      req.user = undefined

      controller.getStats(req as Request, res as Response, next)
      await flushPromises()

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'User ID not found' }),
      )
    })
  })

  describe('processReferralBonus (static)', () => {
    it('pays bonus when referree completes first module', async () => {
      vi.mocked(prisma.referral.findUnique).mockResolvedValue({
        id: 'ref-1',
        referrerId: 'user-2',
        bonusPaid: false,
      } as any)
      vi.mocked(prisma.completion.count).mockResolvedValue(1)
      vi.mocked(prisma.referral.update).mockResolvedValue({} as any)
      vi.mocked(prisma.transaction.create).mockResolvedValue({} as any)

      await ReferralController.processReferralBonus('user-1')

      expect(prisma.referral.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ bonusPaid: true }),
        }),
      )
      expect(prisma.transaction.create).toHaveBeenCalled()
    })

    it('skips bonus if already paid', async () => {
      vi.mocked(prisma.referral.findUnique).mockResolvedValue({
        id: 'ref-1',
        referrerId: 'user-2',
        bonusPaid: true,
      } as any)

      await ReferralController.processReferralBonus('user-1')

      expect(prisma.referral.update).not.toHaveBeenCalled()
    })

    it('skips bonus if no completions yet', async () => {
      vi.mocked(prisma.referral.findUnique).mockResolvedValue({
        id: 'ref-1',
        referrerId: 'user-2',
        bonusPaid: false,
      } as any)
      vi.mocked(prisma.completion.count).mockResolvedValue(0)

      await ReferralController.processReferralBonus('user-1')

      expect(prisma.referral.update).not.toHaveBeenCalled()
    })
  })
})
