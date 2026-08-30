import { Router } from 'express'
import { NotificationController } from '../../controllers/notification.controller'
import { authenticate } from '../../middleware/auth.middleware'

const router: Router = Router()
const notificationController = new NotificationController()

/**
 * @route POST /api/v1/notifications/devices
 * @desc Register a device token for push notifications
 * @access Private
 */
router.post(
  '/devices',
  authenticate,
  notificationController.registerDevice.bind(notificationController),
)

/**
 * @route PATCH /api/v1/notifications/preferences
 * @desc Update notification preferences
 * @access Private
 */
router.patch(
  '/preferences',
  authenticate,
  notificationController.updatePreferences.bind(notificationController),
)

/**
 * @route GET /api/v1/notifications/delivery-status
 * @desc Get delivery status logs for the authenticated user
 * @access Private
 */
router.get(
  '/delivery-status',
  authenticate,
  notificationController.getDeliveryStatus.bind(notificationController),
)

export default router
