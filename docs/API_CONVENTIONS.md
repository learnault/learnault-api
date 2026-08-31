# Learnault API Conventions & Contract Specification

This document defines the standardized DTOs, response envelopes, error handling, pagination guidelines, date/financial serialization, request validation rules, and API-versioning policy across all endpoints in the Learnault API.

---

## 1. Overview & Core Principles

All Learnault API endpoints must adhere to consistent, deterministic response formats and error structures.

- **Explicit Envelopes**: Every API response returns a top-level JSON envelope containing a `success` boolean.
- **Stable Error Codes**: Errors report Machine-readable string codes (e.g. `VALIDATION_ERROR`, `RESOURCE_NOT_FOUND`) without leaking database internals or raw stack traces in non-development environments.
- **Deterministic Pagination**: All paginated responses enforce secondary tiebreaker sorting (e.g. `id` ASC/DESC) to prevent duplication or missing records during concurrent writes.
- **Precision Financial Values**: Monetary and token balances are represented using string-encoded exact amounts alongside explicit asset codes and issuer identifiers.
- **ISO 8601 UTC Timestamps**: All date-time values are represented in UTC ISO-8601 string format with the `Z` suffix.
- **Consistent Request Metadata**: Every request tracks a correlation `requestId`, request timestamp, and API version context (`v1`).

---

## 2. Standard Response Envelopes

### 2.1 Success Envelope (`ApiResponse<T>`)

Returned for single-resource operations, action completions, and non-paginated queries.

#### TypeScript Definition

```typescript
export interface RequestMetadata {
  requestId: string
  timestamp: string
  version: string
}

export interface ApiResponse<T> {
  success: true
  data: T
  message?: string
  meta: RequestMetadata
}
```

#### Runtime Example (JSON)

```json
{
  "success": true,
  "data": {
    "id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "email": "learner@learnault.com",
    "role": "LEARNER",
    "createdAt": "2026-07-25T14:00:00.000Z"
  },
  "message": "User profile retrieved successfully",
  "meta": {
    "requestId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "timestamp": "2026-07-25T14:00:00.000Z",
    "version": "v1"
  }
}
```

---

### 2.2 Offset / Page-Based Pagination Envelope (`PaginatedResponse<T>`)

Used for catalog browsing, administrative tables, search results, and resource listings where total count and page navigation are required.

#### TypeScript Definition

```typescript
export interface PaginationMeta extends RequestMetadata {
  page: number
  limit: number
  total: number
  totalPages: number
  hasNextPage: boolean
  hasPrevPage: boolean
}

export interface PaginatedResponse<T> {
  success: true
  data: T[]
  meta: PaginationMeta
  message?: string
}
```

#### Runtime Example (JSON)

```json
{
  "success": true,
  "data": [
    {
      "id": "c1f7b04e-6e84-482a-89a1-0f7f3299712a",
      "title": "Introduction to Soroban Smart Contracts",
      "slug": "intro-to-soroban",
      "createdAt": "2026-07-20T10:00:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "totalPages": 3,
    "hasNextPage": true,
    "hasPrevPage": false,
    "requestId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "timestamp": "2026-07-25T14:00:00.000Z",
    "version": "v1"
  }
}
```

---

### 2.3 Cursor-Based Pagination Envelope (`CursorPaginatedResponse<T>`)

Used for high-frequency time-series data, append-only logs, activity streams, ledger transactions, and real-time feeds to guarantee zero skipped items during live updates.

#### TypeScript Definition

```typescript
export interface CursorPaginationMeta extends RequestMetadata {
  cursor?: string
  nextCursor: string | null
  hasMore: boolean
  limit: number
}

export interface CursorPaginatedResponse<T> {
  success: true
  data: T[]
  meta: CursorPaginationMeta
  message?: string
}
```

#### Runtime Example (JSON)

```json
{
  "success": true,
  "data": [
    {
      "id": "e2a046c8-527e-4d4b-97c9-e771b93f2187",
      "action": "LESSON_COMPLETED",
      "timestamp": "2026-07-25T13:50:00.000Z"
    }
  ],
  "meta": {
    "cursor": "eyJpZCI6ImUyYTA0NmM4LTUyN2UtNGQ0Yi05N2M5LWU3NzFiOTNmMjE4NyIsImNyZWF0ZWRBdCI6IjIwMjYtMDctMjVUMTM6NTA6MDAuMDAwWiJ9",
    "nextCursor": "eyJpZCI6ImE4YjAxOGQ5LWQzMTUtNDk0YS04MmExLTA1NGM2MWY4NDIyOSIsImNyZWF0ZWRBdCI6IjIwMjYtMDctMjVUMTM6NDU6MDAuMDAwWiJ9",
    "hasMore": true,
    "limit": 20,
    "requestId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "timestamp": "2026-07-25T14:00:00.000Z",
    "version": "v1"
  }
}
```

---

### 2.4 Domain Error Envelope (`ApiErrorResponse`)

Returned when an operational error occurs (e.g. resource not found, unauthorized, forbidden action, rate limit exceeded, conflict).

#### TypeScript Definition

```typescript
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

export interface ApiErrorDetail {
  message: string
  code?: string
  details?: Record<string, string[] | string>
  stack?: string[]
  request?: {
    method: string
    path: string
    headers?: Record<string, string | string[] | undefined>
  }
}

export interface ApiErrorResponse {
  success: false
  error: ApiErrorDetail
  requestId: string
  timestamp: string
}
```

