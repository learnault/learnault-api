import { Router } from 'express'
import { contactCandidate, getCandidateProfile, searchTalent } from '../../controllers/employer.controller'
import { authenticate, authorize, requireVerifiedEmail } from '../../middleware/auth.middleware'
import { employerLimiter } from '../../middleware/rate-limit.middleware'

const router: Router = Router()

// requireVerifiedEmail: employer actions touch candidate PII, so the
// employer's own email must be confirmed — see docs/AUTH_POLICY.md.
router.use(authenticate, authorize('employer'), requireVerifiedEmail, employerLimiter)

// GET /employer/search - search talent with filters
router.get('/search', searchTalent)

// GET /employer/candidates/:id - candidate profile with verified credentials
router.get('/candidates/:id', getCandidateProfile)

// POST /employer/contact - record outreach attempt
router.post('/contact', contactCandidate)

export default router
