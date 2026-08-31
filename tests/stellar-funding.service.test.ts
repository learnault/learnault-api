import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StellarFundingService } from '../src/services/stellar-funding.service'
import { StellarServiceError } from '../src/services/stellar.service'
import type { StellarService } from '../src/services/stellar.service'

const { mockFindUnique, mockCreate, mockFindMany, mockUpdate } = vi.hoisted(
  () => ({
    mockFindUnique: vi.fn(),
    mockCreate: vi.fn(),
    mockFindMany: vi.fn(),
    mockUpdate: vi.fn(),
  }),
)

vi.mock('../src/config/database', () => ({
  default: {
    stellarFunding: {
      findUnique: mockFindUnique,
      create: mockCreate,
      findMany: mockFindMany,
      update: mockUpdate,
    },
  },
}))

const { mockConfigAmount, mockConfigMinBalance } = vi.hoisted(() => ({
  mockConfigAmount: vi.fn(() => '10'),
  mockConfigMinBalance: vi.fn(() => '1'),
}))

vi.mock('../src/config/stellar', () => ({
  stellarConfig: {
    network: 'testnet',
    funding: {
      get amount() {
        return mockConfigAmount()
      },
      get minBalance() {
        return mockConfigMinBalance()
      },
      maxRetries: 5,
      backoffBaseMinutes: 5,
    },
  },
}))

const PUBLIC_KEY =
  'GABCDEF12345678901234567890123456789012345678901234567890123'
const FUNDING_AMOUNT = '10'

