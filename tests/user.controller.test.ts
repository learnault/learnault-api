import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Request, Response } from 'express'
import { UserController } from '../src/controllers/user.controller'

interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
  };
}

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  username: 'testuser',
  firstName: 'Test',
  lastName: 'User',
  bio: 'Test bio',
  avatar: 'https://example.com/avatar.jpg',
  walletAddress: 'GABC1234567890123456789012345678901234567890123456789',
  password: 'hashed_password',
  role: 'LEARNER' as const,
  isVerified: true,
  isActive: true,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-02'),
  lastLoginAt: null,
  profile: null,
  onboarding: null,
}

vi.mock('../src/config/database', () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    learnerProfile: {
      upsert: vi.fn(),
    },
    onboardingState: {
      upsert: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    session: {
      updateMany: vi.fn(),
    },
    $transaction: vi.fn((args: any[]) => Promise.all(args)),
  },
}))

vi.mock('bcryptjs', () => ({
  default: {
    genSalt: vi.fn().mockResolvedValue('salt'),
    hash: vi.fn().mockResolvedValue('new_hashed_password'),
    compare: vi.fn(),
  },
}))

describe('UserController', () => {
  let userController: UserController
  let mockRequest: Partial<AuthRequest>
  let mockResponse: Partial<Response>

  beforeEach(() => {
    userController = new UserController()
    mockRequest = {
      headers: {},
      socket: { remoteAddress: '127.0.0.1' } as any,
    }
    mockResponse = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    }
    vi.clearAllMocks()
  })

  describe('getCurrentUser', () => {
    it('should return current user profile', async () => {
      const prisma = (await import('../src/config/database')).default
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser)

      mockRequest.user = { id: 'user-1', email: 'test@example.com' }

      await userController.getCurrentUser(mockRequest as Request, mockResponse as Response)

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          id: mockUser.id,
          email: mockUser.email,
          username: mockUser.username,
          firstName: mockUser.firstName,
          lastName: mockUser.lastName,
          bio: mockUser.bio,
          avatar: mockUser.avatar,
          walletAddress: mockUser.walletAddress,
          isActive: true,
        })
      )
    })

    it('should return 401 if not authenticated', async () => {
      await userController.getCurrentUser(mockRequest as Request, mockResponse as Response)

      expect(mockResponse.status).toHaveBeenCalledWith(401)
      expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Unauthorized' })
    })

    it('should return 404 if user not found', async () => {
      const prisma = (await import('../src/config/database')).default
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null)

      mockRequest.user = { id: 'nonexistent', email: 'test@example.com' }

      await userController.getCurrentUser(mockRequest as Request, mockResponse as Response)

      expect(mockResponse.status).toHaveBeenCalledWith(404)
      expect(mockResponse.json).toHaveBeenCalledWith({ error: 'User not found' })
    })
  })

  describe('updateProfile', () => {
    it('should update user profile successfully', async () => {
      const prisma = (await import('../src/config/database')).default
      const updatedUser = {
        ...mockUser,
        username: 'updateduser',
        firstName: 'Updated',
        lastName: 'User',
        bio: 'Updated bio',
        avatar: 'https://example.com/new-avatar.jpg',
      }
      vi.mocked(prisma.user.update).mockResolvedValue(updatedUser)
      vi.mocked(prisma.auditLog.create).mockResolvedValue({} as any)

      mockRequest.user = { id: 'user-1', email: 'test@example.com' }
      mockRequest.body = {
        username: 'updateduser',
        firstName: 'Updated',
        lastName: 'User',
        bio: 'Updated bio',
        avatar: 'https://example.com/new-avatar.jpg',
      }

      await userController.updateProfile(mockRequest as Request, mockResponse as Response)

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          id: updatedUser.id,
          username: 'updateduser',
          firstName: 'Updated',
          lastName: 'User',
          bio: 'Updated bio',
          avatar: 'https://example.com/new-avatar.jpg',
          isActive: true,
        })
      )
    })

    it('should return 401 if not authenticated', async () => {
      await userController.updateProfile(mockRequest as Request, mockResponse as Response)

      expect(mockResponse.status).toHaveBeenCalledWith(401)
      expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Unauthorized' })
    })
  })

  describe('getUserById', () => {
    it('should return public user info for public profile', async () => {
      const prisma = (await import('../src/config/database')).default
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser)

      mockRequest.params = { id: 'user-1' }

      await userController.getUserById(mockRequest as Request, mockResponse as Response)

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          id: mockUser.id,
          username: mockUser.username,
          firstName: mockUser.firstName,
          lastName: mockUser.lastName,
          avatar: mockUser.avatar,
        })
      )
    })

    it('should return 404 if user not found', async () => {
      const prisma = (await import('../src/config/database')).default
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null)

      mockRequest.params = { id: 'nonexistent' }

      await userController.getUserById(mockRequest as Request, mockResponse as Response)

      expect(mockResponse.status).toHaveBeenCalledWith(404)
      expect(mockResponse.json).toHaveBeenCalledWith({ error: 'User not found or profile is private' })
    })

    it('should return 404 for private profile', async () => {
      const prisma = (await import('../src/config/database')).default
      const privateUser = {
        ...mockUser,
        profile: {
          id: 'prof-1',
          userId: 'user-1',
          visibility: 'private',
          consentGiven: false,
        },
      }
      vi.mocked(prisma.user.findUnique).mockResolvedValue(privateUser as any)

      mockRequest.params = { id: 'user-1' }

      await userController.getUserById(mockRequest as Request, mockResponse as Response)

      expect(mockResponse.status).toHaveBeenCalledWith(404)
    })
  })

  describe('changePassword', () => {
    it('should change password successfully', async () => {
      const prisma = (await import('../src/config/database')).default
      const bcryptjs = (await import('bcryptjs')).default
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser)
      vi.mocked(bcryptjs.compare).mockResolvedValue(true as never)
      vi.mocked(prisma.auditLog.create).mockResolvedValue({} as any)

      mockRequest.user = { id: 'user-1', email: 'test@example.com' }
      mockRequest.body = {
        currentPassword: 'oldpassword',
        newPassword: 'NewPassword123!',
      }

      await userController.changePassword(mockRequest as Request, mockResponse as Response)

      expect(mockResponse.json).toHaveBeenCalledWith({ message: 'Password updated successfully' })
    })

    it('should return 400 if current password is incorrect', async () => {
      const prisma = (await import('../src/config/database')).default
      const bcryptjs = (await import('bcryptjs')).default
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser)
      vi.mocked(bcryptjs.compare).mockResolvedValue(false as never)

      mockRequest.user = { id: 'user-1', email: 'test@example.com' }
      mockRequest.body = {
        currentPassword: 'wrongpassword',
        newPassword: 'NewPassword123!',
      }

      await userController.changePassword(mockRequest as Request, mockResponse as Response)

      expect(mockResponse.status).toHaveBeenCalledWith(400)
      expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Current password is incorrect' })
    })
  })

  describe('updateWalletAddress', () => {
    it('should update wallet address successfully', async () => {
      const prisma = (await import('../src/config/database')).default
      const updatedUser = {
        ...mockUser,
        walletAddress: 'GABC1234567890123456789012345678901234567890123456789',
      }
      vi.mocked(prisma.user.update).mockResolvedValue(updatedUser)
      vi.mocked(prisma.auditLog.create).mockResolvedValue({} as any)

      mockRequest.user = { id: 'user-1', email: 'test@example.com' }
      mockRequest.body = {
        walletAddress: 'GABC1234567890123456789012345678901234567890123456789',
      }

      await userController.updateWalletAddress(mockRequest as Request, mockResponse as Response)

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          id: updatedUser.id,
          walletAddress: 'GABC1234567890123456789012345678901234567890123456789',
        })
      )
    })

    it('should return 400 for invalid wallet address', async () => {
      mockRequest.user = { id: 'user-1', email: 'test@example.com' }
      mockRequest.body = {
        walletAddress: 'invalid-address',
      }

      await userController.updateWalletAddress(mockRequest as Request, mockResponse as Response)

      expect(mockResponse.status).toHaveBeenCalledWith(400)
      expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Invalid Stellar wallet address' })
    })

    it('should return 401 if not authenticated', async () => {
      mockRequest.body = { walletAddress: 'GABC1234567890123456789012345678901234567890123456789' }

      await userController.updateWalletAddress(mockRequest as Request, mockResponse as Response)

      expect(mockResponse.status).toHaveBeenCalledWith(401)
      expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Unauthorized' })
    })
  })
})
