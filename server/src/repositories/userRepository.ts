import type Database from 'better-sqlite3';
import type { RoleCode, UserPublic, UserStatus } from '../../../shared/types.ts';
import {
  toUserPublic,
  type CreateUserInput,
  type IUserRepository,
  type TenantContext,
  type UserListFilter,
  type UserRecord,
} from './types.ts';

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: RoleCode;
  tenant_id: string | null;
  tenant_name?: string | null;
  tenant_code?: string | null;
  assigned_tenant_ids_json: string;
  is_supervisor: number;
  status: UserStatus;
  password_hash: string;
  failed_logins: number;
  locked_until: string | null;
  password_reset_token_hash: string | null;
  password_reset_expires_at: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

const SORT_COLUMN_MAP: Record<string, string> = {
  name: 'u.name',
  email: 'u.email',
  role: 'u.role',
  status: 'u.status',
  lastLoginAt: 'u.last_login_at',
  createdAt: 'u.created_at',
};

function mapRow(row: UserRow): UserRecord {
  let assignedTenantIds: string[] = [];
  try {
    const parsed = JSON.parse(row.assigned_tenant_ids_json);
    if (Array.isArray(parsed)) {
      assignedTenantIds = parsed.filter((item): item is string => typeof item === 'string');
    }
  } catch {
    assignedTenantIds = [];
  }
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name ?? null,
    tenantCode: row.tenant_code ?? null,
    assignedTenantIds,
    isSupervisor: row.is_supervisor === 1,
    status: row.status,
    passwordHash: row.password_hash,
    failedLogins: row.failed_logins,
    lockedUntil: row.locked_until,
    passwordResetTokenHash: row.password_reset_token_hash,
    passwordResetExpiresAt: row.password_reset_expires_at,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_USER_WITH_TENANT = `
  SELECT u.*, t.name AS tenant_name, t.code AS tenant_code
  FROM users u
  LEFT JOIN tenants t ON t.id = u.tenant_id
`;

export class SqliteUserRepository implements IUserRepository {
  constructor(private readonly db: Database.Database) {}

  /**
   * Builds mandatory tenant isolation SQL clause from TenantContext.
   * Non-platform roles can ONLY see users whose tenant_id is inside ctx.tenantIds.
   */
  private buildScopeClause(ctx: TenantContext): { clause: string; params: unknown[] } {
    if (ctx.allTenants) {
      return { clause: '1 = 1', params: [] };
    }
    if (ctx.tenantIds.length === 0) {
      return { clause: '1 = 0', params: [] };
    }
    const placeholders = ctx.tenantIds.map(() => '?').join(', ');
    return {
      clause: `u.tenant_id IS NOT NULL AND u.tenant_id IN (${placeholders})`,
      params: [...ctx.tenantIds],
    };
  }

  list(ctx: TenantContext, filter: UserListFilter): { items: UserPublic[]; total: number } {
    const scope = this.buildScopeClause(ctx);
    const conditions: string[] = [scope.clause];
    const params: unknown[] = [...scope.params];

    if (filter.staffOnly) {
      // Provider staff list is only meaningful for PLATFORM_ADMIN; scope still protects non-PA.
      conditions.push("u.role IN ('SUPPORT_ENGINEER', 'FIELD_TECHNICIAN')");
    }
    if (filter.role) {
      conditions.push('u.role = ?');
      params.push(filter.role);
    }
    if (filter.status) {
      conditions.push('u.status = ?');
      params.push(filter.status);
    }
    if (filter.tenantId && ctx.allTenants) {
      conditions.push('u.tenant_id = ?');
      params.push(filter.tenantId);
    }
    if (filter.q && filter.q.trim().length > 0) {
      const pattern = `%${filter.q.trim().toLowerCase()}%`;
      conditions.push('(LOWER(u.name) LIKE ? OR LOWER(u.email) LIKE ?)');
      params.push(pattern, pattern);
    }

    const where = conditions.join(' AND ');
    const countRow = this.db
      .prepare(`SELECT COUNT(*) AS count FROM users u WHERE ${where}`)
      .get(...params) as { count: number };

    const sortCol = SORT_COLUMN_MAP[filter.sortField] ?? 'u.created_at';
    const sortDir = filter.sortDir === 'asc' ? 'ASC' : 'DESC';
    const offset = (filter.page - 1) * filter.pageSize;

    const rows = this.db
      .prepare(
        `${SELECT_USER_WITH_TENANT} WHERE ${where} ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?`,
      )
      .all(...params, filter.pageSize, offset) as UserRow[];

    return {
      items: rows.map((r) => toUserPublic(mapRow(r))),
      total: countRow.count,
    };
  }

  findById(ctx: TenantContext, id: string): UserRecord | null {
    const scope = this.buildScopeClause(ctx);
    const row = this.db
      .prepare(`${SELECT_USER_WITH_TENANT} WHERE u.id = ? AND (${scope.clause})`)
      .get(id, ...scope.params) as UserRow | undefined;
    return row ? mapRow(row) : null;
  }

  findByEmailForAuth(email: string): UserRecord | null {
    const row = this.db
      .prepare(`${SELECT_USER_WITH_TENANT} WHERE u.email = ?`)
      .get(email.trim().toLowerCase()) as UserRow | undefined;
    return row ? mapRow(row) : null;
  }

  findByIdForAuth(id: string): UserRecord | null {
    const row = this.db
      .prepare(`${SELECT_USER_WITH_TENANT} WHERE u.id = ?`)
      .get(id) as UserRow | undefined;
    return row ? mapRow(row) : null;
  }

  findByResetTokenHashForAuth(tokenHash: string): UserRecord | null {
    const row = this.db
      .prepare(`${SELECT_USER_WITH_TENANT} WHERE u.password_reset_token_hash = ?`)
      .get(tokenHash) as UserRow | undefined;
    return row ? mapRow(row) : null;
  }

  listDemoAccounts(): UserRecord[] {
    const rows = this.db
      .prepare(
        `${SELECT_USER_WITH_TENANT}
         WHERE u.email LIKE '%@omnisphere.demo'
         ORDER BY
           CASE u.role
             WHEN 'PLATFORM_ADMIN' THEN 1
             WHEN 'SUPPORT_ENGINEER' THEN 2
             WHEN 'FIELD_TECHNICIAN' THEN 3
             WHEN 'CLIENT_ADMIN' THEN 4
             WHEN 'CLIENT_MANAGER' THEN 5
             WHEN 'CLIENT_OPERATOR' THEN 6
           END,
           t.code ASC,
           u.email ASC`,
      )
      .all() as UserRow[];
    return rows.map(mapRow);
  }

  create(ctx: TenantContext, input: CreateUserInput): UserRecord {
    // Enforce tenant isolation on write: non-PA may only create users within their own tenantId.
    if (!ctx.allTenants) {
      if (!input.tenantId || !ctx.tenantIds.includes(input.tenantId)) {
        throw new Error('Cross-tenant user creation is forbidden');
      }
    }
    const now = new Date().toISOString();
    const status = input.status ?? 'ACTIVE';
    this.db
      .prepare(
        `INSERT INTO users (
          id, email, name, role, tenant_id, assigned_tenant_ids_json,
          is_supervisor, status, password_hash, failed_logins,
          locked_until, password_reset_token_hash, password_reset_expires_at,
          last_login_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, NULL, ?, ?)`,
      )
      .run(
        input.id,
        input.email.trim().toLowerCase(),
        input.name.trim(),
        input.role,
        input.tenantId,
        JSON.stringify(input.assignedTenantIds),
        input.isSupervisor ? 1 : 0,
        status,
        input.passwordHash,
        now,
        now,
      );
    const created = this.findByIdForAuth(input.id);
    if (!created) {
      throw new Error('Failed to load created user');
    }
    return created;
  }

  update(
    ctx: TenantContext,
    id: string,
    patch: { name?: string; role?: RoleCode; isSupervisor?: boolean },
  ): UserRecord | null {
    const existing = this.findById(ctx, id);
    if (!existing) {
      return null;
    }
    const now = new Date().toISOString();
    const nextName = patch.name !== undefined ? patch.name.trim() : existing.name;
    const nextRole = patch.role ?? existing.role;
    const nextSupervisor = patch.isSupervisor !== undefined ? patch.isSupervisor : existing.isSupervisor;
    this.db
      .prepare('UPDATE users SET name = ?, role = ?, is_supervisor = ?, updated_at = ? WHERE id = ?')
      .run(nextName, nextRole, nextSupervisor ? 1 : 0, now, id);
    return this.findById(ctx, id);
  }

  updateStatus(ctx: TenantContext, id: string, status: UserStatus): UserRecord | null {
    const existing = this.findById(ctx, id);
    if (!existing) {
      return null;
    }
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, now, id);
    return this.findById(ctx, id);
  }

  updateAssignedTenants(
    ctx: TenantContext,
    id: string,
    assignedTenantIds: string[],
  ): UserRecord | null {
    if (!ctx.allTenants) {
      return null;
    }
    const existing = this.findById(ctx, id);
    if (!existing) {
      return null;
    }
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE users SET assigned_tenant_ids_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(assignedTenantIds), now, id);
    return this.findById(ctx, id);
  }

  updatePasswordSystem(userId: string, passwordHash: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE users
         SET password_hash = ?, password_reset_token_hash = NULL, password_reset_expires_at = NULL,
             failed_logins = 0, locked_until = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .run(passwordHash, now, userId);
  }

  setPasswordResetTokenSystem(
    userId: string,
    tokenHash: string | null,
    expiresAt: string | null,
  ): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE users
         SET password_reset_token_hash = ?, password_reset_expires_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(tokenHash, expiresAt, now, userId);
  }

  recordLoginFailureSystem(userId: string, failedLogins: number, lockedUntil: string | null): void {
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE users SET failed_logins = ?, locked_until = ?, updated_at = ? WHERE id = ?')
      .run(failedLogins, lockedUntil, now, userId);
  }

  recordLoginSuccessSystem(userId: string, lastLoginAt: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE users
         SET failed_logins = 0, locked_until = NULL, last_login_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(lastLoginAt, now, userId);
  }

  countActivePlatformAdmins(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'PLATFORM_ADMIN' AND status = 'ACTIVE'")
      .get() as { count: number };
    return row.count;
  }

  countByTenant(): Map<string, { total: number; active: number }> {
    const rows = this.db
      .prepare(
        `SELECT tenant_id,
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) AS active
         FROM users
         WHERE tenant_id IS NOT NULL
         GROUP BY tenant_id`,
      )
      .all() as Array<{ tenant_id: string; total: number; active: number }>;
    const map = new Map<string, { total: number; active: number }>();
    for (const r of rows) {
      map.set(r.tenant_id, { total: r.total, active: r.active });
    }
    return map;
  }

  countGlobal(): { total: number; active: number; providerStaff: number } {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) AS active,
                SUM(CASE WHEN role IN ('SUPPORT_ENGINEER', 'FIELD_TECHNICIAN') THEN 1 ELSE 0 END) AS provider_staff
         FROM users`,
      )
      .get() as { total: number; active: number | null; provider_staff: number | null };
    return {
      total: row.total,
      active: row.active ?? 0,
      providerStaff: row.provider_staff ?? 0,
    };
  }
}
