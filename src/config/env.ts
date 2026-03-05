import { config } from 'dotenv';

config();

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
};