import { Router } from 'express'
import { authenticate } from '../../middleware/auth.middleware'
import { CredentialController } from '../../controllers/credential.controller'
import { validate, commonSchemas } from '../../middleware/validation.middleware'
import { z } from 'zod'

const router: Router = Router()
const credentialController = new CredentialController()

// Validation schemas
const credentialQuerySchema = z.object({
  moduleId: commonSchemas.id.optional(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
  page: z.string().regex(/^\d+$/).transform(Number).optional(),
  limit: z.string().regex(/^\d+$/).transform(Number).optional(),
})

const credentialIdSchema = z.object({
  id: commonSchemas.id,
})

const onChainIdSchema = z.object({
  onChainId: z.string().min(1, 'On-chain ID is required'),
})

// GET /credentials - Get all credentials for authenticated user
// Requires authentication
// Query params: moduleId, fromDate, toDate, page, limit
router.get(
  '/',
  authenticate,
  validate({ query: credentialQuerySchema }),
  credentialController.getUserCredentials,
)

// GET /credentials/verify/:onChainId - Public verification endpoint
// No authentication required
router.get(
  '/verify/:onChainId',
  validate({ params: onChainIdSchema }),
  credentialController.verifyCredential,
)

// GET /credentials/:id - Get single credential by ID
// Requires authentication - user must own the credential
router.get(
  '/:id',
  authenticate,
  validate({ params: credentialIdSchema }),
  credentialController.getCredentialById,
)

export default router
