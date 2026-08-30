import { describe, it, expect, beforeEach } from 'vitest'
import { EventSchemaRegistry } from '../../src/lib/transactions/event-schema'
import {
  DuplicateHandlerError,
  OutboxHandlerRegistry,
  UnhandledEventTypeError,
  UnknownEventTypeError,
} from '../../src/lib/transactions/handler-registry'
import type { OutboxEventHandler } from '../../src/lib/transactions/types'

function handler(
  name: string,
  eventType = 'UserCreated',
  eventVersion = 1
): OutboxEventHandler {
  return { name, eventType, eventVersion, handle: async () => undefined }
}

describe('OutboxHandlerRegistry', () => {
  let schemas: EventSchemaRegistry
  let registry: OutboxHandlerRegistry

  beforeEach(() => {
    schemas = new EventSchemaRegistry()
    schemas.register({ eventType: 'UserCreated', version: 1, validate: () => undefined })
    schemas.register({ eventType: 'WalletProvisioned', version: 1, validate: () => undefined })
    registry = new OutboxHandlerRegistry(schemas)
  })

  it('resolves handlers by event type and version', () => {
    const a = handler('a')
    registry.register(a)

    expect(registry.handlersFor('UserCreated', 1)).toEqual([a])
    expect(registry.handlersFor('UserCreated', 2)).toEqual([])
    expect(registry.handlerByName('a')).toBe(a)
  })

  it('supports several handlers for one event type', () => {
    registry.register(handler('a'))
    registry.register(handler('b'))

    expect(registry.handlersFor('UserCreated', 1).map(h => h.name)).toEqual(['a', 'b'])
    expect(registry.registeredNames()).toEqual(['a', 'b'])
  })

  it('rejects a duplicate handler name', () => {
    registry.register(handler('a'))

    expect(() => registry.register(handler('a', 'WalletProvisioned'))).toThrow(
      DuplicateHandlerError
    )
  })

  it('rejects a handler for an event type with no registered schema', () => {
    expect(() => registry.register(handler('a', 'NeverDeclared'))).toThrow(
      UnknownEventTypeError
    )
  })

  it('rejects a handler for a version the schema registry does not know', () => {
    expect(() => registry.register(handler('a', 'UserCreated', 7))).toThrow(
      UnknownEventTypeError
    )
  })

  it('fails loudly when an emitted event type has no handler', () => {
    registry.register(handler('a'))

    expect(() =>
      registry.assertHandlersFor([
        { eventType: 'UserCreated', eventVersion: 1 },
        { eventType: 'WalletProvisioned', eventVersion: 1 },
      ])
    ).toThrow(UnhandledEventTypeError)

    expect(() =>
      registry.assertHandlersFor([{ eventType: 'UserCreated', eventVersion: 1 }])
    ).not.toThrow()
  })

  it('names the missing event types in the startup error', () => {
    expect(() =>
      registry.assertHandlersFor([{ eventType: 'WalletProvisioned', eventVersion: 1 }])
    ).toThrow(/WalletProvisioned:v1/)
  })

  it('describes what is registered for operator inspection', () => {
    registry.register(handler('b'))
    registry.register(handler('a'))
    registry.register(handler('c', 'WalletProvisioned'))

    expect(registry.describe()).toEqual([
      { eventType: 'UserCreated', eventVersion: 1, handlers: ['a', 'b'] },
      { eventType: 'WalletProvisioned', eventVersion: 1, handlers: ['c'] },
    ])
  })
})
