import type { ImageDimensions, SignedUploadUrl, StorageProvider } from '../../src/types/avatar.types'

export class FakeStorageProvider implements StorageProvider {
  readonly objects = new Map<string, Buffer>()
  readonly uploads = new Map<string, { uploadUrl: string; storageKey: string; expiresAt: Date }>()
  shouldFailOnUpload = false
  shouldFailOnRead = false
  shouldFailOnWrite = false
  shouldFailOnDelete = false

  async createSignedUpload(
    userId: string,
    key: string,
    contentType: string,
    expiresMs: number,
  ): Promise<SignedUploadUrl> {
    if (this.shouldFailOnUpload) {
      throw new Error('Storage upload failed')
    }

    const upload: SignedUploadUrl = {
      uploadUrl: `data:placeholder/${userId}/${key}`,
      storageKey: key,
      expiresAt: new Date(Date.now() + expiresMs),
    }

    this.uploads.set(key, upload)
    
return upload
  }

  async readBytes(storageKey: string): Promise<Buffer> {
    if (this.shouldFailOnRead) {
      throw new Error('Storage read failed')
    }

    const buf = this.objects.get(storageKey)
    if (!buf) {
      throw new Error(`Object not found: ${storageKey}`)
    }

    return Buffer.from(buf)
  }

  async writeBytes(storageKey: string, data: Buffer, contentType: string): Promise<void> {
    if (this.shouldFailOnWrite) {
      throw new Error('Storage write failed')
    }

    this.objects.set(storageKey, Buffer.from(data))
  }

  async deleteObject(storageKey: string): Promise<void> {
    if (this.shouldFailOnDelete) {
      throw new Error('Storage delete failed')
    }

    this.objects.delete(storageKey)
    this.uploads.delete(storageKey)
  }

  getServingUrl(storageKey: string): string {
    return `/storage/${storageKey}`
  }

  put(storageKey: string, data: Buffer): void {
    this.objects.set(storageKey, data)
  }

  has(storageKey: string): boolean {
    return this.objects.has(storageKey)
  }

  get size(): number {
    return this.objects.size
  }

  clear(): void {
    this.objects.clear()
    this.uploads.clear()
    this.shouldFailOnUpload = false
    this.shouldFailOnRead = false
    this.shouldFailOnWrite = false
    this.shouldFailOnDelete = false
  }
}

export const fakeStorageProvider = new FakeStorageProvider()