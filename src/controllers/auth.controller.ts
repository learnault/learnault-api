import crypto from 'crypto'
import { Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import prisma from '../config/database'
import { loginSchema, registerSchema, verifyEmailSchema, resendVerificationSchema, forgotPasswordSchema, resetPasswordSchema, refreshTokenSchema } from '../schemas/auth.schema'
import { UserRole } from '../types/user.types'
import { emailService } from '../services/email.service'
import { sessionService } from '../services/session.service'
import logger from '../utils/logger'

const VERIFICATION_TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000 // 24 hours
const PASSWORD_RESET_TOKEN_EXPIRY_MS = 30 * 60 * 1000 // 30 minutes
const RESEND_COOLDOWN_MS = 60 * 1000 // 1 minute
const RESEND_ACCOUNT_LIMIT = 5
const RESEND_ACCOUNT_WINDOW_MS = 24 * 60 * 60 * 1000 // 24 hours
const RESET_PASSWORD_COOLDOWN_MS = 60 * 1000 // 1 minute
const RESET_PASSWORD_ACCOUNT_LIMIT = 3
const RESET_PASSWORD_ACCOUNT_WINDOW_MS = 24 * 60 * 60 * 1000 // 24 hours

export const resendCooldowns = new Map<string, number>()
export const resendAccountCounts = new Map<string, { count: number; resetAt: number }>()
export const resetPasswordCooldowns = new Map<string, number>()
export const resetPasswordAccountCounts = new Map<string, { count: number; resetAt: number }>()

function generateVerificationToken(): { rawToken: string; tokenHash: string } {
    const rawToken = crypto.randomBytes(32).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')

    return { rawToken, tokenHash }
}

function buildVerificationEmail(to: string, rawToken: string): { subject: string; body: string } {
    const subject = 'Verify your email address'
    const body = `\
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:sans-serif;padding:24px">
  <h2>Verify your email</h2>
  <p>Use the link below to verify your email address:</p>
  <p><a href="${process.env.VERIFICATION_BASE_URL || 'http://localhost:3000/verify-email'}?token=${rawToken}">
    Verify email
  </a></p>
  <p>Or enter this token manually:</p>
  <pre style="background:#f5f5f5;padding:12px;font-size:14px">${rawToken}</pre>
  <p>This link expires in 24 hours.</p>
  <p>If you did not create this account, please ignore this email.</p>
</body>
</html>`

    return { subject, body }
}

function buildPasswordResetEmail(to: string, rawToken: string): { subject: string; body: string } {
    const subject = 'Reset your password'
    const body = `\
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:sans-serif;padding:24px">
  <h2>Reset your password</h2>
  <p>Use the link below to reset your password:</p>
  <p><a href="${process.env.PASSWORD_RESET_BASE_URL || 'http://localhost:3000/reset-password'}?token=${rawToken}">
    Reset password
  </a></p>
  <p>Or enter this token manually:</p>
  <pre style="background:#f5f5f5;padding:12px;font-size:14px">${rawToken}</pre>
  <p>This link expires in 30 minutes.</p>
  <p>If you did not request this, please ignore this email.</p>
</body>
</html>`

    return { subject, body }
}

export class AuthController {
    /**
     * @openapi
     * /auth/register:
     *   post:
     *     summary: Register a new user
     *     tags: [Auth]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/RegisterInput'
     *     responses:
     *       201:
     *         description: User registered successfully
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/AuthResponse'
     *       400:
     *         description: Validation failed
     *       409:
     *         description: User already exists
     *       500:
     *         description: Internal server error
     */
    async register(req: Request, res: Response): Promise<void> {
        try {
            const validation = registerSchema.safeParse(req.body)
            if (!validation.success) {
                res.status(400).json({
                    error: 'Validation failed',
                    details: validation.error.format()
                })

                return
            }

            const { email, password, username, role } = validation.data

            const existingUser = await prisma.user.findFirst({
                where: {
                    OR: [
                        { email },
                        { username }
                    ]
                }
            })

            if (existingUser) {
                res.status(409).json({ error: 'User with this email or username already exists' })

                return
            }

            const salt = await bcrypt.genSalt(10)
            const hashedPassword = await bcrypt.hash(password, salt)

            const user = await prisma.user.create({
                data: {
                    email,
                    username,
                    password: hashedPassword,
                    role: (role as any) || UserRole.LEARNER,
                }
            })

            // Issue verification token
            const { rawToken, tokenHash } = generateVerificationToken()
            const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_EXPIRY_MS)

            await prisma.verificationToken.create({
                data: {
                    userId: user.id,
                    tokenHash,
                    expiresAt,
                }
            })

            // Queue verification email via outbox
            const { subject, body } = buildVerificationEmail(email, rawToken)
            emailService.queueEmail(user.id, email, subject, body).catch(err =>
                logger.error('[Auth] Failed to queue verification email:', err)
            )

            const userAgent = req.headers['user-agent']
            const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
                || (req.headers['x-real-ip'] as string)
                || req.socket.remoteAddress
                || 'unknown'
            const { accessToken, refreshToken } = await sessionService.createSession(user.id, userAgent, ip)


            res.status(201).json({
                message: 'User registered successfully',
                accessToken,
                refreshToken,
                user: {
                    id: user.id,
                    email: user.email,
                    username: user.username,
                    role: user.role
                }
            })
        } catch (error) {
            console.error('Registration error:', error)
            res.status(500).json({ error: 'Internal server error during registration' })
        }
    }

    /**
     * @openapi
     * /auth/verify-email:
     *   post:
     *     summary: Verify email address with a token
     *     tags: [Auth]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/VerifyEmailInput'
     *     responses:
     *       200:
     *         description: Email verified successfully
     *       400:
     *         description: Invalid or malformed token
     *       410:
     *         description: Token expired or already used
     *       500:
     *         description: Internal server error
     */
    async verifyEmail(req: Request, res: Response): Promise<void> {
        try {
            const validation = verifyEmailSchema.safeParse(req.body)
            if (!validation.success) {
                res.status(400).json({ error: 'Invalid token' })


                return
            }

            const { token } = validation.data

            // Validate token format before hashing
            if (!/^[0-9a-f]{64}$/i.test(token)) {
                res.status(400).json({ error: 'Invalid token' })


                return
            }

            const tokenHash = crypto.createHash('sha256').update(token).digest('hex')

            const verificationToken = await prisma.verificationToken.findFirst({
                where: { tokenHash },
                include: { user: true },
            })

            if (!verificationToken) {
                res.status(400).json({ error: 'Invalid token' })


                return
            }

            if (verificationToken.status === 'USED') {
                res.status(200).json({ message: 'Email already verified' })


                return
            }

            if (verificationToken.status === 'REVOKED') {
                res.status(400).json({ error: 'Invalid token' })


                return
            }

            if (new Date() > verificationToken.expiresAt) {
                await prisma.verificationToken.update({
                    where: { id: verificationToken.id },
                    data: { status: 'REVOKED' },
                })
                res.status(400).json({ error: 'Token expired' })


                return
            }

            // Mark token as used and verify user
            await prisma.$transaction([
                prisma.verificationToken.update({
                    where: { id: verificationToken.id },
                    data: { status: 'USED' },
                }),
                prisma.user.update({
                    where: { id: verificationToken.userId },
                    data: { isVerified: true },
                }),
            ])

            logger.info(`[Auth] Email verified for user ${verificationToken.userId}`)


            res.status(200).json({ message: 'Email verified successfully' })
        } catch (error) {
            console.error('Email verification error:', error)
            res.status(500).json({ error: 'Internal server error during verification' })
        }
    }

    /**
     * @openapi
     * /auth/resend-verification:
     *   post:
     *     summary: Resend verification email
     *     tags: [Auth]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/ResendVerificationInput'
     *     responses:
     *       200:
     *         description: If the account exists, a verification email will be sent
     *       429:
     *         description: Too many requests
     *       500:
     *         description: Internal server error
     */
    async resendVerification(req: Request, res: Response): Promise<void> {
        try {
            const validation = resendVerificationSchema.safeParse(req.body)
            if (!validation.success) {
                // Neutral response regardless
                res.status(200).json({ message: 'If the account exists, a verification email has been sent.' })


                return
            }

            const { email } = validation.data

            // IP rate limit check
            const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
                || (req.headers['x-real-ip'] as string)
                || req.socket.remoteAddress
                || 'unknown'

            if (this.isRateLimited(`ip:${ip}`, RESEND_COOLDOWN_MS)) {
                res.status(429).json({ error: 'Too many requests. Please try again later.' })


                return
            }

            // Look up user (do not reveal existence)
            const user = await prisma.user.findUnique({ where: { email } })

            if (!user) {
                res.status(200).json({ message: 'If the account exists, a verification email has been sent.' })


                return
            }

            if (user.isVerified) {
                res.status(200).json({ message: 'If the account exists, a verification email has been sent.' })


                return
            }

            // Account rate limit check
            if (this.isAccountLimited(user.id)) {
                res.status(429).json({ error: 'Too many requests. Please try again later.' })


                return
            }

            // Cooldown per user
            if (this.isRateLimited(`user:${user.id}`, RESEND_COOLDOWN_MS)) {
                res.status(429).json({ error: 'Too many requests. Please try again later.' })


                return
            }

            // Revoke existing pending tokens
            await prisma.verificationToken.updateMany({
                where: { userId: user.id, status: 'PENDING' },
                data: { status: 'REVOKED' },
            })

            // Create new token
            const { rawToken, tokenHash } = generateVerificationToken()
            const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_EXPIRY_MS)

            await prisma.verificationToken.create({
                data: {
                    userId: user.id,
                    tokenHash,
                    expiresAt,
                }
            })

            // Queue email
            const { subject, body } = buildVerificationEmail(email, rawToken)
            emailService.queueEmail(user.id, email, subject, body).catch(err =>
                logger.error('[Auth] Failed to queue verification email:', err)
            )

            this.recordAccountRequest(user.id)


            res.status(200).json({ message: 'If the account exists, a verification email has been sent.' })
        } catch (error) {
            console.error('Resend verification error:', error)
            res.status(500).json({ error: 'Internal server error' })
        }
    }

    /**
     * @openapi
     * /auth/login:
     *   post:
     *     summary: Login a user
     *     tags: [Auth]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/LoginInput'
     *     responses:
     *       200:
     *         description: Login successful
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/AuthResponse'
     *       400:
     *         description: Validation failed
     *       401:
     *         description: Invalid credentials
     *       500:
     *         description: Internal server error
     */
    async login(req: Request, res: Response): Promise<void> {
        try {
            const validation = loginSchema.safeParse(req.body)
            if (!validation.success) {
                res.status(400).json({
                    error: 'Validation failed',
                    details: validation.error.format()
                })


                return
            }

            const { email, password } = validation.data

            const user = await prisma.user.findUnique({
                where: { email }
            })

            if (!user) {
                res.status(401).json({ error: 'Invalid credentials' })


                return
            }

            const isMatch = await bcrypt.compare(password, user.password)
            if (!isMatch) {
                res.status(401).json({ error: 'Invalid credentials' })


                return
            }

            await prisma.user.update({
                where: { id: user.id },
                data: { lastLoginAt: new Date() }
            })

            const userAgent = req.headers['user-agent']
            const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
                || (req.headers['x-real-ip'] as string)
                || req.socket.remoteAddress
                || 'unknown'

            const { accessToken, refreshToken } = await sessionService.createSession(user.id, userAgent, ip)


            res.status(200).json({
                message: 'Login successful',
                accessToken,
                refreshToken,
                user: {
                    id: user.id,
                    email: user.email,
                    username: user.username,
                    role: user.role
                }
            })
        } catch (error) {
            console.error('Login error:', error)
            res.status(500).json({ error: 'Internal server error during login' })
        }
    }

    /**
     * @openapi
     * /auth/refresh:
     *   post:
     *     summary: Refresh access token using refresh token
     *     tags: [Auth]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/RefreshTokenInput'
     *     responses:
     *       200:
     *         description: Tokens refreshed successfully
     *       400:
     *         description: Validation failed
     *       401:
     *         description: Invalid refresh token
     *       500:
     *         description: Internal server error
     */
    async refresh(req: Request, res: Response): Promise<void> {
        try {
            const validation = refreshTokenSchema.safeParse(req.body)
            if (!validation.success) {
                res.status(400).json({
                    error: 'Validation failed',
                    details: validation.error.format()
                })


                return
            }

            const { refreshToken } = validation.data

            const userAgent = req.headers['user-agent']
            const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
                || (req.headers['x-real-ip'] as string)
                || req.socket.remoteAddress
                || 'unknown'

            const { accessToken, refreshToken: newRefreshToken } = await sessionService.refreshSession(refreshToken, userAgent, ip)


            res.status(200).json({
                message: 'Tokens refreshed successfully',
                accessToken,
                refreshToken: newRefreshToken
            })
        } catch (error) {
            console.error('Refresh error:', error)
            if (error instanceof Error && (error.message === 'Invalid refresh token' || error.message === 'Token reuse detected, family revoked' || error.message === 'Refresh token expired')) {
                res.status(401).json({ error: error.message })
            } else {
                res.status(500).json({ error: 'Internal server error during refresh' })
            }
        }
    }

    /**
     * @openapi
     * /auth/logout:
     *   post:
     *     summary: Logout current session using refresh token
     *     tags: [Auth]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/RefreshTokenInput'
     *     responses:
     *       200:
     *         description: Logged out successfully
     *       400:
     *         description: Validation failed
     *       500:
     *         description: Internal server error
     */
    async logout(req: Request, res: Response): Promise<void> {
        try {
            const validation = refreshTokenSchema.safeParse(req.body)
            if (!validation.success) {
                res.status(400).json({
                    error: 'Validation failed',
                    details: validation.error.format()
                })


                return
            }

            const { refreshToken } = validation.data
            await sessionService.revokeSession(refreshToken)


            res.status(200).json({ message: 'Logged out successfully' })
        } catch (error) {
            console.error('Logout error:', error)
            res.status(500).json({ error: 'Internal server error during logout' })
        }
    }

    /**
     * @openapi
     * /auth/logout-all:
     *   post:
     *     summary: Logout all sessions for current user
     *     tags: [Auth]
     *     responses:
     *       200:
     *         description: All sessions logged out successfully
     *       401:
     *         description: Unauthorized
     *       500:
     *         description: Internal server error
     */
    async logoutAll(req: Request, res: Response): Promise<void> {
        try {
            if (!req.user) {
                res.status(401).json({ error: 'Unauthorized' })

                return
            }

            await sessionService.revokeAllSessions(req.user.id)


            res.status(200).json({ message: 'All sessions logged out successfully' })
        } catch (error) {
            console.error('Logout all error:', error)
            res.status(500).json({ error: 'Internal server error during logout' })
        }
    }

    /**
     * @openapi
     * /auth/forgot-password:
     *   post:
     *     summary: Request a password reset email
     *     tags: [Auth]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/ForgotPasswordInput'
     *     responses:
     *       200:
     *         description: If the account exists, a password reset email will be sent
     *       429:
     *         description: Too many requests
     *       500:
     *         description: Internal server error
     */
    async forgotPassword(req: Request, res: Response): Promise<void> {
        try {
            const validation = forgotPasswordSchema.safeParse(req.body)
            if (!validation.success) {
                res.status(200).json({ message: 'If the account exists, a password reset email has been sent.' })


                return
            }

            const { email } = validation.data

            const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
                || (req.headers['x-real-ip'] as string)
                || req.socket.remoteAddress
                || 'unknown'

            if (this.isRateLimited(`reset:ip:${ip}`, RESET_PASSWORD_COOLDOWN_MS)) {
                res.status(429).json({ error: 'Too many requests. Please try again later.' })


                return
            }

            const user = await prisma.user.findUnique({ where: { email } })
            if (!user) {
                res.status(200).json({ message: 'If the account exists, a password reset email has been sent.' })


                return
            }

            if (this.isResetPasswordAccountLimited(user.id)) {
                res.status(429).json({ error: 'Too many requests. Please try again later.' })


                return
            }

            if (this.isRateLimited(`reset:user:${user.id}`, RESET_PASSWORD_COOLDOWN_MS)) {
                res.status(429).json({ error: 'Too many requests. Please try again later.' })


                return
            }

            await prisma.verificationToken.updateMany({
                where: { userId: user.id, status: 'PENDING', type: 'PASSWORD_RESET' },
                data: { status: 'REVOKED' },
            })

            const { rawToken, tokenHash } = generateVerificationToken()
            const expiresAt = new Date(Date.now() + PASSWORD_RESET_TOKEN_EXPIRY_MS)

            await prisma.verificationToken.create({
                data: {
                    userId: user.id,
                    tokenHash,
                    type: 'PASSWORD_RESET',
                    expiresAt,
                },
            })

            const { subject, body } = buildPasswordResetEmail(email, rawToken)
            emailService.queueEmail(user.id, email, subject, body, 'PASSWORD_RESET').catch(err =>
                logger.error('[Auth] Failed to queue password reset email:', err)
            )

            this.recordResetPasswordAccountRequest(user.id)


            res.status(200).json({ message: 'If the account exists, a password reset email has been sent.' })
        } catch (error) {
            console.error('Forgot password error:', error)
            res.status(500).json({ error: 'Internal server error' })
        }
    }

    /**
     * @openapi
     * /auth/reset-password:
     *   post:
     *     summary: Reset password with a token
     *     tags: [Auth]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/ResetPasswordInput'
     *     responses:
     *       200:
     *         description: Password reset successful
     *       400:
     *         description: Invalid token or password
     *       500:
     *         description: Internal server error
     */
    async resetPassword(req: Request, res: Response): Promise<void> {
        try {
            const validation = resetPasswordSchema.safeParse(req.body)
            if (!validation.success) {
                res.status(400).json({ error: 'Invalid token or password' })


                return
            }

            const { token, newPassword } = validation.data

            if (!/^[0-9a-f]{64}$/i.test(token)) {
                res.status(400).json({ error: 'Invalid token' })


                return
            }

            const tokenHash = crypto.createHash('sha256').update(token).digest('hex')

            const resetToken = await prisma.verificationToken.findFirst({
                where: { tokenHash, type: 'PASSWORD_RESET' },
                include: { user: true },
            })

            if (!resetToken) {
                res.status(400).json({ error: 'Invalid token' })


                return
            }

            if (resetToken.status === 'USED' || resetToken.status === 'REVOKED') {
                res.status(400).json({ error: 'Invalid token' })


                return
            }

            if (new Date() > resetToken.expiresAt) {
                await prisma.verificationToken.update({
                    where: { id: resetToken.id },
                    data: { status: 'REVOKED' },
                })
                res.status(400).json({ error: 'Token expired' })


                return
            }

            const salt = await bcrypt.genSalt(10)
            const hashedPassword = await bcrypt.hash(newPassword, salt)

            const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
                || (req.headers['x-real-ip'] as string)
                || req.socket.remoteAddress
                || 'unknown'
            const userAgent = req.headers['user-agent'] || 'unknown'

            await prisma.$transaction([
                prisma.verificationToken.update({
                    where: { id: resetToken.id },
                    data: { status: 'USED' },
                }),
                prisma.user.update({
                    where: { id: resetToken.userId },
                    data: { password: hashedPassword },
                }),
                prisma.verificationToken.updateMany({
                    where: { userId: resetToken.userId, status: 'PENDING' },
                    data: { status: 'REVOKED' },
                }),
                prisma.session.updateMany({
                    where: { userId: resetToken.userId, isRevoked: false },
                    data: { isRevoked: true, revokedAt: new Date() },
                }),
                prisma.auditLog.create({
                    data: {
                        userId: resetToken.userId,
                        action: 'PASSWORD_RESET',
                        ipAddress: ip,
                        userAgent: userAgent,
                        metadata: JSON.stringify({}),
                    },
                }),
            ])

            logger.info(`[Auth] Password reset for user ${resetToken.userId}`)

            res.status(200).json({ message: 'Password reset successful' })
        } catch (error) {
            console.error('Reset password error:', error)
            res.status(500).json({ error: 'Internal server error' })
        }
    }

    private isRateLimited(key: string, windowMs: number): boolean {
        const now = Date.now()
        const resetTime = resendCooldowns.get(key)
        if (resetTime && resetTime > now) {
            return true
        }
        resendCooldowns.set(key, now + windowMs)

        return false
    }

    private isAccountLimited(userId: string): boolean {
        const now = Date.now()
        const record = resendAccountCounts.get(userId)

        if (!record || record.resetAt < now) {
            return false
        }

        return record.count >= RESEND_ACCOUNT_LIMIT
    }

    private recordAccountRequest(userId: string): void {
        const now = Date.now()
        const record = resendAccountCounts.get(userId)

        if (!record || record.resetAt < now) {
            resendAccountCounts.set(userId, { count: 1, resetAt: now + RESEND_ACCOUNT_WINDOW_MS })
        } else {
            record.count++
        }
    }

    private isResetPasswordAccountLimited(userId: string): boolean {
        const now = Date.now()
        const record = resetPasswordAccountCounts.get(userId)

        if (!record || record.resetAt < now) {
            return false
        }

        return record.count >= RESET_PASSWORD_ACCOUNT_LIMIT
    }

    private recordResetPasswordAccountRequest(userId: string): void {
        const now = Date.now()
        const record = resetPasswordAccountCounts.get(userId)

        if (!record || record.resetAt < now) {
            resetPasswordAccountCounts.set(userId, { count: 1, resetAt: now + RESET_PASSWORD_ACCOUNT_WINDOW_MS })
        } else {
            record.count++
        }
    }
}
