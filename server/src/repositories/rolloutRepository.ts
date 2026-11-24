import type Database from 'better-sqlite3';
import type {
  FirmwareStatus,
  RolloutCounts,
  RolloutJobPublic,
  RolloutJobStatus,
  RolloutPublic,
  RolloutStatus,
  RolloutTargetType,
} from '../../../shared/types.ts';
import type {
  CreateRolloutInput,
  CreateRolloutJobInput,
  FirmwareRecord,
  IRolloutRepository,
  RolloutListFilter,
  TenantContext,
} from './types.ts';

interface RolloutRow {
  id: string;
  tenant_id: string;
  tenant_code?: string;
  tenant_name?: string;
  firmware_id: string;
  firmware_version?: string;
  model_id: string;
  model_name?: string;
  target_type: RolloutTargetType;
  target_value: string;
  scheduled_at: string | null;
  status: RolloutStatus;
  created_by: string;
  created_by_name?: string | null;
  decided_by: string | null;
  decided_by_name?: string | null;
  decision_reason: string | null;
  counts_json: string;
  created_at: string;
  updated_at: string;
}

interface RolloutJobRow {
  id: string;
  tenant_id: string;
  rollout_id: string;
  device_id: string;
  device_name?: string;
  device_serial?: string;
  from_version: string | null;
  to_version: string;
  status: RolloutJobStatus;
  error_code: string | null;
  created_at: string;
  updated_at: string;
}

const SELECT_ROLLOUT_ENRICHED = `
  SELECT r.*,
         t.code AS tenant_code,
         t.name AS tenant_name,
         f.version AS firmware_version,
         m.name AS model_name,
         uc.name AS created_by_name,
         ud.name AS decided_by_name
  FROM rollouts r
  LEFT JOIN tenants t ON t.id = r.tenant_id
  LEFT JOIN firmware_packages f ON f.id = r.firmware_id
  LEFT JOIN device_models m ON m.id = r.model_id
  LEFT JOIN users uc ON uc.id = r.created_by
  LEFT JOIN users ud ON ud.id = r.decided_by
`;

const SELECT_JOB_ENRICHED = `
  SELECT j.*,
         d.name AS device_name,
         d.serial_number AS device_serial
  FROM rollout_jobs j
  LEFT JOIN devices d ON d.id = j.device_id
`;

function parseCounts(raw: string): RolloutCounts {
  try {
    const parsed = JSON.parse(raw) as Partial<RolloutCounts>;
    return {
      total: Number(parsed.total ?? 0),
      verified: Number(parsed.verified ?? 0),
      failed: Number(parsed.failed ?? 0),
      cancelled: Number(parsed.cancelled ?? 0),
    };
  } catch {
    return { total: 0, verified: 0, failed: 0, cancelled: 0 };
  }
}

