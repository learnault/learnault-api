import dotenv from 'dotenv'
dotenv.config()

import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'

import swaggerUi from 'swagger-ui-express'
import { specs } from './config/swagger'
import routes from './routes'
import healthRoutes from './routes/health.routes'
import { errorHandler, notFoundHandler } from './middleware/error.middleware'
import { requestContext } from './middleware/request-context'
import { apiVersionHeader } from './middleware/versioning.middleware'

const app: express.Application = express()

app.use(express.json())
app.use(cors())
app.use(
  helmet({
    contentSecurityPolicy: false, // Disable CSP for Swagger UI to work correctly
  })
)

// Request context middleware - must be early to track all requests
app.use(requestContext)

// Version header middleware
app.use(apiVersionHeader)

app.use(morgan('dev'))

// API routes
app.use('/api', routes)

// Swagger documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs))

// Health check routes (liveness and readiness)
app.use('/health', healthRoutes)

// Legacy health check endpoint (deprecated, use /health/live instead)
/**
 * @openapi
 * /health:
 *   get:
 *     operationId: healthCheck
 *     summary: Service health check (deprecated)
 *     description: Returns HTTP 200 when the server is running. Use /health/live or /health/ready instead.
 *     deprecated: true
 *     tags: [Health]
 *     security: []
 *     responses:
 *       200:
 *         description: Service is healthy
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
app.get('/health-legacy', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() })
})

// 404 handler - must be after all routes
app.use(notFoundHandler)

// Global error handler - must be last
app.use(errorHandler)

export default app