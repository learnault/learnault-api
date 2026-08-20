import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Request, Response } from 'express'
import { AuthController, resendCooldowns, resendAccountCounts, otpPhoneCounts, otpDeviceCounts } from '../src/controllers/auth.controller'
import prisma from '../src/config/database'
import bcrypt from 'bcryptjs'
import { emailService } from '../src/services/email.service'
import { otpService } from '../src/services/otp.service'

const mockTokenHash = 'abc123def456hash'
const mockRawToken = 'aaabbbcccddd00112233445566778899aabbccddeeff00112233445566778899'

vi.mock('../src/config/database', () => ({
    default: {
        user: {
            findFirst: vi.fn(),
            findUnique: vi.fn(),
            create: vi.fn(),
            update: vi.fn(),
        },
        verificationToken: {
            findFirst: vi.fn(),
            create: vi.fn(),
            update: vi.fn(),
            updateMany: vi.fn(),
        },
        emailDelivery: {
            create: vi.fn(),
        },
        accountDeletionRequest: {
            findFirst: vi.fn(),
        },
        session: {
            updateMany: vi.fn(),
        },
        auditLog: {
            create: vi.fn(),
        },
        $transaction: vi.fn((args: any[]) => Promise.all(args)),
    },
}))

vi.mock('bcryptjs', () => ({
    default: {
        genSalt: vi.fn().mockResolvedValue('salt'),
        hash: vi.fn().mockResolvedValue('hashed_password'),
        compare: vi.fn(),
    },
}))

vi.mock('jsonwebtoken', () => ({
    default: {
        sign: vi.fn().mockReturnValue('mock_token'),
    },
}))

vi.mock('crypto', () => ({
    default: {
        randomBytes: vi.fn(() => Buffer.from(mockRawToken, 'hex')),
        createHash: vi.fn(() => ({
            update: vi.fn().mockReturnThis(),
            digest: vi.fn(() => mockTokenHash),
        })),
    },
}))

vi.mock('../src/services/email.service', () => ({
    emailService: {
        queueEmail: vi.fn().mockResolvedValue({ id: 'email1' }),
    },
}))

vi.mock('../src/services/otp.service', async () => {
    const actual = await vi.importActual<typeof import('../src/services/otp.service')>('../src/services/otp.service')

    return {
        ...actual,
        otpService: {
            requestChallenge: vi.fn().mockResolvedValue(undefined),
            verifyChallenge: vi.fn(),
        },
    }
})

