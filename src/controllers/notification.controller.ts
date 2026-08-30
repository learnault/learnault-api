import { Request, Response } from 'express'
import { z } from 'zod'
import { NotificationService } from '../services/notification.service'
import prisma from '../config/database'

const notificationService = new NotificationService()

const registerDeviceSchema = z.object({
  token: z.string().min(1, 'Device token is required'),
  platform: z.enum(['ios', 'android', 'web'], {
    errorMap: () => ({
      message: 'Platform must be "ios", "android", or "web"',
    }),
  }),
})

const updatePreferencesSchema = z
  .object({
    rewardReceipt: z.boolean().optional(),
    quizPassFail: z.boolean().optional(),
    streakReminders: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one preference field is required',
  })

export class NotificationController {
  /**
   * @openapi
   * /notifications/devices:
   *   post:
   *     operationId: notificationsRegisterDevice
   *     summary: Register a device token for push notifications
   *     tags: [Notifications]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/RegisterDeviceInput'
   *     responses:
   *       201:
   *         description: Device token registered successfully
   *       400:
   *         description: Validation failed
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       401:
   *         description: Unauthorized
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  async registerDevice(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' })

        return
      }

      const validation = registerDeviceSchema.safeParse(req.body)
      if (!validation.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: validation.error.format(),
        })

        return
      }

      const { token, platform } = validation.data
      const deviceToken = await notificationService.registerDeviceToken(
        userId,
        token,
        platform,
      )

      res.status(201).json({
        message: 'Device token registered successfully',
        data: deviceToken,
      })
    } catch (error) {
      console.error('Register device token error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * @openapi
   * /notifications/preferences:
   *   patch:
   *     operationId: notificationsUpdatePreferences
   *     summary: Update push notification preferences
   *     tags: [Notifications]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/NotificationPreferencesInput'
   *     responses:
   *       200:
   *         description: Preferences updated successfully
   *       400:
   *         description: Validation failed — at least one preference field required
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       401:
   *         description: Unauthorized
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
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

      const prefs = await notificationService.updateUserPreferences(
        userId,
        validation.data,
      )

      res.status(200).json({
        message: 'Preferences updated successfully',
        data: prefs,
      })
    } catch (error) {
      console.error('Update notification preferences error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * @openapi
   * /notifications/delivery-status:
   *   get:
   *     operationId: notificationsGetDeliveryStatus
   *     summary: Get notification delivery log for the authenticated user
   *     tags: [Notifications]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 20
   *           maximum: 100
   *       - in: query
   *         name: status
   *         schema:
   *           type: string
   *           enum: [pending, success, failed, dead-letter]
   *     responses:
   *       200:
   *         description: Delivery logs retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/NotificationLog'
   *                 count:
   *                   type: integer
   *       401:
   *         description: Unauthorized
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  async getDeliveryStatus(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' })

        return
      }

      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100)
      const status = req.query.status as string | undefined

      const logs = await prisma.notificationLog.findMany({
        where: {
          userId,
          ...(status ? { status } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          status: true,
          error: true,
          attemptCount: true,
          createdAt: true,
        },
      })

      res.status(200).json({
        data: logs,
        count: logs.length,
      })
    } catch (error) {
      console.error('Get delivery status error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  }
}
