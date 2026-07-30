import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConsentService } from '../src/services/consent.service'

const { mockCreate, mockFindFirst, mockFindMany } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockFindFirst: vi.fn(),
  mockFindMany: vi.fn(),
}))

vi.mock('../src/config/database', () => ({
  default: {
    consentRecord: {
      create: mockCreate,
      findFirst: mockFindFirst,
      findMany: mockFindMany,
    },
  },
}))

describe('ConsentService', () => {
  let service: ConsentService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new ConsentService()
  })

  describe('grant', () => {
    it('marks required purposes as required', async () => {
      mockCreate.mockResolvedValue({ id: 'c1', purpose: 'terms_of_service', required: true, status: 'granted' })

      await service.grant('user1', { purpose: 'terms_of_service', policyVersion: 'v1', source: 'onboarding' })

      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ purpose: 'terms_of_service', required: true, status: 'granted' }),
      })
    })

    it('marks optional purposes as not required', async () => {
      mockCreate.mockResolvedValue({ id: 'c2', purpose: 'marketing_emails', required: false, status: 'granted' })

      await service.grant('user1', { purpose: 'marketing_emails', policyVersion: 'v1', source: 'settings' })

      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ purpose: 'marketing_emails', required: false }),
      })
    })

    it('records a fresh row even when a grant for the purpose already exists (versioned re-consent)', async () => {
      mockCreate.mockResolvedValue({ id: 'c3', purpose: 'analytics', required: false, status: 'granted' })

      await service.grant('user1', { purpose: 'analytics', policyVersion: 'v2', source: 'settings' })
      await service.grant('user1', { purpose: 'analytics', policyVersion: 'v2', source: 'settings' })

      expect(mockCreate).toHaveBeenCalledTimes(2)
    })
  })

  describe('withdraw', () => {
    it('returns not-granted when there is no prior consent', async () => {
      mockFindFirst.mockResolvedValue(null)

      const result = await service.withdraw('user1', { purpose: 'analytics', source: 'settings' })

      expect(result).toEqual({ kind: 'not-granted' })
      expect(mockCreate).not.toHaveBeenCalled()
    })

    it('returns not-granted when the latest record is already withdrawn', async () => {
      mockFindFirst.mockResolvedValue({ purpose: 'analytics', required: false, status: 'withdrawn' })

      const result = await service.withdraw('user1', { purpose: 'analytics', source: 'settings' })

      expect(result).toEqual({ kind: 'not-granted' })
    })

    it('blocks withdrawal of required consent', async () => {
      mockFindFirst.mockResolvedValue({ purpose: 'terms_of_service', required: true, status: 'granted', policyVersion: 'v1' })

      const result = await service.withdraw('user1', { purpose: 'terms_of_service', source: 'settings' })

      expect(result).toEqual({ kind: 'required-cannot-withdraw' })
      expect(mockCreate).not.toHaveBeenCalled()
    })

    it('withdraws granted optional consent, carrying forward its policy version', async () => {
      mockFindFirst.mockResolvedValue({ purpose: 'marketing_emails', required: false, status: 'granted', policyVersion: 'v3' })
      mockCreate.mockResolvedValue({ id: 'c4', purpose: 'marketing_emails', status: 'withdrawn', policyVersion: 'v3' })

      const result = await service.withdraw('user1', { purpose: 'marketing_emails', source: 'settings' })

      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ purpose: 'marketing_emails', status: 'withdrawn', policyVersion: 'v3' }),
      })
      expect(result.kind).toBe('withdrawn')
    })
  })

  describe('hasAllRequiredGranted', () => {
    it('is true when every required purpose is currently granted', async () => {
      mockFindMany.mockResolvedValue([
        { purpose: 'terms_of_service', status: 'granted' },
        { purpose: 'privacy_policy', status: 'granted' },
      ])

      expect(await service.hasAllRequiredGranted('user1')).toBe(true)
    })

    it('is false when a required purpose was withdrawn', async () => {
      mockFindMany.mockResolvedValue([
        { purpose: 'terms_of_service', status: 'granted' },
        { purpose: 'privacy_policy', status: 'withdrawn' },
      ])

      expect(await service.hasAllRequiredGranted('user1')).toBe(false)
    })

    it('is false when a required purpose has never been addressed', async () => {
      mockFindMany.mockResolvedValue([{ purpose: 'terms_of_service', status: 'granted' }])

      expect(await service.hasAllRequiredGranted('user1')).toBe(false)
    })
  })
})
