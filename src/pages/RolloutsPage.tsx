import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Plus,
  Rocket,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type {
  DeviceModel,
  DevicePublic,
  FirmwarePackagePublic,
  PaginatedResponse,
  RolloutDetail,
  RolloutPreviewResponse,
  RolloutPublic,
  RolloutTargetType,
  Site,
} from '../../shared/types.ts';
import { ApiClientError, apiRequest } from '../api/client.ts';
import { useAuth } from '../auth/AuthContext.tsx';
import {
  Button,
  Card,
  DataTable,
  Input,
  Modal,
  PageHeader,
  RelativeTime,
  Select,
  StatusChip,
  useToast,
  type Column,
} from '../components/ui/index.ts';
import { formatLocalDateTime } from '../utils/format.ts';

function RolloutProgressBar({ counts }: { counts: RolloutPublic['counts'] }) {
  const total = Math.max(1, counts.total);
  const verifiedPct = Math.round((counts.verified / total) * 100);
  const failedPct = Math.round((counts.failed / total) * 100);
  const cancelledPct = Math.round((counts.cancelled / total) * 100);

  return (
    <div className="min-w-[140px]">
      <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden flex">
        {verifiedPct > 0 && (
          <div className="bg-emerald-500 h-full" style={{ width: `${verifiedPct}%` }} />
        )}
        {failedPct > 0 && <div className="bg-red-500 h-full" style={{ width: `${failedPct}%` }} />}
        {cancelledPct > 0 && (
          <div className="bg-slate-400 h-full" style={{ width: `${cancelledPct}%` }} />
        )}
      </div>
      <p className="mt-1 font-mono text-[11px] tabular-nums text-slate-600">
        {counts.verified}/{counts.total} verified
        {counts.failed > 0 && <span className="text-red-600"> · {counts.failed} failed</span>}
        {counts.cancelled > 0 && (
          <span className="text-slate-500"> · {counts.cancelled} cancelled</span>
        )}
      </p>
    </div>
  );
}

