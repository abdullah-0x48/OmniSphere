import type {
  AlertSeverity,
  AlertStatus,
  AlertsDailyTrendPoint,
  DeviceConnectivity,
  DeviceLifecycleState,
  FirmwareStatus,
  GroupedAvailabilityRow,
  ModelFirmwareComplianceRow,
  NonCompliantDeviceRow,
  TicketPriority,
  TicketStatus,
  WorkOrderStatus,
  WorkOrderType,
} from '../../../shared/types.ts';

/**
 * Pure SemVer comparator (major.minor.patch, with prerelease < release).
 */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string) => {
    const clean = v.trim().replace(/^v/i, '');
    const [core, pre = ''] = clean.split('-', 2);
    const [maj = '0', min = '0', pat = '0'] = core.split('.');
    return {
      maj: Number.parseInt(maj, 10) || 0,
      min: Number.parseInt(min, 10) || 0,
      pat: Number.parseInt(pat, 10) || 0,
      pre,
    };
  };
  const pa = parse(a);
  const pb = parse(b);
  if (pa.maj !== pb.maj) return pa.maj - pb.maj;
  if (pa.min !== pb.min) return pa.min - pb.min;
  if (pa.pat !== pb.pat) return pa.pat - pb.pat;
  if (!pa.pre && pb.pre) return 1;
  if (pa.pre && !pb.pre) return -1;
  return pa.pre.localeCompare(pb.pre);
}

export interface TimeInterval {
  startMs: number;
  endMs: number;
}

export interface StateHistoryInput {
  to: DeviceLifecycleState;
  at: string;
}

export interface ConnectivityEventInput {
  state: 'ONLINE' | 'OFFLINE';
  at: string;
}

export interface AvailabilityDeviceInput {
  deviceId: string;
  deviceName: string;
  serialNumber: string;
  siteId: string;
  siteName: string;
  modelId: string;
  modelName: string;
  state: DeviceLifecycleState;
  connectivity: DeviceConnectivity;
  createdAt: string;
  stateHistory: StateHistoryInput[];
  connectivityEvents: ConnectivityEventInput[];
}

export interface TicketKpiInput {
  id: string;
  priority: TicketPriority;
  status: TicketStatus;
  createdAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
}

export interface AlertKpiInput {
  id: string;
  severity: AlertSeverity;
  status: AlertStatus;
  createdAt: string;
}

export interface FirmwarePackageKpiInput {
  id: string;
  modelId: string;
  version: string;
  status: FirmwareStatus;
  createdAt: string;
}

export interface FirmwareDeviceKpiInput {
  deviceId: string;
  deviceName: string;
  serialNumber: string;
  siteName: string;
  modelId: string;
  modelName: string;
  state: DeviceLifecycleState;
  firmwareVersion: string | null;
}

export interface WorkOrderKpiInput {
  id: string;
  type: WorkOrderType;
  status: WorkOrderStatus;
  plannedStart: string | null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Parses `from` and `to` date parameters for report queries.
 * Defaults to the last 7 days ending at `nowMs`.
 * Supports full ISO timestamps or `YYYY-MM-DD` date strings.
 */
export function parseReportDateRange(
  fromRaw?: string,
  toRaw?: string,
  nowMs: number = Date.now(),
): { fromIso: string; toIso: string; fromMs: number; toMs: number } {
  const defaultToMs = nowMs;
  const defaultFromMs = nowMs - 7 * 86_400_000;

  let fromMs = defaultFromMs;
  if (fromRaw && fromRaw.trim().length > 0) {
    const trimmed = fromRaw.trim();
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
      ? Date.parse(`${trimmed}T00:00:00.000Z`)
      : Date.parse(trimmed);
    if (Number.isFinite(parsed)) {
      fromMs = parsed;
    }
  }

  let toMs = defaultToMs;
  if (toRaw && toRaw.trim().length > 0) {
    const trimmed = toRaw.trim();
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
      ? Date.parse(`${trimmed}T23:59:59.999Z`)
      : Date.parse(trimmed);
    if (Number.isFinite(parsed)) {
      toMs = parsed;
    }
  }

  if (fromMs > toMs) {
    const swap = fromMs;
    fromMs = toMs;
    toMs = swap;
  }

  return {
    fromIso: new Date(fromMs).toISOString(),
    toIso: new Date(toMs).toISOString(),
    fromMs,
    toMs,
  };
}

/**
 * Computes exact total millisecond intersection between two sorted lists of disjoint time intervals.
 */
export function intersectIntervalsDurationMs(a: TimeInterval[], b: TimeInterval[]): number {
  let i = 0;
  let j = 0;
  let total = 0;
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i].startMs, b[j].startMs);
    const end = Math.min(a[i].endMs, b[j].endMs);
    if (end > start) {
      total += end - start;
    }
    if (a[i].endMs < b[j].endMs) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return total;
}

