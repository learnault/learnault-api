import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConsentController } from '../src/controllers/consent.controller'

const { mockGetCurrent, mockGetHistory, mockGrant, mockWithdraw } = vi.hoisted(() => ({
  mockGetCurrent: vi.fn(),
  mockGetHistory: vi.fn(),
  mockGrant: vi.fn(),
  mockWithdraw: vi.fn(),
}))

vi.mock('../src/services/consent.service', () => ({
  consentService: {
    getCurrent: mockGetCurrent,
    getHistory: mockGetHistory,
    grant: mockGrant,
    withdraw: mockWithdraw,
  },
}))

describe('ConsentController', () => {
  let controller: ConsentController
  let req: any
  let res: any

  beforeEach(() => {
    vi.clearAllMocks()
    controller = new ConsentController()
    req = { user: { id: 'user1' }, body: {}, query: {} }
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    }
  })

  describe('getCurrent', () => {
    it('returns 401 when unauthenticated', async () => {
      req.user = undefined

      await controller.getCurrent(req, res)

      expect(res.status).toHaveBeenCalledWith(401)
    })

    it('returns current consents on success', async () => {
      mockGetCurrent.mockResolvedValue([{ purpose: 'terms_of_service', status: 'granted' }])

      await controller.getCurrent(req, res)

      expect(res.status).toHaveBeenCalledWith(200)
    })
  })

  describe('getHistory', () => {
    it('returns 400 on an invalid purpose filter', async () => {
      req.query = { purpose: 'not_a_purpose' }

      await controller.getHistory(req, res)

      expect(res.status).toHaveBeenCalledWith(400)
    })

    it('returns history filtered by purpose', async () => {
      req.query = { purpose: 'analytics' }
      mockGetHistory.mockResolvedValue([])

      await controller.getHistory(req, res)

      expect(mockGetHistory).toHaveBeenCalledWith('user1', 'analytics')
      expect(res.status).toHaveBeenCalledWith(200)
    })
  })

  describe('grant', () => {
    it('returns 400 on an invalid purpose', async () => {
      req.body = { purpose: 'not_a_purpose', policyVersion: 'v1', source: 'onboarding' }

      await controller.grant(req, res)

      expect(res.status).toHaveBeenCalledWith(400)
    })

    it('returns 400 when policyVersion is missing', async () => {
      req.body = { purpose: 'analytics', source: 'onboarding' }

      await controller.grant(req, res)

      expect(res.status).toHaveBeenCalledWith(400)
    })

    it('grants consent with a valid payload', async () => {
      req.body = { purpose: 'analytics', policyVersion: 'v1', source: 'onboarding' }
      mockGrant.mockResolvedValue({ purpose: 'analytics', status: 'granted' })

      await controller.grant(req, res)

      expect(mockGrant).toHaveBeenCalledWith('user1', { purpose: 'analytics', policyVersion: 'v1', source: 'onboarding' })
      expect(res.status).toHaveBeenCalledWith(200)
    })
  })

  describe('withdraw', () => {
    it('returns 400 on an invalid source', async () => {
      req.body = { purpose: 'analytics', source: 'not_a_source' }

      await controller.withdraw(req, res)

      expect(res.status).toHaveBeenCalledWith(400)
    })

    it('returns 409 when consent was never granted', async () => {
      req.body = { purpose: 'analytics', source: 'settings' }
      mockWithdraw.mockResolvedValue({ kind: 'not-granted' })

      await controller.withdraw(req, res)

      expect(res.status).toHaveBeenCalledWith(409)
    })

    it('returns 409 when consent is required', async () => {
      req.body = { purpose: 'terms_of_service', source: 'settings' }
      mockWithdraw.mockResolvedValue({ kind: 'required-cannot-withdraw' })

      await controller.withdraw(req, res)

      expect(res.status).toHaveBeenCalledWith(409)
    })

    it('withdraws optional consent', async () => {
      req.body = { purpose: 'analytics', source: 'settings' }
      mockWithdraw.mockResolvedValue({ kind: 'withdrawn', record: { status: 'withdrawn' } })

      await controller.withdraw(req, res)

      expect(res.status).toHaveBeenCalledWith(200)
    })

    it('returns 500 on unexpected error', async () => {
      req.body = { purpose: 'analytics', source: 'settings' }
      mockWithdraw.mockRejectedValue(new Error('db down'))

      await controller.withdraw(req, res)

      expect(res.status).toHaveBeenCalledWith(500)
    })
  })
})
