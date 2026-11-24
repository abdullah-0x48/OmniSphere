import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Plus,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import type {
  AlertPublic,
  DevicePublic,
  PaginatedResponse,
  TicketPriority,
  TicketPublic,
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
  SeverityChip,
  StatusChip,
  Textarea,
  useToast,
} from '../components/ui/index.ts';

/**
 * Client Operator mobile-first home (/live-status) — live device tiles grouped by site,
 * refreshing every 5s with site filter, "Only problems" toggle, and Raise Service Request action.
 */
export function LiveStatusPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [onlyOffline, setOnlyOffline] = React.useState(false);
  const [siteFilter, setSiteFilter] = React.useState('');
  const [srOpen, setSrOpen] = React.useState(false);
  const [srDeviceId, setSrDeviceId] = React.useState('');
  const [srTitle, setSrTitle] = React.useState('');
  const [srDescription, setSrDescription] = React.useState('');
  const [srPriority, setSrPriority] = React.useState<TicketPriority>('MEDIUM');

  const devicesQuery = useQuery({
    queryKey: ['co-live-devices'],
    queryFn: () =>
      apiRequest<PaginatedResponse<DevicePublic>>('/devices', {
        query: { page: 1, pageSize: 100, sort: 'name:asc' },
      }),
    refetchInterval: 5000,
  });

  const openAlertsQuery = useQuery({
    queryKey: ['co-open-alerts'],
    queryFn: () =>
      apiRequest<PaginatedResponse<AlertPublic>>('/alerts', {
        query: { status: 'OPEN', page: 1, pageSize: 100 },
      }),
    refetchInterval: 5000,
  });

  const ackMutation = useMutation({
    mutationFn: (alertId: string) =>
      apiRequest<AlertPublic>(`/alerts/${alertId}/acknowledge`, { method: 'POST' }),
    onSuccess: () => {
      toast({ kind: 'success', title: 'Alert acknowledged' });
      void queryClient.invalidateQueries({ queryKey: ['co-open-alerts'] });
      void queryClient.invalidateQueries({ queryKey: ['alerts-list'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications-bell'] });
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Acknowledge failed',
        description: err instanceof ApiClientError ? err.message : 'Unable to acknowledge alert.',
      });
    },
  });

  const createServiceRequestMutation = useMutation({
    mutationFn: () =>
      apiRequest<TicketPublic>('/tickets', {
        method: 'POST',
        body: {
          title: srTitle.trim(),
          description: srDescription.trim(),
          priority: srPriority,
          source: 'SERVICE_REQUEST',
          deviceId: srDeviceId || null,
        },
      }),
    onSuccess: (created) => {
      toast({
        kind: 'success',
        title: `Service request ${created.number} submitted`,
        description: 'Routed to the support engineering queue.',
      });
      setSrOpen(false);
      setSrTitle('');
      setSrDescription('');
      setSrDeviceId('');
      setSrPriority('MEDIUM');
      void queryClient.invalidateQueries({ queryKey: ['tickets-list'] });
      navigate(`/tickets/${created.id}`);
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Unable to submit service request',
        description: err instanceof ApiClientError ? err.message : 'Please check your request details.',
      });
    },
  });

  const alertsByDevice = React.useMemo(() => {
    const map = new Map<string, AlertPublic[]>();
    for (const a of openAlertsQuery.data?.items ?? []) {
      const list = map.get(a.deviceId) ?? [];
      list.push(a);
      map.set(a.deviceId, list);
    }
    return map;
  }, [openAlertsQuery.data?.items]);

  const allDevices = devicesQuery.data?.items ?? [];
  const siteOptions = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const d of allDevices) {
      map.set(d.siteId, d.siteName ?? d.siteId);
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [allDevices]);

  const filtered = allDevices.filter((d) => {
    if (siteFilter && d.siteId !== siteFilter) return false;
    const hasOpenAlert = (alertsByDevice.get(d.id)?.length ?? 0) > 0;
    if (onlyOffline && !(d.connectivity === 'OFFLINE' || d.state !== 'ACTIVE' || hasOpenAlert)) {
      return false;
    }
    return true;
  });

  const grouped = new Map<string, DevicePublic[]>();
  for (const d of filtered) {
    const key = d.siteName ?? d.siteId;
    const list = grouped.get(key) ?? [];
    list.push(d);
    grouped.set(key, list);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Live Status"
        description={`Real-time fleet tiles for ${user?.tenantName ?? 'your organization'} (${allDevices.length} devices · ${openAlertsQuery.data?.total ?? 0} open alerts · updates every 5s).`}
        actions={
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto">
            <div className="grid grid-cols-2 sm:flex sm:items-center gap-2">
              <select
                aria-label="Filter by site"
                value={siteFilter}
                onChange={(e) => setSiteFilter(e.target.value)}
                className="min-h-[44px] sm:min-h-[34px] sm:h-8 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
              >
                <option value="">All sites</option>
                {siteOptions.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
              <Button
                variant={onlyOffline ? 'primary' : 'secondary'}
                size="sm"
                className="min-h-[44px] sm:min-h-[34px]"
                aria-pressed={onlyOffline}
                onClick={() => setOnlyOffline((v) => !v)}
              >
                {onlyOffline ? 'Showing problems' : 'Only problems'}
              </Button>
            </div>
            <Button
              size="sm"
              className="min-h-[44px] sm:min-h-[34px] w-full sm:w-auto"
              onClick={() => setSrOpen(true)}
              icon={<Plus className="w-3.5 h-3.5" />}
            >
              Raise Service Request
            </Button>
          </div>
        }
      />

      {devicesQuery.isError ? (
        <ErrorState
          message={
            devicesQuery.error instanceof ApiClientError
              ? devicesQuery.error.message
              : 'Unable to load devices.'
          }
          onRetry={() => void devicesQuery.refetch()}
        />
      ) : devicesQuery.isLoading ? (
        <div className="space-y-4" aria-busy="true" aria-label="Loading live device tiles">
          <div className="h-4 w-40 bg-slate-200 rounded animate-pulse" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, idx) => (
              <div
                key={idx}
                className="bg-white border border-slate-200 rounded-xl p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1.5 flex-1">
                    <div className="h-4 w-3/4 bg-slate-200 rounded animate-pulse" />
                    <div className="h-3 w-1/2 bg-slate-100 rounded animate-pulse" />
                  </div>
                  <div className="h-5 w-16 bg-slate-100 rounded-full animate-pulse" />
                </div>
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                  <div className="h-5 w-16 bg-slate-100 rounded-full animate-pulse" />
                  <div className="h-3.5 w-24 bg-slate-100 rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : grouped.size === 0 ? (
        <Card>
          <EmptyState
            icon={<Cpu className="w-7 h-7" />}
            title={onlyOffline ? 'All monitored devices are healthy' : 'No devices match filter'}
            description={
              onlyOffline
                ? 'Switch off the "Only problems" filter to inspect all active devices.'
                : 'Adjust the site filter or wait for devices to be registered in your organization.'
            }
            action={
              onlyOffline || siteFilter ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setOnlyOffline(false);
                    setSiteFilter('');
                  }}
                >
                  Show all devices
                </Button>
              ) : (
                <Button onClick={() => setSrOpen(true)} icon={<Plus className="w-4 h-4" />}>
                  Raise Service Request
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {Array.from(grouped.entries()).map(([siteName, siteDevices]) => (
            <section key={siteName} className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">{siteName}</h2>
                <span className="text-xs font-mono text-slate-500">
                  {siteDevices.length} {siteDevices.length === 1 ? 'device' : 'devices'}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {siteDevices.map((d) => {
                  const metricEntries = Object.entries(d.latestMetrics).slice(0, 2);
                  const deviceAlerts = alertsByDevice.get(d.id) ?? [];
                  const topAlert = deviceAlerts[0] ?? null;

                  return (
                    <Card
                      key={d.id}
                      className={`p-4 transition-colors ${
                        topAlert ? 'border-red-300 bg-red-50/20' : 'hover:border-indigo-300'
                      }`}
                    >
                      <Link to={`/devices/${d.id}`} className="block group">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900 truncate group-hover:text-indigo-700">
                              {d.name}
                            </p>
                            <p className="text-xs font-mono text-slate-500 truncate">
                              {d.serialNumber} · <RelativeTime iso={d.lastSeenAt} />
                            </p>
                          </div>
                          <StatusChip status={d.connectivity} />
                        </div>
                        <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
                          <StatusChip status={d.state} />
                          <div className="flex items-center gap-3 font-mono tabular-nums text-slate-700">
                            {metricEntries.length === 0 ? (
                              <span className="text-slate-500">No readings</span>
                            ) : (
                              metricEntries.map(([k, v]) => (
                                <span key={k}>
                                  {k.replace('_rms', '')}: <strong>{String(v)}</strong>
                                </span>
                              ))
                            )}
                          </div>
                        </div>
                      </Link>

                      {topAlert && (
                        <div className="mt-3 pt-3 border-t border-red-200/70 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" aria-hidden="true" />
                            <SeverityChip severity={topAlert.severity} />
                            <Link
                              to={`/alerts?alertId=${topAlert.id}`}
                              className="text-xs font-medium text-red-900 truncate hover:underline"
                            >
                              {topAlert.ruleName ?? topAlert.message}
                            </Link>
                          </div>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="min-h-[40px] sm:min-h-[32px] shrink-0"
                            loading={
                              ackMutation.isPending && ackMutation.variables === topAlert.id
                            }
                            onClick={() => ackMutation.mutate(topAlert.id)}
                            icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                          >
                            Ack
                          </Button>
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <Modal
        open={srOpen}
        onClose={() => setSrOpen(false)}
        title="Raise Service Request"
        description="Submit a field issue or support inquiry directly to the Support Engineering queue."
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setSrOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={createServiceRequestMutation.isPending}
              disabled={srTitle.trim().length < 3 || srDescription.trim().length < 3}
              onClick={() => createServiceRequestMutation.mutate()}
            >
              Submit Request
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Summary"
            required
            value={srTitle}
            onChange={(e) => setSrTitle(e.target.value)}
            placeholder="e.g. Sensor enclosure condensation observed on Bay 2"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="Device (optional)"
              value={srDeviceId}
              onChange={(e) => setSrDeviceId(e.target.value)}
            >
              <option value="">General / Site-level issue</option>
              {allDevices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.siteName ?? d.siteId})
                </option>
              ))}
            </Select>
            <Select
              label="Priority"
              value={srPriority}
              onChange={(e) => setSrPriority(e.target.value as TicketPriority)}
              options={[
                { value: 'LOW', label: 'Low' },
                { value: 'MEDIUM', label: 'Medium' },
                { value: 'HIGH', label: 'High' },
                { value: 'CRITICAL', label: 'Critical' },
              ]}
            />
          </div>
          <Textarea
            label="Details"
            required
            rows={4}
            value={srDescription}
            onChange={(e) => setSrDescription(e.target.value)}
            placeholder="Describe what you observed on-site and any immediate safety or operational impact..."
          />
        </div>
      </Modal>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
      <p className="font-mono text-xs font-semibold text-indigo-700">404</p>
      <h1 className="mt-2 text-2xl font-semibold text-slate-900">Page not found</h1>
      <p className="mt-1.5 text-sm text-slate-600 max-w-md">
        The page you requested does not exist or has moved.
      </p>
      <Link
        to="/"
        className="mt-5 inline-flex items-center justify-center min-h-[44px] sm:min-h-0 sm:h-9 px-4 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
      >
        Go to home
      </Link>
    </div>
  );
}
