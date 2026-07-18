export type AssetStatus = 'pending' | 'active' | 'retired'
export type AssetVariantName = 'original' | 'small' | 'medium' | 'large'
export type AssetVariantFormat = 'webp' | 'png'
export type AssetVariantStatus = 'active' | 'retired'
export type UploadIntentStatus = 'pending' | 'finalized' | 'expired' | 'failed'
export type UploadProcessingJobStatus = 'pending' | 'processing' | 'success' | 'failed' | 'dead-letter'
export type AllowedAvatarMimeType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
export type ProfileVisibility = 'public' | 'private'
export type SkillLevel = 'beginner' | 'intermediate' | 'advanced'

export interface AssetVariantDTO {
  id: string
  assetId: string
  variant: AssetVariantName
  format: AssetVariantFormat
  storageKey: string
  sizeBytes: number
  width: number
  height: number
  status: AssetVariantStatus
  createdAt: Date
}

export interface AssetDTO {
  id: string
  userId: string
  storageKey: string
  mimeType: string
  sizeBytes: number
  width: number | null
  height: number | null
  status: AssetStatus
  finalizedAt: Date | null
  retiredAt: Date | null
  createdAt: Date
  updatedAt: Date
  variants: AssetVariantDTO[]
}

export interface UploadIntentDTO {
  id: string
  uploadUrl: string
  storageKey: string
  expiresAt: Date
  mimeType: AllowedAvatarMimeType
  maxSizeBytes: number
}

export interface FinalizeUploadResultDTO {
  intentId: string
  status: 'processing' | 'finalized' | 'failed'
  asset?: AssetDTO
}

export interface CreateUploadIntentInput {
  mimeType: AllowedAvatarMimeType
  sizeBytes: number
}

export interface FinalizeUploadInput {
  intentId: string
}

export interface LearnerProfileDTO {
  id: string
  userId: string
  displayName: string | null
  bio: string | null
  avatar: string | null
  country: string | null
  timezone: string | null
  languages: string[]
  skillLevel: SkillLevel | null
  interests: string[]
  goals: string | null
  profileVisibility: ProfileVisibility
  createdAt: Date
  updatedAt: Date
}

export interface UpdateProfileInput {
  displayName?: string
  bio?: string
  country?: string
  timezone?: string
  languages?: string[]
  skillLevel?: SkillLevel
  interests?: string[]
  goals?: string
  profileVisibility?: ProfileVisibility
}

export const ALLOWED_MIME_TYPES: AllowedAvatarMimeType[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]

export const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024

export const INTENT_TTL_SECONDS = 15 * 60

export const AVATAR_VARIANTS: { name: AssetVariantName; size: number; format: AssetVariantFormat }[] = [
  { name: 'small', size: 100, format: 'webp' },
  { name: 'medium', size: 256, format: 'webp' },
  { name: 'large', size: 512, format: 'png' },
]
