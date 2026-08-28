/**
 * OpenAPI component schemas for the Learnault API.
 *
 * This file is picked up by swagger-jsdoc via the `apis` glob in swagger.ts.
 * Do not add route operations here — keep those in the individual controller files.
 */

/**
 * @openapi
 * components:
 *   schemas:
 *
 *     # ── Shared / primitives ───────────────────────────────────────────────
 *
 *     ErrorResponse:
 *       type: object
 *       description: Standard error envelope returned for all 4xx and 5xx responses.
 *       properties:
 *         success:
 *           type: boolean
 *           example: false
 *         error:
 *           type: object
 *           properties:
 *             message:
 *               type: string
 *               example: Resource not found
 *             code:
 *               type: integer
 *               example: 404
 *
 *     Pagination:
 *       type: object
 *       description: Page-based pagination metadata.
 *       properties:
 *         page:
 *           type: integer
 *           example: 1
 *         limit:
 *           type: integer
 *           example: 20
 *         total:
 *           type: integer
 *           example: 100
 *         totalPages:
 *           type: integer
 *           example: 5
 *         hasNext:
 *           type: boolean
 *           example: true
 *         hasPrev:
 *           type: boolean
 *           example: false
 *
 */

/**
 * @openapi
 * components:
 *   schemas:
 *
 *     # ── Auth ──────────────────────────────────────────────────────────────
 *
 *     RegisterInput:
 *       type: object
 *       required: [email, password, username]
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *           example: alice@example.com
 *         password:
 *           type: string
 *           format: password
 *           minLength: 8
 *           example: P@ssword1
 *         username:
 *           type: string
 *           minLength: 3
 *           example: alice42
 *         role:
 *           type: string
 *           enum: [learner, employer]
 *           default: learner
 *
 *     LoginInput:
 *       type: object
 *       required: [email, password]
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *           example: alice@example.com
 *         password:
 *           type: string
 *           format: password
 *           example: P@ssword1
 *
 *     AuthUser:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         email:
 *           type: string
 *           format: email
 *         username:
 *           type: string
 *         role:
 *           type: string
 *           enum: [learner, employer, admin]
 *
 *     AuthResponse:
 *       type: object
 *       properties:
 *         message:
 *           type: string
 *           example: Login successful
 *         accessToken:
 *           type: string
 *           description: Short-lived JWT; pass as Authorization Bearer token.
 *         refreshToken:
 *           type: string
 *           description: Opaque token used to obtain a new access/refresh pair.
 *         expiresIn:
 *           type: integer
 *           description: Access-token lifetime in seconds.
 *           example: 900
 *         tokenType:
 *           type: string
 *           example: Bearer
 *         user:
 *           $ref: '#/components/schemas/AuthUser'
 *
 *     TokenResponse:
 *       type: object
 *       description: Response from POST /auth/refresh after a successful rotation.
 *       properties:
 *         message:
 *           type: string
 *           example: Token refreshed successfully
 *         accessToken:
 *           type: string
 *           description: New short-lived JWT.
 *         refreshToken:
 *           type: string
 *           description: New opaque refresh token; the presented one is now consumed.
 *         expiresIn:
 *           type: integer
 *           example: 900
 *         tokenType:
 *           type: string
 *           example: Bearer
 *
 *     RefreshTokenInput:
 *       type: object
 *       properties:
 *         refreshToken:
 *           type: string
 *           description: >
 *             Opaque refresh token. Optional in the JSON body when sent via the
 *             httpOnly `refresh_token` cookie instead.
 *
 *     LogoutResponse:
 *       type: object
 *       properties:
 *         message:
 *           type: string
 *           example: Logged out successfully
 *         revokedCount:
 *           type: integer
 *           description: Number of sessions revoked (0 when the token was unknown).
 *           example: 1
 *
 *     VerifyEmailInput:
 *       type: object
 *       required: [token]
 *       properties:
 *         token:
 *           type: string
 *           description: 64-character hex token from the verification email.
 *           example: a1b2c3d4e5f6...
 *
 *     ResendVerificationInput:
 *       type: object
 *       required: [email]
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *           example: alice@example.com
 *
 *     ForgotPasswordInput:
 *       type: object
 *       required: [email]
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *           example: alice@example.com
 *
 *     ResetPasswordInput:
 *       type: object
 *       required: [token, newPassword]
 *       properties:
 *         token:
 *           type: string
 *           description: 64-character hex token from the password-reset email.
 *           example: d4e5f6a1b2c3...
 *         newPassword:
 *           type: string
 *           format: password
 *           minLength: 8
 *           example: NewP@ss1
 *
 *     OtpRequestInput:
 *       type: object
 *       required: [phone]
 *       properties:
 *         phone:
 *           type: string
 *           description: E.164 format (leading +, country code, no spaces).
 *           example: '+2348012345678'
 *         deviceId:
 *           type: string
 *           description: Optional client-generated device identifier, used for device-level rate limiting.
 *
 *     OtpVerifyInput:
 *       type: object
 *       required: [phone, code]
 *       properties:
 *         phone:
 *           type: string
 *           example: '+2348012345678'
 *         code:
 *           type: string
 *           description: 6-digit code sent by SMS.
 *           example: '123456'
 *         deviceId:
 *           type: string
 *
 */

