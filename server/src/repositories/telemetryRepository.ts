import type Database from 'better-sqlite3';
import type { TelemetrySample } from '../../../shared/types.ts';
import type { ITelemetryRepository, TelemetryBucketRecord, TenantContext } from './types.ts';

interface TelemetryBucketRow {
  id: string;
  tenant_id: string;
  device_id: string;
  bucket_start: string;
  samples_json: string;
  updated_at: string;
}

function parseSamples(raw: string): TelemetrySample[] {
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as TelemetrySample[]) : [];
  } catch {
    return [];
  }
}

export class SqliteTelemetryRepository implements ITelemetryRepository {
  constructor(private readonly db: Database.Database) {}

  private assertScope(ctx: TenantContext, tenantId: string): boolean {
    if (ctx.allTenants) return true;
    return ctx.tenantIds.includes(tenantId);
  }

  /**
   * Merges incoming samples into one 10-minute bucket row per device (Section 3.2).
   * Exact duplicate timestamps within the bucket are deduplicated and samples remain sorted by ts.
   */
  upsertBucketSamples(
    bucketId: string,
    tenantId: string,
    deviceId: string,
    bucketStart: string,
    newSamples: TelemetrySample[],
  ): void {
    if (newSamples.length === 0) return;
    const now = new Date().toISOString();

    const tx = this.db.transaction(() => {
      const existing = this.db
        .prepare('SELECT samples_json FROM telemetry_buckets WHERE id = ?')
        .get(bucketId) as { samples_json: string } | undefined;

      if (!existing) {
        const deduped = dedupeAndSort(newSamples);
        this.db
          .prepare(
            `INSERT INTO telemetry_buckets (id, tenant_id, device_id, bucket_start, samples_json, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(bucketId, tenantId, deviceId, bucketStart, JSON.stringify(deduped), now);
        return;
      }

      const merged = dedupeAndSort([...parseSamples(existing.samples_json), ...newSamples]);
      this.db
        .prepare('UPDATE telemetry_buckets SET samples_json = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(merged), now, bucketId);
    });

    tx();
  }

  /**
   * Bulk-writes pre-grouped buckets inside a single transaction (used by seed backfill and flusher).
   */
  bulkUpsertBuckets(
    entries: Array<{
      bucketId: string;
      tenantId: string;
      deviceId: string;
      bucketStart: string;
      samples: TelemetrySample[];
    }>,
  ): void {
    if (entries.length === 0) return;
    const now = new Date().toISOString();
    const selectStmt = this.db.prepare('SELECT samples_json FROM telemetry_buckets WHERE id = ?');
    const insertStmt = this.db.prepare(
      `INSERT INTO telemetry_buckets (id, tenant_id, device_id, bucket_start, samples_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const updateStmt = this.db.prepare(
      'UPDATE telemetry_buckets SET samples_json = ?, updated_at = ? WHERE id = ?',
    );

    const tx = this.db.transaction(() => {
      for (const entry of entries) {
        if (entry.samples.length === 0) continue;
        const existing = selectStmt.get(entry.bucketId) as { samples_json: string } | undefined;
        if (!existing) {
          insertStmt.run(
            entry.bucketId,
            entry.tenantId,
            entry.deviceId,
            entry.bucketStart,
            JSON.stringify(dedupeAndSort(entry.samples)),
            now,
          );
        } else {
          const merged = dedupeAndSort([...parseSamples(existing.samples_json), ...entry.samples]);
          updateStmt.run(JSON.stringify(merged), now, entry.bucketId);
        }
      }
    });

    tx();
  }

  queryBucketsInRange(
    ctx: TenantContext,
    deviceId: string,
    tenantId: string,
    fromIso: string,
    toIso: string,
  ): TelemetryBucketRecord[] {
    if (!this.assertScope(ctx, tenantId)) {
      return [];
    }

    // Shift lower bound back by 10 minutes so a bucket starting just before `fromIso` is still included
    const fromMs = Date.parse(fromIso);
    const bucketFloorIso = Number.isNaN(fromMs)
      ? fromIso
      : new Date(fromMs - 10 * 60_000).toISOString();

    const rows = this.db
      .prepare(
        `SELECT id, tenant_id, device_id, bucket_start, samples_json, updated_at
         FROM telemetry_buckets
         WHERE device_id = ? AND tenant_id = ? AND bucket_start >= ? AND bucket_start <= ?
         ORDER BY bucket_start ASC`,
      )
      .all(deviceId, tenantId, bucketFloorIso, toIso) as TelemetryBucketRow[];

    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      deviceId: r.device_id,
      bucketStart: r.bucket_start,
      samples: parseSamples(r.samples_json),
      updatedAt: r.updated_at,
    }));
  }

  deleteBucketsOlderThan(cutoffIso: string): number {
    const res = this.db
      .prepare('DELETE FROM telemetry_buckets WHERE bucket_start < ?')
      .run(cutoffIso);
    return res.changes;
  }

  countBuckets(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS total FROM telemetry_buckets').get() as {
      total: number;
    };
    return Number(row.total ?? 0);
  }
}

function dedupeAndSort(samples: TelemetrySample[]): TelemetrySample[] {
  const byTs = new Map<string, TelemetrySample>();
  for (const s of samples) {
    if (!byTs.has(s.ts)) {
      byTs.set(s.ts, s);
    }
  }
  return Array.from(byTs.values()).sort((a, b) => a.ts.localeCompare(b.ts));
}
