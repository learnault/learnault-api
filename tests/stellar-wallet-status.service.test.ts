/**
 * stellar-wallet-status.service.test.ts
 *
 * Unit tests for the wallet-status additions to StellarService:
 * getAccountSnapshot() and getPaymentHistory(). No real network calls.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetAccount, mockPaymentsCall } = vi.hoisted(() => ({
  mockGetAccount: vi.fn(),
  mockPaymentsCall: vi.fn(),
}))

vi.mock('@stellar/stellar-sdk', () => {
  function FakeHorizonServer(this: any) {
    this.loadAccount = mockGetAccount
    this.payments = () => {
      const builder = {
        forAccount: () => builder,
        order: () => builder,
        limit: () => builder,
        join: () => builder,
        cursor: () => builder,
        call: mockPaymentsCall,
      }

      return builder
    }
  }

  function FakeServer(this: any) {}

  return {
    Keypair: { random: vi.fn(), fromSecret: vi.fn() },
    Networks: {
      TESTNET: 'Test SDF Network ; September 2015',
      PUBLIC: 'Public Global Stellar Network ; September 2015',
    },
    Horizon: { Server: FakeHorizonServer },
    rpc: { Server: FakeServer, Api: {} },
    TransactionBuilder: vi.fn(),
    Asset: { native: vi.fn() },
    Operation: {},
    Memo: {},
    BASE_FEE: '100',
    nativeToScVal: vi.fn(),
    scValToNative: vi.fn(),
    Contract: vi.fn(),
  }
})

import { StellarService } from '../src/services/stellar.service'

describe('StellarService — wallet status additions', () => {
  let service: StellarService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new StellarService('testnet', '')
  })

  describe('getAccountSnapshot()', () => {
    it('returns exact balances plus the Horizon last-modified time', async () => {
      mockGetAccount.mockResolvedValue({
        last_modified_time: '2026-08-30T00:00:00Z',
        balances: [
          { asset_type: 'native', balance: '100.1234567' },
          {
            asset_type: 'credit_alphanum4',
            asset_code: 'USDC',
            asset_issuer: 'GCISSUER...',
            balance: '5.0000001',
            limit: '1000.0000000',
          },
        ],
      })

      const snapshot = await service.getAccountSnapshot('GPUBKEY...')

      expect(snapshot.found).toBe(true)
      expect(snapshot.lastModifiedTime).toBe('2026-08-30T00:00:00Z')
      expect(snapshot.balances).toEqual([
        { assetType: 'native', assetCode: 'XLM', issuer: null, amount: '100.1234567' },
        { assetType: 'credit_alphanum4', assetCode: 'USDC', issuer: 'GCISSUER...', amount: '5.0000001' },
      ])
    })

    it('treats a 404 (unfunded account) as found: false rather than an error', async () => {
      const notFound = Object.assign(new Error('not found'), { response: { status: 404 } })
      mockGetAccount.mockRejectedValue(notFound)

      const snapshot = await service.getAccountSnapshot('GPUBKEY...')

      expect(snapshot).toEqual({ found: false, lastModifiedTime: null, balances: [] })
    })

    it('classifies a timeout as HORIZON_TIMEOUT', async () => {
      mockGetAccount.mockRejectedValue(
        Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' }),
      )

      await expect(service.getAccountSnapshot('GPUBKEY...')).rejects.toMatchObject({
        code: 'HORIZON_TIMEOUT',
      })
    })

    it('classifies other failures as HORIZON_UNAVAILABLE', async () => {
      mockGetAccount.mockRejectedValue(new Error('ECONNREFUSED'))

      await expect(service.getAccountSnapshot('GPUBKEY...')).rejects.toMatchObject({
        code: 'HORIZON_UNAVAILABLE',
      })
    })
  })

  describe('getPaymentHistory()', () => {
    it('maps payment records to normalized history entries with a stable cursor', async () => {
      mockPaymentsCall.mockResolvedValue({
        records: [
          {
            id: 'op-1',
            paging_token: 'tok-1',
            created_at: '2026-08-29T00:00:00Z',
            transaction_hash: 'hash-1',
            transaction_successful: true,
            type: 'payment',
            from: 'GSENDER',
            to: 'GRECEIVER',
            asset_type: 'native',
            amount: '5.0000000',
            transaction: { memo_type: 'text', memo: 'hello', ledger_attr: 42 },
          },
        ],
      })

      const page = await service.getPaymentHistory('GRECEIVER')

      expect(page.nextCursor).toBe('tok-1')
      expect(page.records).toEqual([
        {
          id: 'op-1',
          pagingToken: 'tok-1',
          createdAt: '2026-08-29T00:00:00Z',
          transactionHash: 'hash-1',
          transactionSuccessful: true,
          ledger: 42,
          type: 'payment',
          from: 'GSENDER',
          to: 'GRECEIVER',
          assetType: 'native',
          assetCode: 'XLM',
          issuer: null,
          amount: '5.0000000',
          memo: 'hello',
          memoType: 'text',
        },
      ])
    })

    it('strips control characters from text memos and caps their length', async () => {
      mockPaymentsCall.mockResolvedValue({
        records: [
          {
            id: 'op-1',
            paging_token: 'tok-1',
            created_at: '2026-08-29T00:00:00Z',
            transaction_hash: 'hash-1',
            transaction_successful: true,
            type: 'payment',
            from: 'GSENDER',
            to: 'GRECEIVER',
            asset_type: 'native',
            amount: '1.0000000',
            transaction: { memo_type: 'text', memo: `bad\x00memo${'x'.repeat(300)}` },
          },
        ],
      })

      const page = await service.getPaymentHistory('GRECEIVER')

      expect(page.records[0].memo).not.toMatch(/\x00/)
      expect(page.records[0].memo!.length).toBeLessThanOrEqual(256)
    })

    it('excludes non-payment operation types (e.g. trustline changes)', async () => {
      mockPaymentsCall.mockResolvedValue({
        records: [
          { id: 'op-1', paging_token: 'tok-1', type: 'change_trust', created_at: 'x', transaction_hash: 'h' },
        ],
      })

      const page = await service.getPaymentHistory('GRECEIVER')

      expect(page.records).toEqual([])
    })

    it('returns an empty page for a 404 rather than throwing', async () => {
      mockPaymentsCall.mockRejectedValue(Object.assign(new Error('not found'), { response: { status: 404 } }))

      const page = await service.getPaymentHistory('GRECEIVER')

      expect(page).toEqual({ records: [], nextCursor: null })
    })

    it('classifies provider failures as HORIZON_UNAVAILABLE', async () => {
      mockPaymentsCall.mockRejectedValue(new Error('ECONNRESET'))

      await expect(service.getPaymentHistory('GRECEIVER')).rejects.toMatchObject({
        code: 'HORIZON_UNAVAILABLE',
      })
    })
  })
})
