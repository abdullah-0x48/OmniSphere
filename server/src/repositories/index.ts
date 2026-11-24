import type Database from 'better-sqlite3';
import { SqliteAlertRepository } from './alertRepository.ts';
import { SqliteAlertRuleRepository } from './alertRuleRepository.ts';
import { SqliteAuditRepository } from './auditRepository.ts';
import { SqliteConfigProfileRepository } from './configProfileRepository.ts';
import { SqliteDeviceCommandRepository } from './deviceCommandRepository.ts';
import { SqliteDeviceModelRepository } from './deviceModelRepository.ts';
import { SqliteDeviceRepository } from './deviceRepository.ts';
import { SqliteEmailOutboxRepository } from './emailOutboxRepository.ts';
import { SqliteFirmwareRepository } from './firmwareRepository.ts';
import { SqliteMaintenancePlanRepository } from './maintenancePlanRepository.ts';
import { SqliteNotificationRepository } from './notificationRepository.ts';
import { SqliteRolloutRepository } from './rolloutRepository.ts';
import { SqliteSiteRepository } from './siteRepository.ts';
import { SqliteTelemetryRepository } from './telemetryRepository.ts';
import { SqliteTenantRepository } from './tenantRepository.ts';
import { SqliteTicketRepository } from './ticketRepository.ts';
import type {
  IAlertRepository,
  IAlertRuleRepository,
  IAuditRepository,
  IConfigProfileRepository,
  IDeviceCommandRepository,
  IDeviceModelRepository,
  IDeviceRepository,
  IEmailOutboxRepository,
  IFirmwareRepository,
  IMaintenancePlanRepository,
  INotificationRepository,
  IRolloutRepository,
  ISiteRepository,
  ITelemetryRepository,
  ITenantRepository,
  ITicketRepository,
  IUserRepository,
  IWorkOrderRepository,
} from './types.ts';
import { SqliteUserRepository } from './userRepository.ts';
import { SqliteWorkOrderRepository } from './workOrderRepository.ts';

export interface Repositories {
  db: Database.Database;
  tenants: ITenantRepository;
  users: IUserRepository;
  audit: IAuditRepository;
  emailOutbox: IEmailOutboxRepository;
  sites: ISiteRepository;
  deviceModels: IDeviceModelRepository;
  devices: IDeviceRepository;
  telemetry: ITelemetryRepository;
  deviceCommands: IDeviceCommandRepository;
  alertRules: IAlertRuleRepository;
  alerts: IAlertRepository;
  notifications: INotificationRepository;
  tickets: ITicketRepository;
  workOrders: IWorkOrderRepository;
  maintenancePlans: IMaintenancePlanRepository;
  configProfiles: IConfigProfileRepository;
  firmware: IFirmwareRepository;
  rollouts: IRolloutRepository;
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
    telemetry: new SqliteTelemetryRepository(db),
    deviceCommands: new SqliteDeviceCommandRepository(db),
    alertRules: new SqliteAlertRuleRepository(db),
    alerts: new SqliteAlertRepository(db),
    notifications: new SqliteNotificationRepository(db),
    tickets: new SqliteTicketRepository(db),
    workOrders: new SqliteWorkOrderRepository(db),
    maintenancePlans: new SqliteMaintenancePlanRepository(db),
    configProfiles: new SqliteConfigProfileRepository(db),
    firmware: new SqliteFirmwareRepository(db),
    rollouts: new SqliteRolloutRepository(db),
  };
}
