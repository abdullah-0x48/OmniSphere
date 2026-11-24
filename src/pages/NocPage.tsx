import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Building2, CheckCircle2, Radio } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import type { FleetOverviewResponse } from '../../shared/types.ts';
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
  StatusChip,
  useToast,
} from '../components/ui/index.ts';

/**
 * Support / NOC Engineer cross-tenant overview (/noc — Section 10.2).
 * Polls GET /api/v1/fleet/overview every 5s and displays per-tenant health cards
 * plus the prioritized Needs Attention queue.
 */
export function NocPage() {
  const { user, activeTenantId, setActiveTenantId } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const overviewQuery = useQuery({
    queryKey: ['fleet-overview'],
    queryFn: () => apiRequest<FleetOverviewResponse>('/fleet/overview'),
    refetchInterval: 5000,
  });

  const data = overviewQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="NOC Cross-Tenant Overview"
        description={`Live monitoring for ${user?.name ?? ''}${user?.isSupervisor ? ' · Supervisor' : ''} across assigned client fleets (auto-refreshes every 5s).`}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate('/simulator')}
              icon={<Radio className="w-3.5 h-3.5" />}
            >
              Simulator
            </Button>
            <Button
              size="sm"
              onClick={() => navigate('/dashboard')}
              disabled={!activeTenantId}
            >
              Active Tenant Dashboard
            </Button>
          </div>
        }
      />

      {overviewQuery.isError ? (
        <ErrorState
          message={
            overviewQuery.error instanceof ApiClientError
              ? overviewQuery.error.message
              : 'Unable to load NOC overview.'
          }
          onRetry={() => void overviewQuery.refetch()}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              loading={overviewQuery.isLoading}
              label="Assigned Organizations"
              value={data?.totals.tenants ?? 0}
              subtext="Active NOC scope"
            />
            <KpiCard
              loading={overviewQuery.isLoading}
              label="Monitored Devices"
              value={data?.totals.devices ?? 0}
              subtext={
                data ? `${data.totals.online} online · ${data.totals.offline} offline` : undefined
              }
              tone="emerald"
            />
            <KpiCard
              loading={overviewQuery.isLoading}
              label="Needs Attention"
              value={data?.needsAttention.length ?? 0}
              subtext="Critical alerts & offline devices"
              tone={(data?.needsAttention.length ?? 0) > 0 ? 'amber' : 'emerald'}
            />
            <KpiCard
              loading={overviewQuery.isLoading}
              label="Open Alerts & Tickets"
              value={`${data?.totals.openAlerts ?? 0} / ${data?.totals.openTickets ?? 0}`}
              subtext="Alerts / Support tickets"
              tone={(data?.totals.openAlerts ?? 0) > 0 ? 'red' : 'default'}
            />
          </div>

          {/* Assigned Tenant Summary Cards */}
          {overviewQuery.isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" aria-busy="true">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-52 rounded-xl bg-white border border-slate-200 p-5 space-y-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1.5">
                      <div className="h-3.5 w-14 bg-slate-200 rounded animate-pulse" />
                      <div className="h-5 w-40 bg-slate-200 rounded animate-pulse" />
                    </div>
                    <div className="h-5 w-16 bg-slate-100 rounded-full animate-pulse" />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="h-14 rounded-lg bg-slate-100 animate-pulse" />
                    <div className="h-14 rounded-lg bg-slate-100 animate-pulse" />
                    <div className="h-14 rounded-lg bg-slate-100 animate-pulse" />
                  </div>
                  <div className="h-8 bg-slate-100 rounded animate-pulse" />
                </div>
              ))}
            </div>
          ) : (data?.tenants ?? []).length === 0 ? (
            <Card>
              <EmptyState
                icon={<Building2 className="w-7 h-7" />}
                title="No client organizations assigned"
                description="Ask a Platform Admin to assign one or more client organizations to your NOC account."
                action={
                  <Button variant="secondary" onClick={() => void overviewQuery.refetch()}>
                    Refresh assignments
                  </Button>
                }
              />
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {(data?.tenants ?? []).map((t) => {
                const isSelected = activeTenantId === t.tenantId;
                return (
                  <Card
                    key={t.tenantId}
                    className={`p-5 flex flex-col justify-between gap-4 ${
                      isSelected ? 'ring-2 ring-indigo-600/20 border-indigo-400' : ''
                    }`}
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-mono font-semibold text-indigo-700">
                            {t.tenantCode}
                          </p>
                          <h2 className="text-base font-semibold text-slate-900 mt-0.5">
                            {t.tenantName}
                          </h2>
                        </div>
                        <StatusChip status={t.status} />
                      </div>

                      <div className="grid grid-cols-3 gap-2 pt-1 text-center">
                        <div className="rounded-lg bg-slate-50 border border-slate-100 py-2 px-1">
                          <p className="font-mono text-base font-semibold text-slate-900 tabular-nums">
                            {t.deviceCount}
                          </p>
                          <p className="text-[11px] text-slate-600">Devices</p>
                        </div>
                        <div className="rounded-lg bg-emerald-50/70 border border-emerald-100 py-2 px-1">
                          <p className="font-mono text-base font-semibold text-emerald-800 tabular-nums">
                            {t.onlinePercentage}%
                          </p>
                          <p className="text-[11px] text-emerald-800">Online</p>
                        </div>
                        <div className="rounded-lg bg-red-50/60 border border-red-100 py-2 px-1">
                          <p className="font-mono text-base font-semibold text-red-800 tabular-nums">
                            {t.offlineCount}
                          </p>
                          <p className="text-[11px] text-red-700">Offline</p>
                        </div>
                      </div>

                      <p className="text-xs text-slate-600">
                        Alerts: <span className="font-mono text-slate-800">{t.openAlertCount}</span> ·
                        Tickets: <span className="font-mono text-slate-800">{t.openTicketCount}</span> ·
                        Work orders: <span className="font-mono text-slate-800">{t.workOrdersToday}</span>
                      </p>
                    </div>

                    <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                      <Button
                        size="sm"
                        variant={isSelected ? 'secondary' : 'primary'}
                        onClick={() => {
                          setActiveTenantId(t.tenantId);
                          toast({
                            kind: 'info',
                            title: `Active workspace set to ${t.tenantName} (${t.tenantCode})`,
                          });
                        }}
                      >
                        {isSelected ? 'Selected' : 'Select workspace'}
                      </Button>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTenantId(t.tenantId);
                          navigate('/dashboard');
                        }}
                        className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 hover:text-indigo-800 cursor-pointer"
                      >
                        Open dashboard <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Needs Attention Queue */}
          <Card className="overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600" aria-hidden="true" />
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Needs Attention</h2>
                  <p className="text-xs text-slate-600">
                    Critical alerts, offline devices, waiting tickets, and overdue work orders across assigned organizations.
                  </p>
                </div>
              </div>
              {data && (
                <span className="text-xs font-mono text-slate-600">
                  {data.needsAttention.length} items
                </span>
              )}
            </div>

            {overviewQuery.isLoading ? (
              <div className="p-5 space-y-3" aria-busy="true">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-9 bg-slate-100 rounded animate-pulse" />
                ))}
              </div>
            ) : (data?.needsAttention ?? []).length === 0 ? (
              <EmptyState
                icon={<CheckCircle2 className="w-8 h-8 text-emerald-600" />}
                title="All fleets operating normally"
                description="Unacknowledged critical alerts, offline devices, waiting tickets, and overdue work orders will appear here automatically."
                action={
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => navigate('/simulator')}
                    icon={<Radio className="w-3.5 h-3.5" />}
                  >
                    Open Simulator
                  </Button>
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70">
                      <th className="px-5 py-2.5 text-xs font-semibold text-slate-600">Item</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-600">Tenant</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-600">Site</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-600">Status</th>
                      <th className="px-5 py-2.5 text-xs font-semibold text-slate-600 text-right">
                        Since
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {(data?.needsAttention ?? []).map((item) => {
                      const targetHref =
                        item.reason === 'CRITICAL_ALERT' && item.alertId
                          ? `/alerts?alertId=${item.alertId}`
                          : item.reason === 'TICKET_WAITING' && item.ticketId
                            ? `/tickets/${item.ticketId}`
                            : item.reason === 'OVERDUE_WORK_ORDER' && item.workOrderId
                              ? `/work-orders/${item.workOrderId}`
                              : `/devices/${item.deviceId}`;
                      const chipStatus =
                        item.reason === 'CRITICAL_ALERT'
                          ? 'CRITICAL'
                          : item.reason === 'TICKET_WAITING'
                            ? 'WAITING_ON_CLIENT'
                            : item.reason === 'OVERDUE_WORK_ORDER'
                              ? 'PENDING'
                              : 'OFFLINE';
                      const chipLabel =
                        item.reason === 'CRITICAL_ALERT'
                          ? 'Critical Alert'
                          : item.reason === 'TICKET_WAITING'
                            ? 'Ticket Waiting'
                            : item.reason === 'OVERDUE_WORK_ORDER'
                              ? 'Overdue WO'
                              : 'Offline';
                      return (
                        <tr
                          key={`${item.reason}-${item.alertId ?? item.ticketId ?? item.workOrderId ?? item.deviceId}`}
                          className="hover:bg-slate-50 transition-colors"
                        >
                          <td className="px-5 py-3">
                            <Link
                              to={targetHref}
                              onClick={() => setActiveTenantId(item.tenantId)}
                              className="font-medium text-indigo-600 hover:text-indigo-700"
                            >
                              {item.deviceName}
                            </Link>
                            <p className="text-xs text-slate-500 max-w-md truncate">
                              {item.message ?? item.modelName}
                            </p>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-slate-700">
                            {item.tenantCode}
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-700">{item.siteName}</td>
                          <td className="px-4 py-3">
                            <StatusChip status={chipStatus} label={chipLabel} />
                          </td>
                          <td className="px-5 py-3 text-right font-mono text-xs text-slate-600">
                            <RelativeTime iso={item.lastSeenAt} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
