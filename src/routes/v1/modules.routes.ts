import { Router } from 'express'
import {
  authenticate,
  optionalAuthenticate,
} from '../../middleware/auth.middleware'
import {
  listModules,
  getModuleById,
  startModule,
  completeModule,
} from '../../controllers/module.controller'

const router: Router = Router()

// GET /modules - List modules with filters and pagination
// Optional authentication - includes user progress if authenticated
router.get('/', optionalAuthenticate, listModules)

// GET /modules/:id - Get module details
// Optional authentication - includes user progress if authenticated
router.get('/:id', optionalAuthenticate, getModuleById)

// POST /modules/:id/start - Start tracking progress
// Requires authentication
router.post('/:id/start', authenticate, startModule)

// POST /modules/:id/complete - Complete module with quiz answers
// Requires authentication
router.post('/:id/complete', authenticate, completeModule)

export default router
