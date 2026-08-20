export type SeedModule = {
  id: string
  title: string
  description: string
  category: string
  difficulty: string
  reward: number
}

export const seedModuleFixtures: SeedModule[] = [
  {
    id: 'seed-module-blockchain-101',
    title: 'Stellar Fundamentals',
    description: 'Core ledger concepts, accounts, trustlines, and transaction flow on Stellar.',
    category: 'blockchain',
    difficulty: 'beginner',
    reward: 10,
  },
  {
    id: 'seed-module-finance-101',
    title: 'Understanding Stablecoins',
    description: 'How fiat-backed and crypto-backed stablecoins work across global payment rails.',
    category: 'finance',
    difficulty: 'beginner',
    reward: 12,
  },
  {
    id: 'seed-module-security-201',
    title: 'Wallet Security & Key Management',
    description: 'Threat modeling, custody approaches, and secure key handling in production systems.',
    category: 'security',
    difficulty: 'intermediate',
    reward: 18,
  },
  {
    id: 'seed-module-development-301',
    title: 'Build with Soroban',
    description: 'Develop and test smart contracts using practical Soroban development workflows.',
    category: 'development',
    difficulty: 'advanced',
    reward: 30,
  },
  {
    id: 'seed-module-compliance-201',
    title: 'AML/KYC for Digital Finance',
    description: 'Compliance basics, sanctions screening, and regulated onboarding for fintech teams.',
    category: 'compliance',
    difficulty: 'intermediate',
    reward: 20,
  },
  {
    id: 'seed-module-identity-301',
    title: 'Decentralized Identity in Practice',
    description: 'Verifiable credentials, selective disclosure, and identity portability patterns.',
    category: 'identity',
    difficulty: 'advanced',
    reward: 28,
  },
  {
    id: 'seed-module-development-401',
    title: 'Production API Hardening',
    description: 'Rate limiting, auth patterns, observability, and safe rollout practices.',
    category: 'development',
    difficulty: 'expert',
    reward: 40,
  },
  {
    id: 'seed-module-blockchain-202',
    title: 'Stellar Asset Issuance',
    description: 'Issue and manage custom assets with issuer/distributor architecture.',
    category: 'blockchain',
    difficulty: 'intermediate',
    reward: 22,
  },
]
