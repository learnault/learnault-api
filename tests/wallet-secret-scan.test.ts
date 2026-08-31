import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const files = [
  'prisma/schema.prisma',
  'prisma/migrations/20260818090000_idempotent_wallet_provisioning/migration.sql',
  'src/services/wallet-self-custody-export.service.ts',
  'src/controllers/wallet-self-custody-export.controller.ts',
  'docs/security/self-custody-export.md',
]

describe('wallet plaintext secret scan', () => {
  it.each(files)('%s defines no plaintext signing-material column', (file) => {
    const source = readFileSync(file, 'utf8')
    const walletPersistence = file.endsWith('schema.prisma')
      ? ['ManagedKeyReference', 'Wallet', 'WalletProvisioningJob']
          .map(
            (model) =>
              source.match(
                new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`),
              )?.[0] ?? '',
          )
          .join('\n')
      : source
    expect(walletPersistence).not.toMatch(
      /\b(secret|seed|private_?key|secret_?key)\b\s+(String|TEXT)/i,
    )
  })

  it('does not embed a Stellar secret in export source or documentation', () => {
    const exportSources = files
      .slice(2)
      .map((file) => readFileSync(file, 'utf8'))
    expect(exportSources.join('\n')).not.toMatch(/S[A-Z2-7]{55}/)
  })

  it('keeps the public wallet DTO free of KMS references', () => {
    const source = readFileSync(
      'src/types/wallet-provisioning.types.ts',
      'utf8',
    )
    const publicWallet =
      source.match(/export interface PublicWallet \{([\s\S]*?)\n\}/)?.[1] ?? ''
    expect(publicWallet).not.toMatch(/managedKey|opaqueReference|keyVersion/i)
  })
})
