import crypto from 'crypto'
import prisma from '../config/database'
import {
  AVATAR_INTENT_TTL_MS,
  AVATAR_MAX_BYTES,
  AVATAR_ALLOWED_MIME_TYPES,
} from '../types/avatar.types'
import type {
  AvatarCurrentResponse,
  AvatarFinalizeResponse,
  UploadIntentResponse,
} from '../types/avatar.types'
import type { StorageProvider } from '../types/avatar.types'
import { validateAvatarBytes } from './asset-validation.service'

const VARIANT_SPECS: Array<{ label: string, suffix: string }> = [
  { label: 'original', suffix: '' },
  { label: 'thumb', suffix: '_thumb' },
  { label: 'medium', suffix: '_medium' },
]

export class AvatarService {
  constructor(private readonly storage: StorageProvider) {}

  /**
   * Issue a short-lived, user-scoped upload intent.
   *
   * The upload key is namespaced by userId so one user can never overwrite
   * another user's pending upload. Storage credentials are never returned.
   */
  async createUploadIntent(
    userId: string,
    contentType: string,
    originalName?: string,
    sizeBytes?: number,
  ): Promise<UploadIntentResponse> {
    const normalisedMime = contentType.split(';')[0].trim().toLowerCase()
    if (!(AVATAR_ALLOWED_MIME_TYPES as readonly string[]).includes(normalisedMime)) {
      throw new AvatarValidationError(`Unsupported content type: ${contentType}`)
    }

    if (sizeBytes !== undefined && sizeBytes > AVATAR_MAX_BYTES) {
      throw new AvatarValidationError('File too large (maximum 5 MB)')
    }

    const id = crypto.randomUUID()
    const safeName = (originalName ?? 'avatar').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)
    const storageKey = `avatars/${userId}/${id}/${safeName}`

    const intent = await this.storage.createSignedUpload(
      userId,
      storageKey,
      normalisedMime,
      AVATAR_INTENT_TTL_MS,
    )

    // Persist a PENDING avatar row so we can track the upload lifecycle.
    // We do not create variants until finalization.
    await prisma.avatar.create({
      data: {
        id,
        userId,
        storageKey: intent.storageKey,
        originalName: originalName ?? null,
        contentType: normalisedMime,
        originalBytes: sizeBytes ?? 0,
        status: 'PENDING',
      },
    })

