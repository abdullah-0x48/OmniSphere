import bcrypt from 'bcryptjs';
import {
  CLIENT_ROLES,
  type RoleCode,
  type UserPublic,
} from '../../../shared/types.ts';
import { config } from '../config.ts';
import {
  toUserPublic,
  type ITenantRepository,
  type IUserRepository,
  type TenantContext,
  type UserListFilter,
  type UserRecord,
} from '../repositories/types.ts';
import { Errors } from '../utils/errors.ts';
import { generateId } from '../utils/ids.ts';
import type { AuditService } from './auditService.ts';
import type { AuthService } from './authService.ts';

export interface CreateUserCommand {
  email: string;
  name: string;
  role: RoleCode;
  tenantId?: string | null;
  assignedTenantIds?: string[];
  isSupervisor?: boolean;
  password: string;
}

export class UserService {
  constructor(
    private readonly users: IUserRepository,
    private readonly tenants: ITenantRepository,
    private readonly audit: AuditService,
    private readonly authService: AuthService,
  ) {}

  list(ctx: TenantContext, filter: UserListFilter): { items: UserPublic[]; total: number } {
    return this.users.list(ctx, filter);
  }

  getById(ctx: TenantContext, id: string): UserPublic {
    const user = this.users.findById(ctx, id);
    if (!user) {
      throw Errors.notFound('User not found');
    }
    return toUserPublic(user);
  }

