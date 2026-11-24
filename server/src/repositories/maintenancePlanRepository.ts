import type Database from 'better-sqlite3';
import type {
  MaintenancePlanPublic,
  MaintenancePlanTemplate,
  MaintenanceScopeType,
} from '../../../shared/types.ts';
import type {
  CreateMaintenancePlanInput,
  IMaintenancePlanRepository,
  MaintenancePlanListFilter,
  TenantContext,
  UpdateMaintenancePlanInput,
} from './types.ts';

interface MaintenancePlanRow {
  id: string;
  tenant_id: string;
  tenant_code?: string | null;
  tenant_name?: string | null;
  name: string;
  scope_type: MaintenanceScopeType;
  scope_value: string;
  every_days: number;
  next_run_at: string;
  last_run_at: string | null;
  template_json: string;
  assigned_to: string | null;
  assigned_to_name?: string | null;
  enabled: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

function parseTemplate(raw: string): MaintenancePlanTemplate {
  try {
    const p = JSON.parse(raw) as Partial<MaintenancePlanTemplate>;
    return {
      title: p.title ?? '',
      instructions: p.instructions ?? '',
      checklist: Array.isArray(p.checklist) ? p.checklist.map(String) : [],
      downtimeRequired: Boolean(p.downtimeRequired),
    };
  } catch {
    return { title: '', instructions: '', checklist: [], downtimeRequired: false };
  }
}

function mapRow(row: MaintenancePlanRow): MaintenancePlanPublic {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    tenantCode: row.tenant_code ?? undefined,
    tenantName: row.tenant_name ?? undefined,
    name: row.name,
    scopeType: row.scope_type,
    scopeValue: row.scope_value,
    everyDays: row.every_days,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    template: parseTemplate(row.template_json),
    assignedTo: row.assigned_to,
    assignedToName: row.assigned_to_name ?? null,
    enabled: row.enabled === 1,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_ENRICHED = `
  SELECT
    mp.*,
    t.code AS tenant_code,
    t.name AS tenant_name,
    u.name AS assigned_to_name
  FROM maintenance_plans mp
  LEFT JOIN tenants t ON t.id = mp.tenant_id
  LEFT JOIN users u ON u.id = mp.assigned_to
`;

function buildTenantScopeSql(
  ctx: TenantContext,
  useActiveTenant = true,
  alias = 'mp',
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

export class SqliteMaintenancePlanRepository implements IMaintenancePlanRepository {
  constructor(private readonly db: Database.Database) {}

  list(
    ctx: TenantContext,
    filter: MaintenancePlanListFilter,
  ): { items: MaintenancePlanPublic[]; total: number } {
    const scope = buildTenantScopeSql(ctx, true, 'mp');
    const conditions: string[] = [scope.clause];
    const params: unknown[] = [...scope.params];

    if (filter.enabled !== undefined) {
      conditions.push('mp.enabled = ?');
      params.push(filter.enabled ? 1 : 0);
    }
    if (filter.q && filter.q.trim()) {
      const pattern = `%${filter.q.trim().toLowerCase()}%`;
      conditions.push('(LOWER(mp.name) LIKE ? OR LOWER(mp.scope_value) LIKE ?)');
      params.push(pattern, pattern);
    }

    const where = conditions.join(' AND ');
    const countRow = this.db
      .prepare(`SELECT COUNT(*) AS count FROM maintenance_plans mp WHERE ${where}`)
      .get(...params) as { count: number };

    const offset = (filter.page - 1) * filter.pageSize;
    const rows = this.db
      .prepare(
        `${SELECT_ENRICHED}
         WHERE ${where}
         ORDER BY mp.enabled DESC, mp.next_run_at ASC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, filter.pageSize, offset) as MaintenancePlanRow[];

    return { items: rows.map(mapRow), total: countRow.count };
  }

  findById(ctx: TenantContext, id: string): MaintenancePlanPublic | null {
    const scope = buildTenantScopeSql(ctx, false, 'mp');
    const row = this.db
      .prepare(`${SELECT_ENRICHED} WHERE mp.id = ? AND ${scope.clause}`)
      .get(id, ...scope.params) as MaintenancePlanRow | undefined;
    return row ? mapRow(row) : null;
  }

  create(ctx: TenantContext, input: CreateMaintenancePlanInput): MaintenancePlanPublic {
    if (!ctx.allTenants && !ctx.tenantIds.includes(input.tenantId)) {
      throw new Error('Tenant scope violation creating maintenance plan');
    }
    const now = input.createdAt ?? new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO maintenance_plans (
          id, tenant_id, name, scope_type, scope_value, every_days,
          next_run_at, last_run_at, template_json, assigned_to, enabled,
          created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.tenantId,
        input.name,
        input.scopeType,
        input.scopeValue,
        input.everyDays,
        input.nextRunAt,
        input.lastRunAt ?? null,
        JSON.stringify(input.template),
        input.assignedTo,
        input.enabled ? 1 : 0,
        input.createdBy,
        now,
        now,
      );
    return this.findById(ctx, input.id)!;
  }

  update(
    ctx: TenantContext,
    id: string,
    patch: UpdateMaintenancePlanInput,
  ): MaintenancePlanPublic | null {
    const scope = buildTenantScopeSql(ctx, false, 'maintenance_plans');
    const sets: string[] = [];
    const params: unknown[] = [];

    if (patch.name !== undefined) {
      sets.push('name = ?');
      params.push(patch.name);
    }
    if (patch.scopeType !== undefined) {
      sets.push('scope_type = ?');
      params.push(patch.scopeType);
    }
    if (patch.scopeValue !== undefined) {
      sets.push('scope_value = ?');
      params.push(patch.scopeValue);
    }
    if (patch.everyDays !== undefined) {
      sets.push('every_days = ?');
      params.push(patch.everyDays);
    }
    if (patch.nextRunAt !== undefined) {
      sets.push('next_run_at = ?');
      params.push(patch.nextRunAt);
    }
    if (patch.lastRunAt !== undefined) {
      sets.push('last_run_at = ?');
      params.push(patch.lastRunAt);
    }
    if (patch.template !== undefined) {
      sets.push('template_json = ?');
      params.push(JSON.stringify(patch.template));
    }
    if (patch.assignedTo !== undefined) {
      sets.push('assigned_to = ?');
      params.push(patch.assignedTo);
    }
    if (patch.enabled !== undefined) {
      sets.push('enabled = ?');
      params.push(patch.enabled ? 1 : 0);
    }

    if (sets.length === 0) return this.findById(ctx, id);

    const now = new Date().toISOString();
    sets.push('updated_at = ?');
    params.push(now);

    const info = this.db
      .prepare(`UPDATE maintenance_plans SET ${sets.join(', ')} WHERE id = ? AND ${scope.clause}`)
      .run(...params, id, ...scope.params);
    if (info.changes === 0) return null;
    return this.findById(ctx, id);
  }

  delete(ctx: TenantContext, id: string): boolean {
    const scope = buildTenantScopeSql(ctx, false, 'maintenance_plans');
    const info = this.db
      .prepare(`DELETE FROM maintenance_plans WHERE id = ? AND ${scope.clause}`)
      .run(id, ...scope.params);
    return info.changes > 0;
  }

  listDueEnabledSystem(nowIso: string): MaintenancePlanPublic[] {
    const rows = this.db
      .prepare(
        `${SELECT_ENRICHED}
         WHERE mp.enabled = 1 AND mp.next_run_at <= ?
         ORDER BY mp.next_run_at ASC`,
      )
      .all(nowIso) as MaintenancePlanRow[];
    return rows.map(mapRow);
  }

  advanceRunSystem(id: string, lastRunAt: string, nextRunAt: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE maintenance_plans
         SET last_run_at = ?, next_run_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(lastRunAt, nextRunAt, now, id);
  }
}
