import type {
  AlertDetail,
  AlertPublic,
  AlertRule,
  DeviceHealthSnapshot,
  DeviceLifecycleState,
  RoleCode,
} from '../../../shared/types.ts';
import type { Repositories } from '../repositories/index.ts';
import type { AlertListFilter, TenantContext, UserRecord } from '../repositories/types.ts';
import { Errors } from '../utils/errors.ts';
import { generateId } from '../utils/ids.ts';
import {
  computeNextEscalationLevel,
  evaluateComparison,
  extractNumericMetricValue,
  formatOperatorSymbol,
  isDeviceSuppressedForAlerts,
  ruleMatchesDevice,
} from './alertEvaluationLogic.ts';
import type { AuditService } from './auditService.ts';
import type { AlertEvaluationHook, LiveStateStore } from './liveStateStore.ts';
import type { NotificationService } from './notificationService.ts';

/**
 * Implements Alert Queue actions (list, detail, acknowledge, close),
 * Section 8.4 real-time rule evaluation (threshold + duration + de-duplication + suppression + no auto-close),
 * Section 8.9 OFFLINE rule evaluation, and Section 8.9 Escalation (Level 1 -> Level 2).
 */
export class AlertService implements AlertEvaluationHook {
  /** In-memory breach start timestamps keyed by `${deviceId}:${ruleId}` (Section 8.4). */
  private readonly breachSinceMs = new Map<string, number>();

  constructor(
    private readonly repos: Repositories,
    private readonly liveState: LiveStateStore,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
  ) {}

  clearBreachesForRule(ruleId: string): void {
    const suffix = `:${ruleId}`;
    for (const key of this.breachSinceMs.keys()) {
      if (key.endsWith(suffix)) {
        this.breachSinceMs.delete(key);
      }
    }
  }

  clearBreachesForDevice(deviceId: string): void {
    const prefix = `${deviceId}:`;
    for (const key of this.breachSinceMs.keys()) {
      if (key.startsWith(prefix)) {
        this.breachSinceMs.delete(key);
      }
    }
  }

  // --- Web API Operations ---

  list(ctx: TenantContext, filter: AlertListFilter): { items: AlertPublic[]; total: number } {
    return this.repos.alerts.list(ctx, filter, true);
  }

  getDetail(ctx: TenantContext, id: string): AlertDetail {
    const alert = this.repos.alerts.findById(ctx, id);
    if (!alert) {
      throw Errors.notFound('Alert not found');
    }

    const auditLogs = this.repos.audit.list(
      {
        ...ctx,
        allTenants: false,
        tenantIds: [alert.tenantId],
        activeTenantId: alert.tenantId,
      },
      {
        targetType: 'ALERT',
        targetId: alert.id,
        page: 1,
        pageSize: 50,
        sortDir: 'asc',
      },
    );

    return {
      ...alert,
      timeline: auditLogs.items.map((a) => ({
        id: a.id,
        at: a.at,
        action: a.action,
        actorId: a.actorId,
        actorName: a.actorName ?? (a.actorId === 'SYSTEM' ? 'System' : a.actorId),
        details: a.details,
      })),
    };
  }