describe('AuthController', () => {
    let authController: AuthController
    let mockRequest: Partial<Request>
    let mockResponse: Partial<Response>

    beforeEach(() => {
        authController = new AuthController()
        mockRequest = {
            headers: {},
            socket: { remoteAddress: '127.0.0.1' } as any,
        }
        mockResponse = {
            json: vi.fn(),
            status: vi.fn().mockReturnThis(),
        }
        resendCooldowns.clear()
        resendAccountCounts.clear()
        otpPhoneCounts.clear()
        otpDeviceCounts.clear()
        vi.clearAllMocks()
    })

    describe('register', () => {
        it('should register a new user successfully and issue verification token', async () => {
            mockRequest.body = {
                email: 'test@example.com',
                password: 'Password123!',
                username: 'testuser',
            }

            const mockUser = {
                id: '1',
                email: 'test@example.com',
                username: 'testuser',
                role: 'LEARNER',
            }

            ;(prisma.user.findFirst as any).mockResolvedValue(null)
            ;(prisma.user.create as any).mockResolvedValue(mockUser)
            ;(prisma.verificationToken.create as any).mockResolvedValue({
                id: 'vt1',
                userId: '1',
                tokenHash: mockTokenHash,
                expiresAt: new Date(Date.now() + 86400000),
            })

            await authController.register(mockRequest as Request, mockResponse as Response)

            expect(prisma.user.create).toHaveBeenCalled()
            expect(prisma.verificationToken.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        userId: '1',
                        tokenHash: mockTokenHash,
                    }),
                })
            )
            expect(emailService.queueEmail).toHaveBeenCalledWith(
                '1',
                'test@example.com',
                expect.any(String),
                expect.any(String)
            )
            expect(mockResponse.status).toHaveBeenCalledWith(201)
            expect(mockResponse.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: 'User registered successfully',
                    token: 'mock_token',
                })
            )
        })

        it('should return 400 for invalid input', async () => {
            mockRequest.body = {
                email: 'invalid-email',
                password: 'short',
            }

            await authController.register(mockRequest as Request, mockResponse as Response)

            expect(mockResponse.status).toHaveBeenCalledWith(400)
            expect(mockResponse.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: 'Validation failed',
                })
            )
        })

        it('should return 400 for a password that meets length but not complexity', async () => {
            mockRequest.body = {
                email: 'test@example.com',
                // 8+ chars but no uppercase/symbol — fails isStrongPassword
                password: 'alllowercase123',
                username: 'testuser',
            }

            await authController.register(mockRequest as Request, mockResponse as Response)

            expect(mockResponse.status).toHaveBeenCalledWith(400)
            expect(mockResponse.json).toHaveBeenCalledWith(
                expect.objectContaining({ error: 'Validation failed' })
            )
            expect(prisma.user.create).not.toHaveBeenCalled()
        })

        it('should return 409 if user already exists', async () => {
            mockRequest.body = {
                email: 'exists@example.com',
                password: 'Password123!',
                username: 'exists',
            }

            ;(prisma.user.findFirst as any).mockResolvedValue({ id: '1' })

            await authController.register(mockRequest as Request, mockResponse as Response)

            expect(mockResponse.status).toHaveBeenCalledWith(409)
            expect(mockResponse.json).toHaveBeenCalledWith({
                error: 'User with this email or username already exists',
            })
        })

        it('should never store or log the raw token', async () => {
            mockRequest.body = {
                email: 'test@example.com',
                password: 'Password123!',
                username: 'testuser',
            }

            const consoleSpy = vi.spyOn(console, 'error')

            ;(prisma.user.findFirst as any).mockResolvedValue(null)
            ;(prisma.user.create as any).mockResolvedValue({
                id: '1',
                email: 'test@example.com',
                username: 'testuser',
                role: 'LEARNER',
            })
            ;(prisma.verificationToken.create as any).mockResolvedValue({
                id: 'vt1',
                userId: '1',
                tokenHash: mockTokenHash,
                expiresAt: new Date(Date.now() + 86400000),
            })

            const createSpy = prisma.verificationToken.create as any

            await authController.register(mockRequest as Request, mockResponse as Response)

            const createCallArgs = createSpy.mock.calls[0][0]
            expect(createCallArgs.data).not.toHaveProperty('token')
            expect(createCallArgs.data.tokenHash).toBe(mockTokenHash)
            expect(createCallArgs.data.tokenHash).not.toBe(mockRawToken)
            expect(consoleSpy).not.toHaveBeenCalledWith(
                expect.stringContaining(mockRawToken)
            )
        })
    })

    describe('verifyEmail', () => {
        it('should verify email with a valid token', async () => {
            mockRequest.body = { token: mockRawToken }

            const mockToken = {
                id: 'vt1',
                userId: '1',
                tokenHash: mockTokenHash,
                status: 'PENDING',
                expiresAt: new Date(Date.now() + 3600000),
            }

            ;(prisma.verificationToken.findFirst as any).mockResolvedValue(mockToken)
            ;(prisma.verificationToken.update as any).mockResolvedValue({
                ...mockToken,
                status: 'USED',
            })
            ;(prisma.user.update as any).mockResolvedValue({ id: '1', isVerified: true })
            ;(prisma.$transaction as any).mockImplementation(
                async (args: any[]) => await Promise.all(args)
            )

            await authController.verifyEmail(
                mockRequest as Request,
                mockResponse as Response
            )

            expect(prisma.$transaction).toHaveBeenCalled()
            expect(prisma.verificationToken.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 'vt1' },
                    data: { status: 'USED' },
                })
            )
            expect(prisma.user.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: '1' },
                    data: { isVerified: true },
                })
            )
            expect(mockResponse.status).toHaveBeenCalledWith(200)
            expect(mockResponse.json).toHaveBeenCalledWith({
                message: 'Email verified successfully',
            })
        })

        it('should return 400 for malformed token', async () => {
            mockRequest.body = { token: 'not-a-hex-string' }

            await authController.verifyEmail(
                mockRequest as Request,
                mockResponse as Response
            )

            expect(mockResponse.status).toHaveBeenCalledWith(400)
            expect(mockResponse.json).toHaveBeenCalledWith({
                error: 'Invalid token',
            })
        })

        it('should return 400 for token with wrong length', async () => {
            mockRequest.body = { token: 'abcdef' }

            await authController.verifyEmail(
                mockRequest as Request,
                mockResponse as Response
            )

            expect(mockResponse.status).toHaveBeenCalledWith(400)
            expect(mockResponse.json).toHaveBeenCalledWith({
                error: 'Invalid token',
            })
        })

        it('should return 400 for non-existent token', async () => {
            mockRequest.body = { token: mockRawToken }

            ;(prisma.verificationToken.findFirst as any).mockResolvedValue(null)

            await authController.verifyEmail(
                mockRequest as Request,
                mockResponse as Response
            )

            expect(mockResponse.status).toHaveBeenCalledWith(400)
            expect(mockResponse.json).toHaveBeenCalledWith({
                error: 'Invalid token',
            })
        })

        it('should return 200 for already used token (idempotent)', async () => {
            mockRequest.body = { token: mockRawToken }

            const mockToken = {
                id: 'vt1',
                userId: '1',
                tokenHash: mockTokenHash,
                status: 'USED',
                expiresAt: new Date(Date.now() + 3600000),
            }

            ;(prisma.verificationToken.findFirst as any).mockResolvedValue(mockToken)

            await authController.verifyEmail(
                mockRequest as Request,
                mockResponse as Response
            )

            expect(mockResponse.status).toHaveBeenCalledWith(200)
            expect(mockResponse.json).toHaveBeenCalledWith({
                message: 'Email already verified',
            })
        })

        it('should return 400 for revoked token', async () => {
            mockRequest.body = { token: mockRawToken }

            const mockToken = {
                id: 'vt1',
                userId: '1',
                tokenHash: mockTokenHash,
                status: 'REVOKED',
                expiresAt: new Date(Date.now() + 3600000),
            }

            ;(prisma.verificationToken.findFirst as any).mockResolvedValue(mockToken)

            await authController.verifyEmail(
                mockRequest as Request,
                mockResponse as Response
            )

            expect(mockResponse.status).toHaveBeenCalledWith(400)
            expect(mockResponse.json).toHaveBeenCalledWith({
                error: 'Invalid token',
            })
        })

        it('should return 400 for expired token and mark as revoked', async () => {
            mockRequest.body = { token: mockRawToken }

            const mockToken = {
                id: 'vt1',
                userId: '1',
                tokenHash: mockTokenHash,
                status: 'PENDING',
                expiresAt: new Date(Date.now() - 3600000),
            }

            ;(prisma.verificationToken.findFirst as any).mockResolvedValue(mockToken)
            ;(prisma.verificationToken.update as any).mockResolvedValue({
                ...mockToken,
                status: 'REVOKED',
            })

            await authController.verifyEmail(
                mockRequest as Request,
                mockResponse as Response
            )

            expect(prisma.verificationToken.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 'vt1' },
                    data: { status: 'REVOKED' },
                })
            )
            expect(mockResponse.status).toHaveBeenCalledWith(400)
            expect(mockResponse.json).toHaveBeenCalledWith({
                error: 'Token expired',
            })
        })

        it('should return 400 for empty token body', async () => {
            mockRequest.body = { token: '' }

            await authController.verifyEmail(
                mockRequest as Request,
                mockResponse as Response
            )

            expect(mockResponse.status).toHaveBeenCalledWith(400)
            expect(mockResponse.json).toHaveBeenCalledWith({
                error: 'Invalid token',
            })
        })
    })

    describe('resendVerification', () => {
        it('should return neutral response when email does not exist', async () => {
            mockRequest.body = { email: 'nonexistent@example.com' }

            ;(prisma.user.findUnique as any).mockResolvedValue(null)

            await authController.resendVerification(
                mockRequest as Request,
                mockResponse as Response
            )

            expect(mockResponse.status).toHaveBeenCalledWith(200)
            expect(mockResponse.json).toHaveBeenCalledWith({
                message:
                    'If the account exists, a verification email has been sent.',
            })
        })

        it('should return neutral response when account already verified', async () => {
            mockRequest.body = { email: 'verified@example.com' }

            ;(prisma.user.findUnique as any).mockResolvedValue({
                id: '1',
                isVerified: true,
            })

            await authController.resendVerification(
                mockRequest as Request,
                mockResponse as Response
            )

            expect(mockResponse.status).toHaveBeenCalledWith(200)
            expect(mockResponse.json).toHaveBeenCalledWith({
                message:
                    'If the account exists, a verification email has been sent.',
            })
        })

        it('should return neutral response for invalid email format', async () => {
            mockRequest.body = { email: 'not-an-email' }

            await authController.resendVerification(
                mockRequest as Request,
                mockResponse as Response
            )

            expect(mockResponse.status).toHaveBeenCalledWith(200)
            expect(mockResponse.json).toHaveBeenCalledWith({
                message:
                    'If the account exists, a verification email has been sent.',
            })
        })

        it('should resend verification for valid unverified account', async () => {
            mockRequest.body = { email: 'unverified@example.com' }

            ;(prisma.user.findUnique as any).mockResolvedValue({
                id: '1',
                email: 'unverified@example.com',
                isVerified: false,
            })
            ;(prisma.verificationToken.updateMany as any).mockResolvedValue({
                count: 1,
            })
            ;(prisma.verificationToken.create as any).mockResolvedValue({
                id: 'vt2',
                userId: '1',
                tokenHash: mockTokenHash,
                expiresAt: new Date(Date.now() + 86400000),
            })

            await authController.resendVerification(
                mockRequest as Request,
                mockResponse as Response
            )

            expect(prisma.verificationToken.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { userId: '1', status: 'PENDING' },
                    data: { status: 'REVOKED' },
                })
            )
            expect(prisma.verificationToken.create).toHaveBeenCalled()
            expect(emailService.queueEmail).toHaveBeenCalledWith(
                '1',
                'unverified@example.com',
                expect.any(String),
                expect.any(String)
            )
            expect(mockResponse.status).toHaveBeenCalledWith(200)
        })

        it('should apply IP rate limiting', async () => {
            mockRequest.body = { email: 'test@example.com' }

            ;(prisma.user.findUnique as any).mockResolvedValue({
                id: '1',
                isVerified: false,
            })
            ;(prisma.verificationToken.updateMany as any).mockResolvedValue({
                count: 1,
            })
            ;(prisma.verificationToken.create as any).mockResolvedValue({
                id: 'vt2',
            })

            await authController.resendVerification(
                mockRequest as Request,
                mockResponse as Response
            )

            expect(mockResponse.status).toHaveBeenCalledWith(200)

            // Second call within cooldown
            mockRequest.body = { email: 'other@example.com' }
            vi.clearAllMocks()

            ;(prisma.user.findUnique as any).mockResolvedValue({
                id: '2',
                isVerified: false,
            })

            await authController.resendVerification(
                mockRequest as Request,
                mockResponse as Response
            )

            expect(mockResponse.status).toHaveBeenCalledWith(429)
            expect(mockResponse.json).toHaveBeenCalledWith({
                error: 'Too many requests. Please try again later.',
            })
        })

        it('should not expose whether an account exists through response message', async () => {
            mockRequest.body = { email: 'any@example.com' }

            ;(prisma.user.findUnique as any).mockResolvedValue(null)

            await authController.resendVerification(
                mockRequest as Request,
                mockResponse as Response
            )

            expect(mockResponse.json).toHaveBeenCalledWith({
                message:
                    'If the account exists, a verification email has been sent.',
            })

            vi.clearAllMocks()
            resendCooldowns.clear()
            resendAccountCounts.clear()
            mockRequest.body = { email: 'exists@example.com' }

            ;(prisma.user.findUnique as any).mockResolvedValue({
                id: '1',
                isVerified: false,
            })
            ;(prisma.verificationToken.updateMany as any).mockResolvedValue({
                count: 1,
            })
            ;(prisma.verificationToken.create as any).mockResolvedValue({
                id: 'vt2',
            })

            await authController.resendVerification(
                mockRequest as Request,
                mockResponse as Response
            )

            expect(mockResponse.json).toHaveBeenCalledWith({
                message:
                    'If the account exists, a verification email has been sent.',
            })
        })
    })

    describe('login', () => {
        it('should login successfully with valid credentials', async () => {
            mockRequest.body = {
                email: 'test@example.com',
                password: 'Password123!',
            }

            const mockUser = {
                id: '1',
                email: 'test@example.com',
                password: 'hashed_password',
                username: 'testuser',
                role: 'LEARNER',
            }

            ;(prisma.user.findUnique as any).mockResolvedValue(mockUser)
            ;(bcrypt.compare as any).mockResolvedValue(true)
            ;(prisma.user.update as any).mockResolvedValue(mockUser)

            await authController.login(
                mockRequest as Request,
                mockResponse as Response
            )

            expect(mockResponse.status).toHaveBeenCalledWith(200)
            expect(mockResponse.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: 'Login successful',
                    token: 'mock_token',
                })
            )
        })

        it('should return 403 with ACCOUNT_DEACTIVATED for deactivated accounts', async () => {
            mockRequest.body = {
                email: 'test@example.com',
                password: 'Password123!',
            }

            ;(prisma.user.findUnique as any).mockResolvedValue({
                id: '1',
                email: 'test@example.com',
                password: 'hashed_password',
                username: 'testuser',
                role: 'LEARNER',
                status: 'DEACTIVATED',
            })
            ;(bcrypt.compare as any).mockResolvedValue(true)

            await authController.login(
                mockRequest as Request,
                mockResponse as Response
            )

            expect(mockResponse.status).toHaveBeenCalledWith(403)
            expect(mockResponse.json).toHaveBeenCalledWith(
                expect.objectContaining({ code: 'ACCOUNT_DEACTIVATED' })
            )
        })

        it('should return 403 with scheduledFor for accounts pending deletion', async () => {
            mockRequest.body = {
                email: 'test@example.com',
                password: 'Password123!',
            }

            const scheduledFor = new Date('2026-08-18T00:00:00Z')

            ;(prisma.user.findUnique as any).mockResolvedValue({
                id: '1',
                email: 'test@example.com',
                password: 'hashed_password',
                username: 'testuser',
                role: 'LEARNER',
                status: 'PENDING_DELETION',
            })
            ;(bcrypt.compare as any).mockResolvedValue(true)
            ;(prisma.accountDeletionRequest.findFirst as any).mockResolvedValue({ scheduledFor })

            await authController.login(
                mockRequest as Request,
                mockResponse as Response
            )

            expect(mockResponse.status).toHaveBeenCalledWith(403)
            expect(mockResponse.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    code: 'ACCOUNT_PENDING_DELETION',
                    scheduledFor,
                })
            )
        })

        it('should return a neutral 401 for deleted (tombstoned) accounts', async () => {
            mockRequest.body = {
                email: 'test@example.com',
                password: 'Password123!',
            }

            ;(prisma.user.findUnique as any).mockResolvedValue({
                id: '1',
                email: 'deleted+abc@anon.invalid',
                password: 'tombstone',
                username: 'deleted_abc',
                role: 'LEARNER',
                status: 'DELETED',
            })
            ;(bcrypt.compare as any).mockResolvedValue(true)

            await authController.login(
                mockRequest as Request,
                mockResponse as Response
            )

            expect(mockResponse.status).toHaveBeenCalledWith(401)
            expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Invalid credentials' })
        })

        it('should return 401 for invalid credentials', async () => {
            mockRequest.body = {
                email: 'test@example.com',
                password: 'wrong_password',
            }

            ;(prisma.user.findUnique as any).mockResolvedValue({
                id: '1',
                password: 'hashed',
            })
            ;(bcrypt.compare as any).mockResolvedValue(false)

            await authController.login(
                mockRequest as Request,
                mockResponse as Response
            )

            expect(mockResponse.status).toHaveBeenCalledWith(401)
            expect(mockResponse.json).toHaveBeenCalledWith({
                error: 'Invalid credentials',
            })
        })

        it('transparently upgrades a hash stored below the current bcrypt cost', async () => {
            mockRequest.body = {
                email: 'test@example.com',
                password: 'Password123!',
            }

            ;(prisma.user.findUnique as any).mockResolvedValue({
                id: '1',
                email: 'test@example.com',
                // cost 10 — below the default configured cost of 12
                password: '$2b$10$abcdefghijklmnopqrstuv',
                username: 'testuser',
                role: 'LEARNER',
                status: 'ACTIVE',
            })
            ;(bcrypt.compare as any).mockResolvedValue(true)
            ;(prisma.user.update as any).mockResolvedValue({})

            await authController.login(
                mockRequest as Request,
                mockResponse as Response
            )

            expect(prisma.user.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: '1' },
                    data: expect.objectContaining({ password: 'hashed_password' }),
                })
            )
            expect(mockResponse.status).toHaveBeenCalledWith(200)
        })

        it('does not rewrite a hash that already meets the current bcrypt cost', async () => {
            mockRequest.body = {
                email: 'test@example.com',
                password: 'Password123!',
            }

            ;(prisma.user.findUnique as any).mockResolvedValue({
                id: '1',
                email: 'test@example.com',
                // cost 12 — matches the default configured cost, no upgrade needed
                password: '$2b$12$abcdefghijklmnopqrstuv',
                username: 'testuser',
                role: 'LEARNER',
                status: 'ACTIVE',
            })
            ;(bcrypt.compare as any).mockResolvedValue(true)
            ;(prisma.user.update as any).mockResolvedValue({})

            await authController.login(
                mockRequest as Request,
                mockResponse as Response
            )

            const updateCallArgs = (prisma.user.update as any).mock.calls[0][0]
            expect(updateCallArgs.data).not.toHaveProperty('password')
        })
    })

    describe('logout', () => {
        it('should return success message', async () => {
            await authController.logout(
                mockRequest as Request,
                mockResponse as Response
            )

            expect(mockResponse.status).toHaveBeenCalledWith(200)
            expect(mockResponse.json).toHaveBeenCalledWith({
                message:
                    'Logged out successfully. Please clear your token client-side.',
            })
        })
    })

    describe('resetPassword', () => {
        const validToken = 'a'.repeat(64)

        it('should return 400 for a new password that fails the strength policy', async () => {
            mockRequest.body = { token: validToken, newPassword: 'alllowercase123' }

            await authController.resetPassword(mockRequest as Request, mockResponse as Response)

            expect(mockResponse.status).toHaveBeenCalledWith(400)
            expect(prisma.$transaction).not.toHaveBeenCalled()
        })

        it('should reset the password, revoke sessions, and revoke pending tokens on success', async () => {
            mockRequest.body = { token: validToken, newPassword: 'NewStr0ng!Pass' }
            mockRequest.headers = { 'user-agent': 'vitest' }
            mockRequest.socket = { remoteAddress: '127.0.0.1' } as any

            ;(prisma.verificationToken.findFirst as any).mockResolvedValue({
                id: 'vt1',
                userId: 'u1',
                status: 'PENDING',
                type: 'PASSWORD_RESET',
                expiresAt: new Date(Date.now() + 60000),
            })

            await authController.resetPassword(mockRequest as Request, mockResponse as Response)

            expect(prisma.$transaction).toHaveBeenCalled()
            expect(mockResponse.status).toHaveBeenCalledWith(200)
            expect(mockResponse.json).toHaveBeenCalledWith({ message: 'Password reset successful' })
        })

        it('should return 400 for an expired token', async () => {
            mockRequest.body = { token: validToken, newPassword: 'NewStr0ng!Pass' }

            ;(prisma.verificationToken.findFirst as any).mockResolvedValue({
                id: 'vt1',
                userId: 'u1',
                status: 'PENDING',
                type: 'PASSWORD_RESET',
                expiresAt: new Date(Date.now() - 60000),
            })

            await authController.resetPassword(mockRequest as Request, mockResponse as Response)

            expect(mockResponse.status).toHaveBeenCalledWith(400)
            expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Token expired' })
        })
    })

    describe('requestOtp', () => {
        it('should reject a malformed phone number', async () => {
            mockRequest.body = { phone: '08012345678' }

            await authController.requestOtp(mockRequest as Request, mockResponse as Response)

            expect(mockResponse.status).toHaveBeenCalledWith(400)
            expect(otpService.requestChallenge).not.toHaveBeenCalled()
        })

        it('LOGIN: returns a generic 200 without creating a challenge for an unregistered phone', async () => {
            mockRequest.body = { phone: '+2348012345678' }

            ;(prisma.user.findUnique as any).mockResolvedValue(null)

            await authController.requestOtp(mockRequest as Request, mockResponse as Response)

            expect(otpService.requestChallenge).not.toHaveBeenCalled()
            expect(mockResponse.status).toHaveBeenCalledWith(200)
            expect(mockResponse.json).toHaveBeenCalledWith({
                message: 'If this phone number is registered, a verification code has been sent.',
            })
        })

        it('LOGIN: returns the same generic 200 for a phone that has not been verified', async () => {
            mockRequest.body = { phone: '+2348012345678' }

            ;(prisma.user.findUnique as any).mockResolvedValue({
                id: 'user1',
                status: 'ACTIVE',
                phoneVerifiedAt: null,
            })

            await authController.requestOtp(mockRequest as Request, mockResponse as Response)

            expect(otpService.requestChallenge).not.toHaveBeenCalled()
            expect(mockResponse.status).toHaveBeenCalledWith(200)
            expect(mockResponse.json).toHaveBeenCalledWith({
                message: 'If this phone number is registered, a verification code has been sent.',
            })
        })

        it('LOGIN: requests a challenge for a verified, active phone', async () => {
            mockRequest.body = { phone: '+2348012345678' }

            ;(prisma.user.findUnique as any).mockResolvedValue({
                id: 'user1',
                status: 'ACTIVE',
                phoneVerifiedAt: new Date(),
            })

            await authController.requestOtp(mockRequest as Request, mockResponse as Response)

            expect(otpService.requestChallenge).toHaveBeenCalledWith(
                '+2348012345678',
                'LOGIN',
                'user1',
                expect.objectContaining({ ip: '127.0.0.1' })
            )
            expect(mockResponse.status).toHaveBeenCalledWith(200)
        })

        it('PHONE_VERIFICATION: requests a challenge for the authenticated caller', async () => {
            mockRequest.body = { phone: '+2348012345678' }
            ;(mockRequest as any).user = { id: 'user1', role: 'learner' }

            ;(prisma.user.findFirst as any).mockResolvedValue(null)

            await authController.requestOtp(mockRequest as Request, mockResponse as Response)

            expect(otpService.requestChallenge).toHaveBeenCalledWith(
                '+2348012345678',
                'PHONE_VERIFICATION',
                'user1',
                expect.anything()
            )
            expect(mockResponse.status).toHaveBeenCalledWith(200)
            expect(mockResponse.json).toHaveBeenCalledWith({ message: 'Verification code sent.' })
        })

        it('PHONE_VERIFICATION: rejects a phone already verified on another account', async () => {
            mockRequest.body = { phone: '+2348012345678' }
            ;(mockRequest as any).user = { id: 'user1', role: 'learner' }

            ;(prisma.user.findFirst as any).mockResolvedValue({ id: 'user2' })

            await authController.requestOtp(mockRequest as Request, mockResponse as Response)

            expect(otpService.requestChallenge).not.toHaveBeenCalled()
            expect(mockResponse.status).toHaveBeenCalledWith(409)
        })

        it('should rate-limit repeated requests for the same phone', async () => {
            ;(prisma.user.findUnique as any).mockResolvedValue({
                id: 'user1',
                status: 'ACTIVE',
                phoneVerifiedAt: new Date(),
            })

            mockRequest.body = { phone: '+2348012345678' }
            await authController.requestOtp(mockRequest as Request, mockResponse as Response)
            expect(mockResponse.status).toHaveBeenCalledWith(200)

            vi.clearAllMocks()
            mockRequest.body = { phone: '+2348012345678' }
            await authController.requestOtp(mockRequest as Request, mockResponse as Response)

            expect(mockResponse.status).toHaveBeenCalledWith(429)
            expect(otpService.requestChallenge).not.toHaveBeenCalled()
        })

        it('should rate-limit repeated requests from the same device regardless of phone', async () => {
            ;(prisma.user.findUnique as any).mockResolvedValue({
                id: 'user1',
                status: 'ACTIVE',
                phoneVerifiedAt: new Date(),
            })

            otpDeviceCounts.set('device-1', { count: 10, resetAt: Date.now() + 60_000 })

            mockRequest.body = { phone: '+2348012345678', deviceId: 'device-1' }
            await authController.requestOtp(mockRequest as Request, mockResponse as Response)

            expect(mockResponse.status).toHaveBeenCalledWith(429)
            expect(otpService.requestChallenge).not.toHaveBeenCalled()
        })
    })

    describe('verifyOtp', () => {
        it('should return 400 for an invalid/expired code', async () => {
            mockRequest.body = { phone: '+2348012345678', code: '000000' }

            ;(otpService.verifyChallenge as any).mockResolvedValue({ ok: false, reason: 'mismatch' })

            await authController.verifyOtp(mockRequest as Request, mockResponse as Response)

            expect(mockResponse.status).toHaveBeenCalledWith(400)
            expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Invalid or expired code' })
        })

        it('should return 429 once the challenge is locked', async () => {
            mockRequest.body = { phone: '+2348012345678', code: '000000' }

            ;(otpService.verifyChallenge as any).mockResolvedValue({ ok: false, reason: 'locked' })

            await authController.verifyOtp(mockRequest as Request, mockResponse as Response)

            expect(mockResponse.status).toHaveBeenCalledWith(429)
        })

        it('LOGIN: issues a JWT on a correct code for an active account', async () => {
            mockRequest.body = { phone: '+2348012345678', code: '123456' }

            ;(otpService.verifyChallenge as any).mockResolvedValue({ ok: true, userId: 'user1' })
            ;(prisma.user.findUnique as any).mockResolvedValue({
                id: 'user1',
                email: 'test@example.com',
                username: 'testuser',
                role: 'LEARNER',
                status: 'ACTIVE',
            })
            ;(prisma.user.update as any).mockResolvedValue({})

            await authController.verifyOtp(mockRequest as Request, mockResponse as Response)

            expect(mockResponse.status).toHaveBeenCalledWith(200)
            expect(mockResponse.json).toHaveBeenCalledWith(
                expect.objectContaining({ message: 'Login successful', token: 'mock_token' })
            )
        })

        it('LOGIN: blocks a deactivated account the same way as password login', async () => {
            mockRequest.body = { phone: '+2348012345678', code: '123456' }

            ;(otpService.verifyChallenge as any).mockResolvedValue({ ok: true, userId: 'user1' })
            ;(prisma.user.findUnique as any).mockResolvedValue({
                id: 'user1',
                status: 'DEACTIVATED',
            })

            await authController.verifyOtp(mockRequest as Request, mockResponse as Response)

            expect(mockResponse.status).toHaveBeenCalledWith(403)
            expect(mockResponse.json).toHaveBeenCalledWith(
                expect.objectContaining({ code: 'ACCOUNT_DEACTIVATED' })
            )
        })

        it('PHONE_VERIFICATION: marks the phone verified on the authenticated caller', async () => {
            mockRequest.body = { phone: '+2348012345678', code: '123456' }
            ;(mockRequest as any).user = { id: 'user1', role: 'learner' }

            ;(otpService.verifyChallenge as any).mockResolvedValue({ ok: true, userId: 'user1' })
            ;(prisma.user.update as any).mockResolvedValue({})

            await authController.verifyOtp(mockRequest as Request, mockResponse as Response)

            expect(prisma.user.update).toHaveBeenCalledWith({
                where: { id: 'user1' },
                data: { phone: '+2348012345678', phoneVerifiedAt: expect.any(Date) },
            })
            expect(mockResponse.status).toHaveBeenCalledWith(200)
            expect(mockResponse.json).toHaveBeenCalledWith({ message: 'Phone number verified successfully' })
        })
    })
})
