# Shared Kernel Specification

The Shared Kernel contains components that are universally accessible to all domains and infrastructure layers. These are cross-cutting concerns that do not belong to any single domain.

---

## Shared Kernel Structure

```plaintext
src/shared/
├── config/           # Configuration and environment
│   ├── database.ts   # Prisma client export
│   ├── env.ts        # Environment variable validation
│   ├── logger.ts     # Logging configuration
│   └── index.ts
├── errors/           # Error handling
│   ├── types.ts      # Error classes (AppError, NotFoundError, etc.)
│   ├── codes.ts      # Error code constants
│   └── index.ts
├── middleware/       # Reusable middleware
│   ├── auth.middleware.ts       # JWT authentication
│   ├── validation.middleware.ts # Request validation
│   ├── error.middleware.ts      # Error handler
│   ├── rate-limit.middleware.ts # Rate limiting
│   └── index.ts
├── types/            # Common type definitions
│   ├── api.types.ts        # API response formats
│   ├── pagination.types.ts # Pagination types
│   ├── common.types.ts     # Shared DTOs
│   └── index.ts
├── utils/            # Utility functions
│   ├── jwt.ts        # JWT token utilities
│   ├── password.ts   # Password hashing
│   ├── date.ts       # Date utilities
│   ├── number.ts     # Number utilities
│   ├── string.ts     # String utilities
│   ├── helpers.ts    # General helpers
│   ├── constant.ts   # Application constants
│   └── index.ts
├── messaging/        # Messaging infrastructure
│   ├── email.service.ts    # Email outbox service
│   ├── webhook.service.ts  # Webhook delivery service
│   ├── events.types.ts     # Event type definitions
│   └── index.ts
└── index.ts          # Barrel export
```

---

## 1. Configuration (`shared/config/`)

### Purpose

Centralized configuration management for database, environment, logging, and external services.

### Components

#### `database.ts`

```typescript
// Exports configured Prisma client
import { PrismaClient } from '@prisma/client'

export const prisma = new PrismaClient({
  log:
    process.env.NODE_ENV === 'development'
      ? ['query', 'error', 'warn']
      : ['error'],
})

export default prisma
```

#### `env.ts`

```typescript
// Validates and exports environment variables
import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.string().default('3000'),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('1d'),
  STELLAR_NETWORK: z.enum(['testnet', 'mainnet']),
  // ... other env vars
})

export const env = envSchema.parse(process.env)
```

#### `logger.ts`

```typescript
// Exports configured logger (winston, pino, etc.)
import winston from 'winston'

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.json(),
  transports: [/* ... */],
})

export default logger
```

### Usage Rules

- All domains MUST use shared config, never read `process.env` directly
- Configuration is read-only; domains cannot modify shared config
- Domain-specific configuration goes in domain folder, imports from shared

---

## 2. Error Handling (`shared/errors/`)

### Purpose

Standardized error types and error handling across the application.

### Components

#### `types.ts`

```typescript
export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number,
    public code: string,
    public details?: any,
  ) {
    super(message)
    this.name = this.constructor.name
    Error.captureStackTrace(this, this.constructor)
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(
      `${resource}${id ? ` with id ${id}` : ''} not found`,
      404,
      'NOT_FOUND',
    )
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 400, 'VALIDATION_ERROR', details)
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED')
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403, 'FORBIDDEN')
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT')
  }
}

export class BadRequestError extends AppError {
  constructor(message: string) {
    super(message, 400, 'BAD_REQUEST')
  }
}
```

#### `codes.ts`

```typescript
export const ERROR_CODES = {
  // General
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',

  // Auth
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',

  // Business logic
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  ALREADY_CLAIMED: 'ALREADY_CLAIMED',
  // ...
} as const
```

### Usage Rules

- All domains MUST throw shared error types
- Never throw generic `Error`; always extend `AppError`
- Domain-specific errors can extend shared error classes

---

## 3. Middleware (`shared/middleware/`)

### Purpose

Reusable Express middleware for authentication, validation, error handling, and rate limiting.

### Components

#### `auth.middleware.ts`

```typescript
import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { UnauthorizedError } from '../errors'

export interface AuthRequest extends Request {
  user?: {
    id: string
    role: string
  }
}

export const authenticate = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  // JWT validation logic
  // Attaches user to req.user
}

export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw new ForbiddenError()
    }
    next()
  }
}
```

#### `validation.middleware.ts`

```typescript
import { Request, Response, NextFunction } from 'express'
import { ZodSchema } from 'zod'
import { ValidationError } from '../errors'

export const validate = (schema: ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      throw new ValidationError('Validation failed', result.error.format())
    }
    next()
  }
}
```

#### `error.middleware.ts`

```typescript
import { Request, Response, NextFunction } from 'express'
import { AppError } from '../errors'
import logger from '../config/logger'

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  logger.error('Error:', { error: err.message, stack: err.stack })

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
      details: err.details,
    })
  }

  // Unknown error
  res.status(500).json({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
  })
}

export const notFoundHandler = (req: Request, res: Response) => {
  res.status(404).json({
    error: 'Resource not found',
    code: 'NOT_FOUND',
    path: req.path,
  })
}

export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}
```

#### `rate-limit.middleware.ts`

```typescript
import rateLimit from 'express-rate-limit'

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later',
})

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // strict limit for auth endpoints
  message: 'Too many authentication attempts, please try again later',
})
```

