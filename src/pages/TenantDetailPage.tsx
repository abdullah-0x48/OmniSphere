import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PauseCircle, PlayCircle, Plus } from 'lucide-react';
import { useParams } from 'react-router-dom';
import {
  ROLE_LABELS,
  type AuditLog,
  type PaginatedResponse,
  type TenantSettings,
  type TenantSummary,
  type UserPublic,
} from '../../shared/types.ts';
import { ApiClientError, apiRequest } from '../api/client.ts';
import {
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  DataTable,
  ErrorState,
  Input,
  Modal,
  PageHeader,
  RelativeTime,
  StatusChip,
  Tabs,
  useToast,
  type Column,
} from '../components/ui/index.ts';
import { formatLocalDateTime } from '../utils/format.ts';

export function TenantDetailPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<'settings' | 'users' | 'audit'>('settings');
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [suspendReason, setSuspendReason] = useState('');
  const [reactivateOpen, setReactivateOpen] = useState(false);
  const [addAdminOpen, setAddAdminOpen] = useState(false);
  const [adminForm, setAdminForm] = useState({ name: '', email: '', password: '' });
  const [adminError, setAdminError] = useState<string | null>(null);

  const [settingsForm, setSettingsForm] = useState<TenantSettings>({
    heartbeatIntervalSec: 30,
    offlineAfterMissedIntervals: 3,
    criticalAckMinutes: 15,
    requireRolloutApproval: false,
    requireMaintenanceApproval: true,
  });

  const tenantQuery = useQuery({
    queryKey: ['tenant', id],
    queryFn: () => apiRequest<TenantSummary>(`/tenants/${id}`),
    enabled: Boolean(id),
  });

  const usersQuery = useQuery({
    queryKey: ['tenant-users', id],
    queryFn: () =>
      apiRequest<PaginatedResponse<UserPublic>>('/users', {
        query: { tenantId: id, page: 1, pageSize: 50 },
      }),
    enabled: Boolean(id),
  });

  const auditQuery = useQuery({
    queryKey: ['tenant-audit', id],
    queryFn: () =>
      apiRequest<PaginatedResponse<AuditLog>>('/audit', {
        query: { tenantId: id, page: 1, pageSize: 25 },
      }),
    enabled: Boolean(id),
  });

  useEffect(() => {
    if (tenantQuery.data?.settings) {
      setSettingsForm(tenantQuery.data.settings);
    }
  }, [tenantQuery.data]);

  const settingsMutation = useMutation({
    mutationFn: (payload: TenantSettings) =>
      apiRequest(`/tenants/${id}/settings`, { method: 'PATCH', body: payload }),
    onSuccess: () => {
      toast({ kind: 'success', title: 'Tenant settings saved' });
      void queryClient.invalidateQueries({ queryKey: ['tenant', id] });
      void queryClient.invalidateQueries({ queryKey: ['tenant-audit', id] });
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Save failed',
        description: err instanceof ApiClientError ? err.message : 'Unable to save settings.',
      });
    },
  });

  const suspendMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/tenants/${id}/suspend`, { method: 'POST', body: { reason: suspendReason } }),
    onSuccess: () => {
      setSuspendOpen(false);
      setSuspendReason('');
      toast({ kind: 'success', title: 'Organization suspended' });
      void queryClient.invalidateQueries({ queryKey: ['tenant', id] });
      void queryClient.invalidateQueries({ queryKey: ['tenant-audit', id] });
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: () => apiRequest(`/tenants/${id}/reactivate`, { method: 'POST' }),
    onSuccess: () => {
      setReactivateOpen(false);
      toast({ kind: 'success', title: 'Organization reactivated' });
      void queryClient.invalidateQueries({ queryKey: ['tenant', id] });
      void queryClient.invalidateQueries({ queryKey: ['tenant-audit', id] });
    },
  });

  const addAdminMutation = useMutation({
    mutationFn: () =>
      apiRequest('/users', {
        method: 'POST',
        body: {
          name: adminForm.name,
          email: adminForm.email,
          password: adminForm.password,
          role: 'CLIENT_ADMIN',
          tenantId: id,
        },
      }),
    onSuccess: () => {
      setAddAdminOpen(false);
      setAdminForm({ name: '', email: '', password: '' });
      setAdminError(null);
      toast({ kind: 'success', title: 'Client Admin added' });
      void queryClient.invalidateQueries({ queryKey: ['tenant-users', id] });
      void queryClient.invalidateQueries({ queryKey: ['tenant', id] });
    },
    onError: (err) => {
      setAdminError(err instanceof ApiClientError ? err.message : 'Unable to create Client Admin.');
    },
  });

  if (tenantQuery.isLoading) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading organization">
        <div className="space-y-2">
          <div className="h-4 w-32 bg-slate-200 rounded animate-pulse" />
          <div className="h-7 w-64 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-96 max-w-full bg-slate-200 rounded animate-pulse" />
        </div>
        <div className="h-10 w-80 bg-slate-200 rounded-lg animate-pulse" />
        <div className="h-72 max-w-2xl bg-white border border-slate-200 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (tenantQuery.isError) {
    return (
      <ErrorState
        message={
          tenantQuery.error instanceof ApiClientError
            ? tenantQuery.error.message
            : 'Unable to load organization.'
        }
        onRetry={() => void tenantQuery.refetch()}
      />
    );
  }

  const tenant = tenantQuery.data;

  const userCols: Column<UserPublic>[] = [
    {
      key: 'name',
      header: 'User',
      render: (u) => (
        <div>
          <p className="font-medium text-slate-900">{u.name}</p>
          <p className="text-xs font-mono text-slate-500">{u.email}</p>
        </div>
      ),
    },
    { key: 'role', header: 'Role', render: (u) => <span>{ROLE_LABELS[u.role]}</span> },
    { key: 'status', header: 'Status', render: (u) => <StatusChip status={u.status} /> },
    {
      key: 'lastLogin',
      header: 'Last sign-in',
      render: (u) => <RelativeTime iso={u.lastLoginAt} />,
    },
  ];

  const auditCols: Column<AuditLog>[] = [
    {
      key: 'at',
      header: 'Time',
      render: (a) => (
        <span className="font-mono text-xs tabular-nums text-slate-600">
          {formatLocalDateTime(a.at)}
        </span>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      render: (a) => <span className="font-mono text-xs font-medium text-slate-900">{a.action}</span>,
    },
    {
      key: 'actor',
      header: 'Actor',
      render: (a) => (
        <span className="text-xs text-slate-700">{a.actorEmail ?? a.actorId}</span>
      ),
    },
    {
      key: 'outcome',
      header: 'Outcome',
      render: (a) => <StatusChip status={a.outcome} />,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={tenant ? tenant.name : 'Loading organization...'}
        description={
          tenant
            ? `${tenant.code} · ${tenant.contactEmail} · ${tenant.activeUserCount} active of ${tenant.userCount} users`
            : undefined
        }
        breadcrumbs={[
          { label: 'Tenants', to: '/tenants' },
          { label: tenant?.code ?? id },
        ]}
        actions={
          tenant && (
            <>
              <StatusChip status={tenant.status} />
              {tenant.status === 'ACTIVE' ? (
                <Button
                  variant="danger"
                  size="sm"
                  icon={<PauseCircle className="w-4 h-4" />}
                  onClick={() => setSuspendOpen(true)}
                >
                  Suspend
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<PlayCircle className="w-4 h-4 text-emerald-600" />}
                  onClick={() => setReactivateOpen(true)}
                >
                  Reactivate
                </Button>
              )}
            </>
          )
        }
      />

      <Tabs
        active={activeTab}
        onChange={(t) => setActiveTab(t as 'settings' | 'users' | 'audit')}
        tabs={[
          { id: 'settings', label: 'Settings' },
          { id: 'users', label: 'Users', count: usersQuery.data?.total },
          { id: 'audit', label: 'Recent Audit', count: auditQuery.data?.total },
        ]}
      />

      {activeTab === 'settings' && (
        <Card className="p-6 max-w-2xl">
          <h2 className="text-base font-semibold text-slate-900">Operational Policies</h2>
          <p className="text-xs text-slate-500 mt-1">
            Controls device offline detection, critical alert escalation timing, and Client Manager approval gates.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              settingsMutation.mutate(settingsForm);
            }}
            className="mt-5 space-y-5"
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Input
                label="Heartbeat interval (sec)"
                type="number"
                min={10}
                max={3600}
                value={settingsForm.heartbeatIntervalSec}
                onChange={(e) =>
                  setSettingsForm({ ...settingsForm, heartbeatIntervalSec: Number(e.target.value) })
                }
              />
              <Input
                label="Offline missed intervals"
                type="number"
                min={1}
                max={20}
                value={settingsForm.offlineAfterMissedIntervals}
                onChange={(e) =>
                  setSettingsForm({
                    ...settingsForm,
                    offlineAfterMissedIntervals: Number(e.target.value),
                  })
                }
              />
              <Input
                label="Critical ack window (min)"
                type="number"
                min={1}
                max={1440}
                value={settingsForm.criticalAckMinutes}
                onChange={(e) =>
                  setSettingsForm({ ...settingsForm, criticalAckMinutes: Number(e.target.value) })
                }
              />
            </div>

            <div className="space-y-3 pt-2 border-t border-slate-100">
              <Checkbox
                label="Require Client Manager approval for OTA rollouts"
                description="Rollouts start in PENDING_APPROVAL until approved by a Client Manager."
                checked={settingsForm.requireRolloutApproval}
                onChange={(e) =>
                  setSettingsForm({ ...settingsForm, requireRolloutApproval: e.target.checked })
                }
              />
              <Checkbox
                label="Require Client Manager approval for downtime maintenance windows"
                description="Field Technicians cannot start downtime work orders until approved."
                checked={settingsForm.requireMaintenanceApproval}
                onChange={(e) =>
                  setSettingsForm({ ...settingsForm, requireMaintenanceApproval: e.target.checked })
                }
              />
            </div>

            <div className="pt-2">
              <Button type="submit" loading={settingsMutation.isPending}>
                Save settings
              </Button>
            </div>
          </form>
        </Card>
      )}

      {activeTab === 'users' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => setAddAdminOpen(true)}>
              Add Client Admin
            </Button>
          </div>
          <DataTable
            columns={userCols}
            rows={usersQuery.data?.items ?? []}
            rowKey={(u) => u.id}
            total={usersQuery.data?.total ?? 0}
            page={1}
            pageSize={50}
            onPageChange={() => {}}
            isLoading={usersQuery.isLoading}
            error={
              usersQuery.isError
                ? usersQuery.error instanceof ApiClientError
                  ? usersQuery.error.message
                  : 'Unable to load users.'
                : null
            }
            onRetry={() => void usersQuery.refetch()}
            emptyTitle="No users in this organization"
            emptyDescription="Add a Client Admin so this organization can onboard staff."
            emptyAction={
              <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => setAddAdminOpen(true)}>
                Add Client Admin
              </Button>
            }
          />
        </div>
      )}

      {activeTab === 'audit' && (
        <DataTable
          columns={auditCols}
          rows={auditQuery.data?.items ?? []}
          rowKey={(a) => a.id}
          total={auditQuery.data?.total ?? 0}
          page={1}
          pageSize={25}
          onPageChange={() => {}}
          isLoading={auditQuery.isLoading}
          error={
            auditQuery.isError
              ? auditQuery.error instanceof ApiClientError
                ? auditQuery.error.message
                : 'Unable to load audit events.'
              : null
          }
          onRetry={() => void auditQuery.refetch()}
          emptyTitle="No audit events yet"
          emptyDescription="Activity scoped to this tenant will appear here."
          emptyAction={
            <Button size="sm" variant="secondary" onClick={() => void auditQuery.refetch()}>
              Refresh
            </Button>
          }
        />
      )}

      <Modal
        open={addAdminOpen}
        onClose={() => setAddAdminOpen(false)}
        title="Add Client Admin"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAddAdminOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="add-ca-form" loading={addAdminMutation.isPending}>
              Create Client Admin
            </Button>
          </>
        }
      >
        <form
          id="add-ca-form"
          onSubmit={(e) => {
            e.preventDefault();
            setAdminError(null);
            addAdminMutation.mutate();
          }}
          className="space-y-4"
        >
          {adminError && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
              {adminError}
            </div>
          )}
          <Input
            label="Full name"
            required
            value={adminForm.name}
            onChange={(e) => setAdminForm({ ...adminForm, name: e.target.value })}
          />
          <Input
            label="Email"
            type="email"
            required
            value={adminForm.email}
            onChange={(e) => setAdminForm({ ...adminForm, email: e.target.value })}
          />
          <Input
            label="Password"
            type="password"
            required
            value={adminForm.password}
            onChange={(e) => setAdminForm({ ...adminForm, password: e.target.value })}
            hint="Minimum 8 characters with a letter and a digit."
          />
        </form>
      </Modal>

      <ConfirmDialog
        open={suspendOpen}
        onClose={() => setSuspendOpen(false)}
        onConfirm={() => suspendMutation.mutate()}
        loading={suspendMutation.isPending}
        title={`Suspend ${tenant?.name ?? ''}`}
        message="All active sessions and device connections for this tenant will be blocked immediately."
        confirmLabel="Suspend"
        extraField={
          <Input
            label="Reason (optional)"
            value={suspendReason}
            onChange={(e) => setSuspendReason(e.target.value)}
          />
        }
      />

      <ConfirmDialog
        open={reactivateOpen}
        onClose={() => setReactivateOpen(false)}
        onConfirm={() => reactivateMutation.mutate()}
        loading={reactivateMutation.isPending}
        variant="primary"
        title={`Reactivate ${tenant?.name ?? ''}`}
        message="Restore user and device access for this organization."
        confirmLabel="Reactivate"
      />
    </div>
  );
}
