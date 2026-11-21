import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase } from '../src/repositories/db.ts';
import { createRepositories, type Repositories } from '../src/repositories/index.ts';
import type { TenantContext } from '../src/repositories/types.ts';
import { seedMilestone1Data } from '../src/seed/seedData.ts';

describe('Test 1: Repository Tenant Scoping & Isolation (NFR-04)', () => {
  let db: Database.Database;
  let repos: Repositories;

  const paCtx: TenantContext = {
    userId: 'usr_pa_admin',
    role: 'PLATFORM_ADMIN',
    allTenants: true,
    tenantIds: [],
    activeTenantId: null,
  };

  const ktlCaCtx: TenantContext = {
    userId: 'usr_ktl_ca',
    role: 'CLIENT_ADMIN',
    allTenants: false,
    tenantIds: ['ten_ktl'],
    activeTenantId: 'ten_ktl',
  };

  const mfpCaCtx: TenantContext = {
    userId: 'usr_mfp_ca',
    role: 'CLIENT_ADMIN',
    allTenants: false,
    tenantIds: ['ten_mfp'],
    activeTenantId: 'ten_mfp',
  };

  const noc1Ctx: TenantContext = {
    userId: 'usr_se_noc1',
    role: 'SUPPORT_ENGINEER',
    allTenants: false,
    tenantIds: ['ten_ktl', 'ten_mfp'],
    activeTenantId: null,
  };

  beforeAll(async () => {
    db = createDatabase(':memory:');
    repos = createRepositories(db);
    await seedMilestone1Data(repos);

    // Seed an outbox entry per tenant for scoping verification
    repos.emailOutbox.insert({
      id: 'eml_test_ktl',
      tenantId: 'ten_ktl',
      to: 'admin.ktl@omnisphere.demo',
      subject: 'KTL Alert',
      body: '<p>KTL</p>',
      status: 'SENT',
      attempts: 1,
      nextAttemptAt: null,
      lastError: null,
      relatedType: 'TEST',
      relatedId: '1',
    });
    repos.emailOutbox.insert({
      id: 'eml_test_scw',
      tenantId: 'ten_scw',
      to: 'admin.scw@omnisphere.demo',
      subject: 'SCW Alert',
      body: '<p>SCW</p>',
      status: 'SENT',
      attempts: 1,
      nextAttemptAt: null,
      lastError: null,
      relatedType: 'TEST',
      relatedId: '2',
    });
  });

  afterAll(() => {
    db.close();
  });

  it('tenantRepository isolates list, findById, update, updateStatus, and updateSettings', () => {
    const ktlList = repos.tenants.list(ktlCaCtx, {
      page: 1,
      pageSize: 50,
      sortField: 'name',
      sortDir: 'asc',
    });
    expect(ktlList.items.map((t) => t.id)).toEqual(['ten_ktl']);

    // Tenant A cannot read, update, suspend, or change settings of Tenant B
    expect(repos.tenants.findById(ktlCaCtx, 'ten_mfp')).toBeNull();
    expect(repos.tenants.update(ktlCaCtx, 'ten_mfp', { name: 'Hacked' })).toBeNull();
    expect(repos.tenants.updateStatus(ktlCaCtx, 'ten_mfp', 'SUSPENDED')).toBeNull();
    expect(
      repos.tenants.updateSettings(ktlCaCtx, 'ten_mfp', {
        heartbeatIntervalSec: 15,
        offlineAfterMissedIntervals: 3,
        criticalAckMinutes: 10,
        requireRolloutApproval: true,
        requireMaintenanceApproval: true,
      }),
    ).toBeNull();

    // SE noc1 sees only KTL and MFP, never SCW
    const noc1Tenants = repos.tenants.listAccessible(noc1Ctx);
    expect(noc1Tenants.map((t) => t.id).sort()).toEqual(['ten_ktl', 'ten_mfp']);
    expect(repos.tenants.findById(noc1Ctx, 'ten_scw')).toBeNull();
  });

  it('userRepository isolates list, findById, update, updateStatus, and create across tenants', () => {
    const ktlUsers = repos.users.list(ktlCaCtx, {
      page: 1,
      pageSize: 50,
      sortField: 'email',
      sortDir: 'asc',
    });
    expect(ktlUsers.items.length).toBeGreaterThan(0);
    expect(ktlUsers.items.every((u) => u.tenantId === 'ten_ktl')).toBe(true);

    // Tenant A CA cannot read, update, or deactivate a Tenant B user or a provider user
    expect(repos.users.findById(ktlCaCtx, 'usr_mfp_ca')).toBeNull();
    expect(repos.users.findById(ktlCaCtx, 'usr_pa_admin')).toBeNull();
    expect(repos.users.update(ktlCaCtx, 'usr_mfp_ca', { name: 'Tampered' })).toBeNull();
    expect(repos.users.updateStatus(ktlCaCtx, 'usr_mfp_ca', 'INACTIVE')).toBeNull();

    // Even if someone tries to pass tenantId filter for another tenant, scope overrides it
    const forcedFilter = repos.users.list(ktlCaCtx, {
      tenantId: 'ten_mfp',
      page: 1,
      pageSize: 50,
      sortField: 'email',
      sortDir: 'asc',
    });
    expect(forcedFilter.items.every((u) => u.tenantId === 'ten_ktl')).toBe(true);

    // Repository blocks cross-tenant create
    expect(() =>
      repos.users.create(ktlCaCtx, {
        id: 'usr_cross_attempt',
        email: 'cross@omnisphere.demo',
        name: 'Cross',
        role: 'CLIENT_OPERATOR',
        tenantId: 'ten_mfp',
        assignedTenantIds: [],
        isSupervisor: false,
        passwordHash: 'hash',
      }),
    ).toThrow();
  });

  it('auditRepository strictly scopes CA to own tenant and enforces append-only triggers', () => {
    const paAudit = repos.audit.list(paCtx, { page: 1, pageSize: 100, sortDir: 'desc' });
    expect(paAudit.total).toBeGreaterThan(0);

    const ktlAudit = repos.audit.list(ktlCaCtx, {
      tenantId: 'ten_mfp', // must be ignored for non-PA
      page: 1,
      pageSize: 100,
      sortDir: 'desc',
    });
    expect(ktlAudit.items.length).toBeGreaterThan(0);
    expect(ktlAudit.items.every((e) => e.tenantId === 'ten_ktl')).toBe(true);

    const mfpAudit = repos.audit.list(mfpCaCtx, { page: 1, pageSize: 100, sortDir: 'desc' });
    expect(mfpAudit.items.every((e) => e.tenantId === 'ten_mfp')).toBe(true);

    // Database triggers enforce append-only immutability on audit_logs
    const firstId = paAudit.items[0].id;
    expect(() => {
      db.prepare('UPDATE audit_logs SET action = ? WHERE id = ?').run('TAMPERED', firstId);
    }).toThrow(/append-only/i);

    expect(() => {
      db.prepare('DELETE FROM audit_logs WHERE id = ?').run(firstId);
    }).toThrow(/append-only/i);
  });

  it('emailOutboxRepository scopes records by TenantContext', () => {
    const ktlEmails = repos.emailOutbox.list(ktlCaCtx, { page: 1, pageSize: 50 });
    expect(ktlEmails.items.map((e) => e.id)).toEqual(['eml_test_ktl']);

    const noc1Emails = repos.emailOutbox.list(noc1Ctx, { page: 1, pageSize: 50 });
    expect(noc1Emails.items.some((e) => e.id === 'eml_test_scw')).toBe(false);
    expect(noc1Emails.items.some((e) => e.id === 'eml_test_ktl')).toBe(true);
  });

  it('siteRepository and deviceRepository strictly isolate reads and writes across tenants', async () => {
    const { seedMilestone2Data } = await import('../src/seed/seedMilestone2.ts');
    await seedMilestone2Data(repos);

    // KTL CA sees only KTL sites and cannot read, update, or delete MFP sites
    const ktlSites = repos.sites.list(ktlCaCtx, {
      page: 1,
      pageSize: 50,
      sortField: 'name',
      sortDir: 'asc',
    });
    expect(ktlSites.items.length).toBeGreaterThan(0);
    expect(ktlSites.items.every((s) => s.tenantId === 'ten_ktl')).toBe(true);
    expect(repos.sites.findById(ktlCaCtx, 'sit_mfp_cld')).toBeNull();
    expect(repos.sites.update(ktlCaCtx, 'sit_mfp_cld', { name: 'Tampered' })).toBeNull();
    expect(repos.sites.delete(ktlCaCtx, 'sit_mfp_cld')).toBe(false);

    // KTL CA sees only KTL devices and cannot read, update, or transition MFP devices
    const ktlDevices = repos.devices.list(ktlCaCtx, {
      page: 1,
      pageSize: 50,
      sortField: 'name',
      sortDir: 'asc',
    });
    expect(ktlDevices.items.length).toBe(12);
    expect(ktlDevices.items.every((d) => d.tenantId === 'ten_ktl')).toBe(true);
    expect(repos.devices.findById(ktlCaCtx, 'dev_mfp_001')).toBeNull();
    expect(repos.devices.update(ktlCaCtx, 'dev_mfp_001', { name: 'Hacked' })).toBeNull();

    // SE noc1 (KTL & MFP) never sees SCW devices
    expect(repos.devices.findById(noc1Ctx, 'dev_scw_001')).toBeNull();
    expect(repos.devices.findById(noc1Ctx, 'dev_mfp_001')).not.toBeNull();
  });
});
