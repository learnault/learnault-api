import swaggerJsdoc from 'swagger-jsdoc'

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Learnault API',
      version: '1.0.0',
      description: [
        'REST API for Learnault — a decentralized learn-to-earn platform on Stellar.',
        '',
        '**Base path for all v1 routes:** `/api/v1`',
        '',
        '**Authentication:** Most routes require a Bearer JWT obtained from `POST /api/v1/auth/login`.',
        'Pass it as `Authorization: Bearer <token>`.',
        '',
        '**Rate-limiting headers** are returned on every response:',
        '`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.',
        'A `Retry-After` header is added when the limit is exceeded (HTTP 429).',
        '',
        '**Error envelope** (all 4xx/5xx responses):',
        '```json',
        '{ "success": false, "error": { "message": "...", "code": 500 } }',
        '```',
        '',
        '> ⚠️ **Preview / not-yet-implemented routes** — `PATCH /api/v1/users/password` and',
        '> `PATCH /api/v1/users/wallet` are wired but their underlying service methods are stubs.',
        '> They will return errors in production until the service layer is completed.',
      ].join('\n'),
      contact: {
        name: 'Learnault Contributors',
        url: 'https://github.com/learnault/learnault',
        email: 'learnault@toneflix.net',
      },
      license: {
        name: 'MIT',
      },
    },
    servers: [
      {
        url: '/api/v1',
        description: 'Current version (v1)',
      },
      {
        url: 'http://localhost:3000/api/v1',
        description: 'Local development',
      },
    ],
    tags: [
      { name: 'Health', description: 'Service health check' },
      { name: 'Auth', description: 'Registration, login, refresh rotation, logout, email verification, password reset, phone OTP' },
      { name: 'Users', description: 'User profile management' },
      { name: 'Modules', description: 'Learning module catalogue and progress tracking' },
      { name: 'Credentials', description: 'On-chain verifiable credentials' },
      { name: 'Rewards', description: 'XLM balance, transaction history, and withdrawals' },
      { name: 'Referrals', description: 'Referral code generation and bonus tracking' },
      { name: 'Notifications', description: 'Push-notification device tokens and preferences' },
      { name: 'Sync', description: 'Offline progress and completion reconciliation' },
      { name: 'Employer', description: 'B2B talent search and candidate outreach (employer role required)' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT obtained from POST /auth/login',
        },
      },
      // All component schemas are defined via JSDoc in src/docs/schemas.ts
    },
    // Global security — individual operations that are public override this with security: []
    security: [{ bearerAuth: [] }],
  },
  // Scan controllers (operations) and the dedicated schema file
  apis: [
    './src/controllers/**/*.ts',
    './src/routes/**/*.ts',
    './src/docs/*.ts',
    './src/app.ts',
  ],
}

export const specs = swaggerJsdoc(options)
