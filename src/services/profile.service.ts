import prisma from '../config/database'
import { LearnerProfileRecord, UpdateLearnerProfileData } from '../types/profile.types'
import {
  toEmployerProfile,
  toOwnerProfile,
  toPrivateProfile,
  toPublicProfile,
} from './profile-serializer'

export class ProfileService {
  async getOrCreateProfile(userId: string): Promise<LearnerProfileRecord> {
    return prisma.learnerProfile.upsert({
      where: { userId },
      update: {},
      create: { userId },
    }) as unknown as LearnerProfileRecord
  }

  async updateProfile(userId: string, data: UpdateLearnerProfileData): Promise<LearnerProfileRecord> {
    return prisma.learnerProfile.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    }) as unknown as LearnerProfileRecord
  }

  async getOwnerView(userId: string) {
    const profile = await this.getOrCreateProfile(userId)

    return toOwnerProfile(profile)
  }

  async getEmployerView(userId: string) {
    const profile = await prisma.learnerProfile.findUnique({ where: { userId } })
    if (!profile) {
      return null
    }

    return toEmployerProfile(profile as unknown as LearnerProfileRecord)
  }

  async getPublicView(userId: string) {
    const profile = await prisma.learnerProfile.findUnique({ where: { userId } })
    if (!profile) {
      return null
    }

    return toPublicProfile(profile as unknown as LearnerProfileRecord)
  }

  async getPrivateView(userId: string) {
    const [profile, user] = await Promise.all([
      this.getOrCreateProfile(userId),
      prisma.user.findUnique({
        where: { id: userId },
        select: { status: true, isVerified: true, phoneVerifiedAt: true },
      }),
    ])

    if (!user) {
      return null
    }

    return toPrivateProfile(profile, user)
  }
}
