# Learnault Webhooks Documentation

Webhooks allow your application to receive real-time notifications about events that happen in the Learnault platform. Instead of polling our API for updates, we'll send HTTP requests to your endpoint when specific events occur.

## Overview

Webhooks are a powerful way to integrate with Learnault and build responsive applications. For example, you could:

- Send a welcome email when a user completes their first module
- Update your CRM when a user earns a credential
- Trigger a payout in your system when a user withdraws funds
- Notify your team when a new employer signs up

## Webhook Events

### Available Events

| Event Type                | Description                                        | Webhook Name          |
| :------------------------ | :------------------------------------------------- | :-------------------- |
| **User Events**           |                                                    |                       |
| `user.created`            | A new user registers                               | `user.created`        |
| `user.verified`           | User verifies their email/wallet                   | `user.verified`       |
| `user.updated`            | User profile is updated                            | `user.updated`        |
| `user.deleted`            | User account is deleted                            | `user.deleted`        |
|                           |                                                    |                       |
| **Learning Events**       |                                                    |                       |
| `module.started`          | User starts a learning module                      | `module.started`      |
| `module.completed`        | User completes a module (passes quiz)              | `module.completed`    |
| `module.failed`           | User fails a module quiz                           | `module.failed`       |
| `milestone.reached`       | User reaches a milestone (10, 50, 100 modules)     | `milestone.reached`   |
|                           |                                                    |                       |
| **Reward Events**         |                                                    |                       |
| `reward.issued`           | Reward is sent to user's wallet                    | `reward.issued`       |
| `reward.withdrawn`        | User withdraws funds from platform                 | `reward.withdrawn`    |
| `reward.failed`           | Reward distribution fails                          | `reward.failed`       |
|                           |                                                    |                       |
| **Credential Events**     |                                                    |                       |
| `credential.issued`       | New credential minted on Stellar                   | `credential.issued`   |
| `credential.verified`     | Someone verifies a credential                      | `credential.verified` |
| `credential.revoked`      | Credential is revoked                              | `credential.revoked`  |
|                           |                                                    |                       |
| **Referral Events**       |                                                    |                       |
| `referral.created`        | User refers a new user                             | `referral.created`    |
| `referral.converted`      | Referred user completes first module               | `referral.converted`  |
| `referral.rewarded`       | Referrer receives bonus reward                     | `referral.rewarded`   |
|                           |                                                    |                       |
| **Employer Events** (B2B) |                                                    |                       |
| `employer.subscribed`     | New employer subscription                          | `employer.subscribed` |
| `employer.searched`       | Employer performs talent search                    | `employer.searched`   |
| `employer.contacted`      | Employer contacts a candidate                      | `employer.contacted`  |
|                           |                                                    |                       |
| **System Events**         |                                                    |                       |
| `webhook.test`            | Test event to verify endpoint                      | `webhook.test`        |
| `webhook.disabled`        | Webhook automatically disabled (too many failures) | `webhook.disabled`    |

## Setting Up Webhooks

### 1. Create Your Endpoint

Your endpoint must be a publicly accessible HTTPS URL that accepts POST requests.

```javascript
// Example Express.js endpoint
app.post('/webhooks/learnault', (req, res) => {
  const event = req.body;

  // Verify signature
  const signature = req.headers['x-learnault-signature'];
  if (!verifySignature(signature, JSON.stringify(event))) {
    return res.status(401).send('Invalid signature');
  }

  // Process event
  switch (event.type) {
    case 'module.completed':
      console.log(
        `User ${event.data.userId} completed module ${event.data.moduleId}`,
      );
      // Your business logic here
      break;
    case 'reward.issued':
      console.log(`Reward issued: ${event.data.amount} ${event.data.asset}`);
      break;
    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  // Acknowledge receipt
  res.status(200).send('Webhook received');
});
```

### 2. Register Your Webhook

#### Via Dashboard (Coming Soon)

