import { describe, it, expect, vi } from 'vitest'
import { Request, Response, NextFunction } from 'express'
import { errorHandler } from '../../src/middleware/errorHandler'

// ── helpers ───────────────────────────────────────────────────────────────────

function makeMocks() {
  const req = {} as Request
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as Partial<Response>
  const next: NextFunction = vi.fn()
  
return { req, res, next }
}

// ── errorHandler ──────────────────────────────────────────────────────────────

describe('errorHandler', () => {
  it('uses err.status as the response status code', () => {
    const { req, res, next } = makeMocks()
    const err = { status: 404, message: 'Not found' }

    errorHandler(err, req, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Not found',
    })
  })

  it('defaults to 500 when err.status is not set', () => {
    const { req, res, next } = makeMocks()
    const err = { message: 'Something went wrong' }

    errorHandler(err, req, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Something went wrong',
    })
  })

  it('defaults to "Internal Server Error" when err.message is not set', () => {
    const { req, res, next } = makeMocks()
    const err = {}

    errorHandler(err, req, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Internal Server Error',
    })
  })

  it('handles a native Error object', () => {
    const { req, res, next } = makeMocks()
    const err = new Error('Unexpected failure')

    errorHandler(err, req, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Unexpected failure',
    })
  })

  it('always sets success: false in the response body', () => {
    const { req, res, next } = makeMocks()

    errorHandler({ status: 200, message: 'ok' }, req, res as Response, next)

    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(body.success).toBe(false)
  })

  it('handles a 400 bad request error', () => {
    const { req, res, next } = makeMocks()
    const err = { status: 400, message: 'Bad request' }

    errorHandler(err, req, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Bad request',
    })
  })

  it('handles a 403 forbidden error', () => {
    const { req, res, next } = makeMocks()
    const err = { status: 403, message: 'Forbidden' }

    errorHandler(err, req, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Forbidden',
    })
  })
})