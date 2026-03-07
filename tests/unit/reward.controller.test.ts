import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RewardController } from '../../src/controllers/reward.controller'
import { RewardService } from '../../src/services/reward.service'
import { Request, Response } from 'express'

// Mock RewardService methods using vi.spyOn
describe('RewardController', () => {
  let controller: RewardController
  let mockRequest: any
  let mockResponse: Partial<Response>
  let jsonMock: any
  let statusMock: any
  let getBalanceSpy: any
  let getTransactionHistorySpy: any
  let hasSufficientBalanceSpy: any
  let processWithdrawalSpy: any

  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks()
  
    jsonMock = vi.fn()
    statusMock = vi.fn().mockReturnValue({ json: jsonMock })
  
    mockResponse = {
      json: jsonMock,
      status: statusMock,
    }
  
    mockRequest = {
      user: { id: 'user-123' },
      query: {}, // Initialize empty query object
    }
  
    // Create spies on RewardService prototype
    getBalanceSpy = vi.spyOn(RewardService.prototype, 'getBalance')
    getTransactionHistorySpy = vi.spyOn(
      RewardService.prototype,
      'getTransactionHistory'
    )
    hasSufficientBalanceSpy = vi.spyOn(
      RewardService.prototype,
      'hasSufficientBalance'
    )
    processWithdrawalSpy = vi.spyOn(
      RewardService.prototype,
      'processWithdrawal'
    )
  
    controller = new RewardController()
  })
  
  // Helper function to create a mock next function
  const createNextFunction = () => {
    return vi.fn()
  }

  describe('getBalance', () => {
    it('should return balance for authenticated user', async () => {
      const mockBalance = {
        available: 100.5,
        pending: 10,
        lifetime: 150,
        updatedAt: new Date(),
      }

      getBalanceSpy.mockReturnValue(mockBalance)

      await controller.getBalance(
        mockRequest as Request,
        mockResponse as Response,
      )

      expect(getBalanceSpy).toHaveBeenCalledWith('user-123')
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            balance: {
              available: 100.5,
              pending: 10,
              lifetime: 150,
            },
          }),
        }),
      )
    })

    it('should throw error if user is not authenticated', async () => {
      mockRequest.user = undefined
      const nextFn = createNextFunction()

      await controller.getBalance(
        mockRequest as Request,
        mockResponse as Response,
        nextFn,
      )

      // Error should be caught by asyncHandler and passed to next()
      expect(nextFn).toHaveBeenCalled()
      expect(nextFn.mock.calls[0][0]).toBeDefined()
    })
  })

  describe('getHistory', () => {
    it('should return transaction history without filters', async () => {
      const mockHistory = {
        transactions: [
          {
            id: 'txn-1',
            type: 'module_reward',
            status: 'completed',
            amount: 5,
            createdAt: new Date(),
          },
        ],
        total: 1,
        hasMore: false,
      }

      getTransactionHistorySpy.mockReturnValue(mockHistory)

      await controller.getHistory(
        mockRequest as Request,
        mockResponse as Response,
      )

      expect(getTransactionHistorySpy).toHaveBeenCalledWith(
        'user-123',
        {},
      )
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            transactions: expect.any(Array),
            pagination: expect.any(Object),
          }),
        }),
      )
    })

    it('should apply type filter when provided', async () => {
      mockRequest.query = { type: 'withdrawal' }
      const mockHistory = { transactions: [], total: 0, hasMore: false }
      getTransactionHistorySpy.mockReturnValue(mockHistory)

      await controller.getHistory(
        mockRequest as Request,
        mockResponse as Response,
      )

      expect(getTransactionHistorySpy).toHaveBeenCalledWith(
        'user-123',
        expect.objectContaining({ type: 'withdrawal' }),
      )
    })

    it('should apply status filter when provided', async () => {
      mockRequest.query = { status: 'pending' }
      const mockHistory = { transactions: [], total: 0, hasMore: false }
      getTransactionHistorySpy.mockReturnValue(mockHistory)

      await controller.getHistory(
        mockRequest as Request,
        mockResponse as Response,
      )

      expect(getTransactionHistorySpy).toHaveBeenCalledWith(
        'user-123',
        expect.objectContaining({ status: 'pending' }),
      )
    })

    it('should apply date range filters when provided', async () => {
      const fromDate = '2024-01-01T00:00:00.000Z'
      const toDate = '2024-12-31T23:59:59.999Z'
      mockRequest.query = { fromDate, toDate }
      const mockHistory = { transactions: [], total: 0, hasMore: false }
      getTransactionHistorySpy.mockReturnValue(mockHistory)

      await controller.getHistory(
        mockRequest as Request,
        mockResponse as Response,
      )

      expect(getTransactionHistorySpy).toHaveBeenCalledWith(
        'user-123',
        expect.objectContaining({
          fromDate: expect.any(Date),
          toDate: expect.any(Date),
        }),
      )
    })

    it('should apply pagination when provided', async () => {
      mockRequest.query = { limit: '10', offset: '20' }
      const mockHistory = { transactions: [], total: 50, hasMore: true }
      getTransactionHistorySpy.mockReturnValue(mockHistory)

      await controller.getHistory(
        mockRequest as Request,
        mockResponse as Response,
      )

      expect(getTransactionHistorySpy).toHaveBeenCalledWith(
        'user-123',
        expect.objectContaining({ limit: 10, offset: 20 }),
      )
    })

    it('should reject invalid type filter', async () => {
      mockRequest.query = { type: 'invalid_type' }
      const nextFn = createNextFunction()

      await controller.getHistory(
        mockRequest as any,
        mockResponse as any,
        nextFn,
      )

      expect(nextFn).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Invalid transaction type' }),
      )
    })

    it('should reject invalid status filter', async () => {
      mockRequest.query = { status: 'invalid_status' }
      const nextFn = createNextFunction()

      await controller.getHistory(
        mockRequest as any,
        mockResponse as any,
        nextFn,
      )

      expect(nextFn).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Invalid transaction status' }),
      )
    })

    it('should reject invalid date format', async () => {
      mockRequest.query = { fromDate: 'invalid-date' }
      const nextFn = createNextFunction()

      await controller.getHistory(
        mockRequest as any,
        mockResponse as any,
        nextFn,
      )

      expect(nextFn).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('Invalid fromDate format') }),
      )
    })

    it('should reject invalid limit values', async () => {
      mockRequest.query = { limit: '150' }
      const nextFn = createNextFunction()

      await controller.getHistory(
        mockRequest as any,
        mockResponse as any,
        nextFn,
      )

      expect(nextFn).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Limit must be between 1 and 100' }),
      )
    })

    it('should reject negative offset', async () => {
      mockRequest.query = { offset: '-5' }
      const nextFn = createNextFunction()

      await controller.getHistory(
        mockRequest as any,
        mockResponse as any,
        nextFn,
      )

      expect(nextFn).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Offset must be a non-negative number' }),
      )
    })
  })

  describe('withdraw', () => {
    it('should process valid withdrawal request', async () => {
      const withdrawalData = {
        walletAddress: 'GABC1234567890123456789012345678901234567890123456789',
        amount: 50,
        memo: 'Test withdrawal',
      }

      mockRequest.body = withdrawalData
      hasSufficientBalanceSpy.mockReturnValue(true)
      processWithdrawalSpy.mockResolvedValue({
        transactionId: 'txn-withdrawal-123',
        userId: 'user-123',
        amount: 50,
        stellarTxHash: 'stellar-hash-xyz',
        status: 'completed',
        requestedAt: new Date(),
        completedAt: new Date(),
      })
      const nextFn = createNextFunction()

      await controller.withdraw(
        mockRequest as any,
        mockResponse as any,
        nextFn,
      )

      expect(hasSufficientBalanceSpy).toHaveBeenCalledWith(
        'user-123',
        50,
      )
      expect(processWithdrawalSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          walletAddress: withdrawalData.walletAddress,
          amount: 50,
          memo: 'Test withdrawal',
        }),
      )
      expect(statusMock).toHaveBeenCalledWith(201)
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Withdrawal processed successfully',
        }),
      )
    })

    it('should reject withdrawal if wallet address is missing', async () => {
      mockRequest.body = { amount: 50 }
      const nextFn = createNextFunction()

      await controller.withdraw(
        mockRequest as any,
        mockResponse as any,
        nextFn,
      )

      expect(nextFn).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Wallet address is required' }),
      )
    })

    it('should reject withdrawal if amount is missing', async () => {
      mockRequest.body = {
        walletAddress: 'GABC1234567890123456789012345678901234567890123456789',
      }
      const nextFn = createNextFunction()

      await controller.withdraw(
        mockRequest as any,
        mockResponse as any,
        nextFn,
      )

      expect(nextFn).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Amount is required' }),
      )
    })

    it('should reject withdrawal if amount is invalid', async () => {
      mockRequest.body = {
        walletAddress: 'GABC1234567890123456789012345678901234567890123456789',
        amount: 'not-a-number',
      }
      const nextFn = createNextFunction()

      await controller.withdraw(
        mockRequest as any,
        mockResponse as any,
        nextFn,
      )

      expect(nextFn).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Amount must be a valid number' }),
      )
    })

    it('should reject withdrawal if amount is zero or negative', async () => {
      mockRequest.body = {
        walletAddress: 'GABC1234567890123456789012345678901234567890123456789',
        amount: 0,
      }
      const nextFn = createNextFunction()

      await controller.withdraw(
        mockRequest as any,
        mockResponse as any,
        nextFn,
      )

      expect(nextFn).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Amount must be greater than 0' }),
      )

      mockRequest.body = {
        walletAddress: 'GABC1234567890123456789012345678901234567890123456789',
        amount: -10,
      }

      await controller.withdraw(
        mockRequest as any,
        mockResponse as any,
        nextFn,
      )

      expect(nextFn).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Amount must be greater than 0' }),
      )
    })

    it('should reject withdrawal if wallet address format is invalid', async () => {
      mockRequest.body = {
        walletAddress: 'INVALID_ADDRESS',
        amount: 50,
      }
      const nextFn = createNextFunction()

      await controller.withdraw(
        mockRequest as any,
        mockResponse as any,
        nextFn,
      )

      expect(nextFn).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Invalid Stellar wallet address format' }),
      )
    })

    it('should reject withdrawal if insufficient balance', async () => {
      mockRequest.body = {
        walletAddress: 'GABC1234567890123456789012345678901234567890123456789',
        amount: 1000,
      }

      hasSufficientBalanceSpy.mockReturnValue(false)
      getBalanceSpy.mockReturnValue({
        available: 50,
        pending: 0,
        lifetime: 100,
      })
      const nextFn = createNextFunction()

      await controller.withdraw(
        mockRequest as any,
        mockResponse as any,
        nextFn,
      )

      expect(nextFn).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('Insufficient balance') }),
      )
    })

    it('should handle withdrawal failure gracefully', async () => {
      mockRequest.body = {
        walletAddress: 'GABC1234567890123456789012345678901234567890123456789',
        amount: 50,
      }

      hasSufficientBalanceSpy.mockReturnValue(true)
      processWithdrawalSpy.mockRejectedValue(
        new Error('Stellar network error'),
      )
      const nextFn = createNextFunction()

      await controller.withdraw(
        mockRequest as any,
        mockResponse as any,
        nextFn,
      )

      // Wait for async error handling
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(nextFn).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Stellar network error' }),
      )
    })
  })

  describe('isValidStellarAddress', () => {
    it('should validate correct Stellar addresses', () => {
      const validAddresses = [
        'GABC1234567890123456789012345678901234567890123456789',
        'GDXVQR6TVSXFKNSXQWVHZTX4XJY4Z5RKPMYYQ6GQVJHXYZ3ABCDEFGHI',
      ]

      validAddresses.forEach((address) => {
        expect((controller as any).isValidStellarAddress(address)).toBe(true)
      })
    })

    it('should reject invalid Stellar addresses', () => {
      const invalidAddresses = [
        'INVALID',
        'GABC',
        'GABC123',
        'SABC1234567890123456789012345678901234567890123456789',
        '',
      ]

      invalidAddresses.forEach((address) => {
        expect((controller as any).isValidStellarAddress(address)).toBe(false)
      })
    })
  })
})
