/**
 * Audit utility functions for metadata sanitization and PII redaction
 */

import type { AuditMetadata } from './types.js'

/**
 * Sensitive field patterns that should be excluded from audit metadata
 */
const SENSITIVE_FIELD_PATTERNS = [
  // Authentication & Authorization
  /password/i,
  /passwd/i,
  /pwd/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /auth/i,
  /bearer/i,
  /credential/i,
  
  // Personal Identifiable Information
  /email/i,
  /phone/i,
  /mobile/i,
  /ssn/i,
  /social[_-]?security/i,
  /credit[_-]?card/i,
  /card[_-]?number/i,
  /cvv/i,
  /cvc/i,
  
  // Blockchain & Wallet
  /private[_-]?key/i,
  /seed[_-]?phrase/i,
  /mnemonic/i,
  /wallet[_-]?secret/i,
  
  // OTP & Verification
  /otp/i,
  /code/i,
  /pin/i,
  /verification[_-]?code/i,
  
  // Session & Tracking
  /session/i,
  /cookie/i,
  /csrf/i,
]

/**
 * Check if a field name is sensitive
 */
function isSensitiveField(fieldName: string): boolean {
  return SENSITIVE_FIELD_PATTERNS.some((pattern) => pattern.test(fieldName))
}

/**
 * Redact sensitive value
 */
function redactValue(value: unknown): string {
  if (typeof value === 'string') {
    if (value.length <= 4) {
      return '***'
    }
    // Show first and last 2 characters, redact middle

    return `${value.slice(0, 2)}***${value.slice(-2)}`
  }

  return '***'
}

/**
 * Recursively sanitize metadata to remove sensitive information
 */
export function sanitizeMetadata(
  metadata: AuditMetadata,
  depth = 0
): AuditMetadata {
  // Prevent infinite recursion
  if (depth > 5) {
    return { _truncated: 'Max depth exceeded' }
  }

  const sanitized: AuditMetadata = {}

  for (const [key, value] of Object.entries(metadata)) {
    // Check if field is sensitive
    if (isSensitiveField(key)) {
      sanitized[key] = redactValue(value)
      continue
    }

    // Handle nested objects
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      sanitized[key] = sanitizeMetadata(
        value as AuditMetadata,
        depth + 1
      )
      continue
    }

    // Handle arrays
    if (Array.isArray(value)) {
      sanitized[key] = value.map((item) => {
        if (item && typeof item === 'object') {
          return sanitizeMetadata(item as AuditMetadata, depth + 1)
        }
        
return item
      })
      continue
    }

    // Safe primitive value
    sanitized[key] = value
  }

  return sanitized
}

/**
 * Extract safe metadata from request for auditing
 */
export function extractSafeMetadata(data: Record<string, unknown>): AuditMetadata {
  const safe: AuditMetadata = {}

  // List of safe fields to include
  const safeFields = [
    'id',
    'userId',
    'moduleId',
    'status',
    'oldStatus',
    'newStatus',
    'type',
    'action',
    'reason',
    'amount',
    'count',
    'affectedRecords',
    'method',
    'path',
    'duration',
  ]

  for (const field of safeFields) {
    if (field in data && data[field] !== undefined) {
      safe[field] = data[field]
    }
  }

  return safe
}

/**
 * Anonymize user data for GDPR compliance
 * Returns pseudonymized identifier instead of actual user data
 */
export function anonymizeUserData(userId: string): AuditMetadata {
  return {
    userId: `anonymized_${userId.slice(0, 8)}`,
    _note: 'User data anonymized per GDPR request',
  }
}

/**
 * Check if metadata contains any sensitive information
 * Used for validation before storing
 */
export function containsSensitiveData(metadata: AuditMetadata): boolean {
  for (const [key, value] of Object.entries(metadata)) {
    if (isSensitiveField(key)) {
      return true
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (containsSensitiveData(value as AuditMetadata)) {
        return true
      }
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object') {
          if (containsSensitiveData(item as AuditMetadata)) {
            return true
          }
        }
      }
    }
  }

  return false
}

/**
 * Format audit metadata for safe logging
 */
export function formatAuditMetadata(metadata: AuditMetadata): string {
  try {
    return JSON.stringify(sanitizeMetadata(metadata), null, 2)
  } catch {
    return '[Unable to format metadata]'
  }
}
