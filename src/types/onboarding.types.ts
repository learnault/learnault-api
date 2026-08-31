import { TransitionMap } from '../utils/transitions'

export const ONBOARDING_STEPS = [
  'profile_basics',
  'consent',
  'preferences',
] as const
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]

export const REQUIRED_ONBOARDING_STEPS: readonly OnboardingStep[] = [
  'profile_basics',
  'consent',
]

export const ONBOARDING_STATUSES = ['in_progress', 'completed'] as const
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number]

export const ONBOARDING_TRANSITIONS: TransitionMap<OnboardingStatus> = {
  in_progress: ['completed'],
  completed: [],
}

export const CURRENT_ONBOARDING_VERSION = 'v1'

export interface OnboardingProgressRecord {
  id: string
  userId: string
  version: string
  currentStep: OnboardingStep
  completedSteps: OnboardingStep[]
  status: OnboardingStatus
  startedAt: Date
  completedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface SaveOnboardingStepData {
  step: OnboardingStep
}
