/**
 * Redaction filter for audit metadata.
 *
 * Audit rows are immutable, so anything written into them cannot be scrubbed
 * later. That inverts the usual defence: metadata is filtered on the way *in*,
 * and the filter is deny-by-default for anything that looks like a secret or an
 * identifier of a natural person.
 *
 * Two independent passes run over every value:
 *
 *  1. Key matching — a field named `password`, `refreshToken`, `email`, … is
 *     replaced regardless of what it holds.
 *  2. Value matching — a *value* that looks like a Stellar seed, a JWT, an
 *     email address or a long opaque blob is replaced even under an innocuous
 *     key, because the caller may have nested a secret somewhere unexpected.
 *
 * Structural caps (depth, breadth, string length, serialized size) then bound
 * how much a caller can push into the audit trail at all.
 */

import { createHmac } from 'crypto'

/** Marker written in place of a redacted value. */
export const REDACTED = '[REDACTED]'

/** Marker written where a structural cap truncated the input. */
export const TRUNCATED = '[TRUNCATED]'

/** Structural caps applied to every metadata object. */
export const RedactionLimits = {
  /** Nesting levels kept; deeper values collapse to TRUNCATED. */
  maxDepth: 4,
  /** Array entries kept per array. */
  maxArrayLength: 20,
  /** Object keys kept per object. */
  maxKeys: 32,
  /** Characters kept per string value. */
  maxStringLength: 256,
  /** Bytes of serialized JSON kept for the whole object. */
  maxSerializedBytes: 4096,
} as const

/**
 * Field names that are always replaced. Compared after normalizing the key to
 * lowercase alphanumerics, so `user_agent`, `userAgent` and `USERAGENT` all
 * match the same entry.
 */
const DENIED_KEYS: ReadonlySet<string> = new Set([
  // Authentication material
  'password',
  'passwordhash',
  'newpassword',
  'currentpassword',
  'confirmpassword',
  'pin',
  'otp',
  'otpcode',
  'codehash',
  'verificationcode',
  'resetcode',
  'salt',
  'signature',
  'sig',
  'nonce',
  // Direct identifiers of a natural person.
  //
  // Note what is *not* here: `to`. It is the obvious name for an email
  // recipient, but it is also the standard name for the destination of a status
  // transition — the single most common thing audit metadata records. The
  // value-level email pattern catches an actual recipient either way.
  'email',
  'emailaddress',
  'recipient',
  'phone',
  'phonenumber',
  'msisdn',
  'username',
  'fullname',
  'firstname',
  'lastname',
  'middlename',
  'displayname',
  'dob',
  'dateofbirth',
  'birthdate',
  'address',
  'street',
  'postcode',
  'zip',
  'ssn',
  'nin',
  'bvn',
  'taxid',
  'passportnumber',
  // Payment instruments
  'cvv',
  'pan',
  'cardnumber',
  'iban',
  'accountnumber',
  'routingnumber',
  // Request fingerprinting
  'ip',
  'ipaddress',
  'useragent',
  'fingerprint',
  'latitude',
  'longitude',
  'geo',
  // Message bodies, which carry whatever the template rendered
  'body',
  'html',
  'text',
  'payload',
  'artifact',
])

/**
 * Substrings that deny a key wherever they appear in it. Kept deliberately
 * narrow: `secret`, `token` and friends have no legitimate use in audit
 * metadata, whereas a broad pattern like `code` would eat `statusCode`,
 * `failureCode` and `referralCode`, which reviewers genuinely need.
 */
const DENIED_KEY_PATTERNS: readonly string[] = [
  'password',
  'passphrase',
  'secret',
  'token',
  'apikey',
  'authorization',
  'credential',
  'privatekey',
  'publickeyseed',
  'seedphrase',
  'mnemonic',
  'cookie',
  'bearer',
  'jwt',
]

