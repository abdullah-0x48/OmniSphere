import type Database from 'better-sqlite3';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type AppRuntime } from '../src/app.ts';
import { createDatabase } from '../src/repositories/db.ts';
import { createRepositories, type Repositories } from '../src/repositories/index.ts';
import { DEMO_PASSWORD } from '../src/seed/seedData.ts';
import { seedAllDemoData } from '../src/seed/seedMilestone2.ts';
import type { AlertEvaluationHook } from '../src/services/liveStateStore.ts';

describe('Test 4: Device API (/device/v1), Telemetry Ingestion, Offline Detector & Fleet/Simulator APIs', () => {
  let db: Database.Database;
  let repos: Repositories;
  let app: Express;
  let runtime: AppRuntime;

  let paToken: string;
  let seToken: string;
  let caToken: string;
  let mfpCaToken: string;
  let coToken: string;

  let testDeviceId: string;
  let testApiKey: string;

  async function signIn(email: string): Promise<string> {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.token as string;
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    db = createDatabase(':memory:');
    repos = createRepositories(db);
    await seedAllDemoData(repos);
    app = createApp(repos);
    runtime = app.locals.runtime as AppRuntime;

    paToken = await signIn('admin@omnisphere.demo');
    seToken = await signIn('noc1@omnisphere.demo');
    caToken = await signIn('admin.ktl@omnisphere.demo');
    mfpCaToken = await signIn('admin.mfp@omnisphere.demo');
    coToken = await signIn('operator1.ktl@omnisphere.demo');

    // Register a fresh PROVISIONED TH-200 device in KTL for handshake & ingestion tests
    const regRes = await request(app)
      .post('/api/v1/devices')
      .set('Authorization', `Bearer ${caToken}`)
      .send({
        name: 'KTL-DYE-TH-M3TEST',
        serialNumber: 'SN-KTL-M3-001',
        hardwareId: 'DE:AD:BE:EF:00:01',
        modelId: 'mdl_th200',
        siteId: 'sit_ktl_dye',
        tags: ['m3-test'],
      });
    expect(regRes.status).toBe(201);
    testDeviceId = regRes.body.provisioning.deviceId;
    testApiKey = regRes.body.provisioning.apiKey;
  });

  afterAll(() => {
    runtime.simulator.stopAll();
    runtime.backgroundJobs.stop();
    db.close();
  });

  it('rejects missing headers, unknown device, and wrong API key with 401 and rate-limits DEVICE_AUTH_FAILED audits', async () => {
    const noHeaders = await request(app).post('/device/v1/handshake').send({ firmwareVersion: '1.0.0' });
    expect(noHeaders.status).toBe(401);

    const unknownDev = await request(app)
      .post('/device/v1/handshake')
      .set('X-Device-Id', 'dev_does_not_exist')
      .set('X-API-Key', 'omk_fakekey1234567890')
      .send({ firmwareVersion: '1.0.0' });
    expect(unknownDev.status).toBe(401);

    // Send 3 bad-key attempts for the same device; audit log should only record 1 within 5 minutes
    for (let i = 0; i < 3; i += 1) {
      const badKey = await request(app)
        .post('/device/v1/telemetry')
        .set('X-Device-Id', testDeviceId)
        .set('X-API-Key', 'omk_wrong_key_value_000000')
        .send({ timestamp: new Date().toISOString(), metrics: { temperature: 25 } });
      expect(badKey.status).toBe(401);
    }

    const auditRes = await request(app)
      .get(`/api/v1/audit?action=DEVICE_AUTH_FAILED&q=${testDeviceId}`)
      .set('Authorization', `Bearer ${caToken}`);
    expect(auditRes.status).toBe(200);
    const matching = auditRes.body.items.filter(
      (a: { targetId: string; action: string }) =>
        a.targetId === testDeviceId && a.action === 'DEVICE_AUTH_FAILED',
    );
    expect(matching).toHaveLength(1);
  });

  it('activates a PROVISIONED device on POST /device/v1/handshake and records history + connectivity + audit', async () => {
    const hsRes = await request(app)
      .post('/device/v1/handshake')
      .set('X-Device-Id', testDeviceId)
      .set('X-API-Key', testApiKey)
      .send({ firmwareVersion: '1.2.3' });

    expect(hsRes.status).toBe(200);
    expect(hsRes.body.heartbeatIntervalSec).toBe(30);
    expect(hsRes.body.config).toBeNull();
    expect(typeof hsRes.body.serverTime).toBe('string');

    const detailRes = await request(app)
      .get(`/api/v1/devices/${testDeviceId}`)
      .set('Authorization', `Bearer ${caToken}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.state).toBe('ACTIVE');
    expect(detailRes.body.connectivity).toBe('ONLINE');
    expect(detailRes.body.firmwareVersion).toBe('1.2.3');

    const historyRes = await request(app)
      .get(`/api/v1/devices/${testDeviceId}/history`)
      .set('Authorization', `Bearer ${caToken}`);
    expect(historyRes.status).toBe(200);
    expect(
      historyRes.body.items.some((e: { kind: string; title: string }) =>
        e.kind === 'STATE_CHANGE' && e.title.includes('PROVISIONED → ACTIVE'),
      ),
    ).toBe(true);
    expect(
      historyRes.body.items.some((e: { kind: string; title: string }) =>
        e.kind === 'CONNECTIVITY' && e.title.includes('ONLINE'),
      ),
    ).toBe(true);
  });

  it('rejects invalid telemetry with 400 and increments invalidPayloadCount; accepts valid telemetry, ignores exact duplicates, flushes 10-min buckets, and returns series', async () => {
    const telemetryHookEvents: Array<{ deviceId: string; metrics: Record<string, unknown> }> = [];
    const hook: AlertEvaluationHook = {
      onTelemetryOrHeartbeat(ev) {
        telemetryHookEvents.push({ deviceId: ev.deviceId, metrics: ev.metrics });
      },
      onDeviceOffline() {
        // tested below
      },
    };
    runtime.liveState.setAlertEvaluationHook(hook);

    // 1. Unknown metric key -> 400
    const badMetric = await request(app)
      .post('/device/v1/telemetry')
      .set('X-Device-Id', testDeviceId)
      .set('X-API-Key', testApiKey)
      .send({ timestamp: new Date().toISOString(), metrics: { unknown_sensor: 42 } });
    expect(badMetric.status).toBe(400);
    expect(badMetric.body.error.code).toBe('VALIDATION_ERROR');

    // 2. Out of range value (temperature max is 120 on TH-200) -> 400
    const outOfRange = await request(app)
      .post('/device/v1/telemetry')
      .set('X-Device-Id', testDeviceId)
      .set('X-API-Key', testApiKey)
      .send({ timestamp: new Date().toISOString(), metrics: { temperature: 999 } });
    expect(outOfRange.status).toBe(400);

    // 3. Wrong type (string instead of number) -> 400
    const wrongType = await request(app)
      .post('/device/v1/telemetry')
      .set('X-Device-Id', testDeviceId)
      .set('X-API-Key', testApiKey)
      .send({ timestamp: new Date().toISOString(), metrics: { temperature: 'hot' } });
    expect(wrongType.status).toBe(400);

    // Verify invalidPayloadCount incremented to 3
    const liveAfterBad = await request(app)
      .get(`/api/v1/devices/${testDeviceId}/live`)
      .set('Authorization', `Bearer ${caToken}`);
    expect(liveAfterBad.status).toBe(200);
    expect(liveAfterBad.body.invalidPayloadCount).toBe(3);

    // 4. Valid telemetry -> 202
    const ts1 = new Date(Date.now() - 60_000).toISOString();
    const ts2 = new Date().toISOString();
    const ok1 = await request(app)
      .post('/device/v1/telemetry')
      .set('X-Device-Id', testDeviceId)
      .set('X-API-Key', testApiKey)
      .send({
        timestamp: ts1,
        metrics: { temperature: 31.5, humidity: 58.2 },
        health: { cpuLoad: 29.4, memoryUsage: 48.0, batteryLevel: 91, signalStrength: -62, uptimeSec: 300 },
      });
    expect(ok1.status).toBe(202);
    expect(ok1.body).toEqual({ accepted: true, duplicate: false });

    // 5. Exact duplicate timestamp -> accepted: true, duplicate: true
    const dup = await request(app)
      .post('/device/v1/telemetry')
      .set('X-Device-Id', testDeviceId)
      .set('X-API-Key', testApiKey)
      .send({
        timestamp: ts1,
        metrics: { temperature: 31.5, humidity: 58.2 },
      });
    expect(dup.status).toBe(202);
    expect(dup.body).toEqual({ accepted: true, duplicate: true });

    // Second distinct reading
    const ok2 = await request(app)
      .post('/device/v1/telemetry')
      .set('X-Device-Id', testDeviceId)
      .set('X-API-Key', testApiKey)
      .send({
        timestamp: ts2,
        metrics: { temperature: 33.1, humidity: 57.0 },
        health: { cpuLoad: 32.0, memoryUsage: 49.5, batteryLevel: 90, signalStrength: -61, uptimeSec: 360 },
      });
    expect(ok2.status).toBe(202);

    // Allow setImmediate hook to run
    await new Promise((r) => setImmediate(r));
    expect(telemetryHookEvents.length).toBe(2);

    // Flush buffer to 10-minute SQLite buckets
    const flushStats = runtime.backgroundJobs.runTelemetryFlushOnce();
    expect(flushStats.samplesFlushed).toBe(2);
    expect(flushStats.bucketsWritten).toBeGreaterThanOrEqual(1);

    // Query telemetry series for 1h range
    const telRes = await request(app)
      .get(`/api/v1/devices/${testDeviceId}/telemetry?range=1h`)
      .set('Authorization', `Bearer ${caToken}`);
    expect(telRes.status).toBe(200);
    expect(telRes.body.series.temperature).toHaveLength(2);
    expect(telRes.body.series.temperature[1].value).toBe(33.1);
    expect(telRes.body.healthSeries.cpuLoad).toHaveLength(2);

    // Cross-tenant isolation: MFP CA cannot view KTL device live state or telemetry (404)
    const crossLive = await request(app)
      .get(`/api/v1/devices/${testDeviceId}/live`)
      .set('Authorization', `Bearer ${mfpCaToken}`);
    expect(crossLive.status).toBe(404);

    const crossTel = await request(app)
      .get(`/api/v1/devices/${testDeviceId}/telemetry?range=1h`)
      .set('Authorization', `Bearer ${mfpCaToken}`);
    expect(crossTel.status).toBe(404);

    runtime.liveState.setAlertEvaluationHook(null);
  });

  it('queues RESTART command, delivers it on GET /device/v1/commands, and marks ACKED on POST /commands/:id/ack', async () => {
    const queueRes = await request(app)
      .post(`/api/v1/devices/${testDeviceId}/commands`)
      .set('Authorization', `Bearer ${caToken}`)
      .send({ type: 'RESTART' });
    expect(queueRes.status).toBe(201);
    const commandId = queueRes.body.id as string;

    const pollRes = await request(app)
      .get('/device/v1/commands')
      .set('X-Device-Id', testDeviceId)
      .set('X-API-Key', testApiKey);
    expect(pollRes.status).toBe(200);
    expect(pollRes.body.commands).toEqual([{ id: commandId, type: 'RESTART' }]);

    const ackRes = await request(app)
      .post(`/device/v1/commands/${commandId}/ack`)
      .set('X-Device-Id', testDeviceId)
      .set('X-API-Key', testApiKey)
      .send({ status: 'ACKED' });
    expect(ackRes.status).toBe(200);
    expect(ackRes.body.command.status).toBe('ACKED');

    // Subsequent poll has no pending commands
    const pollAfter = await request(app)
      .get('/device/v1/commands')
      .set('X-Device-Id', testDeviceId)
      .set('X-API-Key', testApiKey);
    expect(pollAfter.status).toBe(200);
    expect(pollAfter.body.commands).toEqual([]);
  });

  it('detects offline devices after missed heartbeat window, fires AlertEvaluationHook.onDeviceOffline, and restores ONLINE on next heartbeat', async () => {
    const offlineEvents: string[] = [];
    runtime.liveState.setAlertEvaluationHook({
      onTelemetryOrHeartbeat() {},
      onDeviceOffline(ev) {
        offlineEvents.push(ev.deviceId);
      },
    });

    // Run offline check simulating time 5 minutes into the future (exceeds 3 * 30s = 90s)
    const futureMs = Date.now() + 5 * 60_000;
    const sweep = runtime.backgroundJobs.runOfflineCheckOnce(futureMs);
    expect(sweep.markedOffline).toContain(testDeviceId);
    expect(offlineEvents).toContain(testDeviceId);

    const liveOffline = await request(app)
      .get(`/api/v1/devices/${testDeviceId}/live`)
      .set('Authorization', `Bearer ${caToken}`);
    expect(liveOffline.status).toBe(200);
    expect(liveOffline.body.connectivity).toBe('OFFLINE');

    // Device sends heartbeat -> immediately restored to ONLINE
    const hbRes = await request(app)
      .post('/device/v1/heartbeat')
      .set('X-Device-Id', testDeviceId)
      .set('X-API-Key', testApiKey)
      .send({ health: { cpuLoad: 21.0, uptimeSec: 500 } });
    expect(hbRes.status).toBe(202);

    const liveOnline = await request(app)
      .get(`/api/v1/devices/${testDeviceId}/live`)
      .set('Authorization', `Bearer ${caToken}`);
    expect(liveOnline.status).toBe(200);
    expect(liveOnline.body.connectivity).toBe('ONLINE');

    runtime.liveState.setAlertEvaluationHook(null);
  });

  it('rejects SUSPENDED device, DECOMMISSIONED device, and SUSPENDED tenant with 403', async () => {
    // Suspend device
    const suspDev = await request(app)
      .post(`/api/v1/devices/${testDeviceId}/state`)
      .set('Authorization', `Bearer ${caToken}`)
      .send({ action: 'SUSPEND', reason: 'Test suspension' });
    expect(suspDev.status).toBe(200);

    const callSuspended = await request(app)
      .post('/device/v1/heartbeat')
      .set('X-Device-Id', testDeviceId)
      .set('X-API-Key', testApiKey)
      .send({ health: { cpuLoad: 15 } });
    expect(callSuspended.status).toBe(403);

    // Resume device, then suspend tenant KTL -> 403
    await request(app)
      .post(`/api/v1/devices/${testDeviceId}/state`)
      .set('Authorization', `Bearer ${caToken}`)
      .send({ action: 'RESUME' });

    const suspTenant = await request(app)
      .post('/api/v1/tenants/ten_ktl/suspend')
      .set('Authorization', `Bearer ${paToken}`)
      .send({ reason: 'Maintenance hold' });
    expect(suspTenant.status).toBe(200);

    const callSuspTenant = await request(app)
      .post('/device/v1/heartbeat')
      .set('X-Device-Id', testDeviceId)
      .set('X-API-Key', testApiKey)
      .send({ health: { cpuLoad: 15 } });
    expect(callSuspTenant.status).toBe(403);

    // Reactivate tenant KTL
    await request(app)
      .post('/api/v1/tenants/ten_ktl/reactivate')
      .set('Authorization', `Bearer ${paToken}`);

    // Decommission device -> 403
    const decomm = await request(app)
      .post(`/api/v1/devices/${testDeviceId}/state`)
      .set('Authorization', `Bearer ${caToken}`)
      .send({ action: 'DECOMMISSION', reason: 'End of test' });
    expect(decomm.status).toBe(200);

    const callDecomm = await request(app)
      .post('/device/v1/heartbeat')
      .set('X-Device-Id', testDeviceId)
      .set('X-API-Key', testApiKey)
      .send({ health: { cpuLoad: 15 } });
    expect(callDecomm.status).toBe(403);
  });

  it('serves /api/v1/fleet/summary, /api/v1/fleet/overview, and enforces /api/v1/simulator RBAC without leaking API keys', async () => {
    // Fleet summary for KTL CA
    const summaryRes = await request(app)
      .get('/api/v1/fleet/summary')
      .set('Authorization', `Bearer ${caToken}`);
    expect(summaryRes.status).toBe(200);
    expect(summaryRes.body.tenantCode).toBe('KTL');
    expect(summaryRes.body.totalDevices).toBeGreaterThanOrEqual(12);
    expect(summaryRes.body.bySite.length).toBeGreaterThanOrEqual(2);
    expect(summaryRes.body.firmwareDistribution.length).toBeGreaterThan(0);

    // NOC overview for SE (noc1 assigned to KTL + MFP)
    const nocRes = await request(app)
      .get('/api/v1/fleet/overview')
      .set('Authorization', `Bearer ${seToken}`);
    expect(nocRes.status).toBe(200);
    expect(nocRes.body.tenants.map((t: { tenantCode: string }) => t.tenantCode).sort()).toEqual([
      'KTL',
      'MFP',
    ]);
    expect(nocRes.body.needsAttention.length).toBeGreaterThan(0);

    // Simulator status for CA must NEVER leak apiKey or apiKeyHash
    const simRes = await request(app)
      .get('/api/v1/simulator/status')
      .set('Authorization', `Bearer ${caToken}`);
    expect(simRes.status).toBe(200);
    expect(simRes.body.devices.length).toBeGreaterThanOrEqual(8);
    expect(JSON.stringify(simRes.body)).not.toContain('omk_');
    expect(JSON.stringify(simRes.body)).not.toContain('apiKeyHash');

    // Client Operator cannot access simulator (403)
    const coSim = await request(app)
      .get('/api/v1/simulator/status')
      .set('Authorization', `Bearer ${coToken}`);
    expect(coSim.status).toBe(403);
  });
});
