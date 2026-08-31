import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/controllers/employer.controller', () => ({
  searchTalent: vi.fn((_req, res) => res.status(200).json({ ok: true })),
  getCandidateProfile: vi.fn((_req, res) => res.status(200).json({ ok: true })),
  contactCandidate: vi.fn((_req, res) => res.status(201).json({ ok: true })),
}))

// authorize()/requireVerifiedEmail now read the caller's role, status, and
// verification flag from the database rather than trusting the JWT claim
// alone — mock that lookup so this route test doesn't need a real DB.
const findUniqueMock = vi.fn()

vi.mock('../../src/config/database', () => ({
  default: {
    user: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
  },
}))

const { issueAccessToken } = await import('../../src/config/jwt')
const employerRoutes = (await import('../../src/routes/v1/employer.routes'))
  .default

function makeToken(role: 'learner' | 'employer') {
  return issueAccessToken({ id: 'user-1', role })
}

describe('employer.routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects unauthenticated requests', async () => {
    const app = express()
    app.use(express.json())
    app.use('/employer', employerRoutes)

    const response = await request(app).get('/employer/search')

    expect(response.status).toBe(401)
  })

  it('restricts access to employer accounts only', async () => {
    findUniqueMock.mockResolvedValue({
      role: 'learner',
      status: 'ACTIVE',
      isVerified: true,
    })

    const app = express()
    app.use(express.json())
    app.use('/employer', employerRoutes)

    const response = await request(app)
      .get('/employer/search')
      .set('Authorization', `Bearer ${makeToken('learner')}`)

    expect(response.status).toBe(403)
  })

  it('applies employer rate limiter and allows employer role', async () => {
    findUniqueMock.mockResolvedValue({
      role: 'employer',
      status: 'ACTIVE',
      isVerified: true,
    })

    const app = express()
    app.use(express.json())
    app.use('/employer', employerRoutes)

    const response = await request(app)
      .get('/employer/search')
      .set('Authorization', `Bearer ${makeToken('employer')}`)

    expect(response.status).toBe(200)
    expect(response.headers['x-ratelimit-limit']).toBeDefined()
  })

  it('rejects an employer with an unverified email', async () => {
    findUniqueMock.mockResolvedValue({
      role: 'employer',
      status: 'ACTIVE',
      isVerified: false,
    })

    const app = express()
    app.use(express.json())
    app.use('/employer', employerRoutes)

    const response = await request(app)
      .get('/employer/search')
      .set('Authorization', `Bearer ${makeToken('employer')}`)

    expect(response.status).toBe(403)
  })
})
