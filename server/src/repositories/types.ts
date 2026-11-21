import type {
  AuditLog,
  AuditOutcome,
  DeviceConfigState,
  DeviceConnectivity,
  DeviceHealthSnapshot,
  DeviceLifecycleState,
  DeviceModel,
  DevicePublic,
  DeviceStateHistoryItem,
  EmailOutboxItem,
  EmailOutboxStatus,
  MetricDefinition,
  RoleCode,
  Site,
  Tenant,
  TenantSettings,
  TenantStatus,
  UserPublic,
  UserStatus,
} from '../../../shared/types.ts';

/**
 * Built by auth middleware for every authenticated request and passed as a required
 * argument to every tenant-scoped repository method (Section 2.3).
 */
export interface TenantContext {
  userId: string;
  role: RoleCode;
  /**
   * Accessible tenant IDs for this principal.
   * For PLATFORM_ADMIN, `allTenants` is true and `tenantIds` is empty.
   * For SUPPORT_ENGINEER and FIELD_TECHNICIAN, `tenantIds` is `assignedTenantIds`.
   * For client roles, `tenantIds` is `[user.tenantId]`.
   */
  allTenants: boolean;
  tenantIds: string[];
  /**
   * Working tenant ID for the current request:
   * - Client roles: always their own `tenantId` (X-Tenant-Id header is ignored).
   * - SUPPORT_ENGINEER: validated X-Tenant-Id if supplied, else null (cross-tenant).
   * - PLATFORM_ADMIN / FIELD_TECHNICIAN: null unless explicitly scoped.
   */
  activeTenantId: string | null;
}

export interface UserRecord extends UserPublic {
  passwordHash: string;
  passwordResetTokenHash: string | null;
  passwordResetExpiresAt: string | null;
}

