import type Database from 'better-sqlite3';
import type { ConfigProfilePublic, ConfigProfileVersion } from '../../../shared/types.ts';
import type {
  ConfigProfileListFilter,
  CreateConfigProfileInput,
  IConfigProfileRepository,
  TenantContext,
} from './types.ts';

interface ConfigProfileRow {
  id: string;
  tenant_id: string;
  model_id: string;
  model_name?: string;
  name: string;
  version: number;
  payload_json: string;
  created_by: string;
  created_by_name?: string | null;
  created_at: string;
  updated_at: string;
}

interface ConfigProfileVersionRow {
  id: string;
  profile_id: string;
  tenant_id: string;
  version: number;
  payload_json: string;
  created_by: string;
  created_by_name?: string | null;
  created_at: string;
}

const SELECT_PROFILE_ENRICHED = `
  SELECT cp.*,
         m.name AS model_name,
         u.name AS created_by_name
  FROM config_profiles cp
  LEFT JOIN device_models m ON m.id = cp.model_id
  LEFT JOIN users u ON u.id = cp.created_by
`;

function parsePayload(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function mapProfileRow(row: ConfigProfileRow): ConfigProfilePublic {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    modelId: row.model_id,
    modelName: row.model_name,
    name: row.name,
    version: Number(row.version),
    payload: parsePayload(row.payload_json),
    createdBy: row.created_by,
    createdByName: row.created_by_name ?? (row.created_by === 'SYSTEM' ? 'System' : null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapVersionRow(row: ConfigProfileVersionRow): ConfigProfileVersion {
  return {
    id: row.id,
    profileId: row.profile_id,
    version: Number(row.version),
    payload: parsePayload(row.payload_json),
    createdBy: row.created_by,
    createdByName: row.created_by_name ?? (row.created_by === 'SYSTEM' ? 'System' : null),
    createdAt: row.created_at,
  };
}

export class SqliteConfigProfileRepository implements IConfigProfileRepository {
  constructor(private readonly db: Database.Database) {}

  private buildScopeClause(
    ctx: TenantContext,
    useActiveTenant = false,
  ): { clause: string; params: unknown[] } {
    if (ctx.allTenants) {
      if (useActiveTenant && ctx.activeTenantId) {
        return { clause: 'cp.tenant_id = ?', params: [ctx.activeTenantId] };
      }
      return { clause: '1 = 1', params: [] };
    }
    if (ctx.tenantIds.length === 0) {
      return { clause: '1 = 0', params: [] };
    }
    if (useActiveTenant && ctx.activeTenantId && ctx.tenantIds.includes(ctx.activeTenantId)) {
      return { clause: 'cp.tenant_id = ?', params: [ctx.activeTenantId] };
    }
    const placeholders = ctx.tenantIds.map(() => '?').join(', ');
    return {
      clause: `cp.tenant_id IN (${placeholders})`,
      params: [...ctx.tenantIds],
    };
  }

  private assertCanWriteTenant(ctx: TenantContext, tenantId: string): void {
    if (ctx.allTenants) return;
    if (!ctx.tenantIds.includes(tenantId)) {
      throw new Error('Tenant isolation violation: attempted cross-tenant config profile write');
    }
  }

  list(
    ctx: TenantContext,
    filter: ConfigProfileListFilter,
  ): { items: ConfigProfilePublic[]; total: number } {
    const scope = this.buildScopeClause(ctx, true);
    const conditions: string[] = [scope.clause];
    const params: unknown[] = [...scope.params];

    if (filter.q && filter.q.trim()) {
      const like = `%${filter.q.trim().toLowerCase()}%`;
      conditions.push('(LOWER(cp.name) LIKE ? OR LOWER(m.name) LIKE ?)');
      params.push(like, like);
    }
    if (filter.modelId) {
      conditions.push('cp.model_id = ?');
      params.push(filter.modelId);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const countRow = this.db
      .prepare(
        `SELECT COUNT(*) AS total
         FROM config_profiles cp
         LEFT JOIN device_models m ON m.id = cp.model_id
         ${where}`,
      )
      .get(...params) as { total: number };

    const offset = (filter.page - 1) * filter.pageSize;
    const rows = this.db
      .prepare(
        `${SELECT_PROFILE_ENRICHED}
         ${where}
         ORDER BY m.name ASC, cp.name ASC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, filter.pageSize, offset) as ConfigProfileRow[];

    return {
      items: rows.map(mapProfileRow),
      total: Number(countRow.total ?? 0),
    };
  }

  findById(ctx: TenantContext, id: string): ConfigProfilePublic | null {
    const scope = this.buildScopeClause(ctx, false);
    const row = this.db
      .prepare(`${SELECT_PROFILE_ENRICHED} WHERE cp.id = ? AND ${scope.clause}`)
      .get(id, ...scope.params) as ConfigProfileRow | undefined;
    return row ? mapProfileRow(row) : null;
  }

  findByIdSystem(id: string): ConfigProfilePublic | null {
    const row = this.db
      .prepare(`${SELECT_PROFILE_ENRICHED} WHERE cp.id = ?`)
      .get(id) as ConfigProfileRow | undefined;
    return row ? mapProfileRow(row) : null;
  }

  findVersionSystem(profileId: string, version: number): ConfigProfileVersion | null {
    const row = this.db
      .prepare(
        `SELECT v.*, u.name AS created_by_name
         FROM config_profile_versions v
         LEFT JOIN users u ON u.id = v.created_by
         WHERE v.profile_id = ? AND v.version = ?`,
      )
      .get(profileId, version) as ConfigProfileVersionRow | undefined;
    return row ? mapVersionRow(row) : null;
  }

  listVersions(ctx: TenantContext, profileId: string): ConfigProfileVersion[] {
    const profile = this.findById(ctx, profileId);
    if (!profile) return [];

    const rows = this.db
      .prepare(
        `SELECT v.*, u.name AS created_by_name
         FROM config_profile_versions v
         LEFT JOIN users u ON u.id = v.created_by
         WHERE v.profile_id = ? AND v.tenant_id = ?
         ORDER BY v.version DESC`,
      )
      .all(profileId, profile.tenantId) as ConfigProfileVersionRow[];
    return rows.map(mapVersionRow);
  }

  create(ctx: TenantContext, input: CreateConfigProfileInput): ConfigProfilePublic {
    this.assertCanWriteTenant(ctx, input.tenantId);
    const now = input.createdAt ?? new Date().toISOString();
    const payloadJson = JSON.stringify(input.payload);

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO config_profiles (
            id, tenant_id, model_id, name, version, payload_json, created_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`,
        )
        .run(
          input.id,
          input.tenantId,
          input.modelId,
          input.name.trim(),
          payloadJson,
          input.createdBy,
          now,
          now,
        );

      this.db
        .prepare(
          `INSERT INTO config_profile_versions (
            id, profile_id, tenant_id, version, payload_json, created_by, created_at
          ) VALUES (?, ?, ?, 1, ?, ?, ?)`,
        )
        .run(input.versionId, input.id, input.tenantId, payloadJson, input.createdBy, now);
    });

    tx();
    return this.findById(ctx, input.id)!;
  }

  updateAndIncrementVersion(
    ctx: TenantContext,
    id: string,
    patch: { name?: string; payload?: Record<string, unknown>; actorId: string; versionId: string },
  ): ConfigProfilePublic | null {
    const existing = this.findById(ctx, id);
    if (!existing) return null;

    const now = new Date().toISOString();
    const nextVersion = existing.version + 1;
    const nextName = patch.name !== undefined ? patch.name.trim() : existing.name;
    const nextPayload = patch.payload !== undefined ? patch.payload : existing.payload;
    const payloadJson = JSON.stringify(nextPayload);

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE config_profiles
           SET name = ?, version = ?, payload_json = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(nextName, nextVersion, payloadJson, now, id);

      this.db
        .prepare(
          `INSERT INTO config_profile_versions (
            id, profile_id, tenant_id, version, payload_json, created_by, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          patch.versionId,
          existing.id,
          existing.tenantId,
          nextVersion,
          payloadJson,
          patch.actorId,
          now,
        );
    });

    tx();
    return this.findById(ctx, id);
  }
}
