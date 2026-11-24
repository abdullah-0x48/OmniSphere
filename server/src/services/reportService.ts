import type {
  AlertSeverity,
  AlertStatus,
  AlertsReportResponse,
  AlertsReportRow,
  AvailabilityReportResponse,
  DeviceConnectivity,
  DeviceLifecycleState,
  FirmwareComplianceReportResponse,
  FirmwareStatus,
  MaintenanceReportResponse,
  MaintenanceReportRow,
  PlatformHealthReportResponse,
  PlatformHealthTenantRow,
  ReportExportAuditRequest,
  ReportFiltersApplied,
  ReportKpisResponse,
  TenantStatus,
  TicketPriority,
  TicketSource,
  TicketStatus,
  TicketsReportResponse,
  TicketsReportRow,
  WorkOrderApprovalStatus,
  WorkOrderCompletion,
  WorkOrderOutcome,
  WorkOrderStatus,
  WorkOrderType,
} from '../../../shared/types.ts';
import { config } from '../config.ts';
import type { Repositories } from '../repositories/index.ts';
import type { TenantContext } from '../repositories/types.ts';
import { Errors } from '../utils/errors.ts';
import type { AuditService } from './auditService.ts';
import type { LiveStateStore } from './liveStateStore.ts';
import {
  aggregateAvailability,
  computeAlertsBreakdown,
  computeFirmwareCompliance,
  computeMaintenanceCompletion,
  computeMttrHours,
  computeOpenTicketsAtRangeEnd,
  parseReportDateRange,
  type AvailabilityDeviceInput,
  type ConnectivityEventInput,
  type FirmwarePackageKpiInput,
  type StateHistoryInput,
} from './reportKpiLogic.ts';

export interface ReportQueryInput {
  from?: string;
  to?: string;
  siteId?: string;
  modelId?: string;
  tenantId?: string;
}

interface ScopedDeviceRow {
  id: string;
  tenant_id: string;
  site_id: string;
  site_name: string;
  model_id: string;
  model_name: string;
  name: string;
  serial_number: string;
  state: DeviceLifecycleState;
  connectivity: DeviceConnectivity;
  firmware_version: string | null;
  created_at: string;
}

interface ResolvedScope {
  tenantIds: string[] | null; // null = all tenants (PA unfiltered)
  filters: ReportFiltersApplied;
  fromMs: number;
  toMs: number;
  siteId: string | null;
  modelId: string | null;
}

const REPORT_TABLE_ROW_CAP = 200;

export class ReportService {
  constructor(
    private readonly repos: Repositories,
    private readonly liveState: LiveStateStore,
    private readonly audit: AuditService,
  ) {}

  private resolveScope(ctx: TenantContext, query: ReportQueryInput): ResolvedScope {
    const nowMs = Date.now();
    const { fromIso, toIso, fromMs, toMs } = parseReportDateRange(query.from, query.to, nowMs);

    let tenantIds: string[] | null = null;
    let tenantId: string | null = null;
    let tenantCode = 'ALL';
    let tenantName = 'All Organizations';

    if (ctx.allTenants) {
      if (query.tenantId && query.tenantId.trim().length > 0) {
        const tenant = this.repos.tenants.findByIdSystem(query.tenantId.trim());
        if (!tenant) {
          throw Errors.notFound('Organization not found');
        }
        tenantIds = [tenant.id];
        tenantId = tenant.id;
        tenantCode = tenant.code;
        tenantName = tenant.name;
      } else {
        tenantIds = null;
      }
    } else {
      const targetTid = query.tenantId?.trim() || ctx.activeTenantId || ctx.tenantIds[0] || null;
      if (!targetTid) {
        throw Errors.forbidden('No organization scope is active for your account');
      }
      if (!ctx.tenantIds.includes(targetTid)) {
        throw Errors.notFound('Organization not found');
      }
      const tenant = this.repos.tenants.findByIdSystem(targetTid);
      if (!tenant) {
        throw Errors.notFound('Organization not found');
      }
      tenantIds = [tenant.id];
      tenantId = tenant.id;
      tenantCode = tenant.code;
      tenantName = tenant.name;
    }

    let siteId: string | null = null;
    let siteName: string | null = null;
    if (query.siteId && query.siteId.trim().length > 0) {
      const row = this.repos.db
        .prepare('SELECT id, tenant_id, name FROM sites WHERE id = ?')
        .get(query.siteId.trim()) as { id: string; tenant_id: string; name: string } | undefined;
      if (!row || (tenantIds !== null && !tenantIds.includes(row.tenant_id))) {
        throw Errors.notFound('Site not found');
      }
      siteId = row.id;
      siteName = row.name;
    }

    let modelId: string | null = null;
    let modelName: string | null = null;
    if (query.modelId && query.modelId.trim().length > 0) {
      const model = this.repos.deviceModels.findById(query.modelId.trim());
      if (!model) {
        throw Errors.notFound('Device model not found');
      }
      modelId = model.id;
      modelName = model.name;
    }

    return {
      tenantIds,
      fromMs,
      toMs,
      siteId,
      modelId,
      filters: {
        from: fromIso,
        to: toIso,
        siteId,
        siteName,
        modelId,
        modelName,
        tenantId,
        tenantCode,
        tenantName,
      },
    };
  }

