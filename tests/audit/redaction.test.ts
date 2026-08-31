import { describe, it, expect } from 'vitest'
import {
  REDACTED,
  RedactionLimits,
  TRUNCATED,
  hashIpAddress,
  isDeniedKey,
  isDeniedValue,
  redactMetadata,
  serializeMetadata,
  userAgentFamily,
} from '../../src/audit/redaction'

describe('audit redaction', () => {
  describe('key deny-list', () => {
    it.each([
      'password',
      'newPassword',
      'password_hash',
      'refreshToken',
      'accessToken',
      'tokenHash',
      'apiKey',
      'API_KEY',
      'authorization',
      'Cookie',
      'clientSecret',
      'privateKey',
      'mnemonic',
      'passphrase',
      'jwt',
      'signature',
      'codeHash',
      'otp',
    ])('denies the secret-bearing key %s', (key) => {
      expect(isDeniedKey(key)).toBe(true)
    })

    it.each([
      'email',
      'emailAddress',
      'phone',
      'phoneNumber',
      'msisdn',
      'fullName',
      'dateOfBirth',
      'ipAddress',
      'userAgent',
      'fingerprint',
      'cardNumber',
      'ssn',
    ])('denies the personal-identifier key %s', (key) => {
      expect(isDeniedKey(key)).toBe(true)
    })

    it.each([
      'statusCode',
      'failureCode',
      'errorCode',
      'referralCode',
      'attemptCount',
      'walletId',
      'moduleId',
      'requestId',
      'amountStroops',
      'assetCode',
      'status',
      'reason',
    ])('allows the operational key %s', (key) => {
      // Over-redaction is its own failure: an audit trail nobody can read is
      // not reviewable. These are the keys investigators actually need.
      expect(isDeniedKey(key)).toBe(false)
    })

    it('normalizes separators and case before matching', () => {
      expect(isDeniedKey('USER_AGENT')).toBe(true)
      expect(isDeniedKey('user-agent')).toBe(true)
      expect(isDeniedKey('userAgent')).toBe(true)
    })
  })

  describe('value deny-list', () => {
    it('denies a Stellar secret seed', () => {
      expect(
        isDeniedValue(
          'SBQWY3DNPFWGSZTFNV4WQZLBOJ7SFQNDBQFXHTOYIY5QYVCSFRCFUKPP',
        ),
      ).toBe(true)
    })

    it('denies a Stellar public key', () => {
      expect(
        isDeniedValue(
          'GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGQFKKWXR6DOSJBV7STMAQSMTGG',
        ),
      ).toBe(true)
    })

    it('denies a JWT', () => {
      expect(
        isDeniedValue(
          'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
        ),
      ).toBe(true)
    })

    it('denies a bearer credential', () => {
      expect(isDeniedValue('Bearer abcdef0123456789abcdef')).toBe(true)
    })

    it('denies an email address', () => {
      expect(isDeniedValue('learner@example.com')).toBe(true)
    })

    it('denies an E.164 phone number', () => {
      expect(isDeniedValue('call +2348012345678 now')).toBe(true)
    })

    it('denies an IPv4 address', () => {
      expect(isDeniedValue('203.0.113.42')).toBe(true)
    })

    it('denies a long opaque hex blob', () => {
      expect(isDeniedValue('a'.repeat(64))).toBe(true)
    })

    it('denies a PEM private key header', () => {
      expect(isDeniedValue('-----BEGIN RSA PRIVATE KEY-----')).toBe(true)
    })

    it('allows an identifier, a status and a stroop amount', () => {
      expect(isDeniedValue('550e8400-e29b-41d4-a716-446655440000')).toBe(false)
      expect(isDeniedValue('PENDING_DELETION')).toBe(false)
      expect(isDeniedValue('10000000')).toBe(false)
      expect(isDeniedValue('api.account.deactivate')).toBe(false)
    })
  })

  describe('redactMetadata', () => {
    it('returns null for empty input', () => {
      expect(redactMetadata(null).value).toBeNull()
      expect(redactMetadata(undefined).value).toBeNull()
    })

    it('keeps safe fields untouched', () => {
      const { value, redactedPaths } = redactMetadata({
        walletId: 'w-1',
        from: 'RESERVED',
        to: 'ACTIVE',
        attempt: 3,
        terminal: false,
      })

      expect(value).toEqual({
        walletId: 'w-1',
        from: 'RESERVED',
        to: 'ACTIVE',
        attempt: 3,
        terminal: false,
      })
      expect(redactedPaths).toEqual([])
    })

    it('replaces a denied key without inspecting its value', () => {
      const { value, redactedPaths } = redactMetadata({
        password: 'hunter2',
        userId: 'u-1',
      })

      expect(value).toMatchObject({ password: REDACTED, userId: 'u-1' })
      expect(redactedPaths).toEqual(['password'])
    })

    it('replaces a secret hiding under an innocuous key', () => {
      // The key deny-list cannot catch this one; the value deny-list must.
      const { value, redactedPaths } = redactMetadata({
        note: 'recovery is SBQWY3DNPFWGSZTFNV4WQZLBOJ7SFQNDBQFXHTOYIY5QYVCSFRCFUKPP',
      })

      expect(value!.note).toBe(REDACTED)
      expect(redactedPaths).toEqual(['note'])
    })

    it('redacts inside nested objects and arrays, reporting the path', () => {
      const { value, redactedPaths } = redactMetadata({
        session: { device: 'pixel-7', ipAddress: '203.0.113.9' },
        recipients: [{ email: 'a@b.com' }, { email: 'c@d.com' }],
      })

      expect((value!.session as Record<string, unknown>).ipAddress).toBe(
        REDACTED,
      )
      expect(redactedPaths).toContain('session.ipAddress')
      expect(redactedPaths).toContain('recipients[0].email')
      expect(redactedPaths).toContain('recipients[1].email')
    })

    it('records that redaction happened, so a reader is not misled', () => {
      const { value } = redactMetadata({ token: 'abc', keep: 'yes' })

      expect(value!._redacted).toEqual(['token'])
    })

    it('omits the marker when nothing was redacted', () => {
      const { value } = redactMetadata({ keep: 'yes' })

      expect(value).not.toHaveProperty('_redacted')
    })

    it('collapses values past the depth limit', () => {
      const deep = { a: { b: { c: { d: { e: { f: 'too far' } } } } } }
      const { value, truncated } = redactMetadata(deep)

      expect(truncated).toBe(true)
      expect(JSON.stringify(value)).toContain(TRUNCATED)
    })

    it('caps array length', () => {
      const { value, truncated } = redactMetadata({
        ids: Array.from({ length: 100 }, (_, index) => `id-${index}`),
      })

      expect((value!.ids as unknown[]).length).toBe(
        RedactionLimits.maxArrayLength,
      )
      expect(truncated).toBe(true)
    })

    it('caps object breadth', () => {
      const wide = Object.fromEntries(
        Array.from({ length: 100 }, (_, index) => [`k${index}`, index]),
      )
      const { value, truncated } = redactMetadata(wide)

      expect(Object.keys(value!).length).toBe(RedactionLimits.maxKeys)
      expect(truncated).toBe(true)
    })

    it('truncates an over-long string', () => {
      const { value, truncated } = redactMetadata({ note: 'x'.repeat(1000) })

      expect(value!.note).toBe(
        `${'x'.repeat(RedactionLimits.maxStringLength)}${TRUNCATED}`,
      )
      expect(truncated).toBe(true)
    })

    it('survives a circular reference instead of throwing', () => {
      const circular: Record<string, unknown> = { name: 'loop' }
      circular.self = circular

      const { value, truncated } = redactMetadata(circular)

      expect(value!.name).toBe('loop')
      expect(truncated).toBe(true)
    })

    it('renders a BigInt as a decimal string', () => {
      // Stroop amounts arrive as BigInt and are not JSON-serializable.
      expect(redactMetadata({ amountStroops: 10_000_000n }).value).toEqual({
        amountStroops: '10000000',
      })
    })

    it('renders a Date as an ISO timestamp', () => {
      expect(
        redactMetadata({ archivedAt: new Date('2026-08-24T10:00:00.000Z') })
          .value,
      ).toEqual({ archivedAt: '2026-08-24T10:00:00.000Z' })
    })

    it('keeps an error message but drops the stack', () => {
      const { value } = redactMetadata({ cause: new Error('lease lost') })

      expect(value!.cause).toEqual({ name: 'Error', message: 'lease lost' })
      expect(JSON.stringify(value)).not.toContain('at ')
    })

    it('replaces a function or symbol, which is always a caller mistake', () => {
      const { value, redactedPaths } = redactMetadata({
        callback: () => undefined,
        marker: Symbol('x'),
      })

      expect(value!.callback).toBe(REDACTED)
      expect(value!.marker).toBe(REDACTED)
      expect(redactedPaths).toEqual(['callback', 'marker'])
    })

    it('normalizes a non-finite number to null', () => {
      expect(
        redactMetadata({ ratio: Number.NaN, size: Infinity }).value,
      ).toEqual({
        ratio: null,
        size: null,
      })
    })
  })

  describe('serializeMetadata', () => {
    it('returns null for empty input', () => {
      expect(serializeMetadata(null)).toBeNull()
      expect(serializeMetadata({})).toBeNull()
    })

    it('produces parseable JSON with secrets already replaced', () => {
      const serialized = serializeMetadata({
        password: 'hunter2',
        userId: 'u-1',
      })!
      const parsed = JSON.parse(serialized)

      expect(parsed).toMatchObject({ password: REDACTED, userId: 'u-1' })
      expect(serialized).not.toContain('hunter2')
    })

    it('drops an oversized payload rather than storing an unparseable prefix', () => {
      const serialized = serializeMetadata({
        blob: Array.from({ length: 20 }, () => 'y'.repeat(250)),
      })!

      expect(() => JSON.parse(serialized)).not.toThrow()
      expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(
        RedactionLimits.maxSerializedBytes,
      )
    })

    it('flags that a cap fired, so the row is not read as complete', () => {
      const serialized = serializeMetadata({ note: 'z'.repeat(1000) })!

      expect(JSON.parse(serialized)._truncated).toBe(true)
    })
  })

  describe('hashIpAddress', () => {
    const secret = 'test-secret'

    it('returns null for a missing address', () => {
      expect(hashIpAddress(null, secret)).toBeNull()
      expect(hashIpAddress(undefined, secret)).toBeNull()
      expect(hashIpAddress('', secret)).toBeNull()
    })

    it('never returns the address itself', () => {
      const hash = hashIpAddress('203.0.113.42', secret)!

      expect(hash).not.toContain('203')
      expect(hash).toMatch(/^[0-9a-f]{32}$/)
    })

    it('is stable, so events from one source can be correlated', () => {
      expect(hashIpAddress('203.0.113.42', secret)).toBe(
        hashIpAddress('203.0.113.42', secret),
      )
    })

    it('separates different addresses', () => {
      expect(hashIpAddress('203.0.113.42', secret)).not.toBe(
        hashIpAddress('203.0.113.43', secret),
      )
    })

    it('is keyed, so a rotated secret breaks correlation with older hashes', () => {
      // The point of HMAC over a bare digest: the IPv4 space is small enough
      // that an unkeyed hash is reversible by enumeration.
      expect(hashIpAddress('203.0.113.42', 'secret-a')).not.toBe(
        hashIpAddress('203.0.113.42', 'secret-b'),
      )
    })

    it('ignores surrounding whitespace', () => {
      expect(hashIpAddress(' 203.0.113.42 ', secret)).toBe(
        hashIpAddress('203.0.113.42', secret),
      )
    })
  })

  describe('userAgentFamily', () => {
    it('returns null for a missing User-Agent', () => {
      expect(userAgentFamily(null)).toBeNull()
      expect(userAgentFamily('')).toBeNull()
    })

    it.each([
      [
        'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.0.0 Safari/537.36',
        'Chrome',
      ],
      [
        'Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537.36 Edg/120.0',
        'Edge',
      ],
      ['Mozilla/5.0 (X11; Linux) Firefox/121.0', 'Firefox'],
      ['Mozilla/5.0 (Macintosh) Version/17.0 Safari/605.1.15', 'Safari'],
      ['okhttp/4.12.0', 'Android'],
      ['LearnaultApp/1.0 CFNetwork/1494 Darwin/23.4.0', 'iOS'],
      ['curl/8.4.0', 'curl'],
      ['PostmanRuntime/7.36.0', 'Postman'],
      ['Googlebot/2.1', 'Bot'],
    ])('reduces %s to %s', (ua, family) => {
      expect(userAgentFamily(ua)).toBe(family)
    })

    it('resolves Edge before Chrome, which it also advertises', () => {
      expect(
        userAgentFamily('Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'),
      ).toBe('Edge')
    })

    it('falls back to Other for an unrecognized agent', () => {
      expect(userAgentFamily('SomeInternalClient/2.0')).toBe('Other')
    })

    it('discards the version and platform detail it was given', () => {
      const family = userAgentFamily(
        'Mozilla/5.0 (Windows NT 10.0; Win64) Chrome/120.0.6099.109',
      )!

      expect(family).toBe('Chrome')
      expect(family).not.toContain('120')
      expect(family).not.toContain('Windows')
    })
  })
})