1. Log in to the Learnault Partner Dashboard
2. Navigate to Settings > Webhooks
3. Click "Add Webhook"
4. Enter your endpoint URL
5. Select events to subscribe to
6. Copy your signing secret

#### Via API

```
POST /v1/webhooks
Authorization: Bearer <your-api-key>
Content-Type: application/json

{
  "url": "https://yourapp.com/webhooks/learnault",
  "description": "Production webhook",
  "events": ["module.completed", "reward.issued", "credential.issued"],
  "isActive": true,
  "version": "1.0"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "wh_12345",
    "url": "https://yourapp.com/webhooks/learnault",
    "signingSecret": "whsec_abc123def456...", // Save this securely!
    "events": ["module.completed", "reward.issued", "credential.issued"],
    "createdAt": "2024-01-15T10:00:00Z"
  }
}
```

## Webhook Payload Structure

All webhook payloads follow a consistent structure:

```json
{
  "id": "evt_12345abcde",
  "type": "module.completed",
  "created": "2024-01-15T10:30:00Z",
  "version": "1.0",
  "data": {
    // Event-specific data
  }
}
```

### Event-Specific Payloads

#### `module.completed`

```json
{
  "id": "evt_mod_123",
  "type": "module.completed",
  "created": "2024-01-15T10:30:00Z",
  "version": "1.0",
  "data": {
    "userId": "usr_123",
    "userEmail": "user@example.com",
    "moduleId": "mod_456",
    "moduleTitle": "Understanding Stablecoins",
    "moduleCategory": "finance",
    "score": 100,
    "timeSpent": 320,
    "completedAt": "2024-01-15T10:30:00Z",
    "rewardAmount": "0.25",
    "rewardAsset": "USDC",
    "credentialId": "cred_789",
    "onChainCredentialId": "0x123abc..."
  }
}
```

#### `reward.issued`

```json
{
  "id": "evt_rew_123",
  "type": "reward.issued",
  "created": "2024-01-15T10:30:05Z",
  "version": "1.0",
  "data": {
    "userId": "usr_123",
    "userEmail": "user@example.com",
    "amount": "0.25",
    "asset": "USDC",
    "usdValue": "0.25",
    "type": "module_reward",
    "sourceId": "mod_456",
    "sourceType": "module",
    "walletAddress": "GABC...123",
    "transactionHash": "a1b2c3d4e5...",
    "status": "completed",
    "memo": "Reward for completing 'Understanding Stablecoins'"
  }
}
```

#### `credential.issued`

```json
{
  "id": "evt_cred_123",
  "type": "credential.issued",
  "created": "2024-01-15T10:30:10Z",
  "version": "1.0",
  "data": {
    "credentialId": "cred_789",
    "userId": "usr_123",
    "userStellarAddress": "GABC...123",
    "moduleId": "mod_456",
    "moduleTitle": "Understanding Stablecoins",
    "moduleCategory": "finance",
    "issuedAt": "2024-01-15T10:30:00Z",
    "onChainId": "0x123abc...",
    "onChainUrl": "https://stellar.expert/explorer/public/contract/0x123abc...",
    "verifiableUrl": "https://verify.learnault.io/cred_789",
    "metadata": {
      "score": 100,
      "version": "1.0",
      "issuer": "Learnault"
    }
  }
}
```

#### `reward.withdrawn`

```json
{
  "id": "evt_wd_123",
  "type": "reward.withdrawn",
  "created": "2024-01-15T14:20:00Z",
  "version": "1.0",
  "data": {
    "userId": "usr_123",
    "userEmail": "user@example.com",
    "withdrawalId": "wd_123",
    "amount": "25.00",
    "asset": "USDC",
    "usdValue": "25.00",
    "fee": "0.01",
    "netAmount": "24.99",
    "destination": "GA...123", // or mobile money number
    "destinationType": "stellar",
    "status": "completed",
    "transactionHash": "f6e5d4c3b2...",
    "processedAt": "2024-01-15T14:25:00Z"
  }
}
```

#### `user.created`

