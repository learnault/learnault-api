import { Request, Response } from 'express'
import * as userService from '../services/user.service'
import prisma from '../config/database'
import type { UpdateUserData, ChangePasswordData } from '../types/user.types'

export class UserController {
  /**
   * @openapi
   * /users/me:
   *   get:
   *     summary: Get current authenticated user profile
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: User profile retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/User'
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: User not found
   */

  async getCurrentUser(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.id
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' })

        return
      }
      const user = await userService.findUserById(userId)
      if (!user) {
        res.status(404).json({ error: 'User not found' })

        return
      }
      res.json({
        id: user.id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        bio: user.bio,
        avatar: user.avatar,
        walletAddress: user.walletAddress,
        isActive: true,
        role: user.role,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        profile: user.profile,
        onboarding: user.onboarding,
        profileCompletion: user.profileCompletion,
      })
    } catch {
      res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * @openapi
   * /users/profile:
   *   put:
   *     summary: Update user profile
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/UpdateUser'
   *     responses:
   *       200:
   *         description: Profile updated successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/User'
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Internal server error
   */

  async updateProfile(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.id
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' })

        return
      }
      const data = req.body as UpdateUserData
      const user = await userService.updateUserProfile(userId, data)

      await prisma.auditLog.create({
        data: {
          userId,
          action: 'PROFILE_UPDATED',
          metadata: JSON.stringify(Object.keys(data)),
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'] || 'unknown',
        },
      })

      res.json({
        id: user.id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        bio: user.bio,
        avatar: user.avatar,
        walletAddress: user.walletAddress,
        isActive: true,
        role: user.role,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        profile: user.profile,
        onboarding: user.onboarding,
        profileCompletion: user.profileCompletion,
      })
    } catch {
      res.status(500).json({ error: 'Internal server error' })
    }
  }

  async getUserById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params
      const publicProfile = await userService.getPublicProfile(id)
      if (!publicProfile) {
        res.status(404).json({ error: 'User not found or profile is private' })

        return
      }
      res.json(publicProfile)
    } catch (error) {
      console.error('Error getting user by ID:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  }

  async getMyProfile(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.id
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' })

        return
      }
      const data = req.body as { displayName?: string; country?: string; bio?: string }
      await userService.updateUserProfile(userId, {
        firstName: data.displayName,
        bio: data.bio,
      })
      await userService.updateUserProfileData(userId, req.body)

      const user = await userService.findUserById(userId)
      if (!user) {
        res.status(404).json({ error: 'User not found' })

        return
      }
      res.json({
        id: user.id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        bio: user.bio,
        avatar: user.avatar,
        walletAddress: user.walletAddress,
        isActive: true,
        role: user.role,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        profile: user.profile,
        onboarding: user.onboarding,
        profileCompletion: user.profileCompletion,
      })

      await prisma.auditLog.create({
        data: {
          userId,
          action: 'PROFILE_UPDATED',
          metadata: JSON.stringify(Object.keys(req.body)),
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'] || 'unknown',
        },
      })
    } catch {
      res.status(500).json({ error: 'Internal server error' })
    }
  }

  async changePassword(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.id
      const { currentPassword, newPassword }: ChangePasswordData = req.body

      const isValid = await userService.validatePassword(userId, currentPassword)
      if (!isValid) {
        res.status(400).json({ error: 'Current password is incorrect' })

        return
      }

      await userService.updateUserPassword(userId, newPassword)

      await prisma.auditLog.create({
        data: {
          userId,
          action: 'PASSWORD_CHANGED',
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'] || 'unknown',
        },
      })

      res.json({ message: 'Password updated successfully' })
    } catch (error: unknown) {
      console.error('Error changing password:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * @openapi
   * /users/wallet:
   *   put:
   *     summary: Update user Stellar wallet address
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - walletAddress
   *             properties:
   *               walletAddress:
   *                 type: string
   *                 example: GABC123456789012345678901234567890123456789012345678901234567890
   *     responses:
   *       200:
   *         description: Wallet address updated successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/User'
   *       400:
   *         description: Invalid Stellar wallet address
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Internal server error
   */

  async updateWalletAddress(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.id
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' })

        return
      }
      const { walletAddress } = req.body as { walletAddress: string }
      if (!this.isValidStellarAddress(walletAddress)) {
        res.status(400).json({ error: 'Invalid Stellar wallet address' })

        return
      }
      const user = await userService.updateUserWallet(userId, walletAddress)

      await prisma.auditLog.create({
        data: {
          userId,
          action: 'WALLET_UPDATED',
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'] || 'unknown',
        },
      })

      res.json({
        id: user.id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        bio: user.bio,
        avatar: user.avatar,
        walletAddress: user.walletAddress,
        isActive: true,
        role: user.role,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        onboarding: user.onboarding,
      })
    } catch {
      res.status(500).json({ error: 'Internal server error' })
    }
  }

  private isValidStellarAddress(address: string): boolean {
    return /^G[A-Z0-9]{50,55}$/.test(address)
  }
}
