import type {
  DeviceConnectivity,
  DeviceHealthSnapshot,
  DeviceLifecycleState,
  DeviceLiveState,
  DevicePublic,
  TelemetrySample,
} from '../../../shared/types.ts';
import type { Repositories } from '../repositories/index.ts';
import { getTelemetryBucketKey } from './telemetryValidation.ts';

/**
 * Section 8.4 Evaluation Hook — Milestone 4 plugs its AlertEvaluationService in here
 * without altering Milestone 3 ingestion or offline detection code.
 */
export interface AlertEvaluationHook {
  onTelemetryOrHeartbeat(event: {
    tenantId: string;
    deviceId: string;
    modelId: string;
    siteId: string;
    state: DeviceLifecycleState;
    timestamp: string;
    metrics: Record<string, number | boolean | string>;
    health: DeviceHealthSnapshot;
  }): void | Promise<void>;

  onDeviceOffline(event: {
    tenantId: string;
    deviceId: string;
    modelId: string;
    siteId: string;
    state: DeviceLifecycleState;
    lastSeenAt: string | null;
    detectedAt: string;
  }): void | Promise<void>;
}

interface DeviceRuntimeMeta {
  live: DeviceLiveState;
  recentSampleTimestamps: Set<string>;
  dirtySnapshot: boolean;
}

/**
 * In-memory LiveState + Telemetry Buffer (Section 3.2).
 * - Dashboards & live endpoints read from LiveState without hitting SQLite per message.
 * - Incoming telemetry samples buffer in memory and flush once every 60 s (and on shutdown)
 *   into 10-minute `telemetry_buckets` rows.
 * - `lastSeenAt` and latest snapshots persist to `devices` at most once per 60 s during flush,
 *   while state/connectivity/firmware/config changes persist immediately.
 */
export class LiveStateStore {
  private readonly devices = new Map<string, DeviceRuntimeMeta>();
  private readonly sampleBuffers = new Map<
    string,
    { tenantId: string; deviceId: string; samples: TelemetrySample[] }
  >();
  // Rolling 60-minute ingestion & invalid payload timestamps for platform health stats
  private readonly messageTimestampsMs: number[] = [];
  private readonly invalidTimestampsMs: number[] = [];
  private alertHook: AlertEvaluationHook | null = null;

  constructor(private readonly repos: Repositories) {}

  setAlertEvaluationHook(hook: AlertEvaluationHook | null): void {
    this.alertHook = hook;
  }

  getAlertEvaluationHook(): AlertEvaluationHook | null {
    return this.alertHook;
  }

  /**
   * Rebuilds in-memory LiveState from the database at server start (Section 3.2 & 14).
   */
  rebuildFromDatabase(): number {
    this.devices.clear();
    const all = this.repos.devices.listAllSystem();
    for (const d of all) {
      this.devices.set(d.id, {
        live: {
          deviceId: d.id,
          tenantId: d.tenantId,
          state: d.state,
          connectivity: d.connectivity,
          lastSeenAt: d.lastSeenAt,
          firmwareVersion: d.firmwareVersion,
          latestMetrics: { ...d.latestMetrics },
          latestHealth: { ...d.latestHealth },
          invalidPayloadCount: d.invalidPayloadCount,
        },
        recentSampleTimestamps: new Set<string>(),
        dirtySnapshot: false,
      });
    }
    return all.length;
  }

