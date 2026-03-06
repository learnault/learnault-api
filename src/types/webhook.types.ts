export type WebhookEventType =
    | 'module.completed'
    | 'reward.issued'
    | 'user.registered'
    | 'system.test';

export interface WebhookPayload {
    eventId: string;
    eventType: WebhookEventType;
    timestamp: string;
    data: any;
}

export interface WebhookEndpointCreate {
    url: string;
    secret?: string;
    events: WebhookEventType[];
    description?: string;
}

export type WebhookStatus = 'pending' | 'success' | 'failed';
