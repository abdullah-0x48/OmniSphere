import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  Link2,
  Play,
  Plus,
  Radio,
  Square,
  Terminal,
  Upload,
  Zap,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import type {
  DeviceModel,
  PaginatedResponse,
  SimulatedDeviceStatus,
  SimulatorFaultKind,
  SimulatorProfile,
  SimulatorStatusResponse,
  Site,
} from '../../shared/types.ts';
import { ApiClientError, apiRequest } from '../api/client.ts';
import { useAuth } from '../auth/AuthContext.tsx';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  PageHeader,
  RelativeTime,
  Select,
  StatusChip,
  Textarea,
  useToast,
} from '../components/ui/index.ts';

const PROFILE_OPTIONS: Array<{ value: SimulatorProfile; label: string }> = [
  { value: 'NORMAL', label: 'Normal operation' },
  { value: 'DRIFTING_TEMPERATURE', label: 'Drifting temperature' },
  { value: 'BATTERY_DRAIN', label: 'Battery drain' },
  { value: 'RANDOM_DROPOUTS', label: 'Random dropouts' },
];

/**
 * Built-in Device Simulator Console (/simulator — Section 12.1).
 * Accessible to Platform Admin, Support Engineer, and Client Admin.
 * Every simulated device calls the real `/device/v1/*` API over HTTP on localhost.
 */
