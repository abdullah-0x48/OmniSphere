import type {
  StaffOption,
  TicketComment,
  TicketDetail,
  TicketPriority,
  TicketPublic,
  TicketSource,
  TicketStatus,
} from '../../../shared/types.ts';
import type { Repositories } from '../repositories/index.ts';
import {
  toDevicePublic,
  type TenantContext,
  type TicketListFilter,
  type UserRecord,
} from '../repositories/types.ts';
import { Errors } from '../utils/errors.ts';
import { generateId } from '../utils/ids.ts';
import type { AuditService } from './auditService.ts';
import type { LiveStateStore } from './liveStateStore.ts';
import {
  canTransitionTicketStatusBySe,
  mapAlertSeverityToTicketPriority,
  shouldShowPostMaintenanceOfflineWarning,
} from './maintenanceLogic.ts';
import type { NotificationService } from './notificationService.ts';

function isClientRole(role: TenantContext['role']): boolean {
  return role === 'CLIENT_ADMIN' || role === 'CLIENT_MANAGER' || role === 'CLIENT_OPERATOR';
}

export class TicketService {
  constructor(
    private readonly repos: Repositories,
    private readonly liveState: LiveStateStore,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
  ) {}

  private resolveWriteTenantId(ctx: TenantContext): string {
    if (ctx.activeTenantId) return ctx.activeTenantId;
    if (ctx.tenantIds.length === 1) return ctx.tenantIds[0];
    throw Errors.validation('Select a working organization before creating a ticket');
  }

  private getAssignedEngineersForTenant(tenantId: string): UserRecord[] {
    return this.repos.users
      .listAllActiveSystem()
      .filter(
        (u) => u.role === 'SUPPORT_ENGINEER' && u.assignedTenantIds.includes(tenantId),
      );
  }

  private getClientContactsForTicket(ticket: TicketPublic): UserRecord[] {
    const allActive = this.repos.users.listAllActiveSystem();
    const contacts: UserRecord[] = [];
    for (const u of allActive) {
      if (u.tenantId !== ticket.tenantId) continue;
      if (u.id === ticket.createdBy || u.role === 'CLIENT_ADMIN' || u.role === 'CLIENT_OPERATOR') {
        contacts.push(u);
      }
    }
    return contacts;
  }

  list(ctx: TenantContext, filter: TicketListFilter): { items: TicketPublic[]; total: number } {
    return this.repos.tickets.list(ctx, filter);
  }

