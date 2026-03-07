import { NextFunction, Request, Response } from 'express'
import { describe, expect, it, vi } from 'vitest'
import {
  validatePasswordChange,
  validateProfileUpdate,
  validateWalletAddress,
} from '../../src/middleware/validation.middleware'

// ── helpers ───────────────────────────────────────────────────────────────────

function makeMocks (body: Record<string, any> = {}) {
  const req = { body } as Partial<Request>
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as Partial<Response>
  const next: NextFunction = vi.fn()

  return { req, res, next }
}

// ── validateProfileUpdate ─────────────────────────────────────────────────────

describe('validateProfileUpdate', () => {
  it('calls next() for a valid update payload', () => {
    const { req, res, next } = makeMocks({
      username: 'valid_user',
      firstName: 'John',
      lastName: 'Doe',
      bio: 'Hello world',
      avatar: 'https://example.com/avatar.jpg',
    })

    validateProfileUpdate(req as Request, res as Response, next)

    expect(next).toHaveBeenCalledOnce()
    expect(res.status).not.toHaveBeenCalled()
  })

  it('calls next() when body is empty (all fields optional)', () => {
    const { req, res, next } = makeMocks({})

    validateProfileUpdate(req as Request, res as Response, next)

    expect(next).toHaveBeenCalledOnce()
  })

  it('returns 400 when username is too short', () => {
    const { req, res, next } = makeMocks({ username: 'ab' })

    validateProfileUpdate(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ errors: expect.arrayContaining([expect.stringContaining('3 characters')]) })
    )
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 400 when username exceeds 30 characters', () => {
    const { req, res, next } = makeMocks({ username: 'a'.repeat(31) })

    validateProfileUpdate(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ errors: expect.arrayContaining([expect.stringContaining('30 characters')]) })
    )
  })

  it('returns 400 when username contains invalid characters', () => {
    const { req, res, next } = makeMocks({ username: 'bad user!' })

    validateProfileUpdate(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ errors: expect.arrayContaining([expect.stringContaining('letters, numbers')]) })
    )
  })

  it('returns 400 when firstName exceeds 50 characters', () => {
    const { req, res, next } = makeMocks({ firstName: 'A'.repeat(51) })

    validateProfileUpdate(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ errors: expect.arrayContaining([expect.stringContaining('First name')]) })
    )
  })

  it('returns 400 when lastName exceeds 50 characters', () => {
    const { req, res, next } = makeMocks({ lastName: 'B'.repeat(51) })

    validateProfileUpdate(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ errors: expect.arrayContaining([expect.stringContaining('Last name')]) })
    )
  })

  it('returns 400 when bio exceeds 500 characters', () => {
    const { req, res, next } = makeMocks({ bio: 'x'.repeat(501) })

    validateProfileUpdate(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ errors: expect.arrayContaining([expect.stringContaining('Bio')]) })
    )
  })

  it('returns 400 when avatar is not a valid URL', () => {
    const { req, res, next } = makeMocks({ avatar: 'not-a-url' })

    validateProfileUpdate(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ errors: expect.arrayContaining([expect.stringContaining('valid URL')]) })
    )
  })

  it('returns multiple errors when multiple fields are invalid', () => {
    const { req, res, next } = makeMocks({
      username: 'ab',
      bio: 'x'.repeat(501),
    })

    validateProfileUpdate(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(400)
    const { errors } = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(errors.length).toBeGreaterThanOrEqual(2)
  })
})

// ── validatePasswordChange ────────────────────────────────────────────────────

