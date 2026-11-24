import type {
  DevicePublic,
  RolloutDetail,
  RolloutJobPublic,
  RolloutPreviewResponse,
  RolloutPublic,
  RolloutTargetType,
} from '../../../shared/types.ts';
import type { Repositories } from '../repositories/index.ts';
import {
  toFirmwarePublic,
  type DeviceRecord,
  type RolloutListFilter,
  type TenantContext,
} from '../repositories/types.ts';
import { Errors } from '../utils/errors.ts';
import { generateId } from '../utils/ids.ts';
import type { AuditService } from './auditService.ts';
import type { LiveStateStore } from './liveStateStore.ts';
import type { NotificationService } from './notificationService.ts';
import {
  areAllRolloutJobsTerminal,
  computeRolloutCounts,
  evaluateRolloutTargets,
  isValidDeviceJobStatusTransition,
} from './otaAndConfigLogic.ts';

export class RolloutService {
  constructor(
    private readonly repos: Repositories,
    private readonly liveState: LiveStateStore,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
  ) {}

  private resolveWriteTenantId(ctx: TenantContext): string {
    if (ctx.activeTenantId) return ctx.activeTenantId;
    if (ctx.tenantIds.length === 1) return ctx.tenantIds[0];
    throw Errors.validation('Select a working organization before creating or managing rollouts');
  }

