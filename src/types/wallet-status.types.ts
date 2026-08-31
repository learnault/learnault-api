export type WalletStatusValue =
  'NOT_PROVISIONED' | 'PENDING' | 'ACTIVE' | 'UNAVAILABLE'

export interface WalletStatusView {
  status: WalletStatusValue
  network: string | null
  custody: string | null
  publicKey: string | null
  provisionedAt: string | null
}

export interface WalletBalanceView {
  assetType: 'native' | 'credit_alphanum4' | 'credit_alphanum12'
  assetCode: string
  issuer: string | null
  amount: string
}

export interface WalletBalancesView {
  publicKey: string
  sourceTime: string | null
  balances: WalletBalanceView[]
}

export type WalletHistoryDirection = 'incoming' | 'outgoing'
export type WalletHistoryFilter = 'all' | WalletHistoryDirection

export interface WalletHistoryEntry {
  id: string
  direction: WalletHistoryDirection
  status: 'success' | 'failed'
  assetType: string
  assetCode: string
  issuer: string | null
  amount: string | null
  transactionHash: string
  ledger: number | null
  createdAt: string
  memo: string | null
  memoType: string | null
}

export interface WalletHistoryQueryOptions {
  cursor?: string
  limit?: number
  direction?: WalletHistoryFilter
}

export interface WalletHistoryPageView {
  entries: WalletHistoryEntry[]
  nextCursor: string | null
}

export type WalletStatusErrorCode =
  'WALLET_NOT_FOUND' | 'HORIZON_TIMEOUT' | 'HORIZON_UNAVAILABLE'

export class WalletStatusError extends Error {
  constructor(
    readonly code: WalletStatusErrorCode,
    message?: string,
  ) {
    super(message ?? code)
    this.name = 'WalletStatusError'
  }
}
