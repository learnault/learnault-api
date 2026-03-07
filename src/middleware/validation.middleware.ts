import { Request, Response, NextFunction } from 'express';
import { UpdateUserData, ChangePasswordData, UpdateWalletData } from '../types/user.types';

export const validateProfileUpdate = (req: Request, res: Response, next: NextFunction): void => {
  const data: UpdateUserData = req.body;
  const errors: string[] = [];

  if (data.username !== undefined) {
    if (typeof data.username !== 'string' || data.username.trim().length < 3) {
      errors.push('Username must be at least 3 characters long');
    }
    if (data.username.trim().length > 30) {
      errors.push('Username must be less than 30 characters');
    }
    if (!/^[a-zA-Z0-9_]+$/.test(data.username)) {
      errors.push('Username can only contain letters, numbers, and underscores');
    }
  }

  if (data.firstName !== undefined) {
    if (typeof data.firstName !== 'string' || data.firstName.trim().length > 50) {
      errors.push('First name must be less than 50 characters');
    }
  }

  if (data.lastName !== undefined) {
    if (typeof data.lastName !== 'string' || data.lastName.trim().length > 50) {
      errors.push('Last name must be less than 50 characters');
    }
  }

  if (data.bio !== undefined) {
    if (typeof data.bio !== 'string' || data.bio.length > 500) {
      errors.push('Bio must be less than 500 characters');
    }
  }

  if (data.avatar !== undefined) {
    if (typeof data.avatar !== 'string') {
      errors.push('Avatar must be a valid URL string');
    }
    try {
      new URL(data.avatar);
    } catch {
      errors.push('Avatar must be a valid URL');
    }
  }

  if (errors.length > 0) {
    res.status(400).json({ errors });
    return;
  }

  next();
};

export const validatePasswordChange = (req: Request, res: Response, next: NextFunction): void => {
  const { currentPassword, newPassword }: ChangePasswordData = req.body;
  const errors: string[] = [];

  if (!currentPassword || typeof currentPassword !== 'string') {
    errors.push('Current password is required');
  }

  if (!newPassword || typeof newPassword !== 'string') {
    errors.push('New password is required');
  } else {
    if (newPassword.length < 8) {
      errors.push('New password must be at least 8 characters long');
    }
    if (!/(?=.*[a-z])/.test(newPassword)) {
      errors.push('New password must contain at least one lowercase letter');
    }
    if (!/(?=.*[A-Z])/.test(newPassword)) {
      errors.push('New password must contain at least one uppercase letter');
    }
    if (!/(?=.*\d)/.test(newPassword)) {
      errors.push('New password must contain at least one number');
    }
    if (!/(?=.*[@$!%*?&])/.test(newPassword)) {
      errors.push('New password must contain at least one special character');
    }
  }

  if (currentPassword === newPassword) {
    errors.push('New password must be different from current password');
  }

  if (errors.length > 0) {
    res.status(400).json({ errors });
    return;
  }

  next();
};

export const validateWalletAddress = (req: Request, res: Response, next: NextFunction): void => {
  const { walletAddress }: UpdateWalletData = req.body;
  const errors: string[] = [];

  if (!walletAddress || typeof walletAddress !== 'string') {
    errors.push('Wallet address is required');
  } else {
    if (!/^[G][A-Z0-9]{55}$/.test(walletAddress)) {
      errors.push('Invalid Stellar wallet address format');
    }
  }

  if (errors.length > 0) {
    res.status(400).json({ errors });
    return;
  }

  next();
};