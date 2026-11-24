import type Database from 'better-sqlite3';
import type { FirmwarePackagePublic, FirmwareStatus } from '../../../shared/types.ts';
import {
  toFirmwarePublic,
  type CreateFirmwareInput,
  type FirmwareListFilter,
  type FirmwareRecord,
  type IFirmwareRepository,
} from './types.ts';

interface FirmwareRow {
  id: string;
  model_id: string;
  model_name?: string;
  version: string;
  release_notes: string;
  checksum_sha256: string;
  size_bytes: number;
  file_ref: string;
  status: FirmwareStatus;
  uploaded_by: string;
  uploaded_by_name?: string | null;
  created_at: string;
  updated_at: string;
}

const SELECT_FIRMWARE_ENRICHED = `
  SELECT f.*,
         m.name AS model_name,
         u.name AS uploaded_by_name
  FROM firmware_packages f
  LEFT JOIN device_models m ON m.id = f.model_id
  LEFT JOIN users u ON u.id = f.uploaded_by
`;

function mapRow(row: FirmwareRow): FirmwareRecord {
  return {
    id: row.id,
    modelId: row.model_id,
    modelName: row.model_name,
    version: row.version,
    releaseNotes: row.release_notes,
    checksumSha256: row.checksum_sha256,
    sizeBytes: Number(row.size_bytes),
    fileRef: row.file_ref,
    status: row.status,
    uploadedBy: row.uploaded_by,
    uploadedByName: row.uploaded_by_name ?? (row.uploaded_by === 'SYSTEM' ? 'System' : null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteFirmwareRepository implements IFirmwareRepository {
  constructor(private readonly db: Database.Database) {}

  list(filter: FirmwareListFilter): { items: FirmwarePackagePublic[]; total: number } {
    const conditions: string[] = ['1 = 1'];
    const params: unknown[] = [];

    if (filter.onlyReleased) {
      conditions.push(`f.status = 'RELEASED'`);
    } else if (filter.status) {
      conditions.push('f.status = ?');
      params.push(filter.status);
    }

    if (filter.allowedModelIds !== undefined && filter.allowedModelIds !== null) {
      if (filter.allowedModelIds.length === 0) {
        return { items: [], total: 0 };
      }
      const placeholders = filter.allowedModelIds.map(() => '?').join(', ');
      conditions.push(`f.model_id IN (${placeholders})`);
      params.push(...filter.allowedModelIds);
    }

    if (filter.modelId) {
      conditions.push('f.model_id = ?');
      params.push(filter.modelId);
    }

    if (filter.q && filter.q.trim()) {
      const like = `%${filter.q.trim().toLowerCase()}%`;
      conditions.push(
        '(LOWER(f.version) LIKE ? OR LOWER(f.release_notes) LIKE ? OR LOWER(m.name) LIKE ?)',
      );
      params.push(like, like, like);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const countRow = this.db
      .prepare(
        `SELECT COUNT(*) AS total
         FROM firmware_packages f
         LEFT JOIN device_models m ON m.id = f.model_id
         ${where}`,
      )
      .get(...params) as { total: number };

    const offset = (filter.page - 1) * filter.pageSize;
    const rows = this.db
      .prepare(
        `${SELECT_FIRMWARE_ENRICHED}
         ${where}
         ORDER BY f.created_at DESC, m.name ASC, f.version DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, filter.pageSize, offset) as FirmwareRow[];

    return {
      items: rows.map((r) => toFirmwarePublic(mapRow(r))),
      total: Number(countRow.total ?? 0),
    };
  }

  findById(id: string): FirmwareRecord | null {
    const row = this.db
      .prepare(`${SELECT_FIRMWARE_ENRICHED} WHERE f.id = ?`)
      .get(id) as FirmwareRow | undefined;
    return row ? mapRow(row) : null;
  }

  findByModelAndVersion(modelId: string, version: string): FirmwareRecord | null {
    const row = this.db
      .prepare(`${SELECT_FIRMWARE_ENRICHED} WHERE f.model_id = ? AND f.version = ?`)
      .get(modelId, version.trim()) as FirmwareRow | undefined;
    return row ? mapRow(row) : null;
  }

  create(input: CreateFirmwareInput): FirmwareRecord {
    const now = input.createdAt ?? new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO firmware_packages (
          id, model_id, version, release_notes, checksum_sha256,
          size_bytes, file_ref, status, uploaded_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.modelId,
        input.version.trim(),
        input.releaseNotes.trim(),
        input.checksumSha256.toLowerCase(),
        input.sizeBytes,
        input.fileRef,
        input.status ?? 'DRAFT',
        input.uploadedBy,
        now,
        now,
      );
    return this.findById(input.id)!;
  }

  updateStatus(id: string, status: FirmwareStatus): FirmwareRecord | null {
    const existing = this.findById(id);
    if (!existing) return null;
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE firmware_packages SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, now, id);
    return this.findById(id);
  }
}
