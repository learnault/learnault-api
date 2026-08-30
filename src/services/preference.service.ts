import prisma from '../config/database'
import {
  PRIVACY_IMPACTING_FIELDS,
  UpdateLearnerPreferencesData,
} from '../types/preference.types'

export class PreferenceService {
  /**
   * Fetch a learner's preferences, creating the default row on first access.
   * Defaults are deterministic and come from the Prisma schema, so every
   * learner without an explicit override sees the same values.
   */
  async getPreferences(userId: string) {
    return prisma.learnerPreference.upsert({
      where: { userId },
      update: {},
      create: { userId },
    })
  }

  /**
   * Partially update a learner's preferences. Omitted fields are left
   * untouched, unknown fields are rejected by the controller-level schema
   * before this is called, and privacy-impacting fields are audited.
   *
   * The upsert is atomic at the database level, so concurrent updates from
   * the same user cannot create duplicate rows or silently drop a write.
   */
  async updatePreferences(userId: string, data: UpdateLearnerPreferencesData) {
    const before = await prisma.learnerPreference.findUnique({
      where: { userId },
    })

    const updated = await prisma.learnerPreference.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    })

    await this.auditPrivacyChanges(userId, before, updated, data)

    return updated
  }

  private async auditPrivacyChanges(
    userId: string,
    before: { [key: string]: unknown } | null,
    after: { [key: string]: unknown },
    changedFields: UpdateLearnerPreferencesData,
  ): Promise<void> {
    const entries = PRIVACY_IMPACTING_FIELDS.filter(
      (field) => field in changedFields,
    )
      .map((field) => ({
        userId,
        field,
        oldValue: before ? String(before[field]) : null,
        newValue: String(after[field]),
      }))
      .filter((entry) => entry.oldValue !== entry.newValue)

    if (entries.length === 0) {
      return
    }

    await prisma.preferenceAuditLog.createMany({ data: entries })
  }
}
