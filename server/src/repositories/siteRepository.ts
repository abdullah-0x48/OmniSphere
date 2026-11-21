import type Database from 'better-sqlite3';
import type { Site } from '../../../shared/types.ts';
import type {
  CreateSiteInput,
  ISiteRepository,
  SiteListFilter,
  TenantContext,
} from './types.ts';

interface SiteRow {
  id: string;
  tenant_id: string;
  name: string;
  location: string;
  device_count?: number;
  created_at: string;
  updated_at: string;
}

const SORT_COLUMN_MAP: Record<string, string> = {
  name: 's.name',
  location: 's.location',
  deviceCount: 'device_count',
  createdAt: 's.created_at',
};

function mapRow(row: SiteRow): Site {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    location: row.location,
    deviceCount: Number(row.device_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_SITE_WITH_COUNT = `
  SELECT s.*,
    (SELECT COUNT(*) FROM devices d WHERE d.site_id = s.id) AS device_count
  FROM sites s
`;

export class SqliteSiteRepository implements ISiteRepository {
  constructor(private readonly db: Database.Database) {}

  private buildScopeClause(
    ctx: TenantContext,
    useActiveTenantForList = false,
  ): { clause: string; params: unknown[] } {
    if (ctx.allTenants) {
      if (useActiveTenantForList && ctx.activeTenantId) {
        return { clause: 's.tenant_id = ?', params: [ctx.activeTenantId] };
      }
      return { clause: '1 = 1', params: [] };
    }
    if (ctx.tenantIds.length === 0) {
      return { clause: '1 = 0', params: [] };
    }
    if (useActiveTenantForList && ctx.activeTenantId && ctx.tenantIds.includes(ctx.activeTenantId)) {
      return { clause: 's.tenant_id = ?', params: [ctx.activeTenantId] };
    }
    const placeholders = ctx.tenantIds.map(() => '?').join(', ');
    return {
      clause: `s.tenant_id IN (${placeholders})`,
      params: [...ctx.tenantIds],
    };
  }

  private assertCanWriteTenant(ctx: TenantContext, tenantId: string): void {
    if (ctx.allTenants) return;
    if (!ctx.tenantIds.includes(tenantId)) {
      throw new Error('Tenant isolation violation: attempted cross-tenant site write');
    }
  }

  list(ctx: TenantContext, filter: SiteListFilter): { items: Site[]; total: number } {
    const scope = this.buildScopeClause(ctx, true);
    const conditions: string[] = [scope.clause];
    const params: unknown[] = [...scope.params];

    if (filter.q && filter.q.trim()) {
      const like = `%${filter.q.trim().toLowerCase()}%`;
      conditions.push('(LOWER(s.name) LIKE ? OR LOWER(s.location) LIKE ?)');
      params.push(like, like);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const countRow = this.db
      .prepare(`SELECT COUNT(*) AS total FROM sites s ${where}`)
      .get(...params) as { total: number };

    const sortCol = SORT_COLUMN_MAP[filter.sortField] ?? 's.name';
    const sortDir = filter.sortDir === 'desc' ? 'DESC' : 'ASC';
    const offset = (filter.page - 1) * filter.pageSize;

    const rows = this.db
      .prepare(
        `${SELECT_SITE_WITH_COUNT} ${where} ORDER BY ${sortCol} ${sortDir}, s.name ASC LIMIT ? OFFSET ?`,
      )
      .all(...params, filter.pageSize, offset) as SiteRow[];

    return {
      items: rows.map(mapRow),
      total: countRow.total,
    };
  }

  listAllInTenant(ctx: TenantContext, tenantId: string): Site[] {
    if (!ctx.allTenants && !ctx.tenantIds.includes(tenantId)) {
      return [];
    }
    const rows = this.db
      .prepare(`${SELECT_SITE_WITH_COUNT} WHERE s.tenant_id = ? ORDER BY s.name ASC`)
      .all(tenantId) as SiteRow[];
    return rows.map(mapRow);
  }

  findById(ctx: TenantContext, id: string): Site | null {
    const scope = this.buildScopeClause(ctx, false);
    const row = this.db
      .prepare(`${SELECT_SITE_WITH_COUNT} WHERE s.id = ? AND ${scope.clause}`)
      .get(id, ...scope.params) as SiteRow | undefined;
    return row ? mapRow(row) : null;
  }

  findByNameInTenant(ctx: TenantContext, tenantId: string, name: string): Site | null {
    if (!ctx.allTenants && !ctx.tenantIds.includes(tenantId)) {
      return null;
    }
    const row = this.db
      .prepare(`${SELECT_SITE_WITH_COUNT} WHERE s.tenant_id = ? AND LOWER(s.name) = LOWER(?)`)
      .get(tenantId, name.trim()) as SiteRow | undefined;
    return row ? mapRow(row) : null;
  }

  create(ctx: TenantContext, input: CreateSiteInput): Site {
    this.assertCanWriteTenant(ctx, input.tenantId);
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO sites (id, tenant_id, name, location, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(input.id, input.tenantId, input.name.trim(), input.location.trim(), now, now);

    return this.findById(ctx, input.id)!;
  }

  update(
    ctx: TenantContext,
    id: string,
    patch: { name?: string; location?: string },
  ): Site | null {
    const existing = this.findById(ctx, id);
    if (!existing) return null;

    const now = new Date().toISOString();
    const nextName = patch.name !== undefined ? patch.name.trim() : existing.name;
    const nextLocation = patch.location !== undefined ? patch.location.trim() : existing.location;

    this.db
      .prepare('UPDATE sites SET name = ?, location = ?, updated_at = ? WHERE id = ?')
      .run(nextName, nextLocation, now, id);

    return this.findById(ctx, id);
  }

  delete(ctx: TenantContext, id: string): boolean {
    const existing = this.findById(ctx, id);
    if (!existing) return false;
    const result = this.db.prepare('DELETE FROM sites WHERE id = ?').run(id);
    return result.changes > 0;
  }
}
