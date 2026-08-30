/**
 * stellar.service.ts
 *
 * Service layer for all Stellar blockchain interactions.
 *
 * Compatible with @stellar/stellar-sdk v11.x
 * where the Soroban RPC namespace is `rpc`, not `SorobanRpc`.
 *
 * Env vars:
 *   STELLAR_NETWORK=testnet | mainnet   (default: testnet)
 *   SOROBAN_CONTRACT_ID=C...            (your deployed credential contract)
 */

import {
  Asset,
  BASE_FEE,
  Contract,
  Horizon,
  Keypair,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
} from '@stellar/stellar-sdk'

// ---------------------------------------------------------------------------
// Local type aliases — keeps the rest of the file readable
// ---------------------------------------------------------------------------

export type RpcServer = rpc.Server;
export type SimulateTransactionResponse = rpc.Api.SimulateTransactionResponse;
export type GetTransactionResponse = rpc.Api.GetTransactionResponse;

// ---------------------------------------------------------------------------
// Balance row shape returned from Horizon via rpc.Server.getAccount()
// ---------------------------------------------------------------------------

interface NativeBalance {
  asset_type: 'native';
  balance: string;
}

interface IssuedBalance {
  asset_type: 'credit_alphanum4' | 'credit_alphanum12';
  asset_code: string;
  asset_issuer: string;
  balance: string;
  limit: string;
}

export type HorizonBalance = NativeBalance | IssuedBalance;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface StellarWallet {
  publicKey: string;
  secretKey: string;
}

export interface AccountBalance {
  asset: string;
  balance: string;
  limit?: string;
}

export interface AccountBalanceDetail {
  assetType: 'native' | 'credit_alphanum4' | 'credit_alphanum12';
  assetCode: string;
  issuer: string | null;
  amount: string;
}

export interface AccountSnapshot {
  found: boolean;
  lastModifiedTime: string | null;
  balances: AccountBalanceDetail[];
}

export interface PaymentHistoryRecord {
  id: string;
  pagingToken: string;
  createdAt: string;
  transactionHash: string;
  transactionSuccessful: boolean;
  ledger: number | null;
  type: string;
  from: string | null;
  to: string | null;
  assetType: string;
  assetCode: string;
  issuer: string | null;
  amount: string | null;
  memo: string | null;
  memoType: string | null;
}

export interface PaymentHistoryPage {
  records: PaymentHistoryRecord[];
  nextCursor: string | null;
}

export interface PaymentOptions {
  sourceSecret: string;
  destinationPublicKey: string;
  amount: string;
  asset?: Asset;
  memo?: string;
}

export interface PaymentResult {
  hash: string;
  ledger: number;
  successful: boolean;
}

export interface CredentialData {
  recipientPublicKey: string;
  credentialType: string;
  data: Record<string, unknown>;
  expiresAt?: number;
}

export interface CredentialResult {
  contractId: string;
  transactionHash: string;
  credentialId: string;
}

export interface VerificationResult {
  isValid: boolean;
  credentialId: string;
  issuer: string;
  recipient: string;
  credentialType: string;
  issuedAt: number;
  expiresAt?: number;
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Network configuration
// ---------------------------------------------------------------------------

type NetworkName = 'testnet' | 'mainnet';

const NETWORK_CONFIG: Record<
  NetworkName,
  { networkPassphrase: string; rpcUrl: string; horizonUrl: string }
> = {
  testnet: {
    networkPassphrase: Networks.TESTNET,
    rpcUrl: 'https://soroban-testnet.stellar.org',
    horizonUrl: 'https://horizon-testnet.stellar.org',
  },
  mainnet: {
    networkPassphrase: Networks.PUBLIC,
    rpcUrl: 'https://mainnet.stellar.validationcloud.io/v1/[your-key]',
    horizonUrl: 'https://horizon.stellar.org',
  },
}

// ---------------------------------------------------------------------------
// Custom error
// ---------------------------------------------------------------------------

export class StellarServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'StellarServiceError'
  }
}

// ---------------------------------------------------------------------------
// StellarService
// ---------------------------------------------------------------------------

