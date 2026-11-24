import assert from 'node:assert/strict';
import test from 'node:test';
import type { MetricDefinition, TelemetryPoint } from '../../../shared/types.ts';
import {
  downsamplePoints,
  getTelemetryBucketKey,
  rangeToDurationMs,
  validateHealthPayload,
  validateTelemetryPayload,
} from './telemetryValidation.ts';

const TH200_METRICS: MetricDefinition[] = [
  { key: 'temperature', label: 'Temperature', type: 'number', unit: '°C', min: 0, max: 120 },
  { key: 'humidity', label: 'Humidity', type: 'number', unit: '%', min: 0, max: 100 },
  { key: 'door_open', label: 'Door Open', type: 'boolean', unit: '', min: null, max: null },
];

test('validateTelemetryPayload accepts valid metrics and optional health', () => {
  const res = validateTelemetryPayload(
    { temperature: 42.3456, humidity: 58.2, door_open: false },
    { cpuLoad: 25.4, memoryUsage: 48.1, batteryLevel: null, signalStrength: -62, uptimeSec: 3600 },
    TH200_METRICS,
  );
  assert.equal(res.valid, true);
  assert.equal(res.errors.length, 0);
  assert.equal(res.sanitizedMetrics.temperature, 42.346);
  assert.equal(res.sanitizedHealth?.batteryLevel, null);
});

test('validateTelemetryPayload rejects unknown keys, wrong types, and out-of-range values', () => {
  const unknownKey = validateTelemetryPayload({ unknown_metric: 10 }, undefined, TH200_METRICS);
  assert.equal(unknownKey.valid, false);
  assert.match(unknownKey.errors[0], /Unknown metric key/);

  const wrongType = validateTelemetryPayload({ temperature: 'hot' }, undefined, TH200_METRICS);
  assert.equal(wrongType.valid, false);
  assert.match(wrongType.errors[0], /finite number/);

  const outOfRange = validateTelemetryPayload({ temperature: 250, humidity: -5 }, undefined, TH200_METRICS);
  assert.equal(outOfRange.valid, false);
  assert.equal(outOfRange.errors.length, 2);
});

test('validateHealthPayload enforces health field bounds', () => {
  const bad = validateHealthPayload({ cpuLoad: 150, signalStrength: 20 });
  assert.equal(bad.valid, false);
  assert.equal(bad.errors.length, 2);
});

test('getTelemetryBucketKey floors timestamps into 10-minute UTC buckets', () => {
  const { bucketId, bucketStart } = getTelemetryBucketKey('dev_ktl_001', '2026-11-21T14:27:43.210Z');
  assert.equal(bucketId, 'dev_ktl_001_202611211420');
  assert.equal(bucketStart, '2026-11-21T14:20:00.000Z');
});

test('downsamplePoints averages numeric windows to at most 300 points', () => {
  const points: TelemetryPoint[] = [];
  const base = Date.parse('2026-11-21T00:00:00.000Z');
  for (let i = 0; i < 900; i += 1) {
    points.push({ ts: new Date(base + i * 60_000).toISOString(), value: 20 + (i % 10) });
  }
  const down = downsamplePoints(points, 300);
  assert.equal(down.length, 300);
  assert.equal(typeof down[0].value, 'number');
  assert.equal(rangeToDurationMs('15m'), 900_000);
  assert.equal(rangeToDurationMs('7d'), 7 * 86400_000);
});