/**
 * @openapi
 * components:
 *   schemas:
 *
 *     # ── Users, accounts and profiles ───────────────────────────────────────
 *
 *     AccountSummary:
 *       type: object
 *       description: >
 *         Owner-only view of the `User` row. Served exclusively through
 *         `GET /users/me`; none of these fields appears in a public or
 *         employer-facing response.
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         email:
 *           type: string
 *           format: email
 *         username:
 *           type: string
 *         role:
 *           type: string
 *           enum: [ADMIN, LEARNER, INSTRUCTOR]
 *         status:
 *           type: string
 *           enum: [ACTIVE, DEACTIVATED, PENDING_DELETION, DELETED]
 *         isVerified:
 *           type: boolean
 *         phoneVerifiedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         walletAddress:
 *           type: string
 *           nullable: true
 *           example: GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGH
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *         lastLoginAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *
 *     LearnerProfile:
 *       type: object
 *       description: The learner-authored profile record, in full (owner view).
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         userId:
 *           type: string
 *           format: uuid
 *         displayName:
 *           type: string
 *           nullable: true
 *           maxLength: 80
 *         bio:
 *           type: string
 *           nullable: true
 *           maxLength: 1000
 *         avatarUrl:
 *           type: string
 *           format: uri
 *           nullable: true
 *         country:
 *           type: string
 *           nullable: true
 *         timezone:
 *           type: string
 *           nullable: true
 *         languages:
 *           type: array
 *           items:
 *             type: string
 *         level:
 *           type: string
 *           enum: [beginner, intermediate, advanced, expert]
 *         interests:
 *           type: array
 *           items:
 *             type: string
 *         goals:
 *           type: array
 *           items:
 *             type: string
 *         visibility:
 *           type: string
 *           enum: [private, employer, public]
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *
 *     ProfileCompletion:
 *       type: object
 *       description: Computed on read, never stored, so it cannot drift.
 *       properties:
 *         percent:
 *           type: integer
 *           minimum: 0
 *           maximum: 100
 *         missingFields:
 *           type: array
 *           items:
 *             type: string
 *
 *     OnboardingSummary:
 *       type: object
 *       nullable: true
 *       description: Null when the learner has never started onboarding.
 *       properties:
 *         version:
 *           type: string
 *         status:
 *           type: string
 *           enum: [in_progress, completed]
 *         currentStep:
 *           type: string
 *           enum: [profile_basics, consent, preferences]
 *         completedSteps:
 *           type: array
 *           items:
 *             type: string
 *         requiredStepsRemaining:
 *           type: array
 *           items:
 *             type: string
 *         startedAt:
 *           type: string
 *           format: date-time
 *         completedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *
 *     ConsentSummary:
 *       type: object
 *       description: Current state of one consent purpose. History lives at /consents/history.
 *       properties:
 *         purpose:
 *           type: string
 *           enum: [terms_of_service, privacy_policy, marketing_emails, analytics, data_sharing, custodial_wallet]
 *         status:
 *           type: string
 *           enum: [granted, withdrawn]
 *         required:
 *           type: boolean
 *         policyVersion:
 *           type: string
 *         grantedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         withdrawnAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *
 *     OwnerAccountProfile:
 *       type: object
 *       description: The aggregate returned by GET and PATCH /users/me.
 *       properties:
 *         account:
 *           $ref: '#/components/schemas/AccountSummary'
 *         profile:
 *           $ref: '#/components/schemas/LearnerProfile'
 *         completion:
 *           $ref: '#/components/schemas/ProfileCompletion'
 *         onboarding:
 *           $ref: '#/components/schemas/OnboardingSummary'
 *         consents:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/ConsentSummary'
 *         requiredConsentsGranted:
 *           type: boolean
 *
 *     PublicProfile:
 *       description: >
 *         Either the public field subset or the redacted stub
 *         `{ id, visible: false }`. The stub is returned identically for a
 *         non-public profile, a withdrawn data-sharing consent, and an inactive
 *         account, so the refusal itself discloses nothing.
 *       oneOf:
 *         - type: object
 *           properties:
 *             id:
 *               type: string
 *               format: uuid
 *             displayName:
 *               type: string
 *               nullable: true
 *             bio:
 *               type: string
 *               nullable: true
 *             avatarUrl:
 *               type: string
 *               format: uri
 *               nullable: true
 *             country:
 *               type: string
 *               nullable: true
 *             level:
 *               type: string
 *               enum: [beginner, intermediate, advanced, expert]
 *             interests:
 *               type: array
 *               items:
 *                 type: string
 *             visible:
 *               type: boolean
 *               enum: [true]
 *         - type: object
 *           properties:
 *             id:
 *               type: string
 *               format: uuid
 *             visible:
 *               type: boolean
 *               enum: [false]
 *
 *     UpdateProfileInput:
 *       type: object
 *       additionalProperties: false
 *       description: >
 *         Partial update. Every field is optional but at least one is required,
 *         and any property not listed here is rejected with a 400 — this object
 *         is the complete set of fields an owner may write.
 *       minProperties: 1
 *       properties:
 *         displayName:
 *           type: string
 *           nullable: true
 *           minLength: 1
 *           maxLength: 80
 *         bio:
 *           type: string
 *           nullable: true
 *           maxLength: 1000
 *         avatarUrl:
 *           type: string
 *           format: uri
 *           nullable: true
 *         country:
 *           type: string
 *           nullable: true
 *           minLength: 2
 *           maxLength: 60
 *         timezone:
 *           type: string
 *           nullable: true
 *         languages:
 *           type: array
 *           maxItems: 20
 *           items:
 *             type: string
 *         level:
 *           type: string
 *           enum: [beginner, intermediate, advanced, expert]
 *         interests:
 *           type: array
 *           maxItems: 50
 *           items:
 *             type: string
 *         goals:
 *           type: array
 *           maxItems: 20
 *           items:
 *             type: string
 *         visibility:
 *           type: string
 *           enum: [private, employer, public]
 *
 *     ChangePasswordInput:
 *       type: object
 *       required: [currentPassword, newPassword]
 *       properties:
 *         currentPassword:
 *           type: string
 *           format: password
 *         newPassword:
 *           type: string
 *           format: password
 *           minLength: 8
 *           description: >
 *             Must be at least 8 characters and contain uppercase, lowercase,
 *             a digit, and a special character (@$!%*?&).
 *
 *     UpdateWalletInput:
 *       type: object
 *       required: [walletAddress]
 *       properties:
 *         walletAddress:
 *           type: string
 *           pattern: '^G[A-Z0-9]{55}$'
 *           example: GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGH
 *
 */

