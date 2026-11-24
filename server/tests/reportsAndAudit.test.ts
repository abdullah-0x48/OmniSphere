import type Database from 'better-sqlite3';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type AppRuntime } from '../src/app.ts';
import { createDatabase } from '../src/repositories/db.ts';
import { createRepositories, type Repositories } from '../src/repositories/index.ts';
import { DEMO_PASSWORD } from '../src/seed/seedData.ts';
import { seedAllDemoData } from '../src/seed/seedMilestone2.ts';

describe('Milestone 7 — Test 8: Reports, Section 13 KPI Formulas, Platform Health, Export Audit & Tenant Isolation', () => {
  let db: Database.Database;
  let repos: Repositories;
  let app: Express;
  let runtime: AppRuntime;

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
  });

  describe('1. Fixed-Fixture KPI Formula Accuracy (Section 13 exact math)', () => {
    const T_ID = 'tnt_kpi_fix';
    const SITE_1 = 'site_kpi_1';
    const SITE_2 = 'site_kpi_2';
    const MDL_REL = 'mdl_kpi_rel';
    const MDL_DRAFT = 'mdl_kpi_draft';
    const DEV_A = 'dev_kpi_a';
    const DEV_B = 'dev_kpi_b';
    const DEV_C = 'dev_kpi_c';
    const DEV_D = 'dev_kpi_d';
    const RANGE_FROM = '2026-06-01T00:00:00.000Z';
    const RANGE_TO = '2026-06-01T10:00:00.000Z';

    beforeAll(() => {
      const now = '2026-05-01T00:00:00.000Z';
      // Deterministic tenant, sites, models
      db.prepare(
        `INSERT INTO tenants (id, name, code, status, contact_email, settings_json, created_at, updated_at)
         VALUES (?, ?, ?, 'ACTIVE', 'kpi@example.test', '{}', ?, ?)`,
      ).run(T_ID, 'KPI Fixture Org', 'KFX', now, now);

      db.prepare(
        `INSERT INTO sites (id, tenant_id, name, location, created_at, updated_at)
         VALUES (?, ?, ?, 'Plant 1', ?, ?), (?, ?, ?, 'Plant 2', ?, ?)`,
      ).run(SITE_1, T_ID, 'Alpha Plant', now, now, SITE_2, T_ID, 'Beta Plant', now, now);

      db.prepare(
        `INSERT INTO device_models (id, name, manufacturer, hardware_revision, metrics_json, supported_firmware_family, created_at, updated_at)
         VALUES (?, 'KPI-Sensor-R', 'OmniTest', 'rev1', '[]', 'kfx-r', ?, ?),
                (?, 'KPI-Sensor-D', 'OmniTest', 'rev1', '[]', 'kfx-d', ?, ?)`,
      ).run(MDL_REL, now, now, MDL_DRAFT, now, now);

      // Firmware packages:
      // MDL_REL: 1.9.0 RELEASED (May 1), 2.0.0 RELEASED (May 15), 2.1.0 DRAFT (May 20 - must NOT count!)
      // MDL_DRAFT: 0.9.0 DRAFT only (no RELEASED -> devices excluded from compliance!)
      const sha = 'a'.repeat(64);
      db.prepare(
        `INSERT INTO firmware_packages (id, model_id, version, release_notes, checksum_sha256, size_bytes, file_ref, status, uploaded_by, created_at, updated_at)
         VALUES ('fw_kpi_19', ?, '1.9.0', 'older', ?, 128, 'fw19.bin', 'RELEASED', 'usr_pa', '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z'),
                ('fw_kpi_20', ?, '2.0.0', 'latest released', ?, 128, 'fw20.bin', 'RELEASED', 'usr_pa', '2026-05-15T00:00:00.000Z', '2026-05-15T00:00:00.000Z'),
                ('fw_kpi_21', ?, '2.1.0', 'draft beta', ?, 128, 'fw21.bin', 'DRAFT', 'usr_pa', '2026-05-20T00:00:00.000Z', '2026-05-20T00:00:00.000Z'),
                ('fw_kpi_d09', ?, '0.9.0', 'only draft', ?, 128, 'fwd09.bin', 'DRAFT', 'usr_pa', '2026-05-10T00:00:00.000Z', '2026-05-10T00:00:00.000Z')`,
      ).run(MDL_REL, sha, MDL_REL, sha, MDL_REL, sha, MDL_DRAFT, sha);

      // Devices:
      // DEV_A (SITE_1, MDL_REL): ACTIVE entire range, ONLINE 8h/10h = 80%, fw 2.0.0 (compliant)
      // DEV_B (SITE_2, MDL_REL): ACTIVE 4h, SUSPENDED 2h, UNDER_MAINTENANCE 4h -> denom 8h, ONLINE 6h = 75%, fw 1.9.0 (non-compliant)
      // DEV_C (SITE_1, MDL_REL): DECOMMISSIONED entire range -> excluded from availability AND firmware compliance
      // DEV_D (SITE_2, MDL_DRAFT): ACTIVE entire range, ONLINE 10h/10h = 100%, fw 0.9.0 (model has no RELEASED -> excluded from firmware compliance)
      const insertDev = db.prepare(
        `INSERT INTO devices (id, tenant_id, site_id, model_id, name, serial_number, hardware_id, tags_json, state, connectivity, firmware_version, config_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, '{}', ?, ?)`,
      );
      insertDev.run(DEV_A, T_ID, SITE_1, MDL_REL, 'KPI-Dev-A', 'SN-KFX-A', 'HW-KFX-A', 'ACTIVE', 'OFFLINE', '2.0.0', now, now);
      insertDev.run(DEV_B, T_ID, SITE_2, MDL_REL, 'KPI-Dev-B', 'SN-KFX-B', 'HW-KFX-B', 'UNDER_MAINTENANCE', 'ONLINE', '1.9.0', now, now);
      insertDev.run(DEV_C, T_ID, SITE_1, MDL_REL, 'KPI-Dev-C', 'SN-KFX-C', 'HW-KFX-C', 'DECOMMISSIONED', 'OFFLINE', '1.9.0', now, now);
      insertDev.run(DEV_D, T_ID, SITE_2, MDL_DRAFT, 'KPI-Dev-D', 'SN-KFX-D', 'HW-KFX-D', 'ACTIVE', 'ONLINE', '0.9.0', now, now);

      // Device State History
      const insertState = db.prepare(
        `INSERT INTO device_state_history (id, tenant_id, device_id, from_state, to_state, reason, actor_id, at)
         VALUES (?, ?, ?, ?, ?, 'fixture', 'usr_pa', ?)`,
      );
      insertState.run('dsh_k_a1', T_ID, DEV_A, 'PROVISIONED', 'ACTIVE', '2026-05-10T00:00:00.000Z');
      insertState.run('dsh_k_b1', T_ID, DEV_B, 'PROVISIONED', 'ACTIVE', '2026-05-10T00:00:00.000Z');
      insertState.run('dsh_k_b2', T_ID, DEV_B, 'ACTIVE', 'SUSPENDED', '2026-06-01T04:00:00.000Z');
      insertState.run('dsh_k_b3', T_ID, DEV_B, 'SUSPENDED', 'UNDER_MAINTENANCE', '2026-06-01T06:00:00.000Z');
      insertState.run('dsh_k_c1', T_ID, DEV_C, 'ACTIVE', 'DECOMMISSIONED', '2026-05-20T00:00:00.000Z');
      insertState.run('dsh_k_d1', T_ID, DEV_D, 'PROVISIONED', 'ACTIVE', '2026-05-10T00:00:00.000Z');

      // Connectivity Events
      const insertConn = db.prepare(
        `INSERT INTO connectivity_events (id, tenant_id, device_id, state, at) VALUES (?, ?, ?, ?, ?)`,
      );
      // DEV_A: ONLINE before range, OFFLINE at 08:00 -> 8h / 10h = 80.0%
      insertConn.run('ce_k_a1', T_ID, DEV_A, 'ONLINE', '2026-05-31T23:00:00.000Z');
      insertConn.run('ce_k_a2', T_ID, DEV_A, 'OFFLINE', '2026-06-01T08:00:00.000Z');
      // DEV_B: ONLINE 00:00..04:00 (ACTIVE=4h), OFFLINE 04:00..08:00 (04..06 SUSPENDED, 06..08 UNDER_MAINT), ONLINE 08:00..10:00 (UNDER_MAINT=2h) -> 6h / 8h = 75.0%
      insertConn.run('ce_k_b1', T_ID, DEV_B, 'ONLINE', '2026-05-31T23:00:00.000Z');
      insertConn.run('ce_k_b2', T_ID, DEV_B, 'OFFLINE', '2026-06-01T04:00:00.000Z');
      insertConn.run('ce_k_b3', T_ID, DEV_B, 'ONLINE', '2026-06-01T08:00:00.000Z');
      // DEV_D: ONLINE entire range -> 10h / 10h = 100.0%
      insertConn.run('ce_k_d1', T_ID, DEV_D, 'ONLINE', '2026-05-31T20:00:00.000Z');

      // Alerts: 2 CRITICAL, 2 WARNING inside range + 1 CRITICAL outside range
      const insertAlert = db.prepare(
        `INSERT INTO alerts (id, tenant_id, device_id, rule_id, severity, status, message, created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
      );
      insertAlert.run('al_k_1', T_ID, DEV_A, 'CRITICAL', 'OPEN', 'Crit 1', '2026-06-01T01:00:00.000Z', '2026-06-01T01:00:00.000Z');
      insertAlert.run('al_k_2', T_ID, DEV_B, 'CRITICAL', 'ACKNOWLEDGED', 'Crit 2', '2026-06-01T02:00:00.000Z', '2026-06-01T02:00:00.000Z');
      insertAlert.run('al_k_3', T_ID, DEV_A, 'WARNING', 'CLOSED', 'Warn 1', '2026-06-01T03:00:00.000Z', '2026-06-01T03:00:00.000Z');
      insertAlert.run('al_k_4', T_ID, DEV_D, 'WARNING', 'OPEN', 'Warn 2', '2026-06-01T05:00:00.000Z', '2026-06-01T05:00:00.000Z');
      insertAlert.run('al_k_5', T_ID, DEV_A, 'CRITICAL', 'OPEN', 'Outside range', '2026-05-25T00:00:00.000Z', '2026-05-25T00:00:00.000Z');

      // Tickets:
      // T1: created 00:00, resolved 03:00 (3h), closed 04:00 -> counts in MTTR, NOT open at 10:00
      // T2: created 02:00, resolved 07:00 (5h), status RESOLVED (not closed) -> counts in MTTR, OPEN at 10:00 (CRITICAL)
      // T3: created 01:00, unresolved, status OPEN -> NOT in MTTR, OPEN at 10:00 (HIGH)
      // T4: created May 20, resolved May 21, closed June 01 12:00 (AFTER 10:00!) -> NOT in MTTR, OPEN at 10:00 (MEDIUM)
      const insertTicket = db.prepare(
        `INSERT INTO tickets (id, number, tenant_id, site_id, device_id, source, title, description, priority, status, created_by, created_at, resolved_at, closed_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'INTERNAL', ?, 'desc', ?, ?, 'usr_pa', ?, ?, ?, ?)`,
      );
      insertTicket.run('tkt_k_1', 'TKT-KFX-1', T_ID, SITE_1, DEV_A, 'Resolved & Closed', 'LOW', 'CLOSED', '2026-06-01T00:00:00.000Z', '2026-06-01T03:00:00.000Z', '2026-06-01T04:00:00.000Z', '2026-06-01T04:00:00.000Z');
      insertTicket.run('tkt_k_2', 'TKT-KFX-2', T_ID, SITE_2, DEV_B, 'Resolved not Closed', 'CRITICAL', 'RESOLVED', '2026-06-01T02:00:00.000Z', '2026-06-01T07:00:00.000Z', null, '2026-06-01T07:00:00.000Z');
      insertTicket.run('tkt_k_3', 'TKT-KFX-3', T_ID, SITE_1, DEV_A, 'Still Open', 'HIGH', 'OPEN', '2026-06-01T01:00:00.000Z', null, null, '2026-06-01T01:00:00.000Z');
      insertTicket.run('tkt_k_4', 'TKT-KFX-4', T_ID, SITE_2, DEV_D, 'Closed After Range', 'MEDIUM', 'CLOSED', '2026-05-20T00:00:00.000Z', '2026-05-21T00:00:00.000Z', '2026-06-01T12:00:00.000Z', '2026-06-01T12:00:00.000Z');

      // Work Orders:
      // WO1: planned 01:00, COMPLETED
      // WO2: planned 03:00, COMPLETED
      // WO3: planned 05:00, PLANNED
      // WO4: planned 06:00, CANCELLED (excluded from denominator)
      // WO5: planned May 20, COMPLETED (outside range)
      const insertWo = db.prepare(
        `INSERT INTO work_orders (id, number, tenant_id, device_id, type, title, instructions, status, approval_status, planned_start, completed_at, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'Inspect and verify', ?, 'APPROVED', ?, ?, 'usr_pa', ?, ?)`,
      );
      insertWo.run('wo_k_1', 'WO-KFX-1', T_ID, DEV_A, 'PREVENTIVE', 'PM 1', 'COMPLETED', '2026-06-01T01:00:00.000Z', '2026-06-01T02:00:00.000Z', now, now);
      insertWo.run('wo_k_2', 'WO-KFX-2', T_ID, DEV_B, 'CORRECTIVE', 'CM 1', 'COMPLETED', '2026-06-01T03:00:00.000Z', '2026-06-01T04:00:00.000Z', now, now);
      insertWo.run('wo_k_3', 'WO-KFX-3', T_ID, DEV_A, 'PREVENTIVE', 'PM 2', 'PLANNED', '2026-06-01T05:00:00.000Z', null, now, now);
      insertWo.run('wo_k_4', 'WO-KFX-4', T_ID, DEV_B, 'PREVENTIVE', 'PM Cancelled', 'CANCELLED', '2026-06-01T06:00:00.000Z', null, now, now);
      insertWo.run('wo_k_5', 'WO-KFX-5', T_ID, DEV_A, 'PREVENTIVE', 'PM Outside', 'COMPLETED', '2026-05-20T01:00:00.000Z', '2026-05-20T02:00:00.000Z', now, now);
    });

    it('computes exact Availability %, MTTR, Alerts, Open Tickets, Firmware Compliance %, and Maintenance Completion Rate on fixed fixtures', async () => {
      const q = { tenantId: T_ID, from: RANGE_FROM, to: RANGE_TO };

      // 1) KPIs endpoint
      const kpiRes = await request(app)
        .get('/api/v1/reports/kpis')
        .set('Authorization', `Bearer ${paToken}`)
        .query(q);
      expect(kpiRes.status).toBe(200);

      // Availability: mean(80.0, 75.0, 100.0) = 255 / 3 = 85.0% (DEV_C DECOMMISSIONED excluded)
      expect(kpiRes.body.availabilityDeviceCount).toBe(3);
      expect(kpiRes.body.availabilityPct).toBe(85);

      // MTTR: mean(3h, 5h) = 4.0h
      expect(kpiRes.body.resolvedTicketsInRange).toBe(2);
      expect(kpiRes.body.mttrHours).toBe(4);

      // Alerts: 2 CRITICAL, 2 WARNING = 4 total
      expect(kpiRes.body.alertsTotal).toBe(4);
      expect(kpiRes.body.alertsBySeverity).toEqual({ CRITICAL: 2, WARNING: 2 });

      // Open tickets at range end: T2 (CRITICAL), T3 (HIGH), T4 (MEDIUM) = 3 total
      expect(kpiRes.body.openTicketsTotal).toBe(3);
      expect(kpiRes.body.openTicketsByPriority).toEqual({
        CRITICAL: 1,
        HIGH: 1,
        MEDIUM: 1,
        LOW: 0,
      });

      // Firmware compliance: DEV_A (2.0.0) compliant, DEV_B (1.9.0) non-compliant; DEV_C decommissioned excluded; DEV_D model has no RELEASED -> 1/2 = 50.0%
      expect(kpiRes.body.firmwareEligibleCount).toBe(2);
      expect(kpiRes.body.firmwareCompliantCount).toBe(1);
      expect(kpiRes.body.firmwareCompliancePct).toBe(50);

      // Maintenance completion: 2 COMPLETED / (4 in-range - 1 CANCELLED = 3) = 66.7%
      expect(kpiRes.body.maintenanceCompletedCount).toBe(2);
      expect(kpiRes.body.maintenancePlannedCount).toBe(3);
      expect(kpiRes.body.maintenanceCompletionRatePct).toBe(66.7);

      // 2) Availability breakdown per site & per model
      const availRes = await request(app)
        .get('/api/v1/reports/availability')
        .set('Authorization', `Bearer ${paToken}`)
        .query(q);
      expect(availRes.status).toBe(200);
      expect(availRes.body.fleetAvailabilityPct).toBe(85);
      expect(availRes.body.eligibleDevices).toBe(3);
      expect(availRes.body.bySite).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Alpha Plant', availabilityPct: 80, eligibleDeviceCount: 1 }),
          expect.objectContaining({ name: 'Beta Plant', availabilityPct: 87.5, eligibleDeviceCount: 2 }),
        ]),
      );
      expect(availRes.body.byModel).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'KPI-Sensor-R', availabilityPct: 77.5, eligibleDeviceCount: 2 }),
          expect.objectContaining({ name: 'KPI-Sensor-D', availabilityPct: 100, eligibleDeviceCount: 1 }),
        ]),
      );

      // 3) Alerts report with daily trend
      const alertsRes = await request(app)
        .get('/api/v1/reports/alerts')
        .set('Authorization', `Bearer ${paToken}`)
        .query(q);
      expect(alertsRes.status).toBe(200);
      expect(alertsRes.body.total).toBe(4);
      expect(alertsRes.body.dailyTrend).toEqual([
        { date: '2026-06-01', CRITICAL: 2, WARNING: 2, total: 4 },
      ]);

      // 4) Tickets report
      const ticketsRes = await request(app)
        .get('/api/v1/reports/tickets')
        .set('Authorization', `Bearer ${paToken}`)
        .query(q);
      expect(ticketsRes.status).toBe(200);
      expect(ticketsRes.body.mttrHours).toBe(4);
      expect(ticketsRes.body.openAtRangeEndCount).toBe(3);

      // 5) Firmware compliance report & non-compliant devices list
      const fwRes = await request(app)
        .get('/api/v1/reports/firmware-compliance')
        .set('Authorization', `Bearer ${paToken}`)
        .query(q);
      expect(fwRes.status).toBe(200);
      expect(fwRes.body.compliancePct).toBe(50);
      expect(fwRes.body.nonCompliantDevices).toHaveLength(1);
      expect(fwRes.body.nonCompliantDevices[0]).toMatchObject({
        deviceId: DEV_B,
        deviceName: 'KPI-Dev-B',
        currentVersion: '1.9.0',
        latestReleasedVersion: '2.0.0',
      });

      // 6) Maintenance report
      const maintRes = await request(app)
        .get('/api/v1/reports/maintenance')
        .set('Authorization', `Bearer ${paToken}`)
        .query(q);
      expect(maintRes.status).toBe(200);
      expect(maintRes.body.completionRatePct).toBe(66.7);
      expect(maintRes.body.cancelledCount).toBe(1);
      expect(maintRes.body.plannedNonCancelledCount).toBe(3);

      // 7) Filter by siteId narrows KPIs cleanly (Alpha Plant has only DEV_A eligible -> 80% availability, 100% firmware compliance)
      const siteFilterRes = await request(app)
        .get('/api/v1/reports/kpis')
        .set('Authorization', `Bearer ${paToken}`)
        .query({ ...q, siteId: SITE_1 });
      expect(siteFilterRes.status).toBe(200);
      expect(siteFilterRes.body.availabilityPct).toBe(80);
      expect(siteFilterRes.body.firmwareCompliancePct).toBe(100);
    });
  });

  describe('2. Live KPI Recomputation on Seeded Fleet', () => {
    it('recomputes KTL KPIs immediately when an open ticket is resolved and a new alert is triggered', async () => {
      const before = await request(app)
        .get('/api/v1/reports/kpis')
        .set('Authorization', `Bearer ${ktlCaToken}`);
      expect(before.status).toBe(200);
      const initialAlertsTotal = before.body.alertsTotal as number;
      const initialResolved = before.body.resolvedTicketsInRange as number;

      // Fetch KTL site and TH-200 model dynamically
      const sitesRes = await request(app)
        .get('/api/v1/sites')
        .set('Authorization', `Bearer ${ktlCaToken}`);
      expect(sitesRes.status).toBe(200);
      const ktlSiteId = sitesRes.body.items[0].id as string;

      // Create and resolve a new KTL ticket -> resolvedTicketsInRange increases by 1
      const createTkt = await request(app)
        .post('/api/v1/tickets')
        .set('Authorization', `Bearer ${ktlCaToken}`)
        .send({
          title: 'Live KPI recompute check',
          description: 'Verifying live MTTR recomputation in Test 8',
          priority: 'HIGH',
          siteId: ktlSiteId,
        });
      expect(createTkt.status).toBe(201);
      const tktId = createTkt.body.id as string;

      // SE resolves the ticket via POST /resolve
      const resolveTkt = await request(app)
        .post(`/api/v1/tickets/${tktId}/resolve`)
        .set('Authorization', `Bearer ${seToken}`)
        .set('X-Tenant-Id', 'ten_ktl')
        .send({
          rootCause: 'Calibration drift detected during Test 8',
          resolutionNotes: 'Recalibrated sensor remotely and verified readings',
        });
      expect(resolveTkt.status).toBe(200);

      // Register a live KTL TH-200 device and send high temperature telemetry (triggers KTL alert rule immediately)
      const regDev = await request(app)
        .post('/api/v1/devices')
        .set('Authorization', `Bearer ${ktlCaToken}`)
        .send({
          name: 'KPI-Live-TH200',
          serialNumber: 'SN-KPI-LIVE-01',
          hardwareId: 'HW-KPI-LIVE-01',
          modelId: 'mdl_th200',
          siteId: ktlSiteId,
        });
      expect(regDev.status).toBe(201);
      const { deviceId, apiKey } = regDev.body.provisioning as { deviceId: string; apiKey: string };

      const hs = await request(app)
        .post('/device/v1/handshake')
        .set('X-Device-Id', deviceId)
        .set('X-API-Key', apiKey)
        .send({ firmwareVersion: '2.1.0' });
      expect(hs.status).toBe(200);

      // Create an immediate (0s duration) threshold alert rule on this device so telemetry triggers an alert right away
      const ruleRes = await request(app)
        .post('/api/v1/alert-rules')
        .set('Authorization', `Bearer ${ktlCaToken}`)
        .send({
          name: 'KPI Live High Temp Test Rule',
          kind: 'THRESHOLD',
          metricKey: 'temperature',
          operator: 'GT',
          threshold: 40,
          durationSec: 0,
          severity: 'CRITICAL',
          scopeType: 'DEVICE',
          scopeId: deviceId,
          recipients: [{ type: 'ROLE', role: 'CLIENT_ADMIN' }],
          enabled: true,
        });
      expect(ruleRes.status).toBe(201);

      const tel = await request(app)
        .post('/device/v1/telemetry')
        .set('X-Device-Id', deviceId)
        .set('X-API-Key', apiKey)
        .send({ timestamp: new Date().toISOString(), metrics: { temperature: 58.2, humidity: 45 } });
      expect(tel.status).toBe(202);

      const after = await request(app)
        .get('/api/v1/reports/kpis')
        .set('Authorization', `Bearer ${ktlCaToken}`);
      expect(after.status).toBe(200);
      expect(after.body.resolvedTicketsInRange).toBe(initialResolved + 1);
      expect(after.body.alertsTotal).toBeGreaterThan(initialAlertsTotal);
    });
  });

  describe('3. RBAC Matrix, Cross-Tenant Isolation, Export Audit & Platform Health', () => {
    it('enforces exact RBAC rules across all 6 roles on /api/v1/reports/*', async () => {
      // FT is blocked from all report endpoints (403)
      for (const ep of [
        '/api/v1/reports/kpis',
        '/api/v1/reports/availability',
        '/api/v1/reports/alerts',
        '/api/v1/reports/tickets',
        '/api/v1/reports/firmware-compliance',
        '/api/v1/reports/maintenance',
        '/api/v1/reports/platform-health',
      ]) {
        const res = await request(app).get(ep).set('Authorization', `Bearer ${ftToken}`);
        expect(res.status, `FT on ${ep}`).toBe(403);
      }
      const ftExport = await request(app)
        .post('/api/v1/reports/export-audit')
        .set('Authorization', `Bearer ${ftToken}`)
        .send({ format: 'CSV', reportType: 'availability', from: '2026-06-01', to: '2026-06-02' });
      expect(ftExport.status).toBe(403);

      // CO has operational reports ONLY (200 on kpis/availability/alerts/tickets/export-audit; 403 on firmware-compliance/maintenance/platform-health)
      for (const ep of [
        '/api/v1/reports/kpis',
        '/api/v1/reports/availability',
        '/api/v1/reports/alerts',
        '/api/v1/reports/tickets',
      ]) {
        const res = await request(app).get(ep).set('Authorization', `Bearer ${ktlCoToken}`);
        expect(res.status, `CO on ${ep}`).toBe(200);
      }
      for (const ep of [
        '/api/v1/reports/firmware-compliance',
        '/api/v1/reports/maintenance',
        '/api/v1/reports/platform-health',
      ]) {
        const res = await request(app).get(ep).set('Authorization', `Bearer ${ktlCoToken}`);
        expect(res.status, `CO on ${ep}`).toBe(403);
      }

      // CA, CM, SE can access firmware-compliance and maintenance, but NOT platform-health (PA-only)
      for (const [label, tok] of [
        ['CA', ktlCaToken],
        ['CM', ktlCmToken],
        ['SE', seToken],
      ] as const) {
        const fw = await request(app)
          .get('/api/v1/reports/firmware-compliance')
          .set('Authorization', `Bearer ${tok}`);
        expect(fw.status, `${label} firmware-compliance`).toBe(200);
        const maint = await request(app)
          .get('/api/v1/reports/maintenance')
          .set('Authorization', `Bearer ${tok}`);
        expect(maint.status, `${label} maintenance`).toBe(200);
        const ph = await request(app)
          .get('/api/v1/reports/platform-health')
          .set('Authorization', `Bearer ${tok}`);
        expect(ph.status, `${label} platform-health`).toBe(403);
      }
    });

    it('blocks cross-tenant queries on reports and isolates REPORT_EXPORTED audit logs per tenant', async () => {
      // KTL CA cannot query MFP tenantId or MFP siteId
      const crossTenant = await request(app)
        .get('/api/v1/reports/kpis')
        .set('Authorization', `Bearer ${ktlCaToken}`)
        .query({ tenantId: 'ten_mfp' });
      expect(crossTenant.status).toBe(404);

      const mfpSites = await request(app)
        .get('/api/v1/sites')
        .set('Authorization', `Bearer ${mfpCaToken}`);
      expect(mfpSites.status).toBe(200);
      const mfpSiteId = mfpSites.body.items[0].id as string;

      const crossSite = await request(app)
        .get('/api/v1/reports/availability')
        .set('Authorization', `Bearer ${ktlCaToken}`)
        .query({ siteId: mfpSiteId });
      expect(crossSite.status).toBe(404);

      // KTL CA records CSV & PDF exports
      const csvAudit = await request(app)
        .post('/api/v1/reports/export-audit')
        .set('Authorization', `Bearer ${ktlCaToken}`)
        .send({
          format: 'CSV',
          reportType: 'availability',
          from: '2026-06-01T00:00:00.000Z',
          to: '2026-06-08T00:00:00.000Z',
          rowCount: 15,
        });
      expect(csvAudit.status).toBe(201);
      expect(csvAudit.body.ok).toBe(true);
      expect(csvAudit.body.auditId).toBeTruthy();

      const pdfAudit = await request(app)
        .post('/api/v1/reports/export-audit')
        .set('Authorization', `Bearer ${ktlCaToken}`)
        .send({
          format: 'PDF',
          reportType: 'firmware-compliance',
          from: '2026-06-01T00:00:00.000Z',
          to: '2026-06-08T00:00:00.000Z',
          rowCount: 4,
        });
      expect(pdfAudit.status).toBe(201);

      // KTL CA sees ONLY KTL audit entries (and both REPORT_EXPORTED rows)
      const ktlAudit = await request(app)
        .get('/api/v1/audit')
        .set('Authorization', `Bearer ${ktlCaToken}`)
        .query({ action: 'REPORT_EXPORTED', targetType: 'REPORT' });
      expect(ktlAudit.status).toBe(200);
      expect(ktlAudit.body.items.length).toBeGreaterThanOrEqual(2);
      for (const entry of ktlAudit.body.items) {
        expect(entry.tenantId).toBe('ten_ktl');
        expect(entry.action).toBe('REPORT_EXPORTED');
        expect(entry.targetType).toBe('REPORT');
      }

      // MFP CA sees ZERO KTL export audit entries
      const mfpAudit = await request(app)
        .get('/api/v1/audit')
        .set('Authorization', `Bearer ${mfpCaToken}`)
        .query({ action: 'REPORT_EXPORTED' });
      expect(mfpAudit.status).toBe(200);
      for (const entry of mfpAudit.body.items) {
        expect(entry.tenantId).toBe('ten_mfp');
      }
    });

    it('returns full PA Platform Health telemetry including messages/min, invalid payload rate, firmware packages, email outbox, and tenant breakdown', async () => {
      const ph = await request(app)
        .get('/api/v1/reports/platform-health')
        .set('Authorization', `Bearer ${paToken}`);
      expect(ph.status).toBe(200);
      expect(ph.body.tenants.total).toBeGreaterThanOrEqual(3);
      expect(ph.body.devicesTotal).toBeGreaterThan(0);
      expect(ph.body.devicesByState).toHaveProperty('ACTIVE');
      expect(typeof ph.body.messagesPerMinute).toBe('number');
      expect(typeof ph.body.invalidPayloadRate).toBe('number');
      expect(ph.body.messagesLastHour).toBeGreaterThanOrEqual(1); // from telemetry sent in test 2
      expect(ph.body.firmwarePackages.total).toBeGreaterThanOrEqual(1);
      expect(ph.body.emailOutbox).toEqual(
        expect.objectContaining({
          queued: expect.any(Number),
          sent: expect.any(Number),
          failed: expect.any(Number),
        }),
      );
      expect(ph.body.tenantBreakdown.length).toBeGreaterThanOrEqual(3);
      expect(ph.body.tenantBreakdown).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'KTL', name: 'Karnaphuli Textiles Ltd' }),
          expect.objectContaining({ code: 'MFP', name: 'Meghna Food Processing' }),
          expect.objectContaining({ code: 'SCW' }),
        ]),
      );
    });
  });
});
