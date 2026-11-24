import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregateAvailability,
  computeAlertsBreakdown,
  computeDeviceAvailability,
  computeFirmwareCompliance,
  computeMaintenanceCompletion,
  computeMttrHours,
  computeOpenTicketsAtRangeEnd,
  parseReportDateRange,
} from './reportKpiLogic';

const BASE = Date.parse('2026-11-10T00:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

test('computeDeviceAvailability computes exact ONLINE / (ACTIVE + UNDER_MAINTENANCE) ratio', () => {
  // Range: 2026-11-10 00:00 -> 2026-11-11 00:00 (24h)
  const rangeStart = BASE;
  const rangeEnd = BASE + 24 * HOUR;
  const now = rangeEnd + HOUR;

  // Device was ACTIVE all 24h, ONLINE for first 18h, OFFLINE for last 6h -> 75.0%
  const dev1 = computeDeviceAvailability(
    {
      deviceId: 'd1',
      deviceName: 'D1',
      serialNumber: 'SN1',
      siteId: 's1',
      siteName: 'Site 1',
      modelId: 'm1',
      modelName: 'TH-200',
      state: 'ACTIVE',
      connectivity: 'OFFLINE',
      createdAt: new Date(BASE - DAY).toISOString(),
      stateHistory: [
        { to: 'PROVISIONED', at: new Date(BASE - 2 * DAY).toISOString() },
        { to: 'ACTIVE', at: new Date(BASE - DAY).toISOString() },
      ],
      connectivityEvents: [
        { state: 'ONLINE', at: new Date(BASE - DAY).toISOString() },
        { state: 'OFFLINE', at: new Date(BASE + 18 * HOUR).toISOString() },
      ],
    },
    rangeStart,
    rangeEnd,
    now,
  );
  assert.equal(dev1.eligibleHours, 24);
  assert.equal(dev1.onlineHours, 18);
  assert.equal(dev1.availabilityPct, 75);

  // Device was ACTIVE 12h, then SUSPENDED 12h; ONLINE for 6h during ACTIVE (and even ONLINE during SUSPENDED is excluded)
  const dev2 = computeDeviceAvailability(
    {
      deviceId: 'd2',
      deviceName: 'D2',
      serialNumber: 'SN2',
      siteId: 's1',
      siteName: 'Site 1',
      modelId: 'm1',
      modelName: 'TH-200',
      state: 'SUSPENDED',
      connectivity: 'OFFLINE',
      createdAt: new Date(BASE - DAY).toISOString(),
      stateHistory: [
        { to: 'ACTIVE', at: new Date(BASE - DAY).toISOString() },
        { to: 'SUSPENDED', at: new Date(BASE + 12 * HOUR).toISOString() },
      ],
      connectivityEvents: [
        { state: 'ONLINE', at: new Date(BASE + 6 * HOUR).toISOString() },
      ],
    },
    rangeStart,
    rangeEnd,
    now,
  );
  assert.equal(dev2.eligibleHours, 12);
  assert.equal(dev2.onlineHours, 6);
  assert.equal(dev2.availabilityPct, 50);

  // UNDER_MAINTENANCE counts in denominator per Section 13
  const dev3 = computeDeviceAvailability(
    {
      deviceId: 'd3',
      deviceName: 'D3',
      serialNumber: 'SN3',
      siteId: 's2',
      siteName: 'Site 2',
      modelId: 'm2',
      modelName: 'VM-310',
      state: 'UNDER_MAINTENANCE',
      connectivity: 'ONLINE',
      createdAt: new Date(BASE - DAY).toISOString(),
      stateHistory: [
        { to: 'ACTIVE', at: new Date(BASE - DAY).toISOString() },
        { to: 'UNDER_MAINTENANCE', at: new Date(BASE + 12 * HOUR).toISOString() },
      ],
      connectivityEvents: [
        { state: 'ONLINE', at: new Date(BASE - DAY).toISOString() },
      ],
    },
    rangeStart,
    rangeEnd,
    now,
  );
  assert.equal(dev3.eligibleHours, 24);
  assert.equal(dev3.onlineHours, 24);
  assert.equal(dev3.availabilityPct, 100);
});

test('aggregateAvailability computes arithmetic fleet mean and excludes PROVISIONED-only devices', () => {
  const rangeStart = BASE;
  const rangeEnd = BASE + 24 * HOUR;
  const agg = aggregateAvailability(
    [
      {
        deviceId: 'd1',
        deviceName: 'D1',
        serialNumber: 'SN1',
        siteId: 's1',
        siteName: 'Site A',
        modelId: 'm1',
        modelName: 'TH-200',
        state: 'ACTIVE',
        connectivity: 'ONLINE',
        createdAt: new Date(BASE - DAY).toISOString(),
        stateHistory: [{ to: 'ACTIVE', at: new Date(BASE - DAY).toISOString() }],
        connectivityEvents: [{ state: 'ONLINE', at: new Date(BASE - DAY).toISOString() }],
      },
      {
        deviceId: 'd2',
        deviceName: 'D2',
        serialNumber: 'SN2',
        siteId: 's1',
        siteName: 'Site A',
        modelId: 'm2',
        modelName: 'VM-310',
        state: 'ACTIVE',
        connectivity: 'OFFLINE',
        createdAt: new Date(BASE - DAY).toISOString(),
        stateHistory: [{ to: 'ACTIVE', at: new Date(BASE - DAY).toISOString() }],
        connectivityEvents: [
          { state: 'ONLINE', at: new Date(BASE - DAY).toISOString() },
          { state: 'OFFLINE', at: new Date(BASE + 12 * HOUR).toISOString() },
        ],
      },
      {
        deviceId: 'd3',
        deviceName: 'D3',
        serialNumber: 'SN3',
        siteId: 's2',
        siteName: 'Site B',
        modelId: 'm1',
        modelName: 'TH-200',
        state: 'PROVISIONED',
        connectivity: 'UNKNOWN',
        createdAt: new Date(BASE - DAY).toISOString(),
        stateHistory: [{ to: 'PROVISIONED', at: new Date(BASE - DAY).toISOString() }],
        connectivityEvents: [],
      },
    ],
    rangeStart,
    rangeEnd,
    rangeEnd + HOUR,
  );

  // Mean of 100% and 50% = 75.0%; d3 (PROVISIONED) excluded from eligible count
  assert.equal(agg.eligibleDevices, 2);
  assert.equal(agg.fleetAvailabilityPct, 75);
  assert.equal(agg.bySite.find((s) => s.id === 's1')?.availabilityPct, 75);
  assert.equal(agg.bySite.find((s) => s.id === 's2')?.availabilityPct, null);
  assert.equal(agg.byModel.find((m) => m.id === 'm1')?.availabilityPct, 100);
  assert.equal(agg.byModel.find((m) => m.id === 'm2')?.availabilityPct, 50);
});

test('computeMttrHours averages (resolvedAt - createdAt) in hours only for tickets resolved in range', () => {
  const res = computeMttrHours(
    [
      {
        id: 't1',
        priority: 'HIGH',
        status: 'RESOLVED',
        createdAt: new Date(BASE).toISOString(),
        resolvedAt: new Date(BASE + 4 * HOUR).toISOString(),
        closedAt: null,
      },
      {
        id: 't2',
        priority: 'MEDIUM',
        status: 'CLOSED',
        createdAt: new Date(BASE + 2 * HOUR).toISOString(),
        resolvedAt: new Date(BASE + 10 * HOUR).toISOString(), // 8h
        closedAt: new Date(BASE + 12 * HOUR).toISOString(),
      },
      {
        id: 't3_outside',
        priority: 'LOW',
        status: 'CLOSED',
        createdAt: new Date(BASE - 5 * DAY).toISOString(),
        resolvedAt: new Date(BASE - 2 * DAY).toISOString(), // before range
        closedAt: new Date(BASE - DAY).toISOString(),
      },
    ],
    BASE,
    BASE + 24 * HOUR,
  );

  assert.equal(res.resolvedCount, 2);
  assert.equal(res.mttrHours, 6);
});

test('computeOpenTicketsAtRangeEnd counts tickets not CLOSED at range end by priority', () => {
  const end = BASE + 24 * HOUR;
  const res = computeOpenTicketsAtRangeEnd(
    [
      {
        id: 't1',
        priority: 'CRITICAL',
        status: 'OPEN',
        createdAt: new Date(BASE + HOUR).toISOString(),
        resolvedAt: null,
        closedAt: null,
      },
      {
        id: 't2',
        priority: 'HIGH',
        status: 'CLOSED',
        createdAt: new Date(BASE + HOUR).toISOString(),
        resolvedAt: new Date(BASE + 10 * HOUR).toISOString(),
        closedAt: new Date(end + 2 * HOUR).toISOString(), // closed AFTER range end -> still open at end
      },
      {
        id: 't3',
        priority: 'LOW',
        status: 'CLOSED',
        createdAt: new Date(BASE + HOUR).toISOString(),
        resolvedAt: new Date(BASE + 3 * HOUR).toISOString(),
        closedAt: new Date(BASE + 5 * HOUR).toISOString(), // closed BEFORE range end -> excluded
      },
      {
        id: 't4_future',
        priority: 'MEDIUM',
        status: 'OPEN',
        createdAt: new Date(end + 5 * HOUR).toISOString(), // created AFTER range end -> excluded
        resolvedAt: null,
        closedAt: null,
      },
    ],
    end,
  );

  assert.equal(res.total, 2);
  assert.equal(res.byPriority.CRITICAL, 1);
  assert.equal(res.byPriority.HIGH, 1);
  assert.equal(res.byPriority.LOW, 0);
});

test('computeAlertsBreakdown produces severity totals and continuous UTC daily trend', () => {
  const res = computeAlertsBreakdown(
    [
      { id: 'a1', severity: 'CRITICAL', status: 'OPEN', createdAt: '2026-11-10T03:00:00.000Z' },
      { id: 'a2', severity: 'WARNING', status: 'ACKNOWLEDGED', createdAt: '2026-11-10T15:00:00.000Z' },
      { id: 'a3', severity: 'WARNING', status: 'CLOSED', createdAt: '2026-11-12T10:00:00.000Z' },
      { id: 'a4_out', severity: 'CRITICAL', status: 'OPEN', createdAt: '2026-11-09T23:59:59.000Z' },
    ],
    Date.parse('2026-11-10T00:00:00.000Z'),
    Date.parse('2026-11-12T23:59:59.999Z'),
  );

  assert.equal(res.total, 3);
  assert.deepEqual(res.bySeverity, { CRITICAL: 1, WARNING: 2 });
  assert.equal(res.dailyTrend.length, 3);
  assert.equal(res.dailyTrend[0].date, '2026-11-10');
  assert.equal(res.dailyTrend[0].total, 2);
  assert.equal(res.dailyTrend[1].date, '2026-11-11');
  assert.equal(res.dailyTrend[1].total, 0);
  assert.equal(res.dailyTrend[2].date, '2026-11-12');
  assert.equal(res.dailyTrend[2].WARNING, 1);
});

test('computeFirmwareCompliance uses latest RELEASED semver per model and excludes models with no RELEASED package', () => {
  const res = computeFirmwareCompliance(
    [
      { deviceId: 'd1', deviceName: 'D1', serialNumber: 'S1', siteName: 'Site1', modelId: 'm1', modelName: 'TH-200', state: 'ACTIVE', firmwareVersion: '1.10.0' },
      { deviceId: 'd2', deviceName: 'D2', serialNumber: 'S2', siteName: 'Site1', modelId: 'm1', modelName: 'TH-200', state: 'ACTIVE', firmwareVersion: '1.2.0' },
      { deviceId: 'd3', deviceName: 'D3', serialNumber: 'S3', siteName: 'Site1', modelId: 'm2', modelName: 'NoRel', state: 'ACTIVE', firmwareVersion: '1.0.0' },
      { deviceId: 'd4', deviceName: 'D4', serialNumber: 'S4', siteName: 'Site1', modelId: 'm1', modelName: 'TH-200', state: 'DECOMMISSIONED', firmwareVersion: '1.0.0' },
    ],
    [
      { id: 'f1', modelId: 'm1', version: '1.2.0', status: 'RELEASED', createdAt: '2026-11-01T00:00:00.000Z' },
      { id: 'f2', modelId: 'm1', version: '1.10.0', status: 'RELEASED', createdAt: '2026-11-05T00:00:00.000Z' },
      { id: 'f3', modelId: 'm1', version: '2.0.0', status: 'DRAFT', createdAt: '2026-11-09T00:00:00.000Z' },
      { id: 'f4', modelId: 'm2', version: '1.0.0', status: 'DRAFT', createdAt: '2026-11-01T00:00:00.000Z' },
    ],
  );

  // Eligible: d1 & d2 (m2 has no RELEASED, d4 is DECOMMISSIONED). Compliant: d1 (1.10.0) -> 50.0%
  assert.equal(res.eligibleCount, 2);
  assert.equal(res.compliantCount, 1);
  assert.equal(res.compliancePct, 50);
  assert.equal(res.nonCompliantDevices.length, 1);
  assert.equal(res.nonCompliantDevices[0].deviceId, 'd2');
  assert.equal(res.nonCompliantDevices[0].latestReleasedVersion, '1.10.0');
});

test('computeMaintenanceCompletion computes COMPLETED / planned-in-range excluding CANCELLED', () => {
  const res = computeMaintenanceCompletion(
    [
      { id: 'w1', type: 'PREVENTIVE', status: 'COMPLETED', plannedStart: '2026-11-10T10:00:00.000Z' },
      { id: 'w2', type: 'CORRECTIVE', status: 'COMPLETED', plannedStart: '2026-11-11T10:00:00.000Z' },
      { id: 'w3', type: 'PREVENTIVE', status: 'ASSIGNED', plannedStart: '2026-11-12T10:00:00.000Z' },
      { id: 'w4', type: 'CORRECTIVE', status: 'CANCELLED', plannedStart: '2026-11-11T12:00:00.000Z' },
      { id: 'w5_out', type: 'PREVENTIVE', status: 'COMPLETED', plannedStart: '2026-11-20T10:00:00.000Z' },
    ],
    Date.parse('2026-11-10T00:00:00.000Z'),
    Date.parse('2026-11-13T00:00:00.000Z'),
  );

  // 2 completed / 3 non-cancelled in range = 66.7%
  assert.equal(res.plannedNonCancelledCount, 3);
  assert.equal(res.completedCount, 2);
  assert.equal(res.cancelledCount, 1);
  assert.equal(res.completionRatePct, 66.7);
});

test('parseReportDateRange defaults to last 7 days and swaps inverted dates cleanly', () => {
  const now = Date.parse('2026-11-20T12:00:00.000Z');
  const def = parseReportDateRange(undefined, undefined, now);
  assert.equal(def.toMs - def.fromMs, 7 * DAY);

  const swapped = parseReportDateRange('2026-11-15', '2026-11-10', now);
  assert.ok(swapped.fromMs < swapped.toMs);
});
