import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Cpu,
  MessageSquare,
  RotateCcw,
  Send,
  Wrench,
  XCircle,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type {
  StaffOption,
  TicketDetail,
  TicketPriority,
  TicketStatus,
} from '../../shared/types.ts';
import { ApiClientError, apiRequest } from '../api/client.ts';
import { useAuth } from '../auth/AuthContext.tsx';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Modal,
  PageHeader,
  RelativeTime,
  Select,
  SeverityChip,
  StatusChip,
  Textarea,
  useToast,
} from '../components/ui/index.ts';
import { CreateWorkOrderModal } from '../components/workOrders/CreateWorkOrderModal.tsx';
import { formatLocalDateTime } from '../utils/format.ts';

export function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, activeTenantId } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const isSE = user?.role === 'SUPPORT_ENGINEER';
  const canConfirm = user?.role === 'CLIENT_OPERATOR' || user?.role === 'CLIENT_ADMIN';
  const canReopen =
    user?.role === 'CLIENT_OPERATOR' ||
    user?.role === 'CLIENT_ADMIN' ||
    user?.role === 'SUPPORT_ENGINEER';
  const canComment =
    user?.role === 'SUPPORT_ENGINEER' ||
    user?.role === 'CLIENT_ADMIN' ||
    user?.role === 'CLIENT_MANAGER' ||
    user?.role === 'CLIENT_OPERATOR';

  const [commentBody, setCommentBody] = useState('');
  const [resolveOpen, setResolveOpen] = useState(false);
  const [rootCause, setRootCause] = useState('');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeReason, setCloseReason] = useState('');
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenNote, setReopenNote] = useState('');
  const [woModalOpen, setWoModalOpen] = useState(false);

  const detailQuery = useQuery({
    queryKey: ['ticket-detail', id],
    enabled: Boolean(id),
    queryFn: () => apiRequest<TicketDetail>(`/tickets/${id}`),
    refetchInterval: 8000,
  });

  const assigneesQuery = useQuery({
    queryKey: ['ticket-assignees', activeTenantId],
    enabled: isSE,
    queryFn: () => apiRequest<{ items: StaffOption[] }>('/tickets/assignees'),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['ticket-detail', id] });
    void queryClient.invalidateQueries({ queryKey: ['tickets-list'] });
    void queryClient.invalidateQueries({ queryKey: ['alerts-list'] });
    void queryClient.invalidateQueries({ queryKey: ['fleet-summary'] });
    void queryClient.invalidateQueries({ queryKey: ['fleet-overview'] });
  };

  const updateMutation = useMutation({
    mutationFn: (patch: {
      status?: TicketStatus;
      priority?: TicketPriority;
      assigneeId?: string | null;
    }) =>
      apiRequest(`/tickets/${id}`, {
        method: 'PATCH',
        body: patch,
      }),
    onSuccess: () => {
      toast({ kind: 'success', title: 'Ticket updated' });
      invalidate();
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Update failed',
        description: err instanceof ApiClientError ? err.message : 'Unable to update ticket.',
      });
    },
  });

  const commentMutation = useMutation({
    mutationFn: () =>
      apiRequest<TicketDetail>(`/tickets/${id}/comments`, {
        method: 'POST',
        body: { body: commentBody.trim() },
      }),
    onSuccess: (updated) => {
      const resumed = detailQuery.data?.status === 'WAITING_ON_CLIENT' && updated.status === 'IN_PROGRESS';
      toast({
        kind: 'success',
        title: resumed ? 'Comment posted · Ticket resumed to In Progress' : 'Comment added',
      });
      setCommentBody('');
      invalidate();
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Comment failed',
        description: err instanceof ApiClientError ? err.message : 'Unable to post comment.',
      });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: () =>
      apiRequest<TicketDetail>(`/tickets/${id}/resolve`, {
        method: 'POST',
        body: { rootCause: rootCause.trim(), resolutionNotes: resolutionNotes.trim() },
      }),
    onSuccess: () => {
      toast({
        kind: 'success',
        title: 'Ticket marked Resolved',
        description: 'Client has been notified to confirm resolution.',
      });
      setResolveOpen(false);
      setRootCause('');
      setResolutionNotes('');
      invalidate();
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Resolve failed',
        description: err instanceof ApiClientError ? err.message : 'Unable to resolve ticket.',
      });
    },
  });

  const confirmMutation = useMutation({
    mutationFn: () => apiRequest<TicketDetail>(`/tickets/${id}/confirm`, { method: 'POST' }),
    onSuccess: (updated) => {
      toast({
        kind: 'success',
        title: `${updated.number} confirmed & closed`,
        description: updated.alertId
          ? 'The linked alert has also been automatically closed.'
          : undefined,
      });
      invalidate();
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Confirm failed',
        description: err instanceof ApiClientError ? err.message : 'Unable to confirm ticket.',
      });
    },
  });

  const reopenMutation = useMutation({
    mutationFn: () =>
      apiRequest<TicketDetail>(`/tickets/${id}/reopen`, {
        method: 'POST',
        body: { note: reopenNote.trim() || undefined },
      }),
    onSuccess: () => {
      toast({ kind: 'info', title: 'Ticket reopened to In Progress' });
      setReopenOpen(false);
      setReopenNote('');
      invalidate();
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Reopen failed',
        description: err instanceof ApiClientError ? err.message : 'Unable to reopen ticket.',
      });
    },
  });

  const closeMutation = useMutation({
    mutationFn: () =>
      apiRequest<TicketDetail>(`/tickets/${id}/close`, {
        method: 'POST',
        body: { reason: closeReason.trim() },
      }),
    onSuccess: () => {
      toast({ kind: 'success', title: 'Ticket closed' });
      setCloseOpen(false);
      setCloseReason('');
      invalidate();
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Close failed',
        description: err instanceof ApiClientError ? err.message : 'Unable to close ticket.',
      });
    },
  });

  if (detailQuery.isLoading) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading ticket details">
        <div className="space-y-2">
          <div className="h-4 w-32 bg-slate-200 rounded animate-pulse" />
          <div className="h-7 w-96 max-w-full bg-slate-200 rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 space-y-6">
            <div className="h-44 bg-white border border-slate-200 rounded-xl animate-pulse" />
            <div className="h-40 bg-white border border-slate-200 rounded-xl animate-pulse" />
            <div className="h-56 bg-white border border-slate-200 rounded-xl animate-pulse" />
          </div>
          <div className="lg:col-span-4 space-y-5">
            <div className="h-48 bg-white border border-slate-200 rounded-xl animate-pulse" />
            <div className="h-36 bg-white border border-slate-200 rounded-xl animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <ErrorState
        message={
          detailQuery.error instanceof ApiClientError
            ? detailQuery.error.message
            : 'Unable to load ticket details.'
        }
        onRetry={() => void detailQuery.refetch()}
      />
    );
  }

  const ticket = detailQuery.data;
  const isEditableStatus =
    ticket.status === 'OPEN' ||
    ticket.status === 'IN_PROGRESS' ||
    ticket.status === 'WAITING_ON_CLIENT';

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[
          { label: 'Tickets', to: '/tickets' },
          { label: ticket.number },
        ]}
        title={`${ticket.number}: ${ticket.title}`}
        description={`Opened ${formatLocalDateTime(ticket.createdAt)} by ${ticket.createdByName ?? ticket.createdBy}${ticket.tenantCode ? ` · ${ticket.tenantCode}` : ''}`}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <StatusChip status={ticket.priority} />
            <StatusChip status={ticket.status} />
            {isSE && ticket.status !== 'CLOSED' && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setWoModalOpen(true)}
                icon={<Wrench className="w-3.5 h-3.5" />}
              >
                Create Work Order
              </Button>
            )}
            {isSE && isEditableStatus && (
              <Button
                size="sm"
                onClick={() => setResolveOpen(true)}
                icon={<CheckCircle2 className="w-3.5 h-3.5" />}
              >
                Resolve Ticket
              </Button>
            )}
            {isSE && ticket.status === 'RESOLVED' && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setCloseOpen(true)}
                icon={<XCircle className="w-3.5 h-3.5" />}
              >
                Close Directly
              </Button>
            )}
          </div>
        }
      />

      {/* Informational Post-Maintenance Offline Warning Banner (Section 8.5) */}
      {ticket.postMaintenanceOfflineWarning && (
        <div
          role="alert"
          className="rounded-xl border border-amber-300 bg-amber-50 p-4 flex items-start gap-3 text-sm text-amber-950"
        >
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Device still not ONLINE after maintenance completion</p>
            <p className="text-xs text-amber-800 mt-0.5">
              More than 5 minutes have elapsed since a linked work order completed, and{' '}
              <span className="font-mono font-semibold">{ticket.device?.name ?? ticket.deviceId}</span>{' '}
              is currently reporting <span className="font-semibold">{ticket.device?.connectivity}</span>.
              Verify hardware power, network uplink, or API credentials before closing.
            </p>
          </div>
        </div>
      )}

      {/* Client Confirmation Callout when RESOLVED */}
      {ticket.status === 'RESOLVED' && (canConfirm || canReopen) && (
        <Card className="p-5 border-emerald-300 bg-emerald-50/40">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-emerald-950">
                Support marked this ticket as Resolved
              </p>
              <p className="text-xs text-emerald-900">
                <span className="font-semibold">Root cause:</span> {ticket.rootCause}
              </p>
              <p className="text-xs text-emerald-800">
                <span className="font-semibold">Resolution:</span> {ticket.resolutionNotes}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              {canConfirm && (
                <Button
                  size="sm"
                  loading={confirmMutation.isPending}
                  onClick={() => confirmMutation.mutate()}
                  icon={<CheckCircle2 className="w-4 h-4" />}
                >
                  Confirm & Close
                </Button>
              )}
              {canReopen && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setReopenOpen(true)}
                  icon={<RotateCcw className="w-3.5 h-3.5" />}
                >
                  Reopen
                </Button>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Waiting on Client Callout */}
      {ticket.status === 'WAITING_ON_CLIENT' && !isSE && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
          <p className="font-semibold">Your response is requested</p>
          <p className="mt-0.5 text-amber-800">
            Post a comment below and this ticket will automatically move back to In Progress.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left 8 columns: Description, Resolution, Linked Work Orders, Comments */}
        <div className="lg:col-span-8 space-y-6">
          <Card className="p-5 space-y-4">
            <h2 className="text-sm font-semibold text-slate-900">Description</h2>
            <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
              {ticket.description}
            </p>

            {(ticket.rootCause || ticket.resolutionNotes || ticket.closeReason) && (
              <div className="pt-4 border-t border-slate-100 space-y-2.5 text-sm">
                {ticket.rootCause && (
                  <div>
                    <p className="text-xs font-semibold text-slate-600">
                      Root Cause
                    </p>
                    <p className="text-slate-800 mt-0.5">{ticket.rootCause}</p>
                  </div>
                )}
                {ticket.resolutionNotes && (
                  <div>
                    <p className="text-xs font-semibold text-slate-600">
                      Resolution Notes
                    </p>
                    <p className="text-slate-800 mt-0.5">{ticket.resolutionNotes}</p>
                  </div>
                )}
                {ticket.closeReason && (
                  <div>
                    <p className="text-xs font-semibold text-slate-600">
                      Close Reason
                    </p>
                    <p className="text-slate-700 mt-0.5">
                      {ticket.closeReason}
                      {ticket.closedAt && (
                        <span className="ml-2 font-mono text-xs text-slate-500">
                          ({formatLocalDateTime(ticket.closedAt)})
                        </span>
                      )}
                    </p>
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* Linked Work Orders */}
          <Card className="overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Wrench className="w-4 h-4 text-indigo-600" />
                <h2 className="text-sm font-semibold text-slate-900">
                  Linked Work Orders ({ticket.linkedWorkOrders.length})
                </h2>
              </div>
              {isSE && ticket.status !== 'CLOSED' && (
                <Button size="sm" variant="secondary" onClick={() => setWoModalOpen(true)}>
                  Create Work Order
                </Button>
              )}
            </div>
            {ticket.linkedWorkOrders.length === 0 ? (
              <EmptyState
                title="No work orders dispatched yet"
                description="Dispatch a field work order when physical inspection or on-site repair is needed."
                action={
                  isSE && ticket.status !== 'CLOSED' ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setWoModalOpen(true)}
                      icon={<Wrench className="w-3.5 h-3.5" />}
                    >
                      Create Work Order
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <ul className="divide-y divide-slate-100">
                {ticket.linkedWorkOrders.map((wo) => (
                  <li key={wo.id}>
                    <Link
                      to={`/work-orders/${wo.id}`}
                      className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-slate-50 transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs font-semibold text-indigo-600">
                            {wo.number}
                          </span>
                          <StatusChip status={wo.status} />
                          {wo.downtimeRequired && (
                            <StatusChip
                              status={wo.approvalStatus}
                              label={`Approval: ${wo.approvalStatus.replaceAll('_', ' ')}`}
                            />
                          )}
                        </div>
                        <p className="text-sm font-medium text-slate-900 mt-1 truncate">
                          {wo.title}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Technician: {wo.assignedToName ?? 'Unassigned'}
                          {wo.plannedStart ? ` · Planned ${formatLocalDateTime(wo.plannedStart)}` : ''}
                        </p>
                      </div>
                      <span className="text-xs font-medium text-indigo-600 shrink-0">
                        Open →
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Comments Thread */}
          <Card className="p-5 space-y-4">
            <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-indigo-600" />
              Comments ({ticket.comments.length})
            </h2>

            {ticket.comments.length === 0 ? (
              <p className="text-xs text-slate-500">No comments yet.</p>
            ) : (
              <ol className="space-y-3">
                {ticket.comments.map((c) => {
                  const isSystem = c.authorRole === 'SYSTEM';
                  return (
                    <li
                      key={c.id}
                      className={`rounded-xl border p-3.5 text-sm ${
                        isSystem
                          ? 'bg-slate-50 border-slate-200'
                          : 'bg-white border-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-slate-900">{c.authorName}</span>
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono text-[10px]">
                            {c.authorRole.replaceAll('_', ' ')}
                          </span>
                        </div>
                        <RelativeTime iso={c.at} />
                      </div>
                      <p className="mt-2 text-slate-700 whitespace-pre-wrap leading-relaxed">
                        {c.body}
                      </p>
                    </li>
                  );
                })}
              </ol>
            )}

            {canComment && ticket.status !== 'CLOSED' && (
              <div className="pt-3 border-t border-slate-100 space-y-2.5">
                <Textarea
                  label="Add comment"
                  rows={3}
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  placeholder="Write an update or answer..."
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    loading={commentMutation.isPending}
                    disabled={commentBody.trim().length === 0}
                    onClick={() => commentMutation.mutate()}
                    icon={<Send className="w-3.5 h-3.5" />}
                  >
                    Post Comment
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* Right 4 columns: Metadata, SE controls, Device & Alert context */}
        <div className="lg:col-span-4 space-y-5">
          {isSE && isEditableStatus && (
            <Card className="p-5 space-y-4">
              <h2 className="text-sm font-semibold text-slate-900">Support Controls</h2>
              <Select
                label="Status"
                value={ticket.status}
                disabled={updateMutation.isPending}
                onChange={(e) =>
                  updateMutation.mutate({ status: e.target.value as TicketStatus })
                }
                options={[
                  { value: 'OPEN', label: 'Open' },
                  { value: 'IN_PROGRESS', label: 'In Progress' },
                  { value: 'WAITING_ON_CLIENT', label: 'Waiting on Client' },
                ]}
              />
              <Select
                label="Priority"
                value={ticket.priority}
                disabled={updateMutation.isPending}
                onChange={(e) =>
                  updateMutation.mutate({ priority: e.target.value as TicketPriority })
                }
                options={[
                  { value: 'LOW', label: 'Low' },
                  { value: 'MEDIUM', label: 'Medium' },
                  { value: 'HIGH', label: 'High' },
                  { value: 'CRITICAL', label: 'Critical' },
                ]}
              />
              <Select
                label="Assigned Engineer"
                value={ticket.assigneeId ?? ''}
                disabled={updateMutation.isPending}
                onChange={(e) =>
                  updateMutation.mutate({ assigneeId: e.target.value || null })
                }
              >
                <option value="">Unassigned</option>
                {(assigneesQuery.data?.items ?? []).map((eng) => (
                  <option key={eng.id} value={eng.id}>
                    {eng.name}
                  </option>
                ))}
              </Select>
            </Card>
          )}

          <Card className="p-5 space-y-3">
            <h2 className="text-sm font-semibold text-slate-900">Ticket Details</h2>
            <dl className="space-y-2.5 text-xs">
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Source</dt>
                <dd className="font-mono text-slate-800">{ticket.source.replaceAll('_', ' ')}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Assignee</dt>
                <dd className="font-medium text-slate-800">
                  {ticket.assigneeName ?? 'Unassigned'}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Site</dt>
                <dd className="text-slate-800">{ticket.siteName ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Updated</dt>
                <dd>
                  <RelativeTime iso={ticket.updatedAt} />
                </dd>
              </div>
            </dl>
          </Card>

          {ticket.device && (
            <Card className="p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-indigo-600" />
                  Impacted Device
                </h2>
                <StatusChip status={ticket.device.connectivity} />
              </div>
              <div>
                <Link
                  to={`/devices/${ticket.device.id}`}
                  className="text-sm font-semibold text-indigo-600 hover:text-indigo-700"
                >
                  {ticket.device.name}
                </Link>
                <p className="text-xs font-mono text-slate-500 mt-0.5">
                  {ticket.device.serialNumber}
                </p>
              </div>
              <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-100">
                <span className="text-slate-500">Lifecycle state</span>
                <StatusChip status={ticket.device.state} />
              </div>
            </Card>
          )}

          {ticket.linkedAlert && (
            <Card className="p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Bell className="w-4 h-4 text-red-600" />
                  Linked Alert
                </h2>
                <StatusChip status={ticket.linkedAlert.status} />
              </div>
              <div className="flex items-center gap-2">
                <SeverityChip severity={ticket.linkedAlert.severity} />
                <span className="text-xs text-slate-500">
                  {ticket.linkedAlert.ruleName ?? 'Device Alert'}
                </span>
              </div>
              <p className="text-xs text-slate-700">{ticket.linkedAlert.message}</p>
              <Link
                to={`/alerts?alertId=${ticket.linkedAlert.id}`}
                className="inline-block text-xs font-medium text-indigo-600 hover:text-indigo-700"
              >
                Inspect alert →
              </Link>
            </Card>
          )}
        </div>
      </div>

      {/* Resolve Ticket Modal (SE only) */}
      <Modal
        open={resolveOpen}
        onClose={() => setResolveOpen(false)}
        title={`Resolve ${ticket.number}`}
        description="Document the root cause and resolution steps. The client will be notified to confirm and close."
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setResolveOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={resolveMutation.isPending}
              disabled={rootCause.trim().length < 3 || resolutionNotes.trim().length < 3}
              onClick={() => resolveMutation.mutate()}
            >
              Mark Resolved
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Textarea
            label="Root Cause"
            required
            rows={2}
            value={rootCause}
            onChange={(e) => setRootCause(e.target.value)}
            placeholder="What caused the incident?"
          />
          <Textarea
            label="Resolution Notes"
            required
            rows={3}
            value={resolutionNotes}
            onChange={(e) => setResolutionNotes(e.target.value)}
            placeholder="Summary of repair, calibration, or verification performed..."
          />
        </div>
      </Modal>

      {/* Reopen Modal */}
      <Modal
        open={reopenOpen}
        onClose={() => setReopenOpen(false)}
        title={`Reopen ${ticket.number}`}
        description="Move this ticket back to In Progress if the issue persists."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setReopenOpen(false)}>
              Cancel
            </Button>
            <Button loading={reopenMutation.isPending} onClick={() => reopenMutation.mutate()}>
              Reopen Ticket
            </Button>
          </>
        }
      >
        <Textarea
          label="Note (optional)"
          rows={3}
          value={reopenNote}
          onChange={(e) => setReopenNote(e.target.value)}
          placeholder="Explain what still needs attention..."
        />
      </Modal>

      {/* Close Directly Modal (SE only) */}
      <Modal
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        title={`Close ${ticket.number}`}
        description="Close this resolved ticket directly without waiting for client confirmation."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCloseOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={closeMutation.isPending}
              disabled={closeReason.trim().length < 3}
              onClick={() => closeMutation.mutate()}
            >
              Close Ticket
            </Button>
          </>
        }
      >
        <Textarea
          label="Close Reason"
          required
          rows={3}
          value={closeReason}
          onChange={(e) => setCloseReason(e.target.value)}
          placeholder="e.g. Verified stable for 48 hours; client confirmed via phone"
        />
      </Modal>

      {/* Create Linked Work Order Modal (SE only) */}
      <CreateWorkOrderModal
        open={woModalOpen}
        onClose={() => setWoModalOpen(false)}
        defaultDeviceId={ticket.deviceId}
        defaultTicketId={ticket.id}
        defaultTitle={`Repair: ${ticket.title}`}
        defaultInstructions={ticket.description}
        onCreated={(wo) => navigate(`/work-orders/${wo.id}`)}
      />
    </div>
  );
}
