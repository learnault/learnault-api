# Prisma Setup Guide

This directory contains the Prisma ORM configuration for the Learnault API.

## Quick Start

### 1. Install Dependencies

Make sure all dependencies are installed:

```bash
pnpm install
```

### 2. Configure Database

Copy `.env.example` to `.env` and update the `DATABASE_URL` with your PostgreSQL connection string:

```bash
cp .env.example .env
```

Example for local PostgreSQL:
```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/learnault_dev?schema=public"
```

### 3. Run Migrations

Create the database schema by running the initial migration:

```bash
pnpm db:migrate
```

This will:
- Create all tables based on the schema defined in `schema.prisma`
- Store migration history in the `_prisma_migrations` table
- Generate the Prisma Client

### 4. Seed the Database (Optional)

Populate the database with mock data for development:

```bash
pnpm db:seed
```

This will create:
- 2 test users
- 4 sample modules with different difficulties
- 3 module completions
- 2 credentials
- 3 transactions
- 1 webhook endpoint

### 5. Verify Setup

Open Prisma Studio to view and manage your data:

```bash
pnpm db:studio
```

## Database Schema

### Models

#### User
- Email and wallet address are unique
- Relates to completions, credentials, and transactions
- Password is stored as bcrypt hash

#### Module  
- Contains course/learning content
- Has difficulty (easy, medium, hard)
- Associates reward amount
- Relates to completions and credentials

#### Completion
- Links users to completed modules
- Stores completion score
- Unique constraint on userId + moduleId pair

#### Credential
- NFT/on-chain credential issued upon module completion
- Stores on-chain ID if already issued
- Unique constraint on userId + moduleId pair

#### Transaction
- Records all reward/transfer transactions
- Status tracking: pending, completed, failed
- Types: reward, refund, transfer

#### WebhookEndpoint & WebhookDelivery
- For event webhook delivery
- Supports retry logic with configurable attempts

## Useful Commands

```bash
# Run migrations in development mode (interactive)
pnpm db:migrate

# Create a new migration without running it
pnpm db:migrate -- --skip-apply

# Reset database (caution: deletes all data)
prisma migrate reset

# View database in Prisma Studio UI
pnpm db:studio

# Generate Prisma Client
prisma generate

# Seed database with mock data
pnpm db:seed

# Format schema.prisma
prisma format
```

## Environment Configuration

### Development
```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/learnault_dev?schema=public"
NODE_ENV=development
```

### Production
```env
DATABASE_URL="postgresql://user:password@host:5432/learnault_prod?schema=public&sslmode=require"
NODE_ENV=production
```

## Setting Up PostgreSQL Locally

### Using Docker

```bash
docker run --name learnault-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=learnault_dev \
  -p 5432:5432 \
  -d postgres:15
```

### Using Homebrew (macOS)

```bash
brew install postgresql
brew services start postgresql
psql -U postgres -c "CREATE DATABASE learnault_dev;"
```

### Using APT (Ubuntu/Debian)

```bash
sudo apt-get install postgresql postgresql-contrib
sudo -u postgres psql -c "CREATE DATABASE learnault_dev;"
```

## Testing the Connection

After setup, test the connection from the Node.js application:

```typescript
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany();
  console.log("Users:", users);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
```

## Troubleshooting

### "Can't reach database server"
- Verify PostgreSQL is running
- Check DATABASE_URL format
- Ensure correct host, port, credentials

### "Schema validation failed"
- Run `prisma migrate reset` to reset database
- Check for any migration files and review them

### "Prisma Client not found"
- Run `pnpm install` to install dependencies
- Run `pnpm db:migrate` to regenerate Prisma Client

### Import errors in seed.ts
- Ensure dependencies are installed: `pnpm install`
- Check that TypeScript and ts-node are in devDependencies
