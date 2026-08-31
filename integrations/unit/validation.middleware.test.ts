import { NextFunction, Request, Response } from 'express'
import { describe, expect, it, vi } from 'vitest'
import {
  validate,
  validatePasswordChange,
  validateProfileUpdate,
  validateWalletAddress,
  commonSchemas,
} from '../../src/middleware/validation.middleware'
import { z } from 'zod'

// ── helpers ───────────────────────────────────────────────────────────────────

function makeMocks(
  body: Record<string, any> = {},
  query: Record<string, any> = {},
  params: Record<string, any> = {},
) {
  const req = { body, query, params } as Partial<Request>
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as Partial<Response>
  const next: NextFunction = vi.fn()

  return { req, res, next }
}

// ── commonSchemas ─────────────────────────────────────────────────────────────

describe('commonSchemas', () => {
  describe('email', () => {
    it('validates correct email', () => {
      expect(() => commonSchemas.email.parse('test@example.com')).not.toThrow()
    })

    it('rejects invalid email', () => {
      expect(() => commonSchemas.email.parse('invalid-email')).toThrow(
        'Invalid email format',
      )
    })
  })

  describe('password', () => {
    it('validates strong password', () => {
      expect(() => commonSchemas.password.parse('StrongPass1!')).not.toThrow()
    })

    it('rejects short password', () => {
      expect(() => commonSchemas.password.parse('Ab1!')).toThrow(
        'Password must be at least 8 characters long',
      )
    })

    it('rejects password without lowercase', () => {
      expect(() => commonSchemas.password.parse('STRONGPASS1!')).toThrow(
        'Password must contain at least one lowercase letter',
      )
    })

    it('rejects password without uppercase', () => {
      expect(() => commonSchemas.password.parse('strongpass1!')).toThrow(
        'Password must contain at least one uppercase letter',
      )
    })

    it('rejects password without number', () => {
      expect(() => commonSchemas.password.parse('StrongPass!')).toThrow(
        'Password must contain at least one number',
      )
    })

    it('rejects password without special character', () => {
      expect(() => commonSchemas.password.parse('StrongPass1')).toThrow(
        'Password must contain at least one special character',
      )
    })
  })

  describe('id', () => {
    it('validates correct UUID', () => {
      expect(() =>
        commonSchemas.id.parse('123e4567-e89b-12d3-a456-426614174000'),
      ).not.toThrow()
    })

    it('rejects invalid UUID', () => {
      expect(() => commonSchemas.id.parse('not-a-uuid')).toThrow(
        'Invalid ID format',
      )
    })
  })

  describe('username', () => {
    it('validates correct username', () => {
      expect(() => commonSchemas.username.parse('valid_user123')).not.toThrow()
    })

    it('rejects short username', () => {
      expect(() => commonSchemas.username.parse('ab')).toThrow(
        'Username must be at least 3 characters long',
      )
    })

    it('rejects long username', () => {
      expect(() => commonSchemas.username.parse('a'.repeat(31))).toThrow(
        'Username must be less than 30 characters',
      )
    })

    it('rejects username with invalid characters', () => {
      expect(() => commonSchemas.username.parse('bad user!')).toThrow(
        'Username can only contain letters, numbers, and underscores',
      )
    })
  })

  describe('walletAddress', () => {
    it('validates correct Stellar address', () => {
      expect(() =>
        commonSchemas.walletAddress.parse('G' + 'A'.repeat(55)),
      ).not.toThrow()
    })

    it('rejects invalid Stellar address', () => {
      expect(() =>
        commonSchemas.walletAddress.parse('X' + 'A'.repeat(55)),
      ).toThrow('Invalid Stellar wallet address format')
    })
  })

  describe('url', () => {
    it('validates correct URL', () => {
      expect(() => commonSchemas.url.parse('https://example.com')).not.toThrow()
    })

    it('rejects invalid URL', () => {
      expect(() => commonSchemas.url.parse('not-a-url')).toThrow(
        'Invalid URL format',
      )
    })
  })
})

// ── validate function ─────────────────────────────────────────────────────────

