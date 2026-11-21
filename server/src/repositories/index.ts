import type Database from 'better-sqlite3';
import { SqliteAuditRepository } from './auditRepository.ts';
import { SqliteDeviceModelRepository } from './deviceModelRepository.ts';
import { SqliteDeviceRepository } from './deviceRepository.ts';
import { SqliteEmailOutboxRepository } from './emailOutboxRepository.ts';
import { SqliteSiteRepository } from './siteRepository.ts';
import { SqliteTenantRepository } from './tenantRepository.ts';
import type {
  IAuditRepository,
  IDeviceModelRepository,
  IDeviceRepository,
  IEmailOutboxRepository,
  ISiteRepository,
  ITenantRepository,
  IUserRepository,
} from './types.ts';
import { SqliteUserRepository } from './userRepository.ts';

export interface Repositories {
  db: Database.Database;
  tenants: ITenantRepository;
  users: IUserRepository;
  audit: IAuditRepository;
  emailOutbox: IEmailOutboxRepository;
  sites: ISiteRepository;
  deviceModels: IDeviceModelRepository;
  devices: IDeviceRepository;
}

export function createRepositories(db: Database.Database): Repositories {
  return {
    db,
    tenants: new SqliteTenantRepository(db),
    users: new SqliteUserRepository(db),
    audit: new SqliteAuditRepository(db),
    emailOutbox: new SqliteEmailOutboxRepository(db),
    sites: new SqliteSiteRepository(db),
    deviceModels: new SqliteDeviceModelRepository(db),
    devices: new SqliteDeviceRepository(db),
  };
}

