import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Plus, Wrench } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type {
  DevicePublic,
  PaginatedResponse,
  Site,
  StaffOption,
  TicketPriority,
  TicketPublic,
  TicketSource,
} from '../../shared/types.ts';
import { ApiClientError, apiRequest } from '../api/client.ts';
import { useAuth } from '../auth/AuthContext.tsx';
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  PageHeader,
  RelativeTime,
  Select,
  StatusChip,
  Textarea,
  useToast,
  type Column,
} from '../components/ui/index.ts';

export function TicketsPage() {
  const { user, activeTenantId } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const isSE = user?.role === 'SUPPORT_ENGINEER';
  const canCreate =
    user?.role === 'SUPPORT_ENGINEER' ||
    user?.role === 'CLIENT_ADMIN' ||
    user?.role === 'CLIENT_MANAGER' ||
    user?.role === 'CLIENT_OPERATOR';

  const status = searchParams.get('status') ?? '';
  const priority = searchParams.get('priority') ?? '';
  const source = searchParams.get('source') ?? '';
  const search = searchParams.get('search') ?? '';
  const page = Number(searchParams.get('page') ?? '1') || 1;

  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [newPriority, setNewPriority] = useState<TicketPriority>('MEDIUM');
  const [newSource, setNewSource] = useState<TicketSource>('INTERNAL');
  const [deviceId, setDeviceId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [assigneeId, setAssigneeId] = useState('');

  const updateParams = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(updates)) {
      if (!v) next.delete(k);
      else next.set(k, v);
    }
    setSearchParams(next, { replace: true });
  };

  const ticketsQuery = useQuery({
    queryKey: ['tickets-list', { status, priority, source, search, page, activeTenantId }],
    queryFn: () =>
      apiRequest<PaginatedResponse<TicketPublic>>('/tickets', {
        query: {
          status: status || undefined,
          priority: priority || undefined,
          source: source || undefined,
          search: search.trim() || undefined,
          page,
          pageSize: 25,
        },
      }),
    refetchInterval: 10000,
  });

  const devicesQuery = useQuery({
    queryKey: ['ticket-modal-devices', activeTenantId],
    enabled: createOpen,
    queryFn: () =>
      apiRequest<PaginatedResponse<DevicePublic>>('/devices', {
        query: { page: 1, pageSize: 200, sort: 'name:asc' },
      }),
  });

  const sitesQuery = useQuery({
    queryKey: ['ticket-modal-sites', activeTenantId],
    enabled: createOpen,
    queryFn: () =>
      apiRequest<PaginatedResponse<Site>>('/sites', {
        query: { page: 1, pageSize: 200 },
      }),
  });

  const assigneesQuery = useQuery({
    queryKey: ['ticket-assignees', activeTenantId],
    enabled: createOpen && isSE,
    queryFn: () => apiRequest<{ items: StaffOption[] }>('/tickets/assignees'),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      apiRequest<TicketPublic>('/tickets', {
        method: 'POST',
        body: {
          title: title.trim(),
          description: description.trim(),
          priority: newPriority,
          source: isSE ? newSource : 'SERVICE_REQUEST',
          deviceId: deviceId || null,
          siteId: siteId || null,
          assigneeId: isSE ? assigneeId || null : null,
        },
      }),
    onSuccess: (created) => {
      toast({
        kind: 'success',
        title: `${created.number} created`,
        description: isSE
          ? 'Ticket added to the support queue.'
          : 'Your service request has been sent to the Support team.',
      });
      setCreateOpen(false);
      setTitle('');
      setDescription('');
      setDeviceId('');
      setSiteId('');
      setAssigneeId('');
      void queryClient.invalidateQueries({ queryKey: ['tickets-list'] });
      void queryClient.invalidateQueries({ queryKey: ['fleet-summary'] });
      void queryClient.invalidateQueries({ queryKey: ['fleet-overview'] });
      navigate(`/tickets/${created.id}`);
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Failed to create ticket',
        description: err instanceof ApiClientError ? err.message : 'Unable to submit ticket.',
      });
    },
  });

  const columns: Column<TicketPublic>[] = [
    {
      key: 'number',
      header: 'Ticket',
      render: (t) => (
        <div className="min-w-0 max-w-md">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-semibold text-indigo-600">{t.number}</span>
            <span className="text-[11px] font-medium text-slate-600">
              {t.source.replaceAll('_', ' ')}
            </span>
          </div>
          <p className="font-medium text-slate-900 truncate mt-0.5">{t.title}</p>
        </div>
      ),
    },
    {
      key: 'priority',
      header: 'Priority',
      render: (t) => <StatusChip status={t.priority} />,
    },
    {
      key: 'status',
      header: 'Status',
      render: (t) => <StatusChip status={t.status} />,
    },
    {
      key: 'device',
      header: 'Device / Site',
      render: (t) => (
        <div className="text-xs">
          {t.deviceId ? (
            <Link
              to={`/devices/${t.deviceId}`}
              onClick={(e) => e.stopPropagation()}
              className="font-medium text-indigo-600 hover:text-indigo-700"
            >
              {t.deviceName ?? t.deviceId}
            </Link>
          ) : (
            <span className="text-slate-500">General</span>
          )}
          {t.siteName && <p className="text-slate-500">{t.siteName}</p>}
        </div>
      ),
    },
    {
      key: 'assignee',
      header: 'Assignee',
      render: (t) => (
        <span className="text-xs text-slate-700">{t.assigneeName ?? 'Unassigned'}</span>
      ),
    },
    {
      key: 'activity',
      header: 'Activity',
      render: (t) => (
        <div className="flex items-center gap-3 text-xs text-slate-600 font-mono tabular-nums">
          <span className="inline-flex items-center gap-1" title="Work orders">
            <Wrench className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
            {t.workOrderCount ?? 0}
          </span>
          <span className="inline-flex items-center gap-1" title="Comments">
            <MessageSquare className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
            {t.comments.length}
          </span>
        </div>
      ),
    },
    {
      key: 'updatedAt',
      header: 'Updated',
      align: 'right',
      render: (t) => <RelativeTime iso={t.updatedAt} />,
    },
  ];

  const rows = ticketsQuery.data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tickets"
        description={
          isSE
            ? 'Track alerts converted to incidents, client service requests, and field maintenance follow-up.'
            : 'View active support tickets, reply to open questions, or raise a new service request.'
        }
        actions={
          canCreate ? (
            <Button
              size="sm"
              onClick={() => setCreateOpen(true)}
              icon={<Plus className="w-4 h-4" />}
            >
              {isSE ? 'New Ticket' : 'New Service Request'}
            </Button>
          ) : undefined
        }
      />

      {/* Filter Bar */}
      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <Input
            label="Search tickets"
            placeholder="Number, title, or device..."
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
              { value: 'IN_PROGRESS', label: 'In Progress' },
              { value: 'WAITING_ON_CLIENT', label: 'Waiting on Client' },
              { value: 'RESOLVED', label: 'Resolved' },
              { value: 'CLOSED', label: 'Closed' },
            ]}
          />
          <Select
            label="Priority"
            value={priority}
            onChange={(e) => updateParams({ priority: e.target.value || null, page: '1' })}
            options={[
              { value: '', label: 'All priorities' },
              { value: 'CRITICAL', label: 'Critical' },
              { value: 'HIGH', label: 'High' },
              { value: 'MEDIUM', label: 'Medium' },
              { value: 'LOW', label: 'Low' },
            ]}
          />
          <Select
            label="Source"
            value={source}
            onChange={(e) => updateParams({ source: e.target.value || null, page: '1' })}
            options={[
              { value: '', label: 'All sources' },
              { value: 'ALERT', label: 'Alert' },
              { value: 'SERVICE_REQUEST', label: 'Service Request' },
              { value: 'INTERNAL', label: 'Internal' },
            ]}
          />
          <div className="flex items-end">
            {(status || priority || source || search) && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  updateParams({ status: null, priority: null, source: null, search: null, page: '1' })
                }
              >
                Clear filters
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Desktop DataTable */}
      <div className="hidden md:block">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(t) => t.id}
          total={ticketsQuery.data?.total ?? 0}
          page={page}
          pageSize={25}
          onPageChange={(nextPage) => updateParams({ page: String(nextPage) })}
          isLoading={ticketsQuery.isLoading}
          error={
            ticketsQuery.isError
              ? ticketsQuery.error instanceof ApiClientError
                ? ticketsQuery.error.message
                : 'Unable to load tickets.'
              : null
          }
          onRetry={() => void ticketsQuery.refetch()}
          onRowClick={(t) => navigate(`/tickets/${t.id}`)}
          emptyTitle="No tickets found"
          emptyDescription="Tickets converted from alerts or submitted as client service requests will appear here."
          emptyAction={
            status || priority || source || search ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  updateParams({ status: null, priority: null, source: null, search: null, page: '1' })
                }
              >
                Clear filters
              </Button>
            ) : canCreate ? (
              <Button size="sm" onClick={() => setCreateOpen(true)} icon={<Plus className="w-4 h-4" />}>
                {isSE ? 'New Ticket' : 'New Service Request'}
              </Button>
            ) : undefined
          }
        />
      </div>

      {/* Mobile Stacked Cards */}
      <div className="md:hidden space-y-3">
        {ticketsQuery.isError ? (
          <ErrorState
            message={
              ticketsQuery.error instanceof ApiClientError
                ? ticketsQuery.error.message
                : 'Unable to load tickets.'
            }
            onRetry={() => void ticketsQuery.refetch()}
          />
        ) : ticketsQuery.isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-xl bg-white border border-slate-200 p-4 space-y-3 animate-pulse">
              <div className="flex justify-between">
                <div className="h-4 w-24 bg-slate-200 rounded" />
                <div className="h-5 w-28 bg-slate-200 rounded-full" />
              </div>
              <div className="h-4 w-3/4 bg-slate-200 rounded" />
              <div className="h-3 w-1/2 bg-slate-100 rounded" />
            </div>
          ))
        ) : rows.length === 0 ? (
          <Card>
            <EmptyState
              title="No tickets match your filters"
              description="Try clearing active filters or raise a new ticket."
              action={
                status || priority || source || search ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      updateParams({ status: null, priority: null, source: null, search: null, page: '1' })
                    }
                  >
                    Clear filters
                  </Button>
                ) : canCreate ? (
                  <Button size="sm" onClick={() => setCreateOpen(true)} icon={<Plus className="w-4 h-4" />}>
                    {isSE ? 'New Ticket' : 'New Service Request'}
                  </Button>
                ) : undefined
              }
            />
          </Card>
        ) : (
          rows.map((t) => (
            <Link key={t.id} to={`/tickets/${t.id}`} className="block rounded-xl">
              <Card className="p-4 hover:border-indigo-300 transition-colors space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold text-indigo-600">{t.number}</span>
                  <div className="flex items-center gap-1.5">
                    <StatusChip status={t.priority} />
                    <StatusChip status={t.status} />
                  </div>
                </div>
                <p className="text-sm font-semibold text-slate-900">{t.title}</p>
                <div className="flex items-center justify-between text-xs text-slate-600 pt-1 border-t border-slate-100">
                  <span className="truncate">{t.deviceName ?? t.siteName ?? 'General'}</span>
                  <RelativeTime iso={t.updatedAt} />
                </div>
              </Card>
            </Link>
          ))
        )}
      </div>

      {/* Create Ticket / Service Request Modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={isSE ? 'New Support Ticket' : 'New Service Request'}
        description={
          isSE
            ? 'Create an incident or internal engineering ticket for the active organization.'
            : 'Describe the issue or maintenance request. Our Support team will be notified immediately.'
        }
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={createMutation.isPending}
              disabled={title.trim().length < 3 || description.trim().length < 5}
              onClick={() => createMutation.mutate()}
            >
              {isSE ? 'Create Ticket' : 'Submit Request'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Title"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Concise summary of the issue or request..."
          />
          <Textarea
            label="Description"
            required
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Include symptoms, impacted line or process, and any urgency details..."
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="Priority"
              value={newPriority}
              onChange={(e) => setNewPriority(e.target.value as TicketPriority)}
              options={[
                { value: 'LOW', label: 'Low' },
                { value: 'MEDIUM', label: 'Medium' },
                { value: 'HIGH', label: 'High' },
                { value: 'CRITICAL', label: 'Critical' },
              ]}
            />
            {isSE && (
              <Select
                label="Source"
                value={newSource}
                onChange={(e) => setNewSource(e.target.value as TicketSource)}
                options={[
                  { value: 'INTERNAL', label: 'Internal' },
                  { value: 'SERVICE_REQUEST', label: 'Service Request' },
                ]}
              />
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="Related Device (optional)"
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
            >
              <option value="">None / General</option>
              {(devicesQuery.data?.items ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.siteName ?? d.siteId})
                </option>
              ))}
            </Select>
            <Select
              label="Site (optional)"
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
            >
              <option value="">Auto from device / None</option>
              {(sitesQuery.data?.items ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          {isSE && (
            <Select
              label="Assign Support Engineer (optional)"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
            >
              <option value="">Unassigned</option>
              {(assigneesQuery.data?.items ?? []).map((eng) => (
                <option key={eng.id} value={eng.id}>
                  {eng.name}
                </option>
              ))}
            </Select>
          )}
        </div>
      </Modal>
    </div>
  );
}
