import prisma from '../config/database'
import logger from '../utils/logger'

interface EmailDeliveryRecord {
  id: string
  userId: string
  to: string
  subject: string
  body: string
  type: string
  status: string
  error: string | null
  attemptCount: number
  maxAttempts: number
  nextAttemptAt: Date | null
  lastAttemptAt: Date | null
  sentAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export class EmailService {
  async queueEmail(
    userId: string,
    to: string,
    subject: string,
    body: string,
    type: string = 'EMAIL_VERIFICATION',
  ): Promise<EmailDeliveryRecord> {
    const delivery = await prisma.emailDelivery.create({
      data: {
        userId,
        to,
        subject,
        body,
        type,
        status: 'pending',
        nextAttemptAt: new Date(),
      },
    })

    return delivery as unknown as EmailDeliveryRecord
  }

  async processQueue(): Promise<void> {
    const pending = await prisma.emailDelivery.findMany({
      where: {
        status: 'pending',
        nextAttemptAt: { lte: new Date() },
        attemptCount: { lt: 5 },
      },
    })

    for (const delivery of pending) {
      await this.sendEmail(delivery)
    }
  }

  private async sendEmail(delivery: any): Promise<void> {
    await prisma.emailDelivery.update({
      where: { id: delivery.id },
      data: { attemptCount: { increment: 1 }, lastAttemptAt: new Date() },
    })

    try {
      // TODO: Replace with real email provider (SendGrid, SES, etc.)
      // In development, log to console
      logger.info(
        `[EmailService] Sending email to=${delivery.to} subject="${delivery.subject}"`,
      )

      await prisma.emailDelivery.update({
        where: { id: delivery.id },
        data: { status: 'sent', sentAt: new Date() },
      })
    } catch (error: any) {
      await this.handleFailure(
        delivery,
        error.message ?? 'Email provider error',
      )
    }
  }

  private async handleFailure(
    delivery: EmailDeliveryRecord,
    error: string,
  ): Promise<void> {
    const nextAttemptCount = delivery.attemptCount + 1

    if (nextAttemptCount >= delivery.maxAttempts) {
      await prisma.emailDelivery.update({
        where: { id: delivery.id },
        data: { status: 'dead-letter', error },
      })
    } else {
      const backoffMinutes = Math.pow(5, nextAttemptCount - 1)
      const nextAttemptAt = new Date(Date.now() + backoffMinutes * 60_000)

      await prisma.emailDelivery.update({
        where: { id: delivery.id },
        data: { error, nextAttemptAt },
      })
    }
  }
}

export const emailService = new EmailService()
