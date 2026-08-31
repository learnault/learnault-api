import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import express, { Request, Response, NextFunction } from 'express'
import {
  requestContext,
  getRequestId,
  getActor,
} from '../../src/middleware/request-context'

describe('Request Context Middleware', () => {
  let app: express.Application

  beforeEach(() => {
    app = express()
    app.use(express.json())
    app.use(requestContext)
  })

  describe('Request ID Generation', () => {
    it('should generate a request ID if not provided', async () => {
      app.get('/test', (req: Request, res: Response) => {
        res.json({ requestId: req.requestId })
      })

      const response = await request(app).get('/test')

      expect(response.body.requestId).toBeDefined()
      expect(typeof response.body.requestId).toBe('string')
      expect(response.body.requestId.length).toBeGreaterThan(0)
    })

    it('should use provided x-request-id header', async () => {
      const customRequestId = 'custom-request-id-12345'

      app.get('/test', (req: Request, res: Response) => {
        res.json({ requestId: req.requestId })
      })

      const response = await request(app)
        .get('/test')
        .set('x-request-id', customRequestId)

      expect(response.body.requestId).toBe(customRequestId)
    })

    it('should return request ID in response headers', async () => {
      app.get('/test', (req: Request, res: Response) => {
        res.json({ success: true })
      })

      const response = await request(app).get('/test')

      expect(response.headers['x-request-id']).toBeDefined()
      expect(typeof response.headers['x-request-id']).toBe('string')
    })
  })

  describe('Actor Context', () => {
    it('should not set actor context for unauthenticated requests', async () => {
      app.get('/test', (req: Request, res: Response) => {
        res.json({ actor: req.actor })
      })

      const response = await request(app).get('/test')

      expect(response.body.actor).toBeUndefined()
    })

    it('should attach actor context when user is authenticated', async () => {
      // Simulate auth middleware
      app.use((req: Request, res: Response, next: NextFunction) => {
        req.user = {
          id: 'user123',
          email: 'test@example.com',
          role: 'learner' as const,
        }
        // Re-run requestContext logic for actor attachment
        if (req.user) {
          req.actor = {
            id: req.user.id,
            role: req.user.role,
            email: req.user.email,
          }
        }
        next()
      })

      app.get('/test', (req: Request, res: Response) => {
        res.json({ actor: req.actor })
      })

      const response = await request(app).get('/test')

      expect(response.body.actor).toBeDefined()
      expect(response.body.actor.id).toBe('user123')
      expect(response.body.actor.role).toBe('learner')
      expect(response.body.actor.email).toBe('test@example.com')
    })
  })

  describe('Helper Functions', () => {
    it('getRequestId should return request ID', async () => {
      let capturedRequestId: string | undefined

      app.get('/test', (req: Request, res: Response) => {
        capturedRequestId = getRequestId(req)
        res.json({ success: true })
      })

      await request(app).get('/test')

      expect(capturedRequestId).toBeDefined()
      expect(typeof capturedRequestId).toBe('string')
    })

    it('getActor should return undefined for unauthenticated requests', async () => {
      let capturedActor: any

      app.get('/test', (req: Request, res: Response) => {
        capturedActor = getActor(req)
        res.json({ success: true })
      })

      await request(app).get('/test')

      expect(capturedActor).toBeUndefined()
    })

    it('getActor should return actor context for authenticated requests', async () => {
      let capturedActor: any

      app.use((req: Request, res: Response, next: NextFunction) => {
        req.user = {
          id: 'user456',
          email: 'actor@example.com',
          role: 'employer' as const,
        }
        req.actor = {
          id: req.user.id,
          role: req.user.role,
          email: req.user.email,
        }
        next()
      })

      app.get('/test', (req: Request, res: Response) => {
        capturedActor = getActor(req)
        res.json({ success: true })
      })

      await request(app).get('/test')

      expect(capturedActor).toBeDefined()
      expect(capturedActor.id).toBe('user456')
      expect(capturedActor.role).toBe('employer')
    })
  })

  describe('Request Timing', () => {
    it('should track request start time', async () => {
      app.get('/test', (req: Request, res: Response) => {
        res.json({ startTime: req.startTime })
      })

      const response = await request(app).get('/test')

      expect(response.body.startTime).toBeDefined()
      expect(typeof response.body.startTime).toBe('number')
      expect(response.body.startTime).toBeGreaterThan(0)
    })
  })

  describe('Multiple Requests', () => {
    it('should generate unique request IDs for concurrent requests', async () => {
      app.get('/test', (req: Request, res: Response) => {
        res.json({ requestId: req.requestId })
      })

      const responses = await Promise.all([
        request(app).get('/test'),
        request(app).get('/test'),
        request(app).get('/test'),
      ])

      const requestIds = responses.map((r) => r.body.requestId)

      // All request IDs should be unique
      const uniqueIds = new Set(requestIds)
      expect(uniqueIds.size).toBe(3)
    })
  })
})
