import 'dotenv/config'
import { WalletProvisioningOutboxHandler } from '../jobs/wallet-provisioning.handler'
import { InMemoryEnvelopeKms } from '../services/kms/in-memory-envelope-kms'
import { SdkStellarKeypairGenerator } from '../services/stellar-keypair.adapter'
import { PrismaWalletProvisioningRepository } from '../services/wallet-provisioning.repository'
import prisma from '../config/database'

const POLL_INTERVAL_MS = parseInt(process.env.WORKER_POLL_INTERVAL_MS ?? '5000', 10)

// Development worker: drains the idempotent wallet-provisioning outbox using
// the in-memory KMS adapter. Production should swap in a real KMS adapter
// (e.g. AWS KMS) — the handler only depends on the KmsSecretStore interface.
const kms = new InMemoryEnvelopeKms()
const repository = new PrismaWalletProvisioningRepository(prisma)
const keypairGenerator = new SdkStellarKeypairGenerator()
const handler = new WalletProvisioningOutboxHandler(repository, kms, keypairGenerator)

let isShuttingDown = false

async function drainOnce(): Promise<void> {
  const result = await handler.handleNext()
  if (result.kind !== 'idle') {
    console.log(`[worker] ${result.kind}:`, JSON.stringify(result))
  }
}

async function runLoop(): Promise<void> {
  console.log(`[worker] Wallet provisioning worker started (poll every ${POLL_INTERVAL_MS}ms)`)
  while (!isShuttingDown) {
    try {
      await drainOnce()
    } catch (error) {
      console.error('[worker] Unhandled error while draining outbox:', error)
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
}

function gracefulShutdown(signal: string): void {
  if (isShuttingDown) return
  isShuttingDown = true
  console.log(`[worker] Received ${signal}, shutting down...`)
  prisma
    .$disconnect()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('[worker] Error disconnecting Prisma:', error)
      process.exit(1)
    })
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

runLoop().catch((error) => {
  console.error('[worker] Fatal error:', error)
  process.exit(1)
})
