import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { generalLimiter, authLimiter, employerLimiter, authenticatedLimiter, dynamicRateLimiter } from '../../src/middleware/rate-limit.middleware';

// Mock the env
vi.mock('../../src/config/env', () => ({
  env: {
    RATE_LIMIT_GENERAL_WINDOW_MS: 900000, // 15 min
    RATE_LIMIT_GENERAL_MAX: 100,
    RATE_LIMIT_AUTH_WINDOW_MS: 900000,
    RATE_LIMIT_AUTH_MAX: 10,
    RATE_LIMIT_EMPLOYER_WINDOW_MS: 900000,
    RATE_LIMIT_EMPLOYER_MAX: 500,
    RATE_LIMIT_AUTHENTICATED_WINDOW_MS: 900000,
    RATE_LIMIT_AUTHENTICATED_MAX: 1000,
  },
}));

describe('Rate Limiting Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockReq = {
      headers: {},
      connection: { remoteAddress: '127.0.0.1' },
      socket: { remoteAddress: '127.0.0.1' },
      originalUrl: '/test',
    };
    mockRes = {
      set: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    mockNext = vi.fn();
  });

  describe('General Limiter', () => {
    it('should allow requests within limit', () => {
      for (let i = 0; i < 100; i++) {
        generalLimiter(mockReq as Request, mockRes as Response, mockNext);
      }
      expect(mockNext).toHaveBeenCalledTimes(100);
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should block requests over limit', () => {
      for (let i = 0; i < 101; i++) {
        generalLimiter(mockReq as Request, mockRes as Response, mockNext);
      }
      expect(mockNext).toHaveBeenCalledTimes(100);
      expect(mockRes.status).toHaveBeenCalledWith(429);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Too many requests, please try again later.' });
    });

    it('should set correct headers', () => {
      generalLimiter(mockReq as Request, mockRes as Response, mockNext);
      expect(mockRes.set).toHaveBeenCalledWith({
        'X-RateLimit-Limit': '100',
        'X-RateLimit-Remaining': '99',
        'X-RateLimit-Reset': expect.any(String),
      });
    });
  });

  describe('Auth Limiter', () => {
    it('should have stricter limits', () => {
      for (let i = 0; i < 11; i++) {
        authLimiter(mockReq as Request, mockRes as Response, mockNext);
      }
      expect(mockNext).toHaveBeenCalledTimes(10);
      expect(mockRes.status).toHaveBeenCalledWith(429);
    });
  });

  describe('Employer Limiter', () => {
    it('should have higher limits', () => {
      for (let i = 0; i < 500; i++) {
        employerLimiter(mockReq as Request, mockRes as Response, mockNext);
      }
      expect(mockNext).toHaveBeenCalledTimes(500);
      expect(mockRes.status).not.toHaveBeenCalled();
    });
  });

  describe('Authenticated Limiter', () => {
    it('should have high limits', () => {
      for (let i = 0; i < 1000; i++) {
        authenticatedLimiter(mockReq as Request, mockRes as Response, mockNext);
      }
      expect(mockNext).toHaveBeenCalledTimes(1000);
      expect(mockRes.status).not.toHaveBeenCalled();
    });
  });

  describe('Dynamic Rate Limiter', () => {
    it('should use general limiter for unauthenticated', () => {
      dynamicRateLimiter(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should use authenticated limiter for authenticated users', () => {
      (mockReq as any).user = { role: 'user' };
      dynamicRateLimiter(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should use employer limiter for employers', () => {
      (mockReq as any).user = { role: 'employer' };
      dynamicRateLimiter(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });
  });
});