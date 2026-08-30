import { Router, Request, Response } from 'express'
import type { Router as ExpressRouter } from 'express'
import prisma from '../config/database'

const router: ExpressRouter = Router()

/**
 * @openapi
 * /health/live:
 *   get:
 *     operationId: livenessCheck
 *     summary: Liveness probe
 *     description: Returns HTTP 200 if the server process is running. Used by orchestrators to detect crashed processes.
 *     tags: [Health]
 *     security: []
 *     responses:
 *       200:
 *         description: Service is alive
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 */
router.get('/live', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  })
})

/**
 * @openapi
 * /health/ready:
 *   get:
 *     operationId: readinessCheck
 *     summary: Readiness probe
 *     description: Returns HTTP 200 when the service can handle traffic (dependencies healthy). Returns 503 if not ready.
 *     tags: [Health]
 *     security: []
 *     responses:
 *       200:
 *         description: Service is ready to handle requests
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ready
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 checks:
 *                   type: object
 *                   properties:
 *                     database:
 *                       type: string
 *                       example: ok
 *       503:
 *         description: Service is not ready (dependency failure)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: not ready
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 checks:
 *                   type: object
 *                   properties:
 *                     database:
 *                       type: string
 *                       example: error
 *                 errors:
 *                   type: array
 *                   items:
 *                     type: string
 */
router.get('/ready', async (req: Request, res: Response) => {
  const checks: Record<string, string> = {}
  const errors: string[] = []
  let isReady = true

  // Check database connectivity
  try {
    await prisma.$queryRaw`SELECT 1`
    checks.database = 'ok'
  } catch (error) {
    checks.database = 'error'
    errors.push(
      `Database connection failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    )
    isReady = false
  }

  // Add more dependency checks here as needed
  // Example: cache, external APIs, message queues, etc.

  const statusCode = isReady ? 200 : 503
  const status = isReady ? 'ready' : 'not ready'

  const response: any = {
    status,
    timestamp: new Date().toISOString(),
    checks,
  }

  if (!isReady) {
    response.errors = errors
  }

  res.status(statusCode).json(response)
})

export default router
