import type { EmailDeliveryRecord } from '../../src/services/email.service'

export class FakeEmailProvider {
  readonly deliveries: EmailDeliveryRecord[] = []
  readonly sentEmails: Array<{
    userId: string
    to: string
    subject: string
    body: string
    type: string
  }> = []
  shouldFail = false
  failureError = 'Email provider error'

  async queueEmail(
    userId: string,
    to: string,
    subject: string,
    body: string,
    type = 'EMAIL_VERIFICATION',
  ): Promise<EmailDeliveryRecord> {
    const delivery: EmailDeliveryRecord = {
      id: `email-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      userId,
      to,
      subject,
      body,
      type,
      status: 'pending',
      error: null,
      attemptCount: 0,
      maxAttempts: 5,
      nextAttemptAt: new Date(),
      lastAttemptAt: null,
      sentAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.deliveries.push(delivery)
    
return delivery
  }

  async processQueue(): Promise<void> {
    for (const delivery of this.deliveries) {
      if (delivery.status === 'pending' && delivery.nextAttemptAt <= new Date()) {
        await this.sendEmail(delivery)
      }
    }
  }

  private async sendEmail(delivery: EmailDeliveryRecord): Promise<void> {
    delivery.attemptCount += 1
    delivery.lastAttemptAt = new Date()
    delivery.updatedAt = new Date()

    if (this.shouldFail) {
      delivery.error = this.failureError
      if (delivery.attemptCount >= delivery.maxAttempts) {
        delivery.status = 'dead-letter'
      } else {
        const backoffMinutes = Math.pow(5, delivery.attemptCount - 1)
        delivery.nextAttemptAt = new Date(Date.now() + backoffMinutes * 60_000)
      }
      
return
    }

    this.sentEmails.push({
      userId: delivery.userId,
      to: delivery.to,
      subject: delivery.subject,
      body: delivery.body,
      type: delivery.type,
    })

    delivery.status = 'sent'
    delivery.sentAt = new Date()
    delivery.error = null
  }

  getSentEmailsForUser(userId: string): typeof this.sentEmails {
    return this.sentEmails.filter((e) => e.userId === userId)
  }

  getLastSentEmailForUser(userId: string): typeof this.sentEmails[0] | undefined {
    const emails = this.getSentEmailsForUser(userId)
    
return emails[emails.length - 1]
  }

  clear(): void {
    this.deliveries.length = 0
    this.sentEmails.length = 0
    this.shouldFail = false
    this.failureError = 'Email provider error'
  }
}

export const fakeEmailProvider = new FakeEmailProvider()