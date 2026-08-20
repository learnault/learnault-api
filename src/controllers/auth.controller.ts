import crypto from 'crypto'
import { Request, Response } from 'express'
import prisma from '../config/database'
import { issueAccessToken } from '../config/jwt'
import { loginSchema, registerSchema, verifyEmailSchema, resendVerificationSchema, forgotPasswordSchema, resetPasswordSchema, otpRequestSchema, otpVerifySchema } from '../schemas/auth.schema'
import { UserRole } from '../types/user.types'
import { emailService } from '../services/email.service'
import { otpService, normalizePhone, OtpPurpose } from '../services/otp.service'
import { comparePassword, hashPassword, needsRehash } from '../utils/password'
import logger from '../utils/logger'

const VERIFICATION_TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000 // 24 hours
const PASSWORD_RESET_TOKEN_EXPIRY_MS = 30 * 60 * 1000 // 30 minutes
const RESEND_COOLDOWN_MS = 60 * 1000 // 1 minute
const RESEND_ACCOUNT_LIMIT = 5
const RESEND_ACCOUNT_WINDOW_MS = 24 * 60 * 60 * 1000 // 24 hours
const RESET_PASSWORD_COOLDOWN_MS = 60 * 1000 // 1 minute
const RESET_PASSWORD_ACCOUNT_LIMIT = 3
const RESET_PASSWORD_ACCOUNT_WINDOW_MS = 24 * 60 * 60 * 1000 // 24 hours
const OTP_PHONE_COOLDOWN_MS = 60 * 1000 // 1 minute between requests to the same phone
const OTP_PHONE_LIMIT = 5
const OTP_PHONE_WINDOW_MS = 60 * 60 * 1000 // 1 hour
const OTP_DEVICE_LIMIT = 10
const OTP_DEVICE_WINDOW_MS = 60 * 60 * 1000 // 1 hour

