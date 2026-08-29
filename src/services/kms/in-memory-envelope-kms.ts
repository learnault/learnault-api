import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from 'node:crypto'
import type {
  KmsSecretStore,
  SensitiveValue,
  StoredStellarKey,
  StoreStellarSecretInput,
} from './kms-secret-store'
import { SensitiveValue as ProtectedValue } from './kms-secret-store'

interface EncryptedEntry {
  material: StoredStellarKey
  ciphertext: string
  iv: string
  authTag: string
}

export interface InMemoryEnvelopeKmsHooks {
  beforeLookup?: () => void | Promise<void>
  beforeStore?: () => void | Promise<void>
  afterStore?: () => void | Promise<void>
  beforeLoad?: () => void | Promise<void>
  beforeDelete?: () => void | Promise<void>
}

/**
 * Development/test KMS adapter. Even this fake keeps only AES-GCM ciphertext,
 * so snapshots and failure diagnostics cannot accidentally contain a seed.
 */
export class InMemoryEnvelopeKms implements KmsSecretStore {
  readonly #masterKey = randomBytes(32)
  readonly #entries = new Map<string, EncryptedEntry>()

  constructor(private readonly hooks: InMemoryEnvelopeKmsHooks = {}) {}

  async findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<StoredStellarKey | null> {
    await this.hooks.beforeLookup?.()

    return this.#entries.get(idempotencyKey)?.material ?? null
  }

  async storeStellarSecret(
    input: StoreStellarSecretInput,
  ): Promise<StoredStellarKey> {
    const existing = this.#entries.get(input.idempotencyKey)
    if (existing) return existing.material

    await this.hooks.beforeStore?.()

    const iv = randomBytes(12)
    const encrypted = input.secret.use((value) => {
      const cipher = createCipheriv('aes-256-gcm', this.#masterKey, iv)
      const ciphertext = Buffer.concat([
        cipher.update(value, 'utf8'),
        cipher.final(),
      ])

      return { ciphertext, authTag: cipher.getAuthTag() }
    })

    const material: StoredStellarKey = {
      provider: 'in-memory-envelope-kms',
      opaqueReference: `kms-memory://${randomUUID()}`,
      keyVersion: '1',
      publicKey: input.publicKey,
    }

    this.#entries.set(input.idempotencyKey, {
      material,
      ciphertext: encrypted.ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: encrypted.authTag.toString('base64'),
    })

    await this.hooks.afterStore?.()

    return material
  }

  async loadStellarSecret(
    opaqueReference: string,
  ): Promise<SensitiveValue | null> {
    await this.hooks.beforeLoad?.()
    const entry = [...this.#entries.values()].find(
      (candidate) => candidate.material.opaqueReference === opaqueReference,
    )
    if (!entry) return null

    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.#masterKey,
      Buffer.from(entry.iv, 'base64'),
    )
    decipher.setAuthTag(Buffer.from(entry.authTag, 'base64'))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(entry.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8')

    return new ProtectedValue(plaintext)
  }

  async deleteStellarSecret(opaqueReference: string): Promise<void> {
    await this.hooks.beforeDelete?.()
    const match = [...this.#entries.entries()].find(
      ([, entry]) => entry.material.opaqueReference === opaqueReference,
    )
    if (!match) throw new Error('KMS reference not found')
    this.#entries.delete(match[0])
  }

  get storedKeyCount(): number {
    return this.#entries.size
  }
}