/**
 * Value shapes that are replaced under any key. Ordered cheapest-first; a value
 * matching any of them is a secret or a direct identifier regardless of where
 * the caller put it.
 */
const DENIED_VALUE_PATTERNS: readonly RegExp[] = [
  // Stellar secret seed — the single most damaging string in this system.
  /\bS[A-Z2-7]{55}\b/,
  // Stellar public key. Not a secret, but it links a person to on-chain history.
  /\bG[A-Z2-7]{55}\b/,
  // JWT / compact JWS.
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/,
  // `Bearer <token>` and friends.
  /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{12,}/i,
  // Email address.
  /[\w.+-]+@[\w-]+\.[\w.-]+/,
  // E.164 phone number.
  /(?:^|\s)\+[1-9]\d{7,14}(?=$|\s)/,
  // IPv4 address.
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/,
  // Opaque high-entropy blob: 40+ hex chars is a hash, a key or a raw token.
  /\b[0-9a-f]{40,}\b/i,
  // PEM block header.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
]

/** Normalize a key to lowercase alphanumerics for deny-list comparison. */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Whether a field name is denied by the key deny-list. */
export function isDeniedKey(key: string): boolean {
  const normalized = normalizeKey(key)

  if (DENIED_KEYS.has(normalized)) {
    return true
  }

  return DENIED_KEY_PATTERNS.some((pattern) => normalized.includes(pattern))
}

/** Whether a string value looks like a secret or a direct identifier. */
export function isDeniedValue(value: string): boolean {
  return DENIED_VALUE_PATTERNS.some((pattern) => pattern.test(value))
}

/** Outcome of redacting a metadata object. */
export interface RedactionResult {
  /**
   * The safe object, or `null` when the input was empty. Carries a `_redacted`
   * key listing the paths that were replaced, so a reviewer reading the audit
   * trail can see that redaction happened rather than guessing.
   */
  value: Record<string, unknown> | null
  /** Dotted paths that were replaced, in traversal order. */
  redactedPaths: string[]
  /** Whether a structural cap discarded part of the input. */
  truncated: boolean
}

/**
 * Redact a metadata object for storage in an audit event.
 *
 * Never throws: a value that cannot be serialized (a circular reference, a
 * BigInt, a function) is replaced rather than propagated, because a failure here
 * would take down the mutation being audited.
 */
export function redactMetadata(
  input: Record<string, unknown> | null | undefined
): RedactionResult {
  if (input === null || input === undefined) {
    return { value: null, redactedPaths: [], truncated: false }
  }

  const redactedPaths: string[] = []
  const state = { truncated: false }
  const seen = new WeakSet<object>()

  const walk = (value: unknown, path: string, depth: number): unknown => {
    if (value === null || value === undefined) {
      return null
    }

    if (depth > RedactionLimits.maxDepth) {
      state.truncated = true

      return TRUNCATED
    }

    switch (typeof value) {
      case 'string': {
        if (isDeniedValue(value)) {
          redactedPaths.push(path)

          return REDACTED
        }
        if (value.length > RedactionLimits.maxStringLength) {
          state.truncated = true

          return `${value.slice(0, RedactionLimits.maxStringLength)}${TRUNCATED}`
        }

        return value
      }

      case 'number':
        return Number.isFinite(value) ? value : null

      case 'boolean':
        return value

      // A BigInt is not JSON-serializable, so render it as a decimal string.
      // Stroop amounts arrive this way and are safe to keep.
      case 'bigint':
        return value.toString()

      // A function or symbol in audit metadata is always a caller mistake.
      case 'function':
      case 'symbol':
        redactedPaths.push(path)

        return REDACTED

      default:
        break
    }

    if (value instanceof Date) {
      return value.toISOString()
    }

    if (value instanceof Error) {
      // Keep the class and message; a stack trace can embed request payloads.
      return { name: value.name, message: walk(value.message, `${path}.message`, depth + 1) }
    }

    if (seen.has(value as object)) {
      state.truncated = true

      return TRUNCATED
    }
    seen.add(value as object)

    if (Array.isArray(value)) {
      const kept = value.slice(0, RedactionLimits.maxArrayLength)
      if (value.length > kept.length) {
        state.truncated = true
      }

      return kept.map((entry, index) => walk(entry, `${path}[${index}]`, depth + 1))
    }

    const entries = Object.entries(value as Record<string, unknown>)
    const kept = entries.slice(0, RedactionLimits.maxKeys)
    if (entries.length > kept.length) {
      state.truncated = true
    }

    const output: Record<string, unknown> = {}
    for (const [key, entry] of kept) {
      const childPath = path ? `${path}.${key}` : key

      if (isDeniedKey(key)) {
        redactedPaths.push(childPath)
        output[key] = REDACTED
        continue
      }

      output[key] = walk(entry, childPath, depth + 1)
    }

    return output
  }

  const safe = walk(input, '', 0) as Record<string, unknown>

  if (redactedPaths.length > 0) {
    safe._redacted = redactedPaths
  }

  return { value: safe, redactedPaths, truncated: state.truncated }
}

