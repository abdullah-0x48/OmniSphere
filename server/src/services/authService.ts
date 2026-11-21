import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import {
  ROLE_LABELS,
  type AuthMeResponse,
  type AuthSessionResponse,
  type DemoAccount,
  type RoleCode,
  type Tenant,
} from '../../../shared/types.ts';
import { config } from '../config.ts';
import {
  toUserPublic,
  type ITenantRepository,
  type IUserRepository,
  type TenantContext,
  type UserRecord,
} from '../repositories/types.ts';
import { Errors } from '../utils/errors.ts';
import type { AuditService } from './auditService.ts';
import type { EmailService } from './emailService.ts';

export interface JwtPayload {
  sub: string;
  role: RoleCode;
  tenantId: string | null;
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function buildTenantContext(user: UserRecord, requestedTenantHeader?: string): TenantContext {
  if (user.role === 'PLATFORM_ADMIN') {
    return {
      userId: user.id,
      role: user.role,
      allTenants: true,
      tenantIds: [],
      activeTenantId: null,
    };
  }

  if (user.role === 'SUPPORT_ENGINEER') {
    let activeTenantId: string | null = null;
    if (requestedTenantHeader && requestedTenantHeader.trim().length > 0) {
      const requested = requestedTenantHeader.trim();
      if (!user.assignedTenantIds.includes(requested)) {
        throw Errors.forbidden('Selected organization is not assigned to your account');
      }
      activeTenantId = requested;
    }
    return {
      userId: user.id,
      role: user.role,
      allTenants: false,
      tenantIds: [...user.assignedTenantIds],
      activeTenantId,
    };
  }

  if (user.role === 'FIELD_TECHNICIAN') {
    return {
      userId: user.id,
      role: user.role,
      allTenants: false,
      tenantIds: [...user.assignedTenantIds],
      activeTenantId: null,
    };
  }

  // Client roles (CA, CM, CO): always strictly scoped to own tenantId; X-Tenant-Id header is ignored.
  const ownTenants = user.tenantId ? [user.tenantId] : [];
  return {
    userId: user.id,
    role: user.role,
    allTenants: false,
    tenantIds: ownTenants,
    activeTenantId: user.tenantId,
  };
}

export class AuthService {
  constructor(
    private readonly users: IUserRepository,
    private readonly tenants: ITenantRepository,
    private readonly audit: AuditService,
    private readonly email: EmailService,
  ) {}

  signToken(user: UserRecord): string {
    const payload: JwtPayload = {
      sub: user.id,
      role: user.role,
      tenantId: user.tenantId,
    };
    return jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
  }

  verifyToken(token: string): JwtPayload {
    try {
      const decoded = jwt.verify(token, config.jwtSecret) as JwtPayload;
      if (!decoded || typeof decoded.sub !== 'string') {
        throw Errors.unauthenticated('Invalid session token');
      }
      return decoded;
    } catch {
      throw Errors.unauthenticated('Session expired or invalid');
    }
  }

  private getAccessibleTenants(user: UserRecord): Tenant[] {
    const ctx = buildTenantContext(user);
    return this.tenants.listAccessible(ctx);
  }

  async login(email: string, password: string, ip: string): Promise<AuthSessionResponse> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = this.users.findByEmailForAuth(normalizedEmail);

    if (!user) {
      this.audit.record({
        actorId: 'ANONYMOUS',
        actorRole: 'ANONYMOUS',
        tenantId: null,
        action: 'AUTH_LOGIN_FAILED',
        targetType: 'USER',
        targetId: normalizedEmail,
        outcome: 'FAILURE',
        ip,
        details: { reason: 'UNKNOWN_EMAIL' },
      });
      throw Errors.unauthenticated('Invalid email or password');
    }

