import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProfileController } from '../src/controllers/profile.controller'

const { mockGetOwnerView, mockUpdateProfile, mockGetEmployerView, mockGetPublicView } = vi.hoisted(() => ({
  mockGetOwnerView: vi.fn(),
  mockUpdateProfile: vi.fn(),
  mockGetEmployerView: vi.fn(),
  mockGetPublicView: vi.fn(),
}))

vi.mock('../src/services/profile.service', () => ({
  ProfileService: class {
    getOwnerView = mockGetOwnerView
    updateProfile = mockUpdateProfile
    getEmployerView = mockGetEmployerView
    getPublicView = mockGetPublicView
  },
}))

describe('ProfileController', () => {
  let controller: ProfileController
  let req: any
  let res: any

  beforeEach(() => {
    vi.clearAllMocks()
    controller = new ProfileController()
    req = { user: { id: 'user1' }, body: {}, params: {} }
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    }
  })

  describe('getMyProfile', () => {
    it('returns 401 when unauthenticated', async () => {
      req.user = undefined

      await controller.getMyProfile(req, res)

      expect(res.status).toHaveBeenCalledWith(401)
    })

    it('returns the owner view on success', async () => {
      mockGetOwnerView.mockResolvedValue({ id: 'profile1', displayName: 'Ada' })

      await controller.getMyProfile(req, res)

      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({ data: { id: 'profile1', displayName: 'Ada' } })
    })

    it('returns 500 on unexpected error', async () => {
      mockGetOwnerView.mockRejectedValue(new Error('db down'))

      await controller.getMyProfile(req, res)

      expect(res.status).toHaveBeenCalledWith(500)
    })
  })

  describe('updateMyProfile', () => {
    it('returns 401 when unauthenticated', async () => {
      req.user = undefined
      req.body = { displayName: 'Ada' }

      await controller.updateMyProfile(req, res)

      expect(res.status).toHaveBeenCalledWith(401)
    })

    it('returns 400 on empty body', async () => {
      req.body = {}

      await controller.updateMyProfile(req, res)

      expect(res.status).toHaveBeenCalledWith(400)
    })

    it('returns 400 on unknown fields (stable, closed schema)', async () => {
      req.body = { notARealField: true }

      await controller.updateMyProfile(req, res)

      expect(res.status).toHaveBeenCalledWith(400)
    })

    it('returns 400 on invalid level', async () => {
      req.body = { level: 'not-a-level' }

      await controller.updateMyProfile(req, res)

      expect(res.status).toHaveBeenCalledWith(400)
    })

    it('returns 400 on invalid visibility', async () => {
      req.body = { visibility: 'friends' }

      await controller.updateMyProfile(req, res)

      expect(res.status).toHaveBeenCalledWith(400)
    })

    it('accepts a partial update', async () => {
      req.body = { displayName: 'Ada' }
      mockUpdateProfile.mockResolvedValue({ id: 'profile1', displayName: 'Ada' })
      mockGetOwnerView.mockResolvedValue({ id: 'profile1', displayName: 'Ada' })

      await controller.updateMyProfile(req, res)

      expect(mockUpdateProfile).toHaveBeenCalledWith('user1', { displayName: 'Ada' })
      expect(res.status).toHaveBeenCalledWith(200)
    })

    it('returns 500 on unexpected error', async () => {
      req.body = { displayName: 'Ada' }
      mockUpdateProfile.mockRejectedValue(new Error('db down'))

      await controller.updateMyProfile(req, res)

      expect(res.status).toHaveBeenCalledWith(500)
    })
  })

  describe('getProfileById', () => {
    it('returns the owner view when the caller requests their own profile', async () => {
      req.params = { id: 'user1' }
      mockGetOwnerView.mockResolvedValue({ id: 'profile1', displayName: 'Ada' })

      await controller.getProfileById(req, res)

      expect(mockGetOwnerView).toHaveBeenCalledWith('user1')
      expect(res.status).toHaveBeenCalledWith(200)
    })

    it('returns the employer view for an employer caller viewing someone else', async () => {
      req.user = { id: 'employer1', role: 'employer' }
      req.params = { id: 'user2' }
      mockGetEmployerView.mockResolvedValue({ id: 'profile2', visible: true })

      await controller.getProfileById(req, res)

      expect(mockGetEmployerView).toHaveBeenCalledWith('user2')
      expect(mockGetPublicView).not.toHaveBeenCalled()
    })

    it('returns the public view for an anonymous caller', async () => {
      req.user = undefined
      req.params = { id: 'user2' }
      mockGetPublicView.mockResolvedValue({ id: 'profile2', visible: true })

      await controller.getProfileById(req, res)

      expect(mockGetPublicView).toHaveBeenCalledWith('user2')
    })

    it('returns 404 when the profile is not found', async () => {
      req.user = undefined
      req.params = { id: 'missing' }
      mockGetPublicView.mockResolvedValue(null)

      await controller.getProfileById(req, res)

      expect(res.status).toHaveBeenCalledWith(404)
    })

    it('returns 500 on unexpected error', async () => {
      req.user = undefined
      req.params = { id: 'user2' }
      mockGetPublicView.mockRejectedValue(new Error('db down'))

      await controller.getProfileById(req, res)

      expect(res.status).toHaveBeenCalledWith(500)
    })
  })
})
