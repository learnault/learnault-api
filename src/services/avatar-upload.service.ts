import { randomUUID } from 'crypto'
import prisma from '../config/database'
import logger from '../utils/logger'
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../utils/errors'
import {
  ALLOWED_MIME_TYPES,
  AssetDTO,
  AssetVariantDTO,
  AssetVariantName,
  CreateUploadIntentInput,
  FinalizeUploadResultDTO,
  INTENT_TTL_SECONDS,
  MAX_AVATAR_SIZE_BYTES,
  UploadIntentDTO,
} from '../types/avatar.types'
import { StorageProvider, buildStorageKey } from './storage.provider'
import { ImageProcessor } from './image-processor.service'
import { AVScanner } from './av-scanner.service'

type UploadIntentRow = {
  id: string
  userId: string
  mimeType: string
  sizeBytes: number
  storageKey: string
  status: string
  expiresAt: Date
  finalizedAt: Date | null
  assetId: string | null
}

type UploadProcessingJobRow = {
  id: string
  intentId: string
  status: string
  error: string | null
  attemptCount: number
  maxAttempts: number
  nextAttemptAt: Date | null
  lastAttemptAt: Date | null
}

type AssetRow = {
  id: string
  userId: string
  storageKey: string
  mimeType: string
  sizeBytes: number
  width: number | null
  height: number | null
  status: string
  finalizedAt: Date | null
  retiredAt: Date | null
  createdAt: Date
  updatedAt: Date
  variants?:
    | Array<{
        id: string
        assetId: string
        variant: string
        format: string
        storageKey: string
        sizeBytes: number
        width: number
        height: number
        status: string
        createdAt: Date
      }>
    | null
}

export class AvatarUploadService {
  constructor(
    private readonly storage: StorageProvider,
    private readonly imageProcessor: ImageProcessor,
    private readonly avScanner: AVScanner,
  ) {}

  /**
   * Issue a short-lived user-scoped upload intent for an avatar image.
   * Caller receives a presigned upload URL; storage credentials are never
   * returned. The intent expires in `INTENT_TTL_SECONDS` seconds.
   */
  async createUploadIntent(userId: string, input: CreateUploadIntentInput): Promise<UploadIntentDTO> {
    if (!ALLOWED_MIME_TYPES.includes(input.mimeType)) {
      throw new BadRequestError('Unsupported avatar MIME type')
    }
    if (input.sizeBytes <= 0) {
      throw new BadRequestError('File must not be empty')
    }
    if (input.sizeBytes > MAX_AVATAR_SIZE_BYTES) {
      throw new BadRequestError('File exceeds the maximum avatar size of 5MB')
    }

    const storageKey = buildStorageKey(userId)
    const presign = await this.storage.presignUpload(
      `${storageKey}/original`,
      input.mimeType,
      INTENT_TTL_SECONDS,
    )
    const expiresAt = new Date(Date.now() + INTENT_TTL_SECONDS * 1000)

    const intent = await prisma.uploadIntent.create({
      data: {
        userId,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        storageKey: `${storageKey}/original`,
        status: 'pending',
        expiresAt,
      },
    })

    return {
      id: intent.id,
      uploadUrl: presign.uploadUrl,
      storageKey: `${storageKey}/original`,
      expiresAt,
      mimeType: input.mimeType,
      maxSizeBytes: MAX_AVATAR_SIZE_BYTES,
    }
  }