export class StellarService {
  private readonly server: rpc.Server
  private readonly horizonServer: Horizon.Server
  private readonly networkPassphrase: string
  private readonly contractId: string
  private readonly network: NetworkName

  constructor(
    network: NetworkName = (process.env.STELLAR_NETWORK as NetworkName) ?? 'testnet',
    contractId: string = process.env.SOROBAN_CONTRACT_ID ?? ''
  ) {
    this.network = network
    const config = NETWORK_CONFIG[network]
    this.networkPassphrase = config.networkPassphrase
    this.contractId = contractId

    this.server = new rpc.Server(config.rpcUrl, {
      allowHttp: network === 'testnet',
    })
    this.horizonServer = new Horizon.Server(config.horizonUrl, {
      allowHttp: network === 'testnet',
    })
  }

  // ── Wallet generation ─────────────────────────────────────────────────────

  generateWallet (): StellarWallet {
    try {
      const keypair = Keypair.random()

      return {
        publicKey: keypair.publicKey(),
        secretKey: keypair.secret(),
      }
    } catch (err) {
      throw new StellarServiceError(
        'Failed to generate Stellar wallet',
        'WALLET_GENERATION_ERROR',
        err
      )
    }
  }

  /** Fund a testnet account via Friendbot (testnet only). */
  async fundTestnetAccount (publicKey: string): Promise<void> {
    if (this.network !== 'testnet') {
      throw new StellarServiceError(
        'Friendbot is only available on testnet',
        'INVALID_NETWORK'
      )
    }
    try {
      const res = await fetch(
        `https://friendbot.stellar.org?addr=${encodeURIComponent(publicKey)}`
      )
      if (!res.ok) {
        throw new Error(`Friendbot returned ${res.status}`)
      }
    } catch (err) {
      if (err instanceof StellarServiceError) throw err
      throw new StellarServiceError(
        'Failed to fund testnet account via Friendbot',
        'FRIENDBOT_ERROR',
        err
      )
    }
  }

  // ── Balances ──────────────────────────────────────────────────────────────

  async getBalances (publicKey: string): Promise<AccountBalance[]> {
    try {
      const account = await this.horizonServer.loadAccount(publicKey)

      return account.balances.map((b) => {
        const assetName =
          b.asset_type === 'native'
            ? 'XLM'
            : `${(b as { asset_code: string }).asset_code}:${(b as { asset_issuer: string }).asset_issuer
            }`

        return {
          asset: assetName,
          balance: b.balance,
          limit:
            b.asset_type !== 'native'
              ? (b as { limit: string }).limit
              : undefined,
        }
      })
    } catch (err) {
      throw new StellarServiceError(
        `Failed to fetch balances for ${publicKey}`,
        'BALANCE_FETCH_ERROR',
        err
      )
    }
  }

  async getNativeBalance (publicKey: string): Promise<string> {
    const balances = await this.getBalances(publicKey)

    return balances.find((b) => b.asset === 'XLM')?.balance ?? '0'
  }

  /**
   * Load the account's exact balances plus its Horizon last-modified time.
   * A 404 (account not yet funded on-ledger) is a normal, non-error state and
   * resolves to `found: false` with no balances rather than throwing.
   */
  async getAccountSnapshot (publicKey: string): Promise<AccountSnapshot> {
    try {
      const account = await this.horizonServer.loadAccount(publicKey)
      const balances: AccountBalanceDetail[] = account.balances.map((b) => {
        if (b.asset_type === 'native') {
          return { assetType: 'native', assetCode: 'XLM', issuer: null, amount: b.balance }
        }
        const issued = b as unknown as IssuedBalance

        return {
          assetType: issued.asset_type,
          assetCode: issued.asset_code,
          issuer: issued.asset_issuer,
          amount: issued.balance,
        }
      })

      return {
        found: true,
        lastModifiedTime:
          (account as unknown as { last_modified_time?: string }).last_modified_time ?? null,
        balances,
      }
    } catch (err) {
      if (isHorizonNotFound(err)) {
        return { found: false, lastModifiedTime: null, balances: [] }
      }
      if (isHorizonTimeout(err)) {
        throw new StellarServiceError('Horizon request timed out', 'HORIZON_TIMEOUT', err)
      }
      throw new StellarServiceError('Horizon is unavailable', 'HORIZON_UNAVAILABLE', err)
    }
  }

