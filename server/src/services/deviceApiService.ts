import type {
  DeviceCommandPublic,
  DeviceHealthSnapshot,
  DeviceModel,
  RolloutJobPublic,
  RolloutPublic,
  Tenant,
} from '../../../shared/types.ts';
import type { Repositories } from '../repositories/index.ts';
import { toDevicePublic, type DeviceRecord } from '../repositories/types.ts';
import { Errors } from '../utils/errors.ts';
import { generateId } from '../utils/ids.ts';
import { logger } from '../utils/logger.ts';
import type { AuditService } from './auditService.ts';
import type { FirmwareService } from './firmwareService.ts';
import type { LiveStateStore } from './liveStateStore.ts';
import type { RolloutService } from './rolloutService.ts';
import { validateHealthPayload, validateTelemetryPayload } from './telemetryValidation.ts';

export interface DeviceAuthContext {
  device: DeviceRecord;
  tenant: Tenant;
  model: DeviceModel;
}

export interface PendingConfigDescriptor {
  version: number;
  payload: Record<string, unknown>;
}

export interface PendingUpdateDescriptor {
  jobId: string;
  firmwareId: string;
  version: string;
  downloadPath: string;
  sha256: string;
}

/**
 * Implements all `/device/v1/*` endpoints (Section 6).
 */
export class DeviceApiService {
  constructor(
    private readonly repos: Repositories,
    private readonly liveState: LiveStateStore,
    private readonly audit: AuditService,
    private readonly firmwareService?: FirmwareService,
    private readonly rolloutService?: RolloutService,
  ) {}

  private resolvePendingConfig(device: DeviceRecord): PendingConfigDescriptor | null {
    if (device.config.status !== 'PENDING' || !device.config.profileId) {
      return null;
    }

    const versionNum = device.config.version;
    if (versionNum !== null) {
      const versioned = this.repos.configProfiles.findVersionSystem(
        device.config.profileId,
        versionNum,
      );
      if (versioned) {
        return { version: versioned.version, payload: versioned.payload };
      }
    }

    const profile = this.repos.configProfiles.findByIdSystem(device.config.profileId);
    if (!profile) return null;
    return { version: profile.version, payload: profile.payload };
  }

  handshake(
    auth: DeviceAuthContext,
    input: { firmwareVersion: string },
    ip: string,
  ): {
    serverTime: string;
    heartbeatIntervalSec: number;
    config: PendingConfigDescriptor | null;
  } {
    const nowIso = new Date().toISOString();
    const firmwareVersion = input.firmwareVersion.trim();
    const wasProvisioned = auth.device.state === 'PROVISIONED';
    const currentLive = this.liveState.get(auth.device.id);
    const wasOffline = (currentLive?.connectivity ?? auth.device.connectivity) !== 'ONLINE';
    const nextState = wasProvisioned ? 'ACTIVE' : auth.device.state;

    this.repos.devices.activateFromHandshakeSystem(
      auth.device.id,
      { firmwareVersion, lastSeenAt: nowIso },
      wasProvisioned
        ? {
            id: generateId('dsh'),
            tenantId: auth.device.tenantId,
            deviceId: auth.device.id,
            from: 'PROVISIONED',
            to: 'ACTIVE',
            reason: 'First authenticated device handshake',
            actorId: 'SYSTEM',
            at: nowIso,
          }
        : null,
    );

    if (wasOffline) {
      this.repos.devices.insertConnectivityEvent({
        id: generateId('cev'),
        tenantId: auth.device.tenantId,
        deviceId: auth.device.id,
        state: 'ONLINE',
        at: nowIso,
      });
    }

    this.liveState.recordHandshake(toDevicePublic(auth.device), firmwareVersion, nowIso, nextState);

    if (wasProvisioned) {
      this.audit.record({
        actorId: auth.device.id,
        actorRole: 'SYSTEM',
        tenantId: auth.device.tenantId,
        action: 'DEVICE_ACTIVATED',
        targetType: 'DEVICE',
        targetId: auth.device.id,
        outcome: 'SUCCESS',
        ip,
        details: { firmwareVersion, previousState: 'PROVISIONED', newState: 'ACTIVE' },
      });
    }

    const pendingConfig = this.resolvePendingConfig(auth.device);
    if (pendingConfig) {
      const pendingCmds = this.repos.deviceCommands
        .listPendingForDeviceSystem(auth.device.id)
        .filter((c) => c.type === 'APPLY_CONFIG' && c.status === 'PENDING')
        .map((c) => c.id);
      if (pendingCmds.length > 0) {
        this.repos.deviceCommands.markDeliveredSystem(pendingCmds, nowIso);
      }
    }

    return {
      serverTime: nowIso,
      heartbeatIntervalSec: auth.tenant.settings.heartbeatIntervalSec,
      config: pendingConfig,
    };
  }