```json
{
  "id": "evt_user_123",
  "type": "user.created",
  "created": "2024-01-15T09:15:00Z",
  "version": "1.0",
  "data": {
    "userId": "usr_456",
    "email": "newuser@example.com",
    "walletAddress": "GDEF...789",
    "referralCode": "REF123",
    "referredBy": "usr_123", // if applicable
    "country": "KE",
    "createdAt": "2024-01-15T09:15:00Z"
  }
}
```

## Webhook Security

### Signature Verification

All webhook requests include a signature header that you must verify to ensure the request came from Learnault.

**Header:** `X-Learnault-Signature`

The signature is created using HMAC-SHA256 of the request body and your signing secret.

```javascript
// Node.js verification example
const crypto = require('crypto');

function verifySignature(signature, body, secret) {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature),
  );
}

// Usage in Express
app.post('/webhooks/learnault', (req, res) => {
  const signature = req.headers['x-learnault-signature'];
  const body = JSON.stringify(req.body);
  const secret = process.env.LEARNAULT_WEBHOOK_SECRET;

  if (!verifySignature(signature, body, secret)) {
    return res.status(401).send('Invalid signature');
  }

  // Process webhook
  res.status(200).send('OK');
});
```

```python
# Python verification example
import hmac
import hashlib

def verify_signature(signature, body, secret):
    expected = hmac.new(
        key=secret.encode('utf-8'),
        msg=body.encode('utf-8'),
        digestmod=hashlib.sha256
    ).hexdigest()

    return hmac.compare_digest(signature, expected)

# Usage in Flask
@app.route('/webhooks/learnault', methods=['POST'])
def webhook():
    signature = request.headers.get('X-Learnault-Signature')
    body = request.get_data(as_text=True)
    secret = os.environ.get('LEARNAULT_WEBHOOK_SECRET')

    if not verify_signature(signature, body, secret):
        return 'Invalid signature', 401

    # Process webhook
    return 'OK', 200
```

### IP Whitelisting

For additional security, you can whitelist Learnault's IP addresses:

```
Production: 52.85.83.0/27, 54.85.83.0/27
Testnet: 52.85.84.0/27, 54.85.84.0/27
```

### Best Practices

1. **Always verify signatures** - Never skip this step
2. **Use HTTPS** - All webhook URLs must be HTTPS
3. **Respond quickly** - Acknowledge within 5 seconds
4. **Idempotent processing** - Handle duplicate webhooks safely
5. **Store webhook IDs** - Prevent processing the same event twice
6. **Rotate secrets** - Regularly update your signing secret
7. **Monitor failures** - Watch for failed deliveries

## Retry Logic

Webhooks are delivered with an at-least-once guarantee. If your endpoint doesn't acknowledge the webhook (HTTP 2xx), we'll retry with exponential backoff.

### Retry Schedule

| Attempt   | Wait Time  |
| :-------- | :--------- |
| 1st retry | 5 seconds  |
| 2nd retry | 30 seconds |
| 3rd retry | 5 minutes  |
| 4th retry | 30 minutes |
| 5th retry | 2 hours    |
| 6th retry | 6 hours    |
| 7th retry | 12 hours   |
| 8th retry | 24 hours   |

After 8 failed attempts, the webhook is automatically disabled and you'll receive an email notification.

### Handling Failures

Design your endpoint to handle retries gracefully:

```javascript
app.post('/webhooks/learnault', async (req, res) => {
  const eventId = req.body.id;

  // Check if already processed
  if (await hasBeenProcessed(eventId)) {
    return res.status(200).send('Already processed');
  }

  try {
    // Process event
    await processEvent(req.body);

    // Mark as processed
    await markAsProcessed(eventId);

    res.status(200).send('OK');
  } catch (error) {
    // Log error but still return 200 to prevent retry?
    // Or return 500 to trigger retry?
    // Choose based on error type

    if (error.isTransient) {
      // Temporary issue, trigger retry
      res.status(500).send('Try again');
    } else {
      // Permanent failure, accept and log
      await logFailure(eventId, error);
      res.status(200).send('Accepted with errors');
    }
  }
});
```

