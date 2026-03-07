/**
 * stellar.service.test.ts
 *
 * Unit tests for StellarService.
 * Compatible with @stellar/stellar-sdk v11 (`rpc` namespace).
 * Uses Vitest — no real network calls.
 *
 * Run: npm test stellar.service.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  StellarService,
  StellarServiceError,
} from "../src/services/stellar.service";

// ---------------------------------------------------------------------------
// Shared mock functions (defined outside so each test can control them)
// ---------------------------------------------------------------------------

const mockGetAccount          = vi.fn();
const mockSendTransaction     = vi.fn();
const mockSimulateTransaction = vi.fn();
const mockGetTransaction      = vi.fn();

// ---------------------------------------------------------------------------
// Mock @stellar/stellar-sdk  (v11 shape)
//
// Key rules for Vitest constructor mocks:
//  • Classes that are called with `new` MUST be declared with `function` or
//    `class` — never arrow functions. Arrow functions are not constructors.
//  • The `rpc` export is a namespace object; `rpc.Server` is a class inside it.
// ---------------------------------------------------------------------------

vi.mock("@stellar/stellar-sdk", () => {
  // ── FakeKeypair ────────────────────────────────────────────────────────
  class FakeKeypair {
    private _pub: string;
    private _sec: string;

    constructor(pub: string, sec: string) {
      this._pub = pub;
      this._sec = sec;
    }
    publicKey() { return this._pub; }
    secret()    { return this._sec; }

    static random() {
      const seg = () =>
        Math.random().toString(36).slice(2).toUpperCase().padEnd(11, "A");
      const pub = ("G" + seg() + seg() + seg() + seg() + seg()).slice(0, 56);
      const sec = ("S" + seg() + seg() + seg() + seg() + seg()).slice(0, 56);
      return new FakeKeypair(pub, sec);
    }

    static fromSecret(secret: string) {
      return new FakeKeypair(("G" + secret.slice(1)).slice(0, 56), secret);
    }
  }

  // ── FakeTransactionBuilder ─────────────────────────────────────────────
  class FakeTransactionBuilder {
    addOperation(_op: unknown) { return this; }
    addMemo(_m: unknown)       { return this; }
    setTimeout(_t: number)     { return this; }
    build() { return { sign: vi.fn() }; }
  }

  // ── FakeServer  (MUST use `function`, not arrow) ───────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function FakeServer(this: any) {
    this.getAccount          = mockGetAccount;
    this.sendTransaction     = mockSendTransaction;
    this.simulateTransaction = mockSimulateTransaction;
    this.getTransaction      = mockGetTransaction;
  }

  // ── FakeContract (MUST use `function`, not arrow) ─────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function FakeContract(this: any) {
    this.call = vi.fn().mockReturnValue("mock_operation");
  }

  // ── GetTransactionStatus enum values ──────────────────────────────────
  const GetTransactionStatus = {
    SUCCESS:   "SUCCESS",
    FAILED:    "FAILED",
    NOT_FOUND: "NOT_FOUND",
  } as const;

  return {
    Keypair: FakeKeypair,

    Networks: {
      TESTNET: "Test SDF Network ; September 2015",
      PUBLIC:  "Public Global Stellar Network ; September 2015",
    },

    // v11 exports the Soroban RPC utilities under the `rpc` key
    rpc: {
      Server: FakeServer,

      // assembleTransaction is a standalone function in the rpc namespace
      assembleTransaction: vi.fn((_tx: unknown) => ({
        build: vi.fn().mockReturnValue({ sign: vi.fn() }),
      })),

      Api: {
        isSimulationError: vi.fn(
          (r: unknown) =>
            Boolean(r && typeof r === "object" && "error" in (r as object))
        ),
        isSimulationSuccess: vi.fn(
          (r: unknown) =>
            Boolean(
              r && typeof r === "object" && !("error" in (r as object))
            )
        ),
        GetTransactionStatus,
      },
    },

    TransactionBuilder: FakeTransactionBuilder,

    Asset: {
      native: vi.fn().mockReturnValue({ code: "XLM", issuer: null }),
    },

    Operation: {
      createAccount: vi.fn().mockReturnValue("create_account_op"),
      payment:       vi.fn().mockReturnValue("payment_op"),
    },

    Memo: {
      text: vi.fn().mockReturnValue("memo_text"),
    },

    BASE_FEE: "100",

    nativeToScVal: vi.fn((v: unknown) => ({ type: "scVal", value: v })),
    scValToNative: vi.fn((v: unknown) => v),

    Contract: FakeContract,
  };
});

// Import after mock registration so vi.mocked() works
import * as StellarSdk from "@stellar/stellar-sdk";

// Typed helper for FakeKeypair static methods
type FakeKeypairStatic = {
  random: () => { publicKey: () => string; secret: () => string };
  fromSecret: (s: string) => { publicKey: () => string; secret: () => string };
};
const FakeKeypair = StellarSdk.Keypair as unknown as FakeKeypairStatic;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("StellarService", () => {
  let service: StellarService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new StellarService("testnet", "CTEST_CONTRACT_ID");
  });

  // ── Wallet generation ─────────────────────────────────────────────────────

  describe("generateWallet()", () => {
    it("returns a public key starting with G", () => {
      expect(service.generateWallet().publicKey).toMatch(/^G/);
    });

    it("returns a secret key starting with S", () => {
      expect(service.generateWallet().secretKey).toMatch(/^S/);
    });

    it("each call returns a unique keypair", () => {
      const a = service.generateWallet();
      const b = service.generateWallet();
      expect(a.publicKey).not.toBe(b.publicKey);
      expect(a.secretKey).not.toBe(b.secretKey);
    });

    it("returns an object with both required fields", () => {
      const wallet = service.generateWallet();
      expect(wallet).toHaveProperty("publicKey");
      expect(wallet).toHaveProperty("secretKey");
    });
  });

  // ── Friendbot ─────────────────────────────────────────────────────────────

  describe("fundTestnetAccount()", () => {
    it("throws StellarServiceError on mainnet", async () => {
      const mainnetService = new StellarService("mainnet");
      await expect(
        mainnetService.fundTestnetAccount("GABC...")
      ).rejects.toThrow(StellarServiceError);
    });

    it("error code is INVALID_NETWORK on mainnet", async () => {
      const mainnetService = new StellarService("mainnet");
      await expect(
        mainnetService.fundTestnetAccount("GABC...")
      ).rejects.toMatchObject({ code: "INVALID_NETWORK" });
    });

    it("calls friendbot URL containing the encoded public key", async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true });
      const { publicKey } = service.generateWallet();
      await service.fundTestnetAccount(publicKey);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(encodeURIComponent(publicKey))
      );
    });

    it("throws FRIENDBOT_ERROR when friendbot returns non-ok response", async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400 });
      await expect(
        service.fundTestnetAccount("GPUBKEY...")
      ).rejects.toMatchObject({ code: "FRIENDBOT_ERROR" });
    });
  });

  // ── Balance checks ────────────────────────────────────────────────────────

  describe("getBalances()", () => {
    it("maps native asset to XLM", async () => {
      mockGetAccount.mockResolvedValue({
        balances: [{ asset_type: "native", balance: "100.0000000" }],
      });
      const balances = await service.getBalances("GPUBKEY...");
      expect(balances).toHaveLength(1);
      expect(balances[0]).toEqual({ asset: "XLM", balance: "100.0000000" });
    });

    it("does not add a limit field for XLM", async () => {
      mockGetAccount.mockResolvedValue({
        balances: [{ asset_type: "native", balance: "100.0000000" }],
      });
      const balances = await service.getBalances("GPUBKEY...");
      expect(balances[0].limit).toBeUndefined();
    });

    it("formats trustline assets as CODE:ISSUER", async () => {
      mockGetAccount.mockResolvedValue({
        balances: [
          { asset_type: "native", balance: "50.0000000" },
          {
            asset_type:   "credit_alphanum4",
            asset_code:   "USDC",
            asset_issuer: "GCISSUER...",
            balance:      "200.0000000",
            limit:        "1000.0000000",
          },
        ],
      });
      const balances = await service.getBalances("GPUBKEY...");
      expect(balances[1].asset).toBe("USDC:GCISSUER...");
      expect(balances[1].limit).toBe("1000.0000000");
    });

    it("throws BALANCE_FETCH_ERROR on network failure", async () => {
      mockGetAccount.mockRejectedValue(new Error("timeout"));
      await expect(service.getBalances("GPUBKEY...")).rejects.toMatchObject({
        code: "BALANCE_FETCH_ERROR",
      });
    });
  });

  describe("getNativeBalance()", () => {
    it("returns the XLM balance string", async () => {
      mockGetAccount.mockResolvedValue({
        balances: [{ asset_type: "native", balance: "42.0000000" }],
      });
      expect(await service.getNativeBalance("GPUBKEY...")).toBe("42.0000000");
    });

    it("returns '0' when no native balance exists", async () => {
      mockGetAccount.mockResolvedValue({ balances: [] });
      expect(await service.getNativeBalance("GPUBKEY...")).toBe("0");
    });
  });

  // ── Payments ──────────────────────────────────────────────────────────────

  describe("sendPaymentWithOptions()", () => {
    const sourceKeypair = FakeKeypair.random();

    beforeEach(() => {
      mockGetAccount.mockImplementation((pk: string) =>
        Promise.resolve({
          id: pk,
          sequence: "1234",
          balances: [{ asset_type: "native", balance: "1000.0000000" }],
          incrementSequenceNumber: vi.fn(),
        })
      );
      mockSendTransaction.mockResolvedValue({ status: "PENDING", hash: "TXHASH123" });
      mockGetTransaction.mockResolvedValue({ status: "SUCCESS", ledger: 999 });
    });

    it("returns hash, successful=true, and ledger on success", async () => {
      const result = await service.sendPaymentWithOptions({
        sourceSecret: sourceKeypair.secret(),
        destinationPublicKey: FakeKeypair.random().publicKey(),
        amount: "10",
      });
      expect(result.hash).toBe("TXHASH123");
      expect(result.successful).toBe(true);
      expect(result.ledger).toBe(999);
    });

    it("calls Memo.text when memo is provided", async () => {
      await service.sendPaymentWithOptions({
        sourceSecret: sourceKeypair.secret(),
        destinationPublicKey: FakeKeypair.random().publicKey(),
        amount: "5",
        memo: "test payment",
      });
      expect(StellarSdk.Memo.text).toHaveBeenCalledWith("test payment");
    });

    it("throws PAYMENT_ERROR when transaction status is ERROR", async () => {
      mockSendTransaction.mockResolvedValue({
        status: "ERROR",
        errorResult: { msg: "bad sequence" },
        hash: "BADSEND",
      });
      await expect(
        service.sendPaymentWithOptions({
          sourceSecret: sourceKeypair.secret(),
          destinationPublicKey: FakeKeypair.random().publicKey(),
          amount: "10",
        })
      ).rejects.toMatchObject({ code: "PAYMENT_ERROR" });
    });
  });

  // ── Credential issuance ───────────────────────────────────────────────────

  describe("issueCredential()", () => {
    const issuerKeypair = FakeKeypair.random();

    beforeEach(() => {
      mockGetAccount.mockResolvedValue({
        id: issuerKeypair.publicKey(),
        sequence: "5678",
        balances: [{ asset_type: "native", balance: "1000.0000000" }],
        incrementSequenceNumber: vi.fn(),
      });
      mockSimulateTransaction.mockResolvedValue({
        result: { retval: { type: "scVal", value: "CRED_001" } },
        transactionData: "mock_footprint",
        minResourceFee: "100",
      });
      mockSendTransaction.mockResolvedValue({ status: "PENDING", hash: "CREDHASH456" });
      mockGetTransaction.mockResolvedValue({
        status: "SUCCESS",
        ledger: 1001,
        returnValue: { type: "scVal", value: "CRED_001" },
      });
    });

    it("returns contractId, transactionHash, and credentialId", async () => {
      const result = await service.issueCredential(issuerKeypair.secret(), {
        recipientPublicKey: FakeKeypair.random().publicKey(),
        credentialType: "DEGREE",
        data: { institution: "MIT", degree: "BSc" },
        expiresAt: 9999999999,
      });
      expect(result.transactionHash).toBe("CREDHASH456");
      expect(result.contractId).toBe("CTEST_CONTRACT_ID");
      expect(result.credentialId).toBeDefined();
    });

    it("throws CONTRACT_NOT_CONFIGURED when no contract ID", async () => {
      const noContract = new StellarService("testnet", "");
      await expect(
        noContract.issueCredential(issuerKeypair.secret(), {
          recipientPublicKey: "GDEST...",
          credentialType: "ID",
          data: {},
        })
      ).rejects.toMatchObject({ code: "CONTRACT_NOT_CONFIGURED" });
    });

    it("throws CREDENTIAL_ISSUANCE_ERROR when simulation fails", async () => {
      mockSimulateTransaction.mockResolvedValue({ error: "contract panic" });
      await expect(
        service.issueCredential(issuerKeypair.secret(), {
          recipientPublicKey: FakeKeypair.random().publicKey(),
          credentialType: "ID",
          data: {},
        })
      ).rejects.toMatchObject({ code: "CREDENTIAL_ISSUANCE_ERROR" });
    });
  });

  // ── Credential verification ───────────────────────────────────────────────

  describe("verifyCredential()", () => {
    beforeEach(() => {
      mockGetAccount.mockResolvedValue({
        id: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
        sequence: "0",
        balances: [],
        incrementSequenceNumber: vi.fn(),
      });
    });

    it("returns isValid=true with parsed fields on success", async () => {
      const mockCredData = {
        issuer:          "GISSUER...",
        recipient:       "GRECIPIENT...",
        credential_type: "DEGREE",
        issued_at:       1700000000,
        expires_at:      9999999999,
        data:            JSON.stringify({ degree: "BSc" }),
      };
      mockSimulateTransaction.mockResolvedValue({
        result: { retval: mockCredData },
      });
      vi.mocked(StellarSdk.scValToNative).mockReturnValue(mockCredData);

      const result = await service.verifyCredential("CRED_001");
      expect(result.isValid).toBe(true);
      expect(result.credentialType).toBe("DEGREE");
      expect(result.issuer).toBe("GISSUER...");
    });

    it("returns isValid=false when simulation result is null", async () => {
      mockSimulateTransaction.mockResolvedValue({ result: { retval: null } });
      vi.mocked(StellarSdk.scValToNative).mockReturnValue(null);

      expect((await service.verifyCredential("MISSING")).isValid).toBe(false);
    });

    it("throws CREDENTIAL_VERIFICATION_ERROR on simulation failure", async () => {
      mockSimulateTransaction.mockResolvedValue({ error: "contract not found" });
      await expect(service.verifyCredential("BAD_ID")).rejects.toMatchObject({
        code: "CREDENTIAL_VERIFICATION_ERROR",
      });
    });
  });

  // ── Transaction verification ──────────────────────────────────────────────

  describe("verifyTransaction()", () => {
    it("returns true for SUCCESS status", async () => {
      mockGetTransaction.mockResolvedValue({ status: "SUCCESS", ledger: 123 });
      expect(await service.verifyTransaction("TX_HASH")).toBe(true);
    });

    it("returns false for FAILED status", async () => {
      mockGetTransaction.mockResolvedValue({ status: "FAILED", ledger: 123 });
      expect(await service.verifyTransaction("TX_HASH")).toBe(false);
    });

    it("returns false for NOT_FOUND status", async () => {
      mockGetTransaction.mockResolvedValue({ status: "NOT_FOUND" });
      expect(await service.verifyTransaction("TX_HASH")).toBe(false);
    });

    it("throws TRANSACTION_VERIFY_ERROR on network error", async () => {
      mockGetTransaction.mockRejectedValue(new Error("Network error"));
      await expect(service.verifyTransaction("TX_HASH")).rejects.toMatchObject({
        code: "TRANSACTION_VERIFY_ERROR",
      });
    });
  });

  // ── StellarServiceError ───────────────────────────────────────────────────

  describe("StellarServiceError", () => {
    it("has name StellarServiceError", () => {
      expect(new StellarServiceError("msg", "CODE").name).toBe("StellarServiceError");
    });

    it("exposes code and message", () => {
      const err = new StellarServiceError("test error", "TEST_CODE");
      expect(err.message).toBe("test error");
      expect(err.code).toBe("TEST_CODE");
    });

    it("stores the original cause", () => {
      const cause = new Error("original");
      expect(new StellarServiceError("wrapped", "CODE", cause).cause).toBe(cause);
    });

    it("is an instance of Error", () => {
      expect(new StellarServiceError("test", "CODE")).toBeInstanceOf(Error);
    });
  });
});