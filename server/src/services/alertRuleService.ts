import {
  HEALTH_METRIC_KEYS,
  type AlertOperator,
  type AlertRecipient,
  type AlertRule,
  type AlertRuleKind,
  type AlertScopeType,
  type AlertSeverity,
} from '../../../shared/types.ts';
import type { Repositories } from '../repositories/index.ts';
import type { AlertRuleListFilter, TenantContext } from '../repositories/types.ts';
import { Errors } from '../utils/errors.ts';
import { generateId } from '../utils/ids.ts';
import type { AuditService } from './auditService.ts';

export interface CreateAlertRulePayload {
  name: string;
  kind: AlertRuleKind;
  metricKey?: string | null;
  operator?: AlertOperator | null;
  threshold?: number | null;
  durationSec: number;
  severity: AlertSeverity;
  scopeType: AlertScopeType;
  scopeId: string;
  recipients?: AlertRecipient[];
  enabled?: boolean;
}

export type UpdateAlertRulePayload = Partial<CreateAlertRulePayload>;

export class AlertRuleService {
  private onRuleChanged: ((ruleId: string) => void) | null = null;

  constructor(
    private readonly repos: Repositories,
    private readonly audit: AuditService,
  ) {}

  setOnRuleChanged(cb: ((ruleId: string) => void) | null): void {
    this.onRuleChanged = cb;
  }

  list(ctx: TenantContext, filter: AlertRuleListFilter): { items: AlertRule[]; total: number } {
    return this.repos.alertRules.list(ctx, filter);
  }

  getById(ctx: TenantContext, id: string): AlertRule {
    const rule = this.repos.alertRules.findById(ctx, id);
    if (!rule) {
      throw Errors.notFound('Alert rule not found');
    }
    return rule;
  }

