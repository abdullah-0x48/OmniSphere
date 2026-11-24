import crypto from 'node:crypto';
import type {
  DeviceModel,
  SimulatorFaultKind,
  SimulatorLogEvent,
  SimulatorProfile,
  SimulatorStatusResponse,
  SimulatedDeviceStatus,
} from '../../../shared/types.ts';
import { config } from '../config.ts';
import type { Repositories } from '../repositories/index.ts';
import type { TenantContext } from '../repositories/types.ts';
import { Errors } from '../utils/errors.ts';
import { generateId } from '../utils/ids.ts';
import { verifyDeviceApiKey } from '../services/deviceLifecycle.ts';
import type { DeviceService } from '../services/deviceService.ts';
import type { LiveStateStore } from '../services/liveStateStore.ts';
import { verifySha256Checksum } from '../services/otaAndConfigLogic.ts';

interface ManagedSimDevice {
  deviceId: string;
  tenantId: string;
  apiKey: string; // Server-only, NEVER exposed to API responses
  running: boolean;
  intervalSec: number;
  profile: SimulatorProfile;
  firmwareVersion: string;
  lastValues: Record<string, number>;
  batteryLevel: number | null;
  uptimeSec: number;
  startedAtMs: number;
  lastHeartbeatMs: number;
  heartbeatIntervalSec: number;
  lastHttpStatus: number | null;
  lastSentAt: string | null;
  lastError: string | null;
  // Fault injection state
  forceOfflineUntilMs: number | null;
  spikeMetricKey: string | null;
  spikeMetricValue: number | null;
  spikeUntilMs: number | null;
  failNextOtaChecksum: boolean;
  failNextOtaBoot: boolean;
  ignoreNextConfig: boolean;
  restartSilenceUntilMs: number | null;
  activeOtaJobId: string | null;
  timer: ReturnType<typeof setInterval> | null;
}

const MAX_LOG_EVENTS = 250;

/**
 * Built-in server-side Device Simulator Manager (Section 12.1 & 12.2).
 * CRITICAL: Every simulated device calls the real `/device/v1/*` endpoints over HTTP on
 * `http://127.0.0.1:${config.port}/device/v1/...`, exercising full device auth, validation,
 * rate limiting, LiveState, and command delivery.
 */
export class SimulatorManager {
  private readonly managed = new Map<string, ManagedSimDevice>();
  private readonly logs: SimulatorLogEvent[] = [];
  private defaultIntervalSec = 10;
  private defaultProfile: SimulatorProfile = 'NORMAL';

  constructor(
    private readonly repos: Repositories,
    private readonly deviceService: DeviceService,
    private readonly liveState: LiveStateStore,
    private baseUrlResolver: () => string = () =>
      `http://127.0.0.1:${config.port}/device/v1`,
    private otaStepDelayMs: number = 5000,
  ) {}

  setBaseUrl(baseUrl: string): void {
    const clean = baseUrl.replace(/\/+$/, '');
    this.baseUrlResolver = () => (clean.endsWith('/device/v1') ? clean : `${clean}/device/v1`);
  }

  setOtaStepDelayMs(delayMs: number): void {
    this.otaStepDelayMs = Math.max(0, delayMs);
  }

  /**
   * Loads all server-side `simulator_credentials` rows into the managed pool (stopped initially).
   */
  syncFromDatabase(): number {
    const creds = this.repos.devices.listSimulatorCredentialsSystem();
    for (const c of creds) {
      if (this.managed.has(c.deviceId)) continue;
      const dev = this.repos.devices.findByIdSystem(c.deviceId);
      if (!dev || dev.state === 'DECOMMISSIONED') continue;
      this.managed.set(c.deviceId, this.createManagedEntry(dev.id, dev.tenantId, c.apiKey, dev.firmwareVersion ?? '1.0.0', dev.modelId, dev.latestMetrics, dev.latestHealth.batteryLevel ?? null));
    }
    return this.managed.size;
  }

  /**
   * Creates N demo devices in the caller's tenant via DeviceService.register(), persists
   * server-only simulator credentials, and attaches them to the simulator pool.
   */
  createDemoDevices(
    ctx: TenantContext,
    input: { count: number; modelId: string; siteId: string },
    ip: string,
  ): { createdDeviceIds: string[]; count: number } {
    const count = Math.max(1, Math.min(50, Math.floor(input.count)));
    const model = this.repos.deviceModels.findById(input.modelId);
    if (!model) {
      throw Errors.validation('Selected device model does not exist', { field: 'modelId' });
    }

    const shortModel = model.name.split(' ')[0].replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6) || 'DEV';
    const createdDeviceIds: string[] = [];

