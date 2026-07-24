import crypto from 'crypto'
import prisma from '../../../../src/config/database'

/**
 * Generate a mock Stellar public key.
 * Format: G + 55 random uppercase alphanumeric characters
 */
export function generateMockStellarPublicKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567' // Base32 charset
  let key = 'G'
  for (let i = 0; i < 55; i++) {
    key += chars[Math.floor(Math.random() * chars.length)]
  }

  return key
}

/**
 * Generate a mock Stellar secret key.
 * Format: S + 55 random uppercase alphanumeric characters
 */
export function generateMockStellarSecretKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let key = 'S'
  for (let i = 0; i < 55; i++) {
    key += chars[Math.floor(Math.random() * chars.length)]
  }

  return key
}

/**
 * Create a mock wallet record (when wallet provisioning is implemented).
 */
export async function createMockWallet(userId: string) {
  const publicKey = generateMockStellarPublicKey()
  const secretKey = generateMockStellarSecretKey()
  
  // For now, just update user's walletAddress
  // When Wallet/WalletSecret models are added, create those records
  await prisma.user.update({
    where: { id: userId },
    data: { walletAddress: publicKey },
  })
  
  return {
    publicKey,
    secretKey, // In real implementation, this would be encrypted
  }
}

/**
 * Create a funding request record.
 */
export async function createFundingRequest(publicKey: string, amount: string = '10') {
  return prisma.stellarFunding.create({
    data: {
      publicKey,
      amount,
      status: 'pending',
    },
  })
}

/**
 * Create a confirmed funding record.
 */
export async function createConfirmedFunding(publicKey: string, amount: string = '10') {
  const txHash = crypto.randomBytes(32).toString('hex')
  
  return prisma.stellarFunding.create({
    data: {
      publicKey,
      amount,
      status: 'confirmed',
      transactionHash: txHash,
      ledger: crypto.randomInt(1000000, 9999999),
      confirmedAt: new Date(),
    },
  })
}

/**
 * Create a failed funding record.
 */
export async function createFailedFunding(
  publicKey: string,
  amount: string = '10',
  error: string = 'Funding failed'
) {
  return prisma.stellarFunding.create({
    data: {
      publicKey,
      amount,
      status: 'dead-letter',
      error,
      retryCount: 5,
    },
  })
}
