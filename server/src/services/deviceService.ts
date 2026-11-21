import type {
  BulkDeviceActionResult,
  DeviceDetail,
  DeviceImportResponse,
  DeviceImportRowInput,
  DeviceImportRowResult,
  DeviceLifecycleAction,
  DeviceProvisioningPayload,
  DevicePublic,
  DeviceRegistrationResponse,
  DeviceTimelineEvent,
} from '../../../shared/types.ts';
import { config } from '../config.ts';
import {
  toDevicePublic,
  type DeviceListFilter,
  type IAuditRepository,
  type IDeviceModelRepository,
  type IDeviceRepository,
  type ISiteRepository,
  type ITenantRepository,
  type TenantContext,
} from '../repositories/types.ts';
import { Errors } from '../utils/errors.ts';
import { generateId } from '../utils/ids.ts';
import type { AuditService } from './auditService.ts';
import {
  actionToTargetState,
  generateDeviceApiKey,
  getAllowedTransitionsForActor,
  validateLifecycleTransition,
} from './deviceLifecycle.ts';

function normalizeTags(rawTags: string[] | undefined): string[] {
  if (!rawTags) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const t of rawTags) {
    const clean = t.trim().toLowerCase();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    result.push(clean);
  }
  return result.slice(0, 20);
}

function parseTagString(raw: string | undefined): string[] {
  if (!raw || !raw.trim()) return [];
  return normalizeTags(raw.split(/[,;|]/));
}

export class DeviceService {
  constructor(
    private readonly devices: IDeviceRepository,
    private readonly sites: ISiteRepository,
    private readonly models: IDeviceModelRepository,
    private readonly tenants: ITenantRepository,
    private readonly auditRepo: IAuditRepository,
    private readonly audit: AuditService,
  ) {}

  private resolveWriteTenantId(ctx: TenantContext): string {
    if (ctx.activeTenantId) {
      return ctx.activeTenantId;
    }
    if (ctx.tenantIds.length === 1) {
      return ctx.tenantIds[0];
    }
    throw Errors.validation('Select a working tenant before registering or modifying devices');
  }

  private buildProvisioningPayload(
    deviceId: string,
    apiKey: string,
    modelId: string,
    tenantCode: string,
  ): DeviceProvisioningPayload {
    const base = config.publicBaseUrl.replace(/\/+$/, '');
    return {
      deviceId,
      apiKey,
      apiBaseUrl: `${base}/device/v1`,
      modelId,
      tenantCode,
    };
  }

  list(ctx: TenantContext, filter: DeviceListFilter): { items: DevicePublic[]; total: number } {
    return this.devices.list(ctx, filter);
  }

  listDistinctTags(ctx: TenantContext): string[] {
    return this.devices.listDistinctTags(ctx);
  }

  getDetail(ctx: TenantContext, id: string): DeviceDetail {
    const record = this.devices.findById(ctx, id);
    if (!record) {
      throw Errors.notFound('Device not found');
    }

    const model = this.models.findById(record.modelId);
    const site = this.sites.findById(ctx, record.siteId);
    const allowedTransitions = getAllowedTransitionsForActor(record.state, ctx.role);

    return {
      ...toDevicePublic(record),
      model,
      site,
      allowedTransitions,
    };
  }

