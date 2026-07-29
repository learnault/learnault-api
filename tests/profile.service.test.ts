import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProfileService } from '../src/services/profile.service'

const { mockUpsert, mockFindUnique, mockUserFindUnique } = vi.hoisted(() => ({
  mockUpsert: vi.fn(),
  mockFindUnique: vi.fn(),
  mockUserFindUnique: vi.fn(),
}))

vi.mock('../src/config/database', () => ({
  default: {
    learnerProfile: {
      upsert: mockUpsert,
      findUnique: mockFindUnique,
    },
    user: {
      findUnique: mockUserFindUnique,
    },
  },
}))

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

  describe('getOwnerView', () => {
    it('returns the full profile with a completion summary', async () => {
      mockUpsert.mockResolvedValue(baseProfile)

      const result = await service.getOwnerView('user1')

      expect(result.displayName).toBe('Ada')
      expect(result.completion).toBeDefined()
    })
  })

  describe('getEmployerView', () => {
    it('returns null when the profile does not exist', async () => {
      mockFindUnique.mockResolvedValue(null)

      const result = await service.getEmployerView('missing')

      expect(result).toBeNull()
    })

    it('redacts fields when visibility is below employer', async () => {
      mockFindUnique.mockResolvedValue(baseProfile)

      const result = await service.getEmployerView('user1')

      expect(result).toEqual({ id: 'profile1', visible: false })
    })
  })

  describe('getPublicView', () => {
    it('redacts fields when visibility is below public', async () => {
      mockFindUnique.mockResolvedValue(baseProfile)

      const result = await service.getPublicView('user1')

      expect(result).toEqual({ id: 'profile1', visible: false })
    })

    it('exposes the public subset when visibility is public', async () => {
      mockFindUnique.mockResolvedValue({ ...baseProfile, visibility: 'public', displayName: 'Ada' })

      const result = await service.getPublicView('user1')

      expect(result).toMatchObject({ visible: true, displayName: 'Ada' })
      expect(result).not.toHaveProperty('goals')
    })
  })

  describe('getPrivateView', () => {
    it('returns null when the account does not exist', async () => {
      mockUpsert.mockResolvedValue(baseProfile)
      mockUserFindUnique.mockResolvedValue(null)

      const result = await service.getPrivateView('missing')

      expect(result).toBeNull()
    })

    it('joins account-private fields onto the full profile', async () => {
      mockUpsert.mockResolvedValue(baseProfile)
      mockUserFindUnique.mockResolvedValue({ status: 'ACTIVE', isVerified: true, phoneVerifiedAt: null })

      const result = await service.getPrivateView('user1')

      expect(result).toMatchObject({ displayName: 'Ada', status: 'ACTIVE', isVerified: true })
    })
  })
})
