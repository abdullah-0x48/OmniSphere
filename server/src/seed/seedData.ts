import bcrypt from 'bcryptjs';
import { DEFAULT_TENANT_SETTINGS, type RoleCode } from '../../../shared/types.ts';
import { config } from '../config.ts';
import type { Repositories } from '../repositories/index.ts';
import type { TenantContext } from '../repositories/types.ts';
import { AuditService } from '../services/auditService.ts';

export const DEMO_PASSWORD = 'Demo@12345';

const SYSTEM_PA_CTX: TenantContext = {
  userId: 'SYSTEM',
  role: 'PLATFORM_ADMIN',
  allTenants: true,
  tenantIds: [],
  activeTenantId: null,
};

interface SeedTenantDef {
  id: string;
  code: string;
  name: string;
  contactEmail: string;
  requireRolloutApproval: boolean;
}

const DEMO_TENANTS: SeedTenantDef[] = [
  {
    id: 'ten_ktl',
    code: 'KTL',
    name: 'Karnaphuli Textiles Ltd',
    contactEmail: 'ops@ktl.omnisphere.demo',
    requireRolloutApproval: true,
  },
  {
    id: 'ten_mfp',
    code: 'MFP',
    name: 'Meghna Food Processing',
    contactEmail: 'ops@mfp.omnisphere.demo',
    requireRolloutApproval: false,
  },
  {
    id: 'ten_scw',
    code: 'SCW',
    name: 'Sundarbans Cement Works',
    contactEmail: 'ops@scw.omnisphere.demo',
    requireRolloutApproval: false,
  },
];

interface SeedUserDef {
  id: string;
  email: string;
  name: string;
  role: RoleCode;
  tenantId: string | null;
  assignedTenantIds: string[];
  isSupervisor: boolean;
}

const DEMO_USERS: SeedUserDef[] = [
  {
    id: 'usr_pa_admin',
    email: 'admin@omnisphere.demo',
    name: 'Amina Rahman',
    role: 'PLATFORM_ADMIN',
    tenantId: null,
    assignedTenantIds: [],
    isSupervisor: false,
  },
  {
    id: 'usr_se_noc1',
    email: 'noc1@omnisphere.demo',
    name: 'Tariq Hasan',
    role: 'SUPPORT_ENGINEER',
    tenantId: null,
    assignedTenantIds: ['ten_ktl', 'ten_mfp'],
    isSupervisor: true,
  },
  {
    id: 'usr_se_noc2',
    email: 'noc2@omnisphere.demo',
    name: 'Nadia Karim',
    role: 'SUPPORT_ENGINEER',
    tenantId: null,
    assignedTenantIds: ['ten_mfp', 'ten_scw'],
    isSupervisor: false,
  },
  {
    id: 'usr_ft_tech1',
    email: 'tech1@omnisphere.demo',
    name: 'Rafiq Islam',
    role: 'FIELD_TECHNICIAN',
    tenantId: null,
    assignedTenantIds: ['ten_ktl', 'ten_mfp', 'ten_scw'],
    isSupervisor: false,
  },
  {
    id: 'usr_ft_tech2',
    email: 'tech2@omnisphere.demo',
    name: 'Farhana Begum',
    role: 'FIELD_TECHNICIAN',
    tenantId: null,
    assignedTenantIds: ['ten_ktl', 'ten_mfp', 'ten_scw'],
    isSupervisor: false,
  },
  // Karnaphuli Textiles Ltd (KTL)
  {
    id: 'usr_ktl_ca',
    email: 'admin.ktl@omnisphere.demo',
    name: 'Kamal Chowdhury',
    role: 'CLIENT_ADMIN',
    tenantId: 'ten_ktl',
    assignedTenantIds: [],
    isSupervisor: false,
  },
  {
    id: 'usr_ktl_cm',
    email: 'manager.ktl@omnisphere.demo',
    name: 'Sadia Ahmed',
    role: 'CLIENT_MANAGER',
    tenantId: 'ten_ktl',
    assignedTenantIds: [],
    isSupervisor: false,
  },
  {
    id: 'usr_ktl_co1',
    email: 'operator1.ktl@omnisphere.demo',
    name: 'Imran Hossain',
    role: 'CLIENT_OPERATOR',
    tenantId: 'ten_ktl',
    assignedTenantIds: [],
    isSupervisor: false,
  },
  {
    id: 'usr_ktl_co2',
    email: 'operator2.ktl@omnisphere.demo',
    name: 'Laila Yasmin',
    role: 'CLIENT_OPERATOR',
    tenantId: 'ten_ktl',
    assignedTenantIds: [],
    isSupervisor: false,
  },
  // Meghna Food Processing (MFP)
  {
    id: 'usr_mfp_ca',
    email: 'admin.mfp@omnisphere.demo',
    name: 'Mahmudul Haque',
    role: 'CLIENT_ADMIN',
    tenantId: 'ten_mfp',
    assignedTenantIds: [],
    isSupervisor: false,
  },
  {
    id: 'usr_mfp_cm',
    email: 'manager.mfp@omnisphere.demo',
    name: 'Rehana Sultana',
    role: 'CLIENT_MANAGER',
    tenantId: 'ten_mfp',
    assignedTenantIds: [],
    isSupervisor: false,
  },
  {
    id: 'usr_mfp_co1',
    email: 'operator1.mfp@omnisphere.demo',
    name: 'Sajib Das',
    role: 'CLIENT_OPERATOR',
    tenantId: 'ten_mfp',
    assignedTenantIds: [],
    isSupervisor: false,
  },
  {
    id: 'usr_mfp_co2',
    email: 'operator2.mfp@omnisphere.demo',
    name: 'Tania Akter',
    role: 'CLIENT_OPERATOR',
    tenantId: 'ten_mfp',
    assignedTenantIds: [],
    isSupervisor: false,
  },
  // Sundarbans Cement Works (SCW)
  {
    id: 'usr_scw_ca',
    email: 'admin.scw@omnisphere.demo',
    name: 'Zahidul Alam',
    role: 'CLIENT_ADMIN',
    tenantId: 'ten_scw',
    assignedTenantIds: [],
    isSupervisor: false,
  },
  {
    id: 'usr_scw_cm',
    email: 'manager.scw@omnisphere.demo',
    name: 'Nusrat Jahan',
    role: 'CLIENT_MANAGER',
    tenantId: 'ten_scw',
    assignedTenantIds: [],
    isSupervisor: false,
  },
  {
    id: 'usr_scw_co1',
    email: 'operator1.scw@omnisphere.demo',
    name: 'Ashraf Ali',
    role: 'CLIENT_OPERATOR',
    tenantId: 'ten_scw',
    assignedTenantIds: [],
    isSupervisor: false,
  },
  {
    id: 'usr_scw_co2',
    email: 'operator2.scw@omnisphere.demo',
    name: 'Mita Roy',
    role: 'CLIENT_OPERATOR',
    tenantId: 'ten_scw',
    assignedTenantIds: [],
    isSupervisor: false,
  },
];

