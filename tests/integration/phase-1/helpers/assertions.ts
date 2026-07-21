import { expect } from 'vitest'
import prisma from '../../../../src/config/database'

/**
 * Assert that an audit log entry exists for a specific action.
 */
export async function assertAuditLog(
  userId: string,
  action: string,
  options?: {
    minCount?: number
    metadata?: Record<string, any>
    ipAddress?: string
  }
): Promise<void> {
  const logs = await prisma.auditLog.findMany({
    where: { userId, action },
    orderBy: { createdAt: 'desc' },
  })

  const minCount = options?.minCount ?? 1
  expect(logs.length, `Expected at least ${minCount} audit log(s) for action "${action}"`).toBeGreaterThanOrEqual(minCount)

  if (options?.metadata) {
    const lastLog = logs[0]
    const parsedMetadata = lastLog.metadata ? JSON.parse(lastLog.metadata) : {}
    
    for (const [key, value] of Object.entries(options.metadata)) {
      expect(parsedMetadata[key], `Expected audit log metadata.${key} to equal ${value}`).toEqual(value)
    }
  }

  if (options?.ipAddress) {
    const lastLog = logs[0]
    expect(lastLog.ipAddress).toEqual(options.ipAddress)
  }
}

/**
 * Assert that a user has the expected status.
 */
export async function assertUserStatus(userId: string, expectedStatus: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { status: true },
  })

  expect(user, `User ${userId} not found`).toBeTruthy()
  expect(user!.status, `Expected user status to be "${expectedStatus}"`).toEqual(expectedStatus)
}

/**
 * Assert that all sessions for a user are revoked.
 */
export async function assertAllSessionsRevoked(userId: string): Promise<void> {
  const activeSessions = await prisma.session.count({
    where: { userId, isRevoked: false },
  })

  expect(activeSessions, 'Expected all sessions to be revoked').toBe(0)
}

/**
 * Assert that a verification token exists and is in the expected state.
 */
export async function assertVerificationToken(
  userId: string,
  type: string,
  expectedStatus: string
): Promise<void> {
  const token = await prisma.verificationToken.findFirst({
    where: { userId, type },
    orderBy: { createdAt: 'desc' },
  })

  expect(token, `Expected verification token of type "${type}" to exist`).toBeTruthy()
  expect(token!.status, `Expected token status to be "${expectedStatus}"`).toEqual(expectedStatus)
}

/**
 * Assert that an email was queued for delivery.
 */
export async function assertEmailQueued(
  userId: string,
  type: string,
  expectedRecipient: string
): Promise<void> {
  const email = await prisma.emailDelivery.findFirst({
    where: { userId, type },
    orderBy: { createdAt: 'desc' },
  })

  expect(email, `Expected email of type "${type}" to be queued`).toBeTruthy()
  expect(email!.to).toEqual(expectedRecipient)
  expect(email!.status).toEqual('pending')
}

/**
 * Assert that PII has been redacted from audit logs.
 */
export async function assertAuditLogsRedacted(userId: string): Promise<void> {
  const logs = await prisma.auditLog.findMany({
    where: { userId },
  })

  for (const log of logs) {
    expect(log.ipAddress, 'Expected ipAddress to be null').toBeNull()
    expect(log.userAgent, 'Expected userAgent to be null').toBeNull()
    
    if (log.metadata) {
      const metadata = JSON.parse(log.metadata)
      expect(metadata.redacted, 'Expected metadata.redacted to be true').toBe(true)
    }
  }
}

/**
 * Assert that a user record has been tombstoned (anonymized).
 */
export async function assertUserTombstoned(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  })

  expect(user, `User ${userId} not found`).toBeTruthy()
  expect(user!.email, 'Expected email to be tombstoned').toMatch(/^deleted\+[a-f0-9]+@anon\.invalid$/)
  expect(user!.username, 'Expected username to be tombstoned').toMatch(/^deleted_[a-f0-9]+$/)
  expect(user!.walletAddress, 'Expected walletAddress to be null').toBeNull()
  expect(user!.status, 'Expected status to be DELETED').toEqual('DELETED')
}

/**
 * Assert that specific user tables have been hard-deleted.
 */
export async function assertTablesDeleted(userId: string, tables: string[]): Promise<void> {
  for (const table of tables) {
    const modelName = table.charAt(0).toLowerCase() + table.slice(1)
    const model = (prisma as any)[modelName]
    
    if (!model) {
      throw new Error(`Unknown table: ${table}`)
    }
    
    const count = await model.count({ where: { userId } })
    expect(count, `Expected ${table} records to be deleted for user ${userId}`).toBe(0)
  }
}

/**
 * Assert that an OTP challenge exists and is in the expected state.
 */
export async function assertOtpChallenge(
  phone: string,
  purpose: string,
  expectedStatus: string
): Promise<void> {
  const challenge = await prisma.otpChallenge.findFirst({
    where: { phone, purpose },
    orderBy: { createdAt: 'desc' },
  })

  expect(challenge, `Expected OTP challenge for phone ${phone} to exist`).toBeTruthy()
  expect(challenge!.status, `Expected challenge status to be "${expectedStatus}"`).toEqual(expectedStatus)
}

/**
 * Assert that idempotency is enforced (duplicate requests return same result).
 */
export async function assertIdempotent<T>(
  operation: () => Promise<T>,
  equality: (a: T, b: T) => boolean = (a, b) => JSON.stringify(a) === JSON.stringify(b)
): Promise<void> {
  const result1 = await operation()
  const result2 = await operation()
  
  expect(
    equality(result1, result2),
    'Expected idempotent operation to return identical results'
  ).toBe(true)
}