  heartbeat(
    auth: DeviceAuthContext,
    input: { timestamp?: string; health?: unknown },
  ): { accepted: true } {
    const nowIso = new Date().toISOString();
    const tsIso = this.resolveValidTimestamp(input.timestamp, nowIso, auth.device);
    const healthValidation = validateHealthPayload(input.health);

    if (!healthValidation.valid) {
      const nextCount = this.repos.devices.incrementInvalidPayloadCountSystem(auth.device.id);
      this.liveState.recordInvalidPayload(toDevicePublic(auth.device), nextCount);
      throw Errors.validation('Heartbeat health payload validation failed', {
        errors: healthValidation.errors,
      });
    }

    const health: DeviceHealthSnapshot = healthValidation.health ?? {};
    const devicePublic = toDevicePublic(auth.device);
    const becameOnline = this.liveState.recordHeartbeat(devicePublic, health, nowIso);

    if (becameOnline) {
      this.repos.devices.updateConnectivitySystem(auth.device.id, 'ONLINE', nowIso);
      this.repos.devices.insertConnectivityEvent({
        id: generateId('cev'),
        tenantId: auth.device.tenantId,
        deviceId: auth.device.id,
        state: 'ONLINE',
        at: nowIso,
      });
    }

    const latest = this.liveState.get(auth.device.id);
    this.dispatchAlertEvaluation({
      tenantId: auth.device.tenantId,
      deviceId: auth.device.id,
      modelId: auth.device.modelId,
      siteId: auth.device.siteId,
      state: latest?.state ?? auth.device.state,
      timestamp: tsIso,
      metrics: latest?.latestMetrics ?? auth.device.latestMetrics,
      health: latest?.latestHealth ?? health,
    });

    return { accepted: true };
  }

  telemetry(
    auth: DeviceAuthContext,
    input: { timestamp: string; metrics: unknown; health?: unknown },
  ): { accepted: true; duplicate: boolean } {
    const nowIso = new Date().toISOString();
    const tsIso = this.resolveValidTimestamp(input.timestamp, null, auth.device);

    const validation = validateTelemetryPayload(input.metrics, input.health, auth.model.metrics);
    if (!validation.valid) {
      const nextCount = this.repos.devices.incrementInvalidPayloadCountSystem(auth.device.id);
      this.liveState.recordInvalidPayload(toDevicePublic(auth.device), nextCount);
      throw Errors.validation('Telemetry payload validation failed', {
        errors: validation.errors,
      });
    }

    const devicePublic = toDevicePublic(auth.device);
    const { duplicate, becameOnline } = this.liveState.recordTelemetry(
      devicePublic,
      {
        ts: tsIso,
        metrics: validation.sanitizedMetrics,
        health: validation.sanitizedHealth,
      },
      nowIso,
    );

    if (becameOnline) {
      this.repos.devices.updateConnectivitySystem(auth.device.id, 'ONLINE', nowIso);
      this.repos.devices.insertConnectivityEvent({
        id: generateId('cev'),
        tenantId: auth.device.tenantId,
        deviceId: auth.device.id,
        state: 'ONLINE',
        at: nowIso,
      });
    }

    if (!duplicate) {
      const latest = this.liveState.get(auth.device.id);
      this.dispatchAlertEvaluation({
        tenantId: auth.device.tenantId,
        deviceId: auth.device.id,
        modelId: auth.device.modelId,
        siteId: auth.device.siteId,
        state: latest?.state ?? auth.device.state,
        timestamp: tsIso,
        metrics: validation.sanitizedMetrics,
        health: latest?.latestHealth ?? validation.sanitizedHealth ?? {},
      });
    }

    return { accepted: true, duplicate };
  }

