import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PreferenceService } from '../src/services/preference.service'

const { mockUpsert, mockFindUnique, mockCreateMany } = vi.hoisted(() => ({
  mockUpsert: vi.fn(),
  mockFindUnique: vi.fn(),
  mockCreateMany: vi.fn(),
}))

vi.mock('../src/config/database', () => ({
  default: {
    learnerPreference: {
      upsert: mockUpsert,
      findUnique: mockFindUnique,
    },
    preferenceAuditLog: {
      createMany: mockCreateMany,
    },
  },
}))

describe('PreferenceService', () => {
  let service: PreferenceService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new PreferenceService()
  })

  describe('getPreferences', () => {
    it('upserts a default row so every learner gets deterministic defaults', async () => {
      const defaults = { userId: 'user1', locale: 'en-US', timezone: 'UTC' }
      mockUpsert.mockResolvedValue(defaults)

      const result = await service.getPreferences('user1')

      expect(mockUpsert).toHaveBeenCalledWith({
        where: { userId: 'user1' },
        update: {},
        create: { userId: 'user1' },
      })
      expect(result).toEqual(defaults)
    })
  })

  describe('updatePreferences', () => {
    it('preserves omitted fields via a partial upsert', async () => {
      mockFindUnique.mockResolvedValue({
        userId: 'user1',
        locale: 'en-US',
        profileVisibility: 'public',
      })
      mockUpsert.mockResolvedValue({
        userId: 'user1',
        locale: 'fr-FR',
        profileVisibility: 'public',
      })

      const result = await service.updatePreferences('user1', {
        locale: 'fr-FR' as any,
      })

      expect(mockUpsert).toHaveBeenCalledWith({
        where: { userId: 'user1' },
        update: { locale: 'fr-FR' },
        create: { userId: 'user1', locale: 'fr-FR' },
      })
      expect(result.locale).toBe('fr-FR')
    })

    it('audits privacy-impacting changes when the value actually changes', async () => {
      mockFindUnique.mockResolvedValue({
        userId: 'user1',
        profileVisibility: 'public',
      })
      mockUpsert.mockResolvedValue({
        userId: 'user1',
        profileVisibility: 'private',
      })

      await service.updatePreferences('user1', {
        profileVisibility: 'private' as any,
      })

      expect(mockCreateMany).toHaveBeenCalledWith({
        data: [
          {
            userId: 'user1',
            field: 'profileVisibility',
            oldValue: 'public',
            newValue: 'private',
          },
        ],
      })
    })

    it('does not audit when a non-privacy field changes', async () => {
      mockFindUnique.mockResolvedValue({ userId: 'user1', locale: 'en-US' })
      mockUpsert.mockResolvedValue({ userId: 'user1', locale: 'fr-FR' })

      await service.updatePreferences('user1', { locale: 'fr-FR' as any })

      expect(mockCreateMany).not.toHaveBeenCalled()
    })

    it('does not audit when a privacy field is submitted but unchanged', async () => {
      mockFindUnique.mockResolvedValue({
        userId: 'user1',
        analyticsConsent: true,
      })
      mockUpsert.mockResolvedValue({ userId: 'user1', analyticsConsent: true })

      await service.updatePreferences('user1', { analyticsConsent: true })

      expect(mockCreateMany).not.toHaveBeenCalled()
    })

    it('records null oldValue on first-ever write (no prior row)', async () => {
      mockFindUnique.mockResolvedValue(null)
      mockUpsert.mockResolvedValue({
        userId: 'user1',
        dataSharingConsent: true,
      })

      await service.updatePreferences('user1', { dataSharingConsent: true })

      expect(mockCreateMany).toHaveBeenCalledWith({
        data: [
          {
            userId: 'user1',
            field: 'dataSharingConsent',
            oldValue: null,
            newValue: 'true',
          },
        ],
      })
    })
  })
})
