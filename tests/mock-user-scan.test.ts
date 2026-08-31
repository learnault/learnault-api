import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Static scan: the acceptance criterion "no production user route returns
 * hard-coded users" is a property of the source, not of any one request, so it
 * is asserted against the source.
 *
 * These are the files the mock helpers lived in or fed. A future change that
 * reintroduces a hard-coded user — as a quick unblock, a demo fixture, a
 * placeholder while a service is written — fails here rather than shipping.
 */
const USER_ROUTE_SOURCES = [
  'src/controllers/user.controller.ts',
  'src/controllers/profile.controller.ts',
  'src/routes/v1/users.routes.ts',
  'src/services/profile.service.ts',
  'src/services/user-account.service.ts',
  'src/services/profile-serializer.ts',
  'src/schemas/profile.schema.ts',
]

/** The helper names the mock implementations were reached through. */
const REMOVED_MOCK_HELPERS = [
  'findUserById',
  'updateUserProfile',
  'validatePassword',
  'updateUserPassword',
  'updateUserWallet',
  'isValidStellarAddress',
]

function source(file: string): string {
  return readFileSync(file, 'utf8')
}

describe('mock user helper scan', () => {
  it.each(USER_ROUTE_SOURCES)('%s declares no mock user literal', (file) => {
    // `mockUser`, `const mock…= {`, and the sentinel values the old helpers
    // returned. Comments naming the removed mocks are fine; a literal is not.
    expect(source(file)).not.toMatch(/\bmockUser\b/)
    expect(source(file)).not.toMatch(/test@example\.com/)
    expect(source(file)).not.toMatch(/\btestuser\b/)
    expect(source(file)).not.toMatch(/GABC123456789/)
  })

  it.each(USER_ROUTE_SOURCES)('%s contains no not-implemented stub', (file) => {
    expect(source(file)).not.toMatch(/Not implemented/i)
    expect(source(file)).not.toMatch(/throw new Error\(\s*['"`]TODO/i)
  })

  it.each(REMOVED_MOCK_HELPERS)(
    'the %s helper is gone from the user controller',
    (helper) => {
      expect(source('src/controllers/user.controller.ts')).not.toMatch(
        new RegExp(`(private|async)\\s+${helper}\\s*\\(`),
      )
    },
  )

  it('reads users through Prisma-backed services rather than in-controller literals', () => {
    const controller = source('src/controllers/user.controller.ts')

    expect(controller).toMatch(/profileService/)
    expect(controller).toMatch(/userAccountService/)
    // Nothing in the controller may talk to Prisma directly either: the point of
    // the services is that the persistence and its audit stay in one place.
    expect(controller).not.toMatch(/from '\.\.\/config\/database'/)
  })

  it('no longer advertises the password and wallet routes as unimplemented previews', () => {
    const swagger = source('src/config/swagger.ts')
    const controller = source('src/controllers/user.controller.ts')

    expect(swagger).not.toMatch(/not-yet-implemented/i)
    expect(controller).not.toMatch(/⚠️ \*\*Preview\*\*/)
  })

  it('keeps the deprecated mock-era validation middleware off every route', () => {
    // `validateProfileUpdate` validates firstName/lastName/bio/avatar, none of
    // which is a persisted column. It stays exported for its existing tests but
    // must not be mounted — so the check is on the import, not on a prose
    // mention of the name in a comment explaining why it is absent.
    const routeFiles = [
      'src/routes/v1/users.routes.ts',
      'src/routes/v1/avatar.routes.ts',
    ]

    for (const file of routeFiles) {
      const codeLines = source(file)
        .split('\n')
        .filter((line) => !line.trim().startsWith('//'))

      expect(codeLines.join('\n')).not.toMatch(/validateProfileUpdate/)
    }
  })

  it('never selects the password column into a profile or account read', () => {
    const services = [
      'src/services/profile.service.ts',
      'src/services/profile-serializer.ts',
    ]

    for (const file of services) {
      expect(source(file)).not.toMatch(/password:\s*true/)
    }
  })
})
