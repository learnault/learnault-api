import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Request, Response } from 'express'

const {
  mockGetOwnerAccountProfile,
  mockUpdateProfileAudited,
  mockGetPublicView,
  mockChangePassword,
  mockUpdateWalletAddress,
} = vi.hoisted(() => ({
  mockGetOwnerAccountProfile: vi.fn(),
  mockUpdateProfileAudited: vi.fn(),
  mockGetPublicView: vi.fn(),
  mockChangePassword: vi.fn(),
  mockUpdateWalletAddress: vi.fn(),
}))

vi.mock('../src/services/profile.service', () => ({
  profileService: {
    getOwnerAccountProfile: mockGetOwnerAccountProfile,
    updateProfileAudited: mockUpdateProfileAudited,
    getPublicView: mockGetPublicView,
  },
}))

vi.mock('../src/services/user-account.service', () => ({
  userAccountService: {
    changePassword: mockChangePassword,
    updateWalletAddress: mockUpdateWalletAddress,
  },
}))

vi.mock('../src/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { UserController } from '../src/controllers/user.controller'

const USER_ID = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'
const OTHER_ID = '3f1a2b3c-4d5e-4f60-8a71-9b2c3d4e5f60'
const VALID_ADDRESS = `G${'A'.repeat(55)}`

const aggregate = {
  account: {
    id: USER_ID,
    email: 'ada@example.com',
    username: 'ada',
    role: 'LEARNER',
    status: 'ACTIVE',
    isVerified: true,
    phoneVerifiedAt: null,
    walletAddress: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
    lastLoginAt: null,
  },
  profile: { id: 'profile1', userId: USER_ID, displayName: 'Ada' },
  completion: { percent: 25, missingFields: ['bio'] },
  onboarding: { status: 'in_progress', currentStep: 'consent', requiredStepsRemaining: ['consent'] },
  consents: [],
  requiredConsentsGranted: false,
}

describe('UserController', () => {
  let controller: UserController
  let req: any
  let res: Partial<Response>

  beforeEach(() => {
    vi.clearAllMocks()
    controller = new UserController()
    req = {
      user: { id: USER_ID, email: 'ada@example.com', role: 'learner' },
      body: {},
      params: {},
      headers: {},
      requestId: 'req-1',
      ip: '203.0.113.7',
    }
    res = {
      status: vi.fn().mockReturnThis() as unknown as Response['status'],
      json: vi.fn().mockReturnThis() as unknown as Response['json'],
    }
  })

  const call = (handler: keyof UserController) =>
    (controller[handler] as (r: Request, s: Response) => Promise<void>)(
      req as Request,
      res as Response
    )

  describe('getCurrentUser', () => {
    it('returns 401 when unauthenticated', async () => {
      req.user = undefined

      await call('getCurrentUser')

      expect(res.status).toHaveBeenCalledWith(401)
      expect(mockGetOwnerAccountProfile).not.toHaveBeenCalled()
    })

    it('returns 404 when the account no longer exists', async () => {
      mockGetOwnerAccountProfile.mockResolvedValue(null)

      await call('getCurrentUser')

      expect(res.status).toHaveBeenCalledWith(404)
      expect(res.json).toHaveBeenCalledWith({ error: 'User not found' })
    })

    it('returns the account/profile aggregate for the authenticated owner', async () => {
      mockGetOwnerAccountProfile.mockResolvedValue(aggregate)

      await call('getCurrentUser')

      expect(mockGetOwnerAccountProfile).toHaveBeenCalledWith(USER_ID)
      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({ data: aggregate })
    })

    it('returns profile completion and onboarding state', async () => {
      mockGetOwnerAccountProfile.mockResolvedValue(aggregate)

      await call('getCurrentUser')

      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0]

      expect(body.data.completion).toEqual({ percent: 25, missingFields: ['bio'] })
      expect(body.data.onboarding.currentStep).toBe('consent')
      expect(body.data.requiredConsentsGranted).toBe(false)
    })

    it('reads its own account only — never an id taken from the request', async () => {
      req.params = { id: OTHER_ID }
      mockGetOwnerAccountProfile.mockResolvedValue(aggregate)

      await call('getCurrentUser')

      expect(mockGetOwnerAccountProfile).toHaveBeenCalledWith(USER_ID)
    })

    it('returns 500 on an unexpected failure', async () => {
      mockGetOwnerAccountProfile.mockRejectedValue(new Error('db down'))

      await call('getCurrentUser')

      expect(res.status).toHaveBeenCalledWith(500)
    })
  })

  describe('updateProfile', () => {
    it('returns 401 when unauthenticated', async () => {
      req.user = undefined
      req.body = { displayName: 'Ada' }

      await call('updateProfile')

      expect(res.status).toHaveBeenCalledWith(401)
      expect(mockUpdateProfileAudited).not.toHaveBeenCalled()
    })

    it('returns 400 on an empty body', async () => {
      await call('updateProfile')

      expect(res.status).toHaveBeenCalledWith(400)
      expect(mockUpdateProfileAudited).not.toHaveBeenCalled()
    })

    it.each([
      ['status', { status: 'ACTIVE' }],
      ['isVerified', { isVerified: true }],
      ['role', { role: 'ADMIN' }],
      ['phoneVerifiedAt', { phoneVerifiedAt: new Date().toISOString() }],
      ['userId', { userId: OTHER_ID }],
      ['id', { id: 'profile-hijack' }],
      ['archivedAt', { archivedAt: null }],
      ['password', { password: 'Hacked1!pass' }],
      ['email', { email: 'attacker@example.com' }],
      ['walletAddress', { walletAddress: VALID_ADDRESS }],
    ])('rejects %s: an owner may only write allow-listed profile fields', async (_field, body) => {
      req.body = body

      await call('updateProfile')

      expect(res.status).toHaveBeenCalledWith(400)
      expect(mockUpdateProfileAudited).not.toHaveBeenCalled()
    })

    it('rejects an allowed field carried alongside a forbidden one', async () => {
      req.body = { displayName: 'Ada', role: 'ADMIN' }

      await call('updateProfile')

      expect(res.status).toHaveBeenCalledWith(400)
      expect(mockUpdateProfileAudited).not.toHaveBeenCalled()
    })

    it.each([
      ['level', { level: 'wizard' }],
      ['visibility', { visibility: 'friends' }],
      ['avatarUrl', { avatarUrl: 'not-a-url' }],
      ['displayName', { displayName: 'x'.repeat(81) }],
      ['bio', { bio: 'x'.repeat(1001) }],
    ])('returns 400 on an invalid %s value', async (_field, body) => {
      req.body = body

      await call('updateProfile')

      expect(res.status).toHaveBeenCalledWith(400)
    })

    it('applies an audited partial update and returns the refreshed aggregate', async () => {
      req.body = { displayName: 'Ada', interests: ['stellar'] }
      mockUpdateProfileAudited.mockResolvedValue({ id: 'profile1' })
      mockGetOwnerAccountProfile.mockResolvedValue(aggregate)

      await call('updateProfile')

      expect(mockUpdateProfileAudited).toHaveBeenCalledWith(
        USER_ID,
        { displayName: 'Ada', interests: ['stellar'] },
        expect.anything()
      )
      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({
        message: 'Profile updated successfully',
        data: aggregate,
      })
    })

    it('passes an audit context attributed to the authenticated owner', async () => {
      req.body = { displayName: 'Ada' }
      mockUpdateProfileAudited.mockResolvedValue({ id: 'profile1' })
      mockGetOwnerAccountProfile.mockResolvedValue(aggregate)

      await call('updateProfile')

      const context = mockUpdateProfileAudited.mock.calls[0][2]

      expect(context.actor).toMatchObject({ type: 'USER', id: USER_ID })
      expect(context.requestId).toBe('req-1')
    })

    it('returns 404 when the account vanished mid-request', async () => {
      req.body = { displayName: 'Ada' }
      mockUpdateProfileAudited.mockResolvedValue({ id: 'profile1' })
      mockGetOwnerAccountProfile.mockResolvedValue(null)

      await call('updateProfile')

      expect(res.status).toHaveBeenCalledWith(404)
    })

    it('returns 500 when the audited write fails', async () => {
      req.body = { displayName: 'Ada' }
      mockUpdateProfileAudited.mockRejectedValue(new Error('audit trail unavailable'))

      await call('updateProfile')

      expect(res.status).toHaveBeenCalledWith(500)
    })
  })

  describe('getUserById', () => {
    it('returns 400 for a non-uuid id', async () => {
      req.params = { id: 'not-a-uuid' }

      await call('getUserById')

      expect(res.status).toHaveBeenCalledWith(400)
      expect(mockGetPublicView).not.toHaveBeenCalled()
    })

    it('returns 404 when no such learner exists', async () => {
      req.params = { id: OTHER_ID }
      mockGetPublicView.mockResolvedValue(null)

      await call('getUserById')

      expect(res.status).toHaveBeenCalledWith(404)
    })

    it('serves the public view, never the owner view, even to the owner', async () => {
      req.params = { id: USER_ID }
      mockGetPublicView.mockResolvedValue({ id: 'profile1', visible: true, displayName: 'Ada' })

      await call('getUserById')

      expect(mockGetPublicView).toHaveBeenCalledWith(USER_ID)
      expect(mockGetOwnerAccountProfile).not.toHaveBeenCalled()
      expect(res.status).toHaveBeenCalledWith(200)
    })

    it('returns the redacted stub unchanged when disclosure is refused', async () => {
      req.params = { id: OTHER_ID }
      mockGetPublicView.mockResolvedValue({ id: 'profile2', visible: false })

      await call('getUserById')

      expect(res.json).toHaveBeenCalledWith({ data: { id: 'profile2', visible: false } })
    })

    it('never emits private account data in the public response', async () => {
      req.params = { id: OTHER_ID }
      mockGetPublicView.mockResolvedValue({
        id: 'profile2',
        visible: true,
        displayName: 'Ada',
        bio: null,
        avatarUrl: null,
        country: 'NG',
        level: 'beginner',
        interests: [],
      })

      await call('getUserById')

      const body = JSON.stringify((res.json as ReturnType<typeof vi.fn>).mock.calls[0][0])

      for (const leak of ['email', 'password', 'walletAddress', 'status', 'isVerified', 'phoneVerifiedAt', 'userId']) {
        expect(body).not.toContain(leak)
      }
    })

    it('returns 500 on an unexpected failure', async () => {
      req.params = { id: OTHER_ID }
      mockGetPublicView.mockRejectedValue(new Error('db down'))

      await call('getUserById')

      expect(res.status).toHaveBeenCalledWith(500)
    })
  })

  describe('changePassword', () => {
    const body = { currentPassword: 'OldPass1!', newPassword: 'NewPass1!' }

    it('returns 401 when unauthenticated', async () => {
      req.user = undefined
      req.body = body

      await call('changePassword')

      expect(res.status).toHaveBeenCalledWith(401)
      expect(mockChangePassword).not.toHaveBeenCalled()
    })

    it.each([
      ['a missing current password', { newPassword: 'NewPass1!' }],
      ['a weak new password', { currentPassword: 'OldPass1!', newPassword: 'short' }],
      ['reusing the current password', { currentPassword: 'NewPass1!', newPassword: 'NewPass1!' }],
      ['an unknown extra field', { ...body, userId: OTHER_ID }],
    ])('returns 400 for %s', async (_case, invalid) => {
      req.body = invalid

      await call('changePassword')

      expect(res.status).toHaveBeenCalledWith(400)
      expect(mockChangePassword).not.toHaveBeenCalled()
    })

    it('returns 401 when the current password is wrong', async () => {
      req.body = body
      mockChangePassword.mockResolvedValue({ kind: 'invalid-password' })

      await call('changePassword')

      expect(res.status).toHaveBeenCalledWith(401)
      expect(res.json).toHaveBeenCalledWith({
        error: 'Current password is incorrect',
        code: 'STEP_UP_FAILED',
      })
    })

    it('returns 404 when the account no longer exists', async () => {
      req.body = body
      mockChangePassword.mockResolvedValue({ kind: 'not-found' })

      await call('changePassword')

      expect(res.status).toHaveBeenCalledWith(404)
    })

    it('reports the revoked session count on success', async () => {
      req.body = body
      mockChangePassword.mockResolvedValue({ kind: 'changed', revokedSessionCount: 3 })

      await call('changePassword')

      expect(mockChangePassword).toHaveBeenCalledWith(
        USER_ID,
        'OldPass1!',
        'NewPass1!',
        expect.anything()
      )
      expect(res.status).toHaveBeenCalledWith(200)
      expect((res.json as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
        revokedSessionCount: 3,
      })
    })

    it('never echoes either password back to the caller', async () => {
      req.body = body
      mockChangePassword.mockResolvedValue({ kind: 'changed', revokedSessionCount: 0 })

      await call('changePassword')

      const responseBody = JSON.stringify((res.json as ReturnType<typeof vi.fn>).mock.calls[0][0])

      expect(responseBody).not.toContain('OldPass1!')
      expect(responseBody).not.toContain('NewPass1!')
    })

    it('returns 500 on an unexpected failure', async () => {
      req.body = body
      mockChangePassword.mockRejectedValue(new Error('db down'))

      await call('changePassword')

      expect(res.status).toHaveBeenCalledWith(500)
    })
  })

  describe('updateWalletAddress', () => {
    it('returns 401 when unauthenticated', async () => {
      req.user = undefined
      req.body = { walletAddress: VALID_ADDRESS }

      await call('updateWalletAddress')

      expect(res.status).toHaveBeenCalledWith(401)
      expect(mockUpdateWalletAddress).not.toHaveBeenCalled()
    })

    it.each([
      ['a malformed address', { walletAddress: 'invalid-address' }],
      ['a too-short address', { walletAddress: 'GABC123' }],
      ['a secret seed', { walletAddress: `S${'A'.repeat(55)}` }],
      ['a missing address', {}],
      ['an unknown extra field', { walletAddress: VALID_ADDRESS, userId: OTHER_ID }],
    ])('returns 400 for %s', async (_case, body) => {
      req.body = body

      await call('updateWalletAddress')

      expect(res.status).toHaveBeenCalledWith(400)
      expect(mockUpdateWalletAddress).not.toHaveBeenCalled()
    })

    it('returns 409 when the address belongs to another account', async () => {
      req.body = { walletAddress: VALID_ADDRESS }
      mockUpdateWalletAddress.mockResolvedValue({ kind: 'conflict' })

      await call('updateWalletAddress')

      expect(res.status).toHaveBeenCalledWith(409)
      expect((res.json as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
        code: 'WALLET_ADDRESS_TAKEN',
      })
    })

    it('returns 404 when the account no longer exists', async () => {
      req.body = { walletAddress: VALID_ADDRESS }
      mockUpdateWalletAddress.mockResolvedValue({ kind: 'not-found' })

      await call('updateWalletAddress')

      expect(res.status).toHaveBeenCalledWith(404)
    })

    it('persists a valid address for the authenticated owner', async () => {
      req.body = { walletAddress: VALID_ADDRESS }
      mockUpdateWalletAddress.mockResolvedValue({ kind: 'updated', walletAddress: VALID_ADDRESS })

      await call('updateWalletAddress')

      expect(mockUpdateWalletAddress).toHaveBeenCalledWith(
        USER_ID,
        VALID_ADDRESS,
        expect.anything()
      )
      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({
        message: 'Wallet address updated successfully',
        data: { walletAddress: VALID_ADDRESS },
      })
    })

    it('is idempotent when the address is already on file', async () => {
      req.body = { walletAddress: VALID_ADDRESS }
      mockUpdateWalletAddress.mockResolvedValue({ kind: 'unchanged', walletAddress: VALID_ADDRESS })

      await call('updateWalletAddress')

      expect(res.status).toHaveBeenCalledWith(200)
      expect((res.json as ReturnType<typeof vi.fn>).mock.calls[0][0].message).toBe(
        'Wallet address unchanged'
      )
    })

    it('returns 500 on an unexpected failure', async () => {
      req.body = { walletAddress: VALID_ADDRESS }
      mockUpdateWalletAddress.mockRejectedValue(new Error('db down'))

      await call('updateWalletAddress')

      expect(res.status).toHaveBeenCalledWith(500)
    })
  })
})
