import { Request, Response } from 'express'
import prisma from '../config/database'
import { issueAccessToken } from '../config/jwt'
import logger from '../utils/logger'
import {
    deactivateSchema,
    reactivateSchema,
    requestDeletionSchema,
    cancelDeletionSchema,
    exportIdParamSchema,
} from '../schemas/account.schema'
import { dataExportService } from '../services/data-export.service'
import { accountLifecycleService } from '../services/account-lifecycle.service'
import { auditService } from '../services/audit.service'
import { emailService } from '../services/email.service'
import { comparePassword } from '../utils/password'
import { AccountStatus, AuditAction, ExportStatus, RequestContext } from '../types/account.types'

function buildDeletionRequestedEmail(username: string, scheduledFor: Date): { subject: string; body: string } {
    const subject = 'Your account deletion request'
    const body = `\
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:sans-serif;padding:24px">
  <h2>Account deletion requested</h2>
  <p>Hi ${username},</p>
  <p>We received a request to permanently delete your Learnault account.</p>
  <p>Your account is now deactivated and will be permanently deleted on
     <strong>${scheduledFor.toUTCString()}</strong>.</p>
  <p>If you change your mind before then, you can cancel the deletion by signing in
     through the "cancel deletion" option with your email and password.</p>
  <p>If you did not request this, cancel the deletion and change your password immediately.</p>
</body>
</html>`

    return { subject, body }
}

function buildDeletionCancelledEmail(username: string): { subject: string; body: string } {
    const subject = 'Your account deletion was cancelled'
    const body = `\
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:sans-serif;padding:24px">
  <h2>Deletion cancelled</h2>
  <p>Hi ${username},</p>
  <p>Your account deletion request has been cancelled and your account is active again.</p>
  <p>If you did not do this, please change your password immediately.</p>
</body>
</html>`

    return { subject, body }
}

export class AccountController {
    /**
     * @openapi
     * /v1/account/export:
     *   post:
     *     summary: Request a data export
     *     description: Starts asynchronous generation of a user-scoped data export. Only one active export request is allowed at a time.
     *     tags: [Account]
     *     security:
     *       - bearerAuth: []
     *     responses:
     *       202:
     *         description: Export request accepted
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/DataExportRequest'
     *       401:
     *         description: Authentication required
     *       403:
     *         description: Account is not active
     *       409:
     *         description: An active export request already exists
     */
    async requestExport(req: Request, res: Response): Promise<void> {
        try {
            const userId = req.user!.id

            this.sweepInBackground()

            const result = await dataExportService.requestExport(userId)

            if (result.kind === 'duplicate') {
                res.status(409).json({
                    error: 'An export request is already in progress',
                    existingRequestId: result.request.id,
                })

                return
            }

            res.status(202).json({
                id: result.request.id,
                status: result.request.status,
                createdAt: result.request.createdAt,
            })
        } catch (error) {
            logger.error('Export request error:', error)
            res.status(500).json({ error: 'Internal server error during export request' })
        }
    }

    /**
     * @openapi
     * /v1/account/export/{id}:
     *   get:
     *     summary: Get export request status
     *     description: Returns the status of an export request owned by the authenticated user. Requests owned by other users behave as not found.
     *     tags: [Account]
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *           format: uuid
     *     responses:
     *       200:
     *         description: Export request status
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/DataExportRequest'
     *       400:
     *         description: Invalid export id
     *       401:
     *         description: Authentication required
     *       404:
     *         description: Export request not found
     */
    async getExportStatus(req: Request, res: Response): Promise<void> {
        try {
            const params = exportIdParamSchema.safeParse(req.params)
            if (!params.success) {
                res.status(400).json({ error: 'Validation failed', details: params.error.format() })

                return
            }

            const request = await dataExportService.getExportStatus(req.user!.id, params.data.id)

            if (!request) {
                res.status(404).json({ error: 'Export request not found' })

                return
            }

            res.status(200).json({
                id: request.id,
                status: request.status,
                createdAt: request.createdAt,
                completedAt: request.completedAt,
                expiresAt: request.expiresAt,
                downloadedAt: request.downloadedAt,
            })
        } catch (error) {
            logger.error('Export status error:', error)
            res.status(500).json({ error: 'Internal server error during export status lookup' })
        }
    }

