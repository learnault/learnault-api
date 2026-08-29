import { Router } from 'express'
import authRoutes from './v1/auth.routes'
import employerRoutes from './v1/employer.routes'
import moduleRoutes from './v1/modules.routes'
import credentialRoutes from './v1/credentials.routes'
import rewardRoutes from './v1/rewards.routes'
import userRoutes from './v1/users.routes'
import notificationRoutes from './v1/notifications.routes'
import syncRoutes from './v1/sync.routes'
import referralRoutes from './v1/referrals.routes'
import accountRoutes from './v1/account.routes'
import onboardingRoutes from './v1/onboarding.routes'
import consentRoutes from './v1/consent.routes'
import sessionRoutes from './v1/sessions.routes'

const router: Router = Router()

router.get('/', (_req, res) => {
  res.json({ message: 'API is running' })
})

router.use('/v1/auth', authRoutes)
router.use('/v1/users', userRoutes)
router.use('/v1/modules', moduleRoutes)
router.use('/v1/credentials', credentialRoutes)
router.use('/v1/rewards', rewardRoutes)
router.use('/v1/employer', employerRoutes)
router.use('/v1/notifications', notificationRoutes)
router.use('/v1/sync', syncRoutes)
router.use('/v1/referrals', referralRoutes)
router.use('/v1/account', accountRoutes)
router.use('/v1/onboarding', onboardingRoutes)
router.use('/v1/consents', consentRoutes)
router.use('/v1/sessions', sessionRoutes)

export default router
