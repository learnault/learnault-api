# Learnault API Architecture

## Overview

Learnault API is built using **Domain-Driven Design (DDD)** principles with clear bounded contexts, a shared kernel, and event-driven communication between domains.

## Architecture Principles

1. **Domain Boundaries**: Each domain has clear ownership and responsibilities
2. **Loose Coupling**: Domains communicate via events, not direct imports
3. **High Cohesion**: Related functionality stays within domain boundaries
4. **Shared Kernel**: Common infrastructure shared across all domains
5. **Infrastructure Separation**: Infrastructure concerns separated from business logic

---

## System Structure

```plaintext
learnault-api/
├── src/
│   ├── domains/              # Business domains (bounded contexts)
│   │   ├── identity/         # Auth, registration, verification
│   │   ├── users/            # User profile management
│   │   ├── learning/         # Modules, completions, curriculum
│   │   ├── credentials/      # Digital credential issuance
│   │   ├── rewards/          # Reward calculation and distribution
│   │   ├── referrals/        # Referral tracking and bonuses
│   │   ├── notifications/    # Push notifications
│   │   ├── organizations/    # Employer/organization management
│   │   └── sync/             # Client-server synchronization
│   ├── shared/               # Shared kernel
│   │   ├── config/           # Configuration
│   │   ├── errors/           # Error handling
│   │   ├── middleware/       # Reusable middleware
│   │   ├── types/            # Common types
│   │   ├── utils/            # Utilities
│   │   └── messaging/        # Email, webhooks, events
│   ├── infrastructure/       # External integrations
│   │   └── blockchain/       # Stellar/Soroban integration
│   ├── app.ts               # Express app setup
│   └── server.ts            # Server entry point
├── docs/
│   ├── domains/             # Domain documentation
│   │   ├── DOMAIN_INVENTORY.md
│   │   ├── DOMAIN_DEFINITIONS.md
│   │   ├── SHARED_KERNEL.md
│   │   └── REQUEST_AND_EVENT_FLOWS.md
│   ├── ARCHITECTURE.md      # This file
│   ├── API.md
│   ├── ERROR_HANDLING.md
│   └── SECURITY.md
├── integrations/
│   └── architecture/        # Architecture tests
│       └── domain-boundaries.test.ts
└── prisma/
    └── schema.prisma        # Database schema
```

---

## Domain Boundaries

### Business Domains

1. **Identity & Access** (`domains/identity/`)
   - User authentication and authorization
   - JWT token management
   - Email verification

2. **User Management** (`domains/users/`)
   - User profiles and preferences
   - Wallet address management

3. **Learning Content** (`domains/learning/`)
   - Module/course management
   - Learning progress tracking
   - Completion recording

4. **Credentials** (`domains/credentials/`)
   - Digital credential issuance
   - On-chain credential storage
   - Credential verification

5. **Rewards** (`domains/rewards/`)
   - Reward calculation and distribution
   - Balance management
   - Withdrawal processing

6. **Referrals** (`domains/referrals/`)
   - Referral code generation
   - Referral tracking
   - Bonus eligibility

7. **Notifications** (`domains/notifications/`)
   - Push notification delivery
   - Device token management
   - Notification preferences

8. **Organizations** (`domains/organizations/`)
   - Employer/organization management
   - Organization verification

9. **Synchronization** (`domains/sync/`)
   - Client-server sync
   - Idempotency and conflict resolution

---

## Shared Kernel

The shared kernel contains cross-cutting concerns accessible to all domains:

- **Configuration** (`shared/config/`): Database, environment, logging
- **Error Handling** (`shared/errors/`): Error types and middleware
- **Middleware** (`shared/middleware/`): Auth, validation, rate limiting
- **Common Types** (`shared/types/`): API responses, pagination
- **Utilities** (`shared/utils/`): JWT, password hashing, helpers
- **Messaging** (`shared/messaging/`): Email/webhook delivery, event bus

**Rules:**

- All domains can import from shared kernel
- Shared kernel CANNOT import from domains
- Keep shared kernel minimal and stable

---

## Infrastructure Layer

Infrastructure provides technical capabilities without business logic:

- **Blockchain** (`infrastructure/blockchain/`): Stellar/Soroban integration
- **Database** (`shared/config/database.ts`): Prisma client

**Rules:**

- Infrastructure cannot import from business domains
- Domains call infrastructure via well-defined interfaces
- Infrastructure is replaceable (e.g., swap Stellar for different blockchain)

---

## Dependency Rules

### ✅ Allowed Dependencies

