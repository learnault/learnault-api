import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Request, Response } from 'express'
import { AuthController, resendCooldowns, resendAccountCounts } from '../src/controllers/auth.controller'
import prisma from '../src/config/database'
import bcrypt from 'bcryptjs'
import { emailService } from '../src/services/email.service'
import { sessionService } from '../src/services/session.service'

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
        session: {
            findUnique: vi.fn(),
            create: vi.fn(),
            update: vi.fn(),
            updateMany: vi.fn(),
            findFirst: vi.fn(),
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

vi.mock('../src/services/session.service', () => ({
    sessionService: {
        createSession: vi.fn().mockResolvedValue({ accessToken: 'mock_access_token', refreshToken: 'mock_refresh_token' }),
        refreshSession: vi.fn(),
        revokeSession: vi.fn(),
        revokeAllSessions: vi.fn(),
    },
}))

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
                    accessToken: 'mock_access_token',
                    refreshToken: 'mock_refresh_token',
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
                    accessToken: 'mock_access_token',
                    refreshToken: 'mock_refresh_token',
                })
            )
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
    })

    describe('logout', () => {
        it('should return success message', async () => {
            mockRequest.body = { refreshToken: 'test_refresh_token' }
            await authController.logout(
                mockRequest as Request,
                mockResponse as Response
            )

            expect(mockResponse.status).toHaveBeenCalledWith(200)
            expect(mockResponse.json).toHaveBeenCalledWith({
                message: 'Logged out successfully',
            })
        })
    })
})