    for (let i = 0; i < count; i += 1) {
      const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
      const serial = `SN-SIM-${shortModel}-${Date.now().toString().slice(-5)}${i}${rand}`;
      const macHex = Array.from({ length: 6 }, () =>
        Math.floor(Math.random() * 256)
          .toString(16)
          .padStart(2, '0')
          .toUpperCase(),
      ).join(':');
      const name = `SIM-${shortModel}-${rand}-${String(i + 1).padStart(2, '0')}`;

      const reg = this.deviceService.register(
        ctx,
        {
          name,
          serialNumber: serial,
          hardwareId: macHex,
          modelId: input.modelId,
          siteId: input.siteId,
          tags: ['simulated'],
        },
        ip,
      );

      this.repos.devices.setSimulatorCredential(reg.device.id, reg.device.tenantId, reg.provisioning.apiKey);
      this.managed.set(
        reg.device.id,
        this.createManagedEntry(
          reg.device.id,
          reg.device.tenantId,
          reg.provisioning.apiKey,
          '1.0.0',
          reg.device.modelId,
          {},
          reg.device.modelId === 'mdl_em120' ? null : 88,
        ),
      );
      createdDeviceIds.push(reg.device.id);
    }

    return { createdDeviceIds, count: createdDeviceIds.length };
  }

  /**
   * Attaches an existing registered device by its provisioning payload (`deviceId` + `apiKey`).
   * Validates tenant scope and verifies the key against `apiKeyHash` before storing.
   * Always ignores any external `apiBaseUrl` to prevent SSRF — simulator always calls localhost.
   */
  attachProvisioning(
    ctx: TenantContext,
    input: { deviceId: string; apiKey: string },
  ): { deviceId: string; attached: true } {
    const device = this.repos.devices.findById(ctx, input.deviceId.trim());
    if (!device) {
      throw Errors.notFound('Device not found in your organization scope');
    }
    if (device.state === 'DECOMMISSIONED') {
      throw Errors.invalidTransition('Decommissioned devices cannot be attached to the simulator');
    }
    if (!device.apiKeyHash || !verifyDeviceApiKey(input.apiKey.trim(), device.apiKeyHash)) {
      throw Errors.validation('Provided API key does not match this device', { field: 'apiKey' });
    }

    this.repos.devices.setSimulatorCredential(device.id, device.tenantId, input.apiKey.trim());

    const existing = this.managed.get(device.id);
    if (existing) {
      existing.apiKey = input.apiKey.trim();
      existing.lastError = null;
    } else {
      this.managed.set(
        device.id,
        this.createManagedEntry(
          device.id,
          device.tenantId,
          input.apiKey.trim(),
          device.firmwareVersion ?? '1.0.0',
          device.modelId,
          device.latestMetrics,
          device.latestHealth.batteryLevel ?? (device.modelId === 'mdl_em120' ? null : 85),
        ),
      );
    }

    this.pushLog({
      deviceId: device.id,
      deviceName: device.name,
      tenantId: device.tenantId,
      method: 'ATTACH',
      endpoint: '/api/v1/simulator/attach',
      statusCode: 200,
      message: 'Device attached to simulator pool',
    });

    return { deviceId: device.id, attached: true };
  }

  start(
    ctx: TenantContext,
    input: { deviceIds?: string[]; intervalSec?: number; profile?: SimulatorProfile },
  ): { startedCount: number } {
    this.syncFromDatabase();
    if (input.intervalSec !== undefined) {
      this.defaultIntervalSec = Math.max(5, Math.min(60, Math.floor(input.intervalSec)));
    }
    if (input.profile !== undefined) {
      this.defaultProfile = input.profile;
    }

    const targets = this.resolveScopedTargets(ctx, input.deviceIds);
    let startedCount = 0;

    for (const sim of targets) {
      if (input.intervalSec !== undefined) {
        sim.intervalSec = this.defaultIntervalSec;
      }
      if (input.profile !== undefined) {
        sim.profile = this.defaultProfile;
      }

      if (sim.running) {
        // Restart interval if cadence changed
        this.restartDeviceTimer(sim);
        startedCount += 1;
        continue;
      }

      sim.running = true;
      sim.startedAtMs = Date.now();
      sim.lastError = null;
      startedCount += 1;

      // Immediately perform handshake + first telemetry tick over real HTTP on localhost
      void this.runHandshakeThenTick(sim);
      this.restartDeviceTimer(sim);
    }

    return { startedCount };
  }

  stop(ctx: TenantContext, input: { deviceIds?: string[] }): { stoppedCount: number } {
    const targets = this.resolveScopedTargets(ctx, input.deviceIds);
    let stoppedCount = 0;

    for (const sim of targets) {
      if (sim.timer) {
        clearInterval(sim.timer);
        sim.timer = null;
      }
      if (sim.running) {
        sim.running = false;
        stoppedCount += 1;
      }
    }

    return { stoppedCount };
  }

  stopAll(): void {
    for (const sim of this.managed.values()) {
      if (sim.timer) {
        clearInterval(sim.timer);
        sim.timer = null;
      }
      sim.running = false;
    }
  }

  injectFault(
    ctx: TenantContext,
    input: { deviceId: string; fault: SimulatorFaultKind; metricKey?: string; value?: number },
  ): { ok: true; activeFaults: string[] } {
    this.syncFromDatabase();
    const device = this.repos.devices.findById(ctx, input.deviceId);
    if (!device) {
      throw Errors.notFound('Device not found');
    }
    const sim = this.managed.get(device.id);
    if (!sim) {
      throw Errors.validation('Attach this device to the simulator before injecting faults');
    }

    const now = Date.now();
    switch (input.fault) {
      case 'FORCE_OFFLINE':
        sim.forceOfflineUntilMs = now + 3 * 60_000;
        break;
      case 'SPIKE_METRIC': {
        const model = this.repos.deviceModels.findById(device.modelId);
        const numericMetrics = (model?.metrics ?? []).filter((m) => m.type === 'number');
        const chosen =
          (input.metricKey && numericMetrics.find((m) => m.key === input.metricKey)) ||
          numericMetrics[0];
        if (!chosen) {
          throw Errors.validation('Device model has no numeric metric to spike');
        }
        const defaultSpike =
          chosen.max !== null ? Math.round(chosen.max * 0.94 * 10) / 10 : 95;
        const clampedVal =
          input.value !== undefined
            ? Math.min(chosen.max ?? input.value, Math.max(chosen.min ?? input.value, input.value))
            : defaultSpike;
        sim.spikeMetricKey = chosen.key;
        sim.spikeMetricValue = clampedVal;
        sim.spikeUntilMs = now + 2 * 60_000;
        break;
      }
      case 'LOW_BATTERY':
        sim.batteryLevel = 10;
        break;
      case 'FAIL_OTA_CHECKSUM':
        sim.failNextOtaChecksum = true;
        break;
      case 'FAIL_OTA_BOOT':
        sim.failNextOtaBoot = true;
        break;
      case 'IGNORE_NEXT_CONFIG':
        sim.ignoreNextConfig = true;
        break;
      case 'CLEAR_FAULTS':
        sim.forceOfflineUntilMs = null;
        sim.spikeMetricKey = null;
        sim.spikeMetricValue = null;
        sim.spikeUntilMs = null;
        sim.failNextOtaChecksum = false;
        sim.failNextOtaBoot = false;
        sim.ignoreNextConfig = false;
        if (device.modelId !== 'mdl_em120') sim.batteryLevel = 85;
        break;
    }

    this.pushLog({
      deviceId: device.id,
      deviceName: device.name,
      tenantId: device.tenantId,
      method: 'FAULT',
      endpoint: '/api/v1/simulator/inject',
      statusCode: 200,
      message: `Injected fault: ${input.fault}${sim.spikeMetricKey && input.fault === 'SPIKE_METRIC' ? ` (${sim.spikeMetricKey}=${sim.spikeMetricValue})` : ''}`,
    });

    if (sim.running && (input.fault === 'SPIKE_METRIC' || input.fault === 'LOW_BATTERY')) {
      void this.runTick(sim);
    }

    return { ok: true, activeFaults: this.describeActiveFaults(sim, now) };
  }

  getStatus(ctx: TenantContext): SimulatorStatusResponse {
    this.syncFromDatabase();
    const now = Date.now();
    const scopedDevices = this.repos.devices.listAllInScope(ctx);
    const deviceById = new Map(scopedDevices.map((d) => [d.id, this.liveState.mergeIntoDevice(d)]));

    const items: SimulatedDeviceStatus[] = [];
    for (const [deviceId, sim] of this.managed.entries()) {
      const d = deviceById.get(deviceId);
      if (!d) continue;
      if (d.state === 'DECOMMISSIONED') continue;
      items.push({
        deviceId: d.id,
        deviceName: d.name,
        serialNumber: d.serialNumber,
        tenantId: d.tenantId,
        modelId: d.modelId,
        modelName: d.modelName ?? d.modelId,
        siteId: d.siteId,
        siteName: d.siteName ?? d.siteId,
        state: d.state,
        connectivity: d.connectivity,
        running: sim.running,
        intervalSec: sim.intervalSec,
        profile: sim.profile,
        firmwareVersion: d.firmwareVersion ?? sim.firmwareVersion,
        lastHttpStatus: sim.lastHttpStatus,
        lastSentAt: sim.lastSentAt,
        lastError: sim.lastError,
        activeFaults: this.describeActiveFaults(sim, now),
      });
    }

    items.sort((a, b) => {
      if (a.running !== b.running) return a.running ? -1 : 1;
      return a.deviceName.localeCompare(b.deviceName);
    });

    const allowedTenantSet = new Set(scopedDevices.map((d) => d.tenantId));
    if (ctx.activeTenantId) {
      allowedTenantSet.clear();
      allowedTenantSet.add(ctx.activeTenantId);
    }

    const scopedLogs = this.logs
      .filter((l) => ctx.allTenants && !ctx.activeTenantId ? true : allowedTenantSet.has(l.tenantId))
      .slice(-100)
      .reverse();

    return {
      runningCount: items.filter((i) => i.running).length,
      totalCount: items.length,
      defaultIntervalSec: this.defaultIntervalSec,
      defaultProfile: this.defaultProfile,
      devices: items,
      logs: scopedLogs,
    };
  }

  private resolveScopedTargets(ctx: TenantContext, deviceIds?: string[]): ManagedSimDevice[] {
    const scopedDevices = this.repos.devices.listAllInScope(ctx);
    const allowedIds = new Set(
      scopedDevices.filter((d) => d.state !== 'DECOMMISSIONED').map((d) => d.id),
    );

    const targets: ManagedSimDevice[] = [];
    if (deviceIds && deviceIds.length > 0) {
      for (const id of deviceIds) {
        if (!allowedIds.has(id)) continue;
        const sim = this.managed.get(id);
        if (sim) targets.push(sim);
      }
    } else {
      for (const [id, sim] of this.managed.entries()) {
        if (allowedIds.has(id)) targets.push(sim);
      }
    }
    return targets;
  }

  private restartDeviceTimer(sim: ManagedSimDevice): void {
    if (sim.timer) {
      clearInterval(sim.timer);
      sim.timer = null;
    }
    sim.timer = setInterval(() => {
      void this.runTick(sim);
    }, sim.intervalSec * 1000);
    sim.timer.unref?.();
  }

  private async runHandshakeThenTick(sim: ManagedSimDevice): Promise<void> {
    const dev = this.repos.devices.findByIdSystem(sim.deviceId);
    if (!dev) return;

    const ok = await this.callDeviceEndpoint(sim, dev.name, 'POST', '/handshake', {
      firmwareVersion: sim.firmwareVersion,
    });
    if (ok && ok.json) {
      if (typeof ok.json.heartbeatIntervalSec === 'number') {
        sim.heartbeatIntervalSec = ok.json.heartbeatIntervalSec;
      }
      if (ok.json.config && typeof ok.json.config === 'object') {
        const cfg = ok.json.config as { version?: number; payload?: Record<string, unknown> };
        if (typeof cfg.version === 'number') {
          await this.handleConfigApply(sim, dev.name, cfg.version);
        }
      }
    }
    if (sim.running) {
      await this.runTick(sim);
    }
  }

  private async runTick(sim: ManagedSimDevice): Promise<void> {
    if (!sim.running) return;
    const now = Date.now();

    // Respect force-offline fault or simulated restart downtime
    if (sim.forceOfflineUntilMs && now < sim.forceOfflineUntilMs) {
      return;
    }
    if (sim.restartSilenceUntilMs) {
      if (now < sim.restartSilenceUntilMs) {
        return;
      }
      sim.restartSilenceUntilMs = null;
      sim.uptimeSec = 1;
      const devAfterBoot = this.repos.devices.findByIdSystem(sim.deviceId);
      if (devAfterBoot) {
        await this.callDeviceEndpoint(sim, devAfterBoot.name, 'POST', '/handshake', {
          firmwareVersion: sim.firmwareVersion,
        });
      }
    }

    // Random dropouts profile skips ~25% of ticks
    if (sim.profile === 'RANDOM_DROPOUTS' && Math.random() < 0.25) {
      return;
    }

    const dev = this.repos.devices.findByIdSystem(sim.deviceId);
    if (!dev || dev.state === 'DECOMMISSIONED') {
      if (sim.timer) clearInterval(sim.timer);
      sim.timer = null;
      sim.running = false;
      return;
    }

    const model = this.repos.deviceModels.findById(dev.modelId);
    if (!model) return;

    sim.uptimeSec += sim.intervalSec;
    const metrics = this.generateNextMetrics(sim, model, now);
    const health = this.generateNextHealth(sim, model);
    const ts = new Date().toISOString();

    await this.callDeviceEndpoint(sim, dev.name, 'POST', '/telemetry', {
      timestamp: ts,
      metrics,
      health,
    });

    // Send explicit heartbeat at tenant heartbeat interval
    if (now - sim.lastHeartbeatMs >= sim.heartbeatIntervalSec * 1000) {
      sim.lastHeartbeatMs = now;
      await this.callDeviceEndpoint(sim, dev.name, 'POST', '/heartbeat', {
        timestamp: ts,
        health,
      });
    }

    // Poll commands over real HTTP
    const cmdRes = await this.callDeviceEndpoint(sim, dev.name, 'GET', '/commands');
    if (cmdRes && cmdRes.ok && cmdRes.json) {
      // 1. Apply pending configuration profile (Section 12.2)
      if (cmdRes.json.config && typeof cmdRes.json.config === 'object') {
        const cfg = cmdRes.json.config as { version?: number; payload?: Record<string, unknown> };
        if (typeof cfg.version === 'number') {
          await this.handleConfigApply(sim, dev.name, cfg.version);
        }
      }

      // 2. Execute OTA firmware update if queued and not already running on this device
      if (cmdRes.json.update && typeof cmdRes.json.update === 'object' && !sim.activeOtaJobId) {
        const upd = cmdRes.json.update as {
          jobId?: string;
          firmwareId?: string;
          version?: string;
          downloadPath?: string;
          sha256?: string;
        };
        if (upd.jobId && upd.version && upd.downloadPath && upd.sha256) {
          sim.activeOtaJobId = upd.jobId;
          void this.handleOtaUpdate(sim, dev.name, {
            jobId: upd.jobId,
            firmwareId: upd.firmwareId ?? '',
            version: upd.version,
            downloadPath: upd.downloadPath,
            sha256: upd.sha256,
          }).finally(() => {
            if (sim.activeOtaJobId === upd.jobId) {
              sim.activeOtaJobId = null;
            }
          });
        }
      }

      // 3. Execute discrete device commands (RESTART)
      if (Array.isArray(cmdRes.json.commands)) {
        for (const cmd of cmdRes.json.commands as Array<{ id: string; type: string }>) {
          if (cmd.type === 'RESTART') {
            await this.callDeviceEndpoint(sim, dev.name, 'POST', `/commands/${cmd.id}/ack`, {
              status: 'ACKED',
            });
            sim.restartSilenceUntilMs = Date.now() + 10_000;
            sim.uptimeSec = 0;
            this.pushLog({
              deviceId: sim.deviceId,
              deviceName: dev.name,
              tenantId: sim.tenantId,
              method: 'CMD',
              endpoint: '/device/v1/commands',
              statusCode: 200,
              message: `Executing RESTART (${cmd.id}) — 10s simulated reboot`,
            });
            break;
          }
        }
      }
    }
  }

  private async handleConfigApply(
    sim: ManagedSimDevice,
    deviceName: string,
    version: number,
  ): Promise<void> {
    if (sim.ignoreNextConfig) {
      sim.ignoreNextConfig = false;
      await this.callDeviceEndpoint(sim, deviceName, 'POST', '/config-ack', {
        version,
        status: 'FAILED',
        error: 'Simulated fault: IGNORE_NEXT_CONFIG',
      });
      return;
    }

    await this.callDeviceEndpoint(sim, deviceName, 'POST', '/config-ack', {
      version,
      status: 'APPLIED',
    });
  }

  /**
   * Executes full Section 12.2 OTA flow over real localhost HTTP:
   * DOWNLOADING -> GET /device/v1/firmware/:id/download (device headers) -> SHA-256 verify
   * -> wait -> INSTALLING -> wait -> VERIFIED + re-handshake (or FAILED on mismatch/injected fault).
   */
  private async handleOtaUpdate(
    sim: ManagedSimDevice,
    deviceName: string,
    update: {
      jobId: string;
      firmwareId: string;
      version: string;
      downloadPath: string;
      sha256: string;
    },
  ): Promise<void> {
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

    // Step 1: Report DOWNLOADING
    const dlStatusRes = await this.callDeviceEndpoint(
      sim,
      deviceName,
      'POST',
      `/updates/${update.jobId}/status`,
      { status: 'DOWNLOADING' },
    );
    if (!dlStatusRes || !dlStatusRes.ok) return;

    // Step 2: Download firmware binary via authenticated device headers (no signed URLs)
    const relativePath = update.downloadPath.startsWith('/device/v1')
      ? update.downloadPath.slice('/device/v1'.length)
      : update.downloadPath;
    const downloadUrl = `${this.baseUrlResolver()}${relativePath}`;

    let bytes: Buffer;
    let headerChecksum = '';
    try {
      const response = await fetch(downloadUrl, {
        method: 'GET',
        headers: {
          'X-Device-Id': sim.deviceId,
          'X-API-Key': sim.apiKey,
        },
      });
      sim.lastHttpStatus = response.status;
      sim.lastSentAt = new Date().toISOString();
      headerChecksum = response.headers.get('x-checksum-sha256') ?? '';

      this.pushLog({
        deviceId: sim.deviceId,
        deviceName,
        tenantId: sim.tenantId,
        method: 'GET',
        endpoint: `/device/v1${relativePath}`,
        statusCode: response.status,
        message: response.ok
          ? `Downloaded firmware ${update.version} (${response.headers.get('content-length') ?? '?'} bytes)`
          : `Firmware download failed (HTTP ${response.status})`,
      });

      if (!response.ok) {
        await this.callDeviceEndpoint(
          sim,
          deviceName,
          'POST',
          `/updates/${update.jobId}/status`,
          { status: 'FAILED', errorCode: `DOWNLOAD_HTTP_${response.status}` },
        );
        return;
      }

      bytes = Buffer.from(await response.arrayBuffer());
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Download network error';
      this.pushLog({
        deviceId: sim.deviceId,
        deviceName,
        tenantId: sim.tenantId,
        method: 'GET',
        endpoint: `/device/v1${relativePath}`,
        statusCode: 0,
        message: `Firmware download error: ${msg}`,
      });
      await this.callDeviceEndpoint(
        sim,
        deviceName,
        'POST',
        `/updates/${update.jobId}/status`,
        { status: 'FAILED', errorCode: 'DOWNLOAD_ERROR' },
      );
      return;
    }

    // Step 3: Verify SHA-256 checksum against both X-Checksum-SHA256 header and command sha256
    const computedDigest = crypto.createHash('sha256').update(bytes).digest('hex');
    const injectedChecksumFail = sim.failNextOtaChecksum;
    if (injectedChecksumFail) {
      sim.failNextOtaChecksum = false;
    }

    const headerOk = headerChecksum ? verifySha256Checksum(headerChecksum, computedDigest) : false;
    const commandOk = verifySha256Checksum(update.sha256, computedDigest);

    if (injectedChecksumFail || !headerOk || !commandOk) {
      this.pushLog({
        deviceId: sim.deviceId,
        deviceName,
        tenantId: sim.tenantId,
        method: 'OTA',
        endpoint: `/device/v1/updates/${update.jobId}/status`,
        statusCode: 400,
        message: injectedChecksumFail
          ? `Injected CHECKSUM_MISMATCH fault for ${update.version}; keeping ${sim.firmwareVersion}`
          : `SHA-256 mismatch (got ${computedDigest.slice(0, 12)}...); aborting install`,
      });
      await this.callDeviceEndpoint(
        sim,
        deviceName,
        'POST',
        `/updates/${update.jobId}/status`,
        { status: 'FAILED', errorCode: 'CHECKSUM_MISMATCH' },
      );
      return;
    }

    // Step 4: Wait and report INSTALLING
    if (this.otaStepDelayMs > 0) {
      await sleep(this.otaStepDelayMs);
    }
    const instRes = await this.callDeviceEndpoint(
      sim,
      deviceName,
      'POST',
      `/updates/${update.jobId}/status`,
      { status: 'INSTALLING' },
    );
    if (!instRes || !instRes.ok) return;

    // Step 5: Wait and report VERIFIED (or ROLLED_BACK on injected boot failure)
    if (this.otaStepDelayMs > 0) {
      await sleep(this.otaStepDelayMs);
    }

    if (sim.failNextOtaBoot) {
      sim.failNextOtaBoot = false;
      this.pushLog({
        deviceId: sim.deviceId,
        deviceName,
        tenantId: sim.tenantId,
        method: 'OTA',
        endpoint: `/device/v1/updates/${update.jobId}/status`,
        statusCode: 500,
        message: `Injected BOOT_FAILURE for ${update.version}; rolled back to ${sim.firmwareVersion}`,
      });
      await this.callDeviceEndpoint(
        sim,
        deviceName,
        'POST',
        `/updates/${update.jobId}/status`,
        { status: 'FAILED', errorCode: 'ROLLED_BACK' },
      );
      return;
    }

    sim.firmwareVersion = update.version;
    sim.uptimeSec = 1;

    await this.callDeviceEndpoint(
      sim,
      deviceName,
      'POST',
      `/updates/${update.jobId}/status`,
      { status: 'VERIFIED', newVersion: update.version },
    );

    // Re-handshake with new firmware version (Section 12.2)
    await this.callDeviceEndpoint(sim, deviceName, 'POST', '/handshake', {
      firmwareVersion: sim.firmwareVersion,
    });
  }

  private async callDeviceEndpoint(
    sim: ManagedSimDevice,
    deviceName: string,
    method: 'GET' | 'POST',
    endpointPath: string,
    body?: unknown,
  ): Promise<{ ok: boolean; status: number; json: Record<string, unknown> | null } | null> {
    const url = `${this.baseUrlResolver()}${endpointPath}`;
    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Id': sim.deviceId,
          'X-API-Key': sim.apiKey,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

      const status = response.status;
      sim.lastHttpStatus = status;
      sim.lastSentAt = new Date().toISOString();

      let json: Record<string, unknown> | null = null;
      try {
        json = (await response.json()) as Record<string, unknown>;
      } catch {
        json = null;
      }

      if (!response.ok) {
        const errMsg =
          typeof json?.error === 'object' && json.error && 'message' in json.error
            ? String((json.error as { message: unknown }).message)
            : `HTTP ${status}`;
        sim.lastError = errMsg;
      } else {
        sim.lastError = null;
      }

      this.pushLog({
        deviceId: sim.deviceId,
        deviceName,
        tenantId: sim.tenantId,
        method,
        endpoint: `/device/v1${endpointPath}`,
        statusCode: status,
        message: response.ok
          ? `${method} /device/v1${endpointPath} (${status})`
          : `${method} /device/v1${endpointPath} failed: ${sim.lastError ?? status}`,
      });

      return { ok: response.ok, status, json };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error';
      sim.lastError = msg;
      sim.lastHttpStatus = 0;
      this.pushLog({
        deviceId: sim.deviceId,
        deviceName,
        tenantId: sim.tenantId,
        method,
        endpoint: `/device/v1${endpointPath}`,
        statusCode: 0,
        message: `HTTP call error: ${msg}`,
      });
      return null;
    }
  }

  private generateNextMetrics(
    sim: ManagedSimDevice,
    model: DeviceModel,
    nowMs: number,
  ): Record<string, number | boolean | string> {
    const metrics: Record<string, number | boolean | string> = {};

    for (const def of model.metrics) {
      if (def.type !== 'number') {
        metrics[def.key] = def.type === 'boolean' ? true : 'OK';
        continue;
      }

      // Check active metric spike fault
      if (
        sim.spikeMetricKey === def.key &&
        sim.spikeMetricValue !== null &&
        sim.spikeUntilMs &&
        nowMs < sim.spikeUntilMs
      ) {
        metrics[def.key] = sim.spikeMetricValue;
        continue;
      }

      const min = def.min ?? 0;
      const max = def.max ?? 100;
      const span = Math.max(1, max - min);
      const prev =
        sim.lastValues[def.key] ??
        this.defaultMidpointForMetric(def.key, min, max);

      let next: number;
      if (def.key === 'energy_kwh') {
        next = prev + 0.15 + Math.random() * 0.35;
      } else {
        const step = (Math.random() - 0.5) * Math.min(span * 0.03, 2.5);
        const drift =
          sim.profile === 'DRIFTING_TEMPERATURE' && def.key === 'temperature' ? 1.4 : 0;
        next = prev + step + drift;
      }

      // Clamp safely inside model bounds
      next = Math.max(min + span * 0.01, Math.min(max - span * 0.01, next));
      next = Math.round(next * 100) / 100;
      sim.lastValues[def.key] = next;
      metrics[def.key] = next;
    }

    return metrics;
  }

  private generateNextHealth(sim: ManagedSimDevice, model: DeviceModel) {
    if (sim.batteryLevel !== null) {
      if (sim.profile === 'BATTERY_DRAIN') {
        sim.batteryLevel = Math.max(5, Math.round((sim.batteryLevel - 1.5) * 10) / 10);
      } else {
        // Gentle jitter
        sim.batteryLevel = Math.max(
          5,
          Math.min(100, Math.round((sim.batteryLevel + (Math.random() - 0.52) * 0.4) * 10) / 10),
        );
      }
    }

    return {
      cpuLoad: Math.round((25 + Math.random() * 35) * 10) / 10,
      memoryUsage: Math.round((42 + Math.random() * 24) * 10) / 10,
      batteryLevel: model.id === 'mdl_em120' ? null : sim.batteryLevel,
      signalStrength: Math.round(-56 - Math.random() * 24),
      uptimeSec: sim.uptimeSec,
    };
  }

  private defaultMidpointForMetric(key: string, min: number, max: number): number {
    switch (key) {
      case 'temperature':
        return Math.min(max - 5, Math.max(min + 5, 34));
      case 'humidity':
        return 56;
      case 'vibration_rms':
        return 4.5;
      case 'voltage':
        return 230;
      case 'current':
        return 48;
      case 'power_kw':
        return 22;
      case 'energy_kwh':
        return 15400;
      default:
        return (min + max) / 2;
    }
  }

  private describeActiveFaults(sim: ManagedSimDevice, nowMs: number): string[] {
    const faults: string[] = [];
    if (sim.forceOfflineUntilMs && nowMs < sim.forceOfflineUntilMs) {
      const remSec = Math.ceil((sim.forceOfflineUntilMs - nowMs) / 1000);
      faults.push(`Offline (${remSec}s)`);
    }
    if (sim.spikeMetricKey && sim.spikeUntilMs && nowMs < sim.spikeUntilMs) {
      faults.push(`Spike ${sim.spikeMetricKey}=${sim.spikeMetricValue}`);
    }
    if (sim.batteryLevel !== null && sim.batteryLevel <= 15) {
      faults.push(`Low battery (${sim.batteryLevel}%)`);
    }
    if (sim.failNextOtaChecksum) faults.push('Fail OTA checksum');
    if (sim.failNextOtaBoot) faults.push('Fail OTA boot');
    if (sim.ignoreNextConfig) faults.push('Ignore next config');
    if (sim.restartSilenceUntilMs && nowMs < sim.restartSilenceUntilMs) {
      faults.push('Rebooting');
    }
    return faults;
  }

  private createManagedEntry(
    deviceId: string,
    tenantId: string,
    apiKey: string,
    firmwareVersion: string,
    modelId: string,
    initialMetrics: Record<string, number | boolean | string>,
    batteryLevel: number | null,
  ): ManagedSimDevice {
    const lastValues: Record<string, number> = {};
    for (const [k, v] of Object.entries(initialMetrics)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        lastValues[k] = v;
      }
    }
    return {
      deviceId,
      tenantId,
      apiKey,
      running: false,
      intervalSec: this.defaultIntervalSec,
      profile: this.defaultProfile,
      firmwareVersion,
      lastValues,
      batteryLevel: modelId === 'mdl_em120' ? null : (batteryLevel ?? 84),
      uptimeSec: 3600,
      startedAtMs: Date.now(),
      lastHeartbeatMs: 0,
      heartbeatIntervalSec: 30,
      lastHttpStatus: null,
      lastSentAt: null,
      lastError: null,
      forceOfflineUntilMs: null,
      spikeMetricKey: null,
      spikeMetricValue: null,
      spikeUntilMs: null,
      failNextOtaChecksum: false,
      failNextOtaBoot: false,
      ignoreNextConfig: false,
      restartSilenceUntilMs: null,
      activeOtaJobId: null,
      timer: null,
    };
  }

  private pushLog(entry: Omit<SimulatorLogEvent, 'id' | 'at'>): void {
    this.logs.push({
      id: generateId('sim'),
      at: new Date().toISOString(),
      ...entry,
    });
    if (this.logs.length > MAX_LOG_EVENTS) {
      this.logs.splice(0, this.logs.length - MAX_LOG_EVENTS);
    }
  }
}