/**
 * @openapi
 * components:
 *   schemas:
 *
 *     # ── Modules ───────────────────────────────────────────────────────────
 *
 *     UserProgress:
 *       type: object
 *       nullable: true
 *       properties:
 *         completed:
 *           type: boolean
 *         score:
 *           type: number
 *         completedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *
 *     Module:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         title:
 *           type: string
 *         description:
 *           type: string
 *         category:
 *           type: string
 *         difficulty:
 *           type: string
 *         reward:
 *           type: number
 *           description: XLM reward for passing the quiz (score >= 70%).
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *         completionCount:
 *           type: integer
 *         userProgress:
 *           $ref: '#/components/schemas/UserProgress'
 *
 *     ModuleList:
 *       type: object
 *       properties:
 *         modules:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/Module'
 *         pagination:
 *           $ref: '#/components/schemas/Pagination'
 *
 *     CompleteModuleInput:
 *       type: object
 *       required: [quizAnswers]
 *       properties:
 *         quizAnswers:
 *           type: array
 *           items:
 *             type: object
 *             required: [questionId, answer]
 *             properties:
 *               questionId:
 *                 type: string
 *               answer:
 *                 type: string
 *
 *     ModuleCompletionResponse:
 *       type: object
 *       properties:
 *         message:
 *           type: string
 *         score:
 *           type: number
 *           example: 80
 *         isEligibleForReward:
 *           type: boolean
 *         reward:
 *           type: number
 *           description: XLM amount rewarded (0 if score < 70%).
 *         rewardTransaction:
 *           type: string
 *           format: uuid
 *           nullable: true
 *         completedAt:
 *           type: string
 *           format: date-time
 *
 */