  /**
   * Approve a previously issued intent for processing. Idempotent for an
   * already-finalized intent owned by the same user.
   */
  async finalizeUpload(intentId: string, userId: string): Promise<FinalizeUploadResultDTO> {
    const intent = (await prisma.uploadIntent.findUnique({
      where: { id: intentId },
    })) as UploadIntentRow | null

    if (!intent) {
      throw new NotFoundError('Upload intent not found')
    }
    if (intent.userId !== userId) {
      throw new ForbiddenError('You cannot finalize another user\'s upload intent')
    }
    if (intent.status === 'finalized' && intent.assetId) {
      const asset = (await prisma.asset.findUnique({
        where: { id: intent.assetId },
        include: { variants: true },
      })) as AssetRow | null

      return {
        intentId: intent.id,
        status: 'finalized',
        asset: asset ? this.toAssetDTO(asset) : undefined,
      }
    }
    if (intent.status === 'failed') {
      throw new ConflictError('Upload intent already failed validation')
    }
    if (intent.status !== 'pending') {
      throw new ConflictError(`Upload intent is in an unexpected state: ${intent.status}`)
    }
    if (intent.expiresAt.getTime() < Date.now()) {
      await prisma.uploadIntent.update({
        where: { id: intent.id },
        data: { status: 'expired' },
      })
      throw new BadRequestError('Upload intent has expired')
    }

    await prisma.uploadIntent.update({
      where: { id: intent.id },
      data: { status: 'finalized', finalizedAt: new Date() },
    })

    await prisma.uploadProcessingJob.create({
      data: {
        intentId: intent.id,
        status: 'pending',
        nextAttemptAt: new Date(),
      },
    })

    this.processQueue().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      logger.error(`[AvatarUploadService] Queue processing error: ${message}`)
    })

    return { intentId: intent.id, status: 'processing' }
  }

  /**
   * Background queue worker — selects due pending jobs and processes them.
   * Mirrors the EmailService.processQueue shape.
   */
  async processQueue(): Promise<void> {
    const pendingJobs = (await prisma.uploadProcessingJob.findMany({
      where: {
        status: 'pending',
        nextAttemptAt: { lte: new Date() },
        attemptCount: { lt: 5 },
      },
    })) as UploadProcessingJobRow[]

    for (const job of pendingJobs) {
      await this.processJob(job)
    }
  }

  private async processJob(job: UploadProcessingJobRow): Promise<void> {
    await prisma.uploadProcessingJob.update({
      where: { id: job.id },
      data: { status: 'processing', lastAttemptAt: new Date() },
    })

    const intent = (await prisma.uploadIntent.findUnique({
      where: { id: job.intentId },
    })) as UploadIntentRow | null
    if (!intent) {
      await this.handleFailure(job, 'Upload intent not found for processing job')

      return
    }

    try {
      const originalBuffer = await this.storage.getObject(intent.storageKey)
      const scan = await this.avScanner.scan(originalBuffer)
      if (scan.isInfected) {
        await this.markIntentFailed(intent.id, `Infected file detected: ${scan.virusName ?? 'unknown'}`)
        await this.handleFailure(job, `Infected file detected: ${scan.virusName ?? 'unknown'}`)

        return
      }

      const processing = await this.imageProcessor.process(originalBuffer)
      const baseKey = this.extractBaseKey(intent.storageKey)
      const variants: { key: string; variant: AssetVariantName; format: string; buffer: Buffer; width: number; height: number; sizeBytes: number }[] = []
      for (const variantSpec of processing.variants) {
        const variantKey = `${baseKey}/${variantSpec.variant}`
        await this.storage.putObject(variantKey, variantSpec.buffer, variantSpec.mimeType)
        variants.push({
          key: variantKey,
          variant: variantSpec.variant,
          format: variantSpec.format,
          buffer: variantSpec.buffer,
          width: variantSpec.width,
          height: variantSpec.height,
          sizeBytes: variantSpec.sizeBytes,
        })
      }

      const originalVariant = variants.find((v) => v.variant === 'original')
      const assetId = randomUUID()
      const asset = await prisma.$transaction(async (tx) => {
        const created = (await tx.asset.create({
          data: {
            id: assetId,
            userId: intent.userId,
            storageKey: baseKey,
            mimeType: originalVariant?.format === 'png' ? 'image/png' : 'image/webp',
            sizeBytes: originalVariant?.sizeBytes ?? 0,
            width: originalVariant?.width ?? processing.original.width,
            height: originalVariant?.height ?? processing.original.height,
            status: 'active',
            finalizedAt: new Date(),
          },
        })) as AssetRow

        await tx.assetVariant.createMany({
          data: variants.map((v) => ({
            variant: v.variant,
            format: v.format,
            storageKey: v.key,
            sizeBytes: v.sizeBytes,
            width: v.width,
            height: v.height,
            status: 'active',
            assetId: created.id,
          })),
        })

        await tx.uploadIntent.update({
          where: { id: intent.id },
          data: { assetId: created.id },
        })

        const previousActiveAssets = (await tx.asset.findMany({
          where: { userId: intent.userId, status: 'active', id: { not: created.id } },
        })) as AssetRow[]
        if (previousActiveAssets.length > 0) {
          const now = new Date()
          await tx.asset.updateMany({
            where: { id: { in: previousActiveAssets.map((a) => a.id) } },
            data: { status: 'retired', retiredAt: now },
          })
          await tx.assetVariant.updateMany({
            where: { assetId: { in: previousActiveAssets.map((a) => a.id) }, status: 'active' },
            data: { status: 'retired' },
          })
          const previousRetired = previousActiveAssets[0]
          if (previousRetired) {
            await this.retireStorageBackground(previousRetired.storageKey)
          }
        }

        const fullAsset = (await tx.asset.findUnique({
          where: { id: created.id },
          include: { variants: true },
        })) as AssetRow

        return fullAsset
      })

      const publicAvatarUrl = await this.derivePublicAvatarUrl(asset!)
      if (publicAvatarUrl) {
        await prisma.learnerProfile.updateMany({
          where: { userId: intent.userId },
          data: { avatar: publicAvatarUrl },
        })
      }

      await prisma.uploadProcessingJob.update({
        where: { id: job.id },
        data: { status: 'success', completedAt: new Date(), error: null },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Processing failed'
      await this.markIntentFailed(intent.id, message)
      await this.handleFailure(job, message)
    }
  }

  private async handleFailure(job: UploadProcessingJobRow, error: string): Promise<void> {
    const nextAttemptCount = job.attemptCount + 1
    if (nextAttemptCount >= job.maxAttempts) {
      await prisma.uploadProcessingJob.update({
        where: { id: job.id },
        data: { status: 'dead-letter', error },
      })
    } else {
      const backoffMinutes = Math.pow(5, nextAttemptCount - 1)
      await prisma.uploadProcessingJob.update({
        where: { id: job.id },
        data: { status: 'pending', error, nextAttemptAt: new Date(Date.now() + backoffMinutes * 60000) },
      })
    }
  }

  private async markIntentFailed(intentId: string, reason: string): Promise<void> {
    await prisma.uploadIntent.update({
      where: { id: intentId },
      data: { status: 'failed' },
    })
    logger.warn(`[AvatarUploadService] Intent ${intentId} failed: ${reason}`)
  }

  /**
   * Return the active avatar asset for a user, including all variants.
   */
  async getActiveAvatar(userId: string): Promise<AssetDTO | null> {
    const asset = (await prisma.asset.findFirst({
      where: { userId, status: 'active' },
      include: { variants: true },
      orderBy: { finalizedAt: 'desc' },
    })) as AssetRow | null
    if (!asset) {

      return null
    }

    return this.toAssetDTO(asset)
  }

  /**
   * Soft-delete the user's active avatar — marks it retired and schedules
   * storage cleanup. Errors from storage deletion are logged but never
   * block the database state change.
   */
  async deleteAvatar(userId: string): Promise<void> {
    const asset = (await prisma.asset.findFirst({
      where: { userId, status: 'active' },
    })) as AssetRow | null
    if (!asset) {
      throw new NotFoundError('No active avatar to delete')
    }

    const now = new Date()
    await prisma.$transaction(async (tx) => {
      await tx.asset.update({
        where: { id: asset.id },
        data: { status: 'retired', retiredAt: now },
      })
      await tx.assetVariant.updateMany({
        where: { assetId: asset.id, status: 'active' },
        data: { status: 'retired' },
      })
      await tx.learnerProfile.updateMany({
        where: { userId },
        data: { avatar: null },
      })
    })

    await this.retireStorageBackground(asset.storageKey)
  }

  private async retireStorageBackground(storageKey: string): Promise<void> {
    this.storage
      .deletePrefix(storageKey)
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        logger.error(`[AvatarUploadService] Failed to retire storage prefix ${storageKey}: ${message}`)
      })
  }

  private async derivePublicAvatarUrl(asset: AssetRow): Promise<string | null> {
    const originalVariant = asset.variants?.find((v) => v.variant === 'original')
    if (!originalVariant) {

      return null
    }
    try {
      const url = await this.storage.presignDownload(originalVariant.storageKey, 3600)

      return url
    } catch {
      // Fall back to the storage key for environments that do not support
      // signed download URLs (e.g. dev fake provider).
      return originalVariant.storageKey
    }
  }

  private extractBaseKey(originalStorageKey: string): string {
    if (originalStorageKey.endsWith('/original')) {
      return originalStorageKey.slice(0, -'/original'.length)
    }

    return originalStorageKey
  }

  private toAssetDTO(asset: AssetRow): AssetDTO {
    const variants: AssetVariantDTO[] = (asset.variants ?? []).map((v) => ({
      id: v.id,
      assetId: v.assetId,
      variant: v.variant as AssetVariantName,
      format: v.format as AssetVariantDTO['format'],
      storageKey: v.storageKey,
      sizeBytes: v.sizeBytes,
      width: v.width,
      height: v.height,
      status: v.status as AssetVariantDTO['status'],
      createdAt: v.createdAt,
    }))

    return {
      id: asset.id,
      userId: asset.userId,
      storageKey: asset.storageKey,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      width: asset.width,
      height: asset.height,
      status: asset.status as AssetDTO['status'],
      finalizedAt: asset.finalizedAt,
      retiredAt: asset.retiredAt,
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt,
      variants,
    }
  }
}

export function createAvatarUploadService(
  storage: StorageProvider,
  imageProcessorInstance: ImageProcessor,
  avScanner: AVScanner,
): AvatarUploadService {
  return new AvatarUploadService(storage, imageProcessorInstance, avScanner)
}
