import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, KeyRound, Pencil, Plus, Search, UserCheck, UserX } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import {
  ROLE_LABELS,
  type PaginatedResponse,
  type RoleCode,
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
  IconButton,
  Input,
  Modal,
  MultiSelect,
  PageHeader,
  RelativeTime,
  Select,
  StatusChip,
  useToast,
  type Column,
} from '../components/ui/index.ts';

export function StaffPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const q = searchParams.get('q') ?? '';
  const roleFilter = searchParams.get('role') ?? '';
  const statusFilter = searchParams.get('status') ?? '';
  const page = Number(searchParams.get('page') ?? '1') || 1;
  const sort = searchParams.get('sort') ?? 'name:asc';

  const [searchInput, setSearchInput] = useState(q);
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserPublic | null>(null);
  const [assignUser, setAssignUser] = useState<UserPublic | null>(null);
  const [assignTenantIds, setAssignTenantIds] = useState<string[]>([]);
  const [toggleStatusTarget, setToggleStatusTarget] = useState<UserPublic | null>(null);

  const [createForm, setCreateForm] = useState({
    name: '',
    email: '',
    role: 'SUPPORT_ENGINEER' as RoleCode,
    isSupervisor: false,
    assignedTenantIds: [] as string[],
    password: '',
  });
  const [createError, setCreateError] = useState<string | null>(null);

  const [editForm, setEditForm] = useState({ name: '', isSupervisor: false });
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
    queryKey: ['all-tenants-for-assignment'],
    queryFn: () =>
      apiRequest<PaginatedResponse<TenantSummary>>('/tenants', {
        query: { page: 1, pageSize: 200, sort: 'name:asc' },
      }),
  });

  const staffQuery = useQuery({
    queryKey: ['provider-staff', { q, roleFilter, statusFilter, page, sort }],
    queryFn: () =>
      apiRequest<PaginatedResponse<UserPublic>>('/users', {
        query: {
          staffOnly: 'true',
          q,
          role: roleFilter,
          status: statusFilter,
          page,
          pageSize: 25,
          sort,
        },
      }),
  });

  const allTenants = tenantsQuery.data?.items ?? [];
  const tenantCodeMap = new Map(allTenants.map((t) => [t.id, t.code]));

  const createMutation = useMutation({
    mutationFn: () => apiRequest('/users', { method: 'POST', body: createForm }),
    onSuccess: () => {
      setCreateOpen(false);
      setCreateForm({
        name: '',
        email: '',
        role: 'SUPPORT_ENGINEER',
        isSupervisor: false,
        assignedTenantIds: [],
        password: '',
      });
      setCreateError(null);
      toast({ kind: 'success', title: 'Staff account created' });
      void queryClient.invalidateQueries({ queryKey: ['provider-staff'] });
    },
    onError: (err) => {
      setCreateError(err instanceof ApiClientError ? err.message : 'Unable to create staff account.');
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: { name: string; isSupervisor?: boolean } }) =>
      apiRequest(`/users/${id}`, { method: 'PATCH', body: payload }),
    onSuccess: () => {
      setEditUser(null);
      toast({ kind: 'success', title: 'Staff profile updated' });
      void queryClient.invalidateQueries({ queryKey: ['provider-staff'] });
    },
    onError: (err) => {
      setEditError(err instanceof ApiClientError ? err.message : 'Unable to update staff account.');
    },
  });

  const assignMutation = useMutation({
    mutationFn: ({ id, assignedTenantIds }: { id: string; assignedTenantIds: string[] }) =>
      apiRequest(`/users/${id}/tenants`, { method: 'PUT', body: { assignedTenantIds } }),
    onSuccess: () => {
      setAssignUser(null);
      toast({ kind: 'success', title: 'Tenant assignments updated' });
      void queryClient.invalidateQueries({ queryKey: ['provider-staff'] });
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Assignment failed',
        description: err instanceof ApiClientError ? err.message : 'Unable to update tenant assignments.',
      });
    },
  });

  const toggleStatusMutation = useMutation({
    mutationFn: (u: UserPublic) =>
      apiRequest(`/users/${u.id}/${u.status === 'ACTIVE' ? 'deactivate' : 'reactivate'}`, {
        method: 'POST',
      }),
    onSuccess: (_data, u) => {
      setToggleStatusTarget(null);
      toast({
        kind: 'success',
        title: u.status === 'ACTIVE' ? 'Account deactivated' : 'Account reactivated',
      });
      void queryClient.invalidateQueries({ queryKey: ['provider-staff'] });
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Action failed',
        description: err instanceof ApiClientError ? err.message : 'Unable to update account status.',
      });
    },
  });

  const sendResetMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/users/${id}/send-reset`, { method: 'POST' }),
    onSuccess: () => {
      toast({ kind: 'success', title: 'Password reset link queued', description: 'Check Email Outbox if SMTP is not configured.' });
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Reset failed',
        description: err instanceof ApiClientError ? err.message : 'Unable to send reset email.',
      });
    },
  });

  const columns: Column<UserPublic>[] = [
    {
      key: 'name',
      header: 'Staff Member',
      sortKey: 'name',
      render: (u) => (
        <div>
          <p className="font-medium text-slate-900">
            {u.name}
            {u.isSupervisor && (
              <span className="ml-2 text-xs font-medium text-indigo-600">· Supervisor</span>
            )}
          </p>
          <p className="text-xs font-mono text-slate-500">{u.email}</p>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      sortKey: 'role',
      render: (u) => <span>{ROLE_LABELS[u.role]}</span>,
    },
    {
      key: 'assigned',
      header: 'Assigned Tenants',
      render: (u) => (
        <span className="font-mono text-xs text-slate-700">
          {u.assignedTenantIds.length === 0
            ? 'None'
            : u.assignedTenantIds.map((tid) => tenantCodeMap.get(tid) ?? tid).join(', ')}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortKey: 'status',
      render: (u) => <StatusChip status={u.status} />,
    },
    {
      key: 'lastLogin',
      header: 'Last Sign-In',
      sortKey: 'lastLoginAt',
      render: (u) => <RelativeTime iso={u.lastLoginAt} />,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (u) => (
        <div className="inline-flex items-center justify-end gap-1">
          <IconButton
            label={`Assign tenants for ${u.name}`}
            size="sm"
            onClick={() => {
              setAssignUser(u);
              setAssignTenantIds(u.assignedTenantIds);
            }}
          >
            <Building2 className="w-4 h-4" />
          </IconButton>
          <IconButton
            label={`Edit ${u.name}`}
            size="sm"
            onClick={() => {
              setEditUser(u);
              setEditForm({ name: u.name, isSupervisor: u.isSupervisor });
              setEditError(null);
            }}
          >
            <Pencil className="w-4 h-4" />
          </IconButton>
          <IconButton
            label={`Send password reset to ${u.name}`}
            size="sm"
            disabled={u.status !== 'ACTIVE'}
            onClick={() => sendResetMutation.mutate(u.id)}
          >
            <KeyRound className="w-4 h-4" />
          </IconButton>
          <IconButton
            label={u.status === 'ACTIVE' ? `Deactivate ${u.name}` : `Reactivate ${u.name}`}
            size="sm"
            variant={u.status === 'ACTIVE' ? 'danger' : 'ghost'}
            onClick={() => setToggleStatusTarget(u)}
          >
            {u.status === 'ACTIVE' ? (
              <UserX className="w-4 h-4" />
            ) : (
              <UserCheck className="w-4 h-4 text-emerald-600" />
            )}
          </IconButton>
        </div>
      ),
    },
  ];

  const tenantOptions = allTenants.map((t) => ({
    value: t.id,
    label: t.name,
    meta: t.code,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Provider Staff"
        description="Manage Support/NOC Engineers and Field Technicians and assign client organizations."
        actions={
          <Button icon={<Plus className="w-4 h-4" />} onClick={() => setCreateOpen(true)}>
            Add staff member
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
              placeholder="Search by name or email..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <div className="w-full sm:w-48">
            <Select
              label="Role"
              value={roleFilter}
              onChange={(e) => updateParams({ role: e.target.value || null, page: '1' })}
              options={[
                { value: '', label: 'All staff roles' },
                { value: 'SUPPORT_ENGINEER', label: 'Support / NOC Engineer' },
                { value: 'FIELD_TECHNICIAN', label: 'Field Technician' },
              ]}
            />
          </div>
          <div className="w-full sm:w-36">
            <Select
              label="Status"
              value={statusFilter}
              onChange={(e) => updateParams({ status: e.target.value || null, page: '1' })}
              options={[
                { value: '', label: 'All statuses' },
                { value: 'ACTIVE', label: 'Active' },
                { value: 'INACTIVE', label: 'Inactive' },
              ]}
            />
          </div>
          <Button type="submit" variant="secondary" icon={<Search className="w-4 h-4" />}>
            Filter
          </Button>
        </form>
      </Card>

      <DataTable
        columns={columns}
        rows={staffQuery.data?.items ?? []}
        rowKey={(u) => u.id}
        total={staffQuery.data?.total ?? 0}
        page={page}
        pageSize={25}
        onPageChange={(nextPage) => updateParams({ page: String(nextPage) })}
        sort={sort}
        onSortChange={(nextSort) => updateParams({ sort: nextSort, page: '1' })}
        isLoading={staffQuery.isLoading}
        error={
          staffQuery.isError
            ? staffQuery.error instanceof ApiClientError
              ? staffQuery.error.message
              : 'Unable to load provider staff.'
            : null
        }
        onRetry={() => void staffQuery.refetch()}
        emptyTitle="No provider staff found"
        emptyDescription="Add Support Engineers or Field Technicians and assign them to client organizations."
      />

      {/* Create Staff Modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add provider staff member"
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="create-staff-form" loading={createMutation.isPending}>
              Create account
            </Button>
          </>
        }
      >
        <form
          id="create-staff-form"
          onSubmit={(e) => {
            e.preventDefault();
            setCreateError(null);
            createMutation.mutate();
          }}
          className="space-y-4"
        >
          {createError && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
              {createError}
            </div>
          )}
          <Input
            label="Full name"
            required
            value={createForm.name}
            onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
          />
          <Input
            label="Email"
            type="email"
            required
            value={createForm.email}
            onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
          />
          <Select
            label="Role"
            value={createForm.role}
            onChange={(e) =>
              setCreateForm({
                ...createForm,
                role: e.target.value as RoleCode,
                isSupervisor: e.target.value === 'SUPPORT_ENGINEER' ? createForm.isSupervisor : false,
              })
            }
            options={[
              { value: 'SUPPORT_ENGINEER', label: 'Support / NOC Engineer' },
              { value: 'FIELD_TECHNICIAN', label: 'Field Technician' },
            ]}
          />
          {createForm.role === 'SUPPORT_ENGINEER' && (
            <Checkbox
              label="NOC Supervisor"
              description="Receives Level-2 escalations for unacknowledged critical alerts."
              checked={createForm.isSupervisor}
              onChange={(e) => setCreateForm({ ...createForm, isSupervisor: e.target.checked })}
            />
          )}
          <MultiSelect
            label="Assigned organizations"
            options={tenantOptions}
            value={createForm.assignedTenantIds}
            onChange={(ids) => setCreateForm({ ...createForm, assignedTenantIds: ids })}
            hint="Staff members can only access data within assigned tenants."
          />
          <Input
            label="Temporary password"
            type="password"
            required
            value={createForm.password}
            onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
            hint="Minimum 8 characters with a letter and a digit."
          />
        </form>
      </Modal>

      {/* Edit Staff Modal */}
      <Modal
        open={Boolean(editUser)}
        onClose={() => setEditUser(null)}
        title={`Edit ${editUser?.name ?? ''}`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditUser(null)}>
              Cancel
            </Button>
            <Button type="submit" form="edit-staff-form" loading={editMutation.isPending}>
              Save changes
            </Button>
          </>
        }
      >
        <form
          id="edit-staff-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!editUser) return;
            editMutation.mutate({
              id: editUser.id,
              payload: {
                name: editForm.name,
                ...(editUser.role === 'SUPPORT_ENGINEER'
                  ? { isSupervisor: editForm.isSupervisor }
                  : {}),
              },
            });
          }}
          className="space-y-4"
        >
          {editError && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
              {editError}
            </div>
          )}
          <Input
            label="Full name"
            required
            value={editForm.name}
            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
          />
          {editUser?.role === 'SUPPORT_ENGINEER' && (
            <Checkbox
              label="NOC Supervisor"
              checked={editForm.isSupervisor}
              onChange={(e) => setEditForm({ ...editForm, isSupervisor: e.target.checked })}
            />
          )}
        </form>
      </Modal>

      {/* Assign Tenants Modal */}
      <Modal
        open={Boolean(assignUser)}
        onClose={() => setAssignUser(null)}
        title={`Assign tenants — ${assignUser?.name ?? ''}`}
        description="Select which client organizations this staff member can access."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAssignUser(null)}>
              Cancel
            </Button>
            <Button
              loading={assignMutation.isPending}
              onClick={() => {
                if (assignUser) {
                  assignMutation.mutate({ id: assignUser.id, assignedTenantIds: assignTenantIds });
                }
              }}
            >
              Save assignments
            </Button>
          </>
        }
      >
        <MultiSelect
          label="Client organizations"
          options={tenantOptions}
          value={assignTenantIds}
          onChange={setAssignTenantIds}
        />
      </Modal>

      <ConfirmDialog
        open={Boolean(toggleStatusTarget)}
        onClose={() => setToggleStatusTarget(null)}
        onConfirm={() => {
          if (toggleStatusTarget) toggleStatusMutation.mutate(toggleStatusTarget);
        }}
        loading={toggleStatusMutation.isPending}
        variant={toggleStatusTarget?.status === 'ACTIVE' ? 'danger' : 'primary'}
        title={
          toggleStatusTarget?.status === 'ACTIVE'
            ? `Deactivate ${toggleStatusTarget.name}`
            : `Reactivate ${toggleStatusTarget?.name ?? ''}`
        }
        message={
          toggleStatusTarget?.status === 'ACTIVE'
            ? 'Deactivated accounts cannot sign in or access the API.'
            : 'Reactivating restores sign-in access for this account.'
        }
        confirmLabel={toggleStatusTarget?.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
      />
    </div>
  );
}
