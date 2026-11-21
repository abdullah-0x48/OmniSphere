import type Database from 'better-sqlite3';
import type { DeviceModel, MetricDefinition } from '../../../shared/types.ts';
import type {
  CreateDeviceModelInput,
  DeviceModelListFilter,
  IDeviceModelRepository,
  UpdateDeviceModelInput,
} from './types.ts';

interface DeviceModelRow {
  id: string;
  name: string;
  manufacturer: string;
  hardware_revision: string;
  metrics_json: string;
  supported_firmware_family: string;
  device_count?: number;
  created_at: string;
  updated_at: string;
}

const SORT_COLUMN_MAP: Record<string, string> = {
  name: 'm.name',
  manufacturer: 'm.manufacturer',
  hardwareRevision: 'm.hardware_revision',
  deviceCount: 'device_count',
  createdAt: 'm.created_at',
};

function mapRow(row: DeviceModelRow): DeviceModel {
  let metrics: MetricDefinition[] = [];
  try {
    const parsed = JSON.parse(row.metrics_json);
    if (Array.isArray(parsed)) {
      metrics = parsed as MetricDefinition[];
    }
  } catch {
    metrics = [];
  }
  return {
    id: row.id,
    name: row.name,
    manufacturer: row.manufacturer,
    hardwareRevision: row.hardware_revision,
    metrics,
    supportedFirmwareFamily: row.supported_firmware_family,
    deviceCount: Number(row.device_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_MODEL_WITH_COUNT = `
  SELECT m.*,
    (SELECT COUNT(*) FROM devices d WHERE d.model_id = m.id) AS device_count
  FROM device_models m
`;

export class SqliteDeviceModelRepository implements IDeviceModelRepository {
  constructor(private readonly db: Database.Database) {}

  list(filter: DeviceModelListFilter): { items: DeviceModel[]; total: number } {
    const conditions: string[] = ['1 = 1'];
    const params: unknown[] = [];

    if (filter.q && filter.q.trim()) {
      const like = `%${filter.q.trim().toLowerCase()}%`;
      conditions.push(
        '(LOWER(m.name) LIKE ? OR LOWER(m.manufacturer) LIKE ? OR LOWER(m.supported_firmware_family) LIKE ?)',
      );
      params.push(like, like, like);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const countRow = this.db
      .prepare(`SELECT COUNT(*) AS total FROM device_models m ${where}`)
      .get(...params) as { total: number };

    const sortCol = SORT_COLUMN_MAP[filter.sortField] ?? 'm.name';
    const sortDir = filter.sortDir === 'desc' ? 'DESC' : 'ASC';
    const offset = (filter.page - 1) * filter.pageSize;

    const rows = this.db
      .prepare(
        `${SELECT_MODEL_WITH_COUNT} ${where} ORDER BY ${sortCol} ${sortDir}, m.name ASC LIMIT ? OFFSET ?`,
      )
      .all(...params, filter.pageSize, offset) as DeviceModelRow[];

    return {
      items: rows.map(mapRow),
      total: countRow.total,
    };
  }

  listAll(): DeviceModel[] {
    const rows = this.db
      .prepare(`${SELECT_MODEL_WITH_COUNT} ORDER BY m.name ASC`)
      .all() as DeviceModelRow[];
    return rows.map(mapRow);
  }

  findById(id: string): DeviceModel | null {
    const row = this.db
      .prepare(`${SELECT_MODEL_WITH_COUNT} WHERE m.id = ?`)
      .get(id) as DeviceModelRow | undefined;
    return row ? mapRow(row) : null;
  }

  findByName(name: string): DeviceModel | null {
    const row = this.db
      .prepare(`${SELECT_MODEL_WITH_COUNT} WHERE LOWER(m.name) = LOWER(?)`)
      .get(name.trim()) as DeviceModelRow | undefined;
    return row ? mapRow(row) : null;
  }

  create(input: CreateDeviceModelInput): DeviceModel {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO device_models (
          id, name, manufacturer, hardware_revision, metrics_json, supported_firmware_family,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.name.trim(),
        input.manufacturer.trim(),
        input.hardwareRevision.trim(),
        JSON.stringify(input.metrics),
        input.supportedFirmwareFamily.trim(),
        now,
        now,
      );

    return this.findById(input.id)!;
  }

  update(id: string, patch: UpdateDeviceModelInput): DeviceModel | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE device_models
         SET name = ?,
             manufacturer = ?,
             hardware_revision = ?,
             metrics_json = ?,
             supported_firmware_family = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(
        patch.name !== undefined ? patch.name.trim() : existing.name,
        patch.manufacturer !== undefined ? patch.manufacturer.trim() : existing.manufacturer,
        patch.hardwareRevision !== undefined
          ? patch.hardwareRevision.trim()
          : existing.hardwareRevision,
        patch.metrics !== undefined ? JSON.stringify(patch.metrics) : JSON.stringify(existing.metrics),
        patch.supportedFirmwareFamily !== undefined
          ? patch.supportedFirmwareFamily.trim()
          : existing.supportedFirmwareFamily,
        now,
        id,
      );

    return this.findById(id);
  }

  countAll(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS total FROM device_models').get() as {
      total: number;
    };
    return row.total;
  }
}
