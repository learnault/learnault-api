import { PrismaClient, WebhookEndpoint, WebhookDelivery } from '@prisma/client';
import crypto from 'crypto';
import { WebhookEventType, WebhookPayload, WebhookEndpointCreate } from '../types/webhook.types';

const prisma = new PrismaClient();

export class WebhookService {
    /**
     * Register a new webhook endpoint.
     */
    async registerEndpoint(data: WebhookEndpointCreate): Promise<WebhookEndpoint> {
        return prisma.webhookEndpoint.create({
            data: {
                url: data.url,
                secret: data.secret || crypto.randomBytes(32).toString('hex'),
                events: data.events.join(','),
                description: data.description,
            },
        });
    }

    /**
     * Queue an event for all registered endpoints interested in the event type.
     */
    async queueEvent(eventType: WebhookEventType, data: any): Promise<void> {
        const endpoints = await prisma.webhookEndpoint.findMany({
            where: {
                isActive: true,
                events: {
                    contains: eventType,
                },
            },
        });

        if (endpoints.length === 0) return;

        const timestamp = new Date().toISOString();

        const deliveries = await Promise.all(
            endpoints.map((endpoint) => {
                const payload: WebhookPayload = {
                    eventId: crypto.randomUUID(),
                    eventType,
                    timestamp,
                    data,
                };

                return prisma.webhookDelivery.create({
                    data: {
                        endpointId: endpoint.id,
                        eventType,
                        payload: JSON.stringify(payload),
                        status: 'pending',
                        nextAttemptAt: new Date(),
                    },
                });
            })
        );

        // Process asynchronously
        this.processQueue().catch(err => console.error('[Webhook] Queue processing error:', err));
    }

    /**
     * Process pending remains in the queue.
     */
    async processQueue(): Promise<void> {
        const pendingDeliveries = await prisma.webhookDelivery.findMany({
            where: {
                status: 'pending',
                nextAttemptAt: {
                    lte: new Date(),
                },
                attemptCount: {
                    lt: 5,
                },
            },
            include: {
                endpoint: true,
            },
        });

        for (const delivery of pendingDeliveries) {
            await this.sendWebhook(delivery);
        }
    }

    private async sendWebhook(delivery: WebhookDelivery & { endpoint: WebhookEndpoint }): Promise<void> {
        const { endpoint, payload, eventType } = delivery;

        await prisma.webhookDelivery.update({
            where: { id: delivery.id },
            data: {
                attemptCount: { increment: 1 },
                lastAttemptAt: new Date()
            },
        });

        try {
            const signature = this.generateSignature(payload, endpoint.secret || '');

            const response = await fetch(endpoint.url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Learnault-Signature': signature,
                    'X-Learnault-Event': eventType,
                },
                body: payload,
                signal: AbortSignal.timeout(10000),
            });

            const responseBody = await response.text();

            if (response.ok) {
                await prisma.webhookDelivery.update({
                    where: { id: delivery.id },
                    data: {
                        status: 'success',
                        statusCode: response.status,
                        responseBody: responseBody.slice(0, 1000),
                    },
                });
            } else {
                await this.handleFailure(delivery, `HTTP ${response.status}: ${responseBody.slice(0, 200)}`, response.status);
            }
        } catch (error: any) {
            await this.handleFailure(delivery, error.message || 'Network error');
        }
    }

    private generateSignature(payload: string, secret: string): string {
        return crypto
            .createHmac('sha256', secret)
            .update(payload)
            .digest('hex');
    }

    private async handleFailure(delivery: WebhookDelivery, error: string, statusCode?: number): Promise<void> {
        const nextAttemptCount = delivery.attemptCount + 1;

        if (nextAttemptCount >= delivery.maxAttempts) {
            await prisma.webhookDelivery.update({
                where: { id: delivery.id },
                data: {
                    status: 'failed',
                    error,
                    statusCode,
                },
            });

            await this.checkEndpointHealth(delivery.endpointId);
        } else {
            const backoffMinutes = Math.pow(5, nextAttemptCount - 1);
            const nextAttemptAt = new Date(Date.now() + backoffMinutes * 60000);

            await prisma.webhookDelivery.update({
                where: { id: delivery.id },
                data: {
                    error,
                    statusCode,
                    nextAttemptAt,
                },
            });
        }
    }

    private async checkEndpointHealth(endpointId: string): Promise<void> {
        const recentDeliveries = await prisma.webhookDelivery.findMany({
            where: { endpointId },
            orderBy: { createdAt: 'desc' },
            take: 10,
        });

        const failureCount = recentDeliveries.filter(d => d.status === 'failed').length;

        if (failureCount >= 10) {
            await prisma.webhookEndpoint.update({
                where: { id: endpointId },
                data: { isActive: false },
            });
            console.warn(`[Webhook] Deactivating endpoint ${endpointId} due to repeated failures.`);
        }
    }
}
