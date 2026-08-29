import { Request, Response } from 'express'
import logger from '../utils/logger'
import { profileService } from '../services/profile.service'
import { userAccountService } from '../services/user-account.service'
import { requestAuditContext } from '../utils/audit-context'
import {
  changePasswordSchema,
  updateProfileSchema,
  updateWalletSchema,
  userIdParamSchema,
} from '../schemas/profile.schema'

/**
 * User account and profile routes, backed by Prisma.
 *
 * Everything here reads and writes real rows. The mock `findUserById` /
 * `updateUserProfile` / `validatePassword` / `updateUserPassword` /
 * `updateUserWallet` helpers this controller used to carry are gone, along with
 * the `firstName` / `lastName` / `bio` / `avatar` fields they invented: profile
 * data lives on `LearnerProfile` (see docs/decisions/0002), and the only
 * profile-ish column on `User` is `username`, which is an identity field and is
 * not editable through the profile API.
 */
export class UserController {
  /**
   * @openapi
   * /users/me:
   *   get:
   *     operationId: usersGetMe
   *     summary: Get the authenticated user's account and profile
   *     description: >
   *       Owner-only aggregate read: account identity, learner profile, profile
   *       completion, onboarding state, and current consent per purpose. Private
   *       account fields are included because the caller is the owner; the same
   *       data is never served through `GET /users/{id}`.
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Account and profile retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data:
   *                   $ref: '#/components/schemas/OwnerAccountProfile'
   *       401:
   *         description: Unauthorized
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       404:
   *         description: User not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  async getCurrentUser(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' })

        return
      }

      const aggregate = await profileService.getOwnerAccountProfile(userId)
      if (!aggregate) {
        res.status(404).json({ error: 'User not found' })

        return
      }

      res.status(200).json({ data: aggregate })
    } catch (error) {
      logger.error('Get current user error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * @openapi
   * /users/me:
   *   patch:
   *     operationId: usersUpdateProfile
   *     summary: Update the authenticated user's learner profile
   *     description: >
   *       Partial update, restricted to the owner-updatable profile fields. The
   *       request body is closed: any field outside the allow-list — including
   *       account fields such as `status`, `isVerified` or `role` — is a 400,
   *       not a silently ignored key. Every accepted change is written with an
   *       audit event in the same transaction.
   *     tags: [Users]
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
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                 data:
   *                   $ref: '#/components/schemas/OwnerAccountProfile'
   *       400:
   *         description: Validation failed
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       401:
   *         description: Unauthorized
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       404:
   *         description: User not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  async updateProfile(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' })

        return
      }

      const validation = updateProfileSchema.safeParse(req.body)
      if (!validation.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: validation.error.format(),
        })

        return
      }

      await profileService.updateProfileAudited(
        userId,
        validation.data,
        requestAuditContext(req)
      )

      const aggregate = await profileService.getOwnerAccountProfile(userId)
      if (!aggregate) {
        res.status(404).json({ error: 'User not found' })

        return
      }

      res.status(200).json({ message: 'Profile updated successfully', data: aggregate })
    } catch (error) {
      logger.error('Update profile error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * @openapi
   * /users/{id}:
   *   get:
   *     operationId: usersGetById
   *     summary: Get a learner's public profile by user ID
   *     description: >
   *       Public, consent-aware read. Returns the public field subset only when
   *       the profile's visibility is `public`, the account is active, and
   *       data-sharing consent has not been withdrawn; otherwise it returns the
   *       redacted stub `{ id, visible: false }`. Private account data (email,
   *       status, verification, wallet address) is never included.
   *     tags: [Users]
   *     security: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *           format: uuid
   *     responses:
   *       200:
   *         description: Public profile, or a redacted stub
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data:
   *                   $ref: '#/components/schemas/PublicProfile'
   *       400:
   *         description: Invalid user id
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       404:
   *         description: User not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  async getUserById(req: Request, res: Response): Promise<void> {
    try {
      const params = userIdParamSchema.safeParse(req.params)
      if (!params.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: params.error.format(),
        })

        return
      }

      const profile = await profileService.getPublicView(params.data.id)
      if (!profile) {
        res.status(404).json({ error: 'User not found' })

        return
      }

      res.status(200).json({ data: profile })
    } catch (error) {
      logger.error('Get user by id error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * @openapi
   * /users/password:
   *   patch:
   *     operationId: usersChangePassword
   *     summary: Change the authenticated user's password
   *     description: >
   *       Verifies the current password, stores a new bcrypt hash, and revokes
   *       every session and refresh-token family for the account in the same
   *       transaction — so the caller must sign in again, and so does anyone
   *       holding a stolen session. The change is audited.
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/ChangePasswordInput'
   *     responses:
   *       200:
   *         description: Password changed; all sessions revoked
   *       400:
   *         description: Validation failed
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       401:
   *         description: Unauthorized, or the current password is incorrect
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       404:
   *         description: User not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  async changePassword(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' })

        return
      }

      const validation = changePasswordSchema.safeParse(req.body)
      if (!validation.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: validation.error.format(),
        })

        return
      }

      const result = await userAccountService.changePassword(
        userId,
        validation.data.currentPassword,
        validation.data.newPassword,
        requestAuditContext(req)
      )

      if (result.kind === 'not-found') {
        res.status(404).json({ error: 'User not found' })

        return
      }

      // 401, not 400: a wrong current password is a failed re-authentication,
      // and the body that carried it was perfectly well-formed.
      if (result.kind === 'invalid-password') {
        res.status(401).json({ error: 'Current password is incorrect', code: 'STEP_UP_FAILED' })

        return
      }

      res.status(200).json({
        message: 'Password updated successfully. All sessions have been signed out.',
        revokedSessionCount: result.revokedSessionCount,
      })
    } catch (error) {
      logger.error('Change password error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * @openapi
   * /users/wallet:
   *   patch:
   *     operationId: usersUpdateWallet
   *     summary: Set the authenticated user's Stellar wallet address
   *     description: >
   *       Persists the learner's Stellar public key on their account. Addresses
   *       are unique across accounts, so one already claimed elsewhere is a 409.
   *       Re-sending the address already on file is a no-op. The change is
   *       audited. This endpoint never accepts or returns a secret seed.
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/UpdateWalletInput'
   *     responses:
   *       200:
   *         description: Wallet address updated (or already set to this value)
   *       400:
   *         description: Invalid Stellar wallet address
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       401:
   *         description: Unauthorized
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       404:
   *         description: User not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       409:
   *         description: Wallet address is already claimed by another account
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  async updateWalletAddress(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' })

        return
      }

      const validation = updateWalletSchema.safeParse(req.body)
      if (!validation.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: validation.error.format(),
        })

        return
      }

      const result = await userAccountService.updateWalletAddress(
        userId,
        validation.data.walletAddress,
        requestAuditContext(req)
      )

      if (result.kind === 'not-found') {
        res.status(404).json({ error: 'User not found' })

        return
      }

      if (result.kind === 'conflict') {
        res.status(409).json({
          error: 'Wallet address is already associated with another account',
          code: 'WALLET_ADDRESS_TAKEN',
        })

        return
      }

      res.status(200).json({
        message:
          result.kind === 'unchanged'
            ? 'Wallet address unchanged'
            : 'Wallet address updated successfully',
        data: { walletAddress: result.walletAddress },
      })
    } catch (error) {
      logger.error('Update wallet address error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  }
}
