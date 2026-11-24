import type { AlertRuleKind, AlertOperator, AlertScopeType, AlertSeverity, RoleCode } from '../../../shared/types.ts';
import type { Repositories } from '../repositories/index.ts';
import type { TenantContext } from '../repositories/types.ts';
import { AuditService } from '../services/auditService.ts';
import { generateId } from '../utils/ids.ts';

const SYSTEM_PA_CTX: TenantContext = {
  userId: 'SYSTEM',
  role: 'PLATFORM_ADMIN',
  allTenants: true,
  tenantIds: [],
  activeTenantId: null,
};

interface SeedTenantAlertConfig {
  tenantId: string;
  code: string;
  name: string;
  primarySiteId: string;
  primarySiteName: string;
  secondarySiteName: string;
}

const TENANT_CONFIGS: SeedTenantAlertConfig[] = [
  {
    tenantId: 'ten_ktl',
    code: 'KTL',
    name: 'Karnafuli Textiles Ltd',
    primarySiteId: 'sit_ktl_dye',
    primarySiteName: 'Dyeing Plant',
    secondarySiteName: 'Packing Line',
  },
  {
    tenantId: 'ten_mfp',
    code: 'MFP',
    name: 'Meghna Food Processing',
    primarySiteId: 'sit_mfp_cld',
    primarySiteName: 'Cold Storage',
    secondarySiteName: 'Bottling Line',
  },
  {
    tenantId: 'ten_scw',
    code: 'SCW',
    name: 'Sundarban Cement Works',
    primarySiteId: 'sit_scw_kln',
    primarySiteName: 'Kiln Unit 1',
    secondarySiteName: 'Grinding Mill',
  },
];

interface SeedRuleTemplate {
  suffix: string;
  name: string;
  kind: AlertRuleKind;
  metricKey: string | null;
  operator: AlertOperator | null;
  threshold: number | null;
  durationSec: number;
  severity: AlertSeverity;
  scopeType: AlertScopeType;
  scopeId: (tc: SeedTenantAlertConfig) => string;
}

const DEFAULT_RULE_TEMPLATES: SeedRuleTemplate[] = [
  {
    suffix: 'offline_90s',
    name: 'Offline for 90 s',
    kind: 'OFFLINE',
    metricKey: null,
    operator: null,
    threshold: null,
    durationSec: 90,
    severity: 'CRITICAL',
    scopeType: 'SITE',
    scopeId: (tc) => tc.primarySiteId,
  },
  {
    suffix: 'high_temp_vm310',
    name: 'High temperature (VM-310)',
    kind: 'THRESHOLD',
    metricKey: 'temperature',
    operator: 'GT',
    threshold: 85,
    durationSec: 30,
    severity: 'CRITICAL',
    scopeType: 'MODEL',
    scopeId: () => 'mdl_vm310',
  },
  {
    suffix: 'high_temp_th200',
    name: 'High temperature (TH-200)',
    kind: 'THRESHOLD',
    metricKey: 'temperature',
    operator: 'GT',
    threshold: 40,
    durationSec: 30,
    severity: 'WARNING',
    scopeType: 'MODEL',
    scopeId: () => 'mdl_th200',
  },
  {
    suffix: 'low_battery',
    name: 'Low battery',
    kind: 'THRESHOLD',
    metricKey: 'batteryLevel',
    operator: 'LT',
    threshold: 20,
    durationSec: 0,
    severity: 'WARNING',
    scopeType: 'MODEL',
    scopeId: () => 'mdl_th200',
  },
  {
    suffix: 'high_cpu',
    name: 'High CPU',
    kind: 'THRESHOLD',
    metricKey: 'cpuLoad',
    operator: 'GT',
    threshold: 90,
    durationSec: 60,
    severity: 'WARNING',
    scopeType: 'SITE',
    scopeId: (tc) => tc.primarySiteId,
  },
];

function renderSeedEmailHtml(title: string, summary: string, facts: Array<[string, string]>, link: string): string {
  const rows = facts
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#64748b;font-size:13px;">${k}</td><td style="padding:6px 0;color:#0f172a;font-size:13px;font-weight:600;">${v}</td></tr>`,
    )
    .join('');
  return `<!doctype html><html><body style="font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;padding:24px;color:#0f172a;"><div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:24px;"><p style="margin:0 0 8px 0;font-size:12px;font-weight:600;color:#4f46e5;letter-spacing:0.04em;">OMNISPHERE</p><h1 style="margin:0 0 12px 0;font-size:18px;color:#0f172a;">${title}</h1><p style="margin:0 0 16px 0;font-size:14px;line-height:1.6;color:#334155;">${summary}</p><table style="border-collapse:collapse;width:100%;margin-top:8px;">${rows}</table><p style="margin:24px 0 0 0;"><a href="http://localhost:3000${link}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px;">Open Alert in OmniSphere</a></p></div></body></html>`;
}

