import type Database from 'better-sqlite3';
import type {
  AlertOperator,
  AlertRecipient,
  AlertRule,
  AlertRuleKind,
  AlertScopeType,
  AlertSeverity,
} from '../../../shared/types.ts';
import type {
  AlertRuleListFilter,
  CreateAlertRuleInput,
  IAlertRuleRepository,
  TenantContext,
  UpdateAlertRuleInput,
} from './types.ts';

interface AlertRuleRow {
  id: string;
  tenant_id: string;
  name: string;
  kind: AlertRuleKind;
  metric_key: string | null;
  operator: AlertOperator | null;
  threshold: number | null;
  duration_sec: number;
  severity: AlertSeverity;
  scope_type: AlertScopeType;
  scope_id: string;
  recipients_json: string;
  enabled: number;
  created_at: string;
  updated_at: string;
  scope_name?: string | null;
}

function parseRecipients(raw: string): AlertRecipient[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AlertRecipient[]) : [];
  } catch {
    return [];
  }
}

function mapRow(row: AlertRuleRow): AlertRule {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    kind: row.kind,
    metricKey: row.metric_key,
    operator: row.operator,
    threshold: row.threshold,
    durationSec: row.duration_sec,
    severity: row.severity,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    scopeName: row.scope_name ?? undefined,
    recipients: parseRecipients(row.recipients_json),
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_WITH_SCOPE = `
  SELECT r.*,
    CASE
      WHEN r.scope_type = 'DEVICE' THEN (SELECT d.name FROM devices d WHERE d.id = r.scope_id)
      WHEN r.scope_type = 'MODEL' THEN (SELECT m.name FROM device_models m WHERE m.id = r.scope_id)
      WHEN r.scope_type = 'SITE' THEN (SELECT s.name FROM sites s WHERE s.id = r.scope_id)
      ELSE r.scope_id
    END AS scope_name
  FROM alert_rules r
`;

function buildTenantScopeSql(
  ctx: TenantContext,
  alias = 'r',
): { clause: string; params: unknown[] } {
  if (ctx.allTenants) {
    if (ctx.activeTenantId) {
      return { clause: `${alias}.tenant_id = ?`, params: [ctx.activeTenantId] };
    }
    return { clause: '1 = 1', params: [] };
  }
  if (ctx.activeTenantId) {
    return { clause: `${alias}.tenant_id = ?`, params: [ctx.activeTenantId] };
  }
  if (ctx.tenantIds.length === 0) {
    return { clause: '1 = 0', params: [] };
  }
  const placeholders = ctx.tenantIds.map(() => '?').join(', ');
  return { clause: `${alias}.tenant_id IN (${placeholders})`, params: [...ctx.tenantIds] };
}

export class SqliteAlertRuleRepository implements IAlertRuleRepository {
  constructor(private readonly db: Database.Database) {}

  list(ctx: TenantContext, filter: AlertRuleListFilter): { items: AlertRule[]; total: number } {
    const scope = buildTenantScopeSql(ctx, 'r');
    const conditions: string[] = [scope.clause];
    const params: unknown[] = [...scope.params];

    if (filter.q && filter.q.trim()) {
      const pattern = `%${filter.q.trim().toLowerCase()}%`;
      conditions.push('(LOWER(r.name) LIKE ? OR LOWER(COALESCE(r.metric_key, \'\')) LIKE ?)');
      params.push(pattern, pattern);
    }
    if (filter.kind) {
      conditions.push('r.kind = ?');
      params.push(filter.kind);
    }
    if (filter.severity) {
      conditions.push('r.severity = ?');
      params.push(filter.severity);
    }
    if (filter.scopeType) {
      conditions.push('r.scope_type = ?');
      params.push(filter.scopeType);
    }
    if (filter.enabled !== undefined) {
      conditions.push('r.enabled = ?');
      params.push(filter.enabled ? 1 : 0);
    }

    const where = conditions.join(' AND ');
    const countRow = this.db
      .prepare(`SELECT COUNT(*) AS count FROM alert_rules r WHERE ${where}`)
      .get(...params) as { count: number };

    const offset = (filter.page - 1) * filter.pageSize;
    const rows = this.db
      .prepare(
        `${SELECT_WITH_SCOPE} WHERE ${where} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, filter.pageSize, offset) as AlertRuleRow[];

    return { items: rows.map(mapRow), total: countRow.count };
  }

  findById(ctx: TenantContext, id: string): AlertRule | null {
    const scope = buildTenantScopeSql(ctx, 'r');
    const row = this.db
      .prepare(`${SELECT_WITH_SCOPE} WHERE r.id = ? AND ${scope.clause}`)
      .get(id, ...scope.params) as AlertRuleRow | undefined;
    return row ? mapRow(row) : null;
  }

  findByIdSystem(id: string): AlertRule | null {
    const row = this.db
      .prepare(`${SELECT_WITH_SCOPE} WHERE r.id = ?`)
      .get(id) as AlertRuleRow | undefined;
    return row ? mapRow(row) : null;
  }

  listEnabledByTenantSystem(tenantId: string): AlertRule[] {
    const rows = this.db
      .prepare(`${SELECT_WITH_SCOPE} WHERE r.tenant_id = ? AND r.enabled = 1 ORDER BY r.created_at ASC`)
      .all(tenantId) as AlertRuleRow[];
    return rows.map(mapRow);
  }

  listEnabledOfflineRulesSystem(): AlertRule[] {
    const rows = this.db
      .prepare(`${SELECT_WITH_SCOPE} WHERE r.kind = 'OFFLINE' AND r.enabled = 1 ORDER BY r.created_at ASC`)
      .all() as AlertRuleRow[];
    return rows.map(mapRow);
  }

  create(ctx: TenantContext, input: CreateAlertRuleInput): AlertRule {
    if (!ctx.allTenants && !ctx.tenantIds.includes(input.tenantId)) {
      throw new Error('Tenant isolation violation on alert_rules.create');
    }
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO alert_rules (
          id, tenant_id, name, kind, metric_key, operator, threshold, duration_sec,
          severity, scope_type, scope_id, recipients_json, enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.tenantId,
        input.name,
        input.kind,
        input.metricKey,
        input.operator,
        input.threshold,
        input.durationSec,
        input.severity,
        input.scopeType,
        input.scopeId,
        JSON.stringify(input.recipients),
        input.enabled ? 1 : 0,
        now,
        now,
      );
    return this.findByIdSystem(input.id)!;
  }

  update(ctx: TenantContext, id: string, patch: UpdateAlertRuleInput): AlertRule | null {
    const existing = this.findById(ctx, id);
    if (!existing) return null;

    const now = new Date().toISOString();
    const sets: string[] = ['updated_at = ?'];
    const params: unknown[] = [now];

    if (patch.name !== undefined) {
      sets.push('name = ?');
      params.push(patch.name);
    }
    if (patch.kind !== undefined) {
      sets.push('kind = ?');
      params.push(patch.kind);
    }
    if (patch.metricKey !== undefined) {
      sets.push('metric_key = ?');
      params.push(patch.metricKey);
    }
    if (patch.operator !== undefined) {
      sets.push('operator = ?');
      params.push(patch.operator);
    }
    if (patch.threshold !== undefined) {
      sets.push('threshold = ?');
      params.push(patch.threshold);
    }
    if (patch.durationSec !== undefined) {
      sets.push('duration_sec = ?');
      params.push(patch.durationSec);
    }
    if (patch.severity !== undefined) {
      sets.push('severity = ?');
      params.push(patch.severity);
    }
    if (patch.scopeType !== undefined) {
      sets.push('scope_type = ?');
      params.push(patch.scopeType);
    }
    if (patch.scopeId !== undefined) {
      sets.push('scope_id = ?');
      params.push(patch.scopeId);
    }
    if (patch.recipients !== undefined) {
      sets.push('recipients_json = ?');
      params.push(JSON.stringify(patch.recipients));
    }
    if (patch.enabled !== undefined) {
      sets.push('enabled = ?');
      params.push(patch.enabled ? 1 : 0);
    }

    const scope = buildTenantScopeSql(ctx, 'alert_rules');
    this.db
      .prepare(`UPDATE alert_rules SET ${sets.join(', ')} WHERE id = ? AND ${scope.clause}`)
      .run(...params, id, ...scope.params);

    return this.findById(ctx, id);
  }

  delete(ctx: TenantContext, id: string): boolean {
    const scope = buildTenantScopeSql(ctx, 'alert_rules');
    const info = this.db
      .prepare(`DELETE FROM alert_rules WHERE id = ? AND ${scope.clause}`)
      .run(id, ...scope.params);
    return info.changes > 0;
  }
}
