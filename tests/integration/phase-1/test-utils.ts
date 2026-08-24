import { PrismaClient } from '@prisma/client'
import { buildUser, createUser } from '../../helpers/factories'
import { InMemoryWalletProvisioningRepository } from '../../helpers/in-memory-wallet-provisioning'
import { fakeEmailProvider } from '../../fakes/fake-email.provider'
import { fakeKmsProvider } from '../../fakes/fake-kms.provider'
import { fakeHorizonProvider } from '../../fakes/fake-horizon.provider'
import { fakeStorageProvider } from '../../fakes/fake-storage.provider'
import { fakeOtpProvider } from '../../fakes/fake-otp.provider'
import { fakeAuditService } from '../../fakes/fake-audit.provider'
import { WalletProvisioningService } from '../../../src/services/wallet-provisioning.service'
import { StellarFundingService } from '../../../src/services/stellar-funding.service'
import { WalletSelfCustodyExportService } from '../../../src/services/wallet-self-custody-export.service'
import { StellarService } from '../../../src/services/stellar.service'
import { OnboardingService } from '../../../src/services/onboarding.service'
import { ProfileService } from '../../../src/services/profile.service'
import { SessionService } from '../../../src/services/session.service'
import { AccountLifecycleService } from '../../../src/services/account-lifecycle.service'
import { ConsentService } from '../../../src/services/consent.service'
import { AvatarService } from '../../../src/services/avatar.service'
import { DataExportService } from '../../../src/services/data-export.service'
import { PreferenceService } from '../../../src/services/preference.service'
import { RefreshTokenService } from '../../../src/services/refresh-token.service'
import type { RequestContext } from '../../../src/types/account.types'

export interface IntegrationTestContext {
  prisma: PrismaClient
  walletRepo: InMemoryWalletProvisioningRepository
  walletProvisioningService: WalletProvisioningService
  stellarFundingService: StellarFundingService
  stellarService: StellarService
  walletExportService: WalletSelfCustodyExportService
  onboardingService: OnboardingService
  profileService: ProfileService
  sessionService: SessionService
  accountLifecycleService: AccountLifecycleService
  consentService: ConsentService
  avatarService: AvatarService
  dataExportService: DataExportService
  preferenceService: PreferenceService
  refreshTokenService: RefreshTokenService
}

let ctx: IntegrationTestContext | null = null

export function getIntegrationTestContext(): IntegrationTestContext {
  if (!ctx) {
    throw new Error('Integration test context not initialized. Call createIntegrationTestContext() first.')
  }
  
return ctx
}

export async function createIntegrationTestContext(prisma: PrismaClient): Promise<IntegrationTestContext> {
  const walletRepo = new InMemoryWalletProvisioningRepository()
  const walletProvisioningService = new WalletProvisioningService(walletRepo)

  const stellarService = new StellarService('testnet', '')
  const stellarFundingService = new StellarFundingService(stellarService)

  const walletExportService = new WalletSelfCustodyExportService(
    {
      findEligibleWallet: async (userId: string) => {
        const wallet = await walletRepo.getByUserId(userId)
        if (!wallet || wallet.status !== 'ACTIVE') return null
        
return {
          walletId: wallet.id,
          userId: wallet.userId,
          publicKey: wallet.publicKey!,
          opaqueReference: wallet.managedKeyReferenceId!,
        }
      },
      saveAuthorization: async (auth: any) => {},
      claimAuthorization: async () => null,
      releaseClaim: async () => {},
      completeMigration: async () => true,
    },
    {
      verifyPassword: async () => true,
    },
    fakeKmsProvider,
    fakeAuditService,
  )

  const onboardingService = new OnboardingService()
  const profileService = new ProfileService()
  const sessionService = new SessionService()
  const accountLifecycleService = new AccountLifecycleService()
  const consentService = new ConsentService()
  const avatarService = new AvatarService(fakeStorageProvider)
  const dataExportService = new DataExportService()
  const preferenceService = new PreferenceService()
  const refreshTokenService = new RefreshTokenService()

  ctx = {
    prisma,
    walletRepo,
    walletProvisioningService,
    stellarFundingService,
    stellarService,
    walletExportService,
    onboardingService,
    profileService,
    sessionService,
    accountLifecycleService,
    consentService,
    avatarService,
    dataExportService,
    preferenceService,
    refreshTokenService,
  }

  fakeEmailProvider.clear()
  fakeKmsProvider.clear()
  fakeHorizonProvider.clear()
  fakeStorageProvider.clear()
  fakeOtpProvider.clear()
  fakeAuditService.clear()

  return ctx
}

export function clearIntegrationTestContext(): void {
  if (ctx) {
    fakeEmailProvider.clear()
    fakeKmsProvider.clear()
    fakeHorizonProvider.clear()
    fakeStorageProvider.clear()
    fakeOtpProvider.clear()
    fakeAuditService.clear()
  }
}

export function buildTestUser(overrides: Parameters<typeof buildUser>[0] = {}) {
  return buildUser(overrides)
}

export async function createTestUser(
  prisma: PrismaClient,
  overrides: Parameters<typeof createUser>[1] = {},
) {
  return createUser(prisma, overrides)
}

export function createRequestContext(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    ipAddress: '127.0.0.1',
    userAgent: 'integration-test-agent',
    ...overrides,
  }
}

export function createMockRequest(overrides: Partial<{
  body: Record<string, unknown>
  headers: Record<string, string>
  user: { id: string; role: string }
  ip: string
}> = {}) {
  return {
    body: overrides.body ?? {},
    headers: {
      'user-agent': 'integration-test-agent',
      ...overrides.headers,
    },
    user: overrides.user,
    socket: { remoteAddress: overrides.ip ?? '127.0.0.1' },
    get: (name: string) => overrides.headers?.[name.toLowerCase()],
  } as any
}

export function createMockResponse() {
  const res: any = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    cookie: vi.fn().mockReturnThis(),
    clearCookie: vi.fn().mockReturnThis(),
  }
  
return res
}

import { vi } from 'vitest'