/**
 * Idempotently seeds Milestone 1 tenants and users (Section 15).
 * When `resetExisting` is true, also restores demo tenant settings/status and demo user passwords/status/lockouts.
 */
export async function seedMilestone1Data(
  repos: Repositories,
  options: { resetExisting?: boolean; actorId?: string; actorRole?: RoleCode | 'SYSTEM'; ip?: string } = {},
): Promise<{ tenantsCreated: number; usersCreated: number }> {
  const audit = new AuditService(repos.audit);
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, config.security.bcryptCost);
  const actorId = options.actorId ?? 'SYSTEM';
  const actorRole = options.actorRole ?? 'SYSTEM';
  const ip = options.ip ?? '127.0.0.1';

  let tenantsCreated = 0;
  let usersCreated = 0;

  for (const t of DEMO_TENANTS) {
    const existing = repos.tenants.findByCodeSystem(t.code);
    const settings = {
      ...DEFAULT_TENANT_SETTINGS,
      requireRolloutApproval: t.requireRolloutApproval,
    };

    if (!existing) {
      repos.tenants.create(SYSTEM_PA_CTX, {
        id: t.id,
        name: t.name,
        code: t.code,
        contactEmail: t.contactEmail,
        status: 'ACTIVE',
        settings,
      });
      tenantsCreated += 1;
      audit.record({
        actorId,
        actorRole,
        tenantId: t.id,
        action: 'TENANT_CREATED',
        targetType: 'TENANT',
        targetId: t.id,
        outcome: 'SUCCESS',
        ip,
        details: { code: t.code, name: t.name, seeded: true },
      });
    } else if (options.resetExisting) {
      repos.tenants.update(SYSTEM_PA_CTX, existing.id, {
        name: t.name,
        contactEmail: t.contactEmail,
      });
      repos.tenants.updateStatus(SYSTEM_PA_CTX, existing.id, 'ACTIVE');
      repos.tenants.updateSettings(SYSTEM_PA_CTX, existing.id, settings);
    }
  }

  for (const u of DEMO_USERS) {
    const existing = repos.users.findByEmailForAuth(u.email);
    if (!existing) {
      repos.users.create(SYSTEM_PA_CTX, {
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        tenantId: u.tenantId,
        assignedTenantIds: u.assignedTenantIds,
        isSupervisor: u.isSupervisor,
        status: 'ACTIVE',
        passwordHash,
      });
      usersCreated += 1;
      audit.record({
        actorId,
        actorRole,
        tenantId: u.tenantId,
        action: 'USER_CREATED',
        targetType: 'USER',
        targetId: u.id,
        outcome: 'SUCCESS',
        ip,
        details: { email: u.email, role: u.role, seeded: true },
      });
    } else if (options.resetExisting) {
      repos.users.update(SYSTEM_PA_CTX, existing.id, {
        name: u.name,
        role: u.role,
        isSupervisor: u.isSupervisor,
      });
      repos.users.updateStatus(SYSTEM_PA_CTX, existing.id, 'ACTIVE');
      repos.users.updatePasswordSystem(existing.id, passwordHash);
      if (u.role === 'SUPPORT_ENGINEER' || u.role === 'FIELD_TECHNICIAN') {
        repos.users.updateAssignedTenants(SYSTEM_PA_CTX, existing.id, u.assignedTenantIds);
      }
    }
  }

  if (options.resetExisting) {
    audit.record({
      actorId,
      actorRole,
      tenantId: null,
      action: 'DEMO_DATA_RESET',
      targetType: 'PLATFORM',
      targetId: 'demo-seed',
      outcome: 'SUCCESS',
      ip,
      details: { tenantsCreated, usersCreated },
    });
  }

  return { tenantsCreated, usersCreated };
}
