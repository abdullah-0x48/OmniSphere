import type {
  ConfigProfilePublic,
  ConfigProfileVersion,
  ConfigPushResponse,
  ConfigPushResultItem,
  ConfigPushTargetType,
  DevicePublic,
} from '../../../shared/types.ts';
import type { Repositories } from '../repositories/index.ts';
import type { ConfigProfileListFilter, TenantContext } from '../repositories/types.ts';
import { Errors } from '../utils/errors.ts';
import { generateId } from '../utils/ids.ts';
import type { AuditService } from './auditService.ts';

export class ConfigProfileService {
  constructor(
    private readonly repos: Repositories,
    private readonly audit: AuditService,
  ) {}

  private resolveWriteTenantId(ctx: TenantContext): string {
    if (ctx.activeTenantId) return ctx.activeTenantId;
    if (ctx.tenantIds.length === 1) return ctx.tenantIds[0];
    throw Errors.validation('Select a working organization before managing configuration profiles');
  }

  list(
    ctx: TenantContext,
    filter: ConfigProfileListFilter,
  ): { items: ConfigProfilePublic[]; total: number } {
    return this.repos.configProfiles.list(ctx, filter);
  }

  getById(ctx: TenantContext, id: string): ConfigProfilePublic {
    const profile = this.repos.configProfiles.findById(ctx, id);
    if (!profile) {
      throw Errors.notFound('Configuration profile not found');
    }
    return profile;
  }

  listVersions(ctx: TenantContext, id: string): ConfigProfileVersion[] {
    const profile = this.repos.configProfiles.findById(ctx, id);
    if (!profile) {
      throw Errors.notFound('Configuration profile not found');
    }
    return this.repos.configProfiles.listVersions(ctx, id);
  }

