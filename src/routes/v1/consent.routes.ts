import { Router } from 'express'
import { ConsentController } from '../../controllers/consent.controller'
import { authenticate } from '../../middleware/auth.middleware'

const router: Router = Router()
const consentController = new ConsentController()

router.get('/', authenticate, consentController.getCurrent.bind(consentController))

router.get('/history', authenticate, consentController.getHistory.bind(consentController))

router.post('/grant', authenticate, consentController.grant.bind(consentController))

router.post('/withdraw', authenticate, consentController.withdraw.bind(consentController))

export default router
