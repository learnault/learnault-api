import { describe, it, expect } from 'vitest'
import {
  computeProfileCompletion,
  isDisclosureAllowed,
  redactedProfile,
  toAccountSummary,
  toConsentSummary,
  toEmployerProfile,
  toOnboardingSummary,
  toOwnerAccountProfile,
  toOwnerProfile,
  toPrivateProfile,
  toProfileRecord,
  toPublicProfile,
} from '../src/services/profile-serializer'
import { AccountSummary, LearnerProfileRecord } from '../src/types/profile.types'

const baseProfile: LearnerProfileRecord = {
  id: 'profile1',
  userId: 'user1',
  displayName: 'Ada Learner',
  bio: 'Building on Stellar',
  avatarUrl: 'https://cdn.example.com/a.png',
  country: 'NG',
  timezone: 'Africa/Lagos',
  languages: ['en', 'ig'],
  level: 'intermediate',
  interests: ['blockchain'],
  goals: ['finish course'],
  visibility: 'public',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-02'),
}

describe('computeProfileCompletion', () => {
  it('is 100% when every tracked field is filled', () => {
    expect(computeProfileCompletion(baseProfile)).toEqual({ percent: 100, missingFields: [] })
  })

  it('is deterministic for the same input', () => {
    const first = computeProfileCompletion(baseProfile)
    const second = computeProfileCompletion(baseProfile)

    expect(first).toEqual(second)
  })

  it('lists missing fields for an empty profile', () => {
    const empty: LearnerProfileRecord = {
      ...baseProfile,
      displayName: null,
      bio: null,
      avatarUrl: null,
      country: null,
      timezone: null,
      languages: [],
      interests: [],
      goals: [],
    }

    const result = computeProfileCompletion(empty)

    expect(result.percent).toBe(0)
    expect(result.missingFields).toEqual([
      'displayName', 'bio', 'avatarUrl', 'country', 'timezone', 'languages', 'interests', 'goals',
    ])
  })

  it('does not count level, since it always has a default', () => {
    const result = computeProfileCompletion(baseProfile)

    expect(result.missingFields).not.toContain('level')
  })
})

describe('toOwnerProfile', () => {
  it('always returns every field regardless of visibility', () => {
    const privateProfile: LearnerProfileRecord = { ...baseProfile, visibility: 'private' }

    const view = toOwnerProfile(privateProfile)

    expect(view.displayName).toBe('Ada Learner')
    expect(view.bio).toBe('Building on Stellar')
    expect(view.completion.percent).toBe(100)
  })

  it('leaves the archive bookkeeping columns out of the response', () => {
    // The Prisma row carries these; the documented profile contract does not.
    const loaded = {
      ...baseProfile,
      archivedAt: null,
      archivedById: null,
      archivedReason: null,
    } as unknown as LearnerProfileRecord

    const view = toOwnerProfile(loaded) as Record<string, unknown>

    expect(view).not.toHaveProperty('archivedAt')
    expect(view).not.toHaveProperty('archivedById')
    expect(view).not.toHaveProperty('archivedReason')
  })
})

describe('toProfileRecord', () => {
  it('returns exactly the declared profile fields', () => {
    const loaded = {
      ...baseProfile,
      archivedAt: new Date(),
      archivedReason: 'moderation',
      password: 'should never be here',
    } as unknown as LearnerProfileRecord

    expect(Object.keys(toProfileRecord(loaded)).sort()).toEqual(
      Object.keys(baseProfile).sort()
    )
  })
})

