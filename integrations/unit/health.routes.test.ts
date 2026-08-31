import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import healthRoutes from '../../src/routes/health.routes'
import prisma from '../../src/config/database'

// Mock the prisma module
vi.mock('../../src/config/database', () => ({
  default: {
    $queryRaw: vi.fn(),
  },
}))

describe('Health Routes', () => {
  let app: express.Application

  beforeEach(() => {
    app = express()
    app.use('/health', healthRoutes)
    vi.clearAllMocks()
  })

  describe('GET /health/live', () => {
    it('should return 200 with status ok', async () => {
      const response = await request(app).get('/health/live')

      expect(response.status).toBe(200)
      expect(response.body.status).toBe('ok')
      expect(response.body.timestamp).toBeDefined()
    })

    it('should return valid ISO timestamp', async () => {
      const response = await request(app).get('/health/live')

      const timestamp = new Date(response.body.timestamp)
      expect(timestamp.toISOString()).toBe(response.body.timestamp)
    })

    it('should respond quickly', async () => {
      const start = Date.now()
      await request(app).get('/health/live')
      const duration = Date.now() - start

      // Should respond in less than 100ms (liveness checks should be fast)
      expect(duration).toBeLessThan(100)
    })
  })

  describe('GET /health/ready', () => {
    it('should return 200 when all dependencies are healthy', async () => {
      // Mock successful database query
      vi.mocked(prisma.$queryRaw).mockResolvedValue([{ '?column?': 1 }])

      const response = await request(app).get('/health/ready')

      expect(response.status).toBe(200)
      expect(response.body.status).toBe('ready')
      expect(response.body.timestamp).toBeDefined()
      expect(response.body.checks).toBeDefined()
      expect(response.body.checks.database).toBe('ok')
      expect(response.body.errors).toBeUndefined()
    })

    it('should return 503 when database is unavailable', async () => {
      // Mock database failure
      vi.mocked(prisma.$queryRaw).mockRejectedValue(
        new Error('Connection refused'),
      )

      const response = await request(app).get('/health/ready')

      expect(response.status).toBe(503)
      expect(response.body.status).toBe('not ready')
      expect(response.body.checks.database).toBe('error')
      expect(response.body.errors).toBeDefined()
      expect(response.body.errors.length).toBeGreaterThan(0)
      expect(response.body.errors[0]).toContain('Database connection failed')
    })

    it('should include error details in response', async () => {
      const errorMessage = 'Timeout connecting to database'
      vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error(errorMessage))

      const response = await request(app).get('/health/ready')

      expect(response.status).toBe(503)
      expect(response.body.errors).toBeDefined()
      expect(response.body.errors[0]).toContain(errorMessage)
    })

    it('should return valid ISO timestamp', async () => {
      vi.mocked(prisma.$queryRaw).mockResolvedValue([{ '?column?': 1 }])

      const response = await request(app).get('/health/ready')

      const timestamp = new Date(response.body.timestamp)
      expect(timestamp.toISOString()).toBe(response.body.timestamp)
    })

    it('should include checks object in response', async () => {
      vi.mocked(prisma.$queryRaw).mockResolvedValue([{ '?column?': 1 }])

      const response = await request(app).get('/health/ready')

      expect(response.body.checks).toBeDefined()
      expect(typeof response.body.checks).toBe('object')
      expect(response.body.checks.database).toBeDefined()
    })
  })

  describe('Error Handling', () => {
    it('should handle non-Error exceptions in database check', async () => {
      // Mock rejection with non-Error object
      vi.mocked(prisma.$queryRaw).mockRejectedValue('String error')

      const response = await request(app).get('/health/ready')

      expect(response.status).toBe(503)
      expect(response.body.checks.database).toBe('error')
      expect(response.body.errors).toBeDefined()
    })
  })
})
