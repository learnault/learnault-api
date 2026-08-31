import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

// config/jwt.ts reads all of its configuration from process.env at module
// load time, so every scenario below needs its own fresh module instance
// (vi.resetModules + dynamic import) after stubbing the env it cares about.

describe('config/jwt — key rotation and token pinning', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('throws on load outside NODE_ENV=test when JWT_SECRET is missing', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('JWT_SECRET', '')

    await expect(import('../../src/config/jwt')).rejects.toThrow(/JWT_SECRET/)
  })

  it('falls back to a fixed test-only secret when NODE_ENV=test and JWT_SECRET is missing', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('JWT_SECRET', '')

    const { issueAccessToken, verifyAccessToken } =
      await import('../../src/config/jwt')
    const token = issueAccessToken({ id: 'u1', role: 'learner' })
    const claims = verifyAccessToken(token)

    expect(claims.id).toBe('u1')
  })

  it('issues tokens with the pinned issuer, audience, algorithm, and active kid', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('JWT_SECRET', 'primary-secret')
    vi.stubEnv('JWT_ISSUER', 'learnault-api')
    vi.stubEnv('JWT_AUDIENCE', 'learnault-clients')
    vi.stubEnv('JWT_KEY_ID', 'key-2026-01')

    const { issueAccessToken } = await import('../../src/config/jwt')
    const jwtModule = (await import('jsonwebtoken')).default
    const token = issueAccessToken({ id: 'u1', role: 'learner' })
    const decoded = jwtModule.decode(token, { complete: true })

    expect(decoded?.header.alg).toBe('HS256')
    expect(decoded?.header.kid).toBe('key-2026-01')
    expect((decoded?.payload as any).iss).toBe('learnault-api')
    expect((decoded?.payload as any).aud).toBe('learnault-clients')
  })

  it('still verifies a token signed under a retired key listed in JWT_PREVIOUS_KEYS', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('JWT_SECRET', 'old-secret')
    vi.stubEnv('JWT_KEY_ID', 'key-old')

    // Mint a token under the "old" active key/config.
    const oldModule = await import('../../src/config/jwt')
    const oldToken = oldModule.issueAccessToken({ id: 'u1', role: 'learner' })

    // Rotate: new active key, old key demoted to JWT_PREVIOUS_KEYS.
    vi.resetModules()
    vi.stubEnv('JWT_SECRET', 'new-secret')
    vi.stubEnv('JWT_KEY_ID', 'key-new')
    vi.stubEnv('JWT_PREVIOUS_KEYS', 'key-old:old-secret')

    const rotatedModule = await import('../../src/config/jwt')
    const claims = rotatedModule.verifyAccessToken(oldToken)

    expect(claims.id).toBe('u1')

    const newToken = rotatedModule.issueAccessToken({
      id: 'u2',
      role: 'employer',
    })
    expect(rotatedModule.verifyAccessToken(newToken).id).toBe('u2')
  })

  it('rejects a token whose key id is neither active nor listed as retired', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('JWT_SECRET', 'new-secret')
    vi.stubEnv('JWT_KEY_ID', 'key-new')
    vi.stubEnv('JWT_PREVIOUS_KEYS', '')

    const { issueAccessToken, verifyAccessToken } =
      await import('../../src/config/jwt')
    const jwtModule = (await import('jsonwebtoken')).default
    const forged = jwtModule.sign({ id: 'attacker' }, 'guessed-secret', {
      keyid: 'never-registered',
      issuer: 'learnault-api',
      audience: 'learnault-clients',
      algorithm: 'HS256',
    })

    expect(() => verifyAccessToken(forged)).toThrow()
    // sanity: legitimate tokens from the same module still verify fine
    expect(() =>
      verifyAccessToken(issueAccessToken({ id: 'u1', role: 'learner' })),
    ).not.toThrow()
  })
})
