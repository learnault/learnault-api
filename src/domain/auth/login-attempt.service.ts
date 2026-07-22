import prisma from '../../config/database'
import type { LoginAttemptStatus } from '@prisma/client'

export const LOGIN_LOCKOUT_THRESHOLD = 5
export const LOGIN_LOCKOUT_WINDOW_MS = 15 * 60 * 1000

export class LoginAttemptService {
  async recordAttempt(
    userId: string,
    email: string,
    status: LoginAttemptStatus,
    options: { ipAddress?: string; userAgent?: string; failureReason?: string } = {}
  ): Promise<void> {
    await prisma.loginAttempt.create({
      data: {
        userId,
        email,
        status,
        ipAddress: options.ipAddress,
        userAgent: options.userAgent,
        failureReason: options.failureReason
      }
    })
  }

  async getRecentFailedAttempts(
    email: string,
    windowMs: number = LOGIN_LOCKOUT_WINDOW_MS
  ): Promise<number> {
    const since = new Date(Date.now() - windowMs)
    return prisma.loginAttempt.count({
      where: {
        email,
        status: 'FAILURE',
        createdAt: { gte: since }
      }
    })
  }

  async isLockedOut(
    email: string,
    threshold: number = LOGIN_LOCKOUT_THRESHOLD,
    windowMs: number = LOGIN_LOCKOUT_WINDOW_MS
  ): Promise<boolean> {
    const failedCount = await this.getRecentFailedAttempts(email, windowMs)
    return failedCount >= threshold
  }
}

export const loginAttemptService = new LoginAttemptService()
