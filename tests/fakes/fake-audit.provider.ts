import type { AuditEntry } from '../../src/types/account.types'

export interface AuditLogEntry {
  id: string
  userId: string
  action: string
  ipAddress: string | null
  userAgent: string | null
  metadata: Record<string, unknown>
  createdAt: Date
}

export class FakeAuditService {
  readonly entries: AuditLogEntry[] = []
  private sequence = 0

  async op(params: {
    userId: string
    action: string
    ipAddress?: string
    userAgent?: string
    metadata?: Record<string, unknown>
  }): Promise<void> {
    this.sequence += 1
    this.entries.push({
      id: `audit-${this.sequence}`,
      userId: params.userId,
      action: params.action,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
      metadata: params.metadata ?? {},
      createdAt: new Date(),
    })
  }

  async record(entry: Omit<AuditLogEntry, 'id' | 'createdAt'>): Promise<void> {
    this.sequence += 1
    this.entries.push({
      id: `audit-${this.sequence}`,
      ...entry,
      createdAt: new Date(),
    })
  }

  getEntriesForUser(userId: string): AuditLogEntry[] {
    return this.entries.filter((e) => e.userId === userId)
  }

  getEntriesForAction(action: string): AuditLogEntry[] {
    return this.entries.filter((e) => e.action === action)
  }

  clear(): void {
    this.entries.length = 0
    this.sequence = 0
  }
}

export const fakeAuditService = new FakeAuditService()