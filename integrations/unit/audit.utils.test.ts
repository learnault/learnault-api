/**
 * Tests for audit utils - metadata sanitization and PII redaction
 */

import { describe, it, expect } from 'vitest'
import {
  sanitizeMetadata,
  extractSafeMetadata,
  containsSensitiveData,
  anonymizeUserData,
} from '../../src/audit/utils.js'

describe('Audit Utils', () => {
  describe('sanitizeMetadata', () => {
    it('should redact password fields', () => {
      const metadata = {
        username: 'john',
        password: 'super-secret-123',
        newPassword: 'another-secret',
      }

      const sanitized = sanitizeMetadata(metadata)

      expect(sanitized.username).toBe('john')
      expect(sanitized.password).toMatch(/\*\*\*/)
      expect(sanitized.newPassword).toMatch(/\*\*\*/)
    })

    it('should redact token fields', () => {
      const metadata = {
        userId: '123',
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
        apiKey: 'sk-1234567890abcdef',
        accessToken: 'access-token-value',
      }

      const sanitized = sanitizeMetadata(metadata)

      expect(sanitized.userId).toBe('123')
      expect(sanitized.token).toMatch(/\*\*\*/)
      expect(sanitized.apiKey).toMatch(/\*\*\*/)
      expect(sanitized.accessToken).toMatch(/\*\*\*/)
    })

    it('should redact PII fields', () => {
      const metadata = {
        name: 'John Doe',
        email: 'john@example.com',
        phone: '+1234567890',
        mobile: '+0987654321',
      }

      const sanitized = sanitizeMetadata(metadata)

      expect(sanitized.name).toBe('John Doe') // name is allowed
      expect(sanitized.email).toMatch(/\*\*\*/)
      expect(sanitized.phone).toMatch(/\*\*\*/)
      expect(sanitized.mobile).toMatch(/\*\*\*/)
    })

    it('should redact OTP and verification codes', () => {
      const metadata = {
        otp: '123456',
        code: '789012',
        verificationCode: '345678',
        pin: '9876',
      }

      const sanitized = sanitizeMetadata(metadata)

      expect(sanitized.otp).toBe('***')
      expect(sanitized.code).toBe('***')
      expect(sanitized.verificationCode).toMatch(/\*\*\*/)
      expect(sanitized.pin).toBe('***')
    })

    it('should preserve safe fields', () => {
      const metadata = {
        id: 'user-123',
        userId: 'user-456',
        status: 'ACTIVE',
        oldStatus: 'INACTIVE',
        newStatus: 'ACTIVE',
        amount: 100.5,
        count: 42,
        reason: 'User request',
      }

      const sanitized = sanitizeMetadata(metadata)

      expect(sanitized).toEqual(metadata)
    })

    it('should handle nested objects', () => {
      const metadata = {
        user: {
          id: 'user-123',
          password: 'secret',
          email: 'user@example.com',
        },
        changes: {
          status: 'ACTIVE',
          token: 'abc123',
        },
      }

      const sanitized = sanitizeMetadata(metadata)

      expect(sanitized.user.id).toBe('user-123')
      expect(sanitized.user.password).toMatch(/\*\*\*/)
      expect(sanitized.user.email).toMatch(/\*\*\*/)
      expect(sanitized.changes.status).toBe('ACTIVE')
      expect(sanitized.changes.token).toMatch(/\*\*\*/)
    })

    it('should handle arrays', () => {
      const metadata = {
        users: [
          { id: '1', password: 'secret1' },
          { id: '2', password: 'secret2' },
        ],
        statuses: ['ACTIVE', 'INACTIVE'],
      }

      const sanitized = sanitizeMetadata(metadata)

      expect(sanitized.users[0].id).toBe('1')
      expect(sanitized.users[0].password).toMatch(/\*\*\*/)
      expect(sanitized.users[1].id).toBe('2')
      expect(sanitized.users[1].password).toMatch(/\*\*\*/)
      expect(sanitized.statuses).toEqual(['ACTIVE', 'INACTIVE'])
    })

    it('should prevent infinite recursion', () => {
      const metadata: any = {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: {
                  level6: {
                    deep: 'value',
                  },
                },
              },
            },
          },
        },
      }

      const sanitized = sanitizeMetadata(metadata)

      expect(sanitized.level1.level2.level3.level4.level5).toHaveProperty(
        '_truncated'
      )
    })

    it('should redact blockchain secrets', () => {
      const metadata = {
        walletAddress: 'GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37',
        privateKey: 'SBZVMB74P76QV3IQBKHZFBFKH3MQELPL7ZXVLFVTXQZ5QHQMM7MLQAXY',
        seedPhrase: 'word1 word2 word3 word4 word5 word6 word7 word8',
      }

      const sanitized = sanitizeMetadata(metadata)

      expect(sanitized.walletAddress).toBe(metadata.walletAddress) // public address is safe
      expect(sanitized.privateKey).toMatch(/\*\*\*/)
      expect(sanitized.seedPhrase).toMatch(/\*\*\*/)
    })
  })

  describe('extractSafeMetadata', () => {
    it('should extract only safe fields', () => {
      const data = {
        id: 'user-123',
        userId: 'user-456',
        status: 'ACTIVE',
        password: 'secret',
        email: 'user@example.com',
        token: 'abc123',
        amount: 100,
        reason: 'Test',
      }

      const safe = extractSafeMetadata(data)

      expect(safe.id).toBe('user-123')
      expect(safe.userId).toBe('user-456')
      expect(safe.status).toBe('ACTIVE')
      expect(safe.amount).toBe(100)
      expect(safe.reason).toBe('Test')
      expect(safe.password).toBeUndefined()
      expect(safe.email).toBeUndefined()
      expect(safe.token).toBeUndefined()
    })
  })

  describe('containsSensitiveData', () => {
    it('should detect sensitive fields in metadata', () => {
      const metadata1 = {
        userId: '123',
        status: 'ACTIVE',
      }

      expect(containsSensitiveData(metadata1)).toBe(false)

      const metadata2 = {
        userId: '123',
        password: 'secret',
      }

      expect(containsSensitiveData(metadata2)).toBe(true)

      const metadata3 = {
        user: {
          id: '123',
          token: 'abc',
        },
      }

      expect(containsSensitiveData(metadata3)).toBe(true)
    })
  })

  describe('anonymizeUserData', () => {
    it('should pseudonymize user ID', () => {
      const userId = '12345678-1234-1234-1234-123456789012'
      const anonymized = anonymizeUserData(userId)

      expect(anonymized.userId).toContain('anonymized_')
      expect(anonymized.userId).toContain(userId.slice(0, 8))
      expect(anonymized._note).toContain('GDPR')
    })
  })

  describe('Edge Cases', () => {
    it('should handle null and undefined values', () => {
      const metadata = {
        value1: null,
        value2: undefined,
        value3: 'valid',
      }

      const sanitized = sanitizeMetadata(metadata)

      expect(sanitized.value1).toBeNull()
      expect(sanitized.value2).toBeUndefined()
      expect(sanitized.value3).toBe('valid')
    })

    it('should handle empty objects', () => {
      const metadata = {}
      const sanitized = sanitizeMetadata(metadata)

      expect(sanitized).toEqual({})
    })

    it('should handle empty arrays', () => {
      const metadata = {
        items: [],
      }

      const sanitized = sanitizeMetadata(metadata)

      expect(sanitized.items).toEqual([])
    })

    it('should handle mixed types', () => {
      const metadata = {
        string: 'text',
        number: 42,
        boolean: true,
        null: null,
        undefined: undefined,
        array: [1, 2, 3],
        object: { key: 'value' },
      }

      const sanitized = sanitizeMetadata(metadata)

      expect(sanitized.string).toBe('text')
      expect(sanitized.number).toBe(42)
      expect(sanitized.boolean).toBe(true)
      expect(sanitized.null).toBeNull()
      expect(sanitized.array).toEqual([1, 2, 3])
      expect(sanitized.object).toEqual({ key: 'value' })
    })
  })
})
