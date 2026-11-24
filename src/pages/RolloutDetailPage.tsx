import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Ban, CheckCircle2, Cpu, FileCode2, RefreshCw } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import type { RolloutDetail } from '../../shared/types.ts';
import { ApiClientError, apiRequest } from '../api/client.ts';
import { useAuth } from '../auth/AuthContext.tsx';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  KpiCard,
  PageHeader,
  RelativeTime,
  StatusChip,
  useToast,
} from '../components/ui/index.ts';
import { formatLocalDateTime } from '../utils/format.ts';

export function RolloutDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const canManage = user?.role === 'CLIENT_ADMIN' || user?.role === 'SUPPORT_ENGINEER';
  const [cancelOpen, setCancelOpen] = useState(false);

  const detailQuery = useQuery({
    queryKey: ['rollout-detail', id],
    enabled: Boolean(id),
    queryFn: () => apiRequest<RolloutDetail>(`/rollouts/${id}`),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === 'PENDING_APPROVAL' || status === 'PENDING' || status === 'RUNNING') {
        return 4000;
      }
      return false;
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => apiRequest<RolloutDetail>(`/rollouts/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      setCancelOpen(false);
      toast({
        kind: 'info',
        title: 'Rollout cancelled',
        description: 'Remaining queued jobs were cancelled. In-flight downloads/installs will finish safely.',
      });
      void queryClient.invalidateQueries({ queryKey: ['rollout-detail', id] });
      void queryClient.invalidateQueries({ queryKey: ['rollouts-list'] });
      void queryClient.invalidateQueries({ queryKey: ['fleet-summary'] });
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Cancel failed',
        description: err instanceof ApiClientError ? err.message : 'Unable to cancel rollout.',
      });
    },
  });

  if (detailQuery.isLoading) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading rollout details">
        <div className="space-y-2">
          <div className="h-4 w-36 bg-slate-200 rounded animate-pulse" />
          <div className="h-7 w-64 bg-slate-200 rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-28 bg-white border border-slate-200 rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="h-52 lg:col-span-2 bg-white border border-slate-200 rounded-xl animate-pulse" />
          <div className="h-52 bg-white border border-slate-200 rounded-xl animate-pulse" />
        </div>
        <div className="h-64 bg-white border border-slate-200 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <ErrorState
        message={
          detailQuery.error instanceof ApiClientError
            ? detailQuery.error.message
            : 'Rollout not found.'
        }
        onRetry={() => void detailQuery.refetch()}
      />
    );
  }

  const rollout = detailQuery.data;
  const counts = rollout.counts;
  const inProgressCount = Math.max(
    0,
    counts.total - counts.verified - counts.failed - counts.cancelled,
  );
  const canCancel =
    canManage &&
    (rollout.status === 'PENDING_APPROVAL' ||
      rollout.status === 'PENDING' ||
      rollout.status === 'RUNNING');

  const total = Math.max(1, counts.total);
  const verifiedPct = Math.round((counts.verified / total) * 100);
  const inFlightPct = Math.round((inProgressCount / total) * 100);
  const failedPct = Math.round((counts.failed / total) * 100);
  const cancelledPct = Math.round((counts.cancelled / total) * 100);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Rollout to v${rollout.firmwareVersion ?? '—'}`}
        description={`${rollout.modelName ?? rollout.modelId} · ${rollout.targetLabel ?? `${rollout.targetType}: ${rollout.targetValue}`}`}
        breadcrumbs={[
          { label: 'Rollouts', to: '/rollouts' },
          { label: rollout.id },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void detailQuery.refetch()}
              icon={<RefreshCw className="w-3.5 h-3.5" />}
            >
              Refresh
            </Button>
            {canCancel && (
              <Button
                variant="danger"
                size="sm"
                onClick={() => setCancelOpen(true)}
                icon={<Ban className="w-3.5 h-3.5" />}
              >
                Cancel Rollout
              </Button>
            )}
          </div>
        }
      />

      {/* Status & KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Card className="p-5 flex flex-col justify-between">
          <p className="text-xs font-medium text-slate-500">Rollout Status</p>
          <div className="mt-2">
            <StatusChip status={rollout.status} />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Created <RelativeTime iso={rollout.createdAt} />
          </p>
        </Card>
        <KpiCard label="Total Targeted" value={counts.total} />
        <KpiCard label="Verified" value={counts.verified} tone="emerald" />
        <KpiCard label="Queued / Active" value={inProgressCount} tone="amber" />
        <KpiCard
          label="Failed / Cancelled"
          value={`${counts.failed} / ${counts.cancelled}`}
          tone={counts.failed > 0 ? 'red' : 'default'}
        />
      </div>

      {/* Progress Bar & Metadata */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="p-5 lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">Fleet Rollout Progress</h2>
            <span className="font-mono text-xs text-slate-600">
              {verifiedPct}% verified ({counts.verified} of {counts.total})
            </span>
          </div>

          <div className="h-3 w-full rounded-full bg-slate-100 overflow-hidden flex">
            {verifiedPct > 0 && (
              <div className="bg-emerald-500 h-full transition-all" style={{ width: `${verifiedPct}%` }} />
            )}
            {inFlightPct > 0 && (
              <div className="bg-amber-400 h-full transition-all" style={{ width: `${inFlightPct}%` }} />
            )}
            {failedPct > 0 && (
              <div className="bg-red-500 h-full transition-all" style={{ width: `${failedPct}%` }} />
            )}
            {cancelledPct > 0 && (
              <div className="bg-slate-400 h-full transition-all" style={{ width: `${cancelledPct}%` }} />
            )}
          </div>

          <div className="flex items-center gap-4 flex-wrap text-xs text-slate-600">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              Verified ({counts.verified})
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
              Queued / Downloading / Installing ({inProgressCount})
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
              Failed ({counts.failed})
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-slate-400" />
              Cancelled ({counts.cancelled})
            </span>
          </div>

          {rollout.status === 'PENDING_APPROVAL' && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>
                Awaiting Client Manager approval before the rollout scheduler begins delivering
                firmware updates to devices.
              </span>
            </div>
          )}

          {rollout.decidedBy && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-700 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
              <span>
                Decision by <strong>{rollout.decidedByName ?? rollout.decidedBy}</strong>
                {rollout.decisionReason ? `: "${rollout.decisionReason}"` : '.'}
              </span>
            </div>
          )}
        </Card>

        <Card className="p-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <FileCode2 className="w-4 h-4 text-indigo-600" />
            Package & Schedule
          </h2>
          <dl className="space-y-2.5 text-xs">
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">Version</dt>
              <dd className="font-mono font-semibold text-slate-900">
                {rollout.firmwareVersion ?? '—'}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">Model</dt>
              <dd className="text-slate-900 text-right">{rollout.modelName ?? rollout.modelId}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">Created By</dt>
              <dd className="text-slate-900">{rollout.createdByName ?? rollout.createdBy}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">Schedule</dt>
              <dd className="font-mono text-slate-800">
                {rollout.scheduledAt ? formatLocalDateTime(rollout.scheduledAt) : 'Immediate'}
              </dd>
            </div>
            {rollout.firmware && (
              <div className="pt-2 border-t border-slate-100">
                <dt className="text-slate-500 mb-1">SHA-256 Digest</dt>
                <dd className="font-mono text-[11px] text-slate-700 break-all bg-slate-50 p-2 rounded border border-slate-200">
                  {rollout.firmware.checksumSha256}
                </dd>
              </div>
            )}
          </dl>
        </Card>
      </div>

      {/* Per-Device Jobs Table */}
      <Card className="overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-indigo-600" />
            Device Rollout Jobs ({rollout.jobs.length})
          </h2>
        </div>

        {rollout.jobs.length === 0 ? (
          <EmptyState
            title="No device jobs in this rollout"
            description="No eligible devices matched the target scope when this rollout was created."
            action={
              <Link
                to="/rollouts"
                className="inline-flex items-center justify-center h-8 px-3 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-800 hover:bg-slate-50 transition-colors"
              >
                Back to Rollouts
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70">
                  <th className="px-5 py-2.5 text-xs font-semibold text-slate-600">Device</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-600">Version Path</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-600">Status</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-600">Error Code</th>
                  <th className="px-5 py-2.5 text-xs font-semibold text-slate-600 text-right">
                    Updated
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {rollout.jobs.map((job) => (
                  <tr key={job.id} className="hover:bg-slate-50/70">
                    <td className="px-5 py-3">
                      <Link
                        to={`/devices/${job.deviceId}`}
                        className="font-medium text-indigo-600 hover:underline"
                      >
                        {job.deviceName ?? job.deviceId}
                      </Link>
                      {job.deviceSerial && (
                        <p className="font-mono text-xs text-slate-500">{job.deviceSerial}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">
                      {job.fromVersion ?? 'none'} → <strong>{job.toVersion}</strong>
                    </td>
                    <td className="px-4 py-3">
                      <StatusChip status={job.status} />
                    </td>
                    <td className="px-4 py-3">
                      {job.errorCode ? (
                        <span className="font-mono text-xs font-semibold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded">
                          {job.errorCode}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <RelativeTime iso={job.updatedAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={() => cancelMutation.mutate()}
        title="Cancel OTA Rollout"
        message="Cancelling stops all remaining QUEUED device jobs immediately. Devices that are already DOWNLOADING or INSTALLING will complete safely without interruption."
        confirmLabel="Cancel Rollout"
        variant="danger"
        loading={cancelMutation.isPending}
      />
    </div>
  );
}
