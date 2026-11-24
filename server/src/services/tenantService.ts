import bcrypt from 'bcryptjs';
import {
  DEFAULT_TENANT_SETTINGS,
  type PlatformOverviewResponse,
  type Tenant,
  type TenantSettings,
  type TenantSummary,
  type UserPublic,
} from '../../../shared/types.ts';
import { config } from '../config.ts';
import {
  toUserPublic,
  type IAlertRepository,
  type IAuditRepository,
  type IDeviceModelRepository,
  type IDeviceRepository,
  type IEmailOutboxRepository,
  type ITenantRepository,
  type IUserRepository,
  type TenantContext,
  type TenantListFilter,
} from '../repositories/types.ts';
import { Errors } from '../utils/errors.ts';
import { generateId } from '../utils/ids.ts';
import type { AuditService } from './auditService.ts';
import type { LiveStateStore } from './liveStateStore.ts';

export interface CreateTenantWithAdminInput {
  name: string;
  code: string;
  contactEmail: string;
  settings?: Partial<TenantSettings>;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
}

export class TenantService {
  constructor(
    private readonly tenants: ITenantRepository,
    private readonly users: IUserRepository,
    private readonly auditRepo: IAuditRepository,
    private readonly outboxRepo: IEmailOutboxRepository,
    private readonly audit: AuditService,
    private readonly devices?: IDeviceRepository,
    private readonly deviceModels?: IDeviceModelRepository,
    private readonly liveState?: LiveStateStore,
    private readonly alertsRepo?: IAlertRepository,
  ) {}

  list(ctx: TenantContext, filter: TenantListFilter): { items: TenantSummary[]; total: number } {
    const result = this.tenants.list(ctx, filter);
    const userCounts = this.users.countByTenant();
    const deviceCounts = this.devices?.countByTenant() ?? new Map();
    const items: TenantSummary[] = result.items.map((t) => {
      const counts = userCounts.get(t.id) ?? { total: 0, active: 0 };
      const dCounts = deviceCounts.get(t.id) ?? { total: 0, online: 0, active: 0 };
      const onlinePercentage =
        dCounts.total > 0 ? Math.round((dCounts.online / dCounts.total) * 100) : null;
      return {
        ...t,
        userCount: counts.total,
        activeUserCount: counts.active,
        deviceCount: dCounts.total,
        onlinePercentage,
      };
    });
    return { items, total: result.total };
  }

  getById(ctx: TenantContext, id: string): TenantSummary {
    const tenant = this.tenants.findById(ctx, id);
    if (!tenant) {
      throw Errors.notFound('Tenant not found');
    }
    const counts = this.users.countByTenant().get(tenant.id) ?? { total: 0, active: 0 };
    const dCounts = this.devices?.countByTenant().get(tenant.id) ?? {
      total: 0,
      online: 0,
      active: 0,
    };
    const onlinePercentage =
      dCounts.total > 0 ? Math.round((dCounts.online / dCounts.total) * 100) : null;
    return {
      ...tenant,
      userCount: counts.total,
      activeUserCount: counts.active,
      deviceCount: dCounts.total,
      onlinePercentage,
    };
  }

