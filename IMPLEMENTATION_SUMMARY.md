# Implementation Summary: Request Context, Health Checks, and Graceful Shutdown

## Overview
This implementation adds request correlation, comprehensive health monitoring, and safe process shutdown to the Learnault API, fulfilling Phase 0 infrastructure requirements.

## Features Implemented

### 1. Request Context Middleware (`src/middleware/request-context.ts`)
- **Request ID Generation**: Automatically generates UUID for each request or uses client-provided `x-request-id` header
- **Request ID Propagation**: Returns request ID in response headers for correlation
- **Actor Context**: Attaches authenticated user context (id, role, email) without logging secrets
- **Request Timing**: Tracks request duration for performance monitoring
- **Automatic Logging**: Logs request completion with duration, status, actor, and correlation ID

**Usage Example**:
```typescript
// Request ID is automatically generated and attached to req.requestId
// Access it in route handlers:
const requestId = getRequestId(req);
const actor = getActor(req);
```

### 2. Health Check Endpoints (`src/routes/health.routes.ts`)

#### Liveness Endpoint: `/health/live`
- Returns HTTP 200 if the process is running
- Used by orchestrators (Kubernetes, Docker Swarm) to detect crashed processes
- Fast, simple check with no dependencies

**Example Response**:
```json
{
  "status": "ok",
  "timestamp": "2026-07-21T18:57:04.123Z"
}
```

#### Readiness Endpoint: `/health/ready`
- Returns HTTP 200 when service can handle traffic
- Returns HTTP 503 if dependencies are unhealthy
- Checks database connectivity
- Extensible for additional dependency checks (cache, external APIs, etc.)

**Healthy Response** (HTTP 200):
```json
{
  "status": "ready",
  "timestamp": "2026-07-21T18:57:04.123Z",
  "checks": {
    "database": "ok"
  }
}
```

**Unhealthy Response** (HTTP 503):
```json
{
  "status": "not ready",
  "timestamp": "2026-07-21T18:57:04.123Z",
  "checks": {
    "database": "error"
  },
  "errors": [
    "Database connection failed: Connection refused"
  ]
}
```

### 3. Graceful Shutdown (`src/server.ts`)
Handles SIGTERM, SIGINT, uncaught exceptions, and unhandled rejections with graceful cleanup:

1. **Stop accepting new connections**: HTTP server closes immediately
2. **Stop background jobs**: Clears lifecycle sweep interval
3. **Close database connections**: Prisma $disconnect()
4. **Enforce timeout**: Forces exit if shutdown exceeds configured deadline (default 30s)
5. **Prevent duplicate shutdown**: Guards against multiple shutdown signals

**Configuration**:
```bash
# .env
SHUTDOWN_TIMEOUT_MS=30000  # 30 seconds default
```

### 4. Enhanced Logger (`src/config/logger.ts`)
- **Production Mode**: JSON format for log aggregation (ELK, CloudWatch, etc.)
- **Development Mode**: Human-readable colored output
- **Error Stack Traces**: Automatically captured and formatted
- **Request Correlation**: All logs include request ID and actor context
- **Configurable Level**: Set via `LOG_LEVEL` environment variable

**Log Levels**: error, warn, info, http, verbose, debug, silly

### 5. Error Middleware Updates (`src/middleware/error.middleware.ts`)
- Includes `requestId` in all error responses
- Logs errors with request correlation data
- Includes actor context in error logs

**Example Error Response**:
```json
{
  "success": false,
  "error": {
    "message": "Resource not found",
    "code": 404
  },
  "requestId": "550e8400-e29b-41d4-a716-446655440000"
}
```

## Configuration

### Environment Variables
```bash
# Logging
LOG_LEVEL=info  # error, warn, info, http, verbose, debug, silly

# Graceful Shutdown
SHUTDOWN_TIMEOUT_MS=30000  # Maximum time to wait for graceful shutdown
```

## Testing

### Test Scripts
Run the provided test scripts to verify health endpoints:

**Windows**:
```cmd
scripts\test-health.bat http://localhost:5000
```

**Unix/Linux**:
```bash
./scripts/test-health.sh http://localhost:5000
```

### Unit Tests
- ✅ Request context middleware (17 tests)
- ✅ Health routes (9 tests)
- ✅ Graceful shutdown (6 tests)
- ✅ All existing tests pass (423 passed, 3 skipped)

## Benefits

### 1. Observability
- Every request and error is correlatable via request ID
- Performance tracking with request duration
- Actor attribution for audit trails
- Structured logging for easy parsing and searching

### 2. Reliability
- Readiness checks prevent traffic to unhealthy instances
- Liveness checks enable automatic restarts
- Graceful shutdown prevents data loss and connection leaks
- Configurable timeout prevents hanging processes

### 3. Operations
- Zero-downtime deployments with readiness checks
- Easy troubleshooting with correlated logs
- Monitoring-ready with standardized health endpoints
- Container orchestration compatibility (Kubernetes, ECS, etc.)

## Usage Examples

### Kubernetes Probes
```yaml
apiVersion: v1
kind: Pod
spec:
  containers:
  - name: learnault-api
    livenessProbe:
      httpGet:
        path: /health/live
        port: 5000
      initialDelaySeconds: 10
      periodSeconds: 30
    readinessProbe:
      httpGet:
        path: /health/ready
        port: 5000
      initialDelaySeconds: 5
      periodSeconds: 10
```

### Docker Compose
```yaml
services:
  api:
    image: learnault-api:latest
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:5000/health/ready"]
      interval: 10s
      timeout: 3s
      retries: 3
      start_period: 30s
```

### Log Correlation Example
```json
{
  "timestamp": "2026-07-21T18:57:04.123Z",
  "level": "info",
  "message": "Request completed",
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "method": "POST",
  "path": "/api/v1/auth/login",
  "statusCode": 200,
  "duration": "145ms",
  "actor": "learner:user-123",
  "ip": "192.168.1.100"
}
```

## Next Steps
- Add metrics endpoint for Prometheus/Grafana
- Implement distributed tracing (OpenTelemetry)
- Add Redis/cache readiness checks
- Implement circuit breakers for external dependencies
- Add request rate limiting with correlation

## Verification Checklist
- [x] Build passes without errors
- [x] All tests pass (423 passed)
- [x] ESLint passes with no errors
- [x] Request IDs are generated and propagated
- [x] Health endpoints return correct responses
- [x] Graceful shutdown completes within timeout
- [x] Logs include correlation data
- [x] Error responses include request IDs
- [x] Changes committed to git
