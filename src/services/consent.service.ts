import prisma from '../config/database'
import { canTransition } from '../utils/transitions'
import {
  CONSENT_TRANSITIONS,
  ConsentRecordEntry,
  GrantConsentData,
  REQUIRED_CONSENT_PURPOSES,
  WithdrawConsentData,
} from '../types/consent.types'

export type WithdrawConsentResult =
  | { kind: 'withdrawn'; record: ConsentRecordEntry }
  | { kind: 'not-granted' }
  | { kind: 'required-cannot-withdraw' }

export class ConsentService {
  async grant(
    userId: string,
    data: GrantConsentData,
  ): Promise<ConsentRecordEntry> {
    const required = (REQUIRED_CONSENT_PURPOSES as readonly string[]).includes(
      data.purpose,
    )

    return prisma.consentRecord.create({
      data: {
        userId,
        purpose: data.purpose,
        required,
        policyVersion: data.policyVersion,
        status: 'granted',
        source: data.source,
        grantedAt: new Date(),
      },
    }) as unknown as ConsentRecordEntry
  }

  async withdraw(
    userId: string,
    data: WithdrawConsentData,
  ): Promise<WithdrawConsentResult> {
    const latest = await this.getCurrentForPurpose(userId, data.purpose)

    if (
      !latest ||
      !canTransition(CONSENT_TRANSITIONS, latest.status, 'withdrawn')
    ) {
      return { kind: 'not-granted' }
    }

    if (latest.required) {
      return { kind: 'required-cannot-withdraw' }
    }

    const record = await prisma.consentRecord.create({
      data: {
        userId,
        purpose: data.purpose,
        required: latest.required,
        policyVersion: latest.policyVersion,
        status: 'withdrawn',
        source: data.source,
        withdrawnAt: new Date(),
      },
    })

    return {
      kind: 'withdrawn',
      record: record as unknown as ConsentRecordEntry,
    }
  }

  async getCurrentForPurpose(
    userId: string,
    purpose: string,
  ): Promise<ConsentRecordEntry | null> {
    return prisma.consentRecord.findFirst({
      where: { userId, purpose },
      orderBy: { createdAt: 'desc' },
    }) as unknown as ConsentRecordEntry | null
  }

  async getCurrent(userId: string): Promise<ConsentRecordEntry[]> {
    return prisma.consentRecord.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      distinct: ['purpose'],
    }) as unknown as ConsentRecordEntry[]
  }

  async getHistory(
    userId: string,
    purpose?: string,
  ): Promise<ConsentRecordEntry[]> {
    return prisma.consentRecord.findMany({
      where: { userId, ...(purpose ? { purpose } : {}) },
      orderBy: { createdAt: 'asc' },
    }) as unknown as ConsentRecordEntry[]
  }

  async hasAllRequiredGranted(userId: string): Promise<boolean> {
    const current = await this.getCurrent(userId)
    const byPurpose = new Map(current.map((entry) => [entry.purpose, entry]))

    return REQUIRED_CONSENT_PURPOSES.every(
      (purpose) => byPurpose.get(purpose)?.status === 'granted',
    )
  }
}

export const consentService = new ConsentService()
