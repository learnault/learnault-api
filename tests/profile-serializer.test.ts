import { describe, it, expect } from 'vitest'
import {
  computeProfileCompletion,
  toEmployerProfile,
  toOwnerProfile,
  toPrivateProfile,
  toPublicProfile,
} from '../src/services/profile-serializer'
import { LearnerProfileRecord } from '../src/types/profile.types'

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