describe('toEmployerProfile', () => {
  it('redacts fields when visibility is private', () => {
    const profile: LearnerProfileRecord = { ...baseProfile, visibility: 'private' }

    const view = toEmployerProfile(profile)

    expect(view).toEqual({ id: profile.id, visible: false })
  })

  it('exposes fields when visibility is employer', () => {
    const profile: LearnerProfileRecord = { ...baseProfile, visibility: 'employer' }

    const view = toEmployerProfile(profile)

    expect(view.visible).toBe(true)
    if (view.visible) {
      expect(view.displayName).toBe('Ada Learner')
    }
  })

  it('exposes fields when visibility is public', () => {
    const view = toEmployerProfile(baseProfile)

    expect(view.visible).toBe(true)
  })

  it('never includes account-private fields', () => {
    const view = toEmployerProfile({ ...baseProfile, visibility: 'employer' }) as Record<string, unknown>

    expect(view).not.toHaveProperty('status')
    expect(view).not.toHaveProperty('isVerified')
    expect(view).not.toHaveProperty('phoneVerifiedAt')
  })
})

describe('toPublicProfile', () => {
  it('redacts fields unless visibility is public', () => {
    const employerOnly: LearnerProfileRecord = { ...baseProfile, visibility: 'employer' }

    expect(toPublicProfile(employerOnly)).toEqual({ id: employerOnly.id, visible: false })
  })

  it('exposes only the public-safe subset when visibility is public', () => {
    const view = toPublicProfile(baseProfile)

    expect(view.visible).toBe(true)
    if (view.visible) {
      expect(view).not.toHaveProperty('goals')
      expect(view).not.toHaveProperty('timezone')
      expect(view).not.toHaveProperty('languages')
    }
  })

  it('never includes account-private fields', () => {
    const view = toPublicProfile(baseProfile) as Record<string, unknown>

    expect(view).not.toHaveProperty('status')
    expect(view).not.toHaveProperty('isVerified')
    expect(view).not.toHaveProperty('phoneVerifiedAt')
  })
})

describe('toPrivateProfile', () => {
  it('is the only serializer that carries account-private fields', () => {
    const view = toPrivateProfile(baseProfile, {
      status: 'ACTIVE',
      isVerified: true,
      phoneVerifiedAt: null,
    })

    expect(view.status).toBe('ACTIVE')
    expect(view.isVerified).toBe(true)
  })
})

// ── Consent-aware disclosure gate ──────────────────────────────────────────

describe('isDisclosureAllowed', () => {
  it('allows disclosure for an active account with no data-sharing record', () => {
    expect(isDisclosureAllowed({ accountStatus: 'ACTIVE', consents: [] })).toBe(true)
  })

  it('allows disclosure while data-sharing consent is granted', () => {
    expect(
      isDisclosureAllowed({
        accountStatus: 'ACTIVE',
        consents: [{ purpose: 'data_sharing', status: 'granted' }],
      })
    ).toBe(true)
  })

  it('refuses disclosure once data-sharing consent is withdrawn', () => {
    expect(
      isDisclosureAllowed({
        accountStatus: 'ACTIVE',
        consents: [{ purpose: 'data_sharing', status: 'withdrawn' }],
      })
    ).toBe(false)
  })

  it('ignores withdrawal of an unrelated purpose', () => {
    expect(
      isDisclosureAllowed({
        accountStatus: 'ACTIVE',
        consents: [{ purpose: 'marketing_emails', status: 'withdrawn' }],
      })
    ).toBe(true)
  })

  it.each(['DEACTIVATED', 'PENDING_DELETION', 'DELETED'])(
    'refuses disclosure for a %s account even with consent granted',
    status => {
      expect(
        isDisclosureAllowed({
          accountStatus: status,
          consents: [{ purpose: 'data_sharing', status: 'granted' }],
        })
      ).toBe(false)
    }
  )
})

describe('redactedProfile', () => {
  it('is indistinguishable from a below-threshold redaction, so a refusal leaks nothing', () => {
    const belowThreshold = toPublicProfile({ ...baseProfile, visibility: 'private' })

    expect(redactedProfile(baseProfile.id)).toEqual(belowThreshold)
  })
})

// ── Owner account/profile aggregate ────────────────────────────────────────

const baseAccount: AccountSummary = {
  id: 'user1',
  email: 'ada@example.com',
  username: 'ada',
  role: 'LEARNER',
  status: 'ACTIVE',
  isVerified: true,
  phoneVerifiedAt: null,
  walletAddress: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-02'),
  lastLoginAt: null,
}

