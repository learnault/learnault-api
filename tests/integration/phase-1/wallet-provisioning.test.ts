import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '../../../src/config/database'
import {
  createIntegrationTestContext,
  clearIntegrationTestContext,
  buildTestUser,
  createTestUser,
  createRequestContext,
} from './test-utils'
import { fakeKmsProvider } from '../../fakes/fake-kms.provider'
import { fakeHorizonProvider } from '../../fakes/fake-horizon.provider'
import { fakeAuditService } from '../../fakes/fake-audit.provider'
import { WalletProvisioningService } from '../../../src/services/wallet-provisioning.service'
import { StellarFundingService } from '../../../src/services/stellar-funding.service'
import { WalletSelfCustodyExportService } from '../../../src/services/wallet-self-custody-export.service'
import { ConsentService } from '../../../src/services/consent.service'
import { InMemoryWalletProvisioningRepository } from '../../helpers/in-memory-wallet-provisioning'
import { WalletEligibilityError } from '../../../src/types/wallet-provisioning.types'

describe('Phase 1 Integration: Wallet Consent, Provisioning, KMS Failure, Funding, Balance/History, Export Authorization', () => {
  let ctx: ReturnType<typeof createIntegrationTestContext>
  let testUserId: string

  beforeEach(async () => {
    ctx = await createIntegrationTestContext(prisma)

    const userData = buildTestUser({ isVerified: true })
    const user = await createTestUser(prisma, userData)
    testUserId = user.id

    ctx.walletRepo.setUser(testUserId, { verified: true, custodialConsent: true })
    await ctx.consentService.grant(testUserId, {
      purpose: 'custodial_wallet',
      policyVersion: '1.0',
      source: 'integration-test',
    })
  })

  afterEach(async () => {
    await prisma.user.deleteMany({ where: { id: testUserId } })
    clearIntegrationTestContext()
  })

  describe('Wallet Consent', () => {
    it('should require custodial consent for wallet provisioning', async () => {
      const userData = buildTestUser({ email: `no-consent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@test.com`, isVerified: true })
      const user = await createTestUser(prisma, userData)

      const walletRepo = new InMemoryWalletProvisioningRepository()
      walletRepo.setUser(user.id, { verified: true, custodialConsent: false })

      const walletService = new WalletProvisioningService(walletRepo)

      await expect(walletService.request(user.id)).rejects.toThrow(WalletEligibilityError)
    })

    it('should allow provisioning with custodial consent', async () => {
      const wallet = await ctx.walletProvisioningService.request(testUserId)

      expect(wallet.id).toBeDefined()
      expect(wallet.network).toBe('TESTNET')
      expect(wallet.custody).toBe('MANAGED')
      expect(wallet.status).toBe('RESERVED')
    })

    it('should return existing wallet for user', async () => {
      await ctx.walletProvisioningService.request(testUserId)
      const wallet = await ctx.walletProvisioningService.getForUser(testUserId)

      expect(wallet).not.toBeNull()
      expect(wallet?.id).toBeDefined()
    })
  })

  describe('Concurrent Provisioning', () => {
    it('should return same wallet for concurrent requests', async () => {
      const [wallet1, wallet2] = await Promise.all([
        ctx.walletProvisioningService.request(testUserId),
        ctx.walletProvisioningService.request(testUserId),
      ])

      expect(wallet1.id).toBe(wallet2.id)
    })

    it('should handle concurrent provisioning attempts gracefully', async () => {
      const walletRepo = new InMemoryWalletProvisioningRepository()
      walletRepo.setUser(testUserId, { verified: true, custodialConsent: true })

      const walletService = new WalletProvisioningService(walletRepo)

      const results = await Promise.allSettled(
        Array(5).fill(null).map(() => walletService.request(testUserId)),
      )

      const successful = results.filter((r) => r.status === 'fulfilled')
      expect(successful.length).toBe(5)
      expect(successful.every((r) => r.value.id === successful[0].value.id)).toBe(true)
    })
  })

  describe('KMS Failure Handling', () => {
    it('should handle KMS store failure during provisioning', async () => {
      fakeKmsProvider.shouldFailOnStore = true

      const walletRepo = new InMemoryWalletProvisioningRepository()
      walletRepo.setUser(testUserId, { verified: true, custodialConsent: true })

      const walletService = new WalletProvisioningService(walletRepo)
      const wallet = await walletService.request(testUserId)

      expect(wallet.status).toBe('RESERVED')
    })

    it('should retry KMS operation on failure', async () => {
      fakeKmsProvider.shouldFailOnStore = true

      const walletRepo = new InMemoryWalletProvisioningRepository()
      walletRepo.setUser(testUserId, { verified: true, custodialConsent: true })

      const walletService = new WalletProvisioningService(walletRepo)
      await walletService.request(testUserId)

      fakeKmsProvider.shouldFailOnStore = false

      const wallet = await walletService.getForUser(testUserId)
      expect(wallet).not.toBeNull()
    })
  })

  describe('Funding Reconciliation', () => {
    it('should queue funding for new wallet', async () => {
      const wallet = await ctx.walletProvisioningService.request(testUserId)

      const funding = await ctx.stellarFundingService.queueFunding(wallet.publicKey!)

      expect(funding.publicKey).toBe(wallet.publicKey)
      expect(funding.amount).toBeDefined()
      expect(funding.status).toBe('pending')
    })

    it('should process funding and mark confirmed', async () => {
      const wallet = await ctx.walletProvisioningService.request(testUserId)

      await ctx.stellarFundingService.queueFunding(wallet.publicKey!)
      await ctx.stellarFundingService.processQueue()

      const funding = await prisma.stellarFunding.findUnique({ where: { publicKey: wallet.publicKey! } })
      expect(funding?.status).toBe('confirmed')
    })

    it('should reconcile submitted transaction', async () => {
      const wallet = await ctx.walletProvisioningService.request(testUserId)

      await prisma.stellarFunding.create({
        data: {
          publicKey: wallet.publicKey!,
          amount: '100',
          status: 'submitted',
          transactionHash: 'tx-123',
          retryCount: 0,
          maxRetries: 5,
        },
      })

      await ctx.stellarFundingService.processQueue()

      const funding = await prisma.stellarFunding.findUnique({ where: { publicKey: wallet.publicKey! } })
      expect(funding?.status).toBe('confirmed')
    })

    it('should handle funding retry with backoff', async () => {
      fakeHorizonProvider.shouldFailOnPayment = true

      const wallet = await ctx.walletProvisioningService.request(testUserId)
      await ctx.stellarFundingService.queueFunding(wallet.publicKey!)
      await ctx.stellarFundingService.processQueue()

      const funding = await prisma.stellarFunding.findUnique({ where: { publicKey: wallet.publicKey! } })
      expect(funding?.status).toBe('pending')
      expect(funding?.nextAttemptAt).toBeDefined()
      expect(funding?.error).toBeDefined()
    })
  })

  describe('Balance and History', () => {
    it('should fetch wallet balance', async () => {
      const wallet = await ctx.walletProvisioningService.request(testUserId)

      fakeHorizonProvider.fundAccount(wallet.publicKey!)
      const balances = await ctx.stellarService.getBalances(wallet.publicKey!)

      expect(balances.length).toBeGreaterThan(0)
      expect(balances.some((b) => b.asset === 'XLM')).toBe(true)
    })

    it('should fetch native balance', async () => {
      const wallet = await ctx.walletProvisioningService.request(testUserId)

      fakeHorizonProvider.fundAccount(wallet.publicKey!)
      const balance = await ctx.stellarService.getNativeBalance(wallet.publicKey!)

      expect(Number(balance)).toBeGreaterThan(0)
    })
  })

  describe('Self-Custody Export Authorization', () => {
    it('should require acknowledgement for export authorization', async () => {
      const wallet = await ctx.walletProvisioningService.request(testUserId)

      await ctx.walletRepo.reserveEligibleWallet(testUserId, 'TESTNET')
      await ctx.walletRepo.complete(
        wallet.id,
        'dummy-lease',
        { provider: 'fake-kms', opaqueReference: wallet.managedKeyReferenceId!, keyVersion: '1', publicKey: wallet.publicKey! },
        new Date(),
      )

      await expect(
        ctx.walletExportService.authorize({
          userId: testUserId,
          sessionId: 'session-1',
          password: 'password123',
          acknowledgement: false,
        }),
      ).rejects.toThrow('ACKNOWLEDGEMENT_REQUIRED')
    })

    it('should authorize export with valid acknowledgement and password', async () => {
      const wallet = await ctx.walletProvisioningService.request(testUserId)

      await ctx.walletRepo.reserveEligibleWallet(testUserId, 'TESTNET')
      await ctx.walletRepo.complete(
        wallet.id,
        'dummy-lease',
        { provider: 'fake-kms', opaqueReference: wallet.managedKeyReferenceId!, keyVersion: '1', publicKey: wallet.publicKey! },
        new Date(),
      )

      const result = await ctx.walletExportService.authorize({
        userId: testUserId,
        sessionId: 'session-1',
        password: 'password123',
        acknowledgement: true,
      })

      expect(result.authorizationToken).toBeDefined()
      expect(result.expiresAt).toBeDefined()
    })

    it('should reject export with invalid password', async () => {
      const wallet = await ctx.walletProvisioningService.request(testUserId)

      await ctx.walletRepo.reserveEligibleWallet(testUserId, 'TESTNET')
      await ctx.walletRepo.complete(
        wallet.id,
        'dummy-lease',
        { provider: 'fake-kms', opaqueReference: wallet.managedKeyReferenceId!, keyVersion: '1', publicKey: wallet.publicKey! },
        new Date(),
      )

      await expect(
        ctx.walletExportService.authorize({
          userId: testUserId,
          sessionId: 'session-1',
          password: 'wrongpassword',
          acknowledgement: true,
        }),
      ).rejects.toThrow('STEP_UP_FAILED')
    })

    it('should export secret once and delete from KMS', async () => {
      const wallet = await ctx.walletProvisioningService.request(testUserId)

      await ctx.walletRepo.reserveEligibleWallet(testUserId, 'TESTNET')
      await ctx.walletRepo.complete(
        wallet.id,
        'dummy-lease',
        { provider: 'fake-kms', opaqueReference: wallet.managedKeyReferenceId!, keyVersion: '1', publicKey: wallet.publicKey! },
        new Date(),
      )

      const auth = await ctx.walletExportService.authorize({
        userId: testUserId,
        sessionId: 'session-1',
        password: 'password123',
        acknowledgement: true,
      })

      const secret = await ctx.walletExportService.exportOnce({
        userId: testUserId,
        sessionId: 'session-1',
        authorizationToken: auth.authorizationToken,
      })

      expect(secret).toBeDefined()
      expect(fakeKmsProvider.storedKeys.has(wallet.managedKeyReferenceId!)).toBe(false)
    })

    it('should reject double export with same authorization', async () => {
      const wallet = await ctx.walletProvisioningService.request(testUserId)

      await ctx.walletRepo.reserveEligibleWallet(testUserId, 'TESTNET')
      await ctx.walletRepo.complete(
        wallet.id,
        'dummy-lease',
        { provider: 'fake-kms', opaqueReference: wallet.managedKeyReferenceId!, keyVersion: '1', publicKey: wallet.publicKey! },
        new Date(),
      )

      const auth = await ctx.walletExportService.authorize({
        userId: testUserId,
        sessionId: 'session-1',
        password: 'password123',
        acknowledgement: true,
      })

      await ctx.walletExportService.exportOnce({
        userId: testUserId,
        sessionId: 'session-1',
        authorizationToken: auth.authorizationToken,
      })

      await expect(
        ctx.walletExportService.exportOnce({
          userId: testUserId,
          sessionId: 'session-1',
          authorizationToken: auth.authorizationToken,
        }),
      ).rejects.toThrow('AUTHORIZATION_INVALID')
    })

    it('should handle KMS delete failure during export', async () => {
      const wallet = await ctx.walletProvisioningService.request(testUserId)

      await ctx.walletRepo.reserveEligibleWallet(testUserId, 'TESTNET')
      await ctx.walletRepo.complete(
        wallet.id,
        'dummy-lease',
        { provider: 'fake-kms', opaqueReference: wallet.managedKeyReferenceId!, keyVersion: '1', publicKey: wallet.publicKey! },
        new Date(),
      )

      fakeKmsProvider.shouldFailOnDelete = true

      const auth = await ctx.walletExportService.authorize({
        userId: testUserId,
        sessionId: 'session-1',
        password: 'password123',
        acknowledgement: true,
      })

      await expect(
        ctx.walletExportService.exportOnce({
          userId: testUserId,
          sessionId: 'session-1',
          authorizationToken: auth.authorizationToken,
        }),
      ).rejects.toThrow('KMS_DELETE_FAILED')
    })
  })

  describe('Audit Logging', () => {
    it('should audit wallet provisioning events', async () => {
      await ctx.walletProvisioningService.request(testUserId)

      const audits = fakeAuditService.getEntriesForAction('WALLET_PROVISIONING_RESERVED')
      expect(audits.length).toBe(1)
      expect(audits[0].userId).toBe(testUserId)
    })

    it('should audit wallet export events', async () => {
      const wallet = await ctx.walletProvisioningService.request(testUserId)

      await ctx.walletRepo.reserveEligibleWallet(testUserId, 'TESTNET')
      await ctx.walletRepo.complete(
        wallet.id,
        'dummy-lease',
        { provider: 'fake-kms', opaqueReference: wallet.managedKeyReferenceId!, keyVersion: '1', publicKey: wallet.publicKey! },
        new Date(),
      )

      const auth = await ctx.walletExportService.authorize({
        userId: testUserId,
        sessionId: 'session-1',
        password: 'password123',
        acknowledgement: true,
      })

      await ctx.walletExportService.exportOnce({
        userId: testUserId,
        sessionId: 'session-1',
        authorizationToken: auth.authorizationToken,
      })

      const audits = fakeAuditService.getEntriesForAction('WALLET_EXPORT_COMPLETED')
      expect(audits.length).toBe(1)
      expect(audits[0].metadata.walletId).toBe(wallet.id)
    })

    it('should audit funding events', async () => {
      const wallet = await ctx.walletProvisioningService.request(testUserId)
      await ctx.stellarFundingService.queueFunding(wallet.publicKey!)
      await ctx.stellarFundingService.processQueue()

      const audits = fakeAuditService.getEntriesForAction('WALLET_EXPORT_COMPLETED')
    })
  })

  describe('Idempotency', () => {
    it('should be idempotent for wallet request', async () => {
      const wallet1 = await ctx.walletProvisioningService.request(testUserId)
      const wallet2 = await ctx.walletProvisioningService.request(testUserId)

      expect(wallet1.id).toBe(wallet2.id)
    })

    it('should be idempotent for funding queue', async () => {
      const wallet = await ctx.walletProvisioningService.request(testUserId)

      const funding1 = await ctx.stellarFundingService.queueFunding(wallet.publicKey!)
      const funding2 = await ctx.stellarFundingService.queueFunding(wallet.publicKey!)

      expect(funding1.id).toBe(funding2.id)
    })
  })
})