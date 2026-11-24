// Shared domain types, enums, and API contracts for OmniSphere (Client & Server)

export type RoleCode =
  | 'PLATFORM_ADMIN'
  | 'SUPPORT_ENGINEER'
  | 'FIELD_TECHNICIAN'
  | 'CLIENT_ADMIN'
  | 'CLIENT_MANAGER'
  | 'CLIENT_OPERATOR';

export const ALL_ROLES: readonly RoleCode[] = [
  'PLATFORM_ADMIN',
  'SUPPORT_ENGINEER',
  'FIELD_TECHNICIAN',
  'CLIENT_ADMIN',
  'CLIENT_MANAGER',
  'CLIENT_OPERATOR',
] as const;

export const PROVIDER_ROLES: readonly RoleCode[] = [
  'PLATFORM_ADMIN',
  'SUPPORT_ENGINEER',
  'FIELD_TECHNICIAN',
] as const;

export const CLIENT_ROLES: readonly RoleCode[] = [
  'CLIENT_ADMIN',
  'CLIENT_MANAGER',
  'CLIENT_OPERATOR',
] as const;

export const ROLE_LABELS: Record<RoleCode, string> = {
  PLATFORM_ADMIN: 'Platform Admin',
  SUPPORT_ENGINEER: 'Support / NOC Engineer',
  FIELD_TECHNICIAN: 'Field Technician',
  CLIENT_ADMIN: 'Client Admin',
  CLIENT_MANAGER: 'Client Manager',
  CLIENT_OPERATOR: 'Client Operator',
};

export const ROLE_SHORT_LABELS: Record<RoleCode, string> = {
  PLATFORM_ADMIN: 'PA',
  SUPPORT_ENGINEER: 'SE',
  FIELD_TECHNICIAN: 'FT',
  CLIENT_ADMIN: 'CA',
  CLIENT_MANAGER: 'CM',
  CLIENT_OPERATOR: 'CO',
};

export const ROLE_HOME_PATHS: Record<RoleCode, string> = {
  PLATFORM_ADMIN: '/platform',
  SUPPORT_ENGINEER: '/noc',
  FIELD_TECHNICIAN: '/my-work-orders',
  CLIENT_ADMIN: '/dashboard',
  CLIENT_MANAGER: '/dashboard',
  CLIENT_OPERATOR: '/live-status',
};

export type TenantStatus = 'ACTIVE' | 'SUSPENDED';
export type UserStatus = 'ACTIVE' | 'INACTIVE';
export type AuditOutcome = 'SUCCESS' | 'FAILURE';
export type EmailOutboxStatus = 'QUEUED' | 'SENT' | 'FAILED';

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_TRANSITION'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export interface ApiErrorResponse {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface TenantSettings {
  heartbeatIntervalSec: number;
  offlineAfterMissedIntervals: number;
  criticalAckMinutes: number;
  requireRolloutApproval: boolean;
  requireMaintenanceApproval: boolean;
}

export const DEFAULT_TENANT_SETTINGS: TenantSettings = {
  heartbeatIntervalSec: 30,
  offlineAfterMissedIntervals: 3,
  criticalAckMinutes: 15,
  requireRolloutApproval: false,
  requireMaintenanceApproval: true,
};

export interface Tenant {
  id: string;
  name: string;
  code: string;
  status: TenantStatus;
  contactEmail: string;
  settings: TenantSettings;
  createdAt: string;
  updatedAt: string;
}

export interface TenantSummary extends Tenant {
  userCount: number;
  activeUserCount: number;
  deviceCount: number;
  onlinePercentage: number | null;
}

