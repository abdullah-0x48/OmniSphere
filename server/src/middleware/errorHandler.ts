import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/errors.ts';
import { logger } from '../utils/logger.ts';

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    });
    return;
  }

  // Handle malformed JSON bodies from express.json()
  if (err instanceof SyntaxError && 'status' in err && (err as { status?: number }).status === 400) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid JSON payload',
      },
    });
    return;
  }

  logger.error('Unhandled request error', {
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    error: err instanceof Error ? err.message : String(err),
  });

  res.status(500).json({
    error: {
      code: 'INTERNAL',
      message: 'An unexpected internal error occurred',
    },
  });
}
