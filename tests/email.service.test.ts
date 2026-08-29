import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EmailService } from '../src/services/email.service'
import prisma from '../src/config/database'
import logger from '../src/utils/logger'

vi.mock('../src/config/database', () => ({
    default: {
        emailDelivery: {
            create: vi.fn(),
            findMany: vi.fn(),
            update: vi.fn(),
        },
    },
}))

vi.mock('../src/utils/logger', () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
    },
}))

describe('EmailService', () => {
    let emailService: EmailService

    beforeEach(() => {
        emailService = new EmailService()
        vi.clearAllMocks()
    })

    describe('queueEmail', () => {
        it('should create a pending email delivery record without draining the queue', async () => {
            const mockDelivery = {
                id: 'del1',
                userId: 'user1',
                to: 'test@example.com',
                subject: 'Verify your email',
                body: '<html>...</html>',
                type: 'EMAIL_VERIFICATION',
                status: 'pending',
                nextAttemptAt: new Date(),
            }

            ;(prisma.emailDelivery.create as any).mockResolvedValue(mockDelivery)
            ;(prisma.emailDelivery.findMany as any).mockResolvedValue([])

            const result = await emailService.queueEmail(
                'user1',
                'test@example.com',
                'Verify your email',
                '<html>...</html>'
            )

            expect(prisma.emailDelivery.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        userId: 'user1',
                        to: 'test@example.com',
                        subject: 'Verify your email',
                        body: '<html>...</html>',
                        status: 'pending',
                    }),
                })
            )
            expect(result).toEqual(mockDelivery)
            expect(prisma.emailDelivery.findMany).not.toHaveBeenCalled()
        })
    })

    describe('processQueue', () => {
        it('should process pending email deliveries', async () => {
            const mockDelivery = {
                id: 'del1',
                userId: 'user1',
                to: 'test@example.com',
                subject: 'Verify',
                body: '<html>',
                type: 'EMAIL_VERIFICATION',
                status: 'pending',
                attemptCount: 0,
                maxAttempts: 5,
                nextAttemptAt: new Date(),
                lastAttemptAt: null,
                sentAt: null,
                error: null,
            }

            ;(prisma.emailDelivery.findMany as any).mockResolvedValue([
                mockDelivery,
            ])
            ;(prisma.emailDelivery.update as any).mockResolvedValue({ ...mockDelivery, status: 'sent' })

            await emailService.processQueue()

            expect(prisma.emailDelivery.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 'del1' },
                    data: expect.objectContaining({
                        attemptCount: { increment: 1 },
                        lastAttemptAt: expect.any(Date),
                    }),
                })
            )
            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining('Sending email')
            )
        })

        it('should dead-letter after exhausting max attempts', async () => {
            const mockDelivery = {
                id: 'del1',
                userId: 'user1',
                to: 'test@example.com',
                subject: 'Verify',
                body: '<html>',
                type: 'EMAIL_VERIFICATION',
                status: 'pending',
                attemptCount: 4,
                maxAttempts: 5,
                nextAttemptAt: new Date(),
                lastAttemptAt: null,
                sentAt: null,
                error: null,
            }

            ;(prisma.emailDelivery.findMany as any).mockResolvedValue([
                mockDelivery,
            ])
            ;(prisma.emailDelivery.update as any)
                .mockResolvedValueOnce(mockDelivery) // increment attemptCount
                .mockRejectedValueOnce(new Error('Send failed')) // sent update fails
                .mockResolvedValue({}) // handleFailure update

            await emailService.processQueue()

            // Should try to dead-letter after sent update fails
            const updateCalls = (prisma.emailDelivery.update as any).mock.calls
            const deadLetterCall = updateCalls.find(
                (call: any) => call[0]?.data?.status === 'dead-letter'
            )
            expect(deadLetterCall).toBeTruthy()
            expect(deadLetterCall[0].data.error).toBe('Send failed')
        })

        it('should apply exponential backoff on failure with retries remaining', async () => {
            const mockDelivery = {
                id: 'del1',
                userId: 'user1',
                to: 'test@example.com',
                subject: 'Verify',
                body: '<html>',
                type: 'EMAIL_VERIFICATION',
                status: 'pending',
                attemptCount: 1,
                maxAttempts: 5,
                nextAttemptAt: new Date(),
                lastAttemptAt: null,
                sentAt: null,
                error: null,
            }

            ;(prisma.emailDelivery.findMany as any).mockResolvedValue([
                mockDelivery,
            ])
            ;(prisma.emailDelivery.update as any)
                .mockResolvedValueOnce(mockDelivery) // increment attemptCount
                .mockRejectedValueOnce(new Error('Send failed')) // sent update fails
                .mockResolvedValue({}) // handleFailure update

            await emailService.processQueue()

            const updateCalls = (prisma.emailDelivery.update as any).mock.calls
            const backoffCall = updateCalls.find(
                (call: any) => call[0]?.data?.nextAttemptAt
            )
            expect(backoffCall).toBeTruthy()
            expect(backoffCall[0].data.error).toBe('Send failed')
        })

        it('should only fetch deliveries that are due for retry', async () => {
            ;(prisma.emailDelivery.findMany as any).mockResolvedValue([])

            await emailService.processQueue()

            expect(prisma.emailDelivery.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        status: 'pending',
                        nextAttemptAt: { lte: expect.any(Date) },
                        attemptCount: { lt: 5 },
                    }),
                })
            )
        })
    })
})