  /**
   * Cursor-paginated payment history for an account (payments, path payments,
   * and account-creation credits), using Horizon's own paging_token as the
   * cursor so results stay stable under concurrent ledger writes.
   */
  async getPaymentHistory (
    publicKey: string,
    options: { cursor?: string; limit?: number; order?: 'asc' | 'desc' } = {}
  ): Promise<PaymentHistoryPage> {
    const limit = options.limit ?? 20

    try {
      let builder = this.horizonServer
        .payments()
        .forAccount(publicKey)
        .order(options.order ?? 'desc')
        .limit(limit)
        .join('transactions')

      if (options.cursor) builder = builder.cursor(options.cursor)

      const page = await builder.call()
      const relevant = page.records.filter((record) =>
        HISTORY_OPERATION_TYPES.has((record as { type: string }).type)
      )

      return {
        records: relevant.map(toPaymentHistoryRecord),
        nextCursor:
          page.records.length > 0
            ? (page.records[page.records.length - 1] as { paging_token: string }).paging_token
            : null,
      }
    } catch (err) {
      if (isHorizonNotFound(err)) return { records: [], nextCursor: null }
      if (isHorizonTimeout(err)) {
        throw new StellarServiceError('Horizon request timed out', 'HORIZON_TIMEOUT', err)
      }
      throw new StellarServiceError('Horizon is unavailable', 'HORIZON_UNAVAILABLE', err)
    }
  }

  // ── Payments ──────────────────────────────────────────────────────────────

  /** Alias kept for test compatibility. */
  async sendPaymentWithOptions (options: PaymentOptions): Promise<PaymentResult> {
    return this.sendPayment(options)
  }

  async sendPayment (options: PaymentOptions): Promise<PaymentResult> {
    const { sourceSecret, destinationPublicKey, amount, memo } = options
    const asset = options.asset ?? Asset.native()

    try {
      const sourceKeypair = Keypair.fromSecret(sourceSecret)
      const sourcePublicKey = sourceKeypair.publicKey()

      // Load source account (needed for sequence number)
      const sourceAccount = await this.horizonServer.loadAccount(sourcePublicKey)

      // Make sure destination exists (create it if sending XLM and it doesn't exist)
      let destinationExists = true
      try {
        await this.horizonServer.loadAccount(destinationPublicKey)
      } catch {
        destinationExists = false
      }

      const builder = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })

      if (!destinationExists && asset === Asset.native()) {
        builder.addOperation(
          Operation.createAccount({
            destination: destinationPublicKey,
            startingBalance: amount,
          })
        )
      } else {
        builder.addOperation(
          Operation.payment({
            destination: destinationPublicKey,
            asset,
            amount,
          })
        )
      }

      if (memo) builder.addMemo(Memo.text(memo))

      const transaction = builder.setTimeout(30).build()
      transaction.sign(sourceKeypair)

      const response = await this.horizonServer.submitTransaction(transaction)

      if (!response.successful) {
        throw new Error(
          `Transaction failed: ${JSON.stringify(response)}`
        )
      }

      // Poll for confirmation
      const _confirmed = await this.waitForTransaction(response.hash)

      // For regular payments, Horizon response includes ledger
      // For Soroban transactions, we'll need to poll the RPC server
      let ledger = 0
      if ('ledger' in response && response.ledger) {
        ledger = response.ledger
      } else {
        // Try to get from RPC server for Soroban transactions
        try {
          const rpcResult = await this.waitForTransaction(response.hash)
          if ('ledger' in rpcResult && rpcResult.ledger) {
            ledger = rpcResult.ledger
          }
        } catch {
          // Fallback to 0 if we can't get the ledger
          ledger = 0
        }
      }

