import { randomUUID } from 'crypto'
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { NotFoundError } from '../utils/errors'

export interface PresignUploadResult {
  uploadUrl: string
  key: string
}

export interface StorageProvider {
  presignUpload(key: string, contentType: string, expiresInSeconds: number): Promise<PresignUploadResult>
  putObject(key: string, buffer: Buffer, contentType: string): Promise<void>
  getObject(key: string): Promise<Buffer>
  deleteObject(key: string): Promise<void>
  deletePrefix(prefix: string): Promise<void>
  presignDownload(key: string, expiresInSeconds: number): Promise<string>
}

/**
 * In-memory storage provider used in development and tests.
 * Does NOT perform real presigning — returned URLs point to a fake host and
 * are only useful for clients to echo back in subsequent requests.
 */
export class FakeStorageProvider implements StorageProvider {
  private readonly store = new Map<string, Buffer>()
  private readonly uploadedKeys = new Set<string>()

  async presignUpload(key: string, contentType: string, expiresInSeconds: number): Promise<PresignUploadResult> {
    void contentType
    void expiresInSeconds

    return {
      uploadUrl: `http://fake-storage.local/upload/${encodeURIComponent(key)}`,
      key,
    }
  }

  async putObject(key: string, buffer: Buffer, _contentType: string): Promise<void> {
    this.store.set(key, Buffer.from(buffer))
    this.uploadedKeys.add(key)
  }

  async getObject(key: string): Promise<Buffer> {
    const buffer = this.store.get(key)
    if (!buffer) {
      throw new NotFoundError(`Storage object not found: ${key}`)
    }

    return buffer
  }

  async deleteObject(key: string): Promise<void> {
    this.store.delete(key)
  }

  async deletePrefix(prefix: string): Promise<void> {
    for (const key of Array.from(this.store.keys())) {
      if (key.startsWith(prefix)) {
        this.store.delete(key)
      }
    }
  }

  async presignDownload(key: string, expiresInSeconds: number): Promise<string> {
    void expiresInSeconds

    return `http://fake-storage.local/download/${encodeURIComponent(key)}`
  }

  /**
   * Test-only helper: simulate the client performing a PUT to the presigned URL.
   * Throws if the key was never presigned (i.e. the client did not orchestrate intent first).
   */
  simulateUpload(key: string, buffer: Buffer, contentType: string): Promise<void> {
    void contentType

    return this.putObject(key, buffer, contentType)
  }

  isUploaded(key: string): boolean {
    return this.uploadedKeys.has(key)
  }

  clear(): void {
    this.store.clear()
    this.uploadedKeys.clear()
  }
}

/**
 * AWS S3–backed storage provider. Credentials are read from environment
 * variables (`AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`).
 * Storage credentials are never returned to clients — only short-lived
 * presigned URLs.
 */
export class S3StorageProvider implements StorageProvider {
  private readonly client: S3Client
  private readonly bucket: string

  constructor(bucket: string, client?: S3Client) {
    this.bucket = bucket
    this.client = client ?? new S3Client({ region: process.env.AWS_REGION })
  }

  async presignUpload(key: string, contentType: string, expiresInSeconds: number): Promise<PresignUploadResult> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    })

    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn: expiresInSeconds })

    return { uploadUrl, key }
  }

  async putObject(key: string, buffer: Buffer, contentType: string): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })

    await this.client.send(command)
  }

  async getObject(key: string): Promise<Buffer> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key })
    const response = await this.client.send(command)
    if (!response.Body) {
      throw new NotFoundError(`Storage object not found: ${key}`)
    }

    const chunks: Uint8Array[] = []
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk)
    }

    return Buffer.concat(chunks)
  }

  async deleteObject(key: string): Promise<void> {
    const command = new DeleteObjectCommand({ Bucket: this.bucket, Key: key })
    await this.client.send(command)
  }

  async deletePrefix(prefix: string): Promise<void> {
    let continuationToken: string | undefined
    do {
      const listCommand = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
      const listResponse = await this.client.send(listCommand)
      const objects = listResponse.Contents ?? []
      if (objects.length === 0) {

        return
      }

      const deleteCommand = new DeleteObjectsCommand({
        Bucket: this.bucket,
        Delete: {
          Objects: objects.map((obj) => ({ Key: obj.Key })),
        },
      })
      await this.client.send(deleteCommand)
      continuationToken = listResponse.IsTruncated ? listResponse.NextContinuationToken : undefined
    } while (continuationToken)
  }

  async presignDownload(key: string, expiresInSeconds: number): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key })

    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds })
  }
}

export function createStorageProvider(): StorageProvider {
  const bucket = process.env.S3_BUCKET
  if (!bucket) {
    return new FakeStorageProvider()
  }

  return new S3StorageProvider(bucket)
}

export function buildStorageKey(userId: string, uuid: string = randomUUID()): string {
  return `avatars/${userId}/${uuid}`
}
