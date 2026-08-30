import { describe, expect, it, vi, beforeEach } from 'vitest'
import { WalletStatusController } from '../src/controllers/wallet-status.controller'
import { WalletStatusError } from '../src/types/wallet-status.types'
import type { WalletStatusService } from '../src/services/wallet-status.service'

describe('WalletStatusController', () => {
  let service: {
    getStatus: ReturnType<typeof vi.fn>
    getBalances: ReturnType<typeof vi.fn>
    getHistory: ReturnType<typeof vi.fn>
  }
  let controller: WalletStatusController
  let req: any
  let res: any

  beforeEach(() => {
    service = {
      getStatus: vi.fn(),
      getBalances: vi.fn(),
      getHistory: vi.fn(),
    }
    controller = new WalletStatusController(service as unknown as WalletStatusService)
    req = { user: { id: 'user-1' }, query: {} }
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    }
  })

  describe('getStatus', () => {
    it('reads the wallet for the authenticated caller only', async () => {
      service.getStatus.mockResolvedValue({ status: 'ACTIVE' })

      await controller.getStatus(req, res)

      expect(service.getStatus).toHaveBeenCalledWith('user-1')
      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { status: 'ACTIVE' } })
    })
  })

  describe('getBalances', () => {
    it('returns exact balances on success', async () => {
      const balances = { publicKey: 'GABC', sourceTime: '2026-08-30T00:00:00Z', balances: [] }
      service.getBalances.mockResolvedValue(balances)

      await controller.getBalances(req, res)

      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({ success: true, data: balances })
    })

    it('returns 404 without leaking details when the caller has no active wallet', async () => {
      service.getBalances.mockRejectedValue(new WalletStatusError('WALLET_NOT_FOUND'))

      await controller.getBalances(req, res)

      expect(res.status).toHaveBeenCalledWith(404)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: { code: 'WALLET_NOT_FOUND', message: 'WALLET_NOT_FOUND' },
      })
    })

    it('maps a Horizon timeout to 504', async () => {
      service.getBalances.mockRejectedValue(new WalletStatusError('HORIZON_TIMEOUT', 'timed out'))

      await controller.getBalances(req, res)

      expect(res.status).toHaveBeenCalledWith(504)
    })

    it('maps Horizon unavailability to 503', async () => {
      service.getBalances.mockRejectedValue(new WalletStatusError('HORIZON_UNAVAILABLE', 'down'))

      await controller.getBalances(req, res)

      expect(res.status).toHaveBeenCalledWith(503)
    })

    it('returns 500 for unexpected errors without leaking internals', async () => {
      service.getBalances.mockRejectedValue(new Error('unexpected db failure'))

      await controller.getBalances(req, res)

      expect(res.status).toHaveBeenCalledWith(500)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: { code: 'INTERNAL_SERVER_ERROR' },
      })
    })
  })

  describe('getHistory', () => {
    it('rejects invalid pagination query parameters', async () => {
      req.query = { limit: '0' }

      await controller.getHistory(req, res)

      expect(res.status).toHaveBeenCalledWith(400)
      expect(service.getHistory).not.toHaveBeenCalled()
    })

    it('rejects invalid direction filters', async () => {
      req.query = { direction: 'sideways' }

      await controller.getHistory(req, res)

      expect(res.status).toHaveBeenCalledWith(400)
      expect(service.getHistory).not.toHaveBeenCalled()
    })

    it('returns paginated history with stable cursor metadata', async () => {
      req.query = { cursor: 'abc', limit: '10', direction: 'incoming' }
      service.getHistory.mockResolvedValue({ entries: [{ id: 'op-1' }], nextCursor: 'def' })

      await controller.getHistory(req, res)

      expect(service.getHistory).toHaveBeenCalledWith('user-1', {
        cursor: 'abc',
        limit: 10,
        direction: 'incoming',
      })
      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: [{ id: 'op-1' }],
        meta: { cursor: 'abc', nextCursor: 'def', hasMore: true, limit: 10 },
      })
    })

    it('reports hasMore: false when there is no next cursor', async () => {
      service.getHistory.mockResolvedValue({ entries: [], nextCursor: null })

      await controller.getHistory(req, res)

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ meta: expect.objectContaining({ hasMore: false }) }),
      )
    })
  })
})
