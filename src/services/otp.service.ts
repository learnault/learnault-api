import crypto from 'crypto'
import prisma from '../config/database'
import logger from '../utils/logger'
import { getSmsProvider } from './sms/sms-provider.factory'

export const OTP_CODE_LENGTH = 6
export const OTP_EXPIRY_MS = 5 * 60 * 1000
export const OTP_MAX_ATTEMPTS = 5

export type OtpPurpose = 'LOGIN' | 'PHONE_VERIFICATION'

const E164_PATTERN = /^\+[1-9]\d{7,14}$/

export function normalizePhone(input: string): string | null {
  const trimmed = input.trim()

  return E164_PATTERN.test(trimmed) ? trimmed : null
}

function generateCode(): string {
  return crypto
    .randomInt(0, 10 ** OTP_CODE_LENGTH)
    .toString()
    .padStart(OTP_CODE_LENGTH, '0')
}

function hashCode(code: string, phone: string): string {
  return crypto.createHash('sha256').update(`${phone}:${code}`).digest('hex')
}

export type OtpVerifyFailureReason =
  'not_found' | 'expired' | 'locked' | 'mismatch'
export type OtpVerifyResult =
  { ok: true; userId: string } | { ok: false; reason: OtpVerifyFailureReason }

export class OtpService {
  async requestChallenge(
    phone: string,
    purpose: OtpPurpose,
    userId: string,
    context: { ip?: string; deviceId?: string } = {},
  ): Promise<void> {
    await prisma.otpChallenge.updateMany({
      where: { userId, purpose, status: 'PENDING' },
      data: { status: 'REVOKED' },
    })

    const code = generateCode()
    const codeHash = hashCode(code, phone)
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS)

    await prisma.otpChallenge.create({
      data: {
        userId,
        phone,
        purpose,
        codeHash,
        expiresAt,
        requestIp: context.ip,
        deviceId: context.deviceId,
      },
    })

    const provider = getSmsProvider()
    const result = await provider.send(
      phone,
      `Your Learnault verification code is ${code}. It expires in 5 minutes.`,
    )

    if (!result.success) {
      logger.error(
        `[OtpService] SMS send failed for phone=${phone}: ${result.error}`,
      )
    }
  }

  async verifyChallenge(
    phone: string,
    code: string,
    purpose: OtpPurpose,
    expectedUserId?: string,
  ): Promise<OtpVerifyResult> {
    const challenge = await prisma.otpChallenge.findFirst({
      where: { phone, purpose, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    })

    if (!challenge || (expectedUserId && challenge.userId !== expectedUserId)) {
      return { ok: false, reason: 'not_found' }
    }

    if (new Date() > challenge.expiresAt) {
      await prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { status: 'EXPIRED' },
      })

      return { ok: false, reason: 'expired' }
    }

    if (challenge.attempts >= challenge.maxAttempts) {
      await prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { status: 'LOCKED' },
      })

      return { ok: false, reason: 'locked' }
    }

    const codeHash = hashCode(code, phone)

    if (codeHash !== challenge.codeHash) {
      const attempts = challenge.attempts + 1
      const lockedOut = attempts >= challenge.maxAttempts

      await prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { attempts, ...(lockedOut ? { status: 'LOCKED' } : {}) },
      })

      return { ok: false, reason: lockedOut ? 'locked' : 'mismatch' }
    }

    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { status: 'CONSUMED', consumedAt: new Date() },
    })

    return { ok: true, userId: challenge.userId }
  }
}

export const otpService = new OtpService()