#### Runtime Example (JSON)

```json
{
  "success": false,
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "User with ID 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d not found"
  },
  "requestId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "timestamp": "2026-07-25T14:00:00.000Z"
}
```

---

### 2.5 Validation Error Envelope (`ApiValidationErrorResponse`)

Returned when input parameters, query parameters, or request body fail schema validation.

#### TypeScript Definition

```typescript
export interface ApiValidationErrorResponse {
  success: false
  error: {
    code: ErrorCode.VALIDATION_ERROR
    message: string
    details: Record<string, string[]>
  }
  requestId: string
  timestamp: string
}
```

#### Runtime Example (JSON)

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": {
      "body.email": ["Invalid email format"],
      "body.password": ["Password must be at least 8 characters long"]
    }
  },
  "requestId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "timestamp": "2026-07-25T14:00:00.000Z"
}
```

---

## 3. Pagination & Ordering Rules

### 3.1 Choosing Pagination Strategy

| Feature / Criteria      | Page-Based (`page`, `limit`)                    | Cursor-Based (`cursor`, `limit`)                |
| :---------------------- | :---------------------------------------------- | :---------------------------------------------- |
| **Use Cases**           | Admin tables, Catalog listing, User search      | Audit logs, Activity feeds, Ledger transactions |
| **Random Page Access**  | Supported (`page=5`)                            | Not supported (sequential traversal)            |
| **Total Count**         | Provided (`meta.total`, `meta.totalPages`)      | Omitted for high-throughput scalability         |
| **Mutation Resilience** | Sensitive to insertions/deletions during paging | Immune to insertions/deletions during paging    |
| **Default Boundaries**  | `page=1`, `limit=20` (max: 100)                 | `limit=20` (max: 100)                           |

### 3.2 Stable Ordering Requirements (Tiebreakers)

To avoid non-deterministic pagination where database records with matching sort keys slip across page boundaries:

1. Primary sorting is performed on the requested sort field (e.g. `createdAt`, `title`, `points`).
2. **Secondary tiebreaker is mandatory**: The database query MUST append `id` ASC or `id` DESC as the final ordering criteria.
3. Example Prisma ordering:
   ```typescript
   orderBy: [{ createdAt: sortOrder }, { id: sortOrder }]
   ```

---

## 4. Data Serialization Rules

### 4.1 ISO 8601 UTC Dates

- All date and time fields must be serialized as UTC strings in ISO-8601 format ending with `Z`.
- Example: `"2026-07-25T14:00:00.000Z"`
- Zod schema helper: `z.string().datetime()`

### 4.2 Financial, Token, & Asset Amounts

- Monetary and token values must never be serialized using native floating-point numbers.
- Exact amounts are serialized as string representations alongside asset code and issuer.

#### TypeScript Definition

```typescript
export interface AssetAmount {
  amount: string // e.g. "100.5000000" or stroop integer string "1005000000"
  assetCode: string // e.g. "XLM", "LEARN"
  issuer?: string | null // Stellar issuer public key or null for native asset
}
```

### 4.3 Identifiers

- Resource primary keys must be standard lowercase UUID v4 strings.
- Example: `"9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"`
- Zod schema helper: `z.string().uuid()`

### 4.4 Nulls & Optional Fields

- In PUT/PATCH requests:
  - Missing field (`undefined`) means field is untouched.
  - Explicit `null` means field value should be cleared/reset.
- In API responses:
  - Absent values are returned as `null` rather than omitted or set to `undefined`.

### 4.5 Enum Values

- All enums in contracts are represented as `UPPERCASE_SNAKE_CASE` string literals.
- Examples: `USER_ROLE_LEARNER`, `ACCOUNT_STATUS_ACTIVE`, `SORT_ORDER_ASC`.

---

## 5. Request Validation & Unknown-Field Behavior

1. **Automatic Parsing**: Incoming query parameters, path params, and request bodies are validated using Zod schemas via `validate()` middleware.
2. **Unknown Fields Policy**:
   - By default, unexpected properties present in `req.body` or `req.query` are stripped (`.strip()`) to preserve safety and prevent unexpected payload pollution.
   - Strict endpoints requiring exact body structures enforce `.strict()`, rejecting unrecognised fields with a `VALIDATION_ERROR`.
3. **Structured Validation Output**: Field-level validation errors map to `error.details` as array of error messages per field location (e.g. `body.email`, `query.limit`, `params.id`).

---

## 6. API Versioning & Deprecation Policy

### 6.1 Versioning Strategy

- Primary API routes are prefixed under `/api/v1/`.
- Non-breaking additions (e.g. adding new optional fields to responses) are introduced within `/api/v1/`.
- Breaking changes require a new version route prefix (`/api/v2/`).

### 6.2 Version Header

Every API response includes the `X-API-Version` response header set to `v1`.

### 6.3 Deprecation Policy & Headers

When an endpoint or version path is deprecated:

1. It continues functioning for at least **6 months** prior to sunsetting.
2. Response headers MUST include standard RFC 8594 deprecation headers:
   - `Deprecation: true`
   - `Sunset: <HTTP-date>` (e.g. `Sun, 31 Dec 2026 23:59:59 GMT`)
   - `Link: </docs/deprecations#feature-name>; rel="sunset"`
3. The OpenAPI specification marks the endpoint with `deprecated: true`.