      return {
        hash: response.hash,
        ledger: ledger,
        successful: response.successful,
      }
    } catch (err) {
      if (err instanceof StellarServiceError) throw err
      throw new StellarServiceError(
        'Payment transaction failed',
        'PAYMENT_ERROR',
        err
      )
    }
  }

  // ── Credential issuance ───────────────────────────────────────────────────

  async issueCredential (
    issuerSecret: string,
    credential: CredentialData
  ): Promise<CredentialResult> {
    if (!this.contractId) {
      throw new StellarServiceError(
        'No Soroban contract ID configured',
        'CONTRACT_NOT_CONFIGURED'
      )
    }

    try {
      const issuerKeypair = Keypair.fromSecret(issuerSecret)
      const issuerAccount = await this.horizonServer.loadAccount(
        issuerKeypair.publicKey()
      )

      const contract = new Contract(this.contractId)

      const args = [
        nativeToScVal(credential.recipientPublicKey, { type: 'address' }),
        nativeToScVal(credential.credentialType, { type: 'string' }),
        nativeToScVal(JSON.stringify(credential.data), { type: 'string' }),
        nativeToScVal(credential.expiresAt ?? 0, { type: 'u64' }),
      ]

      const transaction = new TransactionBuilder(issuerAccount, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(contract.call('issue_credential', ...args))
        .setTimeout(30)
        .build()

      const simResult: SimulateTransactionResponse =
        await this.server.simulateTransaction(transaction)

      if (rpc.Api.isSimulationError(simResult)) {
        throw new Error(`Simulation failed: ${simResult.error}`)
      }

      // assembleTransaction lives on the `rpc` namespace in v11
      const assembledTx = rpc.assembleTransaction(transaction, simResult).build()
      assembledTx.sign(issuerKeypair)

      const sendResult = await this.server.sendTransaction(assembledTx)
      const confirmed = await this.waitForTransaction(sendResult.hash)

      return {
        contractId: this.contractId,
        transactionHash: sendResult.hash,
        credentialId: this.extractReturnValue(confirmed),
      }
    } catch (err) {
      if (err instanceof StellarServiceError) throw err
      throw new StellarServiceError(
        'Credential issuance failed',
        'CREDENTIAL_ISSUANCE_ERROR',
        err
      )
    }
  }

  // ── Credential verification ───────────────────────────────────────────────

  async verifyCredential (credentialId: string): Promise<VerificationResult> {
    if (!this.contractId) {
      throw new StellarServiceError(
        'No Soroban contract ID configured',
        'CONTRACT_NOT_CONFIGURED'
      )
    }

    try {
      const contract = new Contract(this.contractId)
      const operation = contract.call(
        'verify_credential',
        nativeToScVal(credentialId, { type: 'string' })
      )

      // For read-only calls we simulate without signing
      const dummyAccount = await this.horizonServer.loadAccount(
        // Use a well-known testnet account for simulation if no source available
        'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN'
      )

      const tx = new TransactionBuilder(dummyAccount, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(operation)
        .setTimeout(30)
        .build()

      const simResult: SimulateTransactionResponse =
        await this.server.simulateTransaction(tx)

      if (rpc.Api.isSimulationError(simResult)) {
        throw new Error(`Verification simulation failed: ${simResult.error}`)
      }

      const returnVal =
        rpc.Api.isSimulationSuccess(simResult) && simResult.result
          ? scValToNative(simResult.result.retval)
          : null

      if (!returnVal) {
        return {
          isValid: false,
          credentialId,
          issuer: '',
          recipient: '',
          credentialType: '',
          issuedAt: 0,
          data: {},
        }
      }

      const parsed = returnVal as Record<string, unknown>

      return {
        isValid: true,
        credentialId,
        issuer: String(parsed.issuer ?? ''),
        recipient: String(parsed.recipient ?? ''),
        credentialType: String(parsed.credential_type ?? ''),
        issuedAt: Number(parsed.issued_at ?? 0),
        expiresAt: parsed.expires_at ? Number(parsed.expires_at) : undefined,
        data: parsed.data ? JSON.parse(String(parsed.data)) : {},
      }
    } catch (err) {
      if (err instanceof StellarServiceError) throw err
      throw new StellarServiceError(
        'Credential verification failed',
        'CREDENTIAL_VERIFICATION_ERROR',
        err
      )
    }
  }

  // ── Transaction status check ──────────────────────────────────────────────

  async verifyTransaction (hash: string): Promise<boolean> {
    try {
      const result = await this.server.getTransaction(hash)

      return result.status === rpc.Api.GetTransactionStatus.SUCCESS
    } catch (err) {
      throw new StellarServiceError(
        `Failed to verify transaction ${hash}`,
        'TRANSACTION_VERIFY_ERROR',
        err
      )
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async waitForTransaction (
    hash: string,
    maxAttempts = 20,
    intervalMs = 2000
  ): Promise<rpc.Api.GetTransactionResponse> {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, intervalMs))
      const result = await this.server.getTransaction(hash)

      if (result.status !== rpc.Api.GetTransactionStatus.NOT_FOUND) {
        return result
      }
    }
    throw new StellarServiceError(
      `Transaction ${hash} not confirmed after ${maxAttempts} attempts`,
      'TRANSACTION_TIMEOUT'
    )
  }

  private extractReturnValue (
    txResult: rpc.Api.GetTransactionResponse
  ): string {
    try {
      if (
        txResult.status === rpc.Api.GetTransactionStatus.SUCCESS &&
        txResult.returnValue
      ) {
        const native = scValToNative(txResult.returnValue)

        return String(native)
      }
    } catch {
      // fall through
    }

    return `cred_${Date.now()}`
  }
}

