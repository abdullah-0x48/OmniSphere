import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cpu, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import type {
  DeviceModel,
  MetricDefinition,
  MetricValueType,
  PaginatedResponse,
} from '../../shared/types.ts';
import { ApiClientError, apiRequest } from '../api/client.ts';
import { useAuth } from '../auth/AuthContext.tsx';
import {
  Button,
  DataTable,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Select,
  useToast,
  type Column,
} from '../components/ui/index.ts';

interface EditableMetricRow {
  key: string;
  label: string;
  type: MetricValueType;
  unit: string;
  min: string;
  max: string;
}

const EMPTY_METRIC: EditableMetricRow = {
  key: '',
  label: '',
  type: 'number',
  unit: '',
  min: '',
  max: '',
};

export function DeviceModelsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const canWrite = user?.role === 'PLATFORM_ADMIN' || user?.role === 'SUPPORT_ENGINEER';
  const q = searchParams.get('q') ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const sort = searchParams.get('sort') ?? 'name:asc';

  const [searchInput, setSearchInput] = useState(q);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<DeviceModel | null>(null);
  const [name, setName] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [hardwareRevision, setHardwareRevision] = useState('');
  const [firmwareFamily, setFirmwareFamily] = useState('');
  const [metrics, setMetrics] = useState<EditableMetricRow[]>([{ ...EMPTY_METRIC }]);
  const [formError, setFormError] = useState<string | null>(null);

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

  const modelsQuery = useQuery({
    queryKey: ['device-models', q, page, sort],
    queryFn: () =>
      apiRequest<PaginatedResponse<DeviceModel>>('/device-models', {
        query: { q, page, pageSize: 25, sort },
      }),
  });

  const saveMutation = useMutation({
    mutationFn: (payload: {
      name: string;
      manufacturer: string;
      hardwareRevision: string;
      supportedFirmwareFamily: string;
      metrics: MetricDefinition[];
    }) => {
      if (editing) {
        return apiRequest<DeviceModel>(`/device-models/${editing.id}`, {
          method: 'PATCH',
          body: payload,
        });
      }
      return apiRequest<DeviceModel>('/device-models', {
        method: 'POST',
        body: payload,
      });
    },
    onSuccess: (saved) => {
      toast({
        kind: 'success',
        title: editing ? `Updated model "${saved.name}"` : `Created model "${saved.name}"`,
      });
      setModalOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['device-models'] });
    },
    onError: (err) => {
      const msg = err instanceof ApiClientError ? err.message : 'Unable to save device model';
      setFormError(msg);
      toast({ kind: 'error', title: 'Save failed', description: msg });
    },
  });

  const openCreate = () => {
    setEditing(null);
    setName('');
    setManufacturer('');
    setHardwareRevision('Rev 1.0');
    setFirmwareFamily('');
    setMetrics([{ ...EMPTY_METRIC }]);
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (model: DeviceModel) => {
    setEditing(model);
    setName(model.name);
    setManufacturer(model.manufacturer);
    setHardwareRevision(model.hardwareRevision);
    setFirmwareFamily(model.supportedFirmwareFamily);
    setMetrics(
      model.metrics.length > 0
        ? model.metrics.map((m) => ({
            key: m.key,
            label: m.label,
            type: m.type,
            unit: m.unit,
            min: m.min === null ? '' : String(m.min),
            max: m.max === null ? '' : String(m.max),
          }))
        : [{ ...EMPTY_METRIC }],
    );
    setFormError(null);
    setModalOpen(true);
  };

  const updateMetricRow = (idx: number, patch: Partial<EditableMetricRow>) => {
    setMetrics((prev) => prev.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (name.trim().length < 2) return setFormError('Model name must be at least 2 characters.');
    if (manufacturer.trim().length < 2) return setFormError('Manufacturer is required.');
    if (!hardwareRevision.trim()) return setFormError('Hardware revision is required.');
    if (!firmwareFamily.trim()) return setFormError('Supported firmware family is required.');
    if (metrics.length === 0) return setFormError('Add at least one metric definition.');

    const parsedMetrics: MetricDefinition[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < metrics.length; i += 1) {
      const row = metrics[i];
      const key = row.key.trim();
      const label = row.label.trim();
      if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) {
        return setFormError(
          `Metric row ${i + 1}: key must start with a letter and use letters, digits, or underscores.`,
        );
      }
      if (!label) return setFormError(`Metric row ${i + 1}: label is required.`);
      if (seen.has(key.toLowerCase())) {
        return setFormError(`Duplicate metric key "${key}".`);
      }
      seen.add(key.toLowerCase());

      let min: number | null = null;
      let max: number | null = null;
      if (row.type === 'number') {
        if (row.min.trim() !== '') {
          min = Number(row.min);
          if (Number.isNaN(min)) return setFormError(`Metric "${key}": min must be a valid number.`);
        }
        if (row.max.trim() !== '') {
          max = Number(row.max);
          if (Number.isNaN(max)) return setFormError(`Metric "${key}": max must be a valid number.`);
        }
        if (min !== null && max !== null && min > max) {
          return setFormError(`Metric "${key}": min cannot exceed max.`);
        }
      }

      parsedMetrics.push({
        key,
        label,
        type: row.type,
        unit: row.unit.trim(),
        min,
        max,
      });
    }

    saveMutation.mutate({
      name: name.trim(),
      manufacturer: manufacturer.trim(),
      hardwareRevision: hardwareRevision.trim(),
      supportedFirmwareFamily: firmwareFamily.trim(),
      metrics: parsedMetrics,
    });
  };

  const columns: Column<DeviceModel>[] = [
    {
      key: 'name',
      header: 'Device Model',
      sortKey: 'name',
      render: (m) => (
        <div>
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-indigo-600 shrink-0" aria-hidden="true" />
            <span className="font-medium text-slate-900">{m.name}</span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5 pl-6">
            {m.manufacturer} · {m.hardwareRevision}
          </p>
        </div>
      ),
    },
    {
      key: 'firmware',
      header: 'Firmware Family',
      hideOnMobile: true,
      render: (m) => <span className="font-mono text-xs text-slate-700">{m.supportedFirmwareFamily}</span>,
    },
    {
      key: 'metrics',
      header: 'Metric Schema',
      render: (m) => (
        <div className="space-y-1">
          {m.metrics.map((metric) => (
            <div key={metric.key} className="text-xs text-slate-700 flex items-center gap-1.5 flex-wrap">
              <span className="font-mono font-medium text-slate-900">{metric.key}</span>
              <span className="text-slate-400">({metric.type}{metric.unit ? `, ${metric.unit}` : ''})</span>
              {metric.type === 'number' && (metric.min !== null || metric.max !== null) && (
                <span className="font-mono text-[11px] text-slate-500">
                  [{metric.min ?? '−∞'}..{metric.max ?? '+∞'}]
                </span>
              )}
            </div>
          ))}
        </div>
      ),
    },
    {
      key: 'deviceCount',
      header: 'Fleet Devices',
      sortKey: 'deviceCount',
      align: 'right',
      render: (m) => <span className="font-mono tabular-nums font-medium">{m.deviceCount}</span>,
    },
  ];

  if (canWrite) {
    columns.push({
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (m) => (
        <IconButton label={`Edit device model ${m.name}`} size="sm" onClick={() => openEdit(m)}>
          <Pencil className="w-4 h-4" />
        </IconButton>
      ),
    });
  }

  return (
    <div>
      <PageHeader
        title="Device Models"
        description="Global catalogue of hardware models, supported firmware families, and telemetry metric schemas."
        actions={
          canWrite ? (
            <Button onClick={openCreate} icon={<Plus className="w-4 h-4" />}>
              New Device Model
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
            aria-label="Search device models"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by model name, manufacturer, or firmware family..."
            className="w-full h-9 pl-9 pr-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
          />
        </div>
        <Button type="submit" variant="secondary" size="sm">
          Search
        </Button>
      </form>

      <DataTable
        columns={columns}
        rows={modelsQuery.data?.items ?? []}
        rowKey={(m) => m.id}
        total={modelsQuery.data?.total ?? 0}
        page={page}
        pageSize={25}
        onPageChange={(p) => updateParams({ page: String(p) })}
        sort={sort}
        onSortChange={(nextSort) => updateParams({ sort: nextSort, page: '1' })}
        isLoading={modelsQuery.isLoading}
        error={modelsQuery.error instanceof Error ? modelsQuery.error.message : null}
        onRetry={() => void modelsQuery.refetch()}
        emptyTitle="No device models defined"
        emptyDescription="Add a device model to define telemetry metrics and onboard hardware."
      />

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit Device Model' : 'New Device Model'}
        description="Define hardware identity and the telemetry metrics validated for every device of this model."
        size="lg"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setModalOpen(false)}
              disabled={saveMutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" form="device-model-form" loading={saveMutation.isPending}>
              {editing ? 'Save Changes' : 'Create Model'}
            </Button>
          </>
        }
      >
        <form id="device-model-form" onSubmit={handleSubmit} className="space-y-5">
          {formError && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700"
            >
              {formError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Model Name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. TH-200 Temperature and Humidity Sensor"
            />
            <Input
              label="Manufacturer"
              required
              value={manufacturer}
              onChange={(e) => setManufacturer(e.target.value)}
              placeholder="e.g. Sensirion Industrial"
            />
            <Input
              label="Hardware Revision"
              required
              value={hardwareRevision}
              onChange={(e) => setHardwareRevision(e.target.value)}
              placeholder="e.g. Rev 2.1"
            />
            <Input
              label="Supported Firmware Family"
              required
              value={firmwareFamily}
              onChange={(e) => setFirmwareFamily(e.target.value)}
              placeholder="e.g. th200-rtos"
            />
          </div>

          <div className="border-t border-slate-200 pt-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Metric Definitions</h3>
                <p className="text-xs text-slate-500">
                  Telemetry keys validated on ingestion. Health keys (CPU, memory, battery, signal,
                  uptime) are included automatically for all models.
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setMetrics((prev) => [...prev, { ...EMPTY_METRIC }])}
                icon={<Plus className="w-3.5 h-3.5" />}
              >
                Add Metric
              </Button>
            </div>

            <div className="space-y-3">
              {metrics.map((row, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end"
                >
                  <div className="sm:col-span-3">
                    <Input
                      label="Key"
                      required
                      value={row.key}
                      onChange={(e) => updateMetricRow(idx, { key: e.target.value })}
                      placeholder="temperature"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <Input
                      label="Label"
                      required
                      value={row.label}
                      onChange={(e) => updateMetricRow(idx, { label: e.target.value })}
                      placeholder="Temperature"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Select
                      label="Type"
                      value={row.type}
                      onChange={(e) =>
                        updateMetricRow(idx, { type: e.target.value as MetricValueType })
                      }
                    >
                      <option value="number">Number</option>
                      <option value="boolean">Boolean</option>
                      <option value="string">String</option>
                    </Select>
                  </div>
                  <div className="sm:col-span-1">
                    <Input
                      label="Unit"
                      value={row.unit}
                      onChange={(e) => updateMetricRow(idx, { unit: e.target.value })}
                      placeholder="°C"
                    />
                  </div>
                  <div className="sm:col-span-1">
                    <Input
                      label="Min"
                      type="number"
                      step="any"
                      disabled={row.type !== 'number'}
                      value={row.min}
                      onChange={(e) => updateMetricRow(idx, { min: e.target.value })}
                      placeholder="0"
                    />
                  </div>
                  <div className="sm:col-span-1">
                    <Input
                      label="Max"
                      type="number"
                      step="any"
                      disabled={row.type !== 'number'}
                      value={row.max}
                      onChange={(e) => updateMetricRow(idx, { max: e.target.value })}
                      placeholder="120"
                    />
                  </div>
                  <div className="sm:col-span-1 flex justify-end pb-0.5">
                    <IconButton
                      label={`Remove metric row ${idx + 1}`}
                      size="sm"
                      disabled={metrics.length <= 1}
                      onClick={() => setMetrics((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      <Trash2 className="w-4 h-4 text-red-600" />
                    </IconButton>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </form>
      </Modal>
    </div>
  );
}
