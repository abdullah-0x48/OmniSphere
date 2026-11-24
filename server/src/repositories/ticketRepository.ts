import type Database from 'better-sqlite3';
import type {
  TicketComment,
  TicketPriority,
  TicketPublic,
  TicketSource,
  TicketStatus,
} from '../../../shared/types.ts';
import type {
  CreateTicketInput,
  ITicketRepository,
  TenantContext,
  TicketListFilter,
  UpdateTicketInput,
} from './types.ts';

interface TicketRow {
  id: string;
  number: string;
  tenant_id: string;
  tenant_code?: string | null;
  tenant_name?: string | null;
  device_id: string | null;
  device_name?: string | null;
  device_serial?: string | null;
  site_id: string | null;
  site_name?: string | null;
  source: TicketSource;
  alert_id: string | null;
  title: string;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  assignee_id: string | null;
  assignee_name?: string | null;
  created_by: string;
  created_by_name?: string | null;
  root_cause: string | null;
  resolution_notes: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  close_reason: string | null;
  comments_json: string;
  work_order_count?: number;
  created_at: string;
  updated_at: string;
}

function parseComments(raw: string): TicketComment[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TicketComment[]) : [];
  } catch {
    return [];
  }
}

function mapRow(row: TicketRow): TicketPublic {
  return {
    id: row.id,
    number: row.number,
    tenantId: row.tenant_id,
    tenantCode: row.tenant_code ?? undefined,
    tenantName: row.tenant_name ?? undefined,
    deviceId: row.device_id,
    deviceName: row.device_name ?? null,
    deviceSerial: row.device_serial ?? null,
    siteId: row.site_id,
    siteName: row.site_name ?? null,
    source: row.source,
    alertId: row.alert_id,
    title: row.title,
    description: row.description,
    priority: row.priority,
    status: row.status,
    assigneeId: row.assignee_id,
    assigneeName: row.assignee_name ?? null,
    createdBy: row.created_by,
    createdByName: row.created_by_name ?? null,
    rootCause: row.root_cause,
    resolutionNotes: row.resolution_notes,
    resolvedAt: row.resolved_at,
    closedAt: row.closed_at,
    closeReason: row.close_reason,
    comments: parseComments(row.comments_json),
    workOrderCount: row.work_order_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_ENRICHED = `
  SELECT
    tk.*,
    t.code AS tenant_code,
    t.name AS tenant_name,
    d.name AS device_name,
    d.serial_number AS device_serial,
    s.name AS site_name,
    u_asg.name AS assignee_name,
    u_crt.name AS created_by_name,
    (SELECT COUNT(*) FROM work_orders wo WHERE wo.ticket_id = tk.id) AS work_order_count
  FROM tickets tk
  LEFT JOIN tenants t ON t.id = tk.tenant_id
  LEFT JOIN devices d ON d.id = tk.device_id
  LEFT JOIN sites s ON s.id = COALESCE(tk.site_id, d.site_id)
  LEFT JOIN users u_asg ON u_asg.id = tk.assignee_id
  LEFT JOIN users u_crt ON u_crt.id = tk.created_by
`;

function buildTenantScopeSql(
  ctx: TenantContext,
  useActiveTenant = true,
  alias = 'tk',
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

export class SqliteTicketRepository implements ITicketRepository {
  constructor(private readonly db: Database.Database) {}

  nextNumber(): string {
    const row = this.db
      .prepare(
        `INSERT INTO counters (id, value) VALUES ('ticket', 1)
         ON CONFLICT(id) DO UPDATE SET value = value + 1
         RETURNING value`,
      )
      .get() as { value: number };
    return `TKT-${String(row.value).padStart(4, '0')}`;
  }

  list(
    ctx: TenantContext,
    filter: TicketListFilter,
    useActiveTenant = true,
  ): { items: TicketPublic[]; total: number } {
    const scope = buildTenantScopeSql(ctx, useActiveTenant, 'tk');
    const conditions: string[] = [scope.clause];
    const params: unknown[] = [...scope.params];

    // Section 10.2: FT sees only tickets linked to their assigned work orders
    if (ctx.role === 'FIELD_TECHNICIAN') {
      conditions.push(
        'EXISTS (SELECT 1 FROM work_orders wo_ft WHERE wo_ft.ticket_id = tk.id AND wo_ft.assigned_to = ?)',
      );
      params.push(ctx.userId);
    }

    if (filter.status) {
      conditions.push('tk.status = ?');
      params.push(filter.status);
    }
    if (filter.priority) {
      conditions.push('tk.priority = ?');
      params.push(filter.priority);
    }
    if (filter.source) {
      conditions.push('tk.source = ?');
      params.push(filter.source);
    }
    if (filter.assigneeId) {
      if (filter.assigneeId === 'UNASSIGNED') {
        conditions.push('tk.assignee_id IS NULL');
      } else {
        conditions.push('tk.assignee_id = ?');
        params.push(filter.assigneeId);
      }
    }
    if (filter.deviceId) {
      conditions.push('tk.device_id = ?');
      params.push(filter.deviceId);
    }
    if (filter.siteId) {
      conditions.push('COALESCE(tk.site_id, d.site_id) = ?');
      params.push(filter.siteId);
    }
    if (filter.q && filter.q.trim()) {
      const pattern = `%${filter.q.trim().toLowerCase()}%`;
      conditions.push(
        `(LOWER(tk.number) LIKE ? OR LOWER(tk.title) LIKE ? OR LOWER(tk.description) LIKE ? OR LOWER(COALESCE(d.name, '')) LIKE ?)`,
      );
      params.push(pattern, pattern, pattern, pattern);
    }

    const where = conditions.join(' AND ');
    const countRow = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM tickets tk
         LEFT JOIN devices d ON d.id = tk.device_id
         WHERE ${where}`,
      )
      .get(...params) as { count: number };

    const offset = (filter.page - 1) * filter.pageSize;
    const rows = this.db
      .prepare(
        `${SELECT_ENRICHED}
         WHERE ${where}
         ORDER BY
           CASE tk.status
             WHEN 'OPEN' THEN 0
             WHEN 'IN_PROGRESS' THEN 1
             WHEN 'WAITING_ON_CLIENT' THEN 2
             WHEN 'RESOLVED' THEN 3
             ELSE 4
           END ASC,
           CASE tk.priority
             WHEN 'CRITICAL' THEN 0
             WHEN 'HIGH' THEN 1
             WHEN 'MEDIUM' THEN 2
             ELSE 3
           END ASC,
           tk.updated_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, filter.pageSize, offset) as TicketRow[];

    return { items: rows.map(mapRow), total: countRow.count };
  }

  findById(ctx: TenantContext, id: string): TicketPublic | null {
    const scope = buildTenantScopeSql(ctx, false, 'tk');
    const conditions: string[] = ['tk.id = ?', scope.clause];
    const params: unknown[] = [id, ...scope.params];

    if (ctx.role === 'FIELD_TECHNICIAN') {
      conditions.push(
        'EXISTS (SELECT 1 FROM work_orders wo_ft WHERE wo_ft.ticket_id = tk.id AND wo_ft.assigned_to = ?)',
      );
      params.push(ctx.userId);
    }

    const row = this.db
      .prepare(`${SELECT_ENRICHED} WHERE ${conditions.join(' AND ')}`)
      .get(...params) as TicketRow | undefined;
    return row ? mapRow(row) : null;
  }

  findByIdSystem(id: string): TicketPublic | null {
    const row = this.db
      .prepare(`${SELECT_ENRICHED} WHERE tk.id = ?`)
      .get(id) as TicketRow | undefined;
    return row ? mapRow(row) : null;
  }

  findByAlertIdSystem(alertId: string): TicketPublic | null {
    const row = this.db
      .prepare(`${SELECT_ENRICHED} WHERE tk.alert_id = ? LIMIT 1`)
      .get(alertId) as TicketRow | undefined;
    return row ? mapRow(row) : null;
  }

  create(ctx: TenantContext, input: CreateTicketInput): TicketPublic {
    if (!ctx.allTenants && !ctx.tenantIds.includes(input.tenantId)) {
      throw new Error('Tenant scope violation creating ticket');
    }
    return this.createSystem(input);
  }

  createSystem(input: CreateTicketInput): TicketPublic {
    const now = input.createdAt ?? new Date().toISOString();
    const number = input.number ?? this.nextNumber();
    this.db
      .prepare(
        `INSERT INTO tickets (
          id, number, tenant_id, device_id, site_id, source, alert_id,
          title, description, priority, status, assignee_id, created_by,
          root_cause, resolution_notes, resolved_at, closed_at, close_reason,
          comments_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        number,
        input.tenantId,
        input.deviceId,
        input.siteId,
        input.source,
        input.alertId,
        input.title,
        input.description,
        input.priority,
        input.status ?? 'OPEN',
        input.assigneeId,
        input.createdBy,
        input.rootCause ?? null,
        input.resolutionNotes ?? null,
        input.resolvedAt ?? null,
        input.closedAt ?? null,
        input.closeReason ?? null,
        JSON.stringify(input.comments ?? []),
        now,
        now,
      );
    return this.findByIdSystem(input.id)!;
  }

  update(ctx: TenantContext, id: string, patch: UpdateTicketInput): TicketPublic | null {
    const scope = buildTenantScopeSql(ctx, false, 'tickets');
    const sets: string[] = [];
    const params: unknown[] = [];

    if (patch.assigneeId !== undefined) {
      sets.push('assignee_id = ?');
      params.push(patch.assigneeId);
    }
    if (patch.priority !== undefined) {
      sets.push('priority = ?');
      params.push(patch.priority);
    }
    if (patch.status !== undefined) {
      sets.push('status = ?');
      params.push(patch.status);
    }
    if (patch.rootCause !== undefined) {
      sets.push('root_cause = ?');
      params.push(patch.rootCause);
    }
    if (patch.resolutionNotes !== undefined) {
      sets.push('resolution_notes = ?');
      params.push(patch.resolutionNotes);
    }
    if (patch.resolvedAt !== undefined) {
      sets.push('resolved_at = ?');
      params.push(patch.resolvedAt);
    }
    if (patch.closedAt !== undefined) {
      sets.push('closed_at = ?');
      params.push(patch.closedAt);
    }
    if (patch.closeReason !== undefined) {
      sets.push('close_reason = ?');
      params.push(patch.closeReason);
    }
    if (patch.comments !== undefined) {
      sets.push('comments_json = ?');
      params.push(JSON.stringify(patch.comments));
    }

    if (sets.length === 0) {
      return this.findById(ctx, id);
    }

    const now = new Date().toISOString();
    sets.push('updated_at = ?');
    params.push(now);

    const info = this.db
      .prepare(`UPDATE tickets SET ${sets.join(', ')} WHERE id = ? AND ${scope.clause}`)
      .run(...params, id, ...scope.params);
    if (info.changes === 0) return null;
    return this.findById(ctx, id);
  }

  appendCommentSystem(
    id: string,
    comment: TicketComment,
    nextStatus?: TicketStatus,
  ): TicketPublic | null {
    const existing = this.findByIdSystem(id);
    if (!existing) return null;
    const nextComments = [...existing.comments, comment];
    const now = new Date().toISOString();
    if (nextStatus) {
      this.db
        .prepare('UPDATE tickets SET comments_json = ?, status = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(nextComments), nextStatus, now, id);
    } else {
      this.db
        .prepare('UPDATE tickets SET comments_json = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(nextComments), now, id);
    }
    return this.findByIdSystem(id);
  }

  listByDevice(ctx: TenantContext, deviceId: string, limit = 50): TicketPublic[] {
    const scope = buildTenantScopeSql(ctx, false, 'tk');
    const conditions: string[] = ['tk.device_id = ?', scope.clause];
    const params: unknown[] = [deviceId, ...scope.params];

    if (ctx.role === 'FIELD_TECHNICIAN') {
      conditions.push(
        'EXISTS (SELECT 1 FROM work_orders wo_ft WHERE wo_ft.ticket_id = tk.id AND wo_ft.assigned_to = ?)',
      );
      params.push(ctx.userId);
    }

    const rows = this.db
      .prepare(
        `${SELECT_ENRICHED}
         WHERE ${conditions.join(' AND ')}
         ORDER BY tk.created_at DESC
         LIMIT ?`,
      )
      .all(...params, limit) as TicketRow[];
    return rows.map(mapRow);
  }

  countOpenByTenant(tenantId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM tickets
         WHERE tenant_id = ? AND status IN ('OPEN', 'IN_PROGRESS', 'WAITING_ON_CLIENT')`,
      )
      .get(tenantId) as { count: number };
    return row.count;
  }

  countOpenByTenantIds(tenantIds: string[] | null): Map<string, number> {
    let rows: Array<{ tenant_id: string; count: number }>;
    if (tenantIds === null) {
      rows = this.db
        .prepare(
          `SELECT tenant_id, COUNT(*) AS count FROM tickets
           WHERE status IN ('OPEN', 'IN_PROGRESS', 'WAITING_ON_CLIENT')
           GROUP BY tenant_id`,
        )
        .all() as Array<{ tenant_id: string; count: number }>;
    } else if (tenantIds.length === 0) {
      rows = [];
    } else {
      const placeholders = tenantIds.map(() => '?').join(', ');
      rows = this.db
        .prepare(
          `SELECT tenant_id, COUNT(*) AS count FROM tickets
           WHERE tenant_id IN (${placeholders}) AND status IN ('OPEN', 'IN_PROGRESS', 'WAITING_ON_CLIENT')
           GROUP BY tenant_id`,
        )
        .all(...tenantIds) as Array<{ tenant_id: string; count: number }>;
    }
    const map = new Map<string, number>();
    for (const r of rows) {
      map.set(r.tenant_id, r.count);
    }
    return map;
  }

  listWaitingInScope(ctx: TenantContext, limit = 20): TicketPublic[] {
    const scope = buildTenantScopeSql(ctx, false, 'tk');
    const rows = this.db
      .prepare(
        `${SELECT_ENRICHED}
         WHERE ${scope.clause}
           AND (tk.status = 'WAITING_ON_CLIENT' OR (tk.status = 'OPEN' AND tk.assignee_id IS NULL))
         ORDER BY tk.updated_at ASC
         LIMIT ?`,
      )
      .all(...scope.params, limit) as TicketRow[];
    return rows.map(mapRow);
  }
}
