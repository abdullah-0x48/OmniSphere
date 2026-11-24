import { config } from '../config.ts';
import type { Repositories } from '../repositories/index.ts';
import { generateId } from '../utils/ids.ts';
import { logger } from '../utils/logger.ts';
import type { AlertService } from '../services/alertService.ts';
import type { EmailService } from '../services/emailService.ts';
import type { LiveStateStore } from '../services/liveStateStore.ts';
import type { MaintenancePlanService } from '../services/maintenancePlanService.ts';
import type { RolloutService } from '../services/rolloutService.ts';

const OFFLINE_DETECTOR_INTERVAL_MS = 15_000;
const ROLLOUT_SCHEDULER_INTERVAL_MS = 10_000;
const TELEMETRY_FLUSHER_INTERVAL_MS = 60_000;
const ESCALATION_JOB_INTERVAL_MS = 60_000;
const MAINTENANCE_PLANNER_INTERVAL_MS = 5 * 60_000;
const EMAIL_WORKER_INTERVAL_MS = 30_000;
const RETENTION_JOB_INTERVAL_MS = 24 * 60 * 60_000;

/**
 * In-process background jobs (Section 8.9):
 * 1. Offline detector (15s) — marks ACTIVE / UNDER_MAINTENANCE devices OFFLINE when
 *    `now - lastSeenAt > offlineAfterMissedIntervals * heartbeatIntervalSec`, and evaluates OFFLINE rules.
 * 2. Telemetry flusher (60s + graceful shutdown) — flushes buffered telemetry to 10-minute buckets
 *    and debounced `lastSeenAt` / snapshot fields to SQLite.
 * 3. Escalation job (60s) — escalates unacknowledged OPEN CRITICAL alerts L0 -> L1 -> L2.
 * 4. Email worker (30s) — delivers due QUEUED emails with 3 retries (30s, 60s, 120s) then FAILED.
 * 5. Retention job (daily) — deletes telemetry buckets older than `TELEMETRY_RETENTION_DAYS` (90d).
 *    Never deletes `audit_logs`.
 */
export class BackgroundJobsManager {
  private offlineTimer: ReturnType<typeof setInterval> | null = null;
  private rolloutTimer: ReturnType<typeof setInterval> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private escalationTimer: ReturnType<typeof setInterval> | null = null;
  private maintenanceTimer: ReturnType<typeof setInterval> | null = null;
  private emailTimer: ReturnType<typeof setInterval> | null = null;
  private retentionTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;

  constructor(
    private readonly repos: Repositories,
    private readonly liveState: LiveStateStore,
    private readonly alertService?: AlertService,
    private readonly emailService?: EmailService,
    private readonly maintenancePlanService?: MaintenancePlanService,
    private readonly rolloutService?: RolloutService,
  ) {}