export function toUserPublic(record: UserRecord): UserPublic {
  return {
    id: record.id,
    email: record.email,
    name: record.name,
    role: record.role,
    tenantId: record.tenantId,
    tenantName: record.tenantName,
    tenantCode: record.tenantCode,
    assignedTenantIds: record.assignedTenantIds,
    isSupervisor: record.isSupervisor,
    status: record.status,
    failedLogins: record.failedLogins,
    lockedUntil: record.lockedUntil,
    lastLoginAt: record.lastLoginAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export interface TenantListFilter {
  q?: string;
  status?: TenantStatus;
  page: number;
  pageSize: number;
  sortField: string;
  sortDir: 'asc' | 'desc';
}

export interface UserListFilter {
  q?: string;
  role?: RoleCode;
  status?: UserStatus;
  tenantId?: string;
  staffOnly?: boolean;
  page: number;
  pageSize: number;
  sortField: string;
  sortDir: 'asc' | 'desc';
}

export interface AuditListFilter {
  actorId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  outcome?: AuditOutcome;
  tenantId?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
  sortDir: 'asc' | 'desc';
}

export interface EmailOutboxListFilter {
  status?: EmailOutboxStatus;
  tenantId?: string;
  page: number;
  pageSize: number;
}

export interface CreateTenantInput {
  id: string;
  name: string;
  code: string;
  contactEmail: string;
  status?: TenantStatus;
  settings: TenantSettings;
}

export interface CreateUserInput {
  id: string;
  email: string;
  name: string;
  role: RoleCode;
  tenantId: string | null;
  assignedTenantIds: string[];
  isSupervisor: boolean;
  status?: UserStatus;
  passwordHash: string;
}

export interface CreateAuditInput {
  id: string;
  at: string;
  actorId: string;
  actorRole: RoleCode | 'SYSTEM' | 'ANONYMOUS';
  tenantId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  outcome: AuditOutcome;
  ip: string;
  details: Record<string, unknown>;
}

export interface CreateEmailOutboxInput {
  id: string;
  tenantId: string | null;
  to: string;
  subject: string;
  body: string;
  status: EmailOutboxStatus;
  attempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  relatedType: string | null;
  relatedId: string | null;
}

export interface ITenantRepository {
  list(ctx: TenantContext, filter: TenantListFilter): { items: Tenant[]; total: number };
  listAccessible(ctx: TenantContext): Tenant[];
  findById(ctx: TenantContext, id: string): Tenant | null;
  findByIdSystem(id: string): Tenant | null;
  findByCodeSystem(code: string): Tenant | null;
  create(ctx: TenantContext, input: CreateTenantInput): Tenant;
  update(ctx: TenantContext, id: string, patch: { name?: string; contactEmail?: string }): Tenant | null;
  updateStatus(ctx: TenantContext, id: string, status: TenantStatus): Tenant | null;
  updateSettings(ctx: TenantContext, id: string, settings: TenantSettings): Tenant | null;
  countByStatus(): { total: number; active: number; suspended: number };
}

export interface IUserRepository {
  list(ctx: TenantContext, filter: UserListFilter): { items: UserPublic[]; total: number };
  findById(ctx: TenantContext, id: string): UserRecord | null;
  findByEmailForAuth(email: string): UserRecord | null;
  findByIdForAuth(id: string): UserRecord | null;
  findByResetTokenHashForAuth(tokenHash: string): UserRecord | null;
  listDemoAccounts(): UserRecord[];
  create(ctx: TenantContext, input: CreateUserInput): UserRecord;
  update(
    ctx: TenantContext,
    id: string,
    patch: { name?: string; role?: RoleCode; isSupervisor?: boolean },
  ): UserRecord | null;
  updateStatus(ctx: TenantContext, id: string, status: UserStatus): UserRecord | null;
  updateAssignedTenants(ctx: TenantContext, id: string, assignedTenantIds: string[]): UserRecord | null;
  updatePasswordSystem(userId: string, passwordHash: string): void;
  setPasswordResetTokenSystem(userId: string, tokenHash: string | null, expiresAt: string | null): void;
  recordLoginFailureSystem(userId: string, failedLogins: number, lockedUntil: string | null): void;
  recordLoginSuccessSystem(userId: string, lastLoginAt: string): void;
  countActivePlatformAdmins(): number;
  countByTenant(): Map<string, { total: number; active: number }>;
  countGlobal(): { total: number; active: number; providerStaff: number };
}

export interface IAuditRepository {
  // Append-only: NO update or delete methods exist (FR-SEC-03).
  insert(input: CreateAuditInput): AuditLog;
  list(ctx: TenantContext, filter: AuditListFilter): { items: AuditLog[]; total: number };
  countSince(isoTimestamp: string): number;
}

export interface IEmailOutboxRepository {
  insert(input: CreateEmailOutboxInput): EmailOutboxItem;
  list(ctx: TenantContext, filter: EmailOutboxListFilter): { items: EmailOutboxItem[]; total: number };
  updateDeliveryStatus(
    id: string,
    patch: { status: EmailOutboxStatus; attempts: number; nextAttemptAt: string | null; lastError: string | null },
  ): void;
  countQueuedOrFailed(): number;
}

// --- Milestone 2 Repository Interfaces ---

export interface SiteListFilter {
  q?: string;
  page: number;
  pageSize: number;
  sortField: string;
  sortDir: 'asc' | 'desc';
}

export interface CreateSiteInput {
  id: string;
  tenantId: string;
  name: string;
  location: string;
}

export interface ISiteRepository {
  list(ctx: TenantContext, filter: SiteListFilter): { items: Site[]; total: number };
  listAllInTenant(ctx: TenantContext, tenantId: string): Site[];
  findById(ctx: TenantContext, id: string): Site | null;
  findByNameInTenant(ctx: TenantContext, tenantId: string, name: string): Site | null;
  create(ctx: TenantContext, input: CreateSiteInput): Site;
  update(ctx: TenantContext, id: string, patch: { name?: string; location?: string }): Site | null;
  delete(ctx: TenantContext, id: string): boolean;
}

export interface DeviceModelListFilter {
  q?: string;
  page: number;
  pageSize: number;
  sortField: string;
  sortDir: 'asc' | 'desc';
}

export interface CreateDeviceModelInput {
  id: string;
  name: string;
  manufacturer: string;
  hardwareRevision: string;
  metrics: MetricDefinition[];
  supportedFirmwareFamily: string;
}

export interface UpdateDeviceModelInput {
  name?: string;
  manufacturer?: string;
  hardwareRevision?: string;
  metrics?: MetricDefinition[];
  supportedFirmwareFamily?: string;
}

export interface IDeviceModelRepository {
  list(filter: DeviceModelListFilter): { items: DeviceModel[]; total: number };
  listAll(): DeviceModel[];
  findById(id: string): DeviceModel | null;
  findByName(name: string): DeviceModel | null;
  create(input: CreateDeviceModelInput): DeviceModel;
  update(id: string, patch: UpdateDeviceModelInput): DeviceModel | null;
  countAll(): number;
}

export interface DeviceRecord extends DevicePublic {
  apiKeyHash: string | null;
}

export function toDevicePublic(record: DeviceRecord): DevicePublic {
  const { apiKeyHash: _omit, ...pub } = record;
  return pub;
}

export interface DeviceListFilter {
  q?: string;
  siteId?: string;
  modelId?: string;
  state?: DeviceLifecycleState;
  connectivity?: DeviceConnectivity;
  tag?: string;
  firmwareVersion?: string;
  page: number;
  pageSize: number;
  sortField: string;
  sortDir: 'asc' | 'desc';
}

export interface CreateDeviceInput {
  id: string;
  tenantId: string;
  siteId: string;
  modelId: string;
  name: string;
  serialNumber: string;
  hardwareId: string;
  tags: string[];
  state?: DeviceLifecycleState;
  connectivity?: DeviceConnectivity;
  lastSeenAt?: string | null;
  firmwareVersion?: string | null;
  apiKeyHash: string | null;
  apiKeyLast4: string | null;
  config?: DeviceConfigState;
  latestMetrics?: Record<string, number | boolean | string>;
  latestHealth?: DeviceHealthSnapshot;
  decommissionedAt?: string | null;
  decommissionReason?: string | null;
}

export interface CreateDeviceHistoryInput {
  id: string;
  tenantId: string;
  deviceId: string;
  from: DeviceLifecycleState | null;
  to: DeviceLifecycleState;
  reason: string;
  actorId: string;
  at: string;
}

export interface ConnectivityEventRecord {
  id: string;
  tenantId: string;
  deviceId: string;
  state: 'ONLINE' | 'OFFLINE';
  at: string;
}

export interface IDeviceRepository {
  list(ctx: TenantContext, filter: DeviceListFilter): { items: DevicePublic[]; total: number };
  listDistinctTags(ctx: TenantContext): string[];
  findById(ctx: TenantContext, id: string): DeviceRecord | null;
  findBySerialSystem(serialNumber: string): { deviceId: string; tenantId: string } | null;
  findByHardwareIdSystem(hardwareId: string): { deviceId: string; tenantId: string } | null;
  createWithUniqueKeys(
    ctx: TenantContext,
    input: CreateDeviceInput,
    history: CreateDeviceHistoryInput,
  ): DeviceRecord;
  update(
    ctx: TenantContext,
    id: string,
    patch: { name?: string; siteId?: string; tags?: string[] },
  ): DeviceRecord | null;
  updateApiKey(
    ctx: TenantContext,
    id: string,
    apiKeyHash: string | null,
    apiKeyLast4: string | null,
  ): DeviceRecord | null;
  transitionState(
    ctx: TenantContext,
    id: string,
    patch: {
      state: DeviceLifecycleState;
      decommissionedAt?: string | null;
      decommissionReason?: string | null;
      revokeKey?: boolean;
    },
    history: CreateDeviceHistoryInput,
  ): DeviceRecord | null;
  listStateHistory(ctx: TenantContext, deviceId: string): DeviceStateHistoryItem[];
  listConnectivityEvents(ctx: TenantContext, deviceId: string): ConnectivityEventRecord[];
  insertConnectivityEvent(input: ConnectivityEventRecord): void;
  setSimulatorCredential(deviceId: string, tenantId: string, apiKey: string): void;
  deleteSimulatorCredential(deviceId: string): void;
  countByTenant(): Map<string, { total: number; online: number; active: number }>;
  countByStateGlobal(): Record<DeviceLifecycleState, number>;
  countDevicesInSite(siteId: string): number;
}