    /**
     * @openapi
     * /v1/account/export/{id}/download:
     *   get:
     *     summary: Download a ready data export
     *     description: Streams the export artifact as a JSON attachment. Exports expire and are purged after their retention window.
     *     tags: [Account]
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *           format: uuid
     *     responses:
     *       200:
     *         description: Export artifact (JSON attachment)
     *       400:
     *         description: Invalid export id
     *       401:
     *         description: Authentication required
     *       404:
     *         description: Export request not found
     *       409:
     *         description: Export is not ready yet
     *       410:
     *         description: Export expired, was purged, or failed
     */
    async downloadExport(req: Request, res: Response): Promise<void> {
        try {
            const params = exportIdParamSchema.safeParse(req.params)
            if (!params.success) {
                res.status(400).json({ error: 'Validation failed', details: params.error.format() })

                return
            }

            const userId = req.user!.id
            const request = await dataExportService.getExportStatus(userId, params.data.id)

            if (!request) {
                res.status(404).json({ error: 'Export request not found' })

                return
            }

            if (request.status === ExportStatus.PENDING || request.status === ExportStatus.PROCESSING) {
                res.status(409).json({ error: 'Export is not ready yet', status: request.status })

                return
            }

            const isExpired =
                request.status === ExportStatus.EXPIRED ||
                (request.expiresAt !== null && request.expiresAt <= new Date())

            if (request.status === ExportStatus.FAILED || isExpired || !request.artifact) {
                res.status(410).json({ error: 'Export is no longer available' })

                return
            }

            await dataExportService.markDownloaded(userId, request.id)

            res.setHeader('Content-Type', 'application/json')
            res.setHeader(
                'Content-Disposition',
                `attachment; filename="learnault-export-${request.id}.json"`
            )
            res.status(200).send(request.artifact)
        } catch (error) {
            logger.error('Export download error:', error)
            res.status(500).json({ error: 'Internal server error during export download' })
        }
    }

    /**
     * @openapi
     * /v1/account/deactivate:
     *   post:
     *     summary: Deactivate account
     *     description: Reversibly deactivates the account. Requires password re-entry (step-up). Revokes sessions and blocks login until reactivation.
     *     tags: [Account]
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/DeactivateInput'
     *     responses:
     *       200:
     *         description: Account deactivated
     *       400:
     *         description: Validation failed
     *       401:
     *         description: Authentication required or wrong password
     *       409:
     *         description: Account is already deactivated or pending deletion
     */
    async deactivate(req: Request, res: Response): Promise<void> {
        try {
            const validation = deactivateSchema.safeParse(req.body)
            if (!validation.success) {
                res.status(400).json({ error: 'Validation failed', details: validation.error.format() })

                return
            }

            const user = await this.stepUp(req, res, validation.data.password, 'deactivate')
            if (!user) {
                return
            }

            const result = await accountLifecycleService.deactivate(user.id, user.status, this.context(req))

            if (result.kind === 'conflict') {
                res.status(409).json({
                    error: result.status === AccountStatus.PENDING_DELETION
                        ? 'Account is pending deletion'
                        : 'Account is already deactivated',
                    code: result.status,
                })

                return
            }

            res.status(200).json({ message: 'Account deactivated successfully', status: AccountStatus.DEACTIVATED })
        } catch (error) {
            logger.error('Deactivation error:', error)
            res.status(500).json({ error: 'Internal server error during deactivation' })
        }
    }

