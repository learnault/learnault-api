import { Request, Response, NextFunction } from 'express'

export interface DeprecationOptions {
  sunsetDate?: string
  docUrl?: string
}

/**
 * Middleware that sets standard API versioning response headers (X-API-Version: v1)
 */
export const apiVersionHeader = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  res.setHeader('X-API-Version', 'v1')
  next()
}

/**
 * Helper utility to attach RFC 8594 deprecation headers to a response
 */
export const setDeprecationHeaders = (
  res: Response,
  options: DeprecationOptions = {}
): void => {
  res.setHeader('Deprecation', 'true')

  if (options.sunsetDate) {
    res.setHeader('Sunset', options.sunsetDate)
  }

  if (options.docUrl) {
    res.setHeader('Link', `<${options.docUrl}>; rel="sunset"`)
  }
}

/**
 * Middleware factory to mark an endpoint or router as deprecated
 */
export const deprecatedEndpoint = (options: DeprecationOptions = {}) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    setDeprecationHeaders(res, options)
    next()
  }
}
