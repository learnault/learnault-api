import type { PublicWallet } from '../types/wallet-provisioning.types'
import { toPublicWallet } from '../types/wallet-provisioning.types'
import type { WalletProvisioningRepository } from './wallet-provisioning.repository'

export class WalletProvisioningService {
  constructor(private readonly repository: WalletProvisioningRepository) {}

  async request(userId: string, network = 'TESTNET'): Promise<PublicWallet> {
    const wallet = await this.repository.reserveEligibleWallet(userId, network)

    return toPublicWallet(wallet)
  }

  async getForUser(userId: string): Promise<PublicWallet | null> {
    const wallet = await this.repository.getByUserId(userId)

    return wallet ? toPublicWallet(wallet) : null
  }
}
