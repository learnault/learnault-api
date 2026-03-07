import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';
import { UserController } from '../src/controllers/user.controller';
import { User } from '../src/types/user.types';

interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
  };
}

describe('UserController', () => {
  let userController: UserController;
  let mockRequest: Partial<AuthRequest>;
  let mockResponse: Partial<Response>;

  beforeEach(() => {
    userController = new UserController();
    mockRequest = {};
    mockResponse = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    };
  });

  describe('getCurrentUser', () => {
    it('should return current user profile', async () => {
      const mockUser: User = {
        id: '1',
        email: 'test@example.com',
        username: 'testuser',
        firstName: 'Test',
        lastName: 'User',
        bio: 'Test bio',
        avatar: 'https://example.com/avatar.jpg',
        walletAddress: 'GABC123456789012345678901234567890123456789012345678901234567890',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRequest.user = { id: '1', email: 'test@example.com' };
      
      vi.spyOn(userController as any, 'findUserById').mockResolvedValue(mockUser);

      await userController.getCurrentUser(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.json).toHaveBeenCalledWith({
        id: mockUser.id,
        email: mockUser.email,
        username: mockUser.username,
        firstName: mockUser.firstName,
        lastName: mockUser.lastName,
        bio: mockUser.bio,
        avatar: mockUser.avatar,
        walletAddress: mockUser.walletAddress,
        isActive: mockUser.isActive,
        createdAt: mockUser.createdAt,
        updatedAt: mockUser.updatedAt,
      });
    });

    it('should return 404 if user not found', async () => {
      mockRequest.user = { id: '1', email: 'test@example.com' };
      
      vi.spyOn(userController as any, 'findUserById').mockResolvedValue(null);

      await userController.getCurrentUser(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith({ error: 'User not found' });
    });
  });

  describe('updateProfile', () => {
    it('should update user profile successfully', async () => {
      const mockUser: User = {
        id: '1',
        email: 'test@example.com',
        username: 'updateduser',
        firstName: 'Updated',
        lastName: 'User',
        bio: 'Updated bio',
        avatar: 'https://example.com/new-avatar.jpg',
        walletAddress: 'GABC123456789012345678901234567890123456789012345678901234567890',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRequest.user = { id: '1', email: 'test@example.com' };
      mockRequest.body = {
        username: 'updateduser',
        firstName: 'Updated',
        lastName: 'User',
        bio: 'Updated bio',
        avatar: 'https://example.com/new-avatar.jpg',
      };

      vi.spyOn(userController as any, 'updateUserProfile').mockResolvedValue(mockUser);

      await userController.updateProfile(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.json).toHaveBeenCalledWith({
        id: mockUser.id,
        email: mockUser.email,
        username: mockUser.username,
        firstName: mockUser.firstName,
        lastName: mockUser.lastName,
        bio: mockUser.bio,
        avatar: mockUser.avatar,
        walletAddress: mockUser.walletAddress,
        isActive: mockUser.isActive,
        createdAt: mockUser.createdAt,
        updatedAt: mockUser.updatedAt,
      });
    });
  });

  describe('getUserById', () => {
    it('should return public user info', async () => {
      const mockUser: User = {
        id: '1',
        email: 'test@example.com',
        username: 'testuser',
        firstName: 'Test',
        lastName: 'User',
        bio: 'Test bio',
        avatar: 'https://example.com/avatar.jpg',
        walletAddress: 'GABC123456789012345678901234567890123456789012345678901234567890',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRequest.params = { id: '1' };
      
      vi.spyOn(userController as any, 'findUserById').mockResolvedValue(mockUser);

      await userController.getUserById(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.json).toHaveBeenCalledWith({
        id: mockUser.id,
        username: mockUser.username,
        firstName: mockUser.firstName,
        lastName: mockUser.lastName,
        avatar: mockUser.avatar,
        createdAt: mockUser.createdAt,
      });
    });

    it('should return 404 if user not found', async () => {
      mockRequest.params = { id: '1' };
      
      vi.spyOn(userController as any, 'findUserById').mockResolvedValue(null);

      await userController.getUserById(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith({ error: 'User not found' });
    });
  });

  describe('changePassword', () => {
    it('should change password successfully', async () => {
      const mockUser: User = {
        id: '1',
        email: 'test@example.com',
        username: 'testuser',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRequest.user = { id: '1', email: 'test@example.com' };
      mockRequest.body = {
        currentPassword: 'oldpassword',
        newPassword: 'NewPassword123!',
      };

      vi.spyOn(userController as any, 'findUserById').mockResolvedValue(mockUser);
      vi.spyOn(userController as any, 'validatePassword').mockResolvedValue(true);
      vi.spyOn(userController as any, 'updateUserPassword').mockResolvedValue(undefined);

      await userController.changePassword(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.json).toHaveBeenCalledWith({ message: 'Password updated successfully' });
    });

    it('should return 400 if current password is incorrect', async () => {
      const mockUser: User = {
        id: '1',
        email: 'test@example.com',
        username: 'testuser',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRequest.user = { id: '1', email: 'test@example.com' };
      mockRequest.body = {
        currentPassword: 'wrongpassword',
        newPassword: 'NewPassword123!',
      };

      vi.spyOn(userController as any, 'findUserById').mockResolvedValue(mockUser);
      vi.spyOn(userController as any, 'validatePassword').mockResolvedValue(false);

      await userController.changePassword(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Current password is incorrect' });
    });
  });

  describe('updateWalletAddress', () => {
    it('should update wallet address successfully', async () => {
      const mockUser: User = {
        id: '1',
        email: 'test@example.com',
        username: 'testuser',
        walletAddress: 'GABC1234567890123456789012345678901234567890123456789',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRequest.user = { id: '1', email: 'test@example.com' };
      mockRequest.body = {
        walletAddress: 'GABC1234567890123456789012345678901234567890123456789',
      };

      vi.spyOn(userController as any, 'updateUserWallet').mockResolvedValue(mockUser);

      await userController.updateWalletAddress(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.json).toHaveBeenCalledWith({
        id: mockUser.id,
        email: mockUser.email,
        username: mockUser.username,
        firstName: mockUser.firstName,
        lastName: mockUser.lastName,
        bio: mockUser.bio,
        avatar: mockUser.avatar,
        walletAddress: mockUser.walletAddress,
        isActive: mockUser.isActive,
        createdAt: mockUser.createdAt,
        updatedAt: mockUser.updatedAt,
      });
    });

    it('should return 400 for invalid wallet address', async () => {
      mockRequest.user = { id: '1', email: 'test@example.com' };
      mockRequest.body = {
        walletAddress: 'invalid-address',
      };

      await userController.updateWalletAddress(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Invalid Stellar wallet address' });
    });
  });

  describe('isValidStellarAddress', () => {
    it('should validate correct Stellar address', () => {
      const validAddress = 'GABC1234567890123456789012345678901234567890123456789';
      expect((userController as any).isValidStellarAddress(validAddress)).toBe(true);
    });

    it('should reject invalid Stellar address', () => {
      const invalidAddress = 'invalid-address';
      expect((userController as any).isValidStellarAddress(invalidAddress)).toBe(false);
    });

    it('should reject address with wrong length', () => {
      const shortAddress = 'GABC123';
      expect((userController as any).isValidStellarAddress(shortAddress)).toBe(false);
    });
  });
});
