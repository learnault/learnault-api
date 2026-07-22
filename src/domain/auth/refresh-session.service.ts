import crypto from 'crypto'
import prisma from '../../config/database'
import type { SessionStatus } from '@prisma/client'
import { generateRawToken, hashToken } from './token.service'

export const REFRESH_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000
export const TOKEN_FAMILY_LENGTH = 16

function generateTokenFamily(): string {
  return crypto.randomBytes(TOKEN_FAMILY_LENGTH).toString('hex')
}

export class RefreshSessionService {
  async createSession(
    userId: string,
    options: {
      userAgent?: string
      ipAddress?: string
      deviceId?: string
      deviceName?: string
    } = {}
  ): Promise<{ rawToken: string; sessionId: string }> {
    const rawToken = generateRawToken()
    const tokenHash = hashToken(rawToken)
    const tokenFamily = generateTokenFamily()
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS)

    const session = await prisma.refreshSession.create({
      data: {
        userId,
        tokenHash,
        tokenFamily,
        userAgent: options.userAgent,
        ipAddress: options.ipAddress,
        deviceId: options.deviceId,
        deviceName: options.deviceName,
        expiresAt
      }
    })

    return { rawToken, sessionId: session.id }
  }

  async rotateSession(
    rawToken: string,
    options: {
      userAgent?: string
      ipAddress?: string
    } = {}
  ): Promise<
    | { ok: true; newRawToken: string; newSessionId: string; userId: string }
    | { ok: false; reason: 'invalid' | 'expired' | 'revoked' }
  > {
    const tokenHash = hashToken(rawToken)
    const session = await prisma.refreshSession.findFirst({
      where: { tokenHash }
    })

    if (!session) {
      return { ok: false, reason: 'invalid' }
    }

    if (session.status !== 'ACTIVE') {
      const reason: any = session.status.toLowerCase()
      return { ok: false, reason }
    }

    if (new Date() > session.expiresAt) {
      await prisma.refreshSession.update({
        where: { id: session.id },
        data: { status: 'EXPIRED' }
      })
      return { ok: false, reason: 'expired' }
    }

    await prisma.refreshSession.update({
      where: { id: session.id },
      data: { status: 'REVOKED', revokedAt: new Date() }
    })

    await prisma.refreshSession.updateMany({
      where: {
        tokenFamily: session.tokenFamily,
        id: { not: session.id },
        status: 'ACTIVE'
      },
      data: { status: 'REVOKED', revokedAt: new Date() }
    })

    const newRawToken = generateRawToken()
    const newTokenHash = hashToken(newRawToken)
    const newExpiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS)

    const newSession = await prisma.refreshSession.create({
      data: {
        userId: session.userId,
        tokenHash: newTokenHash,
        tokenFamily: session.tokenFamily,
        userAgent: options.userAgent ?? session.userAgent,
        ipAddress: options.ipAddress ?? session.ipAddress,
        deviceId: session.deviceId,
        deviceName: session.deviceName,
        expiresAt: newExpiresAt
      }
    })

    return {
      ok: true,
      newRawToken,
      newSessionId: newSession.id,
      userId: session.userId
    }
  }

  async getSessionByToken(
    rawToken: string
  ): Promise<{ id: string; userId: string; status: SessionStatus } | null> {
    const tokenHash = hashToken(rawToken)
    const session = await prisma.refreshSession.findFirst({
      where: { tokenHash },
      select: { id: true, userId: true, status: true }
    })
    return session
  }

  async getSessionsForUser(
    userId: string,
    options: { includeRevoked?: boolean } = {}
  ) {
    return prisma.refreshSession.findMany({
      where: {
        userId,
        ...(options.includeRevoked
          ? {}
          : { status: 'ACTIVE' })
      },
      orderBy: { createdAt: 'desc' }
    })
  }

  async revokeSession(sessionId: string): Promise<void> {
    await prisma.refreshSession.update({
      where: { id: sessionId },
      data: { status: 'REVOKED', revokedAt: new Date() }
    })
  }

  async revokeAllSessionsForUser(userId: string): Promise<void> {
    await prisma.refreshSession.updateMany({
      where: { userId, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: new Date() }
    })
  }

  async revokeSessionsByFamily(tokenFamily: string): Promise<void> {
    await prisma.refreshSession.updateMany({
      where: { tokenFamily, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: new Date() }
    })
  }
}

export const refreshSessionService = new RefreshSessionService()