  private buildTenantClause(
    tenantIds: string[] | null,
    columnExpr: string,
    params: unknown[],
  ): string | null {
    if (tenantIds === null) return null;
    if (tenantIds.length === 0) return '1 = 0';
    const placeholders = tenantIds.map(() => '?').join(', ');
    params.push(...tenantIds);
    return `${columnExpr} IN (${placeholders})`;
  }

  private queryScopedDevices(scope: ResolvedScope): ScopedDeviceRow[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    const tenantClause = this.buildTenantClause(scope.tenantIds, 'd.tenant_id', params);
    if (tenantClause) conditions.push(tenantClause);
    if (scope.siteId) {
      conditions.push('d.site_id = ?');
      params.push(scope.siteId);
    }
    if (scope.modelId) {
      conditions.push('d.model_id = ?');
      params.push(scope.modelId);
    }

    const where = conditions.length > 0 ? conditions.join(' AND ') : '1 = 1';
    const rows = this.repos.db
      .prepare(
        `SELECT d.id, d.tenant_id, d.site_id, s.name AS site_name,
                d.model_id, m.name AS model_name,
                d.name, d.serial_number, d.state, d.connectivity,
                d.firmware_version, d.created_at
         FROM devices d
         JOIN sites s ON s.id = d.site_id
         JOIN device_models m ON m.id = d.model_id
         WHERE ${where}
         ORDER BY d.name ASC`,
      )
      .all(...params) as ScopedDeviceRow[];

    // Overlay real-time LiveState connectivity/state/firmware for immediate responsiveness
    return rows.map((r) => {
      const live = this.liveState.get(r.id);
      if (!live) return r;
      return {
        ...r,
        state: live.state,
        connectivity: live.connectivity,
        firmware_version: live.firmwareVersion,
      };
    });
  }

  private loadAvailabilityInputs(devices: ScopedDeviceRow[]): AvailabilityDeviceInput[] {
    if (devices.length === 0) return [];
    const deviceIds = devices.map((d) => d.id);
    const placeholders = deviceIds.map(() => '?').join(', ');

    const stateRows = this.repos.db
      .prepare(
        `SELECT device_id, to_state, at
         FROM device_state_history
         WHERE device_id IN (${placeholders})
         ORDER BY at ASC, rowid ASC`,
      )
      .all(...deviceIds) as Array<{ device_id: string; to_state: DeviceLifecycleState; at: string }>;

    const connRows = this.repos.db
      .prepare(
        `SELECT device_id, state, at
         FROM connectivity_events
         WHERE device_id IN (${placeholders})
         ORDER BY at ASC, rowid ASC`,
      )
      .all(...deviceIds) as Array<{ device_id: string; state: 'ONLINE' | 'OFFLINE'; at: string }>;

    const stateMap = new Map<string, StateHistoryInput[]>();
    for (const r of stateRows) {
      const arr = stateMap.get(r.device_id) ?? [];
      arr.push({ to: r.to_state, at: r.at });
      stateMap.set(r.device_id, arr);
    }

    const connMap = new Map<string, ConnectivityEventInput[]>();
    for (const r of connRows) {
      const arr = connMap.get(r.device_id) ?? [];
      arr.push({ state: r.state, at: r.at });
      connMap.set(r.device_id, arr);
    }

    return devices.map((d) => ({
      deviceId: d.id,
      deviceName: d.name,
      serialNumber: d.serial_number,
      siteId: d.site_id,
      siteName: d.site_name,
      modelId: d.model_id,
      modelName: d.model_name,
      state: d.state,
      connectivity: d.connectivity,
      createdAt: d.created_at,
      stateHistory: stateMap.get(d.id) ?? [],
      connectivityEvents: connMap.get(d.id) ?? [],
    }));
  }

