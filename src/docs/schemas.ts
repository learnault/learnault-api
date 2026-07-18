/**
 * @openapi
 * components:
 *   schemas:
 *     User:
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
 *         firstName:
 *           type: string
 *         lastName:
 *           type: string
 *         bio:
 *           type: string
 *         avatar:
 *           type: string
 *           format: url
 *         walletAddress:
 *           type: string
 *         isActive:
 *           type: boolean
 *         role:
 *           type: string
 *           enum: [LEARNER, EMPLOYER, ADMIN]
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *
 *     UpdateUser:
 *       type: object
 *       properties:
 *         username:
 *           type: string
 *         firstName:
 *           type: string
 *         lastName:
 *           type: string
 *         bio:
 *           type: string
 *         avatar:
 *           type: string
 *           format: url
 *
 *     RegisterInput:
 *       type: object
 *       required:
 *         - email
 *         - password
 *         - username
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *         password:
 *           type: string
 *           format: password
 *         username:
 *           type: string
 *         role:
 *           type: string
 *           enum: [LEARNER, EMPLOYER]
 *
 *     LoginInput:
 *       type: object
 *       required:
 *         - email
 *         - password
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *         password:
 *           type: string
 *           format: password
 *
 *     AuthResponse:
 *       type: object
 *       properties:
 *         message:
 *           type: string
 *         token:
 *           type: string
 *         user:
 *           $ref: '#/components/schemas/User'
 *
 *     VerifyEmailInput:
 *       type: object
 *       required:
 *         - token
 *       properties:
 *         token:
 *           type: string
 *
 *     VerifyEmailResponse:
 *       type: object
 *       properties:
 *         message:
 *           type: string
 *
 *     ResendVerificationInput:
 *       type: object
 *       required:
 *         - email
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *
 *     ResendVerificationResponse:
 *       type: object
 *       properties:
 *         message:
 *           type: string
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
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *         completionCount:
 *           type: integer
 *         userProgress:
 *           type: object
 *           nullable: true
 *           properties:
 *             completed:
 *               type: boolean
 *             score:
 *               type: number
 *             completedAt:
 *               type: string
 *               format: date-time
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
 *     Pagination:
 *       type: object
 *       properties:
 *         page:
 *           type: integer
 *         limit:
 *           type: integer
 *         total:
 *           type: integer
 *         totalPages:
 *           type: integer
 *         hasNext:
 *           type: boolean
 *         hasPrev:
 *           type: boolean
 *
 *     CompleteModuleInput:
 *       type: object
 *       required:
 *         - quizAnswers
 *       properties:
 *         quizAnswers:
 *           type: array
 *           items:
 *             type: object
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
 *         isEligibleForReward:
 *           type: boolean
 *         reward:
 *           type: number
 *         rewardTransaction:
 *           type: string
 *         completedAt:
 *           type: string
 *           format: date-time
 *
 *     RewardBalance:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *         data:
 *           type: object
 *           properties:
 *             balance:
 *               type: object
 *               properties:
 *                 available:
 *                   type: number
 *                 pending:
 *                   type: number
 *                 lifetime:
 *                   type: number
 *             updatedAt:
 *               type: string
 *               format: date-time
 *
 *     Transaction:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         type:
 *           type: string
 *         status:
 *           type: string
 *         amount:
 *           type: number
 *         moduleId:
 *           type: string
 *         stellarTxHash:
 *           type: string
 *         createdAt:
 *           type: string
 *           format: date-time
 *         completedAt:
 *           type: string
 *           format: date-time
 *
 *     TransactionHistory:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
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
 *       required:
 *         - walletAddress
 *         - amount
 *       properties:
 *         walletAddress:
 *           type: string
 *         amount:
 *           type: number
 *         memo:
 *           type: string
 *
 *     WithdrawalResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *         message:
 *           type: string
 *         data:
 *           type: object
 *           properties:
 *             transactionId:
 *               type: string
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
 *
 *     Credential:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         userId:
 *           type: string
 *         holderName:
 *           type: string
 *         moduleId:
 *           type: string
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
 *         data:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/Credential'
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
 *
 *     VerificationResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *         data:
 *           type: object
 *           properties:
 *             valid:
 *               type: boolean
 *             credential:
 *               type: object
 *             verification:
 *               type: object
 *
 *     LearnerProfile:
 *       type: object
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
 *         bio:
 *           type: string
 *           nullable: true
 *         avatar:
 *           type: string
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
 *         skillLevel:
 *           type: string
 *           enum: [beginner, intermediate, advanced]
 *           nullable: true
 *         interests:
 *           type: array
 *           items:
 *             type: string
 *         goals:
 *           type: string
 *           nullable: true
 *         profileVisibility:
 *           type: string
 *           enum: [public, private]
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *
 *     UpdateProfileInput:
 *       type: object
 *       properties:
 *         displayName:
 *           type: string
 *           maxLength: 50
 *         bio:
 *           type: string
 *           maxLength: 500
 *         country:
 *           type: string
 *           minLength: 2
 *           maxLength: 2
 *         timezone:
 *           type: string
 *           maxLength: 50
 *         languages:
 *           type: array
 *           maxItems: 20
 *           items:
 *             type: string
 *         skillLevel:
 *           type: string
 *           enum: [beginner, intermediate, advanced]
 *         interests:
 *           type: array
 *           maxItems: 20
 *           items:
 *             type: string
 *         goals:
 *           type: string
 *           maxLength: 500
 *         profileVisibility:
 *           type: string
 *           enum: [public, private]
 *
 *     CreateUploadIntentRequest:
 *       type: object
 *       required:
 *         - mimeType
 *         - sizeBytes
 *       properties:
 *         mimeType:
 *           type: string
 *           enum: [image/jpeg, image/png, image/webp, image/gif]
 *         sizeBytes:
 *           type: integer
 *           minimum: 1
 *           maximum: 5242880
 *
 *     UploadIntent:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         uploadUrl:
 *           type: string
 *           format: uri
 *         storageKey:
 *           type: string
 *         expiresAt:
 *           type: string
 *           format: date-time
 *         mimeType:
 *           type: string
 *         maxSizeBytes:
 *           type: integer
 *
 *     FinalizeUploadRequest:
 *       type: object
 *       required:
 *         - intentId
 *       properties:
 *         intentId:
 *           type: string
 *           format: uuid
 *
 *     FinalizeUploadResponse:
 *       type: object
 *       properties:
 *         intentId:
 *           type: string
 *           format: uuid
 *         status:
 *           type: string
 *           enum: [processing, finalized, failed]
 *         asset:
 *           $ref: '#/components/schemas/Asset'
 *
 *     AssetVariant:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         assetId:
 *           type: string
 *           format: uuid
 *         variant:
 *           type: string
 *           enum: [original, small, medium, large]
 *         format:
 *           type: string
 *           enum: [webp, png]
 *         storageKey:
 *           type: string
 *         sizeBytes:
 *           type: integer
 *         width:
 *           type: integer
 *         height:
 *           type: integer
 *         status:
 *           type: string
 *           enum: [active, retired]
 *         createdAt:
 *           type: string
 *           format: date-time
 *
 *     Asset:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         userId:
 *           type: string
 *           format: uuid
 *         storageKey:
 *           type: string
 *         mimeType:
 *           type: string
 *         sizeBytes:
 *           type: integer
 *         width:
 *           type: integer
 *           nullable: true
 *         height:
 *           type: integer
 *           nullable: true
 *         status:
 *           type: string
 *           enum: [pending, active, retired]
 *         finalizedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         retiredAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *         variants:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/AssetVariant'
 *
 *     AvatarResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *         data:
 *           type: object
 *           properties:
 *             asset:
 *               $ref: '#/components/schemas/Asset'
 *               nullable: true
 */