describe('validate', () => {
  it('calls next() when validation passes', () => {
    const schema = z.object({ name: z.string() })
    const middleware = validate({ body: schema })
    const { req, res, next } = makeMocks({ name: 'test' })

    middleware(req as Request, res as Response, next)

    expect(next).toHaveBeenCalledOnce()
    expect(res.status).not.toHaveBeenCalled()
  })

  it('returns 400 with body errors when body validation fails', () => {
    const schema = z.object({ name: z.string().min(5) })
    const middleware = validate({ body: schema })
    const { req, res, next } = makeMocks({ name: 'abc' })

    middleware(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      message: 'Validation failed',
      errors: { body: ['String must contain at least 5 character(s)'] },
    })
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 400 with query errors when query validation fails', () => {
    const schema = z.object({ limit: z.number() })
    const middleware = validate({ query: schema })
    const { req, res, next } = makeMocks({}, { limit: 'not-a-number' })

    middleware(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      message: 'Validation failed',
      errors: { query: expect.any(Array) },
    })
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 400 with params errors when params validation fails', () => {
    const schema = z.object({ id: z.string().uuid() })
    const middleware = validate({ params: schema })
    const { req, res, next } = makeMocks({}, {}, { id: 'not-a-uuid' })

    middleware(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      message: 'Validation failed',
      errors: { params: ['Invalid ID format'] },
    })
    expect(next).not.toHaveBeenCalled()
  })

  it('validates multiple parts and collects all errors', () => {
    const bodySchema = z.object({ name: z.string().min(5) })
    const querySchema = z.object({ limit: z.number() })
    const middleware = validate({ body: bodySchema, query: querySchema })
    const { req, res, next } = makeMocks(
      { name: 'abc' },
      { limit: 'not-a-number' },
    )

    middleware(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(400)
    const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(response.errors).toHaveProperty('body')
    expect(response.errors).toHaveProperty('query')
    expect(next).not.toHaveBeenCalled()
  })

  it('parses and updates req.body when validation passes', () => {
    const schema = z.object({
      age: z.string().transform((val) => parseInt(val)),
    })
    const middleware = validate({ body: schema })
    const { req, res, next } = makeMocks({ age: '25' })

    middleware(req as Request, res as Response, next)

    expect(req.body.age).toBe(25)
    expect(next).toHaveBeenCalledOnce()
  })
})

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
    expect(res.json).toHaveBeenCalledWith({
      message: 'Validation failed',
      errors: { body: ['Username must be at least 3 characters long'] },
    })
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 400 when username exceeds 30 characters', () => {
    const { req, res, next } = makeMocks({ username: 'a'.repeat(31) })

    validateProfileUpdate(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      message: 'Validation failed',
      errors: { body: ['Username must be less than 30 characters'] },
    })
  })

  it('returns 400 when username contains invalid characters', () => {
    const { req, res, next } = makeMocks({ username: 'bad user!' })

    validateProfileUpdate(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      message: 'Validation failed',
      errors: {
        body: ['Username can only contain letters, numbers, and underscores'],
      },
    })
  })

  it('returns 400 when firstName exceeds 50 characters', () => {
    const { req, res, next } = makeMocks({ firstName: 'A'.repeat(51) })

    validateProfileUpdate(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      message: 'Validation failed',
      errors: { body: ['First name must be less than 50 characters'] },
    })
  })

  it('returns 400 when lastName exceeds 50 characters', () => {
    const { req, res, next } = makeMocks({ lastName: 'B'.repeat(51) })

    validateProfileUpdate(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      message: 'Validation failed',
      errors: { body: ['Last name must be less than 50 characters'] },
    })
  })

  it('returns 400 when bio exceeds 500 characters', () => {
    const { req, res, next } = makeMocks({ bio: 'x'.repeat(501) })

    validateProfileUpdate(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      message: 'Validation failed',
      errors: { body: ['Bio must be less than 500 characters'] },
    })
  })

  it('returns 400 when avatar is not a valid URL', () => {
    const { req, res, next } = makeMocks({ avatar: 'not-a-url' })

    validateProfileUpdate(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      message: 'Validation failed',
      errors: { body: ['Invalid URL format'] },
    })
  })

  it('returns multiple errors when multiple fields are invalid', () => {
    const { req, res, next } = makeMocks({
      username: 'ab',
      bio: 'x'.repeat(501),
    })

    validateProfileUpdate(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(400)
    const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(response.errors.body.length).toBeGreaterThanOrEqual(2)
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
    expect(res.json).toHaveBeenCalledWith({
      message: 'Validation failed',
      errors: { body: ['Current password is required'] },
    })
  })

  it('returns 400 when newPassword is missing', () => {
    const { req, res, next } = makeMocks({ currentPassword: 'OldPass1!' })

    validatePasswordChange(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      message: 'Validation failed',
      errors: { body: ['New password is required'] },
    })
  })

  it('returns 400 when newPassword is too short', () => {
    const { req, res, next } = makeMocks({
      currentPassword: 'OldPass1!',
      newPassword: 'Ab1!',
    })

    validatePasswordChange(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      message: 'Validation failed',
      errors: { body: ['Password must be at least 8 characters long'] },
    })
  })

  it('returns 400 when newPassword has no lowercase letter', () => {
    const { req, res, next } = makeMocks({
      currentPassword: 'OldPass1!',
      newPassword: 'NEWPASS1!',
    })

    validatePasswordChange(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      message: 'Validation failed',
      errors: { body: ['Password must contain at least one lowercase letter'] },
    })
  })

  it('returns 400 when newPassword has no uppercase letter', () => {
    const { req, res, next } = makeMocks({
      currentPassword: 'OldPass1!',
      newPassword: 'newpass1!',
    })

    validatePasswordChange(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      message: 'Validation failed',
      errors: { body: ['Password must contain at least one uppercase letter'] },
    })
  })

  it('returns 400 when newPassword has no number', () => {
    const { req, res, next } = makeMocks({
      currentPassword: 'OldPass1!',
      newPassword: 'NewPassword!',
    })

    validatePasswordChange(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      message: 'Validation failed',
      errors: { body: ['Password must contain at least one number'] },
    })
  })

  it('returns 400 when newPassword has no special character', () => {
    const { req, res, next } = makeMocks({
      currentPassword: 'OldPass1!',
      newPassword: 'NewPassword1',
    })

    validatePasswordChange(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      message: 'Validation failed',
      errors: {
        body: ['Password must contain at least one special character'],
      },
    })
  })

  it('returns 400 when newPassword is the same as currentPassword', () => {
    const { req, res, next } = makeMocks({
      currentPassword: 'SamePass1!',
      newPassword: 'SamePass1!',
    })

    validatePasswordChange(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      message: 'Validation failed',
      errors: {
        body: ['New password must be different from current password'],
      },
    })
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
    expect(res.json).toHaveBeenCalledWith({
      message: 'Validation failed',
      errors: { body: ['Required'] },
    })
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 400 when walletAddress does not start with G', () => {
    const { req, res, next } = makeMocks({
      walletAddress: 'X' + 'A'.repeat(55),
    })

    validateWalletAddress(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      message: 'Validation failed',
      errors: { body: ['Invalid Stellar wallet address format'] },
    })
  })

  it('returns 400 when walletAddress is too short', () => {
    const { req, res, next } = makeMocks({ walletAddress: 'GABC123' })

    validateWalletAddress(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      message: 'Validation failed',
      errors: { body: ['Invalid Stellar wallet address format'] },
    })
  })

  it('returns 400 when walletAddress contains lowercase characters', () => {
    const { req, res, next } = makeMocks({
      walletAddress: 'g' + 'a'.repeat(55),
    })

    validateWalletAddress(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      message: 'Validation failed',
      errors: { body: ['Invalid Stellar wallet address format'] },
    })
  })

  it('returns 400 when walletAddress is not a string', () => {
    const { req, res, next } = makeMocks({ walletAddress: 12345 })

    validateWalletAddress(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      message: 'Validation failed',
      errors: { body: ['Expected string, received number'] },
    })
    expect(next).not.toHaveBeenCalled()
  })
})
