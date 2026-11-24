import type {
  AlertOperator,
  AlertPublic,
  AlertRecipient,
  AlertRule,
  AlertRuleKind,
  AlertScopeType,
  AlertSeverity,
  AlertStatus,
  AuditLog,
  AuditOutcome,
  ConfigProfilePublic,
  ConfigProfileVersion,
  DeviceCommandPublic,
  DeviceCommandType,
  DeviceConfigState,
  DeviceConnectivity,
  DeviceHealthSnapshot,
  DeviceLifecycleState,
  DeviceModel,
  DevicePublic,
  DeviceStateHistoryItem,
  EmailOutboxItem,
  EmailOutboxStatus,
  FirmwarePackagePublic,
  FirmwareStatus,
  MaintenancePlanPublic,
  MaintenancePlanTemplate,
  MaintenanceScopeType,
  MetricDefinition,
  NotificationItem,
  RoleCode,
  RolloutCounts,
  RolloutJobPublic,
  RolloutJobStatus,
  RolloutPublic,
  RolloutStatus,
  RolloutTargetType,
  Site,
  TelemetrySample,
  Tenant,
  TenantSettings,
  TenantStatus,
  TicketComment,
  TicketPriority,
  TicketPublic,
  TicketSource,
  TicketStatus,
  UserPublic,
  UserStatus,
  WorkOrderApprovalStatus,
  WorkOrderChecklistItem,
  WorkOrderCompletion,
  WorkOrderPublic,
  WorkOrderStatus,
  WorkOrderType,
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
  listAllActiveSystem(): UserRecord[];
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
  listDueQueuedSystem(nowIso: string, limit?: number): EmailOutboxItem[];
  findByIdSystem(id: string): EmailOutboxItem | null;
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
  listSimulatorCredentialsSystem(tenantIds?: string[] | null): SimulatorCredentialRecord[];
  findByIdSystem(id: string): DeviceRecord | null;
  listAllSystem(): DeviceRecord[];
  listAllInScope(ctx: TenantContext, useActiveTenant?: boolean): DevicePublic[];
  activateFromHandshakeSystem(
    deviceId: string,
    patch: { firmwareVersion: string; lastSeenAt: string },
    history?: CreateDeviceHistoryInput | null,
  ): DeviceRecord | null;
  updateConnectivitySystem(
    deviceId: string,
    connectivity: DeviceConnectivity,
    lastSeenAt?: string | null,
  ): void;
  updateDebouncedLiveSnapshotSystem(
    deviceId: string,
    patch: {
      lastSeenAt: string | null;
      latestMetrics: Record<string, number | boolean | string>;
      latestHealth: DeviceHealthSnapshot;
    },
  ): void;
  incrementInvalidPayloadCountSystem(deviceId: string): number;
  updateConfigStatusSystem(
    deviceId: string,
    patch: { version: number; status: 'APPLIED' | 'FAILED'; error: string | null },
  ): DeviceRecord | null;
  assignConfigSystem(
    deviceId: string,
    config: DeviceConfigState,
  ): DeviceRecord | null;
  updateFirmwareVersionSystem(deviceId: string, firmwareVersion: string): DeviceRecord | null;
  listDistinctModelIdsInTenantSystem(tenantId: string): string[];
  countByTenant(): Map<string, { total: number; online: number; active: number }>;
  countByStateGlobal(): Record<DeviceLifecycleState, number>;
  countDevicesInSite(siteId: string): number;
}

// --- Milestone 3 Repository Interfaces ---

