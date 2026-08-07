import express, { Router } from 'express'
import { UserController } from '../../controllers/user.controller'
import { PreferenceController } from '../../controllers/preference.controller'
import { ProfileController } from '../../controllers/profile.controller'
import { authenticate, optionalAuthenticate } from '../../middleware/auth.middleware'
import { validateProfileUpdate, validatePasswordChange, validateWalletAddress } from '../../middleware/validation.middleware'

const router: express.Router = Router()
const userController = new UserController()
const preferenceController = new PreferenceController()
const profileController = new ProfileController()

router.get('/me', authenticate, userController.getCurrentUser.bind(userController))

router.patch('/me', authenticate, validateProfileUpdate, userController.updateProfile.bind(userController))

router.get('/me/preferences', authenticate, preferenceController.getPreferences.bind(preferenceController))

router.patch('/me/preferences', authenticate, preferenceController.updatePreferences.bind(preferenceController))

router.get('/me/profile', authenticate, profileController.getMyProfile.bind(profileController))

router.patch('/me/profile', authenticate, profileController.updateMyProfile.bind(profileController))

router.get('/:id/profile', optionalAuthenticate, profileController.getProfileById.bind(profileController))

router.get('/:id', userController.getUserById.bind(userController))

router.patch('/password', authenticate, validatePasswordChange, userController.changePassword.bind(userController))

router.patch('/wallet', authenticate, validateWalletAddress, userController.updateWalletAddress.bind(userController))

export default router
