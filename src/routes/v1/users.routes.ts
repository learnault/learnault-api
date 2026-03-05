import { Router } from 'express';
import { UserController } from '../../controllers/user.controller';
import { authenticateToken } from '../../middleware/auth.middleware';
import { validateProfileUpdate, validatePasswordChange, validateWalletAddress } from '../../middleware/validation.middleware';

const router = Router();
const userController = new UserController();

router.get('/me', authenticateToken, userController.getCurrentUser.bind(userController));

router.patch('/me', authenticateToken, validateProfileUpdate, userController.updateProfile.bind(userController));

router.get('/:id', userController.getUserById.bind(userController));

router.patch('/password', authenticateToken, validatePasswordChange, userController.changePassword.bind(userController));

router.patch('/wallet', authenticateToken, validateWalletAddress, userController.updateWalletAddress.bind(userController));

export default router;