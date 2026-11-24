import type Database from 'better-sqlite3';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type AppRuntime } from '../src/app.ts';
import { createDatabase } from '../src/repositories/db.ts';
import { createRepositories, type Repositories } from '../src/repositories/index.ts';
import { DEMO_PASSWORD } from '../src/seed/seedData.ts';
import { seedAllDemoData } from '../src/seed/seedMilestone2.ts';

describe('Test 7: Milestone 5 — Tickets, Work Orders, Approvals, Maintenance Plans & End-to-End Story', () => {
  let db: Database.Database;
  let repos: Repositories;
  let app: Express;
  let runtime: AppRuntime;

  let seToken: string;
  let ftToken: string;
  let ft2Token: string;
  let caToken: string;
  let cmToken: string;
  let coToken: string;
  let mfpCaToken: string;

  let tech1Id: string;
  let testDeviceId: string;
  let testDeviceApiKey: string;
  let storyAlertId: string;
  let storyTicketId: string;
  let storyWorkOrderId: string;

  async function signIn(email: string): Promise<{ token: string; userId: string }> {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return { token: res.body.token as string, userId: res.body.user.id as string };
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    db = createDatabase(':memory:');
    repos = createRepositories(db);
    await seedAllDemoData(repos);
    app = createApp(repos);
    runtime = app.locals.runtime as AppRuntime;

    seToken = (await signIn('noc1@omnisphere.demo')).token;
    const ft1 = await signIn('tech1@omnisphere.demo');
    ftToken = ft1.token;
    tech1Id = ft1.userId;
    ft2Token = (await signIn('tech2@omnisphere.demo')).token;
    caToken = (await signIn('admin.ktl@omnisphere.demo')).token;
    cmToken = (await signIn('manager.ktl@omnisphere.demo')).token;
    coToken = (await signIn('operator1.ktl@omnisphere.demo')).token;
    mfpCaToken = (await signIn('admin.mfp@omnisphere.demo')).token;

    // Register & activate a dedicated KTL device for the end-to-end story
    const reg = await request(app)
      .post('/api/v1/devices')
      .set('Authorization', `Bearer ${caToken}`)
      .send({
        name: 'KTL-DYE-VM-M5STORY',
        serialNumber: 'SN-KTL-M5-001',
        hardwareId: 'AA:BB:CC:DD:M5:01',
        modelId: 'mdl_vm310',
        siteId: 'sit_ktl_dye',
        tags: ['m5-story'],
      });
    expect(reg.status).toBe(201);
    testDeviceId = reg.body.provisioning.deviceId;
    testDeviceApiKey = reg.body.provisioning.apiKey;

    const hs = await request(app)
      .post('/device/v1/handshake')
      .set('X-Device-Id', testDeviceId)
      .set('X-API-Key', testDeviceApiKey)
      .send({ firmwareVersion: '2.1.0' });
    expect(hs.status).toBe(200);

    // Create a 0-second threshold rule on this device so we can deterministically fire an alert
    const ruleRes = await request(app)
      .post('/api/v1/alert-rules')
      .set('Authorization', `Bearer ${caToken}`)
      .send({
        name: 'M5 Story Overheat Rule',
        kind: 'THRESHOLD',
        metricKey: 'temperature',
        operator: 'GT',
        threshold: 80,
        durationSec: 0,
        severity: 'CRITICAL',
        scopeType: 'DEVICE',
        scopeId: testDeviceId,
        enabled: true,
      });
    expect(ruleRes.status).toBe(201);

    // Trigger an alert via real telemetry ingestion
    const tel = await request(app)
      .post('/device/v1/telemetry')
      .set('X-Device-Id', testDeviceId)
      .set('X-API-Key', testDeviceApiKey)
      .send({
        timestamp: new Date().toISOString(),
        metrics: { temperature: 96.4, vibration_rms: 7.2 },
        health: { cpuLoad: 35, memoryUsage: 42, batteryLevel: null, signalStrength: -58 },
      });
    expect(tel.status).toBe(202);

    const alertsRes = await request(app)
      .get('/api/v1/alerts')
      .set('Authorization', `Bearer ${seToken}`)
      .set('X-Tenant-Id', 'ten_ktl')
      .query({ deviceId: testDeviceId });
    expect(alertsRes.status).toBe(200);
    expect(alertsRes.body.items.length).toBeGreaterThanOrEqual(1);
    storyAlertId = alertsRes.body.items[0].id as string;
  });

  afterAll(() => {
    runtime.simulator.stopAll();
    runtime.backgroundJobs.stop();
    db.close();
  });

  it('executes the full Milestone 5 end-to-end story: Alert -> Ticket -> WO (downtime) -> CM Approve -> FT Start (UNDER_MAINTENANCE + alert suppression) -> FT Complete (ACTIVE + ticket comment) -> SE Resolve -> Client Confirm (closes Ticket AND linked Alert)', async () => {
    // 1. SE converts Alert to Ticket
    const tktRes = await request(app)
      .post(`/api/v1/alerts/${storyAlertId}/ticket`)
      .set('Authorization', `Bearer ${seToken}`)
      .set('X-Tenant-Id', 'ten_ktl')
      .send({});
    expect(tktRes.status).toBe(201);
    expect(tktRes.body.source).toBe('ALERT');
    expect(tktRes.body.priority).toBe('CRITICAL');
    expect(tktRes.body.alertId).toBe(storyAlertId);
    expect(tktRes.body.number).toMatch(/^TKT-\d{4}$/);
    storyTicketId = tktRes.body.id as string;

    // Duplicate conversion on same alert is rejected with 409
    const dupTkt = await request(app)
      .post(`/api/v1/alerts/${storyAlertId}/ticket`)
      .set('Authorization', `Bearer ${seToken}`)
      .set('X-Tenant-Id', 'ten_ktl')
      .send({});
    expect(dupTkt.status).toBe(409);

    // 2. SE creates Work Order from Ticket with downtimeRequired: true (KTL requires maintenance approval)
    const now = Date.now();
    const woRes = await request(app)
      .post('/api/v1/work-orders')
      .set('Authorization', `Bearer ${seToken}`)
      .set('X-Tenant-Id', 'ten_ktl')
      .send({
        deviceId: testDeviceId,
        ticketId: storyTicketId,
        type: 'CORRECTIVE',
        title: 'Replace overheating bearing & recalibrate probe',
        instructions: 'Lock out motor, replace drive-end bearing, verify temperature stabilizes.',
        checklist: [
          { text: 'Lock out & verify zero energy', done: false },
          { text: 'Replace bearing assembly', done: false },
          { text: 'Verify telemetry normal', done: false },
        ],
        assignedTo: tech1Id,
        plannedStart: new Date(now + 15 * 60_000).toISOString(),
        plannedEnd: new Date(now + 90 * 60_000).toISOString(),
        downtimeRequired: true,
      });
    expect(woRes.status).toBe(201);
    expect(woRes.body.status).toBe('ASSIGNED');
    expect(woRes.body.approvalStatus).toBe('PENDING');
    expect(woRes.body.number).toMatch(/^WO-\d{4}$/);
    storyWorkOrderId = woRes.body.id as string;

    // 3. FT cannot start while approvalStatus is PENDING
    const blockedStart = await request(app)
      .post(`/api/v1/work-orders/${storyWorkOrderId}/start`)
      .set('Authorization', `Bearer ${ftToken}`)
      .send({});
    expect(blockedStart.status).toBe(409);
    expect(String(blockedStart.body.error?.message)).toMatch(/approval/i);

    // 4. CM sees it in pending approvals and approves it
    const pendingRes = await request(app)
      .get('/api/v1/work-orders')
      .set('Authorization', `Bearer ${cmToken}`)
      .query({ approvalStatus: 'PENDING' });
    expect(pendingRes.status).toBe(200);
    expect(pendingRes.body.items.some((w: { id: string }) => w.id === storyWorkOrderId)).toBe(true);

    const approveRes = await request(app)
      .post(`/api/v1/work-orders/${storyWorkOrderId}/decision`)
      .set('Authorization', `Bearer ${cmToken}`)
      .send({ decision: 'APPROVED', note: 'Approved for afternoon shift change.' });
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.approvalStatus).toBe('APPROVED');

    // 5. FT starts Work Order -> device automatically transitions to UNDER_MAINTENANCE
    const startRes = await request(app)
      .post(`/api/v1/work-orders/${storyWorkOrderId}/start`)
      .set('Authorization', `Bearer ${ftToken}`)
      .send({});
    expect(startRes.status).toBe(200);
    expect(startRes.body.status).toBe('IN_PROGRESS');
    expect(startRes.body.startedAt).toBeTruthy();

    const devDuring = await request(app)
      .get(`/api/v1/devices/${testDeviceId}`)
      .set('Authorization', `Bearer ${seToken}`)
      .set('X-Tenant-Id', 'ten_ktl');
    expect(devDuring.status).toBe(200);
    expect(devDuring.body.state).toBe('UNDER_MAINTENANCE');

    // Verify alerts are suppressed immediately while UNDER_MAINTENANCE (even if another rule triggers)
    const rule2 = await request(app)
      .post('/api/v1/alert-rules')
      .set('Authorization', `Bearer ${caToken}`)
      .send({
        name: 'M5 Suppression Verification Rule',
        kind: 'THRESHOLD',
        metricKey: 'vibration_rms',
        operator: 'GT',
        threshold: 5,
        durationSec: 0,
        severity: 'CRITICAL',
        scopeType: 'DEVICE',
        scopeId: testDeviceId,
        enabled: true,
      });
    expect(rule2.status).toBe(201);

    const telDuringMaint = await request(app)
      .post('/device/v1/telemetry')
      .set('X-Device-Id', testDeviceId)
      .set('X-API-Key', testDeviceApiKey)
      .send({
        timestamp: new Date().toISOString(),
        metrics: { temperature: 99, vibration_rms: 12.5 },
        health: { cpuLoad: 40, memoryUsage: 45, batteryLevel: null, signalStrength: -59 },
      });
    expect(telDuringMaint.status).toBe(202);

    const alertsDuringMaint = await request(app)
      .get('/api/v1/alerts')
      .set('Authorization', `Bearer ${seToken}`)
      .set('X-Tenant-Id', 'ten_ktl')
      .query({ deviceId: testDeviceId });
    expect(
      alertsDuringMaint.body.items.some(
        (a: { ruleId: string }) => a.ruleId === rule2.body.id,
      ),
    ).toBe(false);

    // FT updates checklist items while in progress
    const currentChecklist = startRes.body.checklist as Array<{ id: string; text: string; done: boolean }>;
    const checkRes = await request(app)
      .patch(`/api/v1/work-orders/${storyWorkOrderId}/checklist`)
      .set('Authorization', `Bearer ${ftToken}`)
      .send({
        checklist: currentChecklist.map((item) => ({ id: item.id, done: true })),
      });
    expect(checkRes.status).toBe(200);
    expect(checkRes.body.checklist.every((c: { done: boolean }) => c.done)).toBe(true);

    // 6. FT completes Work Order -> device transitions back to ACTIVE + system comment posted on ticket
    const completeRes = await request(app)
      .post(`/api/v1/work-orders/${storyWorkOrderId}/complete`)
      .set('Authorization', `Bearer ${ftToken}`)
      .send({
        actionsTaken: 'Replaced worn drive-end bearing and re-torqued housing bolts.',
        partsReplaced: ['SKF 6206-2RS Bearing (x1)'],
        notes: 'Unit tested under load; temperature steady at 48C.',
        timeSpentMin: 55,
        outcome: 'FIXED',
      });
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.status).toBe('COMPLETED');
    expect(completeRes.body.completion.outcome).toBe('FIXED');
    expect(completeRes.body.completion.partsReplaced).toHaveLength(1);

    const devAfter = await request(app)
      .get(`/api/v1/devices/${testDeviceId}`)
      .set('Authorization', `Bearer ${seToken}`)
      .set('X-Tenant-Id', 'ten_ktl');
    expect(devAfter.status).toBe(200);
    expect(devAfter.body.state).toBe('ACTIVE');

    // Verify linked ticket received SYSTEM comment from work order completion
    const ticketAfterWo = await request(app)
      .get(`/api/v1/tickets/${storyTicketId}`)
      .set('Authorization', `Bearer ${seToken}`)
      .set('X-Tenant-Id', 'ten_ktl');
    expect(ticketAfterWo.status).toBe(200);
    expect(
      ticketAfterWo.body.comments.some(
        (c: { authorRole: string; body: string }) =>
          c.authorRole === 'SYSTEM' && c.body.includes(woRes.body.number),
      ),
    ).toBe(true);

    // 7. SE resolves Ticket with rootCause and resolutionNotes
    const resolveRes = await request(app)
      .post(`/api/v1/tickets/${storyTicketId}/resolve`)
      .set('Authorization', `Bearer ${seToken}`)
      .set('X-Tenant-Id', 'ten_ktl')
      .send({
        rootCause: 'Bearing lubrication degradation caused thermal spike.',
        resolutionNotes: 'Bearing replaced on-site via work order; post-repair telemetry nominal.',
      });
    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.status).toBe('RESOLVED');
    expect(resolveRes.body.rootCause).toContain('Bearing');

    // 8. Client Operator confirms resolution -> Ticket becomes CLOSED AND linked Alert becomes CLOSED
    const confirmRes = await request(app)
      .post(`/api/v1/tickets/${storyTicketId}/confirm`)
      .set('Authorization', `Bearer ${coToken}`)
      .send({ note: 'Verified normal operating temperature on shift panel.' });
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.status).toBe('CLOSED');

    const alertAfterConfirm = await request(app)
      .get(`/api/v1/alerts/${storyAlertId}`)
      .set('Authorization', `Bearer ${seToken}`)
      .set('X-Tenant-Id', 'ten_ktl');
    expect(alertAfterConfirm.status).toBe(200);
    expect(alertAfterConfirm.body.status).toBe('CLOSED');
    expect(String(alertAfterConfirm.body.closeReason)).toContain(tktRes.body.number);
  });

  it('supports CM rejection with required note and resets approval to PENDING when SE updates the window', async () => {
    const now = Date.now();
    const woRes = await request(app)
      .post('/api/v1/work-orders')
      .set('Authorization', `Bearer ${seToken}`)
      .set('X-Tenant-Id', 'ten_ktl')
      .send({
        deviceId: testDeviceId,
        type: 'CORRECTIVE',
        title: 'Inspect cable gland seal',
        instructions: 'Check IP67 sealing ring.',
        assignedTo: tech1Id,
        plannedStart: new Date(now + 2 * 3600_000).toISOString(),
        plannedEnd: new Date(now + 3 * 3600_000).toISOString(),
        downtimeRequired: true,
      });
    expect(woRes.status).toBe(201);
    expect(woRes.body.approvalStatus).toBe('PENDING');

    // Rejection without note fails validation (400)
    const badReject = await request(app)
      .post(`/api/v1/work-orders/${woRes.body.id}/decision`)
      .set('Authorization', `Bearer ${cmToken}`)
      .send({ decision: 'REJECTED' });
    expect(badReject.status).toBe(400);

    // Rejection with note succeeds
    const rejectRes = await request(app)
      .post(`/api/v1/work-orders/${woRes.body.id}/decision`)
      .set('Authorization', `Bearer ${cmToken}`)
      .send({ decision: 'REJECTED', note: 'Peak dyeing run scheduled — move to night shift.' });
    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body.approvalStatus).toBe('REJECTED');

    // FT still cannot start rejected WO
    const startBlocked = await request(app)
      .post(`/api/v1/work-orders/${woRes.body.id}/start`)
      .set('Authorization', `Bearer ${ftToken}`)
      .send({});
    expect(startBlocked.status).toBe(409);

    // SE edits planned window -> approval resets to PENDING automatically
    const editRes = await request(app)
      .patch(`/api/v1/work-orders/${woRes.body.id}`)
      .set('Authorization', `Bearer ${seToken}`)
      .set('X-Tenant-Id', 'ten_ktl')
      .send({
        plannedStart: new Date(now + 12 * 3600_000).toISOString(),
        plannedEnd: new Date(now + 13 * 3600_000).toISOString(),
      });
    expect(editRes.status).toBe(200);
    expect(editRes.body.approvalStatus).toBe('PENDING');
  });

  it('allows CO to raise SERVICE_REQUEST, SE to set WAITING_ON_CLIENT, and auto-moves back to IN_PROGRESS on client comment', async () => {
    const srRes = await request(app)
      .post('/api/v1/tickets')
      .set('Authorization', `Bearer ${coToken}`)
      .send({
        title: 'Enclosure gasket inspection request',
        description: 'Noticed moisture beads inside junction box window on Bay 2.',
        priority: 'HIGH',
        source: 'SERVICE_REQUEST',
        deviceId: testDeviceId,
      });
    expect(srRes.status).toBe(201);
    expect(srRes.body.source).toBe('SERVICE_REQUEST');
    expect(srRes.body.status).toBe('OPEN');

    // SE sets status to WAITING_ON_CLIENT
    const waitRes = await request(app)
      .patch(`/api/v1/tickets/${srRes.body.id}`)
      .set('Authorization', `Bearer ${seToken}`)
      .set('X-Tenant-Id', 'ten_ktl')
      .send({ status: 'WAITING_ON_CLIENT' });
    expect(waitRes.status).toBe(200);
    expect(waitRes.body.status).toBe('WAITING_ON_CLIENT');

    // CO posts a comment -> status automatically transitions back to IN_PROGRESS
    const commentRes = await request(app)
      .post(`/api/v1/tickets/${srRes.body.id}/comments`)
      .set('Authorization', `Bearer ${coToken}`)
      .send({ body: 'Confirmed box latch was loose; accessible after 18:00.' });
    expect(commentRes.status).toBe(200);

    const checkTicket = await request(app)
      .get(`/api/v1/tickets/${srRes.body.id}`)
      .set('Authorization', `Bearer ${seToken}`)
      .set('X-Tenant-Id', 'ten_ktl');
    expect(checkTicket.status).toBe(200);
    expect(checkTicket.body.status).toBe('IN_PROGRESS');
  });

  it('generates PREVENTIVE work orders from due Maintenance Plans idempotently and advances nextRunAt', async () => {
    const pastIso = new Date(Date.now() - 60 * 60_000).toISOString();
    const planRes = await request(app)
      .post('/api/v1/maintenance-plans')
      .set('Authorization', `Bearer ${seToken}`)
      .set('X-Tenant-Id', 'ten_ktl')
      .send({
        name: 'M5 Test Due Calibration Plan',
        scopeType: 'DEVICE',
        scopeValue: testDeviceId,
        everyDays: 14,
        nextRunAt: pastIso,
        template: {
          title: 'Scheduled Calibration Check',
          instructions: 'Run calibration verification check.',
          checklist: ['Verify zero offset', 'Log calibration certificate'],
          downtimeRequired: false,
        },
        enabled: true,
      });
    expect(planRes.status).toBe(201);
    const planId = planRes.body.id as string;

    const nowMs = Date.now();
    const run1 = runtime.backgroundJobs.runMaintenancePlannerOnce(nowMs);
    expect(run1.plansExecuted).toBeGreaterThanOrEqual(1);
    expect(run1.workOrdersCreated).toBeGreaterThanOrEqual(1);

    // Second run immediately at same timestamp must be idempotent (0 duplicates)
    const run2 = runtime.backgroundJobs.runMaintenancePlannerOnce(nowMs);
    expect(run2.workOrdersCreated).toBe(0);

    // Confirm plan nextRunAt moved into the future (~14 days ahead)
    const plansAfter = await request(app)
      .get('/api/v1/maintenance-plans')
      .set('Authorization', `Bearer ${seToken}`)
      .set('X-Tenant-Id', 'ten_ktl');
    const updatedPlan = plansAfter.body.items.find((p: { id: string }) => p.id === planId);
    expect(updatedPlan).toBeTruthy();
    expect(Date.parse(updatedPlan.nextRunAt)).toBeGreaterThan(nowMs + 13 * 86_400_000);
  });

  it('enforces tenant isolation (404 across tenants) and RBAC boundaries across tickets, work orders, and plans', async () => {
    // Cross-tenant isolation: MFP Client Admin gets 404 on KTL ticket and KTL work order
    const crossTkt = await request(app)
      .get(`/api/v1/tickets/${storyTicketId}`)
      .set('Authorization', `Bearer ${mfpCaToken}`);
    expect(crossTkt.status).toBe(404);

    const crossWo = await request(app)
      .get(`/api/v1/work-orders/${storyWorkOrderId}`)
      .set('Authorization', `Bearer ${mfpCaToken}`);
    expect(crossWo.status).toBe(404);

    // FT2 (not assigned to storyWorkOrderId) cannot access FT1's work order (403/404)
    const ft2Wo = await request(app)
      .get(`/api/v1/work-orders/${storyWorkOrderId}`)
      .set('Authorization', `Bearer ${ft2Token}`);
    expect([403, 404]).toContain(ft2Wo.status);

    // CO cannot approve a work order (CM-only -> 403)
    const coApprove = await request(app)
      .post(`/api/v1/work-orders/${storyWorkOrderId}/decision`)
      .set('Authorization', `Bearer ${coToken}`)
      .send({ decision: 'APPROVED' });
    expect(coApprove.status).toBe(403);

    // CM cannot start a work order (FT-only -> 403)
    const cmStart = await request(app)
      .post(`/api/v1/work-orders/${storyWorkOrderId}/start`)
      .set('Authorization', `Bearer ${cmToken}`)
      .send({});
    expect(cmStart.status).toBe(403);

    // CA cannot access /maintenance-plans (SE-only -> 403)
    const caPlans = await request(app)
      .get('/api/v1/maintenance-plans')
      .set('Authorization', `Bearer ${caToken}`);
    expect(caPlans.status).toBe(403);
  });
});