  async createWithFirstAdmin(
    ctx: TenantContext,
    input: CreateTenantWithAdminInput,
    ip: string,
  ): Promise<{ tenant: Tenant; adminUser: UserPublic }> {
    const normalizedCode = input.code.trim().toUpperCase();
    const existingCode = this.tenants.findByCodeSystem(normalizedCode);
    if (existingCode) {
      throw Errors.conflict(`Organization code "${normalizedCode}" is already in use`, {
        field: 'code',
      });
    }

    const normalizedAdminEmail = input.adminEmail.trim().toLowerCase();
    const existingUser = this.users.findByEmailForAuth(normalizedAdminEmail);
    if (existingUser) {
      throw Errors.conflict(`Email "${normalizedAdminEmail}" is already registered`, {
        field: 'adminEmail',
      });
    }

    const settings: TenantSettings = {
      ...DEFAULT_TENANT_SETTINGS,
      ...input.settings,
    };

    const tenantId = generateId('ten');
    const tenant = this.tenants.create(ctx, {
      id: tenantId,
      name: input.name.trim(),
      code: normalizedCode,
      contactEmail: input.contactEmail.trim().toLowerCase(),
      settings,
    });

    const passwordHash = await bcrypt.hash(input.adminPassword, config.security.bcryptCost);
    const adminUser = this.users.create(ctx, {
      id: generateId('usr'),
      email: normalizedAdminEmail,
      name: input.adminName.trim(),
      role: 'CLIENT_ADMIN',
      tenantId: tenant.id,
      assignedTenantIds: [],
      isSupervisor: false,
      passwordHash,
    });

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: tenant.id,
      action: 'TENANT_CREATED',
      targetType: 'TENANT',
      targetId: tenant.id,
      outcome: 'SUCCESS',
      ip,
      details: { name: tenant.name, code: tenant.code, contactEmail: tenant.contactEmail },
    });

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: tenant.id,
      action: 'USER_CREATED',
      targetType: 'USER',
      targetId: adminUser.id,
      outcome: 'SUCCESS',
      ip,
      details: { email: adminUser.email, role: adminUser.role, initialClientAdmin: true },
    });

    return { tenant, adminUser: toUserPublic(adminUser) };
  }

  update(
    ctx: TenantContext,
    id: string,
    patch: { name?: string; contactEmail?: string },
    ip: string,
  ): Tenant {
    const updated = this.tenants.update(ctx, id, patch);
    if (!updated) {
      throw Errors.notFound('Tenant not found');
    }
    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: updated.id,
      action: 'TENANT_UPDATED',
      targetType: 'TENANT',
      targetId: updated.id,
      outcome: 'SUCCESS',
      ip,
      details: patch,
    });
    return updated;
  }

  suspend(ctx: TenantContext, id: string, reason: string | undefined, ip: string): Tenant {
    const existing = this.tenants.findById(ctx, id);
    if (!existing) {
      throw Errors.notFound('Tenant not found');
    }
    if (existing.status === 'SUSPENDED') {
      throw Errors.invalidTransition('Organization is already suspended');
    }
    const updated = this.tenants.updateStatus(ctx, id, 'SUSPENDED');
    if (!updated) {
      throw Errors.notFound('Tenant not found');
    }
    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: updated.id,
      action: 'TENANT_SUSPENDED',
      targetType: 'TENANT',
      targetId: updated.id,
      outcome: 'SUCCESS',
      ip,
      details: { reason: reason?.trim() || 'Suspended by Platform Admin' },
    });
    return updated;
  }

  reactivate(ctx: TenantContext, id: string, ip: string): Tenant {
    const existing = this.tenants.findById(ctx, id);
    if (!existing) {
      throw Errors.notFound('Tenant not found');
    }
    if (existing.status === 'ACTIVE') {
      throw Errors.invalidTransition('Organization is already active');
    }
    const updated = this.tenants.updateStatus(ctx, id, 'ACTIVE');
    if (!updated) {
      throw Errors.notFound('Tenant not found');
    }
    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: updated.id,
      action: 'TENANT_REACTIVATED',
      targetType: 'TENANT',
      targetId: updated.id,
      outcome: 'SUCCESS',
      ip,
    });
    return updated;
  }

  updateSettings(
    ctx: TenantContext,
    id: string,
    patch: Partial<TenantSettings>,
    ip: string,
  ): Tenant {
    const existing = this.tenants.findById(ctx, id);
    if (!existing) {
      throw Errors.notFound('Tenant not found');
    }
    const merged: TenantSettings = {
      ...existing.settings,
      ...patch,
    };
    const updated = this.tenants.updateSettings(ctx, id, merged);
    if (!updated) {
      throw Errors.notFound('Tenant not found');
    }
    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: updated.id,
      action: 'TENANT_SETTINGS_UPDATED',
      targetType: 'TENANT',
      targetId: updated.id,
      outcome: 'SUCCESS',
      ip,
      details: { settings: merged },
    });
    return updated;
  }

  getPlatformOverview(ctx: TenantContext): PlatformOverviewResponse {
    const tenantCounts = this.tenants.countByStatus();
    const userCounts = this.users.countGlobal();
    const devicesByState = this.devices?.countByStateGlobal() ?? {
      PROVISIONED: 0,
      ACTIVE: 0,
      UNDER_MAINTENANCE: 0,
      SUSPENDED: 0,
      DECOMMISSIONED: 0,
    };
    const devicesTotal = Object.values(devicesByState).reduce((acc, n) => acc + n, 0);
    const deviceModelsTotal = this.deviceModels?.countAll() ?? 0;
    const last24hIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const auditEventsLast24h = this.auditRepo.countSince(last24hIso);
    const emailsQueuedOrFailed = this.outboxRepo.countQueuedOrFailed();

    const { items: tenants } = this.list(ctx, {
      page: 1,
      pageSize: 200,
      sortField: 'name',
      sortDir: 'asc',
    });

    const ingestion = this.liveState?.getIngestionMetrics() ?? {
      messagesPerMinute: 0,
      invalidPayloadRate: 0,
    };

    return {
      counts: {
        tenantsTotal: tenantCounts.total,
        tenantsActive: tenantCounts.active,
        tenantsSuspended: tenantCounts.suspended,
        usersTotal: userCounts.total,
        usersActive: userCounts.active,
        providerStaffCount: userCounts.providerStaff,
        devicesTotal,
        devicesByState,
        deviceModelsTotal,
        auditEventsLast24h,
        emailsQueuedOrFailed,
        messagesPerMinute: ingestion.messagesPerMinute,
        invalidPayloadRate: ingestion.invalidPayloadRate,
        openCriticalAlerts: this.alertsRepo?.countOpenCriticalGlobal() ?? 0,
      },
      tenants,
      demoMode: config.demoMode,
    };
  }
}
