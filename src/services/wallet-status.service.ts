import type { WalletProvisioningRepository } from './wallet-provisioning.repository'
import type { AccountSnapshot, PaymentHistoryPage } from './stellar.service'
import { StellarServiceError } from './stellar.service'
import type { WalletRecord } from '../types/wallet-provisioning.types'
import {
  WalletStatusError,
  type WalletBalancesView,
  type WalletHistoryDirection,
  type WalletHistoryPageView,
  type WalletHistoryQueryOptions,
  type WalletStatusView,
} from '../types/wallet-status.types'

const DEFAULT_HISTORY_LIMIT = 20

/** The subset of StellarService this orchestration layer depends on. */
export interface WalletStatusStellarProvider {
  getAccountSnapshot(publicKey: string): Promise<AccountSnapshot>
  getPaymentHistory(
    publicKey: string,
    options?: { cursor?: string; limit?: number; order?: 'asc' | 'desc' },
  ): Promise<PaymentHistoryPage>
}

/** Orchestrates the current user's wallet status, balances, and history. Never accepts an arbitrary address. */
export class WalletStatusService {
  constructor(
    private readonly repository: WalletProvisioningRepository,
    private readonly stellar: WalletStatusStellarProvider,
  ) {}

  async getStatus(userId: string): Promise<WalletStatusView> {
    const wallet = await this.repository.getByUserId(userId)
    if (!wallet) {
      return {
        status: 'NOT_PROVISIONED',
        network: null,
        custody: null,
        publicKey: null,
        provisionedAt: null,
      }
    }

    return {
      status: toStatusValue(wallet.status),
      network: wallet.network,
      custody: wallet.custody,
      publicKey: wallet.status === 'ACTIVE' ? wallet.publicKey : null,
      provisionedAt: wallet.provisionedAt
        ? wallet.provisionedAt.toISOString()
        : null,
    }
  }

  async getBalances(userId: string): Promise<WalletBalancesView> {
    const wallet = await this.requireActiveWallet(userId)
    const snapshot = await this.wrapProviderErrors(() =>
      this.stellar.getAccountSnapshot(wallet.publicKey!),
    )

    return {
      publicKey: wallet.publicKey!,
      sourceTime: snapshot.lastModifiedTime,
      balances: snapshot.balances,
    }
  }

  async getHistory(
    userId: string,
    options: WalletHistoryQueryOptions,
  ): Promise<WalletHistoryPageView> {
    const wallet = await this.requireActiveWallet(userId)
    const publicKey = wallet.publicKey!
    const limit = options.limit ?? DEFAULT_HISTORY_LIMIT
    const direction = options.direction ?? 'all'

    const page = await this.wrapProviderErrors(() =>
      this.stellar.getPaymentHistory(publicKey, {
        cursor: options.cursor,
        limit,
      }),
    )

    const entries = page.records
      .map((record) => ({
        id: record.id,
        direction: (record.to === publicKey
          ? 'incoming'
          : 'outgoing') as WalletHistoryDirection,
        status: (record.transactionSuccessful ? 'success' : 'failed') as
          'success' | 'failed',
        assetType: record.assetType,
        assetCode: record.assetCode,
        issuer: record.issuer,
        amount: record.amount,
        transactionHash: record.transactionHash,
        ledger: record.ledger,
        createdAt: record.createdAt,
        memo: record.memo,
        memoType: record.memoType,
      }))
      .filter((entry) => direction === 'all' || entry.direction === direction)

    return { entries, nextCursor: page.nextCursor }
  }

  private async requireActiveWallet(userId: string): Promise<WalletRecord> {
    const wallet = await this.repository.getByUserId(userId)
    if (!wallet || wallet.status !== 'ACTIVE' || !wallet.publicKey) {
      throw new WalletStatusError('WALLET_NOT_FOUND')
    }

    return wallet
  }

  private async wrapProviderErrors<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (err) {
      if (
        err instanceof StellarServiceError &&
        (err.code === 'HORIZON_TIMEOUT' || err.code === 'HORIZON_UNAVAILABLE')
      ) {
        throw new WalletStatusError(err.code, err.message)
      }
      throw err
    }
  }
}

function toStatusValue(
  walletStatus: WalletRecord['status'],
): WalletStatusView['status'] {
  if (walletStatus === 'ACTIVE') return 'ACTIVE'
  if (walletStatus === 'DISABLED' || walletStatus === 'FAILED')
    return 'UNAVAILABLE'

  return 'PENDING'
}
