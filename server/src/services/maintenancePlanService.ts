import type {
  MaintenancePlanPublic,
  MaintenancePlanTemplate,
  MaintenanceScopeType,
} from '../../../shared/types.ts';
import type { Repositories } from '../repositories/index.ts';
import type { MaintenancePlanListFilter, TenantContext } from '../repositories/types.ts';
import { Errors } from '../utils/errors.ts';
import { generateId } from '../utils/ids.ts';
import type { AuditService } from './auditService.ts';
import {
  advanceMaintenanceNextRunAt,
  deriveInitialWorkOrderApproval,
} from './maintenanceLogic.ts';
import type { WorkOrderService } from './workOrderService.ts';

const SYSTEM_PA_CTX: TenantContext = {
  userId: 'SYSTEM',
  role: 'PLATFORM_ADMIN',
  allTenants: true,
  tenantIds: [],
  activeTenantId: null,
};

export class MaintenancePlanService {
  constructor(
    private readonly repos: Repositories,
    private readonly workOrderService: WorkOrderService,
    private readonly audit: AuditService,
  ) {}

  private resolveWriteTenantId(ctx: TenantContext): string {
    if (ctx.activeTenantId) return ctx.activeTenantId;
    if (ctx.tenantIds.length === 1) return ctx.tenantIds[0];
    throw Errors.validation('Select a working organization before creating a maintenance plan');
  }

  private getMatchingDevices(
    tenantId: string,
    scopeType: MaintenanceScopeType,
    scopeValue: string,
  ) {
    const scopeCtx: TenantContext = {
      ...SYSTEM_PA_CTX,
      allTenants: false,
      tenantIds: [tenantId],
      activeTenantId: tenantId,
    };
    const devices = this.repos.devices
      .listAllInScope(scopeCtx)
      .filter((d) => d.state !== 'DECOMMISSIONED');

    if (scopeType === 'DEVICE') {
      return devices.filter((d) => d.id === scopeValue);
    }
    if (scopeType === 'SITE') {
      return devices.filter((d) => d.siteId === scopeValue);
    }
    const cleanTag = scopeValue.trim().toLowerCase();
    return devices.filter((d) => d.tags.some((t) => t.toLowerCase() === cleanTag));
  }

  private enrichPlan(plan: MaintenancePlanPublic): MaintenancePlanPublic {
    const matched = this.getMatchingDevices(plan.tenantId, plan.scopeType, plan.scopeValue);
    let scopeLabel = plan.scopeValue;
    if (plan.scopeType === 'DEVICE') {
      const dev = this.repos.devices.findById(SYSTEM_PA_CTX, plan.scopeValue);
      scopeLabel = dev ? `${dev.name} (${dev.serialNumber})` : plan.scopeValue;
    } else if (plan.scopeType === 'SITE') {
      const site = this.repos.sites.findById(SYSTEM_PA_CTX, plan.scopeValue);
      scopeLabel = site ? site.name : plan.scopeValue;
    } else {
      scopeLabel = `Tag: #${plan.scopeValue}`;
    }

    return {
      ...plan,
      scopeLabel,
      matchedDeviceCount: matched.length,
    };
  }

  private validateScopeAndAssignee(
    ctx: TenantContext,
    tenantId: string,
    scopeType: MaintenanceScopeType,
    scopeValue: string,
    assignedTo: string | null,
  ): string {
    const cleanVal = scopeValue.trim();
    if (!cleanVal) {
      throw Errors.validation('Scope value is required', { field: 'scopeValue' });
    }

    if (scopeType === 'DEVICE') {
      const dev = this.repos.devices.findById(ctx, cleanVal);
      if (!dev || dev.tenantId !== tenantId) {
        throw Errors.validation('Selected device does not exist in this organization', {
          field: 'scopeValue',
        });
      }
    } else if (scopeType === 'SITE') {
      const site = this.repos.sites.findById(ctx, cleanVal);
      if (!site || site.tenantId !== tenantId) {
        throw Errors.validation('Selected site does not exist in this organization', {
          field: 'scopeValue',
        });
      }
    }

    if (assignedTo) {
      const tech = this.repos.users.findByIdForAuth(assignedTo);
      if (
        !tech ||
        tech.status !== 'ACTIVE' ||
        tech.role !== 'FIELD_TECHNICIAN' ||
        !tech.assignedTenantIds.includes(tenantId)
      ) {
        throw Errors.validation(
          'Selected technician is not an active Field Technician for this organization',
          { field: 'assignedTo' },
        );
      }
    }

    return scopeType === 'TAG' ? cleanVal.toLowerCase() : cleanVal;
  }

  list(
    ctx: TenantContext,
    filter: MaintenancePlanListFilter,
  ): { items: MaintenancePlanPublic[]; total: number } {
    const res = this.repos.maintenancePlans.list(ctx, filter);
    return {
      items: res.items.map((p) => this.enrichPlan(p)),
      total: res.total,
    };
  }

