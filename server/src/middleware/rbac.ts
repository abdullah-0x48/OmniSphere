import type { NextFunction, Request, Response } from 'express';
import type { RoleCode } from '../../../shared/types.ts';
import { Errors } from '../utils/errors.ts';

export function requireRole(allowedRoles: readonly RoleCode[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const ctx = req.tenantContext;
    if (!ctx) {
      next(Errors.unauthenticated());
      return;
    }
    if (!allowedRoles.includes(ctx.role)) {
      next(Errors.forbidden('Your role is not permitted to access this resource'));
      return;
    }
    next();
  };
}
