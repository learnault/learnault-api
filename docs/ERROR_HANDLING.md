# Error Handling Guide

## Overview

The error handling system provides centralized, consistent error handling across the Learnault API. It includes custom error classes, middleware for catching and formatting errors, and a wrapper for async handlers.

## Error Classes

### Available Error Classes

All error classes extend the base `AppError` class and return appropriate HTTP status codes:

- **AppError** (base class, 500)
  - Custom error class for application-level errors
  - Supports operational vs. unexpected errors
- **BadRequestError** (400)
  - Invalid client input or request
- **UnauthorizedError** (401)
  - Missing or invalid authentication
- **ForbiddenError** (403)
  - User lacks permissions for the action
- **NotFoundError** (404)
  - Requested resource does not exist
- **ConflictError** (409)
  - Resource conflict (e.g., duplicate email)
- **ValidationError** (422)
  - Input validation failures with detailed error messages
- **InternalServerError** (500)
  - Unexpected server errors

## Usage Examples

### Basic Error Throwing

```typescript
import {
  NotFoundError,
  BadRequestError,
  ValidationError,
} from '../utils/errors'

// In a controller
export const getUserById = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const { id } = req.params

  // Validate input
  if (!id) {
    throw new BadRequestError('User ID is required')
  }

  const user = await User.findById(id)

  // Handle not found
  if (!user) {
    throw new NotFoundError('User not found')
  }

  res.json(user)
}
```

### Validation Errors

```typescript
import { ValidationError } from '../utils/errors'

export const createUser = async (req: Request, res: Response) => {
  const { email, password } = req.body
  const errors: Record<string, string[]> = {}

  if (!email || !/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
    errors.email = ['Invalid email format']
  }

  if (!password || password.length < 8) {
    errors.password = ['Password must be at least 8 characters']
  }

  if (Object.keys(errors).length > 0) {
    throw new ValidationError('Validation failed', errors)
  }

  // Create user...
}
```

### Conflict Errors

```typescript
import { ConflictError } from '../utils/errors'

export const registerUser = async (req: Request, res: Response) => {
  const existingUser = await User.findByEmail(req.body.email)

  if (existingUser) {
    throw new ConflictError('Email already registered')
  }

  // Register user...
}
```

### Async Handler Usage

```typescript
import { asyncHandler } from '../middleware/error.middleware'

router.get(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id)
    if (!user) {
      throw new NotFoundError('User not found')
    }
    res.json(user)
  }),
)
```

## Middleware Setup

The error handling middleware is already configured in `src/app.ts`:

```typescript
// 404 handler - must be after all routes
app.use(notFoundHandler)

// Global error handler - must be last
app.use(errorHandler)
```

**Important:** The `notFoundHandler` and `errorHandler` must be registered as the last middleware in the application.

## Error Response Format

### Success Response

```json
{
  "success": true,
  "data": {
    /* response data */
  }
}
```

### Error Response (Production)

```json
{
  "success": false,
  "error": {
    "message": "User not found",
    "code": 404
  }
}
```

### Error Response (Development)

```json
{
  "success": false,
  "error": {
    "message": "User not found",
    "code": 404,
    "stack": [
      "NotFoundError: User not found",
      "at Array.getUserById [as handler] (/path/to/controller.ts:25:11)",
      "..."
    ],
    "request": {
      "method": "GET",
      "path": "/api/users/123",
      "headers": {
        /* request headers */
      }
    }
  }
}
```

### Validation Error Response

```json
{
  "success": false,
  "error": {
    "message": "Validation failed",
    "code": 422,
    "details": {
      "email": ["Invalid email format"],
      "password": ["Password too short"]
    }
  }
}
```

## Best Practices

### 1. Throw Errors Instead of Handling in Controllers

❌ **Don't do this:**

```typescript
export const getUser = (req: Request, res: Response) => {
  const user = await User.findById(req.params.id)
  if (!user) {
    return res.status(404).json({ error: 'Not found' })
  }
  res.json(user)
}
```

✅ **Do this:**

```typescript
export const getUser = async (req: Request, res: Response) => {
  const user = await User.findById(req.params.id)
  if (!user) {
    throw new NotFoundError('User not found')
  }
  res.json(user)
}
```

### 2. Use asyncHandler for Async Routes

❌ **Don't do this:**

```typescript
router.post('/users', (req, res, next) => {
  createUser(req.body)
    .then((user) => res.json(user))
    .catch(next) // Redundant error handling
})
```

✅ **Do this:**

```typescript
router.post(
  '/users',
  asyncHandler(async (req, res) => {
    const user = await createUser(req.body)
    res.json(user)
  }),
)
```

### 3. Choose Appropriate Error Types

- Use `BadRequestError` for input validation
- Use `UnauthorizedError` for authentication issues
- Use `ForbiddenError` for authorization failures
- Use `NotFoundError` for missing resources
- Use `ConflictError` for duplicate/conflict scenarios

### 4. Log Errors Appropriately

Errors are automatically logged with:

- Error message
- Stack trace (development only)
- Request path and method
- Timestamp

Don't duplicate logging in your controllers.

### 5. Development vs Production

In **development** mode:

- Full stack traces are included
- Request headers and body preview included
- All error details visible

In **production** mode:

- Stack traces are hidden
- Generic messages for operational errors
- Minimal information to prevent information leakage

## Troubleshooting

### Errors Not Being Caught

Make sure you're either:

1. Using `asyncHandler` wrapper for async routes, OR
2. Calling `next(error)` explicitly for synchronous errors

### Status Code Not Changing

Verify the correct error class is being thrown:

- Check the error extends `AppError`
- Confirm the statusCode parameter is correct
- Ensure error is being thrown (not just created)

### Stack Trace Not Showing in Development

Set `NODE_ENV=development` in your `.env` file:

```txt
NODE_ENV=development
```

## Testing Error Handling

See `tests/error.middleware.test.ts` for comprehensive test examples including:

- Testing error classes
- Testing middleware behavior
- Testing async error handling
- Testing response formats
- Testing environment-specific behavior
