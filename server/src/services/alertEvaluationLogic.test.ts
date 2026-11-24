import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeEmailRetryDelayMs,
  computeNextEscalationLevel,
  evaluateComparison,
  extractNumericMetricValue,
  isDeviceSuppressedForAlerts,
  ruleMatchesDevice,
} from './alertEvaluationLogic';

test('evaluateComparison handles GT, GTE, LT, LTE accurately', () => {
  assert.equal(evaluateComparison(85.1, 'GT', 85), true);
  assert.equal(evaluateComparison(85, 'GT', 85), false);
  assert.equal(evaluateComparison(85, 'GTE', 85), true);
  assert.equal(evaluateComparison(19.9, 'LT', 20), true);
  assert.equal(evaluateComparison(20, 'LT', 20), false);
  assert.equal(evaluateComparison(20, 'LTE', 20), true);
});

test('isDeviceSuppressedForAlerts suppresses SUSPENDED, UNDER_MAINTENANCE, DECOMMISSIONED only', () => {
  assert.equal(isDeviceSuppressedForAlerts('ACTIVE'), false);
  assert.equal(isDeviceSuppressedForAlerts('PROVISIONED'), false);
  assert.equal(isDeviceSuppressedForAlerts('SUSPENDED'), true);
  assert.equal(isDeviceSuppressedForAlerts('UNDER_MAINTENANCE'), true);
  assert.equal(isDeviceSuppressedForAlerts('DECOMMISSIONED'), true);
});

test('ruleMatchesDevice checks enabled flag and DEVICE, MODEL, SITE scopes', () => {
  const device = { id: 'dev_1', modelId: 'mdl_th200', siteId: 'sit_1' };
  assert.equal(ruleMatchesDevice({ enabled: true, scopeType: 'DEVICE', scopeId: 'dev_1' }, device), true);
  assert.equal(ruleMatchesDevice({ enabled: true, scopeType: 'DEVICE', scopeId: 'dev_2' }, device), false);
  assert.equal(ruleMatchesDevice({ enabled: true, scopeType: 'MODEL', scopeId: 'mdl_th200' }, device), true);
  assert.equal(ruleMatchesDevice({ enabled: true, scopeType: 'SITE', scopeId: 'sit_1' }, device), true);
  assert.equal(ruleMatchesDevice({ enabled: false, scopeType: 'SITE', scopeId: 'sit_1' }, device), false);
});

test('extractNumericMetricValue resolves both sensor metrics and device health fields', () => {
  assert.equal(
    extractNumericMetricValue('temperature', { temperature: 92.5 }, { cpuLoad: 40 }),
    92.5,
  );
  assert.equal(
    extractNumericMetricValue('batteryLevel', { temperature: 25 }, { batteryLevel: 14 }),
    14,
  );
  assert.equal(
    extractNumericMetricValue('batteryLevel', {}, { batteryLevel: null }),
    null,
  );
  assert.equal(
    extractNumericMetricValue('unknownMetric', { temperature: 25 }, { cpuLoad: 40 }),
    null,
  );
});

test('computeEmailRetryDelayMs follows 30s, 60s, 120s then null (FAILED)', () => {
  assert.equal(computeEmailRetryDelayMs(1), 30_000);
  assert.equal(computeEmailRetryDelayMs(2), 60_000);
  assert.equal(computeEmailRetryDelayMs(3), 120_000);
  assert.equal(computeEmailRetryDelayMs(4), null);
});

test('computeNextEscalationLevel advances OPEN CRITICAL alerts L0 -> L1 -> L2 on criticalAckMinutes', () => {
  const base = Date.parse('2026-11-21T10:00:00.000Z');
  const openCrit = {
    severity: 'CRITICAL' as const,
    status: 'OPEN' as const,
    escalationLevel: 0 as const,
    createdAt: new Date(base).toISOString(),
    escalatedAt: null,
  };

  // Before 1 minute
  assert.equal(computeNextEscalationLevel(openCrit, 1, base + 59_000), null);
  // At 1 minute -> level 1
  assert.equal(computeNextEscalationLevel(openCrit, 1, base + 60_000), 1);

  // At level 1, wait another 1 minute from escalatedAt -> level 2
  const level1 = {
    ...openCrit,
    escalationLevel: 1 as const,
    escalatedAt: new Date(base + 60_000).toISOString(),
  };
  assert.equal(computeNextEscalationLevel(level1, 1, base + 119_000), null);
  assert.equal(computeNextEscalationLevel(level1, 1, base + 120_000), 2);

  // ACKNOWLEDGED or WARNING never escalate
  assert.equal(
    computeNextEscalationLevel({ ...openCrit, status: 'ACKNOWLEDGED' }, 1, base + 600_000),
    null,
  );
  assert.equal(
    computeNextEscalationLevel({ ...openCrit, severity: 'WARNING' }, 1, base + 600_000),
    null,
  );
});
