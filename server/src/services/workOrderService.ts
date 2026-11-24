import type {
  StaffOption,
  WorkOrderChecklistItem,
  WorkOrderCompletion,
  WorkOrderDetail,
  WorkOrderOutcome,
  WorkOrderPublic,
  WorkOrderType,
} from '../../../shared/types.ts';
import type { Repositories } from '../repositories/index.ts';
import {
  toDevicePublic,
  type TenantContext,
  type UserRecord,
  type WorkOrderListFilter,
} from '../repositories/types.ts';
import { Errors } from '../utils/errors.ts';
import { generateId } from '../utils/ids.ts';
import type { AuditService } from './auditService.ts';
import type { DeviceService } from './deviceService.ts';
import type { LiveStateStore } from './liveStateStore.ts';
import {
  computeApprovalAfterEdit,
  deriveInitialWorkOrderApproval,
  validateWorkOrderStart,
} from './maintenanceLogic.ts';
import type { NotificationService } from './notificationService.ts';

function validatePlannedWindow(
  plannedStart: string | null | undefined,
  plannedEnd: string | null | undefined,
): void {
  if (!plannedStart || !plannedEnd) return;
  const startMs = Date.parse(plannedStart);
  const endMs = Date.parse(plannedEnd);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw Errors.validation('Planned window timestamps must be valid ISO dates', {
      field: 'plannedStart',
    });
  }
  if (endMs <= startMs) {
    throw Errors.validation('Planned end must be after planned start', {
      field: 'plannedEnd',
    });
  }
}

export class WorkOrderService {
  constructor(
    private readonly repos: Repositories,
    private readonly liveState: LiveStateStore,
    private readonly deviceService: DeviceService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
  ) {}

  private getTenantManagers(tenantId: string): UserRecord[] {
    return this.repos.users
      .listAllActiveSystem()
      .filter((u) => u.tenantId === tenantId && u.role === 'CLIENT_MANAGER');
  }

  private getTenantAdmins(tenantId: string): UserRecord[] {
    return this.repos.users
      .listAllActiveSystem()
      .filter((u) => u.tenantId === tenantId && u.role === 'CLIENT_ADMIN');
  }

  private getAssignedEngineers(tenantId: string): UserRecord[] {
    return this.repos.users
      .listAllActiveSystem()
      .filter((u) => u.role === 'SUPPORT_ENGINEER' && u.assignedTenantIds.includes(tenantId));
  }

  private assertValidTechnician(technicianId: string, tenantId: string): UserRecord {
    const user = this.repos.users.findByIdForAuth(technicianId);
    if (
      !user ||
      user.status !== 'ACTIVE' ||
      user.role !== 'FIELD_TECHNICIAN' ||
      !user.assignedTenantIds.includes(tenantId)
    ) {
      throw Errors.validation(
        'Selected technician is not an active Field Technician assigned to this organization',
        { field: 'assignedTo' },
      );
    }
    return user;
  }

  list(ctx: TenantContext, filter: WorkOrderListFilter): { items: WorkOrderPublic[]; total: number } {
    return this.repos.workOrders.list(ctx, filter);
  }

