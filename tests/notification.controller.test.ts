import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NotificationController } from '../src/controllers/notification.controller'

// Use vi.hoisted to ensure these are available for vi.mock
const {
  mockRegisterDeviceToken,
  mockUpdateUserPreferences,
  mockQueueNotification,
  mockProcessQueue,
  mockPrisma,
} = vi.hoisted(() => ({
  mockRegisterDeviceToken: vi.fn(),
  mockUpdateUserPreferences: vi.fn(),
  mockQueueNotification: vi.fn(),
  mockProcessQueue: vi.fn(),
  mockPrisma: {
    notificationLog: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock('../src/services/notification.service', () => ({
  NotificationService: class {
    registerDeviceToken = mockRegisterDeviceToken
    updateUserPreferences = mockUpdateUserPreferences
    queueNotification = mockQueueNotification
    processQueue = mockProcessQueue
  },
}))

vi.mock('../src/config/database', () => ({
  default: mockPrisma,
}))

describe('NotificationController', () => {
  let controller: NotificationController
  let req: any
  let res: any

  beforeEach(() => {
    vi.clearAllMocks()
    controller = new NotificationController()
    req = {
      user: { id: 'user1' },
      body: {},
      query: {},
    }
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    }
  })

  describe('registerDevice', () => {
    it('should return 201 on success', async () => {
      req.body = { token: 't1', platform: 'ios' }
      mockRegisterDeviceToken.mockResolvedValue({ id: 'dt1' })

      await controller.registerDevice(req, res)

      expect(res.status).toHaveBeenCalledWith(201)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ data: { id: 'dt1' } }),
      )
    })

    it('should return 400 on invalid body', async () => {
      req.body = { token: '' } // missing platform

      await controller.registerDevice(req, res)

      expect(res.status).toHaveBeenCalledWith(400)
    })
  })

  describe('updatePreferences', () => {
    it('should return 200 on success', async () => {
      req.body = { rewardReceipt: false }
      mockUpdateUserPreferences.mockResolvedValue({ id: 'p1' })

      await controller.updatePreferences(req, res)

      expect(res.status).toHaveBeenCalledWith(200)
    })

    it('should return 400 on empty body', async () => {
      req.body = {}

      await controller.updatePreferences(req, res)

      expect(res.status).toHaveBeenCalledWith(400)
    })
  })

  describe('getDeliveryStatus', () => {
    it('should return logs for user', async () => {
      mockPrisma.notificationLog.findMany.mockResolvedValue([{ id: 'l1' }])

      await controller.getDeliveryStatus(req, res)

      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ count: 1 }),
      )
    })
  })
})
