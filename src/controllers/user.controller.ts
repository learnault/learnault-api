import { Request, Response } from 'express';
import { ParamsDictionary } from 'express-serve-static-core';
import { User, UpdateUserData, ChangePasswordData, UpdateWalletData, PublicUserInfo, UserRole, UserStatus } from '../types/user.types';

export class UserController {
  async getCurrentUser(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user.id;
      
      const user = await this.findUserById(userId);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
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
        isActive: user.isActive,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      });
    } catch (error) {
      console.error('Error getting current user:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async updateProfile(req: Request<ParamsDictionary, any, UpdateUserData>, res: Response): Promise<void> {
    try {
      const userId = (req as any).user.id;
      const updateData: UpdateUserData = req.body;

      const updatedUser = await this.updateUserProfile(userId, updateData);
      
      res.json({
        id: updatedUser.id,
        email: updatedUser.email,
        username: updatedUser.username,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        bio: updatedUser.bio,
        avatar: updatedUser.avatar,
        walletAddress: updatedUser.walletAddress,
        isActive: updatedUser.isActive,
        createdAt: updatedUser.createdAt,
        updatedAt: updatedUser.updatedAt,
      });
    } catch (error) {
      console.error('Error updating profile:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async getUserById(req: Request<{ id: string }>, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      
      const user = await this.findUserById(id);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const publicInfo: PublicUserInfo = {
        id: user.id,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        avatar: user.avatar,
        role: user.role,
        createdAt: user.createdAt,
      };

      res.json(publicInfo);
    } catch (error) {
      console.error('Error getting user by ID:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async changePassword(req: Request<ParamsDictionary, any, ChangePasswordData>, res: Response): Promise<void> {
    try {
      const userId = (req as any).user.id;
      const { currentPassword, newPassword }: ChangePasswordData = req.body;

      const user = await this.findUserById(userId);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const isCurrentPasswordValid = await this.validatePassword(user, currentPassword);
      if (!isCurrentPasswordValid) {
        res.status(400).json({ error: 'Current password is incorrect' });
        return;
      }

      await this.updateUserPassword(userId, newPassword);
      
      res.json({ message: 'Password updated successfully' });
    } catch (error) {
      console.error('Error changing password:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async updateWalletAddress(req: Request<ParamsDictionary, any, UpdateWalletData>, res: Response): Promise<void> {
    try {
      const userId = (req as any).user.id;
      const { walletAddress }: UpdateWalletData = req.body;

      if (!this.isValidStellarAddress(walletAddress)) {
        res.status(400).json({ error: 'Invalid Stellar wallet address' });
        return;
      }

      const updatedUser = await this.updateUserWallet(userId, walletAddress);
      
      res.json({
        id: updatedUser.id,
        email: updatedUser.email,
        username: updatedUser.username,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        bio: updatedUser.bio,
        avatar: updatedUser.avatar,
        walletAddress: updatedUser.walletAddress,
        isActive: updatedUser.isActive,
        createdAt: updatedUser.createdAt,
        updatedAt: updatedUser.updatedAt,
      });
    } catch (error) {
      console.error('Error updating wallet address:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private async findUserById(id: string): Promise<User | null> {
    const mockUser: User = {
      id,
      email: 'test@example.com',
      username: 'testuser',
      firstName: 'Test',
      lastName: 'User',
      bio: 'Test bio',
      avatar: 'https://example.com/avatar.jpg',
      walletAddress: 'GABC123456789012345678901234567890123456789012345678901234567890',
      role: UserRole.LEARNER,
      status: UserStatus.ACTIVE,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    return mockUser;
  }

  private async updateUserProfile(id: string, data: UpdateUserData): Promise<User> {
    const mockUser: User = {
      id,
      email: 'test@example.com',
      username: data.username || 'testuser',
      firstName: data.firstName,
      lastName: data.lastName,
      bio: data.bio,
      avatar: data.avatar,
      walletAddress: 'GABC123456789012345678901234567890123456789012345678901234567890',
      role: UserRole.LEARNER,
      status: UserStatus.ACTIVE,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    return mockUser;
  }

  private async validatePassword(user: User, password: string): Promise<boolean> {
    return false;
  }

  private async updateUserPassword(id: string, newPassword: string): Promise<void> {
    throw new Error('Not implemented');
  }

  private async updateUserWallet(id: string, walletAddress: string): Promise<User> {
    const mockUser: User = {
      id,
      email: 'test@example.com',
      username: 'testuser',
      walletAddress,
      role: UserRole.LEARNER,
      status: UserStatus.ACTIVE,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    return mockUser;
  }

  private isValidStellarAddress(address: string): boolean {
    return /^G[A-Z0-9]{50,55}$/.test(address);
  }
}
