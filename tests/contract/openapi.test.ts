import { describe, expect, it } from 'vitest'
import { specs } from '../../src/config/swagger'

type Spec = {
  openapi: string
  paths: Record<string, Record<string, unknown>>
  components: { schemas: Record<string, unknown> }
}

const spec = specs as unknown as Spec

/** Every `$ref` string anywhere in the document. */
function collectRefs(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((child) => collectRefs(child, found))

    return found
  }

  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(
      node as Record<string, unknown>,
    )) {
      if (key === '$ref' && typeof value === 'string') {
        found.push(value)
      } else {
        collectRefs(value, found)
      }
    }
  }

  return found
}

describe('OpenAPI document', () => {
  it('builds a 3.x document with paths and component schemas', () => {
    expect(spec.openapi).toMatch(/^3\./)
    expect(Object.keys(spec.paths).length).toBeGreaterThan(0)
    expect(Object.keys(spec.components.schemas).length).toBeGreaterThan(0)
  })

  it('resolves every component $ref', () => {
    const dangling = [...new Set(collectRefs(spec))]
      .filter((ref) => ref.startsWith('#/components/schemas/'))
      .map((ref) => ref.replace('#/components/schemas/', ''))
      .filter((name) => !(name in spec.components.schemas))

    expect(dangling).toEqual([])
  })

  it('documents every user account and profile operation', () => {
    expect(spec.paths['/users/me']).toHaveProperty('get')
    expect(spec.paths['/users/me']).toHaveProperty('patch')
    expect(spec.paths['/users/{id}']).toHaveProperty('get')
    expect(spec.paths['/users/password']).toHaveProperty('patch')
    expect(spec.paths['/users/wallet']).toHaveProperty('patch')
    expect(spec.paths['/users/me/profile']).toHaveProperty('get')
    expect(spec.paths['/users/me/profile']).toHaveProperty('patch')
  })

  it('no longer defines the mock-era user schemas', () => {
    // `User`, `PublicUser` and `UpdateUserInput` described the mock helpers'
    // firstName/lastName/bio/avatar shape. Their replacements are
    // `AccountSummary`, `LearnerProfile`, `PublicProfile` and
    // `UpdateProfileInput`.
    for (const removed of ['PublicUser', 'UpdateUserInput']) {
      expect(spec.components.schemas).not.toHaveProperty(removed)
    }

    for (const added of [
      'AccountSummary',
      'LearnerProfile',
      'ProfileCompletion',
      'OnboardingSummary',
      'ConsentSummary',
      'OwnerAccountProfile',
      'PublicProfile',
      'UpdateProfileInput',
    ]) {
      expect(spec.components.schemas).toHaveProperty(added)
    }
  })

  it('keeps private account fields out of the documented public profile', () => {
    const publicProfile = JSON.stringify(spec.components.schemas.PublicProfile)

    for (const leak of [
      'email',
      'password',
      'walletAddress',
      'isVerified',
      'phoneVerifiedAt',
      'status',
    ]) {
      expect(publicProfile).not.toContain(leak)
    }
  })

  it('marks the public profile read as unauthenticated and the owner reads as bearer-authenticated', () => {
    expect(
      (spec.paths['/users/{id}'].get as { security: unknown[] }).security,
    ).toEqual([])
    expect(
      (spec.paths['/users/me'].get as { security: unknown[] }).security,
    ).toEqual([{ bearerAuth: [] }])
    expect(
      (spec.paths['/users/me'].patch as { security: unknown[] }).security,
    ).toEqual([{ bearerAuth: [] }])
  })

  it('closes the profile update body so undocumented fields cannot be sent', () => {
    const updateInput = spec.components.schemas.UpdateProfileInput as {
      additionalProperties: boolean
      properties: Record<string, unknown>
    }

    expect(updateInput.additionalProperties).toBe(false)

    for (const forbidden of [
      'status',
      'isVerified',
      'role',
      'userId',
      'id',
      'password',
      'email',
    ]) {
      expect(updateInput.properties).not.toHaveProperty(forbidden)
    }
  })

  it('documents the conflict response on the wallet update', () => {
    const responses = (
      spec.paths['/users/wallet'].patch as {
        responses: Record<string, unknown>
      }
    ).responses

    expect(responses).toHaveProperty('409')
    expect(responses).toHaveProperty('401')
    expect(responses).toHaveProperty('400')
  })
})