  private queryScopedAlerts(scope: ResolvedScope): Array<{
    id: string;
    device_id: string;
    device_name: string;
    site_name: string;
    model_name: string;
    rule_name: string;
    severity: AlertSeverity;
    status: AlertStatus;
    message: string;
    created_at: string;
    acknowledged_at: string | null;
    closed_at: string | null;
  }> {
    const conditions: string[] = ['a.created_at >= ?', 'a.created_at <= ?'];
    const params: unknown[] = [scope.filters.from, scope.filters.to];

    const tenantClause = this.buildTenantClause(scope.tenantIds, 'a.tenant_id', params);
    if (tenantClause) conditions.push(tenantClause);
    if (scope.siteId) {
      conditions.push('d.site_id = ?');
      params.push(scope.siteId);
    }
    if (scope.modelId) {
      conditions.push('d.model_id = ?');
      params.push(scope.modelId);
    }

    return this.repos.db
      .prepare(
        `SELECT a.id, a.device_id, d.name AS device_name, s.name AS site_name,
                m.name AS model_name, COALESCE(r.name, 'System Alert') AS rule_name,
                a.severity, a.status, a.message, a.created_at, a.acknowledged_at, a.closed_at
         FROM alerts a
         JOIN devices d ON d.id = a.device_id
         JOIN sites s ON s.id = d.site_id
         JOIN device_models m ON m.id = d.model_id
         LEFT JOIN alert_rules r ON r.id = a.rule_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY a.created_at DESC`,
      )
      .all(...params) as Array<{
      id: string;
      device_id: string;
      device_name: string;
      site_name: string;
      model_name: string;
      rule_name: string;
      severity: AlertSeverity;
      status: AlertStatus;
      message: string;
      created_at: string;
      acknowledged_at: string | null;
      closed_at: string | null;
    }>;
  }

  private queryScopedTickets(scope: ResolvedScope): Array<{
    id: string;
    number: string;
    title: string;
    source: TicketSource;
    priority: TicketPriority;
    status: TicketStatus;
    device_name: string;
    site_name: string;
    model_name: string;
    assignee_name: string | null;
    created_at: string;
    resolved_at: string | null;
    closed_at: string | null;
  }> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    const tenantClause = this.buildTenantClause(scope.tenantIds, 't.tenant_id', params);
    if (tenantClause) conditions.push(tenantClause);
    if (scope.siteId) {
      conditions.push('t.site_id = ?');
      params.push(scope.siteId);
    }
    if (scope.modelId) {
      conditions.push('d.model_id = ?');
      params.push(scope.modelId);
    }

