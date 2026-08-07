// ── Error Code Enum ──────────────────────────────────────────────

export enum ErrorCode {
  BAD_REQUEST = 'BAD_REQUEST',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  CONFLICT = 'CONFLICT',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
}

// ── Request Metadata Context ────────────────────────────────────

export interface RequestMetadata {
  requestId: string;
  timestamp: string;
  version: string;
}

// ── Pagination Types ─────────────────────────────────────────────

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: SortOrder;
}

export interface CursorPaginationParams {
  cursor?: string;
  limit?: number;
  sortBy?: string;
  sortOrder?: SortOrder;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  requestId?: string;
  timestamp?: string;
  version?: string;
}

export interface CursorPaginationMeta {
  cursor?: string;
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
  requestId?: string;
  timestamp?: string;
  version?: string;
}

// ── API Response Wrappers ──────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  meta?: RequestMetadata;
  timestamp?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  meta: PaginationMeta;
  message?: string;
  timestamp?: string;
}

export interface CursorPaginatedResponse<T> {
  success: boolean;
  data: T[];
  meta: CursorPaginationMeta;
  message?: string;
  timestamp?: string;
}

// ── API Error Envelopes ──────────────────────────────────

export interface ApiErrorDetail {
  code: string | ErrorCode;
  message: string;
  details?: Record<string, string[] | string>;
  stack?: string[];
  request?: {
    method: string;
    path: string;
    headers?: Record<string, string | string[] | undefined>;
  };
}

export interface ApiErrorResponse {
  success: false;
  error: ApiErrorDetail;
  requestId?: string;
  timestamp: string;
}

export interface ApiValidationErrorResponse {
  success: false;
  error: {
    code: ErrorCode.VALIDATION_ERROR | string;
    message: string;
    details: Record<string, string[]>;
  };
  requestId?: string;
  timestamp: string;
}

// Legacy alias maintained for existing code compatibility
export type ApiError = ApiErrorResponse;

// ── Financial & Asset Serialization Types ──────────────────────

export interface AssetAmount {
  amount: string;
  assetCode: string;
  issuer?: string | null;
}

export interface StellarAsset {
  code: string;
  issuer?: string | null;
  isNative: boolean;
}

// ── Auth Request / Response Types ──────────────────────────────

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: import('./user.types').User;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface RefreshTokenResponse {
  accessToken: string;
  expiresIn: number;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  newPassword: string;
  confirmPassword: string;
}

// ── Shared Utility Types ───────────────────────────────────

export type Nullable<T> = T | null;
export type Optional<T> = T | undefined;
export type ID = string;
export type ISODateString = string;

export interface IdParam {
  id: ID;
}

export interface DateRangeParams {
  fromDate?: ISODateString;
  toDate?: ISODateString;
}
