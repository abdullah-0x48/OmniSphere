import type { TelemetrySample } from '../../../shared/types.ts';
import type { Repositories } from '../repositories/index.ts';
import { getTelemetryBucketKey } from '../services/telemetryValidation.ts';

function deterministicNoise(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Generates 24 hours of realistic 5-minute telemetry samples (288 samples per ACTIVE device),
 * grouped into 10-minute UTC buckets and inserted in one fast SQLite transaction (Section 15).
 */
export function seedMilestone3Telemetry(
  repos: Repositories,
  options: { force?: boolean } = {},
): { bucketsSeeded: number; devicesBackfilled: number } {
  if (!options.force && repos.telemetry.countBuckets() > 0) {
    return { bucketsSeeded: 0, devicesBackfilled: 0 };
  }

  const allDevices = repos.devices.listAllSystem();
  const activeDevices = allDevices.filter(
    (d) => d.state === 'ACTIVE' || d.state === 'UNDER_MAINTENANCE',
  );

  const nowMs = Date.now();
  // Round end time down to nearest 5 minutes for clean chart ticks
  const endMs = Math.floor(nowMs / 300_000) * 300_000;
  const totalPoints = 288; // 24 hours at 5-minute intervals
  const stepMs = 5 * 60_000;

  const bucketEntries: Array<{
    bucketId: string;
    tenantId: string;
    deviceId: string;
    bucketStart: string;
    samples: TelemetrySample[];
  }> = [];

  let devicesBackfilled = 0;

  for (let dIdx = 0; dIdx < activeDevices.length; dIdx += 1) {
    const dev = activeDevices[dIdx];
    const isOffline = dev.connectivity === 'OFFLINE';
    const stopPoint = isOffline ? totalPoints - 24 : totalPoints; // Offline devices stopped ~2h ago

    const grouped = new Map<
      string,
      {
        bucketId: string;
        tenantId: string;
        deviceId: string;
        bucketStart: string;
        samples: TelemetrySample[];
      }
    >();

    let cumulativeEnergy = 14200 + dIdx * 385;

    for (let i = 0; i < stopPoint; i += 1) {
      const tsMs = endMs - (totalPoints - 1 - i) * stepMs;
      const tsIso = new Date(tsMs).toISOString();
      const wave = Math.sin((i / 288) * Math.PI * 2 + dIdx * 0.7);
      const noise = (deterministicNoise(dIdx * 1000 + i) - 0.5) * 2;

      let metrics: Record<string, number>;
      if (dev.modelId === 'mdl_th200') {
        const baseTemp = 27 + (dIdx % 6) * 2.1;
        const baseHum = 54 + (dIdx % 5) * 3.2;
        metrics = {
          temperature: Math.round((baseTemp + wave * 4.2 + noise * 1.1) * 10) / 10,
          humidity: Math.round(Math.max(20, Math.min(92, baseHum - wave * 6.5 + noise * 2.0)) * 10) / 10,
        };
      } else if (dev.modelId === 'mdl_vm310') {
        const baseVib = 3.8 + (dIdx % 5) * 0.7;
        const baseTemp = 46 + (dIdx % 6) * 2.4;
        metrics = {
          vibration_rms: Math.round(Math.max(0.5, baseVib + wave * 1.4 + noise * 0.45) * 100) / 100,
          temperature: Math.round((baseTemp + wave * 5.1 + noise * 1.4) * 10) / 10,
        };
      } else {
        const baseV = 229 + (dIdx % 4) * 1.5;
        const baseI = 42 + (dIdx % 5) * 4.5;
        const power = Math.max(4, (baseV * (baseI + wave * 6)) / 1000 * 0.88);
        cumulativeEnergy += power * (5 / 60);
        metrics = {
          voltage: Math.round((baseV + wave * 3.5 + noise * 1.2) * 10) / 10,
          current: Math.round(Math.max(5, baseI + wave * 6.0 + noise * 2.1) * 10) / 10,
          power_kw: Math.round(power * 10) / 10,
          energy_kwh: Math.round(cumulativeEnergy * 10) / 10,
        };
      }

      const health = {
        cpuLoad: Math.round(Math.max(8, Math.min(92, 28 + (dIdx % 10) * 2.2 + wave * 8 + noise * 3)) * 10) / 10,
        memoryUsage: Math.round(Math.max(20, Math.min(90, 44 + (dIdx % 8) * 2.1 + wave * 4 + noise * 1.5)) * 10) / 10,
        batteryLevel:
          dev.modelId === 'mdl_em120'
            ? null
            : Math.round(Math.max(25, Math.min(100, 88 - (i / totalPoints) * 6 - (dIdx % 4) * 4)) * 10) / 10,
        signalStrength: Math.round(-60 - (dIdx % 14) + noise * 4),
        uptimeSec: 86400 * (3 + (dIdx % 10)) + i * 300,
      };

      const { bucketId, bucketStart } = getTelemetryBucketKey(dev.id, tsIso);
      let entry = grouped.get(bucketId);
      if (!entry) {
        entry = {
          bucketId,
          tenantId: dev.tenantId,
          deviceId: dev.id,
          bucketStart,
          samples: [],
        };
        grouped.set(bucketId, entry);
      }
      entry.samples.push({ ts: tsIso, metrics, health });
    }

    for (const b of grouped.values()) {
      bucketEntries.push(b);
    }

    // Update latest metrics/health on the device snapshot to match the final seeded point
    const lastBucket = Array.from(grouped.values()).at(-1);
    const lastSample = lastBucket?.samples.at(-1);
    if (lastSample) {
      repos.devices.updateDebouncedLiveSnapshotSystem(dev.id, {
        lastSeenAt: isOffline ? dev.lastSeenAt : new Date(nowMs - ((dIdx % 6) * 4 + 5) * 1000).toISOString(),
        latestMetrics: lastSample.metrics,
        latestHealth: lastSample.health ?? dev.latestHealth,
      });
    }

    devicesBackfilled += 1;
  }

  if (bucketEntries.length > 0) {
    repos.telemetry.bulkUpsertBuckets(bucketEntries);
  }

  return { bucketsSeeded: bucketEntries.length, devicesBackfilled };
}