describe('toAccountSummary', () => {
  it('never carries the password column, even when it is present on the input', () => {
    const withSecret = { ...baseAccount, password: '$2b$12$hash' } as unknown as AccountSummary

    const view = toAccountSummary(withSecret) as Record<string, unknown>

    expect(view).not.toHaveProperty('password')
    expect(view.email).toBe('ada@example.com')
  })

  it('drops any column added to User that has not been opted in', () => {
    const withNewColumn = {
      ...baseAccount,
      internalRiskScore: 99,
    } as unknown as AccountSummary

    expect(toAccountSummary(withNewColumn)).not.toHaveProperty('internalRiskScore')
  })
})

describe('toOnboardingSummary', () => {
  const progress = {
    version: 'v1',
    status: 'in_progress',
    currentStep: 'consent',
    completedSteps: ['profile_basics'],
    startedAt: new Date('2026-01-01'),
    completedAt: null,
  }

  it('computes the required steps still outstanding', () => {
    expect(toOnboardingSummary(progress).requiredStepsRemaining).toEqual(['consent'])
  })

  it('reports nothing outstanding once every required step is done', () => {
    const summary = toOnboardingSummary({
      ...progress,
      completedSteps: ['profile_basics', 'consent'],
    })

    expect(summary.requiredStepsRemaining).toEqual([])
  })

  it('copies completedSteps rather than aliasing the record', () => {
    const summary = toOnboardingSummary(progress)
    summary.completedSteps.push('preferences')

    expect(progress.completedSteps).toEqual(['profile_basics'])
  })
})

describe('toConsentSummary', () => {
  it('drops the row identifiers and keeps only current state', () => {
    const view = toConsentSummary({
      purpose: 'privacy_policy',
      status: 'granted',
      required: true,
      policyVersion: '2026-01',
      grantedAt: new Date('2026-01-01'),
      withdrawnAt: null,
    }) as Record<string, unknown>

    expect(view).toEqual({
      purpose: 'privacy_policy',
      status: 'granted',
      required: true,
      policyVersion: '2026-01',
      grantedAt: new Date('2026-01-01'),
      withdrawnAt: null,
    })
    expect(view).not.toHaveProperty('id')
    expect(view).not.toHaveProperty('userId')
    expect(view).not.toHaveProperty('source')
  })
})

describe('toOwnerAccountProfile', () => {
  const aggregate = () =>
    toOwnerAccountProfile({
      account: baseAccount,
      profile: baseProfile,
      onboarding: {
        version: 'v1',
        status: 'in_progress',
        currentStep: 'consent',
        completedSteps: ['profile_basics'],
        startedAt: new Date('2026-01-01'),
        completedAt: null,
      },
      consents: [
        {
          purpose: 'terms_of_service',
          status: 'granted',
          required: true,
          policyVersion: '2026-01',
          grantedAt: new Date('2026-01-01'),
          withdrawnAt: null,
        },
      ],
      requiredConsentsGranted: false,
    })

  it('returns profile completion alongside the profile', () => {
    expect(aggregate().completion).toEqual({ percent: 100, missingFields: [] })
  })

  it('returns onboarding state', () => {
    expect(aggregate().onboarding).toMatchObject({
      status: 'in_progress',
      currentStep: 'consent',
      requiredStepsRemaining: ['consent'],
    })
  })

  it('reports null onboarding for a learner who never started', () => {
    const view = toOwnerAccountProfile({
      account: baseAccount,
      profile: baseProfile,
      onboarding: null,
      consents: [],
      requiredConsentsGranted: false,
    })

    expect(view.onboarding).toBeNull()
  })

  it('never carries the password column', () => {
    const view = toOwnerAccountProfile({
      account: { ...baseAccount, password: 'secret' } as unknown as AccountSummary,
      profile: baseProfile,
      onboarding: null,
      consents: [],
      requiredConsentsGranted: true,
    })

    expect(JSON.stringify(view)).not.toContain('secret')
  })
})
