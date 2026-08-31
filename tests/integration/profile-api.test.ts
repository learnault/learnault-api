import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from 'vitest'
import { Pool } from 'pg'
import request from 'supertest'
import { validateTestDatabaseUrl } from '../helpers/guard'

/**
 * Identity/profile integration suite for the Prisma-backed user routes.
 *
 * Everything here goes through the real Express app, real middleware, real
 * JWT verification and a real database — no service is stubbed. That is the
 * point: the mock helpers this feature removed were invisible to unit tests
 * precisely because unit tests mock the layer below.
 *
 * Skipped (not failed) when no test database is reachable, matching
 * tests/integration/isolation.test.ts.
 */
async function isDatabaseAvailable(): Promise<boolean> {
  try {
    const url = validateTestDatabaseUrl()
    const pool = new Pool({
      connectionString: url,
      max: 1,
      connectionTimeoutMillis: 3000,
    })
    const client = await pool.connect()
    client.release()
    await pool.end()

    return true
  } catch {
    return false
  }
}

const dbAvailable = await isDatabaseAvailable()

const PUBLIC_KEY_A = `G${'A'.repeat(55)}`
const PUBLIC_KEY_B = `G${'B'.repeat(55)}`

/**
 * Generous, because these are the two slow parts and neither is what is under
 * test: importing the app pulls in swagger-jsdoc, the Stellar SDK and
 * firebase-admin, and bcrypt hashing per fixture is deliberately expensive.
 * The default 5s/10s limits turn CPU contention from a parallel run into a
 * spurious failure.
 */
const HOOK_TIMEOUT_MS = 120_000
const TEST_TIMEOUT_MS = 60_000

vi.setConfig({ testTimeout: TEST_TIMEOUT_MS, hookTimeout: HOOK_TIMEOUT_MS })

