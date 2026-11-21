import type { DeviceModel, MetricDefinition } from '../../../shared/types.ts';
import type {
  DeviceModelListFilter,
  IDeviceModelRepository,
  TenantContext,
} from '../repositories/types.ts';
import { Errors } from '../utils/errors.ts';
import { generateId } from '../utils/ids.ts';
import type { AuditService } from './auditService.ts';

function validateMetricDefinitions(metrics: MetricDefinition[]): MetricDefinition[] {
  const seenKeys = new Set<string>();
  return metrics.map((m) => {
    const key = m.key.trim();
    if (seenKeys.has(key.toLowerCase())) {
      throw Errors.validation(`Duplicate metric key "${key}" in device model`, {
        field: 'metrics',
      });
    }
    seenKeys.add(key.toLowerCase());

    if (m.type === 'number' && m.min !== null && m.max !== null && m.min > m.max) {
      throw Errors.validation(`Metric "${key}" min (${m.min}) cannot exceed max (${m.max})`, {
        field: 'metrics',
      });
    }

    return {
      key,
      label: m.label.trim(),
      type: m.type,
      unit: m.unit.trim(),
      min: m.type === 'number' ? m.min : null,
      max: m.type === 'number' ? m.max : null,
    };
  });
}

export class DeviceModelService {
  constructor(
    private readonly models: IDeviceModelRepository,
    private readonly audit: AuditService,
  ) {}

  list(filter: DeviceModelListFilter): { items: DeviceModel[]; total: number } {
    return this.models.list(filter);
  }

  getById(id: string): DeviceModel {
    const model = this.models.findById(id);
    if (!model) {
      throw Errors.notFound('Device model not found');
    }
    return model;
  }

  create(
    ctx: TenantContext,
    input: {
      name: string;
      manufacturer: string;
      hardwareRevision: string;
      metrics: MetricDefinition[];
      supportedFirmwareFamily: string;
    },
    ip: string,
  ): DeviceModel {
    const existing = this.models.findByName(input.name);
    if (existing) {
      throw Errors.conflict(`Device model "${input.name.trim()}" already exists`, {
        field: 'name',
      });
    }

    const normalizedMetrics = validateMetricDefinitions(input.metrics);
    const created = this.models.create({
      id: generateId('mdl'),
      name: input.name.trim(),
      manufacturer: input.manufacturer.trim(),
      hardwareRevision: input.hardwareRevision.trim(),
      metrics: normalizedMetrics,
      supportedFirmwareFamily: input.supportedFirmwareFamily.trim(),
    });

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: null,
      action: 'DEVICE_MODEL_CREATED',
      targetType: 'DEVICE_MODEL',
      targetId: created.id,
      outcome: 'SUCCESS',
      ip,
      details: {
        name: created.name,
        manufacturer: created.manufacturer,
        hardwareRevision: created.hardwareRevision,
        metricCount: created.metrics.length,
      },
    });

    return created;
  }

  update(
    ctx: TenantContext,
    id: string,
    patch: {
      name?: string;
      manufacturer?: string;
      hardwareRevision?: string;
      metrics?: MetricDefinition[];
      supportedFirmwareFamily?: string;
    },
    ip: string,
  ): DeviceModel {
    const existing = this.models.findById(id);
    if (!existing) {
      throw Errors.notFound('Device model not found');
    }

    if (patch.name !== undefined) {
      const duplicate = this.models.findByName(patch.name);
      if (duplicate && duplicate.id !== existing.id) {
        throw Errors.conflict(`Device model "${patch.name.trim()}" already exists`, {
          field: 'name',
        });
      }
    }

    const normalizedMetrics =
      patch.metrics !== undefined ? validateMetricDefinitions(patch.metrics) : undefined;

    const updated = this.models.update(id, {
      ...patch,
      metrics: normalizedMetrics,
    });
    if (!updated) {
      throw Errors.notFound('Device model not found');
    }

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: null,
      action: 'DEVICE_MODEL_UPDATED',
      targetType: 'DEVICE_MODEL',
      targetId: updated.id,
      outcome: 'SUCCESS',
      ip,
      details: {
        name: updated.name,
        manufacturer: updated.manufacturer,
        hardwareRevision: updated.hardwareRevision,
        metricCount: updated.metrics.length,
      },
    });

    return updated;
  }
}
