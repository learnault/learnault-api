import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import {
  errorHandler,
  notFoundHandler,
  asyncHandler,
} from '../src/middleware/error.middleware';
import {
  AppError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
  InternalServerError,
} from '../src/utils/errors';
import logger from '../src/config/logger';

// Mock the logger
vi.mock('../src/config/logger', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

// Mock the env config
vi.mock('../src/config/env', () => ({
  env: {
    NODE_ENV: 'development',
    PORT: 3000,
  },
}));

describe('Error Handling Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response<unknown>>;
  let mockNext: MockInstance;
  // ReturnType<typeof vi.fn> satisfies Express's strict method signatures
  // by letting TypeScript infer the call signatures from the mock factory.
  let jsonMock: ReturnType<typeof vi.fn>;
  let statusMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    jsonMock = vi.fn().mockReturnValue({});
    statusMock = vi.fn().mockReturnValue({ json: jsonMock });

    mockRequest = {
      path: '/api/test',
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    };

    mockResponse = {
      status: statusMock as unknown as Response['status'],
      json: jsonMock as unknown as Response['json'],
    };

    mockNext = vi.fn();
  });

  describe('AppError Class', () => {
    it('should create an AppError with proper properties', () => {
      const error = new AppError('Test error', 400);
      expect(error.message).toBe('Test error');
      expect(error.statusCode).toBe(400);
      expect(error.isOperational).toBe(true);
      expect(error.name).toBe('AppError');
    });

    it('should set default status code to 500', () => {
      const error = new AppError('Test error');
      expect(error.statusCode).toBe(500);
    });

    it('should maintain stack trace', () => {
      const error = new AppError('Test error');
      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('AppError');
    });
  });

  describe('Custom Error Classes', () => {
    it('should create BadRequestError with 400 status', () => {
      const error = new BadRequestError('Invalid input');
      expect(error.statusCode).toBe(400);
      expect(error.message).toBe('Invalid input');
    });

    it('should create UnauthorizedError with 401 status', () => {
      const error = new UnauthorizedError('Not authenticated');
      expect(error.statusCode).toBe(401);
      expect(error.message).toBe('Not authenticated');
    });

    it('should create ForbiddenError with 403 status', () => {
      const error = new ForbiddenError('No access');
      expect(error.statusCode).toBe(403);
      expect(error.message).toBe('No access');
    });

    it('should create NotFoundError with 404 status', () => {
      const error = new NotFoundError('User not found');
      expect(error.statusCode).toBe(404);
      expect(error.message).toBe('User not found');
    });

    it('should create ConflictError with 409 status', () => {
      const error = new ConflictError('Email already exists');
      expect(error.statusCode).toBe(409);
      expect(error.message).toBe('Email already exists');
    });

    it('should create ValidationError with 422 status and errors', () => {
      const errors = {
        email: ['Invalid email format'],
        password: ['Password too short'],
      };
      const error = new ValidationError('Validation failed', errors);
      expect(error.statusCode).toBe(422);
      expect(error.errors).toEqual(errors);
    });

    it('should create InternalServerError with 500 status', () => {
      const error = new InternalServerError('Database connection failed');
      expect(error.statusCode).toBe(500);
      expect(error.isOperational).toBe(false);
    });
  });

  describe('errorHandler Middleware', () => {
    it('should handle AppError with correct status code', () => {
      const error = new BadRequestError('Invalid input');
      errorHandler(
        error,
        mockRequest as Request,
        mockResponse as Response,
        mockNext as unknown as NextFunction,
      );

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalled();
    });

    it('should return consistent error response format', () => {
      const error = new NotFoundError('User not found');
      errorHandler(
        error,
        mockRequest as Request,
        mockResponse as Response,
        mockNext as unknown as NextFunction,
      );

      const response = jsonMock.mock.calls[0][0];
      expect(response).toHaveProperty('success', false);
      expect(response).toHaveProperty('error');
      expect(response.error).toHaveProperty('message');
      expect(response.error).toHaveProperty('code');
    });

    it('should handle regular Error by converting to InternalServerError', () => {
      const error = new Error('Something went wrong');
      errorHandler(
        error,
        mockRequest as Request,
        mockResponse as Response,
        mockNext as unknown as NextFunction,
      );

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(logger.error).toHaveBeenCalled();
    });

    it('should include stack trace in development mode', () => {
      const error = new AppError('Test error', 400);
      errorHandler(
        error,
        mockRequest as Request,
        mockResponse as Response,
        mockNext as unknown as NextFunction,
      );

      const response = jsonMock.mock.calls[0][0];
      expect(response.error).toHaveProperty('stack');
    });

    it('should include request context in development mode', () => {
      const error = new AppError('Test error', 400);
      errorHandler(
        error,
        mockRequest as Request,
        mockResponse as Response,
        mockNext as unknown as NextFunction,
      );

      const response = jsonMock.mock.calls[0][0];
      expect(response.error).toHaveProperty('request');
      expect(response.error.request).toHaveProperty('method');
      expect(response.error.request).toHaveProperty('path');
    });

    it('should include validation errors in response', () => {
      const validationErrors = {
        email: ['Invalid email'],
      };
      const error = new ValidationError('Validation failed', validationErrors);
      errorHandler(
        error,
        mockRequest as Request,
        mockResponse as Response,
        mockNext as unknown as NextFunction,
      );

      const response = jsonMock.mock.calls[0][0];
      expect(response.error).toHaveProperty('details');
      expect(response.error.details).toEqual(validationErrors);
    });

    it('should log error with correct information', () => {
      const error = new AppError('Test error', 500);
      errorHandler(
        error,
        mockRequest as Request,
        mockResponse as Response,
        mockNext as unknown as NextFunction,
      );

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Test error',
          path: '/api/test',
          method: 'GET',
        })
      );
    });

    it('should set correct status code for default 500 errors', () => {
      const error = new Error('Unhandled error');
      errorHandler(
        error,
        mockRequest as Request,
        mockResponse as Response,
        mockNext as unknown as NextFunction,
      );

      expect(statusMock).toHaveBeenCalledWith(500);
    });
  });

  describe('notFoundHandler Middleware', () => {
    it('should call next with NotFoundError', () => {
      notFoundHandler(
        mockRequest as Request,
        mockResponse as Response,
        mockNext as unknown as NextFunction,
      );

      const errorArg = mockNext.mock.calls[0][0];
      expect(errorArg).toBeInstanceOf(NotFoundError);
    });

    it('should include correct path and method in error message', () => {
      notFoundHandler(
        mockRequest as Request,
        mockResponse as Response,
        mockNext as unknown as NextFunction,
      );

      const error = mockNext.mock.calls[0][0];
      expect(error.message).toContain('GET');
      expect(error.message).toContain('/api/test');
    });

    it('should log warning when route not found', () => {
      notFoundHandler(
        mockRequest as Request,
        mockResponse as Response,
        mockNext as unknown as NextFunction,
      );

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Not Found',
          path: '/api/test',
          method: 'GET',
        })
      );
    });

    it('should have correct error status code', () => {
      notFoundHandler(
        mockRequest as Request,
        mockResponse as Response,
        mockNext as unknown as NextFunction,
      );

      const error = mockNext.mock.calls[0][0];
      expect(error.statusCode).toBe(404);
    });
  });

  describe('asyncHandler Wrapper', () => {
    it('should execute async handler successfully', async () => {
      const asyncFn = vi.fn(async (req, res, next) => {
        res.json({ success: true });
      });

      const wrappedFn = asyncHandler(asyncFn);
      wrappedFn(
        mockRequest as Request,
        mockResponse as Response,
        mockNext as unknown as NextFunction,
      );

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(asyncFn).toHaveBeenCalled();
    });

    it('should catch promise rejections', async () => {
      const error = new Error('Async error');
      const asyncFn = vi.fn(async (req, res, next) => {
        throw error;
      });

      const wrappedFn = asyncHandler(asyncFn);
      wrappedFn(
        mockRequest as Request,
        mockResponse as Response,
        mockNext as unknown as NextFunction,
      );

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockNext).toHaveBeenCalledWith(error);
    });

    it('should log error when async handler fails', async () => {
      const error = new Error('Database error');
      const asyncFn = vi.fn(async () => {
        throw error;
      });

      const wrappedFn = asyncHandler(asyncFn);
      wrappedFn(
        mockRequest as Request,
        mockResponse as Response,
        mockNext as unknown as NextFunction,
      );

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Async error caught',
          error: 'Database error',
        })
      );
    });

    it('should preserve request and response context', async () => {
      const asyncFn = vi.fn(async (req, res) => {
        expect(req.path).toBe('/api/test');
        res.json({ success: true });
      });

      const wrappedFn = asyncHandler(asyncFn);
      wrappedFn(
        mockRequest as Request,
        mockResponse as Response,
        mockNext as unknown as NextFunction,
      );

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(asyncFn).toHaveBeenCalled();
    });
  });

  describe('Error Response Format Consistency', () => {
    const testErrorScenarios = [
      {
        name: 'BadRequestError',
        error: new BadRequestError('Invalid email'),
        expectedStatus: 400,
      },
      {
        name: 'UnauthorizedError',
        error: new UnauthorizedError('Invalid token'),
        expectedStatus: 401,
      },
      {
        name: 'ForbiddenError',
        error: new ForbiddenError('Insufficient permissions'),
        expectedStatus: 403,
      },
      {
        name: 'NotFoundError',
        error: new NotFoundError('User not found'),
        expectedStatus: 404,
      },
      {
        name: 'ConflictError',
        error: new ConflictError('Duplicate entry'),
        expectedStatus: 409,
      },
      {
        name: 'ValidationError',
        error: new ValidationError('Invalid data', { field: ['error'] }),
        expectedStatus: 422,
      },
    ];

    testErrorScenarios.forEach(({ name, error, expectedStatus }) => {
      it(`should format ${name} response correctly`, () => {
        errorHandler(
          error,
          mockRequest as Request,
          mockResponse as Response,
          mockNext as unknown as NextFunction,
        );

        expect(statusMock).toHaveBeenCalledWith(expectedStatus);

        const response = jsonMock.mock.calls[0][0];
        expect(response).toHaveProperty('success', false);
        expect(response.error).toHaveProperty('message');
        expect(response.error).toHaveProperty('code');
      });
    });
  });
});