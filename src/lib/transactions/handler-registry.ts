import { EventSchemaRegistry, getEventSchemaRegistry } from './event-schema.js'
import type { OutboxEventHandler } from './types.js'

export class DuplicateHandlerError extends Error {
  constructor(name: string) {
    super(`Outbox handler "${name}" is already registered`)
    this.name = 'DuplicateHandlerError'
  }
}

export class UnknownEventTypeError extends Error {
  constructor(handlerName: string, eventType: string, eventVersion: number) {
    super(
      `Outbox handler "${handlerName}" targets ${eventType} v${eventVersion}, ` +
        'which has no registered event schema'
    )
    this.name = 'UnknownEventTypeError'
  }
}

export class UnhandledEventTypeError extends Error {
  constructor(missing: string[]) {
    super(
      `No outbox handler registered for emitted event type(s): ${missing.join(', ')}. ` +
        'Register a handler or stop emitting the event.'
    )
    this.name = 'UnhandledEventTypeError'
  }
}

function keyOf(eventType: string, eventVersion: number): string {
  return `${eventType}:v${eventVersion}`
}

export class OutboxHandlerRegistry {
  private readonly byEvent = new Map<string, OutboxEventHandler[]>()
  private readonly byName = new Map<string, OutboxEventHandler>()

  constructor(private readonly schemas: EventSchemaRegistry = getEventSchemaRegistry()) {}

  register(handler: OutboxEventHandler): void {
    if (this.byName.has(handler.name)) {
      throw new DuplicateHandlerError(handler.name)
    }

    if (!this.schemas.has(handler.eventType, handler.eventVersion)) {
      throw new UnknownEventTypeError(handler.name, handler.eventType, handler.eventVersion)
    }

    const key = keyOf(handler.eventType, handler.eventVersion)
    const existing = this.byEvent.get(key) ?? []
    existing.push(handler)

    this.byEvent.set(key, existing)
    this.byName.set(handler.name, handler)
  }

  handlersFor(eventType: string, eventVersion: number): OutboxEventHandler[] {
    return this.byEvent.get(keyOf(eventType, eventVersion)) ?? []
  }

  handlerByName(name: string): OutboxEventHandler | undefined {
    return this.byName.get(name)
  }

  registeredNames(): string[] {
    return [...this.byName.keys()].sort()
  }

  describe(): Array<{ eventType: string; eventVersion: number; handlers: string[] }> {
    return [...this.byEvent.entries()]
      .map(([key, handlers]) => {
        const [eventType, version] = key.split(':v')

        return {
          eventType,
          eventVersion: Number(version),
          handlers: handlers.map(h => h.name).sort(),
        }
      })
      .sort((a, b) => a.eventType.localeCompare(b.eventType))
  }

  assertHandlersFor(emitted: Array<{ eventType: string; eventVersion: number }>): void {
    const missing = emitted
      .filter(e => this.handlersFor(e.eventType, e.eventVersion).length === 0)
      .map(e => keyOf(e.eventType, e.eventVersion))

    if (missing.length > 0) {
      throw new UnhandledEventTypeError(missing)
    }
  }

  clear(): void {
    this.byEvent.clear()
    this.byName.clear()
  }
}

let instance: OutboxHandlerRegistry | null = null

export function getOutboxHandlerRegistry(): OutboxHandlerRegistry {
  if (!instance) {
    instance = new OutboxHandlerRegistry()
  }

  return instance
}

export function resetOutboxHandlerRegistry(): void {
  instance = null
}
