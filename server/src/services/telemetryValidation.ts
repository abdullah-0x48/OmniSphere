import type {
  DeviceHealthSnapshot,
  MetricDefinition,
  TelemetryPoint,
  TelemetryRange,
  TelemetrySample,
} from '../../../shared/types.ts';

export interface TelemetryValidationResult {
  valid: boolean;
  errors: string[];
  sanitizedMetrics: Record<string, number | boolean | string>;
  sanitizedHealth?: DeviceHealthSnapshot;
}

/**
 * Validates health payload keys against Section 6 & 15 ranges.
 */
export function validateHealthPayload(
  raw: unknown,
): { valid: boolean; errors: string[]; health?: DeviceHealthSnapshot } {
  if (raw === undefined || raw === null) {
    return { valid: true, errors: [] };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, errors: ['health must be an object'] };
  }

  const obj = raw as Record<string, unknown>;
  const errors: string[] = [];
  const health: DeviceHealthSnapshot = {};
  const allowedKeys = new Set(['cpuLoad', 'memoryUsage', 'batteryLevel', 'signalStrength', 'uptimeSec']);

  for (const key of Object.keys(obj)) {
    if (!allowedKeys.has(key)) {
      errors.push(`Unknown health field "${key}"`);
    }
  }

  if (obj.cpuLoad !== undefined) {
    if (typeof obj.cpuLoad !== 'number' || !Number.isFinite(obj.cpuLoad) || obj.cpuLoad < 0 || obj.cpuLoad > 100) {
      errors.push('health.cpuLoad must be a number between 0 and 100');
    } else {
      health.cpuLoad = Math.round(obj.cpuLoad * 10) / 10;
    }
  }

  if (obj.memoryUsage !== undefined) {
    if (
      typeof obj.memoryUsage !== 'number' ||
      !Number.isFinite(obj.memoryUsage) ||
      obj.memoryUsage < 0 ||
      obj.memoryUsage > 100
    ) {
      errors.push('health.memoryUsage must be a number between 0 and 100');
    } else {
      health.memoryUsage = Math.round(obj.memoryUsage * 10) / 10;
    }
  }

  if (obj.batteryLevel !== undefined) {
    if (obj.batteryLevel === null) {
      health.batteryLevel = null;
    } else if (
      typeof obj.batteryLevel !== 'number' ||
      !Number.isFinite(obj.batteryLevel) ||
      obj.batteryLevel < 0 ||
      obj.batteryLevel > 100
    ) {
      errors.push('health.batteryLevel must be null or a number between 0 and 100');
    } else {
      health.batteryLevel = Math.round(obj.batteryLevel * 10) / 10;
    }
  }

  if (obj.signalStrength !== undefined) {
    if (
      typeof obj.signalStrength !== 'number' ||
      !Number.isFinite(obj.signalStrength) ||
      obj.signalStrength < -140 ||
      obj.signalStrength > 0
    ) {
      errors.push('health.signalStrength must be a number between -140 and 0');
    } else {
      health.signalStrength = Math.round(obj.signalStrength);
    }
  }

  if (obj.uptimeSec !== undefined) {
    if (typeof obj.uptimeSec !== 'number' || !Number.isFinite(obj.uptimeSec) || obj.uptimeSec < 0) {
      errors.push('health.uptimeSec must be a non-negative number');
    } else {
      health.uptimeSec = Math.floor(obj.uptimeSec);
    }
  }

  return { valid: errors.length === 0, errors, health };
}

/**
 * Validates telemetry metrics against the device model's metric definitions (FR-TEL-03 / Section 6).
 * Unknown metric keys, wrong types, or values outside min..max are rejected with 400.
 */
