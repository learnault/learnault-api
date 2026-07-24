import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import prisma from '../../../../src/config/database'
import { env } from '../../../../src/config/env'

export interface CreateSessionOptions {
  userId: string
  userAgent?: string
  ipAddress?: string
  expiresAt?: Date
  isRevoked?: boolean
}

/**
 * Create a JWT token for a user.
 */
export function createToken(userId: string, email: string, role: string = 'LEARNER'): string {
  return jwt.sign(
    { id: userId, email, role },
    env.JWT_SECRET,
    { expiresIn: '7d' }
  )
}

/**
 * Create a session record in the database.
 */
export async function createSession(options: CreateSessionOptions) {
  const token = crypto.randomBytes(32).toString('hex')
  const refreshToken = crypto.randomBytes(32).toString('hex')
  const expiresAt = options.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  
  return prisma.session.create({
    data: {
      userId: options.userId,
      token,
      refreshToken,
      userAgent: options.userAgent ?? 'test-agent',
      ipAddress: options.ipAddress ?? '127.0.0.1',
      expiresAt,
      isRevoked: options.isRevoked ?? false,
    },
  })
}

/**
 * Create multiple sessions for a user.
 */
export async function createSessions(userId: string, count: number) {
  const sessions = []
  for (let i = 0; i < count; i++) {
    sessions.push(await createSession({
      userId,
      userAgent: `test-agent-${i}`,
      ipAddress: `192.168.1.${i + 1}`,
    }))
  }

  return sessions
}

/**
 * Create a verification token.
 */
export async function createVerificationToken(
  userId: string,
  type: string = 'EMAIL_VERIFICATION',
  status: string = 'PENDING'
) {
  const tokenValue = crypto.randomBytes(32).toString('hex')
  const tokenHash = crypto.createHash('sha256').update(tokenValue).digest('hex')
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
  
  const record = await prisma.verificationToken.create({
    data: {
      userId,
      tokenHash,
      type,
      status,
      expiresAt,
    },
  })
  
  return { token: record, tokenValue }
}

/**
 * Create an expired verification token.
 */
export async function createExpiredVerificationToken(
  userId: string,
  type: string = 'EMAIL_VERIFICATION'
) {
  const tokenValue = crypto.randomBytes(32).toString('hex')
  const tokenHash = crypto.createHash('sha256').update(tokenValue).digest('hex')
  const expiresAt = new Date(Date.now() - 1000) // Already expired
  
  const record = await prisma.verificationToken.create({
    data: {
      userId,
      tokenHash,
      type,
      status: 'PENDING',
      expiresAt,
    },
  })

  return { token: record, tokenValue }
}

/**
 * Revoke all sessions for a user.
 */
export async function revokeSessions(userId: string) {
  return prisma.session.updateMany({
    where: { userId, isRevoked: false },
    data: { isRevoked: true, revokedAt: new Date() },
  })
}
