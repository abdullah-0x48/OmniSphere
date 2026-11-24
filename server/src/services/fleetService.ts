import type {
  DeviceConnectivity,
  DeviceLifecycleState,
  FleetFirmwareDistributionItem,
  FleetModelBreakdown,
  FleetNeedsAttentionItem,
  FleetOverviewResponse,
  FleetOverviewTenantCard,
  FleetSiteBreakdown,
  FleetSummaryResponse,
} from '../../../shared/types.ts';
import type { Repositories } from '../repositories/index.ts';
import type { TenantContext } from '../repositories/types.ts';
import { Errors } from '../utils/errors.ts';
import type { LiveStateStore } from './liveStateStore.ts';

/**
 * Provides fleet dashboard summary (`/api/v1/fleet/summary`) and NOC cross-tenant overview
 * (`/api/v1/fleet/overview`) backed by SQLite + live in-memory `LiveStateStore` (Section 10.2 & 10.3).
 */
export class FleetService {
  constructor(
    private readonly repos: Repositories,
    private readonly liveState: LiveStateStore,
  ) {}

  getSummary(ctx: TenantContext): FleetSummaryResponse {
    const tenantId = ctx.activeTenantId ?? (ctx.tenantIds.length === 1 ? ctx.tenantIds[0] : null);
    if (!tenantId) {
      throw Errors.validation('Select a working organization to view the fleet dashboard');
    }

    const tenant = this.repos.tenants.findById(ctx, tenantId);
    if (!tenant) {
      throw Errors.notFound('Organization not found');
    }

    const scopedCtx: TenantContext = {
      ...ctx,
      allTenants: false,
      tenantIds: [tenantId],
      activeTenantId: tenantId,
    };

    const rawDevices = this.repos.devices.listAllInScope(scopedCtx);
    const devices = rawDevices.map((d) => this.liveState.mergeIntoDevice(d));
    const sites = this.repos.sites.listAllInTenant(scopedCtx, tenantId);
    const models = this.repos.deviceModels.listAll();
    const modelNameById = new Map(models.map((m) => [m.id, m.name]));

    const byState: Record<DeviceLifecycleState, number> = {
      PROVISIONED: 0,
      ACTIVE: 0,
      UNDER_MAINTENANCE: 0,
      SUSPENDED: 0,
      DECOMMISSIONED: 0,
    };
    const byConnectivity: Record<DeviceConnectivity, number> = {
      ONLINE: 0,
      OFFLINE: 0,
      UNKNOWN: 0,
    };

    const alertCountsBySite = this.repos.alerts.countActiveBySiteForTenant(tenantId);
    const alertCountsTenant = this.repos.alerts.countActiveByTenant(tenantId);

    const siteMap = new Map<string, FleetSiteBreakdown>();
    for (const s of sites) {
      siteMap.set(s.id, {
        siteId: s.id,
        siteName: s.name,
        location: s.location,
        deviceCount: 0,
        onlineCount: 0,
        offlineCount: 0,
        openAlertCount: alertCountsBySite.get(s.id) ?? 0,
      });
    }

    const modelMap = new Map<string, FleetModelBreakdown>();
    const firmwareMap = new Map<string, FleetFirmwareDistributionItem>();

    let invalidPayloadCount = 0;

    for (const d of devices) {
      byState[d.state] += 1;
      byConnectivity[d.connectivity] += 1;
      invalidPayloadCount += d.invalidPayloadCount;

      const siteEntry = siteMap.get(d.siteId) ?? {
        siteId: d.siteId,
        siteName: d.siteName ?? 'Unknown Site',
        location: '',
        deviceCount: 0,
        onlineCount: 0,
        offlineCount: 0,
        openAlertCount: 0,
      };
      siteEntry.deviceCount += 1;
      if (d.connectivity === 'ONLINE') siteEntry.onlineCount += 1;
      if (d.connectivity === 'OFFLINE') siteEntry.offlineCount += 1;
      siteMap.set(d.siteId, siteEntry);

      const mName = d.modelName ?? modelNameById.get(d.modelId) ?? d.modelId;
      const modelEntry = modelMap.get(d.modelId) ?? {
        modelId: d.modelId,
        modelName: mName,
        deviceCount: 0,
        onlineCount: 0,
      };
      modelEntry.deviceCount += 1;
      if (d.connectivity === 'ONLINE') modelEntry.onlineCount += 1;
      modelMap.set(d.modelId, modelEntry);

      const fwVer = d.firmwareVersion ?? 'Unreported';
      const fwKey = `${d.modelId}::${fwVer}`;
      const fwEntry = firmwareMap.get(fwKey) ?? {
        modelId: d.modelId,
        modelName: mName,
        firmwareVersion: fwVer,
        count: 0,
      };
      fwEntry.count += 1;
      firmwareMap.set(fwKey, fwEntry);
    }

    const activeCount = byState.ACTIVE;
    const activeOnline = devices.filter(
      (d) => d.state === 'ACTIVE' && d.connectivity === 'ONLINE',
    ).length;
    const onlinePercentage =
      activeCount > 0 ? Math.round((activeOnline / activeCount) * 100) : 0;

    // Sample devices for live telemetry strip (prioritize ACTIVE & ONLINE devices)
    const sampleDevices = [...devices]
      .filter((d) => d.state === 'ACTIVE' || d.state === 'UNDER_MAINTENANCE')
      .sort((a, b) => {
        if (a.connectivity === 'ONLINE' && b.connectivity !== 'ONLINE') return -1;
        if (a.connectivity !== 'ONLINE' && b.connectivity === 'ONLINE') return 1;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 12);

    const ingestion = this.liveState.getIngestionMetrics();
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(now);
    dayEnd.setHours(23, 59, 59, 999);

    const openTickets = this.repos.tickets.countOpenByTenant(tenantId);
    const workOrdersToday = this.repos.workOrders.countTodayByTenant(
      tenantId,
      dayStart.toISOString(),
      dayEnd.toISOString(),
    );
    const approvalsWaiting =
      this.repos.workOrders.countPendingApprovalsByTenant(tenantId) +
      this.repos.rollouts.countPendingApprovalsByTenant(tenantId);

    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      tenantCode: tenant.code,
      totalDevices: devices.length,
      onlineCount: byConnectivity.ONLINE,
      offlineCount: byConnectivity.OFFLINE,
      onlinePercentage,
      activeAlertsCritical: alertCountsTenant.critical,
      activeAlertsWarning: alertCountsTenant.warning,
      openTickets,
      workOrdersToday,
      approvalsWaiting,
      byState,
      byConnectivity,
      bySite: Array.from(siteMap.values()).sort((a, b) => a.siteName.localeCompare(b.siteName)),
      byModel: Array.from(modelMap.values()).sort((a, b) => b.deviceCount - a.deviceCount),
      firmwareDistribution: Array.from(firmwareMap.values()).sort((a, b) => b.count - a.count),
      sampleDevices,
      messagesPerMinute: ingestion.messagesPerMinute,
      invalidPayloadCount,
      generatedAt: new Date().toISOString(),
    };
  }