export interface UserPublic {
  id: string;
  email: string;
  name: string;
  role: RoleCode;
  tenantId: string | null;
  tenantName?: string | null;
  tenantCode?: string | null;
  assignedTenantIds: string[];
  isSupervisor: boolean;
  status: UserStatus;
  failedLogins: number;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLog {
  id: string;
  at: string;
  actorId: string;
  actorName?: string | null;
  actorEmail?: string | null;
  actorRole: RoleCode | 'SYSTEM' | 'ANONYMOUS';
  tenantId: string | null;
  tenantCode?: string | null;
  action: string;
  targetType: string;
  targetId: string;
  outcome: AuditOutcome;
  ip: string;
  details: Record<string, unknown>;
}

export interface EmailOutboxItem {
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
  createdAt: string;
  updatedAt: string;
}

export interface DemoAccount {
  email: string;
  name: string;
  role: RoleCode;
  roleLabel: string;
  tenantCode: string | null;
  tenantName: string | null;
}

export interface AuthSessionResponse {
  token: string;
  user: UserPublic;
  tenants: Tenant[];
  demoMode: boolean;
}

export interface AuthMeResponse {
  user: UserPublic;
  tenants: Tenant[];
  demoMode: boolean;
}

export interface PlatformOverviewResponse {
  counts: {
    tenantsTotal: number;
    tenantsActive: number;
    tenantsSuspended: number;
    usersTotal: number;
    usersActive: number;
    providerStaffCount: number;
    devicesTotal: number;
    devicesByState: Record<DeviceLifecycleState, number>;
    deviceModelsTotal: number;
    messagesPerMinute: number;
    invalidPayloadRate: number;
    openCriticalAlerts: number;
    auditEventsLast24h: number;
    emailsQueuedOrFailed: number;
  };
  tenants: TenantSummary[];
  demoMode: boolean;
}

// --- Milestone 2: Sites, Device Models, Devices & Lifecycle ---

export type DeviceLifecycleState =
  | 'PROVISIONED'
  | 'ACTIVE'
  | 'UNDER_MAINTENANCE'
  | 'SUSPENDED'
  | 'DECOMMISSIONED';

export const ALL_DEVICE_STATES: readonly DeviceLifecycleState[] = [
  'PROVISIONED',
  'ACTIVE',
  'UNDER_MAINTENANCE',
  'SUSPENDED',
  'DECOMMISSIONED',
] as const;

export type DeviceConnectivity = 'ONLINE' | 'OFFLINE' | 'UNKNOWN';

export type DeviceConfigStatus = 'NONE' | 'PENDING' | 'APPLIED' | 'FAILED';

export type DeviceLifecycleAction =
  | 'SUSPEND'
  | 'RESUME'
  | 'SET_UNDER_MAINTENANCE'
  | 'SET_ACTIVE'
  | 'DECOMMISSION';

export type MetricValueType = 'number' | 'boolean' | 'string';

export interface MetricDefinition {
  key: string;
  label: string;
  type: MetricValueType;
  unit: string;
  min: number | null;
  max: number | null;
}

export interface Site {
  id: string;
  tenantId: string;
  name: string;
  location: string;
  deviceCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DeviceModel {
  id: string;
  name: string;
  manufacturer: string;
  hardwareRevision: string;
  metrics: MetricDefinition[];
  supportedFirmwareFamily: string;
  deviceCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DeviceConfigState {
  profileId: string | null;
  version: number | null;
  status: DeviceConfigStatus;
  error: string | null;
}

export interface DeviceHealthSnapshot {
  cpuLoad?: number;
  memoryUsage?: number;
  batteryLevel?: number | null;
  signalStrength?: number;
  uptimeSec?: number;
}

export interface DevicePublic {
  id: string;
  tenantId: string;
  tenantCode?: string;
  tenantName?: string;
  siteId: string;
  siteName?: string;
  modelId: string;
  modelName?: string;
  name: string;
  serialNumber: string;
  hardwareId: string;
  tags: string[];
  state: DeviceLifecycleState;
  connectivity: DeviceConnectivity;
  lastSeenAt: string | null;
  firmwareVersion: string | null;
  apiKeyLast4: string | null;
  config: DeviceConfigState;
  latestMetrics: Record<string, number | boolean | string>;
  latestHealth: DeviceHealthSnapshot;
  invalidPayloadCount: number;
  decommissionedAt: string | null;
  decommissionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeviceDetail extends DevicePublic {
  model: DeviceModel | null;
  site: Site | null;
  allowedTransitions: DeviceLifecycleState[];
  configProfileName?: string | null;
  configProfilePayload?: Record<string, unknown> | null;
  recentConfigCommands?: DeviceCommandPublic[];
  recentRolloutJobs?: RolloutJobPublic[];
}

export interface DeviceProvisioningPayload {
  deviceId: string;
  apiKey: string;
  apiBaseUrl: string;
  modelId: string;
  tenantCode: string;
}

export interface DeviceRegistrationResponse {
  device: DevicePublic;
  provisioning: DeviceProvisioningPayload;
}

export interface DeviceImportRowInput {
  rowNumber: number;
  serialNumber: string;
  hardwareId: string;
  model: string;
  site: string;
  tags?: string;
  name?: string;
}

export interface DeviceImportRowResult {
  rowNumber: number;
  serialNumber: string;
  hardwareId: string;
  name: string;
  modelName: string | null;
  siteName: string | null;
  tags: string[];
  valid: boolean;
  errors: string[];
  createdDeviceId?: string;
}

export interface DeviceImportResponse {
  dryRun: boolean;
  totalRows: number;
  validCount: number;
  createdCount: number;
  errorCount: number;
  rows: DeviceImportRowResult[];
  provisioningFiles: DeviceProvisioningPayload[];
}

export interface DeviceStateHistoryItem {
  id: string;
  tenantId: string;
  deviceId: string;
  from: DeviceLifecycleState | null;
  to: DeviceLifecycleState;
  reason: string;
  actorId: string;
  actorName?: string | null;
  at: string;
}

export interface DeviceTimelineEvent {
  id: string;
  kind:
    | 'STATE_CHANGE'
    | 'CONNECTIVITY'
    | 'CONFIG'
    | 'FIRMWARE'
    | 'ALERT'
    | 'TICKET'
    | 'WORK_ORDER'
    | 'AUDIT';
  at: string;
  title: string;
  description: string;
  actorId: string;
  actorName?: string | null;
  metadata?: Record<string, unknown>;
}

export interface BulkDeviceActionResult {
  succeededCount: number;
  failedCount: number;
  results: Array<{
    deviceId: string;
    deviceName?: string;
    ok: boolean;
    error?: string;
  }>;
}

// --- Milestone 3: Device API, Telemetry, Fleet Dashboards & Simulator ---

export type TelemetryRange = '15m' | '1h' | '24h' | '7d';

export type DeviceCommandType = 'APPLY_CONFIG' | 'RESTART';
export type DeviceCommandStatus = 'PENDING' | 'DELIVERED' | 'ACKED' | 'FAILED';

export interface DeviceCommandPublic {
  id: string;
  tenantId: string;
  deviceId: string;
  type: DeviceCommandType;
  payload: Record<string, unknown>;
  status: DeviceCommandStatus;
  createdBy: string;
  deliveredAt: string | null;
  ackedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TelemetrySample {
  ts: string;
  receivedAt?: string;
  metrics: Record<string, number | boolean | string>;
  health?: DeviceHealthSnapshot;
}

export interface TelemetryPoint {
  ts: string;
  value: number | boolean | string | null;
}

export interface DeviceLiveState {
  deviceId: string;
  tenantId: string;
  state: DeviceLifecycleState;
  connectivity: DeviceConnectivity;
  lastSeenAt: string | null;
  firmwareVersion: string | null;
  latestMetrics: Record<string, number | boolean | string>;
  latestHealth: DeviceHealthSnapshot;
  invalidPayloadCount: number;
}

export interface DeviceTelemetryResponse {
  deviceId: string;
  range: TelemetryRange;
  from: string;
  to: string;
  metrics: MetricDefinition[];
  series: Record<string, TelemetryPoint[]>;
  healthSeries: {
    cpuLoad: TelemetryPoint[];
    memoryUsage: TelemetryPoint[];
    batteryLevel: TelemetryPoint[];
    signalStrength: TelemetryPoint[];
  };
}

export interface FleetSiteBreakdown {
  siteId: string;
  siteName: string;
  location: string;
  deviceCount: number;
  onlineCount: number;
  offlineCount: number;
  openAlertCount: number;
}

export interface FleetModelBreakdown {
  modelId: string;
  modelName: string;
  deviceCount: number;
  onlineCount: number;
}

export interface FleetFirmwareDistributionItem {
  modelId: string;
  modelName: string;
  firmwareVersion: string;
  count: number;
}

export interface FleetSummaryResponse {
  tenantId: string;
  tenantName: string;
  tenantCode: string;
  totalDevices: number;
  onlineCount: number;
  offlineCount: number;
  onlinePercentage: number;
  activeAlertsCritical: number;
  activeAlertsWarning: number;
  openTickets: number;
  workOrdersToday: number;
  approvalsWaiting: number;
  byState: Record<DeviceLifecycleState, number>;
  byConnectivity: Record<DeviceConnectivity, number>;
  bySite: FleetSiteBreakdown[];
  byModel: FleetModelBreakdown[];
  firmwareDistribution: FleetFirmwareDistributionItem[];
  sampleDevices: DevicePublic[];
  messagesPerMinute: number;
  invalidPayloadCount: number;
  generatedAt: string;
}

export interface FleetOverviewTenantCard {
  tenantId: string;
  tenantName: string;
  tenantCode: string;
  status: TenantStatus;
  deviceCount: number;
  onlineCount: number;
  offlineCount: number;
  onlinePercentage: number;
  openAlertCount: number;
  openTicketCount: number;
  workOrdersToday: number;
}

export interface FleetNeedsAttentionItem {
  deviceId: string;
  deviceName: string;
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  siteName: string;
  modelName: string;
  reason: 'OFFLINE' | 'CRITICAL_ALERT' | 'TICKET_WAITING' | 'OVERDUE_WORK_ORDER';
  lastSeenAt: string | null;
  severity: 'CRITICAL' | 'WARNING';
  alertId?: string;
  ticketId?: string;
  workOrderId?: string;
  message?: string;
}

export interface FleetOverviewResponse {
  tenants: FleetOverviewTenantCard[];
  needsAttention: FleetNeedsAttentionItem[];
  totals: {
    tenants: number;
    devices: number;
    online: number;
    offline: number;
    openAlerts: number;
    openTickets: number;
  };
  generatedAt: string;
}

export type SimulatorProfile =
  | 'NORMAL'
  | 'DRIFTING_TEMPERATURE'
  | 'BATTERY_DRAIN'
  | 'RANDOM_DROPOUTS';

export type SimulatorFaultKind =
  | 'FORCE_OFFLINE'
  | 'SPIKE_METRIC'
  | 'LOW_BATTERY'
  | 'FAIL_OTA_CHECKSUM'
  | 'FAIL_OTA_BOOT'
  | 'IGNORE_NEXT_CONFIG'
  | 'CLEAR_FAULTS';

export interface SimulatedDeviceStatus {
  deviceId: string;
  deviceName: string;
  serialNumber: string;
  tenantId: string;
  modelId: string;
  modelName: string;
  siteId: string;
  siteName: string;
  state: DeviceLifecycleState;
  connectivity: DeviceConnectivity;
  running: boolean;
  intervalSec: number;
  profile: SimulatorProfile;
  firmwareVersion: string | null;
  lastHttpStatus: number | null;
  lastSentAt: string | null;
  lastError: string | null;
  activeFaults: string[];
}

export interface SimulatorLogEvent {
  id: string;
  at: string;
  tenantId: string;
  deviceId: string;
  deviceName: string;
  method: string;
  endpoint: string;
  statusCode: number;
  message: string;
}

export interface SimulatorStatusResponse {
  runningCount: number;
  totalCount: number;
  defaultIntervalSec: number;
  defaultProfile: SimulatorProfile;
  devices: SimulatedDeviceStatus[];
  logs: SimulatorLogEvent[];
}

// --- Milestone 4: Alert Rules, Alerts, Notifications & Escalation ---

export type AlertRuleKind = 'THRESHOLD' | 'OFFLINE';
export type AlertOperator = 'GT' | 'GTE' | 'LT' | 'LTE';
export type AlertSeverity = 'WARNING' | 'CRITICAL';
export type AlertScopeType = 'DEVICE' | 'MODEL' | 'SITE';
export type AlertStatus = 'OPEN' | 'ACKNOWLEDGED' | 'CLOSED';

export const HEALTH_METRIC_KEYS = [
  'cpuLoad',
  'memoryUsage',
  'batteryLevel',
  'signalStrength',
] as const;

export type HealthMetricKey = (typeof HEALTH_METRIC_KEYS)[number];

export interface AlertRecipient {
  type: 'ROLE' | 'USER';
  role?: RoleCode;
  userId?: string;
}

export interface AlertRule {
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
  scopeName?: string;
  recipients: AlertRecipient[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AlertPublic {
  id: string;
  tenantId: string;
  tenantCode?: string;
  tenantName?: string;
  ruleId: string | null;
  ruleName?: string | null;
  deviceId: string;
  deviceName?: string;
  siteId?: string;
  siteName?: string;
  modelName?: string;
  severity: AlertSeverity;
  status: AlertStatus;
  message: string;
  snapshot: Record<string, unknown>;
  acknowledgedBy: string | null;
  acknowledgedByName?: string | null;
  acknowledgedAt: string | null;
  ticketId: string | null;
  escalationLevel: 0 | 1 | 2;
  escalatedAt: string | null;
  emailDeliveryFailed: boolean;
  closedAt: string | null;
  closedBy: string | null;
  closedByName?: string | null;
  closeReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AlertDetail extends AlertPublic {
  timeline: Array<{
    id: string;
    at: string;
    action: string;
    actorId: string;
    actorName?: string | null;
    details: Record<string, unknown>;
  }>;
}

export interface NotificationItem {
  id: string;
  tenantId: string | null;
  userId: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

export interface NotificationsResponse extends PaginatedResponse<NotificationItem> {
  unreadCount: number;
}

// --- Milestone 5: Tickets, Service Requests, Work Orders & Maintenance Plans ---

export type TicketSource = 'ALERT' | 'SERVICE_REQUEST' | 'INTERNAL';
export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type TicketStatus =
  | 'OPEN'
  | 'IN_PROGRESS'
  | 'WAITING_ON_CLIENT'
  | 'RESOLVED'
  | 'CLOSED';

export interface TicketComment {
  id: string;
  authorId: string;
  authorName?: string | null;
  authorRole: RoleCode | 'SYSTEM';
  body: string;
  at: string;
}

export interface TicketPublic {
  id: string;
  number: string;
  tenantId: string;
  tenantCode?: string;
  tenantName?: string;
  deviceId: string | null;
  deviceName?: string | null;
  deviceSerial?: string | null;
  siteId: string | null;
  siteName?: string | null;
  source: TicketSource;
  alertId: string | null;
  title: string;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  assigneeId: string | null;
  assigneeName?: string | null;
  createdBy: string;
  createdByName?: string | null;
  rootCause: string | null;
  resolutionNotes: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  closeReason: string | null;
  comments: TicketComment[];
  workOrderCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface TicketDetail extends TicketPublic {
  linkedAlert: AlertPublic | null;
  linkedWorkOrders: WorkOrderPublic[];
  device: DevicePublic | null;
  postMaintenanceOfflineWarning: boolean;
}

export type WorkOrderType = 'CORRECTIVE' | 'PREVENTIVE';
export type WorkOrderApprovalStatus = 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'REJECTED';
export type WorkOrderStatus = 'PLANNED' | 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type WorkOrderOutcome = 'FIXED' | 'PARTIAL' | 'REPLACED';

export interface WorkOrderChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface WorkOrderCompletion {
  actionsTaken: string;
  partsReplaced: string[];
  notes: string;
  timeSpentMin: number;
  outcome: WorkOrderOutcome;
}

export interface WorkOrderPublic {
  id: string;
  number: string;
  tenantId: string;
  tenantCode?: string;
  tenantName?: string;
  deviceId: string;
  deviceName?: string;
  deviceSerial?: string;
  deviceState?: DeviceLifecycleState;
  deviceConnectivity?: DeviceConnectivity;
  siteId?: string;
  siteName?: string;
  siteLocation?: string;
  modelName?: string;
  ticketId: string | null;
  ticketNumber?: string | null;
  planId: string | null;
  planName?: string | null;
  type: WorkOrderType;
  title: string;
  instructions: string;
  checklist: WorkOrderChecklistItem[];
  assignedTo: string | null;
  assignedToName?: string | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  downtimeRequired: boolean;
  approvalStatus: WorkOrderApprovalStatus;
  approvalNote: string | null;
  approvedBy: string | null;
  approvedByName?: string | null;
  approvedAt: string | null;
  status: WorkOrderStatus;
  startedAt: string | null;
  completedAt: string | null;
  completion: WorkOrderCompletion | null;
  createdBy: string;
  createdByName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkOrderDetail extends WorkOrderPublic {
  device: DevicePublic | null;
  linkedTicket: TicketPublic | null;
  recentDeviceHistory: DeviceTimelineEvent[];
}

export type MaintenanceScopeType = 'DEVICE' | 'TAG' | 'SITE';

export interface MaintenancePlanTemplate {
  title: string;
  instructions: string;
  checklist: string[];
  downtimeRequired: boolean;
}

export interface MaintenancePlanPublic {
  id: string;
  tenantId: string;
  tenantCode?: string;
  tenantName?: string;
  name: string;
  scopeType: MaintenanceScopeType;
  scopeValue: string;
  scopeLabel?: string;
  everyDays: number;
  nextRunAt: string;
  lastRunAt: string | null;
  template: MaintenancePlanTemplate;
  assignedTo: string | null;
  assignedToName?: string | null;
  enabled: boolean;
  matchedDeviceCount?: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface StaffOption {
  id: string;
  name: string;
  email: string;
  role: RoleCode;
}

// --- Milestone 6: Configuration Profiles, Firmware Packages & OTA Rollouts ---

export interface ConfigProfileVersion {
  id: string;
  profileId: string;
  version: number;
  payload: Record<string, unknown>;
  createdBy: string;
  createdByName?: string | null;
  createdAt: string;
}

export interface ConfigProfilePublic {
  id: string;
  tenantId: string;
  modelId: string;
  modelName?: string;
  name: string;
  version: number;
  payload: Record<string, unknown>;
  createdBy: string;
  createdByName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ConfigPushTargetType = 'DEVICE' | 'TAG' | 'SITE';

export interface ConfigPushResultItem {
  deviceId: string;
  deviceName: string;
  serialNumber?: string;
  status: 'QUEUED' | 'SKIPPED';
  reason?: string;
}

export interface ConfigPushResponse {
  profileId: string;
  profileName: string;
  version: number;
  queuedCount: number;
  skippedCount: number;
  results: ConfigPushResultItem[];
}

export type FirmwareStatus = 'DRAFT' | 'RELEASED' | 'WITHDRAWN';

export interface FirmwarePackagePublic {
  id: string;
  modelId: string;
  modelName?: string;
  version: string;
  releaseNotes: string;
  checksumSha256: string;
  sizeBytes: number;
  status: FirmwareStatus;
  uploadedBy: string;
  uploadedByName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type RolloutTargetType = 'DEVICE' | 'TAG' | 'SITE';

export type RolloutStatus =
  | 'PENDING_APPROVAL'
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'REJECTED'
  | 'CANCELLED';

export type RolloutJobStatus =
  | 'QUEUED'
  | 'DOWNLOADING'
  | 'INSTALLING'
  | 'VERIFIED'
  | 'FAILED'
  | 'CANCELLED';

export interface RolloutCounts {
  total: number;
  verified: number;
  failed: number;
  cancelled: number;
}

export interface RolloutPublic {
  id: string;
  tenantId: string;
  tenantCode?: string;
  tenantName?: string;
  firmwareId: string;
  firmwareVersion?: string;
  modelId: string;
  modelName?: string;
  targetType: RolloutTargetType;
  targetValue: string;
  targetLabel?: string;
  scheduledAt: string | null;
  status: RolloutStatus;
  createdBy: string;
  createdByName?: string | null;
  decidedBy: string | null;
  decidedByName?: string | null;
  decisionReason: string | null;
  counts: RolloutCounts;
  createdAt: string;
  updatedAt: string;
}

export interface RolloutJobPublic {
  id: string;
  tenantId: string;
  rolloutId: string;
  deviceId: string;
  deviceName?: string;
  deviceSerial?: string;
  fromVersion: string | null;
  toVersion: string;
  status: RolloutJobStatus;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RolloutDetail extends RolloutPublic {
  firmware: FirmwarePackagePublic | null;
  jobs: RolloutJobPublic[];
}

export interface RolloutPreviewIncluded {
  deviceId: string;
  deviceName: string;
  serialNumber: string;
  siteName: string;
  currentVersion: string | null;
}

export interface RolloutPreviewExcluded {
  deviceId: string;
  deviceName: string;
  serialNumber: string;
  siteName: string;
  state: DeviceLifecycleState;
  currentVersion: string | null;
  reason: string;
}

export interface RolloutPreviewResponse {
  firmwareId: string;
  firmwareVersion: string;
  modelId: string;
  modelName: string;
  included: RolloutPreviewIncluded[];
  excluded: RolloutPreviewExcluded[];
}

// --- Milestone 7: Reports, KPIs & Platform Health (Section 13) ---

export interface ReportFiltersApplied {
  from: string;
  to: string;
  siteId: string | null;
  siteName: string | null;
  modelId: string | null;
  modelName: string | null;
  tenantId: string | null;
  tenantCode: string;
  tenantName: string;
}

export interface ReportKpisResponse {
  filters: ReportFiltersApplied;
  availabilityPct: number | null;
  availabilityDeviceCount: number;
  mttrHours: number | null;
  resolvedTicketsInRange: number;
  alertsTotal: number;
  alertsBySeverity: Record<AlertSeverity, number>;
  openTicketsTotal: number;
  openTicketsByPriority: Record<TicketPriority, number>;
  firmwareCompliancePct: number | null;
  firmwareCompliantCount: number;
  firmwareEligibleCount: number;
  maintenanceCompletionRatePct: number | null;
  maintenanceCompletedCount: number;
  maintenancePlannedCount: number;
}

export interface DeviceAvailabilityRow {
  deviceId: string;
  deviceName: string;
  serialNumber: string;
  siteId: string;
  siteName: string;
  modelId: string;
  modelName: string;
  state: DeviceLifecycleState;
  connectivity: DeviceConnectivity;
  onlineHours: number;
  eligibleHours: number;
  availabilityPct: number | null;
}

export interface GroupedAvailabilityRow {
  id: string;
  name: string;
  deviceCount: number;
  eligibleDeviceCount: number;
  onlineHours: number;
  eligibleHours: number;
  availabilityPct: number | null;
}

export interface AvailabilityReportResponse {
  filters: ReportFiltersApplied;
  fleetAvailabilityPct: number | null;
  totalDevices: number;
  eligibleDevices: number;
  bySite: GroupedAvailabilityRow[];
  byModel: GroupedAvailabilityRow[];
  devices: DeviceAvailabilityRow[];
}

export interface AlertsDailyTrendPoint {
  date: string;
  CRITICAL: number;
  WARNING: number;
  total: number;
}

export interface AlertsReportRow {
  id: string;
  deviceId: string;
  deviceName: string;
  siteName: string;
  modelName: string;
  ruleName: string;
  severity: AlertSeverity;
  status: AlertStatus;
  message: string;
  createdAt: string;
  acknowledgedAt: string | null;
  closedAt: string | null;
}

export interface AlertsReportResponse {
  filters: ReportFiltersApplied;
  total: number;
  bySeverity: Record<AlertSeverity, number>;
  byStatus: Record<AlertStatus, number>;
  dailyTrend: AlertsDailyTrendPoint[];
  items: AlertsReportRow[];
}

export interface TicketsReportRow {
  id: string;
  number: string;
  title: string;
  source: TicketSource;
  priority: TicketPriority;
  status: TicketStatus;
  deviceName: string;
  siteName: string;
  modelName: string;
  assigneeName: string | null;
  createdAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
  resolutionHours: number | null;
}

export interface TicketsReportResponse {
  filters: ReportFiltersApplied;
  mttrHours: number | null;
  resolvedInRangeCount: number;
  openAtRangeEndCount: number;
  openByPriority: Record<TicketPriority, number>;
  openByStatus: Record<TicketStatus, number>;
  items: TicketsReportRow[];
}

export interface ModelFirmwareComplianceRow {
  modelId: string;
  modelName: string;
  latestReleasedVersion: string | null;
  eligibleDevices: number;
  compliantDevices: number;
  nonCompliantDevices: number;
  compliancePct: number | null;
}

export interface NonCompliantDeviceRow {
  deviceId: string;
  deviceName: string;
  serialNumber: string;
  siteName: string;
  modelId: string;
  modelName: string;
  state: DeviceLifecycleState;
  currentVersion: string | null;
  latestReleasedVersion: string;
}

export interface FirmwareComplianceReportResponse {
  filters: ReportFiltersApplied;
  compliancePct: number | null;
  compliantCount: number;
  eligibleCount: number;
  nonCompliantCount: number;
  byModel: ModelFirmwareComplianceRow[];
  nonCompliantDevices: NonCompliantDeviceRow[];
}

export interface MaintenanceReportRow {
  id: string;
  number: string;
  title: string;
  type: WorkOrderType;
  status: WorkOrderStatus;
  approvalStatus: WorkOrderApprovalStatus;
  deviceName: string;
  siteName: string;
  modelName: string;
  assignedToName: string | null;
  plannedStart: string | null;
  completedAt: string | null;
  timeSpentMin: number | null;
  outcome: WorkOrderOutcome | null;
}

export interface MaintenanceReportResponse {
  filters: ReportFiltersApplied;
  completionRatePct: number | null;
  completedCount: number;
  plannedNonCancelledCount: number;
  cancelledCount: number;
  byType: Record<WorkOrderType, { planned: number; completed: number }>;
  byStatus: Record<WorkOrderStatus, number>;
  items: MaintenanceReportRow[];
}

export interface PlatformHealthTenantRow {
  id: string;
  name: string;
  code: string;
  status: TenantStatus;
  deviceCount: number;
  onlineCount: number;
  onlinePercentage: number | null;
  openCriticalAlerts: number;
  openTickets: number;
  activeUserCount: number;
  userCount: number;
  createdAt: string;
}

export interface PlatformHealthReportResponse {
  generatedAt: string;
  tenants: {
    total: number;
    active: number;
    suspended: number;
  };
  devicesTotal: number;
  devicesByState: Record<DeviceLifecycleState, number>;
  deviceModelsTotal: number;
  messagesPerMinute: number;
  messagesLastHour: number;
  invalidPayloadRate: number;
  invalidPayloadsLastHour: number;
  openCriticalAlerts: number;
  emailOutbox: {
    queued: number;
    sent: number;
    failed: number;
  };
  firmwarePackages: {
    total: number;
    draft: number;
    released: number;
    withdrawn: number;
  };
  users: {
    total: number;
    active: number;
    providerStaff: number;
  };
  auditEventsLast24h: number;
  tenantBreakdown: PlatformHealthTenantRow[];
  demoMode: boolean;
}

export interface ReportExportAuditRequest {
  format: 'CSV' | 'PDF';
  reportType: string;
  from: string;
  to: string;
  siteId?: string | null;
  modelId?: string | null;
  tenantId?: string | null;
  rowCount?: number;
}
