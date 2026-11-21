import type Database from 'better-sqlite3';
import {
  DEFAULT_TENANT_SETTINGS,
  type Tenant,
  type TenantSettings,
  type TenantStatus,
} from '../../../shared/types.ts';
import type {
  CreateTenantInput,
  ITenantRepository,
  TenantContext,
  TenantListFilter,
} from './types.ts';

interface TenantRow {
  id: string;
  name: string;
  code: string;
  status: TenantStatus;
  contact_email: string;
  settings_json: string;
  created_at: string;
  updated_at: string;
}

const SORT_COLUMN_MAP: Record<string, string> = {
  name: 'name',
  code: 'code',
  status: 'status',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

function mapRow(row: TenantRow): Tenant {
  let parsed: Partial<TenantSettings> = {};
  try {
    parsed = JSON.parse(row.settings_json) as Partial<TenantSettings>;
  } catch {
    parsed = {};
  }
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    status: row.status,
    contactEmail: row.contact_email,
    settings: {
      ...DEFAULT_TENANT_SETTINGS,
      ...parsed,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteTenantRepository implements ITenantRepository {
  constructor(private readonly db: Database.Database) {}

  private buildScopeClause(ctx: TenantContext): { clause: string; params: unknown[] } {
    if (ctx.allTenants) {
      return { clause: '1 = 1', params: [] };
    }
    if (ctx.tenantIds.length === 0) {
      return { clause: '1 = 0', params: [] };
    }
    const placeholders = ctx.tenantIds.map(() => '?').join(', ');
    return { clause: `id IN (${placeholders})`, params: [...ctx.tenantIds] };
  }

  list(ctx: TenantContext, filter: TenantListFilter): { items: Tenant[]; total: number } {
    const scope = this.buildScopeClause(ctx);
    const conditions: string[] = [scope.clause];
    const params: unknown[] = [...scope.params];

    if (filter.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    }
    if (filter.q && filter.q.trim().length > 0) {
      const pattern = `%${filter.q.trim().toLowerCase()}%`;
      conditions.push('(LOWER(name) LIKE ? OR LOWER(code) LIKE ? OR LOWER(contact_email) LIKE ?)');
      params.push(pattern, pattern, pattern);
    }

    const where = conditions.join(' AND ');
    const countRow = this.db
      .prepare(`SELECT COUNT(*) AS count FROM tenants WHERE ${where}`)
      .get(...params) as { count: number };

    const sortCol = SORT_COLUMN_MAP[filter.sortField] ?? 'created_at';
    const sortDir = filter.sortDir === 'asc' ? 'ASC' : 'DESC';
    const offset = (filter.page - 1) * filter.pageSize;

    const rows = this.db
      .prepare(
        `SELECT * FROM tenants WHERE ${where} ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?`,
      )
      .all(...params, filter.pageSize, offset) as TenantRow[];

    return {
      items: rows.map(mapRow),
      total: countRow.count,
    };
  }

  listAccessible(ctx: TenantContext): Tenant[] {
    const scope = this.buildScopeClause(ctx);
    const rows = this.db
      .prepare(`SELECT * FROM tenants WHERE ${scope.clause} ORDER BY name ASC`)
      .all(...scope.params) as TenantRow[];
    return rows.map(mapRow);
  }

  findById(ctx: TenantContext, id: string): Tenant | null {
    const scope = this.buildScopeClause(ctx);
    const row = this.db
      .prepare(`SELECT * FROM tenants WHERE id = ? AND ${scope.clause}`)
      .get(id, ...scope.params) as TenantRow | undefined;
    return row ? mapRow(row) : null;
  }

  findByIdSystem(id: string): Tenant | null {
    const row = this.db
      .prepare('SELECT * FROM tenants WHERE id = ?')
      .get(id) as TenantRow | undefined;
    return row ? mapRow(row) : null;
  }

  findByCodeSystem(code: string): Tenant | null {
    const row = this.db
      .prepare('SELECT * FROM tenants WHERE code = ?')
      .get(code.toUpperCase()) as TenantRow | undefined;
    return row ? mapRow(row) : null;
  }

  create(ctx: TenantContext, input: CreateTenantInput): Tenant {
    if (!ctx.allTenants) {
      throw new Error('Only platform administrators can create tenants');
    }
    const now = new Date().toISOString();
    const status = input.status ?? 'ACTIVE';
    this.db
      .prepare(
        `INSERT INTO tenants (id, name, code, status, contact_email, settings_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.name,
        input.code.toUpperCase(),
        status,
        input.contactEmail.toLowerCase(),
        JSON.stringify(input.settings),
        now,
        now,
      );
    const created = this.findByIdSystem(input.id);
    if (!created) {
      throw new Error('Failed to load created tenant');
    }
    return created;
  }

  update(
    ctx: TenantContext,
    id: string,
    patch: { name?: string; contactEmail?: string },
  ): Tenant | null {
    const existing = this.findById(ctx, id);
    if (!existing) {
      return null;
    }
    const now = new Date().toISOString();
    const nextName = patch.name ?? existing.name;
    const nextEmail = patch.contactEmail ? patch.contactEmail.toLowerCase() : existing.contactEmail;
    this.db
      .prepare('UPDATE tenants SET name = ?, contact_email = ?, updated_at = ? WHERE id = ?')
      .run(nextName, nextEmail, now, id);
    return this.findById(ctx, id);
  }

  updateStatus(ctx: TenantContext, id: string, status: TenantStatus): Tenant | null {
    const existing = this.findById(ctx, id);
    if (!existing) {
      return null;
    }
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE tenants SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, now, id);
    return this.findById(ctx, id);
  }

  updateSettings(ctx: TenantContext, id: string, settings: TenantSettings): Tenant | null {
    const existing = this.findById(ctx, id);
    if (!existing) {
      return null;
    }
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE tenants SET settings_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(settings), now, id);
    return this.findById(ctx, id);
  }

  countByStatus(): { total: number; active: number; suspended: number } {
    const rows = this.db
      .prepare('SELECT status, COUNT(*) AS count FROM tenants GROUP BY status')
      .all() as Array<{ status: TenantStatus; count: number }>;
    let active = 0;
    let suspended = 0;
    for (const r of rows) {
      if (r.status === 'ACTIVE') active = r.count;
      if (r.status === 'SUSPENDED') suspended = r.count;
    }
    return { total: active + suspended, active, suspended };
  }
}
