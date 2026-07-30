import { Router } from 'express'
import { OnboardingController } from '../../controllers/onboarding.controller'
import { authenticate } from '../../middleware/auth.middleware'

const router: Router = Router()
const onboardingController = new OnboardingController()

router.get('/', authenticate, onboardingController.getProgress.bind(onboardingController))

router.post('/steps', authenticate, onboardingController.saveStep.bind(onboardingController))

router.post('/complete', authenticate, onboardingController.complete.bind(onboardingController))

export default router
