import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Building2, ClipboardCheck, Cpu, ScrollText, Settings, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  ROLE_LABELS,
  type DevicePublic,
  type PaginatedResponse,
  type TenantSummary,
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
  StatusChip,
  useToast,
} from '../components/ui/index.ts';

/**
 * Support / NOC Engineer home (/noc) — shows assigned tenants fetched from GET /api/v1/tenants
 * and lets the SE switch their active X-Tenant-Id workspace directly.
 */
export function NocHomePage() {
  const { user, activeTenantId, setActiveTenantId } = useAuth();
  const { toast } = useToast();

  const tenantsQuery = useQuery({
    queryKey: ['se-assigned-tenants'],
    queryFn: () =>
      apiRequest<PaginatedResponse<TenantSummary>>('/tenants', {
        query: { page: 1, pageSize: 100, sort: 'name:asc' },
      }),
  });

  const assigned = tenantsQuery.data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="NOC Overview"
        description={`Cross-tenant workspace for ${user?.name ?? ''} (${user?.isSupervisor ? 'Supervisor · ' : ''}${assigned.length} assigned organizations).`}
      />

      {tenantsQuery.isError ? (
        <ErrorState
          message={
            tenantsQuery.error instanceof ApiClientError
              ? tenantsQuery.error.message
              : 'Unable to load assigned organizations.'
          }
          onRetry={() => void tenantsQuery.refetch()}
        />
      ) : assigned.length === 0 && !tenantsQuery.isLoading ? (
        <Card>
          <EmptyState
            icon={<Building2 className="w-7 h-7" />}
            title="No client organizations assigned"
            description="Ask a Platform Admin to assign one or more client organizations to your account."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {assigned.map((t) => {
            const isSelected = activeTenantId === t.id;
            return (
              <Card
                key={t.id}
                className={`p-5 flex flex-col justify-between gap-4 ${
                  isSelected ? 'ring-2 ring-indigo-600/20 border-indigo-400' : ''
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-mono font-semibold text-indigo-600">{t.code}</p>
                      <h2 className="text-base font-semibold text-slate-900 mt-0.5">{t.name}</h2>
                    </div>
                    <StatusChip status={t.status} />
                  </div>
                  <div className="text-xs text-slate-500 space-y-1">
                    <p>Contact: {t.contactEmail}</p>
                    <p>
                      Heartbeat: {t.settings.heartbeatIntervalSec}s · Offline after{' '}
                      {t.settings.offlineAfterMissedIntervals} missed · Critical ack{' '}
                      {t.settings.criticalAckMinutes}m
                    </p>
                    <p>
                      Approvals:{' '}
                      {t.settings.requireRolloutApproval ? 'Rollout required' : 'Rollout direct'} ·{' '}
                      {t.settings.requireMaintenanceApproval
                        ? 'Downtime required'
                        : 'Downtime direct'}
                    </p>
                  </div>
                </div>
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                  <span className="text-xs font-mono tabular-nums text-slate-600">
                    {t.deviceCount} devices · {t.onlinePercentage ?? 0}% online
                  </span>
                  <Button
                    size="sm"
                    variant={isSelected ? 'secondary' : 'primary'}
                    onClick={() => {
                      setActiveTenantId(t.id);
                      toast({ kind: 'info', title: `Active workspace set to ${t.name} (${t.code})` });
                    }}
                  >
                    {isSelected ? 'Selected' : 'Select workspace'}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Client Admin & Client Manager home (/dashboard) — backed by GET /api/v1/tenants/:id.
 */
export function ClientDashboardPage() {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const isCA = user?.role === 'CLIENT_ADMIN';

  const tenantQuery = useQuery({
    queryKey: ['client-home-tenant', tenantId],
    queryFn: () => apiRequest<TenantSummary>(`/tenants/${tenantId}`),
    enabled: Boolean(tenantId),
  });

  const tenant = tenantQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={tenant ? `${tenant.name} Dashboard` : 'Organization Dashboard'}
        description={
          user
            ? `${ROLE_LABELS[user.role]} · ${user.tenantCode ?? ''}`
            : undefined
        }
        actions={tenant ? <StatusChip status={tenant.status} /> : undefined}
      />

      {tenantQuery.isError ? (
        <ErrorState
          message={
            tenantQuery.error instanceof ApiClientError
              ? tenantQuery.error.message
              : 'Unable to load organization details.'
          }
          onRetry={() => void tenantQuery.refetch()}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Registered Devices"
              value={tenant ? tenant.deviceCount : '—'}
              subtext={
                tenant && tenant.onlinePercentage !== null
                  ? `${tenant.onlinePercentage}% currently online`
                  : 'Fleet inventory'
              }
              tone="emerald"
            />
            <KpiCard
              label="Organization Users"
              value={tenant ? tenant.activeUserCount : '—'}
              subtext={tenant ? `${tenant.userCount} total accounts` : 'Loading...'}
            />
            <KpiCard
              label="Heartbeat Interval"
              value={tenant ? `${tenant.settings.heartbeatIntervalSec}s` : '—'}
              subtext={
                tenant
                  ? `Offline after ${tenant.settings.offlineAfterMissedIntervals} missed`
                  : undefined
              }
            />
            <KpiCard
              label="Critical Alert SLA"
              value={tenant ? `${tenant.settings.criticalAckMinutes}m` : '—'}
              subtext={
                tenant
                  ? `${tenant.settings.requireRolloutApproval ? 'OTA approval' : 'Direct OTA'} · ${
                      tenant.settings.requireMaintenanceApproval ? 'Downtime approval' : 'Direct maint.'
                    }`
                  : undefined
              }
            />
          </div>

          {isCA && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Link to="/users" className="block group">
                <Card className="p-5 hover:border-indigo-300 transition-colors">
                  <div className="flex items-center justify-between">
                    <Users className="w-5 h-5 text-indigo-600" />
                    <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-indigo-600 transition-colors" />
                  </div>
                  <h2 className="mt-3 text-sm font-semibold text-slate-900">Manage Users</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Add Client Managers and Operators, update roles, or send password resets.
                  </p>
                </Card>
              </Link>
              <Link to="/settings" className="block group">
                <Card className="p-5 hover:border-indigo-300 transition-colors">
                  <div className="flex items-center justify-between">
                    <Settings className="w-5 h-5 text-indigo-600" />
                    <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-indigo-600 transition-colors" />
                  </div>
                  <h2 className="mt-3 text-sm font-semibold text-slate-900">Organization Settings</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Tune heartbeat timeouts, critical escalation timing, and approval rules.
                  </p>
                </Card>
              </Link>
              <Link to="/audit" className="block group">
                <Card className="p-5 hover:border-indigo-300 transition-colors">
                  <div className="flex items-center justify-between">
                    <ScrollText className="w-5 h-5 text-indigo-600" />
                    <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-indigo-600 transition-colors" />
                  </div>
                  <h2 className="mt-3 text-sm font-semibold text-slate-900">Audit Trail</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Inspect immutable security and configuration events for your organization.
                  </p>
                </Card>
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Field Technician mobile-first home (/my-work-orders).
 */
export function MyWorkOrdersPage() {
  const { user, tenants } = useAuth();

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Work Orders"
        description={`Assigned field assignments for ${user?.name ?? ''}.`}
      />

      <Card className="p-5">
        <h2 className="text-xs font-semibold text-slate-500">Assigned Client Organizations</h2>
        {tenants.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No assigned organizations.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100">
            {tenants.map((t) => (
              <li key={t.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-slate-800">{t.name}</span>
                <span className="font-mono text-xs text-slate-500">{t.code}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <EmptyState
          icon={<ClipboardCheck className="w-7 h-7" />}
          title="No work orders assigned yet"
          description="Corrective and preventive maintenance work orders assigned to you will appear here grouped by Today, Upcoming, and Completed."
        />
      </Card>
    </div>
  );
}

/**
 * Client Operator mobile-first home (/live-status) — live device tiles grouped by site.
 */
export function LiveStatusPage() {
  const { user } = useAuth();
  const [onlyOffline, setOnlyOffline] = React.useState(false);

  const devicesQuery = useQuery({
    queryKey: ['co-live-devices'],
    queryFn: () =>
      apiRequest<PaginatedResponse<DevicePublic>>('/devices', {
        query: { page: 1, pageSize: 100, sort: 'name:asc' },
      }),
  });

  const allDevices = devicesQuery.data?.items ?? [];
  const filtered = onlyOffline
    ? allDevices.filter((d) => d.connectivity === 'OFFLINE' || d.state !== 'ACTIVE')
    : allDevices;

  const grouped = new Map<string, DevicePublic[]>();
  for (const d of filtered) {
    const key = d.siteName ?? d.siteId;
    const list = grouped.get(key) ?? [];
    list.push(d);
    grouped.set(key, list);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Live Status"
        description={`Fleet tiles for ${user?.tenantName ?? 'your organization'} (${allDevices.length} devices).`}
        actions={
          <Button
            variant={onlyOffline ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setOnlyOffline((v) => !v)}
          >
            {onlyOffline ? 'Showing issues only' : 'Only problems'}
          </Button>
        }
      />

      {devicesQuery.isError ? (
        <ErrorState
          message={
            devicesQuery.error instanceof ApiClientError
              ? devicesQuery.error.message
              : 'Unable to load devices.'
          }
          onRetry={() => void devicesQuery.refetch()}
        />
      ) : devicesQuery.isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div key={idx} className="h-32 bg-white border border-slate-200 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : grouped.size === 0 ? (
        <Card>
          <EmptyState
            icon={<Cpu className="w-7 h-7" />}
            title={onlyOffline ? 'All monitored devices are healthy' : 'No devices registered yet'}
            description={
              onlyOffline
                ? 'Switch off the "Only problems" filter to inspect all active devices.'
                : 'Registered industrial devices for your organization will appear here grouped by site.'
            }
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {Array.from(grouped.entries()).map(([siteName, siteDevices]) => (
            <section key={siteName} className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">{siteName}</h2>
                <span className="text-xs font-mono text-slate-500">
                  {siteDevices.length} {siteDevices.length === 1 ? 'device' : 'devices'}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {siteDevices.map((d) => {
                  const metricEntries = Object.entries(d.latestMetrics).slice(0, 2);
                  return (
                    <Link key={d.id} to={`/devices/${d.id}`} className="block group">
                      <Card className="p-4 hover:border-indigo-300 transition-colors">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900 truncate group-hover:text-indigo-700">
                              {d.name}
                            </p>
                            <p className="text-xs font-mono text-slate-500 truncate">
                              {d.serialNumber}
                            </p>
                          </div>
                          <StatusChip status={d.connectivity} />
                        </div>
                        <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
                          <StatusChip status={d.state} />
                          <div className="flex items-center gap-3 font-mono tabular-nums text-slate-700">
                            {metricEntries.length === 0 ? (
                              <span className="text-slate-400">No readings</span>
                            ) : (
                              metricEntries.map(([k, v]) => (
                                <span key={k}>
                                  {k.replace('_rms', '')}: <strong>{String(v)}</strong>
                                </span>
                              ))
                            )}
                          </div>
                        </div>
                      </Card>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
      <p className="font-mono text-xs font-semibold text-indigo-600">404</p>
      <h1 className="mt-2 text-2xl font-semibold text-slate-900">Page not found</h1>
      <p className="mt-1.5 text-sm text-slate-500 max-w-md">
        The page you requested does not exist or has moved.
      </p>
      <Link
        to="/"
        className="mt-5 inline-flex items-center justify-center h-9 px-4 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
      >
        Go to home
      </Link>
    </div>
  );
}