/**
 * Reconstructs clipped intervals inside [windowStartMs, windowEndMs] during which
 * a predicate on state holds true from chronological transition events.
 */
export function buildIntervalsFromTransitions<T>(
  events: Array<{ atMs: number; value: T }>,
  predicate: (value: T | null) => boolean,
  windowStartMs: number,
  windowEndMs: number,
  initialValue: T | null = null,
): TimeInterval[] {
  if (windowEndMs <= windowStartMs) return [];

  const sorted = [...events].sort((x, y) => x.atMs - y.atMs);
  const intervals: TimeInterval[] = [];

  let currentValue: T | null = initialValue;
  let cursorMs = windowStartMs;

  for (const ev of sorted) {
    if (ev.atMs <= windowStartMs) {
      currentValue = ev.value;
      continue;
    }
    if (ev.atMs >= windowEndMs) {
      break;
    }
    if (predicate(currentValue) && ev.atMs > cursorMs) {
      intervals.push({ startMs: cursorMs, endMs: ev.atMs });
    }
    currentValue = ev.value;
    cursorMs = ev.atMs;
  }

  if (predicate(currentValue) && windowEndMs > cursorMs) {
    intervals.push({ startMs: cursorMs, endMs: windowEndMs });
  }

  // Merge adjacent intervals if contiguous
  const merged: TimeInterval[] = [];
  for (const iv of intervals) {
    const prev = merged[merged.length - 1];
    if (prev && iv.startMs <= prev.endMs) {
      prev.endMs = Math.max(prev.endMs, iv.endMs);
    } else {
      merged.push({ ...iv });
    }
  }
  return merged;
}

/**
 * Section 13 Availability % for a single device:
 * ONLINE time divided by the period during which the device was in state
 * ACTIVE or UNDER_MAINTENANCE within [rangeStartMs, min(rangeEndMs, nowMs)].
 */
