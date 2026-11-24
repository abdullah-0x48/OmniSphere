import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowUpCircle,
  CheckCircle2,
  ExternalLink,
  MailWarning,
  Ticket,
  XCircle,
} from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { AlertDetail, AlertPublic, PaginatedResponse, TicketPublic } from '../../shared/types.ts';
import { ApiClientError, apiRequest } from '../api/client.ts';
import { useAuth } from '../auth/AuthContext.tsx';
import {
  Button,
  Card,
  DataTable,
  Drawer,
  ErrorState,
  Input,
  Modal,
  PageHeader,
  RelativeTime,
  Select,
  SeverityChip,
  StatusChip,
  Textarea,
  useToast,
  type Column,
} from '../components/ui/index.ts';
import { formatLocalDateTime } from '../utils/format.ts';

export function AlertsPage() {
  const { user, activeTenantId } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const canAcknowledge =
    user?.role === 'CLIENT_OPERATOR' ||
    user?.role === 'CLIENT_ADMIN' ||
    user?.role === 'SUPPORT_ENGINEER';
  const canClose = user?.role === 'SUPPORT_ENGINEER';
  const canCreateTicket = user?.role === 'SUPPORT_ENGINEER';

  const status = searchParams.get('status') ?? '';
  const severity = searchParams.get('severity') ?? '';
  const search = searchParams.get('search') ?? '';
  const page = Number(searchParams.get('page') ?? '1') || 1;
  const selectedAlertId = searchParams.get('alertId');

  const [closeTarget, setCloseTarget] = useState<AlertPublic | null>(null);
  const [closeReason, setCloseReason] = useState('');

  const updateParams = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(updates)) {
      if (!v) next.delete(k);
      else next.set(k, v);
    }
    setSearchParams(next, { replace: true });
  };

  const alertsQuery = useQuery({
    queryKey: ['alerts-list', { status, severity, search, page, activeTenantId }],
    queryFn: () =>
      apiRequest<PaginatedResponse<AlertPublic>>('/alerts', {
        query: {
          status: status || undefined,
          severity: severity || undefined,
          search: search.trim() || undefined,
          page,
          pageSize: 25,
        },
      }),
    refetchInterval: 5000,
  });

  const detailQuery = useQuery({
    queryKey: ['alert-detail', selectedAlertId],
    enabled: Boolean(selectedAlertId),
    queryFn: () => apiRequest<AlertDetail>(`/alerts/${selectedAlertId}`),
    refetchInterval: 5000,
  });

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['alerts-list'] });
    void queryClient.invalidateQueries({ queryKey: ['alert-detail'] });
    void queryClient.invalidateQueries({ queryKey: ['tickets-list'] });
    void queryClient.invalidateQueries({ queryKey: ['fleet-summary'] });
    void queryClient.invalidateQueries({ queryKey: ['fleet-overview'] });
    void queryClient.invalidateQueries({ queryKey: ['notifications-bell'] });
  };

  const ackMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest<AlertPublic>(`/alerts/${id}/acknowledge`, { method: 'POST' }),
    onSuccess: (updated) => {
      toast({
        kind: 'success',
        title: 'Alert acknowledged',
        description: `Escalation paused for ${updated.deviceName ?? updated.deviceId}.`,
      });
      invalidateAll();
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Acknowledge failed',
        description: err instanceof ApiClientError ? err.message : 'Unable to acknowledge alert.',
      });
    },
  });

  const closeMutation = useMutation({
    mutationFn: (vars: { id: string; reason: string }) =>
      apiRequest<AlertPublic>(`/alerts/${vars.id}/close`, {
        method: 'POST',
        body: { reason: vars.reason },
      }),
    onSuccess: () => {
      toast({ kind: 'success', title: 'Alert closed' });
      setCloseTarget(null);
      setCloseReason('');
      invalidateAll();
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Close failed',
        description: err instanceof ApiClientError ? err.message : 'Unable to close alert.',
      });
    },
  });

  const createTicketMutation = useMutation({
    mutationFn: (alertId: string) =>
      apiRequest<TicketPublic>(`/alerts/${alertId}/ticket`, { method: 'POST' }),
    onSuccess: (ticket) => {
      toast({
        kind: 'success',
        title: `Ticket ${ticket.number} created`,
        description: 'Linked to this alert and assigned to you.',
      });
      invalidateAll();
      navigate(`/tickets/${ticket.id}`);
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Unable to create ticket',
        description: err instanceof ApiClientError ? err.message : 'Could not convert alert to ticket.',
      });
    },
  });

  const columns: Column<AlertPublic>[] = [
    {
      key: 'severity',
      header: 'Severity',
      render: (a) => (
        <div className="flex items-center gap-1.5 flex-wrap">
          <SeverityChip severity={a.severity} />
          {a.escalationLevel > 0 && (
            <span
              title={`Escalated to Level ${a.escalationLevel}`}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] font-mono font-semibold bg-red-100 text-red-800 border border-red-200"
            >
              <ArrowUpCircle className="w-3 h-3" />L{a.escalationLevel}
            </span>
          )}
          {a.emailDeliveryFailed && (
            <span
              title="One or more notification emails failed after all retries"
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-800 border border-amber-200"
            >
              <MailWarning className="w-3 h-3" />
              Email failed
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'message',
      header: 'Alert',
      render: (a) => (
        <div className="max-w-md">
          <p className="font-medium text-slate-900 line-clamp-2">{a.message}</p>
          {a.ruleName && <p className="text-xs text-slate-500 mt-0.5">Rule: {a.ruleName}</p>}
        </div>
      ),
    },
    {
      key: 'device',
      header: 'Device & Site',
      render: (a) => (
        <div>
          <Link
            to={`/devices/${a.deviceId}`}
            onClick={(e) => e.stopPropagation()}
            className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
          >
            {a.deviceName ?? a.deviceId}
          </Link>
          {a.siteName && <p className="text-xs text-slate-500">{a.siteName}</p>}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (a) => <StatusChip status={a.status} />,
    },
    {
      key: 'createdAt',
      header: 'Opened',
      render: (a) => (
        <div className="text-xs font-mono text-slate-600 whitespace-nowrap">
          <RelativeTime iso={a.createdAt} />
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (a) => (
        <div
          className="inline-flex items-center justify-end gap-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          {canAcknowledge && a.status === 'OPEN' && (
            <Button
              size="sm"
              variant="secondary"
              loading={ackMutation.isPending && ackMutation.variables === a.id}
              onClick={() => ackMutation.mutate(a.id)}
              icon={<CheckCircle2 className="w-3.5 h-3.5" />}
            >
              Acknowledge
            </Button>
          )}
          {a.ticketId ? (
            <Link
              to={`/tickets/${a.ticketId}`}
              className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-indigo-200 bg-indigo-50/70 text-xs font-medium text-indigo-700 hover:bg-indigo-100 transition-colors whitespace-nowrap"
            >
              <Ticket className="w-3.5 h-3.5" />
              View Ticket
            </Link>
          ) : canCreateTicket && a.status !== 'CLOSED' ? (
            <Button
              size="sm"
              variant="secondary"
              loading={createTicketMutation.isPending && createTicketMutation.variables === a.id}
              onClick={() => createTicketMutation.mutate(a.id)}
              icon={<Ticket className="w-3.5 h-3.5" />}
            >
              Create Ticket
            </Button>
          ) : null}
          {canClose && a.status !== 'CLOSED' && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setCloseTarget(a);
                setCloseReason('');
              }}
              icon={<XCircle className="w-3.5 h-3.5" />}
            >
              Close
            </Button>
          )}
        </div>
      ),
    },
  ];

  const detail = detailQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Alerts"
        description="Real-time device alerts (refreshes every 5s). Alerts never auto-close and remain open until acknowledged and resolved."
        actions={
          (user?.role === 'CLIENT_ADMIN' || user?.role === 'SUPPORT_ENGINEER') ? (
            <Link
              to="/alert-rules"
              className="inline-flex items-center justify-center h-9 px-3.5 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Manage Alert Rules
            </Link>
          ) : undefined
        }
      />

      {/* Filter Bar */}
      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <Input
            label="Search alerts"
            placeholder="Message, device, or rule..."
            value={search}
            onChange={(e) => updateParams({ search: e.target.value || null, page: '1' })}
          />
          <Select
            label="Status"
            value={status}
            onChange={(e) => updateParams({ status: e.target.value || null, page: '1' })}
            options={[
              { value: '', label: 'All statuses' },
              { value: 'OPEN', label: 'Open' },
              { value: 'ACKNOWLEDGED', label: 'Acknowledged' },
              { value: 'CLOSED', label: 'Closed' },
            ]}
          />
          <Select
            label="Severity"
            value={severity}
            onChange={(e) => updateParams({ severity: e.target.value || null, page: '1' })}
            options={[
              { value: '', label: 'All severities' },
              { value: 'CRITICAL', label: 'Critical' },
              { value: 'WARNING', label: 'Warning' },
            ]}
          />
          <div className="flex items-end">
            {(status || severity || search) && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => updateParams({ status: null, severity: null, search: null, page: '1' })}
              >
                Clear filters
              </Button>
            )}
          </div>
        </div>
      </Card>

      <DataTable
        columns={columns}
        rows={alertsQuery.data?.items ?? []}
        rowKey={(a) => a.id}
        total={alertsQuery.data?.total ?? 0}
        page={page}
        pageSize={25}
        onPageChange={(nextPage) => updateParams({ page: String(nextPage) })}
        isLoading={alertsQuery.isLoading}
        error={
          alertsQuery.isError
            ? alertsQuery.error instanceof ApiClientError
              ? alertsQuery.error.message
              : 'Unable to load alerts.'
            : null
        }
        onRetry={() => void alertsQuery.refetch()}
        onRowClick={(a) => updateParams({ alertId: a.id })}
        emptyTitle="No alerts match your filters"
        emptyDescription="When a threshold or offline alert rule triggers on an active device, it will appear here in real time."
        emptyAction={
          status || severity || search ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => updateParams({ status: null, severity: null, search: null, page: '1' })}
            >
              Clear filters
            </Button>
          ) : user?.role === 'CLIENT_ADMIN' || user?.role === 'SUPPORT_ENGINEER' ? (
            <Button size="sm" variant="secondary" onClick={() => navigate('/alert-rules')}>
              Manage Alert Rules
            </Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => void alertsQuery.refetch()}>
              Refresh
            </Button>
          )
        }
      />

      {/* Alert Detail Drawer */}
      <Drawer
        open={Boolean(selectedAlertId)}
        onClose={() => updateParams({ alertId: null })}
        title={detail ? detail.ruleName ?? 'Alert Detail' : 'Loading alert...'}
        subtitle={
          detail
            ? `${detail.deviceName ?? detail.deviceId}${detail.siteName ? ` · ${detail.siteName}` : ''}`
            : undefined
        }
      >
        {detailQuery.isLoading ? (
          <div className="space-y-3" aria-busy="true">
            <div className="h-6 w-40 bg-slate-100 rounded animate-pulse" />
            <div className="h-24 bg-slate-100 rounded-xl animate-pulse" />
            <div className="h-32 bg-slate-100 rounded-xl animate-pulse" />
          </div>
        ) : detailQuery.isError || !detail ? (
          <ErrorState
            message={
              detailQuery.error instanceof ApiClientError
                ? detailQuery.error.message
                : 'Unable to load alert details. It may belong to another organization.'
            }
            onRetry={() => void detailQuery.refetch()}
          />
        ) : (
          <div className="space-y-6">
            {/* Status & Severity Strip */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <SeverityChip severity={detail.severity} />
                <StatusChip status={detail.status} />
                {detail.escalationLevel > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-mono font-semibold bg-red-100 text-red-800 border border-red-200">
                    <ArrowUpCircle className="w-3.5 h-3.5" />
                    Escalation Level {detail.escalationLevel}
                  </span>
                )}
              </div>
              <Link
                to={`/devices/${detail.deviceId}`}
                onClick={() => updateParams({ alertId: null })}
                className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700"
              >
                Inspect device <ExternalLink className="w-3.5 h-3.5" />
              </Link>
            </div>

            {detail.emailDeliveryFailed && (
              <div
                role="alert"
                className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 flex items-start gap-2.5 text-xs text-amber-900"
              >
                <MailWarning className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Email delivery failed</p>
                  <p className="mt-0.5 text-amber-800">
                    One or more alert notification emails failed after all retry attempts. Check the
                    Email Outbox for diagnostic details.
                  </p>
                </div>
              </div>
            )}

            {/* Message Box */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <p className="text-xs font-semibold text-slate-600">Alert Summary</p>
              <p className="text-sm font-medium text-slate-900 mt-1">{detail.message}</p>
              <p className="text-xs font-mono text-slate-600 mt-2">
                Alert ID: {detail.id} · Opened {formatLocalDateTime(detail.createdAt)}
              </p>
            </div>

            {/* Action Buttons */}
            {(detail.ticketId || (detail.status !== 'CLOSED' && (canAcknowledge || canClose || canCreateTicket))) ? (
              <div className="flex items-center gap-2 flex-wrap">
                {canAcknowledge && detail.status === 'OPEN' && (
                  <Button
                    size="sm"
                    loading={ackMutation.isPending}
                    onClick={() => ackMutation.mutate(detail.id)}
                    icon={<CheckCircle2 className="w-4 h-4" />}
                  >
                    Acknowledge Alert
                  </Button>
                )}
                {detail.ticketId ? (
                  <Link
                    to={`/tickets/${detail.ticketId}`}
                    onClick={() => updateParams({ alertId: null })}
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-indigo-200 bg-indigo-50 text-xs font-medium text-indigo-700 hover:bg-indigo-100 transition-colors"
                  >
                    <Ticket className="w-3.5 h-3.5" />
                    View Linked Ticket
                  </Link>
                ) : canCreateTicket && detail.status !== 'CLOSED' ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={createTicketMutation.isPending}
                    onClick={() => createTicketMutation.mutate(detail.id)}
                    icon={<Ticket className="w-4 h-4" />}
                  >
                    Create Ticket
                  </Button>
                ) : null}
                {canClose && detail.status !== 'CLOSED' && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setCloseTarget(detail);
                      setCloseReason('');
                    }}
                    icon={<XCircle className="w-4 h-4" />}
                  >
                    Close Alert
                  </Button>
                )}
              </div>
            ) : null}

            {/* Metadata Grid */}
            <dl className="grid grid-cols-2 gap-4 text-xs border-t border-slate-100 pt-4">
              <div>
                <dt className="text-slate-500">Acknowledged By</dt>
                <dd className="text-slate-900 font-medium mt-0.5">
                  {detail.acknowledgedByName ?? detail.acknowledgedBy ?? 'Not yet acknowledged'}
                </dd>
                {detail.acknowledgedAt && (
                  <dd className="font-mono text-slate-500 mt-0.5">
                    {formatLocalDateTime(detail.acknowledgedAt)}
                  </dd>
                )}
              </div>
              <div>
                <dt className="text-slate-500">Closed By</dt>
                <dd className="text-slate-900 font-medium mt-0.5">
                  {detail.closedByName ?? detail.closedBy ?? 'Still active'}
                </dd>
                {detail.closedAt && (
                  <dd className="font-mono text-slate-500 mt-0.5">
                    {formatLocalDateTime(detail.closedAt)}
                  </dd>
                )}
              </div>
              {detail.closeReason && (
                <div className="col-span-2">
                  <dt className="text-slate-500">Close Reason</dt>
                  <dd className="text-slate-800 mt-0.5 bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                    {detail.closeReason}
                  </dd>
                </div>
              )}
            </dl>

            {/* Metric Snapshot */}
            <div className="border-t border-slate-100 pt-4">
              <h3 className="text-xs font-semibold text-slate-700 mb-2.5">Triggering Snapshot</h3>
              <pre className="rounded-xl bg-slate-900 text-slate-100 p-3.5 text-xs font-mono overflow-x-auto leading-relaxed">
                {JSON.stringify(detail.snapshot, null, 2)}
              </pre>
            </div>

            {/* Alert Timeline */}
            <div className="border-t border-slate-100 pt-4">
              <h3 className="text-xs font-semibold text-slate-700 mb-3">Alert History</h3>
              {detail.timeline.length === 0 ? (
                <p className="text-xs text-slate-600">No history events recorded yet.</p>
              ) : (
                <ol className="divide-y divide-slate-100">
                  {detail.timeline.map((ev) => (
                    <li
                      key={ev.id}
                      className="py-2.5 first:pt-0 flex items-start justify-between gap-3 text-xs"
                    >
                      <div>
                        <p className="font-semibold text-slate-800">
                          {ev.action.replaceAll('_', ' ')}
                        </p>
                        <p className="text-slate-600">by {ev.actorName}</p>
                      </div>
                      <span className="font-mono text-slate-600 shrink-0">
                        {formatLocalDateTime(ev.at)}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}
      </Drawer>

      {/* Close Alert Modal (SE only) */}
      <Modal
        open={Boolean(closeTarget)}
        onClose={() => setCloseTarget(null)}
        title="Close Alert"
        description={`Closing "${closeTarget?.message ?? ''}" requires a documented resolution reason.`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCloseTarget(null)}>
              Cancel
            </Button>
            <Button
              loading={closeMutation.isPending}
              disabled={closeReason.trim().length < 3}
              onClick={() => {
                if (closeTarget) {
                  closeMutation.mutate({ id: closeTarget.id, reason: closeReason.trim() });
                }
              }}
            >
              Close Alert
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 flex items-start gap-2 text-xs text-slate-600">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <span>
              Alerts do not auto-close when metrics recover. Confirm the root cause has been
              checked before closing.
            </span>
          </div>
          <Textarea
            label="Resolution Reason"
            required
            rows={3}
            value={closeReason}
            onChange={(e) => setCloseReason(e.target.value)}
            placeholder="Describe how the condition was investigated and resolved..."
          />
        </div>
      </Modal>
    </div>
  );
}
