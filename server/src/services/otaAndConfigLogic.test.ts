import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { DevicePublic } from '../../../shared/types.ts';
import {
  areAllRolloutJobsTerminal,
  computeRolloutCounts,
  computeSha256Hex,
  evaluateRolloutTargets,
  isValidDeviceJobStatusTransition,
  isValidSemver,
  resolveSafeFirmwarePath,
  validateFirmwareStatusTransition,
  verifySha256Checksum,
} from './otaAndConfigLogic.ts';

function makeDevice(overrides: Partial<DevicePublic> = {}): DevicePublic {
  return {
    id: 'dev_1',
    tenantId: 'ten_ktl',
    siteId: 'site_1',
    siteName: 'Dyeing Plant',
    modelId: 'mdl_th200',
    modelName: 'TH-200 Temperature and Humidity Sensor',
    name: 'KTL-TH-001',
    serialNumber: 'SN-001',
    hardwareId: '00:11:22:33:44:55',
    tags: ['line-1'],
    state: 'ACTIVE',
    connectivity: 'ONLINE',
    lastSeenAt: new Date().toISOString(),
    firmwareVersion: '1.0.0',
    apiKeyLast4: '1234',
    config: { profileId: null, version: null, status: 'NONE', error: null },
    latestMetrics: {},
    latestHealth: {},
    invalidPayloadCount: 0,
    decommissionedAt: null,
    decommissionReason: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('otaAndConfigLogic', () => {
  it('computes and verifies SHA-256 checksums in constant time', () => {
    const buf = Buffer.from('OmniSphere firmware payload v1.1.0', 'utf8');
    const digest = computeSha256Hex(buf);
    assert.equal(digest.length, 64);
    assert.equal(verifySha256Checksum(digest, digest.toUpperCase()), true);
    assert.equal(verifySha256Checksum(digest, '0'.repeat(64)), false);
    assert.equal(verifySha256Checksum(digest, 'not-a-hash'), false);
  });

  it('validates semver strings', () => {
    assert.equal(isValidSemver('1.0.0'), true);
    assert.equal(isValidSemver('2.14.3-rc.1'), true);
    assert.equal(isValidSemver('v1.0.0'), false);
    assert.equal(isValidSemver('1.2'), false);
  });

  it('enforces safe firmware storage path confinement', () => {
    const baseDir = '/tmp/omnisphere-fw';
    const ok = resolveSafeFirmwarePath(baseDir, 'fwp_abc123.bin');
    assert.equal(ok, path.resolve(baseDir, 'fwp_abc123.bin'));
    assert.throws(() => resolveSafeFirmwarePath(baseDir, '../etc/passwd'));
    assert.throws(() => resolveSafeFirmwarePath(baseDir, 'sub/fwp_abc.bin'));
    assert.throws(() => resolveSafeFirmwarePath(baseDir, 'fwp_abc.exe'));
  });

  it('validates firmware lifecycle transitions', () => {
    assert.equal(validateFirmwareStatusTransition('DRAFT', 'RELEASED').ok, true);
    assert.equal(validateFirmwareStatusTransition('DRAFT', 'WITHDRAWN').ok, true);
    assert.equal(validateFirmwareStatusTransition('RELEASED', 'WITHDRAWN').ok, true);
    assert.equal(validateFirmwareStatusTransition('RELEASED', 'DRAFT').ok, false);
    assert.equal(validateFirmwareStatusTransition('WITHDRAWN', 'RELEASED').ok, false);
  });

  it('evaluates rollout preview exclusions with exact reasons', () => {
    const candidates: DevicePublic[] = [
      makeDevice({ id: 'dev_ok', name: 'OK-1', firmwareVersion: '1.0.0' }),
      makeDevice({ id: 'dev_wrong_model', name: 'VM-1', modelId: 'mdl_vm310', modelName: 'VM-310' }),
      makeDevice({ id: 'dev_suspended', name: 'SUSP-1', state: 'SUSPENDED' }),
      makeDevice({ id: 'dev_maint', name: 'MNT-1', state: 'UNDER_MAINTENANCE' }),
      makeDevice({ id: 'dev_active_job', name: 'BUSY-1' }),
      makeDevice({ id: 'dev_same_ver', name: 'SAME-1', firmwareVersion: '1.1.0' }),
    ];

    const res = evaluateRolloutTargets(
      candidates,
      { modelId: 'mdl_th200', version: '1.1.0' },
      new Set(['dev_active_job']),
    );

    assert.equal(res.included.length, 1);
    assert.equal(res.included[0].deviceId, 'dev_ok');
    assert.equal(res.excluded.length, 5);

    const byId = new Map(res.excluded.map((e) => [e.deviceId, e.reason]));
    assert.match(byId.get('dev_wrong_model') ?? '', /Wrong model/i);
    assert.match(byId.get('dev_suspended') ?? '', /not ACTIVE/i);
    assert.match(byId.get('dev_maint') ?? '', /not ACTIVE/i);
    assert.match(byId.get('dev_active_job') ?? '', /active rollout job/i);
    assert.match(byId.get('dev_same_ver') ?? '', /Already running version 1\.1\.0/i);
  });

  it('computes rollout counts, terminal completion, and valid job status transitions', () => {
    assert.deepEqual(computeRolloutCounts(['VERIFIED', 'FAILED', 'CANCELLED', 'QUEUED']), {
      total: 4,
      verified: 1,
      failed: 1,
      cancelled: 1,
    });
    assert.equal(areAllRolloutJobsTerminal(['VERIFIED', 'FAILED', 'CANCELLED']), true);
    assert.equal(areAllRolloutJobsTerminal(['VERIFIED', 'INSTALLING']), false);
    assert.equal(areAllRolloutJobsTerminal([]), false);

    assert.equal(isValidDeviceJobStatusTransition('QUEUED', 'DOWNLOADING'), true);
    assert.equal(isValidDeviceJobStatusTransition('DOWNLOADING', 'INSTALLING'), true);
    assert.equal(isValidDeviceJobStatusTransition('INSTALLING', 'VERIFIED'), true);
    assert.equal(isValidDeviceJobStatusTransition('INSTALLING', 'FAILED'), true);
    assert.equal(isValidDeviceJobStatusTransition('VERIFIED', 'FAILED'), false);
    assert.equal(isValidDeviceJobStatusTransition('CANCELLED', 'DOWNLOADING'), false);
  });
});