export function computeDeviceAvailability(
  device: AvailabilityDeviceInput,
  rangeStartMs: number,
  rangeEndMs: number,
  nowMs: number = Date.now(),
): {
  onlineMs: number;
  eligibleMs: number;
  onlineHours: number;
  eligibleHours: number;
  availabilityPct: number | null;
} {
  const effectiveEndMs = Math.min(rangeEndMs, nowMs);
  if (effectiveEndMs <= rangeStartMs) {
    return {
      onlineMs: 0,
      eligibleMs: 0,
      onlineHours: 0,
      eligibleHours: 0,
      availabilityPct: null,
    };
  }

  const stateEvents = device.stateHistory
    .map((h) => ({ atMs: Date.parse(h.at), value: h.to }))
    .filter((e) => Number.isFinite(e.atMs));

  // Fallback if a legacy/synthetic fixture has no state history rows
  const effectiveStateEvents: Array<{ atMs: number; value: DeviceLifecycleState }> =
    stateEvents.length > 0
      ? stateEvents
      : [{ atMs: Date.parse(device.createdAt) || rangeStartMs, value: device.state }];

  const eligibleIntervals = buildIntervalsFromTransitions<DeviceLifecycleState>(
    effectiveStateEvents,
    (st) => st === 'ACTIVE' || st === 'UNDER_MAINTENANCE',
    rangeStartMs,
    effectiveEndMs,
    null,
  );

  const eligibleMs = eligibleIntervals.reduce((acc, iv) => acc + (iv.endMs - iv.startMs), 0);
  if (eligibleMs <= 0) {
    return {
      onlineMs: 0,
      eligibleMs: 0,
      onlineHours: 0,
      eligibleHours: 0,
      availabilityPct: null,
    };
  }

  const connEvents = device.connectivityEvents
    .map((c) => ({ atMs: Date.parse(c.at), value: c.state }))
    .filter((e) => Number.isFinite(e.atMs));

  const onlineIntervals = buildIntervalsFromTransitions<'ONLINE' | 'OFFLINE'>(
    connEvents,
    (c) => c === 'ONLINE',
    rangeStartMs,
    effectiveEndMs,
    null,
  );

  const onlineMs = intersectIntervalsDurationMs(eligibleIntervals, onlineIntervals);
  const pct = Math.max(0, Math.min(100, round1((onlineMs / eligibleMs) * 100)));

  return {
    onlineMs,
    eligibleMs,
    onlineHours: round2(onlineMs / 3_600_000),
    eligibleHours: round2(eligibleMs / 3_600_000),
    availabilityPct: pct,
  };
}

/**
 * Aggregates Section 13 Fleet Availability % (mean across eligible devices)
 * plus per-site and per-model breakdowns.
 */
