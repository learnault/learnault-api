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

/**
 * @openapi
 * components:
 *   schemas:
 *     Credential:
 *       type: object
 *       required: [id, userId, moduleId, type, status, title, description, issuedAt]
 *       properties:
 *         id: { type: string, format: uuid }
 *         userId: { type: string, format: uuid }
 *         moduleId: { type: string, format: uuid }
 *         type: { type: string, enum: [certificate, badge, license, achievement] }
 *         status: { type: string, enum: [active, expired, revoked, pending] }
 *         title: { type: string }
 *         description: { type: string }
 *         issuedAt: { type: string, format: date-time }
 *         expiresAt: { type: string, format: date-time }
 *         revokedAt: { type: string, format: date-time }
 *         revokedReason: { type: string }
 *         blockchainTxHash: { type: string }
 *         metadataUrl: { type: string, format: uri }
 *         imageUrl: { type: string, format: uri }
 */
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

/**
 * @openapi
 * components:
 *   schemas:
 *     VerifyCredentialRequest:
 *       type: object
 *       required: [credentialId]
 *       properties:
 *         credentialId: { type: string, format: uuid }
 *         requestedBy: { type: string }
 */
export interface VerifyCredentialRequest {
  credentialId: string;
  requestedBy?: string;
}

/**
 * @openapi
 * components:
 *   schemas:
 *     RevokeCredentialRequest:
 *       type: object
 *       required: [reason]
 *       properties:
 *         reason: { type: string }
 */
export interface RevokeCredentialRequest {
  reason: string;
}

export interface CredentialFilterParams {
  userId?: string;
  moduleId?: string;
  type?: CredentialType;
  status?: CredentialStatus;
  fromDate?: string;
  toDate?: string;
}
