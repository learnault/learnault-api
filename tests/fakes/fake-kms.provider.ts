import { SensitiveValue, type StoredStellarKey, type StoreStellarSecretInput, type KmsSecretStore } from '../../src/services/kms/kms-secret-store'

export class FakeKmsProvider implements KmsSecretStore {
  readonly storedKeys = new Map<string, StoredStellarKey>()
  readonly idempotencyKeys = new Map<string, string>()
  readonly accessLog: Array<{ action: string; opaqueReference?: string; idempotencyKey?: string; timestamp: Date }> = []
  shouldFailOnStore = false
  shouldFailOnLoad = false
  shouldFailOnDelete = false
  storeFailureError = 'KMS store error'
  loadFailureError = 'KMS load error'
  deleteFailureError = 'KMS delete error'

  async findByIdempotencyKey(idempotencyKey: string): Promise<StoredStellarKey | null> {
    this.accessLog.push({ action: 'findByIdempotencyKey', idempotencyKey, timestamp: new Date() })
    const opaqueReference = this.idempotencyKeys.get(idempotencyKey)
    if (!opaqueReference) return null
    
return this.storedKeys.get(opaqueReference) ?? null
  }

  async storeStellarSecret(input: StoreStellarSecretInput): Promise<StoredStellarKey> {
    this.accessLog.push({ action: 'storeStellarSecret', idempotencyKey: input.idempotencyKey, timestamp: new Date() })

    if (this.shouldFailOnStore) {
      throw new Error(this.storeFailureError)
    }

    const existingRef = this.idempotencyKeys.get(input.idempotencyKey)
    if (existingRef) {
      const existing = this.storedKeys.get(existingRef)
      if (existing) return existing
    }

    const opaqueReference = `kms-ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const stored: StoredStellarKey = {
      provider: 'fake-kms',
      opaqueReference,
      keyVersion: '1',
      publicKey: input.publicKey,
    }

    this.storedKeys.set(opaqueReference, stored)
    this.idempotencyKeys.set(input.idempotencyKey, opaqueReference)

    return stored
  }

  async loadStellarSecret(opaqueReference: string): Promise<SensitiveValue | null> {
    this.accessLog.push({ action: 'loadStellarSecret', opaqueReference, timestamp: new Date() })

    if (this.shouldFailOnLoad) {
      throw new Error(this.loadFailureError)
    }

    const stored = this.storedKeys.get(opaqueReference)
    if (!stored) return null

    const secret = `S${opaqueReference}-secret-material`
    
return new SensitiveValue(secret)
  }

  async deleteStellarSecret(opaqueReference: string): Promise<void> {
    this.accessLog.push({ action: 'deleteStellarSecret', opaqueReference, timestamp: new Date() })

    if (this.shouldFailOnDelete) {
      throw new Error(this.deleteFailureError)
    }

    this.storedKeys.delete(opaqueReference)
  }

  clear(): void {
    this.storedKeys.clear()
    this.idempotencyKeys.clear()
    this.accessLog.length = 0
    this.shouldFailOnStore = false
    this.shouldFailOnLoad = false
    this.shouldFailOnDelete = false
  }
}

export const fakeKmsProvider = new FakeKmsProvider()