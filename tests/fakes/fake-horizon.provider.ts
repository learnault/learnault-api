import type { AccountBalance, PaymentOptions, PaymentResult, HorizonBalance } from '../../src/services/stellar.service'
import { StellarServiceError } from '../../src/services/stellar.service'

interface FundedAccount {
  publicKey: string
  balances: HorizonBalance[]
  sequence: number
}

export class FakeHorizonProvider {
  readonly accounts = new Map<string, FundedAccount>()
  readonly transactions = new Map<string, { hash: string; ledger: number; successful: boolean; status: string }>()
  readonly payments: Array<{ from: string; to: string; amount: string; memo?: string }> = []
  shouldFailOnPayment = false
  shouldFailOnBalance = false
  shouldFailOnFund = false
  paymentFailureError = 'Payment failed'
  balanceFailureError = 'Balance fetch failed'
  fundFailureError = 'Friendbot funding failed'

  fundAccount(publicKey: string): void {
    if (this.shouldFailOnFund) {
      throw new Error(this.fundFailureError)
    }

    if (!this.accounts.has(publicKey)) {
      this.accounts.set(publicKey, {
        publicKey,
        balances: [
          { asset_type: 'native', balance: '10000.0000000' },
        ],
        sequence: 0,
      })
    } else {
      const account = this.accounts.get(publicKey)!
      const nativeBalance = account.balances.find((b) => b.asset_type === 'native')
      if (nativeBalance) {
        nativeBalance.balance = String(Number(nativeBalance.balance) + 10000)
      }
    }
  }

  async getBalances(publicKey: string): Promise<AccountBalance[]> {
    if (this.shouldFailOnBalance) {
      throw new StellarServiceError(this.balanceFailureError, 'BALANCE_FETCH_ERROR')
    }

    const account = this.accounts.get(publicKey)
    if (!account) {
      throw new StellarServiceError(`Account ${publicKey} not found`, 'BALANCE_FETCH_ERROR')
    }

    return account.balances.map((b) => {
      const assetName =
        b.asset_type === 'native'
          ? 'XLM'
          : `${(b as { asset_code: string }).asset_code}:${(b as { asset_issuer: string }).asset_issuer}`

      return {
        asset: assetName,
        balance: b.balance,
        limit: b.asset_type !== 'native' ? (b as { limit: string }).limit : undefined,
      }
    })
  }

  async getNativeBalance(publicKey: string): Promise<string> {
    const balances = await this.getBalances(publicKey)
    
return balances.find((b) => b.asset === 'XLM')?.balance ?? '0'
  }

  async sendPayment(options: PaymentOptions): Promise<PaymentResult> {
    if (this.shouldFailOnPayment) {
      throw new StellarServiceError(this.paymentFailureError, 'PAYMENT_ERROR')
    }

    const sourceAccount = this.accounts.get(options.sourceSecret)
    if (!sourceAccount) {
      throw new StellarServiceError('Source account not found', 'PAYMENT_ERROR')
    }

    let destinationAccount = this.accounts.get(options.destinationPublicKey)
    if (!destinationAccount) {
      destinationAccount = {
        publicKey: options.destinationPublicKey,
        balances: [{ asset_type: 'native', balance: '0' }],
        sequence: 0,
      }
      this.accounts.set(options.destinationPublicKey, destinationAccount)
    }

    const amount = Number(options.amount)
    const sourceNative = sourceAccount.balances.find((b) => b.asset_type === 'native')
    const destNative = destinationAccount.balances.find((b) => b.asset_type === 'native')

    if (!sourceNative || Number(sourceNative.balance) < amount) {
      throw new StellarServiceError('Insufficient funds', 'PAYMENT_ERROR')
    }

    sourceNative.balance = String(Number(sourceNative.balance) - amount)
    if (destNative) {
      destNative.balance = String(Number(destNative.balance) + amount)
    } else {
      destinationAccount.balances.push({ asset_type: 'native', balance: String(amount) })
    }

    const hash = `tx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const ledger = Date.now()

    this.payments.push({
      from: options.sourceSecret,
      to: options.destinationPublicKey,
      amount: options.amount,
      memo: options.memo,
    })

    this.transactions.set(hash, { hash, ledger, successful: true, status: 'success' })

    return { hash, ledger, successful: true }
  }

async verifyTransaction(hash: string): Promise<boolean> {
    const tx = this.transactions.get(hash)

    return tx?.status === 'success'
  }

  getAccount(publicKey: string): FundedAccount | undefined {
    return this.accounts.get(publicKey)
  }

  clear(): void {
    this.accounts.clear()
    this.transactions.clear()
    this.payments.length = 0
    this.shouldFailOnPayment = false
    this.shouldFailOnBalance = false
    this.shouldFailOnFund = false
  }
}

export const fakeHorizonProvider = new FakeHorizonProvider()