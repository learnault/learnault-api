# Learnault API Documentation

## Overview

The Learnault API provides endpoints for user management, learning modules, rewards, and credential verification. The API follows RESTful principles and returns JSON responses.

**Base URL:** `https://api.learnault.io/v1` (production) or `http://localhost:3001/v1` (development)

## Authentication

Most endpoints require authentication using a JWT token.

```
Authorization: Bearer <your-jwt-token>
```

### Get JWT Token

```
POST /v1/auth/login
```

**Request:**

```json
{
  "email": "user@example.com",
  "password": "securepassword"
}
```

**Response:**

```json
{
  "status": "success",
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "data": {
    "id": "usr_123",
    "email": "user@example.com",
    "walletAddress": "GABC...123"
  }
}
```

## Endpoints

### Users

#### Get Current User

```
GET /v1/users/me
```

**Response:**

```json
{
  "status": "success",
  "data": {
    "id": "usr_123",
    "email": "user@example.com",
    "name": "John Doe",
    "walletAddress": "GABC...123",
    "createdAt": "2024-01-01T00:00:00Z",
    "stats": {
      "modulesCompleted": 15,
      "totalEarned": "25.50",
      "currentStreak": 7
    }
  }
}
```

#### Update User Profile

```
PATCH /v1/users/me
```

**Request:**

```json
{
  "name": "John Updated",
  "preferences": {
    "language": "fr",
    "notifications": true
  }
}
```

### Learning Modules

#### List Modules

```
GET /v1/modules?category=finance&page=1&limit=20
```

**Query Parameters:**

- `category` - Filter by category
- `difficulty` - beginner, intermediate, advanced
- `language` - en, fr, es, etc.
- `page` - Page number
- `limit` - Items per page

**Response:**

```json
{
  "status": "success",
  "data": [
    {
      "id": "mod_456",
      "title": "Understanding Stablecoins",
      "description": "Learn how stablecoins work",
      "category": "finance",
      "difficulty": "beginner",
      "duration": 15,
      "reward": "0.25",
      "language": "en",
      "completions": 1243,
      "thumbnail": "https://cdn.learnault.io/modules/stablecoins.jpg"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45
  }
}
```

#### Get Module Details

```
GET /v1/modules/:moduleId
```

**Response:**

```json
{
  "status": "success",
  "data": {
    "id": "mod_456",
    "title": "Understanding Stablecoins",
    "description": "Learn how stablecoins work",
    "content": [
      {
        "type": "text",
        "data": "Stablecoins are cryptocurrencies designed to maintain a stable value..."
      },
      {
        "type": "image",
        "url": "https://cdn.learnault.io/content/stablecoin-diagram.jpg"
      },
      {
        "type": "quiz",
        "questions": [
          {
            "id": "q1",
            "question": "What is a stablecoin?",
            "options": [
              "A volatile cryptocurrency",
              "A cryptocurrency with stable value",
              "A type of stock",
              "A government bond"
            ],
            "correctOption": 1
          }
        ]
      }
    ],
    "reward": "0.25",
    "prerequisites": []
  }
}
```

#### Submit Module Completion

```
POST /v1/modules/:moduleId/complete
```

**Request:**

```json
{
  "answers": [
    {
      "questionId": "q1",
      "selectedOption": 1
    }
  ],
  "timeSpent": 320
}
```

**Response:**

```json
{
  "status": "success",
  "data": {
    "passed": true,
    "score": 100,
    "reward": {
      "amount": "0.25",
      "asset": "USDC",
      "transactionHash": "a1b2c3...",
      "status": "completed"
    },
    "credential": {
      "id": "cred_789",
      "onChainId": "0x123...",
      "issuedAt": "2024-01-15T10:30:00Z"
    }
  }
}
```

### Rewards & Wallet

#### Get Wallet Balance

```
GET /v1/rewards/balance
```

**Response:**

