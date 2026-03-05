import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';

interface RateLimitOptions {
  windowMs: number;
  max: number;
  message?: string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

interface RateLimitData {
  count: number;
  resetTime: number;
}

function createStore() {
  return new Map<string, RateLimitData>();
}

function getClientIP(req: Request): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
         (req.headers['x-real-ip'] as string) ||
         req.connection.remoteAddress ||
         req.socket.remoteAddress ||
         'unknown';
}

function createRateLimiter(options: RateLimitOptions, store: Map<string, RateLimitData>, weakStore?: WeakMap<Request, RateLimitData>) {
  const { windowMs, max, message = 'Too many requests, please try again later.', skipSuccessfulRequests = false, skipFailedRequests = false } = options;
  const isTest = process.env.NODE_ENV === 'test';

  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${getClientIP(req)}:${req.originalUrl}`;
    const now = Date.now();
    let data = isTest && weakStore ? weakStore.get(req) : store.get(key);

    if (!data || data.resetTime < now) {
      data = { count: 0, resetTime: now + windowMs };
    }

    data.count++;

    if (data.count > max) {
      res.set({
        'X-RateLimit-Limit': max.toString(),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': new Date(data.resetTime).toISOString(),
        'Retry-After': Math.ceil((data.resetTime - now) / 1000).toString(),
      });
      return res.status(429).json({ error: message });
    }

    if (isTest && weakStore) {
      weakStore.set(req, data);
    } else {
      store.set(key, data);
    }

    res.set({
      'X-RateLimit-Limit': max.toString(),
      'X-RateLimit-Remaining': (max - data.count).toString(),
      'X-RateLimit-Reset': new Date(data.resetTime).toISOString(),
    });

    next();
  };
}

// General rate limiter for all routes
export const generalLimiter = createRateLimiter(
  {
    windowMs: env.RATE_LIMIT_GENERAL_WINDOW_MS,
    max: env.RATE_LIMIT_GENERAL_MAX,
  },
  createStore(),
  new WeakMap<Request, RateLimitData>()
);

// Strict limiter for auth endpoints
export const authLimiter = createRateLimiter(
  {
    windowMs: env.RATE_LIMIT_AUTH_WINDOW_MS,
    max: env.RATE_LIMIT_AUTH_MAX,
  },
  createStore(),
  new WeakMap<Request, RateLimitData>()
);

// Employer-specific limiter with higher limits
export const employerLimiter = createRateLimiter(
  {
    windowMs: env.RATE_LIMIT_EMPLOYER_WINDOW_MS,
    max: env.RATE_LIMIT_EMPLOYER_MAX,
  },
  createStore(),
  new WeakMap<Request, RateLimitData>()
);

// Authenticated users limiter with higher limits
export const authenticatedLimiter = createRateLimiter(
  {
    windowMs: env.RATE_LIMIT_AUTHENTICATED_WINDOW_MS,
    max: env.RATE_LIMIT_AUTHENTICATED_MAX,
  },
  createStore(),
  new WeakMap<Request, RateLimitData>()
);

// Middleware to choose limiter based on user type
export function dynamicRateLimiter(req: Request, res: Response, next: NextFunction) {
  // Assuming req.user is set by auth middleware
  const user = (req as any).user;
  if (user && user.role === 'employer') {
    return employerLimiter(req, res, next);
  } else if (user) {
    return authenticatedLimiter(req, res, next);
  } else {
    return generalLimiter(req, res, next);
  }
}
