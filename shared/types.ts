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
  kind: 'STATE_CHANGE' | 'CONNECTIVITY' | 'AUDIT';
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