export function SimulatorPage() {
  const { user, activeTenantId } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [intervalSec, setIntervalSec] = useState(10);
  const [profile, setProfile] = useState<SimulatorProfile>('NORMAL');

  // Create N demo devices state
  const [createCount, setCreateCount] = useState(3);
  const [createModelId, setCreateModelId] = useState('mdl_th200');
  const [createSiteId, setCreateSiteId] = useState('');

  // Attach provisioning JSON modal
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachJson, setAttachJson] = useState('');

  // Fault injection modal
  const [faultDevice, setFaultDevice] = useState<SimulatedDeviceStatus | null>(null);
  const [faultKind, setFaultKind] = useState<SimulatorFaultKind>('SPIKE_METRIC');
  const [faultMetricKey, setFaultMetricKey] = useState('');
  const [faultMetricValue, setFaultMetricValue] = useState('');

  const statusQuery = useQuery({
    queryKey: ['simulator-status', activeTenantId],
    queryFn: () => apiRequest<SimulatorStatusResponse>('/simulator/status'),
    refetchInterval: 3000,
  });

  const modelsQuery = useQuery({
    queryKey: ['simulator-models'],
    queryFn: () =>
      apiRequest<PaginatedResponse<DeviceModel>>('/device-models', {
        query: { page: 1, pageSize: 100 },
      }),
  });

  const sitesQuery = useQuery({
    queryKey: ['simulator-sites', activeTenantId],
    enabled: user?.role !== 'PLATFORM_ADMIN',
    queryFn: () =>
      apiRequest<PaginatedResponse<Site>>('/sites', {
        query: { page: 1, pageSize: 100 },
      }),
  });

  const sites = sitesQuery.data?.items ?? [];
  const models = modelsQuery.data?.items ?? [];
  const effectiveSiteId = createSiteId || sites[0]?.id || '';

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['simulator-status'] });
    void queryClient.invalidateQueries({ queryKey: ['devices'] });
    void queryClient.invalidateQueries({ queryKey: ['fleet-summary'] });
    void queryClient.invalidateQueries({ queryKey: ['fleet-overview'] });
  };

  const createDemoMutation = useMutation({
    mutationFn: () =>
      apiRequest<{ createdDeviceIds: string[]; count: number }>('/simulator/demo-devices', {
        method: 'POST',
        body: {
          count: createCount,
          modelId: createModelId,
          siteId: effectiveSiteId,
        },
      }),
    onSuccess: (res) => {
      toast({
        kind: 'success',
        title: `Created ${res.count} demo ${res.count === 1 ? 'device' : 'devices'}`,
        description: 'Attached to the simulator and ready to start.',
      });
      invalidate();
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Unable to create demo devices',
        description: err instanceof ApiClientError ? err.message : 'Request failed',
      });
    },
  });

  const attachMutation = useMutation({
    mutationFn: (payload: { deviceId: string; apiKey: string }) =>
      apiRequest('/simulator/attach', { method: 'POST', body: payload }),
    onSuccess: () => {
      toast({
        kind: 'success',
        title: 'Device attached to simulator',
        description: 'Click Start to send live handshake and telemetry over HTTP.',
      });
      setAttachOpen(false);
      setAttachJson('');
      invalidate();
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Attach failed',
        description: err instanceof ApiClientError ? err.message : 'Invalid provisioning payload',
      });
    },
  });

  const startMutation = useMutation({
    mutationFn: (vars: { deviceIds?: string[] }) =>
      apiRequest<{ startedCount: number }>('/simulator/start', {
        method: 'POST',
        body: {
          deviceIds: vars.deviceIds,
          intervalSec,
          profile,
        },
      }),
    onSuccess: (res) => {
      toast({
        kind: 'success',
        title: `Started ${res.startedCount} simulated ${res.startedCount === 1 ? 'device' : 'devices'}`,
      });
      invalidate();
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Failed to start simulator',
        description: err instanceof ApiClientError ? err.message : 'Request failed',
      });
    },
  });

  const stopMutation = useMutation({
    mutationFn: (vars: { deviceIds?: string[] }) =>
      apiRequest<{ stoppedCount: number }>('/simulator/stop', {
        method: 'POST',
        body: vars,
      }),
    onSuccess: (res) => {
      toast({
        kind: 'info',
        title: `Stopped ${res.stoppedCount} simulated ${res.stoppedCount === 1 ? 'device' : 'devices'}`,
      });
      invalidate();
    },
  });

  const injectMutation = useMutation({
    mutationFn: () => {
      if (!faultDevice) throw new Error('No device selected');
      const parsedVal = faultMetricValue.trim() ? Number(faultMetricValue) : undefined;
      return apiRequest('/simulator/inject', {
        method: 'POST',
        body: {
          deviceId: faultDevice.deviceId,
          fault: faultKind,
          metricKey: faultMetricKey.trim() || undefined,
          value: Number.isFinite(parsedVal) ? parsedVal : undefined,
        },
      });
    },
    onSuccess: () => {
      toast({ kind: 'success', title: `Fault injected (${faultKind.replaceAll('_', ' ')})` });
      setFaultDevice(null);
      invalidate();
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Fault injection failed',
        description: err instanceof ApiClientError ? err.message : 'Unable to inject fault',
      });
    },
  });

  const handleAttachSubmit = () => {
    try {
      const parsed = JSON.parse(attachJson) as Record<string, unknown>;
      const target = Array.isArray(parsed) ? (parsed[0] as Record<string, unknown>) : parsed;
      const deviceId = typeof target?.deviceId === 'string' ? target.deviceId.trim() : '';
      const apiKey = typeof target?.apiKey === 'string' ? target.apiKey.trim() : '';
      if (!deviceId || !apiKey) {
        toast({
          kind: 'error',
          title: 'Invalid JSON',
          description: 'Provisioning JSON must contain "deviceId" and "apiKey".',
        });
        return;
      }
      attachMutation.mutate({ deviceId, apiKey });
    } catch {
      toast({
        kind: 'error',
        title: 'Malformed JSON',
        description: 'Paste the exact provisioning JSON returned when registering the device.',
      });
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setAttachJson(String(reader.result ?? ''));
    };
    reader.readAsText(file);
  };

  const status = statusQuery.data;
  const devices = status?.devices ?? [];
  const logs = status?.logs ?? [];
  const faultDeviceModel = faultDevice
    ? models.find((m) => m.id === faultDevice.modelId) ?? null
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Device Simulator"
        description="Run live simulated industrial devices against the real /device/v1 HTTP API on localhost."
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            {user?.role !== 'PLATFORM_ADMIN' && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setAttachOpen(true)}
                icon={<Link2 className="w-3.5 h-3.5" />}
              >
                Attach Registered Device
              </Button>
            )}
            <Button
              size="sm"
              loading={startMutation.isPending}
              disabled={devices.length === 0}
              onClick={() => startMutation.mutate({})}
              icon={<Play className="w-3.5 h-3.5" />}
            >
              Start All ({devices.length})
            </Button>
            <Button
              variant="secondary"
              size="sm"
              loading={stopMutation.isPending}
              disabled={(status?.runningCount ?? 0) === 0}
              onClick={() => stopMutation.mutate({})}
              icon={<Square className="w-3.5 h-3.5" />}
            >
              Stop All
            </Button>
          </div>
        }
      />

      {/* Server-Process Timer Notice (Section 12.1) */}
      <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 px-4 py-3 flex items-start gap-3 text-xs text-indigo-900">
        <AlertCircle className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
        <p>
          <strong>In-process HTTP simulator:</strong> Every running device sends authenticated{' '}
          <code className="font-mono">/device/v1/handshake</code>,{' '}
          <code className="font-mono">/telemetry</code>,{' '}
          <code className="font-mono">/heartbeat</code>, and{' '}
          <code className="font-mono">/commands</code> requests over HTTP to this server. Timers
          stop automatically on server restart. For long-running external simulation, run{' '}
          <code className="font-mono">node simulator/simulator.mjs &lt;provisioning.json&gt;</code>.
        </p>
      </div>

      {/* Controls Row: Cadence/Profile + Create N Demo Devices */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <Card className="p-5 lg:col-span-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Simulation Parameters</h2>
              <p className="text-xs text-slate-500">
                Applied when starting individual devices or starting all devices.
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 text-xs font-mono font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-md">
              <Radio className="w-3.5 h-3.5" aria-hidden="true" />
              {status?.runningCount ?? 0} / {status?.totalCount ?? 0} running
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Telemetry Interval (5–60 sec)"
              type="number"
              min={5}
              max={60}
              value={String(intervalSec)}
              onChange={(e) => setIntervalSec(Math.max(5, Math.min(60, Number(e.target.value) || 10)))}
            />
            <Select
              label="Behavior Profile"
              value={profile}
              onChange={(e) => setProfile(e.target.value as SimulatorProfile)}
            >
              {PROFILE_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </div>
        </Card>

        {user?.role !== 'PLATFORM_ADMIN' ? (
          <Card className="p-5 lg:col-span-6 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Create Demo Devices</h2>
              <p className="text-xs text-slate-500">
                Register 1–50 devices in your active organization and auto-attach them here.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <Input
                label="Count (1–50)"
                type="number"
                min={1}
                max={50}
                value={String(createCount)}
                onChange={(e) => setCreateCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
              />
              <Select
                label="Model"
                value={createModelId}
                onChange={(e) => setCreateModelId(e.target.value)}
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name.split(' ')[0]} ({m.manufacturer.split(' ')[0]})
                  </option>
                ))}
              </Select>
              <Select
                label="Site"
                value={effectiveSiteId}
                onChange={(e) => setCreateSiteId(e.target.value)}
              >
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="secondary"
                loading={createDemoMutation.isPending}
                disabled={!effectiveSiteId || !createModelId}
                onClick={() => createDemoMutation.mutate()}
                icon={<Plus className="w-3.5 h-3.5" />}
              >
                Create & Attach
              </Button>
            </div>
          </Card>
        ) : (
          <Card className="p-5 lg:col-span-6 flex flex-col justify-center">
            <h2 className="text-sm font-semibold text-slate-900">Cross-Tenant Platform Simulation</h2>
            <p className="text-xs text-slate-500 mt-1">
              As Platform Admin, you can start, stop, and inject faults across all seeded demo
              devices from every organization below. Sign in as a Client Admin or Support Engineer
              to register new devices for a specific tenant.
            </p>
          </Card>
        )}
      </div>

      {/* Attached Simulated Devices Table */}
      {statusQuery.isError ? (
        <ErrorState
          message={
            statusQuery.error instanceof ApiClientError
              ? statusQuery.error.message
              : 'Unable to load simulator status.'
          }
          onRetry={() => void statusQuery.refetch()}
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Attached Devices</h2>
              <p className="text-xs text-slate-500">
                Credentials remain strictly server-side; start any device to observe live HTTP ingestion.
              </p>
            </div>
            <span className="text-xs font-mono text-slate-500">{devices.length} attached</span>
          </div>

          {statusQuery.isLoading ? (
            <div className="p-5 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-12 rounded-lg bg-slate-100 animate-pulse" />
              ))}
            </div>
          ) : devices.length === 0 ? (
            <EmptyState
              icon={<Radio className="w-7 h-7" />}
              title="No devices attached to the simulator"
              description="Create demo devices above or attach a registered device using its provisioning JSON."
              action={
                user?.role !== 'PLATFORM_ADMIN' ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setAttachOpen(true)}
                    icon={<Link2 className="w-3.5 h-3.5" />}
                  >
                    Attach Registered Device
                  </Button>
                ) : (
                  <Button variant="secondary" size="sm" onClick={() => void statusQuery.refetch()}>
                    Refresh
                  </Button>
                )
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70">
                    <th className="px-5 py-2.5 text-xs font-semibold text-slate-600">Device</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-600">State / Conn.</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-600">Simulator</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-600">Last HTTP</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-600">Faults</th>
                    <th className="px-5 py-2.5 text-xs font-semibold text-slate-600 text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {devices.map((d) => (
                    <tr key={d.deviceId} className="hover:bg-slate-50/70">
                      <td className="px-5 py-3">
                        {user?.role !== 'PLATFORM_ADMIN' ? (
                          <Link
                            to={`/devices/${d.deviceId}`}
                            className="font-medium text-indigo-600 hover:text-indigo-700"
                          >
                            {d.deviceName}
                          </Link>
                        ) : (
                          <span className="font-medium text-slate-900">{d.deviceName}</span>
                        )}
                        <p className="text-xs font-mono text-slate-500">
                          {d.serialNumber} · {d.siteName}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <StatusChip status={d.state} />
                          <StatusChip status={d.connectivity} />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {d.running ? (
                          <StatusChip status="RUNNING" label={`Running (${d.intervalSec}s)`} />
                        ) : (
                          <StatusChip status="INACTIVE" label="Stopped" />
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {d.lastHttpStatus !== null ? (
                          <span
                            className={
                              d.lastHttpStatus >= 200 && d.lastHttpStatus < 300
                                ? 'text-emerald-800 font-semibold'
                                : 'text-red-700 font-semibold'
                            }
                          >
                            HTTP {d.lastHttpStatus}
                          </span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                        {d.lastSentAt && (
                          <span className="block text-[11px] text-slate-500">
                            <RelativeTime iso={d.lastSentAt} />
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {d.activeFaults.length === 0 ? (
                          <span className="text-slate-500">None</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {d.activeFaults.map((f) => (
                              <span
                                key={f}
                                className="px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-800 font-mono text-[11px]"
                              >
                                {f}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {d.running ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => stopMutation.mutate({ deviceIds: [d.deviceId] })}
                              icon={<Square className="w-3 h-3" />}
                            >
                              Stop
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              onClick={() => startMutation.mutate({ deviceIds: [d.deviceId] })}
                              icon={<Play className="w-3 h-3" />}
                            >
                              Start
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setFaultDevice(d);
                              setFaultKind('SPIKE_METRIC');
                              setFaultMetricKey('');
                              setFaultMetricValue('');
                            }}
                            icon={<Zap className="w-3 h-3" />}
                          >
                            Fault
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Live Simulator Event Log */}
      <Card className="overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-900 text-slate-100">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-semibold">Live Simulator Event Log (HTTP /device/v1)</h2>
          </div>
          <span className="text-xs font-mono text-slate-300">Last {logs.length} events</span>
        </div>
        <div className="bg-slate-950 text-slate-200 font-mono text-xs max-h-64 overflow-y-auto divide-y divide-slate-800/80">
          {logs.length === 0 ? (
            <p className="p-5 text-slate-300">
              Start one or more simulated devices above to see real HTTP requests and responses here.
            </p>
          ) : (
            logs.map((entry) => (
              <div
                key={entry.id}
                className="px-4 py-2 flex items-center justify-between gap-3 hover:bg-slate-900/70"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="text-slate-400 shrink-0">
                    {new Date(entry.at).toLocaleTimeString()}
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[11px] font-semibold shrink-0 ${
                      entry.statusCode >= 200 && entry.statusCode < 300
                        ? 'bg-emerald-950 text-emerald-400'
                        : 'bg-red-950 text-red-400'
                    }`}
                  >
                    {entry.statusCode}
                  </span>
                  <span className="text-indigo-300 shrink-0">{entry.deviceName}</span>
                  <span className="text-slate-300 truncate">{entry.message}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      {/* Attach Registered Device Modal */}
      <Modal
        open={attachOpen}
        onClose={() => setAttachOpen(false)}
        title="Attach Registered Device"
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAttachOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={attachMutation.isPending}
              disabled={!attachJson.trim()}
              onClick={handleAttachSubmit}
            >
              Attach Device
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-xs text-slate-600">
            Paste the one-time provisioning JSON generated when you registered a device (or upload
            the downloaded <code className="font-mono">.json</code> file). The simulator validates
            the key and calls <code className="font-mono">/device/v1/*</code> over localhost HTTP.
          </p>
          <label className="inline-flex items-center gap-2 h-8 px-3 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer">
            <Upload className="w-3.5 h-3.5" />
            <span>Upload provisioning .json file</span>
            <input type="file" accept=".json,application/json" className="hidden" onChange={handleFileUpload} />
          </label>
          <Textarea
            label="Provisioning JSON"
            rows={7}
            value={attachJson}
            onChange={(e) => setAttachJson(e.target.value)}
            placeholder={'{\n  "deviceId": "dev_...",\n  "apiKey": "omk_..."\n}'}
            className="font-mono text-xs"
          />
        </div>
      </Modal>

      {/* Fault Injection Modal */}
      <Modal
        open={Boolean(faultDevice)}
        onClose={() => setFaultDevice(null)}
        title={`Inject Fault — ${faultDevice?.deviceName ?? ''}`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setFaultDevice(null)}>
              Cancel
            </Button>
            <Button loading={injectMutation.isPending} onClick={() => injectMutation.mutate()}>
              Apply Fault
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select
            label="Fault Type"
            value={faultKind}
            onChange={(e) => setFaultKind(e.target.value as SimulatorFaultKind)}
          >
            <option value="SPIKE_METRIC">Spike metric (2 minutes)</option>
            <option value="FORCE_OFFLINE">Force offline (stop sending for 3 minutes)</option>
            <option value="LOW_BATTERY">Set low battery (10%)</option>
            <option value="FAIL_OTA_CHECKSUM">Fail next OTA checksum</option>
            <option value="FAIL_OTA_BOOT">Fail next OTA boot</option>
            <option value="IGNORE_NEXT_CONFIG">Ignore next config push</option>
            <option value="CLEAR_FAULTS">Clear all active faults</option>
          </Select>

          {faultKind === 'SPIKE_METRIC' && (
            <>
              <Select
                label="Target Metric"
                value={faultMetricKey}
                onChange={(e) => setFaultMetricKey(e.target.value)}
              >
                <option value="">Primary numeric metric (auto)</option>
                {(faultDeviceModel?.metrics ?? [])
                  .filter((m) => m.type === 'number')
                  .map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.label} ({m.min ?? '−∞'}..{m.max ?? '+∞'} {m.unit})
                    </option>
                  ))}
              </Select>
              <Input
                label="Spike Value (optional — defaults near model max)"
                type="number"
                value={faultMetricValue}
                onChange={(e) => setFaultMetricValue(e.target.value)}
                placeholder="e.g. 95"
              />
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