  create(ctx: TenantContext, input: CreateAlertRulePayload, ip: string): AlertRule {
    const tenantId = this.resolveWorkingTenantId(ctx);
    const normalized = this.validateRuleShape(ctx, tenantId, {
      name: input.name.trim(),
      kind: input.kind,
      metricKey: input.metricKey ?? null,
      operator: input.operator ?? null,
      threshold: input.threshold ?? null,
      durationSec: input.durationSec,
      severity: input.severity,
      scopeType: input.scopeType,
      scopeId: input.scopeId.trim(),
      recipients: input.recipients ?? [],
      enabled: input.enabled ?? true,
    });

    const created = this.repos.alertRules.create(ctx, {
      id: generateId('arl'),
      tenantId,
      ...normalized,
    });

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId,
      action: 'ALERT_RULE_CREATED',
      targetType: 'ALERT_RULE',
      targetId: created.id,
      outcome: 'SUCCESS',
      ip,
      details: {
        name: created.name,
        kind: created.kind,
        metricKey: created.metricKey,
        operator: created.operator,
        threshold: created.threshold,
        durationSec: created.durationSec,
        severity: created.severity,
        scopeType: created.scopeType,
        scopeId: created.scopeId,
      },
    });

    return created;
  }

  update(ctx: TenantContext, id: string, patch: UpdateAlertRulePayload, ip: string): AlertRule {
    const existing = this.repos.alertRules.findById(ctx, id);
    if (!existing) {
      throw Errors.notFound('Alert rule not found');
    }

    const merged = this.validateRuleShape(ctx, existing.tenantId, {
      name: patch.name !== undefined ? patch.name.trim() : existing.name,
      kind: patch.kind ?? existing.kind,
      metricKey: patch.metricKey !== undefined ? patch.metricKey : existing.metricKey,
      operator: patch.operator !== undefined ? patch.operator : existing.operator,
      threshold: patch.threshold !== undefined ? patch.threshold : existing.threshold,
      durationSec: patch.durationSec ?? existing.durationSec,
      severity: patch.severity ?? existing.severity,
      scopeType: patch.scopeType ?? existing.scopeType,
      scopeId: patch.scopeId !== undefined ? patch.scopeId.trim() : existing.scopeId,
      recipients: patch.recipients ?? existing.recipients,
      enabled: patch.enabled ?? existing.enabled,
    });

    const updated = this.repos.alertRules.update(ctx, id, merged);
    if (!updated) {
      throw Errors.notFound('Alert rule not found');
    }

    this.onRuleChanged?.(id);

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: existing.tenantId,
      action: 'ALERT_RULE_UPDATED',
      targetType: 'ALERT_RULE',
      targetId: updated.id,
      outcome: 'SUCCESS',
      ip,
      details: {
        name: updated.name,
        enabled: updated.enabled,
        severity: updated.severity,
        threshold: updated.threshold,
        durationSec: updated.durationSec,
      },
    });

    return updated;
  }

  delete(ctx: TenantContext, id: string, ip: string): void {
    const existing = this.repos.alertRules.findById(ctx, id);
    if (!existing) {
      throw Errors.notFound('Alert rule not found');
    }
    const deleted = this.repos.alertRules.delete(ctx, id);
    if (!deleted) {
      throw Errors.notFound('Alert rule not found');
    }

    this.onRuleChanged?.(id);

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: existing.tenantId,
      action: 'ALERT_RULE_DELETED',
      targetType: 'ALERT_RULE',
      targetId: existing.id,
      outcome: 'SUCCESS',
      ip,
      details: { name: existing.name },
    });
  }

  private resolveWorkingTenantId(ctx: TenantContext): string {
    const tenantId = ctx.activeTenantId ?? (ctx.tenantIds.length === 1 ? ctx.tenantIds[0] : null);
    if (!tenantId) {
      throw Errors.validation('Select a working organization before creating an alert rule');
    }
    return tenantId;
  }

  private validateRuleShape(
    ctx: TenantContext,
    tenantId: string,
    rule: {
      name: string;
      kind: AlertRuleKind;
      metricKey: string | null;
      operator: AlertOperator | null;
      threshold: number | null;
      durationSec: number;
      severity: AlertSeverity;
      scopeType: AlertScopeType;
      scopeId: string;
      recipients: AlertRecipient[];
      enabled: boolean;
    },
  ) {
    if (rule.name.length < 2 || rule.name.length > 120) {
      throw Errors.validation('Rule name must be between 2 and 120 characters', { field: 'name' });
    }
    if (!Number.isInteger(rule.durationSec) || rule.durationSec < 0 || rule.durationSec > 86400) {
      throw Errors.validation('Duration must be an integer between 0 and 86400 seconds', {
        field: 'durationSec',
      });
    }

    const scopedCtx: TenantContext = {
      ...ctx,
      allTenants: false,
      tenantIds: [tenantId],
      activeTenantId: tenantId,
    };

    // Validate scope target exists within tenant
    let scopedModelId: string | null = null;
    if (rule.scopeType === 'DEVICE') {
      const device = this.repos.devices.findById(scopedCtx, rule.scopeId);
      if (!device) {
        throw Errors.validation('Target device not found in this organization', { field: 'scopeId' });
      }
      scopedModelId = device.modelId;
    } else if (rule.scopeType === 'SITE') {
      const site = this.repos.sites.findById(scopedCtx, rule.scopeId);
      if (!site) {
        throw Errors.validation('Target site not found in this organization', { field: 'scopeId' });
      }
    } else if (rule.scopeType === 'MODEL') {
      const model = this.repos.deviceModels.findById(rule.scopeId);
      if (!model) {
        throw Errors.validation('Target device model not found', { field: 'scopeId' });
      }
      scopedModelId = model.id;
    }

    if (rule.kind === 'OFFLINE') {
      return {
        ...rule,
        metricKey: null,
        operator: null,
        threshold: null,
      };
    }

    // THRESHOLD rule validations
    const metricKey = rule.metricKey?.trim() ?? '';
    if (!metricKey) {
      throw Errors.validation('Metric key is required for threshold rules', { field: 'metricKey' });
    }
    if (!rule.operator) {
      throw Errors.validation('Comparison operator is required for threshold rules', {
        field: 'operator',
      });
    }
    if (rule.threshold === null || !Number.isFinite(rule.threshold)) {
      throw Errors.validation('Numeric threshold is required for threshold rules', {
        field: 'threshold',
      });
    }

    const isHealthKey = (HEALTH_METRIC_KEYS as readonly string[]).includes(metricKey);
    if (!isHealthKey) {
      if (scopedModelId) {
        const model = this.repos.deviceModels.findById(scopedModelId);
        const metricDef = model?.metrics.find((m) => m.key === metricKey && m.type === 'number');
        if (!metricDef) {
          throw Errors.validation(
            `Metric "${metricKey}" is not a numeric metric on the selected device model or a health metric`,
            { field: 'metricKey' },
          );
        }
      } else {
        const allModels = this.repos.deviceModels.listAll();
        const existsAnywhere = allModels.some((m) =>
          m.metrics.some((def) => def.key === metricKey && def.type === 'number'),
        );
        if (!existsAnywhere) {
          throw Errors.validation(
            `Metric "${metricKey}" is not defined as a numeric metric on any device model or health field`,
            { field: 'metricKey' },
          );
        }
      }
    }

    return {
      ...rule,
      metricKey,
    };
  }
}
