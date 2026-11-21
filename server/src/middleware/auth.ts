import type { NextFunction, Request, Response } from 'express';
import type { ITenantRepository, IUserRepository } from '../repositories/types.ts';
import { buildTenantContext, type AuthService } from '../services/authService.ts';
import { Errors } from '../utils/errors.ts';

export function createAuthMiddleware(
  authService: AuthService,
  users: IUserRepository,
  tenants: ITenantRepository,
) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw Errors.unauthenticated('Missing or invalid Authorization header');
      }
      const token = authHeader.slice('Bearer '.length).trim();
      if (!token) {
        throw Errors.unauthenticated('Missing session token');
      }

      const payload = authService.verifyToken(token);
      const user = users.findByIdForAuth(payload.sub);
      if (!user) {
        throw Errors.unauthenticated('Account not found');
      }
      if (user.status !== 'ACTIVE') {
        throw Errors.forbidden('Your user account has been deactivated');
      }

      // Section 2.3 & 8.2: a suspended tenant's active sessions get 403 on the next request.
      if (user.tenantId) {
        const tenant = tenants.findByIdSystem(user.tenantId);
        if (!tenant || tenant.status === 'SUSPENDED') {
          throw Errors.forbidden('Organization suspended');
        }
      }

      const requestedTenantId = req.header('x-tenant-id') ?? undefined;
      req.authUser = user;
      req.tenantContext = buildTenantContext(user, requestedTenantId);
      next();
    } catch (err) {
      next(err);
    }
  };
}
