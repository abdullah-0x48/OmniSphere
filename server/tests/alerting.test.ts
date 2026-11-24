import type Database from 'better-sqlite3';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type AppRuntime } from '../src/app.ts';
import { createDatabase } from '../src/repositories/db.ts';
import { createRepositories, type Repositories } from '../src/repositories/index.ts';
import { DEMO_PASSWORD } from '../src/seed/seedData.ts';
import { seedAllDemoData } from '../src/seed/seedMilestone2.ts';

describe('Test 5: Alerting — Duration, De-duplication, Suppression, No Auto-Close, Offline & Lifecycle', () => {
  let db: Database.Database;
  let repos: Repositories;
  let app: Express;
  let runtime: AppRuntime;

  let seToken: string;
  let caToken: string;
  let cmToken: string;
  let coToken: string;
  let mfpCaToken: string;

  let testDeviceId: string;
  let testApiKey: string;
  let testRuleId: string;
  let raisedAlertId: string;

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

    seToken = await signIn('noc1@omnisphere.demo');
    caToken = await signIn('admin.ktl@omnisphere.demo');
    cmToken = await signIn('manager.ktl@omnisphere.demo');
    coToken = await signIn('operator1.ktl@omnisphere.demo');
    mfpCaToken = await signIn('admin.mfp@omnisphere.demo');

    // Register & activate a dedicated VM-310 device in KTL for deterministic alert tests
    const reg = await request(app)
      .post('/api/v1/devices')
      .set('Authorization', `Bearer ${caToken}`)
      .send({
        name: 'KTL-DYE-VM-ALRT01',
        serialNumber: 'SN-KTL-ALRT-001',
        hardwareId: 'AA:BB:CC:DD:EE:01',
        modelId: 'mdl_vm310',
        siteId: 'sit_ktl_dye',
        tags: ['alert-test'],
      });
    expect(reg.status).toBe(201);
    testDeviceId = reg.body.provisioning.deviceId;
    testApiKey = reg.body.provisioning.apiKey;

    const hs = await request(app)
      .post('/device/v1/handshake')
      .set('X-Device-Id', testDeviceId)
      .set('X-API-Key', testApiKey)
      .send({ firmwareVersion: '1.0.0' });
    expect(hs.status).toBe(200);

    // Create a dedicated device-scoped threshold rule (temperature > 85 for 30s, CRITICAL)
    const ruleRes = await request(app)
      .post('/api/v1/alert-rules')
      .set('Authorization', `Bearer ${caToken}`)
      .send({
        name: 'Dedicated High Temp Rule',
        kind: 'THRESHOLD',
        metricKey: 'temperature',
        operator: 'GT',
        threshold: 85,
        durationSec: 30,
        severity: 'CRITICAL',
        scopeType: 'DEVICE',
        scopeId: testDeviceId,
        enabled: true,
      });
    expect(ruleRes.status).toBe(201);
    testRuleId = ruleRes.body.id;

    // Disable seeded model-scoped VM-310 high temp rule so assertions target our single rule cleanly
    await request(app)
      .patch('/api/v1/alert-rules/arl_ktl_high_temp_vm310')
      .set('Authorization', `Bearer ${caToken}`)
      .send({ enabled: false });
  });

  afterAll(() => {
    runtime.simulator.stopAll();
    runtime.backgroundJobs.stop();
    db.close();
  });

  it('requires sustained duration before firing and resets duration timer when reading recovers', () => {
    const t0 = Date.now();
    const baseEvent = {
      tenantId: 'ten_ktl',
      deviceId: testDeviceId,
      modelId: 'mdl_vm310',
      siteId: 'sit_ktl_dye',
      state: 'ACTIVE' as const,
      health: { cpuLoad: 30, memoryUsage: 40, batteryLevel: 90, signalStrength: -60 },
    };

    // t=0: spike above 85 -> breach started, 0s elapsed < 30s -> no alert
    const r1 = runtime.alertService.evaluateTelemetryEvent(
      { ...baseEvent, timestamp: new Date(t0).toISOString(), metrics: { temperature: 92, vibration_rms: 4 } },
      t0,
    );
    expect(r1.createdAlertIds).toHaveLength(0);

    // t=15s: still breaching -> 15s < 30s -> no alert
    const r2 = runtime.alertService.evaluateTelemetryEvent(
      { ...baseEvent, timestamp: new Date(t0 + 15_000).toISOString(), metrics: { temperature: 93, vibration_rms: 4 } },
      t0 + 15_000,
    );
    expect(r2.createdAlertIds).toHaveLength(0);

    // t=20s: normal reading -> resets breach timer
    const r3 = runtime.alertService.evaluateTelemetryEvent(
      { ...baseEvent, timestamp: new Date(t0 + 20_000).toISOString(), metrics: { temperature: 60, vibration_rms: 4 } },
      t0 + 20_000,
    );
    expect(r3.createdAlertIds).toHaveLength(0);

    // t=35s: spike again (15s after normal) -> timer restarted at t=35s, so still no alert!
    const r4 = runtime.alertService.evaluateTelemetryEvent(
      { ...baseEvent, timestamp: new Date(t0 + 35_000).toISOString(), metrics: { temperature: 95, vibration_rms: 4 } },
      t0 + 35_000,
    );
    expect(r4.createdAlertIds).toHaveLength(0);

    // t=66s: 31s since t=35s -> fires exactly ONE alert
    const r5 = runtime.alertService.evaluateTelemetryEvent(
      { ...baseEvent, timestamp: new Date(t0 + 66_000).toISOString(), metrics: { temperature: 96, vibration_rms: 4 } },
      t0 + 66_000,
    );
    expect(r5.createdAlertIds).toHaveLength(1);
    raisedAlertId = r5.createdAlertIds[0];

    // t=90s & t=120s: continued breaches must be DE-DUPLICATED
    const r6 = runtime.alertService.evaluateTelemetryEvent(
      { ...baseEvent, timestamp: new Date(t0 + 90_000).toISOString(), metrics: { temperature: 98, vibration_rms: 4 } },
      t0 + 90_000,
    );
    expect(r6.createdAlertIds).toHaveLength(0);

    // t=140s: metric returns to normal -> alert MUST NEVER AUTO-CLOSE
    const r7 = runtime.alertService.evaluateTelemetryEvent(
      { ...baseEvent, timestamp: new Date(t0 + 140_000).toISOString(), metrics: { temperature: 45, vibration_rms: 3 } },
      t0 + 140_000,
    );
    expect(r7.createdAlertIds).toHaveLength(0);

    const persisted = repos.alerts.findByIdSystem(raisedAlertId);
    expect(persisted).not.toBeNull();
    expect(persisted!.status).toBe('OPEN');
    expect(persisted!.severity).toBe('CRITICAL');
  });

  it('creates in-app notifications for default recipients (CA, CO, SE) and supports mark read / read-all', async () => {
    const caNotifs = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${caToken}`);
    expect(caNotifs.status).toBe(200);
    const matchingCa = caNotifs.body.items.find(
      (n: { link: string | null }) => n.link === `/alerts?alertId=${raisedAlertId}`,
    );
    expect(matchingCa).toBeTruthy();
    expect(matchingCa.read).toBe(false);

    const coNotifs = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${coToken}`);
    expect(coNotifs.status).toBe(200);
    expect(
      coNotifs.body.items.some(
        (n: { link: string | null }) => n.link === `/alerts?alertId=${raisedAlertId}`,
      ),
    ).toBe(true);

    const seNotifs = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${seToken}`);
    expect(seNotifs.status).toBe(200);
    expect(
      seNotifs.body.items.some(
        (n: { link: string | null }) => n.link === `/alerts?alertId=${raisedAlertId}`,
      ),
    ).toBe(true);

    // Cross-user isolation: CO cannot mark CA's notification read (404)
    const crossRead = await request(app)
      .post(`/api/v1/notifications/${matchingCa.id}/read`)
      .set('Authorization', `Bearer ${coToken}`);
    expect(crossRead.status).toBe(404);

    // CA marks own notification read
    const markOne = await request(app)
      .post(`/api/v1/notifications/${matchingCa.id}/read`)
      .set('Authorization', `Bearer ${caToken}`);
    expect(markOne.status).toBe(200);
    expect(markOne.body.read).toBe(true);

    // CO marks all read
    const markAll = await request(app)
      .post('/api/v1/notifications/read-all')
      .set('Authorization', `Bearer ${coToken}`);
    expect(markAll.status).toBe(200);

    const coAfter = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${coToken}`);
    expect(coAfter.body.unreadCount).toBe(0);
  });

  it('enforces RBAC on acknowledge (CO/CA/SE) and close (SE only with reason), and deduplicates while ACKNOWLEDGED', async () => {
    // CM cannot acknowledge or close
    const cmAck = await request(app)
      .post(`/api/v1/alerts/${raisedAlertId}/acknowledge`)
      .set('Authorization', `Bearer ${cmToken}`);
    expect(cmAck.status).toBe(403);

    const cmClose = await request(app)
      .post(`/api/v1/alerts/${raisedAlertId}/close`)
      .set('Authorization', `Bearer ${cmToken}`)
      .send({ reason: 'Not allowed' });
    expect(cmClose.status).toBe(403);

    // CA cannot close
    const caClose = await request(app)
      .post(`/api/v1/alerts/${raisedAlertId}/close`)
      .set('Authorization', `Bearer ${caToken}`)
      .send({ reason: 'CA cannot close' });
    expect(caClose.status).toBe(403);

    // Cross-tenant CA gets 404
    const crossGet = await request(app)
      .get(`/api/v1/alerts/${raisedAlertId}`)
      .set('Authorization', `Bearer ${mfpCaToken}`);
    expect(crossGet.status).toBe(404);

    // CO acknowledges the alert
    const coAck = await request(app)
      .post(`/api/v1/alerts/${raisedAlertId}/acknowledge`)
      .set('Authorization', `Bearer ${coToken}`);
    expect(coAck.status).toBe(200);
    expect(coAck.body.status).toBe('ACKNOWLEDGED');
    expect(coAck.body.acknowledgedBy).toBe('usr_ktl_co1');

    // Sustained breach while ACKNOWLEDGED must still be de-duplicated
    const baseTime = Date.now() + 300_000;
    const baseEvent = {
      tenantId: 'ten_ktl',
      deviceId: testDeviceId,
      modelId: 'mdl_vm310',
      siteId: 'sit_ktl_dye',
      state: 'ACTIVE' as const,
      health: { cpuLoad: 30, memoryUsage: 40, batteryLevel: 90, signalStrength: -60 },
      metrics: { temperature: 100, vibration_rms: 5 },
    };
    runtime.alertService.evaluateTelemetryEvent(
      { ...baseEvent, timestamp: new Date(baseTime).toISOString() },
      baseTime,
    );
    const dedup = runtime.alertService.evaluateTelemetryEvent(
      { ...baseEvent, timestamp: new Date(baseTime + 45_000).toISOString() },
      baseTime + 45_000,
    );
    expect(dedup.createdAlertIds).toHaveLength(0);

    // SE closes without reason -> 400 validation error
    const badClose = await request(app)
      .post(`/api/v1/alerts/${raisedAlertId}/close`)
      .set('Authorization', `Bearer ${seToken}`)
      .set('X-Tenant-Id', 'ten_ktl')
      .send({ reason: '' });
    expect(badClose.status).toBe(400);

    // SE closes with valid reason
    const seClose = await request(app)
      .post(`/api/v1/alerts/${raisedAlertId}/close`)
      .set('Authorization', `Bearer ${seToken}`)
      .set('X-Tenant-Id', 'ten_ktl')
      .send({ reason: 'Cooling fan belt replaced and motor temp verified normal' });
    expect(seClose.status).toBe(200);
    expect(seClose.body.status).toBe('CLOSED');
    expect(seClose.body.closeReason).toContain('Cooling fan belt replaced');

    // Detail endpoint includes timeline with ALERT_CREATED, ALERT_ACKNOWLEDGED, ALERT_CLOSED
    const detailRes = await request(app)
      .get(`/api/v1/alerts/${raisedAlertId}`)
      .set('Authorization', `Bearer ${caToken}`);
    expect(detailRes.status).toBe(200);
    const actions = detailRes.body.timeline.map((e: { action: string }) => e.action);
    expect(actions).toContain('ALERT_CREATED');
    expect(actions).toContain('ALERT_ACKNOWLEDGED');
    expect(actions).toContain('ALERT_CLOSED');
  });

  it('suppresses alerts when device is UNDER_MAINTENANCE or SUSPENDED', async () => {
    // Move device to UNDER_MAINTENANCE
    const maintRes = await request(app)
      .post(`/api/v1/devices/${testDeviceId}/state`)
      .set('Authorization', `Bearer ${caToken}`)
      .send({ action: 'SET_UNDER_MAINTENANCE', reason: 'Planned sensor check' });
    expect(maintRes.status).toBe(200);

    const tMaint = Date.now() + 600_000;
    const baseEvent = {
      tenantId: 'ten_ktl',
      deviceId: testDeviceId,
      modelId: 'mdl_vm310',
      siteId: 'sit_ktl_dye',
      state: 'UNDER_MAINTENANCE' as const,
      health: { cpuLoad: 30, memoryUsage: 40, batteryLevel: 90, signalStrength: -60 },
      metrics: { temperature: 110, vibration_rms: 8 },
    };

    const m1 = runtime.alertService.evaluateTelemetryEvent(
      { ...baseEvent, timestamp: new Date(tMaint).toISOString() },
      tMaint,
    );
    const m2 = runtime.alertService.evaluateTelemetryEvent(
      { ...baseEvent, timestamp: new Date(tMaint + 45_000).toISOString() },
      tMaint + 45_000,
    );
    expect(m1.createdAlertIds).toHaveLength(0);
    expect(m2.createdAlertIds).toHaveLength(0);

    // Return to ACTIVE then SUSPEND
    await request(app)
      .post(`/api/v1/devices/${testDeviceId}/state`)
      .set('Authorization', `Bearer ${caToken}`)
      .send({ action: 'SET_ACTIVE' });
    const suspRes = await request(app)
      .post(`/api/v1/devices/${testDeviceId}/state`)
      .set('Authorization', `Bearer ${caToken}`)
      .send({ action: 'SUSPEND', reason: 'Line shutdown' });
    expect(suspRes.status).toBe(200);

    const tSusp = Date.now() + 700_000;
    const s1 = runtime.alertService.evaluateTelemetryEvent(
      { ...baseEvent, state: 'SUSPENDED', timestamp: new Date(tSusp).toISOString() },
      tSusp,
    );
    const s2 = runtime.alertService.evaluateTelemetryEvent(
      { ...baseEvent, state: 'SUSPENDED', timestamp: new Date(tSusp + 45_000).toISOString() },
      tSusp + 45_000,
    );
    expect(s1.createdAlertIds).toHaveLength(0);
    expect(s2.createdAlertIds).toHaveLength(0);

    // Resume to ACTIVE for OFFLINE test
    await request(app)
      .post(`/api/v1/devices/${testDeviceId}/state`)
      .set('Authorization', `Bearer ${caToken}`)
      .send({ action: 'RESUME' });
  });

  it('fires OFFLINE alert once when ACTIVE device goes silent beyond duration and does not duplicate', async () => {
    // Send a fresh heartbeat so device is ONLINE at current time
    const hb = await request(app)
      .post('/device/v1/heartbeat')
      .set('X-Device-Id', testDeviceId)
      .set('X-API-Key', testApiKey)
      .send({ cpuLoad: 25, memoryUsage: 40 });
    expect(hb.status).toBe(202);

    // Advance time 120s (> 90s offline threshold & > 90s Offline rule on sit_ktl_dye)
    const futureMs = Date.now() + 120_000;
    const offlineSweep1 = runtime.backgroundJobs.runOfflineCheckOnce(futureMs);
    expect(offlineSweep1.markedOffline).toContain(testDeviceId);

    // Wait a microtask for async onDeviceOffline hook if any
    await new Promise((r) => setTimeout(r, 20));

    const alertsAfter1 = await request(app)
      .get(`/api/v1/alerts?deviceId=${testDeviceId}&status=OPEN`)
      .set('Authorization', `Bearer ${caToken}`);
    expect(alertsAfter1.status).toBe(200);
    const offlineAlerts = alertsAfter1.body.items.filter(
      (a: { ruleId: string }) => a.ruleId === 'arl_ktl_offline_90s',
    );
    expect(offlineAlerts).toHaveLength(1);

    // Second sweep at +150s must NOT duplicate the OFFLINE alert
    runtime.backgroundJobs.runOfflineCheckOnce(futureMs + 30_000);
    const alertsAfter2 = await request(app)
      .get(`/api/v1/alerts?deviceId=${testDeviceId}&status=OPEN`)
      .set('Authorization', `Bearer ${caToken}`);
    const offlineAlerts2 = alertsAfter2.body.items.filter(
      (a: { ruleId: string }) => a.ruleId === 'arl_ktl_offline_90s',
    );
    expect(offlineAlerts2).toHaveLength(1);
  });

  it('prevents cross-tenant access to alert rules (returns 404)', async () => {
    const crossRule = await request(app)
      .get(`/api/v1/alert-rules/${testRuleId}`)
      .set('Authorization', `Bearer ${mfpCaToken}`);
    expect(crossRule.status).toBe(404);

    const crossDelete = await request(app)
      .delete(`/api/v1/alert-rules/${testRuleId}`)
      .set('Authorization', `Bearer ${mfpCaToken}`);
    expect(crossDelete.status).toBe(404);
  });
});