  register(
    ctx: TenantContext,
    input: {
      name: string;
      serialNumber: string;
      hardwareId: string;
      modelId: string;
      siteId: string;
      tags?: string[];
      configProfileId?: string | null;
    },
    ip: string,
  ): DeviceRegistrationResponse {
    const tenantId = this.resolveWriteTenantId(ctx);
    const tenant = this.tenants.findByIdSystem(tenantId);
    if (!tenant) {
      throw Errors.notFound('Tenant not found');
    }

    const site = this.sites.findById(ctx, input.siteId);
    if (!site || site.tenantId !== tenantId) {
      throw Errors.validation('Selected site does not exist in this organization', {
        field: 'siteId',
      });
    }

    const model = this.models.findById(input.modelId);
    if (!model) {
      throw Errors.validation('Selected device model does not exist', {
        field: 'modelId',
      });
    }

    const serialNumber = input.serialNumber.trim();
    const hardwareId = input.hardwareId.trim();

    // Platform-wide uniqueness checks (Section 8.3 #1)
    if (this.devices.findBySerialSystem(serialNumber)) {
      throw Errors.conflict(`Serial number "${serialNumber}" is already registered`, {
        field: 'serialNumber',
      });
    }
    if (this.devices.findByHardwareIdSystem(hardwareId)) {
      throw Errors.conflict(`Hardware ID "${hardwareId}" is already registered`, {
        field: 'hardwareId',
      });
    }

    const deviceId = generateId('dev');
    const { apiKey, apiKeyHash, apiKeyLast4 } = generateDeviceApiKey();
    const tags = normalizeTags(input.tags);
    const now = new Date().toISOString();

    try {
      const created = this.devices.createWithUniqueKeys(
        ctx,
        {
          id: deviceId,
          tenantId,
          siteId: site.id,
          modelId: model.id,
          name: input.name.trim(),
          serialNumber,
          hardwareId,
          tags,
          state: 'PROVISIONED',
          connectivity: 'UNKNOWN',
          apiKeyHash,
          apiKeyLast4,
          config: input.configProfileId
            ? {
                profileId: input.configProfileId,
                version: null,
                status: 'PENDING',
                error: null,
              }
            : { profileId: null, version: null, status: 'NONE', error: null },
        },
        {
          id: generateId('dsh'),
          tenantId,
          deviceId,
          from: null,
          to: 'PROVISIONED',
          reason: 'Device registered',
          actorId: ctx.userId,
          at: now,
        },
      );

      this.audit.record({
        actorId: ctx.userId,
        actorRole: ctx.role,
        tenantId,
        action: 'DEVICE_REGISTERED',
        targetType: 'DEVICE',
        targetId: created.id,
        outcome: 'SUCCESS',
        ip,
        details: {
          name: created.name,
          serialNumber: created.serialNumber,
          hardwareId: created.hardwareId,
          modelId: created.modelId,
          siteId: created.siteId,
          tags: created.tags,
        },
      });

      return {
        device: toDevicePublic(created),
        provisioning: this.buildProvisioningPayload(created.id, apiKey, model.id, tenant.code),
      };
    } catch (err) {
      if (err instanceof Error && /UNIQUE constraint failed: unique_keys/i.test(err.message)) {
        throw Errors.conflict('Serial number or hardware ID is already registered');
      }
      throw err;
    }
  }