  listAssignableEngineers(ctx: TenantContext): StaffOption[] {
    const targetTenants = ctx.activeTenantId
      ? [ctx.activeTenantId]
      : ctx.allTenants
        ? null
        : ctx.tenantIds;

    return this.repos.users
      .listAllActiveSystem()
      .filter((u) => {
        if (u.role !== 'SUPPORT_ENGINEER') return false;
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

  getDetail(ctx: TenantContext, id: string): TicketDetail {
    const ticket = this.repos.tickets.findById(ctx, id);
    if (!ticket) {
      throw Errors.notFound('Ticket not found');
    }

    const linkedAlert = ticket.alertId
      ? this.repos.alerts.findByIdSystem(ticket.alertId)
      : null;
    const linkedWorkOrders = this.repos.workOrders.listByTicket(ctx, ticket.id);

    let device = null;
    if (ticket.deviceId) {
      const sysCtx: TenantContext = {
        userId: ctx.userId,
        role: 'PLATFORM_ADMIN',
        allTenants: true,
        tenantIds: [],
        activeTenantId: null,
      };
      const rec = this.repos.devices.findById(sysCtx, ticket.deviceId);
      if (rec) {
        device = this.liveState.mergeIntoDevice(toDevicePublic(rec));
      }
    }

    const postMaintenanceOfflineWarning = shouldShowPostMaintenanceOfflineWarning(
      linkedWorkOrders,
      device?.connectivity,
    );

    return {
      ...ticket,
      linkedAlert,
      linkedWorkOrders,
      device,
      postMaintenanceOfflineWarning,
    };
  }

  create(
    ctx: TenantContext,
    input: {
      title: string;
      description: string;
      priority?: TicketPriority;
      source?: TicketSource;
      deviceId?: string | null;
      siteId?: string | null;
      assigneeId?: string | null;
    },
    ip: string,
  ): TicketPublic {
    const tenantId = this.resolveWriteTenantId(ctx);
    const tenant = this.repos.tenants.findByIdSystem(tenantId);
    if (!tenant) {
      throw Errors.notFound('Organization not found');
    }

    let deviceId: string | null = input.deviceId ?? null;
    let siteId: string | null = input.siteId ?? null;

    if (deviceId) {
      const dev = this.repos.devices.findById(ctx, deviceId);
      if (!dev || dev.tenantId !== tenantId) {
        throw Errors.validation('Selected device does not exist in this organization', {
          field: 'deviceId',
        });
      }
      if (!siteId) {
        siteId = dev.siteId;
      }
    }

    if (siteId) {
      const site = this.repos.sites.findById(ctx, siteId);
      if (!site || site.tenantId !== tenantId) {
        throw Errors.validation('Selected site does not exist in this organization', {
          field: 'siteId',
        });
      }
    }

    const clientCreated = isClientRole(ctx.role);
    const source: TicketSource = clientCreated
      ? 'SERVICE_REQUEST'
      : (input.source ?? 'INTERNAL');
    const priority: TicketPriority = input.priority ?? 'MEDIUM';
    let assigneeId: string | null = null;

    if (!clientCreated && input.assigneeId) {
      const candidate = this.repos.users.findByIdForAuth(input.assigneeId);
      if (
        !candidate ||
        candidate.status !== 'ACTIVE' ||
        candidate.role !== 'SUPPORT_ENGINEER' ||
        !candidate.assignedTenantIds.includes(tenantId)
      ) {
        throw Errors.validation('Selected assignee is not an active Support Engineer for this organization', {
          field: 'assigneeId',
        });
      }
      assigneeId = candidate.id;
    }

    const created = this.repos.tickets.create(ctx, {
      id: generateId('tkt'),
      tenantId,
      deviceId,
      siteId,
      source,
      alertId: null,
      title: input.title.trim(),
      description: input.description.trim(),
      priority,
      status: 'OPEN',
      assigneeId,
      createdBy: ctx.userId,
    });

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId,
      action: 'TICKET_CREATED',
      targetType: 'TICKET',
      targetId: created.id,
      outcome: 'SUCCESS',
      ip,
      details: {
        number: created.number,
        source: created.source,
        priority: created.priority,
        deviceId: created.deviceId,
        assigneeId: created.assigneeId,
      },
    });

    // Notify assigned Support Engineers when a client raises a service request
    if (clientCreated) {
      const engineers = this.getAssignedEngineersForTenant(tenantId);
      this.notifications.notifyUsersSystem(engineers, {
        tenantId,
        type: 'TICKET_CREATED',
        title: `New service request ${created.number}`,
        body: `${created.title} (${tenant.code})`,
        link: `/tickets/${created.id}`,
        emailSubject: `[OmniSphere] Service Request ${created.number}: ${created.title}`,
        emailSummary: `A new client service request has been submitted for ${tenant.name}.`,
        emailFacts: [
          { label: 'Ticket', value: created.number },
          { label: 'Organization', value: `${tenant.name} (${tenant.code})` },
          { label: 'Priority', value: created.priority },
          { label: 'Device', value: created.deviceName ?? 'General / Site' },
        ],
        emailCtaLabel: 'Open Ticket',
        relatedType: 'TICKET',
        relatedId: created.id,
      });
    } else if (assigneeId && assigneeId !== ctx.userId) {
      const assignee = this.repos.users.findByIdForAuth(assigneeId);
      if (assignee) {
        this.notifications.notifyUsersSystem([assignee], {
          tenantId,
          type: 'TICKET_ASSIGNED',
          title: `Ticket ${created.number} assigned to you`,
          body: created.title,
          link: `/tickets/${created.id}`,
          emailSubject: `[OmniSphere] Assigned Ticket ${created.number}: ${created.title}`,
          emailSummary: `You have been assigned ticket ${created.number} for ${tenant.name}.`,
          emailFacts: [
            { label: 'Ticket', value: created.number },
            { label: 'Priority', value: created.priority },
            { label: 'Device', value: created.deviceName ?? 'N/A' },
          ],
          emailCtaLabel: 'View Ticket',
          relatedType: 'TICKET',
          relatedId: created.id,
        });
      }
    }

    return created;
  }

  /**
   * Section 5.3 & 8.5: SE converts an alert into a ticket (`source: ALERT`,
   * priority mapped from severity, assignee = current SE, and links `alert.ticketId`).
   */
  createFromAlert(ctx: TenantContext, alertId: string, ip: string): TicketPublic {
    const alert = this.repos.alerts.findById(ctx, alertId);
    if (!alert) {
      throw Errors.notFound('Alert not found');
    }

    if (alert.ticketId) {
      const existingTicket = this.repos.tickets.findByIdSystem(alert.ticketId);
      if (existingTicket) {
        throw Errors.conflict(
          `Alert is already linked to ticket ${existingTicket.number}`,
          { ticketId: existingTicket.id, ticketNumber: existingTicket.number },
        );
      }
    }

    const priority = mapAlertSeverityToTicketPriority(alert.severity);
    const deviceLabel = alert.deviceName ?? alert.deviceId;
    const ruleLabel = alert.ruleName ?? 'Device Alert';
    const title = `${deviceLabel}: ${ruleLabel}`;
    const description = [
      alert.message,
      `Raised at: ${alert.createdAt}`,
      alert.siteName ? `Site: ${alert.siteName}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    const created = this.repos.tickets.create(ctx, {
      id: generateId('tkt'),
      tenantId: alert.tenantId,
      deviceId: alert.deviceId,
      siteId: alert.siteId ?? null,
      source: 'ALERT',
      alertId: alert.id,
      title,
      description,
      priority,
      status: 'OPEN',
      assigneeId: ctx.userId,
      createdBy: ctx.userId,
    });

    this.repos.alerts.setTicketId(ctx, alert.id, created.id);

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: alert.tenantId,
      action: 'TICKET_CREATED',
      targetType: 'TICKET',
      targetId: created.id,
      outcome: 'SUCCESS',
      ip,
      details: {
        number: created.number,
        source: 'ALERT',
        alertId: alert.id,
        priority: created.priority,
        assigneeId: created.assigneeId,
      },
    });

    return created;
  }

  update(
    ctx: TenantContext,
    id: string,
    patch: { assigneeId?: string | null; priority?: TicketPriority; status?: TicketStatus },
    ip: string,
  ): TicketPublic {
    const existing = this.repos.tickets.findById(ctx, id);
    if (!existing) {
      throw Errors.notFound('Ticket not found');
    }

    if (existing.status === 'CLOSED') {
      throw Errors.invalidTransition('Closed tickets cannot be modified', {
        currentState: existing.status,
      });
    }

    if (patch.status !== undefined && !canTransitionTicketStatusBySe(existing.status, patch.status)) {
      throw Errors.invalidTransition(
        `Cannot transition ticket from ${existing.status} to ${patch.status} directly. Use Resolve or Close actions.`,
        { currentState: existing.status, targetState: patch.status },
      );
    }

    if (patch.assigneeId !== undefined && patch.assigneeId !== null) {
      const candidate = this.repos.users.findByIdForAuth(patch.assigneeId);
      if (
        !candidate ||
        candidate.status !== 'ACTIVE' ||
        candidate.role !== 'SUPPORT_ENGINEER' ||
        !candidate.assignedTenantIds.includes(existing.tenantId)
      ) {
        throw Errors.validation('Selected assignee is not an active Support Engineer for this organization', {
          field: 'assigneeId',
        });
      }
    }

    const updated = this.repos.tickets.update(ctx, id, {
      assigneeId: patch.assigneeId,
      priority: patch.priority,
      status: patch.status,
    });
    if (!updated) {
      throw Errors.notFound('Ticket not found');
    }

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: existing.tenantId,
      action: 'TICKET_UPDATED',
      targetType: 'TICKET',
      targetId: updated.id,
      outcome: 'SUCCESS',
      ip,
      details: {
        number: updated.number,
        before: {
          assigneeId: existing.assigneeId,
          priority: existing.priority,
          status: existing.status,
        },
        after: {
          assigneeId: updated.assigneeId,
          priority: updated.priority,
          status: updated.status,
        },
      },
    });

    // Notify client when ticket moves to WAITING_ON_CLIENT (Section 5.3)
    if (patch.status === 'WAITING_ON_CLIENT' && existing.status !== 'WAITING_ON_CLIENT') {
      const contacts = this.getClientContactsForTicket(updated);
      this.notifications.notifyUsersSystem(contacts, {
        tenantId: updated.tenantId,
        type: 'TICKET_WAITING_ON_CLIENT',
        title: `Input requested on ${updated.number}`,
        body: `Support is waiting on your response for "${updated.title}".`,
        link: `/tickets/${updated.id}`,
        emailSubject: `[OmniSphere] Response Needed on Ticket ${updated.number}`,
        emailSummary: `The support team needs additional details to continue working on ticket ${updated.number}. Replying to the ticket will automatically resume progress.`,
        emailFacts: [
          { label: 'Ticket', value: updated.number },
          { label: 'Title', value: updated.title },
          { label: 'Status', value: 'WAITING_ON_CLIENT' },
        ],
        emailCtaLabel: 'Reply to Ticket',
        relatedType: 'TICKET',
        relatedId: updated.id,
      });
    }

    if (
      patch.assigneeId &&
      patch.assigneeId !== existing.assigneeId &&
      patch.assigneeId !== ctx.userId
    ) {
      const assignee = this.repos.users.findByIdForAuth(patch.assigneeId);
      if (assignee) {
        this.notifications.notifyUsersSystem([assignee], {
          tenantId: updated.tenantId,
          type: 'TICKET_ASSIGNED',
          title: `Ticket ${updated.number} assigned to you`,
          body: updated.title,
          link: `/tickets/${updated.id}`,
          emailSubject: `[OmniSphere] Assigned Ticket ${updated.number}`,
          emailSummary: `Ticket ${updated.number} has been reassigned to you.`,
          emailFacts: [
            { label: 'Ticket', value: updated.number },
            { label: 'Title', value: updated.title },
            { label: 'Priority', value: updated.priority },
          ],
          emailCtaLabel: 'Open Ticket',
          relatedType: 'TICKET',
          relatedId: updated.id,
        });
      }
    }

    return updated;
  }

  addComment(ctx: TenantContext, id: string, body: string, ip: string): TicketDetail {
    const existing = this.repos.tickets.findById(ctx, id);
    if (!existing) {
      throw Errors.notFound('Ticket not found');
    }

    if (existing.status === 'CLOSED') {
      throw Errors.invalidTransition('Cannot add comments to a closed ticket', {
        currentState: existing.status,
      });
    }

    const author = this.repos.users.findByIdForAuth(ctx.userId);
    const comment: TicketComment = {
      id: generateId('cmt'),
      authorId: ctx.userId,
      authorRole: ctx.role,
      authorName: author?.name ?? ctx.userId,
      body: body.trim(),
      at: new Date().toISOString(),
    };

    // Section 5.3: Client reply on WAITING_ON_CLIENT automatically moves ticket back to IN_PROGRESS
    const autoResume = existing.status === 'WAITING_ON_CLIENT' && isClientRole(ctx.role);
    const nextStatus = autoResume ? 'IN_PROGRESS' : undefined;

    const updated = this.repos.tickets.appendCommentSystem(existing.id, comment, nextStatus);
    if (!updated) {
      throw Errors.notFound('Ticket not found');
    }

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: existing.tenantId,
      action: 'TICKET_COMMENT_ADDED',
      targetType: 'TICKET',
      targetId: existing.id,
      outcome: 'SUCCESS',
      ip,
      details: {
        number: existing.number,
        commentId: comment.id,
        autoResumedToInProgress: autoResume,
      },
    });

    if (isClientRole(ctx.role)) {
      const recipients: UserRecord[] = [];
      if (updated.assigneeId) {
        const assignee = this.repos.users.findByIdForAuth(updated.assigneeId);
        if (assignee) recipients.push(assignee);
      } else {
        recipients.push(...this.getAssignedEngineersForTenant(updated.tenantId));
      }
      this.notifications.notifyUsersSystem(recipients, {
        tenantId: updated.tenantId,
        type: 'TICKET_COMMENT',
        title: autoResume
          ? `${updated.number} resumed by client reply`
          : `New client comment on ${updated.number}`,
        body: comment.body.slice(0, 140),
        link: `/tickets/${updated.id}`,
        emailSubject: `[OmniSphere] Client Reply on ${updated.number}`,
        emailSummary: `${comment.authorName} commented on ticket ${updated.number}${autoResume ? ' (status moved back to IN_PROGRESS)' : ''}.`,
        emailFacts: [
          { label: 'Ticket', value: updated.number },
          { label: 'From', value: comment.authorName ?? 'User' },
          { label: 'Status', value: updated.status },
        ],
        emailCtaLabel: 'Open Ticket',
        relatedType: 'TICKET',
        relatedId: updated.id,
      });
    } else if (ctx.role === 'SUPPORT_ENGINEER') {
      const contacts = this.getClientContactsForTicket(updated);
      this.notifications.notifyUsersSystem(contacts, {
        tenantId: updated.tenantId,
        type: 'TICKET_COMMENT',
        title: `Support update on ${updated.number}`,
        body: comment.body.slice(0, 140),
        link: `/tickets/${updated.id}`,
        emailSubject: `[OmniSphere] Support Update on ${updated.number}`,
        emailSummary: `${comment.authorName} posted an update on ticket ${updated.number}.`,
        emailFacts: [
          { label: 'Ticket', value: updated.number },
          { label: 'From', value: comment.authorName ?? 'User' },
          { label: 'Status', value: updated.status },
        ],
        emailCtaLabel: 'View Ticket',
        relatedType: 'TICKET',
        relatedId: updated.id,
      });
    }

    return this.getDetail(ctx, existing.id);
  }

  resolve(
    ctx: TenantContext,
    id: string,
    input: { rootCause: string; resolutionNotes: string },
    ip: string,
  ): TicketDetail {
    const existing = this.repos.tickets.findById(ctx, id);
    if (!existing) {
      throw Errors.notFound('Ticket not found');
    }

    if (existing.status === 'RESOLVED' || existing.status === 'CLOSED') {
      throw Errors.invalidTransition(`Ticket is already ${existing.status}`, {
        currentState: existing.status,
      });
    }

    const now = new Date().toISOString();
    const updated = this.repos.tickets.update(ctx, id, {
      status: 'RESOLVED',
      rootCause: input.rootCause.trim(),
      resolutionNotes: input.resolutionNotes.trim(),
      resolvedAt: now,
    });
    if (!updated) {
      throw Errors.notFound('Ticket not found');
    }

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: existing.tenantId,
      action: 'TICKET_RESOLVED',
      targetType: 'TICKET',
      targetId: updated.id,
      outcome: 'SUCCESS',
      ip,
      details: {
        number: updated.number,
        rootCause: updated.rootCause,
      },
    });

    const contacts = this.getClientContactsForTicket(updated);
    this.notifications.notifyUsersSystem(contacts, {
      tenantId: updated.tenantId,
      type: 'TICKET_RESOLVED',
      title: `Ticket ${updated.number} resolved — please confirm`,
      body: `Root cause: ${updated.rootCause ?? 'Recorded'}`,
      link: `/tickets/${updated.id}`,
      emailSubject: `[OmniSphere] Ticket ${updated.number} Resolved — Confirm Closure`,
      emailSummary: `Support has marked ticket ${updated.number} as resolved. Please confirm resolution to close the ticket, or reopen it if the issue persists.`,
      emailFacts: [
        { label: 'Ticket', value: updated.number },
        { label: 'Title', value: updated.title },
        { label: 'Root Cause', value: updated.rootCause ?? '' },
        { label: 'Resolution', value: updated.resolutionNotes ?? '' },
      ],
      emailCtaLabel: 'Review & Confirm',
      relatedType: 'TICKET',
      relatedId: updated.id,
    });

    return this.getDetail(ctx, updated.id);
  }

  /**
   * Section 5.3: Client (CO or CA) confirms a RESOLVED ticket -> CLOSED.
   * Closing a ticket that came from an alert also closes the linked alert.
   */
  confirm(ctx: TenantContext, id: string, ip: string): TicketDetail {
    const existing = this.repos.tickets.findById(ctx, id);
    if (!existing) {
      throw Errors.notFound('Ticket not found');
    }

    if (existing.status !== 'RESOLVED') {
      throw Errors.invalidTransition('Only RESOLVED tickets can be confirmed by the client', {
        currentState: existing.status,
      });
    }

    const now = new Date().toISOString();
    const updated = this.repos.tickets.update(ctx, id, {
      status: 'CLOSED',
      closedAt: now,
      closeReason: 'Confirmed resolved by client',
    });
    if (!updated) {
      throw Errors.notFound('Ticket not found');
    }

    const closedAlertId = this.closeLinkedAlertIfNeeded(existing, ctx, now, ip);

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: existing.tenantId,
      action: 'TICKET_CLOSED',
      targetType: 'TICKET',
      targetId: updated.id,
      outcome: 'SUCCESS',
      ip,
      details: {
        number: updated.number,
        confirmedByClient: true,
        closedAlertId,
      },
    });

    if (updated.assigneeId) {
      const assignee = this.repos.users.findByIdForAuth(updated.assigneeId);
      if (assignee) {
        this.notifications.notifyUsersSystem([assignee], {
          tenantId: updated.tenantId,
          type: 'TICKET_CLOSED',
          title: `Client confirmed & closed ${updated.number}`,
          body: updated.title,
          link: `/tickets/${updated.id}`,
          emailSubject: `[OmniSphere] Ticket ${updated.number} Confirmed & Closed`,
          emailSummary: `The client confirmed resolution and closed ticket ${updated.number}.`,
          emailFacts: [
            { label: 'Ticket', value: updated.number },
            { label: 'Title', value: updated.title },
            { label: 'Linked Alert Closed', value: closedAlertId ? 'Yes' : 'N/A' },
          ],
          emailCtaLabel: 'View Ticket',
          relatedType: 'TICKET',
          relatedId: updated.id,
        });
      }
    }

    return this.getDetail(ctx, updated.id);
  }

  reopen(ctx: TenantContext, id: string, note: string | undefined, ip: string): TicketDetail {
    const existing = this.repos.tickets.findById(ctx, id);
    if (!existing) {
      throw Errors.notFound('Ticket not found');
    }

    if (existing.status !== 'RESOLVED') {
      throw Errors.invalidTransition('Only RESOLVED tickets can be reopened', {
        currentState: existing.status,
      });
    }

    const updated = this.repos.tickets.update(ctx, id, {
      status: 'IN_PROGRESS',
      resolvedAt: null,
    });
    if (!updated) {
      throw Errors.notFound('Ticket not found');
    }

    if (note && note.trim()) {
      const author = this.repos.users.findByIdForAuth(ctx.userId);
      this.repos.tickets.appendCommentSystem(existing.id, {
        id: generateId('cmt'),
        authorId: ctx.userId,
        authorRole: ctx.role,
        authorName: author?.name ?? ctx.userId,
        body: `Reopened ticket: ${note.trim()}`,
        at: new Date().toISOString(),
      });
    }

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: existing.tenantId,
      action: 'TICKET_REOPENED',
      targetType: 'TICKET',
      targetId: updated.id,
      outcome: 'SUCCESS',
      ip,
      details: { number: updated.number, note: note?.trim() ?? null },
    });

    if (isClientRole(ctx.role)) {
      const recipients: UserRecord[] = [];
      if (updated.assigneeId) {
        const assignee = this.repos.users.findByIdForAuth(updated.assigneeId);
        if (assignee) recipients.push(assignee);
      } else {
        recipients.push(...this.getAssignedEngineersForTenant(updated.tenantId));
      }
      this.notifications.notifyUsersSystem(recipients, {
        tenantId: updated.tenantId,
        type: 'TICKET_REOPENED',
        title: `Ticket ${updated.number} reopened by client`,
        body: note?.trim() || updated.title,
        link: `/tickets/${updated.id}`,
        emailSubject: `[OmniSphere] Ticket ${updated.number} Reopened`,
        emailSummary: `The client reopened ticket ${updated.number} because the issue is not yet resolved.`,
        emailFacts: [
          { label: 'Ticket', value: updated.number },
          { label: 'Reason', value: note?.trim() || 'No note provided' },
        ],
        emailCtaLabel: 'Open Ticket',
        relatedType: 'TICKET',
        relatedId: updated.id,
      });
    }

    return this.getDetail(ctx, updated.id);
  }

  /**
   * Section 5.3: SE may close a RESOLVED ticket directly with a reason.
   * Also closes any linked alert.
   */
  close(ctx: TenantContext, id: string, reason: string, ip: string): TicketDetail {
    const existing = this.repos.tickets.findById(ctx, id);
    if (!existing) {
      throw Errors.notFound('Ticket not found');
    }

    if (existing.status !== 'RESOLVED') {
      throw Errors.invalidTransition(
        'Ticket must be RESOLVED before it can be closed directly by Support',
        { currentState: existing.status },
      );
    }

    const now = new Date().toISOString();
    const updated = this.repos.tickets.update(ctx, id, {
      status: 'CLOSED',
      closedAt: now,
      closeReason: reason.trim(),
    });
    if (!updated) {
      throw Errors.notFound('Ticket not found');
    }

    const closedAlertId = this.closeLinkedAlertIfNeeded(existing, ctx, now, ip);

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: existing.tenantId,
      action: 'TICKET_CLOSED',
      targetType: 'TICKET',
      targetId: updated.id,
      outcome: 'SUCCESS',
      ip,
      details: {
        number: updated.number,
        reason: reason.trim(),
        confirmedByClient: false,
        closedAlertId,
      },
    });

    return this.getDetail(ctx, updated.id);
  }

  private closeLinkedAlertIfNeeded(
    ticket: TicketPublic,
    ctx: TenantContext,
    closedAt: string,
    ip: string,
  ): string | null {
    if (!ticket.alertId) return null;
    const alert = this.repos.alerts.findByIdSystem(ticket.alertId);
    if (!alert || alert.status === 'CLOSED') return null;

    const reason = `Closed automatically with ticket ${ticket.number}`;
    const closed = this.repos.alerts.closeByTicketSystem(alert.id, ctx.userId, reason, closedAt);
    if (!closed) return null;

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: alert.tenantId,
      action: 'ALERT_CLOSED',
      targetType: 'ALERT',
      targetId: alert.id,
      outcome: 'SUCCESS',
      ip,
      details: {
        reason,
        closedViaTicketId: ticket.id,
        closedViaTicketNumber: ticket.number,
      },
    });

    return alert.id;
  }
}
