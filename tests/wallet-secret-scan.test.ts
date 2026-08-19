import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const files = [
  'prisma/schema.prisma',
  'prisma/migrations/20260818090000_idempotent_wallet_provisioning/migration.sql',
]

describe('wallet plaintext secret scan', () => {
  it.each(files)('%s defines no plaintext signing-material column', (file) => {
    const source = readFileSync(file, 'utf8')
    const walletPersistence = file.endsWith('schema.prisma')
      ? ['ManagedKeyReference', 'Wallet', 'WalletProvisioningJob']
          .map(
            (model) =>
              source.match(new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`))?.[0] ?? ''
          )
          .join('\n')
      : source
    expect(walletPersistence).not.toMatch(
      /\b(secret|seed|private_?key|secret_?key)\b\s+(String|TEXT)/i
    )
  })

  it('keeps the public wallet DTO free of KMS references', () => {
    const source = readFileSync('src/types/wallet-provisioning.types.ts', 'utf8')
    const publicWallet = source.match(/export interface PublicWallet \{([\s\S]*?)\n\}/)?.[1] ?? ''
    expect(publicWallet).not.toMatch(/managedKey|opaqueReference|keyVersion/i)
  })
})