/**
 * @openapi
 * components:
 *   schemas:
 *
 *     # ── Credentials ───────────────────────────────────────────────────────
 *
 *     CredentialSummary:
 *       type: object
 *       description: Credential as returned in the list endpoint.
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         userId:
 *           type: string
 *           format: uuid
 *         moduleId:
 *           type: string
 *           format: uuid
 *         moduleName:
 *           type: string
 *         moduleCategory:
 *           type: string
 *         moduleDifficulty:
 *           type: string
 *         onChainId:
 *           type: string
 *           nullable: true
 *         issuedAt:
 *           type: string
 *           format: date-time
 *         shareableLink:
 *           type: string
 *
 *     CredentialList:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         data:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/CredentialSummary'
 *         meta:
 *           type: object
 *           properties:
 *             page:
 *               type: integer
 *             limit:
 *               type: integer
 *             total:
 *               type: integer
 *             totalPages:
 *               type: integer
 *             hasNextPage:
 *               type: boolean
 *             hasPrevPage:
 *               type: boolean
 *
 *     Credential:
 *       type: object
 *       description: Full credential detail, including module description and metadata.
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         userId:
 *           type: string
 *           format: uuid
 *         holderName:
 *           type: string
 *         moduleId:
 *           type: string
 *           format: uuid
 *         moduleName:
 *           type: string
 *         moduleDescription:
 *           type: string
 *         moduleCategory:
 *           type: string
 *         moduleDifficulty:
 *           type: string
 *         onChainId:
 *           type: string
 *           nullable: true
 *         issuedAt:
 *           type: string
 *           format: date-time
 *         shareableLink:
 *           type: string
 *         metadata:
 *           type: object
 *           properties:
 *             reward:
 *               type: number
 *             verificationUrl:
 *               type: string
 *
 *     VerificationResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         data:
 *           type: object
 *           properties:
 *             valid:
 *               type: boolean
 *               example: true
 *             credential:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 holderName:
 *                   type: string
 *                 moduleName:
 *                   type: string
 *                 moduleCategory:
 *                   type: string
 *                 moduleDifficulty:
 *                   type: string
 *                 onChainId:
 *                   type: string
 *                   nullable: true
 *                 issuedAt:
 *                   type: string
 *                   format: date-time
 *             verification:
 *               type: object
 *               properties:
 *                 verifiedAt:
 *                   type: string
 *                   format: date-time
 *                 status:
 *                   type: string
 *                   example: verified
 *                 message:
 *                   type: string
 *
 */

