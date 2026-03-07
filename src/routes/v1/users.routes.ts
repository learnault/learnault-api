import { Router } from 'express';
import { UserController } from '../../controllers/user.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { validateProfileUpdate, validatePasswordChange, validateWalletAddress } from '../../middleware/validation.middleware';

const router = Router();
const userController = new UserController();

/**
 * @openapi
 * tags:
 *   name: Users
 *   description: User profile and management
 */

/**
 * @openapi
 * /v1/users/me:
 *   get:
 *     summary: Get current user profile
 *     tags: [Users]
 *     responses:
 *       200:
 *         description: Current user profile
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get('/me', authenticate, userController.getCurrentUser.bind(userController));

/**
 * @openapi
 * /v1/users/me:
 *   patch:
 *     summary: Update current user profile
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateUserData'
 *     responses:
 *       200:
 *         description: Profile updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.patch('/me', authenticate, validateProfileUpdate, userController.updateProfile.bind(userController));

/**
 * @openapi
 * /v1/users/{id}:
 *   get:
 *     summary: Get user profile by ID
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User profile
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PublicUserInfo'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.get('/:id', userController.getUserById.bind(userController));

/**
 * @openapi
 * /v1/users/password:
 *   patch:
 *     summary: Change password
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ChangePasswordData'
 *     responses:
 *       200:
 *         description: Password updated
 *       400:
 *         description: Invalid current password
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.patch('/password', authenticate, validatePasswordChange, userController.changePassword.bind(userController));

/**
 * @openapi
 * /v1/users/wallet:
 *   patch:
 *     summary: Update Stellar wallet address
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateWalletData'
 *     responses:
 *       200:
 *         description: Wallet address updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       400:
 *         description: Invalid wallet address
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.patch('/wallet', authenticate, validateWalletAddress, userController.updateWalletAddress.bind(userController));

export default router;
