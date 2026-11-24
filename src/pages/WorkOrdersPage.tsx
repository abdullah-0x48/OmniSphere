import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Calendar,
  Clock,
  List,
  Plus,
  ShieldAlert,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type {
  PaginatedResponse,
  StaffOption,
  WorkOrderPublic,
} from '../../shared/types.ts';
import { ApiClientError, apiRequest } from '../api/client.ts';
import { useAuth } from '../auth/AuthContext.tsx';
import {
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  PageHeader,
  Select,
  StatusChip,
  useToast,
  type Column,
} from '../components/ui/index.ts';
import { CreateWorkOrderModal } from '../components/workOrders/CreateWorkOrderModal.tsx';
import { formatLocalDateTime } from '../utils/format.ts';

function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function WorkOrdersPage() {
  const { user, activeTenantId } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const isSE = user?.role === 'SUPPORT_ENGINEER';
  const isCM = user?.role === 'CLIENT_MANAGER';

  const view = searchParams.get('view') === 'schedule' ? 'schedule' : 'list';
  const status = searchParams.get('status') ?? '';
  const type = searchParams.get('type') ?? '';
  const approvalStatus = searchParams.get('approvalStatus') ?? '';
  const search = searchParams.get('search') ?? '';
  const page = Number(searchParams.get('page') ?? '1') || 1;

  const [createOpen, setCreateOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<WorkOrderPublic | null>(null);
  const [assignTechId, setAssignTechId] = useState('');
  const [assignStart, setAssignStart] = useState('');
  const [assignEnd, setAssignEnd] = useState('');
  const [cancelTarget, setCancelTarget] = useState<WorkOrderPublic | null>(null);

  const updateParams = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(updates)) {
      if (!v) next.delete(k);
      else next.set(k, v);
    }
    setSearchParams(next, { replace: true });
  };

  const workOrdersQuery = useQuery({
    queryKey: ['work-orders-list', { view, status, type, approvalStatus, search, page, activeTenantId }],
    queryFn: () =>
      apiRequest<PaginatedResponse<WorkOrderPublic>>('/work-orders', {
        query: {
          status: status || undefined,
          type: type || undefined,
          approvalStatus: approvalStatus || undefined,
          search: search.trim() || undefined,
          page: view === 'schedule' ? 1 : page,
          pageSize: view === 'schedule' ? 100 : 25,
        },
      }),
    refetchInterval: 10000,
  });

  const techniciansQuery = useQuery({
    queryKey: ['wo-technicians', activeTenantId],
    enabled: isSE && Boolean(assignTarget),
    queryFn: () => apiRequest<{ items: StaffOption[] }>('/work-orders/technicians'),
  });

  const assignMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/work-orders/${assignTarget!.id}/assign`, {
        method: 'POST',
        body: {
          assignedTo: assignTechId || null,
          plannedStart: assignStart ? new Date(assignStart).toISOString() : null,
          plannedEnd: assignEnd ? new Date(assignEnd).toISOString() : null,
        },
      }),
    onSuccess: () => {
      toast({ kind: 'success', title: 'Work order assignment updated' });
      setAssignTarget(null);
      void queryClient.invalidateQueries({ queryKey: ['work-orders-list'] });
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Assignment failed',
        description: err instanceof ApiClientError ? err.message : 'Unable to assign technician.',
      });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/work-orders/${id}/cancel`, {
        method: 'POST',
        body: { reason: 'Cancelled by Support Engineer' },
      }),
    onSuccess: () => {
      toast({ kind: 'info', title: 'Work order cancelled' });
      setCancelTarget(null);
      void queryClient.invalidateQueries({ queryKey: ['work-orders-list'] });
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Cancel failed',
        description: err instanceof ApiClientError ? err.message : 'Unable to cancel work order.',
      });
    },
  });

  const rows = workOrdersQuery.data?.items ?? [];
  const pendingApprovalCount = rows.filter(
    (wo) => wo.approvalStatus === 'PENDING' && wo.status !== 'COMPLETED' && wo.status !== 'CANCELLED',
  ).length;

  // Build 14-day schedule buckets for Schedule View (Section 10.5)
  const scheduleBuckets = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const days: Array<{ key: string; label: string; isToday: boolean; items: WorkOrderPublic[] }> = [];
    const byDay = new Map<string, WorkOrderPublic[]>();

    for (let i = 0; i < 14; i += 1) {
      const d = new Date(startOfToday.getTime() + i * 86400_000);
      const key = d.toISOString().slice(0, 10);
      byDay.set(key, []);
      days.push({
        key,
        label: d.toLocaleDateString(undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        }),
        isToday: i === 0,
        items: [],
      });
    }

    const unscheduled: WorkOrderPublic[] = [];
    for (const wo of rows) {
      if (wo.status === 'CANCELLED') continue;
      if (!wo.plannedStart) {
        unscheduled.push(wo);
        continue;
      }
      const key = new Date(wo.plannedStart).toISOString().slice(0, 10);
      const bucket = byDay.get(key);
      if (bucket) {
        bucket.push(wo);
      }
    }

    for (const day of days) {
      day.items = byDay.get(day.key) ?? [];
    }
    return { days, unscheduled };
  }, [rows]);

  const columns: Column<WorkOrderPublic>[] = [
    {
      key: 'number',
      header: 'Work Order',
      render: (wo) => (
        <div className="min-w-0 max-w-md">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-semibold text-indigo-600">{wo.number}</span>
            <StatusChip status={wo.type} />
          </div>
          <p className="font-medium text-slate-900 truncate mt-0.5">{wo.title}</p>
        </div>
      ),
    },
    {
      key: 'device',
      header: 'Device & Site',
      render: (wo) => (
        <div className="text-xs">
          <Link
            to={`/devices/${wo.deviceId}`}
            onClick={(e) => e.stopPropagation()}
            className="font-medium text-indigo-600 hover:text-indigo-700"
          >
            {wo.deviceName ?? wo.deviceId}
          </Link>
          {wo.siteName && <p className="text-slate-500">{wo.siteName}</p>}
        </div>
      ),
    },
    {
      key: 'window',
      header: 'Planned Window',
      render: (wo) => (
        <span className="font-mono text-xs text-slate-600 whitespace-nowrap">
          {wo.plannedStart ? formatLocalDateTime(wo.plannedStart) : 'Unscheduled'}
        </span>
      ),
    },
    {
      key: 'assigned',
      header: 'Technician',
      render: (wo) => (
        <span className="text-xs text-slate-700">{wo.assignedToName ?? 'Unassigned'}</span>
      ),
    },
    {
      key: 'approval',
      header: 'Approval',
      render: (wo) =>
        wo.downtimeRequired ? (
          <StatusChip status={wo.approvalStatus} />
        ) : (
          <span className="text-xs text-slate-600">No downtime</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (wo) => <StatusChip status={wo.status} />,
    },
    ...(isSE
      ? [
          {
            key: 'actions',
            header: 'Actions',
            align: 'right' as const,
            render: (wo: WorkOrderPublic) => (
              <div
                className="inline-flex items-center justify-end gap-1"
                onClick={(e) => e.stopPropagation()}
              >
                {(wo.status === 'PLANNED' || wo.status === 'ASSIGNED') && (
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setAssignTarget(wo);
                        setAssignTechId(wo.assignedTo ?? '');
                        setAssignStart(toDatetimeLocalValue(wo.plannedStart));
                        setAssignEnd(toDatetimeLocalValue(wo.plannedEnd));
                      }}
                      icon={<UserCheck className="w-3.5 h-3.5" />}
                    >
                      Assign
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setCancelTarget(wo)}
                      icon={<XCircle className="w-3.5 h-3.5" />}
                    >
                      Cancel
                    </Button>
                  </>
                )}
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Work Orders"
        description="Corrective and preventive field maintenance jobs, technician assignments, and downtime approval tracking."
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5" role="group" aria-label="Work order view">
              <button
                type="button"
                aria-pressed={view === 'list'}
                onClick={() => updateParams({ view: null })}
                className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium cursor-pointer transition-colors ${
                  view === 'list'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-700 hover:text-slate-900'
                }`}
              >
                <List className="w-3.5 h-3.5" aria-hidden="true" />
                List
              </button>
              <button
                type="button"
                aria-pressed={view === 'schedule'}
                onClick={() => updateParams({ view: 'schedule' })}
                className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium cursor-pointer transition-colors ${
                  view === 'schedule'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-700 hover:text-slate-900'
                }`}
              >
                <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
                14-Day Schedule
              </button>
            </div>
            {isSE && (
              <Button
                size="sm"
                onClick={() => setCreateOpen(true)}
                icon={<Plus className="w-4 h-4" />}
              >
                New Work Order
              </Button>
            )}
          </div>
        }
      />

      {/* CM Pending Approvals Callout */}
      {isCM && pendingApprovalCount > 0 && (
        <Card className="p-4 border-amber-300 bg-amber-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-sm text-amber-950">
            <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0" />
            <span>
              <strong>{pendingApprovalCount}</strong> maintenance{' '}
              {pendingApprovalCount === 1 ? 'window awaits' : 'windows await'} your approval before
              field technicians can start work.
            </span>
          </div>
          <Link
            to="/approvals"
            className="inline-flex items-center justify-center h-9 px-3.5 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 shrink-0"
          >
            Review on Approvals Center →
          </Link>
        </Card>
      )}

      {/* Filters */}
      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <Input
            label="Search work orders"
            placeholder="WO number, title, device, site..."
            value={search}
            onChange={(e) => updateParams({ search: e.target.value || null, page: '1' })}
          />
          <Select
            label="Status"
            value={status}
            onChange={(e) => updateParams({ status: e.target.value || null, page: '1' })}
            options={[
              { value: '', label: 'All statuses' },
              { value: 'PLANNED', label: 'Planned' },
              { value: 'ASSIGNED', label: 'Assigned' },
              { value: 'IN_PROGRESS', label: 'In Progress' },
              { value: 'COMPLETED', label: 'Completed' },
              { value: 'CANCELLED', label: 'Cancelled' },
            ]}
          />
          <Select
            label="Type"
            value={type}
            onChange={(e) => updateParams({ type: e.target.value || null, page: '1' })}
            options={[
              { value: '', label: 'All types' },
              { value: 'CORRECTIVE', label: 'Corrective' },
              { value: 'PREVENTIVE', label: 'Preventive' },
            ]}
          />
          <Select
            label="Approval"
            value={approvalStatus}
            onChange={(e) => updateParams({ approvalStatus: e.target.value || null, page: '1' })}
            options={[
              { value: '', label: 'All approvals' },
              { value: 'PENDING', label: 'Pending Approval' },
              { value: 'APPROVED', label: 'Approved' },
              { value: 'REJECTED', label: 'Rejected' },
              { value: 'NOT_REQUIRED', label: 'Not Required' },
            ]}
          />
          <div className="flex items-end">
            {(status || type || approvalStatus || search) && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  updateParams({
                    status: null,
                    type: null,
                    approvalStatus: null,
                    search: null,
                    page: '1',
                  })
                }
              >
                Clear filters
              </Button>
            )}
          </div>
        </div>
      </Card>

      {view === 'list' ? (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(wo) => wo.id}
          total={workOrdersQuery.data?.total ?? 0}
          page={page}
          pageSize={25}
          onPageChange={(nextPage) => updateParams({ page: String(nextPage) })}
          isLoading={workOrdersQuery.isLoading}
          error={
            workOrdersQuery.isError
              ? workOrdersQuery.error instanceof ApiClientError
                ? workOrdersQuery.error.message
                : 'Unable to load work orders.'
              : null
          }
          onRetry={() => void workOrdersQuery.refetch()}
          onRowClick={(wo) => navigate(`/work-orders/${wo.id}`)}
          emptyTitle="No work orders match your filters"
          emptyDescription="Create a work order from a ticket or directly from this page to schedule field maintenance."
          emptyAction={
            status || type || approvalStatus || search ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  updateParams({
                    status: null,
                    type: null,
                    approvalStatus: null,
                    search: null,
                    page: '1',
                  })
                }
              >
                Clear filters
              </Button>
            ) : isSE ? (
              <Button size="sm" onClick={() => setCreateOpen(true)} icon={<Plus className="w-4 h-4" />}>
                New Work Order
              </Button>
            ) : undefined
          }
        />
      ) : (
        /* 14-Day Schedule View */
        <div className="space-y-4">
          {workOrdersQuery.isError ? (
            <ErrorState
              message={
                workOrdersQuery.error instanceof ApiClientError
                  ? workOrdersQuery.error.message
                  : 'Unable to load maintenance schedule.'
              }
              onRetry={() => void workOrdersQuery.refetch()}
            />
          ) : workOrdersQuery.isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" aria-busy="true">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-44 rounded-xl bg-white border border-slate-200 animate-pulse" />
              ))}
            </div>
          ) : scheduleBuckets.days.every((d) => d.items.length === 0) &&
            scheduleBuckets.unscheduled.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Calendar className="w-7 h-7" />}
                title="No maintenance scheduled in the next 14 days"
                description="Schedule a work order or configure a recurring maintenance plan to populate the calendar."
                action={
                  status || type || approvalStatus || search ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        updateParams({
                          status: null,
                          type: null,
                          approvalStatus: null,
                          search: null,
                          page: '1',
                        })
                      }
                    >
                      Clear filters
                    </Button>
                  ) : isSE ? (
                    <Button size="sm" onClick={() => setCreateOpen(true)} icon={<Plus className="w-4 h-4" />}>
                      New Work Order
                    </Button>
                  ) : undefined
                }
              />
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {scheduleBuckets.days
                .filter((d) => d.items.length > 0 || d.isToday)
                .map((day) => (
                  <Card
                    key={day.key}
                    className={`p-4 space-y-3 ${
                      day.isToday ? 'border-indigo-300 ring-1 ring-indigo-500/15' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                      <span className="text-sm font-semibold text-slate-900">
                        {day.isToday ? `Today · ${day.label}` : day.label}
                      </span>
                      <span className="font-mono text-xs text-slate-600">
                        {day.items.length} {day.items.length === 1 ? 'job' : 'jobs'}
                      </span>
                    </div>
                    {day.items.length === 0 ? (
                      <p className="text-xs text-slate-600 py-2">No jobs scheduled today.</p>
                    ) : (
                      <div className="space-y-2.5">
                        {day.items.map((wo) => (
                          <Link
                            key={wo.id}
                            to={`/work-orders/${wo.id}`}
                            className="block rounded-lg border border-slate-200 p-3 hover:border-indigo-300 hover:bg-slate-50/70 transition-colors"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono text-xs font-semibold text-indigo-600">
                                {wo.number}
                              </span>
                              <StatusChip status={wo.status} />
                            </div>
                            <p className="text-sm font-medium text-slate-900 mt-1 line-clamp-1">
                              {wo.title}
                            </p>
                            <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {wo.plannedStart
                                ? new Date(wo.plannedStart).toLocaleTimeString(undefined, {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })
                                : 'TBD'}
                              {wo.assignedToName ? ` · ${wo.assignedToName}` : ' · Unassigned'}
                            </p>
                            {wo.downtimeRequired && (
                              <div className="mt-2">
                                <StatusChip
                                  status={wo.approvalStatus}
                                  label={`Downtime: ${wo.approvalStatus.replaceAll('_', ' ')}`}
                                />
                              </div>
                            )}
                          </Link>
                        ))}
                      </div>
                    )}
                  </Card>
                ))}
            </div>
          )}
        </div>
      )}

      {/* Create Work Order Modal */}
      <CreateWorkOrderModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(wo) => navigate(`/work-orders/${wo.id}`)}
      />

      {/* Assign Technician Modal */}
      <Modal
        open={Boolean(assignTarget)}
        onClose={() => setAssignTarget(null)}
        title={`Assign ${assignTarget?.number ?? ''}`}
        description="Assign a Field Technician and update the planned maintenance window."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAssignTarget(null)}>
              Cancel
            </Button>
            <Button loading={assignMutation.isPending} onClick={() => assignMutation.mutate()}>
              Save Assignment
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select
            label="Field Technician"
            value={assignTechId}
            onChange={(e) => setAssignTechId(e.target.value)}
          >
            <option value="">Unassigned (Planned)</option>
            {(techniciansQuery.data?.items ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
          <Input
            label="Planned Start"
            type="datetime-local"
            value={assignStart}
            onChange={(e) => setAssignStart(e.target.value)}
          />
          <Input
            label="Planned End"
            type="datetime-local"
            value={assignEnd}
            onChange={(e) => setAssignEnd(e.target.value)}
          />
        </div>
      </Modal>

      {/* Cancel Work Order Confirm */}
      <ConfirmDialog
        open={Boolean(cancelTarget)}
        onClose={() => setCancelTarget(null)}
        onConfirm={() => {
          if (cancelTarget) cancelMutation.mutate(cancelTarget.id);
        }}
        title={`Cancel ${cancelTarget?.number ?? ''}`}
        message="Are you sure you want to cancel this planned work order? This action cannot be undone."
        confirmLabel="Cancel Work Order"
        variant="danger"
        loading={cancelMutation.isPending}
      />
    </div>
  );
}
