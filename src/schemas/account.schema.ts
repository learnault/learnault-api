import { z } from 'zod'

export const deactivateSchema = z.object({
  password: z.string().min(1, 'Password is required'),
})

export const reactivateSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
})

export const requestDeletionSchema = z.object({
  password: z.string().min(1, 'Password is required'),
  reason: z
    .string()
    .max(500, 'Reason must be at most 500 characters')
    .optional(),
})

export const cancelDeletionSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
})

export const exportIdParamSchema = z.object({
  id: z.string().uuid('Invalid export id'),
})

export type DeactivateInput = z.infer<typeof deactivateSchema>
export type ReactivateInput = z.infer<typeof reactivateSchema>
export type RequestDeletionInput = z.infer<typeof requestDeletionSchema>
export type CancelDeletionInput = z.infer<typeof cancelDeletionSchema>