## Managing Webhooks

### List Webhooks

```
GET /v1/webhooks
```

### Update Webhook

```
PATCH /v1/webhooks/:webhookId
{
  "events": ["module.completed", "reward.issued"],
  "isActive": true
}
```

### Delete Webhook

```
DELETE /v1/webhooks/:webhookId
```

### Test Webhook

Send a test event to verify your endpoint:

```
POST /v1/webhooks/:webhookId/test
{
  "event": "webhook.test"
}
```

## Rate Limits

- Maximum 10 webhooks per account
- Maximum 100 events per second per webhook
- Maximum payload size: 1MB

## Troubleshooting

### Common Issues

| Issue                  | Solution                                                                |
| :--------------------- | :---------------------------------------------------------------------- |
| **Signature mismatch** | Verify you're using the correct signing secret and the raw request body |
| **Timeout**            | Your endpoint must respond within 5 seconds                             |
| **Too many retries**   | Check for permanent errors causing repeated failures                    |
| **Missing events**     | Verify you've subscribed to the correct event types                     |
| **Duplicate events**   | Implement idempotency using event IDs                                   |

### Debugging

Enable debug mode to see webhook delivery logs:

```
GET /v1/webhooks/:webhookId/logs?limit=50
```

Response:

```json
{
  "status": "success",
  "data": [
    {
      "eventId": "evt_123",
      "eventType": "module.completed",
      "attempt": 1,
      "status": "delivered",
      "responseCode": 200,
      "responseTime": 350,
      "timestamp": "2024-01-15T10:30:15Z"
    },
    {
      "eventId": "evt_124",
      "eventType": "reward.issued",
      "attempt": 1,
      "status": "failed",
      "responseCode": 500,
      "error": "Connection timeout",
      "timestamp": "2024-01-15T10:31:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 47
  }
}
```

## Examples

### Example: Send Welcome Email on Module Completion

```javascript
// Using Node.js with SendGrid
app.post('/webhooks/learnault', async (req, res) => {
  const event = req.body;

  if (event.type === 'module.completed') {
    const { userId, userEmail, moduleTitle, score } = event.data;

    // Check if this is their first completion
    if (await isFirstCompletion(userId)) {
      // Send welcome email
      await sendWelcomeEmail(userEmail, moduleTitle, score);
    }
  }

  res.status(200).send('OK');
});

async function sendWelcomeEmail(email, moduleTitle, score) {
  const msg = {
    to: email,
    from: 'hello@learnault.io',
    subject: 'Congratulations on your first module! 🎉',
    html: `
      <h1>Great job!</h1>
      <p>You've completed "${moduleTitle}" with a score of ${score}%.</p>
      <p>Your reward has been sent to your wallet. Keep learning to earn more!</p>
      <a href="https://learnault.io/learn">Continue Learning →</a>
    `,
  };

  await sgMail.send(msg);
}
```

### Example: Update External Database

```python
# Using Flask with SQLAlchemy
@app.route('/webhooks/learnault', methods=['POST'])
def webhook():
    event = request.json

    if event['type'] == 'credential.issued':
        data = event['data']

        # Update external database
        user = ExternalUser.query.filter_by(
            learnault_id=data['userId']
        ).first()

        if user:
            user.credentials.append({
                'id': data['credentialId'],
                'title': data['moduleTitle'],
                'issued_at': data['issuedAt'],
                'on_chain_id': data['onChainId']
            })
            db.session.commit()

    return 'OK', 200
```

## Support

For webhook-related issues:

- **Documentation**: [https://docs.learnault.io/webhooks](https://docs.learnault.io/webhooks)
- **Discord**: #webhooks channel
- **Email**: learnault@toneflix.net
- **Status Page**: [https://status.learnault.io](https://status.learnault.io)

---

**Version:** 1.0 | **Last Updated:** February 2026 | **Next Review:** Quarterly
