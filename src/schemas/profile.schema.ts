import { z } from 'zod'
import { LEARNER_LEVELS, PROFILE_VISIBILITIES } from '../types/profile.types'
import { commonSchemas } from '../middleware/validation.middleware'

/**
 * The owner-updatable profile field set — the single source of truth for
 * "which fields may an owner change".
 *
 * `.strict()` is what enforces the allow-list: anything outside this object is
 * a 400, not a silently ignored key. That matters more than it looks, because
 * the fields deliberately *absent* here are the ones an owner must never be
 * able to set through a profile write — `id`, `userId`, the `archived*` columns,
 * and every account-private field on `User` (`status`, `isVerified`,
 * `phoneVerifiedAt`, `role`, `password`).
 *
 * `avatarUrl` is present because the profile record owns it, but the avatar
 * upload flow (src/services/avatar.service.ts) is the normal way it changes.
 */
export const profileUpdateFieldsShape = {
  displayName: z.string().min(1).max(80).nullable().optional(),
  bio: z.string().max(1000).nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
  country: z.string().min(2).max(60).nullable().optional(),
  timezone: z.string().nullable().optional(),
  languages: z.array(z.string().min(1)).max(20).optional(),
  level: z
    .enum(LEARNER_LEVELS, {
      errorMap: () => ({
        message: `Level must be one of: ${LEARNER_LEVELS.join(', ')}`,
      }),
    })
    .optional(),
  interests: z.array(z.string().min(1)).max(50).optional(),
  goals: z.array(z.string().min(1)).max(20).optional(),
  visibility: z
    .enum(PROFILE_VISIBILITIES, {
      errorMap: () => ({
        message: `Visibility must be one of: ${PROFILE_VISIBILITIES.join(', ')}`,
      }),
    })
    .optional(),
} as const

/** Field names an owner is allowed to write, derived from the schema itself. */
export const OWNER_UPDATABLE_PROFILE_FIELDS = Object.keys(
  profileUpdateFieldsShape,
) as readonly (keyof typeof profileUpdateFieldsShape)[]

export const updateProfileSchema = z
  .object(profileUpdateFieldsShape)
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one profile field is required',
  })

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: commonSchemas.password,
  })
  .strict()
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'New password must be different from current password',
    path: ['newPassword'],
  })

export const updateWalletSchema = z
  .object({
    walletAddress: commonSchemas.walletAddress,
  })
  .strict()

export const userIdParamSchema = z.object({
  id: z.string().uuid('Invalid user id'),
})

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
export type UpdateWalletInput = z.infer<typeof updateWalletSchema>