    return {
      uploadKey: intent.storageKey,
      uploadUrl: intent.uploadUrl,
      expiresAt: intent.expiresAt.toISOString(),
      maxBytes: AVATAR_MAX_BYTES,
      allowedTypes: AVATAR_ALLOWED_MIME_TYPES,
    }
  }

  /**
   * Validate uploaded bytes, produce variants, and atomically promote
   * the avatar to ACTIVE — retiring any previously active avatar.
   *
   * This is the only path that can produce an ACTIVE avatar.
   */
  async finalize(
    userId: string,
    uploadKey: string,
    sha256?: string,
  ): Promise<AvatarFinalizeResponse> {
    // ── Load the PENDING avatar and verify ownership ─────────────
    const avatar = await prisma.avatar.findUnique({ where: { id: uploadKey.split('/')[2] } })
    if (!avatar) {
      throw new AvatarValidationError('Upload not found', 404)
    }
    if (avatar.userId !== userId) {
      throw new AvatarValidationError('Forbidden', 403)
    }
    if (avatar.status !== 'PENDING') {
      throw new AvatarValidationError(`Avatar is already ${avatar.status}`, 409)
    }

    // ── Read uploaded bytes from storage ─────────────────────────
    const data = await this.storage.readBytes(avatar.storageKey)

    // ── Optional SHA-256 integrity check ─────────────────────────
    if (sha256) {
      const actual = crypto.createHash('sha256').update(data).digest('hex')
      if (actual !== sha256) {
        await this.markFailed(avatar.id, 'Integrity check failed (SHA-256 mismatch)')

        throw new AvatarValidationError('Integrity check failed', 422)
      }
    }

    // ── Server-side validation ───────────────────────────────────
    const validation = validateAvatarBytes(data, avatar.contentType, avatar.originalBytes || undefined)
    if (!validation.ok) {
      await this.markFailed(avatar.id, validation.error ?? 'Validation failed')

      throw new AvatarValidationError(validation.error ?? 'Validation failed', 422)
    }

    // ── Produce variants ─────────────────────────────────────────
    // For now we store the same bytes under variant keys. A real
    // implementation would resize for thumb/medium.
    for (const spec of VARIANT_SPECS) {
      const variantKey = `${avatar.storageKey}${spec.suffix}`
      await this.storage.writeBytes(variantKey, data, validation.detectedMime!)
    }

    // ── Atomic promotion + retirement ────────────────────────────
    await prisma.$transaction(async (tx: any) => {
      // Retire the current active avatar (if any)
      await tx.avatar.updateMany({
        where: { userId, status: 'ACTIVE' },
        data: {
          status: 'PENDING',
          replacedAt: new Date(),
          replacedById: avatar.id,
        },
      })

      // Mark variant count and promote
      await tx.avatar.update({
        where: { id: avatar.id },
        data: {
          status: 'ACTIVE',
          detectedMime: validation.detectedMime,
          width: validation.dimensions?.width ?? null,
          height: validation.dimensions?.height ?? null,
          variantCount: VARIANT_SPECS.length,
          finalizedAt: new Date(),
        },
      })

      // Create variant records
      await tx.avatarVariant.createMany({
        data: VARIANT_SPECS.map((spec) => ({
          avatarId: avatar.id,
          label: spec.label,
          storageKey: `${avatar.storageKey}${spec.suffix}`,
          bytes: data.length,
          width: validation.dimensions?.width ?? null,
          height: validation.dimensions?.height ?? null,
        })),
      })
    })

    // Update the learner profile avatarUrl to point to the new avatar
    await prisma.learnerProfile.upsert({
      where: { userId },
      update: { avatarUrl: this.storage.getServingUrl(avatar.storageKey) },
      create: { userId, avatarUrl: this.storage.getServingUrl(avatar.storageKey) },
    })

    // Clean up retired avatar objects
    const retired = await prisma.avatar.findMany({
      where: { userId, status: 'PENDING', replacedById: avatar.id },
    })
    for (const old of retired) {
      await this.storage.deleteObject(old.storageKey)
    }

    return {
      id: avatar.id,
      status: 'ACTIVE',
      variantCount: VARIANT_SPECS.length,
      width: validation.dimensions?.width ?? null,
      height: validation.dimensions?.height ?? null,
      createdAt: avatar.createdAt.toISOString(),
    }
  }

  /**
   * Delete the user's current avatar and all its variants.
   */
  async deleteAvatar(userId: string): Promise<void> {
    const avatar = await prisma.avatar.findFirst({
      where: { userId, status: 'ACTIVE' },
    })

    if (!avatar) {
      throw new AvatarValidationError('No active avatar to delete', 404)
    }

    // Delete variant objects from storage
    const variants = await prisma.avatarVariant.findMany({ where: { avatarId: avatar.id } })
    for (const v of variants) {
      await this.storage.deleteObject(v.storageKey)
    }
    await this.storage.deleteObject(avatar.storageKey)

    // Remove the avatar record and clear profile link
    await prisma.$transaction([
      prisma.avatar.delete({ where: { id: avatar.id } }),
      prisma.learnerProfile.updateMany({
        where: { userId },
        data: { avatarUrl: null },
      }),
    ])
  }

  /**
   * Return the current avatar for a user.
   */
  async getCurrentAvatar(userId: string): Promise<AvatarCurrentResponse | null> {
    const avatar = await prisma.avatar.findFirst({
      where: { userId, status: 'ACTIVE' },
      include: { variants: true },
    })

    if (!avatar) {
      return null
    }

    return {
      id: avatar.id,
      variants: avatar.variants.map((v: any) => ({
        label: v.label,
        url: this.storage.getServingUrl(v.storageKey),
        width: v.width,
        height: v.height,
      })),
      createdAt: avatar.createdAt.toISOString(),
    }
  }

  private async markFailed(avatarId: string, reason: string): Promise<void> {
    await prisma.avatar.update({
      where: { id: avatarId },
      data: { status: 'FAILED', scanResult: 'rejected', scanReason: reason },
    })
  }
}

// ── Error class ───────────────────────────────────────────────────

export class AvatarValidationError extends Error {
  public readonly statusCode: number
  constructor(message: string, statusCode = 400) {
    super(message)
    this.name = 'AvatarValidationError'
    this.statusCode = statusCode
  }
}