export function RolloutsPage() {
  const { user, activeTenantId } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const canManage = user?.role === 'CLIENT_ADMIN' || user?.role === 'SUPPORT_ENGINEER';

  const q = searchParams.get('q') ?? '';
  const status = searchParams.get('status') ?? '';
  const modelId = searchParams.get('modelId') ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);

  const [searchInput, setSearchInput] = useState(q);

  // 3-Step Create Rollout Wizard state (Section 10.2 & 10.5)
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [selectedFirmwareId, setSelectedFirmwareId] = useState('');
  const [targetType, setTargetType] = useState<RolloutTargetType>('SITE');
  const [targetSiteOrTag, setTargetSiteOrTag] = useState('');
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([]);
  const [previewData, setPreviewData] = useState<RolloutPreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [scheduleMode, setScheduleMode] = useState<'NOW' | 'LATER'>('NOW');
  const [scheduledLocal, setScheduledLocal] = useState('');

  // Support launching wizard from Devices bulk action bar (?create=1&deviceIds=...)
  useEffect(() => {
    if (canManage && searchParams.get('create') === '1') {
      const preIds = (searchParams.get('deviceIds') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      setWizardOpen(true);
      setWizardStep(1);
      if (preIds.length > 0) {
        setTargetType('DEVICE');
        setSelectedDeviceIds(preIds);
      }
      const next = new URLSearchParams(searchParams);
      next.delete('create');
      next.delete('deviceIds');
      setSearchParams(next, { replace: true });
    }
  }, [canManage, searchParams, setSearchParams]);

  const updateParams = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(updates)) {
      if (!v) next.delete(k);
      else next.set(k, v);
    }
    setSearchParams(next, { replace: true });
  };

  const rolloutsQuery = useQuery({
    queryKey: ['rollouts-list', { activeTenantId, q, status, modelId, page }],
    queryFn: () =>
      apiRequest<PaginatedResponse<RolloutPublic>>('/rollouts', {
        query: { q, status, modelId, page, pageSize: 25 },
      }),
    refetchInterval: 6000,
  });

  const modelsQuery = useQuery({
    queryKey: ['device-models-options'],
    queryFn: () =>
      apiRequest<PaginatedResponse<DeviceModel>>('/device-models', {
        query: { page: 1, pageSize: 200 },
      }),
  });

  const releasedFirmwareQuery = useQuery({
    queryKey: ['released-firmware-options', activeTenantId],
    enabled: wizardOpen && canManage,
    queryFn: () =>
      apiRequest<PaginatedResponse<FirmwarePackagePublic>>('/firmware', {
        query: { status: 'RELEASED', page: 1, pageSize: 200 },
      }),
  });

  const sitesQuery = useQuery({
    queryKey: ['sites-options', activeTenantId],
    enabled: wizardOpen && canManage,
    queryFn: () =>
      apiRequest<PaginatedResponse<Site>>('/sites', { query: { page: 1, pageSize: 200 } }),
  });

  const tagsQuery = useQuery({
    queryKey: ['device-tags', activeTenantId],
    enabled: wizardOpen && canManage,
    queryFn: () => apiRequest<{ items: string[] }>('/devices/tags'),
  });

  const devicesQuery = useQuery({
    queryKey: ['rollout-wizard-devices', activeTenantId],
    enabled: wizardOpen && canManage,
    queryFn: () =>
      apiRequest<PaginatedResponse<DevicePublic>>('/devices', {
        query: { page: 1, pageSize: 200 },
      }),
  });

  const previewMutation = useMutation({
    mutationFn: (vars: {
      firmwareId: string;
      targetType: RolloutTargetType;
      targetValue: string;
    }) =>
      apiRequest<RolloutPreviewResponse>('/rollouts/preview', {
        method: 'POST',
        body: vars,
      }),
    onSuccess: (res) => {
      setPreviewData(res);
      setPreviewError(null);
    },
    onError: (err) => {
      setPreviewData(null);
      setPreviewError(err instanceof ApiClientError ? err.message : 'Preview failed');
    },
  });

  const createRolloutMutation = useMutation({
    mutationFn: (vars: {
      firmwareId: string;
      targetType: RolloutTargetType;
      targetValue: string;
      scheduledAt: string | null;
    }) =>
      apiRequest<RolloutDetail>('/rollouts', {
        method: 'POST',
        body: vars,
      }),
    onSuccess: (created) => {
      toast({
        kind: 'success',
        title:
          created.status === 'PENDING_APPROVAL'
            ? 'Rollout submitted for Client Manager approval'
            : created.status === 'RUNNING'
              ? 'Rollout started'
              : 'Rollout scheduled',
        description: `${created.counts.total} device(s) targeted for firmware ${created.firmwareVersion ?? ''}.`,
      });
      setWizardOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['rollouts-list'] });
      void queryClient.invalidateQueries({ queryKey: ['fleet-summary'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications-bell'] });
      navigate(`/rollouts/${created.id}`);
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Unable to create rollout',
        description: err instanceof ApiClientError ? err.message : 'Request failed.',
      });
    },
  });

  const releasedPackages = (releasedFirmwareQuery.data?.items ?? []).filter(
    (f) => f.status === 'RELEASED',
  );
  const selectedFirmware =
    releasedPackages.find((f) => f.id === selectedFirmwareId) ?? null;

  const currentTargetValue =
    targetType === 'DEVICE' ? selectedDeviceIds.join(',') : targetSiteOrTag.trim();

  const resetWizard = () => {
    setWizardStep(1);
    setSelectedFirmwareId('');
    setTargetType('SITE');
    setTargetSiteOrTag('');
    setSelectedDeviceIds([]);
    setPreviewData(null);
    setPreviewError(null);
    setScheduleMode('NOW');
    setScheduledLocal('');
  };

  const openWizard = () => {
    resetWizard();
    setWizardOpen(true);
  };

  const runPreview = () => {
    if (!selectedFirmwareId || !currentTargetValue) return;
    previewMutation.mutate({
      firmwareId: selectedFirmwareId,
      targetType,
      targetValue: currentTargetValue,
    });
  };

  const toggleDeviceId = (id: string) => {
    setPreviewData(null);
    setSelectedDeviceIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const columns: Column<RolloutPublic>[] = [
    {
      key: 'firmware',
      header: 'Firmware & Model',
      render: (r) => (
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-semibold text-slate-900">
              v{r.firmwareVersion ?? '—'}
            </span>
            <StatusChip status={r.status} />
          </div>
          <p className="text-xs text-slate-500 mt-0.5">{r.modelName ?? r.modelId}</p>
        </div>
      ),
    },
    {
      key: 'target',
      header: 'Target Cohort',
      render: (r) => (
        <span className="text-xs font-medium text-slate-700">
          {r.targetLabel ?? `${r.targetType}: ${r.targetValue}`}
        </span>
      ),
    },
    {
      key: 'progress',
      header: 'Progress',
      render: (r) => <RolloutProgressBar counts={r.counts} />,
    },
    {
      key: 'createdBy',
      header: 'Created By',
      hideOnMobile: true,
      render: (r) => (
        <span className="text-xs text-slate-700">{r.createdByName ?? r.createdBy}</span>
      ),
    },
    {
      key: 'scheduledAt',
      header: 'Schedule / Created',
      hideOnMobile: true,
      render: (r) => (
        <div className="text-xs">
          {r.scheduledAt ? (
            <p className="font-mono text-slate-700">{formatLocalDateTime(r.scheduledAt)}</p>
          ) : (
            <p className="text-slate-500">Immediate</p>
          )}
          <RelativeTime iso={r.createdAt} />
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="OTA Rollouts"
        description="Stage and monitor over-the-air firmware rollouts with target previews, approval gates, and per-device verification."
        actions={
          canManage ? (
            <Button onClick={openWizard} icon={<Plus className="w-4 h-4" />}>
              New Rollout
            </Button>
          ) : undefined
        }
      />

      {/* Filter Bar */}
      <Card className="p-4">
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              updateParams({ q: searchInput.trim() || null, page: '1' });
            }}
            className="flex items-center gap-2 flex-1"
          >
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                aria-label="Search rollouts"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search by firmware version, model, or target..."
                className="w-full h-9 pl-9 pr-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
              />
            </div>
            <Button type="submit" variant="secondary" size="sm">
              Search
            </Button>
          </form>

          <div className="w-full sm:w-48">
            <Select
              aria-label="Filter by rollout status"
              value={status}
              onChange={(e) => updateParams({ status: e.target.value || null, page: '1' })}
              className="h-9 py-1.5"
            >
              <option value="">All Statuses</option>
              <option value="PENDING_APPROVAL">Pending Approval</option>
              <option value="PENDING">Pending (Scheduled)</option>
              <option value="RUNNING">Running</option>
              <option value="COMPLETED">Completed</option>
              <option value="CANCELLED">Cancelled</option>
              <option value="REJECTED">Rejected</option>
            </Select>
          </div>

          <div className="w-full sm:w-52">
            <Select
              aria-label="Filter by model"
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
          </div>

          {(q || status || modelId) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchInput('');
                setSearchParams(new URLSearchParams(), { replace: true });
              }}
              icon={<X className="w-3.5 h-3.5" />}
            >
              Clear
            </Button>
          )}
        </div>
      </Card>

      <DataTable
        columns={columns}
        rows={rolloutsQuery.data?.items ?? []}
        rowKey={(r) => r.id}
        total={rolloutsQuery.data?.total ?? 0}
        page={page}
        pageSize={25}
        onPageChange={(next) => updateParams({ page: String(next) })}
        isLoading={rolloutsQuery.isLoading}
        error={
          rolloutsQuery.isError
            ? rolloutsQuery.error instanceof ApiClientError
              ? rolloutsQuery.error.message
              : 'Unable to load rollouts.'
            : null
        }
        onRetry={() => void rolloutsQuery.refetch()}
        onRowClick={(r) => navigate(`/rollouts/${r.id}`)}
        emptyTitle={q || status || modelId ? 'No matching firmware rollouts' : 'No firmware rollouts yet'}
        emptyDescription={
          q || status || modelId
            ? 'Clear your active filters to view all firmware rollouts.'
            : 'Launch a new rollout to update eligible ACTIVE devices to a released firmware package.'
        }
        emptyAction={
          q || status || modelId ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setSearchInput('');
                setSearchParams(new URLSearchParams(), { replace: true });
              }}
            >
              Clear filters
            </Button>
          ) : canManage ? (
            <Button onClick={openWizard} icon={<Rocket className="w-4 h-4" />}>
              Create Rollout
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => void rolloutsQuery.refetch()}>
              Refresh
            </Button>
          )
        }
      />

      {/* 3-Step Create Rollout Wizard Modal */}
      <Modal
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        title="Create OTA Firmware Rollout"
        description={`Step ${wizardStep} of 3 — ${
          wizardStep === 1
            ? 'Choose a Released firmware package'
            : wizardStep === 2
              ? 'Select targets and review exclusions'
              : 'Choose schedule and confirm rollout'
        }`}
        size="lg"
        footer={
          <div className="w-full flex items-center justify-between gap-2">
            <div>
              {wizardStep > 1 && (
                <Button
                  variant="secondary"
                  onClick={() => setWizardStep((s) => (s === 3 ? 2 : 1))}
                  icon={<ArrowLeft className="w-4 h-4" />}
                >
                  Back
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => setWizardOpen(false)}>
                Cancel
              </Button>
              {wizardStep === 1 && (
                <Button
                  disabled={!selectedFirmwareId}
                  onClick={() => {
                    setPreviewData(null);
                    setPreviewError(null);
                    setWizardStep(2);
                  }}
                  icon={<ArrowRight className="w-4 h-4" />}
                >
                  Next: Select Targets
                </Button>
              )}
              {wizardStep === 2 && (
                <Button
                  disabled={!previewData || previewData.included.length === 0}
                  onClick={() => setWizardStep(3)}
                  icon={<ArrowRight className="w-4 h-4" />}
                >
                  Next: Schedule & Confirm
                </Button>
              )}
              {wizardStep === 3 && (
                <Button
                  loading={createRolloutMutation.isPending}
                  disabled={
                    !selectedFirmwareId ||
                    !currentTargetValue ||
                    !previewData ||
                    previewData.included.length === 0 ||
                    (scheduleMode === 'LATER' && !scheduledLocal)
                  }
                  onClick={() => {
                    const scheduledAt =
                      scheduleMode === 'LATER' && scheduledLocal
                        ? new Date(scheduledLocal).toISOString()
                        : null;
                    createRolloutMutation.mutate({
                      firmwareId: selectedFirmwareId,
                      targetType,
                      targetValue: currentTargetValue,
                      scheduledAt,
                    });
                  }}
                  icon={<Rocket className="w-4 h-4" />}
                >
                  Launch Rollout
                </Button>
              )}
            </div>
          </div>
        }
      >
        {/* Stepper Indicator */}
        <div className="flex items-center gap-2 mb-5 pb-4 border-b border-slate-200 text-xs">
          {[
            { num: 1, label: '1. Firmware' },
            { num: 2, label: '2. Target & Preview' },
            { num: 3, label: '3. Schedule & Launch' },
          ].map((st) => (
            <span
              key={st.num}
              className={`px-2.5 py-1 rounded-md font-medium ${
                wizardStep === st.num
                  ? 'bg-indigo-600 text-white'
                  : wizardStep > st.num
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-slate-100 text-slate-500'
              }`}
            >
              {st.label}
            </span>
          ))}
        </div>

        {/* STEP 1: Select Released Firmware */}
        {wizardStep === 1 && (
          <div className="space-y-3">
            {releasedFirmwareQuery.isLoading ? (
              <div className="h-32 bg-slate-100 rounded-xl animate-pulse" />
            ) : releasedPackages.length === 0 ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                No RELEASED firmware packages are available yet. Upload and release a firmware
                package first.
              </div>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {releasedPackages.map((pkg) => {
                  const chosen = pkg.id === selectedFirmwareId;
                  return (
                    <label
                      key={pkg.id}
                      className={`block rounded-xl border p-3.5 cursor-pointer transition-colors ${
                        chosen
                          ? 'border-indigo-600 bg-indigo-50/50 ring-1 ring-indigo-600'
                          : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <input
                            type="radio"
                            name="rollout-firmware"
                            checked={chosen}
                            onChange={() => setSelectedFirmwareId(pkg.id)}
                            className="mt-1 h-4 w-4 text-indigo-600 border-slate-300"
                          />
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-sm font-semibold text-slate-900">
                                {pkg.version}
                              </span>
                              <span className="text-xs font-medium text-slate-700">
                                {pkg.modelName ?? pkg.modelId}
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 mt-1">
                              {pkg.releaseNotes || 'No release notes.'}
                            </p>
                            <p className="text-[11px] font-mono text-slate-500 mt-1">
                              SHA-256: {pkg.checksumSha256.slice(0, 24)}…
                            </p>
                          </div>
                        </div>
                        <StatusChip status={pkg.status} />
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* STEP 2: Target Selection & Preview */}
        {wizardStep === 2 && selectedFirmware && (
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-700 flex items-center justify-between gap-2 flex-wrap">
              <span>
                Selected firmware:{' '}
                <strong className="font-mono text-slate-900">{selectedFirmware.version}</strong> for{' '}
                <strong className="text-slate-900">
                  {selectedFirmware.modelName ?? selectedFirmware.modelId}
                </strong>
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <Select
                label="Target Type"
                value={targetType}
                onChange={(e) => {
                  setTargetType(e.target.value as RolloutTargetType);
                  setTargetSiteOrTag('');
                  setPreviewData(null);
                  setPreviewError(null);
                }}
              >
                <option value="SITE">Site</option>
                <option value="TAG">Tag</option>
                <option value="DEVICE">Specific Devices</option>
              </Select>

              {targetType === 'SITE' && (
                <div className="sm:col-span-2">
                  <Select
                    label="Site"
                    value={targetSiteOrTag}
                    onChange={(e) => {
                      setTargetSiteOrTag(e.target.value);
                      setPreviewData(null);
                    }}
                  >
                    <option value="">Select a site...</option>
                    {(sitesQuery.data?.items ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.deviceCount ?? 0} devices)
                      </option>
                    ))}
                  </Select>
                </div>
              )}

              {targetType === 'TAG' && (
                <div className="sm:col-span-2">
                  <Select
                    label="Tag"
                    value={targetSiteOrTag}
                    onChange={(e) => {
                      setTargetSiteOrTag(e.target.value);
                      setPreviewData(null);
                    }}
                  >
                    <option value="">Select a tag...</option>
                    {(tagsQuery.data?.items ?? []).map((t) => (
                      <option key={t} value={t}>
                        #{t}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
            </div>

            {targetType === 'DEVICE' && (
              <div className="space-y-1.5">
                <p className="text-sm font-medium text-slate-700">
                  Select Devices ({selectedDeviceIds.length} selected)
                </p>
                <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-300 divide-y divide-slate-100 bg-white">
                  {(devicesQuery.data?.items ?? []).map((d) => (
                    <label
                      key={d.id}
                      className="flex items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-slate-50 cursor-pointer"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          checked={selectedDeviceIds.includes(d.id)}
                          onChange={() => toggleDeviceId(d.id)}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                        />
                        <span className="font-medium text-slate-900 truncate">{d.name}</span>
                        <span className="font-mono text-slate-500">({d.modelName?.split(' ')[0] ?? d.modelId})</span>
                      </span>
                      <span className="flex items-center gap-1.5 shrink-0">
                        <span className="font-mono text-slate-500">
                          {d.firmwareVersion ?? '—'}
                        </span>
                        <StatusChip status={d.state} />
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-end">
              <Button
                variant="secondary"
                size="sm"
                loading={previewMutation.isPending}
                disabled={!currentTargetValue}
                onClick={runPreview}
              >
                Preview Target Cohort
              </Button>
            </div>

            {previewError && (
              <div
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700"
              >
                {previewError}
              </div>
            )}

            {previewData && (
              <div className="space-y-3 pt-2 border-t border-slate-200">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 flex items-center justify-between">
                    <div>
                      <p className="text-xs text-emerald-800">Eligible (Included)</p>
                      <p className="text-xl font-semibold font-mono text-emerald-900">
                        {previewData.included.length}
                      </p>
                    </div>
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-center justify-between">
                    <div>
                      <p className="text-xs text-amber-800">Excluded</p>
                      <p className="text-xl font-semibold font-mono text-amber-900">
                        {previewData.excluded.length}
                      </p>
                    </div>
                    <AlertTriangle className="w-5 h-5 text-amber-600" />
                  </div>
                </div>

                {previewData.included.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-slate-700 mb-1.5">
                      Included Devices ({previewData.included.length})
                    </p>
                    <div className="max-h-36 overflow-y-auto rounded-lg border border-emerald-200 divide-y divide-slate-100">
                      {previewData.included.map((inc) => (
                        <div
                          key={inc.deviceId}
                          className="px-3 py-2 flex items-center justify-between gap-2 text-xs bg-white"
                        >
                          <div>
                            <span className="font-medium text-slate-900">{inc.deviceName}</span>{' '}
                            <span className="font-mono text-slate-500">{inc.serialNumber}</span>
                          </div>
                          <span className="font-mono text-emerald-700">
                            {inc.currentVersion ?? 'none'} → {previewData.firmwareVersion}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {previewData.excluded.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-slate-700 mb-1.5">
                      Excluded Devices ({previewData.excluded.length})
                    </p>
                    <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
                      {previewData.excluded.map((exc) => (
                        <div
                          key={exc.deviceId}
                          className="px-3 py-2 flex items-center justify-between gap-2 text-xs bg-slate-50/70"
                        >
                          <div className="min-w-0">
                            <span className="font-medium text-slate-800">{exc.deviceName}</span>{' '}
                            <span className="font-mono text-slate-500">{exc.serialNumber}</span>
                          </div>
                          <span className="text-amber-800 font-medium text-right shrink-0">
                            {exc.reason}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {previewData.included.length === 0 && (
                  <p className="text-xs text-red-600">
                    At least 1 eligible ACTIVE device is required to create a rollout.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* STEP 3: Schedule & Confirm */}
        {wizardStep === 3 && selectedFirmware && previewData && (
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Firmware Package</span>
                <span className="font-mono font-semibold text-slate-900">
                  {selectedFirmware.modelName ?? selectedFirmware.modelId} — v
                  {selectedFirmware.version}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Target Cohort</span>
                <span className="font-medium text-slate-900">
                  {previewData.included.length} eligible device(s) ({previewData.excluded.length}{' '}
                  excluded)
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-700">Execution Schedule</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label
                  className={`flex items-center gap-2.5 rounded-lg border p-3 text-sm cursor-pointer ${
                    scheduleMode === 'NOW'
                      ? 'border-indigo-600 bg-indigo-50/50'
                      : 'border-slate-200'
                  }`}
                >
                  <input
                    type="radio"
                    name="schedule-mode"
                    checked={scheduleMode === 'NOW'}
                    onChange={() => setScheduleMode('NOW')}
                    className="h-4 w-4 text-indigo-600"
                  />
                  <span>Start immediately (once approved if required)</span>
                </label>
                <label
                  className={`flex items-center gap-2.5 rounded-lg border p-3 text-sm cursor-pointer ${
                    scheduleMode === 'LATER'
                      ? 'border-indigo-600 bg-indigo-50/50'
                      : 'border-slate-200'
                  }`}
                >
                  <input
                    type="radio"
                    name="schedule-mode"
                    checked={scheduleMode === 'LATER'}
                    onChange={() => setScheduleMode('LATER')}
                    className="h-4 w-4 text-indigo-600"
                  />
                  <span>Schedule for later</span>
                </label>
              </div>
            </div>

            {scheduleMode === 'LATER' && (
              <Input
                label="Scheduled Start Time (Local)"
                type="datetime-local"
                required
                value={scheduledLocal}
                onChange={(e) => setScheduledLocal(e.target.value)}
              />
            )}

            <div className="rounded-lg border border-indigo-200 bg-indigo-50/70 px-3.5 py-2.5 text-xs text-indigo-900 flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
              <p>
                If this organization has <strong>Require Rollout Approval</strong> enabled in
                Settings, the rollout will wait in <strong>Pending Approval</strong> for a Client
                Manager on the Approvals Center before starting.
              </p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
