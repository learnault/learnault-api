# Step-up self-custody export

This document defines the security contract implemented by the draft wallet
export domain. The routes intentionally remain unmounted until #130 supplies a
durable refresh-session identifier and #135 supplies production wallet/KMS
adapters. Enabling the routes before those dependencies land is unsupported.

## Semantics and eligibility

- Only an active, managed wallet with a public key and opaque KMS reference is
  eligible.
- The learner must explicitly accept acknowledgement version
  `self-custody-v1` and re-enter their password.
- A successful step-up creates a random 256-bit authorization. Persistence
  stores only its SHA-256 digest and binds it to the learner, wallet, and
  authenticated session.
- Authorizations expire after five minutes and may be claimed exactly once.
- Completion changes custody to learner-controlled/migrated and removes the
  managed secret from KMS before the response is delivered.

## Delivery boundary

The export endpoint accepts the one-time authorization in the
`X-Wallet-Export-Authorization` header. The secret is delivered as an
`application/octet-stream` attachment. All authorization and export responses
set `Cache-Control: no-store`, `Pragma: no-cache`, `Surrogate-Control: no-store`,
and `X-Content-Type-Options: nosniff`.

Request/response bodies, authorization headers, and the returned
`SensitiveValue` must be excluded from application logs, traces, analytics,
error serialization, support tickets, and test fixtures. Audit events contain
only the wallet id, public key, policy version, expiry, and outcome reason.

## Failure and support policy

- Expired, replayed, cross-user, and cross-session attempts return the same
  generic `AUTHORIZATION_INVALID` response.
- A KMS read failure releases the claim so a still-valid authorization can be
  retried.
- A custody-transition failure does not delete or deliver the managed secret.
- If KMS deletion fails after the database transition, the secret is not
  delivered. Operations must quarantine the wallet and complete deletion or
  restore managed custody according to the approved custody runbook.
- Support must never request a real Stellar secret or ask a learner to attach
  it to an issue, log, email, or chat.

## Required production review

Before mounting the routes, maintainers must approve the custody policy,
implement the repository transaction with compare-and-set claim/consume
semantics, bind the authorization to the durable session from #130, provide a
production KMS read/delete adapter from #135, and run replay, concurrency,
cross-user, expiry, KMS-failure, and secret-leak tests.
