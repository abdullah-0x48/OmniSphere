import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PauseCircle, Plus, Search, Tag, Upload, X } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ALL_DEVICE_STATES,
  type BulkDeviceActionResult,
  type DeviceModel,
  type DeviceProvisioningPayload,
  type DevicePublic,
  type PaginatedResponse,
  type Site,
} from '../../shared/types.ts';
import { ApiClientError, apiRequest } from '../api/client.ts';
import { useAuth } from '../auth/AuthContext.tsx';
import { CsvImportModal } from '../components/devices/CsvImportModal.tsx';
import { ProvisioningModal } from '../components/devices/ProvisioningModal.tsx';
import { RegisterDeviceModal } from '../components/devices/RegisterDeviceModal.tsx';
import {
  Button,
  DataTable,
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

export function DevicesPage() {
  const { user, activeTenantId } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const canWrite = user?.role === 'CLIENT_ADMIN' || user?.role === 'SUPPORT_ENGINEER';

  const q = searchParams.get('q') ?? '';
  const siteId = searchParams.get('siteId') ?? '';
  const modelId = searchParams.get('modelId') ?? '';
  const state = searchParams.get('state') ?? '';
  const connectivity = searchParams.get('connectivity') ?? '';
  const tag = searchParams.get('tag') ?? '';
  const firmwareVersion = searchParams.get('firmwareVersion') ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const sort = searchParams.get('sort') ?? 'name:asc';

  const [searchInput, setSearchInput] = useState(q);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [provisioningModal, setProvisioningModal] = useState<{
    payload: DeviceProvisioningPayload;
    deviceName: string;
  } | null>(null);

  const [bulkTagOpen, setBulkTagOpen] = useState(false);
  const [bulkTagValue, setBulkTagValue] = useState('');
  const [bulkSuspendOpen, setBulkSuspendOpen] = useState(false);
  const [bulkSuspendReason, setBulkSuspendReason] = useState('');

  useEffect(() => {
    setSearchInput(q);
  }, [q]);

  // Clear selection when tenant or filters change
  useEffect(() => {
    setSelectedIds([]);
  }, [activeTenantId, page, q, siteId, modelId, state, connectivity, tag, firmwareVersion]);

  const updateParams = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(updates)) {
      if (!v) next.delete(k);
      else next.set(k, v);
    }
    setSearchParams(next, { replace: true });
  };

  const hasActiveFilters = Boolean(
    q || siteId || modelId || state || connectivity || tag || firmwareVersion,
  );

  const devicesQuery = useQuery({
    queryKey: [
      'devices',
      activeTenantId,
      q,
      siteId,
      modelId,
      state,
      connectivity,
      tag,
      firmwareVersion,
      page,
      sort,
    ],
    queryFn: () =>
      apiRequest<PaginatedResponse<DevicePublic>>('/devices', {
        query: {
          q,
          siteId,
          modelId,
          state,
          connectivity,
          tag,
          firmwareVersion,
          page,
          pageSize: 25,
          sort,
        },
      }),
  });

  const sitesQuery = useQuery({
    queryKey: ['sites-options', activeTenantId],
    queryFn: () =>
      apiRequest<PaginatedResponse<Site>>('/sites', { query: { page: 1, pageSize: 200 } }),
  });

  const modelsQuery = useQuery({
    queryKey: ['device-models-options'],
    queryFn: () =>
      apiRequest<PaginatedResponse<DeviceModel>>('/device-models', {
        query: { page: 1, pageSize: 200 },
      }),
  });

  const tagsQuery = useQuery({
    queryKey: ['device-tags', activeTenantId],
    queryFn: () => apiRequest<{ items: string[] }>('/devices/tags'),
  });

  const bulkMutation = useMutation({
    mutationFn: (body: {
      deviceIds: string[];
      action: 'ADD_TAG' | 'SUSPEND';
      tag?: string;
      reason?: string;
    }) => apiRequest<BulkDeviceActionResult>('/devices/bulk', { method: 'POST', body }),
    onSuccess: (res, vars) => {
      toast({
        kind: res.failedCount > 0 ? 'info' : 'success',
        title:
          vars.action === 'ADD_TAG'
            ? `Added tag to ${res.succeededCount} device(s)`
            : `Suspended ${res.succeededCount} device(s)`,
        description:
          res.failedCount > 0
            ? `${res.failedCount} device(s) could not be updated in their current state.`
            : undefined,
      });
      setSelectedIds([]);
      setBulkTagOpen(false);
      setBulkTagValue('');
      setBulkSuspendOpen(false);
      setBulkSuspendReason('');
      void queryClient.invalidateQueries({ queryKey: ['devices'] });
      void queryClient.invalidateQueries({ queryKey: ['device-tags'] });
    },
    onError: (err) => {
      const msg = err instanceof ApiClientError ? err.message : 'Bulk action failed';
      toast({ kind: 'error', title: 'Bulk action failed', description: msg });
    },
  });

  const rows = devicesQuery.data?.items ?? [];
  const allVisibleSelected = rows.length > 0 && rows.every((r) => selectedIds.includes(r.id));

  const toggleRow = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(rows.map((r) => r.id));
    }
  };

  const columns: Column<DevicePublic>[] = [];

  if (canWrite) {
    columns.push({
      key: 'select',
      header: 'Select',
      hideOnMobile: true,
      render: (d) => (
        <input
          type="checkbox"
          aria-label={`Select ${d.name}`}
          checked={selectedIds.includes(d.id)}
          onClick={(e) => e.stopPropagation()}
          onChange={() => toggleRow(d.id)}
          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
        />
      ),
    });
  }

  columns.push(
    {
      key: 'name',
      header: 'Device / Serial',
      sortKey: 'name',
      render: (d) => (
        <div>
          <p className="font-medium text-slate-900">{d.name}</p>
          <p className="text-xs font-mono text-slate-500">{d.serialNumber}</p>
        </div>
      ),
    },
    {
      key: 'model',
      header: 'Model',
      sortKey: 'modelName',
      render: (d) => <span className="text-slate-700 text-xs">{d.modelName ?? d.modelId}</span>,
    },
    {
      key: 'site',
      header: 'Site',
      sortKey: 'siteName',
      render: (d) => <span className="text-slate-700 text-xs">{d.siteName ?? d.siteId}</span>,
    },
    {
      key: 'tags',
      header: 'Tags',
      hideOnMobile: true,
      render: (d) =>
        d.tags.length === 0 ? (
          <span className="text-xs text-slate-400">—</span>
        ) : (
          <div className="flex items-center gap-1 flex-wrap">
            {d.tags.slice(0, 2).map((t) => (
              <span
                key={t}
                className="inline-flex items-center px-1.5 py-0.5 text-[11px] font-mono bg-slate-100 text-slate-700 rounded border border-slate-200"
              >
                {t}
              </span>
            ))}
            {d.tags.length > 2 && (
              <span className="text-[11px] font-mono text-slate-500">+{d.tags.length - 2}</span>
            )}
          </div>
        ),
    },
    {
      key: 'state',
      header: 'Lifecycle',
      sortKey: 'state',
      render: (d) => <StatusChip status={d.state} />,
    },
    {
      key: 'connectivity',
      header: 'Connectivity',
      sortKey: 'connectivity',
      render: (d) => (
        <span className="inline-flex items-center gap-1.5">
          <span
            className={`w-2 h-2 rounded-full ${
              d.connectivity === 'ONLINE'
                ? 'bg-emerald-500'
                : d.connectivity === 'OFFLINE'
                  ? 'bg-red-500'
                  : 'bg-slate-400'
            }`}
            aria-hidden="true"
          />
          <StatusChip status={d.connectivity} />
        </span>
      ),
    },
    {
      key: 'firmwareVersion',
      header: 'Firmware',
      sortKey: 'firmwareVersion',
      hideOnMobile: true,
      render: (d) => (
        <span className="font-mono text-xs text-slate-700">{d.firmwareVersion ?? '—'}</span>
      ),
    },
    {
      key: 'lastSeenAt',
      header: 'Last Seen',
      sortKey: 'lastSeenAt',
      hideOnMobile: true,
      render: (d) => <RelativeTime iso={d.lastSeenAt} />,
    },
  );

  return (
    <div>
      <PageHeader
        title="Device Inventory"
        description="Search, filter, register, and manage industrial IoT devices across sites."
        actions={
          canWrite ? (
            <>
              <Button
                variant="secondary"
                onClick={() => setImportOpen(true)}
                icon={<Upload className="w-4 h-4" />}
              >
                Import CSV
              </Button>
              <Button
                onClick={() => setRegisterOpen(true)}
                icon={<Plus className="w-4 h-4" />}
              >
                Register Device
              </Button>
            </>
          ) : undefined
        }
      />

      {/* Filters Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4 space-y-3">
        <div className="flex flex-col lg:flex-row gap-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              updateParams({ q: searchInput.trim() || null, page: '1' });
            }}
            className="flex items-center gap-2 flex-1"
          >
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                aria-label="Search devices"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search by name, serial number, hardware ID, or device ID..."
                className="w-full h-9 pl-9 pr-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
              />
            </div>
            <Button type="submit" variant="secondary" size="sm">
              Search
            </Button>
          </form>

          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSearchParams(new URLSearchParams(), { replace: true })}
              icon={<X className="w-3.5 h-3.5" />}
            >
              Clear filters
            </Button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 items-center">
          <Select
            aria-label="Filter by site"
            value={siteId}
            onChange={(e) => updateParams({ siteId: e.target.value || null, page: '1' })}
            className="h-9 py-1.5"
          >
            <option value="">All Sites</option>
            {(sitesQuery.data?.items ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>

          <Select
            aria-label="Filter by device model"
            value={modelId}
            onChange={(e) => updateParams({ modelId: e.target.value || null, page: '1' })}
            className="h-9 py-1.5"
          >
            <option value="">All Models</option>
            {(modelsQuery.data?.items ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>

          <Select
            aria-label="Filter by lifecycle state"
            value={state}
            onChange={(e) => updateParams({ state: e.target.value || null, page: '1' })}
            className="h-9 py-1.5"
          >
            <option value="">All States</option>
            {ALL_DEVICE_STATES.map((st) => (
              <option key={st} value={st}>
                {st.replaceAll('_', ' ')}
              </option>
            ))}
          </Select>

          <Select
            aria-label="Filter by connectivity"
            value={connectivity}
            onChange={(e) => updateParams({ connectivity: e.target.value || null, page: '1' })}
            className="h-9 py-1.5"
          >
            <option value="">All Connectivity</option>
            <option value="ONLINE">Online</option>
            <option value="OFFLINE">Offline</option>
            <option value="UNKNOWN">Unknown</option>
          </Select>

          <Select
            aria-label="Filter by tag"
            value={tag}
            onChange={(e) => updateParams({ tag: e.target.value || null, page: '1' })}
            className="h-9 py-1.5"
          >
            <option value="">All Tags</option>
            {(tagsQuery.data?.items ?? []).map((t) => (
              <option key={t} value={t}>
                #{t}
              </option>
            ))}
          </Select>

          <Input
            aria-label="Filter by firmware version"
            value={firmwareVersion}
            onChange={(e) => updateParams({ firmwareVersion: e.target.value || null, page: '1' })}
            placeholder="Firmware (e.g. 1.0.0)"
            className="h-9 py-1.5"
          />
        </div>
      </div>

      {/* Contextual Bulk Action Bar (CA & SE) */}
      {canWrite && selectedIds.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-indigo-900 font-mono tabular-nums">
              {selectedIds.length} selected
            </span>
            <button
              type="button"
              onClick={toggleAllVisible}
              className="text-xs font-medium text-indigo-700 hover:underline cursor-pointer"
            >
              {allVisibleSelected ? 'Deselect page' : `Select all ${rows.length} on page`}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setBulkTagOpen(true)}
              icon={<Tag className="w-3.5 h-3.5" />}
            >
              Add Tag
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setBulkSuspendOpen(true)}
              icon={<PauseCircle className="w-3.5 h-3.5" />}
            >
              Suspend
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelectedIds([])}>
              Clear
            </Button>
          </div>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(d) => d.id}
        total={devicesQuery.data?.total ?? 0}
        page={page}
        pageSize={25}
        onPageChange={(p) => updateParams({ page: String(p) })}
        sort={sort}
        onSortChange={(nextSort) => updateParams({ sort: nextSort, page: '1' })}
        isLoading={devicesQuery.isLoading}
        error={devicesQuery.error instanceof Error ? devicesQuery.error.message : null}
        onRetry={() => void devicesQuery.refetch()}
        onRowClick={(d) => navigate(`/devices/${d.id}`)}
        emptyTitle="No devices match your filters"
        emptyDescription="Adjust your search filters or register a new device to populate the inventory."
        emptyAction={
          canWrite ? (
            <Button onClick={() => setRegisterOpen(true)} icon={<Plus className="w-4 h-4" />}>
              Register Device
            </Button>
          ) : undefined
        }
      />

      {/* Modals */}
      <RegisterDeviceModal
        open={registerOpen}
        onClose={() => setRegisterOpen(false)}
        sites={sitesQuery.data?.items ?? []}
        models={modelsQuery.data?.items ?? []}
        onRegistered={(res) => {
          void queryClient.invalidateQueries({ queryKey: ['devices'] });
          void queryClient.invalidateQueries({ queryKey: ['device-tags'] });
          void queryClient.invalidateQueries({ queryKey: ['sites'] });
          setProvisioningModal({ payload: res.provisioning, deviceName: res.device.name });
        }}
      />

      <CsvImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        sites={sitesQuery.data?.items ?? []}
        onImported={() => {
          void queryClient.invalidateQueries({ queryKey: ['devices'] });
          void queryClient.invalidateQueries({ queryKey: ['device-tags'] });
          void queryClient.invalidateQueries({ queryKey: ['sites'] });
        }}
      />

      <ProvisioningModal
        provisioning={provisioningModal?.payload ?? null}
        deviceName={provisioningModal?.deviceName}
        onClose={() => setProvisioningModal(null)}
      />

      {/* Bulk Add Tag Modal */}
      <Modal
        open={bulkTagOpen}
        onClose={() => setBulkTagOpen(false)}
        title={`Add Tag to ${selectedIds.length} Device(s)`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setBulkTagOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={bulkMutation.isPending}
              disabled={!bulkTagValue.trim()}
              onClick={() =>
                bulkMutation.mutate({
                  deviceIds: selectedIds,
                  action: 'ADD_TAG',
                  tag: bulkTagValue.trim(),
                })
              }
            >
              Apply Tag
            </Button>
          </>
        }
      >
        <Input
          label="Tag Name"
          required
          value={bulkTagValue}
          onChange={(e) => setBulkTagValue(e.target.value)}
          placeholder="e.g. phase-2"
          hint="Lowercase alphanumeric tag appended to each non-decommissioned device."
        />
      </Modal>

      {/* Bulk Suspend Modal */}
      <Modal
        open={bulkSuspendOpen}
        onClose={() => setBulkSuspendOpen(false)}
        title={`Suspend ${selectedIds.length} Device(s)`}
        description="Only ACTIVE devices will transition to SUSPENDED; devices in other states will be skipped."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setBulkSuspendOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={bulkMutation.isPending}
              disabled={!bulkSuspendReason.trim()}
              onClick={() =>
                bulkMutation.mutate({
                  deviceIds: selectedIds,
                  action: 'SUSPEND',
                  reason: bulkSuspendReason.trim(),
                })
              }
            >
              Suspend Selected
            </Button>
          </>
        }
      >
        <Textarea
          label="Suspension Reason"
          required
          rows={3}
          value={bulkSuspendReason}
          onChange={(e) => setBulkSuspendReason(e.target.value)}
          placeholder="Explain why these devices are being suspended..."
        />
      </Modal>
    </div>
  );
}
