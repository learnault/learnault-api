import bcrypt from 'bcryptjs'
import prisma from '../../../../src/config/database'
import crypto from 'crypto'

let userCounter = 0

export interface CreateUserOptions {
  email?: string
  username?: string
  password?: string
  role?: 'LEARNER' | 'INSTRUCTOR' | 'ADMIN'
  isVerified?: boolean
  phone?: string
  phoneVerifiedAt?: Date | null
  status?: string
  walletAddress?: string
}

/**
 * Create a test user with deterministic defaults.
 * Each user gets a unique email/username based on a counter to avoid conflicts.
 */
export async function createUser(options: CreateUserOptions = {}) {
  const id = ++userCounter
  const timestamp = Date.now()
  
  const email = options.email ?? `test${id}-${timestamp}@example.com`
  const username = options.username ?? `testuser${id}_${timestamp}`
  const password = options.password ?? 'Test1234!'
  const role = options.role ?? 'LEARNER'
  const isVerified = options.isVerified ?? false
  const status = options.status ?? 'ACTIVE'
  
  const salt = await bcrypt.genSalt(10)
  const hashedPassword = await bcrypt.hash(password, salt)
  
  const user = await prisma.user.create({
    data: {
      email,
      username,
      password: hashedPassword,
      role,
      isVerified,
      phone: options.phone,
      phoneVerifiedAt: options.phoneVerifiedAt,
      status,
      walletAddress: options.walletAddress,
    },
  })

  return { user, plainPassword: password }
}

/**
 * Create multiple test users.
 */
export async function createUsers(count: number, options: CreateUserOptions = []) {
  const users = []
  for (let i = 0; i < count; i++) {
    users.push(await createUser(options))
  }

  return users
}

/**
 * Create a verified user (email verified).
 */
export async function createVerifiedUser(options: CreateUserOptions = {}) {

  return createUser({ ...options, isVerified: true })
}

/**
 * Create a user with verified phone number.
 */
export async function createPhoneVerifiedUser(phone?: string, options: CreateUserOptions = {}) {
  const actualPhone = phone ?? `+234801${crypto.randomInt(1000000, 9999999)}`

  return createUser({
    ...options,
    phone: actualPhone,
    phoneVerifiedAt: new Date(),
  })
}

/**
 * Create a deactivated user.
 */
export async function createDeactivatedUser(options: CreateUserOptions = {}) {

  return createUser({ ...options, status: 'DEACTIVATED' })
}

/**
 * Create a user pending deletion.
 */
export async function createPendingDeletionUser(options: CreateUserOptions = {}) {

  return createUser({ ...options, status: 'PENDING_DELETION' })
}

/**
 * Create a deleted (tombstoned) user.
 */
export async function createDeletedUser(options: CreateUserOptions = {}) {
  const userId = crypto.randomUUID()
  const tombstoneSuffix = userId.replace(/-/g, '').slice(0, 12)
  
  return createUser({
    ...options,
    email: `deleted+${tombstoneSuffix}@anon.invalid`,
    username: `deleted_${tombstoneSuffix}`,
    status: 'DELETED',
    walletAddress: null,
  })
}

/**
 * Reset the user counter (useful for test isolation).
 */
export function resetUserCounter(): void {
  userCounter = 0
}
