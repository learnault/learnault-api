import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NotificationService } from '../src/services/notification.service'

// Use vi.hoisted to mock dependencies before they are imported by the service
const { mockSendEachForMulticast, mockAdmin } = vi.hoisted(() => {
  const mockSendEachForMulticast = vi.fn().mockResolvedValue({ failureCount: 0, responses: [] })

  return {
    mockSendEachForMulticast,
    mockAdmin: {
      apps: [{ name: 'mock-app' }],
      initializeApp: vi.fn(),
      credential: {
        cert: vi.fn().mockReturnValue({})
      },
      messaging: vi.fn().mockReturnValue({
        sendEachForMulticast: mockSendEachForMulticast
      })
    }
  }
})

vi.mock('firebase-admin', () => ({ ...mockAdmin, default: mockAdmin }))

// Use vi.hoisted to ensure these are available for vi.mock
const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    deviceToken: {
      upsert: vi.fn()
    },
    notificationPreference: {
      upsert: vi.fn(),
      findUnique: vi.fn()
    },
    notificationLog: {
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn()
    }
  }
}))

vi.mock('../src/config/database', () => ({
  default: mockPrisma
}))

describe('NotificationService', () => {
  let service: NotificationService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new NotificationService()
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = JSON.stringify({ project_id: 'test' })
  })

  afterEach(() => {
    delete process.env.FIREBASE_SERVICE_ACCOUNT_KEY
  })

  describe('registerDeviceToken', () => {
    it('should upsert device token', async () => {
      await service.registerDeviceToken('user1', 'token1', 'ios')
      expect(mockPrisma.deviceToken.upsert).toHaveBeenCalledWith({
        where: { token: 'token1' },
        update: { userId: 'user1', platform: 'ios' },
        create: { userId: 'user1', token: 'token1', platform: 'ios' }
      })
    })
  })

  describe('updateUserPreferences', () => {
    it('should upsert preferences', async () => {
      await service.updateUserPreferences('user1', { rewardReceipt: true })
      expect(mockPrisma.notificationPreference.upsert).toHaveBeenCalledWith({
        where: { userId: 'user1' },
        update: { rewardReceipt: true },
        create: { userId: 'user1', rewardReceipt: true }
      })
    })
  })

  describe('queueNotification', () => {
    it('should create a pending log if enabled', async () => {
      mockPrisma.notificationPreference.findUnique.mockResolvedValue({ rewardReceipt: true })
      mockPrisma.notificationLog.create.mockResolvedValue({ id: 'log1' })

      const result = await service.queueNotification('user1', 'rewardReceipt', 'Title', 'Body')

      expect(mockPrisma.notificationLog.create).toHaveBeenCalled()
      expect(result).toBeDefined()
    })

    it('should return null if disabled', async () => {
      mockPrisma.notificationPreference.findUnique.mockResolvedValue({ rewardReceipt: false })

      const result = await service.queueNotification('user1', 'rewardReceipt', 'Title', 'Body')

      expect(mockPrisma.notificationLog.create).not.toHaveBeenCalled()
      expect(result).toBeNull()
    })
  })

  describe('processQueue', () => {
    it('should attempt to send pending notifications', async () => {
      const mockLog = {
        id: 'log1',
        title: 'T',
        body: 'B',
        user: { deviceTokens: [{ token: 't1' }] }
      }
      mockPrisma.notificationLog.findMany.mockResolvedValue([mockLog])

      await service.processQueue()

      expect(mockSendEachForMulticast).toHaveBeenCalled()
      expect(mockPrisma.notificationLog.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'log1' },
          data: { status: 'success' }
        })
      )
    })

    it('should handle missing tokens', async () => {
      const mockLog = {
        id: 'log1',
        title: 'T',
        body: 'B',
        user: { deviceTokens: [] }
      }
      mockPrisma.notificationLog.findMany.mockResolvedValue([mockLog])

      await service.processQueue()

      expect(mockPrisma.notificationLog.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'failed' })
        })
      )
    })
  })
})
