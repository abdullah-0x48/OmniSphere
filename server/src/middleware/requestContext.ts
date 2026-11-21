import type { NextFunction, Request, Response } from 'express';
import type { UserRecord } from '../repositories/types.ts';
import type { TenantContext } from '../repositories/types.ts';
import { generateId } from '../utils/ids.ts';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      clientIp: string;
      authUser?: UserRecord;
      tenantContext?: TenantContext;
    }
  }
}

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = generateId('req');
  req.requestId = requestId;
  const forwarded = req.headers['x-forwarded-for'];
  const rawIp = Array.isArray(forwarded)
    ? forwarded[0]
    : typeof forwarded === 'string'
      ? forwarded.split(',')[0]
      : req.ip || req.socket.remoteAddress || 'unknown';
  req.clientIp = rawIp.trim();
  res.setHeader('X-Request-Id', requestId);
  next();
}
