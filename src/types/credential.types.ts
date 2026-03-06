export enum CredentialType {
  CERTIFICATE = "certificate",
  BADGE = "badge",
  LICENSE = "license",
  ACHIEVEMENT = "achievement",
}

export enum CredentialStatus {
  ACTIVE = "active",
  EXPIRED = "expired",
  REVOKED = "revoked",
  PENDING = "pending",
}

export enum VerificationStatus {
  UNVERIFIED = "unverified",
  PENDING = "pending",
  VERIFIED = "verified",
  FAILED = "failed",
  EXPIRED = "expired",
}

export interface Credential {
  id: string;
  userId: string;
  moduleId: string;
  type: CredentialType;
  status: CredentialStatus;
  title: string;
  description: string;
  issuedAt: string;
  expiresAt?: string;
  revokedAt?: string;
  revokedReason?: string;
  blockchainTxHash?: string;
  metadataUrl?: string;
  imageUrl?: string;
}

export interface Verification {
  id: string;
  credentialId: string;
  requestedBy?: string;
  status: VerificationStatus;
  verifiedAt?: string;
  expiresAt?: string;
  verificationUrl: string;
  checksum: string;
  attempts: number;
  lastCheckedAt?: string;
}

export interface CredentialWithVerification extends Credential {
  verification?: Verification;
  holderName: string;
  moduleName: string;
}

// Request types
export interface IssueCredentialRequest {
  userId: string;
  moduleId: string;
  type: CredentialType;
  title: string;
  description: string;
  expiresAt?: string;
  metadataUrl?: string;
  imageUrl?: string;
}

export interface RevokeCredentialRequest {
  reason: string;
}

export interface VerifyCredentialRequest {
  credentialId: string;
  requestedBy?: string;
}

export interface CredentialFilterParams {
  userId?: string;
  moduleId?: string;
  type?: CredentialType;
  status?: CredentialStatus;
  fromDate?: string;
  toDate?: string;
}
