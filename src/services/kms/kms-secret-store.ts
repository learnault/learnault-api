export class SensitiveValue {
  readonly #value: string

  constructor(value: string) {
    this.#value = value
  }

  use<T>(consumer: (value: string) => T): T {
    return consumer(this.#value)
  }

  toString(): string {
    return '[REDACTED]'
  }

  toJSON(): string {
    return '[REDACTED]'
  }
}

export interface StoredStellarKey {
  provider: string
  opaqueReference: string
  keyVersion: string | null
  publicKey: string
}

export interface StoreStellarSecretInput {
  idempotencyKey: string
  publicKey: string
  secret: SensitiveValue
}

/**
 * Trusted boundary for Stellar signing material.
 *
 * Implementations must make store idempotent by idempotencyKey and must never
 * return plaintext signing material. The lookup method is what makes a crash
 * after a successful KMS write repairable.
 */
export interface KmsSecretStore {
  findByIdempotencyKey(idempotencyKey: string): Promise<StoredStellarKey | null>
  storeStellarSecret(input: StoreStellarSecretInput): Promise<StoredStellarKey>
}