  /**
   * Bulk CSV import (FR-DEV-03, Section 8.3 #6).
   * Validates every row; when dryRun=false, creates valid rows even if other rows fail.
   */
  importRows(
    ctx: TenantContext,
    rows: DeviceImportRowInput[],
    dryRun: boolean,
    ip: string,
  ): DeviceImportResponse {
    const tenantId = this.resolveWriteTenantId(ctx);
    const tenant = this.tenants.findByIdSystem(tenantId);
    if (!tenant) {
      throw Errors.notFound('Tenant not found');
    }

    const allModels = this.models.listAll();
    const tenantSites = this.sites.listAllInTenant(ctx, tenantId);

    const findModel = (query: string) => {
      const q = query.trim().toLowerCase();
      if (!q) return null;
      return (
        allModels.find((m) => m.id.toLowerCase() === q) ??
        allModels.find((m) => m.name.toLowerCase() === q) ??
        allModels.find((m) => m.name.toLowerCase().startsWith(`${q} `)) ??
        null
      );
    };

    const findSite = (query: string) => {
      const q = query.trim().toLowerCase();
      if (!q) return null;
      return (
        tenantSites.find((s) => s.id.toLowerCase() === q) ??
        tenantSites.find((s) => s.name.toLowerCase() === q) ??
        null
      );
    };

    const seenSerials = new Set<string>();
    const seenHwIds = new Set<string>();
    const results: DeviceImportRowResult[] = [];
    const provisioningFiles: DeviceProvisioningPayload[] = [];
    let validCount = 0;
    let createdCount = 0;
    let errorCount = 0;

    for (const row of rows) {
      const errors: string[] = [];
      const serial = row.serialNumber.trim();
      const hwId = row.hardwareId.trim();
      const name = (row.name?.trim() || serial).trim();
      const tags = parseTagString(row.tags);

      if (!serial) {
        errors.push('serialNumber is required');
      }
      if (!hwId) {
        errors.push('hardwareId is required');
      }

      const model = findModel(row.model);
      if (!model) {
        errors.push(`Unknown device model "${row.model}"`);
      }

      const site = findSite(row.site);
      if (!site) {
        errors.push(`Unknown site "${row.site}" in ${tenant.code}`);
      }

      if (serial) {
        const key = serial.toUpperCase();
        if (seenSerials.has(key)) {
          errors.push(`Duplicate serialNumber "${serial}" within CSV file`);
        } else if (this.devices.findBySerialSystem(serial)) {
          errors.push(`serialNumber "${serial}" is already registered`);
        }
        seenSerials.add(key);
      }

      if (hwId) {
        const key = hwId.toUpperCase();
        if (seenHwIds.has(key)) {
          errors.push(`Duplicate hardwareId "${hwId}" within CSV file`);
        } else if (this.devices.findByHardwareIdSystem(hwId)) {
          errors.push(`hardwareId "${hwId}" is already registered`);
        }
        seenHwIds.add(key);
      }

      const isValid = errors.length === 0 && model !== null && site !== null;
      const rowResult: DeviceImportRowResult = {
        rowNumber: row.rowNumber,
        serialNumber: serial,
        hardwareId: hwId,
        name,
        modelName: model?.name ?? null,
        siteName: site?.name ?? null,
        tags,
        valid: isValid,
        errors,
      };

      if (isValid && model && site) {
        validCount += 1;
        if (!dryRun) {
          const deviceId = generateId('dev');
          const { apiKey, apiKeyHash, apiKeyLast4 } = generateDeviceApiKey();
          const now = new Date().toISOString();
          try {
            this.devices.createWithUniqueKeys(
              ctx,
              {
                id: deviceId,
                tenantId,
                siteId: site.id,
                modelId: model.id,
                name,
                serialNumber: serial,
                hardwareId: hwId,
                tags,
                state: 'PROVISIONED',
                connectivity: 'UNKNOWN',
                apiKeyHash,
                apiKeyLast4,
              },
              {
                id: generateId('dsh'),
                tenantId,
                deviceId,
                from: null,
                to: 'PROVISIONED',
                reason: 'Registered via CSV bulk import',
                actorId: ctx.userId,
                at: now,
              },
            );
            rowResult.createdDeviceId = deviceId;
            createdCount += 1;
            provisioningFiles.push(
              this.buildProvisioningPayload(deviceId, apiKey, model.id, tenant.code),
            );
          } catch {
            rowResult.valid = false;
            rowResult.errors.push('Conflict inserting unique serialNumber or hardwareId');
            validCount -= 1;
            errorCount += 1;
          }
        }
      } else {
        errorCount += 1;
      }

      results.push(rowResult);
    }

    if (!dryRun && createdCount > 0) {
      this.audit.record({
        actorId: ctx.userId,
        actorRole: ctx.role,
        tenantId,
        action: 'DEVICES_BULK_IMPORTED',
        targetType: 'DEVICE',
        targetId: tenantId,
        outcome: 'SUCCESS',
        ip,
        details: {
          totalRows: rows.length,
          createdCount,
          errorCount,
        },
      });
    }

    return {
      dryRun,
      totalRows: rows.length,
      validCount,
      createdCount,
      errorCount,
      rows: results,
      provisioningFiles,
    };
  }

