import { Request, Response } from 'express'
import { z } from 'zod'
import { consentService } from '../services/consent.service'
import { CONSENT_PURPOSES, CONSENT_SOURCES } from '../types/consent.types'

const grantConsentSchema = z.object({
  purpose: z.enum(CONSENT_PURPOSES, {
    errorMap: () => ({ message: `Purpose must be one of: ${CONSENT_PURPOSES.join(', ')}` }),
  }),
  policyVersion: z.string().min(1),
  source: z.enum(CONSENT_SOURCES, {
    errorMap: () => ({ message: `Source must be one of: ${CONSENT_SOURCES.join(', ')}` }),
  }),
})

const withdrawConsentSchema = z.object({
  purpose: z.enum(CONSENT_PURPOSES, {
    errorMap: () => ({ message: `Purpose must be one of: ${CONSENT_PURPOSES.join(', ')}` }),
  }),
  source: z.enum(CONSENT_SOURCES, {
    errorMap: () => ({ message: `Source must be one of: ${CONSENT_SOURCES.join(', ')}` }),
  }),
})

const historyQuerySchema = z.object({
  purpose: z.enum(CONSENT_PURPOSES).optional(),
})

export class ConsentController {
  /**
   * @openapi
   * /consents:
   *   get:
   *     summary: Get the authenticated user's current consent per purpose
   *     tags: [Consents]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Current consents retrieved successfully
   *       401:
   *         description: Unauthorized
   */
  async getCurrent(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' })

        return
      }

      const consents = await consentService.getCurrent(userId)

      res.status(200).json({ data: consents })
    } catch (error) {
      console.error('Get current consents error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * @openapi
   * /consents/history:
   *   get:
   *     summary: Get the authenticated user's full consent history, optionally filtered by purpose
   *     tags: [Consents]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Consent history retrieved successfully
   *       400:
   *         description: Validation failed
   *       401:
   *         description: Unauthorized
   */
  async getHistory(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' })

        return
      }

      const validation = historyQuerySchema.safeParse(req.query)
      if (!validation.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: validation.error.format(),
        })

        return
      }

      const history = await consentService.getHistory(userId, validation.data.purpose)

      res.status(200).json({ data: history })
    } catch (error) {
      console.error('Get consent history error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * @openapi
   * /consents/grant:
   *   post:
   *     summary: Grant consent for a purpose
   *     tags: [Consents]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Consent granted successfully
   *       400:
   *         description: Validation failed
   *       401:
   *         description: Unauthorized
   */
  async grant(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' })

        return
      }

      const validation = grantConsentSchema.safeParse(req.body)
      if (!validation.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: validation.error.format(),
        })

        return
      }

      const record = await consentService.grant(userId, validation.data)

      res.status(200).json({ message: 'Consent granted successfully', data: record })
    } catch (error) {
      console.error('Grant consent error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * @openapi
   * /consents/withdraw:
   *   post:
   *     summary: Withdraw a previously granted, optional consent
   *     tags: [Consents]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Consent withdrawn successfully
   *       400:
   *         description: Validation failed
   *       401:
   *         description: Unauthorized
   *       409:
   *         description: Consent is required and cannot be withdrawn, or was never granted
   */
  async withdraw(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' })

        return
      }

      const validation = withdrawConsentSchema.safeParse(req.body)
      if (!validation.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: validation.error.format(),
        })

        return
      }

      const result = await consentService.withdraw(userId, validation.data)

      if (result.kind === 'not-granted') {
        res.status(409).json({ error: 'Consent was never granted' })

        return
      }

      if (result.kind === 'required-cannot-withdraw') {
        res.status(409).json({ error: 'Required consent cannot be withdrawn' })

        return
      }

      res.status(200).json({ message: 'Consent withdrawn successfully', data: result.record })
    } catch (error) {
      console.error('Withdraw consent error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  }
}