```plaintext
Domain → Shared Kernel ✅
Domain → Infrastructure ✅
Domain → Identity (for auth context) ✅
Domain A ← Domain B (via events only) ✅
```

### ❌ Forbidden Dependencies

```plaintext
Domain A → Domain B (direct import) ❌
Infrastructure → Domain ❌
Shared Kernel → Domain ❌
Circular dependencies ❌
```

### Communication Patterns

**Preferred:**

1. **Domain Events** (async, decoupled) - Use for cross-domain notifications
2. **Public Service Interfaces** (sync, explicit) - Use sparingly for queries
3. **Database Queries** (read-only) - Acceptable for simple lookups

**Anti-Patterns:**

- Direct controller-to-controller calls
- Direct service-to-service imports across domains
- Shared mutable state

---

## Domain Structure (Standard)

Each domain follows this structure:

```plaintext
domains/[domain-name]/
├── controllers/          # HTTP request handlers
│   └── [domain].controller.ts
├── services/            # Business logic
│   └── [domain].service.ts
├── repositories/        # Data access (future)
│   └── [domain].repository.ts
├── types/               # Domain-specific types
│   └── [domain].types.ts
├── schemas/             # Validation schemas (Zod)
│   └── [domain].schema.ts
├── routes/              # Route definitions
│   └── [domain].routes.ts
├── events/              # Domain event definitions (future)
│   └── [domain].events.ts
├── handlers/            # Event handlers (future)
│   └── [domain].handlers.ts
└── index.ts             # Barrel export
```

---

## Request Flow

### Standard HTTP Request

```plaintext
Client
  ↓ HTTP Request
Express App (app.ts)
  ↓ Middleware (auth, validation, rate-limit)
Domain Router
  ↓ Route handler
Domain Controller
  ↓ Input validation
Domain Service
  ↓ Business logic
  ├─→ Database (Prisma)
  ├─→ Infrastructure (Blockchain)
  └─→ Messaging (Events, Email)
Domain Controller
  ↓ Response formatting
Client
  ↓ HTTP Response
```

### Event-Driven Flow

```plaintext
Domain A
  ↓ Business logic executed
  ↓ Publish DomainEvent
Event Bus (future) / Direct Handler (current)
  ↓ Event dispatched
Domain B (Event Handler)
  ↓ React to event
  ↓ Execute business logic
  ↓ Publish new events (optional)
```

---

## Data Flow & Persistence

### Database Schema

Database schema is defined in `prisma/schema.prisma` using Prisma ORM.

**Key Models:**

- `User` - User accounts and authentication
- `Module` - Learning content
- `Completion` - Module completion records
- `Credential` - Digital credentials
- `Transaction` - Reward transactions
- `ReferralCode`, `Referral` - Referral tracking
- `NotificationLog`, `DeviceToken` - Notifications
- `EmailDelivery`, `WebhookDelivery` - Outbox pattern

### Repository Pattern (Future)

Each domain will have a repository layer to abstract database access:

```typescript
// domains/users/repositories/user.repository.ts
export class UserRepository {
  async findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } })
  }

  async create(data: CreateUserData): Promise<User> {
    return prisma.user.create({ data })
  }
}
```

**Benefits:**

- Testable (mock repositories in tests)
- Encapsulates query logic
- Can switch database technology

---

## Event-Driven Architecture (Future)

### Domain Events

Domain events represent something that has happened in the system:

```typescript
interface DomainEvent {
  eventId: string
  eventType: string // e.g., "UserRegistered"
  aggregateId: string // e.g., userId
  aggregateType: string // e.g., "User"
  payload: object
  timestamp: Date
  version: number
}
```

### Event Bus

Event bus will manage event publishing and subscription:

```typescript
// shared/messaging/event-bus.ts
class EventBus {
  publish(event: DomainEvent): void
  subscribe(eventType: string, handler: EventHandler): void
}
```

### Event Handlers

Each domain has event handlers that react to events from other domains:

```typescript
// domains/rewards/handlers/module-completed.handler.ts
export class ModuleCompletedHandler {
  async handle(event: ModuleCompletedEvent): Promise<void> {
    // Calculate and distribute reward
  }
}
```

---

## Error Handling

### Error Types

All errors extend `AppError` from shared kernel:

- `NotFoundError` (404)
- `ValidationError` (400)
- `UnauthorizedError` (401)
- `ForbiddenError` (403)
- `ConflictError` (409)
- `BadRequestError` (400)

### Error Response Format

```json
{
  "error": "Resource not found",
  "code": "NOT_FOUND",
  "details": {
    "resource": "User",
    "id": "123"
  }
}
```

