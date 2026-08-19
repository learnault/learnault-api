import { describe, expect, it, vi } from 'vitest'
import { WalletProvisioningOutboxHandler } from '../src/jobs/wallet-provisioning.handler'
import { InMemoryEnvelopeKms } from '../src/services/kms/in-memory-envelope-kms'
import { SensitiveValue } from '../src/services/kms/kms-secret-store'
import type {
  GeneratedStellarKeypair,
  StellarKeypairGenerator,
} from '../src/services/stellar-keypair.adapter'
import { WalletProvisioningService } from '../src/services/wallet-provisioning.service'
import { WalletEligibilityError } from '../src/types/wallet-provisioning.types'
import { InMemoryWalletProvisioningRepository } from './helpers/in-memory-wallet-provisioning'

const PUBLIC_KEY = 'GPROVISIONINGTESTPUBLICKEY00000000000000000000000000000000'
const PLAINTEXT_SEED = 'sensitive-signing-material-for-runtime-test'

class DeterministicGenerator implements StellarKeypairGenerator {
  readonly generate = vi.fn<() => GeneratedStellarKeypair>(() => ({
    publicKey: PUBLIC_KEY,
    secret: new SensitiveValue(PLAINTEXT_SEED),
  }))
}

function eligibleRepository(): InMemoryWalletProvisioningRepository {
  const repository = new InMemoryWalletProvisioningRepository()
  repository.setUser('user-1', { verified: true, custodialConsent: true })

  return repository
}