  async create(ctx: TenantContext, input: CreateUserCommand, ip: string): Promise<UserPublic> {
    const normalizedEmail = input.email.trim().toLowerCase();
    const existing = this.users.findByEmailForAuth(normalizedEmail);
    if (existing) {
      throw Errors.conflict(`Email "${normalizedEmail}" is already in use`, { field: 'email' });
    }

    let targetTenantId: string | null = null;
    let assignedTenantIds: string[] = [];
    let isSupervisor = false;

    if (ctx.role === 'PLATFORM_ADMIN') {
      // PA creates SE, FT, PA, or the CA of a tenant (Section 7 & FR-ORG-02)
      if (input.role === 'SUPPORT_ENGINEER' || input.role === 'FIELD_TECHNICIAN') {
        targetTenantId = null;
        assignedTenantIds = this.validateTenantIds(input.assignedTenantIds ?? []);
        isSupervisor = input.role === 'SUPPORT_ENGINEER' ? Boolean(input.isSupervisor) : false;
      } else if (input.role === 'PLATFORM_ADMIN') {
        targetTenantId = null;
      } else if (input.role === 'CLIENT_ADMIN') {
        if (!input.tenantId) {
          throw Errors.validation('A tenant must be specified for a Client Admin');
        }
        const tenant = this.tenants.findByIdSystem(input.tenantId);
        if (!tenant) {
          throw Errors.notFound('Tenant not found');
        }
        targetTenantId = tenant.id;
      } else {
        throw Errors.forbidden(
          'Platform Admins create provider staff or initial Client Admins; Client Managers and Operators are managed by the tenant Client Admin',
        );
      }
    } else if (ctx.role === 'CLIENT_ADMIN') {
      // CA creates CA, CM, CO in own tenant only (FR-ORG-03)
      if (!CLIENT_ROLES.includes(input.role)) {
        throw Errors.forbidden('Client Admins can only assign Client Admin, Client Manager, or Client Operator roles');
      }
      targetTenantId = ctx.tenantIds[0] ?? null;
      if (!targetTenantId) {
        throw Errors.forbidden('No tenant context available');
      }
    } else {
      throw Errors.forbidden('You do not have permission to create users');
    }

    const passwordHash = await bcrypt.hash(input.password, config.security.bcryptCost);
    const created = this.users.create(ctx, {
      id: generateId('usr'),
      email: normalizedEmail,
      name: input.name.trim(),
      role: input.role,
      tenantId: targetTenantId,
      assignedTenantIds,
      isSupervisor,
      passwordHash,
    });

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: created.tenantId,
      action: 'USER_CREATED',
      targetType: 'USER',
      targetId: created.id,
      outcome: 'SUCCESS',
      ip,
      details: {
        email: created.email,
        role: created.role,
        assignedTenantIds: created.assignedTenantIds,
        isSupervisor: created.isSupervisor,
      },
    });

    return toUserPublic(created);
  }

  update(
    ctx: TenantContext,
    id: string,
    patch: { name?: string; role?: RoleCode; isSupervisor?: boolean },
    ip: string,
  ): UserPublic {
    const existing = this.users.findById(ctx, id);
    if (!existing) {
      throw Errors.notFound('User not found');
    }

    if (patch.role !== undefined) {
      if (ctx.role === 'CLIENT_ADMIN' && !CLIENT_ROLES.includes(patch.role)) {
        throw Errors.forbidden('Client Admins can only assign client roles');
      }
      if (
        existing.role === 'PLATFORM_ADMIN' &&
        patch.role !== 'PLATFORM_ADMIN' &&
        this.users.countActivePlatformAdmins() <= 1
      ) {
        throw Errors.conflict('Cannot change role of the last active Platform Admin');
      }
    }

    const nextRole = patch.role ?? existing.role;
    const nextSupervisor =
      nextRole === 'SUPPORT_ENGINEER'
        ? patch.isSupervisor ?? existing.isSupervisor
        : false;

    const updated = this.users.update(ctx, id, {
      name: patch.name,
      role: nextRole,
      isSupervisor: nextSupervisor,
    });
    if (!updated) {
      throw Errors.notFound('User not found');
    }

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: updated.tenantId,
      action: 'USER_UPDATED',
      targetType: 'USER',
      targetId: updated.id,
      outcome: 'SUCCESS',
      ip,
      details: {
        name: updated.name,
        role: updated.role,
        isSupervisor: updated.isSupervisor,
      },
    });

    return toUserPublic(updated);
  }

  deactivate(ctx: TenantContext, id: string, ip: string): UserPublic {
    const existing = this.users.findById(ctx, id);
    if (!existing) {
      throw Errors.notFound('User not found');
    }
    if (existing.status === 'INACTIVE') {
      throw Errors.invalidTransition('User is already inactive');
    }
    // Business rule 8.2: PA cannot deactivate the last active PA.
    if (existing.role === 'PLATFORM_ADMIN' && this.users.countActivePlatformAdmins() <= 1) {
      throw Errors.conflict('Cannot deactivate the last active Platform Admin');
    }

    const updated = this.users.updateStatus(ctx, id, 'INACTIVE');
    if (!updated) {
      throw Errors.notFound('User not found');
    }

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: updated.tenantId,
      action: 'USER_DEACTIVATED',
      targetType: 'USER',
      targetId: updated.id,
      outcome: 'SUCCESS',
      ip,
      details: { email: updated.email },
    });

    return toUserPublic(updated);
  }

  reactivate(ctx: TenantContext, id: string, ip: string): UserPublic {
    const existing = this.users.findById(ctx, id);
    if (!existing) {
      throw Errors.notFound('User not found');
    }
    if (existing.status === 'ACTIVE') {
      throw Errors.invalidTransition('User is already active');
    }

    const updated = this.users.updateStatus(ctx, id, 'ACTIVE');
    if (!updated) {
      throw Errors.notFound('User not found');
    }

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: updated.tenantId,
      action: 'USER_REACTIVATED',
      targetType: 'USER',
      targetId: updated.id,
      outcome: 'SUCCESS',
      ip,
      details: { email: updated.email },
    });

    return toUserPublic(updated);
  }

  async sendPasswordReset(
    ctx: TenantContext,
    actor: UserRecord,
    id: string,
    ip: string,
  ): Promise<void> {
    const target = this.users.findById(ctx, id);
    if (!target) {
      throw Errors.notFound('User not found');
    }
    if (target.status !== 'ACTIVE') {
      throw Errors.conflict('Cannot send a password reset to an inactive user');
    }
    await this.authService.requestPasswordReset(target.email, ip, actor);
  }

  updateAssignedTenants(
    ctx: TenantContext,
    id: string,
    assignedTenantIds: string[],
    ip: string,
  ): UserPublic {
    const existing = this.users.findById(ctx, id);
    if (!existing) {
      throw Errors.notFound('User not found');
    }
    if (existing.role !== 'SUPPORT_ENGINEER' && existing.role !== 'FIELD_TECHNICIAN') {
      throw Errors.validation('Tenant assignments apply only to Support Engineers and Field Technicians');
    }

    const validIds = this.validateTenantIds(assignedTenantIds);
    const updated = this.users.updateAssignedTenants(ctx, id, validIds);
    if (!updated) {
      throw Errors.notFound('User not found');
    }

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: null,
      action: 'USER_TENANTS_ASSIGNED',
      targetType: 'USER',
      targetId: updated.id,
      outcome: 'SUCCESS',
      ip,
      details: { email: updated.email, assignedTenantIds: validIds },
    });

    return toUserPublic(updated);
  }

  private validateTenantIds(ids: string[]): string[] {
    const unique = Array.from(new Set(ids.map((i) => i.trim()).filter(Boolean)));
    for (const tid of unique) {
      const tenant = this.tenants.findByIdSystem(tid);
      if (!tenant) {
        throw Errors.validation(`Unknown tenant ID: ${tid}`);
      }
    }
    return unique;
  }
}
