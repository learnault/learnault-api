import prisma from '../config/database'
import { consentService } from './consent.service'
import {
  CURRENT_ONBOARDING_VERSION,
  ONBOARDING_STEPS,
  OnboardingProgressRecord,
  OnboardingStep,
  REQUIRED_ONBOARDING_STEPS,
} from '../types/onboarding.types'

export type SaveStepResult =
  | { kind: 'saved'; progress: OnboardingProgressRecord }
  | { kind: 'already-completed'; progress: OnboardingProgressRecord }

export type CompleteOnboardingResult =
  | { kind: 'completed'; progress: OnboardingProgressRecord }
  | { kind: 'already-completed'; progress: OnboardingProgressRecord }
  | { kind: 'incomplete-steps'; missingSteps: OnboardingStep[] }
  | { kind: 'missing-required-consent' }

export class OnboardingService {
  async getOrCreate(userId: string): Promise<OnboardingProgressRecord> {
    return prisma.onboardingProgress.upsert({
      where: { userId },
      update: {},
      create: {
        userId,
        version: CURRENT_ONBOARDING_VERSION,
        currentStep: ONBOARDING_STEPS[0],
        completedSteps: [],
      },
    }) as unknown as OnboardingProgressRecord
  }

  async saveStep(userId: string, step: OnboardingStep): Promise<SaveStepResult> {
    const existing = await prisma.onboardingProgress.findUnique({ where: { userId } })

    if (existing && existing.status === 'completed') {
      return { kind: 'already-completed', progress: existing as unknown as OnboardingProgressRecord }
    }

    const completedSteps = existing
      ? Array.from(new Set([...(existing.completedSteps as string[]), step]))
      : [step]

    const progress = await prisma.onboardingProgress.upsert({
      where: { userId },
      update: { currentStep: step, completedSteps },
      create: {
        userId,
        version: CURRENT_ONBOARDING_VERSION,
        currentStep: step,
        completedSteps,
      },
    })

    return { kind: 'saved', progress: progress as unknown as OnboardingProgressRecord }
  }

  async resume(userId: string): Promise<OnboardingProgressRecord> {
    return this.getOrCreate(userId)
  }

  async complete(userId: string): Promise<CompleteOnboardingResult> {
    const progress = await this.getOrCreate(userId)

    if (progress.status === 'completed') {
      return { kind: 'already-completed', progress }
    }

    const missingSteps = REQUIRED_ONBOARDING_STEPS.filter(step => !progress.completedSteps.includes(step))
    if (missingSteps.length > 0) {
      return { kind: 'incomplete-steps', missingSteps: [...missingSteps] }
    }

    const requiredConsentsGranted = await consentService.hasAllRequiredGranted(userId)
    if (!requiredConsentsGranted) {
      return { kind: 'missing-required-consent' }
    }

    const updated = await prisma.onboardingProgress.update({
      where: { userId },
      data: { status: 'completed', completedAt: new Date() },
    })

    return { kind: 'completed', progress: updated as unknown as OnboardingProgressRecord }
  }
}

export const onboardingService = new OnboardingService()
