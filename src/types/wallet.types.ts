export enum WalletStatus {
  UNSET = 'unset',
  INACTIVE = 'inactive',
  ACTIVE = 'active',
  ERROR = 'error',
}

export interface WalletAsset {
  asset: string;
  issuer?: string;
  amount: string;
  sourceTime?: string;
}

export enum TransactionDirection {
  INCOMING = 'incoming',
  OUTGOING = 'outgoing',
}

export enum TransactionStatus {
  SUCCESS = 'success',
  FAILED = 'failed',
  PENDING = 'pending',
}

export interface WalletTransaction {
  hash: string;
  ledger: number;
  createdAt: string;
  direction: TransactionDirection;
  status: TransactionStatus;
  amount: string;
  asset: string;
  issuer?: string;
  counterparty: string;
  memo?: string;
  memoType?: string;
}

export interface WalletStatusResponse {
  status: WalletStatus;
  publicAddress?: string;
}

export interface WalletBalancesResponse {
  status: WalletStatus;
  publicAddress?: string;
  balances: WalletAsset[];
}