  listAssignableTechnicians(ctx: TenantContext): StaffOption[] {
    const targetTenants = ctx.activeTenantId
      ? [ctx.activeTenantId]
      : ctx.allTenants
        ? null
        : ctx.tenantIds;

    return this.repos.users
      .listAllActiveSystem()
      .filter((u) => {
        if (u.role !== 'FIELD_TECHNICIAN') return false;
        if (targetTenants === null) return true;
        return targetTenants.some((tid) => u.assignedTenantIds.includes(tid));
      })
      .map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        isSupervisor: u.isSupervisor,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  getDetail(ctx: TenantContext, id: string): WorkOrderDetail {
    const wo = this.repos.workOrders.findById(ctx, id);
    if (!wo) {
      throw Errors.notFound('Work order not found');
    }

    const sysCtx: TenantContext = {
      userId: ctx.userId,
      role: 'PLATFORM_ADMIN',
      allTenants: true,
      tenantIds: [],
      activeTenantId: null,
    };

    const deviceRec = this.repos.devices.findById(sysCtx, wo.deviceId);
    const device = deviceRec ? this.liveState.mergeIntoDevice(toDevicePublic(deviceRec)) : null;
    const linkedTicket = wo.ticketId ? this.repos.tickets.findByIdSystem(wo.ticketId) : null;
    const recentDeviceHistory = deviceRec
      ? this.deviceService.getTimeline(ctx, wo.deviceId).slice(0, 12)
      : [];

    return {
      ...wo,
      device,
      linkedTicket,
      recentDeviceHistory,
    };
  }

  create(
    ctx: TenantContext,
    input: {
      deviceId: string;
      ticketId?: string | null;
      type: WorkOrderType;
      title: string;
      instructions: string;
      checklist?: Array<{ text: string; done?: boolean }>;
      assignedTo?: string | null;
      plannedStart?: string | null;
      plannedEnd?: string | null;
      downtimeRequired: boolean;
    },
    ip: string,
  ): WorkOrderPublic {
    const device = this.repos.devices.findById(ctx, input.deviceId);
    if (!device) {
      throw Errors.notFound('Device not found');
    }
    if (device.state === 'DECOMMISSIONED') {
      throw Errors.invalidTransition('Cannot create a work order for a decommissioned device', {
        currentState: device.state,
      });
    }

    validatePlannedWindow(input.plannedStart, input.plannedEnd);

    let ticketId: string | null = input.ticketId ?? null;
    if (ticketId) {
      const ticket = this.repos.tickets.findById(ctx, ticketId);
      if (!ticket || ticket.tenantId !== device.tenantId) {
        throw Errors.validation('Linked ticket does not exist in this organization', {
          field: 'ticketId',
        });
      }
      ticketId = ticket.id;
    }

    let assignedTechnician: UserRecord | null = null;
    if (input.assignedTo) {
      assignedTechnician = this.assertValidTechnician(input.assignedTo, device.tenantId);
    }

    const tenant = this.repos.tenants.findByIdSystem(device.tenantId);
    const requireMaintenanceApproval = tenant?.settings.requireMaintenanceApproval ?? true;
    const approvalStatus = deriveInitialWorkOrderApproval(
      input.downtimeRequired,
      requireMaintenanceApproval,
    );

    const checklist: WorkOrderChecklistItem[] = (input.checklist ?? [])
      .map((item) => ({
        id: generateId('chk'),
        text: item.text.trim(),
        done: Boolean(item.done),
      }))
      .filter((item) => item.text.length > 0);

    const created = this.repos.workOrders.create(ctx, {
      id: generateId('wo'),
      tenantId: device.tenantId,
      deviceId: device.id,
      ticketId,
      planId: null,
      type: input.type,
      title: input.title.trim(),
      instructions: input.instructions.trim(),
      checklist,
      assignedTo: assignedTechnician?.id ?? null,
      plannedStart: input.plannedStart ?? null,
      plannedEnd: input.plannedEnd ?? null,
      downtimeRequired: input.downtimeRequired,
      approvalStatus,
      status: assignedTechnician ? 'ASSIGNED' : 'PLANNED',
      createdBy: ctx.userId,
    });

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: device.tenantId,
      action: 'WORK_ORDER_CREATED',
      targetType: 'WORK_ORDER',
      targetId: created.id,
      outcome: 'SUCCESS',
      ip,
      details: {
        number: created.number,
        deviceId: created.deviceId,
        ticketId: created.ticketId,
        type: created.type,
        downtimeRequired: created.downtimeRequired,
        approvalStatus: created.approvalStatus,
        assignedTo: created.assignedTo,
      },
    });