export const resendCooldowns = new Map<string, number>()
export const resendAccountCounts = new Map<string, { count: number; resetAt: number }>()
export const resetPasswordCooldowns = new Map<string, number>()
export const resetPasswordAccountCounts = new Map<string, { count: number; resetAt: number }>()
export const otpPhoneCounts = new Map<string, { count: number; resetAt: number }>()
export const otpDeviceCounts = new Map<string, { count: number; resetAt: number }>()

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
     *     operationId: authRegister
     *     summary: Register a new user
     *     tags: [Auth]
     *     security: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/RegisterInput'
     *     responses:
     *       201:
     *         description: User registered successfully; a verification email is queued.
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/AuthResponse'
     *       400:
     *         description: Validation failed
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     *       409:
     *         description: Email or username already taken
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     *       500:
     *         description: Internal server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
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

            const hashedPassword = await hashPassword(password)

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

            const token = this.generateToken(user.id, user.role)

            res.status(201).json({
                message: 'User registered successfully',
                token,
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
     *     operationId: authVerifyEmail
     *     summary: Verify email address with a token
     *     tags: [Auth]
     *     security: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/VerifyEmailInput'
     *     responses:
     *       200:
     *         description: Email verified (or already verified)
     *       400:
     *         description: Invalid or expired token
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     *       500:
     *         description: Internal server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
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
     *     operationId: authResendVerification
     *     summary: Resend verification email
     *     description: >
     *       Always returns 200 with a neutral message to avoid leaking user existence.
     *       Rate-limited by IP (1 req/min) and per account (5 req/24 h).
     *     tags: [Auth]
     *     security: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/ResendVerificationInput'
     *     responses:
     *       200:
     *         description: If the account exists, a verification email will be sent.
     *       429:
     *         description: Too many requests — IP or account rate limit reached.
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     *       500:
     *         description: Internal server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
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
     *     operationId: authLogin
     *     summary: Log in and receive a JWT
     *     description: Rate-limited to 10 requests per 15 minutes per IP.
     *     tags: [Auth]
     *     security: []
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
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     *       401:
     *         description: Invalid credentials
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     *       500:
     *         description: Internal server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
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

            const isMatch = await comparePassword(password, user.password)
            if (!isMatch) {
                res.status(401).json({ error: 'Invalid credentials' })

                return
            }

            const statusError = await this.getAccountStatusError(user)
            if (statusError) {
                res.status(statusError.statusCode).json(statusError.body)

                return
            }

            // Transparently upgrade the stored hash if it was made under a
            // weaker cost factor than the current configuration.
            const passwordUpdate = needsRehash(user.password)
                ? { password: await hashPassword(password) }
                : {}

            await prisma.user.update({
                where: { id: user.id },
                data: { ...passwordUpdate, lastLoginAt: new Date() }
            })

            const token = this.generateToken(user.id, user.role)

            res.status(200).json({
                message: 'Login successful',
                token,
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
     * /auth/logout:
     *   post:
     *     operationId: authLogout
     *     summary: Log out (stateless — client must discard the token)
     *     description: >
     *       The server has no session state; this endpoint simply returns a
     *       reminder to clear the token client-side.
     *     tags: [Auth]
     *     security: []
     *     responses:
     *       200:
     *         description: Logged out successfully.
     */
    async logout(req: Request, res: Response): Promise<void> {
        res.status(200).json({ message: 'Logged out successfully. Please clear your token client-side.' })
    }

    /**
     * @openapi
     * /auth/forgot-password:
     *   post:
     *     operationId: authForgotPassword
     *     summary: Request a password-reset email
     *     description: >
     *       Always returns 200 to avoid leaking user existence.
     *       Token expires in 30 minutes. Rate-limited by IP and per account.
     *     tags: [Auth]
     *     security: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/ForgotPasswordInput'
     *     responses:
     *       200:
     *         description: If the account exists, a password reset email will be sent.
     *       429:
     *         description: Too many requests.
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     *       500:
     *         description: Internal server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
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
     *     operationId: authResetPassword
     *     summary: Reset password using a token from the reset email
     *     description: >
     *       On success, all existing sessions are revoked and all pending
     *       verification tokens are cancelled.
     *     tags: [Auth]
     *     security: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/ResetPasswordInput'
     *     responses:
     *       200:
     *         description: Password reset successful.
     *       400:
     *         description: Invalid, expired, or already-used token; or weak password.
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     *       500:
     *         description: Internal server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
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

            const hashedPassword = await hashPassword(newPassword)

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

    /**
     * @openapi
     * /auth/otp/request:
     *   post:
     *     operationId: authOtpRequest
     *     summary: Request a phone OTP code (login or phone verification)
     *     description: >
     *       Without a Bearer token, requests a LOGIN code for a phone number
     *       already verified on some account. Always returns 200 with the
     *       same message regardless of whether the number is registered, to
     *       avoid leaking phone existence.
     *
     *       With a Bearer token, requests a PHONE_VERIFICATION code to attach
     *       that phone number to the caller's own account.
     *
     *       Rate-limited by IP, phone (1/min, 5/hour), and, if a `deviceId`
     *       is supplied, by device (10/hour).
     *     tags: [Auth]
     *     security: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/OtpRequestInput'
     *     responses:
     *       200:
     *         description: A code has been sent, or the request was silently ignored (LOGIN, unregistered/unverified phone).
     *       400:
     *         description: Validation failed or phone number is not in E.164 format.
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     *       409:
     *         description: Phone number is already verified on a different account.
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     *       429:
     *         description: Too many requests — IP, phone, or device rate limit reached.
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     *       500:
     *         description: Internal server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     */
    async requestOtp(req: Request, res: Response): Promise<void> {
        try {
            const validation = otpRequestSchema.safeParse(req.body)
            if (!validation.success) {
                res.status(400).json({
                    error: 'Validation failed',
                    details: validation.error.format()
                })

                return
            }

            const { phone, deviceId } = validation.data
            const normalizedPhone = normalizePhone(phone)

            if (!normalizedPhone) {
                res.status(400).json({ error: 'Phone number must be in E.164 format, e.g. +2348012345678' })

                return
            }

            if (deviceId && this.isDeviceOtpLimited(deviceId)) {
                res.status(429).json({ error: 'Too many requests. Please try again later.' })

                return
            }

            const authenticatedUserId = req.user?.id
            const purpose: OtpPurpose = authenticatedUserId ? 'PHONE_VERIFICATION' : 'LOGIN'

            if (this.isRateLimited(`otp:phone:${purpose}:${normalizedPhone}`, OTP_PHONE_COOLDOWN_MS)
                || this.isPhoneOtpLimited(normalizedPhone, purpose)) {
                res.status(429).json({ error: 'Too many requests. Please try again later.' })

                return
            }

            let targetUserId: string

            if (authenticatedUserId) {
                const conflict = await prisma.user.findFirst({
                    where: {
                        phone: normalizedPhone,
                        phoneVerifiedAt: { not: null },
                        NOT: { id: authenticatedUserId },
                    },
                })

                if (conflict) {
                    res.status(409).json({ error: 'Phone number is already verified on another account' })

                    return
                }

                targetUserId = authenticatedUserId
            } else {
                const user = await prisma.user.findUnique({ where: { phone: normalizedPhone } })

                if (!user || !user.phoneVerifiedAt || user.status !== 'ACTIVE') {
                    res.status(200).json({ message: 'If this phone number is registered, a verification code has been sent.' })

                    return
                }

                targetUserId = user.id
            }

            this.recordPhoneOtpRequest(normalizedPhone, purpose)
            if (deviceId) {
                this.recordDeviceOtpRequest(deviceId)
            }

            const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
                || (req.headers['x-real-ip'] as string)
                || req.socket.remoteAddress
                || 'unknown'

            await otpService.requestChallenge(normalizedPhone, purpose, targetUserId, { ip, deviceId })

            res.status(200).json(
                purpose === 'PHONE_VERIFICATION'
                    ? { message: 'Verification code sent.' }
                    : { message: 'If this phone number is registered, a verification code has been sent.' }
            )
        } catch (error) {
            console.error('OTP request error:', error)
            res.status(500).json({ error: 'Internal server error' })
        }
    }

    /**
     * @openapi
     * /auth/otp/verify:
     *   post:
     *     operationId: authOtpVerify
     *     summary: Verify a phone OTP code (completes login or phone verification)
     *     description: >
     *       Without a Bearer token, verifies a LOGIN code and returns a JWT,
     *       identical in shape to POST /auth/login. With a Bearer token,
     *       verifies a PHONE_VERIFICATION code and marks the phone verified
     *       on the caller's account.
     *
     *       Codes are single-use, expire after 5 minutes, and the challenge
     *       locks after 5 wrong attempts (request a new code to retry).
     *     tags: [Auth]
     *     security: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/OtpVerifyInput'
     *     responses:
     *       200:
     *         description: Verified — login response (LOGIN) or confirmation message (PHONE_VERIFICATION).
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/AuthResponse'
     *       400:
     *         description: Validation failed, malformed phone, or invalid/expired code.
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     *       401:
     *         description: Invalid credentials (tombstoned account; LOGIN purpose only).
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     *       403:
     *         description: Account is deactivated or pending deletion (LOGIN purpose only).
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/AccountStatusError'
     *       429:
     *         description: Too many wrong attempts — the challenge is locked; request a new code.
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     *       500:
     *         description: Internal server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     */
    async verifyOtp(req: Request, res: Response): Promise<void> {
        try {
            const validation = otpVerifySchema.safeParse(req.body)
            if (!validation.success) {
                res.status(400).json({
                    error: 'Validation failed',
                    details: validation.error.format()
                })

                return
            }

            const { phone, code } = validation.data
            const normalizedPhone = normalizePhone(phone)

            if (!normalizedPhone) {
                res.status(400).json({ error: 'Invalid or expired code' })

                return
            }

            const authenticatedUserId = req.user?.id
            const purpose: OtpPurpose = authenticatedUserId ? 'PHONE_VERIFICATION' : 'LOGIN'

            const result = await otpService.verifyChallenge(normalizedPhone, code, purpose, authenticatedUserId)

            if (!result.ok) {
                if (result.reason === 'locked') {
                    res.status(429).json({ error: 'Too many attempts. Please request a new code.' })

                    return
                }

                res.status(400).json({ error: 'Invalid or expired code' })

                return
            }

            if (purpose === 'PHONE_VERIFICATION') {
                await prisma.user.update({
                    where: { id: result.userId },
                    data: { phone: normalizedPhone, phoneVerifiedAt: new Date() },
                })

                res.status(200).json({ message: 'Phone number verified successfully' })

                return
            }

            const user = await prisma.user.findUnique({ where: { id: result.userId } })

            if (!user) {
                res.status(401).json({ error: 'Invalid credentials' })

                return
            }

            const statusError = await this.getAccountStatusError(user)
            if (statusError) {
                res.status(statusError.statusCode).json(statusError.body)

                return
            }

            await prisma.user.update({
                where: { id: user.id },
                data: { lastLoginAt: new Date() }
            })

            const token = this.generateToken(user.id, user.role)

            res.status(200).json({
                message: 'Login successful',
                token,
                user: {
                    id: user.id,
                    email: user.email,
                    username: user.username,
                    role: user.role
                }
            })
        } catch (error) {
            console.error('OTP verify error:', error)
            res.status(500).json({ error: 'Internal server error' })
        }
    }

    private async getAccountStatusError(user: { id: string; status: string }): Promise<{ statusCode: number; body: Record<string, unknown> } | null> {
        if (user.status === 'DELETED') {
            // Tombstoned account — indistinguishable from unknown credentials
            return { statusCode: 401, body: { error: 'Invalid credentials' } }
        }

        if (user.status === 'DEACTIVATED') {
            return {
                statusCode: 403,
                body: { error: 'Account is deactivated', code: 'ACCOUNT_DEACTIVATED' },
            }
        }

        if (user.status === 'PENDING_DELETION') {
            const deletionRequest = await prisma.accountDeletionRequest.findFirst({
                where: { userId: user.id, status: 'pending' },
                select: { scheduledFor: true },
            })

            return {
                statusCode: 403,
                body: {
                    error: 'Account is scheduled for deletion',
                    code: 'ACCOUNT_PENDING_DELETION',
                    scheduledFor: deletionRequest?.scheduledFor ?? null,
                },
            }
        }

        return null
    }

    private generateToken(userId: string, role: string): string {
        return issueAccessToken({ id: userId, role })
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

    private isPhoneOtpLimited(phone: string, purpose: string): boolean {
        const now = Date.now()
        const record = otpPhoneCounts.get(`${purpose}:${phone}`)

        if (!record || record.resetAt < now) {
            return false
        }

        return record.count >= OTP_PHONE_LIMIT
    }

    private recordPhoneOtpRequest(phone: string, purpose: string): void {
        const now = Date.now()
        const key = `${purpose}:${phone}`
        const record = otpPhoneCounts.get(key)

        if (!record || record.resetAt < now) {
            otpPhoneCounts.set(key, { count: 1, resetAt: now + OTP_PHONE_WINDOW_MS })
        } else {
            record.count++
        }
    }

    private isDeviceOtpLimited(deviceId: string): boolean {
        const now = Date.now()
        const record = otpDeviceCounts.get(deviceId)

        if (!record || record.resetAt < now) {
            return false
        }

        return record.count >= OTP_DEVICE_LIMIT
    }

    private recordDeviceOtpRequest(deviceId: string): void {
        const now = Date.now()
        const record = otpDeviceCounts.get(deviceId)

        if (!record || record.resetAt < now) {
            otpDeviceCounts.set(deviceId, { count: 1, resetAt: now + OTP_DEVICE_WINDOW_MS })
        } else {
            record.count++
        }
    }
}
