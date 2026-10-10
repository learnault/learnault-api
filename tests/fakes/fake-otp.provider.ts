import crypto from 'crypto'

interface OtpChallengeRecord {
  id: string
  phone: string
  purpose: OtpPurpose
  userId: string
  codeHash: string
  attempts: number
  maxAttempts: number
  expiresAt: Date
  createdAt: Date
  verifiedAt: Date | null
  metadata: Record<string, unknown>
}

export class FakeOtpProvider {
  readonly challenges = new Map<string, OtpChallengeRecord>()
  readonly sentCodes = new Map<string, string>()
  shouldFailOnRequest = false
  shouldFailOnVerify = false
  requestFailureError = 'OTP request failed'
  verifyFailureError = 'OTP verify failed'

  generateCode(): string {
    return String(Math.floor(100000 + Math.random() * 900000))
  }

hashCode(code: string): string {
    return crypto.createHash('sha256').update(code).digest('hex')
  }

  async requestChallenge(
    phone: string,
    purpose: OtpPurpose,
    userId: string,
    metadata: { ip?: string; deviceId?: string } = {},
  ): Promise<void> {
    if (this.shouldFailOnRequest) {
      throw new Error(this.requestFailureError)
    }

    const code = this.generateCode()
    const codeHash = this.hashCode(code)

    const challenge: OtpChallengeRecord = {
      id: `otp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      phone,
      purpose,
      userId,
      codeHash,
      attempts: 0,
      maxAttempts: 5,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      createdAt: new Date(),
      verifiedAt: null,
      metadata,
    }

    this.challenges.set(`${purpose}:${phone}:${userId}`, challenge)
    this.sentCodes.set(`${purpose}:${phone}:${userId}`, code)
  }

  async verifyChallenge(
    phone: string,
    code: string,
    purpose: OtpPurpose,
    userId?: string,
  ): Promise<{ ok: boolean; reason?: string; userId?: string }> {
    if (this.shouldFailOnVerify) {
      throw new Error(this.verifyFailureError)
    }

    const key = `${purpose}:${phone}:${userId ?? ''}`
    const challenge = this.challenges.get(key)

    if (!challenge) {
      return { ok: false, reason: 'not_found' }
    }

    if (challenge.verifiedAt) {
      return { ok: false, reason: 'already_used' }
    }

    if (new Date() > challenge.expiresAt) {
      return { ok: false, reason: 'expired' }
    }

    if (challenge.attempts >= challenge.maxAttempts) {
      return { ok: false, reason: 'locked' }
    }

    const codeHash = this.hashCode(code)
    challenge.attempts += 1

    if (codeHash !== challenge.codeHash) {
      return { ok: false, reason: 'mismatch' }
    }

    challenge.verifiedAt = new Date()
    
return { ok: true, userId: challenge.userId }
  }

  getSentCode(purpose: OtpPurpose, phone: string, userId?: string): string | undefined {
    return this.sentCodes.get(`${purpose}:${phone}:${userId ?? ''}`)
  }

  clear(): void {
    this.challenges.clear()
    this.sentCodes.clear()
    this.shouldFailOnRequest = false
    this.shouldFailOnVerify = false
  }
}

export const fakeOtpProvider = new FakeOtpProvider()