export function aggregateAvailability(
  devices: AvailabilityDeviceInput[],
  rangeStartMs: number,
  rangeEndMs: number,
  nowMs: number = Date.now(),
): {
  fleetAvailabilityPct: number | null;
  eligibleDevices: number;
  bySite: GroupedAvailabilityRow[];
  byModel: GroupedAvailabilityRow[];
  rows: Array<{
    deviceId: string;
    deviceName: string;
    serialNumber: string;
    siteId: string;
    siteName: string;
    modelId: string;
    modelName: string;
    state: DeviceLifecycleState;
    connectivity: DeviceConnectivity;
    onlineHours: number;
    eligibleHours: number;
    availabilityPct: number | null;
  }>;
} {
  const rows = devices.map((d) => {
    const calc = computeDeviceAvailability(d, rangeStartMs, rangeEndMs, nowMs);
    return {
      deviceId: d.deviceId,
      deviceName: d.deviceName,
      serialNumber: d.serialNumber,
      siteId: d.siteId,
      siteName: d.siteName,
      modelId: d.modelId,
      modelName: d.modelName,
      state: d.state,
      connectivity: d.connectivity,
      onlineHours: calc.onlineHours,
      eligibleHours: calc.eligibleHours,
      availabilityPct: calc.availabilityPct,
    };
  });

  const eligibleRows = rows.filter((r) => r.availabilityPct !== null);
  const fleetAvailabilityPct =
    eligibleRows.length > 0
      ? round1(
          eligibleRows.reduce((sum, r) => sum + (r.availabilityPct ?? 0), 0) / eligibleRows.length,
        )
      : null;

  const groupBy = (
    keyFn: (r: (typeof rows)[number]) => { id: string; name: string },
  ): GroupedAvailabilityRow[] => {
    const map = new Map<
      string,
      {
        id: string;
        name: string;
        deviceCount: number;
        pctSum: number;
        eligibleDeviceCount: number;
        onlineHours: number;
        eligibleHours: number;
      }
    >();

    for (const r of rows) {
      const key = keyFn(r);
      let entry = map.get(key.id);
      if (!entry) {
        entry = {
          id: key.id,
          name: key.name,
          deviceCount: 0,
          pctSum: 0,
          eligibleDeviceCount: 0,
          onlineHours: 0,
          eligibleHours: 0,
        };
        map.set(key.id, entry);
      }
      entry.deviceCount += 1;
      entry.onlineHours += r.onlineHours;
      entry.eligibleHours += r.eligibleHours;
      if (r.availabilityPct !== null) {
        entry.eligibleDeviceCount += 1;
        entry.pctSum += r.availabilityPct;
      }
    }

    return Array.from(map.values())
      .map((g) => ({
        id: g.id,
        name: g.name,
        deviceCount: g.deviceCount,
        eligibleDeviceCount: g.eligibleDeviceCount,
        onlineHours: round2(g.onlineHours),
        eligibleHours: round2(g.eligibleHours),
        availabilityPct:
          g.eligibleDeviceCount > 0 ? round1(g.pctSum / g.eligibleDeviceCount) : null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  };

  return {
    fleetAvailabilityPct,
    eligibleDevices: eligibleRows.length,
    bySite: groupBy((r) => ({ id: r.siteId, name: r.siteName })),
    byModel: groupBy((r) => ({ id: r.modelId, name: r.modelName })),
    rows,
  };
}

/**
 * Section 13 MTTR:
 * Mean of (resolvedAt - createdAt) in hours of tickets resolved within [rangeStartMs, rangeEndMs].
 */
export function computeMttrHours(
  tickets: TicketKpiInput[],
  rangeStartMs: number,
  rangeEndMs: number,
): { mttrHours: number | null; resolvedCount: number } {
  const durationsHours: number[] = [];
  for (const t of tickets) {
    if (!t.resolvedAt) continue;
    const resolvedMs = Date.parse(t.resolvedAt);
    const createdMs = Date.parse(t.createdAt);
    if (!Number.isFinite(resolvedMs) || !Number.isFinite(createdMs)) continue;
    if (resolvedMs < rangeStartMs || resolvedMs > rangeEndMs) continue;
    durationsHours.push(Math.max(0, (resolvedMs - createdMs) / 3_600_000));
  }

  if (durationsHours.length === 0) {
    return { mttrHours: null, resolvedCount: 0 };
  }
  const sum = durationsHours.reduce((acc, h) => acc + h, 0);
  return {
    mttrHours: round2(sum / durationsHours.length),
    resolvedCount: durationsHours.length,
  };
}

/**
 * Section 13 Open Tickets:
 * Count with status not CLOSED at the end of the range (createdAt <= rangeEndMs,
 * and either status !== CLOSED or closedAt > rangeEndMs), grouped by priority and status.
 */
export function computeOpenTicketsAtRangeEnd(
  tickets: TicketKpiInput[],
  rangeEndMs: number,
): {
  total: number;
  byPriority: Record<TicketPriority, number>;
  byStatus: Record<TicketStatus, number>;
} {
  const byPriority: Record<TicketPriority, number> = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
  };
  const byStatus: Record<TicketStatus, number> = {
    OPEN: 0,
    IN_PROGRESS: 0,
    WAITING_ON_CLIENT: 0,
    RESOLVED: 0,
    CLOSED: 0,
  };

  let total = 0;
  for (const t of tickets) {
    const createdMs = Date.parse(t.createdAt);
    if (!Number.isFinite(createdMs) || createdMs > rangeEndMs) continue;
    const closedMs = t.closedAt ? Date.parse(t.closedAt) : null;
    const isClosedAtEnd =
      t.status === 'CLOSED' && (closedMs === null || !Number.isFinite(closedMs) || closedMs <= rangeEndMs);
    if (isClosedAtEnd) continue;

    total += 1;
    byPriority[t.priority] += 1;
    byStatus[t.status] += 1;
  }

  return { total, byPriority, byStatus };
}

/**
 * Section 13 Alerts by Severity + Daily Trend:
 * Counts alerts created within [rangeStartMs, rangeEndMs] by severity, status, and UTC day.
 */
export function computeAlertsBreakdown(
  alerts: AlertKpiInput[],
  rangeStartMs: number,
  rangeEndMs: number,
): {
  total: number;
  bySeverity: Record<AlertSeverity, number>;
  byStatus: Record<AlertStatus, number>;
  dailyTrend: AlertsDailyTrendPoint[];
} {
  const bySeverity: Record<AlertSeverity, number> = {
    CRITICAL: 0,
    WARNING: 0,
  };
  const byStatus: Record<AlertStatus, number> = {
    OPEN: 0,
    ACKNOWLEDGED: 0,
    CLOSED: 0,
  };

  // Pre-seed UTC calendar days across the range (capped at 366 days to protect memory)
  const dayMap = new Map<string, AlertsDailyTrendPoint>();
  const startDay = new Date(rangeStartMs);
  startDay.setUTCHours(0, 0, 0, 0);
  const endDay = new Date(rangeEndMs);
  endDay.setUTCHours(0, 0, 0, 0);

  let cursor = startDay.getTime();
  let guard = 0;
  while (cursor <= endDay.getTime() && guard < 366) {
    const key = new Date(cursor).toISOString().slice(0, 10);
    dayMap.set(key, { date: key, CRITICAL: 0, WARNING: 0, total: 0 });
    cursor += 86_400_000;
    guard += 1;
  }

  let total = 0;
  for (const a of alerts) {
    const createdMs = Date.parse(a.createdAt);
    if (!Number.isFinite(createdMs) || createdMs < rangeStartMs || createdMs > rangeEndMs) {
      continue;
    }
    total += 1;
    bySeverity[a.severity] += 1;
    byStatus[a.status] += 1;

    const dayKey = new Date(createdMs).toISOString().slice(0, 10);
    let bucket = dayMap.get(dayKey);
    if (!bucket) {
      bucket = { date: dayKey, CRITICAL: 0, WARNING: 0, total: 0 };
      dayMap.set(dayKey, bucket);
    }
    bucket[a.severity] += 1;
    bucket.total += 1;
  }

  const dailyTrend = Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  return { total, bySeverity, byStatus, dailyTrend };
}

/**
 * Section 13 Firmware Compliance %:
 * Devices running the latest RELEASED version of their model, divided by
 * devices whose model has at least one RELEASED version. Lists non-compliant devices.
 * Excludes permanently DECOMMISSIONED hardware.
 */
export function computeFirmwareCompliance(
  devices: FirmwareDeviceKpiInput[],
  firmwarePackages: FirmwarePackageKpiInput[],
): {
  compliancePct: number | null;
  compliantCount: number;
  eligibleCount: number;
  nonCompliantCount: number;
  byModel: ModelFirmwareComplianceRow[];
  nonCompliantDevices: NonCompliantDeviceRow[];
} {
  // Determine latest RELEASED version per modelId via semver comparison (tie-break by createdAt)
  const latestReleasedByModel = new Map<string, FirmwarePackageKpiInput>();
  for (const pkg of firmwarePackages) {
    if (pkg.status !== 'RELEASED') continue;
    const existing = latestReleasedByModel.get(pkg.modelId);
    if (!existing) {
      latestReleasedByModel.set(pkg.modelId, pkg);
      continue;
    }
    const cmp = compareSemver(pkg.version, existing.version);
    if (cmp > 0 || (cmp === 0 && pkg.createdAt > existing.createdAt)) {
      latestReleasedByModel.set(pkg.modelId, pkg);
    }
  }

  const modelStats = new Map<
    string,
    {
      modelId: string;
      modelName: string;
      latestReleasedVersion: string | null;
      eligibleDevices: number;
      compliantDevices: number;
    }
  >();

  let eligibleCount = 0;
  let compliantCount = 0;
  const nonCompliantDevices: NonCompliantDeviceRow[] = [];

  for (const dev of devices) {
    if (dev.state === 'DECOMMISSIONED') continue;
    const latestPkg = latestReleasedByModel.get(dev.modelId) ?? null;

    let entry = modelStats.get(dev.modelId);
    if (!entry) {
      entry = {
        modelId: dev.modelId,
        modelName: dev.modelName,
        latestReleasedVersion: latestPkg?.version ?? null,
        eligibleDevices: 0,
        compliantDevices: 0,
      };
      modelStats.set(dev.modelId, entry);
    }

    if (!latestPkg) {
      // Model has no RELEASED firmware yet -> excluded from denominator per Section 13
      continue;
    }

    eligibleCount += 1;
    entry.eligibleDevices += 1;

    if (dev.firmwareVersion === latestPkg.version) {
      compliantCount += 1;
      entry.compliantDevices += 1;
    } else {
      nonCompliantDevices.push({
        deviceId: dev.deviceId,
        deviceName: dev.deviceName,
        serialNumber: dev.serialNumber,
        siteName: dev.siteName,
        modelId: dev.modelId,
        modelName: dev.modelName,
        state: dev.state,
        currentVersion: dev.firmwareVersion,
        latestReleasedVersion: latestPkg.version,
      });
    }
  }

  const byModel: ModelFirmwareComplianceRow[] = Array.from(modelStats.values())
    .map((m) => ({
      modelId: m.modelId,
      modelName: m.modelName,
      latestReleasedVersion: m.latestReleasedVersion,
      eligibleDevices: m.eligibleDevices,
      compliantDevices: m.compliantDevices,
      nonCompliantDevices: m.eligibleDevices - m.compliantDevices,
      compliancePct:
        m.eligibleDevices > 0 ? round1((m.compliantDevices / m.eligibleDevices) * 100) : null,
    }))
    .sort((a, b) => a.modelName.localeCompare(b.modelName));

  nonCompliantDevices.sort((a, b) => a.deviceName.localeCompare(b.deviceName));

  return {
    compliancePct: eligibleCount > 0 ? round1((compliantCount / eligibleCount) * 100) : null,
    compliantCount,
    eligibleCount,
    nonCompliantCount: nonCompliantDevices.length,
    byModel,
    nonCompliantDevices,
  };
}

/**
 * Section 13 Maintenance Completion Rate:
 * COMPLETED work orders divided by work orders whose plannedStart is in [rangeStartMs, rangeEndMs]
 * (excluding CANCELLED).
 */
export function computeMaintenanceCompletion(
  workOrders: WorkOrderKpiInput[],
  rangeStartMs: number,
  rangeEndMs: number,
): {
  completionRatePct: number | null;
  completedCount: number;
  plannedNonCancelledCount: number;
  cancelledCount: number;
  byType: Record<WorkOrderType, { planned: number; completed: number }>;
  byStatus: Record<WorkOrderStatus, number>;
} {
  const byType: Record<WorkOrderType, { planned: number; completed: number }> = {
    PREVENTIVE: { planned: 0, completed: 0 },
    CORRECTIVE: { planned: 0, completed: 0 },
  };
  const byStatus: Record<WorkOrderStatus, number> = {
    PLANNED: 0,
    ASSIGNED: 0,
    IN_PROGRESS: 0,
    COMPLETED: 0,
    CANCELLED: 0,
  };

  let plannedNonCancelledCount = 0;
  let completedCount = 0;
  let cancelledCount = 0;

  for (const wo of workOrders) {
    if (!wo.plannedStart) continue;
    const plannedMs = Date.parse(wo.plannedStart);
    if (!Number.isFinite(plannedMs) || plannedMs < rangeStartMs || plannedMs > rangeEndMs) {
      continue;
    }

    byStatus[wo.status] += 1;

    if (wo.status === 'CANCELLED') {
      cancelledCount += 1;
      continue;
    }

    plannedNonCancelledCount += 1;
    byType[wo.type].planned += 1;

    if (wo.status === 'COMPLETED') {
      completedCount += 1;
      byType[wo.type].completed += 1;
    }
  }

  return {
    completionRatePct:
      plannedNonCancelledCount > 0
        ? round1((completedCount / plannedNonCancelledCount) * 100)
        : null,
    completedCount,
    plannedNonCancelledCount,
    cancelledCount,
    byType,
    byStatus,
  };
}