    /**
     * @openapi
     * /v1/account/reactivate:
     *   post:
     *     summary: Reactivate a deactivated account
     *     description: Public endpoint (deactivated accounts cannot log in). Verifies credentials and reactivates the account, returning a fresh token.
     *     tags: [Account]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/ReactivateInput'
     *     responses:
     *       200:
     *         description: Account reactivated
     *       400:
     *         description: Validation failed
     *       401:
     *         description: Invalid credentials
     *       409:
     *         description: Account is pending deletion — cancel the deletion request instead
     */
    async reactivate(req: Request, res: Response): Promise<void> {
        try {
            const validation = reactivateSchema.safeParse(req.body)
            if (!validation.success) {
                res.status(400).json({ error: 'Validation failed', details: validation.error.format() })

                return
            }

            const user = await this.verifyCredentials(validation.data.email, validation.data.password)
            if (!user) {
                res.status(401).json({ error: 'Invalid credentials' })

                return
            }

            if (user.status === AccountStatus.PENDING_DELETION) {
                res.status(409).json({
                    error: 'Account is scheduled for deletion. Cancel the deletion request to restore access.',
                    code: 'ACCOUNT_PENDING_DELETION',
                })

                return
            }

            if (user.status === AccountStatus.DEACTIVATED) {
                await accountLifecycleService.reactivate(user.id, this.context(req))
            }

            const token = this.generateToken(user.id, user.role)

            res.status(200).json({
                message: 'Account reactivated successfully',
                token,
                user: {
                    id: user.id,
                    email: user.email,
                    username: user.username,
                    role: user.role,
                },
            })
        } catch (error) {
            logger.error('Reactivation error:', error)
            res.status(500).json({ error: 'Internal server error during reactivation' })
        }
    }

    /**
     * @openapi
     * /v1/account/deletion:
     *   post:
     *     summary: Request account deletion
     *     description: Starts the deletion process with a cooling-off window. Requires password re-entry (step-up). The account behaves as deactivated until finalization or cancellation.
     *     tags: [Account]
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/RequestDeletionInput'
     *     responses:
     *       202:
     *         description: Deletion request accepted
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/AccountDeletionRequest'
     *       400:
     *         description: Validation failed
     *       401:
     *         description: Authentication required or wrong password
     *       403:
     *         description: Account is not active
     *       409:
     *         description: An active deletion request already exists
     */
    async requestDeletion(req: Request, res: Response): Promise<void> {
        try {
            const validation = requestDeletionSchema.safeParse(req.body)
            if (!validation.success) {
                res.status(400).json({ error: 'Validation failed', details: validation.error.format() })

                return
            }

            const user = await this.stepUp(req, res, validation.data.password, 'deletion')
            if (!user) {
                return
            }

            const result = await accountLifecycleService.requestDeletion(
                user.id,
                validation.data.reason,
                this.context(req)
            )

            if (result.kind === 'duplicate') {
                res.status(409).json({
                    error: 'A deletion request is already pending',
                    existingRequestId: result.request.id,
                    scheduledFor: result.request.scheduledFor,
                })

                return
            }

            const email = buildDeletionRequestedEmail(user.username, result.request.scheduledFor)
            await emailService.queueEmail(user.id, user.email, email.subject, email.body, 'ACCOUNT_DELETION')

            res.status(202).json({
                id: result.request.id,
                status: result.request.status,
                scheduledFor: result.request.scheduledFor,
            })
        } catch (error) {
            logger.error('Deletion request error:', error)
            res.status(500).json({ error: 'Internal server error during deletion request' })
        }
    }

    /**
     * @openapi
     * /v1/account/deletion:
     *   get:
     *     summary: Get deletion request status
     *     description: Returns the latest deletion request for the authenticated user, or a null status when none exists.
     *     tags: [Account]
     *     security:
     *       - bearerAuth: []
     *     responses:
     *       200:
     *         description: Latest deletion request, or null status
     *       401:
     *         description: Authentication required
     */
    async getDeletionStatus(req: Request, res: Response): Promise<void> {
        try {
            this.sweepInBackground()

            const request = await accountLifecycleService.getLatestDeletionRequest(req.user!.id)

            if (!request) {
                res.status(200).json({ status: null })

                return
            }

            res.status(200).json({
                id: request.id,
                status: request.status,
                scheduledFor: request.scheduledFor,
                cancelledAt: request.cancelledAt,
                completedAt: request.completedAt,
                createdAt: request.createdAt,
            })
        } catch (error) {
            logger.error('Deletion status error:', error)
            res.status(500).json({ error: 'Internal server error during deletion status lookup' })
        }
    }

