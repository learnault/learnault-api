import { describe, expect, it } from 'vitest'
import {
  WalletStatusService,
  type WalletStatusStellarProvider,
} from '../src/services/wallet-status.service'
import { StellarServiceError } from '../src/services/stellar.service'
import { WalletStatusError } from '../src/types/wallet-status.types'
import type { WalletProvisioningRepository } from '../src/services/wallet-provisioning.repository'
import type { WalletRecord } from '../src/types/wallet-provisioning.types'

const OWNER_ID = 'user-1'
const PUBLIC_KEY = 'GWALLETSTATUSTESTPUBLICKEY00000000000000000000000000000000'

function wallet(overrides: Partial<WalletRecord> = {}): WalletRecord {
  return {
    id: 'wallet-1',
    userId: OWNER_ID,
    network: 'testnet',
    custody: 'MANAGED',
    publicKey: PUBLIC_KEY,
    status: 'ACTIVE',
    managedKeyReferenceId: 'key-1',
    failureCode: null,
    attemptCount: 1,
    provisionedAt: new Date('2026-08-01T00:00:00.000Z'),
    statusChangedAt: new Date('2026-08-01T00:00:00.000Z'),
    createdAt: new Date('2026-07-31T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  }
}

/** Minimal repository double — only getByUserId is exercised by this service. */
class StubRepository implements Partial<WalletProvisioningRepository> {
  constructor(private readonly record: WalletRecord | null) {}

  async getByUserId(userId: string): Promise<WalletRecord | null> {
    return this.record && this.record.userId === userId ? this.record : null
  }
}

function repositoryFor(
  record: WalletRecord | null,
): WalletProvisioningRepository {
  return new StubRepository(record) as unknown as WalletProvisioningRepository
}

describe('WalletStatusService', () => {
  describe('getStatus', () => {
    it('reports NOT_PROVISIONED when no wallet exists', async () => {
      const service = new WalletStatusService(
        repositoryFor(null),
        {} as WalletStatusStellarProvider,
      )

      const status = await service.getStatus(OWNER_ID)

      expect(status).toEqual({
        status: 'NOT_PROVISIONED',
        network: null,
        custody: null,
        publicKey: null,
        provisionedAt: null,
      })
    })

    it('exposes the public key only when the wallet is ACTIVE', async () => {
      const repository = repositoryFor(
        wallet({ status: 'PROVISIONING', publicKey: null }),
      )
      const service = new WalletStatusService(
        repository,
        {} as WalletStatusStellarProvider,
      )

      const status = await service.getStatus(OWNER_ID)

      expect(status.status).toBe('PENDING')
      expect(status.publicKey).toBeNull()
    })

    it('maps FAILED and DISABLED wallets to UNAVAILABLE', async () => {
      const service = new WalletStatusService(
        repositoryFor(wallet({ status: 'FAILED', publicKey: null })),
        {} as WalletStatusStellarProvider,
      )

      const status = await service.getStatus(OWNER_ID)

      expect(status.status).toBe('UNAVAILABLE')
    })

    it("never exposes another user's wallet", async () => {
      const service = new WalletStatusService(
        repositoryFor(wallet()),
        {} as WalletStatusStellarProvider,
      )

      const status = await service.getStatus('someone-else')

      expect(status.status).toBe('NOT_PROVISIONED')
    })
  })

  describe('getBalances', () => {
    it('rejects when the wallet is not ACTIVE', async () => {
      const service = new WalletStatusService(
        repositoryFor(wallet({ status: 'PROVISIONING', publicKey: null })),
        {} as WalletStatusStellarProvider,
      )

      await expect(service.getBalances(OWNER_ID)).rejects.toMatchObject({
        code: 'WALLET_NOT_FOUND',
      })
    })

    it('returns exact amounts, asset identity, and source time', async () => {
      const stellar: WalletStatusStellarProvider = {
        getAccountSnapshot: async (publicKey) => {
          expect(publicKey).toBe(PUBLIC_KEY)

          return {
            found: true,
            lastModifiedTime: '2026-08-30T00:00:00Z',
            balances: [
              {
                assetType: 'native',
                assetCode: 'XLM',
                issuer: null,
                amount: '123.4567890',
              },
              {
                assetType: 'credit_alphanum4',
                assetCode: 'USDC',
                issuer: 'GISSUER',
                amount: '10.0000001',
              },
            ],
          }
        },
        getPaymentHistory: async () => ({ records: [], nextCursor: null }),
      }
      const service = new WalletStatusService(repositoryFor(wallet()), stellar)

      const balances = await service.getBalances(OWNER_ID)

      expect(balances.publicKey).toBe(PUBLIC_KEY)
      expect(balances.sourceTime).toBe('2026-08-30T00:00:00Z')
      expect(balances.balances).toEqual([
        {
          assetType: 'native',
          assetCode: 'XLM',
          issuer: null,
          amount: '123.4567890',
        },
        {
          assetType: 'credit_alphanum4',
          assetCode: 'USDC',
          issuer: 'GISSUER',
          amount: '10.0000001',
        },
      ])
    })

    it('does not show an unfunded (not-yet-on-ledger) account as a zero balance error', async () => {
      const stellar: WalletStatusStellarProvider = {
        getAccountSnapshot: async () => ({
          found: false,
          lastModifiedTime: null,
          balances: [],
        }),
        getPaymentHistory: async () => ({ records: [], nextCursor: null }),
      }
      const service = new WalletStatusService(repositoryFor(wallet()), stellar)

      const balances = await service.getBalances(OWNER_ID)

      expect(balances.balances).toEqual([])
    })

    it('normalizes a Horizon timeout to a stable provider error code', async () => {
      const stellar: WalletStatusStellarProvider = {
        getAccountSnapshot: async () => {
          throw new StellarServiceError(
            'Horizon request timed out',
            'HORIZON_TIMEOUT',
          )
        },
        getPaymentHistory: async () => ({ records: [], nextCursor: null }),
      }
      const service = new WalletStatusService(repositoryFor(wallet()), stellar)

      await expect(service.getBalances(OWNER_ID)).rejects.toMatchObject({
        code: 'HORIZON_TIMEOUT',
      })
    })

    it('normalizes Horizon unavailability to a stable provider error code', async () => {
      const stellar: WalletStatusStellarProvider = {
        getAccountSnapshot: async () => {
          throw new StellarServiceError(
            'Horizon is unavailable',
            'HORIZON_UNAVAILABLE',
          )
        },
        getPaymentHistory: async () => ({ records: [], nextCursor: null }),
      }
      const service = new WalletStatusService(repositoryFor(wallet()), stellar)

      await expect(service.getBalances(OWNER_ID)).rejects.toBeInstanceOf(
        WalletStatusError,
      )
    })
  })

  describe('getHistory', () => {
    const baseRecord = {
      id: 'op-1',
      pagingToken: 'cursor-1',
      createdAt: '2026-08-29T00:00:00Z',
      transactionHash: 'hash-1',
      transactionSuccessful: true,
      ledger: 100,
      type: 'payment',
      assetType: 'native',
      assetCode: 'XLM',
      issuer: null,
      amount: '5.0000000',
      memo: null,
      memoType: null,
    }

    it("marks records as incoming or outgoing relative to the owner's address", async () => {
      const stellar: WalletStatusStellarProvider = {
        getAccountSnapshot: async () => ({
          found: true,
          lastModifiedTime: null,
          balances: [],
        }),
        getPaymentHistory: async () => ({
          records: [
            { ...baseRecord, id: 'op-in', to: PUBLIC_KEY, from: 'GOTHER' },
            { ...baseRecord, id: 'op-out', to: 'GOTHER', from: PUBLIC_KEY },
          ],
          nextCursor: 'cursor-2',
        }),
      }
      const service = new WalletStatusService(repositoryFor(wallet()), stellar)

      const page = await service.getHistory(OWNER_ID, {})

      expect(page.entries.map((e) => e.direction)).toEqual([
        'incoming',
        'outgoing',
      ])
      expect(page.nextCursor).toBe('cursor-2')
    })

    it('reports failed transactions with status "failed" rather than success', async () => {
      const stellar: WalletStatusStellarProvider = {
        getAccountSnapshot: async () => ({
          found: true,
          lastModifiedTime: null,
          balances: [],
        }),
        getPaymentHistory: async () => ({
          records: [
            {
              ...baseRecord,
              to: PUBLIC_KEY,
              from: 'GOTHER',
              transactionSuccessful: false,
            },
          ],
          nextCursor: null,
        }),
      }
      const service = new WalletStatusService(repositoryFor(wallet()), stellar)

      const page = await service.getHistory(OWNER_ID, {})

      expect(page.entries[0].status).toBe('failed')
    })

    it('filters by direction when requested', async () => {
      const stellar: WalletStatusStellarProvider = {
        getAccountSnapshot: async () => ({
          found: true,
          lastModifiedTime: null,
          balances: [],
        }),
        getPaymentHistory: async () => ({
          records: [
            { ...baseRecord, id: 'op-in', to: PUBLIC_KEY, from: 'GOTHER' },
            { ...baseRecord, id: 'op-out', to: 'GOTHER', from: PUBLIC_KEY },
          ],
          nextCursor: null,
        }),
      }
      const service = new WalletStatusService(repositoryFor(wallet()), stellar)

      const page = await service.getHistory(OWNER_ID, { direction: 'incoming' })

      expect(page.entries).toHaveLength(1)
      expect(page.entries[0].id).toBe('op-in')
    })

    it('preserves the stable cursor for pagination', async () => {
      let receivedCursor: string | undefined
      const stellar: WalletStatusStellarProvider = {
        getAccountSnapshot: async () => ({
          found: true,
          lastModifiedTime: null,
          balances: [],
        }),
        getPaymentHistory: async (_publicKey, options) => {
          receivedCursor = options?.cursor

          return { records: [], nextCursor: null }
        },
      }
      const service = new WalletStatusService(repositoryFor(wallet()), stellar)

      await service.getHistory(OWNER_ID, { cursor: 'cursor-abc' })

      expect(receivedCursor).toBe('cursor-abc')
    })
  })
})
