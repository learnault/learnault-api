import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '../../../src/config/database'
import {
  createIntegrationTestContext,
  clearIntegrationTestContext,
  buildTestUser,
  createTestUser,
  createRequestContext,
} from './test-utils'
import { fakeAuditService } from '../fakes/fake-audit.provider'
import { fakeStorageProvider } from '../../fakes/fake-storage.provider'
import { OnboardingService } from '../../../src/services/onboarding.service'
import { ConsentService } from '../../../src/services/consent.service'
import {
  CURRENT_ONBOARDING_VERSION,
  ONBOARDING_STEPS,
  REQUIRED_ONBOARDING_STEPS,
} from '../../../src/types/onboarding.types'

describe('Phase 1 Integration: Onboarding, Consent, Profile, Preferences, Avatar, Export, Deletion', () => {
  let ctx: ReturnType<typeof createIntegrationTestContext>
  let testUserId: string

  beforeEach(async () => {
    ctx = await createIntegrationTestContext(prisma)
    clearIntegrationTestContext()

    const userData = buildTestUser({ isVerified: true })
    const user = await createTestUser(prisma, userData)
    testUserId = user.id
  })

  afterEach(async () => {
    await prisma.user.deleteMany({ where: { id: testUserId } })
    clearIntegrationTestContext()
  })

  describe('Onboarding', () => {
    it('should create onboarding progress for new user', async () => {
      const { onboardingService } = ctx

      const progress = await onboardingService.getOrCreate(testUserId)

      expect(progress.userId).toBe(testUserId)
      expect(progress.version).toBe(CURRENT_ONBOARDING_VERSION)
      expect(progress.currentStep).toBe(ONBOARDING_STEPS[0])
      expect(progress.completedSteps).toEqual([])
      expect(progress.status).toBe('in_progress')
    })

    it('should save onboarding step', async () => {
      const { onboardingService } = ctx

      const result = await onboardingService.saveStep(testUserId, ONBOARDING_STEPS[1])

      expect(result.kind).toBe('saved')
      expect(result.progress.completedSteps).toContain(ONBOARDING_STEPS[1])
      expect(result.progress.currentStep).toBe(ONBOARDING_STEPS[1])
    })

    it('should save multiple steps', async () => {
      const { onboardingService } = ctx

      await onboardingService.saveStep(testUserId, ONBOARDING_STEPS[1])
      await onboardingService.saveStep(testUserId, ONBOARDING_STEPS[2])

      const progress = await onboardingService.resume(testUserId)

      expect(progress.completedSteps).toContain(ONBOARDING_STEPS[1])
      expect(progress.completedSteps).toContain(ONBOARDING_STEPS[2])
    })

    it('should return already-completed if onboarding finished', async () => {
      const { onboardingService, consentService } = ctx

      for (const step of REQUIRED_ONBOARDING_STEPS) {
        await onboardingService.saveStep(testUserId, step)
      }
      await consentService.grant(testUserId, {
        purpose: 'terms_of_service',
        policyVersion: '1.0',
        source: 'integration-test',
      })
      await consentService.grant(testUserId, {
        purpose: 'privacy_policy',
        policyVersion: '1.0',
        source: 'integration-test',
      })
      await onboardingService.complete(testUserId)

      const result = await onboardingService.saveStep(testUserId, ONBOARDING_STEPS[1])
      expect(result.kind).toBe('already-completed')
    })

    it('should complete onboarding when all required steps done and consent granted', async () => {
      const { onboardingService, consentService } = ctx

      for (const step of REQUIRED_ONBOARDING_STEPS) {
        await onboardingService.saveStep(testUserId, step)
      }

      await consentService.grant(testUserId, {
        purpose: 'terms_of_service',
        policyVersion: '1.0',
        source: 'integration-test',
      })
      await consentService.grant(testUserId, {
        purpose: 'privacy_policy',
        policyVersion: '1.0',
        source: 'integration-test',
      })

      const result = await onboardingService.complete(testUserId)

      expect(result.kind).toBe('completed')
      expect(result.progress.status).toBe('completed')
      expect(result.progress.completedAt).toBeDefined()
    })

    it('should reject completion if required steps missing', async () => {
      const { onboardingService } = ctx

      await onboardingService.saveStep(testUserId, ONBOARDING_STEPS[1])

      const result = await onboardingService.complete(testUserId)

      expect(result.kind).toBe('incomplete-steps')
      expect(result.missingSteps.length).toBeGreaterThan(0)
    })

    it('should reject completion if required consent not granted', async () => {
      const { onboardingService } = ctx

      for (const step of REQUIRED_ONBOARDING_STEPS) {
        await onboardingService.saveStep(testUserId, step)
      }

      const result = await onboardingService.complete(testUserId)

      expect(result.kind).toBe('missing-required-consent')
    })

    it('should resume onboarding progress', async () => {
      const { onboardingService } = ctx

      await onboardingService.saveStep(testUserId, ONBOARDING_STEPS[1])
      await onboardingService.saveStep(testUserId, ONBOARDING_STEPS[2])

      const progress = await onboardingService.resume(testUserId)

      expect(progress.completedSteps).toContain(ONBOARDING_STEPS[1])
      expect(progress.completedSteps).toContain(ONBOARDING_STEPS[2])
    })
  })

  describe('Consent', () => {
    it('should grant consent', async () => {
      const { consentService } = ctx

      const result = await consentService.grant(testUserId, {
        purpose: 'terms_of_service',
        policyVersion: '1.0',
        source: 'integration-test',
      })

      expect(result.purpose).toBe('terms_of_service')
      expect(result.policyVersion).toBe('1.0')
      expect(result.status).toBe('granted')
    })

    it('should withdraw consent', async () => {
      const { consentService } = ctx

      await consentService.grant(testUserId, {
        purpose: 'marketing_emails',
        policyVersion: '1.0',
        source: 'integration-test',
      })
      const result = await consentService.withdraw(testUserId, {
        purpose: 'marketing_emails',
        source: 'integration-test',
      })

      expect(result.kind).toBe('withdrawn')
      expect(result.record.status).toBe('withdrawn')
    })

    it('should check if all required consents granted', async () => {
      const { consentService } = ctx

      const hasAllBefore = await consentService.hasAllRequiredGranted(testUserId)
      expect(hasAllBefore).toBe(false)

      await consentService.grant(testUserId, {
        purpose: 'terms_of_service',
        policyVersion: '1.0',
        source: 'integration-test',
      })
      await consentService.grant(testUserId, {
        purpose: 'privacy_policy',
        policyVersion: '1.0',
        source: 'integration-test',
      })

      const hasAllAfter = await consentService.hasAllRequiredGranted(testUserId)
      expect(hasAllAfter).toBe(true)
    })

    it('should return consent history', async () => {
      const { consentService } = ctx

      await consentService.grant(testUserId, {
        purpose: 'marketing_emails',
        policyVersion: '1.0',
        source: 'integration-test',
      })
      await consentService.withdraw(testUserId, {
        purpose: 'marketing_emails',
        source: 'integration-test',
      })
      await consentService.grant(testUserId, {
        purpose: 'marketing_emails',
        policyVersion: '1.1',
        source: 'integration-test',
      })

      const history = await consentService.getHistory(testUserId, 'marketing_emails')

      expect(history.length).toBe(3)
      expect(history[0].status).toBe('granted')
      expect(history[1].status).toBe('withdrawn')
      expect(history[2].status).toBe('granted')
    })
  })

  describe('Profile', () => {
    it('should get or create profile', async () => {
      const { profileService } = ctx

      const profile = await profileService.getOrCreateProfile(testUserId)

      expect(profile.userId).toBe(testUserId)
    })

    it('should update profile', async () => {
      const { profileService } = ctx

      const updated = await profileService.updateProfile(testUserId, {
        displayName: 'Test User',
        bio: 'Test bio',
        country: 'US',
        timezone: 'America/New_York',
      })

      expect(updated.displayName).toBe('Test User')
      expect(updated.bio).toBe('Test bio')
      expect(updated.country).toBe('US')
      expect(updated.timezone).toBe('America/New_York')
    })

    it('should return owner view with all fields', async () => {
      const { profileService } = ctx

      await profileService.updateProfile(testUserId, {
        displayName: 'Test User',
        bio: 'Test bio',
        country: 'US',
        timezone: 'America/New_York',
        languages: ['en'],
        level: 'intermediate',
        interests: ['blockchain'],
        goals: ['learn'],
        visibility: 'public',
      })

      const ownerView = await profileService.getOwnerView(testUserId)

      expect(ownerView.displayName).toBe('Test User')
      expect(ownerView.bio).toBe('Test bio')
      expect(ownerView.country).toBe('US')
      expect(ownerView.visibility).toBe('public')
    })

    it('should return public view with limited fields', async () => {
      const { profileService } = ctx

      await profileService.updateProfile(testUserId, {
        displayName: 'Test User',
        bio: 'Test bio',
        country: 'US',
        visibility: 'public',
      })

      const publicView = await profileService.getPublicView(testUserId)

      expect(publicView.displayName).toBe('Test User')
      expect(publicView.bio).toBe('Test bio')
      expect(publicView.country).toBe('US')
      expect(publicView.email).toBeUndefined()
    })

    it('should return employer view', async () => {
      const { profileService } = ctx

      await profileService.updateProfile(testUserId, {
        displayName: 'Test User',
        bio: 'Test bio',
        country: 'US',
        level: 'intermediate',
        interests: ['Stellar', 'Rust'],
        goals: ['Learn blockchain'],
        visibility: 'public',
      })

      const employerView = await profileService.getEmployerView(testUserId)

      expect(employerView.displayName).toBe('Test User')
      expect(employerView.interests).toContain('Stellar')
      expect(employerView.level).toBe('intermediate')
    })

    it('should return private view with account status', async () => {
      const { profileService } = ctx

      await profileService.updateProfile(testUserId, { displayName: 'Test User' })

      const privateView = await profileService.getPrivateView(testUserId)

      expect(privateView.displayName).toBe('Test User')
      expect(privateView.status).toBeDefined()
      expect(privateView.isVerified).toBeDefined()
    })
  })

  describe('Preferences', () => {
    it('should get default preferences', async () => {
      const { preferenceService } = ctx

      const prefs = await preferenceService.getPreferences(testUserId)

      expect(prefs.locale).toBeDefined()
      expect(prefs.timezone).toBeDefined()
      expect(prefs.lowDataMode).toBeDefined()
      expect(prefs.highContrast).toBeDefined()
      expect(prefs.reduceMotion).toBeDefined()
      expect(prefs.preferredDifficulty).toBeDefined()
      expect(prefs.profileVisibility).toBeDefined()
    })

    it('should update preferences', async () => {
      const { preferenceService } = ctx

      const updated = await preferenceService.updatePreferences(testUserId, {
        locale: 'es',
        timezone: 'Europe/Madrid',
        lowDataMode: true,
        highContrast: true,
        reduceMotion: true,
        preferredDifficulty: 'intermediate',
        profileVisibility: 'private',
      })

      expect(updated.locale).toBe('es')
      expect(updated.timezone).toBe('Europe/Madrid')
      expect(updated.lowDataMode).toBe(true)
      expect(updated.highContrast).toBe(true)
      expect(updated.reduceMotion).toBe(true)
    })
  })

  describe('Avatar', () => {
    it('should create upload intent', async () => {
      const { avatarService } = ctx

      const upload = await avatarService.createUploadIntent(testUserId, 'image/png')

      expect(upload.uploadUrl).toBeDefined()
      expect(upload.uploadKey).toBeDefined()
      expect(upload.expiresAt).toBeDefined()
    })

    // 1x1 transparent PNG (68 bytes) - pad to meet 1KB minimum
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)
const MIN_PNG_SIZE = 1024 // 1KB minimum
const TINY_PNG_PADDED = Buffer.concat([TINY_PNG, Buffer.alloc(MIN_PNG_SIZE - TINY_PNG.length)])

    it('should finalize avatar upload', async () => {
      const { avatarService } = ctx

      const upload = await avatarService.createUploadIntent(testUserId, 'image/png')

      // Write valid PNG to storage (padded to meet 1KB minimum)
      fakeStorageProvider.put(upload.uploadKey, TINY_PNG_PADDED)

      const avatar = await avatarService.finalize(
        testUserId,
        upload.uploadKey,
      )

      expect(avatar.variantCount).toBeGreaterThan(0)
      expect(avatar.width).toBeDefined()
      expect(avatar.height).toBeDefined()
    })

    it('should delete avatar', async () => {
      const { avatarService } = ctx

      const upload = await avatarService.createUploadIntent(testUserId, 'image/png')
      fakeStorageProvider.put(upload.uploadKey, TINY_PNG_PADDED)
      await avatarService.finalize(testUserId, upload.uploadKey)

      await avatarService.deleteAvatar(testUserId)

      const profile = await ctx.profileService.getOwnerView(testUserId)
      expect(profile.avatarUrl).toBeNull()
    })
  })

  describe('Data Export', () => {
    it('should create data export request', async () => {
      const { dataExportService } = ctx

      const result = await dataExportService.requestExport(testUserId)

      expect(result.kind).toBe('created')
      expect(result.request.id).toBeDefined()
      expect(result.request.userId).toBe(testUserId)
      expect(result.request.status).toBe('pending')
      expect(result.request.nextAttemptAt).toBeDefined()
    })

    it('should return existing pending export request', async () => {
      const { dataExportService } = ctx

      const result1 = await dataExportService.requestExport(testUserId)
      const result2 = await dataExportService.requestExport(testUserId)

      expect(result2.kind).toBe('duplicate')
      expect(result2.request.id).toBe(result1.request.id)
    })

    it('should get export status', async () => {
      const { dataExportService } = ctx

      const result = await dataExportService.requestExport(testUserId)
      const status = await dataExportService.getExportStatus(testUserId, result.request.id)

      expect(status?.id).toBe(result.request.id)
      expect(status?.status).toBe('pending')
    })

    it('should list user exports', async () => {
      const { dataExportService } = ctx

      await dataExportService.requestExport(testUserId)

      const exports = await prisma.dataExportRequest.findMany({
        where: { userId: testUserId },
      })

      expect(exports.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Account Deactivation', () => {
    it('should deactivate account', async () => {
      const { accountLifecycleService } = ctx

      const result = await accountLifecycleService.deactivate(testUserId, 'ACTIVE', createRequestContext())

      expect(result.kind).toBe('deactivated')

      const user = await prisma.user.findUnique({ where: { id: testUserId } })
      expect(user?.status).toBe('DEACTIVATED')
    })

    it('should reject deactivation of non-active account', async () => {
      const { accountLifecycleService } = ctx

      await prisma.user.update({ where: { id: testUserId }, data: { status: 'DEACTIVATED' } })

      const result = await accountLifecycleService.deactivate(testUserId, 'DEACTIVATED', createRequestContext())

      expect(result.kind).toBe('conflict')
    })

    it('should reactivate account', async () => {
      const { accountLifecycleService } = ctx

      await accountLifecycleService.deactivate(testUserId, 'ACTIVE', createRequestContext())
      await accountLifecycleService.reactivate(testUserId, createRequestContext())

      const user = await prisma.user.findUnique({ where: { id: testUserId } })
      expect(user?.status).toBe('ACTIVE')
    })
  })

  describe('Account Deletion', () => {
    it('should request account deletion', async () => {
      const { accountLifecycleService } = ctx

      const result = await accountLifecycleService.requestDeletion(testUserId, 'User requested', createRequestContext())

      expect(result.kind).toBe('created')
      expect(result.request.status).toBe('pending')
      expect(result.request.scheduledFor).toBeDefined()
    })

    it('should reject duplicate deletion request', async () => {
      const { accountLifecycleService } = ctx

      await accountLifecycleService.requestDeletion(testUserId, 'First request', createRequestContext())
      const result = await accountLifecycleService.requestDeletion(testUserId, 'Second request', createRequestContext())

      expect(result.kind).toBe('duplicate')
    })

    it('should cancel deletion request', async () => {
      const { accountLifecycleService } = ctx

      await accountLifecycleService.requestDeletion(testUserId, 'To be cancelled', createRequestContext())
      const result = await accountLifecycleService.cancelDeletion(testUserId, createRequestContext())

      expect(result.kind).toBe('cancelled')
    })

    it('should not cancel already processing deletion', async () => {
      const { accountLifecycleService } = ctx

      await accountLifecycleService.requestDeletion(testUserId, 'To be processed', createRequestContext())

      await prisma.accountDeletionRequest.updateMany({
        where: { userId: testUserId },
        data: { status: 'PROCESSING' },
      })

      const result = await accountLifecycleService.cancelDeletion(testUserId, createRequestContext())

      expect(result.kind).toBe('finalized')
    })
  })
})