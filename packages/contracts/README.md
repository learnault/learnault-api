# Learnault Contracts

Soroban smart contracts for credential issuance and verification on the Stellar network.

## Overview

The Learnault contracts handle:

- **Credential Issuance**: Minting verifiable credentials when users complete modules
- **Credential Verification**: Allowing third parties to verify credentials
- **Reward Distribution**: Automating reward payouts (future)
- **Talent Pool Management**: B2B talent discovery (future)

## Contract Architecture

```
┌─────────────────────────────────────┐
│        Credential Contract          │
├─────────────────────────────────────┤
│ • issue_credential()                │
│ • verify_credential()               │
│ • revoke_credential()               │
│ • get_user_credentials()            │
└─────────────────────────────────────┘
```

## Prerequisites

- Rust 1.70+
- Soroban CLI
- Stellar account for deployment

## Installation

```bash
# Install Soroban CLI
cargo install --locked soroban-cli

# Build contracts
cd packages/contracts
make build
```

## Contract Interface

### Credential Contract

```rust
// Issue a new credential
fn issue_credential(
    env: Env,
    user: Address,
    module_id: Symbol,
    completion_date: u64,
    score: u32
) -> Result<Symbol, Error>

// Verify a credential
fn verify_credential(
    env: Env,
    credential_id: Symbol
) -> Result<CredentialData, Error>

// Revoke a credential (admin only)
fn revoke_credential(
    env: Env,
    credential_id: Symbol,
    reason: String
) -> Result<(), Error>

// Get all credentials for a user
fn get_user_credentials(
    env: Env,
    user: Address
) -> Result<Vec<CredentialData>, Error>
```

### Data Structures

```rust
pub struct CredentialData {
    pub id: Symbol,
    pub user: Address,
    pub module_id: Symbol,
    pub completion_date: u64,
    pub score: u32,
    pub issuer: Address,
    pub is_valid: bool,
    pub metadata: Option<String>,
}
```

## Testing

```bash
# Run unit tests
cargo test

# Run integration tests
make test-integration

# Test with specific contract
cargo test --package credential -- --nocapture
```

## Deployment

```bash
# Deploy to testnet
make deploy-testnet

# Deploy to mainnet
make deploy-mainnet

# Example deployment
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/credential.wasm \
  --source <YOUR_SECRET_KEY> \
  --network testnet
```

## Contract Interaction

```bash
# Issue credential
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <YOUR_SECRET_KEY> \
  --network testnet \
  -- \
  issue_credential \
  --user GABC... \
  --module_id financial_literacy_101 \
  --completion_date 1705363200 \
  --score 100

# Verify credential
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- \
  verify_credential \
  --credential_id cred_123
```

## Security Considerations

- Only authorized issuers (Learnault) can mint credentials
- Credentials are immutable once issued (except revocation)
- Revocation is permanent and recorded on-chain
- All functions include proper access controls

## Integration with API

The API interacts with these contracts via the `soroban-sdk`:

```typescript
import { SorobanRpc, Address, nativeToScVal } from 'soroban-sdk';

// Issue credential
const result = await contract.call('issue_credential', [
  new Address(userStellarAddress),
  nativeToScVal(moduleId, { type: 'symbol' }),
  nativeToScVal(Math.floor(Date.now() / 1000), { type: 'u64' }),
  nativeToScVal(score, { type: 'u32' }),
]);
```

## Development Roadmap

### Phase 1 (Current)

- Basic credential issuance and verification
- Simple data structures
- Testnet deployment

### Phase 2 (Q3 2024)

- Reward distribution automation
- Batch credential issuance
- Enhanced metadata support

### Phase 3 (Q4 2024)

- ZK-proof integration for privacy
- Cross-contract communication
- Talent pool management

## Contributing

See the main [Contributing Guide](../../docs/CONTRIBUTING.md) for details.

## License

MIT