### Usage Rules

- All routes SHOULD use shared middleware
- Domain-specific middleware can extend/compose shared middleware
- Middleware must be stateless and reusable

---

## 4. Common Types (`shared/types/`)

### Purpose

Type definitions shared across all domains.

### Components

#### `api.types.ts`

```typescript
export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

export interface PaginatedResponse<T = any> {
  data: T[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
    hasNext: boolean
    hasPrev: boolean
  }
}

export interface ApiError {
  error: string
  code: string
  details?: any
}
```

#### `pagination.types.ts`

```typescript
export interface PaginationParams {
  page?: number
  limit?: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

export interface PaginationMeta {
  page: number
  limit: number
  total: number
  totalPages: number
  hasNext: boolean
  hasPrev: boolean
}
```

#### `common.types.ts`

```typescript
export type Timestamp = string // ISO 8601
export type UUID = string

export enum Role {
  ADMIN = 'ADMIN',
  LEARNER = 'LEARNER',
  INSTRUCTOR = 'INSTRUCTOR',
}

export interface BaseEntity {
  id: string
  createdAt: Date
  updatedAt: Date
}
```

### Usage Rules

- Use for DTOs that cross domain boundaries
- Domain-specific types belong in domain folders
- Keep types minimal and stable

---

## 5. Utilities (`shared/utils/`)

### Purpose

Pure utility functions without business logic.

### Components

#### `jwt.ts`

```typescript
import jwt from 'jsonwebtoken'
import { env } from '../config/env'

export const generateToken = (payload: object): string => {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  })
}

export const verifyToken = (token: string): any => {
  return jwt.verify(token, env.JWT_SECRET)
}
```

#### `password.ts`

```typescript
import bcrypt from 'bcryptjs'

export const hashPassword = async (password: string): Promise<string> => {
  const salt = await bcrypt.genSalt(10)
  return bcrypt.hash(password, salt)
}

export const comparePassword = async (
  password: string,
  hash: string,
): Promise<boolean> => {
  return bcrypt.compare(password, hash)
}
```

#### `date.ts`, `number.ts`, `string.ts`

```typescript
// Pure utility functions for formatting, parsing, validation
```

### Usage Rules

- Utilities MUST be pure functions (no side effects)
- No database access or external API calls
- No business logic; only technical utilities

---

## 6. Messaging Infrastructure (`shared/messaging/`)

### Purpose

Outbox pattern implementation for emails, webhooks, and domain events.

### Components

#### `email.service.ts`

```typescript
import prisma from '../config/database'
import logger from '../config/logger'

export class EmailService {
  async queueEmail(
    userId: string,
    to: string,
    subject: string,
    body: string,
    type: string = 'GENERAL',
  ): Promise<void> {
    await prisma.emailDelivery.create({
      data: { userId, to, subject, body, type, status: 'pending' },
    })

    // Trigger async processing
    this.processQueue().catch((err) => logger.error('Email queue error:', err))
  }

  async processQueue(): Promise<void> {
    // Process pending emails with retry logic
  }
}

export const emailService = new EmailService()
```

#### `webhook.service.ts`

```typescript
// Similar outbox pattern for webhook delivery
```

#### `events.types.ts`

```typescript
export interface DomainEvent {
  eventType: string
  aggregateId: string
  aggregateType: string
  payload: any
  timestamp: Date
  version: number
}

// Specific event types
export interface UserRegisteredEvent extends DomainEvent {
  eventType: 'UserRegistered'
  aggregateType: 'User'
  payload: {
    userId: string
    email: string
    role: string
  }
}

// ... other event types
```

### Usage Rules

- Domains MUST use messaging infrastructure for async communication
- No direct service-to-service calls for cross-domain operations
- Events are write-only (fire and forget)

---

## Import Rules for Shared Kernel

### ✅ Allowed

```typescript
// Any domain can import from shared
import { prisma } from '@/shared/config/database'
import { NotFoundError } from '@/shared/errors'
import { authenticate } from '@/shared/middleware/auth'
import { ApiResponse } from '@/shared/types/api'
import { hashPassword } from '@/shared/utils/password'
import { emailService } from '@/shared/messaging/email.service'
```

### ❌ Forbidden

```typescripttypescript
// Shared CANNOT import from domains
import { UserService } from '@/domains/users/user.service' // ❌
import { RewardService } from '@/domains/rewards/reward.service' // ❌

// Shared CANNOT contain business logic
// Shared CANNOT access domain-specific models directly
```

---

## Testing the Shared Kernel

- Each shared component MUST have unit tests
- No mocking of domain logic (shared has no domain dependencies)
- Test utilities, error handling, middleware in isolation

---

## Migration Path

Current → Target structure:

```plaintext
src/config/           → src/shared/config/
src/utils/errors.ts   → src/shared/errors/
src/middleware/       → src/shared/middleware/
src/types/api.types.ts→ src/shared/types/
src/utils/            → src/shared/utils/
src/services/email.service.ts → src/shared/messaging/
src/services/webhook.service.ts → src/shared/messaging/
```

---

## Versioning and Stability

- Shared kernel changes affect ALL domains
- Breaking changes require careful planning and communication
- Semantic versioning for shared kernel components (future consideration)
- Keep shared kernel stable and minimal
