import type {
  OutboxEventHandler,
  OutboxEventHandlerContext,
  OutboxEventHandlerResult,
} from '../lib/transactions/types'
import type { WalletProvisioningOutboxHandler } from './wallet-provisioning.handler'

export interface WalletProvisioningRequestedPayload {
  walletId: string
  userId: string
  network: string
}

export class WalletProvisioningRequestedHandler implements OutboxEventHandler {
  readonly name = 'wallet.provision'
  readonly eventType = 'WalletProvisioningRequested'
  readonly eventVersion = 1
  readonly maxAttempts = 5

  constructor(private readonly handler: WalletProvisioningOutboxHandler) {}

  async handle(
    context: OutboxEventHandlerContext,
  ): Promise<OutboxEventHandlerResult> {
    const payload = context.payload as WalletProvisioningRequestedPayload
    const result = await this.handler.handleWallet(payload.walletId)

    if (result.kind === 'retry-scheduled') {
      throw new Error(
        `Wallet ${payload.walletId} provisioning failed with ${result.failureCode}`,
      )
    }

    return {
      idempotencyKey: `${context.eventId}:${this.name}`,
      result,
    }
  }
}