```json
{
  "status": "success",
  "data": [
    {
      "asset": "USDC",
      "amount": "45.75",
      "valueInUSD": "45.75"
    },
    {
      "asset": "XLM",
      "amount": "125.50",
      "valueInUSD": "12.55"
    }
  ],
  "totalValueUSD": "58.30"
}
```

#### Get Reward History

```
GET /v1/rewards/history?page=1&limit=20
```

**Response:**

```json
{
  "status": "success",
  "data": [
    {
      "id": "tx_abc",
      "type": "module_reward",
      "amount": "0.25",
      "asset": "USDC",
      "moduleId": "mod_456",
      "moduleTitle": "Understanding Stablecoins",
      "timestamp": "2024-01-15T10:30:00Z",
      "transactionHash": "a1b2c3..."
    },
    {
      "id": "tx_def",
      "type": "referral_bonus",
      "amount": "0.50",
      "asset": "USDC",
      "referralEmail": "friend@example.com",
      "timestamp": "2024-01-14T14:20:00Z",
      "transactionHash": "d4e5f6..."
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 47
  }
}
```

#### Withdraw Funds

```
POST /v1/rewards/withdraw
```

**Request:**

```json
{
  "amount": "25.00",
  "asset": "USDC",
  "destination": "GA...", // Stellar address or mobile money identifier
  "method": "stellar" // or "mobile_money"
}
```

**Response:**

```json
{
  "status": "success",
  "data": {
    "withdrawalId": "wd_123",
    "amount": "25.00",
    "asset": "USDC",
    "fee": "0.01",
    "netAmount": "24.99",
    "status": "processing",
    "estimatedCompletion": "2024-01-15T12:30:00Z"
  }
}
```

### Credentials

#### Get User Credentials

```
GET /v1/credentials
```

**Response:**

```json
{
  "status": "success",
  "data": [
    {
      "id": "cred_789",
      "moduleId": "mod_456",
      "moduleTitle": "Understanding Stablecoins",
      "issuedAt": "2024-01-15T10:30:00Z",
      "onChainId": "0x123...",
      "verifiableUrl": "https://verify.learnault.io/cred_789"
    }
  ]
}
```

#### Verify Credential

```
GET /v1/credentials/verify/:onChainId
```

**Response:**

```json
{
  "status": "success",
  "data": {
    "valid": true,
    "credential": {
      "userId": "usr_123",
      "userName": "John Doe",
      "moduleId": "mod_456",
      "moduleTitle": "Understanding Stablecoins",
      "issuedAt": "2024-01-15T10:30:00Z",
      "issuer": "Learnault"
    }
  }
}
```

### Employer Endpoints (B2B)

#### Search Talent

```
GET /v1/employer/search?skills=finance,defi&location=kenya
```

**Authentication:** Requires employer API key

**Response:**

```json
{
  "status": "success",
  "data": [
    {
      "userId": "usr_123",
      "anonymousId": "anon_456", // For privacy until contact
      "skills": [
        {
          "name": "Financial Literacy",
          "level": "advanced",
          "modules": 12,
          "verified": true
        }
      ],
      "matchScore": 95,
      "availableForHire": true
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 47
  }
}
```

## Error Handling

The API uses conventional HTTP response codes:

- `200` - Success
- `201` - Created
- `400` - Bad request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not found
- `429` - Too many requests
- `500` - Internal server error

Error response format:

```json
{
  "status": "error",
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "The requested module was not found",
    "details": {
      "moduleId": "mod_invalid"
    }
  }
}
```

## Rate Limiting

- Public endpoints: 60 requests per minute
- Authenticated endpoints: 120 requests per minute
- Employer endpoints: Based on subscription tier

Rate limit headers:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 58
X-RateLimit-Reset: 1627583492
```

## Webhooks

You can register webhooks to receive real-time events:

- `user.completed_module`
- `reward.issued`
- `credential.verified`

See [Webhook Documentation](./WEBHOOKS.md) for details.

## SDKs

## Support

For API support, please:

- Check our [API status page](https://status.learnault.io)
- Join our [Discord](https://discord.gg) #api channel
- Email: learnault@toneflix.net
