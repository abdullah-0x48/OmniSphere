import type Database from 'better-sqlite3';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../src/app.ts';
import { createDatabase } from '../src/repositories/db.ts';
import { createRepositories, type Repositories } from '../src/repositories/index.ts';
import { DEMO_PASSWORD, seedMilestone1Data } from '../src/seed/seedData.ts';

describe('Test 2: RBAC Matrix & Milestone 1 Acceptance Flows', () => {
  let db: Database.Database;
  let repos: Repositories;
  let app: Express;
  const tokens: Record<string, string> = {};

  async function signIn(email: string, password = DEMO_PASSWORD): Promise<string> {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    return res.body.token as string;
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    db = createDatabase(':memory:');
    repos = createRepositories(db);
    await seedMilestone1Data(repos);
    app = createApp(repos);

    tokens.PA = await signIn('admin@omnisphere.demo');
    tokens.SE = await signIn('noc1@omnisphere.demo');
    tokens.FT = await signIn('tech1@omnisphere.demo');
    tokens.CA = await signIn('admin.ktl@omnisphere.demo');
    tokens.CM = await signIn('manager.ktl@omnisphere.demo');
    tokens.CO = await signIn('operator1.ktl@omnisphere.demo');
  });

  afterAll(() => {
    db.close();
  });

  it('GET /api/v1/health and /api/v1/openapi.json are accessible without authentication', async () => {
    const health = await request(app).get('/api/v1/health');
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('ok');

    const openapi = await request(app).get('/api/v1/openapi.json');
    expect(openapi.status).toBe(200);
    expect(openapi.body.openapi).toBe('3.0.3');
  });

  it('rejects unauthenticated access to protected endpoints with 401 UNAUTHENTICATED', async () => {
    const res = await request(app).get('/api/v1/tenants');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  // Table-driven RBAC test matching Section 2.2
  const rbacCases: Array<{
    name: string;
    method: 'get' | 'post' | 'patch' | 'put';
    path: string;
    body?: Record<string, unknown>;
    expected: Record<'PA' | 'SE' | 'FT' | 'CA' | 'CM' | 'CO', number>;
  }> = [
    {
      name: 'GET /api/v1/platform/overview (PA only)',
      method: 'get',
      path: '/api/v1/platform/overview',
      expected: { PA: 200, SE: 403, FT: 403, CA: 403, CM: 403, CO: 403 },
    },
    {
      name: 'GET /api/v1/tenants (all roles scoped)',
      method: 'get',
      path: '/api/v1/tenants',
      expected: { PA: 200, SE: 200, FT: 200, CA: 200, CM: 200, CO: 200 },
    },
    {
      name: 'GET /api/v1/users (PA and CA only)',
      method: 'get',
      path: '/api/v1/users',
      expected: { PA: 200, SE: 403, FT: 403, CA: 200, CM: 403, CO: 403 },
    },
    {
      name: 'GET /api/v1/audit (PA and CA only)',
      method: 'get',
      path: '/api/v1/audit',
      expected: { PA: 200, SE: 403, FT: 403, CA: 200, CM: 403, CO: 403 },
    },
    {
      name: 'GET /api/v1/email-outbox (PA, SE, CA only)',
      method: 'get',
      path: '/api/v1/email-outbox',
      expected: { PA: 200, SE: 200, FT: 403, CA: 200, CM: 403, CO: 403 },
    },
    {
      name: 'PATCH /api/v1/tenants/ten_ktl/settings (PA and KTL CA only)',
      method: 'patch',
      path: '/api/v1/tenants/ten_ktl/settings',
      body: { heartbeatIntervalSec: 30 },
      expected: { PA: 200, SE: 403, FT: 403, CA: 200, CM: 403, CO: 403 },
    },
    {
      name: 'PUT /api/v1/users/usr_se_noc2/tenants (PA only)',
      method: 'put',
      path: '/api/v1/users/usr_se_noc2/tenants',
      body: { assignedTenantIds: ['ten_mfp', 'ten_scw'] },
      expected: { PA: 200, SE: 403, FT: 403, CA: 403, CM: 403, CO: 403 },
    },
    {
      name: 'GET /api/v1/device-models (all roles)',
      method: 'get',
      path: '/api/v1/device-models',
      expected: { PA: 200, SE: 200, FT: 200, CA: 200, CM: 200, CO: 200 },
    },
    {
      name: 'GET /api/v1/sites (all except PA)',
      method: 'get',
      path: '/api/v1/sites',
      expected: { PA: 403, SE: 200, FT: 200, CA: 200, CM: 200, CO: 200 },
    },
    {
      name: 'GET /api/v1/devices (all except PA)',
      method: 'get',
      path: '/api/v1/devices',
      expected: { PA: 403, SE: 200, FT: 200, CA: 200, CM: 200, CO: 200 },
    },
    {
      name: 'POST /api/v1/device-models (PA and SE only; invalid empty body -> 400 vs 403)',
      method: 'post',
      path: '/api/v1/device-models',
      body: {},
      expected: { PA: 400, SE: 400, FT: 403, CA: 403, CM: 403, CO: 403 },
    },
    {
      name: 'POST /api/v1/devices (CA and SE only; invalid empty body -> 400 vs 403)',
      method: 'post',
      path: '/api/v1/devices',
      body: {},
      expected: { PA: 403, SE: 400, FT: 403, CA: 400, CM: 403, CO: 403 },
    },
    {
      name: 'GET /api/v1/alert-rules (SE, CA, CM, CO only)',
      method: 'get',
      path: '/api/v1/alert-rules',
      expected: { PA: 403, SE: 200, FT: 403, CA: 200, CM: 200, CO: 200 },
    },
    {
      name: 'POST /api/v1/alert-rules (CA and SE only; invalid empty body -> 400 vs 403)',
      method: 'post',
      path: '/api/v1/alert-rules',
      body: {},
      expected: { PA: 403, SE: 400, FT: 403, CA: 400, CM: 403, CO: 403 },
    },
    {
      name: 'GET /api/v1/alerts (SE, CA, CM, CO only)',
      method: 'get',
      path: '/api/v1/alerts',
      expected: { PA: 403, SE: 200, FT: 403, CA: 200, CM: 200, CO: 200 },
    },
    {
      name: 'GET /api/v1/notifications (all roles)',
      method: 'get',
      path: '/api/v1/notifications',
      expected: { PA: 200, SE: 200, FT: 200, CA: 200, CM: 200, CO: 200 },
    },
  ];

  for (const tc of rbacCases) {
    it(`RBAC: ${tc.name}`, async () => {
      for (const role of ['PA', 'SE', 'FT', 'CA', 'CM', 'CO'] as const) {
        const req = request(app)[tc.method](tc.path).set('Authorization', `Bearer ${tokens[role]}`);
        const res = tc.body ? await req.send(tc.body) : await req;
        expect(res.status, `${role} on ${tc.name}`).toBe(tc.expected[role]);
      }
    });
  }

  it('Acceptance #2: PA creates a tenant with its first CA', async () => {
    const res = await request(app)
      .post('/api/v1/tenants')
      .set('Authorization', `Bearer ${tokens.PA}`)
      .send({
        name: 'Bengal Steel Works',
        code: 'BSW',
        contactEmail: 'ops@bsw.example.com',
        adminName: 'Karim Uddin',
        adminEmail: 'admin.bsw@example.com',
        adminPassword: 'Password123',
      });
    expect(res.status).toBe(201);
    expect(res.body.tenant.code).toBe('BSW');
    expect(res.body.adminUser.role).toBe('CLIENT_ADMIN');
    expect(res.body.adminUser.passwordHash).toBeUndefined();

    // First CA can immediately sign in
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin.bsw@example.com', password: 'Password123' });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user.tenantId).toBe(res.body.tenant.id);
  });

  it('Acceptance #3: CA creates a CM and a CO in own tenant, cannot create provider role', async () => {
    const cmRes = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${tokens.CA}`)
      .send({
        name: 'New KTL Manager',
        email: 'manager2.ktl@example.com',
        role: 'CLIENT_MANAGER',
        password: 'Password123',
      });
    expect(cmRes.status).toBe(201);
    expect(cmRes.body.tenantId).toBe('ten_ktl');

    const coRes = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${tokens.CA}`)
      .send({
        name: 'New KTL Operator',
        email: 'operator3.ktl@example.com',
        role: 'CLIENT_OPERATOR',
        password: 'Password123',
      });
    expect(coRes.status).toBe(201);
    expect(coRes.body.tenantId).toBe('ten_ktl');

    const forbiddenRoleRes = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${tokens.CA}`)
      .send({
        name: 'Sneaky Admin',
        email: 'sneaky@example.com',
        role: 'PLATFORM_ADMIN',
        password: 'Password123',
      });
    expect(forbiddenRoleRes.status).toBe(403);
  });

  it('Acceptance #4: five consecutive wrong passwords lock the account for 15 minutes', async () => {
    const email = 'operator2.ktl@omnisphere.demo';
    for (let i = 1; i <= 4; i++) {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email, password: 'WrongPassword1' });
      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Invalid email or password');
    }

    // 5th failure triggers lockout
    const fifth = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'WrongPassword1' });
    expect(fifth.status).toBe(429);
    expect(fifth.body.error.code).toBe('RATE_LIMITED');

    // Even the right password is blocked while locked
    const blocked = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: DEMO_PASSWORD });
    expect(blocked.status).toBe(429);

    // USER_LOCKED audit entry exists
    const auditRes = await request(app)
      .get('/api/v1/audit?action=USER_LOCKED')
      .set('Authorization', `Bearer ${tokens.PA}`);
    expect(auditRes.status).toBe(200);
    expect(auditRes.body.items.length).toBeGreaterThanOrEqual(1);
  });

  it('Acceptance #5: SE sees only assigned tenants and X-Tenant-Id rejects unassigned tenant', async () => {
    const res = await request(app)
      .get('/api/v1/tenants')
      .set('Authorization', `Bearer ${tokens.SE}`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((t: { code: string }) => t.code).sort()).toEqual(['KTL', 'MFP']);

    // Unassigned tenant in X-Tenant-Id header rejected with 403
    const badHeader = await request(app)
      .get('/api/v1/tenants')
      .set('Authorization', `Bearer ${tokens.SE}`)
      .set('X-Tenant-Id', 'ten_scw');
    expect(badHeader.status).toBe(403);

    // Assigned tenant succeeds
    const goodHeader = await request(app)
      .get('/api/v1/tenants/ten_ktl')
      .set('Authorization', `Bearer ${tokens.SE}`)
      .set('X-Tenant-Id', 'ten_ktl');
    expect(goodHeader.status).toBe(200);
  });

  it('Acceptance #6: requesting another tenant user by ID as CA returns 404 (not 403)', async () => {
    const res = await request(app)
      .get('/api/v1/users/usr_mfp_ca')
      .set('Authorization', `Bearer ${tokens.CA}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');

    // Also updating another tenant's settings as CA returns 404
    const settingsRes = await request(app)
      .patch('/api/v1/tenants/ten_mfp/settings')
      .set('Authorization', `Bearer ${tokens.CA}`)
      .send({ heartbeatIntervalSec: 45 });
    expect(settingsRes.status).toBe(404);
  });

  it('Acceptance #7: suspending a tenant blocks its users on login AND active sessions', async () => {
    const scwToken = await signIn('admin.scw@omnisphere.demo');

    // PA suspends SCW
    const suspendRes = await request(app)
      .post('/api/v1/tenants/ten_scw/suspend')
      .set('Authorization', `Bearer ${tokens.PA}`)
      .send({ reason: 'Contract paused' });
    expect(suspendRes.status).toBe(200);
    expect(suspendRes.body.status).toBe('SUSPENDED');

    // Existing JWT is blocked immediately with 403 "Organization suspended"
    const activeSessionRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${scwToken}`);
    expect(activeSessionRes.status).toBe(403);
    expect(activeSessionRes.body.error.message).toBe('Organization suspended');

    // Fresh login is blocked with 403 "Organization suspended"
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin.scw@omnisphere.demo', password: DEMO_PASSWORD });
    expect(loginRes.status).toBe(403);
    expect(loginRes.body.error.message).toBe('Organization suspended');

    // Reactivate restores access
    const reactivateRes = await request(app)
      .post('/api/v1/tenants/ten_scw/reactivate')
      .set('Authorization', `Bearer ${tokens.PA}`);
    expect(reactivateRes.status).toBe(200);
    const loginAfter = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin.scw@omnisphere.demo', password: DEMO_PASSWORD });
    expect(loginAfter.status).toBe(200);
  });

  it('Acceptance #8: PA sees audit events across tenants; CA sees own tenant; audit cannot be modified', async () => {
    const paAudit = await request(app)
      .get('/api/v1/audit?pageSize=100')
      .set('Authorization', `Bearer ${tokens.PA}`);
    expect(paAudit.status).toBe(200);
    const actions = paAudit.body.items.map((a: { action: string }) => a.action);
    expect(actions).toContain('TENANT_CREATED');
    expect(actions).toContain('TENANT_SUSPENDED');
    expect(actions).toContain('TENANT_REACTIVATED');
    expect(actions).toContain('USER_CREATED');

    const caAudit = await request(app)
      .get('/api/v1/audit?pageSize=100')
      .set('Authorization', `Bearer ${tokens.CA}`);
    expect(caAudit.status).toBe(200);
    expect(caAudit.body.items.every((e: { tenantId: string }) => e.tenantId === 'ten_ktl')).toBe(true);

    // No edit or delete endpoints exist on /api/v1/audit
    const delRes = await request(app)
      .delete(`/api/v1/audit/${paAudit.body.items[0].id}`)
      .set('Authorization', `Bearer ${tokens.PA}`);
    expect(delRes.status).toBe(404);
  });

  it('Password reset flow works end-to-end via outbox token', async () => {
    const forgotRes = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'operator1.mfp@omnisphere.demo' });
    expect(forgotRes.status).toBe(200);

    const outbox = await request(app)
      .get('/api/v1/email-outbox')
      .set('Authorization', `Bearer ${tokens.PA}`);
    expect(outbox.status).toBe(200);
    const resetEmail = outbox.body.items.find(
      (e: { to: string; relatedType: string }) =>
        e.to === 'operator1.mfp@omnisphere.demo' && e.relatedType === 'PASSWORD_RESET',
    );
    expect(resetEmail).toBeTruthy();

    const match = /\/reset-password\/([A-Za-z0-9_-]+)/.exec(resetEmail.body as string);
    expect(match).toBeTruthy();
    const token = match![1];

    const resetRes = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, newPassword: 'NewPassword99' });
    expect(resetRes.status).toBe(200);

    // Token is single-use
    const reuseRes = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, newPassword: 'AnotherPassword99' });
    expect(reuseRes.status).toBe(400);

    // Login with new password works
    const newLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'operator1.mfp@omnisphere.demo', password: 'NewPassword99' });
    expect(newLogin.status).toBe(200);
  });
});
