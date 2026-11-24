import type Database from 'better-sqlite3';
import type { AlertPublic, AlertSeverity, AlertStatus } from '../../../shared/types.ts';
import type {
  AlertListFilter,
  CreateAlertInput,
  IAlertRepository,
  TenantContext,
} from './types.ts';

interface AlertRow {
  id: string;
  tenant_id: string;
  tenant_code?: string | null;
  tenant_name?: string | null;
  rule_id: string | null;
  rule_name?: string | null;
  device_id: string;
  device_name?: string | null;
  site_id?: string | null;
  site_name?: string | null;
  model_name?: string | null;
  severity: AlertSeverity;
  status: AlertStatus;
  message: string;
  snapshot_json: string;
  acknowledged_by: string | null;
  acknowledged_by_name?: string | null;
  acknowledged_at: string | null;
  ticket_id: string | null;
  escalation_level: number;
  escalated_at: string | null;
  email_delivery_failed: number;
  closed_at: string | null;
  closed_by: string | null;
  closed_by_name?: string | null;
  close_reason: string | null;
  created_at: string;
  updated_at: string;
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function mapRow(row: AlertRow): AlertPublic {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    tenantCode: row.tenant_code ?? undefined,
    tenantName: row.tenant_name ?? undefined,
    ruleId: row.rule_id,
    ruleName: row.rule_name ?? null,
    deviceId: row.device_id,
    deviceName: row.device_name ?? undefined,
    siteId: row.site_id ?? undefined,
    siteName: row.site_name ?? undefined,
    modelName: row.model_name ?? undefined,
    severity: row.severity,
    status: row.status,
    message: row.message,
    snapshot: parseJsonObject(row.snapshot_json),
    acknowledgedBy: row.acknowledged_by,
    acknowledgedByName: row.acknowledged_by_name ?? null,
    acknowledgedAt: row.acknowledged_at,
    ticketId: row.ticket_id,
    escalationLevel: (row.escalation_level === 2 ? 2 : row.escalation_level === 1 ? 1 : 0),
    escalatedAt: row.escalated_at,
    emailDeliveryFailed: row.email_delivery_failed === 1,
    closedAt: row.closed_at,
    closedBy: row.closed_by,
    closedByName: row.closed_by_name ?? null,
    closeReason: row.close_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_ENRICHED = `
  SELECT
    a.*,
    t.code AS tenant_code,
    t.name AS tenant_name,
    r.name AS rule_name,
    d.name AS device_name,
    d.site_id AS site_id,
    s.name AS site_name,
    m.name AS model_name,
    u_ack.name AS acknowledged_by_name,
    u_cls.name AS closed_by_name
  FROM alerts a
  LEFT JOIN tenants t ON t.id = a.tenant_id
  LEFT JOIN alert_rules r ON r.id = a.rule_id
  LEFT JOIN devices d ON d.id = a.device_id
  LEFT JOIN sites s ON s.id = d.site_id
  LEFT JOIN device_models m ON m.id = d.model_id
  LEFT JOIN users u_ack ON u_ack.id = a.acknowledged_by
  LEFT JOIN users u_cls ON u_cls.id = a.closed_by
`;

function buildTenantScopeSql(
  ctx: TenantContext,
  useActiveTenant = true,
  alias = 'a',
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

export class SqliteAlertRepository implements IAlertRepository {
  constructor(private readonly db: Database.Database) {}

  list(
    ctx: TenantContext,
    filter: AlertListFilter,
    useActiveTenant = true,
  ): { items: AlertPublic[]; total: number } {
    const scope = buildTenantScopeSql(ctx, useActiveTenant, 'a');
    const conditions: string[] = [scope.clause];
    const params: unknown[] = [...scope.params];

    if (filter.severity) {
      conditions.push('a.severity = ?');
      params.push(filter.severity);
    }
    if (filter.status) {
      conditions.push('a.status = ?');
      params.push(filter.status);
    }
    if (filter.deviceId) {
      conditions.push('a.device_id = ?');
      params.push(filter.deviceId);
    }
    if (filter.siteId) {
      conditions.push('d.site_id = ?');
      params.push(filter.siteId);
    }
    if (filter.q && filter.q.trim()) {
      const pattern = `%${filter.q.trim().toLowerCase()}%`;
      conditions.push(
        '(LOWER(a.message) LIKE ? OR LOWER(COALESCE(d.name, \'\')) LIKE ? OR LOWER(COALESCE(r.name, \'\')) LIKE ?)',
      );
      params.push(pattern, pattern, pattern);
    }

    const where = conditions.join(' AND ');
    const countRow = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM alerts a
         LEFT JOIN devices d ON d.id = a.device_id
         LEFT JOIN alert_rules r ON r.id = a.rule_id
         WHERE ${where}`,
      )
      .get(...params) as { count: number };

    const offset = (filter.page - 1) * filter.pageSize;
    const rows = this.db
      .prepare(
        `${SELECT_ENRICHED}
         WHERE ${where}
         ORDER BY
           CASE a.status WHEN 'OPEN' THEN 0 WHEN 'ACKNOWLEDGED' THEN 1 ELSE 2 END ASC,
           CASE a.severity WHEN 'CRITICAL' THEN 0 ELSE 1 END ASC,
           a.created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, filter.pageSize, offset) as AlertRow[];

    return { items: rows.map(mapRow), total: countRow.count };
  }

  findById(ctx: TenantContext, id: string): AlertPublic | null {
    const scope = buildTenantScopeSql(ctx, false, 'a');
    const row = this.db
      .prepare(`${SELECT_ENRICHED} WHERE a.id = ? AND ${scope.clause}`)
      .get(id, ...scope.params) as AlertRow | undefined;
    return row ? mapRow(row) : null;
  }

  findByIdSystem(id: string): AlertPublic | null {
    const row = this.db
      .prepare(`${SELECT_ENRICHED} WHERE a.id = ?`)
      .get(id) as AlertRow | undefined;
    return row ? mapRow(row) : null;
  }

  findActiveByDeviceAndRuleSystem(deviceId: string, ruleId: string): AlertPublic | null {
    const row = this.db
      .prepare(
        `${SELECT_ENRICHED}
         WHERE a.device_id = ? AND a.rule_id = ? AND a.status IN ('OPEN', 'ACKNOWLEDGED')
         ORDER BY a.created_at DESC LIMIT 1`,
      )
      .get(deviceId, ruleId) as AlertRow | undefined;
    return row ? mapRow(row) : null;
  }

  createSystem(input: CreateAlertInput): AlertPublic {
    const now = input.createdAt ?? new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO alerts (
          id, tenant_id, rule_id, device_id, severity, status, message, snapshot_json,
          acknowledged_by, acknowledged_at, ticket_id, escalation_level, escalated_at,
          email_delivery_failed, closed_at, closed_by, close_reason, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.tenantId,
        input.ruleId,
        input.deviceId,
        input.severity,
        input.status ?? 'OPEN',
        input.message,
        JSON.stringify(input.snapshot ?? {}),
        input.acknowledgedBy ?? null,
        input.acknowledgedAt ?? null,
        input.ticketId ?? null,
        input.escalationLevel ?? 0,
        input.escalatedAt ?? null,
        input.emailDeliveryFailed ? 1 : 0,
        input.closedAt ?? null,
        input.closedBy ?? null,
        input.closeReason ?? null,
        now,
        now,
      );
    return this.findByIdSystem(input.id)!;
  }

  acknowledge(ctx: TenantContext, id: string, actorId: string, ackedAt: string): AlertPublic | null {
    const scope = buildTenantScopeSql(ctx, false, 'alerts');
    const info = this.db
      .prepare(
        `UPDATE alerts
         SET status = 'ACKNOWLEDGED', acknowledged_by = ?, acknowledged_at = ?, updated_at = ?
         WHERE id = ? AND ${scope.clause}`,
      )
      .run(actorId, ackedAt, ackedAt, id, ...scope.params);
    if (info.changes === 0) return null;
    return this.findById(ctx, id);
  }

  close(
    ctx: TenantContext,
    id: string,
    actorId: string,
    reason: string,
    closedAt: string,
  ): AlertPublic | null {
    const scope = buildTenantScopeSql(ctx, false, 'alerts');
    const info = this.db
      .prepare(
        `UPDATE alerts
         SET status = 'CLOSED', closed_at = ?, closed_by = ?, close_reason = ?, updated_at = ?
         WHERE id = ? AND ${scope.clause}`,
      )
      .run(closedAt, actorId, reason, closedAt, id, ...scope.params);
    if (info.changes === 0) return null;
    return this.findById(ctx, id);
  }

  setTicketId(ctx: TenantContext, id: string, ticketId: string): AlertPublic | null {
    const scope = buildTenantScopeSql(ctx, false, 'alerts');
    const now = new Date().toISOString();
    const info = this.db
      .prepare(
        `UPDATE alerts
         SET ticket_id = ?, updated_at = ?
         WHERE id = ? AND ${scope.clause}`,
      )
      .run(ticketId, now, id, ...scope.params);
    if (info.changes === 0) return null;
    return this.findById(ctx, id);
  }

  closeByTicketSystem(
    id: string,
    actorId: string,
    reason: string,
    closedAt: string,
  ): AlertPublic | null {
    const info = this.db
      .prepare(
        `UPDATE alerts
         SET status = 'CLOSED', closed_at = ?, closed_by = ?, close_reason = ?, updated_at = ?
         WHERE id = ? AND status != 'CLOSED'`,
      )
      .run(closedAt, actorId, reason, closedAt, id);
    if (info.changes === 0) return null;
    return this.findByIdSystem(id);
  }

  updateEscalationSystem(id: string, level: 1 | 2, escalatedAt: string): AlertPublic | null {
    const info = this.db
      .prepare(
        `UPDATE alerts
         SET escalation_level = ?, escalated_at = ?, updated_at = ?
         WHERE id = ? AND status = 'OPEN'`,
      )
      .run(level, escalatedAt, escalatedAt, id);
    if (info.changes === 0) return null;
    return this.findByIdSystem(id);
  }

  markEmailDeliveryFailedSystem(id: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE alerts SET email_delivery_failed = 1, updated_at = ? WHERE id = ?')
      .run(now, id);
  }

  listOpenCriticalForEscalationSystem(): AlertPublic[] {
    const rows = this.db
      .prepare(
        `${SELECT_ENRICHED}
         WHERE a.status = 'OPEN' AND a.severity = 'CRITICAL' AND a.escalation_level < 2
         ORDER BY a.created_at ASC`,
      )
      .all() as AlertRow[];
    return rows.map(mapRow);
  }

  listByDevice(ctx: TenantContext, deviceId: string, limit = 50): AlertPublic[] {
    const scope = buildTenantScopeSql(ctx, false, 'a');
    const rows = this.db
      .prepare(
        `${SELECT_ENRICHED}
         WHERE a.device_id = ? AND ${scope.clause}
         ORDER BY a.created_at DESC LIMIT ?`,
      )
      .all(deviceId, ...scope.params, limit) as AlertRow[];
    return rows.map(mapRow);
  }

  countActiveByTenant(tenantId: string): { critical: number; warning: number; total: number } {
    const rows = this.db
      .prepare(
        `SELECT severity, COUNT(*) AS count
         FROM alerts
         WHERE tenant_id = ? AND status IN ('OPEN', 'ACKNOWLEDGED')
         GROUP BY severity`,
      )
      .all(tenantId) as Array<{ severity: AlertSeverity; count: number }>;

    let critical = 0;
    let warning = 0;
    for (const r of rows) {
      if (r.severity === 'CRITICAL') critical = r.count;
      else if (r.severity === 'WARNING') warning = r.count;
    }
    return { critical, warning, total: critical + warning };
  }

  countActiveBySiteForTenant(tenantId: string): Map<string, number> {
    const rows = this.db
      .prepare(
        `SELECT d.site_id AS site_id, COUNT(*) AS count
         FROM alerts a
         JOIN devices d ON d.id = a.device_id
         WHERE a.tenant_id = ? AND a.status IN ('OPEN', 'ACKNOWLEDGED')
         GROUP BY d.site_id`,
      )
      .all(tenantId) as Array<{ site_id: string; count: number }>;

    const result = new Map<string, number>();
    for (const r of rows) {
      result.set(r.site_id, r.count);
    }
    return result;
  }

  countActiveByTenantIds(
    tenantIds: string[] | null,
  ): Map<string, { critical: number; warning: number; total: number }> {
    let rows: Array<{ tenant_id: string; severity: AlertSeverity; count: number }>;
    if (tenantIds === null) {
      rows = this.db
        .prepare(
          `SELECT tenant_id, severity, COUNT(*) AS count
           FROM alerts
           WHERE status IN ('OPEN', 'ACKNOWLEDGED')
           GROUP BY tenant_id, severity`,
        )
        .all() as Array<{ tenant_id: string; severity: AlertSeverity; count: number }>;
    } else if (tenantIds.length === 0) {
      rows = [];
    } else {
      const placeholders = tenantIds.map(() => '?').join(', ');
      rows = this.db
        .prepare(
          `SELECT tenant_id, severity, COUNT(*) AS count
           FROM alerts
           WHERE tenant_id IN (${placeholders}) AND status IN ('OPEN', 'ACKNOWLEDGED')
           GROUP BY tenant_id, severity`,
        )
        .all(...tenantIds) as Array<{ tenant_id: string; severity: AlertSeverity; count: number }>;
    }

    const result = new Map<string, { critical: number; warning: number; total: number }>();
    for (const r of rows) {
      const entry = result.get(r.tenant_id) ?? { critical: 0, warning: 0, total: 0 };
      if (r.severity === 'CRITICAL') entry.critical += r.count;
      else entry.warning += r.count;
      entry.total += r.count;
      result.set(r.tenant_id, entry);
    }
    return result;
  }

  countOpenCriticalGlobal(): number {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) AS count FROM alerts WHERE severity = 'CRITICAL' AND status IN ('OPEN', 'ACKNOWLEDGED')",
      )
      .get() as { count: number };
    return row.count;
  }

  listOpenCriticalInScope(ctx: TenantContext, limit = 30): AlertPublic[] {
    const scope = buildTenantScopeSql(ctx, false, 'a');
    const rows = this.db
      .prepare(
        `${SELECT_ENRICHED}
         WHERE a.severity = 'CRITICAL' AND a.status = 'OPEN' AND ${scope.clause}
         ORDER BY a.escalation_level DESC, a.created_at ASC
         LIMIT ?`,
      )
      .all(...scope.params, limit) as AlertRow[];
    return rows.map(mapRow);
  }
}