/**
 * Serialize redacted metadata to the JSON string stored on the audit row, or
 * `null` when there is nothing to store. Enforces the serialized-size cap by
 * dropping the payload rather than storing a truncated, unparseable prefix.
 */
export function serializeMetadata(
  input: Record<string, unknown> | null | undefined
): string | null {
  const { value, truncated } = redactMetadata(input)

  if (value === null || Object.keys(value).length === 0) {
    return null
  }

  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    return JSON.stringify({ _redacted: ['*'], _reason: 'unserializable' })
  }

  if (Buffer.byteLength(serialized, 'utf8') > RedactionLimits.maxSerializedBytes) {
    return JSON.stringify({
      _truncated: true,
      _reason: 'metadata exceeded size limit',
      _keys: Object.keys(value).slice(0, RedactionLimits.maxKeys),
    })
  }

  if (truncated) {
    // Surface that a cap fired so a reviewer does not read the row as complete.
    return JSON.stringify({ ...value, _truncated: true })
  }

  return serialized
}

/**
 * Keyed hash of a request IP, for correlating events from one source without
 * storing the address.
 *
 * HMAC rather than a bare digest: the IPv4 space is small enough to enumerate,
 * so an unkeyed hash is reversible in seconds. Rotating the secret makes older
 * hashes uncorrelatable with newer ones, which is the intended trade-off.
 */
export function hashIpAddress(
  ipAddress: string | null | undefined,
  secret: string
): string | null {
  if (!ipAddress) {
    return null
  }

  return createHmac('sha256', secret).update(ipAddress.trim()).digest('hex').slice(0, 32)
}

/**
 * Reduce a User-Agent to a coarse family label. Enough to tell "the admin
 * console" from "the mobile app" in an investigation, not enough to fingerprint
 * a device.
 */
export function userAgentFamily(userAgent: string | null | undefined): string | null {
  if (!userAgent) {
    return null
  }

  const ua = userAgent.toLowerCase()

  // Order matters: Edge and Opera both advertise Chrome, Chrome advertises
  // Safari, and every mobile web view advertises something else entirely.
  const families: readonly [string, string][] = [
    ['edg/', 'Edge'],
    ['opr/', 'Opera'],
    ['firefox/', 'Firefox'],
    ['chrome/', 'Chrome'],
    ['safari/', 'Safari'],
    ['okhttp', 'Android'],
    ['cfnetwork', 'iOS'],
    ['dart:io', 'Flutter'],
    ['curl/', 'curl'],
    ['postman', 'Postman'],
    ['node', 'Node'],
    ['axios', 'Node'],
    ['bot', 'Bot'],
    ['spider', 'Bot'],
  ]

  for (const [needle, family] of families) {
    if (ua.includes(needle)) {
      return family
    }
  }

  return 'Other'
}
