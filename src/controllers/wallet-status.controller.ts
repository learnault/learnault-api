import type { Request, Response } from 'express'
import type { WalletStatusService } from '../services/wallet-status.service'
import { WalletStatusError } from '../types/wallet-status.types'
import { walletHistoryQuerySchema } from '../schemas/wallet-status.schema'
import logger from '../utils/logger'

const PROVIDER_ERROR_STATUS: Record<string, number> = {
  WALLET_NOT_FOUND: 404,
  HORIZON_TIMEOUT: 504,
  HORIZON_UNAVAILABLE: 503,
}

/** Only ever reads the caller's own wallet — no address parameter is accepted. */
export class WalletStatusController {
  constructor(private readonly service: WalletStatusService) {}

  getStatus = async (req: Request, res: Response): Promise<void> => {
    try {
      const status = await this.service.getStatus(req.user!.id)
      res.status(200).json({ success: true, data: status })
    } catch (error) {
      this.respondWithError(res, error)
    }
  }

  getBalances = async (req: Request, res: Response): Promise<void> => {
    try {
      const balances = await this.service.getBalances(req.user!.id)
      res.status(200).json({ success: true, data: balances })
    } catch (error) {
      this.respondWithError(res, error)
    }
  }

  getHistory = async (req: Request, res: Response): Promise<void> => {
    const parsed = walletHistoryQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', details: parsed.error.format() },
      })

      return
    }

    try {
      const { entries, nextCursor } = await this.service.getHistory(req.user!.id, parsed.data)
      res.status(200).json({
        success: true,
        data: entries,
        meta: {
          cursor: parsed.data.cursor,
          nextCursor,
          hasMore: nextCursor !== null,
          limit: parsed.data.limit,
        },
      })
    } catch (error) {
      this.respondWithError(res, error)
    }
  }

  private respondWithError(res: Response, error: unknown): void {
    if (error instanceof WalletStatusError) {
      const statusCode = PROVIDER_ERROR_STATUS[error.code] ?? 500
      res.status(statusCode).json({ success: false, error: { code: error.code, message: error.message } })

      return
    }

    logger.error('[WalletStatusController] Unexpected error:', error)
    res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR' } })
  }
}
