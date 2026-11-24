import type Database from 'better-sqlite3';
import type {
  DeviceCommandPublic,
  DeviceCommandStatus,
  DeviceCommandType,
} from '../../../shared/types.ts';
import type { CreateDeviceCommandInput, IDeviceCommandRepository, TenantContext } from './types.ts';

interface DeviceCommandRow {
  id: string;
  tenant_id: string;
  device_id: string;
  type: DeviceCommandType;
  payload_json: string;
  status: DeviceCommandStatus;
  created_by: string;
  delivered_at: string | null;
  acked_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(row: DeviceCommandRow): DeviceCommandPublic {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(row.payload_json) as Record<string, unknown>;
  } catch {
    payload = {};
  }
  return {
    id: row.id,
    tenantId: row.tenant_id,
    deviceId: row.device_id,
    type: row.type,
    payload,
    status: row.status,
    createdBy: row.created_by,
    deliveredAt: row.delivered_at,
    ackedAt: row.acked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteDeviceCommandRepository implements IDeviceCommandRepository {
  constructor(private readonly db: Database.Database) {}

  private assertCanWriteTenant(ctx: TenantContext, tenantId: string): void {
    if (ctx.allTenants) return;
    if (!ctx.tenantIds.includes(tenantId)) {
      throw new Error('Tenant isolation violation: attempted cross-tenant command write');
    }
  }

  create(ctx: TenantContext, input: CreateDeviceCommandInput): DeviceCommandPublic {
    this.assertCanWriteTenant(ctx, input.tenantId);
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO device_commands (
          id, tenant_id, device_id, type, payload_json, status,
          created_by, delivered_at, acked_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'PENDING', ?, NULL, NULL, ?, ?)`,
      )
      .run(
        input.id,
        input.tenantId,
        input.deviceId,
        input.type,
        JSON.stringify(input.payload ?? {}),
        input.createdBy,
        now,
        now,
      );

    const row = this.db
      .prepare('SELECT * FROM device_commands WHERE id = ?')
      .get(input.id) as DeviceCommandRow;
    return mapRow(row);
  }

  listByDevice(ctx: TenantContext, deviceId: string, tenantId: string): DeviceCommandPublic[] {
    if (!ctx.allTenants && !ctx.tenantIds.includes(tenantId)) {
      return [];
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM device_commands
         WHERE device_id = ? AND tenant_id = ?
         ORDER BY created_at DESC
         LIMIT 50`,
      )
      .all(deviceId, tenantId) as DeviceCommandRow[];
    return rows.map(mapRow);
  }

  listPendingForDeviceSystem(deviceId: string): DeviceCommandPublic[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM device_commands
         WHERE device_id = ? AND status IN ('PENDING', 'DELIVERED')
         ORDER BY created_at ASC`,
      )
      .all(deviceId) as DeviceCommandRow[];
    return rows.map(mapRow);
  }

  markDeliveredSystem(commandIds: string[], deliveredAt: string): void {
    if (commandIds.length === 0) return;
    const stmt = this.db.prepare(
      `UPDATE device_commands
       SET status = 'DELIVERED', delivered_at = COALESCE(delivered_at, ?), updated_at = ?
       WHERE id = ? AND status = 'PENDING'`,
    );
    const tx = this.db.transaction(() => {
      for (const id of commandIds) {
        stmt.run(deliveredAt, deliveredAt, id);
      }
    });
    tx();
  }

  ackSystem(
    deviceId: string,
    commandId: string,
    status: 'ACKED' | 'FAILED',
    ackedAt: string,
  ): DeviceCommandPublic | null {
    const existing = this.db
      .prepare('SELECT * FROM device_commands WHERE id = ? AND device_id = ?')
      .get(commandId, deviceId) as DeviceCommandRow | undefined;
    if (!existing) return null;

    this.db
      .prepare(
        `UPDATE device_commands
         SET status = ?, acked_at = ?, updated_at = ?
         WHERE id = ? AND device_id = ?`,
      )
      .run(status, ackedAt, ackedAt, commandId, deviceId);

    const updated = this.db
      .prepare('SELECT * FROM device_commands WHERE id = ?')
      .get(commandId) as DeviceCommandRow;
    return mapRow(updated);
  }

  ackPendingApplyConfigSystem(
    deviceId: string,
    status: 'ACKED' | 'FAILED',
    ackedAt: string,
  ): number {
    const res = this.db
      .prepare(
        `UPDATE device_commands
         SET status = ?, acked_at = ?, updated_at = ?
         WHERE device_id = ? AND type = 'APPLY_CONFIG' AND status IN ('PENDING', 'DELIVERED')`,
      )
      .run(status, ackedAt, ackedAt, deviceId);
    return res.changes;
  }

  cancelPendingForDeviceSystem(deviceId: string): number {
    const now = new Date().toISOString();
    const res = this.db
      .prepare(
        `UPDATE device_commands
         SET status = 'FAILED', updated_at = ?
         WHERE device_id = ? AND status IN ('PENDING', 'DELIVERED')`,
      )
      .run(now, deviceId);
    return res.changes;
  }
}
