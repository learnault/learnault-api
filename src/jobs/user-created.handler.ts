import type { Prisma, PrismaClient } from '@prisma/client'
import type {
  OutboxEventHandler,
  OutboxEventHandlerContext,
  OutboxEventHandlerResult,
} from '../lib/transactions/types'
import { createOutboxService, OutboxService } from '../lib/transactions/outbox.service'
import type { WalletProvisioningRepository } from '../services/wallet-provisioning.repository'

export interface UserCreatedPayload {
  userId: string
  email: string
  role: 'ADMIN' | 'LEARNER' | 'INSTRUCTOR'
}

export interface UserCreatedHandlerOptions {
  network?: string
  outboxService?: OutboxService
}

export class UserCreatedHandler implements OutboxEventHandler {
  readonly name = 'wallet.reserve-on-user-created'
  readonly eventType = 'UserCreated'
  readonly eventVersion = 1
  readonly maxAttempts = 5

  private readonly network: string
  private readonly outbox: OutboxService

  constructor(
    private readonly prisma: PrismaClient,
    private readonly repository: WalletProvisioningRepository,
    options: UserCreatedHandlerOptions = {},
  ) {
    this.network = options.network ?? 'TESTNET'
    this.outbox = options.outboxService ?? createOutboxService(prisma)
  }

  async handle(context: OutboxEventHandlerContext): Promise<OutboxEventHandlerResult> {
    const payload = context.payload as UserCreatedPayload

    const wallet = await this.repository.reserveEligibleWallet(payload.userId, this.network)

    const alreadyRequested = await this.prisma.outboxEvent.findFirst({
      where: {
        aggregateId: wallet.id,
        eventType: 'WalletProvisioningRequested',
        causedBy: context.eventId,
      },
      select: { id: true },
    })

    if (!alreadyRequested) {
      await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await this.outbox.createEvent(tx, {
          aggregateId: wallet.id,
          aggregateType: 'Wallet',
          eventType: 'WalletProvisioningRequested',
          eventVersion: 1,
          payload: {
            walletId: wallet.id,
            userId: payload.userId,
            network: this.network,
          },
          source: 'relay.user-created',
          causedBy: context.eventId,
        })
      })
    }

    return {
      idempotencyKey: `${context.eventId}:${this.name}`,
      result: { walletId: wallet.id, requested: !alreadyRequested },
    }
  }
}