  private enrichTargetLabel(ctx: TenantContext, rollout: RolloutPublic): RolloutPublic {
    if (rollout.targetType === 'SITE') {
      const site = this.repos.sites.findById(ctx, rollout.targetValue);
      return { ...rollout, targetLabel: site ? `Site: ${site.name}` : `Site: ${rollout.targetValue}` };
    }
    if (rollout.targetType === 'TAG') {
      return { ...rollout, targetLabel: `Tag: #${rollout.targetValue}` };
    }
    const ids = rollout.targetValue
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length === 1) {
      const dev = this.repos.devices.findByIdSystem(ids[0]);
      return { ...rollout, targetLabel: dev ? `Device: ${dev.name}` : `Device: ${ids[0]}` };
    }
    return { ...rollout, targetLabel: `${ids.length} selected devices` };
  }

  private resolveTargetCandidates(
    ctx: TenantContext,
    tenantId: string,
    targetType: RolloutTargetType,
    targetValue: string,
  ): DevicePublic[] {
    const tenantScope: TenantContext = {
      ...ctx,
      allTenants: false,
      tenantIds: [tenantId],
      activeTenantId: tenantId,
    };

    const allDevices = this.repos.devices
      .listAllInScope(tenantScope, true)
      .map((d) => this.liveState.mergeIntoDevice(d));

    if (targetType === 'DEVICE') {
      const ids = targetValue
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (ids.length === 0) {
        throw Errors.validation('Select at least one target device', { field: 'targetValue' });
      }
      const idSet = new Set(ids);
      const matched = allDevices.filter((d) => idSet.has(d.id));
      if (matched.length === 0) {
        throw Errors.notFound('Target device not found in this organization');
      }
      return matched;
    }

    if (targetType === 'SITE') {
      const site = this.repos.sites.findById(tenantScope, targetValue.trim());
      if (!site || site.tenantId !== tenantId) {
        throw Errors.validation('Selected site does not exist in this organization', {
          field: 'targetValue',
        });
      }
      return allDevices.filter((d) => d.siteId === site.id);
    }

    const cleanTag = targetValue.trim().toLowerCase();
    if (!cleanTag) {
      throw Errors.validation('Target tag is required', { field: 'targetValue' });
    }
    return allDevices.filter((d) => d.tags.some((t) => t.toLowerCase() === cleanTag));
  }

  list(
    ctx: TenantContext,
    filter: RolloutListFilter,
  ): { items: RolloutPublic[]; total: number } {
    const res = this.repos.rollouts.list(ctx, filter, true);
    return {
      items: res.items.map((r) => this.enrichTargetLabel(ctx, r)),
      total: res.total,
    };
  }

  getDetail(ctx: TenantContext, id: string): RolloutDetail {
    const rollout = this.repos.rollouts.findById(ctx, id);
    if (!rollout) {
      throw Errors.notFound('Rollout not found');
    }
    const fw = this.repos.firmware.findById(rollout.firmwareId);
    const jobs = this.repos.rollouts.listJobsByRollout(ctx, id);
    return {
      ...this.enrichTargetLabel(ctx, rollout),
      firmware: fw ? toFirmwarePublic(fw) : null,
      jobs,
    };
  }

  /**
   * Computes exact included & excluded device sets with exclusion reasons (Section 8.7 #3).
   */
  preview(
    ctx: TenantContext,
    input: { firmwareId: string; targetType: RolloutTargetType; targetValue: string },
  ): RolloutPreviewResponse {
    const tenantId = this.resolveWriteTenantId(ctx);
    const fw = this.repos.firmware.findById(input.firmwareId.trim());
    if (!fw) {
      throw Errors.notFound('Firmware package not found');
    }
    if (fw.status !== 'RELEASED') {
      throw Errors.validation(
        `Only RELEASED firmware packages can be rolled out (current status: ${fw.status})`,
        { field: 'firmwareId' },
      );
    }

    const candidates = this.resolveTargetCandidates(
      ctx,
      tenantId,
      input.targetType,
      input.targetValue,
    );
    const activeJobDeviceIds = this.repos.rollouts.findDevicesWithActiveJobsInTenantSystem(tenantId);
    const { included, excluded } = evaluateRolloutTargets(
      candidates,
      { modelId: fw.modelId, version: fw.version },
      activeJobDeviceIds,
    );

    return {
      firmwareId: fw.id,
      firmwareVersion: fw.version,
      modelId: fw.modelId,
      modelName: fw.modelName ?? fw.modelId,
      included,
      excluded,
    };
  }

  /**
   * Creates an OTA rollout and 1 QUEUED job per included device (Section 8.7 #4).
   * - If tenant.settings.requireRolloutApproval is true -> PENDING_APPROVAL + notifies CM
   * - Else -> PENDING (picked up by Rollout Scheduler when scheduledAt <= now or null)
   */
  create(
    ctx: TenantContext,
    input: {
      firmwareId: string;
      targetType: RolloutTargetType;
      targetValue: string;
      scheduledAt?: string | null;
    },
    ip: string,
  ): RolloutDetail {
    const tenantId = this.resolveWriteTenantId(ctx);
    const tenant = this.repos.tenants.findByIdSystem(tenantId);
    if (!tenant) {
      throw Errors.notFound('Organization not found');
    }

    let scheduledAtIso: string | null = null;
    if (input.scheduledAt && input.scheduledAt.trim()) {
      const parsed = Date.parse(input.scheduledAt);
      if (!Number.isFinite(parsed)) {
        throw Errors.validation('scheduledAt must be a valid ISO timestamp', {
          field: 'scheduledAt',
        });
      }
      scheduledAtIso = new Date(parsed).toISOString();
    }

    const previewRes = this.preview(ctx, {
      firmwareId: input.firmwareId,
      targetType: input.targetType,
      targetValue: input.targetValue,
    });

    if (previewRes.included.length === 0) {
      throw Errors.validation(
        'No eligible devices match this rollout target. Check the preview exclusions before creating.',
      );
    }

    const fw = this.repos.firmware.findById(input.firmwareId.trim())!;
    const needsApproval = Boolean(tenant.settings.requireRolloutApproval);
    const initialStatus = needsApproval ? 'PENDING_APPROVAL' : 'PENDING';
    const rolloutId = generateId('rol');
    const nowIso = new Date().toISOString();

    const jobsInput = previewRes.included.map((inc) => ({
      id: generateId('rjb'),
      tenantId,
      rolloutId,
      deviceId: inc.deviceId,
      fromVersion: inc.currentVersion,
      toVersion: fw.version,
      status: 'QUEUED' as const,
      createdAt: nowIso,
    }));

    const { rollout, jobs } = this.repos.rollouts.createWithJobs(
      ctx,
      {
        id: rolloutId,
        tenantId,
        firmwareId: fw.id,
        modelId: fw.modelId,
        targetType: input.targetType,
        targetValue: input.targetValue.trim(),
        scheduledAt: scheduledAtIso,
        status: initialStatus,
        createdBy: ctx.userId,
        counts: {
          total: jobsInput.length,
          verified: 0,
          failed: 0,
          cancelled: 0,
        },
        createdAt: nowIso,
      },
      jobsInput,
    );

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId,
      action: 'ROLLOUT_CREATED',
      targetType: 'ROLLOUT',
      targetId: rollout.id,
      outcome: 'SUCCESS',
      ip,
      details: {
        firmwareId: fw.id,
        firmwareVersion: fw.version,
        modelId: fw.modelId,
        targetType: rollout.targetType,
        targetValue: rollout.targetValue,
        status: rollout.status,
        includedCount: jobs.length,
        excludedCount: previewRes.excluded.length,
      },
    });

    if (needsApproval) {
      const managers = this.repos.users
        .listAllActiveSystem()
        .filter((u) => u.role === 'CLIENT_MANAGER' && u.tenantId === tenantId);

      this.notifications.notifyUsersSystem(managers, {
        tenantId,
        type: 'ROLLOUT_APPROVAL_REQUESTED',
        title: `Firmware rollout approval needed (${fw.version})`,
        body: `A firmware rollout to ${fw.version} for ${jobs.length} device(s) in ${tenant.name} is awaiting your approval.`,
        link: '/approvals?tab=rollouts',
        emailSubject: `[OmniSphere] Firmware rollout approval requested (v${fw.version})`,
        emailSummary: `A firmware rollout targeting ${jobs.length} device(s) in ${tenant.name} requires Client Manager approval.`,
        emailFacts: [
          { label: 'Organization', value: tenant.name },
          { label: 'Firmware Version', value: fw.version },
          { label: 'Target Devices', value: String(jobs.length) },
        ],
        emailCtaLabel: 'Review in Approvals Center',
        relatedType: 'ROLLOUT',
        relatedId: rollout.id,
      });
    }

    if (!needsApproval && (!scheduledAtIso || Date.parse(scheduledAtIso) <= Date.now())) {
      this.runSchedulerOnce();
      return this.getDetail(ctx, rollout.id);
    }

    return {
      ...this.enrichTargetLabel(ctx, rollout),
      firmware: toFirmwarePublic(fw),
      jobs,
    };
  }

  /**
   * Client Manager approval or rejection of a PENDING_APPROVAL rollout (Section 8.7 #5).
   */
  decide(
    ctx: TenantContext,
    id: string,
    input: { decision: 'APPROVED' | 'REJECTED'; reason?: string },
    ip: string,
  ): RolloutDetail {
    const existing = this.repos.rollouts.findById(ctx, id);
    if (!existing) {
      throw Errors.notFound('Rollout not found');
    }
    if (existing.status !== 'PENDING_APPROVAL') {
      throw Errors.invalidTransition(
        `Rollout cannot be decided in status ${existing.status}; must be PENDING_APPROVAL`,
        { currentStatus: existing.status },
      );
    }

    const reason = input.reason?.trim() ?? '';
    if (input.decision === 'REJECTED' && reason.length < 3) {
      throw Errors.validation('A rejection reason is required (minimum 3 characters)', {
        field: 'reason',
      });
    }

    let nextStatus: RolloutPublic['status'] = 'PENDING';
    let nextCounts = existing.counts;

    if (input.decision === 'REJECTED') {
      nextStatus = 'REJECTED';
      this.repos.rollouts.cancelQueuedJobsForRolloutSystem(existing.id);
      const jobsAfter = this.repos.rollouts.listJobsByRolloutSystem(existing.id);
      nextCounts = computeRolloutCounts(jobsAfter.map((j) => j.status));
    }

    const updated = this.repos.rollouts.updateStatusAndDecision(existing.id, {
      status: nextStatus,
      decidedBy: ctx.userId,
      decisionReason: reason || null,
      counts: nextCounts,
    });
    if (!updated) {
      throw Errors.notFound('Rollout not found');
    }

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: existing.tenantId,
      action: input.decision === 'APPROVED' ? 'ROLLOUT_APPROVED' : 'ROLLOUT_REJECTED',
      targetType: 'ROLLOUT',
      targetId: existing.id,
      outcome: 'SUCCESS',
      ip,
      details: {
        decision: input.decision,
        reason: reason || null,
        firmwareVersion: existing.firmwareVersion,
      },
    });

    const creator = this.repos.users.findByIdForAuth(existing.createdBy);
    if (creator && creator.status === 'ACTIVE') {
      const approved = input.decision === 'APPROVED';
      const fwVer = existing.firmwareVersion ?? 'firmware';
      this.notifications.notifyUsersSystem([creator], {
        tenantId: existing.tenantId,
        type: approved ? 'ROLLOUT_APPROVED' : 'ROLLOUT_REJECTED',
        title: approved ? `Rollout to ${fwVer} approved` : `Rollout to ${fwVer} rejected`,
        body: approved
          ? `Your firmware rollout (${existing.counts.total} device(s)) was approved and queued for execution.`
          : `Your firmware rollout was rejected. Reason: ${reason}`,
        link: `/rollouts/${existing.id}`,
        emailSubject: `[OmniSphere] Rollout to v${fwVer} ${approved ? 'approved' : 'rejected'}`,
        emailSummary: approved
          ? `Your firmware rollout to v${fwVer} has been approved by a Client Manager.`
          : `Your firmware rollout to v${fwVer} was rejected. Reason: ${reason}`,
        emailFacts: [
          { label: 'Firmware Version', value: fwVer },
          { label: 'Decision', value: input.decision },
          { label: 'Target Devices', value: String(existing.counts.total) },
          ...(reason ? [{ label: 'Note / Reason', value: reason }] : []),
        ],
        emailCtaLabel: 'Open Rollout',
        relatedType: 'ROLLOUT',
        relatedId: existing.id,
      });
    }

    if (
      input.decision === 'APPROVED' &&
      (!existing.scheduledAt || Date.parse(existing.scheduledAt) <= Date.now())
    ) {
      this.runSchedulerOnce();
    }

    return this.getDetail(ctx, existing.id);
  }

  /**
   * Cancels a rollout: transitions remaining QUEUED jobs to CANCELLED while letting
   * jobs already DOWNLOADING or INSTALLING finish safely (Section 5.3 & 8.7 #6).
   */
  cancel(ctx: TenantContext, id: string, ip: string): RolloutDetail {
    const existing = this.repos.rollouts.findById(ctx, id);
    if (!existing) {
      throw Errors.notFound('Rollout not found');
    }
    if (
      existing.status !== 'PENDING_APPROVAL' &&
      existing.status !== 'PENDING' &&
      existing.status !== 'RUNNING'
    ) {
      throw Errors.invalidTransition(
        `Cannot cancel rollout in terminal status ${existing.status}`,
        { currentStatus: existing.status },
      );
    }

    const cancelledQueued = this.repos.rollouts.cancelQueuedJobsForRolloutSystem(existing.id);
    const jobsAfter = this.repos.rollouts.listJobsByRolloutSystem(existing.id);
    const counts = computeRolloutCounts(jobsAfter.map((j) => j.status));

    this.repos.rollouts.updateStatusAndDecision(existing.id, {
      status: 'CANCELLED',
      counts,
    });

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: existing.tenantId,
      action: 'ROLLOUT_CANCELLED',
      targetType: 'ROLLOUT',
      targetId: existing.id,
      outcome: 'SUCCESS',
      ip,
      details: {
        previousStatus: existing.status,
        cancelledQueuedJobs: cancelledQueued,
        counts,
      },
    });

    return this.getDetail(ctx, existing.id);
  }

  /**
   * Background Rollout Scheduler (Section 8.9 — every 10s).
   * Idempotently promotes due PENDING rollouts to RUNNING.
   */
  runSchedulerOnce(nowMs = Date.now()): { startedRolloutIds: string[] } {
    const nowIso = new Date(nowMs).toISOString();
    const due = this.repos.rollouts.listDuePendingRolloutsSystem(nowIso);
    const startedRolloutIds: string[] = [];

    for (const r of due) {
      const updated = this.repos.rollouts.updateStatusAndDecision(r.id, { status: 'RUNNING' });
      if (!updated) continue;
      startedRolloutIds.push(r.id);

      this.audit.record({
        actorId: 'SYSTEM',
        actorRole: 'SYSTEM',
        tenantId: r.tenantId,
        action: 'ROLLOUT_STARTED',
        targetType: 'ROLLOUT',
        targetId: r.id,
        outcome: 'SUCCESS',
        ip: '127.0.0.1',
        details: {
          firmwareId: r.firmwareId,
          firmwareVersion: r.firmwareVersion,
          scheduledAt: r.scheduledAt,
          totalJobs: r.counts.total,
        },
      });
    }

    return { startedRolloutIds };
  }

  /**
   * Returns a QUEUED OTA update descriptor for a polling device ONLY if the device is ACTIVE
   * and belongs to a RUNNING rollout (Section 6 & 8.7).
   */
  getPendingUpdateForDevicePoll(device: DeviceRecord): {
    jobId: string;
    firmwareId: string;
    version: string;
    downloadPath: string;
    sha256: string;
  } | null {
    const currentState = this.liveState.get(device.id)?.state ?? device.state;
    if (currentState !== 'ACTIVE') {
      // Skip delivery while SUSPENDED or UNDER_MAINTENANCE; keep job QUEUED
      return null;
    }

    const found = this.repos.rollouts.findQueuedJobForRunningRolloutSystem(device.id);
    if (!found) return null;

    return {
      jobId: found.job.id,
      firmwareId: found.firmware.id,
      version: found.firmware.version,
      downloadPath: `/device/v1/firmware/${found.firmware.id}/download`,
      sha256: found.firmware.checksumSha256,
    };
  }

  /**
   * Authorizes `GET /device/v1/firmware/:firmwareId/download` (Section 6):
   * Device must have an active rollout job for that firmware.
   */
  assertDeviceAuthorizedForFirmware(device: DeviceRecord, firmwareId: string): void {
    const active = this.repos.rollouts.findActiveJobForDeviceAndFirmwareSystem(
      device.id,
      firmwareId,
    );
    if (!active) {
      throw Errors.forbidden('Device does not have an active rollout job for this firmware package');
    }
  }

  /**
   * Handles `POST /device/v1/updates/:jobId/status` (Section 6 & 8.7 #7):
   * - Updates job status (DOWNLOADING, INSTALLING, VERIFIED, FAILED)
   * - On VERIFIED: updates device.firmwareVersion + LiveState
   * - On FAILED: creates a CRITICAL alert and notifies rollout owner
   * - Recomputes rollout counts; when all jobs are terminal, marks RUNNING rollout COMPLETED and notifies owner
   */
  reportDeviceJobStatus(
    device: DeviceRecord,
    jobId: string,
    input: {
      status: 'DOWNLOADING' | 'INSTALLING' | 'VERIFIED' | 'FAILED';
      newVersion?: string | null;
      errorCode?: string | null;
    },
    ip: string,
  ): { job: RolloutJobPublic; rolloutStatus: RolloutPublic['status'] } {
    const job = this.repos.rollouts.findJobByIdSystem(jobId);
    if (!job || job.deviceId !== device.id) {
      throw Errors.notFound('Rollout job not found for this device');
    }

    if (!isValidDeviceJobStatusTransition(job.status, input.status)) {
      throw Errors.invalidTransition(
        `Cannot transition rollout job from ${job.status} to ${input.status}`,
        { from: job.status, to: input.status },
      );
    }

    const normalizedError =
      input.status === 'FAILED' ? (input.errorCode?.trim() || 'OTA_UPDATE_FAILED') : null;

    const updatedJob = this.repos.rollouts.updateJobStatusSystem(
      job.id,
      input.status,
      normalizedError,
    )!;

    const rollout = this.repos.rollouts.findByIdSystem(job.rolloutId);
    if (!rollout) {
      throw Errors.notFound('Parent rollout not found');
    }

    if (input.status === 'VERIFIED') {
      const finalVersion = input.newVersion?.trim() || job.toVersion;
      this.repos.devices.updateFirmwareVersionSystem(device.id, finalVersion);
      this.liveState.updateFirmwareVersion(device.id, finalVersion);

      this.audit.record({
        actorId: device.id,
        actorRole: 'SYSTEM',
        tenantId: device.tenantId,
        action: 'OTA_JOB_VERIFIED',
        targetType: 'DEVICE',
        targetId: device.id,
        outcome: 'SUCCESS',
        ip,
        details: {
          rolloutId: rollout.id,
          jobId: job.id,
          fromVersion: job.fromVersion,
          toVersion: finalVersion,
        },
      });
    } else if (input.status === 'FAILED') {
      const errorCode = normalizedError ?? 'OTA_UPDATE_FAILED';
      const alertMessage = `OTA update failed: ${errorCode}`;

      // Create CRITICAL alert (Section 6 & 8.7 #7) without waiting for email
      const createdAlert = this.repos.alerts.createSystem({
        id: generateId('alr'),
        tenantId: device.tenantId,
        ruleId: null,
        deviceId: device.id,
        severity: 'CRITICAL',
        status: 'OPEN',
        message: alertMessage,
        snapshot: {
          rolloutId: rollout.id,
          jobId: job.id,
          fromVersion: job.fromVersion,
          toVersion: job.toVersion,
          errorCode,
        },
      });

      this.audit.record({
        actorId: device.id,
        actorRole: 'SYSTEM',
        tenantId: device.tenantId,
        action: 'OTA_JOB_FAILED',
        targetType: 'DEVICE',
        targetId: device.id,
        outcome: 'FAILURE',
        ip,
        details: {
          rolloutId: rollout.id,
          jobId: job.id,
          fromVersion: job.fromVersion,
          toVersion: job.toVersion,
          errorCode,
          alertId: createdAlert.id,
        },
      });

      this.audit.record({
        actorId: 'SYSTEM',
        actorRole: 'SYSTEM',
        tenantId: device.tenantId,
        action: 'ALERT_CREATED',
        targetType: 'ALERT',
        targetId: createdAlert.id,
        outcome: 'SUCCESS',
        ip,
        details: {
          deviceId: device.id,
          severity: 'CRITICAL',
          message: alertMessage,
          source: 'OTA_FAILURE',
          rolloutId: rollout.id,
        },
      });

      // Notify rollout creator and assigned SE/CA (in-app + non-blocking email outbox)
      const owner = this.repos.users.findByIdForAuth(rollout.createdBy);
      const notifiedIds = new Set<string>();
      if (owner && owner.status === 'ACTIVE') {
        notifiedIds.add(owner.id);
        this.notifications.notifyUsersSystem([owner], {
          tenantId: device.tenantId,
          type: 'OTA_JOB_FAILED',
          title: `OTA failed on ${device.name}: ${errorCode}`,
          body: `Device ${device.name} failed to update to ${job.toVersion} (${errorCode}). A Critical alert has been opened.`,
          link: `/rollouts/${rollout.id}`,
          emailSubject: `[CRITICAL] OTA update failed on ${device.name} (${errorCode})`,
          emailSummary: `Device ${device.name} reported ${errorCode} while updating to firmware ${job.toVersion}.`,
          emailFacts: [
            { label: 'Device', value: device.name },
            { label: 'Target Version', value: job.toVersion },
            { label: 'Error Code', value: errorCode },
            { label: 'Alert ID', value: createdAlert.id },
          ],
          emailCtaLabel: 'Inspect Rollout',
          relatedType: 'ALERT',
          relatedId: createdAlert.id,
        });
      }

      const extraRecipients = this.repos.users.listAllActiveSystem().filter((u) => {
        if (notifiedIds.has(u.id)) return false;
        const isTenantCA = u.role === 'CLIENT_ADMIN' && u.tenantId === device.tenantId;
        const isAssignedSE =
          u.role === 'SUPPORT_ENGINEER' && u.assignedTenantIds.includes(device.tenantId);
        return isTenantCA || isAssignedSE;
      });

      if (extraRecipients.length > 0) {
        this.notifications.notifyUsersSystem(extraRecipients, {
          tenantId: device.tenantId,
          type: 'ALERT_CREATED',
          title: `[CRITICAL] ${device.name} — ${alertMessage}`,
          body: `Firmware update to ${job.toVersion} failed with ${errorCode} on ${device.name}.`,
          link: `/alerts?alertId=${createdAlert.id}`,
          emailSubject: `[CRITICAL] ${device.name} — ${alertMessage}`,
          emailSummary: `Firmware update to ${job.toVersion} failed with ${errorCode} on ${device.name}.`,
          emailFacts: [
            { label: 'Device', value: device.name },
            { label: 'Severity', value: 'CRITICAL' },
            { label: 'Error Code', value: errorCode },
          ],
          emailCtaLabel: 'Open Alert',
          relatedType: 'ALERT',
          relatedId: createdAlert.id,
        });
      }
    }

    // Recompute rollout counts and detect completion
    const allJobs = this.repos.rollouts.listJobsByRolloutSystem(rollout.id);
    const statuses = allJobs.map((j) => j.status);
    const counts = computeRolloutCounts(statuses);
    const shouldComplete = rollout.status === 'RUNNING' && areAllRolloutJobsTerminal(statuses);
    const nextRolloutStatus = shouldComplete ? 'COMPLETED' : rollout.status;

    this.repos.rollouts.updateCountsSystem(rollout.id, counts, nextRolloutStatus);

    if (shouldComplete) {
      this.audit.record({
        actorId: 'SYSTEM',
        actorRole: 'SYSTEM',
        tenantId: rollout.tenantId,
        action: 'ROLLOUT_COMPLETED',
        targetType: 'ROLLOUT',
        targetId: rollout.id,
        outcome: 'SUCCESS',
        ip,
        details: {
          firmwareVersion: rollout.firmwareVersion,
          counts,
        },
      });

      const owner = this.repos.users.findByIdForAuth(rollout.createdBy);
      if (owner && owner.status === 'ACTIVE') {
        const fwVer = rollout.firmwareVersion ?? 'firmware';
        this.notifications.notifyUsersSystem([owner], {
          tenantId: rollout.tenantId,
          type: 'ROLLOUT_COMPLETED',
          title: `Rollout to ${fwVer} completed`,
          body: `Rollout finished: ${counts.verified} verified, ${counts.failed} failed, ${counts.cancelled} cancelled (of ${counts.total} total).`,
          link: `/rollouts/${rollout.id}`,
          emailSubject: `[OmniSphere] Firmware rollout to v${fwVer} completed`,
          emailSummary: `Your OTA firmware rollout to v${fwVer} has reached COMPLETED status.`,
          emailFacts: [
            { label: 'Firmware Version', value: fwVer },
            { label: 'Verified', value: String(counts.verified) },
            { label: 'Failed', value: String(counts.failed) },
            { label: 'Cancelled', value: String(counts.cancelled) },
            { label: 'Total Devices', value: String(counts.total) },
          ],
          emailCtaLabel: 'View Rollout Summary',
          relatedType: 'ROLLOUT',
          relatedId: rollout.id,
        });
      }
    }

    return { job: updatedJob, rolloutStatus: nextRolloutStatus };
  }

  /**
   * Called when a device is decommissioned (Section 5.1): cancels any QUEUED rollout jobs
   * for that device and recomputes parent rollout counts & completion.
   */
  cancelQueuedJobsForDevice(deviceId: string): number {
    const affectedRolloutIds = this.repos.rollouts.cancelQueuedJobsForDeviceSystem(deviceId);
    for (const rid of affectedRolloutIds) {
      const rollout = this.repos.rollouts.findByIdSystem(rid);
      if (!rollout) continue;
      const allJobs = this.repos.rollouts.listJobsByRolloutSystem(rid);
      const statuses = allJobs.map((j) => j.status);
      const counts = computeRolloutCounts(statuses);
      const shouldComplete = rollout.status === 'RUNNING' && areAllRolloutJobsTerminal(statuses);
      this.repos.rollouts.updateCountsSystem(rid, counts, shouldComplete ? 'COMPLETED' : rollout.status);
    }
    return affectedRolloutIds.length;
  }
}
