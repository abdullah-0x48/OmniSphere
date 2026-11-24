import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PauseCircle, Pencil, PlayCircle, Plus, Search } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import type { PaginatedResponse, TenantSummary } from '../../shared/types.ts';
import { ApiClientError, apiRequest } from '../api/client.ts';
import {
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Select,
  StatusChip,
  useToast,
  type Column,
} from '../components/ui/index.ts';
import { formatLocalDateTime } from '../utils/format.ts';

export function TenantsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const q = searchParams.get('q') ?? '';
  const status = searchParams.get('status') ?? '';
  const page = Number(searchParams.get('page') ?? '1') || 1;
  const sort = searchParams.get('sort') ?? 'name:asc';

  const [searchInput, setSearchInput] = useState(q);
  const [createOpen, setCreateOpen] = useState(searchParams.get('create') === '1');
  const [editTenant, setEditTenant] = useState<TenantSummary | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<TenantSummary | null>(null);
  const [suspendReason, setSuspendReason] = useState('');
  const [reactivateTarget, setReactivateTarget] = useState<TenantSummary | null>(null);

  // Create form state
  const [form, setForm] = useState({
    name: '',
    code: '',
    contactEmail: '',
    adminName: '',
    adminEmail: '',
    adminPassword: '',
  });
  const [formError, setFormError] = useState<string | null>(null);

  // Edit form state
  const [editForm, setEditForm] = useState({ name: '', contactEmail: '' });
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    setSearchInput(q);
  }, [q]);

  const updateParams = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(updates)) {
      if (!v) next.delete(k);
      else next.set(k, v);
    }
    setSearchParams(next, { replace: true });
  };

  const tenantsQuery = useQuery({
    queryKey: ['tenants', { q, status, page, sort }],
    queryFn: () =>
      apiRequest<PaginatedResponse<TenantSummary>>('/tenants', {
        query: { q, status, page, pageSize: 25, sort },
      }),
  });

  const createMutation = useMutation({
    mutationFn: (payload: typeof form) =>
      apiRequest('/tenants', {
        method: 'POST',
        body: payload,
      }),
    onSuccess: () => {
      setCreateOpen(false);
      updateParams({ create: null });
      setForm({ name: '', code: '', contactEmail: '', adminName: '', adminEmail: '', adminPassword: '' });
      setFormError(null);
      toast({ kind: 'success', title: 'Organization created', description: 'Initial Client Admin account is ready.' });
      void queryClient.invalidateQueries({ queryKey: ['tenants'] });
      void queryClient.invalidateQueries({ queryKey: ['platform-overview'] });
    },
    onError: (err) => {
      setFormError(err instanceof ApiClientError ? err.message : 'Unable to create organization.');
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: { name: string; contactEmail: string } }) =>
      apiRequest(`/tenants/${id}`, { method: 'PATCH', body: payload }),
    onSuccess: () => {
      setEditTenant(null);
      setEditError(null);
      toast({ kind: 'success', title: 'Organization updated' });
      void queryClient.invalidateQueries({ queryKey: ['tenants'] });
      void queryClient.invalidateQueries({ queryKey: ['platform-overview'] });
    },
    onError: (err) => {
      setEditError(err instanceof ApiClientError ? err.message : 'Unable to update organization.');
    },
  });

  const suspendMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiRequest(`/tenants/${id}/suspend`, { method: 'POST', body: { reason } }),
    onSuccess: () => {
      setSuspendTarget(null);
      setSuspendReason('');
      toast({ kind: 'success', title: 'Organization suspended', description: 'Its users and devices are now blocked.' });
      void queryClient.invalidateQueries({ queryKey: ['tenants'] });
      void queryClient.invalidateQueries({ queryKey: ['platform-overview'] });
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Suspend failed',
        description: err instanceof ApiClientError ? err.message : 'Unable to suspend organization.',
      });
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/tenants/${id}/reactivate`, { method: 'POST' }),
    onSuccess: () => {
      setReactivateTarget(null);
      toast({ kind: 'success', title: 'Organization reactivated' });
      void queryClient.invalidateQueries({ queryKey: ['tenants'] });
      void queryClient.invalidateQueries({ queryKey: ['platform-overview'] });
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Reactivate failed',
        description: err instanceof ApiClientError ? err.message : 'Unable to reactivate organization.',
      });
    },
  });

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!/^[A-Z]{2,6}$/.test(form.code.trim().toUpperCase())) {
      setFormError('Tenant code must be 2 to 6 uppercase letters (e.g. BTL).');
      return;
    }
    if (form.adminPassword.length < 8 || !/[A-Za-z]/.test(form.adminPassword) || !/\d/.test(form.adminPassword)) {
      setFormError('Initial Client Admin password must be at least 8 characters with a letter and a digit.');
      return;
    }
    createMutation.mutate({
      ...form,
      code: form.code.trim().toUpperCase(),
    });
  };

  const columns: Column<TenantSummary>[] = [
    {
      key: 'name',
      header: 'Organization',
      sortKey: 'name',
      render: (t) => (
        <div>
          <Link
            to={`/tenants/${t.id}`}
            className="font-medium text-indigo-700 hover:text-indigo-800 hover:underline"
          >
            {t.name}
          </Link>
          <p className="text-xs text-slate-500">{t.contactEmail}</p>
        </div>
      ),
    },
    {
      key: 'code',
      header: 'Code',
      sortKey: 'code',
      render: (t) => <span className="font-mono text-xs font-semibold text-slate-800">{t.code}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      sortKey: 'status',
      render: (t) => <StatusChip status={t.status} />,
    },
    {
      key: 'users',
      header: 'Users',
      align: 'right',
      render: (t) => (
        <span className="font-mono text-xs tabular-nums text-slate-700">
          {t.activeUserCount} / {t.userCount}
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: 'Created',
      sortKey: 'createdAt',
      render: (t) => (
        <span className="font-mono text-xs tabular-nums text-slate-500">
          {formatLocalDateTime(t.createdAt)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (t) => (
        <div className="inline-flex items-center justify-end gap-1">
          <IconButton
            label={`Edit ${t.name}`}
            size="sm"
            onClick={() => {
              setEditTenant(t);
              setEditForm({ name: t.name, contactEmail: t.contactEmail });
              setEditError(null);
            }}
          >
            <Pencil className="w-4 h-4" />
          </IconButton>
          {t.status === 'ACTIVE' ? (
            <IconButton
              label={`Suspend ${t.name}`}
              size="sm"
              variant="danger"
              onClick={() => {
                setSuspendTarget(t);
                setSuspendReason('');
              }}
            >
              <PauseCircle className="w-4 h-4" />
            </IconButton>
          ) : (
            <IconButton
              label={`Reactivate ${t.name}`}
              size="sm"
              onClick={() => setReactivateTarget(t)}
            >
              <PlayCircle className="w-4 h-4 text-emerald-600" />
            </IconButton>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Client Organizations"
        description="Onboard client tenants, configure initial Client Admins, and manage organization access."
        actions={
          <Button icon={<Plus className="w-4 h-4" />} onClick={() => setCreateOpen(true)}>
            New tenant
          </Button>
        }
      />

      <Card className="p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            updateParams({ q: searchInput.trim() || null, page: '1' });
          }}
          className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end"
        >
          <div className="flex-1">
            <Input
              label="Search"
              placeholder="Search by name, code, or contact email..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <div className="w-full sm:w-44">
            <Select
              label="Status"
              value={status}
              onChange={(e) => updateParams({ status: e.target.value || null, page: '1' })}
              options={[
                { value: '', label: 'All statuses' },
                { value: 'ACTIVE', label: 'Active' },
                { value: 'SUSPENDED', label: 'Suspended' },
              ]}
            />
          </div>
          <Button type="submit" variant="secondary" icon={<Search className="w-4 h-4" />}>
            Filter
          </Button>
          {(q || status) && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setSearchInput('');
                updateParams({ q: null, status: null, page: '1' });
              }}
            >
              Clear
            </Button>
          )}
        </form>
      </Card>

      <DataTable
        columns={columns}
        rows={tenantsQuery.data?.items ?? []}
        rowKey={(t) => t.id}
        total={tenantsQuery.data?.total ?? 0}
        page={page}
        pageSize={25}
        onPageChange={(nextPage) => updateParams({ page: String(nextPage) })}
        sort={sort}
        onSortChange={(nextSort) => updateParams({ sort: nextSort, page: '1' })}
        isLoading={tenantsQuery.isLoading}
        error={
          tenantsQuery.isError
            ? tenantsQuery.error instanceof ApiClientError
              ? tenantsQuery.error.message
              : 'Failed to load organizations.'
            : null
        }
        onRetry={() => void tenantsQuery.refetch()}
        emptyTitle="No client organizations found"
        emptyDescription={
          q || status
            ? 'No client organizations match the active filters.'
            : 'Create your first client organization to onboard devices and users.'
        }
        emptyAction={
          q || status ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setSearchInput('');
                updateParams({ q: null, status: null, page: '1' });
              }}
            >
              Clear filters
            </Button>
          ) : (
            <Button icon={<Plus className="w-4 h-4" />} onClick={() => setCreateOpen(true)}>
              New tenant
            </Button>
          )
        }
      />

      {/* Create Tenant + Initial Client Admin Modal (UC-02) */}
      <Modal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          updateParams({ create: null });
        }}
        title="New client organization"
        description="Creates the tenant and provisions its initial Client Admin account."
        size="lg"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setCreateOpen(false);
                updateParams({ create: null });
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="create-tenant-form"
              loading={createMutation.isPending}
            >
              Create organization
            </Button>
          </>
        }
      >
        <form id="create-tenant-form" onSubmit={handleCreateSubmit} className="space-y-5">
          {formError && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
              {formError}
            </div>
          )}

          <div className="space-y-4">
            <h3 className="text-xs font-semibold text-slate-500">Organization details</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <Input
                  label="Organization name"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Bengal Textile Labs"
                />
              </div>
              <Input
                label="Code"
                required
                maxLength={6}
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="BTL"
                hint="2–6 uppercase letters"
              />
            </div>
            <Input
              label="Contact email"
              type="email"
              required
              value={form.contactEmail}
              onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
              placeholder="ops@company.com"
            />
          </div>

          <div className="pt-4 border-t border-slate-200 space-y-4">
            <h3 className="text-xs font-semibold text-slate-500">Initial Client Admin</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Admin full name"
                required
                value={form.adminName}
                onChange={(e) => setForm({ ...form, adminName: e.target.value })}
                placeholder="Farid Ahmed"
              />
              <Input
                label="Admin email"
                type="email"
                required
                value={form.adminEmail}
                onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
                placeholder="admin@company.com"
              />
            </div>
            <Input
              label="Temporary password"
              type="password"
              required
              value={form.adminPassword}
              onChange={(e) => setForm({ ...form, adminPassword: e.target.value })}
              hint="Minimum 8 characters with at least one letter and one digit."
            />
          </div>
        </form>
      </Modal>

      {/* Edit Tenant Modal */}
      <Modal
        open={Boolean(editTenant)}
        onClose={() => setEditTenant(null)}
        title={`Edit ${editTenant?.name ?? 'organization'}`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditTenant(null)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="edit-tenant-form"
              loading={editMutation.isPending}
            >
              Save changes
            </Button>
          </>
        }
      >
        <form
          id="edit-tenant-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!editTenant) return;
            editMutation.mutate({ id: editTenant.id, payload: editForm });
          }}
          className="space-y-4"
        >
          {editError && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
              {editError}
            </div>
          )}
          <Input
            label="Organization name"
            required
            value={editForm.name}
            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
          />
          <Input
            label="Contact email"
            type="email"
            required
            value={editForm.contactEmail}
            onChange={(e) => setEditForm({ ...editForm, contactEmail: e.target.value })}
          />
        </form>
      </Modal>

      {/* Suspend Confirm Dialog */}
      <ConfirmDialog
        open={Boolean(suspendTarget)}
        onClose={() => setSuspendTarget(null)}
        onConfirm={() => {
          if (suspendTarget) {
            suspendMutation.mutate({ id: suspendTarget.id, reason: suspendReason });
          }
        }}
        loading={suspendMutation.isPending}
        title={`Suspend ${suspendTarget?.name ?? ''}`}
        message="Suspending this organization immediately blocks all of its users from signing in or using active sessions, and rejects its devices at the Device API."
        confirmLabel="Suspend organization"
        extraField={
          <Input
            label="Reason (optional)"
            value={suspendReason}
            onChange={(e) => setSuspendReason(e.target.value)}
            placeholder="e.g., Maintenance hold or contract review"
          />
        }
      />

      {/* Reactivate Confirm Dialog */}
      <ConfirmDialog
        open={Boolean(reactivateTarget)}
        onClose={() => setReactivateTarget(null)}
        onConfirm={() => {
          if (reactivateTarget) reactivateMutation.mutate(reactivateTarget.id);
        }}
        loading={reactivateMutation.isPending}
        variant="primary"
        title={`Reactivate ${reactivateTarget?.name ?? ''}`}
        message="Users and devices belonging to this organization will regain access immediately."
        confirmLabel="Reactivate"
      />
    </div>
  );
}
