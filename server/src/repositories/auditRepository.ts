import type Database from 'better-sqlite3';
import type { AuditLog, AuditOutcome, RoleCode } from '../../../shared/types.ts';
import type {
  AuditListFilter,
  CreateAuditInput,
  IAuditRepository,
  TenantContext,
} from './types.ts';

interface AuditRow {
  id: string;
  at: string;
  actor_id: string;
  actor_name?: string | null;
  actor_email?: string | null;
  actor_role: RoleCode | 'SYSTEM' | 'ANONYMOUS';
  tenant_id: string | null;
  tenant_code?: string | null;
  action: string;
  target_type: string;
  target_id: string;
  outcome: AuditOutcome;
  ip: string;
  details_json: string;
}

function mapRow(row: AuditRow): AuditLog {
  let details: Record<string, unknown> = {};
  try {
    details = JSON.parse(row.details_json) as Record<string, unknown>;
  } catch {
    details = {};
  }
  return {
    id: row.id,
    at: row.at,
    actorId: row.actor_id,
    actorName: row.actor_name ?? null,
    actorEmail: row.actor_email ?? null,
    actorRole: row.actor_role,
    tenantId: row.tenant_id,
    tenantCode: row.tenant_code ?? null,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    outcome: row.outcome,
    ip: row.ip,
    details,
  };
}

/**
 * Append-only audit repository (FR-SEC-03, FR-SEC-04).
 * Intentionally exposes NO update or delete operations; the database also blocks them via triggers.
 */
export class SqliteAuditRepository implements IAuditRepository {
  constructor(private readonly db: Database.Database) {}

  insert(input: CreateAuditInput): AuditLog {
    this.db
      .prepare(
        `INSERT INTO audit_logs (
          id, at, actor_id, actor_role, tenant_id,
          action, target_type, target_id, outcome, ip, details_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.at,
        input.actorId,
        input.actorRole,
        input.tenantId,
        input.action,
        input.targetType,
        input.targetId,
        input.outcome,
        input.ip,
        JSON.stringify(input.details),
      );
    return {
      id: input.id,
      at: input.at,
      actorId: input.actorId,
      actorRole: input.actorRole,
      tenantId: input.tenantId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      outcome: input.outcome,
      ip: input.ip,
      details: input.details,
    };
  }

  list(ctx: TenantContext, filter: AuditListFilter): { items: AuditLog[]; total: number } {
    const conditions: string[] = [];
    const params: unknown[] = [];

    // Enforce tenant scoping: PA sees all (and may filter by tenantId), CA sees own tenant only.
    if (ctx.allTenants) {
      if (filter.tenantId) {
        conditions.push('a.tenant_id = ?');
        params.push(filter.tenantId);
      }
    } else if (ctx.tenantIds.length > 0) {
      const placeholders = ctx.tenantIds.map(() => '?').join(', ');
      conditions.push(`a.tenant_id IN (${placeholders})`);
      params.push(...ctx.tenantIds);
    } else {
      conditions.push('1 = 0');
    }

    if (filter.actorId && filter.actorId.trim().length > 0) {
      const pattern = `%${filter.actorId.trim().toLowerCase()}%`;
      conditions.push(
        '(LOWER(a.actor_id) LIKE ? OR LOWER(COALESCE(u.email, \'\')) LIKE ? OR LOWER(COALESCE(u.name, \'\')) LIKE ?)',
      );
      params.push(pattern, pattern, pattern);
    }
    if (filter.action && filter.action.trim().length > 0) {
      conditions.push('LOWER(a.action) LIKE ?');
      params.push(`%${filter.action.trim().toLowerCase()}%`);
    }
    if (filter.targetType && filter.targetType.trim().length > 0) {
      conditions.push('LOWER(a.target_type) = ?');
      params.push(filter.targetType.trim().toLowerCase());
    }
    if (filter.targetId && filter.targetId.trim().length > 0) {
      conditions.push('LOWER(a.target_id) LIKE ?');
      params.push(`%${filter.targetId.trim().toLowerCase()}%`);
    }
    if (filter.outcome) {
      conditions.push('a.outcome = ?');
      params.push(filter.outcome);
    }
    if (filter.from) {
      conditions.push('a.at >= ?');
      params.push(filter.from);
    }
    if (filter.to) {
      conditions.push('a.at <= ?');
      params.push(filter.to);
    }

    const where = conditions.length > 0 ? conditions.join(' AND ') : '1 = 1';
    const countRow = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.actor_id
         WHERE ${where}`,
      )
      .get(...params) as { count: number };

    const sortDir = filter.sortDir === 'asc' ? 'ASC' : 'DESC';
    const offset = (filter.page - 1) * filter.pageSize;

    const rows = this.db
      .prepare(
        `SELECT a.*, u.name AS actor_name, u.email AS actor_email, t.code AS tenant_code
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.actor_id
         LEFT JOIN tenants t ON t.id = a.tenant_id
         WHERE ${where}
         ORDER BY a.at ${sortDir}, a.rowid ${sortDir}
         LIMIT ? OFFSET ?`,
      )
      .all(...params, filter.pageSize, offset) as AuditRow[];

    return {
      items: rows.map(mapRow),
      total: countRow.count,
    };
  }

  countSince(isoTimestamp: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM audit_logs WHERE at >= ?')
      .get(isoTimestamp) as { count: number };
    return row.count;
  }
}