// ---------------------------------------------------------------------------
// Payment history helpers
// ---------------------------------------------------------------------------

const HISTORY_OPERATION_TYPES = new Set([
  'payment',
  'create_account',
  'path_payment_strict_receive',
  'path_payment_strict_send',
])

const MAX_MEMO_LENGTH = 256

/** Text memos are free-form user input; hash/id/return memos are opaque public identifiers already. */
function applyMemoPolicy (memoType: string | null, memo: string | null): string | null {
  if (!memo) return null
  if (memoType === 'text') {
    // eslint-disable-next-line no-control-regex
    const sanitized = memo.replace(/[\x00-\x1F\x7F]/g, '').slice(0, MAX_MEMO_LENGTH)

    return sanitized.length > 0 ? sanitized : null
  }

  return memo
}

function toPaymentHistoryRecord (record: unknown): PaymentHistoryRecord {
  const r = record as Record<string, unknown>
  const transaction = (r.transaction ?? undefined) as Record<string, unknown> | undefined
  const memoType = (transaction?.memo_type as string | undefined) ?? null
  const rawMemo = (transaction?.memo as string | undefined) ?? null
  const assetType = (r.asset_type as string | undefined) ?? 'native'

  return {
    id: String(r.id),
    pagingToken: String(r.paging_token),
    createdAt: String(r.created_at),
    transactionHash: String(r.transaction_hash),
    transactionSuccessful: r.transaction_successful !== false,
    ledger: typeof transaction?.ledger_attr === 'number' ? (transaction.ledger_attr as number) : null,
    type: String(r.type),
    from: (r.from as string | undefined) ?? (r.funder as string | undefined) ?? null,
    to: (r.to as string | undefined) ?? (r.account as string | undefined) ?? null,
    assetType,
    assetCode: assetType === 'native' ? 'XLM' : String(r.asset_code ?? ''),
    issuer: (r.asset_issuer as string | undefined) ?? null,
    amount: (r.amount as string | undefined) ?? (r.starting_balance as string | undefined) ?? null,
    memo: applyMemoPolicy(memoType, rawMemo),
    memoType,
  }
}

function isHorizonNotFound (err: unknown): boolean {
  const status = (err as { response?: { status?: number } } | undefined)?.response?.status

  return status === 404
}

function isHorizonTimeout (err: unknown): boolean {
  const code = (err as { code?: string } | undefined)?.code
  const name = (err as { name?: string } | undefined)?.name
  const message = err instanceof Error ? err.message.toLowerCase() : ''

  return (
    code === 'ETIMEDOUT' ||
    code === 'ECONNABORTED' ||
    name === 'TimeoutError' ||
    message.includes('timeout')
  )
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const stellarService = new StellarService()