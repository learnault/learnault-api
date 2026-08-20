import { Request, Response } from 'express'
import { z } from 'zod'
import { AvatarService, AvatarValidationError } from '../services/avatar.service'
import { InMemoryStorageProvider } from '../services/storage/in-memory-storage'
import { AVATAR_MAX_BYTES } from '../types/avatar.types'

// Singleton storage — swap via DI or env-based factory in production
const storageProvider = new InMemoryStorageProvider()
const avatarService = new AvatarService(storageProvider)

// ── Zod schemas ───────────────────────────────────────────────────

const uploadIntentSchema = z
  .object({
    contentType: z.string().min(1, 'contentType is required'),
    originalName: z.string().max(200).optional(),
    sizeBytes: z.number().int().positive().max(AVATAR_MAX_BYTES).optional(),
  })
  .strict()

const finalizeSchema = z
  .object({
    uploadKey: z.string().min(1, 'uploadKey is required'),
    sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/i, 'Invalid SHA-256 hex string')
      .optional(),
  })
  .strict()

// ── Controller ────────────────────────────────────────────────────

export class AvatarController {
  /**
   * @openapi
   * /v1/users/me/avatar/upload-intent:
   *   post:
   *     summary: Create a short-lived upload intent for an avatar image
   *     tags: [Avatars]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [contentType]
   *             properties:
   *               contentType:
   *                 type: string
   *                 example: image/jpeg
   *               originalName:
   *                 type: string
   *               sizeBytes:
   *                 type: integer
   *     responses:
   *       201:
   *         description: Upload intent created
   *       400:
   *         description: Validation failed
   *       401:
   *         description: Unauthorized
   */
  async createUploadIntent(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }

      const validation = uploadIntentSchema.safeParse(req.body)
      if (!validation.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: validation.error.format(),
        })
        return
      }

      const intent = await avatarService.createUploadIntent(
        userId,
        validation.data.contentType,
        validation.data.originalName,
        validation.data.sizeBytes,
      )

      res.status(201).json({ data: intent })
    } catch (error) {
      if (error instanceof AvatarValidationError) {
        res.status(error.statusCode).json({ error: error.message })
        return
      }
      console.error('Upload intent error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * @openapi
   * /v1/users/me/avatar/finalize:
   *   post:
   *     summary: Finalize an uploaded avatar (validate, produce variants, promote to active)
   *     tags: [Avatars]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [uploadKey]
   *             properties:
   *               uploadKey:
   *                 type: string
   *               sha256:
   *                 type: string
   *     responses:
   *       200:
   *         description: Avatar finalized
   *       400:
   *         description: Validation or ownership error
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Upload belongs to another user
   *       404:
   *         description: Upload not found
   *       409:
   *         description: Avatar already finalized
   *       422:
   *         description: File validation failed
   */
  async finalize(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }

      const validation = finalizeSchema.safeParse(req.body)
      if (!validation.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: validation.error.format(),
        })
        return
      }

      const result = await avatarService.finalize(
        userId,
        validation.data.uploadKey,
        validation.data.sha256,
      )

      res.status(200).json({ data: result })
    } catch (error) {
      if (error instanceof AvatarValidationError) {
        res.status(error.statusCode).json({ error: error.message })
        return
      }
      console.error('Avatar finalize error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * @openapi
   * /v1/users/me/avatar:
   *   delete:
   *     summary: Delete the current avatar
   *     tags: [Avatars]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       204:
   *         description: Avatar deleted
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: No active avatar
   */
  async deleteAvatar(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }

      await avatarService.deleteAvatar(userId)
      res.status(204).send()
    } catch (error) {
      if (error instanceof AvatarValidationError) {
        res.status(error.statusCode).json({ error: error.message })
        return
      }
      console.error('Avatar delete error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * @openapi
   * /v1/users/me/avatar:
   *   get:
   *     summary: Get the current avatar with variant URLs
   *     tags: [Avatars]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Current avatar
   *       401:
   *         description: Unauthorized
   */
  async getCurrentAvatar(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }

      const avatar = await avatarService.getCurrentAvatar(userId)

      if (!avatar) {
        res.status(200).json({ data: null })
        return
      }

      res.status(200).json({ data: avatar })
    } catch (error) {
      console.error('Get avatar error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  }

  /** Expose the service for testing */
  static get service(): AvatarService {
    return avatarService
  }

  static get storage(): InMemoryStorageProvider {
    return storageProvider
  }
}
