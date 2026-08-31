import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PreferenceController } from '../src/controllers/preference.controller'

const { mockGetPreferences, mockUpdatePreferences } = vi.hoisted(() => ({
  mockGetPreferences: vi.fn(),
  mockUpdatePreferences: vi.fn(),
}))

vi.mock('../src/services/preference.service', () => ({
  PreferenceService: class {
    getPreferences = mockGetPreferences
    updatePreferences = mockUpdatePreferences
  },
}))

describe('PreferenceController', () => {
  let controller: PreferenceController
  let req: any
  let res: any

  beforeEach(() => {
    vi.clearAllMocks()
    controller = new PreferenceController()
    req = { user: { id: 'user1' }, body: {} }
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    }
  })

  describe('getPreferences', () => {
    it('returns 401 when unauthenticated', async () => {
      req.user = undefined

      await controller.getPreferences(req, res)

      expect(res.status).toHaveBeenCalledWith(401)
    })

    it('returns defaults on success', async () => {
      mockGetPreferences.mockResolvedValue({ userId: 'user1', locale: 'en-US' })

      await controller.getPreferences(req, res)

      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({
        data: { userId: 'user1', locale: 'en-US' },
      })
    })

    it('returns 500 on unexpected error', async () => {
      mockGetPreferences.mockRejectedValue(new Error('db down'))

      await controller.getPreferences(req, res)

      expect(res.status).toHaveBeenCalledWith(500)
    })
  })

  describe('updatePreferences', () => {
    it('returns 401 when unauthenticated', async () => {
      req.user = undefined
      req.body = { locale: 'fr-FR' }

      await controller.updatePreferences(req, res)

      expect(res.status).toHaveBeenCalledWith(401)
    })

    it('returns 400 on empty body', async () => {
      req.body = {}

      await controller.updatePreferences(req, res)

      expect(res.status).toHaveBeenCalledWith(400)
    })

    it('returns 400 on invalid locale', async () => {
      req.body = { locale: 'not-a-locale' }

      await controller.updatePreferences(req, res)

      expect(res.status).toHaveBeenCalledWith(400)
    })

    it('returns 400 on invalid timezone', async () => {
      req.body = { timezone: 'Not/A_Timezone' }

      await controller.updatePreferences(req, res)

      expect(res.status).toHaveBeenCalledWith(400)
    })

    it('returns 400 on unknown fields (stable, closed schema)', async () => {
      req.body = { notARealField: true }

      await controller.updatePreferences(req, res)

      expect(res.status).toHaveBeenCalledWith(400)
    })

    it('accepts a partial update and preserves omitted fields', async () => {
      req.body = { lowDataMode: true }
      mockUpdatePreferences.mockResolvedValue({
        userId: 'user1',
        lowDataMode: true,
        locale: 'en-US',
      })

      await controller.updatePreferences(req, res)

      expect(mockUpdatePreferences).toHaveBeenCalledWith('user1', {
        lowDataMode: true,
      })
      expect(res.status).toHaveBeenCalledWith(200)
    })

    it('returns 500 on unexpected error', async () => {
      req.body = { lowDataMode: true }
      mockUpdatePreferences.mockRejectedValue(new Error('db down'))

      await controller.updatePreferences(req, res)

      expect(res.status).toHaveBeenCalledWith(500)
    })
  })
})
