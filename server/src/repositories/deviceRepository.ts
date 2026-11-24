import type Database from 'better-sqlite3';
import type {
  DeviceConfigState,
  DeviceConnectivity,
  DeviceHealthSnapshot,
  DeviceLifecycleState,
  DevicePublic,
  DeviceStateHistoryItem,
} from '../../../shared/types.ts';
import {
  toDevicePublic,
  type ConnectivityEventRecord,
  type CreateDeviceHistoryInput,
  type CreateDeviceInput,
  type DeviceListFilter,
  type DeviceRecord,
  type IDeviceRepository,
  type TenantContext,
} from './types.ts';

interface DeviceRow {
  id: string;
  tenant_id: string;
  tenant_code?: string;
  tenant_name?: string;
  site_id: string;
  site_name?: string;
  model_id: string;
  model_name?: string;
  name: string;
  serial_number: string;
  hardware_id: string;
  tags_json: string;
  state: DeviceLifecycleState;
  connectivity: DeviceConnectivity;
  last_seen_at: string | null;
  firmware_version: string | null;
  api_key_hash: string | null;
  api_key_last4: string | null;
  config_json: string;
  latest_metrics_json: string;
  latest_health_json: string;
  invalid_payload_count: number;
  decommissioned_at: string | null;
  decommission_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface DeviceHistoryRow {
  id: string;
  tenant_id: string;
  device_id: string;
  from_state: DeviceLifecycleState | null;
  to_state: DeviceLifecycleState;
  reason: string;
  actor_id: string;
  actor_name?: string | null;
  at: string;
}

interface ConnectivityEventRow {
  id: string;
  tenant_id: string;
  device_id: string;
  state: 'ONLINE' | 'OFFLINE';
  at: string;
}

const DEFAULT_CONFIG_STATE: DeviceConfigState = {
  profileId: null,
  version: null,
  status: 'NONE',
  error: null,
};

const SORT_COLUMN_MAP: Record<string, string> = {
  name: 'd.name',
  serialNumber: 'd.serial_number',
  state: 'd.state',
  connectivity: 'd.connectivity',
  firmwareVersion: 'd.firmware_version',
  lastSeenAt: 'd.last_seen_at',
  createdAt: 'd.created_at',
  siteName: 's.name',
  modelName: 'm.name',
};

const SELECT_DEVICE_ENRICHED = `
  SELECT d.*,
         t.code AS tenant_code,
         t.name AS tenant_name,
         s.name AS site_name,
         m.name AS model_name
  FROM devices d
  LEFT JOIN tenants t ON t.id = d.tenant_id
  LEFT JOIN sites s ON s.id = d.site_id
  LEFT JOIN device_models m ON m.id = d.model_id
`;

function parseJsonSafe<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function mapRow(row: DeviceRow): DeviceRecord {
  const tags = parseJsonSafe<string[]>(row.tags_json, []).filter(
    (t): t is string => typeof t === 'string',
  );
  return {
    id: row.id,
    tenantId: row.tenant_id,
    tenantCode: row.tenant_code,
    tenantName: row.tenant_name,
    siteId: row.site_id,
    siteName: row.site_name,
    modelId: row.model_id,
    modelName: row.model_name,
    name: row.name,
    serialNumber: row.serial_number,
    hardwareId: row.hardware_id,
    tags,
    state: row.state,
    connectivity: row.connectivity,
    lastSeenAt: row.last_seen_at,
    firmwareVersion: row.firmware_version,
    apiKeyHash: row.api_key_hash,
    apiKeyLast4: row.api_key_last4,
    config: parseJsonSafe<DeviceConfigState>(row.config_json, DEFAULT_CONFIG_STATE),
    latestMetrics: parseJsonSafe<Record<string, number | boolean | string>>(
      row.latest_metrics_json,
      {},
    ),
    latestHealth: parseJsonSafe<DeviceHealthSnapshot>(row.latest_health_json, {}),
    invalidPayloadCount: Number(row.invalid_payload_count ?? 0),
    decommissionedAt: row.decommissioned_at,
    decommissionReason: row.decommission_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function serialUniqueKey(serialNumber: string): string {
  return `serial:${serialNumber.trim().toUpperCase()}`;
}

export function hardwareUniqueKey(hardwareId: string): string {
  return `hw:${hardwareId.trim().toUpperCase()}`;
}

export class SqliteDeviceRepository implements IDeviceRepository {
  constructor(private readonly db: Database.Database) {}

  private buildScopeClause(
    ctx: TenantContext,
    useActiveTenantForList = false,
  ): { clause: string; params: unknown[] } {
    if (ctx.allTenants) {
      if (useActiveTenantForList && ctx.activeTenantId) {
        return { clause: 'd.tenant_id = ?', params: [ctx.activeTenantId] };
      }
      return { clause: '1 = 1', params: [] };
    }
    if (ctx.tenantIds.length === 0) {
      return { clause: '1 = 0', params: [] };
    }
    if (useActiveTenantForList && ctx.activeTenantId && ctx.tenantIds.includes(ctx.activeTenantId)) {
      return { clause: 'd.tenant_id = ?', params: [ctx.activeTenantId] };
    }
    const placeholders = ctx.tenantIds.map(() => '?').join(', ');
    return {
      clause: `d.tenant_id IN (${placeholders})`,
      params: [...ctx.tenantIds],
    };
  }

  private assertCanWriteTenant(ctx: TenantContext, tenantId: string): void {
    if (ctx.allTenants) return;
    if (!ctx.tenantIds.includes(tenantId)) {
      throw new Error('Tenant isolation violation: attempted cross-tenant device write');
    }
  }

  list(ctx: TenantContext, filter: DeviceListFilter): { items: DevicePublic[]; total: number } {
    const scope = this.buildScopeClause(ctx, true);
    const conditions: string[] = [scope.clause];
    const params: unknown[] = [...scope.params];

    if (filter.q && filter.q.trim()) {
      const like = `%${filter.q.trim().toLowerCase()}%`;
      conditions.push(
        '(LOWER(d.name) LIKE ? OR LOWER(d.serial_number) LIKE ? OR LOWER(d.hardware_id) LIKE ? OR LOWER(d.id) LIKE ?)',
      );
      params.push(like, like, like, like);
    }
    if (filter.siteId) {
      conditions.push('d.site_id = ?');
      params.push(filter.siteId);
    }
    if (filter.modelId) {
      conditions.push('d.model_id = ?');
      params.push(filter.modelId);
    }
    if (filter.state) {
      conditions.push('d.state = ?');
      params.push(filter.state);
    }
    if (filter.connectivity) {
      conditions.push('d.connectivity = ?');
      params.push(filter.connectivity);
    }
    if (filter.firmwareVersion) {
      conditions.push('d.firmware_version = ?');
      params.push(filter.firmwareVersion);
    }
    if (filter.tag && filter.tag.trim()) {
      // Exact tag match via JSON array containment using SQLite json_each
      conditions.push(
        'EXISTS (SELECT 1 FROM json_each(d.tags_json) WHERE LOWER(json_each.value) = LOWER(?))',
      );
      params.push(filter.tag.trim());
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const countRow = this.db
      .prepare(`SELECT COUNT(*) AS total FROM devices d ${where}`)
      .get(...params) as { total: number };

    const sortCol = SORT_COLUMN_MAP[filter.sortField] ?? 'd.name';
    const sortDir = filter.sortDir === 'desc' ? 'DESC' : 'ASC';
    const offset = (filter.page - 1) * filter.pageSize;

    const rows = this.db
      .prepare(
        `${SELECT_DEVICE_ENRICHED} ${where} ORDER BY ${sortCol} ${sortDir}, d.created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, filter.pageSize, offset) as DeviceRow[];

    return {
      items: rows.map((r) => toDevicePublic(mapRow(r))),
      total: countRow.total,
    };
  }

  listDistinctTags(ctx: TenantContext): string[] {
    const scope = this.buildScopeClause(ctx, true);
    const rows = this.db
      .prepare(
        `SELECT DISTINCT json_each.value AS tag
         FROM devices d, json_each(d.tags_json)
         WHERE ${scope.clause}
         ORDER BY LOWER(tag) ASC`,
      )
      .all(...scope.params) as Array<{ tag: string }>;
    return rows.map((r) => r.tag);
  }

  findById(ctx: TenantContext, id: string): DeviceRecord | null {
    const scope = this.buildScopeClause(ctx, false);
    const row = this.db
      .prepare(`${SELECT_DEVICE_ENRICHED} WHERE d.id = ? AND ${scope.clause}`)
      .get(id, ...scope.params) as DeviceRow | undefined;
    return row ? mapRow(row) : null;
  }

  findBySerialSystem(serialNumber: string): { deviceId: string; tenantId: string } | null {
    const row = this.db
      .prepare('SELECT device_id, tenant_id FROM unique_keys WHERE key_id = ?')
      .get(serialUniqueKey(serialNumber)) as { device_id: string; tenant_id: string } | undefined;
    return row ? { deviceId: row.device_id, tenantId: row.tenant_id } : null;
  }

  findByHardwareIdSystem(hardwareId: string): { deviceId: string; tenantId: string } | null {
    const row = this.db
      .prepare('SELECT device_id, tenant_id FROM unique_keys WHERE key_id = ?')
      .get(hardwareUniqueKey(hardwareId)) as { device_id: string; tenant_id: string } | undefined;
    return row ? { deviceId: row.device_id, tenantId: row.tenant_id } : null;
  }

  createWithUniqueKeys(
    ctx: TenantContext,
    input: CreateDeviceInput,
    history: CreateDeviceHistoryInput,
  ): DeviceRecord {
    this.assertCanWriteTenant(ctx, input.tenantId);

    const now = new Date().toISOString();
    const sKey = serialUniqueKey(input.serialNumber);
    const hKey = hardwareUniqueKey(input.hardwareId);

    // Atomic transaction guarantees devices + unique_keys + initial history stay consistent (Section 4)
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO devices (
            id, tenant_id, site_id, model_id, name, serial_number, hardware_id,
            tags_json, state, connectivity, last_seen_at, firmware_version,
            api_key_hash, api_key_last4, config_json, latest_metrics_json,
            latest_health_json, invalid_payload_count, decommissioned_at,
            decommission_reason, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
        )
        .run(
          input.id,
          input.tenantId,
          input.siteId,
          input.modelId,
          input.name.trim(),
          input.serialNumber.trim(),
          input.hardwareId.trim(),
          JSON.stringify(input.tags),
          input.state ?? 'PROVISIONED',
          input.connectivity ?? 'UNKNOWN',
          input.lastSeenAt ?? null,
          input.firmwareVersion ?? null,
          input.apiKeyHash,
          input.apiKeyLast4,
          JSON.stringify(input.config ?? DEFAULT_CONFIG_STATE),
          JSON.stringify(input.latestMetrics ?? {}),
          JSON.stringify(input.latestHealth ?? {}),
          input.decommissionedAt ?? null,
          input.decommissionReason ?? null,
          now,
          now,
        );

      const insertUnique = this.db.prepare(
        'INSERT INTO unique_keys (key_id, device_id, tenant_id, created_at) VALUES (?, ?, ?, ?)',
      );
      insertUnique.run(sKey, input.id, input.tenantId, now);
      insertUnique.run(hKey, input.id, input.tenantId, now);

      this.db
        .prepare(
          `INSERT INTO device_state_history (id, tenant_id, device_id, from_state, to_state, reason, actor_id, at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          history.id,
          history.tenantId,
          history.deviceId,
          history.from,
          history.to,
          history.reason,
          history.actorId,
          history.at,
        );
    });

    tx();
    return this.findById(ctx, input.id)!;
  }

  update(
    ctx: TenantContext,
    id: string,
    patch: { name?: string; siteId?: string; tags?: string[] },
  ): DeviceRecord | null {
    const existing = this.findById(ctx, id);
    if (!existing) return null;

    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE devices
         SET name = ?, site_id = ?, tags_json = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        patch.name !== undefined ? patch.name.trim() : existing.name,
        patch.siteId !== undefined ? patch.siteId : existing.siteId,
        patch.tags !== undefined ? JSON.stringify(patch.tags) : JSON.stringify(existing.tags),
        now,
        id,
      );

    return this.findById(ctx, id);
  }

  updateApiKey(
    ctx: TenantContext,
    id: string,
    apiKeyHash: string | null,
    apiKeyLast4: string | null,
  ): DeviceRecord | null {
    const existing = this.findById(ctx, id);
    if (!existing) return null;

    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE devices SET api_key_hash = ?, api_key_last4 = ?, updated_at = ? WHERE id = ?')
      .run(apiKeyHash, apiKeyLast4, now, id);

    return this.findById(ctx, id);
  }

  transitionState(
    ctx: TenantContext,
    id: string,
    patch: {
      state: DeviceLifecycleState;
      decommissionedAt?: string | null;
      decommissionReason?: string | null;
      revokeKey?: boolean;
    },
    history: CreateDeviceHistoryInput,
  ): DeviceRecord | null {
    const existing = this.findById(ctx, id);
    if (!existing) return null;

    const now = new Date().toISOString();
    const tx = this.db.transaction(() => {
      if (patch.revokeKey) {
        this.db
          .prepare(
            `UPDATE devices
             SET state = ?,
                 connectivity = 'OFFLINE',
                 api_key_hash = NULL,
                 api_key_last4 = NULL,
                 decommissioned_at = ?,
                 decommission_reason = ?,
                 updated_at = ?
             WHERE id = ?`,
          )
          .run(
            patch.state,
            patch.decommissionedAt ?? now,
            patch.decommissionReason ?? null,
            now,
            id,
          );
        this.db.prepare('DELETE FROM simulator_credentials WHERE device_id = ?').run(id);
      } else {
        this.db
          .prepare('UPDATE devices SET state = ?, updated_at = ? WHERE id = ?')
          .run(patch.state, now, id);
      }

      this.db
        .prepare(
          `INSERT INTO device_state_history (id, tenant_id, device_id, from_state, to_state, reason, actor_id, at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          history.id,
          history.tenantId,
          history.deviceId,
          history.from,
          history.to,
          history.reason,
          history.actorId,
          history.at,
        );
    });

    tx();
    return this.findById(ctx, id);
  }

  listStateHistory(ctx: TenantContext, deviceId: string): DeviceStateHistoryItem[] {
    const device = this.findById(ctx, deviceId);
    if (!device) return [];

    const rows = this.db
      .prepare(
        `SELECT h.*, u.name AS actor_name
         FROM device_state_history h
         LEFT JOIN users u ON u.id = h.actor_id
         WHERE h.device_id = ? AND h.tenant_id = ?
         ORDER BY h.at DESC`,
      )
      .all(deviceId, device.tenantId) as DeviceHistoryRow[];

    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      deviceId: r.device_id,
      from: r.from_state,
      to: r.to_state,
      reason: r.reason,
      actorId: r.actor_id,
      actorName: r.actor_name ?? (r.actor_id === 'SYSTEM' ? 'System' : null),
      at: r.at,
    }));
  }

  listConnectivityEvents(ctx: TenantContext, deviceId: string): ConnectivityEventRecord[] {
    const device = this.findById(ctx, deviceId);
    if (!device) return [];

    const rows = this.db
      .prepare(
        `SELECT id, tenant_id, device_id, state, at
         FROM connectivity_events
         WHERE device_id = ? AND tenant_id = ?
         ORDER BY at DESC
         LIMIT 200`,
      )
      .all(deviceId, device.tenantId) as ConnectivityEventRow[];

    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      deviceId: r.device_id,
      state: r.state,
      at: r.at,
    }));
  }

  insertConnectivityEvent(input: ConnectivityEventRecord): void {
    this.db
      .prepare(
        `INSERT INTO connectivity_events (id, tenant_id, device_id, state, at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(input.id, input.tenantId, input.deviceId, input.state, input.at);
  }

  setSimulatorCredential(deviceId: string, tenantId: string, apiKey: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO simulator_credentials (device_id, tenant_id, api_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(device_id) DO UPDATE SET api_key = excluded.api_key, updated_at = excluded.updated_at`,
      )
      .run(deviceId, tenantId, apiKey, now, now);
  }

  deleteSimulatorCredential(deviceId: string): void {
    this.db.prepare('DELETE FROM simulator_credentials WHERE device_id = ?').run(deviceId);
  }

  listSimulatorCredentialsSystem(tenantIds?: string[] | null): Array<{
    deviceId: string;
    tenantId: string;
    apiKey: string;
    createdAt: string;
    updatedAt: string;
  }> {
    let rows: Array<{
      device_id: string;
      tenant_id: string;
      api_key: string;
      created_at: string;
      updated_at: string;
    }>;

    if (tenantIds === undefined || tenantIds === null) {
      rows = this.db
        .prepare('SELECT device_id, tenant_id, api_key, created_at, updated_at FROM simulator_credentials ORDER BY created_at ASC')
        .all() as typeof rows;
    } else if (tenantIds.length === 0) {
      return [];
    } else {
      const placeholders = tenantIds.map(() => '?').join(', ');
      rows = this.db
        .prepare(
          `SELECT device_id, tenant_id, api_key, created_at, updated_at
           FROM simulator_credentials
           WHERE tenant_id IN (${placeholders})
           ORDER BY created_at ASC`,
        )
        .all(...tenantIds) as typeof rows;
    }

    return rows.map((r) => ({
      deviceId: r.device_id,
      tenantId: r.tenant_id,
      apiKey: r.api_key,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  findByIdSystem(id: string): DeviceRecord | null {
    const row = this.db
      .prepare(`${SELECT_DEVICE_ENRICHED} WHERE d.id = ?`)
      .get(id) as DeviceRow | undefined;
    return row ? mapRow(row) : null;
  }

  listAllSystem(): DeviceRecord[] {
    const rows = this.db
      .prepare(`${SELECT_DEVICE_ENRICHED} ORDER BY d.created_at ASC`)
      .all() as DeviceRow[];
    return rows.map(mapRow);
  }

  listAllInScope(ctx: TenantContext, useActiveTenant = true): DevicePublic[] {
    const scope = this.buildScopeClause(ctx, useActiveTenant);
    const rows = this.db
      .prepare(`${SELECT_DEVICE_ENRICHED} WHERE ${scope.clause} ORDER BY d.name ASC`)
      .all(...scope.params) as DeviceRow[];
    return rows.map((r) => toDevicePublic(mapRow(r)));
  }

  activateFromHandshakeSystem(
    deviceId: string,
    patch: { firmwareVersion: string; lastSeenAt: string },
    history?: CreateDeviceHistoryInput | null,
  ): DeviceRecord | null {
    const existing = this.findByIdSystem(deviceId);
    if (!existing) return null;

    const now = new Date().toISOString();
    const nextState: DeviceLifecycleState =
      existing.state === 'PROVISIONED' ? 'ACTIVE' : existing.state;

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE devices
           SET state = ?,
               connectivity = 'ONLINE',
               firmware_version = ?,
               last_seen_at = ?,
               updated_at = ?
           WHERE id = ?`,
        )
        .run(nextState, patch.firmwareVersion, patch.lastSeenAt, now, deviceId);

      if (history) {
        this.db
          .prepare(
            `INSERT INTO device_state_history (id, tenant_id, device_id, from_state, to_state, reason, actor_id, at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            history.id,
            history.tenantId,
            history.deviceId,
            history.from,
            history.to,
            history.reason,
            history.actorId,
            history.at,
          );
      }
    });

    tx();
    return this.findByIdSystem(deviceId);
  }

  updateConnectivitySystem(
    deviceId: string,
    connectivity: DeviceConnectivity,
    lastSeenAt?: string | null,
  ): void {
    const now = new Date().toISOString();
    if (lastSeenAt !== undefined) {
      this.db
        .prepare(
          `UPDATE devices SET connectivity = ?, last_seen_at = ?, updated_at = ? WHERE id = ?`,
        )
        .run(connectivity, lastSeenAt, now, deviceId);
    } else {
      this.db
        .prepare(`UPDATE devices SET connectivity = ?, updated_at = ? WHERE id = ?`)
        .run(connectivity, now, deviceId);
    }
  }

  updateDebouncedLiveSnapshotSystem(
    deviceId: string,
    patch: {
      lastSeenAt: string | null;
      latestMetrics: Record<string, number | boolean | string>;
      latestHealth: DeviceHealthSnapshot;
    },
  ): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE devices
         SET last_seen_at = COALESCE(?, last_seen_at),
             latest_metrics_json = ?,
             latest_health_json = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(
        patch.lastSeenAt,
        JSON.stringify(patch.latestMetrics),
        JSON.stringify(patch.latestHealth),
        now,
        deviceId,
      );
  }

  incrementInvalidPayloadCountSystem(deviceId: string): number {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE devices
         SET invalid_payload_count = invalid_payload_count + 1, updated_at = ?
         WHERE id = ?`,
      )
      .run(now, deviceId);
    const row = this.db
      .prepare('SELECT invalid_payload_count FROM devices WHERE id = ?')
      .get(deviceId) as { invalid_payload_count: number } | undefined;
    return Number(row?.invalid_payload_count ?? 0);
  }

  updateConfigStatusSystem(
    deviceId: string,
    patch: { version: number; status: 'APPLIED' | 'FAILED'; error: string | null },
  ): DeviceRecord | null {
    const existing = this.findByIdSystem(deviceId);
    if (!existing) return null;

    const nextConfig: DeviceConfigState = {
      ...existing.config,
      version: patch.version,
      status: patch.status,
      error: patch.error,
    };
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE devices SET config_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(nextConfig), now, deviceId);
    return this.findByIdSystem(deviceId);
  }

  assignConfigSystem(deviceId: string, config: DeviceConfigState): DeviceRecord | null {
    const existing = this.findByIdSystem(deviceId);
    if (!existing) return null;
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE devices SET config_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(config), now, deviceId);
    return this.findByIdSystem(deviceId);
  }

  updateFirmwareVersionSystem(deviceId: string, firmwareVersion: string): DeviceRecord | null {
    const existing = this.findByIdSystem(deviceId);
    if (!existing) return null;
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE devices SET firmware_version = ?, updated_at = ? WHERE id = ?')
      .run(firmwareVersion.trim(), now, deviceId);
    return this.findByIdSystem(deviceId);
  }

  listDistinctModelIdsInTenantSystem(tenantId: string): string[] {
    const rows = this.db
      .prepare('SELECT DISTINCT model_id FROM devices WHERE tenant_id = ?')
      .all(tenantId) as Array<{ model_id: string }>;
    return rows.map((r) => r.model_id);
  }

  countByTenant(): Map<string, { total: number; online: number; active: number }> {
    const rows = this.db
      .prepare(
        `SELECT tenant_id,
                COUNT(*) AS total,
                SUM(CASE WHEN connectivity = 'ONLINE' THEN 1 ELSE 0 END) AS online,
                SUM(CASE WHEN state = 'ACTIVE' THEN 1 ELSE 0 END) AS active
         FROM devices
         GROUP BY tenant_id`,
      )
      .all() as Array<{ tenant_id: string; total: number; online: number; active: number }>;

    const map = new Map<string, { total: number; online: number; active: number }>();
    for (const r of rows) {
      map.set(r.tenant_id, {
        total: Number(r.total ?? 0),
        online: Number(r.online ?? 0),
        active: Number(r.active ?? 0),
      });
    }
    return map;
  }

  countByStateGlobal(): Record<DeviceLifecycleState, number> {
    const result: Record<DeviceLifecycleState, number> = {
      PROVISIONED: 0,
      ACTIVE: 0,
      UNDER_MAINTENANCE: 0,
      SUSPENDED: 0,
      DECOMMISSIONED: 0,
    };
    const rows = this.db
      .prepare('SELECT state, COUNT(*) AS total FROM devices GROUP BY state')
      .all() as Array<{ state: DeviceLifecycleState; total: number }>;
    for (const r of rows) {
      if (r.state in result) {
        result[r.state] = Number(r.total ?? 0);
      }
    }
    return result;
  }

  countDevicesInSite(siteId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS total FROM devices WHERE site_id = ?')
      .get(siteId) as { total: number };
    return Number(row.total ?? 0);
  }
}
