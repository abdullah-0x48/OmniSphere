import crypto from 'node:crypto';
import path from 'node:path';
import type {
  DevicePublic,
  FirmwareStatus,
  RolloutCounts,
  RolloutJobStatus,
  RolloutPreviewExcluded,
  RolloutPreviewIncluded,
} from '../../../shared/types.ts';

export const MAX_FIRMWARE_BYTES = 5 * 1024 * 1024; // 5 MB (Section 4)

const SEMVER_REGEX =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/i;

export function isValidSemver(version: string): boolean {
  return SEMVER_REGEX.test(version.trim());
}

export function isValidSha256Hex(value: string): boolean {
  return SHA256_HEX_REGEX.test(value.trim());
}

export function computeSha256Hex(data: Buffer | Uint8Array): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Constant-time SHA-256 hex digest verification (NFR-06).
 */
export function verifySha256Checksum(expectedHex: string, actualHex: string): boolean {
  const a = expectedHex.trim().toLowerCase();
  const b = actualHex.trim().toLowerCase();
  if (!SHA256_HEX_REGEX.test(a) || !SHA256_HEX_REGEX.test(b)) {
    return false;
  }
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Strictly confines firmware binary paths inside the configured firmware directory
 * to prevent path traversal (Section 4 + securecoder).
 */
export function resolveSafeFirmwarePath(baseDir: string, fileName: string): string {
  const safeBase = path.resolve(baseDir);
  const cleanName = path.basename(fileName);
  if (!cleanName || cleanName !== fileName || !/^[a-zA-Z0-9_-]+\.bin$/.test(cleanName)) {
    throw new Error('Invalid firmware file reference');
  }
  const resolved = path.resolve(safeBase, cleanName);
  if (!resolved.startsWith(safeBase + path.sep)) {
    throw new Error('Firmware path escapes storage directory');
  }
  return resolved;
}

/**
 * Validates FirmwarePackage lifecycle transitions (Section 5.3 & 8.7):
 * - DRAFT -> RELEASED | WITHDRAWN
 * - RELEASED -> WITHDRAWN
 * - WITHDRAWN is terminal.
 */
export function validateFirmwareStatusTransition(
  from: FirmwareStatus,
  to: FirmwareStatus,
): { ok: boolean; error?: string } {
  if (from === to) {
    return { ok: false, error: `Firmware package is already ${from}` };
  }
  if (from === 'DRAFT' && (to === 'RELEASED' || to === 'WITHDRAWN')) {
    return { ok: true };
  }
  if (from === 'RELEASED' && to === 'WITHDRAWN') {
    return { ok: true };
  }
  return {
    ok: false,
    error: `Cannot transition firmware status from ${from} to ${to}`,
  };
}

/**
 * Evaluates candidate devices for an OTA rollout preview (Section 8.7 #3).
 * Excludes devices with explicit reasons:
 * 1. Wrong model
 * 2. Not in ACTIVE state
 * 3. Already has an active rollout job (QUEUED, DOWNLOADING, INSTALLING)
 * 4. Already running the target firmware version
 */
export function evaluateRolloutTargets(
  candidateDevices: DevicePublic[],
  firmware: { modelId: string; version: string },
  devicesWithActiveJob: ReadonlySet<string>,
): { included: RolloutPreviewIncluded[]; excluded: RolloutPreviewExcluded[] } {
  const included: RolloutPreviewIncluded[] = [];
  const excluded: RolloutPreviewExcluded[] = [];

  for (const device of candidateDevices) {
    const baseExcluded = {
      deviceId: device.id,
      deviceName: device.name,
      serialNumber: device.serialNumber,
      siteName: device.siteName ?? device.siteId,
      state: device.state,
      currentVersion: device.firmwareVersion,
    };

    if (device.modelId !== firmware.modelId) {
      excluded.push({
        ...baseExcluded,
        reason: `Wrong model (${device.modelName ?? device.modelId})`,
      });
      continue;
    }

    if (device.state !== 'ACTIVE') {
      excluded.push({
        ...baseExcluded,
        reason: `Device not ACTIVE (${device.state.replaceAll('_', ' ')})`,
      });
      continue;
    }

    if (devicesWithActiveJob.has(device.id)) {
      excluded.push({
        ...baseExcluded,
        reason: 'Already has an active rollout job',
      });
      continue;
    }

    if (device.firmwareVersion && device.firmwareVersion.trim() === firmware.version.trim()) {
      excluded.push({
        ...baseExcluded,
        reason: `Already running version ${firmware.version}`,
      });
      continue;
    }

    included.push({
      deviceId: device.id,
      deviceName: device.name,
      serialNumber: device.serialNumber,
      siteName: device.siteName ?? device.siteId,
      currentVersion: device.firmwareVersion,
    });
  }

  return { included, excluded };
}

export const ACTIVE_ROLLOUT_JOB_STATUSES: readonly RolloutJobStatus[] = [
  'QUEUED',
  'DOWNLOADING',
  'INSTALLING',
] as const;

export const TERMINAL_ROLLOUT_JOB_STATUSES: readonly RolloutJobStatus[] = [
  'VERIFIED',
  'FAILED',
  'CANCELLED',
] as const;

export function isTerminalRolloutJobStatus(status: RolloutJobStatus): boolean {
  return status === 'VERIFIED' || status === 'FAILED' || status === 'CANCELLED';
}

export function isValidDeviceJobStatusTransition(
  from: RolloutJobStatus,
  to: 'DOWNLOADING' | 'INSTALLING' | 'VERIFIED' | 'FAILED',
): boolean {
  if (from === to) return true;
  switch (from) {
    case 'QUEUED':
      return to === 'DOWNLOADING' || to === 'INSTALLING' || to === 'FAILED';
    case 'DOWNLOADING':
      return to === 'INSTALLING' || to === 'VERIFIED' || to === 'FAILED';
    case 'INSTALLING':
      return to === 'VERIFIED' || to === 'FAILED';
    case 'VERIFIED':
    case 'FAILED':
    case 'CANCELLED':
      return false;
  }
}

export function computeRolloutCounts(statuses: readonly RolloutJobStatus[]): RolloutCounts {
  let verified = 0;
  let failed = 0;
  let cancelled = 0;
  for (const s of statuses) {
    if (s === 'VERIFIED') verified += 1;
    else if (s === 'FAILED') failed += 1;
    else if (s === 'CANCELLED') cancelled += 1;
  }
  return {
    total: statuses.length,
    verified,
    failed,
    cancelled,
  };
}

export function areAllRolloutJobsTerminal(statuses: readonly RolloutJobStatus[]): boolean {
  return statuses.length > 0 && statuses.every((s) => isTerminalRolloutJobStatus(s));
}
