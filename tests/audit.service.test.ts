import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/config/database', () => ({
  default: {
    auditLog: {
      create: vi.fn(),
    },
  },
}))

vi.mock('../src/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import prisma from '../src/config/database'
import logger from '../src/utils/logger'
import { AuditService } from '../src/services/audit.service'

describe('AuditService', () => {
  let service: AuditService

  beforeEach(() => {
    vi.resetAllMocks()
    service = new AuditService()
  })

  it('writes an audit entry with serialized metadata', async () => {
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as any)

    await service.record({
      userId: 'user-1',
      action: 'ACCOUNT_DEACTIVATED',
      metadata: { source: 'test' },
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    })

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        action: 'ACCOUNT_DEACTIVATED',
        metadata: JSON.stringify({ source: 'test' }),
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
      },
    })
  })

  it('never throws when the write fails — auditing must not break the flow', async () => {
    vi.mocked(prisma.auditLog.create).mockRejectedValue(new Error('db down'))

    await expect(
      service.record({ userId: 'user-1', action: 'EXPORT_REQUESTED' }),
    ).resolves.toBeUndefined()

    expect(logger.error).toHaveBeenCalled()
  })
})