export function validateTelemetryPayload(
  rawMetrics: unknown,
  rawHealth: unknown,
  modelMetrics: MetricDefinition[],
): TelemetryValidationResult {
  const errors: string[] = [];
  const sanitizedMetrics: Record<string, number | boolean | string> = {};

  if (!rawMetrics || typeof rawMetrics !== 'object' || Array.isArray(rawMetrics)) {
    return { valid: false, errors: ['metrics must be a non-empty JSON object'], sanitizedMetrics };
  }

  const metricMap = new Map<string, MetricDefinition>();
  for (const def of modelMetrics) {
    metricMap.set(def.key, def);
  }

  const entries = Object.entries(rawMetrics as Record<string, unknown>);
  if (entries.length === 0) {
    errors.push('metrics must include at least one reading');
  }

  for (const [key, val] of entries) {
    const def = metricMap.get(key);
    if (!def) {
      errors.push(`Unknown metric key "${key}" for device model`);
      continue;
    }

    if (def.type === 'number') {
      if (typeof val !== 'number' || !Number.isFinite(val)) {
        errors.push(`Metric "${key}" must be a finite number`);
        continue;
      }
      if (def.min !== null && val < def.min) {
        errors.push(`Metric "${key}" value ${val} is below minimum ${def.min}`);
        continue;
      }
      if (def.max !== null && val > def.max) {
        errors.push(`Metric "${key}" value ${val} exceeds maximum ${def.max}`);
        continue;
      }
      sanitizedMetrics[key] = Math.round(val * 1000) / 1000;
    } else if (def.type === 'boolean') {
      if (typeof val !== 'boolean') {
        errors.push(`Metric "${key}" must be a boolean`);
        continue;
      }
      sanitizedMetrics[key] = val;
    } else {
      if (typeof val !== 'string' || val.length > 256) {
        errors.push(`Metric "${key}" must be a string (max 256 chars)`);
        continue;
      }
      sanitizedMetrics[key] = val;
    }
  }

  const healthCheck = validateHealthPayload(rawHealth);
  if (!healthCheck.valid) {
    errors.push(...healthCheck.errors);
  }

  return {
    valid: errors.length === 0,
    errors,
    sanitizedMetrics,
    sanitizedHealth: healthCheck.health,
  };
}

/**
 * Computes the 10-minute UTC bucket key `{deviceId}_{yyyyMMddHHmm}` and ISO bucketStart (Section 3.2).
 */
export function getTelemetryBucketKey(
  deviceId: string,
  isoTimestamp: string,
): { bucketId: string; bucketStart: string } {
  const date = new Date(isoTimestamp);
  const utcMs = date.getTime();
  const flooredMs = Math.floor(utcMs / 600_000) * 600_000;
  const bucketDate = new Date(flooredMs);

  const yyyy = bucketDate.getUTCFullYear();
  const MM = String(bucketDate.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(bucketDate.getUTCDate()).padStart(2, '0');
  const HH = String(bucketDate.getUTCHours()).padStart(2, '0');
  const mm = String(bucketDate.getUTCMinutes()).padStart(2, '0');

  return {
    bucketId: `${deviceId}_${yyyy}${MM}${dd}${HH}${mm}`,
    bucketStart: bucketDate.toISOString(),
  };
}

export function rangeToDurationMs(range: TelemetryRange): number {
  switch (range) {
    case '15m':
      return 15 * 60_000;
    case '1h':
      return 60 * 60_000;
    case '24h':
      return 24 * 60 * 60_000;
    case '7d':
      return 7 * 24 * 60 * 60_000;
  }
}

/**
 * Down-samples an ordered array of telemetry points to at most `maxPoints` (default 300, Section 3.2).
 * Numeric values are averaged per window; non-numeric values take the last reading in the window.
 */
export function downsamplePoints(points: TelemetryPoint[], maxPoints = 300): TelemetryPoint[] {
  if (points.length <= maxPoints || maxPoints <= 0) {
    return points;
  }

  const bucketSize = points.length / maxPoints;
  const result: TelemetryPoint[] = [];

  for (let i = 0; i < maxPoints; i += 1) {
    const startIdx = Math.floor(i * bucketSize);
    const endIdx = Math.min(points.length, Math.floor((i + 1) * bucketSize));
    if (startIdx >= endIdx) continue;

    const slice = points.slice(startIdx, endIdx);
    const midTs = slice[Math.floor(slice.length / 2)].ts;

    const numericVals = slice
      .map((p) => p.value)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

    if (numericVals.length > 0) {
      const avg = numericVals.reduce((acc, v) => acc + v, 0) / numericVals.length;
      result.push({ ts: midTs, value: Math.round(avg * 100) / 100 });
    } else {
      result.push({ ts: midTs, value: slice[slice.length - 1].value });
    }
  }

  return result;
}

/**
 * Extracts per-metric time series from raw telemetry samples filtered to [fromMs, toMs] and
 * down-samples each metric series to at most `maxPoints`.
 */
export function buildDownsampledSeries(
  samples: TelemetrySample[],
  metricKeys: string[],
  fromMs: number,
  toMs: number,
  maxPoints = 300,
): Record<string, TelemetryPoint[]> {
  const sorted = samples
    .filter((s) => {
      const t = Date.parse(s.ts);
      return Number.isFinite(t) && t >= fromMs && t <= toMs;
    })
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));

  const series: Record<string, TelemetryPoint[]> = {};
  for (const key of metricKeys) {
    const rawPoints: TelemetryPoint[] = [];
    for (const s of sorted) {
      if (Object.prototype.hasOwnProperty.call(s.metrics, key)) {
        rawPoints.push({ ts: s.ts, value: s.metrics[key] });
      }
    }
    series[key] = downsamplePoints(rawPoints, maxPoints);
  }
  return series;
}
