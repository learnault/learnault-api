import { config } from 'dotenv'

config()

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3000', 10),

  // Rate limiting configurations
  RATE_LIMIT_GENERAL_WINDOW_MS: parseInt(process.env.RATE_LIMIT_GENERAL_WINDOW_MS || '900000', 10), // 15 minutes
  RATE_LIMIT_GENERAL_MAX: parseInt(process.env.RATE_LIMIT_GENERAL_MAX || '100', 10),

  RATE_LIMIT_AUTH_WINDOW_MS: parseInt(process.env.RATE_LIMIT_AUTH_WINDOW_MS || '900000', 10), // 15 minutes
  RATE_LIMIT_AUTH_MAX: parseInt(process.env.RATE_LIMIT_AUTH_MAX || '10', 10),

  RATE_LIMIT_EMPLOYER_WINDOW_MS: parseInt(process.env.RATE_LIMIT_EMPLOYER_WINDOW_MS || '900000', 10), // 15 minutes
  RATE_LIMIT_EMPLOYER_MAX: parseInt(process.env.RATE_LIMIT_EMPLOYER_MAX || '500', 10),

  RATE_LIMIT_AUTHENTICATED_WINDOW_MS: parseInt(process.env.RATE_LIMIT_AUTHENTICATED_WINDOW_MS || '900000', 10), // 15 minutes
  RATE_LIMIT_AUTHENTICATED_MAX: parseInt(process.env.RATE_LIMIT_AUTHENTICATED_MAX || '1000', 10),

  // Avatar upload & storage
  S3_BUCKET: process.env.S3_BUCKET || '',
  AWS_REGION: process.env.AWS_REGION || 'us-east-1',
  AVATAR_MAX_SIZE_BYTES: parseInt(process.env.AVATAR_MAX_SIZE_BYTES || '5242880', 10), // 5MB
  INTENT_TTL_SECONDS: parseInt(process.env.INTENT_TTL_SECONDS || '900', 10), // 15 minutes

  // ClamAV malware scanner
  CLAMAV_HOST: process.env.CLAMAV_HOST || '',
  CLAMAV_PORT: process.env.CLAMAV_PORT || '3310',
}