import prisma from '../../../../src/config/database'

/**
 * Clean up all test data from the database.
 * Runs in reverse FK order to avoid constraint violations.
 */
export async function cleanupDatabase(): Promise<void> {
  await prisma.$transaction([
    // Child tables first
    prisma.otpChallenge.deleteMany(),
    prisma.accountDeletionRequest.deleteMany(),
    prisma.dataExportRequest.deleteMany(),
    prisma.preferenceAuditLog.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.session.deleteMany(),
    prisma.emailDelivery.deleteMany(),
    prisma.verificationToken.deleteMany(),
    prisma.learnerPreference.deleteMany(),
    prisma.syncEvent.deleteMany(),
    prisma.notificationLog.deleteMany(),
    prisma.notificationPreference.deleteMany(),
    prisma.deviceToken.deleteMany(),
    prisma.completion.deleteMany(),
    prisma.credential.deleteMany(),
    prisma.transaction.deleteMany(),
    prisma.referral.deleteMany(),
    prisma.referralCode.deleteMany(),
    prisma.stellarFunding.deleteMany(),
    prisma.webhookDelivery.deleteMany(),
    prisma.webhookEndpoint.deleteMany(),
    
    // Parent tables last
    prisma.user.deleteMany(),
    prisma.module.deleteMany(),
  ])
}

/**
 * Delete a specific user and all related data.
 */
export async function deleteUser(userId: string): Promise<void> {
  await prisma.$transaction([
    prisma.otpChallenge.deleteMany({ where: { userId } }),
    prisma.accountDeletionRequest.deleteMany({ where: { userId } }),
    prisma.dataExportRequest.deleteMany({ where: { userId } }),
    prisma.preferenceAuditLog.deleteMany({ where: { userId } }),
    prisma.auditLog.deleteMany({ where: { userId } }),
    prisma.session.deleteMany({ where: { userId } }),
    prisma.emailDelivery.deleteMany({ where: { userId } }),
    prisma.verificationToken.deleteMany({ where: { userId } }),
    prisma.learnerPreference.deleteMany({ where: { userId } }),
    prisma.syncEvent.deleteMany({ where: { userId } }),
    prisma.notificationLog.deleteMany({ where: { userId } }),
    prisma.notificationPreference.deleteMany({ where: { userId } }),
    prisma.deviceToken.deleteMany({ where: { userId } }),
    prisma.completion.deleteMany({ where: { userId } }),
    prisma.credential.deleteMany({ where: { userId } }),
    prisma.transaction.deleteMany({ where: { userId } }),
    prisma.referral.deleteMany({ where: { referrerId: userId } }),
    prisma.referral.deleteMany({ where: { referreeId: userId } }),
    prisma.referralCode.deleteMany({ where: { userId } }),
    prisma.user.delete({ where: { id: userId } }),
  ])
}

/**
 * Get the count of records for a user in a specific table.
 */
export async function countUserRecords(userId: string, table: string): Promise<number> {
  const modelName = table.charAt(0).toLowerCase() + table.slice(1)
  const model = (prisma as any)[modelName]
  
  if (!model) {
    throw new Error(`Unknown table: ${table}`)
  }
  
  return model.count({ where: { userId } })
}

/**
 * Check if a user exists in the database.
 */
export async function userExists(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  return user !== null
}

/**
 * Get the current status of a user.
 */
export async function getUserStatus(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ 
    where: { id: userId },
    select: { status: true }
  })
  return user?.status ?? null
}
