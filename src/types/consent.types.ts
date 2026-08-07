import { TransitionMap } from '../utils/transitions'

export const CONSENT_PURPOSES = [
  'terms_of_service',
  'privacy_policy',
  'marketing_emails',
  'analytics',
  'data_sharing',
] as const
export type ConsentPurpose = typeof CONSENT_PURPOSES[number]

export const REQUIRED_CONSENT_PURPOSES: readonly ConsentPurpose[] = [
  'terms_of_service',
  'privacy_policy',
]

export const CONSENT_STATUSES = ['granted', 'withdrawn'] as const
export type ConsentStatus = typeof CONSENT_STATUSES[number]

export const CONSENT_TRANSITIONS: TransitionMap<ConsentStatus> = {
  granted: ['withdrawn'],
  withdrawn: ['granted'],
}

export const CONSENT_SOURCES = ['onboarding', 'settings', 'api'] as const
export type ConsentSource = typeof CONSENT_SOURCES[number]

export interface ConsentRecordEntry {
  id: string
  userId: string
  purpose: ConsentPurpose
  required: boolean
  policyVersion: string
  status: ConsentStatus
  source: ConsentSource
  grantedAt: Date | null
  withdrawnAt: Date | null
  createdAt: Date
}

export interface GrantConsentData {
  purpose: ConsentPurpose
  policyVersion: string
  source: ConsentSource
}

export interface WithdrawConsentData {
  purpose: ConsentPurpose
  source: ConsentSource
}
