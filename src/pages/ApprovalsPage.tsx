import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock,
  CheckCircle2,
  Cpu,
  MapPin,
  Rocket,
  ShieldCheck,
  User,
  XCircle,
} from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type {
  PaginatedResponse,
  RolloutDetail,
  RolloutPublic,
  WorkOrderPublic,
} from '../../shared/types.ts';
import { ApiClientError, apiRequest } from '../api/client.ts';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Modal,
  PageHeader,
  StatusChip,
  Tabs,
  Textarea,
  useToast,
} from '../components/ui/index.ts';
import { formatLocalDateTime } from '../utils/format.ts';

/**
 * Client Manager Approvals Center (/approvals — Section 10.2 & 10.5).
 * Displays pending maintenance downtime window approvals AND pending OTA firmware
 * rollout approvals with one-click Approve or Reject-with-reason workflows.
 */
export function ApprovalsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const tabParam = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<'maintenance' | 'rollouts'>(
    tabParam === 'rollouts' ? 'rollouts' : 'maintenance',
  );

  useEffect(() => {
    if (tabParam === 'rollouts') setActiveTab('rollouts');
    else if (tabParam === 'maintenance') setActiveTab('maintenance');
  }, [tabParam]);

  const [woDecisionModal, setWoDecisionModal] = useState<{
    wo: WorkOrderPublic;
    decision: 'APPROVED' | 'REJECTED';
  } | null>(null);
  const [woDecisionNote, setWoDecisionNote] = useState('');

  const [rolloutDecisionModal, setRolloutDecisionModal] = useState<{
    rollout: RolloutPublic;
    decision: 'APPROVED' | 'REJECTED';
  } | null>(null);
  const [rolloutDecisionReason, setRolloutDecisionReason] = useState('');

  const pendingWoQuery = useQuery({
    queryKey: ['approvals-pending-work-orders'],
    queryFn: () =>
      apiRequest<PaginatedResponse<WorkOrderPublic>>('/work-orders', {
        query: { approvalStatus: 'PENDING', page: 1, pageSize: 100 },
      }),
    refetchInterval: 8000,
  });

  const allDowntimeQuery = useQuery({
    queryKey: ['approvals-history-work-orders'],
    queryFn: () =>
      apiRequest<PaginatedResponse<WorkOrderPublic>>('/work-orders', {
        query: { page: 1, pageSize: 50 },
      }),
  });

  const pendingRolloutsQuery = useQuery({
    queryKey: ['approvals-pending-rollouts'],
    queryFn: () =>
      apiRequest<PaginatedResponse<RolloutPublic>>('/rollouts', {
        query: { status: 'PENDING_APPROVAL', page: 1, pageSize: 100 },
      }),
    refetchInterval: 8000,
  });

  const allRolloutsQuery = useQuery({
    queryKey: ['approvals-history-rollouts'],
    queryFn: () =>
      apiRequest<PaginatedResponse<RolloutPublic>>('/rollouts', {
        query: { page: 1, pageSize: 50 },
      }),
  });

  const decideWoMutation = useMutation({
    mutationFn: (vars: { id: string; decision: 'APPROVED' | 'REJECTED'; note?: string }) =>
      apiRequest(`/work-orders/${vars.id}/decision`, {
        method: 'POST',
        body: { decision: vars.decision, note: vars.note || undefined },
      }),
    onSuccess: (_data, vars) => {
      toast({
        kind: vars.decision === 'APPROVED' ? 'success' : 'info',
        title:
          vars.decision === 'APPROVED'
            ? 'Maintenance window approved'
            : 'Maintenance window rejected',
        description:
          vars.decision === 'APPROVED'
            ? 'Support Engineer and Field Technician have been notified.'
            : 'Support Engineer has been notified to adjust the plan.',
      });
      setWoDecisionModal(null);
      setWoDecisionNote('');
      void queryClient.invalidateQueries({ queryKey: ['approvals-pending-work-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['approvals-history-work-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['work-orders-list'] });
      void queryClient.invalidateQueries({ queryKey: ['fleet-summary'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications-bell'] });
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Decision failed',
        description: err instanceof ApiClientError ? err.message : 'Unable to record decision.',
      });
    },
  });

  const decideRolloutMutation = useMutation({
    mutationFn: (vars: { id: string; decision: 'APPROVED' | 'REJECTED'; reason?: string }) =>
      apiRequest<RolloutDetail>(`/rollouts/${vars.id}/decision`, {
        method: 'POST',
        body: { decision: vars.decision, reason: vars.reason || undefined },
      }),
    onSuccess: (updated, vars) => {
      toast({
        kind: vars.decision === 'APPROVED' ? 'success' : 'info',
        title:
          vars.decision === 'APPROVED'
            ? `Rollout to v${updated.firmwareVersion ?? ''} approved`
            : `Rollout to v${updated.firmwareVersion ?? ''} rejected`,
        description:
          vars.decision === 'APPROVED'
            ? 'The rollout creator has been notified and execution is queued.'
            : 'All queued jobs were cancelled and the creator has been notified.',
      });
      setRolloutDecisionModal(null);
      setRolloutDecisionReason('');
      void queryClient.invalidateQueries({ queryKey: ['approvals-pending-rollouts'] });
      void queryClient.invalidateQueries({ queryKey: ['approvals-history-rollouts'] });
      void queryClient.invalidateQueries({ queryKey: ['rollouts-list'] });
      void queryClient.invalidateQueries({ queryKey: ['fleet-summary'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications-bell'] });
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Decision failed',
        description: err instanceof ApiClientError ? err.message : 'Unable to record decision.',
      });
    },
  });

  const pendingWoItems = (pendingWoQuery.data?.items ?? []).filter(
    (wo) => wo.status !== 'COMPLETED' && wo.status !== 'CANCELLED',
  );
  const recentWoDecisions = (allDowntimeQuery.data?.items ?? [])
    .filter((wo) => wo.approvalStatus === 'APPROVED' || wo.approvalStatus === 'REJECTED')
    .slice(0, 12);

  const pendingRollouts = pendingRolloutsQuery.data?.items ?? [];
  const recentRolloutDecisions = (allRolloutsQuery.data?.items ?? [])
    .filter((r) => Boolean(r.decidedBy))
    .slice(0, 12);

  const handleTabChange = (id: string) => {
    const next = id as 'maintenance' | 'rollouts';
    setActiveTab(next);
    setSearchParams({ tab: next }, { replace: true });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Approvals Center"
        description="Review and decide on planned maintenance downtime windows and OTA firmware rollout requests for your organization."
      />

      <Tabs
        active={activeTab}
        onChange={handleTabChange}
        tabs={[
          { id: 'maintenance', label: 'Maintenance Windows', count: pendingWoItems.length },
          { id: 'rollouts', label: 'Rollouts', count: pendingRollouts.length },
        ]}
      />

      {activeTab === 'rollouts' ? (
        pendingRolloutsQuery.isError ? (
          <ErrorState
            message={
              pendingRolloutsQuery.error instanceof ApiClientError
                ? pendingRolloutsQuery.error.message
                : 'Unable to load pending rollout approvals.'
            }
            onRetry={() => void pendingRolloutsQuery.refetch()}
          />
        ) : (
          <div className="space-y-6">
            {pendingRolloutsQuery.isLoading ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" aria-busy="true">
                {Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} className="h-56 rounded-xl bg-white border border-slate-200 p-5 space-y-3">
                    <div className="flex justify-between">
                      <div className="h-5 w-32 bg-slate-200 rounded animate-pulse" />
                      <div className="h-5 w-24 bg-slate-100 rounded-full animate-pulse" />
                    </div>
                    <div className="h-5 w-3/4 bg-slate-200 rounded animate-pulse" />
                    <div className="h-14 bg-slate-100 rounded-lg animate-pulse" />
                  </div>
                ))}
              </div>
            ) : pendingRollouts.length === 0 ? (
              <Card>
                <EmptyState
                  icon={<ShieldCheck className="w-8 h-8 text-emerald-600" />}
                  title="No pending rollout approvals"
                  description="OTA firmware rollout approval requests will appear here when submitted for your organization."
                  action={
                    <Button size="sm" variant="secondary" onClick={() => navigate('/rollouts')}>
                      View All Rollouts
                    </Button>
                  }
                />
              </Card>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {pendingRollouts.map((r) => (
                  <Card
                    key={r.id}
                    className="p-5 flex flex-col justify-between gap-4 border-amber-200"
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 font-mono text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-md">
                            <Rocket className="w-3.5 h-3.5" aria-hidden="true" />
                            v{r.firmwareVersion ?? '—'}
                          </span>
                          <span className="text-xs font-medium text-slate-700">
                            {r.modelName ?? r.modelId}
                          </span>
                        </div>
                        <StatusChip status="PENDING_APPROVAL" label="Pending Approval" />
                      </div>

                      <div>
                        <Link
                          to={`/rollouts/${r.id}`}
                          className="text-base font-semibold text-slate-900 hover:text-indigo-700"
                        >
                          OTA Rollout — {r.targetLabel ?? `${r.targetType}: ${r.targetValue}`}
                        </Link>
                        <p className="text-xs text-slate-600 mt-1">
                          {r.counts.total} eligible ACTIVE device
                          {r.counts.total === 1 ? '' : 's'} will download and verify firmware{' '}
                          <span className="font-mono font-semibold">{r.firmwareVersion}</span>.
                        </p>
                      </div>

                      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-slate-100 text-xs">
                        <div className="flex items-start gap-2">
                          <Cpu className="w-3.5 h-3.5 text-slate-500 mt-0.5 shrink-0" aria-hidden="true" />
                          <div>
                            <dt className="text-slate-600">Target Cohort</dt>
                            <dd className="font-medium text-slate-900">
                              {r.counts.total} device{r.counts.total === 1 ? '' : 's'}
                            </dd>
                          </div>
                        </div>
                        <div className="flex items-start gap-2">
                          <CalendarClock className="w-3.5 h-3.5 text-slate-500 mt-0.5 shrink-0" aria-hidden="true" />
                          <div>
                            <dt className="text-slate-600">Schedule</dt>
                            <dd className="font-mono text-slate-800">
                              {r.scheduledAt ? formatLocalDateTime(r.scheduledAt) : 'Immediate'}
                            </dd>
                          </div>
                        </div>
                        <div className="flex items-start gap-2 sm:col-span-2">
                          <User className="w-3.5 h-3.5 text-slate-500 mt-0.5 shrink-0" aria-hidden="true" />
                          <div>
                            <dt className="text-slate-600">Submitted By</dt>
                            <dd className="text-slate-800">
                              {r.createdByName ?? r.createdBy} ·{' '}
                              <span className="font-mono text-slate-600">
                                {formatLocalDateTime(r.createdAt)}
                              </span>
                            </dd>
                          </div>
                        </div>
                      </dl>
                    </div>

                    <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                      <Link
                        to={`/rollouts/${r.id}`}
                        className="text-xs font-medium text-indigo-600 hover:underline"
                      >
                        Inspect devices
                      </Link>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setRolloutDecisionModal({ rollout: r, decision: 'REJECTED' });
                            setRolloutDecisionReason('');
                          }}
                          icon={<XCircle className="w-4 h-4 text-red-600" />}
                        >
                          Reject
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => {
                            setRolloutDecisionModal({ rollout: r, decision: 'APPROVED' });
                            setRolloutDecisionReason('');
                          }}
                          icon={<CheckCircle2 className="w-4 h-4" />}
                        >
                          Approve Rollout
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}

            {recentRolloutDecisions.length > 0 && (
              <Card className="overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200">
                  <h2 className="text-sm font-semibold text-slate-900">Recent Rollout Decisions</h2>
                  <p className="text-xs text-slate-500">
                    Previously approved or rejected OTA firmware rollouts.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/70">
                        <th className="px-5 py-2.5 text-xs font-semibold text-slate-600">Rollout</th>
                        <th className="px-4 py-2.5 text-xs font-semibold text-slate-600">Target</th>
                        <th className="px-4 py-2.5 text-xs font-semibold text-slate-600">Status</th>
                        <th className="px-4 py-2.5 text-xs font-semibold text-slate-600">Reason</th>
                        <th className="px-5 py-2.5 text-xs font-semibold text-slate-600 text-right">
                          Updated
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {recentRolloutDecisions.map((r) => (
                        <tr key={r.id} className="hover:bg-slate-50">
                          <td className="px-5 py-3">
                            <Link
                              to={`/rollouts/${r.id}`}
                              className="font-mono font-semibold text-indigo-600 hover:underline"
                            >
                              v{r.firmwareVersion ?? '—'}
                            </Link>
                            <p className="text-slate-600 mt-0.5">{r.modelName ?? r.modelId}</p>
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            {r.targetLabel ?? r.targetValue} ({r.counts.total})
                          </td>
                          <td className="px-4 py-3">
                            <StatusChip status={r.status} />
                          </td>
                          <td className="px-4 py-3 text-slate-600 max-w-xs truncate">
                            {r.decisionReason ?? '—'}
                          </td>
                          <td className="px-5 py-3 text-right font-mono text-slate-500 whitespace-nowrap">
                            {formatLocalDateTime(r.updatedAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </div>
        )
      ) : pendingWoQuery.isError ? (
        <ErrorState
          message={
            pendingWoQuery.error instanceof ApiClientError
              ? pendingWoQuery.error.message
              : 'Unable to load pending approvals.'
          }
          onRetry={() => void pendingWoQuery.refetch()}
        />
      ) : (
        <div className="space-y-6">
          {pendingWoQuery.isLoading ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" aria-busy="true">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="h-60 rounded-xl bg-white border border-slate-200 p-5 space-y-3">
                  <div className="flex justify-between">
                    <div className="h-5 w-32 bg-slate-200 rounded animate-pulse" />
                    <div className="h-5 w-24 bg-slate-100 rounded-full animate-pulse" />
                  </div>
                  <div className="h-5 w-3/4 bg-slate-200 rounded animate-pulse" />
                  <div className="h-16 bg-slate-100 rounded-lg animate-pulse" />
                </div>
              ))}
            </div>
          ) : pendingWoItems.length === 0 ? (
            <Card>
              <EmptyState
                icon={<CheckCircle2 className="w-8 h-8 text-emerald-600" />}
                title="All caught up"
                description="There are no pending maintenance window approvals requiring your review right now."
                action={
                  <Button size="sm" variant="secondary" onClick={() => navigate('/work-orders')}>
                    View Work Orders
                  </Button>
                }
              />
            </Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {pendingWoItems.map((wo) => (
                <Card
                  key={wo.id}
                  className="p-5 flex flex-col justify-between gap-4 border-amber-200"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-md">
                          {wo.number}
                        </span>
                        <StatusChip status={wo.type} />
                      </div>
                      <StatusChip status="PENDING" label="Pending Approval" />
                    </div>

                    <div>
                      <Link
                        to={`/work-orders/${wo.id}`}
                        className="text-base font-semibold text-slate-900 hover:text-indigo-700"
                      >
                        {wo.title}
                      </Link>
                      <p className="text-xs text-slate-600 mt-1 line-clamp-2">{wo.instructions}</p>
                    </div>

                    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-slate-100 text-xs">
                      <div className="flex items-start gap-2">
                        <Cpu className="w-3.5 h-3.5 text-slate-500 mt-0.5 shrink-0" aria-hidden="true" />
                        <div>
                          <dt className="text-slate-600">Device Impact</dt>
                          <dd className="font-medium text-slate-900">
                            {wo.deviceName ?? wo.deviceId}
                          </dd>
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <MapPin className="w-3.5 h-3.5 text-slate-500 mt-0.5 shrink-0" aria-hidden="true" />
                        <div>
                          <dt className="text-slate-600">Site</dt>
                          <dd className="font-medium text-slate-900">{wo.siteName ?? '—'}</dd>
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <CalendarClock className="w-3.5 h-3.5 text-slate-500 mt-0.5 shrink-0" aria-hidden="true" />
                        <div>
                          <dt className="text-slate-600">Planned Window</dt>
                          <dd className="font-mono text-slate-800">
                            {wo.plannedStart ? formatLocalDateTime(wo.plannedStart) : 'TBD'}
                            {wo.plannedEnd ? ` → ${formatLocalDateTime(wo.plannedEnd)}` : ''}
                          </dd>
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <User className="w-3.5 h-3.5 text-slate-500 mt-0.5 shrink-0" aria-hidden="true" />
                        <div>
                          <dt className="text-slate-600">Requested By / Tech</dt>
                          <dd className="text-slate-800">
                            {wo.createdByName ?? wo.createdBy} ·{' '}
                            {wo.assignedToName ?? 'Unassigned'}
                          </dd>
                        </div>
                      </div>
                    </dl>

                    <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
                      Device will transition to <strong>UNDER MAINTENANCE</strong> during field
                      execution and automated alerts will be temporarily suppressed.
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setWoDecisionModal({ wo, decision: 'REJECTED' });
                        setWoDecisionNote('');
                      }}
                      icon={<XCircle className="w-4 h-4 text-red-600" />}
                    >
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        setWoDecisionModal({ wo, decision: 'APPROVED' });
                        setWoDecisionNote('');
                      }}
                      icon={<CheckCircle2 className="w-4 h-4" />}
                    >
                      Approve Window
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {recentWoDecisions.length > 0 && (
            <Card className="overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200">
                <h2 className="text-sm font-semibold text-slate-900">Recent Maintenance Decisions</h2>
                <p className="text-xs text-slate-500">
                  Previously approved or rejected maintenance downtime windows.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70">
                      <th className="px-5 py-2.5 text-xs font-semibold text-slate-600">Work Order</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-600">Device</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-600">Decision</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-600">Note</th>
                      <th className="px-5 py-2.5 text-xs font-semibold text-slate-600 text-right">
                        Decided
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {recentWoDecisions.map((wo) => (
                      <tr key={wo.id} className="hover:bg-slate-50">
                        <td className="px-5 py-3">
                          <Link
                            to={`/work-orders/${wo.id}`}
                            className="font-mono font-semibold text-indigo-600 hover:underline"
                          >
                            {wo.number}
                          </Link>
                          <p className="text-slate-700 font-medium mt-0.5 truncate max-w-xs">
                            {wo.title}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-slate-700">{wo.deviceName ?? wo.deviceId}</td>
                        <td className="px-4 py-3">
                          <StatusChip status={wo.approvalStatus} />
                        </td>
                        <td className="px-4 py-3 text-slate-600 max-w-xs truncate">
                          {wo.approvalNote ?? '—'}
                        </td>
                        <td className="px-5 py-3 text-right font-mono text-slate-500 whitespace-nowrap">
                          {wo.approvedAt ? formatLocalDateTime(wo.approvedAt) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Maintenance Window Decision Modal */}
      <Modal
        open={Boolean(woDecisionModal)}
        onClose={() => setWoDecisionModal(null)}
        title={
          woDecisionModal?.decision === 'APPROVED'
            ? `Approve ${woDecisionModal.wo.number}`
            : `Reject ${woDecisionModal?.wo.number ?? ''}`
        }
        description={
          woDecisionModal?.decision === 'APPROVED'
            ? 'Approving unlocks field execution for the assigned technician during the planned window.'
            : 'Provide a clear reason (e.g., preferred production window) so Support can adjust and resubmit.'
        }
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setWoDecisionModal(null)}>
              Cancel
            </Button>
            <Button
              variant={woDecisionModal?.decision === 'REJECTED' ? 'danger' : 'primary'}
              loading={decideWoMutation.isPending}
              disabled={
                woDecisionModal?.decision === 'REJECTED' && woDecisionNote.trim().length < 3
              }
              onClick={() => {
                if (!woDecisionModal) return;
                decideWoMutation.mutate({
                  id: woDecisionModal.wo.id,
                  decision: woDecisionModal.decision,
                  note: woDecisionNote.trim(),
                });
              }}
            >
              {woDecisionModal?.decision === 'APPROVED' ? 'Confirm Approval' : 'Reject Window'}
            </Button>
          </>
        }
      >
        <Textarea
          label={woDecisionModal?.decision === 'REJECTED' ? 'Rejection Reason' : 'Approval Note (optional)'}
          required={woDecisionModal?.decision === 'REJECTED'}
          rows={3}
          value={woDecisionNote}
          onChange={(e) => setWoDecisionNote(e.target.value)}
          placeholder={
            woDecisionModal?.decision === 'REJECTED'
              ? 'e.g. Line 1 runs continuous batch until 22:00; reschedule for Sunday morning.'
              : 'Optional handoff instructions for the site team...'
          }
        />
      </Modal>

      {/* Rollout Decision Modal */}
      <Modal
        open={Boolean(rolloutDecisionModal)}
        onClose={() => setRolloutDecisionModal(null)}
        title={
          rolloutDecisionModal?.decision === 'APPROVED'
            ? `Approve Rollout to v${rolloutDecisionModal.rollout.firmwareVersion ?? ''}`
            : `Reject Rollout to v${rolloutDecisionModal?.rollout.firmwareVersion ?? ''}`
        }
        description={
          rolloutDecisionModal?.decision === 'APPROVED'
            ? 'Approving queues the rollout for immediate or scheduled execution across eligible devices.'
            : 'Rejecting cancels all queued rollout jobs and notifies the creator with your reason.'
        }
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRolloutDecisionModal(null)}>
              Cancel
            </Button>
            <Button
              variant={rolloutDecisionModal?.decision === 'REJECTED' ? 'danger' : 'primary'}
              loading={decideRolloutMutation.isPending}
              disabled={
                rolloutDecisionModal?.decision === 'REJECTED' &&
                rolloutDecisionReason.trim().length < 3
              }
              onClick={() => {
                if (!rolloutDecisionModal) return;
                decideRolloutMutation.mutate({
                  id: rolloutDecisionModal.rollout.id,
                  decision: rolloutDecisionModal.decision,
                  reason: rolloutDecisionReason.trim(),
                });
              }}
            >
              {rolloutDecisionModal?.decision === 'APPROVED' ? 'Confirm Approval' : 'Reject Rollout'}
            </Button>
          </>
        }
      >
        <Textarea
          label={
            rolloutDecisionModal?.decision === 'REJECTED'
              ? 'Rejection Reason'
              : 'Approval Note (optional)'
          }
          required={rolloutDecisionModal?.decision === 'REJECTED'}
          rows={3}
          value={rolloutDecisionReason}
          onChange={(e) => setRolloutDecisionReason(e.target.value)}
          placeholder={
            rolloutDecisionModal?.decision === 'REJECTED'
              ? 'e.g. Hold OTA updates until peak production shift completes.'
              : 'Optional release approval note...'
          }
        />
      </Modal>
    </div>
  );
}