/**
 * @openapi
 * components:
 *   schemas:
 *
 *     # ── Rewards ───────────────────────────────────────────────────────────
 *
 *     RewardBalance:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         data:
 *           type: object
 *           properties:
 *             balance:
 *               type: object
 *               properties:
 *                 available:
 *                   type: number
 *                   example: 10.5
 *                 pending:
 *                   type: number
 *                   example: 2.0
 *                 lifetime:
 *                   type: number
 *                   example: 25.0
 *             updatedAt:
 *               type: string
 *               format: date-time
 *
 *     Transaction:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         type:
 *           type: string
 *           enum: [module_reward, streak_bonus, referral_reward, withdrawal]
 *         status:
 *           type: string
 *           enum: [pending, completed, failed]
 *         amount:
 *           type: number
 *         moduleId:
 *           type: string
 *           format: uuid
 *           nullable: true
 *         stellarTxHash:
 *           type: string
 *           nullable: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *         completedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *
 *     TransactionHistory:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         data:
 *           type: object
 *           properties:
 *             transactions:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Transaction'
 *             pagination:
 *               type: object
 *               properties:
 *                 total:
 *                   type: integer
 *                 limit:
 *                   type: integer
 *                 offset:
 *                   type: integer
 *                 hasMore:
 *                   type: boolean
 *
 *     WithdrawalInput:
 *       type: object
 *       required: [walletAddress, amount]
 *       properties:
 *         walletAddress:
 *           type: string
 *           pattern: '^G[A-Z0-9]{50,55}$'
 *           example: GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDE
 *         amount:
 *           type: number
 *           minimum: 0
 *           exclusiveMinimum: true
 *           example: 5.0
 *         memo:
 *           type: string
 *           nullable: true
 *
 *     WithdrawalResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *         data:
 *           type: object
 *           properties:
 *             transactionId:
 *               type: string
 *               format: uuid
 *             amount:
 *               type: number
 *             stellarTxHash:
 *               type: string
 *             status:
 *               type: string
 *             requestedAt:
 *               type: string
 *               format: date-time
 *             completedAt:
 *               type: string
 *               format: date-time
 *               nullable: true
 *
 */

/**
 * @openapi
 * components:
 *   schemas:
 *
 *     # ── Referrals ─────────────────────────────────────────────────────────
 *
 *     ReferralCodeResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *         data:
 *           type: object
 *           properties:
 *             code:
 *               type: string
 *               example: A1B2C3D4
 *
 *     ApplyReferralInput:
 *       type: object
 *       required: [code]
 *       properties:
 *         code:
 *           type: string
 *           example: A1B2C3D4
 *
 *     ApplyReferralResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *         data:
 *           type: object
 *           properties:
 *             referralId:
 *               type: string
 *               format: uuid
 *
 *     ReferralStats:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         data:
 *           type: object
 *           properties:
 *             totalReferrals:
 *               type: integer
 *               example: 3
 *             activeReferrals:
 *               type: integer
 *               description: Referrals where the referree has completed at least one module.
 *               example: 2
 *             earnedBonuses:
 *               type: number
 *               description: Total XLM bonuses already paid out.
 *               example: 10.0
 *             pendingBonuses:
 *               type: number
 *               description: Estimated pending bonus (unpaid referrals × 5 XLM per referral).
 *               example: 5.0
 *
 *     # ── Notifications ─────────────────────────────────────────────────────
 *
 *     RegisterDeviceInput:
 *       type: object
 *       required: [token, platform]
 *       properties:
 *         token:
 *           type: string
 *           description: Firebase device token.
 *         platform:
 *           type: string
 *           enum: [ios, android, web]
 *
 *     NotificationPreferencesInput:
 *       type: object
 *       description: At least one field must be provided.
 *       properties:
 *         rewardReceipt:
 *           type: boolean
 *         quizPassFail:
 *           type: boolean
 *         streakReminders:
 *           type: boolean
 *
 *     NotificationLog:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         type:
 *           type: string
 *         title:
 *           type: string
 *         body:
 *           type: string
 *         status:
 *           type: string
 *           enum: [pending, success, failed, dead-letter]
 *         error:
 *           type: string
 *           nullable: true
 *         attemptCount:
 *           type: integer
 *         createdAt:
 *           type: string
 *           format: date-time
 *
 */

