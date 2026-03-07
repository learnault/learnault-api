// ── Pagination ─────────────────────────────────────────────

export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: SortOrder;
}

export enum SortOrder {
  ASC = "asc",
  DESC = "desc",
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

// ── API Response wrappers ──────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  timestamp: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  meta: PaginationMeta;
  message?: string;
  timestamp: string;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, string[]>;
  };
  timestamp: string;
}

// ── Auth request types ─────────────────────────────────────

/**
 * @openapi
 * components:
 *   schemas:
 *     LoginRequest:
 *       type: object
 *       required: [email, password]
 *       properties:
 *         email: { type: string, format: email }
 *         password: { type: string, format: password }
 */
export interface LoginRequest {
  email: string;
  password: string;
}

/**
 * @openapi
 * components:
 *   schemas:
 *     LoginResponse:
 *       type: object
 *       properties:
 *         accessToken: { type: string }
 *         refreshToken: { type: string }
 *         expiresIn: { type: number }
 *         user: { $ref: '#/components/schemas/User' }
 */
export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: import("./user.types").User;
}

/**
 * @openapi
 * components:
 *   schemas:
 *     RefreshTokenRequest:
 *       type: object
 *       required: [refreshToken]
 *       properties:
 *         refreshToken: { type: string }
 */
export interface RefreshTokenRequest {
  refreshToken: string;
}

/**
 * @openapi
 * components:
 *   schemas:
 *     RefreshTokenResponse:
 *       type: object
 *       properties:
 *         accessToken: { type: string }
 *         expiresIn: { type: number }
 */
export interface RefreshTokenResponse {
  accessToken: string;
  expiresIn: number;
}

/**
 * @openapi
 * components:
 *   schemas:
 *     ForgotPasswordRequest:
 *       type: object
 *       required: [email]
 *       properties:
 *         email: { type: string, format: email }
 */
export interface ForgotPasswordRequest {
  email: string;
}

/**
 * @openapi
 * components:
 *   schemas:
 *     ResetPasswordRequest:
 *       type: object
 *       required: [token, newPassword, confirmPassword]
 *       properties:
 *         token: { type: string }
 *         newPassword: { type: string, format: password }
 *         confirmPassword: { type: string, format: password }
 */
export interface ResetPasswordRequest {
  token: string;
  newPassword: string;
  confirmPassword: string;
}

// ── Shared utility types ───────────────────────────────────

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
