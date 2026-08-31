import prisma from '../config/database'
import admin from 'firebase-admin'

// Local type definition to avoid @prisma/client import at test time
interface NotificationLog {
  id: string
  userId: string
  type: string
  title: string
  body: string
  status: string
  error: string | null
  attemptCount: number
  maxAttempts: number
  nextAttemptAt: Date | null
  createdAt: Date
  updatedAt: Date
}

// Initialize Firebase Admin lazily/safely
let firebaseInitialized = false
const initFirebase = () => {
  if (firebaseInitialized || admin.apps.length > 0) {
    firebaseInitialized = true

    return
  }
  try {
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY
    if (serviceAccount) {
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(serviceAccount)),
      })
      console.log('[NotificationService] Firebase Admin initialized.')
    } else {
      console.warn(
        '[NotificationService] FIREBASE_SERVICE_ACCOUNT_KEY not set. Push notifications will be simulated.',
      )
    }
    firebaseInitialized = true
  } catch (e) {
    console.error('[NotificationService] Failed to initialize Firebase:', e)
  }
}

export class NotificationService {
  /**
   * Register or update a device token for push notifications.
   */
  async registerDeviceToken(userId: string, token: string, platform: string) {
    return prisma.deviceToken.upsert({
      where: { token },
      update: { userId, platform },
      create: { userId, token, platform },
    })
  }

  /**
   * Upsert notification preferences for a user.
   */
  async updateUserPreferences(
    userId: string,
    preferences: {
      rewardReceipt?: boolean
      quizPassFail?: boolean
      streakReminders?: boolean
    },
  ) {
    return prisma.notificationPreference.upsert({
      where: { userId },
      update: preferences,
      create: { userId, ...preferences },
    })
  }

  /**
   * Queue a push notification if the user has not opted out.
   * Returns null if the user opted out of that notification type.
   */
  async queueNotification(
    userId: string,
    type: 'rewardReceipt' | 'quizPassFail' | 'streakReminders',
    title: string,
    body: string,
  ): Promise<NotificationLog | null> {
    const prefs = await prisma.notificationPreference.findUnique({
      where: { userId },
    })

    // Default to enabled when no preference row exists
    const isEnabled = prefs ? Boolean(prefs[type as keyof typeof prefs]) : true

    if (!isEnabled) {
      return null
    }

    const log = await prisma.notificationLog.create({
      data: {
        userId,
        type,
        title,
        body,
        status: 'pending',
        nextAttemptAt: new Date(),
      },
    })

    return log as unknown as NotificationLog
  }

  /**
   * Process all pending notification logs whose nextAttemptAt is due.
   */
  async processQueue(): Promise<void> {
    initFirebase()

    const pendingLogs = await prisma.notificationLog.findMany({
      where: {
        status: 'pending',
        nextAttemptAt: { lte: new Date() },
        attemptCount: { lt: 5 },
      },
      include: {
        user: { include: { deviceTokens: true } },
      },
    })

    for (const log of pendingLogs) {
      await this.sendPush(log)
    }
  }

  private async sendPush(log: any): Promise<void> {
    // Increment attempt counter first
    await prisma.notificationLog.update({
      where: { id: log.id },
      data: { attemptCount: { increment: 1 } },
    })

    const tokens: string[] = (log.user?.deviceTokens ?? []).map(
      (dt: any) => dt.token,
    )

    if (tokens.length === 0) {
      await prisma.notificationLog.update({
        where: { id: log.id },
        data: { status: 'failed', error: 'No device tokens found for user' },
      })

      return
    }

    try {
      if (admin.apps.length > 0) {
        const response = await admin.messaging().sendEachForMulticast({
          notification: { title: log.title, body: log.body },
          tokens,
        })

        if (response.failureCount > 0) {
          const errorMsg = response.responses
            .filter((r: any) => !r.success)
            .map((r: any) => r.error?.message)
            .join(', ')
          await this.handleFailure(log, errorMsg)
        } else {
          await prisma.notificationLog.update({
            where: { id: log.id },
            data: { status: 'success' },
          })
        }
      } else {
        // Simulated success when Firebase is not configured (development mode)
        await prisma.notificationLog.update({
          where: { id: log.id },
          data: { status: 'success' },
        })
      }
    } catch (error: any) {
      await this.handleFailure(log, error.message ?? 'Push provider error')
    }
  }

  private async handleFailure(
    log: NotificationLog,
    error: string,
  ): Promise<void> {
    const nextAttemptCount = log.attemptCount + 1

    if (nextAttemptCount >= log.maxAttempts) {
      // Dead-letter: exhausted all retries
      await prisma.notificationLog.update({
        where: { id: log.id },
        data: { status: 'dead-letter', error },
      })
    } else {
      // Exponential backoff: 1min, 5min, 25min…
      const backoffMinutes = Math.pow(5, nextAttemptCount - 1)
      const nextAttemptAt = new Date(Date.now() + backoffMinutes * 60_000)

      await prisma.notificationLog.update({
        where: { id: log.id },
        data: { error, nextAttemptAt },
      })
    }
  }
}
