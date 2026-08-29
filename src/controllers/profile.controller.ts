import { Request, Response } from 'express'
import { ProfileService } from '../services/profile.service'
import { requestAuditContext } from '../utils/audit-context'
// One allow-list for owner-updatable profile fields, shared with
// `PATCH /users/me` — two copies would drift, and a drifted copy is how a
// field becomes writable on one route and not the other.
import { updateProfileSchema } from '../schemas/profile.schema'

const profileService = new ProfileService()

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
   *     description: >
   *       Closed body: only owner-updatable profile fields are accepted, and the
   *       change is written together with its audit event in one transaction.
   *     tags: [Profiles]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/UpdateProfileInput'
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

      await profileService.updateProfileAudited(userId, validation.data, requestAuditContext(req))
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
