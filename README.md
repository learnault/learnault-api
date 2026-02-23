# Learnault (APP)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)
[![Stellar](https://img.shields.io/badge/Stellar-Built%20on%20SDF-black)](https://stellar.org)

**Learnault** is a decentralized learn-to-earn platform built on the Stellar blockchain that democratizes access to financial literacy and digital skills while creating verifiable, portable credentials for learners worldwide.

## Vision

A world where anyone, anywhere can access quality education, earn while learning, and prove their skills with verifiable blockchain credentials — all for free.

## Features

- **Learn & Earn**: Complete educational modules and earn Stellar-based token rewards
- **Verifiable Credentials**: All achievements stored immutably on Stellar
- **Mobile-First**: Optimized for low-bandwidth environments in emerging markets
- **Privacy-Preserving**: Future ZK-proof integration for selective disclosure
- **B2B Talent Pool**: Employers can find verified talent (paid feature)

## Packages

| Package                                                         | Description                                     | Tech Stack                           |
| :-------------------------------------------------------------- | :---------------------------------------------- | :----------------------------------- |
| [`contracts`](https://github.com/learnault/learnault-contracts) | Soroban smart contracts for credential issuance | Rust, Soroban                        |
| [`api`](https://github.com/learnault/learnault-api)             | Backend API for user management and rewards     | Node.js, Express, PostgreSQL         |
| [`app`](https://github.com/learnault/learnault)                 | Mobile-first PWA frontend                       | React, Next.js, TypeScript, Tailwind |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      PWA Frontend (React)                   │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│                     Backend API (Node.js)                   │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│                   Stellar Blockchain Layer                  │
│      (Horizon API • Soroban Contracts • Asset Management)   │
└─────────────────────────────────────────────────────────────┘
```

For detailed architecture, see [ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 10+
- Rust (for contract development)
- Docker (optional, for local database)

### Installation

```bash
# Clone the repository
git clone https://github.com/learnault/learnault-api.git
cd learnault-api

# Install dependencies
pnpm install

# Set up environment variables
cp .env.example .env

# Run development environment
pnpm dev
```

### Development Workflow

```bash
# Run all packages in dev mode
pnpm dev

# Build all packages
pnpm build

# Run tests
pnpm test

# Lint code
pnpm lint
```

## Documentation

- [API Documentation](./docs/API.md) - API endpoints and usage
- [Code of Conduct](./docs/CODE_OF_CONDUCT.md) - Community guidelines
- [Contributing Guide](./docs/CONTRIBUTING.md) - How to contribute

## Contributing

We welcome contributions! Please see our [Contributing Guide](./docs/CONTRIBUTING.md) and [Code of Conduct](./docs/CODE_OF_CONDUCT.md).

## Security

Found a security vulnerability? Please see our [Security Policy](./docs/SECURITY.md).

## License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

## Acknowledgments

- [Stellar Development Foundation](https://stellar.org) for their incredible blockchain technology
- All our contributors and community members

## Contact

- Discord: [Join our community](https://discord.gg)
- Email: learnault@toneflix.net
