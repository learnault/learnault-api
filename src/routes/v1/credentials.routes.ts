import { Router } from 'express';
import { CredentialController } from '../../controllers/credential.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();
const credentialController = new CredentialController();

/**
 * @openapi
 * tags:
 *   name: Credentials
 *   description: Certificates and verified achievements
 */

/**
 * @openapi
 * /v1/credentials:
 *   get:
 *     summary: Get user credentials
 *     tags: [Credentials]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of credentials
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Credential'
 */
router.get('/', authenticate, credentialController.getUserCredentials.bind(credentialController));

/**
 * @openapi
 * /v1/credentials/{id}:
 *   get:
 *     summary: Get credential details by ID
 *     tags: [Credentials]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Credential details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Credential'
 */
router.get('/:id', credentialController.getCredentialById.bind(credentialController));

/**
 * @openapi
 * /v1/credentials/verify:
 *   post:
 *     summary: Verify a credential
 *     tags: [Credentials]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/VerifyCredentialRequest'
 *     responses:
 *       200:
 *         description: Verification result
 */
router.post('/verify', credentialController.verifyCredential.bind(credentialController));

/**
 * @openapi
 * /v1/credentials/{id}/revoke:
 *   post:
 *     summary: Revoke a credential
 *     tags: [Credentials]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RevokeCredentialRequest'
 *     responses:
 *       200:
 *         description: Credential revoked
 */
router.post('/:id/revoke', authenticate, credentialController.revokeCredential.bind(credentialController));

export default router;