describe('idempotent Stellar wallet provisioning', () => {
  it('reserves one wallet and one durable job under concurrent requests', async () => {
    const repository = eligibleRepository()
    const service = new WalletProvisioningService(repository)

    const results = await Promise.all(
      Array.from({ length: 50 }, () => service.request('user-1')),
    )

    expect(new Set(results.map((wallet) => wallet.id)).size).toBe(1)
    expect(repository.walletCount).toBe(1)
    expect(repository.jobCount).toBe(1)
  })

  it('requires account verification before reserving or generating', async () => {
    const repository = new InMemoryWalletProvisioningRepository()
    repository.setUser('user-1', { verified: false, custodialConsent: true })
    const service = new WalletProvisioningService(repository)

    await expect(
      service.request('user-1'),
    ).rejects.toMatchObject<WalletEligibilityError>({
      code: 'USER_NOT_VERIFIED',
    })
    expect(repository.walletCount).toBe(0)
  })

  it('requires current custodial consent before reserving or generating', async () => {
    const repository = new InMemoryWalletProvisioningRepository()
    repository.setUser('user-1', { verified: true, custodialConsent: false })
    const service = new WalletProvisioningService(repository)

    await expect(
      service.request('user-1'),
    ).rejects.toMatchObject<WalletEligibilityError>({
      code: 'CUSTODIAL_CONSENT_REQUIRED',
    })
    expect(repository.walletCount).toBe(0)
  })

  it('lets only one concurrent worker generate and activate the wallet', async () => {
    const repository = eligibleRepository()
    await new WalletProvisioningService(repository).request('user-1')
    const generator = new DeterministicGenerator()
    const kms = new InMemoryEnvelopeKms()
    const handler = new WalletProvisioningOutboxHandler(
      repository,
      kms,
      generator,
    )

    const results = await Promise.all(
      Array.from({ length: 25 }, () => handler.handleNext()),
    )

    expect(
      results.filter((result) => result.kind === 'completed'),
    ).toHaveLength(1)
    expect(generator.generate).toHaveBeenCalledTimes(1)
    expect(kms.storedKeyCount).toBe(1)
    expect(repository.activeWalletCount).toBe(1)
  })

  it('recovers an acknowledged-after-store KMS failure without generating again', async () => {
    const repository = eligibleRepository()
    await new WalletProvisioningService(repository).request('user-1')
    const generator = new DeterministicGenerator()
    const kms = new InMemoryEnvelopeKms({
      afterStore: () => {
        throw new Error(`provider response lost ${PLAINTEXT_SEED}`)
      },
    })
    const handler = new WalletProvisioningOutboxHandler(
      repository,
      kms,
      generator,
    )

    const result = await handler.handleNext()

    expect(result.kind).toBe('completed')
    expect(generator.generate).toHaveBeenCalledTimes(1)
    expect(kms.storedKeyCount).toBe(1)
    expect(JSON.stringify(result)).not.toContain(PLAINTEXT_SEED)
  })

  it('recovers from a DB finalization failure using the existing KMS record', async () => {
    const repository = eligibleRepository()
    await new WalletProvisioningService(repository).request('user-1')
    repository.completeFailures = 1
    const generator = new DeterministicGenerator()
    const kms = new InMemoryEnvelopeKms()
    let nowMs = 0
    const handler = new WalletProvisioningOutboxHandler(
      repository,
      kms,
      generator,
      {
        baseRetryMs: 10,
        now: () => new Date(nowMs),
      },
    )

    const first = await handler.handleNext()
    nowMs = 20
    const second = await handler.handleNext()

    expect(first).toMatchObject({
      kind: 'retry-scheduled',
      failureCode: 'DATABASE_FINALIZATION_FAILED',
    })
    expect(second.kind).toBe('completed')
    expect(generator.generate).toHaveBeenCalledTimes(1)
    expect(kms.storedKeyCount).toBe(1)
    expect(repository.activeWalletCount).toBe(1)
  })

  it('reclaims an abandoned process lease and completes the same wallet', async () => {
    const repository = eligibleRepository()
    await new WalletProvisioningService(repository).request('user-1')
    const abandoned = await repository.claimNext(new Date(0), 10)
    expect(abandoned).not.toBeNull()

    const generator = new DeterministicGenerator()
    const kms = new InMemoryEnvelopeKms()
    const handler = new WalletProvisioningOutboxHandler(
      repository,
      kms,
      generator,
      {
        now: () => new Date(20),
      },
    )

    const recovered = await handler.handleNext()

    expect(recovered.kind).toBe('completed')
    expect(generator.generate).toHaveBeenCalledTimes(1)
    expect(repository.walletCount).toBe(1)
    expect(repository.activeWalletCount).toBe(1)
  })

  it('repairs a KMS failure before storage and still activates only one wallet', async () => {
    const repository = eligibleRepository()
    await new WalletProvisioningService(repository).request('user-1')
    const generator = new DeterministicGenerator()
    let failuresRemaining = 1
    const kms = new InMemoryEnvelopeKms({
      beforeStore: () => {
        if (failuresRemaining > 0) {
          failuresRemaining -= 1
          throw new Error(`temporary KMS error ${PLAINTEXT_SEED}`)
        }
      },
    })
    let nowMs = 0
    const handler = new WalletProvisioningOutboxHandler(
      repository,
      kms,
      generator,
      {
        baseRetryMs: 10,
        now: () => new Date(nowMs),
      },
    )

    const first = await handler.handleNext()
    nowMs = 20
    const second = await handler.handleNext()

    expect(first).toMatchObject({
      kind: 'retry-scheduled',
      failureCode: 'KMS_STORE_UNCERTAIN',
    })
    expect(second.kind).toBe('completed')
    expect(generator.generate).toHaveBeenCalledTimes(2)
    expect(kms.storedKeyCount).toBe(1)
    expect(repository.activeWalletCount).toBe(1)
  })

  it('keeps plaintext signing material out of persistence, audit, and errors', async () => {
    const repository = eligibleRepository()
    await new WalletProvisioningService(repository).request('user-1')
    const handler = new WalletProvisioningOutboxHandler(
      repository,
      new InMemoryEnvelopeKms(),
      new DeterministicGenerator(),
    )

    const result = await handler.handleNext()
    const observableState = `${repository.snapshot()}${JSON.stringify(result)}`

    expect(observableState).not.toContain(PLAINTEXT_SEED)
    expect(observableState).not.toMatch(/secretKey|privateKey|seedPhrase/i)
    expect(
      repository.audits.every((entry) => !('opaqueReference' in entry)),
    ).toBe(true)
  })
})
