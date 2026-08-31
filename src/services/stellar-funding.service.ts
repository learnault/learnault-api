import prisma from '../config/database'
import { stellarConfig } from '../config/stellar'
import { StellarService, StellarServiceError } from './stellar.service'

interface StellarFundingRecord {
  id: string
  publicKey: string
  amount: string
  status: string
  transactionHash: string | null
  ledger: number | null
  retryCount: number
  maxRetries: number
  nextAttemptAt: Date | null
  lastAttemptAt: Date | null
  error: string | null
  confirmedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export class StellarFundingService {
  private stellarService: StellarService

  constructor(stellarService?: StellarService) {
    this.stellarService = stellarService ?? new StellarService()
  }

  async queueFunding(publicKey: string): Promise<StellarFundingRecord> {
    const existing = await prisma.stellarFunding.findUnique({
      where: { publicKey },
    })

    if (existing) {
      return existing as unknown as StellarFundingRecord
    }

    const funding = await prisma.stellarFunding.create({
      data: {
        publicKey,
        amount: stellarConfig.funding.amount,
        status: 'pending',
        nextAttemptAt: new Date(),
      },
    })

    return funding as unknown as StellarFundingRecord
  }

  async processQueue(): Promise<void> {
    const pending = await prisma.stellarFunding.findMany({
      where: {
        status: { in: ['pending', 'submitted'] },
        nextAttemptAt: { lte: new Date() },
        retryCount: { lt: stellarConfig.funding.maxRetries },
      },
    })

    for (const record of pending) {
      await this.processFunding(record as unknown as StellarFundingRecord)
    }
  }

  private async processFunding(record: StellarFundingRecord): Promise<void> {
    await prisma.stellarFunding.update({
      where: { id: record.id },
      data: { retryCount: { increment: 1 }, lastAttemptAt: new Date() },
    })

    if (record.status === 'submitted') {
      await this.reconcile(record)

      return
    }

    const alreadyFunded = await this.checkAlreadyFunded(record)
    if (alreadyFunded) return

    const sourceSecret = process.env.STELLAR_FUNDING_SOURCE_SECRET
    if (!sourceSecret) {
      await this.handleFailure(record, 'Funding source secret not configured')

      return
    }

    try {
      const result = await this.stellarService.sendPayment({
        sourceSecret,
        destinationPublicKey: record.publicKey,
        amount: record.amount,
        memo: 'Account funding',
      })

      await this.markConfirmed(record, result.hash, result.ledger)
    } catch (err) {
      if (err instanceof StellarServiceError) {
        if (err.code === 'TRANSACTION_TIMEOUT') {
          await prisma.stellarFunding.update({
            where: { id: record.id },
            data: {
              status: 'submitted',
              error: 'Transaction submitted, awaiting confirmation',
            },
          })

          return
        }

        if (
          err.code === 'PAYMENT_ERROR' &&
          this.isInsufficientFundsError(err)
        ) {
          await this.handleFailure(
            record,
            'Insufficient funding source balance',
          )

          return
        }
      }

      const message = err instanceof Error ? err.message : 'Funding failed'
      await this.handleFailure(record, message)
    }
  }

  private async reconcile(record: StellarFundingRecord): Promise<void> {
    const alreadyFunded = await this.checkAlreadyFunded(record)
    if (alreadyFunded) return

    if (record.transactionHash) {
      try {
        const succeeded = await this.stellarService.verifyTransaction(
          record.transactionHash,
        )
        if (succeeded) {
          await this.markConfirmed(
            record,
            record.transactionHash,
            record.ledger ?? undefined,
          )

          return
        }
      } catch {
        // verification failed, fall through to retry
      }
    }

    await this.handleFailure(
      record,
      'Reconciliation: funding not confirmed, retrying',
    )
  }

  private async checkAlreadyFunded(
    record: StellarFundingRecord,
  ): Promise<boolean> {
    try {
      const balance = await this.stellarService.getNativeBalance(
        record.publicKey,
      )
      if (parseFloat(balance) >= parseFloat(stellarConfig.funding.minBalance)) {
        await this.markConfirmed(record)

        return true
      }
    } catch {
      // balance check failed, continue to submit
    }

    return false
  }

  private async markConfirmed(
    record: StellarFundingRecord,
    transactionHash?: string,
    ledger?: number,
  ): Promise<void> {
    const data: Record<string, unknown> = {
      status: 'confirmed',
      confirmedAt: new Date(),
    }
    if (transactionHash) data.transactionHash = transactionHash
    if (ledger !== undefined) data.ledger = ledger

    await prisma.stellarFunding.update({
      where: { id: record.id },
      data,
    })
  }

  private async handleFailure(
    record: StellarFundingRecord,
    error: string,
  ): Promise<void> {
    const nextAttemptCount = record.retryCount + 1

    if (nextAttemptCount >= record.maxRetries) {
      await prisma.stellarFunding.update({
        where: { id: record.id },
        data: { status: 'dead-letter', error },
      })
    } else {
      const backoffMinutes = Math.pow(
        stellarConfig.funding.backoffBaseMinutes,
        nextAttemptCount - 1,
      )
      const nextAttemptAt = new Date(Date.now() + backoffMinutes * 60_000)

      await prisma.stellarFunding.update({
        where: { id: record.id },
        data: {
          status: 'pending',
          error,
          nextAttemptAt,
        },
      })
    }
  }

  private isInsufficientFundsError(err: StellarServiceError): boolean {
    const causeMessage =
      err.cause instanceof Error ? err.cause.message : String(err.cause ?? '')

    return (
      causeMessage.includes('op_underfunded') ||
      causeMessage.includes('insufficient')
    )
  }
}

export const stellarFundingService = new StellarFundingService()