/**
 * Section 15 Milestone 4 demo seed (idempotent):
 * - 5 default alert rules per tenant (Offline 90s, High temp VM-310, High temp TH-200, Low battery, High CPU)
 * - 2 CLOSED alerts + 1 OPEN CRITICAL alert per tenant (created 2 minutes ago so it sits at escalation level 0)
 * - Initial in-app notifications & SENT email outbox entries for each tenant's open critical alert
 */
export function seedMilestone4Data(
  repos: Repositories,
  options: { actorId?: string; actorRole?: RoleCode | 'SYSTEM'; ip?: string } = {},
): { alertRulesCreated: number; alertsCreated: number; notificationsCreated: number } {
  const audit = new AuditService(repos.audit);
  const actorId = options.actorId ?? 'SYSTEM';
  const actorRole = options.actorRole ?? 'SYSTEM';
  const ip = options.ip ?? '127.0.0.1';
  const nowMs = Date.now();

  let alertRulesCreated = 0;
  let alertsCreated = 0;
  let notificationsCreated = 0;

  const activeUsers = repos.users.listAllActiveSystem();

  for (const tc of TENANT_CONFIGS) {
    if (!repos.tenants.findByIdSystem(tc.tenantId)) continue;
    const codeLower = tc.code.toLowerCase();

    // 1. Seed default alert rules
    for (const tmpl of DEFAULT_RULE_TEMPLATES) {
      const ruleId = `arl_${codeLower}_${tmpl.suffix}`;
      if (repos.alertRules.findByIdSystem(ruleId)) continue;

      repos.alertRules.create(SYSTEM_PA_CTX, {
        id: ruleId,
        tenantId: tc.tenantId,
        name: tmpl.name,
        kind: tmpl.kind,
        metricKey: tmpl.metricKey,
        operator: tmpl.operator,
        threshold: tmpl.threshold,
        durationSec: tmpl.durationSec,
        severity: tmpl.severity,
        scopeType: tmpl.scopeType,
        scopeId: tmpl.scopeId(tc),
        recipients: [],
        enabled: true,
      });
      alertRulesCreated += 1;

      audit.record({
        actorId,
        actorRole,
        tenantId: tc.tenantId,
        action: 'ALERT_RULE_CREATED',
        targetType: 'ALERT_RULE',
        targetId: ruleId,
        outcome: 'SUCCESS',
        ip,
        details: { name: tmpl.name, kind: tmpl.kind, severity: tmpl.severity, seeded: true },
      });
    }

    // 2. Seed 2 CLOSED alerts + 1 OPEN CRITICAL alert per tenant
    // Keep dev_*_001 and dev_*_002 free of OPEN alerts for smooth live spike demonstrations
    const closedAlert1Id = `alr_${codeLower}_closed_1`;
    const dev1Id = `dev_${codeLower}_001`;
    if (!repos.alerts.findByIdSystem(closedAlert1Id) && repos.devices.findByIdSystem(dev1Id)) {
      const createdAt = new Date(nowMs - 4 * 86400_000).toISOString();
      const ackAt = new Date(nowMs - 4 * 86400_000 + 8 * 60_000).toISOString();
      const closedAt = new Date(nowMs - 4 * 86400_000 + 42 * 60_000).toISOString();
      repos.alerts.createSystem({
        id: closedAlert1Id,
        tenantId: tc.tenantId,
        ruleId: `arl_${codeLower}_high_temp_th200`,
        deviceId: dev1Id,
        severity: 'WARNING',
        status: 'OPEN',
        message: 'High temperature (TH-200): temperature is 43.8 (> 40 for 30s)',
        snapshot: {
          kind: 'THRESHOLD',
          metricKey: 'temperature',
          value: 43.8,
          operator: 'GT',
          threshold: 40,
          durationSec: 30,
          timestamp: createdAt,
        },
        createdAt,
      });
      repos.alerts.acknowledge(SYSTEM_PA_CTX, closedAlert1Id, `usr_${codeLower}_co1`, ackAt);
      repos.alerts.close(
        SYSTEM_PA_CTX,
        closedAlert1Id,
        'usr_se_noc1',
        'HVAC intake filter cleared and ambient temperature stabilized',
        closedAt,
      );
      alertsCreated += 1;
      audit.record({
        actorId: 'usr_se_noc1',
        actorRole: 'SUPPORT_ENGINEER',
        tenantId: tc.tenantId,
        action: 'ALERT_CLOSED',
        targetType: 'ALERT',
        targetId: closedAlert1Id,
        outcome: 'SUCCESS',
        ip,
        details: {
          deviceId: dev1Id,
          reason: 'HVAC intake filter cleared and ambient temperature stabilized',
          seeded: true,
        },
      });
    }

    const closedAlert2Id = `alr_${codeLower}_closed_2`;
    const dev3Id = `dev_${codeLower}_003`;
    if (!repos.alerts.findByIdSystem(closedAlert2Id) && repos.devices.findByIdSystem(dev3Id)) {
      const createdAt = new Date(nowMs - 2 * 86400_000).toISOString();
      const ackAt = new Date(nowMs - 2 * 86400_000 + 5 * 60_000).toISOString();
      const closedAt = new Date(nowMs - 2 * 86400_000 + 25 * 60_000).toISOString();
      repos.alerts.createSystem({
        id: closedAlert2Id,
        tenantId: tc.tenantId,
        ruleId: `arl_${codeLower}_high_cpu`,
        deviceId: dev3Id,
        severity: 'WARNING',
        status: 'OPEN',
        message: 'High CPU: cpuLoad is 94.2 (> 90 for 60s)',
        snapshot: {
          kind: 'THRESHOLD',
          metricKey: 'cpuLoad',
          value: 94.2,
          operator: 'GT',
          threshold: 90,
          durationSec: 60,
          timestamp: createdAt,
        },
        createdAt,
      });
      repos.alerts.acknowledge(SYSTEM_PA_CTX, closedAlert2Id, `usr_${codeLower}_ca`, ackAt);
      repos.alerts.close(
        SYSTEM_PA_CTX,
        closedAlert2Id,
        'usr_se_noc1',
        'Remote restart completed and telemetry polling returned to normal CPU load',
        closedAt,
      );
      alertsCreated += 1;
      audit.record({
        actorId: 'usr_se_noc1',
        actorRole: 'SUPPORT_ENGINEER',
        tenantId: tc.tenantId,
        action: 'ALERT_CLOSED',
        targetType: 'ALERT',
        targetId: closedAlert2Id,
        outcome: 'SUCCESS',
        ip,
        details: {
          deviceId: dev3Id,
          reason: 'Remote restart completed and telemetry polling returned to normal CPU load',
          seeded: true,
        },
      });
    }

    // 1 OPEN CRITICAL alert on slot 6 (VM-310 on secondary site)
    const openCritId = `alr_${codeLower}_open_crit_1`;
    const dev6Id = `dev_${codeLower}_006`;
    const dev6 = repos.devices.findByIdSystem(dev6Id);
    if (!repos.alerts.findByIdSystem(openCritId) && dev6) {
      const createdAt = new Date(nowMs - 2 * 60_000).toISOString();
      const message = 'High temperature (VM-310): temperature is 91.4 (> 85 for 30s)';
      repos.alerts.createSystem({
        id: openCritId,
        tenantId: tc.tenantId,
        ruleId: `arl_${codeLower}_high_temp_vm310`,
        deviceId: dev6Id,
        severity: 'CRITICAL',
        status: 'OPEN',
        message,
        snapshot: {
          kind: 'THRESHOLD',
          metricKey: 'temperature',
          value: 91.4,
          operator: 'GT',
          threshold: 85,
          durationSec: 30,
          timestamp: createdAt,
          metrics: { temperature: 91.4, vibration_rms: 7.8 },
          health: { cpuLoad: 48.2, memoryUsage: 54.0, batteryLevel: 84, signalStrength: -64 },
        },
        createdAt,
      });
      alertsCreated += 1;

      audit.record({
        actorId: 'SYSTEM',
        actorRole: 'SYSTEM',
        tenantId: tc.tenantId,
        action: 'ALERT_CREATED',
        targetType: 'ALERT',
        targetId: openCritId,
        outcome: 'SUCCESS',
        ip,
        details: {
          ruleId: `arl_${codeLower}_high_temp_vm310`,
          ruleName: 'High temperature (VM-310)',
          deviceId: dev6Id,
          severity: 'CRITICAL',
          message,
          seeded: true,
        },
      });

      const link = `/alerts?alertId=${openCritId}`;
      const recipients = activeUsers.filter(
        (u) =>
          (u.tenantId === tc.tenantId &&
            (u.role === 'CLIENT_ADMIN' || u.role === 'CLIENT_OPERATOR')) ||
          (u.role === 'SUPPORT_ENGINEER' && u.assignedTenantIds.includes(tc.tenantId)),
      );

      for (const user of recipients) {
        repos.notifications.insertSystem({
          id: generateId('ntf'),
          tenantId: tc.tenantId,
          userId: user.id,
          type: 'ALERT_CREATED',
          title: `[CRITICAL] ${dev6.name}: High temperature (VM-310)`,
          body: message,
          link,
          read: false,
          createdAt,
        });
        notificationsCreated += 1;

        repos.emailOutbox.insert({
          id: generateId('eml'),
          tenantId: tc.tenantId,
          to: user.email,
          subject: `[OmniSphere CRITICAL] ${dev6.name} — High temperature (VM-310)`,
          body: renderSeedEmailHtml(
            `[OmniSphere CRITICAL] ${dev6.name} — High temperature (VM-310)`,
            message,
            [
              ['Organization', `${tc.name} (${tc.code})`],
              ['Device', dev6.name],
              ['Site', tc.secondarySiteName],
              ['Rule', 'High temperature (VM-310)'],
              ['Severity', 'CRITICAL'],
            ],
            link,
          ),
          status: 'SENT',
          attempts: 1,
          nextAttemptAt: null,
          lastError: null,
          relatedType: 'ALERT',
          relatedId: openCritId,
        });
      }
    }
  }

  return { alertRulesCreated, alertsCreated, notificationsCreated };
}
