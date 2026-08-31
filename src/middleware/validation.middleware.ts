import { Request, Response, NextFunction } from 'express'
import { z, ZodSchema, ZodError } from 'zod'
import { ErrorCode } from '../types/api.types'

// Helper to normalize zod issue messages to the project's expected wording
const formatZodMessages = (issues: any[] = []) => {
  return issues.map((issue) => {
    const path = (issue.path || []).join('.')
    const msg = issue.message || ''

    // Map specific cases expected by tests
    if (/uuid/i.test(msg) && path === 'id') return 'Invalid ID format'

    if (msg === 'Required') {
      if (path === 'currentPassword') return 'Current password is required'
      if (path === 'newPassword') return 'New password is required'

      return 'Required'
    }

    return msg
  })
}

// ── Common validation schemas ────────────────────────────────────────────────
// These can be reused across different routes and controllers

export const commonSchemas = {
  email: z.string().email('Invalid email format'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters long')
    .regex(/(?=.*[a-z])/, 'Password must contain at least one lowercase letter')
    .regex(/(?=.*[A-Z])/, 'Password must contain at least one uppercase letter')
    .regex(/(?=.*\d)/, 'Password must contain at least one number')
    .regex(
      /(?=.*[@$!%*?&])/,
      'Password must contain at least one special character',
    ),
  id: z.string().uuid('Invalid ID format'),
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters long')
    .max(30, 'Username must be less than 30 characters')
    .regex(
      /^[a-zA-Z0-9_]+$/,
      'Username can only contain letters, numbers, and underscores',
    ),
  walletAddress: z
    .string()
    .regex(/^[G][A-Z0-9]{55}$/, 'Invalid Stellar wallet address format'),
  url: z.string().url('Invalid URL format'),
}

// ── Validation middleware options & factory ─────────────────────────────────

export interface ValidationSchemas {
  body?: ZodSchema
  query?: ZodSchema
  params?: ZodSchema
  stripUnknown?: boolean
}

export const validate = (schemas: ValidationSchemas) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const errors: Record<string, string[]> = {}

    // Validate body
    if (schemas.body) {
      try {
        req.body = schemas.body.parse(req.body)
      } catch (error) {
        if (error instanceof ZodError) {
          const rawIssues =
            (error as ZodError).issues ?? (error as any).errors ?? []
          const msgs = formatZodMessages(rawIssues)
          errors.body = msgs
        }
      }
    }

    // Validate query
    if (schemas.query) {
      try {
        req.query = schemas.query.parse(req.query)
      } catch (error) {
        if (error instanceof ZodError) {
          const rawIssues =
            (error as ZodError).issues ?? (error as any).errors ?? []
          const msgs = formatZodMessages(rawIssues)
          errors.query = msgs
        }
      }
    }

    // Validate params
    if (schemas.params) {
      try {
        req.params = schemas.params.parse(req.params)
      } catch (error) {
        if (error instanceof ZodError) {
          const rawIssues =
            (error as ZodError).issues ?? (error as any).errors ?? []
          const msgs = formatZodMessages(rawIssues)
          errors.params = msgs
        }
      }
    }

    // If there are errors, return 400 with standardized validation error envelope
    if (Object.keys(errors).length > 0) {
      const requestId = req.requestId || 'unknown'
      const timestamp = new Date().toISOString()

      res.status(400).json({
        success: false,
        error: {
          code: ErrorCode.VALIDATION_ERROR,
          message: 'Validation failed',
          details: errors,
        },
        message: 'Validation failed', // Legacy fallback for direct assertion compatibility
        errors, // Legacy fallback for field-specific error checks
        requestId,
        timestamp,
      })

      return
    }

    next()
  }
}

// Specific validation middlewares for backward compatibility.
//
// `validateProfileUpdate` is **deprecated and no longer mounted on any route**.
// It validates the mock-era `firstName`/`lastName`/`bio`/`avatar` body, none of
// which is a persisted column: learner profile data lives on `LearnerProfile`.
// The live allow-list is `updateProfileSchema` in src/schemas/profile.schema.ts,
// applied inside the controller. Do not wire this back up.
export const validateProfileUpdate = validate({
  body: z.object({
    username: commonSchemas.username.optional(),
    firstName: z
      .string()
      .max(50, 'First name must be less than 50 characters')
      .optional(),
    lastName: z
      .string()
      .max(50, 'Last name must be less than 50 characters')
      .optional(),
    bio: z.string().max(500, 'Bio must be less than 500 characters').optional(),
    avatar: commonSchemas.url.optional(),
  }),
})

export const validatePasswordChange = validate({
  body: z
    .object({
      currentPassword: z.string().min(1, 'Current password is required'),
      newPassword: commonSchemas.password,
    })
    .refine(
      (data: { currentPassword: string; newPassword: string }) =>
        data.currentPassword !== data.newPassword,
      {
        message: 'New password must be different from current password',
        path: ['newPassword'],
      },
    ),
})

export const validateWalletAddress = validate({
  body: z.object({
    walletAddress: commonSchemas.walletAddress,
  }),
})