    // Check account lockout (8.1)
    if (user.lockedUntil) {
      const lockedUntilMs = Date.parse(user.lockedUntil);
      const nowMs = Date.now();
      if (lockedUntilMs > nowMs) {
        const remainingMin = Math.max(1, Math.ceil((lockedUntilMs - nowMs) / 60_000));
        this.audit.record({
          actorId: user.id,
          actorRole: user.role,
          tenantId: user.tenantId,
          action: 'AUTH_LOGIN_BLOCKED_LOCKED',
          targetType: 'USER',
          targetId: user.id,
          outcome: 'FAILURE',
          ip,
          details: { remainingMinutes: remainingMin },
        });
        throw Errors.rateLimited(
          `Account is temporarily locked due to repeated failed sign-in attempts. Try again in ${remainingMin} minute${remainingMin === 1 ? '' : 's'}.`,
        );
      }
    }

    // Verify password before revealing account/tenant status except lockout
    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      const nextFailures = user.failedLogins + 1;
      const shouldLock = nextFailures >= config.security.maxFailedLogins;
      const lockedUntil = shouldLock
        ? new Date(Date.now() + config.security.lockoutMinutes * 60_000).toISOString()
        : null;

      this.users.recordLoginFailureSystem(user.id, nextFailures, lockedUntil);

      if (shouldLock) {
        this.audit.record({
          actorId: user.id,
          actorRole: user.role,
          tenantId: user.tenantId,
          action: 'USER_LOCKED',
          targetType: 'USER',
          targetId: user.id,
          outcome: 'FAILURE',
          ip,
          details: { failedLogins: nextFailures, lockoutMinutes: config.security.lockoutMinutes },
        });
        throw Errors.rateLimited(
          `Account locked for ${config.security.lockoutMinutes} minutes after ${config.security.maxFailedLogins} consecutive failed attempts.`,
        );
      }

      this.audit.record({
        actorId: user.id,
        actorRole: user.role,
        tenantId: user.tenantId,
        action: 'AUTH_LOGIN_FAILED',
        targetType: 'USER',
        targetId: user.id,
        outcome: 'FAILURE',
        ip,
        details: { failedLogins: nextFailures },
      });
      throw Errors.unauthenticated('Invalid email or password');
    }

    // Check deactivated user (8.2)
    if (user.status !== 'ACTIVE') {
      this.audit.record({
        actorId: user.id,
        actorRole: user.role,
        tenantId: user.tenantId,
        action: 'AUTH_LOGIN_BLOCKED_INACTIVE',
        targetType: 'USER',
        targetId: user.id,
        outcome: 'FAILURE',
        ip,
      });
      throw Errors.forbidden('Your user account has been deactivated');
    }

    // Check suspended tenant (2.3 & 8.2)
    if (user.tenantId) {
      const tenant = this.tenants.findByIdSystem(user.tenantId);
      if (!tenant || tenant.status === 'SUSPENDED') {
        this.audit.record({
          actorId: user.id,
          actorRole: user.role,
          tenantId: user.tenantId,
          action: 'AUTH_LOGIN_BLOCKED_SUSPENDED_TENANT',
          targetType: 'TENANT',
          targetId: user.tenantId,
          outcome: 'FAILURE',
          ip,
        });
        throw Errors.forbidden('Organization suspended');
      }
    }

    const nowIso = new Date().toISOString();
    this.users.recordLoginSuccessSystem(user.id, nowIso);
    const updatedUser: UserRecord = {
      ...user,
      failedLogins: 0,
      lockedUntil: null,
      lastLoginAt: nowIso,
    };

    const token = this.signToken(updatedUser);
    const accessibleTenants = this.getAccessibleTenants(updatedUser);

    this.audit.record({
      actorId: user.id,
      actorRole: user.role,
      tenantId: user.tenantId,
      action: 'AUTH_LOGIN',
      targetType: 'USER',
      targetId: user.id,
      outcome: 'SUCCESS',
      ip,
    });