/**
 * @openapi
 * components:
 *   schemas:
 *
 *     # ── Sync ──────────────────────────────────────────────────────────────
 *
 *     SyncProgressEvent:
 *       type: object
 *       required: [idempotencyKey, deviceId, moduleId, progressPercent, clientTimestamp, syncVersion]
 *       properties:
 *         idempotencyKey:
 *           type: string
 *           description: Unique key to deduplicate events.
 *         deviceId:
 *           type: string
 *         moduleId:
 *           type: string
 *           format: uuid
 *         progressPercent:
 *           type: number
 *           minimum: 0
 *           maximum: 100
 *         clientTimestamp:
 *           type: string
 *           format: date-time
 *         syncVersion:
 *           type: integer
 *
 *     SyncCompletionEvent:
 *       type: object
 *       required: [idempotencyKey, deviceId, moduleId, score, clientTimestamp, syncVersion]
 *       properties:
 *         idempotencyKey:
 *           type: string
 *         deviceId:
 *           type: string
 *         moduleId:
 *           type: string
 *           format: uuid
 *         score:
 *           type: number
 *           minimum: 0
 *           maximum: 100
 *         clientTimestamp:
 *           type: string
 *           format: date-time
 *         syncVersion:
 *           type: integer
 *
 *     SyncResult:
 *       type: object
 *       properties:
 *         idempotencyKey:
 *           type: string
 *         status:
 *           type: string
 *           enum: [applied, skipped, rejected]
 *         reason:
 *           type: string
 *           nullable: true
 *           description: Present when status is skipped or rejected.
 *
 *     SyncResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         data:
 *           type: object
 *           properties:
 *             results:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/SyncResult'
 *
 *     # ── Employer ──────────────────────────────────────────────────────────
 *
 *     CandidateSummary:
 *       type: object
 *       description: Truncated candidate record returned by the search endpoint.
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         name:
 *           type: string
 *         location:
 *           type: string
 *           nullable: true
 *         skills:
 *           type: array
 *           items:
 *             type: string
 *         completions:
 *           type: integer
 *         averageScore:
 *           type: number
 *         verifiedCredentialCount:
 *           type: integer
 *
 *     EmployerSearchResponse:
 *       type: object
 *       properties:
 *         candidates:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/CandidateSummary'
 *         pagination:
 *           type: object
 *           properties:
 *             page:
 *               type: integer
 *             limit:
 *               type: integer
 *             total:
 *               type: integer
 *             totalPages:
 *               type: integer
 *             hasNext:
 *               type: boolean
 *             hasPrev:
 *               type: boolean
 *         filters:
 *           type: object
 *           properties:
 *             skills:
 *               type: array
 *               items:
 *                 type: string
 *             location:
 *               type: string
 *               nullable: true
 *             credentials:
 *               type: string
 *         plan:
 *           type: string
 *           enum: [starter, pro, enterprise]
 *
 *     VerifiedCredentialDetail:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         moduleId:
 *           type: string
 *         moduleTitle:
 *           type: string
 *         category:
 *           type: string
 *         difficulty:
 *           type: string
 *         issuedAt:
 *           type: string
 *           format: date-time
 *         onChainId:
 *           type: string
 *           nullable: true
 *         verified:
 *           type: boolean
 *
 *     CandidateProfile:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         name:
 *           type: string
 *         location:
 *           type: string
 *         joinedAt:
 *           type: string
 *           format: date-time
 *         skills:
 *           type: array
 *           items:
 *             type: string
 *         completions:
 *           type: integer
 *         averageScore:
 *           type: number
 *         verifiedCredentials:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/VerifiedCredentialDetail'
 *         privacy:
 *           type: object
 *           properties:
 *             profileVisibility:
 *               type: string
 *               example: public
 *
 *     ContactCandidateInput:
 *       type: object
 *       required: [candidateId, subject, message]
 *       properties:
 *         candidateId:
 *           type: string
 *           format: uuid
 *         subject:
 *           type: string
 *           minLength: 3
 *           maxLength: 120
 *         message:
 *           type: string
 *           minLength: 10
 *           maxLength: 3000
 *         channel:
 *           type: string
 *           enum: [platform, email, both]
 *           default: platform
 *
 *     ContactCandidateResponse:
 *       type: object
 *       properties:
 *         message:
 *           type: string
 *         outreach:
 *           type: object
 *           properties:
 *             id:
 *               type: string
 *               format: uuid
 *             candidateId:
 *               type: string
 *               format: uuid
 *             channel:
 *               type: string
 *             status:
 *               type: string
 *               example: recorded
 *             createdAt:
 *               type: string
 *               format: date-time
 *
 */