  pollCommands(auth: DeviceAuthContext): {
    config: PendingConfigDescriptor | null;
    update: PendingUpdateDescriptor | null;
    commands: Array<{ id: string; type: DeviceCommandPublic['type'] }>;
  } {
    const nowIso = new Date().toISOString();
    const becameOnline = this.liveState.recordCommandPoll(toDevicePublic(auth.device), nowIso);

    if (becameOnline) {
      this.repos.devices.updateConnectivitySystem(auth.device.id, 'ONLINE', nowIso);
      this.repos.devices.insertConnectivityEvent({
        id: generateId('cev'),
        tenantId: auth.device.tenantId,
        deviceId: auth.device.id,
        state: 'ONLINE',
        at: nowIso,
      });
    }

    const pendingAll = this.repos.deviceCommands.listPendingForDeviceSystem(auth.device.id);
    const pendingToDeliverIds = pendingAll
      .filter((c) => c.status === 'PENDING')
      .map((c) => c.id);
    if (pendingToDeliverIds.length > 0) {
      this.repos.deviceCommands.markDeliveredSystem(pendingToDeliverIds, nowIso);
    }

    const pendingConfig = this.resolvePendingConfig(auth.device);
    const pendingUpdate = this.rolloutService
      ? this.rolloutService.getPendingUpdateForDevicePoll(auth.device)
      : null;

    // Only non-config commands (e.g. RESTART) are returned in the commands array; config is in `config`
    const nonConfigCommands = pendingAll
      .filter((c) => c.type === 'RESTART')
      .map((c) => ({ id: c.id, type: c.type }));

    return {
      config: pendingConfig,
      update: pendingUpdate,
      commands: nonConfigCommands,
    };
  }

  configAck(
    auth: DeviceAuthContext,
    input: { version: number; status: 'APPLIED' | 'FAILED'; error?: string | null },
    ip: string,
  ): { ok: true } {
    const nowIso = new Date().toISOString();
    const errorMsg =
      input.status === 'FAILED'
        ? input.error?.trim() || 'Device reported config failure'
        : null;

    this.repos.devices.updateConfigStatusSystem(auth.device.id, {
      version: input.version,
      status: input.status,
      error: errorMsg,
    });

    this.repos.deviceCommands.ackPendingApplyConfigSystem(
      auth.device.id,
      input.status === 'APPLIED' ? 'ACKED' : 'FAILED',
      nowIso,
    );

    this.audit.record({
      actorId: auth.device.id,
      actorRole: 'SYSTEM',
      tenantId: auth.device.tenantId,
      action: input.status === 'APPLIED' ? 'CONFIG_APPLIED' : 'CONFIG_FAILED',
      targetType: 'DEVICE',
      targetId: auth.device.id,
      outcome: input.status === 'APPLIED' ? 'SUCCESS' : 'FAILURE',
      ip,
      details: {
        profileId: auth.device.config.profileId,
        version: input.version,
        status: input.status,
        error: errorMsg,
      },
    });

    return { ok: true };
  }