  syncDeviceRecord(device: DevicePublic): void {
    const existing = this.devices.get(device.id);
    if (!existing) {
      this.devices.set(device.id, {
        live: {
          deviceId: device.id,
          tenantId: device.tenantId,
          state: device.state,
          connectivity: device.connectivity,
          lastSeenAt: device.lastSeenAt,
          firmwareVersion: device.firmwareVersion,
          latestMetrics: { ...device.latestMetrics },
          latestHealth: { ...device.latestHealth },
          invalidPayloadCount: device.invalidPayloadCount,
        },
        recentSampleTimestamps: new Set<string>(),
        dirtySnapshot: false,
      });
      return;
    }

    existing.live.state = device.state;
    existing.live.connectivity = device.connectivity;
    existing.live.firmwareVersion = device.firmwareVersion;
    if (device.lastSeenAt && (!existing.live.lastSeenAt || device.lastSeenAt > existing.live.lastSeenAt)) {
      existing.live.lastSeenAt = device.lastSeenAt;
    }
    if (device.invalidPayloadCount > existing.live.invalidPayloadCount) {
      existing.live.invalidPayloadCount = device.invalidPayloadCount;
    }
  }

  get(deviceId: string): DeviceLiveState | null {
    const meta = this.devices.get(deviceId);
    return meta ? { ...meta.live, latestMetrics: { ...meta.live.latestMetrics }, latestHealth: { ...meta.live.latestHealth } } : null;
  }

  /**
   * Overlays fresh in-memory LiveState onto a DevicePublic read from SQLite so dashboards and
   * inventory immediately reflect live telemetry within <5s without waiting for the 60s flusher.
   */
  mergeIntoDevice<T extends DevicePublic>(device: T): T {
    const meta = this.devices.get(device.id);
    if (!meta) return device;
    return {
      ...device,
      state: meta.live.state,
      connectivity: meta.live.connectivity,
      lastSeenAt: meta.live.lastSeenAt ?? device.lastSeenAt,
      firmwareVersion: meta.live.firmwareVersion ?? device.firmwareVersion,
      latestMetrics:
        Object.keys(meta.live.latestMetrics).length > 0
          ? { ...meta.live.latestMetrics }
          : device.latestMetrics,
      latestHealth:
        Object.keys(meta.live.latestHealth).length > 0
          ? { ...meta.live.latestHealth }
          : device.latestHealth,
      invalidPayloadCount: Math.max(device.invalidPayloadCount, meta.live.invalidPayloadCount),
    };
  }

  recordHandshake(
    device: DevicePublic,
    firmwareVersion: string,
    nowIso: string,
    newState: DeviceLifecycleState,
  ): void {
    const meta = this.ensureMeta(device);
    meta.live.state = newState;
    meta.live.connectivity = 'ONLINE';
    meta.live.firmwareVersion = firmwareVersion;
    meta.live.lastSeenAt = nowIso;
    meta.dirtySnapshot = false; // Handshake already persisted immediately to DB
    this.recordMessageMetric();
  }

  recordHeartbeat(device: DevicePublic, health: DeviceHealthSnapshot, nowIso: string): boolean {
    const meta = this.ensureMeta(device);
    const wasOffline = meta.live.connectivity !== 'ONLINE';
    meta.live.connectivity = 'ONLINE';
    meta.live.lastSeenAt = nowIso;
    meta.live.latestHealth = { ...meta.live.latestHealth, ...health };
    meta.dirtySnapshot = true;
    this.recordMessageMetric();
    return wasOffline;
  }

  recordCommandPoll(device: DevicePublic, nowIso: string): boolean {
    const meta = this.ensureMeta(device);
    const wasOffline = meta.live.connectivity !== 'ONLINE';
    meta.live.connectivity = 'ONLINE';
    meta.live.lastSeenAt = nowIso;
    meta.dirtySnapshot = true;
    return wasOffline;
  }