function mapRolloutRow(row: RolloutRow): RolloutPublic {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    tenantCode: row.tenant_code,
    tenantName: row.tenant_name,
    firmwareId: row.firmware_id,
    firmwareVersion: row.firmware_version,
    modelId: row.model_id,
    modelName: row.model_name,
    targetType: row.target_type,
    targetValue: row.target_value,
    scheduledAt: row.scheduled_at,
    status: row.status,
    createdBy: row.created_by,
    createdByName: row.created_by_name ?? (row.created_by === 'SYSTEM' ? 'System' : null),
    decidedBy: row.decided_by,
    decidedByName: row.decided_by_name ?? (row.decided_by === 'SYSTEM' ? 'System' : null),
    decisionReason: row.decision_reason,
    counts: parseCounts(row.counts_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapJobRow(row: RolloutJobRow): RolloutJobPublic {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    rolloutId: row.rollout_id,
    deviceId: row.device_id,
    deviceName: row.device_name,
    deviceSerial: row.device_serial,
    fromVersion: row.from_version,
    toVersion: row.to_version,
    status: row.status,
    errorCode: row.error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteRolloutRepository implements IRolloutRepository {
  constructor(private readonly db: Database.Database) {}

  private buildScopeClause(
    ctx: TenantContext,
    useActiveTenant = false,
  ): { clause: string; params: unknown[] } {
    if (ctx.allTenants) {
      if (useActiveTenant && ctx.activeTenantId) {
        return { clause: 'r.tenant_id = ?', params: [ctx.activeTenantId] };
      }
      return { clause: '1 = 1', params: [] };
    }
    if (ctx.tenantIds.length === 0) {
      return { clause: '1 = 0', params: [] };
    }
    if (useActiveTenant && ctx.activeTenantId && ctx.tenantIds.includes(ctx.activeTenantId)) {
      return { clause: 'r.tenant_id = ?', params: [ctx.activeTenantId] };
    }
    const placeholders = ctx.tenantIds.map(() => '?').join(', ');
    return {
      clause: `r.tenant_id IN (${placeholders})`,
      params: [...ctx.tenantIds],
    };
  }

  private assertCanWriteTenant(ctx: TenantContext, tenantId: string): void {
    if (ctx.allTenants) return;
    if (!ctx.tenantIds.includes(tenantId)) {
      throw new Error('Tenant isolation violation: attempted cross-tenant rollout write');
    }
  }

  list(
    ctx: TenantContext,
    filter: RolloutListFilter,
    useActiveTenant = true,
  ): { items: RolloutPublic[]; total: number } {
    const scope = this.buildScopeClause(ctx, useActiveTenant);
    const conditions: string[] = [scope.clause];
    const params: unknown[] = [...scope.params];

    if (filter.status) {
      conditions.push('r.status = ?');
      params.push(filter.status);
    }
    if (filter.modelId) {
      conditions.push('r.model_id = ?');
      params.push(filter.modelId);
    }
    if (filter.q && filter.q.trim()) {
      const like = `%${filter.q.trim().toLowerCase()}%`;
      conditions.push(
        '(LOWER(r.id) LIKE ? OR LOWER(f.version) LIKE ? OR LOWER(m.name) LIKE ? OR LOWER(r.target_value) LIKE ?)',
      );
      params.push(like, like, like, like);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const countRow = this.db
      .prepare(
        `SELECT COUNT(*) AS total
         FROM rollouts r
         LEFT JOIN firmware_packages f ON f.id = r.firmware_id
         LEFT JOIN device_models m ON m.id = r.model_id
         ${where}`,
      )
      .get(...params) as { total: number };

    const offset = (filter.page - 1) * filter.pageSize;
    const rows = this.db
      .prepare(
        `${SELECT_ROLLOUT_ENRICHED}
         ${where}
         ORDER BY r.created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, filter.pageSize, offset) as RolloutRow[];

    return {
      items: rows.map(mapRolloutRow),
      total: Number(countRow.total ?? 0),
    };
  }

  findById(ctx: TenantContext, id: string): RolloutPublic | null {
    const scope = this.buildScopeClause(ctx, false);
    const row = this.db
      .prepare(`${SELECT_ROLLOUT_ENRICHED} WHERE r.id = ? AND ${scope.clause}`)
      .get(id, ...scope.params) as RolloutRow | undefined;
    return row ? mapRolloutRow(row) : null;
  }

  findByIdSystem(id: string): RolloutPublic | null {
    const row = this.db
      .prepare(`${SELECT_ROLLOUT_ENRICHED} WHERE r.id = ?`)
      .get(id) as RolloutRow | undefined;
    return row ? mapRolloutRow(row) : null;
  }

  createWithJobs(
    ctx: TenantContext,
    rollout: CreateRolloutInput,
    jobs: CreateRolloutJobInput[],
  ): { rollout: RolloutPublic; jobs: RolloutJobPublic[] } {
    this.assertCanWriteTenant(ctx, rollout.tenantId);
    return this.createWithJobsSystem(rollout, jobs);
  }

  createWithJobsSystem(
    rollout: CreateRolloutInput,
    jobs: CreateRolloutJobInput[],
  ): { rollout: RolloutPublic; jobs: RolloutJobPublic[] } {
    const now = rollout.createdAt ?? new Date().toISOString();
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO rollouts (
            id, tenant_id, firmware_id, model_id, target_type, target_value,
            scheduled_at, status, created_by, decided_by, decision_reason,
            counts_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          rollout.id,
          rollout.tenantId,
          rollout.firmwareId,
          rollout.modelId,
          rollout.targetType,
          rollout.targetValue,
          rollout.scheduledAt,
          rollout.status,
          rollout.createdBy,
          rollout.decidedBy ?? null,
          rollout.decisionReason ?? null,
          JSON.stringify(rollout.counts),
          now,
          now,
        );

      const insertJob = this.db.prepare(
        `INSERT INTO rollout_jobs (
          id, tenant_id, rollout_id, device_id, from_version, to_version,
          status, error_code, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const j of jobs) {
        const jNow = j.createdAt ?? now;
        insertJob.run(
          j.id,
          j.tenantId,
          j.rolloutId,
          j.deviceId,
          j.fromVersion,
          j.toVersion,
          j.status ?? 'QUEUED',
          j.errorCode ?? null,
          jNow,
          jNow,
        );
      }
    });

    tx();
    return {
      rollout: this.findByIdSystem(rollout.id)!,
      jobs: this.listJobsByRolloutSystem(rollout.id),
    };
  }

  updateStatusAndDecision(
    id: string,
    patch: {
      status: RolloutStatus;
      decidedBy?: string | null;
      decisionReason?: string | null;
      counts?: RolloutCounts;
    },
  ): RolloutPublic | null {
    const existing = this.findByIdSystem(id);
    if (!existing) return null;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE rollouts
         SET status = ?,
             decided_by = ?,
             decision_reason = ?,
             counts_json = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(
        patch.status,
        patch.decidedBy !== undefined ? patch.decidedBy : existing.decidedBy,
        patch.decisionReason !== undefined ? patch.decisionReason : existing.decisionReason,
        JSON.stringify(patch.counts ?? existing.counts),
        now,
        id,
      );
    return this.findByIdSystem(id);
  }

  updateCountsSystem(
    id: string,
    counts: RolloutCounts,
    nextStatus?: RolloutStatus,
  ): RolloutPublic | null {
    const existing = this.findByIdSystem(id);
    if (!existing) return null;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE rollouts
         SET counts_json = ?, status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(JSON.stringify(counts), nextStatus ?? existing.status, now, id);
    return this.findByIdSystem(id);
  }

  listJobsByRollout(ctx: TenantContext, rolloutId: string): RolloutJobPublic[] {
    const rollout = this.findById(ctx, rolloutId);
    if (!rollout) return [];
    return this.listJobsByRolloutSystem(rolloutId);
  }

  listJobsByRolloutSystem(rolloutId: string): RolloutJobPublic[] {
    const rows = this.db
      .prepare(
        `${SELECT_JOB_ENRICHED}
         WHERE j.rollout_id = ?
         ORDER BY d.name ASC, j.created_at ASC`,
      )
      .all(rolloutId) as RolloutJobRow[];
    return rows.map(mapJobRow);
  }

  listJobsByDevice(ctx: TenantContext, deviceId: string, limit = 50): RolloutJobPublic[] {
    const params: unknown[] = [deviceId];
    let scopeSql = '1 = 1';
    if (!ctx.allTenants) {
      if (ctx.tenantIds.length === 0) return [];
      scopeSql = `j.tenant_id IN (${ctx.tenantIds.map(() => '?').join(', ')})`;
      params.push(...ctx.tenantIds);
    }
    const rows = this.db
      .prepare(
        `${SELECT_JOB_ENRICHED}
         WHERE j.device_id = ? AND ${scopeSql}
         ORDER BY j.created_at DESC
         LIMIT ?`,
      )
      .all(...params, limit) as RolloutJobRow[];
    return rows.map(mapJobRow);
  }

  findJobByIdSystem(jobId: string): RolloutJobPublic | null {
    const row = this.db
      .prepare(`${SELECT_JOB_ENRICHED} WHERE j.id = ?`)
      .get(jobId) as RolloutJobRow | undefined;
    return row ? mapJobRow(row) : null;
  }

  findDevicesWithActiveJobsInTenantSystem(tenantId: string): Set<string> {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT j.device_id
         FROM rollout_jobs j
         INNER JOIN rollouts r ON r.id = j.rollout_id
         WHERE j.tenant_id = ?
           AND j.status IN ('QUEUED', 'DOWNLOADING', 'INSTALLING')
           AND r.status IN ('PENDING_APPROVAL', 'PENDING', 'RUNNING')`,
      )
      .all(tenantId) as Array<{ device_id: string }>;
    return new Set(rows.map((r) => r.device_id));
  }

  findQueuedJobForRunningRolloutSystem(deviceId: string): {
    job: RolloutJobPublic;
    rollout: RolloutPublic;
    firmware: FirmwareRecord;
  } | null {
    const row = this.db
      .prepare(
        `SELECT j.id AS job_id, r.id AS rollout_id, f.id AS firmware_id,
                f.model_id, f.version, f.release_notes, f.checksum_sha256,
                f.size_bytes, f.file_ref, f.status AS fw_status,
                f.uploaded_by, f.created_at AS fw_created_at, f.updated_at AS fw_updated_at
         FROM rollout_jobs j
         INNER JOIN rollouts r ON r.id = j.rollout_id
         INNER JOIN firmware_packages f ON f.id = r.firmware_id
         WHERE j.device_id = ?
           AND j.status = 'QUEUED'
           AND r.status = 'RUNNING'
         ORDER BY j.created_at ASC
         LIMIT 1`,
      )
      .get(deviceId) as
      | {
          job_id: string;
          rollout_id: string;
          firmware_id: string;
          model_id: string;
          version: string;
          release_notes: string;
          checksum_sha256: string;
          size_bytes: number;
          file_ref: string;
          fw_status: FirmwareStatus;
          uploaded_by: string;
          fw_created_at: string;
          fw_updated_at: string;
        }
      | undefined;

    if (!row) return null;
    const job = this.findJobByIdSystem(row.job_id);
    const rollout = this.findByIdSystem(row.rollout_id);
    if (!job || !rollout) return null;

    return {
      job,
      rollout,
      firmware: {
        id: row.firmware_id,
        modelId: row.model_id,
        version: row.version,
        releaseNotes: row.release_notes,
        checksumSha256: row.checksum_sha256,
        sizeBytes: Number(row.size_bytes),
        fileRef: row.file_ref,
        status: row.fw_status,
        uploadedBy: row.uploaded_by,
        createdAt: row.fw_created_at,
        updatedAt: row.fw_updated_at,
      },
    };
  }

  findActiveJobForDeviceAndFirmwareSystem(
    deviceId: string,
    firmwareId: string,
  ): { job: RolloutJobPublic; rollout: RolloutPublic } | null {
    const row = this.db
      .prepare(
        `SELECT j.id AS job_id, r.id AS rollout_id
         FROM rollout_jobs j
         INNER JOIN rollouts r ON r.id = j.rollout_id
         WHERE j.device_id = ?
           AND r.firmware_id = ?
           AND (
             (j.status = 'QUEUED' AND r.status = 'RUNNING')
             OR (j.status IN ('DOWNLOADING', 'INSTALLING') AND r.status IN ('RUNNING', 'CANCELLED'))
           )
         ORDER BY j.created_at DESC
         LIMIT 1`,
      )
      .get(deviceId, firmwareId) as { job_id: string; rollout_id: string } | undefined;

    if (!row) return null;
    const job = this.findJobByIdSystem(row.job_id);
    const rollout = this.findByIdSystem(row.rollout_id);
    if (!job || !rollout) return null;
    return { job, rollout };
  }

  updateJobStatusSystem(
    jobId: string,
    status: RolloutJobStatus,
    errorCode?: string | null,
  ): RolloutJobPublic | null {
    const existing = this.findJobByIdSystem(jobId);
    if (!existing) return null;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE rollout_jobs
         SET status = ?, error_code = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(status, errorCode !== undefined ? errorCode : existing.errorCode, now, jobId);
    return this.findJobByIdSystem(jobId);
  }

  cancelQueuedJobsForRolloutSystem(rolloutId: string): number {
    const now = new Date().toISOString();
    const res = this.db
      .prepare(
        `UPDATE rollout_jobs
         SET status = 'CANCELLED', updated_at = ?
         WHERE rollout_id = ? AND status = 'QUEUED'`,
      )
      .run(now, rolloutId);
    return res.changes;
  }

  cancelQueuedJobsForDeviceSystem(deviceId: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT rollout_id
         FROM rollout_jobs
         WHERE device_id = ? AND status = 'QUEUED'`,
      )
      .all(deviceId) as Array<{ rollout_id: string }>;

    if (rows.length === 0) return [];
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE rollout_jobs
         SET status = 'CANCELLED', updated_at = ?
         WHERE device_id = ? AND status = 'QUEUED'`,
      )
      .run(now, deviceId);

    return rows.map((r) => r.rollout_id);
  }

  listDuePendingRolloutsSystem(nowIso: string): RolloutPublic[] {
    const rows = this.db
      .prepare(
        `${SELECT_ROLLOUT_ENRICHED}
         WHERE r.status = 'PENDING'
           AND (r.scheduled_at IS NULL OR r.scheduled_at <= ?)
         ORDER BY r.created_at ASC`,
      )
      .all(nowIso) as RolloutRow[];
    return rows.map(mapRolloutRow);
  }

  countPendingApprovalsByTenant(tenantId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS total
         FROM rollouts
         WHERE tenant_id = ? AND status = 'PENDING_APPROVAL'`,
      )
      .get(tenantId) as { total: number };
    return Number(row.total ?? 0);
  }
}