  create(
    ctx: TenantContext,
    input: { name: string; modelId: string; payload: Record<string, unknown> },
    ip: string,
  ): ConfigProfilePublic {
    const tenantId = this.resolveWriteTenantId(ctx);
    const model = this.repos.deviceModels.findById(input.modelId);
    if (!model) {
      throw Errors.validation('Selected device model does not exist', { field: 'modelId' });
    }

    const created = this.repos.configProfiles.create(ctx, {
      id: generateId('cfg'),
      tenantId,
      modelId: model.id,
      name: input.name.trim(),
      payload: input.payload,
      createdBy: ctx.userId,
      versionId: generateId('cfv'),
    });

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId,
      action: 'CONFIG_PROFILE_CREATED',
      targetType: 'CONFIG_PROFILE',
      targetId: created.id,
      outcome: 'SUCCESS',
      ip,
      details: { name: created.name, modelId: created.modelId, version: created.version },
    });

    return created;
  }

  update(
    ctx: TenantContext,
    id: string,
    patch: { name?: string; payload?: Record<string, unknown> },
    ip: string,
  ): ConfigProfilePublic {
    const existing = this.repos.configProfiles.findById(ctx, id);
    if (!existing) {
      throw Errors.notFound('Configuration profile not found');
    }

    const updated = this.repos.configProfiles.updateAndIncrementVersion(ctx, id, {
      name: patch.name,
      payload: patch.payload,
      actorId: ctx.userId,
      versionId: generateId('cfv'),
    });

    if (!updated) {
      throw Errors.notFound('Configuration profile not found');
    }

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: updated.tenantId,
      action: 'CONFIG_PROFILE_UPDATED',
      targetType: 'CONFIG_PROFILE',
      targetId: updated.id,
      outcome: 'SUCCESS',
      ip,
      details: {
        name: updated.name,
        previousVersion: existing.version,
        version: updated.version,
      },
    });

    return updated;
  }

  /**
   * Pushes a configuration profile version to a target device, list of devices, tag, or site (Section 8.6).
   * Sets device.config = { profileId, version, status: 'PENDING', error: null } and queues APPLY_CONFIG.
   */
  push(
    ctx: TenantContext,
    profileId: string,
    input: {
      targetType: ConfigPushTargetType;
      targetValue: string;
      deviceIds?: string[];
    },
    ip: string,
  ): ConfigPushResponse {
    const profile = this.repos.configProfiles.findById(ctx, profileId);
    if (!profile) {
      throw Errors.notFound('Configuration profile not found');
    }

    const tenantScope: TenantContext = {
      ...ctx,
      allTenants: false,
      tenantIds: [profile.tenantId],
      activeTenantId: profile.tenantId,
    };

    const allTenantDevices = this.repos.devices.listAllInScope(tenantScope, true);
    let matched: DevicePublic[] = [];

    if (input.targetType === 'DEVICE') {
      const requestedIds =
        input.deviceIds && input.deviceIds.length > 0
          ? input.deviceIds
          : input.targetValue
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
      const idSet = new Set(requestedIds);
      matched = allTenantDevices.filter((d) => idSet.has(d.id));
      if (matched.length === 0) {
        throw Errors.notFound('Target device not found in this organization');
      }
    } else if (input.targetType === 'SITE') {
      const site = this.repos.sites.findById(tenantScope, input.targetValue.trim());
      if (!site || site.tenantId !== profile.tenantId) {
        throw Errors.validation('Target site does not exist in this organization', {
          field: 'targetValue',
        });
      }
      matched = allTenantDevices.filter((d) => d.siteId === site.id);
    } else if (input.targetType === 'TAG') {
      const tag = input.targetValue.trim().toLowerCase();
      if (!tag) {
        throw Errors.validation('Target tag is required', { field: 'targetValue' });
      }
      matched = allTenantDevices.filter((d) =>
        d.tags.some((t) => t.toLowerCase() === tag),
      );
    }

    const results: ConfigPushResultItem[] = [];
    let queuedCount = 0;
    let skippedCount = 0;

    for (const dev of matched) {
      if (dev.modelId !== profile.modelId) {
        skippedCount += 1;
        results.push({
          deviceId: dev.id,
          deviceName: dev.name,
          serialNumber: dev.serialNumber,
          status: 'SKIPPED',
          reason: `Wrong model (${dev.modelName ?? dev.modelId})`,
        });
        continue;
      }

      if (dev.state === 'DECOMMISSIONED') {
        skippedCount += 1;
        results.push({
          deviceId: dev.id,
          deviceName: dev.name,
          serialNumber: dev.serialNumber,
          status: 'SKIPPED',
          reason: 'Device is decommissioned',
        });
        continue;
      }

      this.repos.devices.assignConfigSystem(dev.id, {
        profileId: profile.id,
        version: profile.version,
        status: 'PENDING',
        error: null,
      });

      this.repos.deviceCommands.create(tenantScope, {
        id: generateId('cmd'),
        tenantId: profile.tenantId,
        deviceId: dev.id,
        type: 'APPLY_CONFIG',
        payload: {
          profileId: profile.id,
          profileName: profile.name,
          version: profile.version,
        },
        createdBy: ctx.userId,
      });

      this.audit.record({
        actorId: ctx.userId,
        actorRole: ctx.role,
        tenantId: profile.tenantId,
        action: 'CONFIG_PUSHED',
        targetType: 'DEVICE',
        targetId: dev.id,
        outcome: 'SUCCESS',
        ip,
        details: {
          profileId: profile.id,
          profileName: profile.name,
          version: profile.version,
          targetType: input.targetType,
          targetValue: input.targetValue,
        },
      });

      queuedCount += 1;
      results.push({
        deviceId: dev.id,
        deviceName: dev.name,
        serialNumber: dev.serialNumber,
        status: 'QUEUED',
      });
    }

    return {
      profileId: profile.id,
      profileName: profile.name,
      version: profile.version,
      queuedCount,
      skippedCount,
      results,
    };
  }
}