    if (assignedTechnician) {
      this.notifyTechnicianAssigned(created, assignedTechnician);
    }
    if (created.approvalStatus === 'PENDING') {
      this.notifyManagersApprovalNeeded(created, false);
    }

    return created;
  }

  update(
    ctx: TenantContext,
    id: string,
    patch: {
      title?: string;
      instructions?: string;
      checklist?: Array<{ id?: string; text: string; done?: boolean }>;
      plannedStart?: string | null;
      plannedEnd?: string | null;
      downtimeRequired?: boolean;
    },
    ip: string,
  ): WorkOrderDetail {
    const existing = this.repos.workOrders.findById(ctx, id);
    if (!existing) {
      throw Errors.notFound('Work order not found');
    }

    if (
      existing.status === 'IN_PROGRESS' ||
      existing.status === 'COMPLETED' ||
      existing.status === 'CANCELLED'
    ) {
      throw Errors.invalidTransition(
        `Cannot edit work order details while status is ${existing.status}`,
        { currentState: existing.status },
      );
    }

    const nextPlannedStart =
      patch.plannedStart !== undefined ? patch.plannedStart : existing.plannedStart;
    const nextPlannedEnd = patch.plannedEnd !== undefined ? patch.plannedEnd : existing.plannedEnd;
    validatePlannedWindow(nextPlannedStart, nextPlannedEnd);

    const nextDowntime =
      patch.downtimeRequired !== undefined ? patch.downtimeRequired : existing.downtimeRequired;

    const nextChecklist: WorkOrderChecklistItem[] | undefined =
      patch.checklist !== undefined
        ? patch.checklist
            .map((c) => ({
              id: c.id && c.id.trim() ? c.id.trim() : generateId('chk'),
              text: c.text.trim(),
              done: Boolean(c.done),
            }))
            .filter((c) => c.text.length > 0)
        : undefined;

    const detailsChanged =
      (patch.title !== undefined && patch.title.trim() !== existing.title) ||
      (patch.instructions !== undefined && patch.instructions.trim() !== existing.instructions) ||
      nextChecklist !== undefined ||
      nextDowntime !== existing.downtimeRequired;

    const tenant = this.repos.tenants.findByIdSystem(existing.tenantId);
    const requireMaintenanceApproval = tenant?.settings.requireMaintenanceApproval ?? true;

    const approvalResult = computeApprovalAfterEdit({
      currentDowntimeRequired: existing.downtimeRequired,
      currentApprovalStatus: existing.approvalStatus,
      currentPlannedStart: existing.plannedStart,
      currentPlannedEnd: existing.plannedEnd,
      nextDowntimeRequired: nextDowntime,
      nextPlannedStart,
      nextPlannedEnd,
      requireMaintenanceApproval,
      detailsChanged,
    });

    const updated = this.repos.workOrders.update(ctx, id, {
      title: patch.title !== undefined ? patch.title.trim() : undefined,
      instructions: patch.instructions !== undefined ? patch.instructions.trim() : undefined,
      checklist: nextChecklist,
      plannedStart: patch.plannedStart,
      plannedEnd: patch.plannedEnd,
      downtimeRequired: nextDowntime,
      approvalStatus: approvalResult.approvalStatus,
      approvalNote: approvalResult.clearNote ? null : undefined,
      approvedBy: approvalResult.clearNote ? null : undefined,
      approvedAt: approvalResult.clearNote ? null : undefined,
    });
    if (!updated) {
      throw Errors.notFound('Work order not found');
    }

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: existing.tenantId,
      action: 'WORK_ORDER_UPDATED',
      targetType: 'WORK_ORDER',
      targetId: updated.id,
      outcome: 'SUCCESS',
      ip,
      details: {
        number: updated.number,
        approvalStatusBefore: existing.approvalStatus,
        approvalStatusAfter: updated.approvalStatus,
        plannedStart: updated.plannedStart,
        plannedEnd: updated.plannedEnd,
      },
    });

    if (approvalResult.notifyManagers) {
      this.notifyManagersApprovalNeeded(updated, existing.approvalStatus === 'REJECTED');
    }

    return this.getDetail(ctx, updated.id);
  }

  assign(
    ctx: TenantContext,
    id: string,
    input: {
      assignedTo: string | null;
      plannedStart?: string | null;
      plannedEnd?: string | null;
    },
    ip: string,
  ): WorkOrderDetail {
    const existing = this.repos.workOrders.findById(ctx, id);
    if (!existing) {
      throw Errors.notFound('Work order not found');
    }

    if (
      existing.status === 'IN_PROGRESS' ||
      existing.status === 'COMPLETED' ||
      existing.status === 'CANCELLED'
    ) {
      throw Errors.invalidTransition(
        `Cannot reassign work order in status ${existing.status}`,
        { currentState: existing.status },
      );
    }

    let tech: UserRecord | null = null;
    if (input.assignedTo) {
      tech = this.assertValidTechnician(input.assignedTo, existing.tenantId);
    }

    const nextPlannedStart =
      input.plannedStart !== undefined ? input.plannedStart : existing.plannedStart;
    const nextPlannedEnd =
      input.plannedEnd !== undefined ? input.plannedEnd : existing.plannedEnd;
    validatePlannedWindow(nextPlannedStart, nextPlannedEnd);

    const tenant = this.repos.tenants.findByIdSystem(existing.tenantId);
    const requireMaintenanceApproval = tenant?.settings.requireMaintenanceApproval ?? true;

    const approvalResult = computeApprovalAfterEdit({
      currentDowntimeRequired: existing.downtimeRequired,
      currentApprovalStatus: existing.approvalStatus,
      currentPlannedStart: existing.plannedStart,
      currentPlannedEnd: existing.plannedEnd,
      nextDowntimeRequired: existing.downtimeRequired,
      nextPlannedStart,
      nextPlannedEnd,
      requireMaintenanceApproval,
      detailsChanged: false,
    });

    const updated = this.repos.workOrders.update(ctx, id, {
      assignedTo: tech?.id ?? null,
      status: tech ? 'ASSIGNED' : 'PLANNED',
      plannedStart: input.plannedStart,
      plannedEnd: input.plannedEnd,
      approvalStatus: approvalResult.approvalStatus,
      approvalNote: approvalResult.clearNote ? null : undefined,
      approvedBy: approvalResult.clearNote ? null : undefined,
      approvedAt: approvalResult.clearNote ? null : undefined,
    });
    if (!updated) {
      throw Errors.notFound('Work order not found');
    }

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: existing.tenantId,
      action: 'WORK_ORDER_ASSIGNED',
      targetType: 'WORK_ORDER',
      targetId: updated.id,
      outcome: 'SUCCESS',
      ip,
      details: {
        number: updated.number,
        assignedTo: updated.assignedTo,
        plannedStart: updated.plannedStart,
        plannedEnd: updated.plannedEnd,
      },
    });

    if (tech && tech.id !== existing.assignedTo) {
      this.notifyTechnicianAssigned(updated, tech);
    }
    if (approvalResult.notifyManagers) {
      this.notifyManagersApprovalNeeded(updated, existing.approvalStatus === 'REJECTED');
    }

    return this.getDetail(ctx, updated.id);
  }

  /**
   * Section 5.3 & 8.5: Client Manager approves or rejects a pending downtime maintenance window.
   */
  decide(
    ctx: TenantContext,
    id: string,
    input: { decision: 'APPROVED' | 'REJECTED'; note?: string },
    ip: string,
  ): WorkOrderDetail {
    const existing = this.repos.workOrders.findById(ctx, id);
    if (!existing) {
      throw Errors.notFound('Work order not found');
    }

    if (existing.status === 'COMPLETED' || existing.status === 'CANCELLED') {
      throw Errors.invalidTransition(`Work order is already ${existing.status}`, {
        currentState: existing.status,
      });
    }

    if (existing.approvalStatus !== 'PENDING') {
      throw Errors.invalidTransition(
        `Work order approval is ${existing.approvalStatus}, not PENDING`,
        { currentState: existing.approvalStatus },
      );
    }

    const note = input.note?.trim() ?? '';
    if (input.decision === 'REJECTED' && note.length < 3) {
      throw Errors.validation('A rejection reason (at least 3 characters) is required', {
        field: 'note',
      });
    }

    const now = new Date().toISOString();
    const updated = this.repos.workOrders.update(ctx, id, {
      approvalStatus: input.decision,
      approvalNote: note || null,
      approvedBy: ctx.userId,
      approvedAt: now,
    });
    if (!updated) {
      throw Errors.notFound('Work order not found');
    }

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: existing.tenantId,
      action: input.decision === 'APPROVED' ? 'WORK_ORDER_APPROVED' : 'WORK_ORDER_REJECTED',
      targetType: 'WORK_ORDER',
      targetId: updated.id,
      outcome: 'SUCCESS',
      ip,
      details: {
        number: updated.number,
        decision: input.decision,
        note: note || null,
      },
    });

    const engineers = this.getAssignedEngineers(updated.tenantId);
    const creator = this.repos.users.findByIdForAuth(updated.createdBy);
    const recipients = creator ? [creator, ...engineers] : engineers;

    this.notifications.notifyUsersSystem(recipients, {
      tenantId: updated.tenantId,
      type: input.decision === 'APPROVED' ? 'WORK_ORDER_APPROVED' : 'WORK_ORDER_REJECTED',
      title: `${updated.number} maintenance window ${input.decision.toLowerCase()}`,
      body: note || updated.title,
      link: `/work-orders/${updated.id}`,
      emailSubject: `[OmniSphere] ${updated.number} Maintenance Window ${input.decision}`,
      emailSummary:
        input.decision === 'APPROVED'
          ? `Client Manager approved the planned maintenance window for ${updated.number}. Field execution can now proceed.`
          : `Client Manager rejected the planned maintenance window for ${updated.number}. Please adjust the window or details to resubmit for approval.`,
      emailFacts: [
        { label: 'Work Order', value: updated.number },
        { label: 'Device', value: updated.deviceName ?? updated.deviceId },
        { label: 'Decision', value: input.decision },
        { label: 'Note', value: note || 'None' },
      ],
      emailCtaLabel: 'Open Work Order',
      relatedType: 'WORK_ORDER',
      relatedId: updated.id,
    });

    if (input.decision === 'APPROVED' && updated.assignedTo) {
      const tech = this.repos.users.findByIdForAuth(updated.assignedTo);
      if (tech) {
        this.notifications.notifyUsersSystem([tech], {
          tenantId: updated.tenantId,
          type: 'WORK_ORDER_APPROVED',
          title: `${updated.number} approved — ready to start`,
          body: `${updated.deviceName ?? updated.deviceId} (${updated.siteName ?? ''})`,
          link: `/work-orders/${updated.id}`,
          emailSubject: `[OmniSphere] ${updated.number} Approved — Ready to Start`,
          emailSummary: `The maintenance window for ${updated.number} has been approved. You may start work during the planned window.`,
          emailFacts: [
            { label: 'Work Order', value: updated.number },
            { label: 'Device', value: updated.deviceName ?? updated.deviceId },
            { label: 'Site', value: updated.siteName ?? 'N/A' },
          ],
          emailCtaLabel: 'Open Work Order',
          relatedType: 'WORK_ORDER',
          relatedId: updated.id,
        });
      }
    }

    return this.getDetail(ctx, updated.id);
  }

  updateChecklist(
    ctx: TenantContext,
    id: string,
    items: Array<{ id: string; text?: string; done: boolean }>,
  ): WorkOrderDetail {
    const existing = this.repos.workOrders.findById(ctx, id);
    if (!existing) {
      throw Errors.notFound('Work order not found');
    }
    if (existing.status === 'COMPLETED' || existing.status === 'CANCELLED') {
      throw Errors.invalidTransition(`Cannot update checklist when status is ${existing.status}`, {
        currentState: existing.status,
      });
    }

    let nextChecklist: WorkOrderChecklistItem[];
    if (ctx.role === 'FIELD_TECHNICIAN') {
      const doneById = new Map(items.map((i) => [i.id, Boolean(i.done)]));
      nextChecklist = existing.checklist.map((item) => ({
        ...item,
        done: doneById.has(item.id) ? doneById.get(item.id)! : item.done,
      }));
    } else {
      nextChecklist = items
        .map((i) => ({
          id: i.id || generateId('chk'),
          text: (i.text ?? '').trim(),
          done: Boolean(i.done),
        }))
        .filter((i) => i.text.length > 0);
    }

    const updated = this.repos.workOrders.update(ctx, id, { checklist: nextChecklist });
    if (!updated) {
      throw Errors.notFound('Work order not found');
    }
    return this.getDetail(ctx, updated.id);
  }

  /**
   * Section 5.3 & 8.5: FT starts work order -> WO becomes IN_PROGRESS,
   * device transitions ACTIVE -> UNDER_MAINTENANCE (alerts suppressed immediately).
   */
  start(ctx: TenantContext, id: string, ip: string): WorkOrderDetail {
    const existing = this.repos.workOrders.findById(ctx, id);
    if (!existing) {
      throw Errors.notFound('Work order not found');
    }

    const check = validateWorkOrderStart(existing, ctx.userId);
    if (!check.ok) {
      if (check.code === 'FORBIDDEN') {
        throw Errors.forbidden(check.message);
      }
      throw Errors.invalidTransition(check.message, {
        status: existing.status,
        approvalStatus: existing.approvalStatus,
      });
    }

    if (existing.deviceState === 'DECOMMISSIONED' || existing.deviceState === 'SUSPENDED') {
      throw Errors.invalidTransition(
        `Cannot start maintenance while device is in ${existing.deviceState} state`,
        { deviceState: existing.deviceState },
      );
    }

    const now = new Date().toISOString();
    const updated = this.repos.workOrders.update(ctx, id, {
      status: 'IN_PROGRESS',
      startedAt: now,
    });
    if (!updated) {
      throw Errors.notFound('Work order not found');
    }

    this.deviceService.transitionLifecycleForWorkOrderSystem({
      deviceId: existing.deviceId,
      targetState: 'UNDER_MAINTENANCE',
      reason: `Work order ${existing.number}`,
      actorId: ctx.userId,
      actorRole: ctx.role,
      ip,
    });

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: existing.tenantId,
      action: 'WORK_ORDER_STARTED',
      targetType: 'WORK_ORDER',
      targetId: updated.id,
      outcome: 'SUCCESS',
      ip,
      details: {
        number: updated.number,
        deviceId: updated.deviceId,
      },
    });

    return this.getDetail(ctx, updated.id);
  }

  /**
   * Section 5.3 & 8.5: FT completes work order -> WO becomes COMPLETED,
   * device transitions UNDER_MAINTENANCE -> ACTIVE, and system comment added to linked ticket.
   */
  complete(
    ctx: TenantContext,
    id: string,
    input: {
      actionsTaken: string;
      partsReplaced?: string[];
      notes?: string;
      timeSpentMin: number;
      outcome: WorkOrderOutcome;
      checklist?: Array<{ id: string; done: boolean }>;
    },
    ip: string,
  ): WorkOrderDetail {
    const existing = this.repos.workOrders.findById(ctx, id);
    if (!existing) {
      throw Errors.notFound('Work order not found');
    }

    if (existing.assignedTo !== ctx.userId) {
      throw Errors.forbidden('Only the assigned Field Technician can complete this work order');
    }
    if (existing.status !== 'IN_PROGRESS') {
      throw Errors.invalidTransition(
        'Work order must be IN_PROGRESS before it can be completed',
        { currentState: existing.status },
      );
    }

    const parts = (input.partsReplaced ?? []).map((p) => p.trim()).filter(Boolean);
    const completion: WorkOrderCompletion = {
      actionsTaken: input.actionsTaken.trim(),
      partsReplaced: parts,
      notes: (input.notes ?? '').trim(),
      timeSpentMin: Math.round(input.timeSpentMin),
      outcome: input.outcome,
    };

    let nextChecklist: WorkOrderChecklistItem[] | undefined;
    if (input.checklist) {
      const doneById = new Map(input.checklist.map((i) => [i.id, Boolean(i.done)]));
      nextChecklist = existing.checklist.map((item) => ({
        ...item,
        done: doneById.has(item.id) ? doneById.get(item.id)! : item.done,
      }));
    }

    const now = new Date().toISOString();
    const updated = this.repos.workOrders.update(ctx, id, {
      status: 'COMPLETED',
      completedAt: now,
      completion,
      checklist: nextChecklist,
    });
    if (!updated) {
      throw Errors.notFound('Work order not found');
    }

    this.deviceService.transitionLifecycleForWorkOrderSystem({
      deviceId: existing.deviceId,
      targetState: 'ACTIVE',
      reason: `Work order ${existing.number} completed`,
      actorId: ctx.userId,
      actorRole: ctx.role,
      ip,
    });

    // Add system comment to linked ticket (Section 8.5)
    if (existing.ticketId) {
      const tech = this.repos.users.findByIdForAuth(ctx.userId);
      const partsSummary = parts.length > 0 ? ` Parts replaced: ${parts.join(', ')}.` : '';
      const notesSummary = completion.notes ? ` Notes: ${completion.notes}` : '';
      this.repos.tickets.appendCommentSystem(existing.ticketId, {
        id: generateId('cmt'),
        authorId: 'SYSTEM',
        authorRole: 'SYSTEM',
        authorName: 'Maintenance System',
        body: `Work order ${existing.number} completed (${completion.outcome}) by ${tech?.name ?? 'Field Technician'} in ${completion.timeSpentMin} min. Actions taken: ${completion.actionsTaken}.${partsSummary}${notesSummary}`,
        at: now,
      });
    }

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: existing.tenantId,
      action: 'WORK_ORDER_COMPLETED',
      targetType: 'WORK_ORDER',
      targetId: updated.id,
      outcome: 'SUCCESS',
      ip,
      details: {
        number: updated.number,
        deviceId: updated.deviceId,
        ticketId: updated.ticketId,
        outcome: completion.outcome,
        timeSpentMin: completion.timeSpentMin,
        partsReplaced: parts,
      },
    });

    const recipients = [
      ...this.getAssignedEngineers(updated.tenantId),
      ...this.getTenantAdmins(updated.tenantId),
    ];
    this.notifications.notifyUsersSystem(recipients, {
      tenantId: updated.tenantId,
      type: 'WORK_ORDER_COMPLETED',
      title: `${updated.number} completed (${completion.outcome})`,
      body: `${updated.deviceName ?? updated.deviceId}: ${completion.actionsTaken.slice(0, 120)}`,
      link: `/work-orders/${updated.id}`,
      emailSubject: `[OmniSphere] ${updated.number} Completed (${completion.outcome})`,
      emailSummary: `Field maintenance work order ${updated.number} has been completed and the device returned to ACTIVE state.`,
      emailFacts: [
        { label: 'Work Order', value: updated.number },
        { label: 'Device', value: updated.deviceName ?? updated.deviceId },
        { label: 'Outcome', value: completion.outcome },
        { label: 'Time Spent', value: `${completion.timeSpentMin} min` },
        { label: 'Parts Replaced', value: parts.length > 0 ? parts.join(', ') : 'None' },
      ],
      emailCtaLabel: 'View Completion Report',
      relatedType: 'WORK_ORDER',
      relatedId: updated.id,
    });

    return this.getDetail(ctx, updated.id);
  }

  cancel(ctx: TenantContext, id: string, reason: string | undefined, ip: string): WorkOrderDetail {
    const existing = this.repos.workOrders.findById(ctx, id);
    if (!existing) {
      throw Errors.notFound('Work order not found');
    }

    if (existing.status !== 'PLANNED' && existing.status !== 'ASSIGNED') {
      throw Errors.invalidTransition(
        `Cannot cancel a work order in status ${existing.status}`,
        { currentState: existing.status },
      );
    }

    const updated = this.repos.workOrders.update(ctx, id, { status: 'CANCELLED' });
    if (!updated) {
      throw Errors.notFound('Work order not found');
    }

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: existing.tenantId,
      action: 'WORK_ORDER_CANCELLED',
      targetType: 'WORK_ORDER',
      targetId: updated.id,
      outcome: 'SUCCESS',
      ip,
      details: { number: updated.number, reason: reason?.trim() ?? null },
    });

    return this.getDetail(ctx, updated.id);
  }

  notifyTechnicianAssigned(wo: WorkOrderPublic, technician: UserRecord): void {
    this.notifications.notifyUsersSystem([technician], {
      tenantId: wo.tenantId,
      type: 'WORK_ORDER_ASSIGNED',
      title: `Assigned ${wo.number}: ${wo.title}`,
      body: `${wo.deviceName ?? wo.deviceId} at ${wo.siteName ?? 'site'}`,
      link: `/work-orders/${wo.id}`,
      emailSubject: `[OmniSphere] Work Order ${wo.number} Assigned`,
      emailSummary: `You have been assigned a ${wo.type.toLowerCase()} maintenance work order.`,
      emailFacts: [
        { label: 'Work Order', value: wo.number },
        { label: 'Device', value: wo.deviceName ?? wo.deviceId },
        { label: 'Site', value: wo.siteName ?? 'N/A' },
        { label: 'Planned Start', value: wo.plannedStart ?? 'Unscheduled' },
        { label: 'Approval', value: wo.approvalStatus },
      ],
      emailCtaLabel: 'Open Work Order',
      relatedType: 'WORK_ORDER',
      relatedId: wo.id,
    });
  }

  notifyManagersApprovalNeeded(wo: WorkOrderPublic, isResubmission: boolean): void {
    const managers = this.getTenantManagers(wo.tenantId);
    this.notifications.notifyUsersSystem(managers, {
      tenantId: wo.tenantId,
      type: 'MAINTENANCE_APPROVAL_REQUESTED',
      title: isResubmission
        ? `Resubmitted approval: ${wo.number}`
        : `Maintenance approval needed: ${wo.number}`,
      body: `${wo.title} (${wo.deviceName ?? wo.deviceId}) requires downtime.`,
      link: '/approvals',
      emailSubject: `[OmniSphere] Approval Needed for Maintenance Window ${wo.number}`,
      emailSummary: isResubmission
        ? `Support updated work order ${wo.number} and resubmitted the maintenance window for your approval.`
        : `Work order ${wo.number} requires planned device downtime and awaits your approval before field work can start.`,
      emailFacts: [
        { label: 'Work Order', value: wo.number },
        { label: 'Device', value: wo.deviceName ?? wo.deviceId },
        { label: 'Site', value: wo.siteName ?? 'N/A' },
        { label: 'Planned Start', value: wo.plannedStart ?? 'TBD' },
        { label: 'Planned End', value: wo.plannedEnd ?? 'TBD' },
      ],
      emailCtaLabel: 'Review Approval',
      relatedType: 'WORK_ORDER',
      relatedId: wo.id,
    });
  }
}
