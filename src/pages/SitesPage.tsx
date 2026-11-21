import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import type { PaginatedResponse, Site } from '../../shared/types.ts';
import { ApiClientError, apiRequest } from '../api/client.ts';
import { useAuth } from '../auth/AuthContext.tsx';
import {
  Button,
  ConfirmDialog,
  DataTable,
  IconButton,
  Input,
  Modal,
  PageHeader,
  RelativeTime,
  useToast,
  type Column,
} from '../components/ui/index.ts';

export function SitesPage() {
  const { user, activeTenantId } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const canWrite = user?.role === 'CLIENT_ADMIN' || user?.role === 'SUPPORT_ENGINEER';
  const q = searchParams.get('q') ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const sort = searchParams.get('sort') ?? 'name:asc';

  const [searchInput, setSearchInput] = useState(q);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSite, setEditingSite] = useState<Site | null>(null);
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [deletingSite, setDeletingSite] = useState<Site | null>(null);

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

  const sitesQuery = useQuery({
    queryKey: ['sites', activeTenantId, q, page, sort],
    queryFn: () =>
      apiRequest<PaginatedResponse<Site>>('/sites', {
        query: { q, page, pageSize: 25, sort },
      }),
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      if (editingSite) {
        return apiRequest<Site>(`/sites/${editingSite.id}`, {
          method: 'PATCH',
          body: { name: name.trim(), location: location.trim() },
        });
      }
      return apiRequest<Site>('/sites', {
        method: 'POST',
        body: { name: name.trim(), location: location.trim() },
      });
    },
    onSuccess: (saved) => {
      toast({
        kind: 'success',
        title: editingSite ? `Updated site "${saved.name}"` : `Created site "${saved.name}"`,
      });
      setModalOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['sites'] });
    },
    onError: (err) => {
      if (err instanceof ApiClientError) {
        const details = err.details as { field?: string } | undefined;
        if (details?.field) {
          setFieldErrors({ [details.field]: err.message });
        }
        toast({ kind: 'error', title: 'Could not save site', description: err.message });
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (siteId: string) =>
      apiRequest<{ ok: boolean }>(`/sites/${siteId}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast({ kind: 'success', title: `Deleted site "${deletingSite?.name ?? ''}"` });
      setDeletingSite(null);
      void queryClient.invalidateQueries({ queryKey: ['sites'] });
    },
    onError: (err) => {
      const msg = err instanceof ApiClientError ? err.message : 'Unable to delete site';
      toast({ kind: 'error', title: 'Delete blocked', description: msg });
      setDeletingSite(null);
    },
  });

  const openCreate = () => {
    setEditingSite(null);
    setName('');
    setLocation('');
    setFieldErrors({});
    setModalOpen(true);
  };

  const openEdit = (site: Site) => {
    setEditingSite(site);
    setName(site.name);
    setLocation(site.location);
    setFieldErrors({});
    setModalOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (name.trim().length < 2) errs.name = 'Site name must be at least 2 characters';
    if (location.trim().length < 2) errs.location = 'Location must be at least 2 characters';
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;
    saveMutation.mutate();
  };

  const columns: Column<Site>[] = [
    {
      key: 'name',
      header: 'Site Name',
      sortKey: 'name',
      render: (s) => (
        <div className="flex items-center gap-2.5">
          <MapPin className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
          <span className="font-medium text-slate-900">{s.name}</span>
        </div>
      ),
    },
    {
      key: 'location',
      header: 'Location',
      sortKey: 'location',
      render: (s) => <span className="text-slate-600">{s.location}</span>,
    },
    {
      key: 'deviceCount',
      header: 'Assigned Devices',
      sortKey: 'deviceCount',
      align: 'right',
      render: (s) => (
        <Link
          to={`/devices?siteId=${encodeURIComponent(s.id)}`}
          className="font-mono tabular-nums text-indigo-600 hover:text-indigo-700 font-medium"
        >
          {s.deviceCount}
        </Link>
      ),
    },
    {
      key: 'createdAt',
      header: 'Created',
      sortKey: 'createdAt',
      hideOnMobile: true,
      render: (s) => <RelativeTime iso={s.createdAt} />,
    },
  ];

  if (canWrite) {
    columns.push({
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (s) => (
        <div className="inline-flex items-center justify-end gap-1">
          <IconButton
            label={`Edit site ${s.name}`}
            size="sm"
            onClick={() => openEdit(s)}
          >
            <Pencil className="w-4 h-4" />
          </IconButton>
          <IconButton
            label={`Delete site ${s.name}`}
            size="sm"
            onClick={() => setDeletingSite(s)}
          >
            <Trash2 className="w-4 h-4 text-red-600" />
          </IconButton>
        </div>
      ),
    });
  }

  return (
    <div>
      <PageHeader
        title="Sites"
        description="Manage plants, production lines, and physical locations where devices are deployed."
        actions={
          canWrite ? (
            <Button onClick={openCreate} icon={<Plus className="w-4 h-4" />}>
              Add Site
            </Button>
          ) : undefined
        }
      />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          updateParams({ q: searchInput.trim() || null, page: '1' });
        }}
        className="mb-4 flex items-center gap-2 max-w-md"
      >
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            aria-label="Search sites"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by site name or location..."
            className="w-full h-9 pl-9 pr-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
          />
        </div>
        <Button type="submit" variant="secondary" size="sm">
          Search
        </Button>
      </form>

      <DataTable
        columns={columns}
        rows={sitesQuery.data?.items ?? []}
        rowKey={(s) => s.id}
        total={sitesQuery.data?.total ?? 0}
        page={page}
        pageSize={25}
        onPageChange={(p) => updateParams({ page: String(p) })}
        sort={sort}
        onSortChange={(nextSort) => updateParams({ sort: nextSort, page: '1' })}
        isLoading={sitesQuery.isLoading}
        error={sitesQuery.error instanceof Error ? sitesQuery.error.message : null}
        onRetry={() => void sitesQuery.refetch()}
        emptyTitle="No sites configured"
        emptyDescription="Add a plant or facility location to begin assigning devices."
        emptyAction={
          canWrite ? (
            <Button onClick={openCreate} icon={<Plus className="w-4 h-4" />}>
              Add Site
            </Button>
          ) : undefined
        }
      />

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingSite ? 'Edit Site' : 'Add Site'}
        description="Site names must be unique within the organization."
        size="sm"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setModalOpen(false)}
              disabled={saveMutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" form="site-form" loading={saveMutation.isPending}>
              {editingSite ? 'Save Changes' : 'Create Site'}
            </Button>
          </>
        }
      >
        <form id="site-form" onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Site Name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Dyeing Plant"
            error={fieldErrors.name}
          />
          <Input
            label="Location"
            required
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. Chattogram Industrial Zone, Block A"
            error={fieldErrors.location}
          />
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deletingSite)}
        onClose={() => setDeletingSite(null)}
        onConfirm={() => {
          if (deletingSite) deleteMutation.mutate(deletingSite.id);
        }}
        title="Delete Site"
        message={
          deletingSite && deletingSite.deviceCount > 0
            ? `"${deletingSite.name}" currently has ${deletingSite.deviceCount} assigned device(s). Deleting a site with assigned devices will be blocked until those devices are moved.`
            : `Are you sure you want to permanently delete "${deletingSite?.name ?? ''}"?`
        }
        confirmLabel="Delete Site"
        variant="danger"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
