import { z } from 'zod'
import { UserRole } from '../types/user.types'
import { isStrongPassword } from '../utils/password'

// Shared password policy: 8+ chars, upper, lower, number, symbol. Applied
// wherever a new credential is set (register, reset) so the rule can't
// drift between entry points.
const strongPassword = z
    .string()
    .min(8, 'Password must be at least 8 characters long')
    .refine(isStrongPassword, {
        message: 'Password must include an uppercase letter, a lowercase letter, a number, and a symbol',
    })

export const registerSchema = z.object({
    email: z.string().email('Invalid email address'),
    password: strongPassword,
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
    newPassword: strongPassword,
})

export const otpRequestSchema = z.object({
    phone: z.string().min(1, 'Phone number is required'),
    deviceId: z.string().min(1).optional(),
})

export const otpVerifySchema = z.object({
    phone: z.string().min(1, 'Phone number is required'),
    code: z.string().length(6, 'Code must be 6 digits'),
    deviceId: z.string().min(1).optional(),
})

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type OtpRequestInput = z.infer<typeof otpRequestSchema>;
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;
