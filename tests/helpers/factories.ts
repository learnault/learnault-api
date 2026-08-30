import type { PrismaClient } from '@prisma/client'

export function buildUser(
  overrides: Partial<{
    email: string
    username: string
    password: string
    role: 'LEARNER' | 'ADMIN' | 'INSTRUCTOR'
    isVerified: boolean
    walletAddress: string | null
    status: string
  }> = {},
): {
  email: string
  username: string
  password: string
  role: 'LEARNER' | 'ADMIN' | 'INSTRUCTOR'
  isVerified: boolean
  walletAddress: string | null
  status: string
} {
  const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  return {
    email: `test_${uniqueSuffix}@example.com`,
    username: `testuser_${uniqueSuffix}`,
    password: '$2a$10$dummy_hash_for_testing_purposes_only',
    role: 'LEARNER',
    isVerified: true,
    walletAddress: null,
    status: 'ACTIVE',
    ...overrides,
  }
}

export async function createUser(
  prisma: PrismaClient,
  overrides: Partial<{
    email: string
    username: string
    password: string
    role: 'LEARNER' | 'ADMIN' | 'INSTRUCTOR'
    isVerified: boolean
    walletAddress: string | null
    status: string
  }> = {},
) {
  return prisma.user.create({ data: buildUser(overrides) })
}

export function buildModule(
  overrides: Partial<{
    title: string
    description: string
    category: string
    difficulty: string
    reward: number
  }> = {},
) {
  const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  return {
    title: `Test Module ${uniqueSuffix}`,
    description: 'A test module for integration testing',
    category: 'technology',
    difficulty: 'beginner',
    reward: 10,
    ...overrides,
  }
}

export async function createModule(
  prisma: PrismaClient,
  overrides: Partial<{
    title: string
    description: string
    category: string
    difficulty: string
    reward: number
  }> = {},
) {
  return prisma.module.create({ data: buildModule(overrides) })
}

export async function createUserWithModule(
  prisma: PrismaClient,
  userOverrides: Parameters<typeof createUser>[1] = {},
  moduleOverrides: Parameters<typeof createModule>[1] = {},
) {
  const user = await createUser(prisma, userOverrides)
  const module = await createModule(prisma, moduleOverrides)

  return { user, module }
}

export function buildCompletion(
  userId: string,
  moduleId: string,
  overrides: Partial<{
    score: number
  }> = {},
) {
  return {
    userId,
    moduleId,
    score: 85,
    ...overrides,
  }
}

export async function createCompletion(
  prisma: PrismaClient,
  userId: string,
  moduleId: string,
  overrides: Partial<{
    score: number
  }> = {},
) {
  return prisma.completion.create({
    data: buildCompletion(userId, moduleId, overrides),
  })
}
