import jwt, { SignOptions, VerifyOptions } from 'jsonwebtoken'

export interface JWTPayload {
  [key: string]: any;
}

/**
 * Sign a payload and return a JWT.
 */
export function signToken(
  payload: JWTPayload,
  secret: string,
  options: SignOptions = {}
): string {
  return jwt.sign(payload, secret, options)
}

/**
 * Verify a JWT and return the decoded payload. Throws if invalid.
 */
export function verifyToken(
  token: string,
  secret: string,
  options: VerifyOptions = {}
): JWTPayload {
  return jwt.verify(token, secret, options) as JWTPayload
}

/**
 * Decode a JWT without verifying signature. Returns null if invalid.
 */
export function decodeToken(token: string): JWTPayload | null {
  return (jwt.decode(token) as JWTPayload | null)
}
