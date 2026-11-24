import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, Pencil, Plus, Search, Send, Sliders, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import type {
  ConfigProfilePublic,
  ConfigProfileVersion,
  ConfigPushResponse,
  ConfigPushTargetType,
  DeviceModel,
  DevicePublic,
  PaginatedResponse,
  Site,
} from '../../shared/types.ts';
import { ApiClientError, apiRequest } from '../api/client.ts';
import { useAuth } from '../auth/AuthContext.tsx';
import {
  Button,
  Card,
  DataTable,
  Drawer,
  ErrorState,
  Input,
  JsonEditor,
  Modal,
  PageHeader,
  RelativeTime,
  Select,
  StatusChip,
  useToast,
  type Column,
} from '../components/ui/index.ts';
import { formatLocalDateTime } from '../utils/format.ts';

const DEFAULT_CONFIG_JSON = JSON.stringify(
  {
    reportingIntervalSec: 30,
    heartbeatIntervalSec: 30,
    powerMode: 'balanced',
  },
  null,
  2,
);

export function ConfigProfilesPage() {
  const { user, activeTenantId } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const canWrite = user?.role === 'CLIENT_ADMIN' || user?.role === 'SUPPORT_ENGINEER';

  const q = searchParams.get('q') ?? '';
  const modelId = searchParams.get('modelId') ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);

  const [searchInput, setSearchInput] = useState(q);

  // Create / Edit modal state
  const [editorModalOpen, setEditorModalOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<ConfigProfilePublic | null>(null);
  const [formName, setFormName] = useState('');
  const [formModelId, setFormModelId] = useState('');
  const [formPayloadText, setFormPayloadText] = useState(DEFAULT_CONFIG_JSON);
  const [formError, setFormError] = useState<string | null>(null);

  // Version history drawer state
  const [historyProfile, setHistoryProfile] = useState<ConfigProfilePublic | null>(null);

  // Push modal state
  const [pushProfile, setPushProfile] = useState<ConfigProfilePublic | null>(null);
  const [pushTargetType, setPushTargetType] = useState<ConfigPushTargetType>('DEVICE');
  const [pushTargetValue, setPushTargetValue] = useState('');
  const [pushResult, setPushResult] = useState<ConfigPushResponse | null>(null);

  const updateParams = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(updates)) {
      if (!v) next.delete(k);
      else next.set(k, v);
    }
    setSearchParams(next, { replace: true });
  };

  const profilesQuery = useQuery({
    queryKey: ['config-profiles', { activeTenantId, q, modelId, page }],
    queryFn: () =>
      apiRequest<PaginatedResponse<ConfigProfilePublic>>('/config-profiles', {
        query: { q, modelId, page, pageSize: 25 },
      }),
  });

  const modelsQuery = useQuery({
    queryKey: ['device-models-options'],
    queryFn: () =>
      apiRequest<PaginatedResponse<DeviceModel>>('/device-models', {
        query: { page: 1, pageSize: 200 },
      }),
  });

  const versionsQuery = useQuery({
    queryKey: ['config-profile-versions', historyProfile?.id],
    enabled: Boolean(historyProfile),
    queryFn: () =>
      apiRequest<{ items: ConfigProfileVersion[] }>(
        `/config-profiles/${historyProfile!.id}/versions`,
      ),
  });

  const sitesQuery = useQuery({
    queryKey: ['sites-options', activeTenantId],
    enabled: Boolean(pushProfile) && canWrite,
    queryFn: () =>
      apiRequest<PaginatedResponse<Site>>('/sites', { query: { page: 1, pageSize: 200 } }),
  });

  const tagsQuery = useQuery({
    queryKey: ['device-tags', activeTenantId],
    enabled: Boolean(pushProfile) && canWrite,
    queryFn: () => apiRequest<{ items: string[] }>('/devices/tags'),
  });

  const matchingDevicesQuery = useQuery({
    queryKey: ['config-push-devices', activeTenantId, pushProfile?.modelId],
    enabled: Boolean(pushProfile) && canWrite,
    queryFn: () =>
      apiRequest<PaginatedResponse<DevicePublic>>('/devices', {
        query: { modelId: pushProfile!.modelId, page: 1, pageSize: 100 },
      }),
  });

  const saveMutation = useMutation({
    mutationFn: (body: {
      id?: string;
      name: string;
      modelId?: string;
      payload: Record<string, unknown>;
    }) => {
      if (body.id) {
        return apiRequest<ConfigProfilePublic>(`/config-profiles/${body.id}`, {
          method: 'PATCH',
          body: { name: body.name, payload: body.payload },
        });
      }
      return apiRequest<ConfigProfilePublic>('/config-profiles', {
        method: 'POST',
        body: { name: body.name, modelId: body.modelId, payload: body.payload },
      });
    },
    onSuccess: (saved) => {
      toast({
        kind: 'success',
        title: editingProfile
          ? `Updated "${saved.name}" to v${saved.version}`
          : `Created "${saved.name}" (v${saved.version})`,
      });
      setEditorModalOpen(false);
      setEditingProfile(null);
      setFormError(null);
      void queryClient.invalidateQueries({ queryKey: ['config-profiles'] });
      void queryClient.invalidateQueries({ queryKey: ['config-profile-versions'] });
    },
    onError: (err) => {
      const msg = err instanceof ApiClientError ? err.message : 'Unable to save configuration profile';
      setFormError(msg);
      toast({ kind: 'error', title: 'Save failed', description: msg });
    },
  });

  const pushMutation = useMutation({
    mutationFn: (vars: {
      profileId: string;
      targetType: ConfigPushTargetType;
      targetValue: string;
    }) =>
      apiRequest<ConfigPushResponse>(`/config-profiles/${vars.profileId}/push`, {
        method: 'POST',
        body: { targetType: vars.targetType, targetValue: vars.targetValue },
      }),
    onSuccess: (res) => {
      setPushResult(res);
      toast({
        kind: res.queuedCount > 0 ? 'success' : 'info',
        title: `Config v${res.version} queued for ${res.queuedCount} device(s)`,
        description:
          res.skippedCount > 0
            ? `${res.skippedCount} device(s) skipped (wrong model or decommissioned).`
            : 'Devices will apply and acknowledge on their next command poll.',
      });
      void queryClient.invalidateQueries({ queryKey: ['devices'] });
      void queryClient.invalidateQueries({ queryKey: ['device'] });
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Push failed',
        description: err instanceof ApiClientError ? err.message : 'Unable to push configuration.',
      });
    },
  });

  const openCreateModal = () => {
    setEditingProfile(null);
    setFormName('');
    setFormModelId(modelsQuery.data?.items?.[0]?.id ?? '');
    setFormPayloadText(DEFAULT_CONFIG_JSON);
    setFormError(null);
    setEditorModalOpen(true);
  };

  const openEditModal = (profile: ConfigProfilePublic) => {
    setEditingProfile(profile);
    setFormName(profile.name);
    setFormModelId(profile.modelId);
    setFormPayloadText(JSON.stringify(profile.payload, null, 2));
    setFormError(null);
    setEditorModalOpen(true);
  };

  const openPushModal = (profile: ConfigProfilePublic) => {
    setPushProfile(profile);
    setPushTargetType('DEVICE');
    setPushTargetValue('');
    setPushResult(null);
  };

  const handleSaveSubmit = () => {
    if (formName.trim().length < 2) {
      setFormError('Profile name must be at least 2 characters.');
      return;
    }
    if (!editingProfile && !formModelId) {
      setFormError('Select a device model.');
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(formPayloadText);
    } catch (e) {
      setFormError(e instanceof Error ? `Invalid JSON: ${e.message}` : 'Invalid JSON payload');
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setFormError('Configuration payload must be a JSON object (e.g. {"reportingIntervalSec": 15}).');
      return;
    }
    setFormError(null);
    saveMutation.mutate({
      id: editingProfile?.id,
      name: formName.trim(),
      modelId: editingProfile ? undefined : formModelId,
      payload: parsed as Record<string, unknown>,
    });
  };

  const columns: Column<ConfigProfilePublic>[] = [
    {
      key: 'name',
      header: 'Profile Name',
      render: (p) => (
        <div>
          <p className="font-medium text-slate-900">{p.name}</p>
          <p className="text-xs font-mono text-slate-500">
            {Object.keys(p.payload).length} setting{Object.keys(p.payload).length === 1 ? '' : 's'}
          </p>
        </div>
      ),
    },
    {
      key: 'model',
      header: 'Device Model',
      render: (p) => <span className="text-xs text-slate-700">{p.modelName ?? p.modelId}</span>,
    },
    {
      key: 'version',
      header: 'Version',
      render: (p) => (
        <span className="inline-flex items-center px-2 py-0.5 rounded-md border border-indigo-200 bg-indigo-50 text-indigo-700 font-mono text-xs font-semibold">
          v{p.version}
        </span>
      ),
    },
    {
      key: 'updatedAt',
      header: 'Updated',
      hideOnMobile: true,
      render: (p) => <RelativeTime iso={p.updatedAt} />,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (p) => (
        <div
          className="inline-flex items-center gap-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setHistoryProfile(p)}
            icon={<History className="w-3.5 h-3.5" />}
          >
            History
          </Button>
          {canWrite && (
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => openEditModal(p)}
                icon={<Pencil className="w-3.5 h-3.5" />}
              >
                Edit
              </Button>
              <Button
                size="sm"
                onClick={() => openPushModal(p)}
                icon={<Send className="w-3.5 h-3.5" />}
              >
                Push
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  const candidateDevices = (matchingDevicesQuery.data?.items ?? []).filter(
    (d) => d.state !== 'DECOMMISSIONED',
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Configuration Profiles"
        description="Manage versioned JSON configuration templates per device model and push updates to devices, tags, or sites."
        actions={
          canWrite ? (
            <Button onClick={openCreateModal} icon={<Plus className="w-4 h-4" />}>
              New Config Profile
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
                aria-label="Search configuration profiles"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search by profile name..."
                className="w-full h-9 pl-9 pr-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
              />
            </div>
            <Button type="submit" variant="secondary" size="sm">
              Search
            </Button>
          </form>

          <div className="w-full sm:w-64">
            <Select
              aria-label="Filter by device model"
              value={modelId}
              onChange={(e) => updateParams({ modelId: e.target.value || null, page: '1' })}
              className="h-9 py-1.5"
            >
              <option value="">All Device Models</option>
              {(modelsQuery.data?.items ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </div>

          {(q || modelId) && (
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
        rows={profilesQuery.data?.items ?? []}
        rowKey={(p) => p.id}
        total={profilesQuery.data?.total ?? 0}
        page={page}
        pageSize={25}
        onPageChange={(next) => updateParams({ page: String(next) })}
        isLoading={profilesQuery.isLoading}
        error={
          profilesQuery.isError
            ? profilesQuery.error instanceof ApiClientError
              ? profilesQuery.error.message
              : 'Unable to load configuration profiles.'
            : null
        }
        onRetry={() => void profilesQuery.refetch()}
        onRowClick={(p) => setHistoryProfile(p)}
        emptyTitle={q || modelId ? 'No matching configuration profiles' : 'No configuration profiles yet'}
        emptyDescription={
          q || modelId
            ? 'Clear your active filters to see all configuration profiles.'
            : 'Create a JSON configuration profile for a device model to standardize settings across your fleet.'
        }
        emptyAction={
          q || modelId ? (
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
          ) : canWrite ? (
            <Button onClick={openCreateModal} icon={<Sliders className="w-4 h-4" />}>
              Create Config Profile
            </Button>
          ) : undefined
        }
      />

      {/* Create / Edit Profile Modal */}
      <Modal
        open={editorModalOpen}
        onClose={() => setEditorModalOpen(false)}
        title={
          editingProfile
            ? `Edit "${editingProfile.name}" (creates v${editingProfile.version + 1})`
            : 'New Configuration Profile'
        }
        description={
          editingProfile
            ? 'Saving increments the profile version and preserves previous snapshots in version history.'
            : 'Define a model-specific JSON configuration starting at version 1.'
        }
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditorModalOpen(false)}>
              Cancel
            </Button>
            <Button loading={saveMutation.isPending} onClick={handleSaveSubmit}>
              {editingProfile ? `Save as v${editingProfile.version + 1}` : 'Create Profile'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700"
            >
              {formError}
            </div>
          )}

          <Input
            label="Profile Name"
            required
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            placeholder="e.g. TH-200 Cold Chain 15 s"
          />

          <Select
            label="Device Model"
            required
            disabled={Boolean(editingProfile)}
            value={formModelId}
            onChange={(e) => setFormModelId(e.target.value)}
            hint={
              editingProfile
                ? 'Device model cannot be changed after creation.'
                : 'Profile can only be pushed to devices matching this model.'
            }
          >
            <option value="">Select model...</option>
            {(modelsQuery.data?.items ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>

          <JsonEditor
            label="Configuration JSON Payload"
            rows={9}
            value={formPayloadText}
            onChange={setFormPayloadText}
          />
        </div>
      </Modal>

      {/* Version History Drawer */}
      <Drawer
        open={Boolean(historyProfile)}
        onClose={() => setHistoryProfile(null)}
        title={historyProfile?.name ?? 'Version History'}
        subtitle={
          historyProfile
            ? `${historyProfile.modelName ?? historyProfile.modelId} · Current v${historyProfile.version}`
            : undefined
        }
      >
        {historyProfile && (
          <div className="space-y-5">
            {canWrite && (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const p = historyProfile;
                    setHistoryProfile(null);
                    openEditModal(p);
                  }}
                  icon={<Pencil className="w-3.5 h-3.5" />}
                >
                  Edit (Create v{historyProfile.version + 1})
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    const p = historyProfile;
                    setHistoryProfile(null);
                    openPushModal(p);
                  }}
                  icon={<Send className="w-3.5 h-3.5" />}
                >
                  Push v{historyProfile.version}
                </Button>
              </div>
            )}

            {versionsQuery.isError ? (
              <ErrorState
                message={
                  versionsQuery.error instanceof ApiClientError
                    ? versionsQuery.error.message
                    : 'Unable to load version history.'
                }
                onRetry={() => void versionsQuery.refetch()}
              />
            ) : versionsQuery.isLoading ? (
              <div className="space-y-3">
                <div className="h-28 bg-slate-100 rounded-xl animate-pulse" />
                <div className="h-28 bg-slate-100 rounded-xl animate-pulse" />
              </div>
            ) : (versionsQuery.data?.items ?? []).length === 0 ? (
              <p className="text-sm text-slate-600">No version snapshots recorded.</p>
            ) : (
              <div className="space-y-4">
                {(versionsQuery.data?.items ?? []).map((v) => (
                  <div
                    key={v.id}
                    className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md border border-indigo-200 bg-indigo-50 text-indigo-700 font-mono text-xs font-semibold">
                        v{v.version}
                      </span>
                      <span className="text-xs font-mono text-slate-500">
                        {formatLocalDateTime(v.createdAt)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      Saved by <span className="text-slate-700 font-medium">{v.createdByName ?? v.createdBy}</span>
                    </p>
                    <pre className="rounded-lg bg-slate-900 text-slate-100 p-3 text-xs font-mono overflow-x-auto">
                      {JSON.stringify(v.payload, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Drawer>

      {/* Push Config Modal */}
      <Modal
        open={Boolean(pushProfile)}
        onClose={() => {
          setPushProfile(null);
          setPushResult(null);
        }}
        title={
          pushProfile ? `Push "${pushProfile.name}" (v${pushProfile.version})` : 'Push Configuration'
        }
        description="Devices matching the profile model will be marked PENDING and receive the payload on their next poll."
        size="md"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setPushProfile(null);
                setPushResult(null);
              }}
            >
              {pushResult ? 'Close' : 'Cancel'}
            </Button>
            {!pushResult && (
              <Button
                loading={pushMutation.isPending}
                disabled={!pushTargetValue.trim()}
                onClick={() => {
                  if (!pushProfile) return;
                  pushMutation.mutate({
                    profileId: pushProfile.id,
                    targetType: pushTargetType,
                    targetValue: pushTargetValue.trim(),
                  });
                }}
                icon={<Send className="w-4 h-4" />}
              >
                Push Configuration
              </Button>
            )}
          </>
        }
      >
        {pushProfile && (
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-700">
              Model scope: <strong className="text-slate-900">{pushProfile.modelName ?? pushProfile.modelId}</strong> ·
              Version <span className="font-mono font-semibold">v{pushProfile.version}</span>
            </div>

            {!pushResult ? (
              <>
                <Select
                  label="Target Scope"
                  value={pushTargetType}
                  onChange={(e) => {
                    setPushTargetType(e.target.value as ConfigPushTargetType);
                    setPushTargetValue('');
                  }}
                >
                  <option value="DEVICE">Single Device</option>
                  <option value="SITE">Site (all matching model devices)</option>
                  <option value="TAG">Tag (all matching model devices)</option>
                </Select>

                {pushTargetType === 'DEVICE' && (
                  <Select
                    label="Target Device"
                    required
                    value={pushTargetValue}
                    onChange={(e) => setPushTargetValue(e.target.value)}
                  >
                    <option value="">Select a device...</option>
                    {candidateDevices.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({d.serialNumber}) — {d.state} / {d.connectivity}
                      </option>
                    ))}
                  </Select>
                )}

                {pushTargetType === 'SITE' && (
                  <Select
                    label="Target Site"
                    required
                    value={pushTargetValue}
                    onChange={(e) => setPushTargetValue(e.target.value)}
                  >
                    <option value="">Select a site...</option>
                    {(sitesQuery.data?.items ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.location})
                      </option>
                    ))}
                  </Select>
                )}

                {pushTargetType === 'TAG' && (
                  <Select
                    label="Target Tag"
                    required
                    value={pushTargetValue}
                    onChange={(e) => setPushTargetValue(e.target.value)}
                  >
                    <option value="">Select a tag...</option>
                    {(tagsQuery.data?.items ?? []).map((t) => (
                      <option key={t} value={t}>
                        #{t}
                      </option>
                    ))}
                  </Select>
                )}
              </>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                    <p className="text-xs text-emerald-800">Queued</p>
                    <p className="text-xl font-semibold font-mono text-emerald-900">
                      {pushResult.queuedCount}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs text-slate-600">Skipped</p>
                    <p className="text-xl font-semibold font-mono text-slate-900">
                      {pushResult.skippedCount}
                    </p>
                  </div>
                </div>

                <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
                  {pushResult.results.map((r) => (
                    <div
                      key={r.deviceId}
                      className="px-3 py-2 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900 truncate">{r.deviceName}</p>
                        <p className="font-mono text-slate-500">{r.serialNumber}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <StatusChip
                          status={r.status === 'QUEUED' ? 'PENDING' : 'UNKNOWN'}
                          label={r.status === 'QUEUED' ? 'Pending' : 'Skipped'}
                        />
                        {r.reason && <p className="text-[11px] text-slate-500 mt-0.5">{r.reason}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
