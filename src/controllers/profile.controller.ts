import { Request, Response } from 'express'
import { z } from 'zod'
import { ProfileService } from '../services/profile.service'
import { LEARNER_LEVELS, PROFILE_VISIBILITIES } from '../types/profile.types'

const profileService = new ProfileService()

const updateProfileSchema = z
  .object({
    displayName: z.string().min(1).max(80).nullable().optional(),
    bio: z.string().max(1000).nullable().optional(),
    avatarUrl: z.string().url().nullable().optional(),
    country: z.string().min(2).max(60).nullable().optional(),
    timezone: z.string().nullable().optional(),
    languages: z.array(z.string().min(1)).max(20).optional(),
    level: z.enum(LEARNER_LEVELS, {
      errorMap: () => ({ message: `Level must be one of: ${LEARNER_LEVELS.join(', ')}` }),
    }).optional(),
    interests: z.array(z.string().min(1)).max(50).optional(),
    goals: z.array(z.string().min(1)).max(20).optional(),
    visibility: z.enum(PROFILE_VISIBILITIES, {
      errorMap: () => ({ message: `Visibility must be one of: ${PROFILE_VISIBILITIES.join(', ')}` }),
    }).optional(),
  })
  .strict()
  .refine(data => Object.keys(data).length > 0, { message: 'At least one profile field is required' })

export class ProfileController {
  /**
   * @openapi
   * /users/me/profile:
   *   get:
   *     summary: Get the authenticated user's full learner profile
   *     tags: [Profiles]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Profile retrieved successfully
   *       401:
   *         description: Unauthorized
   */
  async getMyProfile(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' })

        return
      }

      const profile = await profileService.getOwnerView(userId)

      res.status(200).json({ data: profile })
    } catch (error) {
      console.error('Get profile error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * @openapi
   * /users/me/profile:
   *   patch:
   *     summary: Partially update the authenticated user's learner profile
   *     tags: [Profiles]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Profile updated successfully
   *       400:
   *         description: Validation failed
   *       401:
   *         description: Unauthorized
   */
  async updateMyProfile(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' })

        return
      }

      const validation = updateProfileSchema.safeParse(req.body)
      if (!validation.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: validation.error.format(),
        })

        return
      }

      await profileService.updateProfile(userId, validation.data)
      const profile = await profileService.getOwnerView(userId)

      res.status(200).json({
        message: 'Profile updated successfully',
        data: profile,
      })
    } catch (error) {
      console.error('Update profile error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * @openapi
   * /users/{id}/profile:
   *   get:
   *     summary: Get a learner's profile, scoped to the caller's visibility level
   *     tags: [Profiles]
   *     security: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *           format: uuid
   *     responses:
   *       200:
   *         description: Profile retrieved successfully, subject to the owner's visibility setting
   *       404:
   *         description: Profile not found
   */
  async getProfileById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params

      if (req.user?.id === id) {
        const profile = await profileService.getOwnerView(id)
        res.status(200).json({ data: profile })

        return
      }

      const profile = req.user?.role === 'employer'
        ? await profileService.getEmployerView(id)
        : await profileService.getPublicView(id)

      if (!profile) {
        res.status(404).json({ error: 'Profile not found' })

        return
      }

      res.status(200).json({ data: profile })
    } catch (error) {
      console.error('Get profile by id error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  }
}
