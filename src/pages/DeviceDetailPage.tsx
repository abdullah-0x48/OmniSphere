import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCircle2,
  History,
  KeyRound,
  PauseCircle,
  Pencil,
  PlayCircle,
  Plus,
  PowerOff,
  Rocket,
  RotateCw,
  Send,
  Sliders,
  Ticket,
  Wrench,
  XCircle,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type {
  AlertPublic,
  ConfigProfilePublic,
  ConfigPushResponse,
  DeviceDetail,
  DeviceLifecycleAction,
  DeviceLiveState,
  DeviceProvisioningPayload,
  DeviceRegistrationResponse,
  DeviceTimelineEvent,
  PaginatedResponse,
  Site,
  TicketPublic,
  WorkOrderPublic,
} from '../../shared/types.ts';
import { ApiClientError, apiRequest } from '../api/client.ts';
import { useAuth } from '../auth/AuthContext.tsx';
import { DeviceTelemetryTab } from '../components/devices/DeviceTelemetryTab.tsx';
import { ProvisioningModal } from '../components/devices/ProvisioningModal.tsx';
import { CreateWorkOrderModal } from '../components/workOrders/CreateWorkOrderModal.tsx';
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
  SeverityChip,
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
  const navigate = useNavigate();

  const canManage = user?.role === 'CLIENT_ADMIN' || user?.role === 'SUPPORT_ENGINEER';
  const isClientAdmin = user?.role === 'CLIENT_ADMIN';
  const isSE = user?.role === 'SUPPORT_ENGINEER';
  const canViewAlerts =
    user?.role === 'SUPPORT_ENGINEER' ||
    user?.role === 'CLIENT_ADMIN' ||
    user?.role === 'CLIENT_MANAGER' ||
    user?.role === 'CLIENT_OPERATOR';
  const canAckAlerts =
    user?.role === 'CLIENT_OPERATOR' ||
    user?.role === 'CLIENT_ADMIN' ||
    user?.role === 'SUPPORT_ENGINEER';
  const canCloseAlerts = user?.role === 'SUPPORT_ENGINEER';

  const [activeTab, setActiveTab] = useState<
    'overview' | 'telemetry' | 'configuration' | 'firmware' | 'alerts' | 'maintenance' | 'timeline'
  >('overview');
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editSiteId, setEditSiteId] = useState('');
  const [editTags, setEditTags] = useState('');

  const [regenConfirmOpen, setRegenConfirmOpen] = useState(false);
  const [restartConfirmOpen, setRestartConfirmOpen] = useState(false);
  const [provisioning, setProvisioning] = useState<DeviceProvisioningPayload | null>(null);
  const [woModalOpen, setWoModalOpen] = useState(false);
  const [pushConfigOpen, setPushConfigOpen] = useState(false);
  const [selectedConfigProfileId, setSelectedConfigProfileId] = useState('');

  const [closeAlertTarget, setCloseAlertTarget] = useState<AlertPublic | null>(null);
  const [closeAlertReason, setCloseAlertReason] = useState('');

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

  const liveQuery = useQuery({
    queryKey: ['device-live', id],
    enabled: Boolean(id),
    queryFn: () => apiRequest<DeviceLiveState>(`/devices/${id}/live`),
    refetchInterval: 5000,
  });

  const timelineQuery = useQuery({
    queryKey: ['device-timeline', id],
    enabled: Boolean(id),
    queryFn: () => apiRequest<{ items: DeviceTimelineEvent[] }>(`/devices/${id}/history`),
  });

  const deviceAlertsQuery = useQuery({
    queryKey: ['device-alerts', id],
    enabled: Boolean(id) && canViewAlerts,
    queryFn: () =>
      apiRequest<PaginatedResponse<AlertPublic>>('/alerts', {
        query: { deviceId: id, page: 1, pageSize: 50 },
      }),
    refetchInterval: 5000,
  });

  const deviceTicketsQuery = useQuery({
    queryKey: ['device-tickets', id],
    enabled: Boolean(id),
    queryFn: () =>
      apiRequest<PaginatedResponse<TicketPublic>>('/tickets', {
        query: { deviceId: id, page: 1, pageSize: 50 },
      }),
    refetchInterval: 10000,
  });

  const deviceWorkOrdersQuery = useQuery({
    queryKey: ['device-work-orders', id],
    enabled: Boolean(id),
    queryFn: () =>
      apiRequest<PaginatedResponse<WorkOrderPublic>>('/work-orders', {
        query: { deviceId: id, page: 1, pageSize: 50 },
      }),
    refetchInterval: 10000,
  });

  const sitesQuery = useQuery({
    queryKey: ['sites-options', activeTenantId],
    enabled: canManage,
    queryFn: () =>
      apiRequest<PaginatedResponse<Site>>('/sites', { query: { page: 1, pageSize: 200 } }),
  });

  const modelConfigProfilesQuery = useQuery({
    queryKey: ['device-config-profiles', activeTenantId, detailQuery.data?.modelId],
    enabled: canManage && Boolean(detailQuery.data?.modelId),
    queryFn: () =>
      apiRequest<PaginatedResponse<ConfigProfilePublic>>('/config-profiles', {
        query: { modelId: detailQuery.data!.modelId, page: 1, pageSize: 100 },
      }),
  });

  const pushConfigMutation = useMutation({
    mutationFn: (profileId: string) =>
      apiRequest<ConfigPushResponse>(`/config-profiles/${profileId}/push`, {
        method: 'POST',
        body: { targetType: 'DEVICE', targetValue: id },
      }),
    onSuccess: (res) => {
      toast({
        kind: 'success',
        title: `Configuration v${res.version} pushed`,
        description: 'Status set to PENDING; device will acknowledge on next command poll.',
      });
      setPushConfigOpen(false);
      refreshDevice();
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Config push failed',
        description: err instanceof ApiClientError ? err.message : 'Unable to push configuration.',
      });
    },
  });

  const refreshDevice = () => {
    void queryClient.invalidateQueries({ queryKey: ['device', id] });
    void queryClient.invalidateQueries({ queryKey: ['device-timeline', id] });
    void queryClient.invalidateQueries({ queryKey: ['device-alerts', id] });
    void queryClient.invalidateQueries({ queryKey: ['device-tickets', id] });
    void queryClient.invalidateQueries({ queryKey: ['device-work-orders', id] });
    void queryClient.invalidateQueries({ queryKey: ['devices'] });
    void queryClient.invalidateQueries({ queryKey: ['alerts-list'] });
  };

  const createTicketFromAlertMutation = useMutation({
    mutationFn: (alertId: string) =>
      apiRequest<TicketPublic>(`/alerts/${alertId}/ticket`, { method: 'POST' }),
    onSuccess: (ticket) => {
      toast({ kind: 'success', title: `Ticket ${ticket.number} created` });
      refreshDevice();
      navigate(`/tickets/${ticket.id}`);
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Unable to create ticket',
        description: err instanceof ApiClientError ? err.message : 'Could not convert alert to ticket.',
      });
    },
  });

  const ackAlertMutation = useMutation({
    mutationFn: (alertId: string) =>
      apiRequest<AlertPublic>(`/alerts/${alertId}/acknowledge`, { method: 'POST' }),
    onSuccess: () => {
      toast({ kind: 'success', title: 'Alert acknowledged' });
      refreshDevice();
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Acknowledge failed',
        description: err instanceof ApiClientError ? err.message : 'Unable to acknowledge alert.',
      });
    },
  });

  const closeAlertMutation = useMutation({
    mutationFn: (vars: { alertId: string; reason: string }) =>
      apiRequest<AlertPublic>(`/alerts/${vars.alertId}/close`, {
        method: 'POST',
        body: { reason: vars.reason },
      }),
    onSuccess: () => {
      toast({ kind: 'success', title: 'Alert closed' });
      setCloseAlertTarget(null);
      setCloseAlertReason('');
      refreshDevice();
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Close failed',
        description: err instanceof ApiClientError ? err.message : 'Unable to close alert.',
      });
    },
  });

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

  const restartMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/devices/${id}/commands`, {
        method: 'POST',
        body: { type: 'RESTART' },
      }),
    onSuccess: () => {
      setRestartConfirmOpen(false);
      toast({
        kind: 'success',
        title: 'Restart command queued',
        description: 'The device will execute and acknowledge on its next command poll.',
      });
      refreshDevice();
    },
    onError: (err) => {
      const msg = err instanceof ApiClientError ? err.message : 'Unable to queue restart';
      toast({ kind: 'error', title: 'Restart failed', description: msg });
    },
  });

  if (detailQuery.isLoading) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading device details">
        <div className="space-y-2">
          <div className="h-4 w-36 bg-slate-200 rounded animate-pulse" />
          <div className="h-7 w-72 bg-slate-200 rounded animate-pulse" />
        </div>
        <div className="h-24 bg-white border border-slate-200 rounded-xl animate-pulse" />
        <div className="h-10 w-96 max-w-full bg-slate-200 rounded-lg animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="h-64 lg:col-span-2 bg-white border border-slate-200 rounded-xl animate-pulse" />
          <div className="h-64 bg-white border border-slate-200 rounded-xl animate-pulse" />
        </div>
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

  const baseDevice = detailQuery.data;
  const live = liveQuery.data;
  const device: DeviceDetail = live
    ? {
        ...baseDevice,
        state: live.state,
        connectivity: live.connectivity,
        lastSeenAt: live.lastSeenAt ?? baseDevice.lastSeenAt,
        firmwareVersion: live.firmwareVersion ?? baseDevice.firmwareVersion,
        latestMetrics:
          Object.keys(live.latestMetrics).length > 0 ? live.latestMetrics : baseDevice.latestMetrics,
        latestHealth:
          Object.keys(live.latestHealth).length > 0 ? live.latestHealth : baseDevice.latestHealth,
        invalidPayloadCount: Math.max(baseDevice.invalidPayloadCount, live.invalidPayloadCount),
      }
    : baseDevice;

  const isDecommissioned = device.state === 'DECOMMISSIONED';
  const allowed = device.allowedTransitions;
  const canRestart =
    canManage && (device.state === 'ACTIVE' || device.state === 'UNDER_MAINTENANCE');

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
              {canRestart && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setRestartConfirmOpen(true)}
                  icon={<RotateCw className="w-3.5 h-3.5" />}
                >
                  Restart
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const list = modelConfigProfilesQuery.data?.items ?? [];
                  setSelectedConfigProfileId(
                    device.config.profileId ?? list[0]?.id ?? '',
                  );
                  setPushConfigOpen(true);
                }}
                icon={<Send className="w-3.5 h-3.5" />}
              >
                Push Config
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
          { id: 'telemetry', label: 'Telemetry' },
          { id: 'configuration', label: 'Configuration' },
          {
            id: 'firmware',
            label: 'Firmware',
            count: (device.recentRolloutJobs ?? []).length,
          },
          {
            id: 'alerts',
            label: canViewAlerts ? 'Tickets & Alerts' : 'Tickets',
            count:
              (canViewAlerts
                ? (deviceAlertsQuery.data?.items ?? []).filter((a) => a.status !== 'CLOSED').length
                : 0) +
              (deviceTicketsQuery.data?.items ?? []).filter((t) => t.status !== 'CLOSED').length,
          },
          {
            id: 'maintenance',
            label: 'Maintenance',
            count: (deviceWorkOrdersQuery.data?.items ?? []).length,
          },
          { id: 'timeline', label: 'Timeline', count: timelineQuery.data?.items.length },
        ]}
        active={activeTab}
        onChange={(tab) =>
          setActiveTab(
            tab as
              | 'overview'
              | 'telemetry'
              | 'configuration'
              | 'firmware'
              | 'alerts'
              | 'maintenance'
              | 'timeline',
          )
        }
      />

      {activeTab === 'telemetry' ? (
        <DeviceTelemetryTab device={device} />
      ) : activeTab === 'configuration' ? (
        <div className="space-y-6">
          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-indigo-600" />
                  Assigned Configuration Profile
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Configuration is delivered on device handshake or command poll and confirmed via config-ack.
                </p>
              </div>
              {canManage && !isDecommissioned && (
                <Button
                  size="sm"
                  onClick={() => {
                    const list = modelConfigProfilesQuery.data?.items ?? [];
                    setSelectedConfigProfileId(device.config.profileId ?? list[0]?.id ?? '');
                    setPushConfigOpen(true);
                  }}
                  icon={<Send className="w-3.5 h-3.5" />}
                >
                  Push New Config
                </Button>
              )}
            </div>

            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-slate-100 text-sm">
              <div>
                <dt className="text-xs text-slate-500">Profile</dt>
                <dd className="font-medium text-slate-900 mt-0.5">
                  {device.configProfileName ??
                    (device.config.profileId ? device.config.profileId : 'None assigned')}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Version</dt>
                <dd className="font-mono text-slate-900 mt-0.5">
                  {device.config.version !== null ? `v${device.config.version}` : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Delivery Status</dt>
                <dd className="mt-0.5">
                  <StatusChip
                    status={device.config.status}
                    label={device.config.status === 'NONE' ? 'None' : undefined}
                  />
                </dd>
              </div>
            </dl>

            {device.config.error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">
                Last configuration error: <span className="font-mono">{device.config.error}</span>
              </div>
            )}

            {device.configProfilePayload && (
              <div>
                <p className="text-xs font-medium text-slate-600 mb-1.5">Active Payload JSON</p>
                <pre className="rounded-xl bg-slate-900 text-slate-100 p-4 text-xs font-mono overflow-x-auto">
                  {JSON.stringify(device.configProfilePayload, null, 2)}
                </pre>
              </div>
            )}
          </Card>

          <Card className="p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-3">
              Recent Configuration Push Commands
            </h3>
            {(device.recentConfigCommands ?? []).length === 0 ? (
              <EmptyState
                title="No configuration pushes recorded"
                description="When a configuration profile is pushed to this device, delivery and acknowledgement history will appear here."
                action={
                  canManage && !isDecommissioned ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        const list = modelConfigProfilesQuery.data?.items ?? [];
                        setSelectedConfigProfileId(device.config.profileId ?? list[0]?.id ?? '');
                        setPushConfigOpen(true);
                      }}
                      icon={<Send className="w-3.5 h-3.5" />}
                    >
                      Push New Config
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <ul className="divide-y divide-slate-100 text-xs">
                {(device.recentConfigCommands ?? []).map((cmd) => (
                  <li key={cmd.id} className="py-3 flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                      <StatusChip status={cmd.status} />
                      <span className="font-medium text-slate-900">
                        {String(cmd.payload.profileName ?? cmd.payload.profileId ?? 'Config push')}
                      </span>
                      {cmd.payload.version !== undefined && (
                        <span className="font-mono text-indigo-700">v{String(cmd.payload.version)}</span>
                      )}
                    </div>
                    <div className="font-mono text-slate-500">
                      Queued {formatLocalDateTime(cmd.createdAt)}
                      {cmd.ackedAt ? ` · Acked ${formatLocalDateTime(cmd.ackedAt)}` : ''}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      ) : activeTab === 'firmware' ? (
        <div className="space-y-6">
          <Card className="p-5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Rocket className="w-4 h-4 text-indigo-600" />
                  Current Firmware
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Model family:{' '}
                  <span className="font-mono text-slate-700">
                    {device.model?.supportedFirmwareFamily ?? '—'}
                  </span>
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-lg font-semibold text-slate-900 bg-slate-100 border border-slate-200 px-3 py-1 rounded-lg">
                  v{device.firmwareVersion ?? '—'}
                </span>
                {canManage && !isDecommissioned && (
                  <Link
                    to={`/rollouts?create=1&deviceIds=${device.id}`}
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 transition-colors"
                  >
                    <Rocket className="w-3.5 h-3.5" />
                    Start Rollout
                  </Link>
                )}
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-3">OTA Update History</h3>
            {(device.recentRolloutJobs ?? []).length === 0 ? (
              <EmptyState
                title="No OTA rollout jobs for this device"
                description="Firmware updates dispatched to this device will track DOWNLOADING, INSTALLING, VERIFIED, or FAILED states here."
                action={
                  canManage && !isDecommissioned ? (
                    <Link
                      to={`/rollouts?create=1&deviceIds=${device.id}`}
                      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 transition-colors"
                    >
                      <Rocket className="w-3.5 h-3.5" />
                      Start Rollout
                    </Link>
                  ) : undefined
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70">
                      <th className="px-3 py-2 font-semibold text-slate-600">Rollout</th>
                      <th className="px-3 py-2 font-semibold text-slate-600">Version Change</th>
                      <th className="px-3 py-2 font-semibold text-slate-600">Status</th>
                      <th className="px-3 py-2 font-semibold text-slate-600">Error</th>
                      <th className="px-3 py-2 font-semibold text-slate-600 text-right">Updated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(device.recentRolloutJobs ?? []).map((job) => (
                      <tr key={job.id}>
                        <td className="px-3 py-2.5">
                          {user?.role !== 'FIELD_TECHNICIAN' && user?.role !== 'CLIENT_OPERATOR' ? (
                            <Link
                              to={`/rollouts/${job.rolloutId}`}
                              className="font-mono font-semibold text-indigo-600 hover:underline"
                            >
                              {job.rolloutId}
                            </Link>
                          ) : (
                            <span className="font-mono text-slate-700">{job.rolloutId}</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-slate-700">
                          {job.fromVersion ?? 'none'} → <strong>{job.toVersion}</strong>
                        </td>
                        <td className="px-3 py-2.5">
                          <StatusChip status={job.status} />
                        </td>
                        <td className="px-3 py-2.5 font-mono text-red-700">
                          {job.errorCode ?? '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <RelativeTime iso={job.updatedAt} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      ) : activeTab === 'alerts' ? (
        <div className="space-y-6">
          {canViewAlerts && (
            <Card className="p-5">
              <div className="flex items-center justify-between gap-3 mb-4">
                <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Bell className="w-4 h-4 text-indigo-600" />
                  Device Alerts
                </h2>
                <Link to="/alerts" className="text-xs font-medium text-indigo-600 hover:text-indigo-700">
                  View all organization alerts
                </Link>
              </div>
              {deviceAlertsQuery.isError ? (
                <ErrorState
                  message={
                    deviceAlertsQuery.error instanceof ApiClientError
                      ? deviceAlertsQuery.error.message
                      : 'Unable to load device alerts.'
                  }
                  onRetry={() => void deviceAlertsQuery.refetch()}
                />
              ) : deviceAlertsQuery.isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-14 bg-slate-100 rounded-lg animate-pulse" />
                  ))}
                </div>
              ) : (deviceAlertsQuery.data?.items ?? []).length === 0 ? (
                <EmptyState
                  title="No alerts for this device"
                  description="Threshold or offline alerts raised for this device will appear here."
                  action={
                    <Link
                      to="/alerts"
                      className="inline-flex items-center justify-center h-8 px-3 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-800 hover:bg-slate-50 transition-colors"
                    >
                      View all alerts
                    </Link>
                  }
                />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {(deviceAlertsQuery.data?.items ?? []).map((a) => (
                    <li
                      key={a.id}
                      className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <SeverityChip severity={a.severity} />
                          <StatusChip status={a.status} />
                          {a.escalationLevel > 0 && (
                            <span className="px-1.5 py-0.5 rounded text-[11px] font-mono font-semibold bg-red-100 text-red-800">
                              L{a.escalationLevel}
                            </span>
                          )}
                          <Link
                            to={`/alerts?alertId=${a.id}`}
                            className="text-sm font-medium text-slate-900 hover:text-indigo-600"
                          >
                            {a.message}
                          </Link>
                        </div>
                        <p className="text-xs text-slate-500 mt-1 font-mono">
                          Opened {formatLocalDateTime(a.createdAt)} · <RelativeTime iso={a.createdAt} />
                          {a.closeReason ? ` · Resolution: ${a.closeReason}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 flex-wrap">
                        {canAckAlerts && a.status === 'OPEN' && (
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={ackAlertMutation.isPending && ackAlertMutation.variables === a.id}
                            onClick={() => ackAlertMutation.mutate(a.id)}
                            icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                          >
                            Acknowledge
                          </Button>
                        )}
                        {a.ticketId ? (
                          <Link
                            to={`/tickets/${a.ticketId}`}
                            className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-indigo-200 bg-indigo-50 text-xs font-medium text-indigo-700 hover:bg-indigo-100 transition-colors"
                          >
                            <Ticket className="w-3.5 h-3.5" />
                            View Ticket
                          </Link>
                        ) : isSE && a.status !== 'CLOSED' ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={
                              createTicketFromAlertMutation.isPending &&
                              createTicketFromAlertMutation.variables === a.id
                            }
                            onClick={() => createTicketFromAlertMutation.mutate(a.id)}
                            icon={<Ticket className="w-3.5 h-3.5" />}
                          >
                            Create Ticket
                          </Button>
                        ) : null}
                        {canCloseAlerts && a.status !== 'CLOSED' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setCloseAlertTarget(a);
                              setCloseAlertReason('');
                            }}
                            icon={<XCircle className="w-3.5 h-3.5" />}
                          >
                            Close
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <Card className="p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <Ticket className="w-4 h-4 text-indigo-600" />
                Support Tickets
              </h2>
              {user?.role !== 'FIELD_TECHNICIAN' && (
                <Link to="/tickets" className="text-xs font-medium text-indigo-600 hover:text-indigo-700">
                  Open ticket queue
                </Link>
              )}
            </div>
            {deviceTicketsQuery.isError ? (
              <ErrorState
                message={
                  deviceTicketsQuery.error instanceof ApiClientError
                    ? deviceTicketsQuery.error.message
                    : 'Unable to load support tickets.'
                }
                onRetry={() => void deviceTicketsQuery.refetch()}
              />
            ) : deviceTicketsQuery.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} className="h-14 bg-slate-100 rounded-lg animate-pulse" />
                ))}
              </div>
            ) : (deviceTicketsQuery.data?.items ?? []).length === 0 ? (
              <EmptyState
                title="No tickets for this device"
                description="Support tickets and service requests linked to this device will appear here."
                action={
                  user?.role !== 'FIELD_TECHNICIAN' ? (
                    <Link
                      to="/tickets"
                      className="inline-flex items-center justify-center h-8 px-3 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-800 hover:bg-slate-50 transition-colors"
                    >
                      Open ticket queue
                    </Link>
                  ) : undefined
                }
              />
            ) : (
              <ul className="divide-y divide-slate-100">
                {(deviceTicketsQuery.data?.items ?? []).map((t) => (
                  <li
                    key={t.id}
                    className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-semibold text-indigo-700">
                          {t.number}
                        </span>
                        <StatusChip status={t.priority} />
                        <StatusChip status={t.status} />
                        <Link
                          to={`/tickets/${t.id}`}
                          className="text-sm font-medium text-slate-900 hover:text-indigo-600"
                        >
                          {t.title}
                        </Link>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        Assignee: {t.assigneeName ?? 'Unassigned'} · Updated{' '}
                        <RelativeTime iso={t.updatedAt} />
                      </p>
                    </div>
                    <Link
                      to={`/tickets/${t.id}`}
                      className="text-xs font-medium text-indigo-600 hover:text-indigo-700 shrink-0"
                    >
                      Open ticket
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      ) : activeTab === 'maintenance' ? (
        <Card className="p-5">
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Wrench className="w-4 h-4 text-indigo-600" />
              Maintenance & Work Orders
            </h2>
            <div className="flex items-center gap-2">
              {user?.role !== 'FIELD_TECHNICIAN' && (
                <Link
                  to="/work-orders"
                  className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
                >
                  All work orders
                </Link>
              )}
              {isSE && !isDecommissioned && (
                <Button
                  size="sm"
                  onClick={() => setWoModalOpen(true)}
                  icon={<Plus className="w-3.5 h-3.5" />}
                >
                  Create Work Order
                </Button>
              )}
            </div>
          </div>

          {deviceWorkOrdersQuery.isError ? (
            <ErrorState
              message={
                deviceWorkOrdersQuery.error instanceof ApiClientError
                  ? deviceWorkOrdersQuery.error.message
                  : 'Unable to load work orders.'
              }
              onRetry={() => void deviceWorkOrdersQuery.refetch()}
            />
          ) : deviceWorkOrdersQuery.isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="h-16 bg-slate-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : (deviceWorkOrdersQuery.data?.items ?? []).length === 0 ? (
            <EmptyState
              title="No work orders for this device"
              description="Corrective and preventive field maintenance history will appear here."
              action={
                isSE && !isDecommissioned ? (
                  <Button
                    size="sm"
                    onClick={() => setWoModalOpen(true)}
                    icon={<Plus className="w-3.5 h-3.5" />}
                  >
                    Create Work Order
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {(deviceWorkOrdersQuery.data?.items ?? []).map((wo) => (
                <li
                  key={wo.id}
                  className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-semibold text-indigo-700">
                        {wo.number}
                      </span>
                      <StatusChip status={wo.type} />
                      <StatusChip status={wo.status} />
                      {wo.downtimeRequired && <StatusChip status={wo.approvalStatus} />}
                      <Link
                        to={`/work-orders/${wo.id}`}
                        className="text-sm font-medium text-slate-900 hover:text-indigo-600"
                      >
                        {wo.title}
                      </Link>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      Technician: {wo.assignedToName ?? 'Unassigned'}
                      {wo.plannedStart ? ` · Planned ${formatLocalDateTime(wo.plannedStart)}` : ''}
                      {wo.completion ? ` · Outcome: ${wo.completion.outcome} (${wo.completion.timeSpentMin}m)` : ''}
                    </p>
                  </div>
                  <Link
                    to={`/work-orders/${wo.id}`}
                    className="text-xs font-medium text-indigo-600 hover:text-indigo-700 shrink-0"
                  >
                    Open work order
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : activeTab === 'overview' ? (
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
                    <span className="text-xs text-slate-500">No tags assigned</span>
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

          {timelineQuery.isError ? (
            <ErrorState
              message={
                timelineQuery.error instanceof ApiClientError
                  ? timelineQuery.error.message
                  : 'Unable to load device timeline.'
              }
              onRetry={() => void timelineQuery.refetch()}
            />
          ) : timelineQuery.isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-12 bg-slate-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : (timelineQuery.data?.items ?? []).length === 0 ? (
            <EmptyState
              title="No timeline events yet"
              description="Lifecycle transitions, connectivity events, and credential updates will appear here."
              action={
                <Button size="sm" variant="secondary" onClick={() => void timelineQuery.refetch()}>
                  Refresh
                </Button>
              }
            />
          ) : (
            <ol className="divide-y divide-slate-100">
              {(timelineQuery.data?.items ?? []).map((ev) => {
                const ticketId =
                  typeof ev.metadata?.ticketId === 'string' ? ev.metadata.ticketId : null;
                const workOrderId =
                  typeof ev.metadata?.workOrderId === 'string' ? ev.metadata.workOrderId : null;
                const rolloutId =
                  typeof ev.metadata?.rolloutId === 'string' ? ev.metadata.rolloutId : null;
                const canViewRollouts =
                  user?.role === 'CLIENT_ADMIN' ||
                  user?.role === 'SUPPORT_ENGINEER' ||
                  user?.role === 'CLIENT_MANAGER';
                return (
                  <li key={ev.id} className="py-3.5 flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {ticketId ? (
                          <Link
                            to={`/tickets/${ticketId}`}
                            className="text-sm font-medium text-indigo-700 hover:underline"
                          >
                            {ev.title}
                          </Link>
                        ) : workOrderId ? (
                          <Link
                            to={`/work-orders/${workOrderId}`}
                            className="text-sm font-medium text-indigo-700 hover:underline"
                          >
                            {ev.title}
                          </Link>
                        ) : rolloutId && canViewRollouts ? (
                          <Link
                            to={`/rollouts/${rolloutId}`}
                            className="text-sm font-medium text-indigo-700 hover:underline"
                          >
                            {ev.title}
                          </Link>
                        ) : (
                          <span className="text-sm font-medium text-slate-900">{ev.title}</span>
                        )}
                        <span className="text-[11px] font-mono text-slate-600 px-1.5 py-0.5 bg-slate-100 rounded">
                          {ev.kind.replace('_', ' ')}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 mt-0.5">{ev.description}</p>
                      <p className="text-xs text-slate-500 mt-1">
                        Actor: <span className="text-slate-700">{ev.actorName ?? ev.actorId}</span>
                      </p>
                    </div>
                    <div className="text-xs font-mono text-slate-500 shrink-0 sm:text-right">
                      <p>{formatLocalDateTime(ev.at)}</p>
                      <RelativeTime iso={ev.at} />
                    </div>
                  </li>
                );
              })}
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

      {/* Restart Device Command Confirm */}
      <ConfirmDialog
        open={restartConfirmOpen}
        onClose={() => setRestartConfirmOpen(false)}
        onConfirm={() => restartMutation.mutate()}
        title="Queue Device Restart"
        message={`Send a remote RESTART command to "${device.name}"? The device will reboot on its next command poll and reconnect after restarting.`}
        confirmLabel="Queue Restart"
        variant="primary"
        loading={restartMutation.isPending}
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

      <Modal
        open={Boolean(closeAlertTarget)}
        onClose={() => setCloseAlertTarget(null)}
        title="Close Alert"
        description={closeAlertTarget?.message}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCloseAlertTarget(null)}>
              Cancel
            </Button>
            <Button
              loading={closeAlertMutation.isPending}
              disabled={closeAlertReason.trim().length < 3}
              onClick={() => {
                if (closeAlertTarget) {
                  closeAlertMutation.mutate({
                    alertId: closeAlertTarget.id,
                    reason: closeAlertReason.trim(),
                  });
                }
              }}
            >
              Close Alert
            </Button>
          </>
        }
      >
        <Textarea
          label="Resolution Reason"
          required
          rows={3}
          value={closeAlertReason}
          onChange={(e) => setCloseAlertReason(e.target.value)}
          placeholder="Document the resolution before closing this alert..."
        />
      </Modal>

      <ProvisioningModal
        provisioning={provisioning}
        deviceName={device.name}
        onClose={() => setProvisioning(null)}
      />

      {canManage && (
        <Modal
          open={pushConfigOpen}
          onClose={() => setPushConfigOpen(false)}
          title={`Push Configuration to ${device.name}`}
          description="Select a configuration profile matching this device's model. Status will become PENDING until acknowledged."
          size="sm"
          footer={
            <>
              <Button variant="secondary" onClick={() => setPushConfigOpen(false)}>
                Cancel
              </Button>
              <Button
                loading={pushConfigMutation.isPending}
                disabled={!selectedConfigProfileId}
                onClick={() => pushConfigMutation.mutate(selectedConfigProfileId)}
                icon={<Send className="w-3.5 h-3.5" />}
              >
                Push Config
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <Select
              label="Configuration Profile"
              required
              value={selectedConfigProfileId}
              onChange={(e) => setSelectedConfigProfileId(e.target.value)}
            >
              <option value="">Select profile...</option>
              {(modelConfigProfilesQuery.data?.items ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} (v{p.version})
                </option>
              ))}
            </Select>
            {(modelConfigProfilesQuery.data?.items ?? []).length === 0 && (
              <p className="text-xs text-amber-700">
                No configuration profiles exist yet for this device model. Create one under Config Profiles.
              </p>
            )}
          </div>
        </Modal>
      )}

      {isSE && (
        <CreateWorkOrderModal
          open={woModalOpen}
          onClose={() => setWoModalOpen(false)}
          defaultDeviceId={device.id}
          onCreated={() => refreshDevice()}
        />
      )}
    </div>
  );
}
