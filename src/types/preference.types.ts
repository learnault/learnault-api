export const SUPPORTED_LOCALES = [
  'en-US',
  'en-GB',
  'fr-FR',
  'es-ES',
  'pt-BR',
  'sw-KE',
  'ar-SA',
  'de-DE',
] as const

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

export const TEXT_SIZES = ['small', 'medium', 'large', 'extra_large'] as const
export type TextSize = (typeof TEXT_SIZES)[number]

export const DIFFICULTY_LEVELS = [
  'beginner',
  'intermediate',
  'advanced',
] as const
export type DifficultyLevel = (typeof DIFFICULTY_LEVELS)[number]

export const PROFILE_VISIBILITIES = [
  'public',
  'private',
  'connections',
] as const
export type ProfileVisibility = (typeof PROFILE_VISIBILITIES)[number]

export interface LearnerPreferences {
  id: string
  userId: string
  locale: SupportedLocale
  timezone: string
  lowDataMode: boolean
  highContrast: boolean
  reduceMotion: boolean
  screenReaderOptimized: boolean
  textSize: TextSize
  preferredDifficulty: DifficultyLevel
  preferredCategories: string[]
  profileVisibility: ProfileVisibility
  analyticsConsent: boolean
  dataSharingConsent: boolean
  createdAt: Date
  updatedAt: Date
}

export interface UpdateLearnerPreferencesData {
  locale?: SupportedLocale
  timezone?: string
  lowDataMode?: boolean
  highContrast?: boolean
  reduceMotion?: boolean
  screenReaderOptimized?: boolean
  textSize?: TextSize
  preferredDifficulty?: DifficultyLevel
  preferredCategories?: string[]
  profileVisibility?: ProfileVisibility
  analyticsConsent?: boolean
  dataSharingConsent?: boolean
}

// Privacy-impacting fields are audited whenever they change.
export const PRIVACY_IMPACTING_FIELDS: readonly (keyof UpdateLearnerPreferencesData)[] =
  ['profileVisibility', 'analyticsConsent', 'dataSharingConsent']
