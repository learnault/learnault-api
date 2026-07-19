import crypto from 'crypto'
import prisma from '../config/database'
import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'your-default-secret'
const ACCESS_TOKEN_EXPIRES_IN = process.env.ACCESS_TOKEN_EXPIRES_IN || '15m'
const REFRESH_TOKEN_EXPIRES_IN = process.env.REFRESH_TOKEN_EXPIRES_IN || '7d'

function generateRefreshToken(): string {
    return crypto.randomBytes(64).toString('hex')
}

function generateAccessToken(userId: string, role: string): string {
    return jwt.sign(
        { id: userId, role },
        JWT_SECRET,
        { expiresIn: ACCESS_TOKEN_EXPIRES_IN }
    )
}

function getRefreshTokenExpiry(): Date {
    const ms = parseDurationToMs(REFRESH_TOKEN_EXPIRES_IN)
    return new Date(Date.now() + ms)
}

function parseDurationToMs(duration: string): number {
    const unit = duration.slice(-1)
    const value = parseInt(duration.slice(0, -1), 10)
    switch (unit) {
        case 's': return value * 1000
        case 'm': return value * 60 * 1000
        case 'h': return value * 60 * 60 * 1000
        case 'd': return value * 24 * 60 * 60 * 1000
        default: return 7 * 24 * 60 * 60 * 1000
    }
}

export class SessionService {
    async createSession(userId: string, userAgent?: string, ipAddress?: string): Promise<{ accessToken: string; refreshToken: string }> {
        const refreshToken = generateRefreshToken()
        const familyId = crypto.randomUUID()
        const expiresAt = getRefreshTokenExpiry()

        await prisma.session.create({
            data: {
                userId,
                refreshToken,
                familyId,
                userAgent,
                ipAddress,
                expiresAt,
            }
        })

        const user = await prisma.user.findUnique({ where: { id: userId } })
        if (!user) {
            throw new Error('User not found')
        }


        return {
            accessToken: generateAccessToken(user.id, user.role),
            refreshToken
        }
    }

    async refreshSession(oldRefreshToken: string, userAgent?: string, ipAddress?: string): Promise<{ accessToken: string; refreshToken: string }> {
        const existingSession = await prisma.session.findUnique({
            where: { refreshToken: oldRefreshToken }
        })

        if (!existingSession) {
            throw new Error('Invalid refresh token')
        }

        if (existingSession.isRevoked) {
            await prisma.session.updateMany({
                where: { familyId: existingSession.familyId, isRevoked: false },
                data: { isRevoked: true, revokedAt: new Date() }
            })
            throw new Error('Token reuse detected, family revoked')
        }

        if (new Date() > existingSession.expiresAt) {
            throw new Error('Refresh token expired')
        }

        const newRefreshToken = generateRefreshToken()
        const expiresAt = getRefreshTokenExpiry()

        const [, newSession] = await prisma.$transaction([
            prisma.session.update({
                where: { id: existingSession.id },
                data: { isRevoked: true, revokedAt: new Date() }
            }),
            prisma.session.create({
                data: {
                    userId: existingSession.userId,
                    refreshToken: newRefreshToken,
                    familyId: existingSession.familyId,
                    parentId: existingSession.id,
                    userAgent,
                    ipAddress,
                    expiresAt
                }
            })
        ])

        const user = await prisma.user.findUnique({ where: { id: existingSession.userId } })
        if (!user) {
            throw new Error('User not found')
        }


        return {
            accessToken: generateAccessToken(user.id, user.role),
            refreshToken: newRefreshToken
        }
    }

    async revokeSession(refreshToken: string): Promise<void> {
        const session = await prisma.session.findUnique({
            where: { refreshToken }
        })

        if (session) {
            await prisma.session.update({
                where: { id: session.id },
                data: { isRevoked: true, revokedAt: new Date() }
            })
        }

    }

    async revokeAllSessions(userId: string): Promise<void> {
        await prisma.session.updateMany({
            where: { userId, isRevoked: false },
            data: { isRevoked: true, revokedAt: new Date() }
        })

    }

    async revokeSessionFamily(familyId: string): Promise<void> {
        await prisma.session.updateMany({
            where: { familyId, isRevoked: false },
            data: { isRevoked: true, revokedAt: new Date() }
        })

    }

    async getValidSessionByRefreshToken(refreshToken: string) {

        return prisma.session.findFirst({
            where: {
                refreshToken,
                isRevoked: false,
                expiresAt: { gt: new Date() }
            },
            include: { user: true }
        })
    }
}

export const sessionService = new SessionService()
