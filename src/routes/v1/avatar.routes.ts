import { Router } from 'express'
import { AvatarController } from '../../controllers/avatar.controller'
import { authenticate } from '../../middleware/auth.middleware'

const router: Router = Router()
const avatarController = new AvatarController()

// All avatar routes require authentication
router.use(authenticate)

/**
 * @route POST /api/v1/users/me/avatar/upload-intent
 * @desc Create a short-lived upload intent for an avatar image
 * @access Private
 */
router.post(
  '/upload-intent',
  avatarController.createUploadIntent.bind(avatarController),
)

/**
 * @route POST /api/v1/users/me/avatar/finalize
 * @desc Finalize an uploaded avatar (validate, produce variants, promote)
 * @access Private
 */
router.post(
  '/finalize',
  avatarController.finalize.bind(avatarController),
)

/**
 * @route GET /api/v1/users/me/avatar
 * @desc Get the current avatar with variant URLs
 * @access Private
 */
router.get(
  '/',
  avatarController.getCurrentAvatar.bind(avatarController),
)

/**
 * @route DELETE /api/v1/users/me/avatar
 * @desc Delete the current avatar and all variants
 * @access Private
 */
router.delete(
  '/',
  avatarController.deleteAvatar.bind(avatarController),
)

export default router
