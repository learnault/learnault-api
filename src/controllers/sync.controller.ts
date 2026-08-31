import { Request, Response } from 'express'
import prisma from '../config/database'
import { asyncHandler } from '../middleware/error.middleware'
import { BadRequestError, UnauthorizedError } from '../utils/errors'

interface ProgressEvent {
  idempotencyKey: string
  deviceId: string
  moduleId: string
  progressPercent: number
  clientTimestamp: string
  syncVersion: number
}

interface CompletionEvent {
  idempotencyKey: string
  deviceId: string
  moduleId: string
  score: number
  clientTimestamp: string
  syncVersion: number
}

type SyncStatus = 'applied' | 'skipped' | 'rejected'

interface SyncResult {
  idempotencyKey: string
  status: SyncStatus
  reason?: string
}

export class SyncController {
  /**
   * @openapi
   * /sync/progress:
   *   post:
   *     operationId: syncProgress
   *     summary: Upload batched offline progress events
   *     description: >
   *       Each event is deduplicated by `idempotencyKey`. Events with a stale
   *       `syncVersion` (lower than the latest already applied for that module)
   *       are silently skipped.
   *     tags: [Sync]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [events]
   *             properties:
   *               events:
   *                 type: array
   *                 items:
   *                   $ref: '#/components/schemas/SyncProgressEvent'
   *     responses:
   *       200:
   *         description: Per-event sync results
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/SyncResponse'
   *       400:
   *         description: Invalid payload (e.g. empty events array)
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       401:
   *         description: Unauthorized
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  syncProgress = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const userId = (req as any).user?.id
      if (!userId) throw new UnauthorizedError('User ID not found')

      const { events } = req.body
      if (!Array.isArray(events) || events.length === 0) {
        throw new BadRequestError('events must be a non-empty array')
      }

      const results: SyncResult[] = []

      for (const event of events as ProgressEvent[]) {
        const {
          idempotencyKey,
          deviceId,
          moduleId,
          progressPercent,
          clientTimestamp,
          syncVersion,
        } = event

        if (
          !idempotencyKey ||
          !deviceId ||
          !moduleId ||
          progressPercent === undefined ||
          !clientTimestamp ||
          syncVersion === undefined
        ) {
          results.push({
            idempotencyKey: idempotencyKey ?? 'unknown',
            status: 'rejected',
            reason: 'Missing required fields',
          })
          continue
        }

        if (
          typeof progressPercent !== 'number' ||
          progressPercent < 0 ||
          progressPercent > 100
        ) {
          results.push({
            idempotencyKey,
            status: 'rejected',
            reason: 'progressPercent must be between 0 and 100',
          })
          continue
        }

        const clientTs = new Date(clientTimestamp)
        if (isNaN(clientTs.getTime())) {
          results.push({
            idempotencyKey,
            status: 'rejected',
            reason: 'Invalid clientTimestamp format',
          })
          continue
        }

        const existing = await prisma.syncEvent.findUnique({
          where: { idempotencyKey },
        })
        if (existing) {
          results.push({ idempotencyKey, status: 'skipped' })
          continue
        }

        const latestForModule = await prisma.syncEvent.findFirst({
          where: {
            userId,
            payload: { contains: moduleId },
            eventType: 'progress',
          },
          orderBy: { syncVersion: 'desc' },
        })

        if (latestForModule && latestForModule.syncVersion > syncVersion) {
          results.push({
            idempotencyKey,
            status: 'skipped',
            reason: 'Stale sync version — a newer version already applied',
          })
          continue
        }

        await prisma.syncEvent.create({
          data: {
            idempotencyKey,
            userId,
            deviceId,
            eventType: 'progress',
            payload: JSON.stringify({ moduleId, progressPercent }),
            clientTimestamp: clientTs,
            syncVersion,
            status: 'applied',
          },
        })

        results.push({ idempotencyKey, status: 'applied' })
      }

      res.status(200).json({ success: true, data: { results } })
    },
  )

  /**
   * @openapi
   * /sync/completions:
   *   post:
   *     operationId: syncCompletions
   *     summary: Reconcile offline quiz/completion attempts
   *     description: >
   *       Each event is deduplicated by `idempotencyKey`. If the user already has a
   *       completion with an equal or higher score, the event is skipped. A higher
   *       score updates the existing record.
   *     tags: [Sync]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [events]
   *             properties:
   *               events:
   *                 type: array
   *                 items:
   *                   $ref: '#/components/schemas/SyncCompletionEvent'
   *     responses:
   *       200:
   *         description: Per-event sync results
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/SyncResponse'
   *       400:
   *         description: Invalid payload (e.g. empty events array)
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       401:
   *         description: Unauthorized
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  syncCompletions = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const userId = (req as any).user?.id
      if (!userId) throw new UnauthorizedError('User ID not found')

      const { events } = req.body
      if (!Array.isArray(events) || events.length === 0) {
        throw new BadRequestError('events must be a non-empty array')
      }

      const results: SyncResult[] = []

      for (const event of events as CompletionEvent[]) {
        const {
          idempotencyKey,
          deviceId,
          moduleId,
          score,
          clientTimestamp,
          syncVersion,
        } = event

        if (
          !idempotencyKey ||
          !deviceId ||
          !moduleId ||
          score === undefined ||
          !clientTimestamp ||
          syncVersion === undefined
        ) {
          results.push({
            idempotencyKey: idempotencyKey ?? 'unknown',
            status: 'rejected',
            reason: 'Missing required fields',
          })
          continue
        }

        if (typeof score !== 'number' || score < 0 || score > 100) {
          results.push({
            idempotencyKey,
            status: 'rejected',
            reason: 'score must be between 0 and 100',
          })
          continue
        }

        const clientTs = new Date(clientTimestamp)
        if (isNaN(clientTs.getTime())) {
          results.push({
            idempotencyKey,
            status: 'rejected',
            reason: 'Invalid clientTimestamp format',
          })
          continue
        }

        const existing = await prisma.syncEvent.findUnique({
          where: { idempotencyKey },
        })
        if (existing) {
          results.push({ idempotencyKey, status: 'skipped' })
          continue
        }

        const module = await prisma.module.findUnique({
          where: { id: moduleId },
        })
        if (!module) {
          results.push({
            idempotencyKey,
            status: 'rejected',
            reason: 'Module not found',
          })
          continue
        }

        const alreadyCompleted = await prisma.completion.findUnique({
          where: { userId_moduleId: { userId, moduleId } },
        })

        if (alreadyCompleted) {
          if (score <= alreadyCompleted.score) {
            await prisma.syncEvent.create({
              data: {
                idempotencyKey,
                userId,
                deviceId,
                eventType: 'completion',
                payload: JSON.stringify({ moduleId, score }),
                clientTimestamp: clientTs,
                syncVersion,
                status: 'skipped',
                rejectionReason:
                  'Existing completion has equal or higher score',
              },
            })
            results.push({
              idempotencyKey,
              status: 'skipped',
              reason: 'Existing completion has equal or higher score',
            })
            continue
          }

          await prisma.completion.update({
            where: { userId_moduleId: { userId, moduleId } },
            data: { score },
          })
        } else {
          await prisma.completion.create({
            data: { userId, moduleId, score },
          })
        }

        await prisma.syncEvent.create({
          data: {
            idempotencyKey,
            userId,
            deviceId,
            eventType: 'completion',
            payload: JSON.stringify({ moduleId, score }),
            clientTimestamp: clientTs,
            syncVersion,
            status: 'applied',
          },
        })

        results.push({ idempotencyKey, status: 'applied' })
      }

      res.status(200).json({ success: true, data: { results } })
    },
  )
}