See `docs/ERROR_HANDLING.md` for details.

---

## Testing Strategy

### Unit Tests

- Test business logic in isolation
- Mock external dependencies (database, blockchain, email)
- Located in `tests/unit/`

### Integration Tests

- Test API endpoints end-to-end
- Use test database
- Located in `integrations/`

### Architecture Tests

- Enforce domain boundary rules
- Detect forbidden imports
- Detect circular dependencies
- Located in `integrations/architecture/`

**Run tests:**

```bash
pnpm test              # All tests
pnpm test:watch        # Watch mode
pnpm test:coverage     # With coverage
```

---

## Security

### Authentication

- JWT-based authentication
- Tokens signed with `JWT_SECRET`
- Token expiry configured via `JWT_EXPIRES_IN`
- Auth middleware: `shared/middleware/auth.middleware.ts`

### Authorization

- Role-based access control (RBAC)
- Roles: `ADMIN`, `LEARNER`, `INSTRUCTOR`
- Checked in middleware and business logic

### Rate Limiting

- API rate limiting: 100 requests per 15 minutes
- Auth rate limiting: 5 requests per 15 minutes
- Configured in `shared/middleware/rate-limit.middleware.ts`

### Input Validation

- Zod schemas for request validation
- Validation middleware: `shared/middleware/validation.middleware.ts`

See `docs/SECURITY.md` for details.

---

## API Documentation

### Swagger/OpenAPI

API documentation is available at `/api-docs` when the server is running.

Configuration: `src/config/swagger.ts`

### Versioning

Current API version: `v1`

All routes are prefixed with `/api/v1/`

Future versions will be added as `/api/v2/`, maintaining backward compatibility.

See `docs/API.md` for endpoint details.

---

## Deployment

### Environment Variables

Required environment variables:

```bash
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://...
JWT_SECRET=...
JWT_EXPIRES_IN=1d
STELLAR_NETWORK=testnet
STELLAR_SOURCE_SECRET=...
FIREBASE_SERVICE_ACCOUNT_KEY=...
```

See `.env.example` for full list.

### Database Migrations

```bash
pnpm db:migrate     # Run migrations
pnpm db:studio      # Open Prisma Studio
pnpm seed           # Seed database
```

### Docker

```bash
docker build -t learnault-api .
docker run -p 3000:3000 learnault-api
```

See `Dockerfile` and `docker-compose.yml`.

---

## Future Enhancements

### Event Sourcing

Store all domain events for:

- Audit trail
- Event replay
- Temporal queries

### CQRS (Command Query Responsibility Segregation)

Separate read and write models:

- Commands: Modify state
- Queries: Read-optimized views

### Saga Pattern

Coordinate distributed transactions across domains:

- Orchestration-based sagas
- Compensating transactions for rollback

### API Gateway

Centralized API gateway for:

- Rate limiting
- Authentication
- Routing
- Load balancing

---

## Migration Path

### Current State (Pre-refactoring)

```plaintext
src/
├── controllers/      # Flat controller structure
├── services/         # Flat service structure
├── routes/           # Flat routes
├── config/           # Mixed with business logic
└── ...
```

### Target State (Domain-driven)

```plaintext
src/
├── domains/          # Bounded contexts
│   └── [domain]/
├── shared/           # Shared kernel
├── infrastructure/   # External integrations
└── ...
```

### Migration Steps

1. ✅ Document domain boundaries
2. ✅ Define shared kernel
3. ⬜ Create domain folder structure
4. ⬜ Move files to domains
5. ⬜ Extract shared kernel
6. ⬜ Implement event infrastructure
7. ⬜ Refactor to event-driven
8. ⬜ Add repository layer
9. ⬜ Remove forbidden dependencies

---

## References

- [Domain Inventory](./domains/DOMAIN_INVENTORY.md)
- [Domain Definitions](./domains/DOMAIN_DEFINITIONS.md)
- [Shared Kernel](./domains/SHARED_KERNEL.md)
- [Request and Event Flows](./domains/REQUEST_AND_EVENT_FLOWS.md)
- [API Documentation](./API.md)
- [Error Handling](./ERROR_HANDLING.md)
- [Security](./SECURITY.md)

---

## Contributing

When adding new features:

1. Identify which domain owns the feature
2. Add business logic to domain service
3. Add API endpoint to domain controller
4. Update domain routes
5. Publish domain events for cross-domain coordination
6. Update architecture documentation
7. Add architecture tests for new dependencies

See `docs/CONTRIBUTING.md` for details.

---

## Contact

For questions about the architecture, please open an issue or discussion on GitHub.