/**
 * @openapi
 * components:
 *   schemas:
 *     DataExportRequest:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         status:
 *           type: string
 *           enum: [pending, processing, ready, failed, expired]
 *         createdAt:
 *           type: string
 *           format: date-time
 *         completedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         expiresAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         downloadedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *
 *     AccountDeletionRequest:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         status:
 *           type: string
 *           enum: [pending, processing, completed, cancelled, failed]
 *         scheduledFor:
 *           type: string
 *           format: date-time
 *         cancelledAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         completedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *
 *     DeactivateInput:
 *       type: object
 *       required: [password]
 *       properties:
 *         password:
 *           type: string
 *           description: Current password (step-up re-authentication)
 *
 *     ReactivateInput:
 *       type: object
 *       required: [email, password]
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *         password:
 *           type: string
 *
 *     RequestDeletionInput:
 *       type: object
 *       required: [password]
 *       properties:
 *         password:
 *           type: string
 *           description: Current password (step-up re-authentication)
 *         reason:
 *           type: string
 *           maxLength: 500
 *
 *     CancelDeletionInput:
 *       type: object
 *       required: [email, password]
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *         password:
 *           type: string
 *
 *     AccountStatusError:
 *       type: object
 *       properties:
 *         error:
 *           type: string
 *         code:
 *           type: string
 *           enum: [ACCOUNT_DEACTIVATED, ACCOUNT_PENDING_DELETION, STEP_UP_FAILED]
 *         scheduledFor:
 *           type: string
 *           format: date-time
 *           nullable: true
 */

/**
 * @openapi
 * components:
 *   schemas:
 *
 *     # ── Sessions ─────────────────────────────────────────────────────────
 *
 *     SessionView:
 *       type: object
 *       description: >
 *         A redacted view of a single active session. Tokens and raw IP
 *         addresses are never included.
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *           description: Session identifier.
 *           example: 3fa85f64-5717-4562-b3fc-2c963f66afa6
 *         deviceName:
 *           type: string
 *           nullable: true
 *           description: Human-readable device label, e.g. "iPhone 14".
 *           example: iPhone 14
 *         browser:
 *           type: string
 *           nullable: true
 *           description: Browser label, e.g. "Chrome 124".
 *           example: Chrome 124
 *         os:
 *           type: string
 *           nullable: true
 *           description: Operating system label, e.g. "macOS 14.4".
 *           example: macOS 14.4
 *         country:
 *           type: string
 *           nullable: true
 *           description: ISO 3166-1 alpha-2 country code from approximate geo-lookup.
 *           example: NG
 *         city:
 *           type: string
 *           nullable: true
 *           description: City name from approximate geo-lookup.
 *           example: Lagos
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: When the session was first created (initial login).
 *         lastUsedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *           description: When the session last consumed a refresh token. Null for sessions that have never refreshed.
 *         expiresAt:
 *           type: string
 *           format: date-time
 *           description: Absolute session expiry timestamp.
 *         isCurrent:
 *           type: boolean
 *           description: True when this session is associated with the current access token.
 *           example: true
 *
 *     SessionListResponse:
 *       type: object
 *       description: Paginated list of active sessions.
 *       properties:
 *         sessions:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/SessionView'
 *         pagination:
 *           $ref: '#/components/schemas/Pagination'
 *
 *     RevokeSessionResponse:
 *       type: object
 *       properties:
 *         message:
 *           type: string
 *           example: Session revoked successfully
 *
 *     RevokeAllSessionsResponse:
 *       type: object
 *       properties:
 *         message:
 *           type: string
 *           example: 3 sessions revoked successfully
 *         revokedCount:
 *           type: integer
 *           description: Number of sessions that were revoked.
 *           example: 3
 *
 */
