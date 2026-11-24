import type {
  BulkDeviceActionResult,
  DeviceCommandPublic,
  DeviceCommandType,
  DeviceDetail,
  DeviceImportResponse,
  DeviceImportRowInput,
  DeviceImportRowResult,
  DeviceLifecycleAction,
  DeviceLiveState,
  DeviceProvisioningPayload,
  DevicePublic,
  DeviceRegistrationResponse,
  DeviceTelemetryResponse,
  DeviceTimelineEvent,
  RoleCode,
  TelemetryPoint,
  TelemetryRange,
  TelemetrySample,
} from '../../../shared/types.ts';
import { config } from '../config.ts';
import {
  toDevicePublic,
  type DeviceListFilter,
  type IAlertRepository,
  type IAuditRepository,
  type IConfigProfileRepository,
  type IDeviceCommandRepository,
  type IDeviceModelRepository,
  type IDeviceRepository,
  type IRolloutRepository,
  type ISiteRepository,
  type ITelemetryRepository,
  type ITenantRepository,
  type ITicketRepository,
  type IWorkOrderRepository,
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
import type { LiveStateStore } from './liveStateStore.ts';
import {
  buildDownsampledSeries,
  downsamplePoints,
  rangeToDurationMs,
} from './telemetryValidation.ts';

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
  private onDeviceSuppressed: ((deviceId: string) => void) | null = null;
  private onDeviceDecommissioned: ((deviceId: string) => void) | null = null;

  constructor(
    private readonly devices: IDeviceRepository,
    private readonly sites: ISiteRepository,
    private readonly models: IDeviceModelRepository,
    private readonly tenants: ITenantRepository,
    private readonly auditRepo: IAuditRepository,
    private readonly audit: AuditService,
    private readonly liveState?: LiveStateStore,
    private readonly telemetryRepo?: ITelemetryRepository,
    private readonly commandsRepo?: IDeviceCommandRepository,
    private readonly alertsRepo?: IAlertRepository,
    private readonly ticketsRepo?: ITicketRepository,
    private readonly workOrdersRepo?: IWorkOrderRepository,
    private readonly configProfilesRepo?: IConfigProfileRepository,
    private readonly rolloutsRepo?: IRolloutRepository,
  ) {}

  setOnDeviceSuppressed(handler: (deviceId: string) => void): void {
    this.onDeviceSuppressed = handler;
  }

  setOnDeviceDecommissioned(handler: (deviceId: string) => void): void {
    this.onDeviceDecommissioned = handler;
  }

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
    const res = this.devices.list(ctx, filter);
    if (!this.liveState) return res;
    return {
      items: res.items.map((d) => this.liveState!.mergeIntoDevice(d)),
      total: res.total,
    };
  }

  listDistinctTags(ctx: TenantContext): string[] {
    return this.devices.listDistinctTags(ctx);
  }

  getDetail(ctx: TenantContext, id: string): DeviceDetail {
    const record = this.devices.findById(ctx, id);
    if (!record) {
      throw Errors.notFound('Device not found');
    }

    const basePublic = toDevicePublic(record);
    const merged = this.liveState ? this.liveState.mergeIntoDevice(basePublic) : basePublic;
    const model = this.models.findById(record.modelId);
    const site = this.sites.findById(ctx, record.siteId);
    const allowedTransitions = getAllowedTransitionsForActor(merged.state, ctx.role);

    let configProfileName: string | null = null;
    let configProfilePayload: Record<string, unknown> | null = null;
    if (merged.config.profileId && this.configProfilesRepo) {
      const prof = this.configProfilesRepo.findByIdSystem(merged.config.profileId);
      if (prof) {
        configProfileName = prof.name;
        const ver =
          merged.config.version !== null
            ? this.configProfilesRepo.findVersionSystem(prof.id, merged.config.version)
            : null;
        configProfilePayload = ver ? ver.payload : prof.payload;
      }
    }

    const recentConfigCommands = this.commandsRepo
      ? this.commandsRepo
          .listByDevice(ctx, record.id, record.tenantId)
          .filter((c) => c.type === 'APPLY_CONFIG')
      : [];
    const recentRolloutJobs = this.rolloutsRepo
      ? this.rolloutsRepo.listJobsByDevice(ctx, record.id, 30)
      : [];

    return {
      ...merged,
      model,
      site,
      allowedTransitions,
      configProfileName,
      configProfilePayload,
      recentConfigCommands,
      recentRolloutJobs,
    };
  }

  getLive(ctx: TenantContext, id: string): DeviceLiveState {
    const record = this.devices.findById(ctx, id);
    if (!record) {
      throw Errors.notFound('Device not found');
    }
    const merged = this.liveState
      ? this.liveState.mergeIntoDevice(toDevicePublic(record))
      : toDevicePublic(record);
    return {
      deviceId: merged.id,
      tenantId: merged.tenantId,
      state: merged.state,
      connectivity: merged.connectivity,
      lastSeenAt: merged.lastSeenAt,
      firmwareVersion: merged.firmwareVersion,
      latestMetrics: merged.latestMetrics,
      latestHealth: merged.latestHealth,
      invalidPayloadCount: merged.invalidPayloadCount,
    };
  }

  getTelemetry(
    ctx: TenantContext,
    id: string,
    options: { metric?: string; range: TelemetryRange },
  ): DeviceTelemetryResponse {
    const record = this.devices.findById(ctx, id);
    if (!record) {
      throw Errors.notFound('Device not found');
    }

    const model = this.models.findById(record.modelId);
    const allMetricDefs = model?.metrics ?? [];
    const targetDefs = options.metric
      ? allMetricDefs.filter((m) => m.key === options.metric)
      : allMetricDefs;

    if (options.metric && targetDefs.length === 0) {
      throw Errors.validation(`Metric "${options.metric}" does not exist on this device model`, {
        field: 'metric',
      });
    }

    const nowMs = Date.now();
    const durationMs = rangeToDurationMs(options.range);
    const fromMs = nowMs - durationMs;
    // Start bucket scan 10 minutes earlier so samples inside the boundary bucket aren't missed
    const bucketFromIso = new Date(fromMs - 600_000).toISOString();
    const toIso = new Date(nowMs).toISOString();

    const buckets = this.telemetryRepo
      ? this.telemetryRepo.queryBucketsInRange(ctx, id, record.tenantId, bucketFromIso, toIso)
      : [];

    const buffered = this.liveState ? this.liveState.getBufferedSamples(id) : [];

    // Combine persisted bucket samples + live buffered samples, deduplicated by timestamp
    const sampleByTs = new Map<string, TelemetrySample>();
    for (const b of buckets) {
      for (const s of b.samples) {
        sampleByTs.set(s.ts, s);
      }
    }
    for (const s of buffered) {
      sampleByTs.set(s.ts, s);
    }

    const allSamples = Array.from(sampleByTs.values());
    const metricKeys = targetDefs.map((m) => m.key);
    const series = buildDownsampledSeries(allSamples, metricKeys, fromMs, nowMs, 300);

    // Build down-sampled health time series as well
    const sortedInWindow = allSamples
      .filter((s) => {
        const t = Date.parse(s.ts);
        return Number.isFinite(t) && t >= fromMs && t <= nowMs;
      })
      .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));

    const extractHealthSeries = (
      field: 'cpuLoad' | 'memoryUsage' | 'batteryLevel' | 'signalStrength',
    ): TelemetryPoint[] => {
      const pts: TelemetryPoint[] = [];
      for (const s of sortedInWindow) {
        const val = s.health?.[field];
        if (typeof val === 'number' && Number.isFinite(val)) {
          pts.push({ ts: s.ts, value: val });
        }
      }
      return downsamplePoints(pts, 300);
    };

    const healthSeries = {
      cpuLoad: extractHealthSeries('cpuLoad'),
      memoryUsage: extractHealthSeries('memoryUsage'),
      batteryLevel: extractHealthSeries('batteryLevel'),
      signalStrength: extractHealthSeries('signalStrength'),
    };

    return {
      deviceId: record.id,
      range: options.range,
      from: new Date(fromMs).toISOString(),
      to: toIso,
      metrics: targetDefs,
      series,
      healthSeries,
    };
  }

  enqueueCommand(
    ctx: TenantContext,
    id: string,
    input: { type: DeviceCommandType },
    ip: string,
  ): DeviceCommandPublic {
    if (!this.commandsRepo) {
      throw Errors.internal('Device commands repository not configured');
    }

    const existing = this.devices.findById(ctx, id);
    if (!existing) {
      throw Errors.notFound('Device not found');
    }

    const currentState = this.liveState?.get(id)?.state ?? existing.state;
    if (currentState !== 'ACTIVE' && currentState !== 'UNDER_MAINTENANCE') {
      throw Errors.invalidTransition(
        `Cannot send ${input.type} command while device is in ${currentState} state`,
        { currentState },
      );
    }

    const command = this.commandsRepo.create(ctx, {
      id: generateId('cmd'),
      tenantId: existing.tenantId,
      deviceId: existing.id,
      type: input.type,
      createdBy: ctx.userId,
    });

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: existing.tenantId,
      action: 'DEVICE_COMMAND_QUEUED',
      targetType: 'DEVICE',
      targetId: existing.id,
      outcome: 'SUCCESS',
      ip,
      details: { commandId: command.id, type: command.type },
    });

    return command;
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

    // Validate optional initial configuration profile (Section 8.3 #5)
    let initialConfig: DeviceDetail['config'] = {
      profileId: null,
      version: null,
      status: 'NONE',
      error: null,
    };
    let initialProfileName: string | null = null;
    if (input.configProfileId && this.configProfilesRepo) {
      const profile = this.configProfilesRepo.findById(ctx, input.configProfileId);
      if (!profile || profile.tenantId !== tenantId) {
        throw Errors.validation('Selected configuration profile does not exist in this organization', {
          field: 'configProfileId',
        });
      }
      if (profile.modelId !== model.id) {
        throw Errors.validation('Selected configuration profile does not match the device model', {
          field: 'configProfileId',
        });
      }
      initialConfig = {
        profileId: profile.id,
        version: profile.version,
        status: 'PENDING',
        error: null,
      };
      initialProfileName = profile.name;
    }

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
          config: initialConfig,
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

      if (initialConfig.profileId && this.commandsRepo) {
        this.commandsRepo.create(ctx, {
          id: generateId('cmd'),
          tenantId,
          deviceId: created.id,
          type: 'APPLY_CONFIG',
          payload: {
            profileId: initialConfig.profileId,
            profileName: initialProfileName,
            version: initialConfig.version,
          },
          createdBy: ctx.userId,
        });
      }

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

      const publicDevice = toDevicePublic(created);
      this.liveState?.syncDeviceRecord(publicDevice);

      return {
        device: publicDevice,
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

    if (isDecommission) {
      this.commandsRepo?.cancelPendingForDeviceSystem(updated.id);
      this.onDeviceDecommissioned?.(updated.id);
      this.liveState?.updateLifecycleState(updated.id, 'DECOMMISSIONED', 'OFFLINE');
    } else {
      this.liveState?.updateLifecycleState(updated.id, targetState);
    }

    if (
      targetState === 'SUSPENDED' ||
      targetState === 'UNDER_MAINTENANCE' ||
      targetState === 'DECOMMISSIONED'
    ) {
      this.onDeviceSuppressed?.(updated.id);
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

  /**
   * System-initiated device lifecycle transition driven by Work Order start/complete (Section 5.3 & 8.5):
   * - Start work order: ACTIVE -> UNDER_MAINTENANCE (alerts suppressed immediately)
   * - Complete work order: UNDER_MAINTENANCE -> ACTIVE
   */
  transitionLifecycleForWorkOrderSystem(params: {
    deviceId: string;
    targetState: 'UNDER_MAINTENANCE' | 'ACTIVE';
    reason: string;
    actorId: string;
    actorRole: RoleCode | 'SYSTEM';
    ip: string;
  }): boolean {
    const sysCtx: TenantContext = {
      userId: params.actorId,
      role: 'PLATFORM_ADMIN',
      allTenants: true,
      tenantIds: [],
      activeTenantId: null,
    };

    const existing = this.devices.findById(sysCtx, params.deviceId);
    if (!existing) return false;

    const currentState = this.liveState?.get(existing.id)?.state ?? existing.state;
    if (params.targetState === 'UNDER_MAINTENANCE' && currentState !== 'ACTIVE') {
      // Ensure suppression still applies if already under maintenance
      if (currentState === 'UNDER_MAINTENANCE') {
        this.liveState?.updateLifecycleState(existing.id, 'UNDER_MAINTENANCE');
        this.onDeviceSuppressed?.(existing.id);
      }
      return false;
    }
    if (params.targetState === 'ACTIVE' && currentState !== 'UNDER_MAINTENANCE') {
      return false;
    }

    const now = new Date().toISOString();
    const updated = this.devices.transitionState(
      sysCtx,
      existing.id,
      { state: params.targetState },
      {
        id: generateId('dsh'),
        tenantId: existing.tenantId,
        deviceId: existing.id,
        from: currentState,
        to: params.targetState,
        reason: params.reason,
        actorId: params.actorId,
        at: now,
      },
    );
    if (!updated) return false;

    this.liveState?.updateLifecycleState(updated.id, params.targetState);
    if (params.targetState === 'UNDER_MAINTENANCE') {
      this.onDeviceSuppressed?.(updated.id);
    }

    this.audit.record({
      actorId: params.actorId,
      actorRole: params.actorRole,
      tenantId: existing.tenantId,
      action: 'DEVICE_STATE_CHANGED',
      targetType: 'DEVICE',
      targetId: updated.id,
      outcome: 'SUCCESS',
      ip: params.ip,
      details: {
        from: currentState,
        to: params.targetState,
        reason: params.reason,
        source: 'WORK_ORDER',
      },
    });

    return true;
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

    // Include non-duplicate audit events (updates, key regeneration, config pushes, OTA)
    for (const a of auditRows) {
      if (
        a.action === 'DEVICE_REGISTERED' ||
        a.action === 'DEVICE_STATE_CHANGED' ||
        a.action === 'DEVICE_DECOMMISSIONED'
      ) {
        continue;
      }
      const isConfig =
        a.action === 'CONFIG_PUSHED' ||
        a.action === 'CONFIG_APPLIED' ||
        a.action === 'CONFIG_FAILED';
      const isFirmware = a.action === 'OTA_JOB_VERIFIED' || a.action === 'OTA_JOB_FAILED';
      const description =
        a.action === 'DEVICE_KEY_REGENERATED'
          ? `API key rotated (ending in ••••${String(a.details.apiKeyLast4 ?? '')})`
          : a.action === 'CONFIG_PUSHED'
            ? `Pushed ${String(a.details.profileName ?? a.details.profileId ?? 'profile')} v${String(a.details.version ?? '?')}`
            : a.action === 'CONFIG_APPLIED'
              ? `Device applied configuration v${String(a.details.version ?? '?')}`
              : a.action === 'CONFIG_FAILED'
                ? `Configuration v${String(a.details.version ?? '?')} failed: ${String(a.details.error ?? 'Unknown error')}`
                : a.action === 'OTA_JOB_VERIFIED'
                  ? `Updated firmware ${String(a.details.fromVersion ?? '?')} → ${String(a.details.toVersion ?? '?')}`
                  : a.action === 'OTA_JOB_FAILED'
                    ? `Firmware update to ${String(a.details.toVersion ?? '?')} failed (${String(a.details.errorCode ?? 'ERROR')})`
                    : 'Device metadata updated';
      events.push({
        id: a.id,
        kind: isConfig ? 'CONFIG' : isFirmware ? 'FIRMWARE' : 'AUDIT',
        at: a.at,
        title: a.action.replaceAll('_', ' '),
        description,
        actorId: a.actorId,
        actorName: a.actorName ?? a.actorEmail ?? a.actorId,
        metadata: a.details,
      });
    }

    // Include device alerts in timeline (Section 10.4)
    const deviceAlerts = this.alertsRepo?.listByDevice(ctx, deviceId, 50) ?? [];
    for (const al of deviceAlerts) {
      events.push({
        id: `alr_evt_${al.id}`,
        kind: 'ALERT',
        at: al.createdAt,
        title: `[${al.severity}] Alert raised (${al.status})`,
        description: al.message,
        actorId: 'SYSTEM',
        actorName: 'Alert Engine',
        metadata: { alertId: al.id, severity: al.severity, status: al.status },
      });
      if (al.acknowledgedAt) {
        events.push({
          id: `alr_ack_${al.id}`,
          kind: 'ALERT',
          at: al.acknowledgedAt,
          title: `Alert acknowledged`,
          description: al.message,
          actorId: al.acknowledgedBy ?? 'SYSTEM',
          actorName: al.acknowledgedByName ?? al.acknowledgedBy ?? 'User',
          metadata: { alertId: al.id },
        });
      }
      if (al.closedAt) {
        events.push({
          id: `alr_cls_${al.id}`,
          kind: 'ALERT',
          at: al.closedAt,
          title: `Alert closed`,
          description: al.closeReason ?? al.message,
          actorId: al.closedBy ?? 'SYSTEM',
          actorName: al.closedByName ?? al.closedBy ?? 'Support Engineer',
          metadata: { alertId: al.id },
        });
      }
    }

    // Include device tickets in timeline (Section 10.4)
    const deviceTickets = this.ticketsRepo?.listByDevice(ctx, deviceId, 50) ?? [];
    for (const tk of deviceTickets) {
      events.push({
        id: `tkt_evt_${tk.id}`,
        kind: 'TICKET',
        at: tk.createdAt,
        title: `${tk.number} created (${tk.priority} · ${tk.status})`,
        description: tk.title,
        actorId: tk.createdBy,
        actorName: tk.createdByName ?? tk.createdBy,
        metadata: { ticketId: tk.id, number: tk.number, status: tk.status },
      });
      if (tk.resolvedAt) {
        events.push({
          id: `tkt_res_${tk.id}`,
          kind: 'TICKET',
          at: tk.resolvedAt,
          title: `${tk.number} resolved`,
          description: tk.rootCause ? `Root cause: ${tk.rootCause}` : tk.title,
          actorId: tk.assigneeId ?? 'SYSTEM',
          actorName: tk.assigneeName ?? 'Support Engineer',
          metadata: { ticketId: tk.id, number: tk.number },
        });
      }
      if (tk.closedAt) {
        events.push({
          id: `tkt_cls_${tk.id}`,
          kind: 'TICKET',
          at: tk.closedAt,
          title: `${tk.number} closed`,
          description: tk.closeReason ?? tk.title,
          actorId: 'SYSTEM',
          actorName: 'Ticket Closure',
          metadata: { ticketId: tk.id, number: tk.number },
        });
      }
    }

    // Include device work orders in timeline (Section 10.4)
    const deviceWorkOrders = this.workOrdersRepo?.listByDevice(ctx, deviceId, 50) ?? [];
    for (const wo of deviceWorkOrders) {
      events.push({
        id: `wo_evt_${wo.id}`,
        kind: 'WORK_ORDER',
        at: wo.createdAt,
        title: `${wo.number} (${wo.type}) · ${wo.status}`,
        description: wo.title,
        actorId: wo.createdBy,
        actorName: wo.createdByName ?? wo.createdBy,
        metadata: { workOrderId: wo.id, number: wo.number, status: wo.status },
      });
      if (wo.startedAt) {
        events.push({
          id: `wo_str_${wo.id}`,
          kind: 'WORK_ORDER',
          at: wo.startedAt,
          title: `${wo.number} started`,
          description: `Field work began (${wo.title})`,
          actorId: wo.assignedTo ?? 'SYSTEM',
          actorName: wo.assignedToName ?? 'Field Technician',
          metadata: { workOrderId: wo.id, number: wo.number },
        });
      }
      if (wo.completedAt) {
        events.push({
          id: `wo_cmp_${wo.id}`,
          kind: 'WORK_ORDER',
          at: wo.completedAt,
          title: `${wo.number} completed (${wo.completion?.outcome ?? 'FIXED'})`,
          description: wo.completion?.actionsTaken ?? wo.title,
          actorId: wo.assignedTo ?? 'SYSTEM',
          actorName: wo.assignedToName ?? 'Field Technician',
          metadata: { workOrderId: wo.id, number: wo.number },
        });
      }
    }

    events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    return events;
  }
}
