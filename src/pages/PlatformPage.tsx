import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Plus, RotateCcw } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import type { PlatformOverviewResponse, TenantSummary } from '../../shared/types.ts';
import { ApiClientError, apiRequest } from '../api/client.ts';
import {
  Button,
  Card,
  ConfirmDialog,
  ErrorState,
  KpiCard,
  PageHeader,
  StatusChip,
  useToast,
} from '../components/ui/index.ts';
import { formatLocalDateTime } from '../utils/format.ts';

export function PlatformPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [confirmSeedOpen, setConfirmSeedOpen] = useState(false);

  const overviewQuery = useQuery({
    queryKey: ['platform-overview'],
    queryFn: () => apiRequest<PlatformOverviewResponse>('/platform/overview'),
  });

  const seedMutation = useMutation({
    mutationFn: () => apiRequest('/platform/seed-demo', { method: 'POST' }),
    onSuccess: () => {
      setConfirmSeedOpen(false);
      toast({ kind: 'success', title: 'Demo data restored', description: 'All seeded organizations and accounts are ready.' });
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

  const data = overviewQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform Health"
        description="Multi-tenant overview across all client organizations and provider accounts."
        actions={
          <>
            <a
              href="/api/docs"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <span>API Docs</span>
              <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
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

      {overviewQuery.isError ? (
        <ErrorState
          message={
            overviewQuery.error instanceof ApiClientError
              ? overviewQuery.error.message
              : 'Failed to load platform overview.'
          }
          onRetry={() => void overviewQuery.refetch()}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Client Organizations"
              value={overviewQuery.isLoading ? '—' : data?.counts.tenantsTotal ?? 0}
              subtext={
                data
                  ? `${data.counts.tenantsActive} active · ${data.counts.tenantsSuspended} suspended`
                  : 'Loading...'
              }
            />
            <KpiCard
              label="Fleet Devices"
              value={overviewQuery.isLoading ? '—' : data?.counts.devicesTotal ?? 0}
              subtext={
                data
                  ? `${data.counts.devicesByState.ACTIVE} active · ${data.counts.devicesByState.PROVISIONED} provisioned · ${data.counts.deviceModelsTotal} models`
                  : 'Loading...'
              }
              tone="emerald"
            />
            <KpiCard
              label="Total Users"
              value={overviewQuery.isLoading ? '—' : data?.counts.usersTotal ?? 0}
              subtext={
                data
                  ? `${data.counts.usersActive} active · ${data.counts.providerStaffCount} provider staff`
                  : 'Loading...'
              }
            />
            <KpiCard
              label="Audit Events (24h)"
              value={overviewQuery.isLoading ? '—' : data?.counts.auditEventsLast24h ?? 0}
              subtext={
                data
                  ? `${data.counts.emailsQueuedOrFailed} emails queued or failed`
                  : 'Append-only security trail'
              }
              tone={(data?.counts.emailsQueuedOrFailed ?? 0) > 0 ? 'amber' : 'default'}
            />
          </div>

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
                    <th className="px-4 py-3 text-xs font-semibold text-slate-600 text-right">Users</th>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-600 text-right">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {overviewQuery.isLoading
                    ? Array.from({ length: 3 }).map((_, idx) => (
                        <tr key={idx}>
                          <td colSpan={7} className="px-5 py-3.5">
                            <div className="h-4 bg-slate-100 rounded w-1/2 animate-pulse" />
                          </td>
                        </tr>
                      ))
                    : (data?.tenants ?? []).map((t: TenantSummary) => (
                        <tr
                          key={t.id}
                          onClick={() => navigate(`/tenants/${t.id}`)}
                          className="hover:bg-slate-50 cursor-pointer transition-colors"
                        >
                          <td className="px-5 py-3.5">
                            <p className="text-sm font-medium text-slate-900">{t.name}</p>
                            <p className="text-xs text-slate-500">{t.contactEmail}</p>
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
                          <td className="px-4 py-3.5 text-right font-mono text-xs tabular-nums text-slate-700">
                            {t.activeUserCount} / {t.userCount}
                          </td>
                          <td className="px-5 py-3.5 text-right font-mono text-xs tabular-nums text-slate-500">
                            {formatLocalDateTime(t.createdAt)}
                          </td>
                        </tr>
                      ))}
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