  getOverview(ctx: TenantContext): FleetOverviewResponse {
    const tenantsRes = this.repos.tenants.list(ctx, {
      page: 1,
      pageSize: 200,
      sortField: 'name',
      sortDir: 'asc',
    });

    const tenants = tenantsRes.items;
    const tenantById = new Map(tenants.map((t) => [t.id, t]));

    // Fetch all devices in caller's multi-tenant scope (ignoring activeTenantId so NOC sees all assigned orgs)
    const overviewCtx: TenantContext = {
      ...ctx,
      activeTenantId: null,
    };
    const rawDevices = this.repos.devices.listAllInScope(overviewCtx);
    const devices = rawDevices.map((d) => this.liveState.mergeIntoDevice(d));

    const cardsByTenant = new Map<string, FleetOverviewTenantCard>();
    const activeByTenant = new Map<string, { activeTotal: number; activeOnline: number }>();

    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(now);
    dayEnd.setHours(23, 59, 59, 999);

    const tenantIdsForAlerts = tenants.map((t) => t.id);
    const alertCountsByTenant = this.repos.alerts.countActiveByTenantIds(tenantIdsForAlerts);
    const ticketCountsByTenant = this.repos.tickets.countOpenByTenantIds(tenantIdsForAlerts);
    const workOrdersTodayByTenant = this.repos.workOrders.countTodayByTenantIds(
      tenantIdsForAlerts,
      dayStart.toISOString(),
      dayEnd.toISOString(),
    );

    for (const t of tenants) {
      cardsByTenant.set(t.id, {
        tenantId: t.id,
        tenantName: t.name,
        tenantCode: t.code,
        status: t.status,
        deviceCount: 0,
        onlineCount: 0,
        offlineCount: 0,
        onlinePercentage: 0,
        openAlertCount: alertCountsByTenant.get(t.id)?.total ?? 0,
        openTicketCount: ticketCountsByTenant.get(t.id) ?? 0,
        workOrdersToday: workOrdersTodayByTenant.get(t.id) ?? 0,
      });
      activeByTenant.set(t.id, { activeTotal: 0, activeOnline: 0 });
    }

    const needsAttention: FleetNeedsAttentionItem[] = [];

    // Prioritize unacknowledged CRITICAL alerts at top of Needs Attention (Section 10.2)
    const openCriticalAlerts = this.repos.alerts.listOpenCriticalInScope(overviewCtx, 30);
    for (const alert of openCriticalAlerts) {
      const t = tenantById.get(alert.tenantId);
      needsAttention.push({
        deviceId: alert.deviceId,
        deviceName: alert.deviceName ?? alert.deviceId,
        tenantId: alert.tenantId,
        tenantCode: alert.tenantCode ?? t?.code ?? '',
        tenantName: alert.tenantName ?? t?.name ?? '',
        siteName: alert.siteName ?? 'Unknown Site',
        modelName: alert.modelName ?? '',
        reason: 'CRITICAL_ALERT',
        lastSeenAt: alert.createdAt,
        severity: 'CRITICAL',
        alertId: alert.id,
        message: alert.message,
      });
    }

    for (const d of devices) {
      const card = cardsByTenant.get(d.tenantId);
      if (!card) continue;
      card.deviceCount += 1;
      if (d.connectivity === 'ONLINE') card.onlineCount += 1;
      if (d.connectivity === 'OFFLINE') card.offlineCount += 1;

      if (d.state === 'ACTIVE') {
        const stats = activeByTenant.get(d.tenantId)!;
        stats.activeTotal += 1;
        if (d.connectivity === 'ONLINE') stats.activeOnline += 1;
      }

      // Flag ACTIVE devices that are currently OFFLINE in Needs Attention
      if (d.state === 'ACTIVE' && d.connectivity === 'OFFLINE') {
        const t = tenantById.get(d.tenantId);
        needsAttention.push({
          deviceId: d.id,
          deviceName: d.name,
          tenantId: d.tenantId,
          tenantCode: t?.code ?? '',
          tenantName: t?.name ?? '',
          siteName: d.siteName ?? 'Unknown Site',
          modelName: d.modelName ?? 'Unknown Model',
          reason: 'OFFLINE',
          lastSeenAt: d.lastSeenAt,
          severity: 'WARNING',
        });
      }
    }

    for (const [tid, card] of cardsByTenant.entries()) {
      const stats = activeByTenant.get(tid);
      if (stats && stats.activeTotal > 0) {
        card.onlinePercentage = Math.round((stats.activeOnline / stats.activeTotal) * 100);
      } else if (card.deviceCount > 0) {
        card.onlinePercentage = Math.round((card.onlineCount / card.deviceCount) * 100);
      } else {
        card.onlinePercentage = 0;
      }
    }

    // Include waiting/unassigned tickets and overdue work orders in Needs Attention (Section 10.2)
    const waitingTickets = this.repos.tickets.listWaitingInScope(overviewCtx, 15);
    for (const tk of waitingTickets) {
      const t = tenantById.get(tk.tenantId);
      needsAttention.push({
        deviceId: tk.deviceId ?? tk.id,
        deviceName: tk.deviceName ?? tk.number,
        tenantId: tk.tenantId,
        tenantCode: tk.tenantCode ?? t?.code ?? '',
        tenantName: tk.tenantName ?? t?.name ?? '',
        siteName: tk.siteName ?? 'Organization',
        modelName: tk.number,
        reason: 'TICKET_WAITING',
        lastSeenAt: tk.updatedAt,
        severity: tk.priority === 'CRITICAL' ? 'CRITICAL' : 'WARNING',
        ticketId: tk.id,
        message: `${tk.number} (${tk.status.replaceAll('_', ' ')}): ${tk.title}`,
      });
    }

    const overdueWorkOrders = this.repos.workOrders.listOverdueInScope(
      overviewCtx,
      now.toISOString(),
      15,
    );
    for (const wo of overdueWorkOrders) {
      const t = tenantById.get(wo.tenantId);
      needsAttention.push({
        deviceId: wo.deviceId,
        deviceName: wo.deviceName ?? wo.number,
        tenantId: wo.tenantId,
        tenantCode: wo.tenantCode ?? t?.code ?? '',
        tenantName: wo.tenantName ?? t?.name ?? '',
        siteName: wo.siteName ?? 'Unknown Site',
        modelName: wo.number,
        reason: 'OVERDUE_WORK_ORDER',
        lastSeenAt: wo.plannedEnd ?? wo.updatedAt,
        severity: 'WARNING',
        workOrderId: wo.id,
        message: `${wo.number} overdue: ${wo.title}`,
      });
    }

    // CRITICAL_ALERT items first, then oldest offline/created items
    needsAttention.sort((a, b) => {
      if (a.severity !== b.severity) {
        return a.severity === 'CRITICAL' ? -1 : 1;
      }
      const ta = a.lastSeenAt ? Date.parse(a.lastSeenAt) : 0;
      const tb = b.lastSeenAt ? Date.parse(b.lastSeenAt) : 0;
      return ta - tb;
    });

    const tenantCards = Array.from(cardsByTenant.values());
    const totals = {
      tenants: tenantCards.length,
      devices: tenantCards.reduce((acc, c) => acc + c.deviceCount, 0),
      online: tenantCards.reduce((acc, c) => acc + c.onlineCount, 0),
      offline: tenantCards.reduce((acc, c) => acc + c.offlineCount, 0),
      openAlerts: tenantCards.reduce((acc, c) => acc + c.openAlertCount, 0),
      openTickets: tenantCards.reduce((acc, c) => acc + c.openTicketCount, 0),
    };

    return {
      tenants: tenantCards,
      needsAttention: needsAttention.slice(0, 50),
      totals,
      generatedAt: new Date().toISOString(),
    };
  }
}
