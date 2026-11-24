import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowRight, BarChart3, Bell, Cpu, MapPin, Radio } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ROLE_LABELS,
  type AlertPublic,
  type DevicePublic,
  type DeviceTelemetryResponse,
  type FleetSummaryResponse,
  type PaginatedResponse,
} from '../../shared/types.ts';
import { ApiClientError, apiRequest } from '../api/client.ts';
import { useAuth } from '../auth/AuthContext.tsx';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  KpiCard,
  PageHeader,
  RelativeTime,
  SeverityChip,
  StatusChip,
} from '../components/ui/index.ts';

const CONNECTIVITY_COLORS: Record<string, string> = {
  Online: '#059669',
  Offline: '#dc2626',
  Unknown: '#94a3b8',
};

function MiniDeviceLiveChart({ device }: { device: DevicePublic }) {
  const query = useQuery({
    queryKey: ['fleet-strip-telemetry', device.id],
    queryFn: () =>
      apiRequest<DeviceTelemetryResponse>(`/devices/${device.id}/telemetry`, {
        query: { range: '1h' },
      }),
    refetchInterval: 5000,
  });

  const firstMetric = query.data?.metrics[0];
  const points = firstMetric ? query.data?.series[firstMetric.key] ?? [] : [];
  const latestVal = points.length > 0 ? points[points.length - 1].value : device.latestMetrics[firstMetric?.key ?? ''];

  return (
    <Card className="p-4 flex flex-col justify-between gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            to={`/devices/${device.id}`}
            className="text-sm font-semibold text-slate-900 hover:text-indigo-600 truncate block"
          >
            {device.name}
          </Link>
          <p className="text-xs text-slate-500 truncate">
            {device.siteName} · {firstMetric ? firstMetric.label : 'Telemetry'}
          </p>
        </div>
        <div className="text-right shrink-0">
          <StatusChip status={device.connectivity} />
          {latestVal !== undefined && firstMetric && (
            <p className="mt-1 font-mono text-xs font-semibold text-slate-900 tabular-nums">
              {String(latestVal)}
              {firstMetric.unit ? ` ${firstMetric.unit}` : ''}
            </p>
          )}
        </div>
      </div>

      <div className="h-32 w-full mt-1">
        {query.isLoading ? (
          <div className="h-full rounded-lg bg-slate-100 animate-pulse" aria-busy="true" />
        ) : points.length > 0 ? (
          <>
            <p className="sr-only">
              {device.name} {firstMetric?.label ?? 'telemetry'}: {points.length} samples in the last
              hour, latest value {String(latestVal ?? 'n/a')}
              {firstMetric?.unit ? ` ${firstMetric.unit}` : ''}.
            </p>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 6, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis
                  dataKey="ts"
                  tickFormatter={(v) =>
                    new Date(String(v)).toLocaleTimeString(undefined, {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  }
                  tick={{ fontSize: 10, fill: '#64748b' }}
                  minTickGap={24}
                />
                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} domain={['auto', 'auto']} />
                <Tooltip
                  labelFormatter={(l) => new Date(String(l)).toLocaleTimeString()}
                  formatter={(v) => [
                    `${String(v)}${firstMetric?.unit ? ` ${firstMetric.unit}` : ''}`,
                    firstMetric?.label ?? 'Value',
                  ]}
                  contentStyle={{ fontSize: '11px', borderRadius: '8px', borderColor: '#e2e8f0' }}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#4f46e5"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </>
        ) : (
          <div className="h-full flex items-center justify-center text-xs text-slate-600">
            Waiting for samples...
          </div>
        )}
      </div>
    </Card>
  );
}

/**
 * Single-Tenant Fleet Dashboard (/dashboard — Section 10.3).
 * Used by Client Admin, Client Manager, and Support Engineers working inside an active tenant.
 */
export function FleetDashboardPage() {
  const { user, activeTenantId } = useAuth();
  const navigate = useNavigate();
  const isManager = user?.role === 'CLIENT_MANAGER';
  const canUseSimulator = user?.role === 'CLIENT_ADMIN' || user?.role === 'SUPPORT_ENGINEER';

  const [selectedStripIds, setSelectedStripIds] = useState<string[]>([]);

  const summaryQuery = useQuery({
    queryKey: ['fleet-summary', activeTenantId ?? user?.tenantId],
    queryFn: () => apiRequest<FleetSummaryResponse>('/fleet/summary'),
    refetchInterval: 5000,
  });

  const recentAlertsQuery = useQuery({
    queryKey: ['fleet-recent-alerts', activeTenantId ?? user?.tenantId],
    queryFn: () =>
      apiRequest<PaginatedResponse<AlertPublic>>('/alerts', {
        query: { page: 1, pageSize: 8 },
      }),
    refetchInterval: 5000,
  });

  const data = summaryQuery.data;
  const recentAlerts = recentAlertsQuery.data?.items ?? [];

  // Auto-select up to 3 sample devices for the live telemetry strip when tenant loads
  useEffect(() => {
    if (!data) return;
    const validIds = new Set(data.sampleDevices.map((d) => d.id));
    setSelectedStripIds((prev) => {
      const kept = prev.filter((id) => validIds.has(id));
      if (kept.length > 0) return kept;
      return data.sampleDevices.slice(0, 3).map((d) => d.id);
    });
  }, [data?.tenantId, data?.sampleDevices.length]);

  const toggleStripDevice = (deviceId: string) => {
    setSelectedStripIds((prev) => {
      if (prev.includes(deviceId)) {
        return prev.filter((id) => id !== deviceId);
      }
      if (prev.length >= 3) {
        return [...prev.slice(1), deviceId];
      }
      return [...prev, deviceId];
    });
  };

  const connectivityPieData = data
    ? [
        { name: 'Online', value: data.byConnectivity.ONLINE },
        { name: 'Offline', value: data.byConnectivity.OFFLINE },
        { name: 'Unknown', value: data.byConnectivity.UNKNOWN },
      ].filter((d) => d.value > 0)
    : [];

  const stateBarData = data
    ? [
        { state: 'Active', count: data.byState.ACTIVE },
        { state: 'Provisioned', count: data.byState.PROVISIONED },
        { state: 'Maintenance', count: data.byState.UNDER_MAINTENANCE },
        { state: 'Suspended', count: data.byState.SUSPENDED },
        { state: 'Decomm.', count: data.byState.DECOMMISSIONED },
      ]
    : [];

  const firmwareBarData = (data?.firmwareDistribution ?? []).slice(0, 8).map((item) => {
    const modelShort = item.modelName.split(' ')[0];
    const ver =
      item.firmwareVersion === 'Unreported' || !item.firmwareVersion
        ? '(none)'
        : `v${item.firmwareVersion}`;
    return {
      label: `${modelShort} ${ver}`,
      count: item.count,
    };
  });

  const selectedDevices = (data?.sampleDevices ?? []).filter((d) =>
    selectedStripIds.includes(d.id),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={data ? `${data.tenantName} Fleet Dashboard` : 'Fleet Dashboard'}
        description={
          data && user
            ? `${ROLE_LABELS[user.role]} · ${data.tenantCode} · Live updates every 5s`
            : 'Real-time device connectivity, site health, and live telemetry.'
        }
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            {canUseSimulator && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate('/simulator')}
                icon={<Radio className="w-3.5 h-3.5" />}
              >
                Open Simulator
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate('/reports')}
              icon={<BarChart3 className="w-3.5 h-3.5" />}
            >
              Reports & KPIs
            </Button>
            <Button
              size="sm"
              onClick={() => navigate('/devices')}
              icon={<Cpu className="w-3.5 h-3.5" />}
            >
              Device Inventory
            </Button>
          </div>
        }
      />

      {summaryQuery.isError ? (
        <ErrorState
          message={
            summaryQuery.error instanceof ApiClientError
              ? summaryQuery.error.message
              : 'Unable to load fleet dashboard.'
          }
          onRetry={() => void summaryQuery.refetch()}
        />
      ) : (
        <>
          {/* KPI Row */}
          <div
            className={`grid grid-cols-1 sm:grid-cols-2 ${
              isManager ? 'lg:grid-cols-3 xl:grid-cols-6' : 'lg:grid-cols-5'
            } gap-4`}
          >
            <KpiCard
              loading={summaryQuery.isLoading}
              label="Total Devices"
              value={data?.totalDevices ?? 0}
              subtext={
                data
                  ? `${data.byState.ACTIVE} active · ${data.byState.PROVISIONED} provisioned`
                  : undefined
              }
            />
            <KpiCard
              loading={summaryQuery.isLoading}
              label="Online %"
              value={`${data?.onlinePercentage ?? 0}%`}
              subtext={data ? `${data.onlineCount} online · ${data.offlineCount} offline` : undefined}
              tone={
                (data?.onlinePercentage ?? 100) >= 85
                  ? 'emerald'
                  : (data?.onlinePercentage ?? 100) >= 60
                    ? 'amber'
                    : 'red'
              }
            />
            <Link to="/alerts" className="block rounded-xl focus-visible:outline-none">
              <KpiCard
                loading={summaryQuery.isLoading}
                label="Active Alerts"
                value={`${data?.activeAlertsCritical ?? 0} / ${data?.activeAlertsWarning ?? 0}`}
                subtext="Critical / Warning"
                tone={
                  (data?.activeAlertsCritical ?? 0) > 0
                    ? 'red'
                    : (data?.activeAlertsWarning ?? 0) > 0
                      ? 'amber'
                      : 'default'
                }
              />
            </Link>
            <Link to="/tickets" className="block rounded-xl focus-visible:outline-none">
              <KpiCard
                loading={summaryQuery.isLoading}
                label="Open Tickets"
                value={data?.openTickets ?? 0}
                subtext="Service desk queue"
              />
            </Link>
            <Link to="/work-orders" className="block rounded-xl focus-visible:outline-none">
              <KpiCard
                loading={summaryQuery.isLoading}
                label="Work Orders Today"
                value={data?.workOrdersToday ?? 0}
                subtext="Field maintenance"
              />
            </Link>
            {isManager && (
              <Link to="/approvals" className="block rounded-xl focus-visible:outline-none">
                <KpiCard
                  loading={summaryQuery.isLoading}
                  label="Approvals Waiting"
                  value={data?.approvalsWaiting ?? 0}
                  subtext="Maintenance & OTA rollouts"
                  tone={(data?.approvalsWaiting ?? 0) > 0 ? 'amber' : 'default'}
                />
              </Link>
            )}
          </div>

          {/* Connectivity Donut + Lifecycle State Bar */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <Card className="p-5 lg:col-span-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Connectivity Breakdown</h2>
                  <p className="text-xs text-slate-600">Real-time heartbeat status across fleet</p>
                </div>
                {data && (
                  <span className="text-xs font-mono text-slate-600">
                    {data.messagesPerMinute} msg/min
                  </span>
                )}
              </div>

              <div className="h-52 w-full">
                {summaryQuery.isLoading ? (
                  <div className="h-full rounded-lg bg-slate-100 animate-pulse" aria-busy="true" />
                ) : connectivityPieData.length > 0 ? (
                  <>
                    <p className="sr-only">
                      Connectivity breakdown: {data?.byConnectivity.ONLINE ?? 0} online,{' '}
                      {data?.byConnectivity.OFFLINE ?? 0} offline, and{' '}
                      {data?.byConnectivity.UNKNOWN ?? 0} unknown devices.
                    </p>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={connectivityPieData}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={52}
                          outerRadius={80}
                          paddingAngle={3}
                          isAnimationActive={false}
                        >
                          {connectivityPieData.map((entry) => (
                            <Cell
                              key={entry.name}
                              fill={CONNECTIVITY_COLORS[entry.name] ?? '#64748b'}
                            />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center gap-2 text-xs text-slate-600">
                    <span>No devices registered yet</span>
                    <Button size="sm" variant="secondary" onClick={() => navigate('/devices')}>
                      Register Device
                    </Button>
                  </div>
                )}
              </div>

              <div className="mt-2 flex items-center justify-center gap-5 text-xs text-slate-700">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-600" aria-hidden="true" />
                  Online ({data?.byConnectivity.ONLINE ?? 0})
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-600" aria-hidden="true" />
                  Offline ({data?.byConnectivity.OFFLINE ?? 0})
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-slate-400" aria-hidden="true" />
                  Unknown ({data?.byConnectivity.UNKNOWN ?? 0})
                </span>
              </div>
            </Card>

            <Card className="p-5 lg:col-span-7">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Devices by Lifecycle State</h2>
                  <p className="text-xs text-slate-600">
                    Distribution from Provisioned to Decommissioned
                  </p>
                </div>
                {data && (
                  <span className="text-xs text-slate-600">
                    Updated <RelativeTime iso={data.generatedAt} />
                  </span>
                )}
              </div>
              <div className="h-56 w-full">
                {summaryQuery.isLoading ? (
                  <div className="h-full rounded-lg bg-slate-100 animate-pulse" aria-busy="true" />
                ) : (
                  <>
                    <p className="sr-only">
                      Devices by lifecycle state:{' '}
                      {stateBarData.map((s) => `${s.state}: ${s.count}`).join(', ')}.
                    </p>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={stateBarData} margin={{ top: 8, right: 16, left: -12, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="state" tick={{ fontSize: 11, fill: '#475569' }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#475569' }} />
                        <Tooltip
                          contentStyle={{ fontSize: '12px', borderRadius: '8px', borderColor: '#e2e8f0' }}
                        />
                        <Bar dataKey="count" fill="#4f46e5" radius={[6, 6, 0, 0]} isAnimationActive={false} />
                      </BarChart>
                    </ResponsiveContainer>
                  </>
                )}
              </div>
            </Card>
          </div>

          {/* By Site Table + Firmware Version Distribution */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <Card className="overflow-hidden lg:col-span-7">
              <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-indigo-600" />
                  <h2 className="text-sm font-semibold text-slate-900">Fleet by Site</h2>
                </div>
                <Link to="/sites" className="text-xs font-medium text-indigo-600 hover:text-indigo-700">
                  Manage sites
                </Link>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70">
                      <th className="px-5 py-2.5 text-xs font-semibold text-slate-600">Site</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-600 text-right">Devices</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-600 text-right">Online</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-600 text-right">Offline</th>
                      <th className="px-5 py-2.5 text-xs font-semibold text-slate-600 text-right">Alerts</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {summaryQuery.isLoading ? (
                      Array.from({ length: 3 }).map((_, idx) => (
                        <tr key={idx}>
                          <td colSpan={5} className="px-5 py-3">
                            <div className="h-4 w-2/3 bg-slate-100 rounded animate-pulse" />
                          </td>
                        </tr>
                      ))
                    ) : (data?.bySite ?? []).length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-5 py-6">
                          <EmptyState
                            icon={<MapPin className="w-6 h-6" />}
                            title="No sites configured yet"
                            description="Add a site to organize devices by facility or location."
                            action={
                              <Button size="sm" variant="secondary" onClick={() => navigate('/sites')}>
                                Manage Sites
                              </Button>
                            }
                          />
                        </td>
                      </tr>
                    ) : (
                      (data?.bySite ?? []).map((site) => (
                        <tr
                          key={site.siteId}
                          tabIndex={0}
                          onClick={() => navigate(`/devices?siteId=${site.siteId}`)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              navigate(`/devices?siteId=${site.siteId}`);
                            }
                          }}
                          className="hover:bg-slate-50 cursor-pointer transition-colors"
                        >
                          <td className="px-5 py-3">
                            <p className="font-medium text-slate-900">{site.siteName}</p>
                            {site.location && (
                              <p className="text-xs text-slate-600 truncate max-w-[260px]">
                                {site.location}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-slate-800">
                            {site.deviceCount}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-emerald-700 font-medium">
                            {site.onlineCount}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-red-700 font-medium">
                            {site.offlineCount}
                          </td>
                          <td className="px-5 py-3 text-right font-mono text-xs tabular-nums text-slate-700">
                            {site.openAlertCount}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card className="p-5 lg:col-span-5 flex flex-col justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 mb-1">
                  Firmware Version Distribution
                </h2>
                <p className="text-xs text-slate-600 mb-3">Reported versions grouped by model</p>
                <div className="h-56 w-full">
                  {summaryQuery.isLoading ? (
                    <div className="h-full rounded-lg bg-slate-100 animate-pulse" aria-busy="true" />
                  ) : firmwareBarData.length > 0 ? (
                    <>
                      <p className="sr-only">
                        Firmware distribution:{' '}
                        {firmwareBarData.map((f) => `${f.label}: ${f.count} devices`).join(', ')}.
                      </p>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={firmwareBarData}
                          layout="vertical"
                          margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#475569' }} />
                          <YAxis
                            type="category"
                            dataKey="label"
                            width={124}
                            interval={0}
                            tick={{ fontSize: 11, fill: '#334155' }}
                          />
                          <Tooltip
                            contentStyle={{ fontSize: '12px', borderRadius: '8px', borderColor: '#e2e8f0' }}
                          />
                          <Bar dataKey="count" fill="#0284c7" radius={[0, 6, 6, 0]} isAnimationActive={false} />
                        </BarChart>
                      </ResponsiveContainer>
                    </>
                  ) : (
                    <div className="h-full flex items-center justify-center text-xs text-slate-600">
                      No firmware versions reported
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
                <Link
                  to="/alerts"
                  className="flex items-center gap-1.5 text-slate-700 hover:text-indigo-700 font-medium"
                >
                  <Bell className="w-3.5 h-3.5 text-indigo-600" aria-hidden="true" />
                  Open Alerts: {(data?.activeAlertsCritical ?? 0) + (data?.activeAlertsWarning ?? 0)}
                </Link>
                <Link to="/devices" className="text-indigo-700 hover:text-indigo-800 font-medium inline-flex items-center gap-1">
                  View all devices <ArrowRight className="w-3 h-3" aria-hidden="true" />
                </Link>
              </div>
            </Card>
          </div>

          {/* Recent Alerts Card (latest 8 — Section 10.3) */}
          <Card className="overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-indigo-600" aria-hidden="true" />
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Recent Alerts</h2>
                  <p className="text-xs text-slate-600">
                    Latest alerts across your organization (updates every 5s)
                  </p>
                </div>
              </div>
              <Link
                to="/alerts"
                className="text-xs font-medium text-indigo-700 hover:text-indigo-800 inline-flex items-center gap-1"
              >
                Open alert queue <ArrowRight className="w-3 h-3" aria-hidden="true" />
              </Link>
            </div>
            {recentAlertsQuery.isError ? (
              <div className="p-4">
                <ErrorState
                  message="Unable to load recent alerts."
                  onRetry={() => void recentAlertsQuery.refetch()}
                />
              </div>
            ) : recentAlertsQuery.isLoading ? (
              <div className="p-5 space-y-3" aria-busy="true">
                {Array.from({ length: 3 }).map((_, idx) => (
                  <div key={idx} className="h-8 bg-slate-100 rounded animate-pulse" />
                ))}
              </div>
            ) : recentAlerts.length === 0 ? (
              <EmptyState
                icon={<Bell className="w-6 h-6" />}
                title="No alerts recorded yet"
                description="Threshold breaches and offline device alerts will appear here in real time."
                action={
                  canUseSimulator ? (
                    <Button size="sm" variant="secondary" onClick={() => navigate('/alert-rules')}>
                      Manage Alert Rules
                    </Button>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => navigate('/alerts')}>
                      View Alert History
                    </Button>
                  )
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70">
                      <th className="px-5 py-2.5 text-xs font-semibold text-slate-600">Severity</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-600">Message</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-600">Device</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-600">Status</th>
                      <th className="px-5 py-2.5 text-xs font-semibold text-slate-600 text-right">
                        Opened
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {recentAlerts.map((alert) => (
                      <tr
                        key={alert.id}
                        tabIndex={0}
                        onClick={() => navigate(`/alerts?alertId=${alert.id}`)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            navigate(`/alerts?alertId=${alert.id}`);
                          }
                        }}
                        className="hover:bg-slate-50 cursor-pointer transition-colors"
                      >
                        <td className="px-5 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <SeverityChip severity={alert.severity} />
                            {alert.escalationLevel > 0 && (
                              <span className="px-1.5 py-0.5 rounded text-[11px] font-mono font-semibold bg-red-100 text-red-800">
                                L{alert.escalationLevel}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-xs font-medium text-slate-900 max-w-md truncate">
                          {alert.message}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-700 whitespace-nowrap">
                          {alert.deviceName ?? alert.deviceId}
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusChip status={alert.status} />
                        </td>
                        <td className="px-5 py-2.5 text-right font-mono text-xs text-slate-600 whitespace-nowrap">
                          <RelativeTime iso={alert.createdAt} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Live Telemetry Strip (up to 3 user-picked devices) */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-indigo-600" aria-hidden="true" />
                  Live Telemetry Strip
                </h2>
                <p className="text-xs text-slate-600">
                  Pick up to 3 active devices to monitor their primary metric over the last hour (refreshes every 5s).
                </p>
              </div>

              <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="Select devices for telemetry strip">
                {(data?.sampleDevices ?? []).slice(0, 6).map((d) => {
                  const picked = selectedStripIds.includes(d.id);
                  return (
                    <button
                      key={d.id}
                      type="button"
                      aria-pressed={picked}
                      onClick={() => toggleStripDevice(d.id)}
                      className={`h-8 px-2.5 rounded-md text-xs font-mono transition-colors cursor-pointer border ${
                        picked
                          ? 'bg-indigo-50 border-indigo-300 text-indigo-800 font-semibold'
                          : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {d.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {selectedDevices.length === 0 ? (
              <Card>
                <EmptyState
                  title="Select a device to inspect live telemetry"
                  description="Choose up to 3 devices above to render compact real-time trend charts."
                  action={
                    (data?.sampleDevices ?? []).length > 0 ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          setSelectedStripIds(
                            (data?.sampleDevices ?? []).slice(0, 3).map((d) => d.id),
                          )
                        }
                      >
                        Select sample devices
                      </Button>
                    ) : (
                      <Button size="sm" variant="secondary" onClick={() => navigate('/devices')}>
                        Browse Devices
                      </Button>
                    )
                  }
                />
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {selectedDevices.map((d) => (
                  <MiniDeviceLiveChart key={d.id} device={d} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
