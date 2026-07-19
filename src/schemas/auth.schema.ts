import { z } from 'zod'
import { UserRole } from '../types/user.types'

export const registerSchema = z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters long'),
    username: z.string().min(3, 'Username must be at least 3 characters long'),
    role: z.nativeEnum(UserRole).optional().default(UserRole.LEARNER),
})

export const loginSchema = z.object({
    email: z.string().email('Invalid email address'),
    password: z.string(),
})

export const verifyEmailSchema = z.object({
    token: z.string().min(1, 'Token is required'),
})

export const resendVerificationSchema = z.object({
    email: z.string().email('Invalid email address'),
})

export const forgotPasswordSchema = z.object({
    email: z.string().email('Invalid email address'),
})

export const resetPasswordSchema = z.object({
    token: z.string().min(1, 'Token is required'),
    newPassword: z.string().min(8, 'Password must be at least 8 characters long'),
})

export const refreshTokenSchema = z.object({
    refreshToken: z.string().min(1, 'Refresh token is required'),
})

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
