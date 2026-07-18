import clamd from 'clamdjs'
import logger from '../utils/logger'

export interface ScanResult {
  isInfected: boolean
  virusName: string | null
  error: string | null
}

export interface AVScanner {
  scan(buffer: Buffer): Promise<ScanResult>
}

/**
 * ClamAV-backed scanner. Connects to a running `clamd` daemon over TCP and
 * streams the supplied buffer using the INSTREAM protocol. When the daemon
 * is unreachable, the scan is reported as a connection error (the caller
 * decides whether to fail the upload or fail-open).
 */
export class ClamAVScanner implements AVScanner {
  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs: number = 5000,
    private readonly chunkSize: number = 64 * 1024,
  ) {}

  async scan(buffer: Buffer): Promise<ScanResult> {
    const scanner = clamd.createScanner(this.host, this.port)
    try {
      const reply = await scanner.scanBuffer(buffer, this.timeoutMs, this.chunkSize)
      if (typeof reply !== 'string') {

        return { isInfected: false, virusName: null, error: null }
      }
      const trimmed = reply.trim()
      if (trimmed.endsWith('OK')) {

        return { isInfected: false, virusName: null, error: null }
      }
      const match = /^stream:\s+(.+?)\s+FOUND$/.exec(trimmed)
      const virusName = match ? match[1] : 'unknown'

      return { isInfected: true, virusName, error: null }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Scanner error'
      logger.error(`[ClamAVScanner] scan failed: ${message}`)

      return { isInfected: false, virusName: null, error: message }
    }
  }
}

/**
 * Passthrough scanner used in development and tests when ClamAV is not
 * configured. Always reports files as clean so the processing pipeline can
 * run end-to-end without an external daemon.
 */
export class NoopScanner implements AVScanner {
  async scan(_buffer: Buffer): Promise<ScanResult> {

    return { isInfected: false, virusName: null, error: null }
  }
}

export function createAVScanner(): AVScanner {
  const host = process.env.CLAMAV_HOST
  if (!host) {
    return new NoopScanner()
  }
  const port = parseInt(process.env.CLAMAV_PORT || '3310', 10)

  return new ClamAVScanner(host, port)
}
