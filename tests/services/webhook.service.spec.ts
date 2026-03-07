import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebhookService } from '../../src/services/webhook.service';

const { mockPrismaInstance } = vi.hoisted(() => ({
    mockPrismaInstance: {
        webhookEndpoint: {
            create: vi.fn(),
            findMany: vi.fn(),
            update: vi.fn(),
        },
        webhookDelivery: {
            create: vi.fn(),
            findMany: vi.fn(),
            update: vi.fn(),
        },
    },
}));

vi.mock('@prisma/client', () => ({
    PrismaClient: class {
        webhookEndpoint = mockPrismaInstance.webhookEndpoint;
        webhookDelivery = mockPrismaInstance.webhookDelivery;
    },
}));

// Mock global fetch
global.fetch = vi.fn();

describe('WebhookService', () => {
    let service: WebhookService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new WebhookService();
    });

    describe('registerEndpoint', () => {
        it('should create a new endpoint with a generated secret', async () => {
            const data = {
                url: 'https://example.com/webhook',
                events: ['module.completed' as any],
            };

            mockPrismaInstance.webhookEndpoint.create.mockResolvedValue({ id: '1', ...data, secret: 'secret' });

            const result = await service.registerEndpoint(data);

            expect(mockPrismaInstance.webhookEndpoint.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        url: data.url,
                        events: 'module.completed',
                    }),
                })
            );
            expect(result.id).toBe('1');
        });
    });

    describe('queueEvent', () => {
        it('should create deliveries for subscribed endpoints', async () => {
            mockPrismaInstance.webhookEndpoint.findMany.mockResolvedValue([
                { id: 'ep1', url: 'https://ep1.com', secret: 's1', events: 'module.completed', isActive: true },
            ]);
            mockPrismaInstance.webhookDelivery.create.mockResolvedValue({ id: 'd1' });
            mockPrismaInstance.webhookDelivery.findMany.mockResolvedValue([]); // for processQueue

            await service.queueEvent('module.completed', { foo: 'bar' });

            expect(mockPrismaInstance.webhookDelivery.create).toHaveBeenCalledOnce();
            const createCall = mockPrismaInstance.webhookDelivery.create.mock.calls[0][0];
            expect(createCall.data.eventType).toBe('module.completed');
            expect(JSON.parse(createCall.data.payload).data).toEqual({ foo: 'bar' });
        });
    });

    describe('signature generation', () => {
        it('should generate a valid HMAC SHA256 signature', () => {
            const payload = '{"foo":"bar"}';
            const secret = 'test-secret';
            // @ts-ignore
            const signature = service.generateSignature(payload, secret);

            expect(signature).toBeDefined();
            expect(signature).toHaveLength(64);
        });
    });

    describe('retry logic', () => {
        it('should calculate exponential backoff', async () => {
            const delivery = { id: 'd1', attemptCount: 1, maxAttempts: 5 };
            mockPrismaInstance.webhookDelivery.update.mockResolvedValue({});

            // @ts-ignore
            await service.handleFailure(delivery, 'error');

            expect(mockPrismaInstance.webhookDelivery.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        nextAttemptAt: expect.any(Date),
                    }),
                })
            );
        });

        it('should handle terminal failure after max attempts', async () => {
            const delivery = { id: 'd1', attemptCount: 4, maxAttempts: 5, endpointId: 'ep1' };
            mockPrismaInstance.webhookDelivery.update.mockResolvedValue({});
            mockPrismaInstance.webhookDelivery.findMany.mockResolvedValue([]);

            // @ts-ignore
            await service.handleFailure(delivery, 'max retry error');

            expect(mockPrismaInstance.webhookDelivery.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        status: 'failed',
                    }),
                })
            );
        });
    });
});