  /**
   * Records a validated telemetry sample. Returns `{ duplicate, becameOnline }`.
   * Duplicate samples (exact same deviceId + timestamp) are ignored per FR-TEL-04.
   */
  recordTelemetry(
    device: DevicePublic,
    sample: TelemetrySample,
    nowIso: string,
  ): { duplicate: boolean; becameOnline: boolean } {
    const meta = this.ensureMeta(device);
    const wasOffline = meta.live.connectivity !== 'ONLINE';

    if (meta.recentSampleTimestamps.has(sample.ts)) {
      meta.live.connectivity = 'ONLINE';
      meta.live.lastSeenAt = nowIso;
      meta.dirtySnapshot = true;
      return { duplicate: true, becameOnline: wasOffline };
    }

    meta.recentSampleTimestamps.add(sample.ts);
    // Keep duplicate tracking window bounded (last 500 timestamps per device)
    if (meta.recentSampleTimestamps.size > 500) {
      const oldest = meta.recentSampleTimestamps.values().next().value;
      if (oldest) meta.recentSampleTimestamps.delete(oldest);
    }

    meta.live.connectivity = 'ONLINE';
    meta.live.lastSeenAt = nowIso;
    meta.live.latestMetrics = { ...meta.live.latestMetrics, ...sample.metrics };
    if (sample.health && Object.keys(sample.health).length > 0) {
      meta.live.latestHealth = { ...meta.live.latestHealth, ...sample.health };
    }
    meta.dirtySnapshot = true;

    const buf = this.sampleBuffers.get(device.id) ?? {
      tenantId: device.tenantId,
      deviceId: device.id,
      samples: [],
    };
    buf.samples.push(sample);
    this.sampleBuffers.set(device.id, buf);

    this.recordMessageMetric();
    return { duplicate: false, becameOnline: wasOffline };
  }

  recordInvalidPayload(device: DevicePublic, newCount: number): void {
    const meta = this.ensureMeta(device);
    meta.live.invalidPayloadCount = newCount;
    const now = Date.now();
    this.invalidTimestampsMs.push(now);
    this.pruneRollingMetrics(now);
  }

  markOffline(deviceId: string): void {
    const meta = this.devices.get(deviceId);
    if (meta) {
      meta.live.connectivity = 'OFFLINE';
    }
  }

  updateLifecycleState(deviceId: string, state: DeviceLifecycleState, connectivity?: DeviceConnectivity): void {
    const meta = this.devices.get(deviceId);
    if (!meta) return;
    meta.live.state = state;
    if (connectivity) {
      meta.live.connectivity = connectivity;
    }
  }

  updateFirmwareVersion(deviceId: string, firmwareVersion: string): void {
    const meta = this.devices.get(deviceId);
    if (!meta) return;
    meta.live.firmwareVersion = firmwareVersion;
  }

  /**
   * Returns unflushed buffered samples for a device so history charts show live points immediately
   * without waiting for the 60-second flusher.
   */
  getBufferedSamples(deviceId: string): TelemetrySample[] {
    const buf = this.sampleBuffers.get(deviceId);
    return buf ? [...buf.samples] : [];
  }

  /**
   * Flushes all buffered telemetry samples into 10-minute buckets in SQLite AND persists
   * debounced `lastSeenAt` / `latestMetrics` / `latestHealth` snapshots (Section 3.2 & 8.9).
   */
  flushToDatabase(): { bucketsWritten: number; samplesFlushed: number; snapshotsUpdated: number } {
    const groupedBuckets = new Map<
      string,
      {
        bucketId: string;
        tenantId: string;
        deviceId: string;
        bucketStart: string;
        samples: TelemetrySample[];
      }
    >();
    let samplesFlushed = 0;

    for (const [deviceId, buf] of this.sampleBuffers.entries()) {
      if (buf.samples.length === 0) continue;
      const taken = buf.samples.splice(0, buf.samples.length);
      samplesFlushed += taken.length;

      for (const sample of taken) {
        const { bucketId, bucketStart } = getTelemetryBucketKey(deviceId, sample.ts);
        let entry = groupedBuckets.get(bucketId);
        if (!entry) {
          entry = {
            bucketId,
            tenantId: buf.tenantId,
            deviceId,
            bucketStart,
            samples: [],
          };
          groupedBuckets.set(bucketId, entry);
        }
        entry.samples.push(sample);
      }
    }

    const bucketList = Array.from(groupedBuckets.values());
    if (bucketList.length > 0) {
      this.repos.telemetry.bulkUpsertBuckets(bucketList);
    }

    let snapshotsUpdated = 0;
    for (const [deviceId, meta] of this.devices.entries()) {
      if (!meta.dirtySnapshot) continue;
      meta.dirtySnapshot = false;
      this.repos.devices.updateDebouncedLiveSnapshotSystem(deviceId, {
        lastSeenAt: meta.live.lastSeenAt,
        latestMetrics: meta.live.latestMetrics,
        latestHealth: meta.live.latestHealth,
      });
      snapshotsUpdated += 1;
    }

    return { bucketsWritten: bucketList.length, samplesFlushed, snapshotsUpdated };
  }

