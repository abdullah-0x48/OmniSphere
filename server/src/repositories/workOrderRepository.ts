import type Database from 'better-sqlite3';
import type {
  DeviceConnectivity,
  DeviceLifecycleState,
  WorkOrderApprovalStatus,
  WorkOrderChecklistItem,
  WorkOrderCompletion,
  WorkOrderPublic,
  WorkOrderStatus,
  WorkOrderType,
} from '../../../shared/types.ts';
import type {
  CreateWorkOrderInput,
  IWorkOrderRepository,
  TenantContext,
  UpdateWorkOrderInput,
  WorkOrderListFilter,
} from './types.ts';

interface WorkOrderRow {
  id: string;
  number: string;
  tenant_id: string;
  tenant_code?: string | null;
  tenant_name?: string | null;
  device_id: string;
  device_name?: string | null;
  device_serial?: string | null;
  device_state?: DeviceLifecycleState | null;
  device_connectivity?: DeviceConnectivity | null;
  site_id?: string | null;
  site_name?: string | null;
  site_location?: string | null;
  model_name?: string | null;
  ticket_id: string | null;
  ticket_number?: string | null;
  plan_id: string | null;
  plan_name?: string | null;
  type: WorkOrderType;
  title: string;
  instructions: string;
  checklist_json: string;
  assigned_to: string | null;
  assigned_to_name?: string | null;
  planned_start: string | null;
  planned_end: string | null;
  downtime_required: number;
  approval_status: WorkOrderApprovalStatus;
  approval_note: string | null;
  approved_by: string | null;
  approved_by_name?: string | null;
  approved_at: string | null;
  status: WorkOrderStatus;
  started_at: string | null;
  completed_at: string | null;
  completion_json: string | null;
  created_by: string;
  created_by_name?: string | null;
  created_at: string;
  updated_at: string;
}

function parseChecklist(raw: string): WorkOrderChecklistItem[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as WorkOrderChecklistItem[]) : [];
  } catch {
    return [];
  }
}

function parseCompletion(raw: string | null): WorkOrderCompletion | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as WorkOrderCompletion) : null;
  } catch {
    return null;
  }
}

