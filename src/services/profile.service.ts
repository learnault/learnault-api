import prisma from '../config/database'
import { AuditContext, auditedMutation } from '../audit'
import {
  AccountSummary,
  LearnerProfileRecord,
  OwnerAccountProfileView,
  UpdateLearnerProfileData,
} from '../types/profile.types'
import { REQUIRED_CONSENT_PURPOSES } from '../types/consent.types'
import {
  isDisclosureAllowed,
  redactedProfile,
  toEmployerProfile,
  toOwnerAccountProfile,
  toOwnerProfile,
  toPrivateProfile,
  toPublicProfile,
} from './profile-serializer'

/** `User` columns the aggregate read discloses. Never includes `password`. */
const ACCOUNT_SELECT = {
  id: true,
  email: true,
  username: true,
  role: true,
  status: true,
  isVerified: true,
  phoneVerifiedAt: true,
  walletAddress: true,
  createdAt: true,
  updatedAt: true,
  lastLoginAt: true,
} as const

/** Status of a tombstoned account: it must read as "not found", not as data. */
const DELETED_STATUS = 'DELETED'

export class ProfileService {
  async getOrCreateProfile(userId: string): Promise<LearnerProfileRecord> {
    return prisma.learnerProfile.upsert({
      where: { userId },
      update: {},
      create: { userId },
    }) as unknown as LearnerProfileRecord
  }

  async updateProfile(userId: string, data: UpdateLearnerProfileData): Promise<LearnerProfileRecord> {
    return prisma.learnerProfile.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    }) as unknown as LearnerProfileRecord
  }

  /**
   * Partial profile update, with its audit event committed in the same
   * transaction (see src/audit/audited-mutation.ts).
   *
   * `data` must already have been parsed by `updateProfileSchema`, which is what
   * bounds the write to owner-updatable fields — this method does not re-derive
   * that allow-list, it relies on having been handed a validated object.
   *
   * The metadata records which fields changed, never their values: a bio or a
   * display name in an append-only trail is PII that cannot be scrubbed later.
   */
  async updateProfileAudited(
    userId: string,
    data: UpdateLearnerProfileData,
    context: AuditContext
  ): Promise<LearnerProfileRecord> {
    return auditedMutation({
      action: 'learner_profile.updated',
      actor: context.actor,
      target: { type: 'LearnerProfile' },
      source: 'api.users.update_profile',
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { userId, fields: Object.keys(data).sort() },
      mutate: tx =>
        tx.learnerProfile.upsert({
          where: { userId },
          update: data,
          create: { userId, ...data },
        }) as unknown as Promise<LearnerProfileRecord>,
      resolveTargetId: profile => profile.id,
    })
  }

  async getOwnerView(userId: string) {
    const profile = await this.getOrCreateProfile(userId)

    return toOwnerProfile(profile)
  }

  /**
   * Everything `GET /users/me` needs, in one read: account identity, profile,
   * completion percentage, onboarding state, and current consent per purpose.
   *
   * Returns null for an unknown or tombstoned account, so the route answers 404
   * rather than materialising a profile row for a user that no longer exists.
   */
  async getOwnerAccountProfile(userId: string): Promise<OwnerAccountProfileView | null> {
    const account = await prisma.user.findUnique({
      where: { id: userId },
      select: ACCOUNT_SELECT,
    })

    if (!account || account.status === DELETED_STATUS) {
      return null
    }

    const [profile, onboarding, consents] = await Promise.all([
      this.getOrCreateProfile(userId),
      prisma.onboardingProgress.findUnique({ where: { userId } }),
      prisma.consentRecord.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        distinct: ['purpose'],
      }),
    ])

    return toOwnerAccountProfile({
      account: account as unknown as AccountSummary,
      profile,
      onboarding,
      consents,
      requiredConsentsGranted: REQUIRED_CONSENT_PURPOSES.every(purpose =>
        consents.some(consent => consent.purpose === purpose && consent.status === 'granted')
      ),
    })
  }

  /**
   * Employer-facing read. Layers the consent/status gate on top of the profile's
   * own `visibility` threshold; either one refusing yields the same stub.
   */
  async getEmployerView(userId: string) {
    const context = await this.disclosureContext(userId)
    if (!context) {
      return null
    }

    if (!context.allowed) {
      return redactedProfile(context.profile.id)
    }

    return toEmployerProfile(context.profile)
  }

  /** Public (possibly unauthenticated) read. Same gating as the employer view. */
  async getPublicView(userId: string) {
    const context = await this.disclosureContext(userId)
    if (!context) {
      return null
    }

    if (!context.allowed) {
      return redactedProfile(context.profile.id)
    }

    return toPublicProfile(context.profile)
  }

  async getPrivateView(userId: string) {
    const [profile, user] = await Promise.all([
      this.getOrCreateProfile(userId),
      prisma.user.findUnique({
        where: { id: userId },
        select: { status: true, isVerified: true, phoneVerifiedAt: true },
      }),
    ])

    if (!user) {
      return null
    }

    return toPrivateProfile(profile, user)
  }

  /**
   * Load the profile plus the two inputs to the disclosure gate.
   *
   * Null means "nothing to disclose at all" (no profile row, or no account) and
   * maps to 404. A loaded context with `allowed: false` means the profile exists
   * but must be redacted — a distinction the caller keeps to itself.
   */
  private async disclosureContext(userId: string): Promise<
    { profile: LearnerProfileRecord; allowed: boolean } | null
  > {
    const [profile, account, consents] = await Promise.all([
      prisma.learnerProfile.findFirst({ where: { userId } }),
      prisma.user.findUnique({ where: { id: userId }, select: { status: true } }),
      prisma.consentRecord.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        distinct: ['purpose'],
        select: { purpose: true, status: true },
      }),
    ])

    if (!profile || !account) {
      return null
    }

    return {
      profile: profile as unknown as LearnerProfileRecord,
      allowed: isDisclosureAllowed({ accountStatus: account.status, consents }),
    }
  }
}

export const profileService = new ProfileService()
