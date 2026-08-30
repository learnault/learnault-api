import type { PrismaClient } from '@prisma/client'
import defaultPrisma from '../config/database'
import {
  getOutboxHandlerRegistry,
  OutboxHandlerRegistry,
} from '../lib/transactions/handler-registry'
import { registerBuiltInSchemas } from '../lib/transactions/event-schema'
import { InMemoryEnvelopeKms } from '../services/kms/in-memory-envelope-kms'
import { SdkStellarKeypairGenerator } from '../services/stellar-keypair.adapter'
import { PrismaWalletProvisioningRepository } from '../services/wallet-provisioning.repository'
import { UserCreatedHandler } from './user-created.handler'
import { WalletProvisioningOutboxHandler } from './wallet-provisioning.handler'
import { WalletProvisioningRequestedHandler } from './wallet-provisioning-requested.handler'

export const EMITTED_EVENT_TYPES = [
  { eventType: 'UserCreated', eventVersion: 1 },
  { eventType: 'WalletProvisioningRequested', eventVersion: 1 },
]

let schemasRegistered = false

export interface RegisterHandlersOptions {
  prisma?: PrismaClient
  registry?: OutboxHandlerRegistry
}

export function registerOutboxHandlers(
  options: RegisterHandlersOptions = {},
): OutboxHandlerRegistry {
  const prisma = options.prisma ?? defaultPrisma
  const registry = options.registry ?? getOutboxHandlerRegistry()

  if (!schemasRegistered) {
    registerBuiltInSchemas()
    schemasRegistered = true
  }

  const repository = new PrismaWalletProvisioningRepository(prisma)

  registry.register(new UserCreatedHandler(prisma, repository))
  registry.register(
    new WalletProvisioningRequestedHandler(
      new WalletProvisioningOutboxHandler(
        repository,
        new InMemoryEnvelopeKms(),
        new SdkStellarKeypairGenerator(),
      ),
    ),
  )

  registry.assertHandlersFor(EMITTED_EVENT_TYPES)

  return registry
}
