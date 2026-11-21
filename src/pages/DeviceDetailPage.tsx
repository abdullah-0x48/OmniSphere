import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  History,
  KeyRound,
  PauseCircle,
  Pencil,
  PlayCircle,
  PowerOff,
  Wrench,
} from 'lucide-react';
import { useParams } from 'react-router-dom';
import type {
  DeviceDetail,
  DeviceLifecycleAction,
  DeviceProvisioningPayload,
  DeviceRegistrationResponse,
  DeviceTimelineEvent,
  PaginatedResponse,
  Site,
} from '../../shared/types.ts';
import { ApiClientError, apiRequest } from '../api/client.ts';
import { useAuth } from '../auth/AuthContext.tsx';
import { ProvisioningModal } from '../components/devices/ProvisioningModal.tsx';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  PageHeader,
  RelativeTime,
  Select,
  StatusChip,
  Tabs,
  Textarea,
  useToast,
} from '../components/ui/index.ts';
import { formatLocalDateTime } from '../utils/format.ts';

function formatUptime(uptimeSec: number | undefined): string {
  if (uptimeSec === undefined || uptimeSec === null) return '—';
  const days = Math.floor(uptimeSec / 86400);
  const hours = Math.floor((uptimeSec % 86400) / 3600);
  const mins = Math.floor((uptimeSec % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export function DeviceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, activeTenantId } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const canManage = user?.role === 'CLIENT_ADMIN' || user?.role === 'SUPPORT_ENGINEER';
  const isClientAdmin = user?.role === 'CLIENT_ADMIN';

  const [activeTab, setActiveTab] = useState<'overview' | 'timeline'>('overview');
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editSiteId, setEditSiteId] = useState('');
  const [editTags, setEditTags] = useState('');

  const [regenConfirmOpen, setRegenConfirmOpen] = useState(false);
  const [provisioning, setProvisioning] = useState<DeviceProvisioningPayload | null>(null);

  const [stateDialog, setStateDialog] = useState<{
    action: DeviceLifecycleAction;
    title: string;
    message: string;
    confirmLabel: string;
    requireReason: boolean;
    variant: 'primary' | 'danger';
  } | null>(null);
  const [stateReason, setStateReason] = useState('');

  const [decommOpen, setDecommOpen] = useState(false);
  const [decommReason, setDecommReason] = useState('');

  const detailQuery = useQuery({
    queryKey: ['device', id],
    enabled: Boolean(id),
    queryFn: () => apiRequest<DeviceDetail>(`/devices/${id}`),
  });

  const timelineQuery = useQuery({
    queryKey: ['device-timeline', id],
    enabled: Boolean(id),
    queryFn: () => apiRequest<{ items: DeviceTimelineEvent[] }>(`/devices/${id}/history`),
  });

  const sitesQuery = useQuery({
    queryKey: ['sites-options', activeTenantId],
    enabled: canManage,
    queryFn: () =>
      apiRequest<PaginatedResponse<Site>>('/sites', { query: { page: 1, pageSize: 200 } }),
  });

  const refreshDevice = () => {
    void queryClient.invalidateQueries({ queryKey: ['device', id] });
    void queryClient.invalidateQueries({ queryKey: ['device-timeline', id] });
    void queryClient.invalidateQueries({ queryKey: ['devices'] });
  };

  const editMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/devices/${id}`, {
        method: 'PATCH',
        body: {
          name: editName.trim(),
          siteId: editSiteId,
          tags: editTags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
        },
      }),
    onSuccess: () => {
      toast({ kind: 'success', title: 'Device updated' });
      setEditOpen(false);
      refreshDevice();
    },
    onError: (err) => {
      const msg = err instanceof ApiClientError ? err.message : 'Unable to update device';
      toast({ kind: 'error', title: 'Update failed', description: msg });
    },
  });

  const regenMutation = useMutation({
    mutationFn: () =>
      apiRequest<DeviceRegistrationResponse>(`/devices/${id}/regenerate-key`, {
        method: 'POST',
      }),
    onSuccess: (res) => {
      setRegenConfirmOpen(false);
      setProvisioning(res.provisioning);
      toast({ kind: 'success', title: 'API key rotated', description: 'Old key invalidated immediately.' });
      refreshDevice();
    },
    onError: (err) => {
      const msg = err instanceof ApiClientError ? err.message : 'Unable to rotate key';
      toast({ kind: 'error', title: 'Key rotation failed', description: msg });
    },
  });

  const stateMutation = useMutation({
    mutationFn: (vars: { action: DeviceLifecycleAction; reason?: string }) =>
      apiRequest<DeviceDetail>(`/devices/${id}/state`, {
        method: 'POST',
        body: vars,
      }),
    onSuccess: (updated) => {
      toast({
        kind: 'success',
        title: `Device state changed to ${updated.state.replaceAll('_', ' ')}`,
      });
      setStateDialog(null);
      setStateReason('');
      setDecommOpen(false);
      setDecommReason('');
      refreshDevice();
    },
    onError: (err) => {
      const msg = err instanceof ApiClientError ? err.message : 'State transition rejected';
      toast({ kind: 'error', title: 'Transition rejected', description: msg });
    },
  });

  if (detailQuery.isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-64 bg-slate-200 rounded animate-pulse" />
        <div className="h-44 bg-white border border-slate-200 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (detailQuery.error || !detailQuery.data) {
    return (
      <ErrorState
        message={
          detailQuery.error instanceof Error ? detailQuery.error.message : 'Device not found'
        }
        onRetry={() => void detailQuery.refetch()}
      />
    );
  }

  const device = detailQuery.data;
  const isDecommissioned = device.state === 'DECOMMISSIONED';
  const allowed = device.allowedTransitions;

  const openEditModal = () => {
    setEditName(device.name);
    setEditSiteId(device.siteId);
    setEditTags(device.tags.join(', '));
    setEditOpen(true);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={device.name}
        description={`${device.serialNumber} · ${device.modelName ?? device.modelId} · ${device.siteName ?? device.siteId}`}
        breadcrumbs={[{ label: 'Devices', to: '/devices' }, { label: device.name }]}
        actions={
          canManage && !isDecommissioned ? (
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="secondary"
                size="sm"
                onClick={openEditModal}
                icon={<Pencil className="w-3.5 h-3.5" />}
              >
                Edit
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setRegenConfirmOpen(true)}
                icon={<KeyRound className="w-3.5 h-3.5" />}
              >
                Regenerate Key
              </Button>

              {allowed.includes('SUSPENDED') && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setStateReason('');
                    setStateDialog({
                      action: 'SUSPEND',
                      title: 'Suspend Device',
                      message:
                        'Suspended devices are rejected at the device API and stop generating alerts until resumed.',
                      confirmLabel: 'Suspend Device',
                      requireReason: true,
                      variant: 'danger',
                    });
                  }}
                  icon={<PauseCircle className="w-3.5 h-3.5" />}
                >
                  Suspend
                </Button>
              )}

              {device.state === 'SUSPENDED' && allowed.includes('ACTIVE') && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    setStateReason('');
                    setStateDialog({
                      action: 'RESUME',
                      title: 'Resume Device',
                      message: 'Return this suspended device to ACTIVE operational state?',
                      confirmLabel: 'Resume Device',
                      requireReason: false,
                      variant: 'primary',
                    });
                  }}
                  icon={<PlayCircle className="w-3.5 h-3.5" />}
                >
                  Resume
                </Button>
              )}

              {allowed.includes('UNDER_MAINTENANCE') && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setStateReason('');
                    setStateDialog({
                      action: 'SET_UNDER_MAINTENANCE',
                      title: 'Set Under Maintenance',
                      message:
                        'Alerts are suppressed while the device is Under Maintenance. You can return it to Active when work finishes.',
                      confirmLabel: 'Enter Maintenance',
                      requireReason: false,
                      variant: 'primary',
                    });
                  }}
                  icon={<Wrench className="w-3.5 h-3.5" />}
                >
                  Maintenance
                </Button>
              )}

              {device.state === 'UNDER_MAINTENANCE' && allowed.includes('ACTIVE') && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    setStateReason('');
                    setStateDialog({
                      action: 'SET_ACTIVE',
                      title: 'Return Device to Active',
                      message: 'Mark maintenance finished and restore ACTIVE status?',
                      confirmLabel: 'Set Active',
                      requireReason: false,
                      variant: 'primary',
                    });
                  }}
                  icon={<PlayCircle className="w-3.5 h-3.5" />}
                >
                  Set Active
                </Button>
              )}

              {isClientAdmin && allowed.includes('DECOMMISSIONED') && (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    setDecommReason('');
                    setDecommOpen(true);
                  }}
                  icon={<PowerOff className="w-3.5 h-3.5" />}
                >
                  Decommission
                </Button>
              )}
            </div>
          ) : undefined
        }
      />

      {/* Status Summary Strip */}
      <Card className="p-4">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-sm">
          <div>
            <p className="text-xs text-slate-500 mb-1">Lifecycle State</p>
            <StatusChip status={device.state} />
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Connectivity</p>
            <div className="flex items-center gap-1.5">
              <StatusChip status={device.connectivity} />
              <RelativeTime iso={device.lastSeenAt} />
            </div>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Firmware</p>
            <p className="font-mono text-sm font-medium text-slate-900">
              {device.firmwareVersion ?? 'Not reported'}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Config Status</p>
            <StatusChip status={device.config.status === 'NONE' ? 'UNKNOWN' : device.config.status} label={device.config.status === 'NONE' ? 'None' : undefined} />
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">API Credentials</p>
            <p className="font-mono text-xs text-slate-700">
              {device.apiKeyLast4 ? `omk_••••${device.apiKeyLast4}` : 'Revoked'}
            </p>
          </div>
        </div>
      </Card>

      {isDecommissioned && (
        <div
          role="status"
          className="rounded-xl border border-slate-300 bg-slate-100 px-4 py-3 flex items-start gap-3 text-sm text-slate-700"
        >
          <AlertTriangle className="w-5 h-5 text-slate-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-slate-900">
              Decommissioned (Terminal State — Read-Only)
            </p>
            <p className="text-xs text-slate-600 mt-0.5">
              {device.decommissionReason ?? 'Hardware retired.'}{' '}
              {device.decommissionedAt && (
                <span>Revoked on {formatLocalDateTime(device.decommissionedAt)}.</span>
              )}
            </p>
          </div>
        </div>
      )}

      <Tabs
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'timeline', label: 'Timeline', count: timelineQuery.data?.items.length },
        ]}
        active={activeTab}
        onChange={(tab) => setActiveTab(tab as 'overview' | 'timeline')}
      />

      {activeTab === 'overview' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Identity Card */}
          <Card className="p-5 lg:col-span-2">
            <h2 className="text-sm font-semibold text-slate-900 mb-4">Device Identity</h2>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-sm">
              <div>
                <dt className="text-xs text-slate-500">Device ID</dt>
                <dd className="font-mono text-xs text-slate-900 mt-0.5">{device.id}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Serial Number</dt>
                <dd className="font-mono text-xs text-slate-900 mt-0.5">{device.serialNumber}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Hardware ID (MAC / IMEI)</dt>
                <dd className="font-mono text-xs text-slate-900 mt-0.5">{device.hardwareId}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Organization</dt>
                <dd className="text-slate-900 mt-0.5">
                  {device.tenantName ?? device.tenantId}{' '}
                  {device.tenantCode && (
                    <span className="font-mono text-xs text-slate-500">({device.tenantCode})</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Device Model</dt>
                <dd className="text-slate-900 mt-0.5">
                  {device.model?.name ?? device.modelId}
                  {device.model && (
                    <span className="block text-xs text-slate-500">
                      {device.model.manufacturer} · {device.model.hardwareRevision}
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Assigned Site</dt>
                <dd className="text-slate-900 mt-0.5">
                  {device.site?.name ?? device.siteId}
                  {device.site && (
                    <span className="block text-xs text-slate-500">{device.site.location}</span>
                  )}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-slate-500 mb-1">Tags</dt>
                <dd className="flex items-center gap-1.5 flex-wrap">
                  {device.tags.length === 0 ? (
                    <span className="text-xs text-slate-400">No tags assigned</span>
                  ) : (
                    device.tags.map((t) => (
                      <span
                        key={t}
                        className="px-2 py-0.5 text-xs font-mono bg-slate-100 text-slate-700 rounded border border-slate-200"
                      >
                        {t}
                      </span>
                    ))
                  )}
                </dd>
              </div>
            </dl>
          </Card>

          {/* Health & Diagnostics Card */}
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <Activity className="w-4 h-4 text-indigo-600" />
              Latest Health & Diagnostics
            </h2>
            <dl className="space-y-3 text-sm">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <dt className="text-xs text-slate-500">CPU Load</dt>
                <dd className="font-mono tabular-nums text-slate-900">
                  {device.latestHealth.cpuLoad !== undefined ? `${device.latestHealth.cpuLoad}%` : '—'}
                </dd>
              </div>
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <dt className="text-xs text-slate-500">Memory Usage</dt>
                <dd className="font-mono tabular-nums text-slate-900">
                  {device.latestHealth.memoryUsage !== undefined
                    ? `${device.latestHealth.memoryUsage}%`
                    : '—'}
                </dd>
              </div>
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <dt className="text-xs text-slate-500">Battery / Power</dt>
                <dd className="font-mono tabular-nums text-slate-900">
                  {device.latestHealth.batteryLevel === null
                    ? 'Mains powered'
                    : device.latestHealth.batteryLevel !== undefined
                      ? `${device.latestHealth.batteryLevel}%`
                      : '—'}
                </dd>
              </div>
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <dt className="text-xs text-slate-500">Signal Strength</dt>
                <dd className="font-mono tabular-nums text-slate-900">
                  {device.latestHealth.signalStrength !== undefined
                    ? `${device.latestHealth.signalStrength} dBm`
                    : '—'}
                </dd>
              </div>
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <dt className="text-xs text-slate-500">Uptime</dt>
                <dd className="font-mono tabular-nums text-slate-900">
                  {formatUptime(device.latestHealth.uptimeSec)}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-xs text-slate-500">Invalid Payloads</dt>
                <dd className="font-mono tabular-nums text-slate-900">
                  {device.invalidPayloadCount}
                </dd>
              </div>
            </dl>
          </Card>

          {/* Latest Metrics Card */}
          <Card className="p-5 lg:col-span-3">
            <h2 className="text-sm font-semibold text-slate-900 mb-3">
              Model Metrics & Latest Readings
            </h2>
            {device.model && device.model.metrics.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {device.model.metrics.map((m) => {
                  const val = device.latestMetrics[m.key];
                  return (
                    <div
                      key={m.key}
                      className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5"
                    >
                      <p className="text-xs font-medium text-slate-500">{m.label}</p>
                      <p className="mt-1.5 text-xl font-semibold font-mono tabular-nums text-slate-900">
                        {val !== undefined ? `${val}${m.unit ? ` ${m.unit}` : ''}` : '—'}
                      </p>
                      <p className="mt-1 text-[11px] font-mono text-slate-500">
                        {m.key}
                        {m.type === 'number' && (m.min !== null || m.max !== null)
                          ? ` · range ${m.min ?? '−∞'}..${m.max ?? '+∞'}${m.unit ? ` ${m.unit}` : ''}`
                          : ` · ${m.type}`}
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-slate-500">No metrics configured for this device model.</p>
            )}
          </Card>
        </div>
      ) : (
        /* Timeline Tab */
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <History className="w-4 h-4 text-indigo-600" />
            Lifecycle & Event Timeline
          </h2>

          {timelineQuery.isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-12 bg-slate-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : (timelineQuery.data?.items ?? []).length === 0 ? (
            <EmptyState
              title="No timeline events yet"
              description="Lifecycle transitions, connectivity events, and credential updates will appear here."
            />
          ) : (
            <ol className="divide-y divide-slate-100">
              {(timelineQuery.data?.items ?? []).map((ev) => (
                <li key={ev.id} className="py-3.5 flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-slate-900">{ev.title}</span>
                      <span className="text-[11px] font-mono uppercase text-slate-500 px-1.5 py-0.5 bg-slate-100 rounded">
                        {ev.kind.replace('_', ' ')}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-0.5">{ev.description}</p>
                    <p className="text-xs text-slate-400 mt-1">
                      Actor: <span className="text-slate-600">{ev.actorName ?? ev.actorId}</span>
                    </p>
                  </div>
                  <div className="text-xs font-mono text-slate-500 shrink-0 sm:text-right">
                    <p>{formatLocalDateTime(ev.at)}</p>
                    <RelativeTime iso={ev.at} />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      )}

      {/* Edit Device Modal */}
      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit Device"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={editMutation.isPending}
              disabled={editName.trim().length < 2 || !editSiteId}
              onClick={() => editMutation.mutate()}
            >
              Save Changes
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Device Name"
            required
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
          />
          <Select
            label="Assigned Site"
            required
            value={editSiteId}
            onChange={(e) => setEditSiteId(e.target.value)}
          >
            {(sitesQuery.data?.items ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Input
            label="Tags"
            value={editTags}
            onChange={(e) => setEditTags(e.target.value)}
            placeholder="critical, line-1"
            hint="Comma-separated list of tags."
          />
        </div>
      </Modal>

      {/* Regenerate Key Confirm */}
      <ConfirmDialog
        open={regenConfirmOpen}
        onClose={() => setRegenConfirmOpen(false)}
        onConfirm={() => regenMutation.mutate()}
        title="Regenerate Device API Key"
        message="Rotating the API key immediately invalidates the existing key. Connected hardware using the old key will receive 401 until updated with the new provisioning file."
        confirmLabel="Regenerate Key"
        variant="danger"
        loading={regenMutation.isPending}
      />

      {/* Lifecycle State Transition Dialog (Suspend / Resume / Maintenance / Set Active) */}
      <ConfirmDialog
        open={Boolean(stateDialog)}
        onClose={() => setStateDialog(null)}
        onConfirm={() => {
          if (!stateDialog) return;
          if (stateDialog.requireReason && !stateReason.trim()) {
            toast({ kind: 'error', title: 'Reason is required' });
            return;
          }
          stateMutation.mutate({
            action: stateDialog.action,
            reason: stateReason.trim() || undefined,
          });
        }}
        title={stateDialog?.title ?? ''}
        message={stateDialog?.message ?? ''}
        confirmLabel={stateDialog?.confirmLabel ?? 'Confirm'}
        variant={stateDialog?.variant ?? 'primary'}
        loading={stateMutation.isPending}
        extraField={
          stateDialog ? (
            <Textarea
              label={stateDialog.requireReason ? 'Reason (required)' : 'Reason (optional)'}
              required={stateDialog.requireReason}
              rows={3}
              value={stateReason}
              onChange={(e) => setStateReason(e.target.value)}
              placeholder="Record the operational reason for this lifecycle change..."
            />
          ) : undefined
        }
      />

      {/* Decommission ConfirmDialog (CA only, requires typing exact serial number per Section 11) */}
      <ConfirmDialog
        open={decommOpen}
        onClose={() => setDecommOpen(false)}
        onConfirm={() => {
          if (!decommReason.trim()) {
            toast({ kind: 'error', title: 'Decommission reason is required' });
            return;
          }
          stateMutation.mutate({ action: 'DECOMMISSION', reason: decommReason.trim() });
        }}
        title="Decommission Device"
        message={`This permanently retires "${device.name}", immediately revokes its API key, and locks its history read-only. This action cannot be undone.`}
        confirmLabel="Decommission Permanently"
        variant="danger"
        loading={stateMutation.isPending}
        requireTypedText={device.serialNumber}
        extraField={
          <Textarea
            label="Decommission Reason"
            required
            rows={2}
            value={decommReason}
            onChange={(e) => setDecommReason(e.target.value)}
            placeholder="e.g. Hardware failed and replaced by new unit"
          />
        }
      />

      <ProvisioningModal
        provisioning={provisioning}
        deviceName={device.name}
        onClose={() => setProvisioning(null)}
      />
    </div>
  );
}
