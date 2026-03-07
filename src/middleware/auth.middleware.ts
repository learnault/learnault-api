import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export type UserRole = 'learner' | 'employer';

export interface JwtPayload {
     id: string;
     email: string;
     role: UserRole;
     iat?: number;
     exp?: number;
}

declare global {
     namespace Express {
          interface Request {
               user?: JwtPayload;
          }
     }
}

const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  return secret;
};

/**
 * Strict authentication — rejects requests without a valid JWT.
 */
export const authenticate = (
     req: Request,
     res: Response,
     next: NextFunction
): void => {
     const authHeader = req.headers.authorization;

     if (!authHeader || !authHeader.startsWith('Bearer ')) {
          res.status(401).json({ message: 'Authorization token required' });
          return;
     }

     const token = authHeader.split(' ')[1];

     try {
          const decoded = jwt.verify(token, getJwtSecret()) as JwtPayload;
          req.user = decoded;
          next();
     } catch (err) {
          if (err instanceof jwt.TokenExpiredError) {
               res.status(401).json({ message: 'Token has expired' });
               return;
          }
          if (err instanceof jwt.JsonWebTokenError) {
               res.status(401).json({ message: 'Invalid token' });
               return;
          }
          res.status(500).json({ message: 'Internal server error during authentication' });
     }
};

/**
 * Optional authentication — attaches user to req if token is present and valid,
 * but does not block requests without a token.
 */
export const optionalAuthenticate = (
     req: Request,
     res: Response,
     next: NextFunction
): void => {
     const authHeader = req.headers.authorization;

     if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return next();
     }

     const token = authHeader.split(' ')[1];

     try {
          const decoded = jwt.verify(token, getJwtSecret()) as JwtPayload;
          req.user = decoded;
     } catch {

     }

     next();
};

/**
 * Role-based authorization — must be used after `authenticate`.
 * Restricts access to users with one of the specified roles.
 */
export const authorize = (...roles: UserRole[]) => {
     return (req: Request, res: Response, next: NextFunction): void => {
          if (!req.user) {
               res.status(401).json({ message: 'Authentication required' });
               return;
          }

          if (!roles.includes(req.user.role)) {
               res.status(403).json({
                    message: `Access denied. Requires one of the following roles: ${roles.join(', ')}`,
               });
               return;
          }

          next();
     };
};