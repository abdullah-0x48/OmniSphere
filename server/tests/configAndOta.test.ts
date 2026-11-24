import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type AppRuntime } from '../src/app.ts';
import { config } from '../src/config.ts';
import { createDatabase } from '../src/repositories/db.ts';
import { createRepositories, type Repositories } from '../src/repositories/index.ts';
import { DEMO_PASSWORD } from '../src/seed/seedData.ts';
import { seedAllDemoData } from '../src/seed/seedMilestone2.ts';

function sha256Hex(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

describe('Milestone 6 — Config Profiles, Firmware Repository, OTA Rollouts, & Simulator Verification', () => {
  let db: Database.Database;
  let repos: Repositories;
  let app: Express;
  let runtime: AppRuntime;
  const createdFirmwareFileIds: string[] = [];

  let paToken: string;
  let seToken: string;
  let ktlCaToken: string;
  let ktlCmToken: string;
  let ktlCoToken: string;
  let mfpCaToken: string;
  let ftToken: string;

  async function signIn(email: string): Promise<{ token: string; userId: string }> {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return { token: res.body.token as string, userId: res.body.user.id as string };
  }

  async function registerActiveDevice(opts: {
    token: string;
    tenantHeader?: string;
    name: string;
    serialNumber: string;
    hardwareId: string;
    modelId: string;
    siteId: string;
    tags?: string[];
    firmwareVersion?: string;
    configProfileId?: string;
  }): Promise<{ deviceId: string; apiKey: string }> {
    let req = request(app).post('/api/v1/devices').set('Authorization', `Bearer ${opts.token}`);
    if (opts.tenantHeader) req = req.set('X-Tenant-Id', opts.tenantHeader);
    const regRes = await req.send({
      name: opts.name,
      serialNumber: opts.serialNumber,
      hardwareId: opts.hardwareId,
      modelId: opts.modelId,
      siteId: opts.siteId,
      tags: opts.tags ?? [],
      configProfileId: opts.configProfileId,
    });
    expect(regRes.status).toBe(201);
    const { deviceId, apiKey } = regRes.body.provisioning as { deviceId: string; apiKey: string };

    // Activate via authenticated handshake
    const hsRes = await request(app)
      .post('/device/v1/handshake')
      .set('X-Device-Id', deviceId)
      .set('X-API-Key', apiKey)
      .send({ firmwareVersion: opts.firmwareVersion ?? '1.0.0' });
    expect(hsRes.status).toBe(200);

    return { deviceId, apiKey };
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    db = createDatabase(':memory:');
    repos = createRepositories(db);
    await seedAllDemoData(repos);
    app = createApp(repos);
    runtime = app.locals.runtime as AppRuntime;

    paToken = (await signIn('admin@omnisphere.demo')).token;
    seToken = (await signIn('noc1@omnisphere.demo')).token;
    ktlCaToken = (await signIn('admin.ktl@omnisphere.demo')).token;
    ktlCmToken = (await signIn('manager.ktl@omnisphere.demo')).token;
    ktlCoToken = (await signIn('operator1.ktl@omnisphere.demo')).token;
    mfpCaToken = (await signIn('admin.mfp@omnisphere.demo')).token;
    ftToken = (await signIn('tech1@omnisphere.demo')).token;
  });

  afterAll(() => {
    runtime.simulator.stopAll();
    runtime.backgroundJobs.stop();
    db.close();
    const fwDir = path.resolve(config.firmwareStorageDir);
    for (const id of createdFirmwareFileIds) {
      const p = path.join(fwDir, `${id}.bin`);
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
      }
    }
  });

  describe('1. Configuration Profiles (CRUD, Versioning, RBAC, Tenant Isolation, Push & Ack)', () => {
    let profileId = '';
    let devId = '';
    let devKey = '';

    it('creates v1 profile, increments to v2 on edit, preserves immutable version history, and enforces RBAC & tenant scoping', async () => {
      // CO & CM cannot create (403)
      const coForbidden = await request(app)
        .post('/api/v1/config-profiles')
        .set('Authorization', `Bearer ${ktlCoToken}`)
        .send({ name: 'Nope', modelId: 'mdl_th200', payload: { reportingIntervalSec: 15 } });
      expect(coForbidden.status).toBe(403);

      const cmForbidden = await request(app)
        .post('/api/v1/config-profiles')
        .set('Authorization', `Bearer ${ktlCmToken}`)
        .send({ name: 'Nope', modelId: 'mdl_th200', payload: { reportingIntervalSec: 15 } });
      expect(cmForbidden.status).toBe(403);

      // CA creates v1
      const createRes = await request(app)
        .post('/api/v1/config-profiles')
        .set('Authorization', `Bearer ${ktlCaToken}`)
        .send({
          name: 'TH-200 Cold Chain Test',
          modelId: 'mdl_th200',
          payload: { reportingIntervalSec: 20, powerMode: 'balanced' },
        });
      expect(createRes.status).toBe(201);
      expect(createRes.body.version).toBe(1);
      profileId = createRes.body.id;

      // CO & CM can read own tenant's profile
      const coRead = await request(app)
        .get(`/api/v1/config-profiles/${profileId}`)
        .set('Authorization', `Bearer ${ktlCoToken}`);
      expect(coRead.status).toBe(200);

      // Another tenant's CA gets 404 (tenant isolation)
      const mfpCross = await request(app)
        .get(`/api/v1/config-profiles/${profileId}`)
        .set('Authorization', `Bearer ${mfpCaToken}`);
      expect(mfpCross.status).toBe(404);

      // Edit increments version to v2
      const editRes = await request(app)
        .patch(`/api/v1/config-profiles/${profileId}`)
        .set('Authorization', `Bearer ${ktlCaToken}`)
        .send({ payload: { reportingIntervalSec: 10, powerMode: 'high_frequency' } });
      expect(editRes.status).toBe(200);
      expect(editRes.body.version).toBe(2);

      // Version history has both v2 and v1
      const histRes = await request(app)
        .get(`/api/v1/config-profiles/${profileId}/versions`)
        .set('Authorization', `Bearer ${ktlCaToken}`);
      expect(histRes.status).toBe(200);
      expect(histRes.body.items).toHaveLength(2);
      expect(histRes.body.items[0].version).toBe(2);
      expect(histRes.body.items[0].payload.reportingIntervalSec).toBe(10);
      expect(histRes.body.items[1].version).toBe(1);
      expect(histRes.body.items[1].payload.reportingIntervalSec).toBe(20);
    });

    it('pushes config to device -> PENDING -> delivered via /device/v1/commands -> APPLIED via /config-ack (and supports FAILED)', async () => {
      const reg = await registerActiveDevice({
        token: ktlCaToken,
        name: 'KTL-CFG-TEST-01',
        serialNumber: 'SN-KTL-CFG-001',
        hardwareId: 'AA:BB:CC:00:01:01',
        modelId: 'mdl_th200',
        siteId: 'sit_ktl_dye',
        tags: ['cfg-test'],
      });
      devId = reg.deviceId;
      devKey = reg.apiKey;

      // Push v2 profile to device
      const pushRes = await request(app)
        .post(`/api/v1/config-profiles/${profileId}/push`)
        .set('Authorization', `Bearer ${ktlCaToken}`)
        .send({ targetType: 'DEVICE', targetValue: devId });
      expect(pushRes.status).toBe(200);
      expect(pushRes.body.queuedCount).toBe(1);
      expect(pushRes.body.version).toBe(2);

      // Device detail shows PENDING before poll
      const beforeDetail = await request(app)
        .get(`/api/v1/devices/${devId}`)
        .set('Authorization', `Bearer ${ktlCaToken}`);
      expect(beforeDetail.status).toBe(200);
      expect(beforeDetail.body.config.status).toBe('PENDING');
      expect(beforeDetail.body.config.version).toBe(2);
      expect(beforeDetail.body.configProfileName).toBe('TH-200 Cold Chain Test');

      // Device polls commands -> receives pending config payload
      const pollRes = await request(app)
        .get('/device/v1/commands')
        .set('X-Device-Id', devId)
        .set('X-API-Key', devKey);
      expect(pollRes.status).toBe(200);
      expect(pollRes.body.config).toEqual({
        version: 2,
        payload: { reportingIntervalSec: 10, powerMode: 'high_frequency' },
      });

      // Device acknowledges APPLIED
      const ackRes = await request(app)
        .post('/device/v1/config-ack')
        .set('X-Device-Id', devId)
        .set('X-API-Key', devKey)
        .send({ version: 2, status: 'APPLIED' });
      expect(ackRes.status).toBe(200);

      // Device detail now shows APPLIED
      const afterDetail = await request(app)
        .get(`/api/v1/devices/${devId}`)
        .set('Authorization', `Bearer ${ktlCaToken}`);
      expect(afterDetail.body.config.status).toBe('APPLIED');
      expect(afterDetail.body.config.error).toBeNull();

      // Next poll has config: null since already APPLIED
      const pollAfter = await request(app)
        .get('/device/v1/commands')
        .set('X-Device-Id', devId)
        .set('X-API-Key', devKey);
      expect(pollAfter.body.config).toBeNull();

      // Test FAILED config-ack
      await request(app)
        .post(`/api/v1/config-profiles/${profileId}/push`)
        .set('Authorization', `Bearer ${ktlCaToken}`)
        .send({ targetType: 'DEVICE', targetValue: devId });
      const failAck = await request(app)
        .post('/device/v1/config-ack')
        .set('X-Device-Id', devId)
        .set('X-API-Key', devKey)
        .send({ version: 2, status: 'FAILED', error: 'CONFIG_IGNORED_BY_DEVICE' });
      expect(failAck.status).toBe(200);

      const failedDetail = await request(app)
        .get(`/api/v1/devices/${devId}`)
        .set('Authorization', `Bearer ${ktlCaToken}`);
      expect(failedDetail.body.config.status).toBe('FAILED');
      expect(failedDetail.body.config.error).toBe('CONFIG_IGNORED_BY_DEVICE');
    });
  });

  describe('2. Firmware Repository (Multipart Upload, SHA-256 Verification, RBAC & Lifecycle)', () => {
    const fwBinary = Buffer.from('OMNISPHERE-TEST-FW-1.3.0-' + 'A'.repeat(2048), 'utf8');
    const fwSha = sha256Hex(fwBinary);
    let uploadedFwId = '';

    it('rejects upload with mismatched checksum (400), non-PA/SE upload (403), and accepts valid upload in DRAFT', async () => {
      // CA cannot upload (403)
      const caUpload = await request(app)
        .post('/api/v1/firmware')
        .set('Authorization', `Bearer ${ktlCaToken}`)
        .field('modelId', 'mdl_th200')
        .field('version', '1.3.0')
        .attach('file', fwBinary, 'th200-1.3.0.bin');
      expect(caUpload.status).toBe(403);

      // Mismatched checksum -> 400
      const badChecksum = await request(app)
        .post('/api/v1/firmware')
        .set('Authorization', `Bearer ${paToken}`)
        .field('modelId', 'mdl_th200')
        .field('version', '1.3.0')
        .field('checksumSha256', '0'.repeat(64))
        .attach('file', fwBinary, 'th200-1.3.0.bin');
      expect(badChecksum.status).toBe(400);
      expect(badChecksum.body.error.code).toBe('VALIDATION_ERROR');

      // Valid upload by PA -> 201 DRAFT with exact server-computed SHA-256
      const okUpload = await request(app)
        .post('/api/v1/firmware')
        .set('Authorization', `Bearer ${paToken}`)
        .field('modelId', 'mdl_th200')
        .field('version', '1.3.0')
        .field('checksumSha256', fwSha)
        .field('releaseNotes', 'Test release 1.3.0 with verified checksum')
        .attach('file', fwBinary, 'th200-1.3.0.bin');
      expect(okUpload.status).toBe(201);
      expect(okUpload.body.status).toBe('DRAFT');
      expect(okUpload.body.checksumSha256).toBe(fwSha);
      expect(okUpload.body.sizeBytes).toBe(fwBinary.length);
      uploadedFwId = okUpload.body.id;
      createdFirmwareFileIds.push(uploadedFwId);

      // Duplicate (modelId, version) -> 409
      const dupUpload = await request(app)
        .post('/api/v1/firmware')
        .set('Authorization', `Bearer ${seToken}`)
        .field('modelId', 'mdl_th200')
        .field('version', '1.3.0')
        .attach('file', fwBinary, 'th200-1.3.0.bin');
      expect(dupUpload.status).toBe(409);

      // CA does NOT see DRAFT firmware
      const caListDraft = await request(app)
        .get('/api/v1/firmware')
        .set('Authorization', `Bearer ${ktlCaToken}`);
      expect(caListDraft.status).toBe(200);
      expect(caListDraft.body.items.some((f: any) => f.id === uploadedFwId)).toBe(false);
      expect(caListDraft.body.items.every((f: any) => f.status === 'RELEASED')).toBe(true);

      // Release by SE -> RELEASED -> now visible to CA
      const releaseRes = await request(app)
        .patch(`/api/v1/firmware/${uploadedFwId}/status`)
        .set('Authorization', `Bearer ${seToken}`)
        .send({ status: 'RELEASED' });
      expect(releaseRes.status).toBe(200);
      expect(releaseRes.body.status).toBe('RELEASED');

      const caListReleased = await request(app)
        .get('/api/v1/firmware')
        .set('Authorization', `Bearer ${ktlCaToken}`);
      expect(caListReleased.body.items.some((f: any) => f.id === uploadedFwId)).toBe(true);

      // FT gets 403 on firmware list
      const ftList = await request(app)
        .get('/api/v1/firmware')
        .set('Authorization', `Bearer ${ftToken}`);
      expect(ftList.status).toBe(403);
    });
  });

  describe('3. OTA Rollout Preview, Approval Gating, Authenticated Download, Progress, Failure Alerts & Cancellation', () => {
    let fw140Id = '';
    const fw140Bytes = Buffer.from('OMNISPHERE-FW-1.4.0-BINARY-' + 'Z'.repeat(4096), 'utf8');
    const fw140Sha = sha256Hex(fw140Bytes);

    let ktlDev1 = { deviceId: '', apiKey: '' };
    let ktlDev2 = { deviceId: '', apiKey: '' };
    let ktlDevWrongModel = { deviceId: '', apiKey: '' };
    let ktlDevAlreadyOn = { deviceId: '', apiKey: '' };
    let ktlDevSuspended = { deviceId: '', apiKey: '' };
    let mfpDev1 = { deviceId: '', apiKey: '' };

    beforeAll(async () => {
      // Upload and release 1.4.0 for TH-200
      const up = await request(app)
        .post('/api/v1/firmware')
        .set('Authorization', `Bearer ${paToken}`)
        .field('modelId', 'mdl_th200')
        .field('version', '1.4.0')
        .field('releaseNotes', 'OTA E2E release 1.4.0')
        .attach('file', fw140Bytes, 'th200-1.4.0.bin');
      expect(up.status).toBe(201);
      fw140Id = up.body.id;
      createdFirmwareFileIds.push(fw140Id);

      const rel = await request(app)
        .patch(`/api/v1/firmware/${fw140Id}/status`)
        .set('Authorization', `Bearer ${paToken}`)
        .send({ status: 'RELEASED' });
      expect(rel.status).toBe(200);

      // Register KTL devices tagged 'ota-cohort'
      ktlDev1 = await registerActiveDevice({
        token: ktlCaToken,
        name: 'KTL-OTA-01',
        serialNumber: 'SN-KTL-OTA-001',
        hardwareId: 'AA:CC:11:00:00:01',
        modelId: 'mdl_th200',
        siteId: 'sit_ktl_dye',
        tags: ['ota-cohort'],
        firmwareVersion: '1.0.0',
      });
      ktlDev2 = await registerActiveDevice({
        token: ktlCaToken,
        name: 'KTL-OTA-02',
        serialNumber: 'SN-KTL-OTA-002',
        hardwareId: 'AA:CC:11:00:00:02',
        modelId: 'mdl_th200',
        siteId: 'sit_ktl_dye',
        tags: ['ota-cohort'],
        firmwareVersion: '1.0.0',
      });
      ktlDevWrongModel = await registerActiveDevice({
        token: ktlCaToken,
        name: 'KTL-OTA-WRONG-MODEL',
        serialNumber: 'SN-KTL-OTA-003',
        hardwareId: 'AA:CC:11:00:00:03',
        modelId: 'mdl_vm310',
        siteId: 'sit_ktl_dye',
        tags: ['ota-cohort'],
        firmwareVersion: '1.0.0',
      });
      ktlDevAlreadyOn = await registerActiveDevice({
        token: ktlCaToken,
        name: 'KTL-OTA-ALREADY',
        serialNumber: 'SN-KTL-OTA-004',
        hardwareId: 'AA:CC:11:00:00:04',
        modelId: 'mdl_th200',
        siteId: 'sit_ktl_dye',
        tags: ['ota-cohort'],
        firmwareVersion: '1.4.0',
      });
      ktlDevSuspended = await registerActiveDevice({
        token: ktlCaToken,
        name: 'KTL-OTA-SUSPENDED',
        serialNumber: 'SN-KTL-OTA-005',
        hardwareId: 'AA:CC:11:00:00:05',
        modelId: 'mdl_th200',
        siteId: 'sit_ktl_dye',
        tags: ['ota-cohort'],
        firmwareVersion: '1.0.0',
      });
      const susp = await request(app)
        .post(`/api/v1/devices/${ktlDevSuspended.deviceId}/state`)
        .set('Authorization', `Bearer ${ktlCaToken}`)
        .send({ action: 'SUSPEND', reason: 'Hold for test' });
      expect(susp.status).toBe(200);

      // Register MFP device (MFP has requireRolloutApproval = false)
      mfpDev1 = await registerActiveDevice({
        token: mfpCaToken,
        name: 'MFP-OTA-01',
        serialNumber: 'SN-MFP-OTA-001',
        hardwareId: 'BB:DD:22:00:00:01',
        modelId: 'mdl_th200',
        siteId: 'sit_mfp_cld',
        tags: ['mfp-ota'],
        firmwareVersion: '1.0.0',
      });
    });

    it('preview excludes wrong-model, non-ACTIVE, and already-on-version devices with clear reasons', async () => {
      const preview = await request(app)
        .post('/api/v1/rollouts/preview')
        .set('Authorization', `Bearer ${ktlCaToken}`)
        .send({ firmwareId: fw140Id, targetType: 'TAG', targetValue: 'ota-cohort' });
      expect(preview.status).toBe(200);
      expect(preview.body.included).toHaveLength(2);
      const includedIds = preview.body.included.map((i: any) => i.deviceId);
      expect(includedIds).toContain(ktlDev1.deviceId);
      expect(includedIds).toContain(ktlDev2.deviceId);

      expect(preview.body.excluded).toHaveLength(3);
      const byId = new Map<string, string>(
        preview.body.excluded.map((e: any) => [e.deviceId, e.reason]),
      );
      expect(byId.get(ktlDevWrongModel.deviceId)).toMatch(/Wrong model/i);
      expect(byId.get(ktlDevAlreadyOn.deviceId)).toMatch(/Already running version 1.4.0/i);
      expect(byId.get(ktlDevSuspended.deviceId)).toMatch(/SUSPENDED/i);
    });

    it('MFP rollout starts immediately (RUNNING) without approval; KTL rollout waits in PENDING_APPROVAL for CM', async () => {
      // MFP immediate rollout
      const mfpCreate = await request(app)
        .post('/api/v1/rollouts')
        .set('Authorization', `Bearer ${mfpCaToken}`)
        .send({ firmwareId: fw140Id, targetType: 'TAG', targetValue: 'mfp-ota' });
      expect(mfpCreate.status).toBe(201);
      expect(mfpCreate.body.status).toBe('RUNNING');
      expect(mfpCreate.body.jobs).toHaveLength(1);

      // Cancel MFP rollout so it cleans up for later tests
      const mfpCancel = await request(app)
        .post(`/api/v1/rollouts/${mfpCreate.body.id}/cancel`)
        .set('Authorization', `Bearer ${mfpCaToken}`);
      expect(mfpCancel.status).toBe(200);
      expect(mfpCancel.body.status).toBe('CANCELLED');
      expect(mfpCancel.body.counts.cancelled).toBe(1);

      // KTL rollout waits in PENDING_APPROVAL
      const ktlCreate = await request(app)
        .post('/api/v1/rollouts')
        .set('Authorization', `Bearer ${ktlCaToken}`)
        .send({ firmwareId: fw140Id, targetType: 'TAG', targetValue: 'ota-cohort' });
      expect(ktlCreate.status).toBe(201);
      expect(ktlCreate.body.status).toBe('PENDING_APPROVAL');
      expect(ktlCreate.body.counts.total).toBe(2);

      // CA cannot approve own rollout (CM only -> 403)
      const caApprove = await request(app)
        .post(`/api/v1/rollouts/${ktlCreate.body.id}/decision`)
        .set('Authorization', `Bearer ${ktlCaToken}`)
        .send({ decision: 'APPROVED' });
      expect(caApprove.status).toBe(403);

      // Device cannot download firmware while rollout is still PENDING_APPROVAL (403)
      const earlyDl = await request(app)
        .get(`/device/v1/firmware/${fw140Id}/download`)
        .set('X-Device-Id', ktlDev1.deviceId)
        .set('X-API-Key', ktlDev1.apiKey);
      expect(earlyDl.status).toBe(403);

      // CM rejects without reason -> 400
      const badReject = await request(app)
        .post(`/api/v1/rollouts/${ktlCreate.body.id}/decision`)
        .set('Authorization', `Bearer ${ktlCmToken}`)
        .send({ decision: 'REJECTED', reason: '' });
      expect(badReject.status).toBe(400);

      // CM approves -> transitions to RUNNING immediately (scheduledAt is null)
      const cmApprove = await request(app)
        .post(`/api/v1/rollouts/${ktlCreate.body.id}/decision`)
        .set('Authorization', `Bearer ${ktlCmToken}`)
        .send({ decision: 'APPROVED', reason: 'Approved for night shift window' });
      expect(cmApprove.status).toBe(200);
      expect(cmApprove.body.status).toBe('RUNNING');

      // Device 1 polls commands -> gets OTA update descriptor
      const poll1 = await request(app)
        .get('/device/v1/commands')
        .set('X-Device-Id', ktlDev1.deviceId)
        .set('X-API-Key', ktlDev1.apiKey);
      expect(poll1.status).toBe(200);
      expect(poll1.body.update).toEqual({
        jobId: expect.any(String),
        firmwareId: fw140Id,
        version: '1.4.0',
        downloadPath: `/device/v1/firmware/${fw140Id}/download`,
        sha256: fw140Sha,
      });
      const job1Id = poll1.body.update.jobId as string;

      // Device 1 downloads binary with device headers (no signed URLs) + verifies X-Checksum-SHA256
      const dlBadKey = await request(app)
        .get(`/device/v1/firmware/${fw140Id}/download`)
        .set('X-Device-Id', ktlDev1.deviceId)
        .set('X-API-Key', 'omk_invalid_key');
      expect(dlBadKey.status).toBe(401);

      const dlUnassigned = await request(app)
        .get(`/device/v1/firmware/${fw140Id}/download`)
        .set('X-Device-Id', ktlDevWrongModel.deviceId)
        .set('X-API-Key', ktlDevWrongModel.apiKey);
      expect(dlUnassigned.status).toBe(403);

      const dlOk = await request(app)
        .get(`/device/v1/firmware/${fw140Id}/download`)
        .set('X-Device-Id', ktlDev1.deviceId)
        .set('X-API-Key', ktlDev1.apiKey)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(Buffer.from(c)));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(dlOk.status).toBe(200);
      expect(dlOk.headers['x-checksum-sha256']).toBe(fw140Sha);
      expect(sha256Hex(dlOk.body as Buffer)).toBe(fw140Sha);

      // Device 1 transitions DOWNLOADING -> INSTALLING -> VERIFIED
      for (const st of ['DOWNLOADING', 'INSTALLING', 'VERIFIED'] as const) {
        const stRes = await request(app)
          .post(`/device/v1/updates/${job1Id}/status`)
          .set('X-Device-Id', ktlDev1.deviceId)
          .set('X-API-Key', ktlDev1.apiKey)
          .send(st === 'VERIFIED' ? { status: st, newVersion: '1.4.0' } : { status: st });
        expect(stRes.status).toBe(200);
      }

      // Device 1 now shows firmwareVersion 1.4.0
      const dev1After = await request(app)
        .get(`/api/v1/devices/${ktlDev1.deviceId}`)
        .set('Authorization', `Bearer ${ktlCaToken}`);
      expect(dev1After.body.firmwareVersion).toBe('1.4.0');

      // Device 2 polls and fails with CHECKSUM_MISMATCH -> CRITICAL alert + rollout COMPLETED + owner notified
      const poll2 = await request(app)
        .get('/device/v1/commands')
        .set('X-Device-Id', ktlDev2.deviceId)
        .set('X-API-Key', ktlDev2.apiKey);
      const job2Id = poll2.body.update.jobId as string;

      await request(app)
        .post(`/device/v1/updates/${job2Id}/status`)
        .set('X-Device-Id', ktlDev2.deviceId)
        .set('X-API-Key', ktlDev2.apiKey)
        .send({ status: 'DOWNLOADING' });

      const failRes = await request(app)
        .post(`/device/v1/updates/${job2Id}/status`)
        .set('X-Device-Id', ktlDev2.deviceId)
        .set('X-API-Key', ktlDev2.apiKey)
        .send({ status: 'FAILED', errorCode: 'CHECKSUM_MISMATCH' });
      expect(failRes.status).toBe(200);
      expect(failRes.body.rolloutStatus).toBe('COMPLETED');

      // Rollout detail shows COMPLETED with 1 verified, 1 failed
      const rolloutFinal = await request(app)
        .get(`/api/v1/rollouts/${ktlCreate.body.id}`)
        .set('Authorization', `Bearer ${ktlCaToken}`);
      expect(rolloutFinal.body.status).toBe('COMPLETED');
      expect(rolloutFinal.body.counts).toEqual({
        total: 2,
        verified: 1,
        failed: 1,
        cancelled: 0,
      });

      // CRITICAL alert created for Device 2
      const alertsRes = await request(app)
        .get('/api/v1/alerts')
        .set('Authorization', `Bearer ${ktlCaToken}`)
        .query({ deviceId: ktlDev2.deviceId });
      expect(alertsRes.status).toBe(200);
      const otaAlert = alertsRes.body.items.find(
        (a: any) => a.severity === 'CRITICAL' && a.message.includes('CHECKSUM_MISMATCH'),
      );
      expect(otaAlert).toBeTruthy();

      // Owner received ROLLOUT_COMPLETED & OTA_JOB_FAILED notifications
      const notifRes = await request(app)
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${ktlCaToken}`);
      expect(notifRes.status).toBe(200);
      expect(notifRes.body.items.some((n: any) => n.type === 'ROLLOUT_COMPLETED')).toBe(true);
      expect(notifRes.body.items.some((n: any) => n.type === 'OTA_JOB_FAILED')).toBe(true);
    });

    it('cancelling a RUNNING rollout cancels QUEUED jobs while leaving DOWNLOADING/INSTALLING in-flight', async () => {
      const dA = await registerActiveDevice({
        token: mfpCaToken,
        name: 'MFP-CANCEL-A',
        serialNumber: 'SN-MFP-CAN-A',
        hardwareId: 'BB:EE:33:00:00:01',
        modelId: 'mdl_th200',
        siteId: 'sit_mfp_cld',
        tags: ['cancel-test'],
        firmwareVersion: '1.0.0',
      });
      const dB = await registerActiveDevice({
        token: mfpCaToken,
        name: 'MFP-CANCEL-B',
        serialNumber: 'SN-MFP-CAN-B',
        hardwareId: 'BB:EE:33:00:00:02',
        modelId: 'mdl_th200',
        siteId: 'sit_mfp_cld',
        tags: ['cancel-test'],
        firmwareVersion: '1.0.0',
      });

      const create = await request(app)
        .post('/api/v1/rollouts')
        .set('Authorization', `Bearer ${mfpCaToken}`)
        .send({ firmwareId: fw140Id, targetType: 'TAG', targetValue: 'cancel-test' });
      expect(create.status).toBe(201);
      expect(create.body.status).toBe('RUNNING');

      const jobA = create.body.jobs.find((j: any) => j.deviceId === dA.deviceId);
      // Put device A in DOWNLOADING; keep device B in QUEUED
      await request(app)
        .post(`/device/v1/updates/${jobA.id}/status`)
        .set('X-Device-Id', dA.deviceId)
        .set('X-API-Key', dA.apiKey)
        .send({ status: 'DOWNLOADING' });

      const cancelRes = await request(app)
        .post(`/api/v1/rollouts/${create.body.id}/cancel`)
        .set('Authorization', `Bearer ${mfpCaToken}`);
      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.status).toBe('CANCELLED');

      const jobAAfter = cancelRes.body.jobs.find((j: any) => j.deviceId === dA.deviceId);
      const jobBAfter = cancelRes.body.jobs.find((j: any) => j.deviceId === dB.deviceId);
      expect(jobAAfter.status).toBe('DOWNLOADING');
      expect(jobBAfter.status).toBe('CANCELLED');
    });

    it('real localhost HTTP simulator executes OTA download, SHA-256 verification, VERIFIED upgrade, and FAIL_OTA_CHECKSUM', async () => {
      // Spin up a real ephemeral HTTP listener for SimulatorManager to call over localhost
      const server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const addr = server.address() as { port: number };
      const baseUrl = `http://127.0.0.1:${addr.port}`;
      runtime.simulator.setBaseUrl(baseUrl);
      runtime.simulator.setOtaStepDelayMs(50);

      try {
        const simOk = await registerActiveDevice({
          token: mfpCaToken,
          name: 'MFP-SIM-OTA-OK',
          serialNumber: 'SN-MFP-SIM-OK',
          hardwareId: 'CC:11:22:33:44:01',
          modelId: 'mdl_th200',
          siteId: 'sit_mfp_cld',
          tags: ['sim-ota'],
          firmwareVersion: '1.0.0',
        });
        const simFail = await registerActiveDevice({
          token: mfpCaToken,
          name: 'MFP-SIM-OTA-FAIL',
          serialNumber: 'SN-MFP-SIM-FAIL',
          hardwareId: 'CC:11:22:33:44:02',
          modelId: 'mdl_th200',
          siteId: 'sit_mfp_cld',
          tags: ['sim-ota'],
          firmwareVersion: '1.0.0',
        });

        // Attach both to simulator
        const att1 = await request(app)
          .post('/api/v1/simulator/attach')
          .set('Authorization', `Bearer ${mfpCaToken}`)
          .send(simOk);
        expect(att1.status).toBe(200);
        const att2 = await request(app)
          .post('/api/v1/simulator/attach')
          .set('Authorization', `Bearer ${mfpCaToken}`)
          .send(simFail);
        expect(att2.status).toBe(200);

        // Inject FAIL_OTA_CHECKSUM on simFail
        const inj = await request(app)
          .post('/api/v1/simulator/inject')
          .set('Authorization', `Bearer ${mfpCaToken}`)
          .send({ deviceId: simFail.deviceId, fault: 'FAIL_OTA_CHECKSUM' });
        expect(inj.status).toBe(200);

        // Launch immediate MFP rollout for tag 'sim-ota'
        const roll = await request(app)
          .post('/api/v1/rollouts')
          .set('Authorization', `Bearer ${mfpCaToken}`)
          .send({ firmwareId: fw140Id, targetType: 'TAG', targetValue: 'sim-ota' });
        expect(roll.status).toBe(201);
        expect(roll.body.status).toBe('RUNNING');

        // Start both simulated devices over real localhost HTTP
        const startRes = await request(app)
          .post('/api/v1/simulator/start')
          .set('Authorization', `Bearer ${mfpCaToken}`)
          .send({ deviceIds: [simOk.deviceId, simFail.deviceId], intervalSec: 5 });
        expect(startRes.status).toBe(200);

        // Wait up to 4 seconds for both simulated OTA jobs to reach terminal status
        let finalDetail: any = null;
        for (let attempt = 0; attempt < 40; attempt += 1) {
          await new Promise((r) => setTimeout(r, 100));
          const r = await request(app)
            .get(`/api/v1/rollouts/${roll.body.id}`)
            .set('Authorization', `Bearer ${mfpCaToken}`);
          finalDetail = r.body;
          if (finalDetail.status === 'COMPLETED') break;
        }

        expect(finalDetail.status).toBe('COMPLETED');
        expect(finalDetail.counts).toEqual({
          total: 2,
          verified: 1,
          failed: 1,
          cancelled: 0,
        });

        const okJob = finalDetail.jobs.find((j: any) => j.deviceId === simOk.deviceId);
        const failJob = finalDetail.jobs.find((j: any) => j.deviceId === simFail.deviceId);
        expect(okJob.status).toBe('VERIFIED');
        expect(failJob.status).toBe('FAILED');
        expect(failJob.errorCode).toBe('CHECKSUM_MISMATCH');

        const okDeviceDetail = await request(app)
          .get(`/api/v1/devices/${simOk.deviceId}`)
          .set('Authorization', `Bearer ${mfpCaToken}`);
        expect(okDeviceDetail.body.firmwareVersion).toBe('1.4.0');
      } finally {
        runtime.simulator.stopAll();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });
});
