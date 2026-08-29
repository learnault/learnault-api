import { Keypair } from '@stellar/stellar-sdk'
import { SensitiveValue } from './kms/kms-secret-store'

export interface GeneratedStellarKeypair {
  publicKey: string
  secret: SensitiveValue
}

export interface StellarKeypairGenerator {
  generate(): GeneratedStellarKeypair
}

/** Generates signing material only inside the provisioning worker boundary. */
export class SdkStellarKeypairGenerator implements StellarKeypairGenerator {
  generate(): GeneratedStellarKeypair {
    const keypair = Keypair.random()

    return {
      publicKey: keypair.publicKey(),
      secret: new SensitiveValue(keypair.secret()),
    }
  }
}