  updateJobStatus(
    auth: DeviceAuthContext,
    jobId: string,
    input: {
      status: 'DOWNLOADING' | 'INSTALLING' | 'VERIFIED' | 'FAILED';
      newVersion?: string | null;
      errorCode?: string | null;
    },
    ip: string,
  ): { ok: true; job: RolloutJobPublic; rolloutStatus: RolloutPublic['status'] } {
    if (!this.rolloutService) {
      throw Errors.internal('Rollout service not configured');
    }
    const result = this.rolloutService.reportDeviceJobStatus(auth.device, jobId, input, ip);
    return { ok: true, ...result };
  }

  downloadFirmware(
    auth: DeviceAuthContext,
    firmwareId: string,
  ): { buffer: Buffer; checksumSha256: string; sizeBytes: number; version: string } {
    if (!this.rolloutService || !this.firmwareService) {
      throw Errors.internal('Firmware download service not configured');
    }

    // Strict device-header authorization: only allowed if device has an active rollout job for this firmware
    this.rolloutService.assertDeviceAuthorizedForFirmware(auth.device, firmwareId);
    const { record, buffer } = this.firmwareService.readBinaryForDevice(firmwareId);

    return {
      buffer,
      checksumSha256: record.checksumSha256,
      sizeBytes: record.sizeBytes,
      version: record.version,
    };
  }

  commandAck(
    auth: DeviceAuthContext,
    commandId: string,
    input: { status: 'ACKED' | 'FAILED' },
    ip: string,
  ): { ok: true; command: DeviceCommandPublic } {
    const nowIso = new Date().toISOString();
    const acked = this.repos.deviceCommands.ackSystem(auth.device.id, commandId, input.status, nowIso);
    if (!acked) {
      throw Errors.notFound('Pending device command not found');
    }

    this.audit.record({
      actorId: auth.device.id,
      actorRole: 'SYSTEM',
      tenantId: auth.device.tenantId,
      action: input.status === 'ACKED' ? 'DEVICE_COMMAND_ACKED' : 'DEVICE_COMMAND_FAILED',
      targetType: 'DEVICE',
      targetId: auth.device.id,
      outcome: input.status === 'ACKED' ? 'SUCCESS' : 'FAILURE',
      ip,
      details: { commandId: acked.id, type: acked.type, status: acked.status },
    });

    return { ok: true, command: acked };
  }

  private resolveValidTimestamp(
    raw: string | undefined,
    fallbackIso: string | null,
    device: DeviceRecord,
  ): string {
    if (raw === undefined) {
      if (fallbackIso) return fallbackIso;
      const nextCount = this.repos.devices.incrementInvalidPayloadCountSystem(device.id);
      this.liveState.recordInvalidPayload(toDevicePublic(device), nextCount);
      throw Errors.validation('timestamp is required and must be a valid ISO-8601 date string', {
        errors: ['timestamp is required'],
      });
    }

    const parsed = Date.parse(raw);
    if (!Number.isFinite(parsed)) {
      const nextCount = this.repos.devices.incrementInvalidPayloadCountSystem(device.id);
      this.liveState.recordInvalidPayload(toDevicePublic(device), nextCount);
      throw Errors.validation('timestamp must be a valid ISO-8601 date string', {
        errors: ['Invalid ISO timestamp'],
      });
    }

    return new Date(parsed).toISOString();
  }

  private dispatchAlertEvaluation(event: {
    tenantId: string;
    deviceId: string;
    modelId: string;
    siteId: string;
    state: DeviceRecord['state'];
    timestamp: string;
    metrics: Record<string, number | boolean | string>;
    health: DeviceHealthSnapshot;
  }): void {
    const hook = this.liveState.getAlertEvaluationHook();
    if (!hook) return;
    setImmediate(() => {
      Promise.resolve(hook.onTelemetryOrHeartbeat(event)).catch((err) => {
        logger.error('AlertEvaluationHook.onTelemetryOrHeartbeat failed', {
          deviceId: event.deviceId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    });
  }
}
