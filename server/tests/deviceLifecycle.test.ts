import type Database from 'better-sqlite3';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_DEVICE_STATES, type DeviceLifecycleState } from '../../shared/types.ts';
import { createApp } from '../src/app.ts';
import { createDatabase } from '../src/repositories/db.ts';
import { createRepositories, type Repositories } from '../src/repositories/index.ts';
import { DEMO_PASSWORD } from '../src/seed/seedData.ts';
import { seedAllDemoData } from '../src/seed/seedMilestone2.ts';
import {
  generateDeviceApiKey,
  getAllowedTransitionsForActor,
  validateLifecycleTransition,
  verifyDeviceApiKey,
} from '../src/services/deviceLifecycle.ts';

describe('Test 3: Device Lifecycle State Machine & Milestone 2 Acceptance Flows', () => {
  describe('Pure state machine (Section 5.1 exhaustive 5x5 matrix)', () => {
    const expectedCA: Record<DeviceLifecycleState, DeviceLifecycleState[]> = {
      PROVISIONED: ['DECOMMISSIONED'],
      ACTIVE: ['UNDER_MAINTENANCE', 'SUSPENDED', 'DECOMMISSIONED'],
      UNDER_MAINTENANCE: ['ACTIVE', 'DECOMMISSIONED'],
      SUSPENDED: ['ACTIVE', 'DECOMMISSIONED'],
      DECOMMISSIONED: [],
    };

    const expectedSE: Record<DeviceLifecycleState, DeviceLifecycleState[]> = {
      PROVISIONED: [],
      ACTIVE: ['UNDER_MAINTENANCE', 'SUSPENDED'],
      UNDER_MAINTENANCE: ['ACTIVE'],
      SUSPENDED: ['ACTIVE'],
      DECOMMISSIONED: [],
    };

    const expectedSystem: Record<DeviceLifecycleState, DeviceLifecycleState[]> = {
      PROVISIONED: ['ACTIVE'],
      ACTIVE: ['UNDER_MAINTENANCE'],
      UNDER_MAINTENANCE: ['ACTIVE'],
      SUSPENDED: [],
      DECOMMISSIONED: [],
    };

    it('enforces every allowed and forbidden transition for CLIENT_ADMIN', () => {
      for (const from of ALL_DEVICE_STATES) {
        expect(getAllowedTransitionsForActor(from, 'CLIENT_ADMIN')).toEqual(expectedCA[from]);
        for (const to of ALL_DEVICE_STATES) {
          const allowed = expectedCA[from].includes(to);
          if (allowed) {
            const res = validateLifecycleTransition({
              from,
              to,
              actorRole: 'CLIENT_ADMIN',
              reason: 'Operational reason',
            });
            expect(res.targetState).toBe(to);
          } else {
            expect(() =>
              validateLifecycleTransition({
                from,
                to,
                actorRole: 'CLIENT_ADMIN',
                reason: 'Operational reason',
              }),
            ).toThrow();
          }
        }
      }
    });

    it('enforces every allowed and forbidden transition for SUPPORT_ENGINEER (cannot decommission)', () => {
      for (const from of ALL_DEVICE_STATES) {
        expect(getAllowedTransitionsForActor(from, 'SUPPORT_ENGINEER')).toEqual(expectedSE[from]);
        for (const to of ALL_DEVICE_STATES) {
          const allowed = expectedSE[from].includes(to);
          if (allowed) {
            const res = validateLifecycleTransition({
              from,
              to,
              actorRole: 'SUPPORT_ENGINEER',
              reason: 'NOC action',
            });
            expect(res.targetState).toBe(to);
          } else {
            expect(() =>
              validateLifecycleTransition({
                from,
                to,
                actorRole: 'SUPPORT_ENGINEER',
                reason: 'NOC action',
              }),
            ).toThrow();
          }
        }
      }
    });

    it('allows SYSTEM to activate PROVISIONED devices and toggle UNDER_MAINTENANCE', () => {
      for (const from of ALL_DEVICE_STATES) {
        expect(getAllowedTransitionsForActor(from, 'SYSTEM')).toEqual(expectedSystem[from]);
      }
      expect(
        validateLifecycleTransition({
          from: 'PROVISIONED',
          to: 'ACTIVE',
          actorRole: 'SYSTEM',
        }).targetState,
      ).toBe('ACTIVE');
    });

    it('requires a non-empty reason for SUSPEND and DECOMMISSION', () => {
      expect(() =>
        validateLifecycleTransition({
          from: 'ACTIVE',
          action: 'SUSPEND',
          to: 'SUSPENDED',
          actorRole: 'CLIENT_ADMIN',
          reason: '   ',
        }),
      ).toThrow(/reason is required/i);

      expect(() =>
        validateLifecycleTransition({
          from: 'ACTIVE',
          action: 'DECOMMISSION',
          to: 'DECOMMISSIONED',
          actorRole: 'CLIENT_ADMIN',
          reason: '',
        }),
      ).toThrow(/reason is required/i);
    });

    it('generates omk_ API keys and verifies SHA-256 hashes in constant time', () => {
      const { apiKey, apiKeyHash, apiKeyLast4 } = generateDeviceApiKey();
      expect(apiKey.startsWith('omk_')).toBe(true);
      expect(apiKey.length).toBeGreaterThan(40);
      expect(apiKeyLast4).toBe(apiKey.slice(-4));
      expect(verifyDeviceApiKey(apiKey, apiKeyHash)).toBe(true);
      expect(verifyDeviceApiKey(`${apiKey}x`, apiKeyHash)).toBe(false);
      expect(verifyDeviceApiKey(apiKey, null)).toBe(false);
    });
  });

  describe('Milestone 2 End-to-End API Acceptance Suite', () => {
    let db: Database.Database;
    let repos: Repositories;
    let app: Express;
    let paToken: string;
    let seToken: string;
    let caToken: string;
    let mfpCaToken: string;

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

      paToken = await signIn('admin@omnisphere.demo');
      seToken = await signIn('noc1@omnisphere.demo');
      caToken = await signIn('admin.ktl@omnisphere.demo');
      mfpCaToken = await signIn('admin.mfp@omnisphere.demo');
    });

    afterAll(() => {
      db.close();
    });

    it('Acceptance #1 & #2: register device, return one-time provisioning JSON, and reject duplicate serial/hardwareId with 409', async () => {
      const regRes = await request(app)
        .post('/api/v1/devices')
        .set('Authorization', `Bearer ${caToken}`)
        .send({
          name: 'KTL-DYE-TH-901',
          serialNumber: 'SN-KTL-TEST-901',
          hardwareId: 'AA:BB:CC:DD:EE:01',
          modelId: 'mdl_th200',
          siteId: 'sit_ktl_dye',
          tags: ['critical', 'pilot'],
        });

      expect(regRes.status).toBe(201);
      expect(regRes.body.device.state).toBe('PROVISIONED');
      expect(regRes.body.device.apiKeyHash).toBeUndefined();
      expect(regRes.body.provisioning.deviceId).toBe(regRes.body.device.id);
      expect(regRes.body.provisioning.apiKey).toMatch(/^omk_/);
      expect(regRes.body.provisioning.tenantCode).toBe('KTL');
      expect(regRes.body.device.apiKeyLast4).toBe(regRes.body.provisioning.apiKey.slice(-4));

      // Duplicate serial (even case-insensitive and from another tenant!) returns 409 naming serialNumber
      const dupSerial = await request(app)
        .post('/api/v1/devices')
        .set('Authorization', `Bearer ${mfpCaToken}`)
        .send({
          name: 'MFP-DUP-01',
          serialNumber: 'sn-ktl-test-901',
          hardwareId: 'AA:BB:CC:DD:EE:99',
          modelId: 'mdl_th200',
          siteId: 'sit_mfp_cld',
        });
      expect(dupSerial.status).toBe(409);
      expect(dupSerial.body.error.code).toBe('CONFLICT');
      expect(dupSerial.body.error.message).toMatch(/serial/i);
      expect(dupSerial.body.error.details.field).toBe('serialNumber');

      // Duplicate hardwareId returns 409 naming hardwareId
      const dupHw = await request(app)
        .post('/api/v1/devices')
        .set('Authorization', `Bearer ${caToken}`)
        .send({
          name: 'KTL-DUP-HW',
          serialNumber: 'SN-KTL-TEST-902',
          hardwareId: 'aa:bb:cc:dd:ee:01',
          modelId: 'mdl_th200',
          siteId: 'sit_ktl_dye',
        });
      expect(dupHw.status).toBe(409);
      expect(dupHw.body.error.details.field).toBe('hardwareId');
    });

    it('Acceptance #3: CSV import dryRun reports row errors, then commit creates valid rows with provisioning list', async () => {
      const payload = {
        rows: [
          {
            rowNumber: 1,
            serialNumber: 'SN-CSV-VALID-01',
            hardwareId: '11:22:33:44:55:01',
            model: 'TH-200 Temperature and Humidity Sensor',
            site: 'Dyeing Plant',
            tags: 'line-1,csv-batch',
            name: 'KTL-CSV-01',
          },
          {
            rowNumber: 2,
            serialNumber: 'SN-KTL-TEST-901', // duplicate of existing
            hardwareId: '11:22:33:44:55:02',
            model: 'NO-SUCH-MODEL',
            site: 'Nonexistent Site',
            tags: '',
            name: 'KTL-CSV-BAD',
          },
        ],
      };

      const dryRes = await request(app)
        .post('/api/v1/devices/import?dryRun=true')
        .set('Authorization', `Bearer ${caToken}`)
        .send(payload);
      expect(dryRes.status).toBe(200);
      expect(dryRes.body.dryRun).toBe(true);
      expect(dryRes.body.validCount).toBe(1);
      expect(dryRes.body.errorCount).toBe(1);
      expect(dryRes.body.createdCount).toBe(0);
      expect(dryRes.body.rows[1].errors.length).toBeGreaterThanOrEqual(3);

      // Commit creates valid row even though row 2 has errors
      const commitRes = await request(app)
        .post('/api/v1/devices/import?dryRun=false')
        .set('Authorization', `Bearer ${caToken}`)
        .send(payload);
      expect(commitRes.status).toBe(201);
      expect(commitRes.body.createdCount).toBe(1);
      expect(commitRes.body.errorCount).toBe(1);
      expect(commitRes.body.provisioningFiles).toHaveLength(1);
      expect(commitRes.body.provisioningFiles[0].apiKey).toMatch(/^omk_/);
    });

    it('Acceptance #4: inventory search, filters, and bulk add-tag work accurately', async () => {
      const searchRes = await request(app)
        .get('/api/v1/devices?q=KTL-CSV-01&tag=csv-batch&state=PROVISIONED')
        .set('Authorization', `Bearer ${caToken}`);
      expect(searchRes.status).toBe(200);
      expect(searchRes.body.items).toHaveLength(1);
      expect(searchRes.body.items[0].name).toBe('KTL-CSV-01');

      const bulkRes = await request(app)
        .post('/api/v1/devices/bulk')
        .set('Authorization', `Bearer ${caToken}`)
        .send({
          deviceIds: [searchRes.body.items[0].id],
          action: 'ADD_TAG',
          tag: 'verified-batch',
        });
      expect(bulkRes.status).toBe(200);
      expect(bulkRes.body.succeededCount).toBe(1);
    });

    it('Acceptance #5, #6 & #7: suspend -> resume, regenerate key, invalid transition 409, and CA-only decommission revokes key', async () => {
      // Seeded KTL ACTIVE device: dev_ktl_001
      const suspendRes = await request(app)
        .post('/api/v1/devices/dev_ktl_001/state')
        .set('Authorization', `Bearer ${seToken}`)
        .set('X-Tenant-Id', 'ten_ktl')
        .send({ action: 'SUSPEND', reason: 'Inspecting thermal drift' });
      expect(suspendRes.status).toBe(200);
      expect(suspendRes.body.state).toBe('SUSPENDED');

      // Invalid transition: SUSPENDED -> UNDER_MAINTENANCE returns 409 with allowedTransitions
      const invalidRes = await request(app)
        .post('/api/v1/devices/dev_ktl_001/state')
        .set('Authorization', `Bearer ${caToken}`)
        .send({ action: 'SET_UNDER_MAINTENANCE' });
      expect(invalidRes.status).toBe(409);
      expect(invalidRes.body.error.code).toBe('INVALID_TRANSITION');
      expect(invalidRes.body.error.details.allowedTransitions).toContain('ACTIVE');

      // Resume back to ACTIVE
      const resumeRes = await request(app)
        .post('/api/v1/devices/dev_ktl_001/state')
        .set('Authorization', `Bearer ${caToken}`)
        .send({ action: 'RESUME' });
      expect(resumeRes.status).toBe(200);
      expect(resumeRes.body.state).toBe('ACTIVE');

      // Regenerate key changes apiKeyLast4
      const regenRes = await request(app)
        .post('/api/v1/devices/dev_ktl_001/regenerate-key')
        .set('Authorization', `Bearer ${caToken}`);
      expect(regenRes.status).toBe(200);
      expect(regenRes.body.provisioning.apiKey).toMatch(/^omk_/);

      // SE cannot decommission (403)
      const seDecomm = await request(app)
        .post('/api/v1/devices/dev_ktl_002/state')
        .set('Authorization', `Bearer ${seToken}`)
        .set('X-Tenant-Id', 'ten_ktl')
        .send({ action: 'DECOMMISSION', reason: 'SE attempt' });
      expect(seDecomm.status).toBe(403);

      // CA decommissions dev_ktl_002 -> terminal state, key revoked
      const caDecomm = await request(app)
        .post('/api/v1/devices/dev_ktl_002/state')
        .set('Authorization', `Bearer ${caToken}`)
        .send({ action: 'DECOMMISSION', reason: 'Hardware retired permanently' });
      expect(caDecomm.status).toBe(200);
      expect(caDecomm.body.state).toBe('DECOMMISSIONED');
      expect(caDecomm.body.apiKeyLast4).toBeNull();
      expect(caDecomm.body.allowedTransitions).toEqual([]);

      // Verify apiKeyHash cleared in DB
      const rawRecord = repos.devices.findById(
        {
          userId: 'usr_ktl_ca',
          role: 'CLIENT_ADMIN',
          allTenants: false,
          tenantIds: ['ten_ktl'],
          activeTenantId: 'ten_ktl',
        },
        'dev_ktl_002',
      );
      expect(rawRecord?.apiKeyHash).toBeNull();

      // Any further transition or edit on DECOMMISSIONED returns 409
      const afterDecomm = await request(app)
        .post('/api/v1/devices/dev_ktl_002/state')
        .set('Authorization', `Bearer ${caToken}`)
        .send({ action: 'RESUME' });
      expect(afterDecomm.status).toBe(409);

      const editDecomm = await request(app)
        .patch('/api/v1/devices/dev_ktl_002')
        .set('Authorization', `Bearer ${caToken}`)
        .send({ name: 'Should Fail' });
      expect(editDecomm.status).toBe(409);

      // Timeline includes state transitions
      const timelineRes = await request(app)
        .get('/api/v1/devices/dev_ktl_002/history')
        .set('Authorization', `Bearer ${caToken}`);
      expect(timelineRes.status).toBe(200);
      expect(timelineRes.body.items.length).toBeGreaterThanOrEqual(2);
    });

    it('Sites delete is blocked with 409 when devices exist, and allowed when empty; Device models support metric editor', async () => {
      // Seeded Dyeing Plant has devices -> delete blocked with 409
      const blockedDel = await request(app)
        .delete('/api/v1/sites/sit_ktl_dye')
        .set('Authorization', `Bearer ${caToken}`);
      expect(blockedDel.status).toBe(409);

      // Create and delete an empty site
      const createSite = await request(app)
        .post('/api/v1/sites')
        .set('Authorization', `Bearer ${caToken}`)
        .send({ name: 'Temporary Warehouse', location: 'Chattogram South' });
      expect(createSite.status).toBe(201);

      const okDel = await request(app)
        .delete(`/api/v1/sites/${createSite.body.id}`)
        .set('Authorization', `Bearer ${caToken}`);
      expect(okDel.status).toBe(200);

      // PA creates a new device model with metric definitions
      const createModel = await request(app)
        .post('/api/v1/device-models')
        .set('Authorization', `Bearer ${paToken}`)
        .send({
          name: 'PR-400 Pressure Transducer',
          manufacturer: 'Honeywell Process',
          hardwareRevision: 'Rev 1.0',
          supportedFirmwareFamily: 'pr400-fw',
          metrics: [
            { key: 'pressure_bar', label: 'Line Pressure', type: 'number', unit: 'bar', min: 0, max: 40 },
          ],
        });
      expect(createModel.status).toBe(201);
      expect(createModel.body.metrics).toHaveLength(1);
    });
  });
});
