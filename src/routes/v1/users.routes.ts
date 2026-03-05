import { Router } from 'express';
import { UserController } from '../../controllers/user.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { validateProfileUpdate, validatePasswordChange, validateWalletAddress } from '../../middleware/validation.middleware';

const router = Router();
const userController = new UserController();

router.get('/me', authenticate, userController.getCurrentUser.bind(userController));

router.patch('/me', authenticate, validateProfileUpdate, userController.updateProfile.bind(userController));

router.get('/:id', userController.getUserById.bind(userController));

router.patch('/password', authenticate, validatePasswordChange, userController.changePassword.bind(userController));

router.patch('/wallet', authenticate, validateWalletAddress, userController.updateWalletAddress.bind(userController));

export default router;
