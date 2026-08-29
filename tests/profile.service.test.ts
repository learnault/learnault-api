import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ActorType } from '../src/audit/types'

const {
  mockUpsert,
  mockFindUnique,
  mockFindFirst,
  mockUserFindUnique,
  mockUserFindFirst,
  mockOnboardingFindUnique,
  mockConsentFindMany,
  mockTransaction,
} = vi.hoisted(() => ({
  mockUpsert: vi.fn(),
  mockFindUnique: vi.fn(),
  mockFindFirst: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockUserFindFirst: vi.fn(),
  mockOnboardingFindUnique: vi.fn(),
  mockConsentFindMany: vi.fn(),
  mockTransaction: vi.fn(),
}))

vi.mock('../src/config/database', () => ({
  default: {
    learnerProfile: {
      upsert: mockUpsert,
      findUnique: mockFindUnique,
      findFirst: mockFindFirst,
    },
    user: {
      findUnique: mockUserFindUnique,
      findFirst: mockUserFindFirst,
    },
    onboardingProgress: {
      findUnique: mockOnboardingFindUnique,
    },
    consentRecord: {
      findMany: mockConsentFindMany,
    },
    $transaction: mockTransaction,
  },
}))

vi.mock('../src/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { ProfileService } from '../src/services/profile.service'

const baseProfile = {
  id: 'profile1',
  userId: 'user1',
  displayName: 'Ada',
  bio: null,
  avatarUrl: null,
  country: null,
  timezone: null,
  languages: [],
  level: 'beginner',
  interests: [],
  goals: [],
  visibility: 'private',
  createdAt: new Date(),
  updatedAt: new Date(),
}

const baseAccount = {
  id: 'user1',
  email: 'ada@example.com',
  username: 'ada',
  role: 'LEARNER',
  status: 'ACTIVE',
  isVerified: true,
  phoneVerifiedAt: null,
  walletAddress: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastLoginAt: null,
}

const ownerContext = {
  actor: { type: ActorType.USER, id: 'user1', role: 'LEARNER' },
  requestId: 'req-1',
  ipAddress: '203.0.113.7',
  userAgent: 'curl/8.0',
}

/**
 * A stand-in transaction client, so a test can assert the audit row was written
 * inside the same transaction as the profile write.
 */
function fakeTransaction(result: unknown = baseProfile) {
  const calls: string[] = []
  const auditCreate = vi.fn(async () => {
    calls.push('audit')

    return {}
  })
  const profileUpsert = vi.fn(async () => {
    calls.push('mutate')

    return result
  })

  mockTransaction.mockImplementation(
    async (callback: (client: unknown) => Promise<unknown>) =>
      callback({
        auditEvent: { create: auditCreate },
        learnerProfile: { upsert: profileUpsert },
      })
  )

  return { calls, auditCreate, profileUpsert }
}

function auditRow(auditCreate: ReturnType<typeof vi.fn>): Record<string, unknown> {
  return (auditCreate.mock.calls[0][0] as { data: Record<string, unknown> }).data
}

describe('ProfileService', () => {
  let service: ProfileService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new ProfileService()
  })

  describe('getOrCreateProfile', () => {
    it('upserts a default row so every learner gets a deterministic starting profile', async () => {
      mockUpsert.mockResolvedValue(baseProfile)

      const result = await service.getOrCreateProfile('user1')

      expect(mockUpsert).toHaveBeenCalledWith({
        where: { userId: 'user1' },
        update: {},
        create: { userId: 'user1' },
      })
      expect(result).toEqual(baseProfile)
    })
  })

  describe('updateProfile', () => {
    it('preserves omitted fields via a partial upsert', async () => {
      mockUpsert.mockResolvedValue({ ...baseProfile, displayName: 'New Name' })

      const result = await service.updateProfile('user1', { displayName: 'New Name' })

      expect(mockUpsert).toHaveBeenCalledWith({
        where: { userId: 'user1' },
        update: { displayName: 'New Name' },
        create: { userId: 'user1', displayName: 'New Name' },
      })
      expect(result.displayName).toBe('New Name')
    })
  })

  describe('updateProfileAudited', () => {
    it('writes the profile change and its audit event in one transaction', async () => {
      const { calls, auditCreate, profileUpsert } = fakeTransaction()

      await service.updateProfileAudited('user1', { displayName: 'Ada' }, ownerContext)

      expect(mockTransaction).toHaveBeenCalledOnce()
      expect(profileUpsert).toHaveBeenCalledWith({
        where: { userId: 'user1' },
        update: { displayName: 'Ada' },
        create: { userId: 'user1', displayName: 'Ada' },
      })
      // Order matters: an audit row written after the transaction commits is a
      // trail with holes in it.
      expect(calls).toEqual(['mutate', 'audit'])
      expect(auditCreate).toHaveBeenCalledOnce()
    })

    it('attributes the event to the owner and the affected profile row', async () => {
      const { auditCreate } = fakeTransaction()

      await service.updateProfileAudited('user1', { displayName: 'Ada' }, ownerContext)

      expect(auditRow(auditCreate)).toMatchObject({
        action: 'learner_profile.updated',
        actorType: ActorType.USER,
        actorId: 'user1',
        targetType: 'LearnerProfile',
        targetId: 'profile1',
        requestId: 'req-1',
        source: 'api.users.update_profile',
      })
    })

    it('records which fields changed but never their values', async () => {
      const { auditCreate } = fakeTransaction()

      await service.updateProfileAudited(
        'user1',
        { bio: 'my private medical history', displayName: 'Ada Lovelace' },
        ownerContext
      )

      const metadata = auditRow(auditCreate).metadata as string

      expect(metadata).toContain('bio')
      expect(metadata).toContain('displayName')
      expect(metadata).not.toContain('medical history')
      expect(metadata).not.toContain('Lovelace')
    })

    it('propagates a failed audit write, so the profile change cannot land alone', async () => {
      mockTransaction.mockRejectedValue(new Error('audit trail unavailable'))

      await expect(
        service.updateProfileAudited('user1', { displayName: 'Ada' }, ownerContext)
      ).rejects.toThrow('audit trail unavailable')
    })

    it('refuses an unattributable owner change rather than writing it anonymously', async () => {
      fakeTransaction()

      await expect(
        service.updateProfileAudited(
          'user1',
          { displayName: 'Ada' },
          { ...ownerContext, actor: { type: ActorType.USER } }
        )
      ).rejects.toThrow(/unattributable/)
      expect(mockTransaction).not.toHaveBeenCalled()
    })
  })

  describe('getOwnerView', () => {
    it('returns the full profile with a completion summary', async () => {
      mockUpsert.mockResolvedValue(baseProfile)

      const result = await service.getOwnerView('user1')

      expect(result.displayName).toBe('Ada')
      expect(result.completion).toBeDefined()
    })
  })

  describe('getOwnerAccountProfile', () => {
    beforeEach(() => {
      mockUpsert.mockResolvedValue(baseProfile)
      mockOnboardingFindUnique.mockResolvedValue(null)
      mockConsentFindMany.mockResolvedValue([])
    })

    it('returns null for an unknown account', async () => {
      mockUserFindUnique.mockResolvedValue(null)

      expect(await service.getOwnerAccountProfile('missing')).toBeNull()
    })

    it('returns null for a tombstoned account instead of materialising a profile', async () => {
      mockUserFindUnique.mockResolvedValue({ ...baseAccount, status: 'DELETED' })

      expect(await service.getOwnerAccountProfile('user1')).toBeNull()
      expect(mockUpsert).not.toHaveBeenCalled()
    })

    it('never selects the password column', async () => {
      mockUserFindUnique.mockResolvedValue(baseAccount)

      await service.getOwnerAccountProfile('user1')

      const select = mockUserFindUnique.mock.calls[0][0].select

      expect(select).not.toHaveProperty('password')
      expect(select.email).toBe(true)
    })

    it('aggregates account, profile, completion, onboarding and consents', async () => {
      mockUserFindUnique.mockResolvedValue(baseAccount)
      mockOnboardingFindUnique.mockResolvedValue({
        version: 'v1',
        status: 'in_progress',
        currentStep: 'consent',
        completedSteps: ['profile_basics'],
        startedAt: new Date(),
        completedAt: null,
      })
      mockConsentFindMany.mockResolvedValue([
        {
          purpose: 'terms_of_service',
          status: 'granted',
          required: true,
          policyVersion: '2026-01',
          grantedAt: new Date(),
          withdrawnAt: null,
        },
      ])

      const result = await service.getOwnerAccountProfile('user1')

      expect(result?.account.email).toBe('ada@example.com')
      expect(result?.profile.displayName).toBe('Ada')
      expect(result?.completion.percent).toBeTypeOf('number')
      expect(result?.onboarding?.requiredStepsRemaining).toEqual(['consent'])
      expect(result?.consents).toHaveLength(1)
    })

    it('reports required consents as granted only when every required purpose is granted', async () => {
      mockUserFindUnique.mockResolvedValue(baseAccount)
      mockConsentFindMany.mockResolvedValue([
        { purpose: 'terms_of_service', status: 'granted', required: true, policyVersion: '1', grantedAt: new Date(), withdrawnAt: null },
        { purpose: 'privacy_policy', status: 'withdrawn', required: true, policyVersion: '1', grantedAt: null, withdrawnAt: new Date() },
      ])

      const partial = await service.getOwnerAccountProfile('user1')
      expect(partial?.requiredConsentsGranted).toBe(false)

      mockConsentFindMany.mockResolvedValue([
        { purpose: 'terms_of_service', status: 'granted', required: true, policyVersion: '1', grantedAt: new Date(), withdrawnAt: null },
        { purpose: 'privacy_policy', status: 'granted', required: true, policyVersion: '1', grantedAt: new Date(), withdrawnAt: null },
      ])

      const complete = await service.getOwnerAccountProfile('user1')
      expect(complete?.requiredConsentsGranted).toBe(true)
    })
  })

  describe('getEmployerView', () => {
    beforeEach(() => {
      mockConsentFindMany.mockResolvedValue([])
      mockUserFindUnique.mockResolvedValue({ status: 'ACTIVE' })
    })

    it('returns null when the profile does not exist', async () => {
      mockFindFirst.mockResolvedValue(null)

      expect(await service.getEmployerView('missing')).toBeNull()
    })

    it('returns null when the account does not exist', async () => {
      mockFindFirst.mockResolvedValue(baseProfile)
      mockUserFindUnique.mockResolvedValue(null)

      expect(await service.getEmployerView('user1')).toBeNull()
    })

    it('redacts fields when visibility is below employer', async () => {
      mockFindFirst.mockResolvedValue(baseProfile)

      expect(await service.getEmployerView('user1')).toEqual({ id: 'profile1', visible: false })
    })

    it('exposes the employer subset when visibility allows it', async () => {
      mockFindFirst.mockResolvedValue({ ...baseProfile, visibility: 'employer' })

      expect(await service.getEmployerView('user1')).toMatchObject({ visible: true, displayName: 'Ada' })
    })

    it('redacts an employer-visible profile once data-sharing consent is withdrawn', async () => {
      mockFindFirst.mockResolvedValue({ ...baseProfile, visibility: 'employer' })
      mockConsentFindMany.mockResolvedValue([{ purpose: 'data_sharing', status: 'withdrawn' }])

      expect(await service.getEmployerView('user1')).toEqual({ id: 'profile1', visible: false })
    })
  })

  describe('getPublicView', () => {
    beforeEach(() => {
      mockConsentFindMany.mockResolvedValue([])
      mockUserFindUnique.mockResolvedValue({ status: 'ACTIVE' })
    })

    it('reads through findFirst, so archived profiles are excluded by the client extension', async () => {
      mockFindFirst.mockResolvedValue(baseProfile)

      await service.getPublicView('user1')

      expect(mockFindFirst).toHaveBeenCalledWith({ where: { userId: 'user1' } })
      expect(mockFindUnique).not.toHaveBeenCalled()
    })

    it('redacts fields when visibility is below public', async () => {
      mockFindFirst.mockResolvedValue(baseProfile)

      expect(await service.getPublicView('user1')).toEqual({ id: 'profile1', visible: false })
    })

    it('exposes the public subset when visibility is public', async () => {
      mockFindFirst.mockResolvedValue({ ...baseProfile, visibility: 'public' })

      const result = await service.getPublicView('user1')

      expect(result).toMatchObject({ visible: true, displayName: 'Ada' })
      expect(result).not.toHaveProperty('goals')
    })

    it('never leaks account-private fields, even for a fully public profile', async () => {
      mockFindFirst.mockResolvedValue({ ...baseProfile, visibility: 'public' })

      const result = (await service.getPublicView('user1')) as Record<string, unknown>

      expect(result).not.toHaveProperty('userId')
      expect(result).not.toHaveProperty('status')
      expect(result).not.toHaveProperty('isVerified')
      expect(result).not.toHaveProperty('phoneVerifiedAt')
      expect(result).not.toHaveProperty('email')
      expect(result).not.toHaveProperty('walletAddress')
    })

    it('redacts a public profile once data-sharing consent is withdrawn', async () => {
      mockFindFirst.mockResolvedValue({ ...baseProfile, visibility: 'public' })
      mockConsentFindMany.mockResolvedValue([{ purpose: 'data_sharing', status: 'withdrawn' }])

      expect(await service.getPublicView('user1')).toEqual({ id: 'profile1', visible: false })
    })

    it.each(['DEACTIVATED', 'PENDING_DELETION'])(
      'redacts a public profile for a %s account',
      async status => {
        mockFindFirst.mockResolvedValue({ ...baseProfile, visibility: 'public' })
        mockUserFindUnique.mockResolvedValue({ status })

        expect(await service.getPublicView('user1')).toEqual({ id: 'profile1', visible: false })
      }
    )
  })

  describe('getPrivateView', () => {
    it('returns null when the account does not exist', async () => {
      mockUpsert.mockResolvedValue(baseProfile)
      mockUserFindUnique.mockResolvedValue(null)

      expect(await service.getPrivateView('missing')).toBeNull()
    })

    it('joins account-private fields onto the full profile', async () => {
      mockUpsert.mockResolvedValue(baseProfile)
      mockUserFindUnique.mockResolvedValue({ status: 'ACTIVE', isVerified: true, phoneVerifiedAt: null })

      const result = await service.getPrivateView('user1')

      expect(result).toMatchObject({ displayName: 'Ada', status: 'ACTIVE', isVerified: true })
    })
  })
})