  acknowledge(ctx: TenantContext, id: string, ip: string): AlertPublic {
    const existing = this.repos.alerts.findById(ctx, id);
    if (!existing) {
      throw Errors.notFound('Alert not found');
    }
    if (existing.status === 'CLOSED') {
      throw Errors.invalidTransition('Closed alerts cannot be acknowledged');
    }
    if (existing.status === 'ACKNOWLEDGED') {
      throw Errors.invalidTransition('Alert is already acknowledged');
    }

    const nowIso = new Date().toISOString();
    const updated = this.repos.alerts.acknowledge(ctx, id, ctx.userId, nowIso);
    if (!updated) {
      throw Errors.notFound('Alert not found');
    }

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: existing.tenantId,
      action: 'ALERT_ACKNOWLEDGED',
      targetType: 'ALERT',
      targetId: updated.id,
      outcome: 'SUCCESS',
      ip,
      details: {
        deviceId: existing.deviceId,
        severity: existing.severity,
        acknowledgedAt: nowIso,
      },
    });

    return updated;
  }

  close(ctx: TenantContext, id: string, reason: string, ip: string): AlertPublic {
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      throw Errors.validation('Close reason must be at least 3 characters', { field: 'reason' });
    }

    const existing = this.repos.alerts.findById(ctx, id);
    if (!existing) {
      throw Errors.notFound('Alert not found');
    }
    if (existing.status === 'CLOSED') {
      throw Errors.invalidTransition('Alert is already closed');
    }

    const nowIso = new Date().toISOString();
    const updated = this.repos.alerts.close(ctx, id, ctx.userId, trimmed, nowIso);
    if (!updated) {
      throw Errors.notFound('Alert not found');
    }

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: existing.tenantId,
      action: 'ALERT_CLOSED',
      targetType: 'ALERT',
      targetId: updated.id,
      outcome: 'SUCCESS',
      ip,
      details: {
        deviceId: existing.deviceId,
        severity: existing.severity,
        reason: trimmed,
        closedAt: nowIso,
      },
    });

    return updated;
  }

  // --- Section 8.4 Evaluation Hook (called asynchronously after telemetry/heartbeat 202) ---

  onTelemetryOrHeartbeat(event: {
    tenantId: string;
    deviceId: string;
    modelId: string;
    siteId: string;
    state: DeviceLifecycleState;
    timestamp: string;
    metrics: Record<string, number | boolean | string>;
    health: DeviceHealthSnapshot;
  }): void {
    this.evaluateTelemetryEvent(event, Date.parse(event.timestamp) || Date.now());
  }

  /**
   * Exposed publicly so deterministic Vitest tests (Test 5) can pass explicit timestamps
   * for duration evaluation without sleeping.
   */
  evaluateTelemetryEvent(
    event: {
      tenantId: string;
      deviceId: string;
      modelId: string;
      siteId: string;
      state: DeviceLifecycleState;
      timestamp: string;
      metrics: Record<string, number | boolean | string>;
      health: DeviceHealthSnapshot;
    },
    evalNowMs = Date.now(),
  ): { createdAlertIds: string[] } {
    const createdAlertIds: string[] = [];

    // Re-check latest authoritative device state so lifecycle changes suppress immediately
    const latestLive = this.liveState.get(event.deviceId);
    const dbDevice = this.repos.devices.findByIdSystem(event.deviceId);
    const effectiveState = latestLive?.state ?? dbDevice?.state ?? event.state;

    // Suppression (FR-ALR-02 & FR-MNT-06): never raise alerts for SUSPENDED, UNDER_MAINTENANCE, or DECOMMISSIONED
    if (isDeviceSuppressedForAlerts(effectiveState)) {
      this.clearBreachesForDevice(event.deviceId);
      return { createdAlertIds };
    }

    const rules = this.repos.alertRules.listEnabledByTenantSystem(event.tenantId);
    const deviceTarget = { id: event.deviceId, modelId: event.modelId, siteId: event.siteId };

    for (const rule of rules) {
      if (rule.kind !== 'THRESHOLD') continue;
      if (!rule.metricKey || !rule.operator || rule.threshold === null) continue;
      if (!ruleMatchesDevice(rule, deviceTarget)) continue;

      const value = extractNumericMetricValue(rule.metricKey, event.metrics, event.health);
      if (value === null) continue;

      const key = `${event.deviceId}:${rule.id}`;
      const breached = evaluateComparison(value, rule.operator, rule.threshold);

      if (!breached) {
        // Condition returned to normal: clear duration tracker ONLY — NEVER auto-close existing alerts (Section 5.3)
        this.breachSinceMs.delete(key);
        continue;
      }

      let startMs = this.breachSinceMs.get(key);
      if (startMs === undefined) {
        startMs = evalNowMs;
        this.breachSinceMs.set(key, startMs);
      }

      const requiredMs = Math.max(0, rule.durationSec) * 1000;
      if (evalNowMs - startMs < requiredMs) {
        continue;
      }

      // De-duplication: skip if OPEN or ACKNOWLEDGED alert already exists for this device & rule
      const existingActive = this.repos.alerts.findActiveByDeviceAndRuleSystem(event.deviceId, rule.id);
      if (existingActive) {
        continue;
      }

      const opSym = formatOperatorSymbol(rule.operator);
      const durationLabel = rule.durationSec > 0 ? ` for ${rule.durationSec}s` : '';
      const message = `${rule.name}: ${rule.metricKey} is ${value} (${opSym} ${rule.threshold}${durationLabel})`;

      const alert = this.createAlertAndNotify({
        rule,
        deviceId: event.deviceId,
        deviceName: dbDevice?.name ?? event.deviceId,
        siteName: dbDevice?.siteName ?? '',
        tenantId: event.tenantId,
        message,
        snapshot: {
          kind: 'THRESHOLD',
          metricKey: rule.metricKey,
          value,
          operator: rule.operator,
          threshold: rule.threshold,
          durationSec: rule.durationSec,
          breachSince: new Date(startMs).toISOString(),
          timestamp: event.timestamp,
          metrics: event.metrics,
          health: event.health,
        },
        createdAt: new Date(evalNowMs).toISOString(),
      });
      createdAlertIds.push(alert.id);
    }

    return { createdAlertIds };
  }

  onDeviceOffline(event: {
    tenantId: string;
    deviceId: string;
    modelId: string;
    siteId: string;
    state: DeviceLifecycleState;
    lastSeenAt: string | null;
    detectedAt: string;
  }): void {
    const detectedMs = Date.parse(event.detectedAt) || Date.now();
    this.evaluateOfflineForDevice(event, detectedMs);
  }

  /**
   * Evaluates all enabled OFFLINE rules against all currently OFFLINE devices (called on every 15s offline sweep).
   */
  evaluateOfflineRules(nowMs = Date.now()): { createdAlertIds: string[] } {
    const createdAlertIds: string[] = [];
    const offlineRules = this.repos.alertRules.listEnabledOfflineRulesSystem();
    if (offlineRules.length === 0) return { createdAlertIds };

    const rulesByTenant = new Map<string, AlertRule[]>();
    for (const r of offlineRules) {
      const arr = rulesByTenant.get(r.tenantId) ?? [];
      arr.push(r);
      rulesByTenant.set(r.tenantId, arr);
    }

    const allDevices = this.repos.devices.listAllSystem();
    for (const d of allDevices) {
      const merged = this.liveState.mergeIntoDevice(d);
      if (merged.connectivity !== 'OFFLINE') continue;
      if (isDeviceSuppressedForAlerts(merged.state)) continue;
      if (!rulesByTenant.has(merged.tenantId)) continue;

      const res = this.evaluateOfflineForDevice(
        {
          tenantId: merged.tenantId,
          deviceId: merged.id,
          modelId: merged.modelId,
          siteId: merged.siteId,
          state: merged.state,
          lastSeenAt: merged.lastSeenAt,
          detectedAt: new Date(nowMs).toISOString(),
        },
        nowMs,
      );
      createdAlertIds.push(...res.createdAlertIds);
    }

    return { createdAlertIds };
  }

  private evaluateOfflineForDevice(
    event: {
      tenantId: string;
      deviceId: string;
      modelId: string;
      siteId: string;
      state: DeviceLifecycleState;
      lastSeenAt: string | null;
      detectedAt: string;
    },
    nowMs: number,
  ): { createdAlertIds: string[] } {
    const createdAlertIds: string[] = [];
    const latestLive = this.liveState.get(event.deviceId);
    const dbDevice = this.repos.devices.findByIdSystem(event.deviceId);
    const effectiveState = latestLive?.state ?? dbDevice?.state ?? event.state;

    if (isDeviceSuppressedForAlerts(effectiveState)) {
      return { createdAlertIds };
    }

    const tenant = this.repos.tenants.findByIdSystem(event.tenantId);
    const defaultOfflineSec =
      (tenant?.settings.heartbeatIntervalSec ?? 30) *
      (tenant?.settings.offlineAfterMissedIntervals ?? 3);

    const lastSeenMs = event.lastSeenAt ? Date.parse(event.lastSeenAt) : NaN;
    const silentMs = Number.isFinite(lastSeenMs) ? nowMs - lastSeenMs : defaultOfflineSec * 1000;

    const rules = this.repos.alertRules
      .listEnabledByTenantSystem(event.tenantId)
      .filter((r) => r.kind === 'OFFLINE');

    const deviceTarget = { id: event.deviceId, modelId: event.modelId, siteId: event.siteId };

    for (const rule of rules) {
      if (!ruleMatchesDevice(rule, deviceTarget)) continue;

      const requiredSec = rule.durationSec > 0 ? rule.durationSec : defaultOfflineSec;
      if (silentMs < requiredSec * 1000) continue;

      const existingActive = this.repos.alerts.findActiveByDeviceAndRuleSystem(event.deviceId, rule.id);
      if (existingActive) continue;

      const silentSecRounded = Math.max(requiredSec, Math.round(silentMs / 1000));
      const message = `${rule.name}: device silent for ${silentSecRounded}s (threshold ${requiredSec}s)`;

      const alert = this.createAlertAndNotify({
        rule,
        deviceId: event.deviceId,
        deviceName: dbDevice?.name ?? event.deviceId,
        siteName: dbDevice?.siteName ?? '',
        tenantId: event.tenantId,
        message,
        snapshot: {
          kind: 'OFFLINE',
          lastSeenAt: event.lastSeenAt,
          silentSec: silentSecRounded,
          durationSec: requiredSec,
          detectedAt: event.detectedAt,
        },
        createdAt: new Date(nowMs).toISOString(),
      });
      createdAlertIds.push(alert.id);
    }

    return { createdAlertIds };
  }

  private createAlertAndNotify(params: {
    rule: AlertRule;
    deviceId: string;
    deviceName: string;
    siteName: string;
    tenantId: string;
    message: string;
    snapshot: Record<string, unknown>;
    createdAt: string;
  }): AlertPublic {
    const alertId = generateId('alr');
    const alert = this.repos.alerts.createSystem({
      id: alertId,
      tenantId: params.tenantId,
      ruleId: params.rule.id,
      deviceId: params.deviceId,
      severity: params.rule.severity,
      status: 'OPEN',
      message: params.message,
      snapshot: params.snapshot,
      createdAt: params.createdAt,
    });

    this.audit.record({
      actorId: 'SYSTEM',
      actorRole: 'SYSTEM',
      tenantId: params.tenantId,
      action: 'ALERT_CREATED',
      targetType: 'ALERT',
      targetId: alert.id,
      outcome: 'SUCCESS',
      ip: '127.0.0.1',
      details: {
        ruleId: params.rule.id,
        ruleName: params.rule.name,
        deviceId: params.deviceId,
        severity: params.rule.severity,
        message: params.message,
      },
    });

    const recipients = this.resolveRecipientsForRule(params.tenantId, params.rule);
    const link = `/alerts?alertId=${alert.id}`;
    const tenant = this.repos.tenants.findByIdSystem(params.tenantId);

    this.notifications.notifyUsersSystem(recipients, {
      tenantId: params.tenantId,
      type: 'ALERT_CREATED',
      title: `[${params.rule.severity}] ${params.deviceName}: ${params.rule.name}`,
      body: params.message,
      link,
      emailSubject: `[OmniSphere ${params.rule.severity}] ${params.deviceName} — ${params.rule.name}`,
      emailSummary: params.message,
      emailFacts: [
        { label: 'Organization', value: tenant ? `${tenant.name} (${tenant.code})` : params.tenantId },
        { label: 'Device', value: params.deviceName },
        ...(params.siteName ? [{ label: 'Site', value: params.siteName }] : []),
        { label: 'Rule', value: params.rule.name },
        { label: 'Severity', value: params.rule.severity },
      ],
      emailCtaLabel: 'Open Alert in OmniSphere',
      relatedType: 'ALERT',
      relatedId: alert.id,
    });

    return alert;
  }

  /**
   * Section 8.4 recipient resolution:
   * Default recipients when a rule has none: all active CA and CO users of the tenant
   * and all active SE users assigned to the tenant.
   */
  private resolveRecipientsForRule(tenantId: string, rule: AlertRule): UserRecord[] {
    const activeUsers = this.repos.users.listAllActiveSystem();

    if (!rule.recipients || rule.recipients.length === 0) {
      return activeUsers.filter(
        (u) =>
          (u.tenantId === tenantId && (u.role === 'CLIENT_ADMIN' || u.role === 'CLIENT_OPERATOR')) ||
          (u.role === 'SUPPORT_ENGINEER' && u.assignedTenantIds.includes(tenantId)),
      );
    }

    const matched: UserRecord[] = [];
    const seen = new Set<string>();
    const add = (u: UserRecord) => {
      if (seen.has(u.id)) return;
      seen.add(u.id);
      matched.push(u);
    };

    for (const r of rule.recipients) {
      if (r.type === 'USER' && r.userId) {
        const u = activeUsers.find((cand) => cand.id === r.userId);
        if (
          u &&
          (u.role === 'PLATFORM_ADMIN' ||
            u.tenantId === tenantId ||
            u.assignedTenantIds.includes(tenantId))
        ) {
          add(u);
        }
      } else if (r.type === 'ROLE' && r.role) {
        const roleCode: RoleCode = r.role;
        for (const u of activeUsers) {
          if (u.role !== roleCode) continue;
          if (
            roleCode === 'PLATFORM_ADMIN' ||
            u.tenantId === tenantId ||
            u.assignedTenantIds.includes(tenantId)
          ) {
            add(u);
          }
        }
      }
    }

    return matched;
  }

  // --- Section 8.9 Escalation Job (every 60s) ---

  runEscalationCheckOnce(nowMs = Date.now()): {
    escalatedToLevel1: string[];
    escalatedToLevel2: string[];
  } {
    const escalatedToLevel1: string[] = [];
    const escalatedToLevel2: string[] = [];
    const openCriticals = this.repos.alerts.listOpenCriticalForEscalationSystem();
    if (openCriticals.length === 0) {
      return { escalatedToLevel1, escalatedToLevel2 };
    }

    const nowIso = new Date(nowMs).toISOString();
    const activeUsers = this.repos.users.listAllActiveSystem();

    for (const alert of openCriticals) {
      const tenant = this.repos.tenants.findByIdSystem(alert.tenantId);
      const criticalAckMinutes = tenant?.settings.criticalAckMinutes ?? 15;
      const nextLevel = computeNextEscalationLevel(alert, criticalAckMinutes, nowMs);
      if (!nextLevel) continue;

      const updated = this.repos.alerts.updateEscalationSystem(alert.id, nextLevel, nowIso);
      if (!updated) continue;

      this.audit.record({
        actorId: 'SYSTEM',
        actorRole: 'SYSTEM',
        tenantId: alert.tenantId,
        action: 'ALERT_ESCALATED',
        targetType: 'ALERT',
        targetId: alert.id,
        outcome: 'SUCCESS',
        ip: '127.0.0.1',
        details: {
          deviceId: alert.deviceId,
          previousLevel: alert.escalationLevel,
          newLevel: nextLevel,
          criticalAckMinutes,
        },
      });

      let recipients: UserRecord[];
      if (nextLevel === 1) {
        // Level 1: notify tenant's CA users
        recipients = activeUsers.filter(
          (u) => u.tenantId === alert.tenantId && u.role === 'CLIENT_ADMIN',
        );
        escalatedToLevel1.push(alert.id);
      } else {
        // Level 2: notify SE supervisors assigned to tenant AND PA users
        recipients = activeUsers.filter(
          (u) =>
            u.role === 'PLATFORM_ADMIN' ||
            (u.role === 'SUPPORT_ENGINEER' &&
              u.isSupervisor &&
              u.assignedTenantIds.includes(alert.tenantId)),
        );
        escalatedToLevel2.push(alert.id);
      }

      const deviceLabel = alert.deviceName ?? alert.deviceId;
      const link = `/alerts?alertId=${alert.id}`;
      this.notifications.notifyUsersSystem(recipients, {
        tenantId: alert.tenantId,
        type: 'ALERT_ESCALATED',
        title: `Escalation L${nextLevel}: Unacknowledged CRITICAL alert on ${deviceLabel}`,
        body: `Alert "${alert.message}" has remained OPEN beyond ${criticalAckMinutes} minute(s).`,
        link,
        emailSubject: `[ESCALATION L${nextLevel}] CRITICAL alert unacknowledged — ${deviceLabel}`,
        emailSummary: `A CRITICAL alert on ${deviceLabel} has not been acknowledged within ${criticalAckMinutes} minute(s) and has been escalated to Level ${nextLevel}.`,
        emailFacts: [
          { label: 'Organization', value: tenant ? `${tenant.name} (${tenant.code})` : alert.tenantId },
          { label: 'Device', value: deviceLabel },
          { label: 'Escalation Level', value: `Level ${nextLevel}` },
          { label: 'Alert Message', value: alert.message },
        ],
        emailCtaLabel: 'Acknowledge Alert Now',
        relatedType: 'ALERT',
        relatedId: alert.id,
      });
    }

    return { escalatedToLevel1, escalatedToLevel2 };
  }
}
