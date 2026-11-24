import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Pencil, Plus, Search, UserCheck, UserX } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import {
  ROLE_LABELS,
  type PaginatedResponse,
  type RoleCode,
  type UserPublic,
} from '../../shared/types.ts';
import { ApiClientError, apiRequest } from '../api/client.ts';
import { useAuth } from '../auth/AuthContext.tsx';
import {
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  IconButton,
  Input,
  Modal,
  PageHeader,
  RelativeTime,
  Select,
  StatusChip,
  useToast,
  type Column,
} from '../components/ui/index.ts';

const CLIENT_ROLE_OPTIONS = [
  { value: 'CLIENT_ADMIN', label: 'Client Admin' },
  { value: 'CLIENT_MANAGER', label: 'Client Manager' },
  { value: 'CLIENT_OPERATOR', label: 'Client Operator' },
];

export function UsersPage() {
  const { user: currentUser } = useAuth();
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
  const [toggleTarget, setToggleTarget] = useState<UserPublic | null>(null);

  const [createForm, setCreateForm] = useState({
    name: '',
    email: '',
    role: 'CLIENT_OPERATOR' as RoleCode,
    password: '',
  });
  const [createError, setCreateError] = useState<string | null>(null);

  const [editForm, setEditForm] = useState({ name: '', role: 'CLIENT_OPERATOR' as RoleCode });
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

  const usersQuery = useQuery({
    queryKey: ['tenant-users-page', { q, roleFilter, statusFilter, page, sort }],
    queryFn: () =>
      apiRequest<PaginatedResponse<UserPublic>>('/users', {
        query: { q, role: roleFilter, status: statusFilter, page, pageSize: 25, sort },
      }),
  });

  const createMutation = useMutation({
    mutationFn: () => apiRequest('/users', { method: 'POST', body: createForm }),
    onSuccess: () => {
      setCreateOpen(false);
      setCreateForm({ name: '', email: '', role: 'CLIENT_OPERATOR', password: '' });
      setCreateError(null);
      toast({ kind: 'success', title: 'User created' });
      void queryClient.invalidateQueries({ queryKey: ['tenant-users-page'] });
    },
    onError: (err) => {
      setCreateError(err instanceof ApiClientError ? err.message : 'Unable to create user.');
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: { name: string; role: RoleCode } }) =>
      apiRequest(`/users/${id}`, { method: 'PATCH', body: payload }),
    onSuccess: () => {
      setEditUser(null);
      toast({ kind: 'success', title: 'User updated' });
      void queryClient.invalidateQueries({ queryKey: ['tenant-users-page'] });
    },
    onError: (err) => {
      setEditError(err instanceof ApiClientError ? err.message : 'Unable to update user.');
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (u: UserPublic) =>
      apiRequest(`/users/${u.id}/${u.status === 'ACTIVE' ? 'deactivate' : 'reactivate'}`, {
        method: 'POST',
      }),
    onSuccess: (_d, u) => {
      setToggleTarget(null);
      toast({
        kind: 'success',
        title: u.status === 'ACTIVE' ? 'User deactivated' : 'User reactivated',
      });
      void queryClient.invalidateQueries({ queryKey: ['tenant-users-page'] });
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Action failed',
        description: err instanceof ApiClientError ? err.message : 'Unable to update user status.',
      });
    },
  });

  const resetMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/users/${id}/send-reset`, { method: 'POST' }),
    onSuccess: () => {
      toast({ kind: 'success', title: 'Password reset link queued', description: 'Visible in Email Outbox when SMTP is not configured.' });
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Reset failed',
        description: err instanceof ApiClientError ? err.message : 'Unable to queue reset email.',
      });
    },
  });

  const columns: Column<UserPublic>[] = [
    {
      key: 'name',
      header: 'User',
      sortKey: 'name',
      render: (u) => (
        <div>
          <p className="font-medium text-slate-900">
            {u.name}
            {u.id === currentUser?.id && (
              <span className="ml-1.5 text-xs text-slate-600">(You)</span>
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
            label={`Edit ${u.name}`}
            size="sm"
            onClick={() => {
              setEditUser(u);
              setEditForm({ name: u.name, role: u.role });
              setEditError(null);
            }}
          >
            <Pencil className="w-4 h-4" />
          </IconButton>
          <IconButton
            label={`Send password reset to ${u.name}`}
            size="sm"
            disabled={u.status !== 'ACTIVE'}
            onClick={() => resetMutation.mutate(u.id)}
          >
            <KeyRound className="w-4 h-4" />
          </IconButton>
          <IconButton
            label={u.status === 'ACTIVE' ? `Deactivate ${u.name}` : `Reactivate ${u.name}`}
            size="sm"
            variant={u.status === 'ACTIVE' ? 'danger' : 'ghost'}
            disabled={u.id === currentUser?.id}
            onClick={() => setToggleTarget(u)}
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organization Users"
        description={`Manage user accounts and roles within ${currentUser?.tenantName ?? 'your organization'}.`}
        actions={
          <Button icon={<Plus className="w-4 h-4" />} onClick={() => setCreateOpen(true)}>
            Add user
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
          <div className="w-full sm:w-44">
            <Select
              label="Role"
              value={roleFilter}
              onChange={(e) => updateParams({ role: e.target.value || null, page: '1' })}
              options={[{ value: '', label: 'All roles' }, ...CLIENT_ROLE_OPTIONS]}
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
          {(q || roleFilter || statusFilter) && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setSearchInput('');
                updateParams({ q: null, role: null, status: null, page: '1' });
              }}
            >
              Clear
            </Button>
          )}
        </form>
      </Card>

      <DataTable
        columns={columns}
        rows={usersQuery.data?.items ?? []}
        rowKey={(u) => u.id}
        total={usersQuery.data?.total ?? 0}
        page={page}
        pageSize={25}
        onPageChange={(nextPage) => updateParams({ page: String(nextPage) })}
        sort={sort}
        onSortChange={(nextSort) => updateParams({ sort: nextSort, page: '1' })}
        isLoading={usersQuery.isLoading}
        error={
          usersQuery.isError
            ? usersQuery.error instanceof ApiClientError
              ? usersQuery.error.message
              : 'Unable to load users.'
            : null
        }
        onRetry={() => void usersQuery.refetch()}
        emptyTitle="No users found"
        emptyDescription={
          q || roleFilter || statusFilter
            ? 'No users match the active filters.'
            : 'Add Client Managers or Operators to collaborate on your fleet.'
        }
        emptyAction={
          q || roleFilter || statusFilter ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setSearchInput('');
                updateParams({ q: null, role: null, status: null, page: '1' });
              }}
            >
              Clear filters
            </Button>
          ) : (
            <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => setCreateOpen(true)}>
              Add user
            </Button>
          )
        }
      />

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add organization user"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="create-client-user-form" loading={createMutation.isPending}>
              Create user
            </Button>
          </>
        }
      >
        <form
          id="create-client-user-form"
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
            onChange={(e) => setCreateForm({ ...createForm, role: e.target.value as RoleCode })}
            options={CLIENT_ROLE_OPTIONS}
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
            <Button type="submit" form="edit-client-user-form" loading={editMutation.isPending}>
              Save changes
            </Button>
          </>
        }
      >
        <form
          id="edit-client-user-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!editUser) return;
            editMutation.mutate({ id: editUser.id, payload: editForm });
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
          <Select
            label="Role"
            value={editForm.role}
            onChange={(e) => setEditForm({ ...editForm, role: e.target.value as RoleCode })}
            options={CLIENT_ROLE_OPTIONS}
          />
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(toggleTarget)}
        onClose={() => setToggleTarget(null)}
        onConfirm={() => {
          if (toggleTarget) toggleMutation.mutate(toggleTarget);
        }}
        loading={toggleMutation.isPending}
        variant={toggleTarget?.status === 'ACTIVE' ? 'danger' : 'primary'}
        title={
          toggleTarget?.status === 'ACTIVE'
            ? `Deactivate ${toggleTarget.name}`
            : `Reactivate ${toggleTarget?.name ?? ''}`
        }
        message={
          toggleTarget?.status === 'ACTIVE'
            ? 'This user will no longer be able to sign in until reactivated.'
            : 'This user will regain access to the organization.'
        }
        confirmLabel={toggleTarget?.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
      />
    </div>
  );
}
