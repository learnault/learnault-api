import { createHash } from 'node:crypto'
import type { Request, Response } from 'express'
import type { WalletSelfCustodyExportService } from '../services/wallet-self-custody-export.service'
import { WalletExportError } from '../types/wallet-self-custody-export.types'

export class WalletSelfCustodyExportController {
  constructor(private readonly service: WalletSelfCustodyExportService) {}

  authorize = async (req: Request, res: Response): Promise<void> => {
    const password = req.body?.password
    const acknowledgement = req.body?.acknowledgement
    if (typeof password !== 'string' || password.length === 0) {
      res.status(400).json({ error: { code: 'PASSWORD_REQUIRED' } })

      return
    }

    try {
      const result = await this.service.authorize({
        userId: req.user!.id,
        sessionId: sessionFingerprint(req),
        password,
        acknowledgement: acknowledgement === true,
      })
      setNoStoreHeaders(res)
      res.status(201).json({
        authorizationToken: result.authorizationToken,
        expiresAt: result.expiresAt.toISOString(),
      })
    } catch (error) {
      this.respondWithError(res, error)
    }
  }

  exportOnce = async (req: Request, res: Response): Promise<void> => {
    const authorizationToken = req.header('x-wallet-export-authorization')
    if (!authorizationToken) {
      res.status(401).json({ error: { code: 'AUTHORIZATION_INVALID' } })

      return
    }

    try {
      const secret = await this.service.exportOnce({
        userId: req.user!.id,
        sessionId: sessionFingerprint(req),
        authorizationToken,
      })
      setNoStoreHeaders(res)
      res.setHeader('Content-Type', 'application/octet-stream')
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="stellar-secret.txt"',
      )
      secret.use((value) => res.status(200).send(value))
    } catch (error) {
      this.respondWithError(res, error)
    }
  }

  private respondWithError(res: Response, error: unknown): void {
    if (!(error instanceof WalletExportError)) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR' } })

      return
    }

    const statusByCode: Record<string, number> = {
      ACKNOWLEDGEMENT_REQUIRED: 400,
      STEP_UP_FAILED: 401,
      WALLET_NOT_ELIGIBLE: 409,
      AUTHORIZATION_INVALID: 401,
      KMS_SECRET_UNAVAILABLE: 503,
      CUSTODY_TRANSITION_FAILED: 409,
      KMS_DELETE_FAILED: 503,
    }
    setNoStoreHeaders(res)
    res.status(statusByCode[error.code] ?? 500).json({
      error: { code: error.code },
    })
  }
}

function sessionFingerprint(req: Request): string {
  return createHash('sha256')
    .update(req.header('authorization') ?? '', 'utf8')
    .digest('hex')
}

function setNoStoreHeaders(res: Response): void {
  res.setHeader('Cache-Control', 'no-store, max-age=0')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Surrogate-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
}
