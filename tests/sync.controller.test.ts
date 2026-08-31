import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Request, Response } from 'express'
import { SyncController } from '../src/controllers/sync.controller'

vi.mock('../src/config/database', () => ({
  default: {
    syncEvent: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    completion: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    module: {
      findUnique: vi.fn(),
    },
  },
}))

import prisma from '../src/config/database'

const flushPromises = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0))

interface AuthRequest extends Request {
  user?: { id: string; email: string; role: string }
}

const makeEvent = (overrides = {}) => ({
  idempotencyKey: 'idem-1',
  deviceId: 'device-abc',
  moduleId: 'module-1',
  progressPercent: 50,
  clientTimestamp: new Date().toISOString(),
  syncVersion: 1,
  ...overrides,
})

const makeCompletionEvent = (overrides = {}) => ({
  idempotencyKey: 'idem-c1',
  deviceId: 'device-abc',
  moduleId: 'module-1',
  score: 85,
  clientTimestamp: new Date().toISOString(),
  syncVersion: 1,
  ...overrides,
})

describe('SyncController', () => {
  let controller: SyncController
  let req: Partial<AuthRequest>
  let res: Partial<Response>
  let next: ReturnType<typeof vi.fn>

  beforeEach(() => {
    controller = new SyncController()
    req = {
      user: { id: 'user-1', email: 'test@example.com', role: 'LEARNER' },
      body: {},
    }
    res = { json: vi.fn(), status: vi.fn().mockReturnThis() }
    next = vi.fn()
    vi.clearAllMocks()
  })

  describe('syncProgress', () => {
    it('throws UnauthorizedError when user is missing', async () => {
      req.user = undefined
      req.body = { events: [makeEvent()] }

      controller.syncProgress(req as Request, res as Response, next)
      await flushPromises()

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'User ID not found' }),
      )
    })

    it('throws BadRequestError when events is not an array', async () => {
      req.body = { events: 'not-an-array' }

      controller.syncProgress(req as Request, res as Response, next)
      await flushPromises()

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'events must be a non-empty array',
        }),
      )
    })

    it('rejects event with missing required fields', async () => {
      req.body = { events: [{ idempotencyKey: 'idem-1' }] }

      controller.syncProgress(req as Request, res as Response, next)
      await flushPromises()

      expect(res.status).toHaveBeenCalledWith(200)
      const call = vi.mocked(res.json).mock.calls[0][0]
      expect(call.data.results[0].status).toBe('rejected')
    })

    it('rejects event with invalid progressPercent', async () => {
      req.body = { events: [makeEvent({ progressPercent: 150 })] }
      vi.mocked(prisma.syncEvent.findUnique).mockResolvedValue(null)

      controller.syncProgress(req as Request, res as Response, next)
      await flushPromises()

      const call = vi.mocked(res.json).mock.calls[0][0]
      expect(call.data.results[0]).toEqual(
        expect.objectContaining({ status: 'rejected' }),
      )
    })

    it('skips duplicate idempotency key', async () => {
      req.body = { events: [makeEvent()] }
      vi.mocked(prisma.syncEvent.findUnique).mockResolvedValue({
        id: 'existing',
      } as any)

      controller.syncProgress(req as Request, res as Response, next)
      await flushPromises()

      const call = vi.mocked(res.json).mock.calls[0][0]
      expect(call.data.results[0].status).toBe('skipped')
    })

    it('skips stale sync version', async () => {
      req.body = { events: [makeEvent({ syncVersion: 1 })] }
      vi.mocked(prisma.syncEvent.findUnique).mockResolvedValue(null)
      vi.mocked(prisma.syncEvent.findFirst).mockResolvedValue({
        syncVersion: 5,
      } as any)

      controller.syncProgress(req as Request, res as Response, next)
      await flushPromises()

      const call = vi.mocked(res.json).mock.calls[0][0]
      expect(call.data.results[0].status).toBe('skipped')
    })

    it('applies a valid progress event', async () => {
      req.body = { events: [makeEvent()] }
      vi.mocked(prisma.syncEvent.findUnique).mockResolvedValue(null)
      vi.mocked(prisma.syncEvent.findFirst).mockResolvedValue(null)
      vi.mocked(prisma.syncEvent.create).mockResolvedValue({} as any)

      controller.syncProgress(req as Request, res as Response, next)
      await flushPromises()

      expect(prisma.syncEvent.create).toHaveBeenCalled()
      const call = vi.mocked(res.json).mock.calls[0][0]
      expect(call.data.results[0].status).toBe('applied')
    })

    it('handles partial success across multiple events', async () => {
      req.body = {
        events: [
          makeEvent({ idempotencyKey: 'idem-1' }),
          makeEvent({ idempotencyKey: 'idem-2', progressPercent: 999 }),
        ],
      }
      vi.mocked(prisma.syncEvent.findUnique).mockResolvedValue(null)
      vi.mocked(prisma.syncEvent.findFirst).mockResolvedValue(null)
      vi.mocked(prisma.syncEvent.create).mockResolvedValue({} as any)

      controller.syncProgress(req as Request, res as Response, next)
      await flushPromises()

      const { results } = vi.mocked(res.json).mock.calls[0][0].data
      expect(results[0].status).toBe('applied')
      expect(results[1].status).toBe('rejected')
    })
  })

  describe('syncCompletions', () => {
    it('throws UnauthorizedError when user is missing', async () => {
      req.user = undefined
      req.body = { events: [makeCompletionEvent()] }

      controller.syncCompletions(req as Request, res as Response, next)
      await flushPromises()

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'User ID not found' }),
      )
    })

    it('rejects event for unknown module', async () => {
      req.body = { events: [makeCompletionEvent()] }
      vi.mocked(prisma.syncEvent.findUnique).mockResolvedValue(null)
      vi.mocked(prisma.module.findUnique).mockResolvedValue(null)

      controller.syncCompletions(req as Request, res as Response, next)
      await flushPromises()

      const call = vi.mocked(res.json).mock.calls[0][0]
      expect(call.data.results[0]).toEqual(
        expect.objectContaining({
          status: 'rejected',
          reason: 'Module not found',
        }),
      )
    })

    it('skips duplicate idempotency key', async () => {
      req.body = { events: [makeCompletionEvent()] }
      vi.mocked(prisma.syncEvent.findUnique).mockResolvedValue({
        id: 'existing',
      } as any)

      controller.syncCompletions(req as Request, res as Response, next)
      await flushPromises()

      const call = vi.mocked(res.json).mock.calls[0][0]
      expect(call.data.results[0].status).toBe('skipped')
    })

    it('skips completion if existing score is higher', async () => {
      req.body = { events: [makeCompletionEvent({ score: 60 })] }
      vi.mocked(prisma.syncEvent.findUnique).mockResolvedValue(null)
      vi.mocked(prisma.module.findUnique).mockResolvedValue({
        id: 'module-1',
      } as any)
      vi.mocked(prisma.completion.findUnique).mockResolvedValue({
        score: 90,
      } as any)
      vi.mocked(prisma.syncEvent.create).mockResolvedValue({} as any)

      controller.syncCompletions(req as Request, res as Response, next)
      await flushPromises()

      const call = vi.mocked(res.json).mock.calls[0][0]
      expect(call.data.results[0].status).toBe('skipped')
      expect(prisma.completion.update).not.toHaveBeenCalled()
    })

    it('updates completion when new score is higher', async () => {
      req.body = { events: [makeCompletionEvent({ score: 95 })] }
      vi.mocked(prisma.syncEvent.findUnique).mockResolvedValue(null)
      vi.mocked(prisma.module.findUnique).mockResolvedValue({
        id: 'module-1',
      } as any)
      vi.mocked(prisma.completion.findUnique).mockResolvedValue({
        score: 70,
      } as any)
      vi.mocked(prisma.completion.update).mockResolvedValue({} as any)
      vi.mocked(prisma.syncEvent.create).mockResolvedValue({} as any)

      controller.syncCompletions(req as Request, res as Response, next)
      await flushPromises()

      expect(prisma.completion.update).toHaveBeenCalled()
      const call = vi.mocked(res.json).mock.calls[0][0]
      expect(call.data.results[0].status).toBe('applied')
    })

    it('creates new completion when none exists', async () => {
      req.body = { events: [makeCompletionEvent()] }
      vi.mocked(prisma.syncEvent.findUnique).mockResolvedValue(null)
      vi.mocked(prisma.module.findUnique).mockResolvedValue({
        id: 'module-1',
      } as any)
      vi.mocked(prisma.completion.findUnique).mockResolvedValue(null)
      vi.mocked(prisma.completion.create).mockResolvedValue({} as any)
      vi.mocked(prisma.syncEvent.create).mockResolvedValue({} as any)

      controller.syncCompletions(req as Request, res as Response, next)
      await flushPromises()

      expect(prisma.completion.create).toHaveBeenCalled()
      const call = vi.mocked(res.json).mock.calls[0][0]
      expect(call.data.results[0].status).toBe('applied')
    })

    it('rejects event with invalid score', async () => {
      req.body = { events: [makeCompletionEvent({ score: -5 })] }
      vi.mocked(prisma.syncEvent.findUnique).mockResolvedValue(null)

      controller.syncCompletions(req as Request, res as Response, next)
      await flushPromises()

      const call = vi.mocked(res.json).mock.calls[0][0]
      expect(call.data.results[0].status).toBe('rejected')
    })
  })
})