  start(): void {
    if (this.started) return;
    this.started = true;

    this.offlineTimer = setInterval(() => {
      try {
        this.runOfflineCheckOnce();
      } catch (err) {
        logger.error('Offline detector job error', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }, OFFLINE_DETECTOR_INTERVAL_MS);
    this.offlineTimer.unref?.();

    this.rolloutTimer = setInterval(() => {
      try {
        this.runRolloutSchedulerOnce();
      } catch (err) {
        logger.error('Rollout scheduler job error', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }, ROLLOUT_SCHEDULER_INTERVAL_MS);
    this.rolloutTimer.unref?.();

    this.flushTimer = setInterval(() => {
      try {
        this.runTelemetryFlushOnce();
      } catch (err) {
        logger.error('Telemetry flusher job error', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }, TELEMETRY_FLUSHER_INTERVAL_MS);
    this.flushTimer.unref?.();

    this.escalationTimer = setInterval(() => {
      try {
        this.runEscalationCheckOnce();
      } catch (err) {
        logger.error('Escalation job error', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }, ESCALATION_JOB_INTERVAL_MS);
    this.escalationTimer.unref?.();

    this.maintenanceTimer = setInterval(() => {
      try {
        this.runMaintenancePlannerOnce();
      } catch (err) {
        logger.error('Maintenance planner job error', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }, MAINTENANCE_PLANNER_INTERVAL_MS);
    this.maintenanceTimer.unref?.();

    this.emailTimer = setInterval(() => {
      void this.runEmailWorkerOnce().catch((err) => {
        logger.error('Email worker job error', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, EMAIL_WORKER_INTERVAL_MS);
    this.emailTimer.unref?.();

    this.retentionTimer = setInterval(() => {
      try {
        this.runRetentionOnce();
      } catch (err) {
        logger.error('Telemetry retention job error', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }, RETENTION_JOB_INTERVAL_MS);
    this.retentionTimer.unref?.();

    // Run retention cleanup once at startup so expired demo data is pruned cleanly
    try {
      this.runRetentionOnce();
    } catch (err) {
      logger.error('Initial telemetry retention check failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  stop(): void {
    if (this.offlineTimer) {
      clearInterval(this.offlineTimer);
      this.offlineTimer = null;
    }
    if (this.rolloutTimer) {
      clearInterval(this.rolloutTimer);
      this.rolloutTimer = null;
    }
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.escalationTimer) {
      clearInterval(this.escalationTimer);
      this.escalationTimer = null;
    }
    if (this.maintenanceTimer) {
      clearInterval(this.maintenanceTimer);
      this.maintenanceTimer = null;
    }
    if (this.emailTimer) {
      clearInterval(this.emailTimer);
      this.emailTimer = null;
    }
    if (this.retentionTimer) {
      clearInterval(this.retentionTimer);
      this.retentionTimer = null;
    }
    this.started = false;

    // Flush any remaining telemetry samples before process exit (Section 3.2)
    try {
      const stats = this.runTelemetryFlushOnce();
      if (stats.samplesFlushed > 0 || stats.snapshotsUpdated > 0) {
        logger.info('Flushed live telemetry buffer on shutdown', stats);
      }
    } catch (err) {
      logger.error('Error flushing telemetry on shutdown', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Executes one offline-detection sweep + OFFLINE alert rule evaluation.
   * Exposed publicly for deterministic unit/integration tests.
   */
  runOfflineCheckOnce(nowMs = Date.now()): { markedOffline: string[] } {
    const markedOffline: string[] = [];
    const nowIso = new Date(nowMs).toISOString();
    const devices = this.repos.devices.listAllSystem();

    // Cache tenant thresholds per sweep
    const thresholdByTenantMs = new Map<string, number>();
    const getThresholdMs = (tenantId: string): number => {
      let cached = thresholdByTenantMs.get(tenantId);
      if (cached !== undefined) return cached;
      const tenant = this.repos.tenants.findByIdSystem(tenantId);
      const heartbeatSec = tenant?.settings.heartbeatIntervalSec ?? 30;
      const missedIntervals = tenant?.settings.offlineAfterMissedIntervals ?? 3;
      cached = Math.max(10, heartbeatSec * missedIntervals) * 1000;
      thresholdByTenantMs.set(tenantId, cached);
      return cached;
    };

    const alertHook = this.liveState.getAlertEvaluationHook();

    for (const d of devices) {
      const merged = this.liveState.mergeIntoDevice(d);
      if (merged.state !== 'ACTIVE' && merged.state !== 'UNDER_MAINTENANCE') {
        continue;
      }
      if (merged.connectivity !== 'ONLINE') {
        continue;
      }
      if (!merged.lastSeenAt) {
        continue;
      }

      const lastSeenMs = Date.parse(merged.lastSeenAt);
      if (!Number.isFinite(lastSeenMs)) continue;

      const thresholdMs = getThresholdMs(merged.tenantId);
      if (nowMs - lastSeenMs > thresholdMs) {
        this.liveState.markOffline(merged.id);
        this.repos.devices.updateConnectivitySystem(merged.id, 'OFFLINE', merged.lastSeenAt);
        this.repos.devices.insertConnectivityEvent({
          id: generateId('cev'),
          tenantId: merged.tenantId,
          deviceId: merged.id,
          state: 'OFFLINE',
          at: nowIso,
        });
        markedOffline.push(merged.id);

        if (alertHook) {
          Promise.resolve(
            alertHook.onDeviceOffline({
              tenantId: merged.tenantId,
              deviceId: merged.id,
              modelId: merged.modelId,
              siteId: merged.siteId,
              state: merged.state,
              lastSeenAt: merged.lastSeenAt,
              detectedAt: nowIso,
            }),
          ).catch((err) => {
            logger.error('AlertEvaluationHook.onDeviceOffline failed', {
              deviceId: merged.id,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }
      }
    }

    // Evaluate OFFLINE alert rules for devices whose rule durationSec exceeds the tenant offline threshold
    if (this.alertService) {
      this.alertService.evaluateOfflineRules(nowMs);
    }

    return { markedOffline };
  }

  runEscalationCheckOnce(nowMs = Date.now()) {
    if (!this.alertService) {
      return { escalatedToLevel1: [], escalatedToLevel2: [] };
    }
    return this.alertService.runEscalationCheckOnce(nowMs);
  }

  runMaintenancePlannerOnce(nowMs = Date.now()) {
    if (!this.maintenancePlanService) {
      return { plansExecuted: 0, workOrdersCreated: 0, createdWorkOrderIds: [] as string[] };
    }
    return this.maintenancePlanService.runDuePlansOnce(nowMs);
  }

  runRolloutSchedulerOnce(nowMs = Date.now()) {
    if (!this.rolloutService) {
      return { startedRolloutIds: [] as string[] };
    }
    return this.rolloutService.runSchedulerOnce(nowMs);
  }

  async runEmailWorkerOnce(nowMs = Date.now()) {
    if (!this.emailService) {
      return { processed: 0, sent: 0, retried: 0, failed: 0 };
    }
    return this.emailService.processOutboxOnce(nowMs);
  }

  runTelemetryFlushOnce() {
    return this.liveState.flushToDatabase();
  }

  runRetentionOnce(nowMs = Date.now()): { deletedBuckets: number } {
    const retentionMs = Math.max(1, config.telemetryRetentionDays) * 24 * 60 * 60_000;
    const cutoffIso = new Date(nowMs - retentionMs).toISOString();
    const deletedBuckets = this.repos.telemetry.deleteBucketsOlderThan(cutoffIso);
    return { deletedBuckets };
  }
}