describe.runIf(dbAvailable)('Identity and profile API', () => {
  let app: import('express').Application
  let prisma: import('@prisma/client').PrismaClient
  let issueAccessToken: (claims: { id: string; role: string }) => string
  let hashPassword: (password: string) => Promise<string>
  let uniqueSuffix = 0

  beforeAll(async () => {
    ;({ default: app } = await import('../../src/app'))
    ;({ prisma } = await import('../../src/config/database'))
    ;({ issueAccessToken } = await import('../../src/config/jwt'))
    ;({ hashPassword } = await import('../../src/utils/password'))
  }, HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await prisma?.$disconnect()
  }, HOOK_TIMEOUT_MS)

  beforeEach(async () => {
    // Cascades clear profiles, onboarding, consents, sessions and audit-free
    // children; audit events are append-only and are asserted by count deltas.
    await prisma.user.deleteMany({})
  }, HOOK_TIMEOUT_MS)

  async function createLearner(
    overrides: Partial<{
      status: string
      password: string
      walletAddress: string | null
    }> = {},
  ) {
    uniqueSuffix += 1
    const plaintext = overrides.password ?? 'Str0ng!Pass'

    const user = await prisma.user.create({
      data: {
        email: `learner_${Date.now()}_${uniqueSuffix}@example.com`,
        username: `learner_${Date.now()}_${uniqueSuffix}`,
        password: await hashPassword(plaintext),
        role: 'LEARNER',
        isVerified: true,
        status: overrides.status ?? 'ACTIVE',
        walletAddress: overrides.walletAddress ?? null,
      },
    })

    return {
      user,
      plaintext,
      token: issueAccessToken({ id: user.id, role: 'learner' }),
      auth: `Bearer ${issueAccessToken({ id: user.id, role: 'learner' })}`,
    }
  }

  async function auditEventsFor(userId: string, action: string) {
    return prisma.auditEvent.findMany({ where: { targetId: userId, action } })
  }

  // ── Authentication ───────────────────────────────────────────────────────

  describe('authentication', () => {
    it('rejects GET /users/me without a token', async () => {
      await request(app).get('/api/v1/users/me').expect(401)
    })

    it('rejects PATCH /users/me without a token', async () => {
      await request(app)
        .patch('/api/v1/users/me')
        .send({ displayName: 'Ada' })
        .expect(401)
    })

    it('rejects an invalid token', async () => {
      await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', 'Bearer not-a-jwt')
        .expect(401)
    })

    it('rejects PATCH /users/password and PATCH /users/wallet without a token', async () => {
      await request(app).patch('/api/v1/users/password').send({}).expect(401)
      await request(app).patch('/api/v1/users/wallet').send({}).expect(401)
    })

    it('serves GET /users/{id} to an anonymous caller', async () => {
      const { user } = await createLearner()
      await prisma.learnerProfile.create({
        data: { userId: user.id, visibility: 'public' },
      })

      await request(app).get(`/api/v1/users/${user.id}`).expect(200)
    })
  })

  // ── Owner aggregate read ─────────────────────────────────────────────────

  describe('GET /users/me', () => {
    it('returns real persisted data, not a fixture', async () => {
      const { user, auth } = await createLearner()

      const response = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', auth)
        .expect(200)

      expect(response.body.data.account.id).toBe(user.id)
      expect(response.body.data.account.email).toBe(user.email)
      expect(response.body.data.account.email).not.toBe('test@example.com')
      expect(response.body.data.account.username).not.toBe('testuser')
    })

    it('never returns the password hash', async () => {
      const { auth } = await createLearner()

      const response = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', auth)

      expect(JSON.stringify(response.body)).not.toContain('$2')
      expect(response.body.data.account).not.toHaveProperty('password')
    })

    it('returns only the documented profile fields, not the archive bookkeeping', async () => {
      const { auth } = await createLearner()

      const response = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', auth)
        .expect(200)

      expect(Object.keys(response.body.data.profile).sort()).toEqual([
        'avatarUrl',
        'bio',
        'country',
        'createdAt',
        'displayName',
        'goals',
        'id',
        'interests',
        'languages',
        'level',
        'timezone',
        'updatedAt',
        'userId',
        'visibility',
      ])
    })

    it('creates the profile row on first access and reports 0% completion', async () => {
      const { user, auth } = await createLearner()

      const response = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', auth)
        .expect(200)

      expect(response.body.data.completion.percent).toBe(0)
      expect(response.body.data.completion.missingFields).toContain(
        'displayName',
      )
      expect(
        await prisma.learnerProfile.findUnique({ where: { userId: user.id } }),
      ).not.toBeNull()
    })

    it('returns onboarding state and outstanding required steps', async () => {
      const { user, auth } = await createLearner()
      await prisma.onboardingProgress.create({
        data: {
          userId: user.id,
          currentStep: 'profile_basics',
          completedSteps: ['profile_basics'],
        },
      })

      const response = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', auth)
        .expect(200)

      expect(response.body.data.onboarding.status).toBe('in_progress')
      expect(response.body.data.onboarding.requiredStepsRemaining).toEqual([
        'consent',
      ])
    })

    it('reports null onboarding for a learner who never started', async () => {
      const { auth } = await createLearner()

      const response = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', auth)
        .expect(200)

      expect(response.body.data.onboarding).toBeNull()
    })

    it('reports required consents as granted only once both are granted', async () => {
      const { user, auth } = await createLearner()

      await prisma.consentRecord.create({
        data: {
          userId: user.id,
          purpose: 'terms_of_service',
          required: true,
          policyVersion: '2026-01',
          status: 'granted',
          source: 'onboarding',
          grantedAt: new Date(),
        },
      })

      const partial = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', auth)
        .expect(200)
      expect(partial.body.data.requiredConsentsGranted).toBe(false)

      await prisma.consentRecord.create({
        data: {
          userId: user.id,
          purpose: 'privacy_policy',
          required: true,
          policyVersion: '2026-01',
          status: 'granted',
          source: 'onboarding',
          grantedAt: new Date(),
        },
      })

      const complete = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', auth)
        .expect(200)
      expect(complete.body.data.requiredConsentsGranted).toBe(true)
      expect(complete.body.data.consents).toHaveLength(2)
    })

    it('returns 404 once the account row is gone', async () => {
      const { user, auth } = await createLearner()
      await prisma.user.delete({ where: { id: user.id } })

      await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', auth)
        .expect(404)
    })

    it('returns 404 for a tombstoned account', async () => {
      const { user, auth } = await createLearner()
      await prisma.user.update({
        where: { id: user.id },
        data: { status: 'DELETED' },
      })

      await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', auth)
        .expect(404)
    })
  })

  // ── Owner update ─────────────────────────────────────────────────────────

  describe('PATCH /users/me', () => {
    it('persists a partial update and leaves omitted fields alone', async () => {
      const { user, auth } = await createLearner()

      await request(app)
        .patch('/api/v1/users/me')
        .set('Authorization', auth)
        .send({ displayName: 'Ada Lovelace', country: 'NG' })
        .expect(200)

      await request(app)
        .patch('/api/v1/users/me')
        .set('Authorization', auth)
        .send({ bio: 'Building on Stellar' })
        .expect(200)

      const stored = await prisma.learnerProfile.findUnique({
        where: { userId: user.id },
      })

      expect(stored?.displayName).toBe('Ada Lovelace')
      expect(stored?.country).toBe('NG')
      expect(stored?.bio).toBe('Building on Stellar')
    })

    it('recomputes profile completion from the persisted row', async () => {
      const { auth } = await createLearner()

      const response = await request(app)
        .patch('/api/v1/users/me')
        .set('Authorization', auth)
        .send({
          displayName: 'Ada',
          bio: 'hi',
          country: 'NG',
          timezone: 'Africa/Lagos',
        })
        .expect(200)

      expect(response.body.data.completion.percent).toBe(50)
      expect(response.body.data.completion.missingFields).not.toContain(
        'displayName',
      )
    })

    it.each([
      ['status', { status: 'ACTIVE' }],
      ['isVerified', { isVerified: true }],
      ['role', { role: 'ADMIN' }],
      ['email', { email: 'attacker@example.com' }],
      ['password', { password: 'Hacked1!pass' }],
      ['walletAddress', { walletAddress: PUBLIC_KEY_A }],
      ['userId', { userId: '00000000-0000-4000-8000-000000000000' }],
    ])('rejects %s and changes nothing', async (_field, body) => {
      const { user, auth } = await createLearner()
      const before = await prisma.user.findUnique({ where: { id: user.id } })

      await request(app)
        .patch('/api/v1/users/me')
        .set('Authorization', auth)
        .send(body)
        .expect(400)

      expect(await prisma.user.findUnique({ where: { id: user.id } })).toEqual(
        before,
      )
    })

    it('rejects an empty body', async () => {
      const { auth } = await createLearner()

      await request(app)
        .patch('/api/v1/users/me')
        .set('Authorization', auth)
        .send({})
        .expect(400)
    })

    it('rejects an out-of-range value without writing a partial update', async () => {
      const { user, auth } = await createLearner()

      await request(app)
        .patch('/api/v1/users/me')
        .set('Authorization', auth)
        .send({ displayName: 'Ada', level: 'wizard' })
        .expect(400)

      expect(
        await prisma.learnerProfile.findUnique({ where: { userId: user.id } }),
      ).toBeNull()
    })

    it('cannot touch another learner’s profile', async () => {
      const owner = await createLearner()
      const victim = await createLearner()
      await prisma.learnerProfile.create({
        data: { userId: victim.user.id, displayName: 'Victim' },
      })

      await request(app)
        .patch('/api/v1/users/me')
        .set('Authorization', owner.auth)
        .send({ displayName: 'Attacker' })
        .expect(200)

      const victimProfile = await prisma.learnerProfile.findUnique({
        where: { userId: victim.user.id },
      })

      expect(victimProfile?.displayName).toBe('Victim')
    })

    it('writes an audit event naming the changed fields but not their values', async () => {
      const { user, auth } = await createLearner()

      await request(app)
        .patch('/api/v1/users/me')
        .set('Authorization', auth)
        .set('x-request-id', 'itest-profile-update')
        .send({ displayName: 'Ada Lovelace', bio: 'private medical history' })
        .expect(200)

      const profile = await prisma.learnerProfile.findUnique({
        where: { userId: user.id },
      })
      const events = await auditEventsFor(
        profile!.id,
        'learner_profile.updated',
      )

      expect(events).toHaveLength(1)
      expect(events[0].actorType).toBe('USER')
      expect(events[0].actorId).toBe(user.id)
      expect(events[0].targetType).toBe('LearnerProfile')
      expect(events[0].requestId).toBe('itest-profile-update')
      expect(events[0].metadata).toContain('displayName')
      expect(events[0].metadata).not.toContain('Lovelace')
      expect(events[0].metadata).not.toContain('medical history')
    })

    it('writes no audit event for a rejected update', async () => {
      const { auth } = await createLearner()
      const before = await prisma.auditEvent.count()

      await request(app)
        .patch('/api/v1/users/me')
        .set('Authorization', auth)
        .send({ role: 'ADMIN' })
        .expect(400)

      expect(await prisma.auditEvent.count()).toBe(before)
    })
  })

  // ── Public, consent-aware read ───────────────────────────────────────────

  describe('GET /users/{id}', () => {
    it('rejects a non-uuid id', async () => {
      await request(app).get('/api/v1/users/not-a-uuid').expect(400)
    })

    it('returns 404 for an unknown learner', async () => {
      await request(app)
        .get('/api/v1/users/00000000-0000-4000-8000-000000000000')
        .expect(404)
    })

    it('serves the public subset for a public profile', async () => {
      const { user } = await createLearner()
      await prisma.learnerProfile.create({
        data: {
          userId: user.id,
          displayName: 'Ada',
          bio: 'Building on Stellar',
          country: 'NG',
          timezone: 'Africa/Lagos',
          languages: ['en'],
          goals: ['ship'],
          interests: ['stellar'],
          visibility: 'public',
        },
      })

      const response = await request(app)
        .get(`/api/v1/users/${user.id}`)
        .expect(200)

      expect(response.body.data).toMatchObject({
        visible: true,
        displayName: 'Ada',
        country: 'NG',
      })
      expect(response.body.data).not.toHaveProperty('goals')
      expect(response.body.data).not.toHaveProperty('timezone')
      expect(response.body.data).not.toHaveProperty('languages')
    })

    it('never leaks private account data', async () => {
      const { user } = await createLearner({ walletAddress: PUBLIC_KEY_A })
      await prisma.learnerProfile.create({
        data: { userId: user.id, displayName: 'Ada', visibility: 'public' },
      })

      const response = await request(app)
        .get(`/api/v1/users/${user.id}`)
        .expect(200)
      const body = JSON.stringify(response.body)

      expect(body).not.toContain(user.email)
      expect(body).not.toContain(user.username)
      expect(body).not.toContain(PUBLIC_KEY_A)
      expect(body).not.toContain('$2')
      expect(response.body.data).not.toHaveProperty('userId')
      expect(response.body.data).not.toHaveProperty('status')
      expect(response.body.data).not.toHaveProperty('isVerified')
      expect(response.body.data).not.toHaveProperty('phoneVerifiedAt')
    })

    it('redacts a private profile', async () => {
      const { user } = await createLearner()
      const profile = await prisma.learnerProfile.create({
        data: { userId: user.id, displayName: 'Ada', visibility: 'private' },
      })

      const response = await request(app)
        .get(`/api/v1/users/${user.id}`)
        .expect(200)

      expect(response.body.data).toEqual({ id: profile.id, visible: false })
    })

    it('redacts an employer-only profile from the public route', async () => {
      const { user } = await createLearner()
      await prisma.learnerProfile.create({
        data: { userId: user.id, displayName: 'Ada', visibility: 'employer' },
      })

      const response = await request(app)
        .get(`/api/v1/users/${user.id}`)
        .expect(200)

      expect(response.body.data.visible).toBe(false)
      expect(response.body.data).not.toHaveProperty('displayName')
    })

    it('redacts a public profile once data-sharing consent is withdrawn', async () => {
      const { user } = await createLearner()
      await prisma.learnerProfile.create({
        data: { userId: user.id, displayName: 'Ada', visibility: 'public' },
      })
      await prisma.consentRecord.create({
        data: {
          userId: user.id,
          purpose: 'data_sharing',
          required: false,
          policyVersion: '2026-01',
          status: 'withdrawn',
          source: 'settings',
          withdrawnAt: new Date(),
        },
      })

      const response = await request(app)
        .get(`/api/v1/users/${user.id}`)
        .expect(200)

      expect(response.body.data.visible).toBe(false)
    })

    it('still discloses a public profile while data-sharing consent is granted', async () => {
      const { user } = await createLearner()
      await prisma.learnerProfile.create({
        data: { userId: user.id, displayName: 'Ada', visibility: 'public' },
      })
      await prisma.consentRecord.create({
        data: {
          userId: user.id,
          purpose: 'data_sharing',
          required: false,
          policyVersion: '2026-01',
          status: 'granted',
          source: 'settings',
          grantedAt: new Date(),
        },
      })

      const response = await request(app)
        .get(`/api/v1/users/${user.id}`)
        .expect(200)

      expect(response.body.data.visible).toBe(true)
    })

    it.each(['DEACTIVATED', 'PENDING_DELETION'])(
      'redacts a public profile for a %s account',
      async (status) => {
        const { user } = await createLearner()
        await prisma.learnerProfile.create({
          data: { userId: user.id, displayName: 'Ada', visibility: 'public' },
        })
        await prisma.user.update({ where: { id: user.id }, data: { status } })

        const response = await request(app)
          .get(`/api/v1/users/${user.id}`)
          .expect(200)

        expect(response.body.data.visible).toBe(false)
      },
    )

    it('excludes an archived profile entirely', async () => {
      const { user } = await createLearner()
      await prisma.learnerProfile.create({
        data: {
          userId: user.id,
          displayName: 'Ada',
          visibility: 'public',
          archivedAt: new Date(),
          archivedReason: 'account deactivated',
        },
      })

      await request(app).get(`/api/v1/users/${user.id}`).expect(404)
    })

    it('serves the owner the same public view as anyone else', async () => {
      const { user, auth } = await createLearner()
      await prisma.learnerProfile.create({
        data: { userId: user.id, displayName: 'Ada', visibility: 'private' },
      })

      const asOwner = await request(app)
        .get(`/api/v1/users/${user.id}`)
        .set('Authorization', auth)
        .expect(200)
      const anonymous = await request(app)
        .get(`/api/v1/users/${user.id}`)
        .expect(200)

      expect(asOwner.body).toEqual(anonymous.body)
      expect(asOwner.body.data.visible).toBe(false)
    })
  })

  // ── Password change ──────────────────────────────────────────────────────

  describe('PATCH /users/password', () => {
    it('rejects a wrong current password with 401 and leaves the hash intact', async () => {
      const { user, auth } = await createLearner()
      const before = await prisma.user.findUnique({ where: { id: user.id } })

      await request(app)
        .patch('/api/v1/users/password')
        .set('Authorization', auth)
        .send({ currentPassword: 'WrongPass1!', newPassword: 'Another1!Pass' })
        .expect(401)

      const after = await prisma.user.findUnique({ where: { id: user.id } })
      expect(after?.password).toBe(before?.password)
    })

    it('rejects a weak new password', async () => {
      const { auth, plaintext } = await createLearner()

      await request(app)
        .patch('/api/v1/users/password')
        .set('Authorization', auth)
        .send({ currentPassword: plaintext, newPassword: 'weak' })
        .expect(400)
    })

    it('rejects reusing the current password', async () => {
      const { auth, plaintext } = await createLearner()

      await request(app)
        .patch('/api/v1/users/password')
        .set('Authorization', auth)
        .send({ currentPassword: plaintext, newPassword: plaintext })
        .expect(400)
    })

    it('stores a new hash and revokes every live session', async () => {
      const { user, auth, plaintext } = await createLearner()
      const before = await prisma.user.findUnique({ where: { id: user.id } })

      const session = await prisma.session.create({
        data: {
          userId: user.id,
          token: `tok_${user.id}`,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      })
      await prisma.refreshToken.create({
        data: {
          sessionId: session.id,
          familyId: 'fam-1',
          tokenHash: `hash_${user.id}`,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      })

      const response = await request(app)
        .patch('/api/v1/users/password')
        .set('Authorization', auth)
        .send({ currentPassword: plaintext, newPassword: 'Another1!Pass' })
        .expect(200)

      expect(response.body.revokedSessionCount).toBe(1)
      expect(JSON.stringify(response.body)).not.toContain('Another1!Pass')

      const after = await prisma.user.findUnique({ where: { id: user.id } })
      expect(after?.password).not.toBe(before?.password)
      expect(after?.password).not.toBe('Another1!Pass')

      expect(
        (await prisma.session.findUnique({ where: { id: session.id } }))
          ?.isRevoked,
      ).toBe(true)
      expect(
        await prisma.refreshToken.count({
          where: { sessionId: session.id, status: 'REVOKED' },
        }),
      ).toBe(1)
    })

    it('audits the change without recording either password', async () => {
      const { user, auth, plaintext } = await createLearner()

      await request(app)
        .patch('/api/v1/users/password')
        .set('Authorization', auth)
        .send({ currentPassword: plaintext, newPassword: 'Another1!Pass' })
        .expect(200)

      const events = await auditEventsFor(user.id, 'user.password_changed')

      expect(events).toHaveLength(1)
      expect(events[0].actorId).toBe(user.id)
      expect(events[0].metadata).toContain('revokedSessionCount')
      expect(JSON.stringify(events[0])).not.toContain(plaintext)
      expect(JSON.stringify(events[0])).not.toContain('Another1!Pass')
    })
  })

  // ── Wallet address ───────────────────────────────────────────────────────

  describe('PATCH /users/wallet', () => {
    it('rejects a malformed address', async () => {
      const { auth } = await createLearner()

      await request(app)
        .patch('/api/v1/users/wallet')
        .set('Authorization', auth)
        .send({ walletAddress: 'invalid-address' })
        .expect(400)
    })

    it('rejects a secret seed in the address field', async () => {
      const { auth } = await createLearner()

      await request(app)
        .patch('/api/v1/users/wallet')
        .set('Authorization', auth)
        .send({ walletAddress: `S${'A'.repeat(55)}` })
        .expect(400)
    })

    it('persists a valid address and audits it', async () => {
      const { user, auth } = await createLearner()

      await request(app)
        .patch('/api/v1/users/wallet')
        .set('Authorization', auth)
        .send({ walletAddress: PUBLIC_KEY_A })
        .expect(200)

      expect(
        (await prisma.user.findUnique({ where: { id: user.id } }))
          ?.walletAddress,
      ).toBe(PUBLIC_KEY_A)
      expect(
        await auditEventsFor(user.id, 'user.wallet_address_changed'),
      ).toHaveLength(1)
    })

    it('is idempotent and writes no second audit event', async () => {
      const { user, auth } = await createLearner({
        walletAddress: PUBLIC_KEY_A,
      })

      const response = await request(app)
        .patch('/api/v1/users/wallet')
        .set('Authorization', auth)
        .send({ walletAddress: PUBLIC_KEY_A })
        .expect(200)

      expect(response.body.message).toBe('Wallet address unchanged')
      expect(
        await auditEventsFor(user.id, 'user.wallet_address_changed'),
      ).toHaveLength(0)
    })

    it('returns 409 when the address is already claimed by another account', async () => {
      await createLearner({ walletAddress: PUBLIC_KEY_B })
      const { user, auth } = await createLearner()

      const response = await request(app)
        .patch('/api/v1/users/wallet')
        .set('Authorization', auth)
        .send({ walletAddress: PUBLIC_KEY_B })
        .expect(409)

      expect(response.body.code).toBe('WALLET_ADDRESS_TAKEN')
      expect(
        (await prisma.user.findUnique({ where: { id: user.id } }))
          ?.walletAddress,
      ).toBeNull()
    })

    it('returns 404 for a tombstoned account', async () => {
      const { user, auth } = await createLearner()
      await prisma.user.update({
        where: { id: user.id },
        data: { status: 'DELETED' },
      })

      await request(app)
        .patch('/api/v1/users/wallet')
        .set('Authorization', auth)
        .send({ walletAddress: PUBLIC_KEY_A })
        .expect(404)
    })
  })
})
