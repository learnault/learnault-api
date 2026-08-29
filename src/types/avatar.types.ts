// ── Avatar lifecycle statuses ─────────────────────────────────────

export const AVATAR_STATUSES = ['PENDING', 'PROCESSING', 'ACTIVE', 'FAILED'] as const
export type AvatarStatus = (typeof AVATAR_STATUSES)[number]

export const AVATAR_SCAN_RESULTS = ['clean', 'rejected', 'error'] as const
export type AvatarScanResult = (typeof AVATAR_SCAN_RESULTS)[number]

// ── Avatar variant labels ─────────────────────────────────────────

export const AVARIANT_LABELS = ['original', 'thumb', 'medium'] as const
export type AvatarVariantLabel = (typeof AVARIANT_LABELS)[number]

// ── Upload constraints ────────────────────────────────────────────

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024 // 5 MB
export const AVATAR_MIN_BYTES = 1 * 1024         // 1 KB
export const AVATAR_INTENT_TTL_MS = 15 * 60 * 1000 // 15 minutes

export const AVATAR_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const

export type AvatarAllowedMime = (typeof AVATAR_ALLOWED_MIME_TYPES)[number]

// ── Record types (shape returned from DB / service layer) ─────────

export interface AvatarRecord {
  id: string
  userId: string
  storageKey: string
  originalName: string | null
  contentType: string
  detectedMime: string | null
  originalBytes: number
  status: string
  scanResult: string | null
  scanReason: string | null
  width: number | null
  height: number | null
  variantCount: number
  createdAt: Date
  updatedAt: Date
  finalizedAt: Date | null
  replacedAt: Date | null
  replacedById: string | null
}

export interface AvatarVariantRecord {
  id: string
  avatarId: string
  label: string
  storageKey: string
  bytes: number
  width: number | null
  height: number | null
  createdAt: Date
}

// ── DTOs (shape sent to clients) ──────────────────────────────────

export interface UploadIntentResponse {
  uploadKey: string
  uploadUrl: string
  expiresAt: string
  maxBytes: number
  allowedTypes: readonly string[]
}

export interface AvatarFinalizeResponse {
  id: string
  status: string
  variantCount: number
  width: number | null
  height: number | null
  createdAt: string
}

export interface AvatarCurrentResponse {
  id: string
  variants: Array<{
    label: string
    url: string
    width: number | null
    height: number | null
  }>
  createdAt: string
}

// ── Upload intent payload ─────────────────────────────────────────

export interface UploadIntentRequest {
  contentType: string
  originalName?: string
  sizeBytes?: number
}

// ── Finalize payload ──────────────────────────────────────────────

export interface FinalizeRequest {
  uploadKey: string
  sha256?: string
}

// ── Storage provider interface ────────────────────────────────────

export interface SignedUploadUrl {
  uploadUrl: string
  storageKey: string
  expiresAt: Date
}

export interface ImageDimensions {
  width: number
  height: number
}

export interface StorageProvider {
  /** Generate a signed upload URL for a user-scoped object. */
  createSignedUpload(userId: string, key: string, contentType: string, expiresMs: number): Promise<SignedUploadUrl>

  /** Read raw bytes from a stored object. */
  readBytes(storageKey: string): Promise<Buffer>

  /** Write raw bytes (for variants produced by the processing pipeline). */
  writeBytes(storageKey: string, data: Buffer, contentType: string): Promise<void>

  /** Delete an object and all its variants. */
  deleteObject(storageKey: string): Promise<void>

  /** Get a serving URL (may be the same as the storage key for dev fake). */
  getServingUrl(storageKey: string): string
}
