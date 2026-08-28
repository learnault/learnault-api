import prisma from '../config/database'
import { AuditContext, auditedMutation } from '../audit'
import { comparePassword, hashPassword } from '../utils/password'

/** Status of a tombstoned account: it must read as "not found", not as data. */
const DELETED_STATUS = 'DELETED'

/** Prisma's unique-constraint violation. */
const UNIQUE_VIOLATION = 'P2002'

export type ChangePasswordResult =
  | { kind: 'changed'; revokedSessionCount: number }
  | { kind: 'not-found' }
  | { kind: 'invalid-password' }

export type UpdateWalletAddressResult =
  | { kind: 'updated'; walletAddress: string }
  | { kind: 'unchanged'; walletAddress: string }
  | { kind: 'not-found' }
  | { kind: 'conflict' }

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === UNIQUE_VIOLATION
  )
}

/**
 * Account-level operations on `User` that are neither profile data nor part of
 * the authentication flow: the credential change and the learner's wallet
 * address. Both are audited, because both are account-takeover relevant.
 */
export class UserAccountService {
  /**
   * Change the owner's password after verifying the current one, and revoke
   * every session in the same transaction.
   *
   * Revocation is inside the mutation rather than after it on purpose. A
   * password change whose session revocation fails separately would leave the
   * attacker's stolen session alive precisely when the victim believes they have
   * locked them out — so either both land or neither does.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    context: AuditContext
  ): Promise<ChangePasswordResult> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, password: true, status: true },
    })

    if (!user || user.status === DELETED_STATUS) {
      return { kind: 'not-found' }
    }

    if (!(await comparePassword(currentPassword, user.password))) {
      return { kind: 'invalid-password' }
    }

    const passwordHash = await hashPassword(newPassword)

    const revokedSessionCount = await auditedMutation({
      action: 'user.password_changed',
      actor: context.actor,
      target: { type: 'User', id: userId },
      source: 'api.users.change_password',
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      mutate: async tx => {
        await tx.user.update({ where: { id: userId }, data: { password: passwordHash } })

        const sessions = await tx.session.findMany({
          where: { userId, isRevoked: false },
          select: { id: true },
        })
        const sessionIds = sessions.map(session => session.id)

        if (sessionIds.length === 0) {
          return 0
        }

        await tx.session.updateMany({
          where: { id: { in: sessionIds } },
          data: { isRevoked: true, revokedAt: new Date() },
        })
        await tx.refreshToken.updateMany({
          where: { sessionId: { in: sessionIds }, status: { not: 'REVOKED' } },
          data: { status: 'REVOKED' },
        })

        return sessionIds.length
      },
      // The password itself never appears here, and cannot: `redaction.ts`
      // denies every `*password*` key. The count is the reviewable part.
      resolveMetadata: count => ({ revokedSessionCount: count }),
    })

    return { kind: 'changed', revokedSessionCount }
  }

  /**
   * Set the owner's Stellar wallet address.
   *
   * `User.walletAddress` is unique, so an address already claimed by another
   * account is a 409 rather than a silent overwrite. The check is done up front
   * for a clear error and again by catching the constraint violation, because
   * two accounts claiming the same address concurrently would both pass the
   * up-front read.
   */
  async updateWalletAddress(
    userId: string,
    walletAddress: string,
    context: AuditContext
  ): Promise<UpdateWalletAddressResult> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true, walletAddress: true },
    })

    if (!user || user.status === DELETED_STATUS) {
      return { kind: 'not-found' }
    }

    if (user.walletAddress === walletAddress) {
      return { kind: 'unchanged', walletAddress }
    }

    const claimedByOther = await prisma.user.findFirst({
      where: { walletAddress, id: { not: userId } },
      select: { id: true },
    })

    if (claimedByOther) {
      return { kind: 'conflict' }
    }

    try {
      await auditedMutation({
        action: 'user.wallet_address_changed',
        actor: context.actor,
        target: { type: 'User', id: userId },
        source: 'api.users.update_wallet_address',
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        // A Stellar *public* key is not a secret; the corresponding seed never
        // touches this path. Recording it is what makes a hijacked payout
        // address traceable afterwards.
        metadata: { walletAddress, hadPreviousAddress: user.walletAddress !== null },
        mutate: tx => tx.user.update({ where: { id: userId }, data: { walletAddress } }),
      })
    } catch (error) {
      if (isUniqueViolation(error)) {
        return { kind: 'conflict' }
      }

      throw error
    }

    return { kind: 'updated', walletAddress }
  }
}

export const userAccountService = new UserAccountService()
