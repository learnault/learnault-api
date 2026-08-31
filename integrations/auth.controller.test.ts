import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Request, Response } from 'express'
import { AuthController } from '../src/controllers/auth.controller'
import prisma from '../src/config/database'
import bcrypt from 'bcryptjs'
// import jwt from 'jsonwebtoken'

// Mock dependencies
vi.mock('../src/config/database', () => ({
  default: {
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
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

describe('AuthController', () => {
  let authController: AuthController
  let mockRequest: Partial<Request>
  let mockResponse: Partial<Response>

  beforeEach(() => {
    authController = new AuthController()
    mockRequest = {}
    mockResponse = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    }
    vi.clearAllMocks()
  })

  describe('register', () => {
    it('should register a new user successfully', async () => {
      mockRequest.body = {
        email: 'test@example.com',
        password: 'Password123!',
        username: 'testuser',
      }

      ;(prisma.user.findFirst as any).mockResolvedValue(null)
      ;(prisma.user.create as any).mockResolvedValue({
        id: '1',
        email: 'test@example.com',
        username: 'testuser',
        role: 'LEARNER',
      })

      await authController.register(
        mockRequest as Request,
        mockResponse as Response,
      )

      expect(prisma.user.create).toHaveBeenCalled()
      expect(mockResponse.status).toHaveBeenCalledWith(201)
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'User registered successfully',
          token: 'mock_token',
        }),
      )
    })

    it('should return 400 for invalid input', async () => {
      mockRequest.body = {
        email: 'invalid-email',
        password: 'short',
      }

      await authController.register(
        mockRequest as Request,
        mockResponse as Response,
      )

      expect(mockResponse.status).toHaveBeenCalledWith(400)
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Validation failed',
        }),
      )
    })

    it('should return 409 if user already exists', async () => {
      mockRequest.body = {
        email: 'exists@example.com',
        password: 'Password123!',
        username: 'exists',
      }

      ;(prisma.user.findFirst as any).mockResolvedValue({ id: '1' })

      await authController.register(
        mockRequest as Request,
        mockResponse as Response,
      )

      expect(mockResponse.status).toHaveBeenCalledWith(409)
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'User with this email or username already exists',
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
        mockResponse as Response,
      )

      expect(mockResponse.status).toHaveBeenCalledWith(200)
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Login successful',
          token: 'mock_token',
        }),
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
        mockResponse as Response,
      )

      expect(mockResponse.status).toHaveBeenCalledWith(401)
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Invalid credentials',
      })
    })
  })

  describe('logout', () => {
    it('should return success message', async () => {
      await authController.logout(
        mockRequest as Request,
        mockResponse as Response,
      )

      expect(mockResponse.status).toHaveBeenCalledWith(200)
      expect(mockResponse.json).toHaveBeenCalledWith({
        message:
          'Logged out successfully. Please clear your token client-side.',
      })
    })
  })
})
