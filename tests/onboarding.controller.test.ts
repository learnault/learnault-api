import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OnboardingController } from '../src/controllers/onboarding.controller'

const { mockResume, mockSaveStep, mockComplete } = vi.hoisted(() => ({
  mockResume: vi.fn(),
  mockSaveStep: vi.fn(),
  mockComplete: vi.fn(),
}))

vi.mock('../src/services/onboarding.service', () => ({
  onboardingService: {
    resume: mockResume,
    saveStep: mockSaveStep,
    complete: mockComplete,
  },
}))

describe('OnboardingController', () => {
  let controller: OnboardingController
  let req: any
  let res: any

  beforeEach(() => {
    vi.clearAllMocks()
    controller = new OnboardingController()
    req = { user: { id: 'user1' }, body: {} }
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    }
  })

  describe('getProgress', () => {
    it('returns 401 when unauthenticated', async () => {
      req.user = undefined

      await controller.getProgress(req, res)

      expect(res.status).toHaveBeenCalledWith(401)
    })

    it('returns progress on success', async () => {
      mockResume.mockResolvedValue({ userId: 'user1', status: 'in_progress' })

      await controller.getProgress(req, res)

      expect(res.status).toHaveBeenCalledWith(200)
    })

    it('returns 500 on unexpected error', async () => {
      mockResume.mockRejectedValue(new Error('db down'))

      await controller.getProgress(req, res)

      expect(res.status).toHaveBeenCalledWith(500)
    })
  })

  describe('saveStep', () => {
    it('returns 401 when unauthenticated', async () => {
      req.user = undefined
      req.body = { step: 'profile_basics' }

      await controller.saveStep(req, res)

      expect(res.status).toHaveBeenCalledWith(401)
    })

    it('returns 400 on an unknown step', async () => {
      req.body = { step: 'not_a_step' }

      await controller.saveStep(req, res)

      expect(res.status).toHaveBeenCalledWith(400)
    })

    it('returns 400 when step is missing', async () => {
      req.body = {}

      await controller.saveStep(req, res)

      expect(res.status).toHaveBeenCalledWith(400)
    })

    it('saves a valid step', async () => {
      req.body = { step: 'profile_basics' }
      mockSaveStep.mockResolvedValue({
        kind: 'saved',
        progress: { currentStep: 'profile_basics' },
      })

      await controller.saveStep(req, res)

      expect(mockSaveStep).toHaveBeenCalledWith('user1', 'profile_basics')
      expect(res.status).toHaveBeenCalledWith(200)
    })

    it('returns 409 when onboarding is already completed', async () => {
      req.body = { step: 'preferences' }
      mockSaveStep.mockResolvedValue({
        kind: 'already-completed',
        progress: { status: 'completed' },
      })

      await controller.saveStep(req, res)

      expect(res.status).toHaveBeenCalledWith(409)
    })

    it('returns 500 on unexpected error', async () => {
      req.body = { step: 'profile_basics' }
      mockSaveStep.mockRejectedValue(new Error('db down'))

      await controller.saveStep(req, res)

      expect(res.status).toHaveBeenCalledWith(500)
    })
  })

  describe('complete', () => {
    it('returns 401 when unauthenticated', async () => {
      req.user = undefined

      await controller.complete(req, res)

      expect(res.status).toHaveBeenCalledWith(401)
    })

    it('returns 409 when required steps are missing', async () => {
      mockComplete.mockResolvedValue({
        kind: 'incomplete-steps',
        missingSteps: ['consent'],
      })

      await controller.complete(req, res)

      expect(res.status).toHaveBeenCalledWith(409)
    })

    it('returns 409 when required consent is missing', async () => {
      mockComplete.mockResolvedValue({ kind: 'missing-required-consent' })

      await controller.complete(req, res)

      expect(res.status).toHaveBeenCalledWith(409)
    })

    it('returns 200 on successful completion', async () => {
      mockComplete.mockResolvedValue({
        kind: 'completed',
        progress: { status: 'completed' },
      })

      await controller.complete(req, res)

      expect(res.status).toHaveBeenCalledWith(200)
    })

    it('returns 500 on unexpected error', async () => {
      mockComplete.mockRejectedValue(new Error('db down'))

      await controller.complete(req, res)

      expect(res.status).toHaveBeenCalledWith(500)
    })
  })
})