export interface SimulatorCredentialRecord {
  deviceId: string;
  tenantId: string;
  apiKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface TelemetryBucketRecord {
  id: string;
  tenantId: string;
  deviceId: string;
  bucketStart: string;
  samples: TelemetrySample[];
  updatedAt: string;
}

export interface ITelemetryRepository {
  upsertBucketSamples(
    bucketId: string,
    tenantId: string,
    deviceId: string,
    bucketStart: string,
    newSamples: TelemetrySample[],
  ): void;
  bulkUpsertBuckets(
    entries: Array<{
      bucketId: string;
      tenantId: string;
      deviceId: string;
      bucketStart: string;
      samples: TelemetrySample[];
    }>,
  ): void;
  queryBucketsInRange(
    ctx: TenantContext,
    deviceId: string,
    tenantId: string,
    fromIso: string,
    toIso: string,
  ): TelemetryBucketRecord[];
  deleteBucketsOlderThan(cutoffIso: string): number;
  countBuckets(): number;
}

export interface CreateDeviceCommandInput {
  id: string;
  tenantId: string;
  deviceId: string;
  type: DeviceCommandType;
  payload?: Record<string, unknown>;
  createdBy: string;
}

export interface IDeviceCommandRepository {
  create(ctx: TenantContext, input: CreateDeviceCommandInput): DeviceCommandPublic;
  listByDevice(ctx: TenantContext, deviceId: string, tenantId: string): DeviceCommandPublic[];
  listPendingForDeviceSystem(deviceId: string): DeviceCommandPublic[];
  markDeliveredSystem(commandIds: string[], deliveredAt: string): void;
  ackSystem(
    deviceId: string,
    commandId: string,
    status: 'ACKED' | 'FAILED',
    ackedAt: string,
  ): DeviceCommandPublic | null;
  ackPendingApplyConfigSystem(
    deviceId: string,
    status: 'ACKED' | 'FAILED',
    ackedAt: string,
  ): number;
  cancelPendingForDeviceSystem(deviceId: string): number;
}

// --- Milestone 4 Repository Interfaces ---

export interface AlertRuleListFilter {
  q?: string;
  kind?: AlertRuleKind;
  severity?: AlertSeverity;
  scopeType?: AlertScopeType;
  enabled?: boolean;
  page: number;
  pageSize: number;
}

export interface CreateAlertRuleInput {
  id: string;
  tenantId: string;
  name: string;
  kind: AlertRuleKind;
  metricKey: string | null;
  operator: AlertOperator | null;
  threshold: number | null;
  durationSec: number;
  severity: AlertSeverity;
  scopeType: AlertScopeType;
  scopeId: string;
  recipients: AlertRecipient[];
  enabled: boolean;
}

export interface UpdateAlertRuleInput {
  name?: string;
  kind?: AlertRuleKind;
  metricKey?: string | null;
  operator?: AlertOperator | null;
  threshold?: number | null;
  durationSec?: number;
  severity?: AlertSeverity;
  scopeType?: AlertScopeType;
  scopeId?: string;
  recipients?: AlertRecipient[];
  enabled?: boolean;
}

export interface IAlertRuleRepository {
  list(ctx: TenantContext, filter: AlertRuleListFilter): { items: AlertRule[]; total: number };
  findById(ctx: TenantContext, id: string): AlertRule | null;
  findByIdSystem(id: string): AlertRule | null;
  listEnabledByTenantSystem(tenantId: string): AlertRule[];
  listEnabledOfflineRulesSystem(): AlertRule[];
  create(ctx: TenantContext, input: CreateAlertRuleInput): AlertRule;
  update(ctx: TenantContext, id: string, patch: UpdateAlertRuleInput): AlertRule | null;
  delete(ctx: TenantContext, id: string): boolean;
}

export interface AlertListFilter {
  q?: string;
  severity?: AlertSeverity;
  status?: AlertStatus;
  deviceId?: string;
  siteId?: string;
  page: number;
  pageSize: number;
}

export interface CreateAlertInput {
  id: string;
  tenantId: string;
  ruleId: string | null;
  deviceId: string;
  severity: AlertSeverity;
  status?: AlertStatus;
  message: string;
  snapshot: Record<string, unknown>;
  acknowledgedBy?: string | null;
  acknowledgedAt?: string | null;
  ticketId?: string | null;
  escalationLevel?: 0 | 1 | 2;
  escalatedAt?: string | null;
  emailDeliveryFailed?: boolean;
  closedAt?: string | null;
  closedBy?: string | null;
  closeReason?: string | null;
  createdAt?: string;
}

export interface IAlertRepository {
  list(ctx: TenantContext, filter: AlertListFilter, useActiveTenant?: boolean): { items: AlertPublic[]; total: number };
  findById(ctx: TenantContext, id: string): AlertPublic | null;
  findByIdSystem(id: string): AlertPublic | null;
  findActiveByDeviceAndRuleSystem(deviceId: string, ruleId: string): AlertPublic | null;
  createSystem(input: CreateAlertInput): AlertPublic;
  acknowledge(ctx: TenantContext, id: string, actorId: string, ackedAt: string): AlertPublic | null;
  close(ctx: TenantContext, id: string, actorId: string, reason: string, closedAt: string): AlertPublic | null;
  setTicketId(ctx: TenantContext, id: string, ticketId: string): AlertPublic | null;
  closeByTicketSystem(id: string, actorId: string, reason: string, closedAt: string): AlertPublic | null;
  updateEscalationSystem(id: string, level: 1 | 2, escalatedAt: string): AlertPublic | null;
  markEmailDeliveryFailedSystem(id: string): void;
  listOpenCriticalForEscalationSystem(): AlertPublic[];
  listByDevice(ctx: TenantContext, deviceId: string, limit?: number): AlertPublic[];
  countActiveByTenant(tenantId: string): { critical: number; warning: number; total: number };
  countActiveBySiteForTenant(tenantId: string): Map<string, number>;
  countActiveByTenantIds(tenantIds: string[] | null): Map<string, { critical: number; warning: number; total: number }>;
  countOpenCriticalGlobal(): number;
  listOpenCriticalInScope(ctx: TenantContext, limit?: number): AlertPublic[];
}

export interface CreateNotificationInput {
  id: string;
  tenantId: string | null;
  userId: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  read?: boolean;
  createdAt?: string;
}

export interface INotificationRepository {
  insertSystem(input: CreateNotificationInput): NotificationItem;
  listForUser(
    userId: string,
    filter: { unreadOnly?: boolean; page: number; pageSize: number },
  ): { items: NotificationItem[]; total: number; unreadCount: number };
  markReadForUser(userId: string, id: string): NotificationItem | null;
  markAllReadForUser(userId: string): number;
}

// --- Milestone 5 Repository Interfaces: Tickets, Work Orders, Maintenance Plans ---

export interface TicketListFilter {
  q?: string;
  status?: TicketStatus;
  priority?: TicketPriority;
  source?: TicketSource;
  assigneeId?: string;
  deviceId?: string;
  siteId?: string;
  page: number;
  pageSize: number;
}

export interface CreateTicketInput {
  id: string;
  number?: string;
  tenantId: string;
  deviceId: string | null;
  siteId: string | null;
  source: TicketSource;
  alertId: string | null;
  title: string;
  description: string;
  priority: TicketPriority;
  status?: TicketStatus;
  assigneeId: string | null;
  createdBy: string;
  rootCause?: string | null;
  resolutionNotes?: string | null;
  resolvedAt?: string | null;
  closedAt?: string | null;
  closeReason?: string | null;
  comments?: TicketComment[];
  createdAt?: string;
}

export interface UpdateTicketInput {
  assigneeId?: string | null;
  priority?: TicketPriority;
  status?: TicketStatus;
  rootCause?: string | null;
  resolutionNotes?: string | null;
  resolvedAt?: string | null;
  closedAt?: string | null;
  closeReason?: string | null;
  comments?: TicketComment[];
}

export interface ITicketRepository {
  nextNumber(): string;
  list(ctx: TenantContext, filter: TicketListFilter, useActiveTenant?: boolean): { items: TicketPublic[]; total: number };
  findById(ctx: TenantContext, id: string): TicketPublic | null;
  findByIdSystem(id: string): TicketPublic | null;
  findByAlertIdSystem(alertId: string): TicketPublic | null;
  create(ctx: TenantContext, input: CreateTicketInput): TicketPublic;
  createSystem(input: CreateTicketInput): TicketPublic;
  update(ctx: TenantContext, id: string, patch: UpdateTicketInput): TicketPublic | null;
  appendCommentSystem(id: string, comment: TicketComment, nextStatus?: TicketStatus): TicketPublic | null;
  listByDevice(ctx: TenantContext, deviceId: string, limit?: number): TicketPublic[];
  countOpenByTenant(tenantId: string): number;
  countOpenByTenantIds(tenantIds: string[] | null): Map<string, number>;
  listWaitingInScope(ctx: TenantContext, limit?: number): TicketPublic[];
}

export interface WorkOrderListFilter {
  q?: string;
  status?: WorkOrderStatus;
  type?: WorkOrderType;
  approvalStatus?: WorkOrderApprovalStatus;
  assignedTo?: string;
  deviceId?: string;
  ticketId?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

export interface CreateWorkOrderInput {
  id: string;
  number?: string;
  tenantId: string;
  deviceId: string;
  ticketId: string | null;
  planId: string | null;
  type: WorkOrderType;
  title: string;
  instructions: string;
  checklist: WorkOrderChecklistItem[];
  assignedTo: string | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  downtimeRequired: boolean;
  approvalStatus: WorkOrderApprovalStatus;
  approvalNote?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  status: WorkOrderStatus;
  startedAt?: string | null;
  completedAt?: string | null;
  completion?: WorkOrderCompletion | null;
  createdBy: string;
  createdAt?: string;
}

export interface UpdateWorkOrderInput {
  title?: string;
  instructions?: string;
  checklist?: WorkOrderChecklistItem[];
  assignedTo?: string | null;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  downtimeRequired?: boolean;
  approvalStatus?: WorkOrderApprovalStatus;
  approvalNote?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  status?: WorkOrderStatus;
  startedAt?: string | null;
  completedAt?: string | null;
  completion?: WorkOrderCompletion | null;
}

export interface IWorkOrderRepository {
  nextNumber(): string;
  list(ctx: TenantContext, filter: WorkOrderListFilter, useActiveTenant?: boolean): { items: WorkOrderPublic[]; total: number };
  findById(ctx: TenantContext, id: string): WorkOrderPublic | null;
  findByIdSystem(id: string): WorkOrderPublic | null;
  create(ctx: TenantContext, input: CreateWorkOrderInput): WorkOrderPublic;
  createSystem(input: CreateWorkOrderInput): WorkOrderPublic;
  update(ctx: TenantContext, id: string, patch: UpdateWorkOrderInput): WorkOrderPublic | null;
  listByDevice(ctx: TenantContext, deviceId: string, limit?: number): WorkOrderPublic[];
  listByTicket(ctx: TenantContext, ticketId: string): WorkOrderPublic[];
  countTodayByTenant(tenantId: string, dayStartIso: string, dayEndIso: string): number;
  countTodayByTenantIds(tenantIds: string[] | null, dayStartIso: string, dayEndIso: string): Map<string, number>;
  countPendingApprovalsByTenant(tenantId: string): number;
  listOverdueInScope(ctx: TenantContext, nowIso: string, limit?: number): WorkOrderPublic[];
}

export interface MaintenancePlanListFilter {
  q?: string;
  enabled?: boolean;
  page: number;
  pageSize: number;
}

export interface CreateMaintenancePlanInput {
  id: string;
  tenantId: string;
  name: string;
  scopeType: MaintenanceScopeType;
  scopeValue: string;
  everyDays: number;
  nextRunAt: string;
  lastRunAt?: string | null;
  template: MaintenancePlanTemplate;
  assignedTo: string | null;
  enabled: boolean;
  createdBy: string;
  createdAt?: string;
}

export interface UpdateMaintenancePlanInput {
  name?: string;
  scopeType?: MaintenanceScopeType;
  scopeValue?: string;
  everyDays?: number;
  nextRunAt?: string;
  lastRunAt?: string | null;
  template?: MaintenancePlanTemplate;
  assignedTo?: string | null;
  enabled?: boolean;
}

export interface IMaintenancePlanRepository {
  list(ctx: TenantContext, filter: MaintenancePlanListFilter): { items: MaintenancePlanPublic[]; total: number };
  findById(ctx: TenantContext, id: string): MaintenancePlanPublic | null;
  create(ctx: TenantContext, input: CreateMaintenancePlanInput): MaintenancePlanPublic;
  update(ctx: TenantContext, id: string, patch: UpdateMaintenancePlanInput): MaintenancePlanPublic | null;
  delete(ctx: TenantContext, id: string): boolean;
  listDueEnabledSystem(nowIso: string): MaintenancePlanPublic[];
  advanceRunSystem(id: string, lastRunAt: string, nextRunAt: string): void;
}

// --- Milestone 6 Repository Interfaces: Config Profiles, Firmware, Rollouts ---

export interface ConfigProfileListFilter {
  q?: string;
  modelId?: string;
  page: number;
  pageSize: number;
}

export interface CreateConfigProfileInput {
  id: string;
  tenantId: string;
  modelId: string;
  name: string;
  payload: Record<string, unknown>;
  createdBy: string;
  versionId: string;
  createdAt?: string;
}

export interface IConfigProfileRepository {
  list(ctx: TenantContext, filter: ConfigProfileListFilter): { items: ConfigProfilePublic[]; total: number };
  findById(ctx: TenantContext, id: string): ConfigProfilePublic | null;
  findByIdSystem(id: string): ConfigProfilePublic | null;
  findVersionSystem(profileId: string, version: number): ConfigProfileVersion | null;
  listVersions(ctx: TenantContext, profileId: string): ConfigProfileVersion[];
  create(ctx: TenantContext, input: CreateConfigProfileInput): ConfigProfilePublic;
  updateAndIncrementVersion(
    ctx: TenantContext,
    id: string,
    patch: { name?: string; payload?: Record<string, unknown>; actorId: string; versionId: string },
  ): ConfigProfilePublic | null;
}

export interface FirmwareRecord extends FirmwarePackagePublic {
  fileRef: string;
}

export function toFirmwarePublic(record: FirmwareRecord): FirmwarePackagePublic {
  const { fileRef: _omit, ...pub } = record;
  return pub;
}

export interface FirmwareListFilter {
  q?: string;
  modelId?: string;
  status?: FirmwareStatus;
  onlyReleased?: boolean;
  allowedModelIds?: string[] | null;
  page: number;
  pageSize: number;
}

export interface CreateFirmwareInput {
  id: string;
  modelId: string;
  version: string;
  releaseNotes: string;
  checksumSha256: string;
  sizeBytes: number;
  fileRef: string;
  status?: FirmwareStatus;
  uploadedBy: string;
  createdAt?: string;
}

export interface IFirmwareRepository {
  list(filter: FirmwareListFilter): { items: FirmwarePackagePublic[]; total: number };
  findById(id: string): FirmwareRecord | null;
  findByModelAndVersion(modelId: string, version: string): FirmwareRecord | null;
  create(input: CreateFirmwareInput): FirmwareRecord;
  updateStatus(id: string, status: FirmwareStatus): FirmwareRecord | null;
}

export interface RolloutListFilter {
  q?: string;
  status?: RolloutStatus;
  modelId?: string;
  page: number;
  pageSize: number;
}

export interface CreateRolloutInput {
  id: string;
  tenantId: string;
  firmwareId: string;
  modelId: string;
  targetType: RolloutTargetType;
  targetValue: string;
  scheduledAt: string | null;
  status: RolloutStatus;
  createdBy: string;
  decidedBy?: string | null;
  decisionReason?: string | null;
  counts: RolloutCounts;
  createdAt?: string;
}

export interface CreateRolloutJobInput {
  id: string;
  tenantId: string;
  rolloutId: string;
  deviceId: string;
  fromVersion: string | null;
  toVersion: string;
  status?: RolloutJobStatus;
  errorCode?: string | null;
  createdAt?: string;
}

export interface IRolloutRepository {
  list(ctx: TenantContext, filter: RolloutListFilter, useActiveTenant?: boolean): { items: RolloutPublic[]; total: number };
  findById(ctx: TenantContext, id: string): RolloutPublic | null;
  findByIdSystem(id: string): RolloutPublic | null;
  createWithJobs(
    ctx: TenantContext,
    rollout: CreateRolloutInput,
    jobs: CreateRolloutJobInput[],
  ): { rollout: RolloutPublic; jobs: RolloutJobPublic[] };
  createWithJobsSystem(
    rollout: CreateRolloutInput,
    jobs: CreateRolloutJobInput[],
  ): { rollout: RolloutPublic; jobs: RolloutJobPublic[] };
  updateStatusAndDecision(
    id: string,
    patch: {
      status: RolloutStatus;
      decidedBy?: string | null;
      decisionReason?: string | null;
      counts?: RolloutCounts;
    },
  ): RolloutPublic | null;
  updateCountsSystem(id: string, counts: RolloutCounts, nextStatus?: RolloutStatus): RolloutPublic | null;
  listJobsByRollout(ctx: TenantContext, rolloutId: string): RolloutJobPublic[];
  listJobsByRolloutSystem(rolloutId: string): RolloutJobPublic[];
  listJobsByDevice(ctx: TenantContext, deviceId: string, limit?: number): RolloutJobPublic[];
  findJobByIdSystem(jobId: string): RolloutJobPublic | null;
  findDevicesWithActiveJobsInTenantSystem(tenantId: string): Set<string>;
  findQueuedJobForRunningRolloutSystem(deviceId: string): {
    job: RolloutJobPublic;
    rollout: RolloutPublic;
    firmware: FirmwareRecord;
  } | null;
  findActiveJobForDeviceAndFirmwareSystem(deviceId: string, firmwareId: string): {
    job: RolloutJobPublic;
    rollout: RolloutPublic;
  } | null;
  updateJobStatusSystem(
    jobId: string,
    status: RolloutJobStatus,
    errorCode?: string | null,
  ): RolloutJobPublic | null;
  cancelQueuedJobsForRolloutSystem(rolloutId: string): number;
  cancelQueuedJobsForDeviceSystem(deviceId: string): string[];
  listDuePendingRolloutsSystem(nowIso: string): RolloutPublic[];
  countPendingApprovalsByTenant(tenantId: string): number;
}



