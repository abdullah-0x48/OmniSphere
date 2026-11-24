import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, ExternalLink, Plus, RotateCcw } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  PlatformHealthReportResponse,
  PlatformHealthTenantRow,
} from '../../shared/types.ts';
import { ApiClientError, apiRequest } from '../api/client.ts';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  KpiCard,
  PageHeader,
  StatusChip,
  useToast,
} from '../components/ui/index.ts';
import { formatLocalDateTime } from '../utils/format.ts';

const STATE_BAR_COLORS: Record<string, string> = {
  ACTIVE: '#059669',
  PROVISIONED: '#0284c7',
  UNDER_MAINTENANCE: '#d97706',
  SUSPENDED: '#64748b',
  DECOMMISSIONED: '#94a3b8',
};

export function PlatformPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [confirmSeedOpen, setConfirmSeedOpen] = useState(false);

  const healthQuery = useQuery({
    queryKey: ['platform-health-report'],
    queryFn: () => apiRequest<PlatformHealthReportResponse>('/reports/platform-health'),
    refetchInterval: 10_000,
  });

  const seedMutation = useMutation({
    mutationFn: () => apiRequest('/platform/seed-demo', { method: 'POST' }),
    onSuccess: () => {
      setConfirmSeedOpen(false);
      toast({
        kind: 'success',
        title: 'Demo data restored',
        description: 'All seeded organizations, devices, telemetry, and workflows are ready.',
      });
      void queryClient.invalidateQueries();
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Reset failed',
        description: err instanceof ApiClientError ? err.message : 'Unable to restore demo data.',
      });
    },
  });

  const data = healthQuery.data;

  const stateChartData = data
    ? [
        { state: 'Active', key: 'ACTIVE', count: data.devicesByState.ACTIVE },
        { state: 'Provisioned', key: 'PROVISIONED', count: data.devicesByState.PROVISIONED },
        { state: 'Maintenance', key: 'UNDER_MAINTENANCE', count: data.devicesByState.UNDER_MAINTENANCE },
        { state: 'Suspended', key: 'SUSPENDED', count: data.devicesByState.SUSPENDED },
        { state: 'Decomm.', key: 'DECOMMISSIONED', count: data.devicesByState.DECOMMISSIONED },
      ]
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform Health"
        description="Real-time multi-tenant health, ingestion throughput, firmware inventory, and alert status across OmniSphere."
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              icon={<BarChart3 className="w-4 h-4" />}
              onClick={() => navigate('/reports')}
            >
              Reports & KPIs
            </Button>
            <a
              href="/api/docs"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <span>API Docs</span>
              <ExternalLink className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
            </a>
            {data?.demoMode && (
              <Button
                variant="secondary"
                icon={<RotateCcw className="w-4 h-4" />}
                onClick={() => setConfirmSeedOpen(true)}
              >
                Load / reset demo data
              </Button>
            )}
            <Button icon={<Plus className="w-4 h-4" />} onClick={() => navigate('/tenants?create=1')}>
              New tenant
            </Button>
          </>
        }
      />

      {healthQuery.isError ? (
        <ErrorState
          message={
            healthQuery.error instanceof ApiClientError
              ? healthQuery.error.message
              : 'Failed to load platform health metrics.'
          }
          onRetry={() => void healthQuery.refetch()}
        />
      ) : (
        <>
          {/* FR-RPT-04 Platform Health KPI Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            <KpiCard
              loading={healthQuery.isLoading}
              label="Client Organizations"
              value={data?.tenants.total ?? 0}
              subtext={
                data
                  ? `${data.tenants.active} active · ${data.tenants.suspended} suspended`
                  : undefined
              }
            />
            <KpiCard
              loading={healthQuery.isLoading}
              label="Fleet Devices"
              value={data?.devicesTotal ?? 0}
              subtext={
                data
                  ? `${data.devicesByState.ACTIVE} active · ${data.deviceModelsTotal} models`
                  : undefined
              }
              tone="emerald"
            />
            <KpiCard
              loading={healthQuery.isLoading}
              label="Messages / Min (1h)"
              value={`${data?.messagesPerMinute ?? 0} /m`}
              subtext={
                data
                  ? `${data.messagesLastHour} msgs · ${data.invalidPayloadRate}% invalid`
                  : 'Last hour'
              }
              tone={(data?.invalidPayloadRate ?? 0) > 10 ? 'amber' : 'default'}
            />
            <KpiCard
              loading={healthQuery.isLoading}
              label="Open Critical Alerts"
              value={data?.openCriticalAlerts ?? 0}
              subtext="Across all tenants"
              tone={(data?.openCriticalAlerts ?? 0) > 0 ? 'red' : 'emerald'}
            />
            <Link to="/firmware" className="block rounded-xl focus-visible:outline-none">
              <KpiCard
                loading={healthQuery.isLoading}
                label="Firmware Packages"
                value={data?.firmwarePackages.total ?? 0}
                subtext={
                  data
                    ? `${data.firmwarePackages.released} released · ${data.firmwarePackages.draft} draft`
                    : undefined
                }
              />
            </Link>
            <Link to="/email-outbox" className="block rounded-xl focus-visible:outline-none">
              <KpiCard
                loading={healthQuery.isLoading}
                label="Email Failures"
                value={data?.emailOutbox.failed ?? 0}
                subtext={
                  data
                    ? `${data.emailOutbox.queued} queued · ${data.auditEventsLast24h} audit (24h)`
                    : undefined
                }
                tone={(data?.emailOutbox.failed ?? 0) > 0 ? 'red' : 'emerald'}
              />
            </Link>
          </div>

          {/* Devices by State Chart & Platform Summary */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <Card className="p-5 lg:col-span-7">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Devices by Lifecycle State</h2>
                  <p className="text-xs text-slate-600">
                    Global device distribution across all client organizations
                  </p>
                </div>
                {data && (
                  <span className="font-mono text-xs text-slate-600">
                    Total: {data.devicesTotal}
                  </span>
                )}
              </div>
              <div className="h-52 w-full">
                {stateChartData.length > 0 ? (
                  <>
                    <p className="sr-only">
                      Global devices by lifecycle state:{' '}
                      {stateChartData.map((s) => `${s.state}: ${s.count}`).join(', ')}.
                    </p>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={stateChartData} margin={{ top: 8, right: 16, left: -16, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="state" tick={{ fontSize: 11, fill: '#475569' }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#475569' }} />
                        <Tooltip />
                        <Bar dataKey="count" name="Devices" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                          {stateChartData.map((entry) => (
                            <Cell key={entry.key} fill={STATE_BAR_COLORS[entry.key] ?? '#4f46e5'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </>
                ) : (
                  <div className="h-full bg-slate-100 rounded-lg animate-pulse" aria-busy="true" />
                )}
              </div>
            </Card>

            <Card className="p-5 lg:col-span-5 flex flex-col justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Operations & Security Snapshot</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Platform-wide accounts, ingestion hygiene, and audit activity
                </p>
                <dl className="mt-4 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                    <dt className="text-slate-500">Active / Total Users</dt>
                    <dd className="font-mono font-semibold text-slate-900">
                      {data ? `${data.users.active} / ${data.users.total}` : '—'}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                    <dt className="text-slate-500">Provider Staff (SE & FT)</dt>
                    <dd className="font-mono font-semibold text-slate-900">
                      {data?.users.providerStaff ?? '—'}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                    <dt className="text-slate-500">Invalid Payloads (Last Hour)</dt>
                    <dd className="font-mono font-semibold text-slate-900">
                      {data ? `${data.invalidPayloadsLastHour} (${data.invalidPayloadRate}%)` : '—'}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                    <dt className="text-slate-500">Outbox Emails Sent / Failed</dt>
                    <dd className="font-mono font-semibold text-slate-900">
                      {data ? `${data.emailOutbox.sent} sent · ${data.emailOutbox.failed} failed` : '—'}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between py-1.5">
                    <dt className="text-slate-500">Audit Log Entries (24h)</dt>
                    <dd className="font-mono font-semibold text-indigo-600">
                      <Link to="/audit" className="hover:underline">
                        {data?.auditEventsLast24h ?? 0} events →
                      </Link>
                    </dd>
                  </div>
                </dl>
              </div>
            </Card>
          </div>

          {/* Client Organizations Table */}
          <Card className="overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Client organizations</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Click any organization to inspect settings, users, and tenant audit history.
                </p>
              </div>
              <Link to="/tenants" className="text-xs font-medium text-indigo-600 hover:text-indigo-700">
                Manage all tenants
              </Link>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70">
                    <th className="px-5 py-3 text-xs font-semibold text-slate-600">Organization</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-600">Code</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-600">Status</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-600 text-right">Devices</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-600 text-right">Online %</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-600 text-right">Critical Alerts</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-600 text-right">Open Tickets</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-600 text-right">Users</th>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-600 text-right">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {healthQuery.isLoading ? (
                    Array.from({ length: 3 }).map((_, idx) => (
                      <tr key={idx}>
                        <td colSpan={9} className="px-5 py-3.5">
                          <div className="h-4 bg-slate-100 rounded w-1/2 animate-pulse" />
                        </td>
                      </tr>
                    ))
                  ) : (data?.tenantBreakdown ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-5 py-6">
                        <EmptyState
                          title="No client organizations yet"
                          description="Create your first client organization to onboard sites, users, and devices."
                          action={
                            <Button
                              size="sm"
                              icon={<Plus className="w-4 h-4" />}
                              onClick={() => navigate('/tenants?create=1')}
                            >
                              New tenant
                            </Button>
                          }
                        />
                      </td>
                    </tr>
                  ) : (
                    (data?.tenantBreakdown ?? []).map((t: PlatformHealthTenantRow) => (
                      <tr
                        key={t.id}
                        tabIndex={0}
                        onClick={() => navigate(`/tenants/${t.id}`)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            navigate(`/tenants/${t.id}`);
                          }
                        }}
                        className="hover:bg-slate-50 cursor-pointer transition-colors"
                      >
                        <td className="px-5 py-3.5">
                          <p className="text-sm font-medium text-slate-900">{t.name}</p>
                        </td>
                        <td className="px-4 py-3.5 font-mono text-xs font-semibold text-slate-700">
                          {t.code}
                        </td>
                        <td className="px-4 py-3.5">
                          <StatusChip status={t.status} />
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono text-xs tabular-nums text-slate-800 font-medium">
                          {t.deviceCount}
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono text-xs tabular-nums text-slate-700">
                          {t.onlinePercentage !== null ? `${t.onlinePercentage}%` : '—'}
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono text-xs tabular-nums">
                          <span className={t.openCriticalAlerts > 0 ? 'text-red-700 font-semibold' : 'text-slate-600'}>
                            {t.openCriticalAlerts}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono text-xs tabular-nums text-slate-700">
                          {t.openTickets}
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono text-xs tabular-nums text-slate-700">
                          {t.activeUserCount} / {t.userCount}
                        </td>
                        <td className="px-5 py-3.5 text-right font-mono text-xs tabular-nums text-slate-600">
                          {formatLocalDateTime(t.createdAt)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <ConfirmDialog
        open={confirmSeedOpen}
        onClose={() => setConfirmSeedOpen(false)}
        onConfirm={() => seedMutation.mutate()}
        loading={seedMutation.isPending}
        variant="primary"
        title="Load / reset demo data"
        message="This will restore all demo organizations (KTL, MFP, SCW), reset demo accounts to Active with default credentials, and log a DEMO_DATA_RESET audit entry."
        confirmLabel="Restore demo data"
      />
    </div>
  );
}
