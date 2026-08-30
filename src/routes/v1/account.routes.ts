import { Router } from 'express'
import { AccountController } from '../../controllers/account.controller'
import {
  authenticate,
  requireActiveAccount,
} from '../../middleware/auth.middleware'
import { authLimiter } from '../../middleware/rate-limit.middleware'

const router: Router = Router()
const accountController = new AccountController()

/**
 * @route POST /api/v1/account/export
 * @desc Request an asynchronous data export
 * @access Private (active accounts only)
 */
router.post(
  '/export',
  authenticate,
  requireActiveAccount,
  accountController.requestExport.bind(accountController),
)

/**
 * @route GET /api/v1/account/export/:id
 * @desc Get export request status (allowed while deactivated/pending deletion)
 * @access Private
 */
router.get(
  '/export/:id',
  authenticate,
  accountController.getExportStatus.bind(accountController),
)

/**
 * @route GET /api/v1/account/export/:id/download
 * @desc Download a ready export artifact (allowed while deactivated/pending deletion)
 * @access Private
 */
router.get(
  '/export/:id/download',
  authenticate,
  accountController.downloadExport.bind(accountController),
)

/**
 * @route POST /api/v1/account/deactivate
 * @desc Deactivate account (step-up: password re-entry)
 * @access Private
 */
router.post(
  '/deactivate',
  authenticate,
  accountController.deactivate.bind(accountController),
)

/**
 * @route POST /api/v1/account/reactivate
 * @desc Reactivate a deactivated account (deactivated accounts cannot log in)
 * @access Public (credentialed)
 */
router.post(
  '/reactivate',
  authLimiter,
  accountController.reactivate.bind(accountController),
)

/**
 * @route POST /api/v1/account/deletion
 * @desc Request account deletion with cooling-off window (step-up: password re-entry)
 * @access Private (active accounts only)
 */
router.post(
  '/deletion',
  authenticate,
  requireActiveAccount,
  accountController.requestDeletion.bind(accountController),
)

/**
 * @route GET /api/v1/account/deletion
 * @desc Get latest deletion request status (allowed while pending deletion)
 * @access Private
 */
router.get(
  '/deletion',
  authenticate,
  accountController.getDeletionStatus.bind(accountController),
)

/**
 * @route POST /api/v1/account/deletion/cancel
 * @desc Cancel a pending deletion request (accounts pending deletion cannot log in)
 * @access Public (credentialed)
 */
router.post(
  '/deletion/cancel',
  authLimiter,
  accountController.cancelDeletion.bind(accountController),
)

export default router
