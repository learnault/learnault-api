import bcrypt from 'bcryptjs'
import prisma from '../config/database'
import type { UpdateUserData, ProfileCompletion, ProfileUpdateData } from '../types/user.types'

export function toProfileCompletion(user: {
  firstName: string | null;
  lastName: string | null;
  bio: string | null;
  avatar: string | null;
  username: string;
  email: string;
}): ProfileCompletion {
  const fields: Record<string, string | null> = {
    firstName: user.firstName,
    lastName: user.lastName,
    bio: user.bio,
    avatar: user.avatar,
    username: user.username,
    email: user.email,
  }
  const missingFields = Object.entries(fields)
    .filter(([, v]) => !v)
    .map(([k]) => k)
  const percentage = Math.round(((Object.keys(fields).length - missingFields.length) / Object.keys(fields).length) * 100)

  return { percentage, missingFields }
}

export async function findUserById(id: string) {
  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      profile: true,
      onboarding: true,
    },
  })
  if (!user) return null

  const onboarding = user.onboarding ?? {
    id: '',
    userId: user.id,
    profileComplete: false,
    emailVerified: user.isVerified,
    walletConnected: !!user.walletAddress,
    firstSessionBooked: false,
    firstCredentialEarned: false,
    consentProvided: user.profile?.consentGiven ?? false,
    completedSteps: [],
    currentStep: 'welcome',
    dismissed: false,
  }

  return {
    ...user,
    onboarding,
    profileCompletion: toProfileCompletion(user),
  }
}

export async function updateUserProfile(id: string, data: UpdateUserData) {
  const user = await prisma.user.update({
    where: { id },
    data: {
      ...(data.username !== undefined && { username: data.username }),
      ...(data.firstName !== undefined && { firstName: data.firstName }),
      ...(data.lastName !== undefined && { lastName: data.lastName }),
      ...(data.bio !== undefined && { bio: data.bio }),
      ...(data.avatar !== undefined && { avatar: data.avatar }),
    },
    include: { profile: true, onboarding: true },
  })

  const completion = toProfileCompletion(user)
  const onboarding = user.onboarding ?? null

  return { ...user, onboarding, profileCompletion: completion }
}

export async function updateUserProfileData(id: string, data: ProfileUpdateData) {
  const { consentGiven, ...profileFields } = data

  const profile = await prisma.learnerProfile.upsert({
    where: { userId: id },
    create: {
      userId: id,
      displayName: profileFields.displayName,
      country: profileFields.country,
      timezone: profileFields.timezone,
      languages: JSON.stringify(profileFields.languages ?? []),
      skillLevel: profileFields.skillLevel,
      interests: JSON.stringify(profileFields.interests ?? []),
      goals: JSON.stringify(profileFields.goals ?? []),
      visibility: profileFields.visibility ?? 'public',
      consentGiven: consentGiven ?? false,
      ...(consentGiven ? { consentAt: new Date() } : {}),
    },
    update: {
      ...(profileFields.displayName !== undefined && { displayName: profileFields.displayName }),
      ...(profileFields.country !== undefined && { country: profileFields.country }),
      ...(profileFields.timezone !== undefined && { timezone: profileFields.timezone }),
      ...(profileFields.languages !== undefined && { languages: JSON.stringify(profileFields.languages) }),
      ...(profileFields.skillLevel !== undefined && { skillLevel: profileFields.skillLevel }),
      ...(profileFields.interests !== undefined && { interests: JSON.stringify(profileFields.interests) }),
      ...(profileFields.goals !== undefined && { goals: JSON.stringify(profileFields.goals) }),
      ...(profileFields.visibility !== undefined && { visibility: profileFields.visibility }),
      ...(consentGiven !== undefined && { consentGiven, consentAt: consentGiven ? new Date() : undefined }),
    },
  })

  if (consentGiven) {
    await prisma.onboardingState.upsert({
      where: { userId: id },
      create: { userId: id, consentProvided: true },
      update: { consentProvided: true },
    })
  }

  return profile
}

export async function validatePassword(id: string, password: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id },
    select: { password: true },
  })
  if (!user) return false

  return bcrypt.compare(password, user.password)
}

export async function updateUserPassword(id: string, newPassword: string): Promise<void> {
  const salt = await bcrypt.genSalt(10)
  const hashedPassword = await bcrypt.hash(newPassword, salt)

  await prisma.user.update({
    where: { id },
    data: { password: hashedPassword },
  })
}

export async function updateUserWallet(id: string, walletAddress: string) {
  const user = await prisma.user.update({
    where: { id },
    data: { walletAddress },
    include: { profile: true, onboarding: true },
  })

  await prisma.onboardingState.upsert({
    where: { userId: id },
    create: { userId: id, walletConnected: true },
    update: { walletConnected: true },
  })

  const onboarding = user.onboarding ?? null

  return { ...user, onboarding }
}

export async function getPublicProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  })
  if (!user) return null

  const profile = user.profile
  if (profile && profile.visibility !== 'public') return null

  return {
    id: user.id,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    avatar: user.avatar,
    role: user.role,
    createdAt: user.createdAt,
    profile: profile
      ? {
          displayName: profile.displayName,
          country: profile.country,
          skillLevel: profile.skillLevel,
        }
      : null,
  }
}

export async function getUserProfileCompletion(id: string): Promise<ProfileCompletion> {
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      firstName: true,
      lastName: true,
      bio: true,
      avatar: true,
      username: true,
      email: true,
    },
  })
  if (!user) return { percentage: 0, missingFields: [] }

  return toProfileCompletion(user)
}

export async function getOnboardingState(id: string) {
  const user = await prisma.user.findUnique({
    where: { id },
    include: { onboarding: true },
  })
  if (!user) return null

  if (user.onboarding) {
    return {
      ...user.onboarding,
      completedSteps: JSON.parse(user.onboarding.completedSteps) as string[],
    }
  }

  return {
    profileComplete: false,
    emailVerified: user.isVerified,
    walletConnected: !!user.walletAddress,
    firstSessionBooked: false,
    firstCredentialEarned: false,
    consentProvided: false,
    completedSteps: [],
    currentStep: 'welcome',
    dismissed: false,
  }
}
