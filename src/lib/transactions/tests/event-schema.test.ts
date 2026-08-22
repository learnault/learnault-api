/**
 * Event Schema Registry Test: Verify schema registration and validation
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
  EventSchemaRegistry,
  createEventSchema,
} from '../event-schema'

describe('EventSchemaRegistry', () => {
  it('should create a new registry instance', () => {
    const registry = new EventSchemaRegistry()
    expect(registry).toBeDefined()
  })

  it('should register an event schema', async () => {
    const registry = new EventSchemaRegistry()
    const schema = createEventSchema(
      'UserCreated',
      1,
      z.object({
        userId: z.string().uuid(),
        email: z.string().email(),
      })
    )

    registry.register(schema)
    expect(registry.has('UserCreated', 1)).toBe(true)
  })

  it('should check if schema is registered', () => {
    const registry = new EventSchemaRegistry()
    expect(registry.has('UserCreated', 1)).toBe(false)

    const schema = createEventSchema(
      'UserCreated',
      1,
      z.object({ userId: z.string() })
    )
    registry.register(schema)

    expect(registry.has('UserCreated', 1)).toBe(true)
  })

  it('should get all registered schemas', () => {
    const registry = new EventSchemaRegistry()
    const schema1 = createEventSchema(
      'UserCreated',
      1,
      z.object({ userId: z.string() })
    )
    const schema2 = createEventSchema(
      'UserUpdated',
      1,
      z.object({ userId: z.string() })
    )

    registry.register(schema1)
    registry.register(schema2)

    const schemas = registry.getAll()
    expect(schemas).toHaveLength(2)
  })

  it('should validate event payload against schema', async () => {
    const registry = new EventSchemaRegistry()
    const schema = createEventSchema(
      'UserCreated',
      1,
      z.object({
        userId: z.string().uuid(),
        email: z.string().email(),
      })
    )

    registry.register(schema)

    const validPayload = {
      userId: '550e8400-e29b-41d4-a716-446655440000',
      email: 'test@example.com',
    }

    // Should not throw for valid payload
    await registry.validate('UserCreated', 1, validPayload)
  })

  it('should throw error for invalid payload', async () => {
    const registry = new EventSchemaRegistry()
    const schema = createEventSchema(
      'UserCreated',
      1,
      z.object({
        userId: z.string().uuid(),
        email: z.string().email(),
      })
    )

    registry.register(schema)

    const invalidPayload = {
      userId: 'not-a-uuid',
      email: 'not-an-email',
    }

    let threwError = false
    try {
      await registry.validate('UserCreated', 1, invalidPayload)
    } catch (error) {
      threwError = true
      expect((error as Error).message).toContain('validation failed')
    }

    expect(threwError).toBe(true)
  })

  it('should throw error for unregistered schema', async () => {
    const registry = new EventSchemaRegistry()

    let threwError = false
    try {
      await registry.validate('UnknownEvent', 1, {})
    } catch (error) {
      threwError = true
      expect((error as Error).message).toContain('No schema registered')
    }

    expect(threwError).toBe(true)
  })

  it('should support multiple versions of same event', () => {
    const registry = new EventSchemaRegistry()
    const schemaV1 = createEventSchema(
      'UserCreated',
      1,
      z.object({ userId: z.string() })
    )
    const schemaV2 = createEventSchema(
      'UserCreated',
      2,
      z.object({ userId: z.string(), email: z.string() })
    )

    registry.register(schemaV1)
    registry.register(schemaV2)

    expect(registry.has('UserCreated', 1)).toBe(true)
    expect(registry.has('UserCreated', 2)).toBe(true)
    expect(registry.has('UserCreated', 3)).toBe(false)
  })
})
