import crypto from 'crypto'
import prisma from '../../config/database'
import type { TokenPurpose, TokenStatus } from '@prisma/client'

export const TOKEN_LENGTH = 32
export const EMAIL_VERIFICATION_EXPIRY_MS = 24 * 60 * 60 * 1000
export const PASSWORD_RESET_EXPIRY_MS = 60 * 60 * 1000

export function generateRawToken(): string {
  return crypto.randomBytes(TOKEN_LENGTH).toString('hex')
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export class TokenService {
  async createToken(
    userId: string,
    purpose: TokenPurpose
  ): Promise<{ rawToken: string; tokenId: string }> {
    await prisma.verificationToken.updateMany({
      where: { userId, purpose, status: 'PENDING' },
      data: { status: 'REVOKED' }
    })

    const rawToken = generateRawToken()
    const tokenHash = hashToken(rawToken)
    const now = Date.now()
    const expiryMs =
      purpose === 'EMAIL_VERIFICATION'
        ? EMAIL_VERIFICATION_EXPIRY_MS
        : PASSWORD_RESET_EXPIRY_MS

    const token = await prisma.verificationToken.create({
      data: {
        userId,
        tokenHash,
        purpose,
        expiresAt: new Date(now + expiryMs)
      }
    })

    return { rawToken, tokenId: token.id }
  }

  async verifyToken(
    rawToken: string,
    purpose: TokenPurpose
  ): Promise<
    | { ok: true; userId: string; tokenId: string }
    | { ok: false; reason: 'invalid' | 'expired' | 'revoked' | 'used' }
  > {
    const tokenHash = hashToken(rawToken)
    const token = await prisma.verificationToken.findFirst({
      where: { tokenHash, purpose }
    })

    if (!token) {
      return { ok: false, reason: 'invalid' }
    }

    if (token.status !== 'PENDING') {
      const reason: any = token.status.toLowerCase()
      return { ok: false, reason }
    }

    if (new Date() > token.expiresAt) {
      await prisma.verificationToken.update({
        where: { id: token.id },
        data: { status: 'EXPIRED' }
      })
      return { ok: false, reason: 'expired' }
    }

    return { ok: true, userId: token.userId, tokenId: token.id }
  }

  async markTokenAsUsed(tokenId: string): Promise<void> {
    await prisma.verificationToken.update({
      where: { id: tokenId },
      data: { status: 'USED', usedAt: new Date() }
    })
  }

  async revokeToken(tokenId: string): Promise<void> {
    await prisma.verificationToken.update({
      where: { id: tokenId },
      data: { status: 'REVOKED' }
    })
  }

  async revokeAllPendingTokens(userId: string, purpose: TokenPurpose): Promise<void> {
    await prisma.verificationToken.updateMany({
      where: { userId, purpose, status: 'PENDING' },
      data: { status: 'REVOKED' }
    })
  }
}

export const tokenService = new TokenService()