    const where = conditions.length > 0 ? conditions.join(' AND ') : '1 = 1';
    return this.repos.db
      .prepare(
        `SELECT t.id, t.number, t.title, t.source, t.priority, t.status,
                COALESCE(d.name, 'Site-wide') AS device_name,
                COALESCE(s.name, '—') AS site_name,
                COALESCE(m.name, '—') AS model_name,
                u.name AS assignee_name,
                t.created_at, t.resolved_at, t.closed_at
         FROM tickets t
         LEFT JOIN devices d ON d.id = t.device_id
         LEFT JOIN sites s ON s.id = t.site_id
         LEFT JOIN device_models m ON m.id = d.model_id
         LEFT JOIN users u ON u.id = t.assignee_id
         WHERE ${where}
         ORDER BY t.created_at DESC`,
      )
      .all(...params) as Array<{
      id: string;
      number: string;
      title: string;
      source: TicketSource;
      priority: TicketPriority;
      status: TicketStatus;
      device_name: string;
      site_name: string;
      model_name: string;
      assignee_name: string | null;
      created_at: string;
      resolved_at: string | null;
      closed_at: string | null;
    }>;
  }

  private queryAllFirmwarePackages(): FirmwarePackageKpiInput[] {
    const rows = this.repos.db
      .prepare('SELECT id, model_id, version, status, created_at FROM firmware_packages')
      .all() as Array<{
      id: string;
      model_id: string;
      version: string;
      status: FirmwareStatus;
      created_at: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      modelId: r.model_id,
      version: r.version,
      status: r.status,
      createdAt: r.created_at,
    }));
  }

  private queryScopedWorkOrders(scope: ResolvedScope): Array<{
    id: string;
    number: string;
    title: string;
    type: WorkOrderType;
    status: WorkOrderStatus;
    approval_status: WorkOrderApprovalStatus;
    device_name: string;
    site_name: string;
    model_name: string;
    assigned_to_name: string | null;
    planned_start: string | null;
    completed_at: string | null;
    completion_json: string | null;
  }> {
    const conditions: string[] = [
      'w.planned_start IS NOT NULL',
      'w.planned_start >= ?',
      'w.planned_start <= ?',
    ];
    const params: unknown[] = [scope.filters.from, scope.filters.to];

    const tenantClause = this.buildTenantClause(scope.tenantIds, 'w.tenant_id', params);
    if (tenantClause) conditions.push(tenantClause);
    if (scope.siteId) {
      conditions.push('d.site_id = ?');
      params.push(scope.siteId);
    }
    if (scope.modelId) {
      conditions.push('d.model_id = ?');
      params.push(scope.modelId);
    }

    return this.repos.db
      .prepare(
        `SELECT w.id, w.number, w.title, w.type, w.status, w.approval_status,
                d.name AS device_name, s.name AS site_name, m.name AS model_name,
                u.name AS assigned_to_name,
                w.planned_start, w.completed_at, w.completion_json
         FROM work_orders w
         JOIN devices d ON d.id = w.device_id
         JOIN sites s ON s.id = d.site_id
         JOIN device_models m ON m.id = d.model_id
         LEFT JOIN users u ON u.id = w.assigned_to
         WHERE ${conditions.join(' AND ')}
         ORDER BY w.planned_start DESC`,
      )
      .all(...params) as Array<{
      id: string;
      number: string;
      title: string;
      type: WorkOrderType;
      status: WorkOrderStatus;
      approval_status: WorkOrderApprovalStatus;
      device_name: string;
      site_name: string;
      model_name: string;
      assigned_to_name: string | null;
      planned_start: string | null;
      completed_at: string | null;
      completion_json: string | null;
    }>;
  }

  getKpis(ctx: TenantContext, query: ReportQueryInput): ReportKpisResponse {
    const scope = this.resolveScope(ctx, query);
    const nowMs = Date.now();

    const devices = this.queryScopedDevices(scope);
    const availInputs = this.loadAvailabilityInputs(devices);
    const avail = aggregateAvailability(availInputs, scope.fromMs, scope.toMs, nowMs);

    const alertRows = this.queryScopedAlerts(scope);
    const alerts = computeAlertsBreakdown(
      alertRows.map((a) => ({
        id: a.id,
        severity: a.severity,
        status: a.status,
        createdAt: a.created_at,
      })),
      scope.fromMs,
      scope.toMs,
    );

    const ticketRows = this.queryScopedTickets(scope);
    const ticketInputs = ticketRows.map((t) => ({
      id: t.id,
      priority: t.priority,
      status: t.status,
      createdAt: t.created_at,
      resolvedAt: t.resolved_at,
      closedAt: t.closed_at,
    }));
    const mttr = computeMttrHours(ticketInputs, scope.fromMs, scope.toMs);
    const openTickets = computeOpenTicketsAtRangeEnd(ticketInputs, scope.toMs);

    const firmwarePackages = this.queryAllFirmwarePackages();
    const compliance = computeFirmwareCompliance(
      devices.map((d) => ({
        deviceId: d.id,
        deviceName: d.name,
        serialNumber: d.serial_number,
        siteName: d.site_name,
        modelId: d.model_id,
        modelName: d.model_name,
        state: d.state,
        firmwareVersion: d.firmware_version,
      })),
      firmwarePackages,
    );

    const workOrderRows = this.queryScopedWorkOrders(scope);
    const maintenance = computeMaintenanceCompletion(
      workOrderRows.map((w) => ({
        id: w.id,
        type: w.type,
        status: w.status,
        plannedStart: w.planned_start,
      })),
      scope.fromMs,
      scope.toMs,
    );

    return {
      filters: scope.filters,
      availabilityPct: avail.fleetAvailabilityPct,
      availabilityDeviceCount: avail.eligibleDevices,
      mttrHours: mttr.mttrHours,
      resolvedTicketsInRange: mttr.resolvedCount,
      alertsTotal: alerts.total,
      alertsBySeverity: alerts.bySeverity,
      openTicketsTotal: openTickets.total,
      openTicketsByPriority: openTickets.byPriority,
      firmwareCompliancePct: compliance.compliancePct,
      firmwareCompliantCount: compliance.compliantCount,
      firmwareEligibleCount: compliance.eligibleCount,
      maintenanceCompletionRatePct: maintenance.completionRatePct,
      maintenanceCompletedCount: maintenance.completedCount,
      maintenancePlannedCount: maintenance.plannedNonCancelledCount,
    };
  }

  getAvailabilityReport(ctx: TenantContext, query: ReportQueryInput): AvailabilityReportResponse {
    const scope = this.resolveScope(ctx, query);
    const devices = this.queryScopedDevices(scope);
    const availInputs = this.loadAvailabilityInputs(devices);
    const agg = aggregateAvailability(availInputs, scope.fromMs, scope.toMs, Date.now());

    return {
      filters: scope.filters,
      fleetAvailabilityPct: agg.fleetAvailabilityPct,
      totalDevices: devices.length,
      eligibleDevices: agg.eligibleDevices,
      bySite: agg.bySite,
      byModel: agg.byModel,
      devices: agg.rows.slice(0, REPORT_TABLE_ROW_CAP),
    };
  }

  getAlertsReport(ctx: TenantContext, query: ReportQueryInput): AlertsReportResponse {
    const scope = this.resolveScope(ctx, query);
    const alertRows = this.queryScopedAlerts(scope);
    const breakdown = computeAlertsBreakdown(
      alertRows.map((a) => ({
        id: a.id,
        severity: a.severity,
        status: a.status,
        createdAt: a.created_at,
      })),
      scope.fromMs,
      scope.toMs,
    );

    const items: AlertsReportRow[] = alertRows.slice(0, REPORT_TABLE_ROW_CAP).map((a) => ({
      id: a.id,
      deviceId: a.device_id,
      deviceName: a.device_name,
      siteName: a.site_name,
      modelName: a.model_name,
      ruleName: a.rule_name,
      severity: a.severity,
      status: a.status,
      message: a.message,
      createdAt: a.created_at,
      acknowledgedAt: a.acknowledged_at,
      closedAt: a.closed_at,
    }));

    return {
      filters: scope.filters,
      total: breakdown.total,
      bySeverity: breakdown.bySeverity,
      byStatus: breakdown.byStatus,
      dailyTrend: breakdown.dailyTrend,
      items,
    };
  }

  getTicketsReport(ctx: TenantContext, query: ReportQueryInput): TicketsReportResponse {
    const scope = this.resolveScope(ctx, query);
    const ticketRows = this.queryScopedTickets(scope);
    const ticketInputs = ticketRows.map((t) => ({
      id: t.id,
      priority: t.priority,
      status: t.status,
      createdAt: t.created_at,
      resolvedAt: t.resolved_at,
      closedAt: t.closed_at,
    }));

    const mttr = computeMttrHours(ticketInputs, scope.fromMs, scope.toMs);
    const open = computeOpenTicketsAtRangeEnd(ticketInputs, scope.toMs);

    // Return tickets either created in range, resolved in range, or open at end of range
    const relevant = ticketRows.filter((t) => {
      const createdMs = Date.parse(t.created_at);
      const resolvedMs = t.resolved_at ? Date.parse(t.resolved_at) : null;
      const closedMs = t.closed_at ? Date.parse(t.closed_at) : null;
      const createdInRange = createdMs >= scope.fromMs && createdMs <= scope.toMs;
      const resolvedInRange =
        resolvedMs !== null && resolvedMs >= scope.fromMs && resolvedMs <= scope.toMs;
      const openAtEnd =
        createdMs <= scope.toMs &&
        (t.status !== 'CLOSED' || (closedMs !== null && closedMs > scope.toMs));
      return createdInRange || resolvedInRange || openAtEnd;
    });

    const items: TicketsReportRow[] = relevant.slice(0, REPORT_TABLE_ROW_CAP).map((t) => {
      let resolutionHours: number | null = null;
      if (t.resolved_at) {
        const diff = Date.parse(t.resolved_at) - Date.parse(t.created_at);
        if (Number.isFinite(diff) && diff >= 0) {
          resolutionHours = Math.round((diff / 3_600_000) * 100) / 100;
        }
      }
      return {
        id: t.id,
        number: t.number,
        title: t.title,
        source: t.source,
        priority: t.priority,
        status: t.status,
        deviceName: t.device_name,
        siteName: t.site_name,
        modelName: t.model_name,
        assigneeName: t.assignee_name,
        createdAt: t.created_at,
        resolvedAt: t.resolved_at,
        closedAt: t.closed_at,
        resolutionHours,
      };
    });

    return {
      filters: scope.filters,
      mttrHours: mttr.mttrHours,
      resolvedInRangeCount: mttr.resolvedCount,
      openAtRangeEndCount: open.total,
      openByPriority: open.byPriority,
      openByStatus: open.byStatus,
      items,
    };
  }

  getFirmwareComplianceReport(
    ctx: TenantContext,
    query: ReportQueryInput,
  ): FirmwareComplianceReportResponse {
    const scope = this.resolveScope(ctx, query);
    const devices = this.queryScopedDevices(scope);
    const firmwarePackages = this.queryAllFirmwarePackages();
    const res = computeFirmwareCompliance(
      devices.map((d) => ({
        deviceId: d.id,
        deviceName: d.name,
        serialNumber: d.serial_number,
        siteName: d.site_name,
        modelId: d.model_id,
        modelName: d.model_name,
        state: d.state,
        firmwareVersion: d.firmware_version,
      })),
      firmwarePackages,
    );

    return {
      filters: scope.filters,
      compliancePct: res.compliancePct,
      compliantCount: res.compliantCount,
      eligibleCount: res.eligibleCount,
      nonCompliantCount: res.nonCompliantCount,
      byModel: res.byModel,
      nonCompliantDevices: res.nonCompliantDevices.slice(0, REPORT_TABLE_ROW_CAP),
    };
  }

  getMaintenanceReport(ctx: TenantContext, query: ReportQueryInput): MaintenanceReportResponse {
    const scope = this.resolveScope(ctx, query);
    const workOrderRows = this.queryScopedWorkOrders(scope);
    const summary = computeMaintenanceCompletion(
      workOrderRows.map((w) => ({
        id: w.id,
        type: w.type,
        status: w.status,
        plannedStart: w.planned_start,
      })),
      scope.fromMs,
      scope.toMs,
    );

    const items: MaintenanceReportRow[] = workOrderRows.slice(0, REPORT_TABLE_ROW_CAP).map((w) => {
      let timeSpentMin: number | null = null;
      let outcome: WorkOrderOutcome | null = null;
      if (w.completion_json) {
        try {
          const parsed = JSON.parse(w.completion_json) as Partial<WorkOrderCompletion>;
          if (typeof parsed.timeSpentMin === 'number') timeSpentMin = parsed.timeSpentMin;
          if (parsed.outcome) outcome = parsed.outcome;
        } catch {
          // ignore malformed completion JSON
        }
      }
      return {
        id: w.id,
        number: w.number,
        title: w.title,
        type: w.type,
        status: w.status,
        approvalStatus: w.approval_status,
        deviceName: w.device_name,
        siteName: w.site_name,
        modelName: w.model_name,
        assignedToName: w.assigned_to_name,
        plannedStart: w.planned_start,
        completedAt: w.completed_at,
        timeSpentMin,
        outcome,
      };
    });

    return {
      filters: scope.filters,
      completionRatePct: summary.completionRatePct,
      completedCount: summary.completedCount,
      plannedNonCancelledCount: summary.plannedNonCancelledCount,
      cancelledCount: summary.cancelledCount,
      byType: summary.byType,
      byStatus: summary.byStatus,
      items,
    };
  }

  getPlatformHealth(_ctx: TenantContext): PlatformHealthReportResponse {
    const tenantCounts = this.repos.tenants.countByStatus();
    const userCounts = this.repos.users.countGlobal();
    const devicesByState = this.repos.devices.countByStateGlobal();
    const devicesTotal = Object.values(devicesByState).reduce((acc, n) => acc + n, 0);
    const deviceModelsTotal = this.repos.deviceModels.countAll();
    const openCriticalAlerts = this.repos.alerts.countOpenCriticalGlobal();
    const last24hIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const auditEventsLast24h = this.repos.audit.countSince(last24hIso);

    const ingestion = this.liveState.getLastHourIngestionMetrics();

    // Email outbox counts by status
    const emailRows = this.repos.db
      .prepare('SELECT status, COUNT(*) AS count FROM email_outbox GROUP BY status')
      .all() as Array<{ status: 'QUEUED' | 'SENT' | 'FAILED'; count: number }>;
    const emailOutbox = { queued: 0, sent: 0, failed: 0 };
    for (const r of emailRows) {
      if (r.status === 'QUEUED') emailOutbox.queued = r.count;
      else if (r.status === 'SENT') emailOutbox.sent = r.count;
      else if (r.status === 'FAILED') emailOutbox.failed = r.count;
    }

    // Firmware package counts by status
    const fwRows = this.repos.db
      .prepare('SELECT status, COUNT(*) AS count FROM firmware_packages GROUP BY status')
      .all() as Array<{ status: FirmwareStatus; count: number }>;
    const firmwarePackages = { total: 0, draft: 0, released: 0, withdrawn: 0 };
    for (const r of fwRows) {
      firmwarePackages.total += r.count;
      if (r.status === 'DRAFT') firmwarePackages.draft = r.count;
      else if (r.status === 'RELEASED') firmwarePackages.released = r.count;
      else if (r.status === 'WITHDRAWN') firmwarePackages.withdrawn = r.count;
    }

    // Per-tenant summary breakdown (batched queries, zero N+1)
    const tenantRows = this.repos.db
      .prepare('SELECT id, name, code, status, created_at FROM tenants ORDER BY name ASC LIMIT 200')
      .all() as Array<{
      id: string;
      name: string;
      code: string;
      status: TenantStatus;
      created_at: string;
    }>;

    const deviceRows = this.repos.db
      .prepare('SELECT id, tenant_id, state, connectivity FROM devices')
      .all() as Array<{
      id: string;
      tenant_id: string;
      state: DeviceLifecycleState;
      connectivity: DeviceConnectivity;
    }>;

    const userAggRows = this.repos.db
      .prepare(
        `SELECT tenant_id,
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) AS active
         FROM users
         WHERE tenant_id IS NOT NULL
         GROUP BY tenant_id`,
      )
      .all() as Array<{ tenant_id: string; total: number; active: number }>;

    const critAlertRows = this.repos.db
      .prepare(
        `SELECT tenant_id, COUNT(*) AS count
         FROM alerts
         WHERE severity = 'CRITICAL' AND status != 'CLOSED'
         GROUP BY tenant_id`,
      )
      .all() as Array<{ tenant_id: string; count: number }>;

    const openTicketRows = this.repos.db
      .prepare(
        `SELECT tenant_id, COUNT(*) AS count
         FROM tickets
         WHERE status != 'CLOSED'
         GROUP BY tenant_id`,
      )
      .all() as Array<{ tenant_id: string; count: number }>;

    const userMap = new Map(userAggRows.map((r) => [r.tenant_id, r]));
    const alertMap = new Map(critAlertRows.map((r) => [r.tenant_id, r.count]));
    const ticketMap = new Map(openTicketRows.map((r) => [r.tenant_id, r.count]));

    const devStats = new Map<string, { total: number; eligible: number; online: number }>();
    for (const d of deviceRows) {
      const live = this.liveState.get(d.id);
      const state = live?.state ?? d.state;
      const connectivity = live?.connectivity ?? d.connectivity;
      let st = devStats.get(d.tenant_id);
      if (!st) {
        st = { total: 0, eligible: 0, online: 0 };
        devStats.set(d.tenant_id, st);
      }
      st.total += 1;
      if (state === 'ACTIVE' || state === 'UNDER_MAINTENANCE') {
        st.eligible += 1;
        if (connectivity === 'ONLINE') st.online += 1;
      }
    }

    const tenantBreakdown: PlatformHealthTenantRow[] = tenantRows.map((t) => {
      const ds = devStats.get(t.id) ?? { total: 0, eligible: 0, online: 0 };
      const us = userMap.get(t.id);
      return {
        id: t.id,
        name: t.name,
        code: t.code,
        status: t.status,
        deviceCount: ds.total,
        onlineCount: ds.online,
        onlinePercentage:
          ds.eligible > 0 ? Math.round((ds.online / ds.eligible) * 1000) / 10 : null,
        openCriticalAlerts: alertMap.get(t.id) ?? 0,
        openTickets: ticketMap.get(t.id) ?? 0,
        activeUserCount: us?.active ?? 0,
        userCount: us?.total ?? 0,
        createdAt: t.created_at,
      };
    });

    return {
      generatedAt: new Date().toISOString(),
      tenants: tenantCounts,
      devicesTotal,
      devicesByState,
      deviceModelsTotal,
      messagesPerMinute: ingestion.messagesPerMinute,
      messagesLastHour: ingestion.messagesLastHour,
      invalidPayloadRate: ingestion.invalidPayloadRate,
      invalidPayloadsLastHour: ingestion.invalidPayloadsLastHour,
      openCriticalAlerts,
      emailOutbox,
      firmwarePackages,
      users: userCounts,
      auditEventsLast24h,
      tenantBreakdown,
      demoMode: config.demoMode,
    };
  }

  recordExportAudit(
    ctx: TenantContext,
    payload: ReportExportAuditRequest,
    ip: string,
  ): { ok: true; auditId: string } {
    let targetTenantId: string | null = null;
    if (ctx.allTenants) {
      targetTenantId = payload.tenantId ?? null;
    } else {
      targetTenantId = ctx.activeTenantId ?? ctx.tenantIds[0] ?? null;
    }

    const entry = this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: targetTenantId,
      action: 'REPORT_EXPORTED',
      targetType: 'REPORT',
      targetId: `${payload.reportType}:${payload.format}`,
      outcome: 'SUCCESS',
      ip,
      details: {
        format: payload.format,
        reportType: payload.reportType,
        from: payload.from,
        to: payload.to,
        siteId: payload.siteId ?? null,
        modelId: payload.modelId ?? null,
        rowCount: payload.rowCount ?? null,
      },
    });
    return { ok: true, auditId: entry.id };
  }
}
