import type {
  AlertOperator,
  AlertRule,
  DeviceHealthSnapshot,
  DeviceLifecycleState,
} from '../../../shared/types.ts';

/**
 * Pure, decoupled Milestone 4 alerting, escalation, and email-retry logic.
 * Tested directly via Node's built-in test runner (`node:test`).
 */

export const EMAIL_RETRY_DELAYS_MS: readonly number[] = [
  30_000, // Retry 1 after 30s
  60_000, // Retry 2 after 60s
  120_000, // Retry 3 after 120s
] as const;

export const MAX_EMAIL_ATTEMPTS = EMAIL_RETRY_DELAYS_MS.length + 1; // 1 initial attempt + 3 retries = 4

export function isDeviceSuppressedForAlerts(state: DeviceLifecycleState): boolean {
  return state === 'SUSPENDED' || state === 'UNDER_MAINTENANCE' || state === 'DECOMMISSIONED';
}

export function ruleMatchesDevice(
  rule: Pick<AlertRule, 'scopeType' | 'scopeId' | 'enabled'>,
  device: { id: string; modelId: string; siteId: string },
): boolean {
  if (!rule.enabled) return false;
  switch (rule.scopeType) {
    case 'DEVICE':
      return rule.scopeId === device.id;
    case 'MODEL':
      return rule.scopeId === device.modelId;
    case 'SITE':
      return rule.scopeId === device.siteId;
    default:
      return false;
  }
}

export function extractNumericMetricValue(
  metricKey: string,
  metrics: Record<string, number | boolean | string>,
  health: DeviceHealthSnapshot,
): number | null {
  if (Object.prototype.hasOwnProperty.call(metrics, metricKey)) {
    const val = metrics[metricKey];
    return typeof val === 'number' && Number.isFinite(val) ? val : null;
  }
  const healthMap = health as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(healthMap, metricKey)) {
    const val = healthMap[metricKey];
    return typeof val === 'number' && Number.isFinite(val) ? val : null;
  }
  return null;
}

export function evaluateComparison(
  value: number,
  operator: AlertOperator,
  threshold: number,
): boolean {
  switch (operator) {
    case 'GT':
      return value > threshold;
    case 'GTE':
      return value >= threshold;
    case 'LT':
      return value < threshold;
    case 'LTE':
      return value <= threshold;
    default:
      return false;
  }
}

export function formatOperatorSymbol(operator: AlertOperator): string {
  switch (operator) {
    case 'GT':
      return '>';
    case 'GTE':
      return '>=';
    case 'LT':
      return '<';
    case 'LTE':
      return '<=';
  }
}

/**
 * Returns the next escalation level (1 or 2) if an OPEN CRITICAL alert is overdue
 * based on the tenant's `criticalAckMinutes`, otherwise `null`.
 */
export function computeNextEscalationLevel(
  alert: {
    severity: 'WARNING' | 'CRITICAL';
    status: 'OPEN' | 'ACKNOWLEDGED' | 'CLOSED';
    escalationLevel: 0 | 1 | 2;
    createdAt: string;
    escalatedAt: string | null;
  },
  criticalAckMinutes: number,
  nowMs: number,
): 1 | 2 | null {
  if (alert.severity !== 'CRITICAL' || alert.status !== 'OPEN') {
    return null;
  }
  const thresholdMs = Math.max(1, criticalAckMinutes) * 60_000;

  if (alert.escalationLevel === 0) {
    const createdMs = Date.parse(alert.createdAt);
    if (!Number.isFinite(createdMs)) return null;
    return nowMs - createdMs >= thresholdMs ? 1 : null;
  }

  if (alert.escalationLevel === 1) {
    const baseMs = Date.parse(alert.escalatedAt ?? alert.createdAt);
    if (!Number.isFinite(baseMs)) return null;
    return nowMs - baseMs >= thresholdMs ? 2 : null;
  }

  return null;
}

/**
 * Given the new attempt count after a failed delivery (1 = initial attempt failed,
 * 2 = 1st retry failed, 3 = 2nd retry failed, 4 = 3rd retry failed), returns the backoff
 * delay in ms for the next retry, or `null` when retries are exhausted and the email
 * should be marked FAILED.
 */
export function computeEmailRetryDelayMs(failedAttemptsCount: number): number | null {
  if (failedAttemptsCount <= 0) return EMAIL_RETRY_DELAYS_MS[0];
  const retryIndex = failedAttemptsCount - 1;
  if (retryIndex < EMAIL_RETRY_DELAYS_MS.length) {
    return EMAIL_RETRY_DELAYS_MS[retryIndex];
  }
  return null;
}
