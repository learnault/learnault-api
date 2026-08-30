/**
 * Event Schema Registry: Version and validate outbox event payloads
 *
 * Ensures that event payloads conform to expected schemas based on
 * eventVersion. This prevents workers from processing malformed events
 * and aids in safe migrations when event schemas evolve.
 */

import { z } from 'zod'
import { EventSchema } from './types.js'

/**
 * Event schema registry mapping (eventType, version) → schema validator
 *
 * Usage:
 * ```typescript
 * // Register schemas
 * eventSchemaRegistry.register({
 *   version: 1,
 *   eventType: "UserCreated",
 *   validate: (payload) => {
 *     const schema = z.object({
 *       userId: z.string().uuid(),
 *       email: z.string().email(),
 *     });
 *     return schema.parseAsync(payload);
 *   },
 * });
 *
 * // Validate event payloads
 * await eventSchemaRegistry.validate("UserCreated", 1, payload);
 * ```
 */
export class EventSchemaRegistry {
  private schemas: Map<string, EventSchema> = new Map()

  /**
   * Register an event schema
   *
   * @param schema EventSchema with version, eventType, and validate function
   */
  register(schema: EventSchema): void {
    const key = `${schema.eventType}:v${schema.version}`
    this.schemas.set(key, schema)
  }

  /**
   * Validate an event payload against its schema
   *
   * @param eventType Event type
   * @param eventVersion Event schema version
   * @param payload Event payload to validate
   * @throws Error if payload doesn't match schema
   */
  async validate(
    eventType: string,
    eventVersion: number,
    payload: unknown
  ): Promise<void> {
    const key = `${eventType}:v${eventVersion}`
    const schema = this.schemas.get(key)

    if (!schema) {
      throw new Error(
        `No schema registered for ${eventType} version ${eventVersion}`
      )
    }

    try {
      await schema.validate(payload)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const err = new Error(
        `Event payload validation failed for ${eventType} v${eventVersion}: ${message}`
      )
      if (error instanceof Error) {
        err.cause = error
      }

      throw err
    }
  }

  /**
   * Check if a schema is registered
   *
   * @param eventType Event type
   * @param eventVersion Event schema version
   * @returns true if schema is registered
   */
  has(eventType: string, eventVersion: number): boolean {
    const key = `${eventType}:v${eventVersion}`

    return this.schemas.has(key)
  }

  /**
   * Get all registered schemas
   *
   * @returns Array of registered EventSchemas
   */
  getAll(): EventSchema[] {
    return Array.from(this.schemas.values())
  }
}

/**
 * Singleton instance of EventSchemaRegistry
 */
let registryInstance: EventSchemaRegistry | null = null

/**
 * Get or create the event schema registry instance
 */
export function getEventSchemaRegistry(): EventSchemaRegistry {
  if (!registryInstance) {
    registryInstance = new EventSchemaRegistry()
  }

  return registryInstance
}

// ─────────────────────────────────────────────────────────────────────────────
// Built-in Event Schemas (examples - extend as needed)
// ─────────────────────────────────────────────────────────────────────────────

const registry = getEventSchemaRegistry()

/**
 * Register built-in event schemas
 *
 * Call this on application startup to populate the registry with all
 * event types your system handles.
 */
export function registerBuiltInSchemas(): void {
  // User domain events
  registry.register({
    version: 1,
    eventType: 'UserCreated',
    validate: async (payload) => {
      const schema = z.object({
        userId: z.string().uuid(),
        email: z.string().email(),
        role: z.enum(['ADMIN', 'LEARNER', 'INSTRUCTOR']),
      })
      await schema.parseAsync(payload)
    },
  })

  // Wallet domain events
  registry.register({
    version: 1,
    eventType: 'WalletProvisioningRequested',
    validate: async (payload) => {
      const schema = z.object({
        walletId: z.string().uuid(),
        userId: z.string().uuid(),
        network: z.string(),
      })
      await schema.parseAsync(payload)
    },
  })

  registry.register({
    version: 1,
    eventType: 'WalletProvisioned',
    validate: async (payload) => {
      const schema = z.object({
        walletId: z.string().uuid(),
        userId: z.string().uuid(),
        publicKey: z.string(),
        network: z.enum(['testnet', 'mainnet']),
      })
      await schema.parseAsync(payload)
    },
  })

  registry.register({
    version: 1,
    eventType: 'WalletProvisioningFailed',
    validate: async (payload) => {
      const schema = z.object({
        walletId: z.string().uuid(),
        userId: z.string().uuid(),
        failureCode: z.string(),
        attemptCount: z.number().int().positive(),
      })
      await schema.parseAsync(payload)
    },
  })

  // Learning domain events
  registry.register({
    version: 1,
    eventType: 'ModuleCompleted',
    validate: async (payload) => {
      const schema = z.object({
        completionId: z.string().uuid(),
        userId: z.string().uuid(),
        moduleId: z.string().uuid(),
        score: z.number().min(0).max(100),
      })
      await schema.parseAsync(payload)
    },
  })

  // Reward domain events
  registry.register({
    version: 1,
    eventType: 'RewardCalculated',
    validate: async (payload) => {
      const schema = z.object({
        rewardId: z.string().uuid(),
        userId: z.string().uuid(),
        amountStroops: z.string(), // BigInt as string
        assetCode: z.string(),
        assetIssuer: z.string().nullable(),
        source: z.string(), // "completion", "referral", "bonus"
      })
      await schema.parseAsync(payload)
    },
  })

  registry.register({
    version: 1,
    eventType: 'RewardDistributed',
    validate: async (payload) => {
      const schema = z.object({
        transactionId: z.string().uuid(),
        userId: z.string().uuid(),
        amountStroops: z.string(),
        assetCode: z.string(),
        stellarTxHash: z.string(),
        ledgerSequence: z.number().int().positive(),
      })
      await schema.parseAsync(payload)
    },
  })

  // Credential domain events
  registry.register({
    version: 1,
    eventType: 'CredentialIssued',
    validate: async (payload) => {
      const schema = z.object({
        credentialId: z.string().uuid(),
        userId: z.string().uuid(),
        moduleId: z.string().uuid(),
        onChainId: z.string().optional(),
      })
      await schema.parseAsync(payload)
    },
  })

  // Notification domain events
  registry.register({
    version: 1,
    eventType: 'NotificationQueued',
    validate: async (payload) => {
      const schema = z.object({
        notificationId: z.string().uuid(),
        userId: z.string().uuid(),
        type: z.enum(['reward', 'quiz', 'streak', 'credential']),
        title: z.string(),
        body: z.string(),
      })
      await schema.parseAsync(payload)
    },
  })

  // Email domain events
  registry.register({
    version: 1,
    eventType: 'EmailQueued',
    validate: async (payload) => {
      const schema = z.object({
        emailId: z.string().uuid(),
        userId: z.string().uuid(),
        to: z.string().email(),
        subject: z.string(),
        type: z.string(),
      })
      await schema.parseAsync(payload)
    },
  })
}

/**
 * Helper function to create a Zod-based event schema
 *
 * Usage:
 * ```typescript
 * registry.register(
 *   createEventSchema("UserUpdated", 1, z.object({
 *     userId: z.string().uuid(),
 *     email: z.string().email(),
 *   }))
 * );
 * ```
 */
export function createEventSchema(
  eventType: string,
  version: number,
  zodSchema: z.ZodSchema
): EventSchema {
  return {
    eventType,
    version,
    validate: async (payload) => {
      await zodSchema.parseAsync(payload)
    },
  }
}