    /**
     * @openapi
     * /v1/account/deletion/cancel:
     *   post:
     *     summary: Cancel a pending deletion request
     *     description: Public endpoint (accounts pending deletion cannot log in). Verifies credentials and cancels the pending deletion, restoring the account.
     *     tags: [Account]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/CancelDeletionInput'
     *     responses:
     *       200:
     *         description: Deletion cancelled, account restored
     *       400:
     *         description: Validation failed
     *       401:
     *         description: Invalid credentials
     *       404:
     *         description: No pending deletion request
     *       410:
     *         description: Deletion has already been finalized
     */
    async cancelDeletion(req: Request, res: Response): Promise<void> {
        try {
            const validation = cancelDeletionSchema.safeParse(req.body)
            if (!validation.success) {
                res.status(400).json({ error: 'Validation failed', details: validation.error.format() })

                return
            }

            const user = await this.verifyCredentials(validation.data.email, validation.data.password)
            if (!user) {
                res.status(401).json({ error: 'Invalid credentials' })

                return
            }

            const result = await accountLifecycleService.cancelDeletion(user.id, this.context(req))

            if (result.kind === 'none') {
                res.status(404).json({ error: 'No pending deletion request found' })

                return
            }

            if (result.kind === 'finalized') {
                res.status(410).json({ error: 'Deletion has already been finalized and cannot be cancelled' })

                return
            }

            const email = buildDeletionCancelledEmail(user.username)
            await emailService.queueEmail(user.id, user.email, email.subject, email.body, 'ACCOUNT_DELETION')

            res.status(200).json({ message: 'Deletion request cancelled. Your account is active again.' })
        } catch (error) {
            logger.error('Deletion cancellation error:', error)
            res.status(500).json({ error: 'Internal server error during deletion cancellation' })
        }
    }

    /**
     * Step-up authentication: even with a valid JWT, sensitive actions require
     * fresh password re-entry. Responds 401 and returns null on failure.
     */
    private async stepUp(
        req: Request,
        res: Response,
        password: string,
        action: string
    ): Promise<{ id: string; email: string; username: string; role: string; status: string } | null> {
        const userId = req.user!.id
        const user = await prisma.user.findUnique({ where: { id: userId } })

        if (!user || user.status === AccountStatus.DELETED) {
            res.status(401).json({ error: 'Account not found' })

            return null
        }

        const isMatch = await comparePassword(password, user.password)
        if (!isMatch) {
            await auditService.record({
                userId,
                action: AuditAction.STEP_UP_FAILED,
                metadata: { attemptedAction: action },
                ...this.context(req),
            })
            res.status(401).json({ error: 'Invalid password', code: 'STEP_UP_FAILED' })

            return null
        }

        return user
    }

    /**
     * Credential verification for public lifecycle endpoints. Neutral null on
     * unknown email, wrong password, or tombstoned account (no state leaks).
     */
    private async verifyCredentials(
        email: string,
        password: string
    ): Promise<{ id: string; email: string; username: string; role: string; status: string } | null> {
        const user = await prisma.user.findUnique({ where: { email } })

        if (!user || user.status === AccountStatus.DELETED) {
            return null
        }

        const isMatch = await comparePassword(password, user.password)
        if (!isMatch) {
            return null
        }

        return user
    }

    private context(req: Request): RequestContext {
        return {
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        }
    }

    private sweepInBackground(): void {
        accountLifecycleService.sweep().catch(err =>
            logger.error('Lifecycle sweep error:', err)
        )
    }

    private generateToken(userId: string, role: string): string {
        return issueAccessToken({ id: userId, role })
    }
}