describe('validatePasswordChange', () => {
  it('calls next() for a valid password change', () => {
    const { req, res, next } = makeMocks({
      currentPassword: 'OldPass1!',
      newPassword: 'NewPass1!',
    })

    validatePasswordChange(req as Request, res as Response, next)

    expect(next).toHaveBeenCalledOnce()
    expect(res.status).not.toHaveBeenCalled()
  })

  it('returns 400 when currentPassword is missing', () => {
    const { req, res, next } = makeMocks({ newPassword: 'NewPass1!' })

    validatePasswordChange(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ errors: expect.arrayContaining([expect.stringContaining('Current password')]) })
    )
  })

  it('returns 400 when newPassword is missing', () => {
    const { req, res, next } = makeMocks({ currentPassword: 'OldPass1!' })

    validatePasswordChange(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ errors: expect.arrayContaining([expect.stringContaining('New password is required')]) })
    )
  })

  it('returns 400 when newPassword is too short', () => {
    const { req, res, next } = makeMocks({ currentPassword: 'OldPass1!', newPassword: 'Ab1!' })

    validatePasswordChange(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ errors: expect.arrayContaining([expect.stringContaining('8 characters')]) })
    )
  })

  it('returns 400 when newPassword has no lowercase letter', () => {
    const { req, res, next } = makeMocks({ currentPassword: 'OldPass1!', newPassword: 'NEWPASS1!' })

    validatePasswordChange(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ errors: expect.arrayContaining([expect.stringContaining('lowercase')]) })
    )
  })

  it('returns 400 when newPassword has no uppercase letter', () => {
    const { req, res, next } = makeMocks({ currentPassword: 'OldPass1!', newPassword: 'newpass1!' })

    validatePasswordChange(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ errors: expect.arrayContaining([expect.stringContaining('uppercase')]) })
    )
  })

  it('returns 400 when newPassword has no number', () => {
    const { req, res, next } = makeMocks({ currentPassword: 'OldPass1!', newPassword: 'NewPassword!' })

    validatePasswordChange(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ errors: expect.arrayContaining([expect.stringContaining('number')]) })
    )
  })

  it('returns 400 when newPassword has no special character', () => {
    const { req, res, next } = makeMocks({ currentPassword: 'OldPass1!', newPassword: 'NewPassword1' })

    validatePasswordChange(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ errors: expect.arrayContaining([expect.stringContaining('special character')]) })
    )
  })

  it('returns 400 when newPassword is the same as currentPassword', () => {
    const { req, res, next } = makeMocks({ currentPassword: 'SamePass1!', newPassword: 'SamePass1!' })

    validatePasswordChange(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ errors: expect.arrayContaining([expect.stringContaining('different')]) })
    )
  })
})

// ── validateWalletAddress ─────────────────────────────────────────────────────

describe('validateWalletAddress', () => {
  const VALID_ADDRESS = 'G' + 'A'.repeat(55)

  it('calls next() for a valid Stellar wallet address', () => {
    const { req, res, next } = makeMocks({ walletAddress: VALID_ADDRESS })

    validateWalletAddress(req as Request, res as Response, next)

    expect(next).toHaveBeenCalledOnce()
    expect(res.status).not.toHaveBeenCalled()
  })

  it('returns 400 when walletAddress is missing', () => {
    const { req, res, next } = makeMocks({})

    validateWalletAddress(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ errors: expect.arrayContaining([expect.stringContaining('required')]) })
    )
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 400 when walletAddress does not start with G', () => {
    const { req, res, next } = makeMocks({ walletAddress: 'X' + 'A'.repeat(55) })

    validateWalletAddress(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ errors: expect.arrayContaining([expect.stringContaining('Invalid Stellar')]) })
    )
  })

  it('returns 400 when walletAddress is too short', () => {
    const { req, res, next } = makeMocks({ walletAddress: 'GABC123' })

    validateWalletAddress(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ errors: expect.arrayContaining([expect.stringContaining('Invalid Stellar')]) })
    )
  })

  it('returns 400 when walletAddress contains lowercase characters', () => {
    const { req, res, next } = makeMocks({ walletAddress: 'g' + 'a'.repeat(55) })

    validateWalletAddress(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ errors: expect.arrayContaining([expect.stringContaining('Invalid Stellar')]) })
    )
  })

  it('returns 400 when walletAddress is not a string', () => {
    const { req, res, next } = makeMocks({ walletAddress: 12345 })

    validateWalletAddress(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(next).not.toHaveBeenCalled()
  })
})