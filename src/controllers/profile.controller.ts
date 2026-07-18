import { Request, Response } from 'express'
import prisma from '../config/database'
import { asyncHandler } from '../middleware/error.middleware'
import { BadRequestError, NotFoundError, UnauthorizedError } from '../utils/errors'
import { AvatarUploadService } from '../services/avatar-upload.service'
import {
  LearnerProfileDTO,
  UpdateProfileInput,
} from '../types/avatar.types'

type LearnerProfileRow = {
  id: string
  userId: string
  displayName: string | null
  bio: string | null
  avatar: string | null
  country: string | null
  timezone: string | null
  languages: string | null
  skillLevel: string | null
  interests: string | null
  goals: string | null
  profileVisibility: string
  createdAt: Date
  updatedAt: Date
}

function parseJsonArray(value: string | null): string[] {
  if (!value) {

    return []
  }
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) {

      return parsed.map((v) => String(v))
    }
  } catch {
    return []
  }

  return []
}

export class ProfileController {
  constructor(private readonly avatarUploadService: AvatarUploadService) {}

  /**
   * @openapi
   * /profile/me:
   *   get:
   *     summary: Get the authenticated user's profile
   *     tags: [Profile]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Profile retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/LearnerProfile'
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Profile not found
   */
  getProfile = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) {
      throw new UnauthorizedError('Authentication required')
    }

    const profile = (await prisma.learnerProfile.findUnique({
      where: { userId },
    })) as LearnerProfileRow | null
    if (!profile) {
      throw new NotFoundError('Profile not found')
    }

    res.status(200).json({ success: true, data: this.toProfileDTO(profile) })
  })

  /**
   * @openapi
   * /profile/me:
   *   patch:
   *     summary: Update the authenticated user's profile text fields
   *     tags: [Profile]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/UpdateProfileInput'
   *     responses:
   *       200:
   *         description: Profile updated successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/LearnerProfile'
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Profile not found
   */
  updateProfile = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) {
      throw new UnauthorizedError('Authentication required')
    }
    const data = req.body as UpdateProfileInput

    const existing = (await prisma.learnerProfile.findUnique({
      where: { userId },
    })) as LearnerProfileRow | null
    if (!existing) {
      throw new NotFoundError('Profile not found')
    }

    const updateData: Record<string, string | null> = {}
    if (data.displayName !== undefined) updateData.displayName = data.displayName
    if (data.bio !== undefined) updateData.bio = data.bio
    if (data.country !== undefined) updateData.country = data.country
    if (data.timezone !== undefined) updateData.timezone = data.timezone
    if (data.languages !== undefined) updateData.languages = JSON.stringify(data.languages)
    if (data.skillLevel !== undefined) updateData.skillLevel = data.skillLevel
    if (data.interests !== undefined) updateData.interests = JSON.stringify(data.interests)
    if (data.goals !== undefined) updateData.goals = data.goals
    if (data.profileVisibility !== undefined) updateData.profileVisibility = data.profileVisibility

    const updated = (await prisma.learnerProfile.update({
      where: { userId },
      data: updateData,
    })) as LearnerProfileRow

    res.status(200).json({ success: true, data: this.toProfileDTO(updated) })
  })

  /**
   * @openapi
   * /profile/avatar/intent:
   *   post:
   *     summary: Create a short-lived avatar upload intent
   *     description: Returns a presigned upload URL. Storage credentials
   *       are never returned; clients PUT the image bytes to `uploadUrl`
   *       and then call `/profile/avatar/finalize` with the intent id.
   *     tags: [Profile]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/CreateUploadIntentRequest'
   *     responses:
   *       201:
   *         description: Upload intent created
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/UploadIntent'
   *       400:
   *         description: Invalid MIME type or oversized file
   *       401:
   *         description: Unauthorized
   */
  createUploadIntent = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) {
      throw new UnauthorizedError('Authentication required')
    }
    const { mimeType, sizeBytes } = req.body
    if (!mimeType || typeof mimeType !== 'string') {
      throw new BadRequestError('mimeType is required')
    }
    if (typeof sizeBytes !== 'number') {
      throw new BadRequestError('sizeBytes must be a number')
    }

    const intent = await this.avatarUploadService.createUploadIntent(userId, {
      mimeType: mimeType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
      sizeBytes,
    })

    res.status(201).json({ success: true, data: intent })
  })

  /**
   * @openapi
   * /profile/avatar/finalize:
   *   post:
   *     summary: Finalize an uploaded avatar image
   *     description: Validates ownership, verifies the uploaded bytes,
   *       scans for malware, generates variants, and atomically activates
   *       the asset — retiring the previously active avatar.
   *     tags: [Profile]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/FinalizeUploadRequest'
   *     responses:
   *       200:
   *         description: Finalization accepted and queued for processing
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/FinalizeUploadResponse'
   *       400:
   *         description: Invalid or expired intent
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Forbidden — intent belongs to another user
   *       404:
   *         description: Intent not found
   *       409:
   *         description: Intent already finalized or failed
   */
  finalizeUpload = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) {
      throw new UnauthorizedError('Authentication required')
    }
    const { intentId } = req.body
    if (!intentId || typeof intentId !== 'string') {
      throw new BadRequestError('intentId is required')
    }

    const result = await this.avatarUploadService.finalizeUpload(intentId, userId)

    res.status(200).json({ success: true, data: result })
  })

  /**
   * @openapi
   * /profile/avatar:
   *   get:
   *     summary: Get the active avatar asset and its variants
   *     tags: [Profile]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Active avatar retrieved
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/AvatarResponse'
   *       401:
   *         description: Unauthorized
   */
  getAvatar = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) {
      throw new UnauthorizedError('Authentication required')
    }

    const asset = await this.avatarUploadService.getActiveAvatar(userId)

    res.status(200).json({ success: true, data: { asset } })
  })

  /**
   * @openapi
   * /profile/avatar:
   *   delete:
   *     summary: Delete the authenticated user's active avatar
   *     description: Marks the active avatar as retired and removes the
   *       underlying storage objects. Only the owning user can delete
   *       their own avatar — cross-user deletion is forbidden.
   *     tags: [Profile]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Avatar deleted successfully
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Forbidden
   *       404:
   *         description: No active avatar to delete
   */
  deleteAvatar = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user?.id as string | undefined
    if (!userId) {
      throw new UnauthorizedError('Authentication required')
    }

    await this.avatarUploadService.deleteAvatar(userId)

    res.status(200).json({ success: true, message: 'Avatar deleted successfully' })
  })

  private toProfileDTO(row: LearnerProfileRow): LearnerProfileDTO {
    return {
      id: row.id,
      userId: row.userId,
      displayName: row.displayName,
      bio: row.bio,
      avatar: row.avatar,
      country: row.country,
      timezone: row.timezone,
      languages: parseJsonArray(row.languages),
      skillLevel: row.skillLevel as LearnerProfileDTO['skillLevel'],
      interests: parseJsonArray(row.interests),
      goals: row.goals,
      profileVisibility: row.profileVisibility as LearnerProfileDTO['profileVisibility'],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  }
}
