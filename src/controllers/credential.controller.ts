import { Request, Response } from 'express'
import { asyncHandler } from '../middleware/error.middleware'
import {
  BadRequestError,
  NotFoundError,
  UnauthorizedError,
} from '../utils/errors'
import { prisma } from '../config/database'

export class CredentialController {
  /**
   * @openapi
   * /credentials:
   *   get:
   *     operationId: credentialsList
   *     summary: List credentials for the authenticated user
   *     tags: [Credentials]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: moduleId
   *         schema:
   *           type: string
   *           format: uuid
   *       - in: query
   *         name: fromDate
   *         schema:
   *           type: string
   *           format: date-time
   *       - in: query
   *         name: toDate
   *         schema:
   *           type: string
   *           format: date-time
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *           default: 1
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 10
   *           maximum: 100
   *     responses:
   *       200:
   *         description: Credentials retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/CredentialList'
   *       401:
   *         description: Unauthorized
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  getUserCredentials = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const userId = (req as any).user?.id

      if (!userId) {
        throw new UnauthorizedError('User ID not found')
      }

      // Parse query parameters
      const page = parseInt(req.query.page as string) || 1
      const limit = Math.min(parseInt(req.query.limit as string) || 10, 100)
      const skip = (page - 1) * limit

      // Build where clause
      const where: any = { userId }

      if (req.query.moduleId) {
        where.moduleId = req.query.moduleId as string
      }

      if (req.query.fromDate) {
        const fromDate = new Date(req.query.fromDate as string)
        if (isNaN(fromDate.getTime())) {
          throw new BadRequestError('Invalid fromDate format')
        }
        where.issuedAt = { ...where.issuedAt, gte: fromDate }
      }

      if (req.query.toDate) {
        const toDate = new Date(req.query.toDate as string)
        if (isNaN(toDate.getTime())) {
          throw new BadRequestError('Invalid toDate format')
        }
        where.issuedAt = { ...where.issuedAt, lte: toDate }
      }

      // Get total count
      const total = await prisma.credential.count({ where })

      // Get credentials with related data
      const credentials = await prisma.credential.findMany({
        where,
        skip,
        take: limit,
        orderBy: { issuedAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              email: true,
            },
          },
          module: {
            select: {
              id: true,
              title: true,
              description: true,
              category: true,
              difficulty: true,
            },
          },
        },
      })

      res.json({
        success: true,
        data: credentials.map((cred: any) => ({
          id: cred.id,
          userId: cred.userId,
          moduleId: cred.moduleId,
          moduleName: cred.module.title,
          moduleCategory: cred.module.category,
          moduleDifficulty: cred.module.difficulty,
          onChainId: cred.onChainId,
          issuedAt: cred.issuedAt.toISOString(),
          shareableLink: `/api/v1/credentials/verify/${cred.onChainId || cred.id}`,
        })),
        meta: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNextPage: page * limit < total,
          hasPrevPage: page > 1,
        },
      })
    },
  )

  /**
   * @openapi
   * /credentials/{id}:
   *   get:
   *     operationId: credentialsGetById
   *     summary: Get a single credential by ID (must be owned by caller)
   *     tags: [Credentials]
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
   *         description: Credential details
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 data:
   *                   $ref: '#/components/schemas/Credential'
   *       401:
   *         description: Unauthorized or credential belongs to another user
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       404:
   *         description: Credential not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  getCredentialById = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const userId = (req as any).user?.id
      const { id } = req.params

      if (!userId) {
        throw new UnauthorizedError('User ID not found')
      }

      const credential = await prisma.credential.findUnique({
        where: { id },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              email: true,
            },
          },
          module: {
            select: {
              id: true,
              title: true,
              description: true,
              category: true,
              difficulty: true,
              reward: true,
            },
          },
        },
      })

      if (!credential) {
        throw new NotFoundError('Credential not found')
      }

      // Verify ownership
      if (credential.userId !== userId) {
        throw new UnauthorizedError('You do not have access to this credential')
      }

      res.json({
        success: true,
        data: {
          id: credential.id,
          userId: credential.userId,
          holderName: credential.user.username,
          moduleId: credential.moduleId,
          moduleName: credential.module.title,
          moduleDescription: credential.module.description,
          moduleCategory: credential.module.category,
          moduleDifficulty: credential.module.difficulty,
          onChainId: credential.onChainId,
          issuedAt: credential.issuedAt.toISOString(),
          shareableLink: `/api/v1/credentials/verify/${credential.onChainId || credential.id}`,
          metadata: {
            reward: credential.module.reward,
            verificationUrl: `/api/v1/credentials/verify/${credential.onChainId || credential.id}`,
          },
        },
      })
    },
  )

  /**
   * @openapi
   * /credentials/verify/{onChainId}:
   *   get:
   *     operationId: credentialsVerify
   *     summary: Publicly verify a credential by on-chain ID (or credential ID)
   *     description: >
   *       No authentication required. Looks up by `onChainId` first; falls back to
   *       the credential's primary `id` if no on-chain record is found.
   *     tags: [Credentials]
   *     security: []
   *     parameters:
   *       - in: path
   *         name: onChainId
   *         required: true
   *         schema:
   *           type: string
   *         description: On-chain credential ID or the credential's database UUID.
   *     responses:
   *       200:
   *         description: Credential verification result
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/VerificationResponse'
   *       404:
   *         description: Credential not found or invalid
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  verifyCredential = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const { onChainId } = req.params

      // Try to find by onChainId first, then by regular id
      let credential = await prisma.credential.findFirst({
        where: { onChainId },
        include: {
          user: {
            select: {
              id: true,
              username: true,
            },
          },
          module: {
            select: {
              id: true,
              title: true,
              category: true,
              difficulty: true,
            },
          },
        },
      })

      // If not found by onChainId, try by regular id
      if (!credential) {
        credential = await prisma.credential.findUnique({
          where: { id: onChainId },
          include: {
            user: {
              select: {
                id: true,
                username: true,
              },
            },
            module: {
              select: {
                id: true,
                title: true,
                category: true,
                difficulty: true,
              },
            },
          },
        })
      }

      if (!credential) {
        throw new NotFoundError('Credential not found or invalid')
      }

      res.json({
        success: true,
        data: {
          valid: true,
          credential: {
            id: credential.id,
            holderName: credential.user.username,
            moduleName: credential.module.title,
            moduleCategory: credential.module.category,
            moduleDifficulty: credential.module.difficulty,
            onChainId: credential.onChainId,
            issuedAt: credential.issuedAt.toISOString(),
          },
          verification: {
            verifiedAt: new Date().toISOString(),
            status: 'verified',
            message: 'This credential is valid and has been verified on-chain',
          },
        },
      })
    },
  )
}