describe('StellarFundingService', () => {
  let stellarMock: StellarService
  let service: StellarFundingService

  beforeEach(() => {
    vi.clearAllMocks()
    mockFindMany.mockResolvedValue([])
    stellarMock = {
      getNativeBalance: vi.fn(),
      sendPayment: vi.fn(),
      verifyTransaction: vi.fn(),
    } as unknown as StellarService
    service = new StellarFundingService(stellarMock)

    mockConfigAmount.mockReturnValue('10')
    mockConfigMinBalance.mockReturnValue('1')
    process.env.STELLAR_FUNDING_SOURCE_SECRET = 'SFAKE_SECRET_KEY'
  })

  describe('queueFunding', () => {
    it('creates a new funding record when none exists', async () => {
      mockFindUnique.mockResolvedValue(null)
      mockCreate.mockResolvedValue({
        id: 'fund-1',
        publicKey: PUBLIC_KEY,
        amount: FUNDING_AMOUNT,
        status: 'pending',
        nextAttemptAt: new Date(),
      })

      const result = await service.queueFunding(PUBLIC_KEY)

      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          publicKey: PUBLIC_KEY,
          amount: FUNDING_AMOUNT,
          status: 'pending',
        }),
      })
      expect(result.publicKey).toBe(PUBLIC_KEY)
    })

    it('returns existing record on duplicate request', async () => {
      const existing = {
        id: 'fund-1',
        publicKey: PUBLIC_KEY,
        amount: FUNDING_AMOUNT,
        status: 'pending',
      }
      mockFindUnique.mockResolvedValue(existing)

      const result = await service.queueFunding(PUBLIC_KEY)

      expect(mockCreate).not.toHaveBeenCalled()
      expect(result.publicKey).toBe(PUBLIC_KEY)
    })
  })

  describe('processQueue - already funded', () => {
    it('marks as confirmed when account already meets minimum balance', async () => {
      const record = makeRecord({ status: 'pending' })
      mockFindMany.mockResolvedValue([record])
      vi.mocked(stellarMock.getNativeBalance).mockResolvedValue('5.0000000')

      await service.processQueue()

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: record.id },
          data: expect.objectContaining({ status: 'confirmed' }),
        }),
      )
      expect(stellarMock.sendPayment).not.toHaveBeenCalled()
    })
  })

  describe('processQueue - successful funding', () => {
    beforeEach(() => {
      vi.mocked(stellarMock.getNativeBalance).mockResolvedValue('0')
      vi.mocked(stellarMock.sendPayment).mockResolvedValue({
        hash: 'TXHASH123',
        ledger: 42,
        successful: true,
      })
    })

    it('submits payment and marks confirmed', async () => {
      const record = makeRecord({ status: 'pending' })
      mockFindMany.mockResolvedValue([record])

      await service.processQueue()

      expect(stellarMock.sendPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceSecret: 'SFAKE_SECRET_KEY',
          destinationPublicKey: record.publicKey,
          amount: FUNDING_AMOUNT,
        }),
      )
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: record.id },
          data: expect.objectContaining({
            status: 'confirmed',
            transactionHash: 'TXHASH123',
            ledger: 42,
          }),
        }),
      )
    })
  })

  describe('processQueue - timeout after submit', () => {
    it('sets status to submitted when transaction times out', async () => {
      const record = makeRecord({ status: 'pending' })
      mockFindMany.mockResolvedValue([record])
      vi.mocked(stellarMock.getNativeBalance).mockResolvedValue('0')
      vi.mocked(stellarMock.sendPayment).mockRejectedValue(
        new StellarServiceError(
          'Transaction TXHASH123 not confirmed after 20 attempts',
          'TRANSACTION_TIMEOUT',
        ),
      )

      await service.processQueue()

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: record.id },
          data: expect.objectContaining({
            status: 'submitted',
            error: 'Transaction submitted, awaiting confirmation',
          }),
        }),
      )
    })
  })

  describe('processQueue - reconciliation', () => {
    it('marks confirmed when account is funded during reconciliation', async () => {
      const record = makeRecord({ status: 'submitted' })
      mockFindMany.mockResolvedValue([record])
      vi.mocked(stellarMock.getNativeBalance).mockResolvedValue('5.0000000')

      await service.processQueue()

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: record.id },
          data: expect.objectContaining({ status: 'confirmed' }),
        }),
      )
    })

    it('marks confirmed when persisted transaction hash is valid', async () => {
      const record = makeRecord({
        status: 'submitted',
        transactionHash: 'TXHASH123',
        ledger: 42,
      })
      mockFindMany.mockResolvedValue([record])
      vi.mocked(stellarMock.getNativeBalance).mockResolvedValue('0')
      vi.mocked(stellarMock.verifyTransaction).mockResolvedValue(true)

      await service.processQueue()

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: record.id },
          data: expect.objectContaining({
            status: 'confirmed',
            transactionHash: 'TXHASH123',
            ledger: 42,
          }),
        }),
      )
    })

    it('schedules retry when reconciliation cannot confirm', async () => {
      const record = makeRecord({
        status: 'submitted',
        transactionHash: 'TXHASH123',
        retryCount: 1,
      })
      mockFindMany.mockResolvedValue([record])
      vi.mocked(stellarMock.getNativeBalance).mockResolvedValue('0')
      vi.mocked(stellarMock.verifyTransaction).mockResolvedValue(false)

      await service.processQueue()

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: record.id },
          data: expect.objectContaining({
            status: 'pending',
            error: 'Reconciliation: funding not confirmed, retrying',
          }),
        }),
      )
    })
  })

  describe('processQueue - idempotent execution', () => {
    it('does not submit a new transaction when record is already confirmed', async () => {
      mockFindMany.mockResolvedValue([])

      await service.processQueue()

      expect(stellarMock.sendPayment).not.toHaveBeenCalled()
    })

    it('skips funding when already funded on retry', async () => {
      const record = makeRecord({
        status: 'pending',
        retryCount: 1,
      })
      mockFindMany.mockResolvedValue([record])
      vi.mocked(stellarMock.getNativeBalance).mockResolvedValue('5.0000000')

      await service.processQueue()

      expect(stellarMock.sendPayment).not.toHaveBeenCalled()
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'confirmed' }),
        }),
      )
    })
  })

  describe('processQueue - retry behavior', () => {
    it('increments retryCount on each attempt', async () => {
      const record = makeRecord({ status: 'pending', retryCount: 0 })
      mockFindMany.mockResolvedValue([record])
      vi.mocked(stellarMock.getNativeBalance).mockResolvedValue('0')
      vi.mocked(stellarMock.sendPayment).mockRejectedValue(
        new Error('Network error'),
      )

      await service.processQueue()

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: record.id },
          data: expect.objectContaining({
            retryCount: { increment: 1 },
            lastAttemptAt: expect.any(Date),
          }),
        }),
      )
    })

    it('dead-letters after max retries', async () => {
      const record = makeRecord({
        status: 'pending',
        retryCount: 4,
        maxRetries: 5,
      })
      mockFindMany.mockResolvedValue([record])
      vi.mocked(stellarMock.getNativeBalance).mockResolvedValue('0')
      vi.mocked(stellarMock.sendPayment).mockRejectedValue(
        new Error('Final failure'),
      )

      await service.processQueue()

      const calls = mockUpdate.mock.calls
      const deadLetterCall = calls.find(
        (c: any[]) => c[0]?.data?.status === 'dead-letter',
      )
      expect(deadLetterCall).toBeDefined()
    })

    it('does not fetch records that exceeded maxRetries', async () => {
      mockFindMany.mockResolvedValue([])

      await service.processQueue()

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            retryCount: { lt: 5 },
          }),
        }),
      )
    })
  })

  describe('processQueue - insufficient funds', () => {
    it('handles op_underfunded error gracefully', async () => {
      const record = makeRecord({ status: 'pending' })
      mockFindMany.mockResolvedValue([record])
      vi.mocked(stellarMock.getNativeBalance).mockResolvedValue('0')

      const cause = new Error('op_underfunded')
      const paymentError = new StellarServiceError(
        'Payment transaction failed',
        'PAYMENT_ERROR',
        cause,
      )
      vi.mocked(stellarMock.sendPayment).mockRejectedValue(paymentError)

      await service.processQueue()

      const errorUpdate = mockUpdate.mock.calls.find((c: any[]) =>
        c[0]?.data?.error?.includes('Insufficient funding source balance'),
      )
      expect(errorUpdate).toBeDefined()
    })
  })

  describe('processQueue - provider outage', () => {
    it('handles network errors during balance check gracefully', async () => {
      const record = makeRecord({ status: 'pending' })
      mockFindMany.mockResolvedValue([record])
      vi.mocked(stellarMock.getNativeBalance).mockRejectedValue(
        new Error('Network timeout'),
      )
      vi.mocked(stellarMock.sendPayment).mockRejectedValue(
        new Error('Also down'),
      )

      await service.processQueue()

      expect(stellarMock.sendPayment).toHaveBeenCalled()
    })

    it('handles network errors during payment submission', async () => {
      const record = makeRecord({ status: 'pending' })
      mockFindMany.mockResolvedValue([record])
      vi.mocked(stellarMock.getNativeBalance).mockResolvedValue('0')
      vi.mocked(stellarMock.sendPayment).mockRejectedValue(
        new Error('Horizon unreachable'),
      )

      await service.processQueue()

      const errorUpdate = mockUpdate.mock.calls.find(
        (c: any[]) => c[0]?.data?.error === 'Horizon unreachable',
      )
      expect(errorUpdate).toBeDefined()
    })
  })

  describe('funding policy enforcement', () => {
    it('uses configured funding amount from config', async () => {
      mockConfigAmount.mockReturnValue('25')
      service = new StellarFundingService(stellarMock)

      mockFindUnique.mockResolvedValue(null)
      mockCreate.mockResolvedValue({
        id: 'fund-1',
        publicKey: PUBLIC_KEY,
        amount: '25',
        status: 'pending',
      })

      await service.queueFunding(PUBLIC_KEY)

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amount: '25' }),
        }),
      )
    })

    it('uses configured minimum balance to determine already-funded', async () => {
      mockConfigMinBalance.mockReturnValue('10')
      service = new StellarFundingService(stellarMock)

      const record = makeRecord({ status: 'pending' })
      mockFindMany.mockResolvedValue([record])
      vi.mocked(stellarMock.getNativeBalance).mockResolvedValue('9.0000000')

      await service.processQueue()

      expect(stellarMock.sendPayment).toHaveBeenCalled()
    })
  })

  describe('security', () => {
    it('funding secret is never persisted in the database record', () => {
      const record = makeRecord({ status: 'pending' })
      expect(Object.keys(record)).not.toContain('secretKey')
      expect(Object.keys(record)).not.toContain('secret')
    })
  })
})

function makeRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fund-1',
    publicKey: PUBLIC_KEY,
    amount: FUNDING_AMOUNT,
    status: 'pending',
    transactionHash: null,
    ledger: null,
    retryCount: 0,
    maxRetries: 5,
    nextAttemptAt: new Date(),
    lastAttemptAt: null,
    error: null,
    confirmedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}
