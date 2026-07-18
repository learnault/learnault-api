import express, { Router } from 'express'
import { authenticate } from '../../middleware/auth.middleware'
import { validate } from '../../middleware/validation.middleware'
import {
  createUploadIntentSchema,
  finalizeUploadSchema,
  updateProfileSchema,
} from '../../schemas/profile.schema'
import { ProfileController } from '../../controllers/profile.controller'
import { ImageProcessor } from '../../services/image-processor.service'
import { createAVScanner } from '../../services/av-scanner.service'
import { createAvatarUploadService } from '../../services/avatar-upload.service'
import { createStorageProvider } from '../../services/storage.provider'

const router: express.Router = Router()

const avatarUploadService = createAvatarUploadService(
  createStorageProvider(),
  new ImageProcessor(),
  createAVScanner(),
)
const profileController = new ProfileController(avatarUploadService)

router.get('/me', authenticate, profileController.getProfile)
router.patch('/me', authenticate, validate({ body: updateProfileSchema }), profileController.updateProfile)

router.post(
  '/avatar/intent',
  authenticate,
  validate({ body: createUploadIntentSchema }),
  profileController.createUploadIntent,
)
router.post(
  '/avatar/finalize',
  authenticate,
  validate({ body: finalizeUploadSchema }),
  profileController.finalizeUpload,
)
router.get('/avatar', authenticate, profileController.getAvatar)
router.delete('/avatar', authenticate, profileController.deleteAvatar)

export default router
