import { Request, Response } from 'express'

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
) => {
  const statusCode = err.status || 500

  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal Server Error'
  })
}