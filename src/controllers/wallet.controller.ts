import { Request, Response } from 'express'
import { stellarService } from '../services/stellar.service'
import { WalletAsset, WalletStatus, WalletTransaction, TransactionDirection, TransactionStatus } from '../types/wallet.types'
import { PaginatedResponse } from '../types/api.types'
import { User } from '../types/user.types'

export class WalletController {
  async getWalletStatus (req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.id
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }

      const user = await this.findUserById(userId)
      if (!user) {
        res.status(404).json({ error: 'User not found' })
        return
      }

      if (!user.walletAddress) {
        res.json({ status: WalletStatus.UNSET })
        return
      }

      const exists = await stellarService.accountExists(user.walletAddress)
      const status = exists ? WalletStatus.ACTIVE : WalletStatus.INACTIVE

      res.json({
        status,
        publicAddress: user.walletAddress,
      })
    } catch {
      res.status(500).json({ error: 'Internal server error' })
    }
  }

  async getWalletBalances (req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.id
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }

      const user = await this.findUserById(userId)
      if (!user) {
        res.status(404).json({ error: 'User not found' })
        return
      }

      if (!user.walletAddress) {
        res.json({
          status: WalletStatus.UNSET,
          balances: [],
        })
        return
      }

      const balances = await stellarService.getBalances(user.walletAddress)
      const walletAssets: WalletAsset[] = balances.map(b => ({
        asset: b.asset,
        issuer: b.issuer,
        amount: b.balance,
        sourceTime: b.sourceTime,
      }))

      const exists = await stellarService.accountExists(user.walletAddress)
      const status = exists ? WalletStatus.ACTIVE : WalletStatus.INACTIVE

      res.json({
        status,
        publicAddress: user.walletAddress,
        balances: walletAssets,
      })
    } catch {
      res.status(500).json({ error: 'Internal server error' })
    }
  }

  async getWalletHistory (req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.id
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }

      const user = await this.findUserById(userId)
      if (!user) {
        res.status(404).json({ error: 'User not found' })
        return
      }

      if (!user.walletAddress) {
        const response: PaginatedResponse<WalletTransaction> = {
          success: true,
          data: [],
          meta: {
            page: 1,
            limit: 20,
            total: 0,
            totalPages: 0,
            hasNextPage: false,
            hasPrevPage: false,
          },
          timestamp: new Date().toISOString(),
        }
        res.json(response)
        return
      }

      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100)
      const cursor = req.query.cursor as string | undefined

      const { payments, nextCursor } = await stellarService.getPaymentHistory(user.walletAddress, limit, cursor)
      const transactions: WalletTransaction[] = await Promise.all(payments.map(async payment => {
        const direction = payment.to === user.walletAddress ? TransactionDirection.INCOMING : TransactionDirection.OUTGOING
        const counterparty = payment.to === user.walletAddress ? payment.from : payment.to
        const asset = payment.assetType === 'native' ? 'XLM' : payment.assetCode || 'XLM'
        const issuer = payment.assetType === 'native' ? undefined : payment.assetIssuer

        let transactionDetails
        try {
          const tx = await stellarService.horizonServer.transactions().transaction(payment.transactionHash).call()
          transactionDetails = tx
        } catch {
          transactionDetails = null
        }

        return {
          hash: payment.transactionHash,
          ledger: transactionDetails?.ledger || 0,
          createdAt: payment.createdAt,
          direction,
          status: transactionDetails?.successful ? TransactionStatus.SUCCESS : TransactionStatus.FAILED,
          amount: payment.amount,
          asset,
          issuer,
          counterparty,
          memo: transactionDetails?.memo,
          memoType: transactionDetails?.memo_type,
        }
      }))

      const response: PaginatedResponse<WalletTransaction> = {
        success: true,
        data: transactions,
        meta: {
          page: 1,
          limit,
          total: transactions.length,
          totalPages: nextCursor ? 2 : 1,
          hasNextPage: !!nextCursor,
          hasPrevPage: !!cursor,
        },
        timestamp: new Date().toISOString(),
      }

      res.json(response)
    } catch {
      res.status(500).json({ error: 'Internal server error' })
    }
  }

  private async findUserById (id: string): Promise<User | null> {
    const mockUser: User = {
      id,
      email: 'test@example.com',
      username: 'testuser',
      firstName: 'Test',
      lastName: 'User',
      bio: 'Test bio',
      avatar: 'https://example.com/avatar.jpg',
      walletAddress: 'GABC123456789012345678901234567890123456789012345678901234567890',
      isActive: true,
      role: 'LEARNER' as any,
      status: 'active' as any,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    return mockUser
  }
}