  getIngestionMetrics(): { messagesPerMinute: number; invalidPayloadRate: number } {
    const now = Date.now();
    this.pruneRollingMetrics(now);

    // Rate over the last 5 minutes (or full 60-min window scaled per minute) for responsive dashboard readout
    const fiveMinAgo = now - 5 * 60_000;
    const recentMsgs = this.messageTimestampsMs.filter((t) => t >= fiveMinAgo).length;
    const recentInvalid = this.invalidTimestampsMs.filter((t) => t >= fiveMinAgo).length;

    const messagesPerMinute = Math.round((recentMsgs / 5) * 10) / 10;
    const totalAttempts = recentMsgs + recentInvalid;
    const invalidPayloadRate =
      totalAttempts > 0 ? Math.round((recentInvalid / totalAttempts) * 1000) / 10 : 0;

    return { messagesPerMinute, invalidPayloadRate };
  }

  getLastHourIngestionMetrics(): {
    messagesPerMinute: number;
    messagesLastHour: number;
    invalidPayloadRate: number;
    invalidPayloadsLastHour: number;
  } {
    const now = Date.now();
    this.pruneRollingMetrics(now);

    const messagesLastHour = this.messageTimestampsMs.length;
    const invalidPayloadsLastHour = this.invalidTimestampsMs.length;
    const rawRate = messagesLastHour / 60;
    const messagesPerMinute =
      rawRate >= 1 ? Math.round(rawRate * 10) / 10 : Math.round(rawRate * 100) / 100;
    const totalAttempts = messagesLastHour + invalidPayloadsLastHour;
    const invalidPayloadRate =
      totalAttempts > 0 ? Math.round((invalidPayloadsLastHour / totalAttempts) * 1000) / 10 : 0;

    return {
      messagesPerMinute,
      messagesLastHour,
      invalidPayloadRate,
      invalidPayloadsLastHour,
    };
  }

  private ensureMeta(device: DevicePublic): DeviceRuntimeMeta {
    let meta = this.devices.get(device.id);
    if (!meta) {
      meta = {
        live: {
          deviceId: device.id,
          tenantId: device.tenantId,
          state: device.state,
          connectivity: device.connectivity,
          lastSeenAt: device.lastSeenAt,
          firmwareVersion: device.firmwareVersion,
          latestMetrics: { ...device.latestMetrics },
          latestHealth: { ...device.latestHealth },
          invalidPayloadCount: device.invalidPayloadCount,
        },
        recentSampleTimestamps: new Set<string>(),
        dirtySnapshot: false,
      };
      this.devices.set(device.id, meta);
    }
    return meta;
  }

  private recordMessageMetric(): void {
    const now = Date.now();
    this.messageTimestampsMs.push(now);
    this.pruneRollingMetrics(now);
  }

  private pruneRollingMetrics(nowMs: number): void {
    const oneHourAgo = nowMs - 60 * 60_000;
    while (this.messageTimestampsMs.length > 0 && this.messageTimestampsMs[0] < oneHourAgo) {
      this.messageTimestampsMs.shift();
    }
    while (this.invalidTimestampsMs.length > 0 && this.invalidTimestampsMs[0] < oneHourAgo) {
      this.invalidTimestampsMs.shift();
    }
  }
}