  create(
    ctx: TenantContext,
    input: {
      name: string;
      scopeType: MaintenanceScopeType;
      scopeValue: string;
      everyDays: number;
      nextRunAt: string;
      template: MaintenancePlanTemplate;
      assignedTo?: string | null;
      enabled?: boolean;
    },
    ip: string,
  ): MaintenancePlanPublic {
    const tenantId = this.resolveWriteTenantId(ctx);
    const cleanScopeValue = this.validateScopeAndAssignee(
      ctx,
      tenantId,
      input.scopeType,
      input.scopeValue,
      input.assignedTo ?? null,
    );

    const parsedNext = Date.parse(input.nextRunAt);
    if (!Number.isFinite(parsedNext)) {
      throw Errors.validation('nextRunAt must be a valid ISO timestamp', { field: 'nextRunAt' });
    }

    const template: MaintenancePlanTemplate = {
      title: input.template.title.trim(),
      instructions: input.template.instructions.trim(),
      checklist: input.template.checklist.map((c) => c.trim()).filter(Boolean),
      downtimeRequired: Boolean(input.template.downtimeRequired),
    };

    const created = this.repos.maintenancePlans.create(ctx, {
      id: generateId('mpl'),
      tenantId,
      name: input.name.trim(),
      scopeType: input.scopeType,
      scopeValue: cleanScopeValue,
      everyDays: Math.max(1, Math.floor(input.everyDays)),
      nextRunAt: new Date(parsedNext).toISOString(),
      template,
      assignedTo: input.assignedTo ?? null,
      enabled: input.enabled ?? true,
      createdBy: ctx.userId,
    });

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId,
      action: 'MAINTENANCE_PLAN_CREATED',
      targetType: 'MAINTENANCE_PLAN',
      targetId: created.id,
      outcome: 'SUCCESS',
      ip,
      details: {
        name: created.name,
        scopeType: created.scopeType,
        scopeValue: created.scopeValue,
        everyDays: created.everyDays,
        nextRunAt: created.nextRunAt,
      },
    });

    return this.enrichPlan(created);
  }

  update(
    ctx: TenantContext,
    id: string,
    patch: {
      name?: string;
      scopeType?: MaintenanceScopeType;
      scopeValue?: string;
      everyDays?: number;
      nextRunAt?: string;
      template?: MaintenancePlanTemplate;
      assignedTo?: string | null;
      enabled?: boolean;
    },
    ip: string,
  ): MaintenancePlanPublic {
    const existing = this.repos.maintenancePlans.findById(ctx, id);
    if (!existing) {
      throw Errors.notFound('Maintenance plan not found');
    }

    const nextScopeType = patch.scopeType ?? existing.scopeType;
    const nextScopeValueRaw = patch.scopeValue ?? existing.scopeValue;
    const nextAssignedTo =
      patch.assignedTo !== undefined ? patch.assignedTo : existing.assignedTo;

    const cleanScopeValue = this.validateScopeAndAssignee(
      ctx,
      existing.tenantId,
      nextScopeType,
      nextScopeValueRaw,
      nextAssignedTo,
    );

    let normalizedNextRunAt: string | undefined;
    if (patch.nextRunAt !== undefined) {
      const parsed = Date.parse(patch.nextRunAt);
      if (!Number.isFinite(parsed)) {
        throw Errors.validation('nextRunAt must be a valid ISO timestamp', { field: 'nextRunAt' });
      }
      normalizedNextRunAt = new Date(parsed).toISOString();
    }

    const template = patch.template
      ? {
          title: patch.template.title.trim(),
          instructions: patch.template.instructions.trim(),
          checklist: patch.template.checklist.map((c) => c.trim()).filter(Boolean),
          downtimeRequired: Boolean(patch.template.downtimeRequired),
        }
      : undefined;

    const updated = this.repos.maintenancePlans.update(ctx, id, {
      name: patch.name !== undefined ? patch.name.trim() : undefined,
      scopeType: patch.scopeType,
      scopeValue:
        patch.scopeType !== undefined || patch.scopeValue !== undefined
          ? cleanScopeValue
          : undefined,
      everyDays:
        patch.everyDays !== undefined ? Math.max(1, Math.floor(patch.everyDays)) : undefined,
      nextRunAt: normalizedNextRunAt,
      template,
      assignedTo: patch.assignedTo,
      enabled: patch.enabled,
    });
    if (!updated) {
      throw Errors.notFound('Maintenance plan not found');
    }

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: existing.tenantId,
      action: 'MAINTENANCE_PLAN_UPDATED',
      targetType: 'MAINTENANCE_PLAN',
      targetId: updated.id,
      outcome: 'SUCCESS',
      ip,
      details: {
        name: updated.name,
        enabled: updated.enabled,
        everyDays: updated.everyDays,
        nextRunAt: updated.nextRunAt,
      },
    });

    return this.enrichPlan(updated);
  }

  delete(ctx: TenantContext, id: string, ip: string): void {
    const existing = this.repos.maintenancePlans.findById(ctx, id);
    if (!existing) {
      throw Errors.notFound('Maintenance plan not found');
    }
    const deleted = this.repos.maintenancePlans.delete(ctx, id);
    if (!deleted) {
      throw Errors.notFound('Maintenance plan not found');
    }

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: existing.tenantId,
      action: 'MAINTENANCE_PLAN_DELETED',
      targetType: 'MAINTENANCE_PLAN',
      targetId: existing.id,
      outcome: 'SUCCESS',
      ip,
      details: { name: existing.name },
    });
  }

  /**
   * Section 8.9: Maintenance planner background job (every 5 min).
   * Finds due enabled plans, creates PREVENTIVE work orders for each matching active/non-decommissioned
   * device, and advances `nextRunAt` idempotently.
   */
  runDuePlansOnce(nowMs = Date.now()): {
    plansExecuted: number;
    workOrdersCreated: number;
    createdWorkOrderIds: string[];
  } {
    const nowIso = new Date(nowMs).toISOString();
    const duePlans = this.repos.maintenancePlans.listDueEnabledSystem(nowIso);
    let plansExecuted = 0;
    const createdWorkOrderIds: string[] = [];

    for (const plan of duePlans) {
      const devices = this.getMatchingDevices(plan.tenantId, plan.scopeType, plan.scopeValue);
      const tenant = this.repos.tenants.findByIdSystem(plan.tenantId);
      const requireMaintenanceApproval = tenant?.settings.requireMaintenanceApproval ?? true;
      const approvalStatus = deriveInitialWorkOrderApproval(
        plan.template.downtimeRequired,
        requireMaintenanceApproval,
      );

      const plannedStartMs = Math.max(nowMs, Date.parse(plan.nextRunAt) || nowMs);
      const plannedStartIso = new Date(plannedStartMs).toISOString();
      const plannedEndIso = new Date(plannedStartMs + 2 * 60 * 60_000).toISOString();

      const tech = plan.assignedTo ? this.repos.users.findByIdForAuth(plan.assignedTo) : null;
      const validTech =
        tech &&
        tech.status === 'ACTIVE' &&
        tech.role === 'FIELD_TECHNICIAN' &&
        tech.assignedTenantIds.includes(plan.tenantId)
          ? tech
          : null;

      const planWoIds: string[] = [];
      for (const dev of devices) {
        const wo = this.repos.workOrders.createSystem({
          id: generateId('wo'),
          tenantId: plan.tenantId,
          deviceId: dev.id,
          ticketId: null,
          planId: plan.id,
          type: 'PREVENTIVE',
          title: `${plan.template.title} — ${dev.name}`,
          instructions: plan.template.instructions,
          checklist: plan.template.checklist.map((text) => ({
            id: generateId('chk'),
            text,
            done: false,
          })),
          assignedTo: validTech?.id ?? null,
          plannedStart: plannedStartIso,
          plannedEnd: plannedEndIso,
          downtimeRequired: plan.template.downtimeRequired,
          approvalStatus,
          status: validTech ? 'ASSIGNED' : 'PLANNED',
          createdBy: 'SYSTEM',
        });

        planWoIds.push(wo.id);
        createdWorkOrderIds.push(wo.id);

        this.audit.record({
          actorId: 'SYSTEM',
          actorRole: 'SYSTEM',
          tenantId: plan.tenantId,
          action: 'WORK_ORDER_CREATED',
          targetType: 'WORK_ORDER',
          targetId: wo.id,
          outcome: 'SUCCESS',
          ip: '127.0.0.1',
          details: {
            number: wo.number,
            planId: plan.id,
            planName: plan.name,
            deviceId: dev.id,
            type: 'PREVENTIVE',
            approvalStatus: wo.approvalStatus,
          },
        });

        if (validTech) {
          this.workOrderService.notifyTechnicianAssigned(wo, validTech);
        }
        if (wo.approvalStatus === 'PENDING') {
          this.workOrderService.notifyManagersApprovalNeeded(wo, false);
        }
      }

      const nextRunAt = advanceMaintenanceNextRunAt(plan.nextRunAt, plan.everyDays, nowMs);
      this.repos.maintenancePlans.advanceRunSystem(plan.id, nowIso, nextRunAt);
      plansExecuted += 1;

      this.audit.record({
        actorId: 'SYSTEM',
        actorRole: 'SYSTEM',
        tenantId: plan.tenantId,
        action: 'MAINTENANCE_PLAN_EXECUTED',
        targetType: 'MAINTENANCE_PLAN',
        targetId: plan.id,
        outcome: 'SUCCESS',
        ip: '127.0.0.1',
        details: {
          planName: plan.name,
          createdWorkOrderIds: planWoIds,
          nextRunAt,
        },
      });
    }

    return {
      plansExecuted,
      workOrdersCreated: createdWorkOrderIds.length,
      createdWorkOrderIds,
    };
  }
}