  update(
    ctx: TenantContext,
    id: string,
    patch: { name?: string; siteId?: string; tags?: string[] },
    ip: string,
  ): DevicePublic {
    const existing = this.devices.findById(ctx, id);
    if (!existing) {
      throw Errors.notFound('Device not found');
    }
    if (existing.state === 'DECOMMISSIONED') {
      throw Errors.invalidTransition('Decommissioned devices are read-only and cannot be edited', {
        currentState: existing.state,
        allowedTransitions: [],
      });
    }

    if (patch.siteId !== undefined) {
      const site = this.sites.findById(ctx, patch.siteId);
      if (!site || site.tenantId !== existing.tenantId) {
        throw Errors.validation('Selected site does not exist in this device organization', {
          field: 'siteId',
        });
      }
    }

    const normalizedPatch = {
      name: patch.name?.trim(),
      siteId: patch.siteId,
      tags: patch.tags !== undefined ? normalizeTags(patch.tags) : undefined,
    };

    const updated = this.devices.update(ctx, id, normalizedPatch);
    if (!updated) {
      throw Errors.notFound('Device not found');
    }

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: existing.tenantId,
      action: 'DEVICE_UPDATED',
      targetType: 'DEVICE',
      targetId: updated.id,
      outcome: 'SUCCESS',
      ip,
      details: {
        before: { name: existing.name, siteId: existing.siteId, tags: existing.tags },
        after: { name: updated.name, siteId: updated.siteId, tags: updated.tags },
      },
    });

    return toDevicePublic(updated);
  }

  regenerateKey(ctx: TenantContext, id: string, ip: string): DeviceRegistrationResponse {
    const existing = this.devices.findById(ctx, id);
    if (!existing) {
      throw Errors.notFound('Device not found');
    }
    if (existing.state === 'DECOMMISSIONED') {
      throw Errors.invalidTransition(
        'Cannot regenerate API key for a decommissioned device',
        { currentState: existing.state, allowedTransitions: [] },
      );
    }

    const tenant = this.tenants.findByIdSystem(existing.tenantId);
    if (!tenant) {
      throw Errors.notFound('Tenant not found');
    }

    const { apiKey, apiKeyHash, apiKeyLast4 } = generateDeviceApiKey();
    const updated = this.devices.updateApiKey(ctx, id, apiKeyHash, apiKeyLast4);
    if (!updated) {
      throw Errors.notFound('Device not found');
    }
    // Remove stale simulator credential so the old key is immediately invalidated everywhere
    this.devices.deleteSimulatorCredential(id);

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: existing.tenantId,
      action: 'DEVICE_KEY_REGENERATED',
      targetType: 'DEVICE',
      targetId: updated.id,
      outcome: 'SUCCESS',
      ip,
      details: { apiKeyLast4 },
    });

    return {
      device: toDevicePublic(updated),
      provisioning: this.buildProvisioningPayload(
        updated.id,
        apiKey,
        updated.modelId,
        tenant.code,
      ),
    };
  }

  transitionState(
    ctx: TenantContext,
    id: string,
    action: DeviceLifecycleAction,
    reason: string | undefined,
    ip: string,
  ): DeviceDetail {
    const existing = this.devices.findById(ctx, id);
    if (!existing) {
      throw Errors.notFound('Device not found');
    }

    const to = actionToTargetState(action);
    const { targetState, normalizedReason } = validateLifecycleTransition({
      from: existing.state,
      action,
      to,
      actorRole: ctx.role,
      reason,
    });

    const now = new Date().toISOString();
    const isDecommission = targetState === 'DECOMMISSIONED';
    const updated = this.devices.transitionState(
      ctx,
      id,
      {
        state: targetState,
        decommissionedAt: isDecommission ? now : undefined,
        decommissionReason: isDecommission ? normalizedReason : undefined,
        revokeKey: isDecommission,
      },
      {
        id: generateId('dsh'),
        tenantId: existing.tenantId,
        deviceId: existing.id,
        from: existing.state,
        to: targetState,
        reason: normalizedReason,
        actorId: ctx.userId,
        at: now,
      },
    );

    if (!updated) {
      throw Errors.notFound('Device not found');
    }

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: existing.tenantId,
      action: isDecommission ? 'DEVICE_DECOMMISSIONED' : 'DEVICE_STATE_CHANGED',
      targetType: 'DEVICE',
      targetId: updated.id,
      outcome: 'SUCCESS',
      ip,
      details: {
        from: existing.state,
        to: targetState,
        action,
        reason: normalizedReason,
        credentialsRevoked: isDecommission,
      },
    });

    return this.getDetail(ctx, updated.id);
  }

  bulkAction(
    ctx: TenantContext,
    input: { deviceIds: string[]; action: 'ADD_TAG' | 'SUSPEND'; tag?: string; reason?: string },
    ip: string,
  ): BulkDeviceActionResult {
    const results: BulkDeviceActionResult['results'] = [];
    let succeededCount = 0;
    let failedCount = 0;

    for (const deviceId of input.deviceIds) {
      const existing = this.devices.findById(ctx, deviceId);
      if (!existing) {
        failedCount += 1;
        results.push({ deviceId, ok: false, error: 'Device not found' });
        continue;
      }

      try {
        if (input.action === 'ADD_TAG') {
          const cleanTag = input.tag?.trim().toLowerCase() ?? '';
          if (!cleanTag) {
            throw Errors.validation('Tag is required');
          }
          const nextTags = normalizeTags([...existing.tags, cleanTag]);
          this.update(ctx, deviceId, { tags: nextTags }, ip);
          succeededCount += 1;
          results.push({ deviceId, deviceName: existing.name, ok: true });
        } else {
          this.transitionState(ctx, deviceId, 'SUSPEND', input.reason, ip);
          succeededCount += 1;
          results.push({ deviceId, deviceName: existing.name, ok: true });
        }
      } catch (err) {
        failedCount += 1;
        results.push({
          deviceId,
          deviceName: existing.name,
          ok: false,
          error: err instanceof Error ? err.message : 'Action failed',
        });
      }
    }

    return { succeededCount, failedCount, results };
  }

  getTimeline(ctx: TenantContext, deviceId: string): DeviceTimelineEvent[] {
    const existing = this.devices.findById(ctx, deviceId);
    if (!existing) {
      throw Errors.notFound('Device not found');
    }

    const stateRows = this.devices.listStateHistory(ctx, deviceId);
    const connRows = this.devices.listConnectivityEvents(ctx, deviceId);
    // Query audit entries for this device using a tenant-scoped context so non-PA/non-CA roles can view device timeline safely
    const deviceAuditCtx: TenantContext = {
      userId: ctx.userId,
      role: 'PLATFORM_ADMIN',
      allTenants: true,
      tenantIds: [],
      activeTenantId: null,
    };
    const auditRows = this.auditRepo.list(deviceAuditCtx, {
      tenantId: existing.tenantId,
      targetType: 'DEVICE',
      targetId: deviceId,
      page: 1,
      pageSize: 100,
      sortDir: 'desc',
    }).items;

    const events: DeviceTimelineEvent[] = [];

    for (const h of stateRows) {
      events.push({
        id: h.id,
        kind: 'STATE_CHANGE',
        at: h.at,
        title: h.from ? `State changed: ${h.from} → ${h.to}` : `Provisioned (${h.to})`,
        description: h.reason,
        actorId: h.actorId,
        actorName: h.actorName,
        metadata: { from: h.from, to: h.to },
      });
    }

    for (const c of connRows) {
      events.push({
        id: c.id,
        kind: 'CONNECTIVITY',
        at: c.at,
        title: `Connectivity changed to ${c.state}`,
        description:
          c.state === 'ONLINE'
            ? 'Device established authenticated heartbeat connection'
            : 'Device missed heartbeat window and marked offline',
        actorId: 'SYSTEM',
        actorName: 'System',
        metadata: { state: c.state },
      });
    }

    // Include non-duplicate audit events (updates, key regeneration)
    for (const a of auditRows) {
      if (
        a.action === 'DEVICE_REGISTERED' ||
        a.action === 'DEVICE_STATE_CHANGED' ||
        a.action === 'DEVICE_DECOMMISSIONED'
      ) {
        continue;
      }
      events.push({
        id: a.id,
        kind: 'AUDIT',
        at: a.at,
        title: a.action.replaceAll('_', ' '),
        description:
          a.action === 'DEVICE_KEY_REGENERATED'
            ? `API key rotated (ending in ••••${String(a.details.apiKeyLast4 ?? '')})`
            : 'Device metadata updated',
        actorId: a.actorId,
        actorName: a.actorName ?? a.actorEmail ?? a.actorId,
        metadata: a.details,
      });
    }

    events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    return events;
  }
}
