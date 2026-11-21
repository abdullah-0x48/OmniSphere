import type { ApiErrorCode } from '../../../shared/types.ts';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ApiErrorCode;
  public readonly details?: unknown;

  constructor(statusCode: number, code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const Errors = {
  validation: (message: string, details?: unknown) =>
    new AppError(400, 'VALIDATION_ERROR', message, details),
  unauthenticated: (message = 'Authentication required') =>
    new AppError(401, 'UNAUTHENTICATED', message),
  forbidden: (message = 'You do not have permission to perform this action') =>
    new AppError(403, 'FORBIDDEN', message),
  notFound: (message = 'Resource not found') =>
    new AppError(404, 'NOT_FOUND', message),
  conflict: (message: string, details?: unknown) =>
    new AppError(409, 'CONFLICT', message, details),
  invalidTransition: (message: string, details?: unknown) =>
    new AppError(409, 'INVALID_TRANSITION', message, details),
  rateLimited: (message = 'Too many requests. Please try again later.') =>
    new AppError(429, 'RATE_LIMITED', message),
  internal: (message = 'Internal server error') =>
    new AppError(500, 'INTERNAL', message),
};
