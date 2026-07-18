import { z } from 'zod'
import {
  MAX_AVATAR_SIZE_BYTES,
} from '../types/avatar.types'

export const createUploadIntentSchema = z.object({
  mimeType: z.enum([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
  ]),
  sizeBytes: z
    .number()
    .int('File size must be an integer')
    .min(1, 'File must not be empty')
    .max(MAX_AVATAR_SIZE_BYTES, 'File must be less than 5MB'),
})

export const finalizeUploadSchema = z.object({
  intentId: z.string().uuid('Invalid intent ID format'),
})

export const updateProfileSchema = z.object({
  displayName: z.string().max(50, 'Display name must be 50 characters or less').optional(),
  bio: z.string().max(500, 'Bio must be 500 characters or less').optional(),
  country: z.string().length(2, 'Country must be a 2-letter ISO code').optional(),
  timezone: z.string().max(50, 'Timezone must be 50 characters or less').optional(),
  languages: z
    .array(
      z
        .string()
        .max(10, 'Language must be 10 characters or less')
        .regex(/^[a-z]{2}$/i, 'Language must be a 2-letter code'),
    )
    .max(20, 'Maximum of 20 languages allowed')
    .optional(),
  skillLevel: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  interests: z
    .array(z.string().max(50, 'Interest must be 50 characters or less'))
    .max(20, 'Maximum of 20 interests allowed')
    .optional(),
  goals: z.string().max(500, 'Goals must be 500 characters or less').optional(),
  profileVisibility: z.enum(['public', 'private']).optional(),
})

export type CreateUploadIntentSchemaInput = z.infer<typeof createUploadIntentSchema>
export type FinalizeUploadSchemaInput = z.infer<typeof finalizeUploadSchema>
export type UpdateProfileSchemaInput = z.infer<typeof updateProfileSchema>
