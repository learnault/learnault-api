import express, { Router } from 'express'
import { UserController } from '../../controllers/user.controller'
import { PreferenceController } from '../../controllers/preference.controller'
import { ProfileController } from '../../controllers/profile.controller'
import { authenticate, optionalAuthenticate } from '../../middleware/auth.middleware'
import avatarRoutes from './avatar.routes'

const router: express.Router = Router()
const userController = new UserController()
const preferenceController = new PreferenceController()
const profileController = new ProfileController()

// Bodies and path params are validated inside the controllers with the Zod
// schemas in src/schemas/profile.schema.ts, the same way every other Prisma-
// backed controller in this service does it. The legacy `validateProfileUpdate`
// middleware is deliberately not mounted here: it validated the mock-era
// firstName/lastName/bio/avatar body, none of which is a persisted column.

router.get('/me', authenticate, userController.getCurrentUser.bind(userController))

router.patch('/me', authenticate, userController.updateProfile.bind(userController))

router.get('/me/preferences', authenticate, preferenceController.getPreferences.bind(preferenceController))

router.patch('/me/preferences', authenticate, preferenceController.updatePreferences.bind(preferenceController))

router.get('/me/profile', authenticate, profileController.getMyProfile.bind(profileController))

router.patch('/me/profile', authenticate, profileController.updateMyProfile.bind(profileController))

router.patch('/password', authenticate, userController.changePassword.bind(userController))

router.patch('/wallet', authenticate, userController.updateWalletAddress.bind(userController))

router.use('/me/avatar', avatarRoutes)

router.get('/:id/profile', optionalAuthenticate, profileController.getProfileById.bind(profileController))

router.get('/:id', userController.getUserById.bind(userController))

export default router
