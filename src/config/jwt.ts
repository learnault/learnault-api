import jwt, { Algorithm, SignOptions, VerifyOptions } from 'jsonwebtoken'
import { JWTPayload, signToken, verifyToken } from '../utils/jwt'

// Centralized JWT policy: one algorithm, one issuer/audience pair, and an
// explicit key id (kid) so tokens are self-describing during key rotation.
const ALGORITHM: Algorithm = 'HS256'
const ISSUER = process.env.JWT_ISSUER || 'learnault-api'
const AUDIENCE = process.env.JWT_AUDIENCE || 'learnault-clients'
// Access tokens are short-lived (default 15 minutes); clients exchange an
// opaque refresh token (see services/refresh-token.service.ts) for a fresh one.
const ACCESS_TOKEN_TTL_SECONDS = (() => {
  const parsed = parseInt(process.env.JWT_ACCESS_TTL_SECONDS || '', 10)

  return Number.isInteger(parsed) && parsed > 0 ? parsed : 15 * 60
})()
const ACTIVE_KEY_ID = process.env.JWT_KEY_ID || 'default'
const IS_TEST_ENV = process.env.NODE_ENV === 'test'

// A hardcoded fallback secret is only ever tolerated in the test runner.
// Anywhere else, missing config is a startup failure, not a silent weak key.
function loadActiveSecret(): string {
  const secret = process.env.JWT_SECRET

  if (secret && secret.trim().length > 0) {
    return secret
  }

  if (IS_TEST_ENV) {
    return 'test-only-insecure-secret-do-not-use-in-prod'
  }

  throw new Error(
    'JWT_SECRET environment variable is required (NODE_ENV != test). ' +
    'Refusing to start with an insecure fallback secret.'
  )
}

// JWT_PREVIOUS_KEYS="kid1:secret1,kid2:secret2" — retired signing keys kept
// around only so tokens issued before a rotation can still be verified.
function loadRetiredKeys(): Map<string, string> {
  const raw = process.env.JWT_PREVIOUS_KEYS
  const keys = new Map<string, string>()

  if (!raw) {
    return keys
  }

  for (const entry of raw.split(',')) {
    const [kid, secret] = entry.split(':').map((part: string) => part?.trim())

    if (kid && secret) {
      keys.set(kid, secret)
    }
  }

  return keys
}

const ACTIVE_SECRET = loadActiveSecret()
const RETIRED_KEYS = loadRetiredKeys()

export interface AccessTokenClaims extends JWTPayload {
  id: string;
  role: string;
}

/** Reads the unverified `kid` header so we know which key to check against. */
function readKeyId(token: string): string | undefined {
  const headerSegment = token.split('.')[0]

  if (!headerSegment) {
    return undefined
  }

  try {
    const header = JSON.parse(Buffer.from(headerSegment, 'base64url').toString('utf8'))

    return typeof header.kid === 'string' ? header.kid : undefined
  } catch {
    return undefined
  }
}

/**
 * Sign an access token under the current active key, issuer, audience and
 * algorithm. `expiresIn` and `algorithm` may not be overridden by callers.
 */
export function issueAccessToken(
  claims: AccessTokenClaims,
  options: Omit<SignOptions, 'algorithm' | 'expiresIn' | 'keyid'> = {}
): string {
  return signToken(claims, ACTIVE_SECRET, {
    ...options,
    algorithm: ALGORITHM,
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    keyid: ACTIVE_KEY_ID,
  } as SignOptions)
}

/**
 * Verify an access token. Resolves the signing key from the token's `kid`
 * header (falling back to the active key for tokens minted before this
 * change), and always pins algorithm/issuer/audience — a token that used a
 * different algorithm or was minted for another audience is rejected.
 */
export function verifyAccessToken(token: string, options: VerifyOptions = {}): AccessTokenClaims {
  const kid = readKeyId(token)
  const secret = !kid || kid === ACTIVE_KEY_ID ? ACTIVE_SECRET : RETIRED_KEYS.get(kid)

  if (!secret) {
    // Same error type jwt.verify() itself throws for a bad signature, so
    // callers (e.g. authenticate()) treat this as "invalid token" (401)
    // rather than an unexpected server error (500).
    throw new jwt.JsonWebTokenError('Unknown or retired signing key')
  }

  return verifyToken(token, secret, {
    ...options,
    algorithms: [ALGORITHM],
    issuer: ISSUER,
    audience: AUDIENCE,
  }) as AccessTokenClaims
}

export const jwtConfig = {
  algorithm: ALGORITHM,
  issuer: ISSUER,
  audience: AUDIENCE,
  expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  activeKeyId: ACTIVE_KEY_ID,
  retiredKeyIds: Array.from(RETIRED_KEYS.keys()),
}

/** Access-token lifetime in seconds, for the `expiresIn` response field. */
export const accessTokenTtlSeconds = ACCESS_TOKEN_TTL_SECONDS
