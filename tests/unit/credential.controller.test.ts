import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Request, Response } from 'express'
import { CredentialController } from '../../src/controllers/credential.controller'
import { prisma } from '../../src/config/database'

vi.mock('../../src/config/database', () => ({
  prisma: {
    credential: {
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}))

interface AuthRequest extends Request {
  user?: {
    id: string
    email: string
  }
}

describe('CredentialController', () => {
  let credentialController: CredentialController
  let mockRequest: Partial<AuthRequest>
  let mockResponse: Partial<Response>
  let mockNext: any

  beforeEach(() => {
    credentialController = new CredentialController()
    mockRequest = {
      query: {},
      params: {},
    }
    mockResponse = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    }
    mockNext = vi.fn()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('getUserCredentials', () => {
    it('should return user credentials with pagination', async () => {
      const mockCredentials = [
        {
          id: 'cred-1',
          userId: 'user-1',
          moduleId: 'module-1',
          onChainId: 'chain-1',
          issuedAt: new Date('2024-01-01'),
          user: {
            id: 'user-1',
            username: 'John Doe',
            email: 'john@example.com',
          },
          module: {
            id: 'module-1',
            title: 'JavaScript Basics',
            description: 'Learn JS',
            category: 'Programming',
            difficulty: 'easy',
          },
        },
      ]

      mockRequest.user = { id: 'user-1', email: 'john@example.com' }
      vi.mocked(prisma.credential.count).mockResolvedValue(1)
      vi.mocked(prisma.credential.findMany).mockResolvedValue(
        mockCredentials as any,
      )

      await credentialController.getUserCredentials(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      )

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(prisma.credential.count).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      })
      expect(prisma.credential.findMany).toHaveBeenCalled()
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        data: expect.arrayContaining([
          expect.objectContaining({
            id: 'cred-1',
            moduleName: 'JavaScript Basics',
            onChainId: 'chain-1',
          }),
        ]),
        meta: expect.objectContaining({
          page: 1,
          limit: 10,
          total: 1,
        }),
      })
    })

    it('should filter credentials by moduleId', async () => {
      mockRequest.user = { id: 'user-1', email: 'john@example.com' }
      mockRequest.query = { moduleId: 'module-1' }

      vi.mocked(prisma.credential.count).mockResolvedValue(0)
      vi.mocked(prisma.credential.findMany).mockResolvedValue([])

      await credentialController.getUserCredentials(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      )

      expect(prisma.credential.count).toHaveBeenCalledWith({
        where: { userId: 'user-1', moduleId: 'module-1' },
      })
    })

    it('should filter credentials by date range', async () => {
      mockRequest.user = { id: 'user-1', email: 'john@example.com' }
      mockRequest.query = {
        fromDate: '2024-01-01T00:00:00Z',
        toDate: '2024-12-31T23:59:59Z',
      }

      vi.mocked(prisma.credential.count).mockResolvedValue(0)
      vi.mocked(prisma.credential.findMany).mockResolvedValue([])

      await credentialController.getUserCredentials(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      )

      expect(prisma.credential.count).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          issuedAt: {
            gte: new Date('2024-01-01T00:00:00Z'),
            lte: new Date('2024-12-31T23:59:59Z'),
          },
        },
      })
    })

    it('should throw error for invalid date format', async () => {
      mockRequest.user = { id: 'user-1', email: 'john@example.com' }
      mockRequest.query = { fromDate: 'invalid-date' }

      await credentialController.getUserCredentials(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      )

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Invalid fromDate format' }),
      )
    })

    it('should throw error if user is not authenticated', async () => {
      mockRequest.user = undefined

      await credentialController.getUserCredentials(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      )

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'User ID not found' }),
      )
    })

    it('should handle pagination correctly', async () => {
      mockRequest.user = { id: 'user-1', email: 'john@example.com' }
      mockRequest.query = { page: '2', limit: '5' }

      vi.mocked(prisma.credential.count).mockResolvedValue(15)
      vi.mocked(prisma.credential.findMany).mockResolvedValue([])

      await credentialController.getUserCredentials(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      )

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(prisma.credential.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 5,
          take: 5,
        }),
      )
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          meta: expect.objectContaining({
            page: 2,
            limit: 5,
            total: 15,
            totalPages: 3,
            hasNextPage: true,
            hasPrevPage: true,
          }),
        }),
      )
    })
  })

  describe('getCredentialById', () => {
    it('should return credential details for owner', async () => {
      const mockCredential = {
        id: 'cred-1',
        userId: 'user-1',
        moduleId: 'module-1',
        onChainId: 'chain-1',
        issuedAt: new Date('2024-01-01'),
        user: {
          id: 'user-1',
          username: 'John Doe',
          email: 'john@example.com',
        },
        module: {
          id: 'module-1',
          title: 'JavaScript Basics',
          description: 'Learn JS fundamentals',
          category: 'Programming',
          difficulty: 'easy',
          reward: 100,
        },
      }

      mockRequest.user = { id: 'user-1', email: 'john@example.com' }
      mockRequest.params = { id: 'cred-1' }
      vi.mocked(prisma.credential.findUnique).mockResolvedValue(
        mockCredential as any,
      )

      await credentialController.getCredentialById(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      )

      expect(prisma.credential.findUnique).toHaveBeenCalledWith({
        where: { id: 'cred-1' },
        include: expect.any(Object),
      })
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          id: 'cred-1',
          holderName: 'John Doe',
          moduleName: 'JavaScript Basics',
          onChainId: 'chain-1',
        }),
      })
    })

    it('should throw error if credential not found', async () => {
      mockRequest.user = { id: 'user-1', email: 'john@example.com' }
      mockRequest.params = { id: 'non-existent' }
      vi.mocked(prisma.credential.findUnique).mockResolvedValue(null)

      await credentialController.getCredentialById(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      )

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Credential not found' }),
      )
    })

    it('should throw error if user does not own credential', async () => {
      const mockCredential = {
        id: 'cred-1',
        userId: 'user-2',
        moduleId: 'module-1',
        onChainId: 'chain-1',
        issuedAt: new Date(),
        user: { id: 'user-2', username: 'Jane Doe', email: 'jane@example.com' },
        module: {
          id: 'module-1',
          title: 'Test',
          description: 'Test',
          category: 'Test',
          difficulty: 'easy',
          reward: 100,
        },
      }

      mockRequest.user = { id: 'user-1', email: 'john@example.com' }
      mockRequest.params = { id: 'cred-1' }
      vi.mocked(prisma.credential.findUnique).mockResolvedValue(
        mockCredential as any,
      )

      await credentialController.getCredentialById(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      )

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'You do not have access to this credential',
        }),
      )
    })

    it('should throw error if user is not authenticated', async () => {
      mockRequest.user = undefined
      mockRequest.params = { id: 'cred-1' }

      await credentialController.getCredentialById(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      )

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'User ID not found' }),
      )
    })
  })

  describe('verifyCredential', () => {
    it('should verify credential by onChainId', async () => {
      const mockCredential = {
        id: 'cred-1',
        userId: 'user-1',
        moduleId: 'module-1',
        onChainId: 'chain-1',
        issuedAt: new Date('2024-01-01'),
        user: {
          id: 'user-1',
          username: 'John Doe',
        },
        module: {
          id: 'module-1',
          title: 'JavaScript Basics',
          category: 'Programming',
          difficulty: 'easy',
        },
      }

      mockRequest.params = { onChainId: 'chain-1' }
      vi.mocked(prisma.credential.findFirst).mockResolvedValue(
        mockCredential as any,
      )

      await credentialController.verifyCredential(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      )

      expect(prisma.credential.findFirst).toHaveBeenCalledWith({
        where: { onChainId: 'chain-1' },
        include: expect.any(Object),
      })
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          valid: true,
          credential: expect.objectContaining({
            holderName: 'John Doe',
            moduleName: 'JavaScript Basics',
          }),
          verification: expect.objectContaining({
            status: 'verified',
          }),
        }),
      })
    })

    it('should verify credential by regular id if onChainId not found', async () => {
      const mockCredential = {
        id: 'cred-1',
        userId: 'user-1',
        moduleId: 'module-1',
        onChainId: null,
        issuedAt: new Date('2024-01-01'),
        user: {
          id: 'user-1',
          username: 'John Doe',
        },
        module: {
          id: 'module-1',
          title: 'JavaScript Basics',
          category: 'Programming',
          difficulty: 'easy',
        },
      }

      mockRequest.params = { onChainId: 'cred-1' }
      vi.mocked(prisma.credential.findFirst).mockResolvedValue(null)
      vi.mocked(prisma.credential.findUnique).mockResolvedValue(
        mockCredential as any,
      )

      await credentialController.verifyCredential(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      )

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(prisma.credential.findFirst).toHaveBeenCalled()
      expect(prisma.credential.findUnique).toHaveBeenCalledWith({
        where: { id: 'cred-1' },
        include: expect.any(Object),
      })
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({ valid: true }),
        }),
      )
    })

    it('should throw error if credential not found', async () => {
      mockRequest.params = { onChainId: 'non-existent' }
      vi.mocked(prisma.credential.findFirst).mockResolvedValue(null)
      vi.mocked(prisma.credential.findUnique).mockResolvedValue(null)

      await credentialController.verifyCredential(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      )

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Credential not found or invalid' }),
      )
    })

    it('should not require authentication', async () => {
      const mockCredential = {
        id: 'cred-1',
        userId: 'user-1',
        moduleId: 'module-1',
        onChainId: 'chain-1',
        issuedAt: new Date(),
        user: { id: 'user-1', username: 'John Doe' },
        module: {
          id: 'module-1',
          title: 'Test',
          category: 'Test',
          difficulty: 'easy',
        },
      }

      mockRequest.user = undefined
      mockRequest.params = { onChainId: 'chain-1' }
      vi.mocked(prisma.credential.findFirst).mockResolvedValue(
        mockCredential as any,
      )

      await credentialController.verifyCredential(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      )

      expect(mockResponse.json).toHaveBeenCalled()
    })
  })
})
