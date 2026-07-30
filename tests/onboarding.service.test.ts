import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OnboardingService } from '../src/services/onboarding.service'

const { mockUpsert, mockFindUnique, mockUpdate, mockHasAllRequiredGranted } = vi.hoisted(() => ({
  mockUpsert: vi.fn(),
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
  mockHasAllRequiredGranted: vi.fn(),
}))

vi.mock('../src/config/database', () => ({
  default: {
    onboardingProgress: {
      upsert: mockUpsert,
      findUnique: mockFindUnique,
      update: mockUpdate,
    },
  },
}))

vi.mock('../src/services/consent.service', () => ({
  consentService: {
    hasAllRequiredGranted: mockHasAllRequiredGranted,
  },
}))

const baseProgress = {
  id: 'onb1',
  userId: 'user1',
  version: 'v1',
  currentStep: 'profile_basics',
  completedSteps: ['profile_basics'],
  status: 'in_progress',
  startedAt: new Date(),
  completedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

describe('OnboardingService', () => {
  let service: OnboardingService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new OnboardingService()
  })

  describe('getOrCreate / resume', () => {
    it('upserts a default in-progress row so resume is deterministic', async () => {
      mockUpsert.mockResolvedValue({ ...baseProgress, completedSteps: [] })

      const result = await service.resume('user1')

      expect(mockUpsert).toHaveBeenCalledWith({
        where: { userId: 'user1' },
        update: {},
        create: { userId: 'user1', version: 'v1', currentStep: 'profile_basics', completedSteps: [] },
      })
      expect(result.status).toBe('in_progress')
    })
  })

  describe('saveStep', () => {
    it('creates a new row on first save', async () => {
      mockFindUnique.mockResolvedValue(null)
      mockUpsert.mockResolvedValue({ ...baseProgress, completedSteps: ['profile_basics'] })

      const result = await service.saveStep('user1', 'profile_basics')

      expect(mockUpsert).toHaveBeenCalledWith({
        where: { userId: 'user1' },
        update: { currentStep: 'profile_basics', completedSteps: ['profile_basics'] },
        create: { userId: 'user1', version: 'v1', currentStep: 'profile_basics', completedSteps: ['profile_basics'] },
      })
      expect(result.kind).toBe('saved')
    })

    it('does not duplicate a step that is saved twice (idempotent)', async () => {
      mockFindUnique.mockResolvedValue({ ...baseProgress, completedSteps: ['profile_basics'] })
      mockUpsert.mockResolvedValue(baseProgress)

      await service.saveStep('user1', 'profile_basics')

      expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({
        update: { currentStep: 'profile_basics', completedSteps: ['profile_basics'] },
      }))
    })

    it('appends a new step onto existing progress', async () => {
      mockFindUnique.mockResolvedValue({ ...baseProgress, completedSteps: ['profile_basics'] })
      mockUpsert.mockResolvedValue({ ...baseProgress, completedSteps: ['profile_basics', 'consent'] })

      await service.saveStep('user1', 'consent')

      expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({
        update: { currentStep: 'consent', completedSteps: ['profile_basics', 'consent'] },
      }))
    })

    it('refuses to modify a completed onboarding record', async () => {
      mockFindUnique.mockResolvedValue({ ...baseProgress, status: 'completed' })

      const result = await service.saveStep('user1', 'preferences')

      expect(result.kind).toBe('already-completed')
      expect(mockUpsert).not.toHaveBeenCalled()
    })
  })

  describe('complete', () => {
    it('returns already-completed when already completed', async () => {
      mockUpsert.mockResolvedValue({ ...baseProgress, status: 'completed' })

      const result = await service.complete('user1')

      expect(result.kind).toBe('already-completed')
      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('blocks completion when required steps are missing', async () => {
      mockUpsert.mockResolvedValue({ ...baseProgress, completedSteps: ['profile_basics'] })

      const result = await service.complete('user1')

      expect(result).toEqual({ kind: 'incomplete-steps', missingSteps: ['consent'] })
      expect(mockHasAllRequiredGranted).not.toHaveBeenCalled()
    })

    it('blocks completion when required consent is missing', async () => {
      mockUpsert.mockResolvedValue({ ...baseProgress, completedSteps: ['profile_basics', 'consent'] })
      mockHasAllRequiredGranted.mockResolvedValue(false)

      const result = await service.complete('user1')

      expect(result).toEqual({ kind: 'missing-required-consent' })
      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('completes when all required steps and consents are satisfied', async () => {
      mockUpsert.mockResolvedValue({ ...baseProgress, completedSteps: ['profile_basics', 'consent'] })
      mockHasAllRequiredGranted.mockResolvedValue(true)
      mockUpdate.mockResolvedValue({ ...baseProgress, status: 'completed', completedAt: new Date() })

      const result = await service.complete('user1')

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { userId: 'user1' },
        data: { status: 'completed', completedAt: expect.any(Date) },
      })
      expect(result.kind).toBe('completed')
    })
  })
})