    return {
      token,
      user: toUserPublic(updatedUser),
      tenants: accessibleTenants,
      demoMode: config.demoMode,
    };
  }

  logout(user: UserRecord, ip: string): void {
    this.audit.record({
      actorId: user.id,
      actorRole: user.role,
      tenantId: user.tenantId,
      action: 'AUTH_LOGOUT',
      targetType: 'USER',
      targetId: user.id,
      outcome: 'SUCCESS',
      ip,
    });
  }

  me(user: UserRecord): AuthMeResponse {
    return {
      user: toUserPublic(user),
      tenants: this.getAccessibleTenants(user),
      demoMode: config.demoMode,
    };
  }

  async changePassword(
    user: UserRecord,
    currentPassword: string,
    newPassword: string,
    ip: string,
  ): Promise<void> {
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      this.audit.record({
        actorId: user.id,
        actorRole: user.role,
        tenantId: user.tenantId,
        action: 'PASSWORD_CHANGE_FAILED',
        targetType: 'USER',
        targetId: user.id,
        outcome: 'FAILURE',
        ip,
        details: { reason: 'INVALID_CURRENT_PASSWORD' },
      });
      throw Errors.validation('Current password is incorrect');
    }

    const hash = await bcrypt.hash(newPassword, config.security.bcryptCost);
    this.users.updatePasswordSystem(user.id, hash);

    this.audit.record({
      actorId: user.id,
      actorRole: user.role,
      tenantId: user.tenantId,
      action: 'PASSWORD_CHANGED',
      targetType: 'USER',
      targetId: user.id,
      outcome: 'SUCCESS',
      ip,
    });
  }

  async requestPasswordReset(email: string, ip: string, initiatedBy?: UserRecord): Promise<void> {
    const normalized = email.trim().toLowerCase();
    const targetUser = this.users.findByEmailForAuth(normalized);
    if (!targetUser || targetUser.status !== 'ACTIVE') {
      // Do not leak account existence on public forgot-password endpoint
      return;
    }

    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = sha256(rawToken);
    const expiresAt = new Date(
      Date.now() + config.security.passwordResetExpiryMinutes * 60_000,
    ).toISOString();

    this.users.setPasswordResetTokenSystem(targetUser.id, tokenHash, expiresAt);

    await this.email.enqueueAndSend({
      tenantId: targetUser.tenantId,
      to: targetUser.email,
      subject: 'OmniSphere Password Reset Request',
      summary:
        'A password reset was requested for your OmniSphere account. This single-use link expires in 60 minutes.',
      facts: [
        { label: 'Account', value: targetUser.email },
        { label: 'Expires at (UTC)', value: expiresAt },
      ],
      ctaLabel: 'Reset Password',
      ctaPath: `/reset-password/${rawToken}`,
      relatedType: 'PASSWORD_RESET',
      relatedId: targetUser.id,
    });

    this.audit.record({
      actorId: initiatedBy ? initiatedBy.id : targetUser.id,
      actorRole: initiatedBy ? initiatedBy.role : targetUser.role,
      tenantId: targetUser.tenantId,
      action: 'PASSWORD_RESET_REQUESTED',
      targetType: 'USER',
      targetId: targetUser.id,
      outcome: 'SUCCESS',
      ip,
      details: { initiatedByAdmin: Boolean(initiatedBy) },
    });
  }

  async resetPassword(token: string, newPassword: string, ip: string): Promise<void> {
    const tokenHash = sha256(token.trim());
    const user = this.users.findByResetTokenHashForAuth(tokenHash);

    if (!user || !user.passwordResetExpiresAt || Date.parse(user.passwordResetExpiresAt) < Date.now()) {
      throw Errors.validation('This password reset link is invalid or has expired');
    }

    const hash = await bcrypt.hash(newPassword, config.security.bcryptCost);
    this.users.updatePasswordSystem(user.id, hash);

    this.audit.record({
      actorId: user.id,
      actorRole: user.role,
      tenantId: user.tenantId,
      action: 'PASSWORD_RESET_COMPLETED',
      targetType: 'USER',
      targetId: user.id,
      outcome: 'SUCCESS',
      ip,
    });
  }

  listDemoAccounts(): DemoAccount[] {
    if (!config.demoMode) {
      throw Errors.notFound('Demo accounts are not enabled');
    }
    return this.users.listDemoAccounts().map((u) => ({
      email: u.email,
      name: u.name,
      role: u.role,
      roleLabel: ROLE_LABELS[u.role],
      tenantCode: u.tenantCode ?? null,
      tenantName: u.tenantName ?? null,
    }));
  }
}
