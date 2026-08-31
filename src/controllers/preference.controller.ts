import { Request, Response } from 'express'
import { z } from 'zod'
import { PreferenceService } from '../services/preference.service'
import {
  DIFFICULTY_LEVELS,
  PROFILE_VISIBILITIES,
  SUPPORTED_LOCALES,
  TEXT_SIZES,
} from '../types/preference.types'

const preferenceService = new PreferenceService()

const isValidTimezone = (value: string): boolean => {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value })

    return true
  } catch {
    return false
  }
}

const updatePreferencesSchema = z
  .object({
    locale: z
      .enum(SUPPORTED_LOCALES, {
        errorMap: () => ({
          message: `Locale must be one of: ${SUPPORTED_LOCALES.join(', ')}`,
        }),
      })
      .optional(),
    timezone: z
      .string()
      .refine(isValidTimezone, { message: 'Invalid IANA timezone' })
      .optional(),
    lowDataMode: z.boolean().optional(),
    highContrast: z.boolean().optional(),
    reduceMotion: z.boolean().optional(),
    screenReaderOptimized: z.boolean().optional(),
    textSize: z
      .enum(TEXT_SIZES, {
        errorMap: () => ({
          message: `Text size must be one of: ${TEXT_SIZES.join(', ')}`,
        }),
      })
      .optional(),
    preferredDifficulty: z
      .enum(DIFFICULTY_LEVELS, {
        errorMap: () => ({
          message: `Difficulty must be one of: ${DIFFICULTY_LEVELS.join(', ')}`,
        }),
      })
      .optional(),
    preferredCategories: z.array(z.string().min(1)).max(50).optional(),
    profileVisibility: z
      .enum(PROFILE_VISIBILITIES, {
        errorMap: () => ({
          message: `Profile visibility must be one of: ${PROFILE_VISIBILITIES.join(', ')}`,
        }),
      })
      .optional(),
    analyticsConsent: z.boolean().optional(),
    dataSharingConsent: z.boolean().optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one preference field is required',
  })

export class PreferenceController {
  /**
   * @openapi
   * /users/me/preferences:
   *   get:
   *     summary: Get current authenticated user's learner preferences
   *     tags: [Preferences]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Preferences retrieved successfully
   *       401:
   *         description: Unauthorized
   */
  async getPreferences(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' })

        return
      }

      const preferences = await preferenceService.getPreferences(userId)

      res.status(200).json({ data: preferences })
    } catch (error) {
      console.error('Get preferences error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * @openapi
   * /users/me/preferences:
   *   patch:
   *     summary: Partially update current authenticated user's learner preferences
   *     tags: [Preferences]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               locale:
   *                 type: string
   *               timezone:
   *                 type: string
   *               lowDataMode:
   *                 type: boolean
   *               highContrast:
   *                 type: boolean
   *               reduceMotion:
   *                 type: boolean
   *               screenReaderOptimized:
   *                 type: boolean
   *               textSize:
   *                 type: string
   *               preferredDifficulty:
   *                 type: string
   *               preferredCategories:
   *                 type: array
   *                 items:
   *                   type: string
   *               profileVisibility:
   *                 type: string
   *               analyticsConsent:
   *                 type: boolean
   *               dataSharingConsent:
   *                 type: boolean
   *     responses:
   *       200:
   *         description: Preferences updated successfully
   *       400:
   *         description: Validation failed
   *       401:
   *         description: Unauthorized
   */
  async updatePreferences(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' })

        return
      }

      const validation = updatePreferencesSchema.safeParse(req.body)
      if (!validation.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: validation.error.format(),
        })

        return
      }

      const preferences = await preferenceService.updatePreferences(
        userId,
        validation.data,
      )

      res.status(200).json({
        message: 'Preferences updated successfully',
        data: preferences,
      })
    } catch (error) {
      console.error('Update preferences error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  }
}
