import type Database from 'better-sqlite3';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type AppRuntime } from '../src/app.ts';
import { createDatabase } from '../src/repositories/db.ts';
import { createRepositories, type Repositories } from '../src/repositories/index.ts';
import { DEMO_PASSWORD } from '../src/seed/seedData.ts';
import { seedAllDemoData } from '../src/seed/seedMilestone2.ts';

describe('Test 6: Alert Escalation (L0 -> L1 -> L2) & Non-Blocking Email Retry/Failure', () => {
  let db: Database.Database;
  let repos: Repositories;
  let app: Express;
  let runtime: AppRuntime;

  let paToken: string;
  let seSupToken: string;
  let seOtherToken: string;
  let caToken: string;

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
    seSupToken = await signIn('noc1@omnisphere.demo'); // supervisor assigned to KTL & MFP
    seOtherToken = await signIn('noc2@omnisphere.demo'); // non-supervisor assigned to MFP & SCW
    caToken = await signIn('admin.ktl@omnisphere.demo');
  });

  afterAll(() => {
    runtime.emailService.setCustomSenderForTesting(null, { autoKickWorker: true });
    runtime.simulator.stopAll();
    runtime.backgroundJobs.stop();
    db.close();
  });

  it('never blocks alert creation when SMTP fails, retries 30s -> 60s -> 120s -> FAILED, and flags emailDeliveryFailed', async () => {
    // Configure a slow failing SMTP sender and disable background auto-kick so we drive retries deterministically
    let smtpAttempts = 0;
    runtime.emailService.setCustomSenderForTesting(
      async () => {
        smtpAttempts += 1;
        await new Promise((r) => setTimeout(r, 150));
        throw new Error('SMTP 421 Service temporarily unavailable');
      },
      { autoKickWorker: false },
    );

    // Create an immediate (durationSec: 0) threshold rule on dev_ktl_002
    const ruleRes = await request(app)
      .post('/api/v1/alert-rules')
      .set('Authorization', `Bearer ${caToken}`)
      .send({
        name: 'Immediate Email Failure Test Rule',
        kind: 'THRESHOLD',
        metricKey: 'vibration_rms',
        operator: 'GT',
        threshold: 30,
        durationSec: 0,
        severity: 'CRITICAL',
        scopeType: 'DEVICE',
        scopeId: 'dev_ktl_002',
        recipients: [{ type: 'ROLE', role: 'CLIENT_ADMIN' }],
        enabled: true,
      });
    expect(ruleRes.status).toBe(201);

    // Trigger alert and assert synchronous creation finishes well before the 150ms SMTP delay
    const startPerf = Date.now();
    const evalRes = runtime.alertService.evaluateTelemetryEvent(
      {
        tenantId: 'ten_ktl',
        deviceId: 'dev_ktl_002',
        modelId: 'mdl_vm310',
        siteId: 'sit_ktl_dye',
        state: 'ACTIVE',
        timestamp: new Date(startPerf).toISOString(),
        metrics: { vibration_rms: 42.5, temperature: 55 },
        health: { cpuLoad: 25, memoryUsage: 40, batteryLevel: 85, signalStrength: -62 },
      },
      startPerf,
    );
    const elapsedMs = Date.now() - startPerf;
    expect(evalRes.createdAlertIds).toHaveLength(1);
    expect(elapsedMs).toBeLessThan(120); // Did NOT wait for the 150ms SMTP sender!
    expect(smtpAttempts).toBe(0);

    const alertId = evalRes.createdAlertIds[0];

    // Outbox entry exists immediately as QUEUED with 0 attempts
    const outboxBefore = repos.emailOutbox
      .list(
        {
          userId: 'usr_pa_admin',
          role: 'PLATFORM_ADMIN',
          allTenants: true,
          tenantIds: [],
          activeTenantId: null,
        },
        { status: 'QUEUED', page: 1, pageSize: 50 },
      )
      .items.filter((e) => e.relatedId === alertId);
    expect(outboxBefore).toHaveLength(1);
    const emailId = outboxBefore[0].id;
    expect(outboxBefore[0].status).toBe('QUEUED');
    expect(outboxBefore[0].attempts).toBe(0);

    // Attempt 1 (initial delivery attempt) -> fails, schedules retry #1 in +30s
    const t0 = Date.now() + 1_000;
    const w1 = await runtime.backgroundJobs.runEmailWorkerOnce(t0);
    expect(w1.retried).toBeGreaterThanOrEqual(1);
    const after1 = repos.emailOutbox.findByIdSystem(emailId)!;
    expect(after1.status).toBe('QUEUED');
    expect(after1.attempts).toBe(1);
    expect(Date.parse(after1.nextAttemptAt!) - t0).toBe(30_000);
    expect(repos.alerts.findByIdSystem(alertId)!.emailDeliveryFailed).toBe(false);

    // Before 30s elapses, worker does not retry prematurely
    const wEarly = await runtime.backgroundJobs.runEmailWorkerOnce(t0 + 15_000);
    expect(wEarly.processed).toBe(0);

    // Retry #1 at +31s -> fails, schedules retry #2 in +60s
    const t1 = t0 + 31_000;
    await runtime.backgroundJobs.runEmailWorkerOnce(t1);
    const after2 = repos.emailOutbox.findByIdSystem(emailId)!;
    expect(after2.status).toBe('QUEUED');
    expect(after2.attempts).toBe(2);
    expect(Date.parse(after2.nextAttemptAt!) - t1).toBe(60_000);

    // Retry #2 at +61s -> fails, schedules retry #3 in +120s
    const t2 = t1 + 61_000;
    await runtime.backgroundJobs.runEmailWorkerOnce(t2);
    const after3 = repos.emailOutbox.findByIdSystem(emailId)!;
    expect(after3.status).toBe('QUEUED');
    expect(after3.attempts).toBe(3);
    expect(Date.parse(after3.nextAttemptAt!) - t2).toBe(120_000);
    expect(repos.alerts.findByIdSystem(alertId)!.emailDeliveryFailed).toBe(false);

    // Retry #3 at +121s -> permanent FAILED & flags related alert emailDeliveryFailed = true
    const t3 = t2 + 121_000;
    const w4 = await runtime.backgroundJobs.runEmailWorkerOnce(t3);
    expect(w4.failed).toBeGreaterThanOrEqual(1);

    const after4 = repos.emailOutbox.findByIdSystem(emailId)!;
    expect(after4.status).toBe('FAILED');
    expect(after4.attempts).toBe(4);
    expect(after4.nextAttemptAt).toBeNull();
    expect(after4.lastError).toContain('SMTP 421');

    const alertAfterFail = repos.alerts.findByIdSystem(alertId)!;
    expect(alertAfterFail.emailDeliveryFailed).toBe(true);

    // Restore normal outbox-only delivery for escalation assertions
    runtime.emailService.setCustomSenderForTesting(null, { autoKickWorker: true });
    // Close this test alert so it does not interfere with the escalation test below
    await request(app)
      .post(`/api/v1/alerts/${alertId}/close`)
      .set('Authorization', `Bearer ${seSupToken}`)
      .set('X-Tenant-Id', 'ten_ktl')
      .send({ reason: 'Email retry test completed' });
  });

  it('escalates unacknowledged OPEN CRITICAL alerts L0 -> L1 (CA) -> L2 (SE supervisor + PA) and skips acknowledged or WARNING alerts', async () => {
    const baseMs = Date.now();

    // Seed a controlled OPEN CRITICAL alert created at baseMs (KTL criticalAckMinutes = 15)
    const critAlert = repos.alerts.createSystem({
      id: 'alr_esc_crit_1',
      tenantId: 'ten_ktl',
      ruleId: 'arl_ktl_high_temp_vm310',
      deviceId: 'dev_ktl_002',
      severity: 'CRITICAL',
      status: 'OPEN',
      message: 'Escalation test critical overheat',
      snapshot: { kind: 'THRESHOLD', metricKey: 'temperature', value: 99 },
      createdAt: new Date(baseMs).toISOString(),
    });

    // Also create an ACKNOWLEDGED CRITICAL alert & an OPEN WARNING alert — neither must escalate
    const ackedAlert = repos.alerts.createSystem({
      id: 'alr_esc_acked_1',
      tenantId: 'ten_ktl',
      ruleId: 'arl_ktl_high_temp_vm310',
      deviceId: 'dev_ktl_008',
      severity: 'CRITICAL',
      status: 'OPEN',
      message: 'Acknowledged critical alert',
      snapshot: { kind: 'THRESHOLD' },
      createdAt: new Date(baseMs).toISOString(),
    });
    await request(app)
      .post(`/api/v1/alerts/${ackedAlert.id}/acknowledge`)
      .set('Authorization', `Bearer ${caToken}`);

    const warnAlert = repos.alerts.createSystem({
      id: 'alr_esc_warn_1',
      tenantId: 'ten_ktl',
      ruleId: 'arl_ktl_high_temp_th200',
      deviceId: 'dev_ktl_001',
      severity: 'WARNING',
      status: 'OPEN',
      message: 'Warning alert should never escalate',
      snapshot: { kind: 'THRESHOLD' },
      createdAt: new Date(baseMs).toISOString(),
    });

    // At +10 minutes (< 15m): no escalation for critAlert
    const r10 = runtime.backgroundJobs.runEscalationCheckOnce(baseMs + 10 * 60_000);
    expect(r10.escalatedToLevel1).not.toContain(critAlert.id);
    expect(repos.alerts.findByIdSystem(critAlert.id)!.escalationLevel).toBe(0);

    // At +16 minutes (> 15m): Level 1 escalation -> notifies KTL CA
    const r16 = runtime.backgroundJobs.runEscalationCheckOnce(baseMs + 16 * 60_000);
    expect(r16.escalatedToLevel1).toContain(critAlert.id);
    expect(r16.escalatedToLevel1).not.toContain(ackedAlert.id);
    expect(r16.escalatedToLevel1).not.toContain(warnAlert.id);

    const afterL1 = repos.alerts.findByIdSystem(critAlert.id)!;
    expect(afterL1.escalationLevel).toBe(1);
    expect(afterL1.escalatedAt).toBeTruthy();

    const caNotifs = await request(app)
      .get('/api/v1/notifications?pageSize=50')
      .set('Authorization', `Bearer ${caToken}`);
    expect(
      caNotifs.body.items.some(
        (n: { type: string; title: string; link: string }) =>
          n.type === 'ALERT_ESCALATED' &&
          n.title.includes('Escalation L1') &&
          n.link === `/alerts?alertId=${critAlert.id}`,
      ),
    ).toBe(true);

    // PA should NOT have received an L1 escalation notification for critAlert
    const paNotifsL1 = await request(app)
      .get('/api/v1/notifications?pageSize=50')
      .set('Authorization', `Bearer ${paToken}`);
    expect(
      paNotifsL1.body.items.some(
        (n: { link: string }) => n.link === `/alerts?alertId=${critAlert.id}`,
      ),
    ).toBe(false);

    // At +25 minutes (only 9 min since L1 at +16m): must NOT escalate to L2 yet
    const r25 = runtime.backgroundJobs.runEscalationCheckOnce(baseMs + 25 * 60_000);
    expect(r25.escalatedToLevel2).not.toContain(critAlert.id);

    // At +32 minutes (16 min since L1): Level 2 escalation -> notifies SE supervisor (noc1) AND PA
    const r32 = runtime.backgroundJobs.runEscalationCheckOnce(baseMs + 32 * 60_000);
    expect(r32.escalatedToLevel2).toContain(critAlert.id);
    expect(repos.alerts.findByIdSystem(critAlert.id)!.escalationLevel).toBe(2);

    // Verify SE supervisor (noc1) and PA received L2 notifications, while unassigned non-supervisor SE (noc2) did not
    const seSupNotifs = await request(app)
      .get('/api/v1/notifications?pageSize=50')
      .set('Authorization', `Bearer ${seSupToken}`);
    expect(
      seSupNotifs.body.items.some(
        (n: { type: string; title: string; link: string }) =>
          n.type === 'ALERT_ESCALATED' &&
          n.title.includes('Escalation L2') &&
          n.link === `/alerts?alertId=${critAlert.id}`,
      ),
    ).toBe(true);

    const paNotifsL2 = await request(app)
      .get('/api/v1/notifications?pageSize=50')
      .set('Authorization', `Bearer ${paToken}`);
    expect(
      paNotifsL2.body.items.some(
        (n: { type: string; title: string; link: string }) =>
          n.type === 'ALERT_ESCALATED' &&
          n.title.includes('Escalation L2') &&
          n.link === `/alerts?alertId=${critAlert.id}`,
      ),
    ).toBe(true);

    const seOtherNotifs = await request(app)
      .get('/api/v1/notifications?pageSize=50')
      .set('Authorization', `Bearer ${seOtherToken}`);
    expect(
      seOtherNotifs.body.items.some(
        (n: { link: string }) => n.link === `/alerts?alertId=${critAlert.id}`,
      ),
    ).toBe(false);

    // Verify ALERT_ESCALATED audit entries exist for both L1 and L2
    const auditRes = await request(app)
      .get('/api/v1/audit?action=ALERT_ESCALATED&pageSize=50')
      .set('Authorization', `Bearer ${paToken}`);
    const critAudits = auditRes.body.items.filter(
      (a: { targetId: string }) => a.targetId === critAlert.id,
    );
    expect(critAudits.map((a: { details: { newLevel: number } }) => a.details.newLevel).sort()).toEqual([
      1, 2,
    ]);

    // Acknowledged alert & warning alert remain at level 0
    expect(repos.alerts.findByIdSystem(ackedAlert.id)!.escalationLevel).toBe(0);
    expect(repos.alerts.findByIdSystem(warnAlert.id)!.escalationLevel).toBe(0);
  });
});