function mapRow(row: WorkOrderRow): WorkOrderPublic {
  return {
    id: row.id,
    number: row.number,
    tenantId: row.tenant_id,
    tenantCode: row.tenant_code ?? undefined,
    tenantName: row.tenant_name ?? undefined,
    deviceId: row.device_id,
    deviceName: row.device_name ?? undefined,
    deviceSerial: row.device_serial ?? undefined,
    deviceState: row.device_state ?? undefined,
    deviceConnectivity: row.device_connectivity ?? undefined,
    siteId: row.site_id ?? undefined,
    siteName: row.site_name ?? undefined,
    siteLocation: row.site_location ?? undefined,
    modelName: row.model_name ?? undefined,
    ticketId: row.ticket_id,
    ticketNumber: row.ticket_number ?? null,
    planId: row.plan_id,
    planName: row.plan_name ?? null,
    type: row.type,
    title: row.title,
    instructions: row.instructions,
    checklist: parseChecklist(row.checklist_json),
    assignedTo: row.assigned_to,
    assignedToName: row.assigned_to_name ?? null,
    plannedStart: row.planned_start,
    plannedEnd: row.planned_end,
    downtimeRequired: row.downtime_required === 1,
    approvalStatus: row.approval_status,
    approvalNote: row.approval_note,
    approvedBy: row.approved_by,
    approvedByName: row.approved_by_name ?? null,
    approvedAt: row.approved_at,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    completion: parseCompletion(row.completion_json),
    createdBy: row.created_by,
    createdByName: row.created_by_name ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_ENRICHED = `
  SELECT
    wo.*,
    t.code AS tenant_code,
    t.name AS tenant_name,
    d.name AS device_name,
    d.serial_number AS device_serial,
    d.state AS device_state,
    d.connectivity AS device_connectivity,
    d.site_id AS site_id,
    s.name AS site_name,
    s.location AS site_location,
    m.name AS model_name,
    tk.number AS ticket_number,
    mp.name AS plan_name,
    u_asg.name AS assigned_to_name,
    u_apr.name AS approved_by_name,
    u_crt.name AS created_by_name
  FROM work_orders wo
  LEFT JOIN tenants t ON t.id = wo.tenant_id
  LEFT JOIN devices d ON d.id = wo.device_id
  LEFT JOIN sites s ON s.id = d.site_id
  LEFT JOIN device_models m ON m.id = d.model_id
  LEFT JOIN tickets tk ON tk.id = wo.ticket_id
  LEFT JOIN maintenance_plans mp ON mp.id = wo.plan_id
  LEFT JOIN users u_asg ON u_asg.id = wo.assigned_to
  LEFT JOIN users u_apr ON u_apr.id = wo.approved_by
  LEFT JOIN users u_crt ON u_crt.id = wo.created_by
`;

function buildTenantScopeSql(
  ctx: TenantContext,
  useActiveTenant = true,
  alias = 'wo',
): { clause: string; params: unknown[] } {
  if (ctx.allTenants) {
    if (useActiveTenant && ctx.activeTenantId) {
      return { clause: `${alias}.tenant_id = ?`, params: [ctx.activeTenantId] };
    }
    return { clause: '1 = 1', params: [] };
  }
  if (useActiveTenant && ctx.activeTenantId) {
    return { clause: `${alias}.tenant_id = ?`, params: [ctx.activeTenantId] };
  }
  if (ctx.tenantIds.length === 0) {
    return { clause: '1 = 0', params: [] };
  }
  const placeholders = ctx.tenantIds.map(() => '?').join(', ');
  return { clause: `${alias}.tenant_id IN (${placeholders})`, params: [...ctx.tenantIds] };
}

export class SqliteWorkOrderRepository implements IWorkOrderRepository {
  constructor(private readonly db: Database.Database) {}

  nextNumber(): string {
    const row = this.db
      .prepare(
        `INSERT INTO counters (id, value) VALUES ('work_order', 1)
         ON CONFLICT(id) DO UPDATE SET value = value + 1
         RETURNING value`,
      )
      .get() as { value: number };
    return `WO-${String(row.value).padStart(4, '0')}`;
  }

  list(
    ctx: TenantContext,
    filter: WorkOrderListFilter,
    useActiveTenant = true,
  ): { items: WorkOrderPublic[]; total: number } {
    // Field Technicians always see across all their assigned tenants, strictly own assigned WOs (Section 7)
    const effectiveUseActive = ctx.role === 'FIELD_TECHNICIAN' ? false : useActiveTenant;
    const scope = buildTenantScopeSql(ctx, effectiveUseActive, 'wo');
    const conditions: string[] = [scope.clause];
    const params: unknown[] = [...scope.params];

    if (ctx.role === 'FIELD_TECHNICIAN') {
      conditions.push('wo.assigned_to = ?');
      params.push(ctx.userId);
    } else if (filter.assignedTo) {
      if (filter.assignedTo === 'UNASSIGNED') {
        conditions.push('wo.assigned_to IS NULL');
      } else {
        conditions.push('wo.assigned_to = ?');
        params.push(filter.assignedTo);
      }
    }

    if (filter.status) {
      conditions.push('wo.status = ?');
      params.push(filter.status);
    }
    if (filter.type) {
      conditions.push('wo.type = ?');
      params.push(filter.type);
    }
    if (filter.approvalStatus) {
      conditions.push('wo.approval_status = ?');
      params.push(filter.approvalStatus);
    }
    if (filter.deviceId) {
      conditions.push('wo.device_id = ?');
      params.push(filter.deviceId);
    }
    if (filter.ticketId) {
      conditions.push('wo.ticket_id = ?');
      params.push(filter.ticketId);
    }
    if (filter.from) {
      conditions.push('COALESCE(wo.planned_start, wo.created_at) >= ?');
      params.push(filter.from);
    }
    if (filter.to) {
      conditions.push('COALESCE(wo.planned_start, wo.created_at) <= ?');
      params.push(filter.to);
    }
    if (filter.q && filter.q.trim()) {
      const pattern = `%${filter.q.trim().toLowerCase()}%`;
      conditions.push(
        `(LOWER(wo.number) LIKE ? OR LOWER(wo.title) LIKE ? OR LOWER(COALESCE(d.name, '')) LIKE ? OR LOWER(COALESCE(s.name, '')) LIKE ?)`,
      );
      params.push(pattern, pattern, pattern, pattern);
    }

    const where = conditions.join(' AND ');
    const countRow = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM work_orders wo
         LEFT JOIN devices d ON d.id = wo.device_id
         LEFT JOIN sites s ON s.id = d.site_id
         WHERE ${where}`,
      )
      .get(...params) as { count: number };

    const offset = (filter.page - 1) * filter.pageSize;
    const rows = this.db
      .prepare(
        `${SELECT_ENRICHED}
         WHERE ${where}
         ORDER BY
           CASE wo.status
             WHEN 'IN_PROGRESS' THEN 0
             WHEN 'ASSIGNED' THEN 1
             WHEN 'PLANNED' THEN 2
             WHEN 'COMPLETED' THEN 3
             ELSE 4
           END ASC,
           COALESCE(wo.planned_start, wo.created_at) ASC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, filter.pageSize, offset) as WorkOrderRow[];

    return { items: rows.map(mapRow), total: countRow.count };
  }

  findById(ctx: TenantContext, id: string): WorkOrderPublic | null {
    const scope = buildTenantScopeSql(ctx, false, 'wo');
    const conditions: string[] = ['wo.id = ?', scope.clause];
    const params: unknown[] = [id, ...scope.params];

    if (ctx.role === 'FIELD_TECHNICIAN') {
      conditions.push('wo.assigned_to = ?');
      params.push(ctx.userId);
    }

    const row = this.db
      .prepare(`${SELECT_ENRICHED} WHERE ${conditions.join(' AND ')}`)
      .get(...params) as WorkOrderRow | undefined;
    return row ? mapRow(row) : null;
  }

  findByIdSystem(id: string): WorkOrderPublic | null {
    const row = this.db
      .prepare(`${SELECT_ENRICHED} WHERE wo.id = ?`)
      .get(id) as WorkOrderRow | undefined;
    return row ? mapRow(row) : null;
  }

  create(ctx: TenantContext, input: CreateWorkOrderInput): WorkOrderPublic {
    if (!ctx.allTenants && !ctx.tenantIds.includes(input.tenantId)) {
      throw new Error('Tenant scope violation creating work order');
    }
    return this.createSystem(input);
  }

  createSystem(input: CreateWorkOrderInput): WorkOrderPublic {
    const now = input.createdAt ?? new Date().toISOString();
    const number = input.number ?? this.nextNumber();
    this.db
      .prepare(
        `INSERT INTO work_orders (
          id, number, tenant_id, device_id, ticket_id, plan_id, type,
          title, instructions, checklist_json, assigned_to, planned_start, planned_end,
          downtime_required, approval_status, approval_note, approved_by, approved_at,
          status, started_at, completed_at, completion_json, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        number,
        input.tenantId,
        input.deviceId,
        input.ticketId,
        input.planId,
        input.type,
        input.title,
        input.instructions,
        JSON.stringify(input.checklist ?? []),
        input.assignedTo,
        input.plannedStart,
        input.plannedEnd,
        input.downtimeRequired ? 1 : 0,
        input.approvalStatus,
        input.approvalNote ?? null,
        input.approvedBy ?? null,
        input.approvedAt ?? null,
        input.status,
        input.startedAt ?? null,
        input.completedAt ?? null,
        input.completion ? JSON.stringify(input.completion) : null,
        input.createdBy,
        now,
        now,
      );
    return this.findByIdSystem(input.id)!;
  }

  update(ctx: TenantContext, id: string, patch: UpdateWorkOrderInput): WorkOrderPublic | null {
    const scope = buildTenantScopeSql(ctx, false, 'work_orders');
    const sets: string[] = [];
    const params: unknown[] = [];

    if (patch.title !== undefined) {
      sets.push('title = ?');
      params.push(patch.title);
    }
    if (patch.instructions !== undefined) {
      sets.push('instructions = ?');
      params.push(patch.instructions);
    }
    if (patch.checklist !== undefined) {
      sets.push('checklist_json = ?');
      params.push(JSON.stringify(patch.checklist));
    }
    if (patch.assignedTo !== undefined) {
      sets.push('assigned_to = ?');
      params.push(patch.assignedTo);
    }
    if (patch.plannedStart !== undefined) {
      sets.push('planned_start = ?');
      params.push(patch.plannedStart);
    }
    if (patch.plannedEnd !== undefined) {
      sets.push('planned_end = ?');
      params.push(patch.plannedEnd);
    }
    if (patch.downtimeRequired !== undefined) {
      sets.push('downtime_required = ?');
      params.push(patch.downtimeRequired ? 1 : 0);
    }
    if (patch.approvalStatus !== undefined) {
      sets.push('approval_status = ?');
      params.push(patch.approvalStatus);
    }
    if (patch.approvalNote !== undefined) {
      sets.push('approval_note = ?');
      params.push(patch.approvalNote);
    }
    if (patch.approvedBy !== undefined) {
      sets.push('approved_by = ?');
      params.push(patch.approvedBy);
    }
    if (patch.approvedAt !== undefined) {
      sets.push('approved_at = ?');
      params.push(patch.approvedAt);
    }
    if (patch.status !== undefined) {
      sets.push('status = ?');
      params.push(patch.status);
    }
    if (patch.startedAt !== undefined) {
      sets.push('started_at = ?');
      params.push(patch.startedAt);
    }
    if (patch.completedAt !== undefined) {
      sets.push('completed_at = ?');
      params.push(patch.completedAt);
    }
    if (patch.completion !== undefined) {
      sets.push('completion_json = ?');
      params.push(patch.completion ? JSON.stringify(patch.completion) : null);
    }

    if (sets.length === 0) {
      return this.findById(ctx, id);
    }

    const now = new Date().toISOString();
    sets.push('updated_at = ?');
    params.push(now);

    const conditions = ['id = ?', scope.clause];
    const whereParams: unknown[] = [id, ...scope.params];
    if (ctx.role === 'FIELD_TECHNICIAN') {
      conditions.push('assigned_to = ?');
      whereParams.push(ctx.userId);
    }

    const info = this.db
      .prepare(`UPDATE work_orders SET ${sets.join(', ')} WHERE ${conditions.join(' AND ')}`)
      .run(...params, ...whereParams);
    if (info.changes === 0) return null;
    return this.findById(ctx, id);
  }

  listByDevice(ctx: TenantContext, deviceId: string, limit = 50): WorkOrderPublic[] {
    const scope = buildTenantScopeSql(ctx, false, 'wo');
    const conditions: string[] = ['wo.device_id = ?', scope.clause];
    const params: unknown[] = [deviceId, ...scope.params];
    if (ctx.role === 'FIELD_TECHNICIAN') {
      conditions.push('wo.assigned_to = ?');
      params.push(ctx.userId);
    }
    const rows = this.db
      .prepare(
        `${SELECT_ENRICHED}
         WHERE ${conditions.join(' AND ')}
         ORDER BY wo.created_at DESC
         LIMIT ?`,
      )
      .all(...params, limit) as WorkOrderRow[];
    return rows.map(mapRow);
  }

  listByTicket(ctx: TenantContext, ticketId: string): WorkOrderPublic[] {
    const scope = buildTenantScopeSql(ctx, false, 'wo');
    const conditions: string[] = ['wo.ticket_id = ?', scope.clause];
    const params: unknown[] = [ticketId, ...scope.params];
    if (ctx.role === 'FIELD_TECHNICIAN') {
      conditions.push('wo.assigned_to = ?');
      params.push(ctx.userId);
    }
    const rows = this.db
      .prepare(
        `${SELECT_ENRICHED}
         WHERE ${conditions.join(' AND ')}
         ORDER BY wo.created_at DESC`,
      )
      .all(...params) as WorkOrderRow[];
    return rows.map(mapRow);
  }

  countTodayByTenant(tenantId: string, dayStartIso: string, dayEndIso: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM work_orders
         WHERE tenant_id = ?
           AND status IN ('PLANNED', 'ASSIGNED', 'IN_PROGRESS')
           AND (
             status = 'IN_PROGRESS'
             OR (planned_start IS NOT NULL AND planned_start >= ? AND planned_start <= ?)
           )`,
      )
      .get(tenantId, dayStartIso, dayEndIso) as { count: number };
    return row.count;
  }

  countTodayByTenantIds(
    tenantIds: string[] | null,
    dayStartIso: string,
    dayEndIso: string,
  ): Map<string, number> {
    let rows: Array<{ tenant_id: string; count: number }>;
    const timeCond = `status IN ('PLANNED', 'ASSIGNED', 'IN_PROGRESS') AND (status = 'IN_PROGRESS' OR (planned_start IS NOT NULL AND planned_start >= ? AND planned_start <= ?))`;
    if (tenantIds === null) {
      rows = this.db
        .prepare(`SELECT tenant_id, COUNT(*) AS count FROM work_orders WHERE ${timeCond} GROUP BY tenant_id`)
        .all(dayStartIso, dayEndIso) as Array<{ tenant_id: string; count: number }>;
    } else if (tenantIds.length === 0) {
      rows = [];
    } else {
      const placeholders = tenantIds.map(() => '?').join(', ');
      rows = this.db
        .prepare(
          `SELECT tenant_id, COUNT(*) AS count FROM work_orders
           WHERE tenant_id IN (${placeholders}) AND ${timeCond}
           GROUP BY tenant_id`,
        )
        .all(...tenantIds, dayStartIso, dayEndIso) as Array<{ tenant_id: string; count: number }>;
    }
    const map = new Map<string, number>();
    for (const r of rows) {
      map.set(r.tenant_id, r.count);
    }
    return map;
  }

  countPendingApprovalsByTenant(tenantId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM work_orders
         WHERE tenant_id = ? AND approval_status = 'PENDING' AND status NOT IN ('COMPLETED', 'CANCELLED')`,
      )
      .get(tenantId) as { count: number };
    return row.count;
  }

  listOverdueInScope(ctx: TenantContext, nowIso: string, limit = 20): WorkOrderPublic[] {
    const scope = buildTenantScopeSql(ctx, false, 'wo');
    const rows = this.db
      .prepare(
        `${SELECT_ENRICHED}
         WHERE ${scope.clause}
           AND wo.status IN ('PLANNED', 'ASSIGNED', 'IN_PROGRESS')
           AND wo.planned_end IS NOT NULL
           AND wo.planned_end < ?
         ORDER BY wo.planned_end ASC
         LIMIT ?`,
      )
      .all(...scope.params, nowIso, limit) as WorkOrderRow[];
    return rows.map(mapRow);
  }
}
