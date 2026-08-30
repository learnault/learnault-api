import { Request, Response } from 'express'
import { z } from 'zod'
import { onboardingService } from '../services/onboarding.service'
import { ONBOARDING_STEPS } from '../types/onboarding.types'

const saveStepSchema = z.object({
  step: z.enum(ONBOARDING_STEPS, {
    errorMap: () => ({
      message: `Step must be one of: ${ONBOARDING_STEPS.join(', ')}`,
    }),
  }),
})

export class OnboardingController {
  /**
   * @openapi
   * /onboarding:
   *   get:
   *     summary: Resume the authenticated user's onboarding progress
   *     tags: [Onboarding]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Onboarding progress retrieved successfully
   *       401:
   *         description: Unauthorized
   */
  async getProgress(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' })

        return
      }

      const progress = await onboardingService.resume(userId)

      res.status(200).json({ data: progress })
    } catch (error) {
      console.error('Get onboarding progress error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * @openapi
   * /onboarding/steps:
   *   post:
   *     summary: Save (or idempotently re-save) an onboarding step
   *     tags: [Onboarding]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Step saved successfully
   *       400:
   *         description: Validation failed
   *       401:
   *         description: Unauthorized
   *       409:
   *         description: Onboarding is already completed
   */
  async saveStep(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' })

        return
      }

      const validation = saveStepSchema.safeParse(req.body)
      if (!validation.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: validation.error.format(),
        })

        return
      }

      const result = await onboardingService.saveStep(
        userId,
        validation.data.step,
      )

      if (result.kind === 'already-completed') {
        res.status(409).json({
          error: 'Onboarding is already completed',
          data: result.progress,
        })

        return
      }

      res
        .status(200)
        .json({ message: 'Step saved successfully', data: result.progress })
    } catch (error) {
      console.error('Save onboarding step error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * @openapi
   * /onboarding/complete:
   *   post:
   *     summary: Complete onboarding once all required steps and consents are satisfied
   *     tags: [Onboarding]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Onboarding completed successfully
   *       401:
   *         description: Unauthorized
   *       409:
   *         description: Required steps or consents are missing
   */
  async complete(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' })

        return
      }

      const result = await onboardingService.complete(userId)

      if (result.kind === 'incomplete-steps') {
        res.status(409).json({
          error: 'Required onboarding steps are missing',
          missingSteps: result.missingSteps,
        })

        return
      }

      if (result.kind === 'missing-required-consent') {
        res.status(409).json({ error: 'Required consent has not been granted' })

        return
      }

      res.status(200).json({
        message: 'Onboarding completed successfully',
        data: result.progress,
      })
    } catch (error) {
      console.error('Complete onboarding error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  }
}
