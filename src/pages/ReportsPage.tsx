import React, { useMemo } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Cpu,
  Download,
  FileSpreadsheet,
  FileText,
  RotateCcw,
  ShieldCheck,
  Ticket,
  Wrench,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  AlertsReportResponse,
  AvailabilityReportResponse,
  DeviceModel,
  FirmwareComplianceReportResponse,
  MaintenanceReportResponse,
  PaginatedResponse,
  PlatformHealthReportResponse,
  ReportExportAuditRequest,
  ReportKpisResponse,
  Site,
  TenantSummary,
  TicketsReportResponse,
} from '../../shared/types.ts';
import { ApiClientError, apiRequest } from '../api/client.ts';
import { useAuth } from '../auth/AuthContext.tsx';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  KpiCard,
  PageHeader,
  Select,
  SeverityChip,
  StatusChip,
  useToast,
} from '../components/ui/index.ts';
import { formatLocalDateTime } from '../utils/format.ts';
import {
  buildReportFilename,
  downloadCsvFile,
  downloadPdfReport,
  type CsvTableData,
  type PdfTableSection,
} from '../utils/reportExport.ts';

type ReportTab = 'availability' | 'alerts' | 'tickets' | 'firmware' | 'maintenance' | 'platform';

function toInputDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function getDefaultDateBounds(): { from: string; to: string } {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
  return {
    from: toInputDate(sevenDaysAgo),
    to: toInputDate(now),
  };
}

export function ReportsPage() {
  const { user, activeTenantId } = useAuth();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const isPA = user?.role === 'PLATFORM_ADMIN';
  const isCO = user?.role === 'CLIENT_OPERATOR';
  const canSeeFullReports = !isCO;

  const defaults = useMemo(() => getDefaultDateBounds(), []);
  const from = searchParams.get('from') || defaults.from;
  const to = searchParams.get('to') || defaults.to;
  const siteId = searchParams.get('siteId') || '';
  const modelId = searchParams.get('modelId') || '';
  const paTenantId = isPA ? searchParams.get('tenantId') || '' : '';

  const rawTab = (searchParams.get('tab') as ReportTab | null) || 'availability';
  const allowedTabs: ReportTab[] = isPA
    ? ['availability', 'alerts', 'tickets', 'firmware', 'maintenance', 'platform']
    : isCO
      ? ['availability', 'alerts', 'tickets']
      : ['availability', 'alerts', 'tickets', 'firmware', 'maintenance'];
  const activeTab: ReportTab = allowedTabs.includes(rawTab) ? rawTab : 'availability';

  const updateParams = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(updates)) {
      if (!v) next.delete(k);
      else next.set(k, v);
    }
    setSearchParams(next, { replace: true });
  };

  const applyDatePreset = (days: number) => {
    const now = new Date();
    const start = new Date(now.getTime() - days * 86_400_000);
    updateParams({ from: toInputDate(start), to: toInputDate(now) });
  };

  // Reference filter options
  const tenantsQuery = useQuery({
    queryKey: ['report-tenants-filter'],
    enabled: isPA,
    queryFn: () =>
      apiRequest<PaginatedResponse<TenantSummary>>('/tenants', {
        query: { page: 1, pageSize: 200, sort: 'name:asc' },
      }),
  });

  const sitesQuery = useQuery({
    queryKey: ['report-sites-filter', activeTenantId],
    enabled: !isPA,
    queryFn: () =>
      apiRequest<PaginatedResponse<Site>>('/sites', {
        query: { page: 1, pageSize: 200 },
      }),
  });

  const modelsQuery = useQuery({
    queryKey: ['report-models-filter'],
    queryFn: () =>
      apiRequest<PaginatedResponse<DeviceModel>>('/device-models', {
        query: { page: 1, pageSize: 200 },
      }),
  });

  const filterQueryObj = {
    from,
    to,
    siteId: siteId || undefined,
    modelId: modelId || undefined,
    tenantId: isPA && paTenantId ? paTenantId : undefined,
  };

  const queryScopeKey = [activeTenantId, from, to, siteId, modelId, paTenantId];

  const kpisQuery = useQuery({
    queryKey: ['reports-kpis', ...queryScopeKey],
    queryFn: () => apiRequest<ReportKpisResponse>('/reports/kpis', { query: filterQueryObj }),
  });

  const availabilityQuery = useQuery({
    queryKey: ['reports-availability', ...queryScopeKey],
    enabled: activeTab === 'availability',
    queryFn: () =>
      apiRequest<AvailabilityReportResponse>('/reports/availability', { query: filterQueryObj }),
  });

  const alertsQuery = useQuery({
    queryKey: ['reports-alerts', ...queryScopeKey],
    enabled: activeTab === 'alerts',
    queryFn: () => apiRequest<AlertsReportResponse>('/reports/alerts', { query: filterQueryObj }),
  });

  const ticketsQuery = useQuery({
    queryKey: ['reports-tickets', ...queryScopeKey],
    enabled: activeTab === 'tickets',
    queryFn: () => apiRequest<TicketsReportResponse>('/reports/tickets', { query: filterQueryObj }),
  });

  const firmwareQuery = useQuery({
    queryKey: ['reports-firmware', ...queryScopeKey],
    enabled: activeTab === 'firmware' && canSeeFullReports,
    queryFn: () =>
      apiRequest<FirmwareComplianceReportResponse>('/reports/firmware-compliance', {
        query: filterQueryObj,
      }),
  });

  const maintenanceQuery = useQuery({
    queryKey: ['reports-maintenance', ...queryScopeKey],
    enabled: activeTab === 'maintenance' && canSeeFullReports,
    queryFn: () =>
      apiRequest<MaintenanceReportResponse>('/reports/maintenance', { query: filterQueryObj }),
  });

  const platformHealthQuery = useQuery({
    queryKey: ['reports-platform-health'],
    enabled: activeTab === 'platform' && isPA,
    queryFn: () => apiRequest<PlatformHealthReportResponse>('/reports/platform-health'),
  });

  const exportAuditMutation = useMutation({
    mutationFn: (payload: ReportExportAuditRequest) =>
      apiRequest<{ ok: true; auditId: string }>('/reports/export-audit', {
        method: 'POST',
        body: payload,
      }),
  });

  const kpis = kpisQuery.data;
  const tenantCode = kpis?.filters.tenantCode ?? 'FLEET';
  const tenantName = kpis?.filters.tenantName ?? 'Organization';

  const buildActiveExportPayload = (): {
    slug: string;
    title: string;
    csv: CsvTableData;
    pdfSections: PdfTableSection[];
  } | null => {
    if (activeTab === 'availability' && availabilityQuery.data) {
      const d = availabilityQuery.data;
      return {
        slug: 'availability',
        title: 'Fleet Availability Report',
        csv: {
          headers: [
            'Device',
            'Serial Number',
            'Site',
            'Model',
            'State',
            'Connectivity',
            'Online Hours',
            'Eligible Hours',
            'Availability %',
          ],
          rows: d.devices.map((row) => [
            row.deviceName,
            row.serialNumber,
            row.siteName,
            row.modelName,
            row.state,
            row.connectivity,
            row.onlineHours,
            row.eligibleHours,
            row.availabilityPct !== null ? `${row.availabilityPct}%` : 'N/A',
          ]),
        },
        pdfSections: [
          {
            title: 'Availability by Site',
            headers: ['Site', 'Devices', 'Eligible', 'Online Hours', 'Eligible Hours', 'Availability %'],
            rows: d.bySite.map((s) => [
              s.name,
              s.deviceCount,
              s.eligibleDeviceCount,
              s.onlineHours,
              s.eligibleHours,
              s.availabilityPct !== null ? `${s.availabilityPct}%` : 'N/A',
            ]),
          },
          {
            title: 'Availability by Model',
            headers: ['Model', 'Devices', 'Eligible', 'Online Hours', 'Eligible Hours', 'Availability %'],
            rows: d.byModel.map((m) => [
              m.name,
              m.deviceCount,
              m.eligibleDeviceCount,
              m.onlineHours,
              m.eligibleHours,
              m.availabilityPct !== null ? `${m.availabilityPct}%` : 'N/A',
            ]),
          },
          {
            title: 'Per-Device Availability Breakdown',
            headers: ['Device', 'Site', 'Model', 'State', 'Online h', 'Eligible h', 'Availability %'],
            rows: d.devices.map((row) => [
              row.deviceName,
              row.siteName,
              row.modelName,
              row.state,
              row.onlineHours,
              row.eligibleHours,
              row.availabilityPct !== null ? `${row.availabilityPct}%` : 'N/A',
            ]),
          },
        ],
      };
    }

    if (activeTab === 'alerts' && alertsQuery.data) {
      const d = alertsQuery.data;
      return {
        slug: 'alerts',
        title: 'Alerts & Incident Volume Report',
        csv: {
          headers: [
            'Created At',
            'Severity',
            'Status',
            'Device',
            'Site',
            'Model',
            'Rule',
            'Message',
            'Acknowledged At',
            'Closed At',
          ],
          rows: d.items.map((a) => [
            a.createdAt,
            a.severity,
            a.status,
            a.deviceName,
            a.siteName,
            a.modelName,
            a.ruleName,
            a.message,
            a.acknowledgedAt ?? '',
            a.closedAt ?? '',
          ]),
        },
        pdfSections: [
          {
            title: 'Daily Alert Volume Trend',
            headers: ['Date (UTC)', 'Critical', 'Warning', 'Total'],
            rows: d.dailyTrend.map((pt) => [pt.date, pt.CRITICAL, pt.WARNING, pt.total]),
          },
          {
            title: 'Alerts in Selected Range',
            headers: ['Severity', 'Status', 'Device', 'Rule', 'Message', 'Created'],
            rows: d.items.map((a) => [
              a.severity,
              a.status,
              a.deviceName,
              a.ruleName,
              a.message,
              formatLocalDateTime(a.createdAt),
            ]),
          },
        ],
      };
    }

    if (activeTab === 'tickets' && ticketsQuery.data) {
      const d = ticketsQuery.data;
      return {
        slug: 'tickets-mttr',
        title: 'Tickets & MTTR Report',
        csv: {
          headers: [
            'Number',
            'Title',
            'Source',
            'Priority',
            'Status',
            'Device',
            'Site',
            'Assignee',
            'Created At',
            'Resolved At',
            'Resolution Hours',
          ],
          rows: d.items.map((t) => [
            t.number,
            t.title,
            t.source,
            t.priority,
            t.status,
            t.deviceName,
            t.siteName,
            t.assigneeName ?? 'Unassigned',
            t.createdAt,
            t.resolvedAt ?? '',
            t.resolutionHours ?? '',
          ]),
        },
        pdfSections: [
          {
            title: 'Open Tickets at Range End by Priority',
            headers: ['Critical', 'High', 'Medium', 'Low', 'Total Open'],
            rows: [
              [
                d.openByPriority.CRITICAL,
                d.openByPriority.HIGH,
                d.openByPriority.MEDIUM,
                d.openByPriority.LOW,
                d.openAtRangeEndCount,
              ],
            ],
          },
          {
            title: 'Tickets Detail',
            headers: ['Number', 'Title', 'Priority', 'Status', 'Device', 'Resolution (h)'],
            rows: d.items.map((t) => [
              t.number,
              t.title,
              t.priority,
              t.status,
              t.deviceName,
              t.resolutionHours !== null ? `${t.resolutionHours} h` : '—',
            ]),
          },
        ],
      };
    }

    if (activeTab === 'firmware' && firmwareQuery.data) {
      const d = firmwareQuery.data;
      return {
        slug: 'firmware-compliance',
        title: 'Firmware Compliance Report',
        csv: {
          headers: [
            'Device',
            'Serial Number',
            'Site',
            'Model',
            'State',
            'Current Version',
            'Latest Released Version',
          ],
          rows: d.nonCompliantDevices.map((nc) => [
            nc.deviceName,
            nc.serialNumber,
            nc.siteName,
            nc.modelName,
            nc.state,
            nc.currentVersion ?? 'None',
            nc.latestReleasedVersion,
          ]),
        },
        pdfSections: [
          {
            title: 'Firmware Compliance by Model',
            headers: ['Model', 'Latest Released', 'Eligible', 'Compliant', 'Non-Compliant', 'Compliance %'],
            rows: d.byModel.map((m) => [
              m.modelName,
              m.latestReleasedVersion ?? 'None',
              m.eligibleDevices,
              m.compliantDevices,
              m.nonCompliantDevices,
              m.compliancePct !== null ? `${m.compliancePct}%` : 'N/A',
            ]),
          },
          {
            title: 'Non-Compliant Devices',
            headers: ['Device', 'Serial', 'Site', 'Model', 'Current', 'Target Released'],
            rows: d.nonCompliantDevices.map((nc) => [
              nc.deviceName,
              nc.serialNumber,
              nc.siteName,
              nc.modelName,
              nc.currentVersion ?? 'None',
              nc.latestReleasedVersion,
            ]),
          },
        ],
      };
    }

    if (activeTab === 'maintenance' && maintenanceQuery.data) {
      const d = maintenanceQuery.data;
      return {
        slug: 'maintenance',
        title: 'Maintenance Completion Report',
        csv: {
          headers: [
            'Number',
            'Title',
            'Type',
            'Status',
            'Approval',
            'Device',
            'Site',
            'Technician',
            'Planned Start',
            'Completed At',
            'Time Spent (min)',
            'Outcome',
          ],
          rows: d.items.map((w) => [
            w.number,
            w.title,
            w.type,
            w.status,
            w.approvalStatus,
            w.deviceName,
            w.siteName,
            w.assignedToName ?? 'Unassigned',
            w.plannedStart ?? '',
            w.completedAt ?? '',
            w.timeSpentMin ?? '',
            w.outcome ?? '',
          ]),
        },
        pdfSections: [
          {
            title: 'Work Orders Scheduled in Range',
            headers: ['Number', 'Title', 'Type', 'Status', 'Device', 'Planned Start', 'Outcome'],
            rows: d.items.map((w) => [
              w.number,
              w.title,
              w.type,
              w.status,
              w.deviceName,
              w.plannedStart ? formatLocalDateTime(w.plannedStart) : '—',
              w.outcome ?? '—',
            ]),
          },
        ],
      };
    }

    if (activeTab === 'platform' && platformHealthQuery.data) {
      const d = platformHealthQuery.data;
      return {
        slug: 'platform-health',
        title: 'Platform Health Summary',
        csv: {
          headers: [
            'Organization',
            'Code',
            'Status',
            'Devices',
            'Online Devices',
            'Online %',
            'Open Critical Alerts',
            'Open Tickets',
            'Active Users',
            'Total Users',
          ],
          rows: d.tenantBreakdown.map((t) => [
            t.name,
            t.code,
            t.status,
            t.deviceCount,
            t.onlineCount,
            t.onlinePercentage !== null ? `${t.onlinePercentage}%` : 'N/A',
            t.openCriticalAlerts,
            t.openTickets,
            t.activeUserCount,
            t.userCount,
          ]),
        },
        pdfSections: [
          {
            title: 'Organizations Health Breakdown',
            headers: ['Organization', 'Code', 'Status', 'Devices', 'Online %', 'Critical Alerts', 'Open Tickets'],
            rows: d.tenantBreakdown.map((t) => [
              t.name,
              t.code,
              t.status,
              t.deviceCount,
              t.onlinePercentage !== null ? `${t.onlinePercentage}%` : 'N/A',
              t.openCriticalAlerts,
              t.openTickets,
            ]),
          },
        ],
      };
    }

    return null;
  };

  const handleExportCsv = () => {
    const payload = buildActiveExportPayload();
    if (!payload) {
      toast({ kind: 'info', title: 'Report is still loading', description: 'Wait a moment and try again.' });
      return;
    }
    const filename = buildReportFilename(tenantCode, payload.slug, from, to, 'csv');
    downloadCsvFile(filename, payload.csv);
    exportAuditMutation.mutate({
      format: 'CSV',
      reportType: payload.slug,
      from,
      to,
      siteId: siteId || null,
      modelId: modelId || null,
      tenantId: paTenantId || null,
      rowCount: payload.csv.rows.length,
    });
    toast({
      kind: 'success',
      title: 'CSV exported',
      description: `Downloaded ${filename} (${payload.csv.rows.length} rows).`,
    });
  };

  const handleExportPdf = () => {
    const payload = buildActiveExportPayload();
    if (!payload) {
      toast({ kind: 'info', title: 'Report is still loading', description: 'Wait a moment and try again.' });
      return;
    }
    const filename = buildReportFilename(tenantCode, payload.slug, from, to, 'pdf');
    const kpiRows: Array<{ label: string; value: string; detail: string }> = [
      {
        label: 'Fleet Availability %',
        value: kpis?.availabilityPct !== null && kpis?.availabilityPct !== undefined ? `${kpis.availabilityPct}%` : 'N/A',
        detail: `${kpis?.availabilityDeviceCount ?? 0} eligible ACTIVE / UNDER_MAINTENANCE devices`,
      },
      {
        label: 'Mean Time To Resolution (MTTR)',
        value: kpis?.mttrHours !== null && kpis?.mttrHours !== undefined ? `${kpis.mttrHours} h` : 'N/A',
        detail: `${kpis?.resolvedTicketsInRange ?? 0} ticket(s) resolved in range`,
      },
      {
        label: 'Alerts Created in Range',
        value: String(kpis?.alertsTotal ?? 0),
        detail: `Critical: ${kpis?.alertsBySeverity.CRITICAL ?? 0} · Warning: ${kpis?.alertsBySeverity.WARNING ?? 0}`,
      },
      {
        label: 'Open Tickets (at range end)',
        value: String(kpis?.openTicketsTotal ?? 0),
        detail: `Critical: ${kpis?.openTicketsByPriority.CRITICAL ?? 0} · High: ${kpis?.openTicketsByPriority.HIGH ?? 0} · Medium: ${kpis?.openTicketsByPriority.MEDIUM ?? 0} · Low: ${kpis?.openTicketsByPriority.LOW ?? 0}`,
      },
    ];

    if (canSeeFullReports) {
      kpiRows.push(
        {
          label: 'Firmware Compliance %',
          value:
            kpis?.firmwareCompliancePct !== null && kpis?.firmwareCompliancePct !== undefined
              ? `${kpis.firmwareCompliancePct}%`
              : 'N/A',
          detail: `${kpis?.firmwareCompliantCount ?? 0} of ${kpis?.firmwareEligibleCount ?? 0} eligible devices on latest RELEASED version`,
        },
        {
          label: 'Maintenance Completion Rate',
          value:
            kpis?.maintenanceCompletionRatePct !== null && kpis?.maintenanceCompletionRatePct !== undefined
              ? `${kpis.maintenanceCompletionRatePct}%`
              : 'N/A',
          detail: `${kpis?.maintenanceCompletedCount ?? 0} completed of ${kpis?.maintenancePlannedCount ?? 0} planned (excl. cancelled)`,
        },
      );
    }

    const filterParts: string[] = [];
    if (kpis?.filters.siteName) filterParts.push(`Site: ${kpis.filters.siteName}`);
    if (kpis?.filters.modelName) filterParts.push(`Model: ${kpis.filters.modelName}`);
    if (filterParts.length === 0) filterParts.push('All sites · All models');

    downloadPdfReport({
      filename,
      title: payload.title,
      subtitle: 'Operational KPI & Compliance Report (Section 13)',
      organizationLabel: `${tenantCode} — ${tenantName}`,
      dateRangeLabel: `${from} to ${to}`,
      filterSummary: filterParts.join(' · '),
      kpis: kpiRows,
      sections: payload.pdfSections,
    });

    exportAuditMutation.mutate({
      format: 'PDF',
      reportType: payload.slug,
      from,
      to,
      siteId: siteId || null,
      modelId: modelId || null,
      tenantId: paTenantId || null,
      rowCount: payload.csv.rows.length,
    });
    toast({
      kind: 'success',
      title: 'PDF exported',
      description: `Downloaded ${filename}.`,
    });
  };

  const tabMeta: Array<{
    id: ReportTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'availability', label: 'Availability', icon: Activity },
    { id: 'alerts', label: 'Alerts', icon: AlertTriangle },
    { id: 'tickets', label: 'Tickets & MTTR', icon: Ticket },
    ...(canSeeFullReports
      ? [
          { id: 'firmware' as const, label: 'Firmware Compliance', icon: ShieldCheck },
          { id: 'maintenance' as const, label: 'Maintenance', icon: Wrench },
        ]
      : []),
    ...(isPA ? [{ id: 'platform' as const, label: 'Platform Health', icon: BarChart3 }] : []),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports & KPIs"
        description={
          kpis
            ? `${kpis.filters.tenantCode} · ${kpis.filters.tenantName} · ${from} to ${to}`
            : 'Fleet availability, incident MTTR, alert trends, firmware compliance, and maintenance KPIs.'
        }
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleExportCsv}
              icon={<FileSpreadsheet className="w-4 h-4" />}
            >
              Export CSV
            </Button>
            <Button
              size="sm"
              onClick={handleExportPdf}
              icon={<FileText className="w-4 h-4" />}
            >
              Export PDF
            </Button>
          </div>
        }
      />

      {/* Global Report Filters Bar */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-medium text-slate-500 mr-1">Quick range:</span>
            <Button size="sm" variant="ghost" onClick={() => applyDatePreset(1)}>
              Last 24h
            </Button>
            <Button size="sm" variant="ghost" onClick={() => applyDatePreset(7)}>
              Last 7 days
            </Button>
            <Button size="sm" variant="ghost" onClick={() => applyDatePreset(30)}>
              Last 30 days
            </Button>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              updateParams({
                from: defaults.from,
                to: defaults.to,
                siteId: null,
                modelId: null,
                tenantId: null,
              })
            }
            icon={<RotateCcw className="w-3.5 h-3.5" />}
          >
            Reset filters
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <Input
            label="From date"
            type="date"
            value={from}
            onChange={(e) => updateParams({ from: e.target.value || defaults.from })}
          />
          <Input
            label="To date"
            type="date"
            value={to}
            onChange={(e) => updateParams({ to: e.target.value || defaults.to })}
          />
          {isPA ? (
            <Select
              label="Organization"
              value={paTenantId}
              onChange={(e) => updateParams({ tenantId: e.target.value || null, siteId: null })}
              options={[
                { value: '', label: 'All organizations' },
                ...(tenantsQuery.data?.items ?? []).map((t) => ({
                  value: t.id,
                  label: `${t.code} — ${t.name}`,
                })),
              ]}
            />
          ) : (
            <Select
              label="Site"
              value={siteId}
              onChange={(e) => updateParams({ siteId: e.target.value || null })}
              options={[
                { value: '', label: 'All sites' },
                ...(sitesQuery.data?.items ?? []).map((s) => ({
                  value: s.id,
                  label: s.name,
                })),
              ]}
            />
          )}
          <Select
            label="Device Model"
            value={modelId}
            onChange={(e) => updateParams({ modelId: e.target.value || null })}
            options={[
              { value: '', label: 'All models' },
              ...(modelsQuery.data?.items ?? []).map((m) => ({
                value: m.id,
                label: m.name,
              })),
            ]}
          />
          <div className="text-xs text-slate-500 pb-2">
            {isCO
              ? 'Operator view: availability, alerts & tickets.'
              : 'All KPIs recompute live for the selected filters.'}
          </div>
        </div>
      </Card>

      {/* Executive KPI Strip (Section 13) */}
      {kpisQuery.isError ? (
        <ErrorState
          message={
            kpisQuery.error instanceof ApiClientError
              ? kpisQuery.error.message
              : 'Unable to load KPI metrics.'
          }
          onRetry={() => void kpisQuery.refetch()}
        />
      ) : (
        <div
          className={`grid grid-cols-1 sm:grid-cols-2 ${
            canSeeFullReports ? 'lg:grid-cols-3 xl:grid-cols-6' : 'lg:grid-cols-4'
          } gap-4`}
        >
          <KpiCard
            label="Fleet Availability"
            loading={kpisQuery.isLoading}
            value={
              kpis?.availabilityPct !== null && kpis?.availabilityPct !== undefined
                ? `${kpis.availabilityPct}%`
                : 'N/A'
            }
            subtext={
              kpis ? `${kpis.availabilityDeviceCount} eligible devices` : undefined
            }
            tone={
              kpis?.availabilityPct === null || kpis?.availabilityPct === undefined
                ? 'default'
                : kpis.availabilityPct >= 95
                  ? 'emerald'
                  : kpis.availabilityPct >= 80
                    ? 'amber'
                    : 'red'
            }
          />
          <KpiCard
            label="MTTR"
            loading={kpisQuery.isLoading}
            value={
              kpis?.mttrHours !== null && kpis?.mttrHours !== undefined
                ? `${kpis.mttrHours} h`
                : 'N/A'
            }
            subtext={
              kpis ? `${kpis.resolvedTicketsInRange} resolved in range` : undefined
            }
          />
          <KpiCard
            label="Alerts in Range"
            loading={kpisQuery.isLoading}
            value={kpis?.alertsTotal ?? 0}
            subtext={
              kpis
                ? `${kpis.alertsBySeverity.CRITICAL} critical · ${kpis.alertsBySeverity.WARNING} warning`
                : undefined
            }
            tone={
              (kpis?.alertsBySeverity.CRITICAL ?? 0) > 0
                ? 'red'
                : (kpis?.alertsBySeverity.WARNING ?? 0) > 0
                  ? 'amber'
                  : 'emerald'
            }
          />
          <KpiCard
            label="Open Tickets"
            loading={kpisQuery.isLoading}
            value={kpis?.openTicketsTotal ?? 0}
            subtext={
              kpis
                ? `${kpis.openTicketsByPriority.CRITICAL + kpis.openTicketsByPriority.HIGH} critical/high`
                : 'At end of range'
            }
            tone={(kpis?.openTicketsByPriority.CRITICAL ?? 0) > 0 ? 'red' : 'default'}
          />
          {canSeeFullReports && (
            <>
              <KpiCard
                label="Firmware Compliance"
                loading={kpisQuery.isLoading}
                value={
                  kpis?.firmwareCompliancePct !== null && kpis?.firmwareCompliancePct !== undefined
                    ? `${kpis.firmwareCompliancePct}%`
                    : 'N/A'
                }
                subtext={
                  kpis
                    ? `${kpis.firmwareCompliantCount} / ${kpis.firmwareEligibleCount} on latest RELEASED`
                    : undefined
                }
                tone={
                  kpis?.firmwareCompliancePct === null || kpis?.firmwareCompliancePct === undefined
                    ? 'default'
                    : kpis.firmwareCompliancePct >= 90
                      ? 'emerald'
                      : kpis.firmwareCompliancePct >= 50
                        ? 'amber'
                        : 'red'
                }
              />
              <KpiCard
                label="Maintenance Completion"
                loading={kpisQuery.isLoading}
                value={
                  kpis?.maintenanceCompletionRatePct !== null &&
                  kpis?.maintenanceCompletionRatePct !== undefined
                    ? `${kpis.maintenanceCompletionRatePct}%`
                    : 'N/A'
                }
                subtext={
                  kpis
                    ? `${kpis.maintenanceCompletedCount} / ${kpis.maintenancePlannedCount} planned`
                    : 'Excl. cancelled'
                }
                tone={
                  kpis?.maintenanceCompletionRatePct === null ||
                  kpis?.maintenanceCompletionRatePct === undefined
                    ? 'default'
                    : kpis.maintenanceCompletionRatePct >= 80
                      ? 'emerald'
                      : 'amber'
                }
              />
            </>
          )}
        </div>
      )}

      {/* Report Tabs */}
      <div className="border-b border-slate-200 overflow-x-auto">
        <div role="tablist" aria-label="Report views" className="flex items-center gap-1 min-w-max">
          {tabMeta.map((tab) => {
            const Icon = tab.icon;
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => updateParams({ tab: tab.id })}
                className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-t-md ${
                  selected
                    ? 'border-indigo-600 text-indigo-700'
                    : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
                }`}
              >
                <Icon className="w-4 h-4" aria-hidden="true" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* TAB 1: Availability */}
      {activeTab === 'availability' && (
        <div className="space-y-6">
          {availabilityQuery.isError ? (
            <ErrorState
              message="Unable to load availability report."
              onRetry={() => void availabilityQuery.refetch()}
            />
          ) : availabilityQuery.isLoading ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="h-72 rounded-xl bg-white border border-slate-200 animate-pulse" />
              <div className="h-72 rounded-xl bg-white border border-slate-200 animate-pulse" />
            </div>
          ) : availabilityQuery.data ? (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <Card className="p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h2 className="text-sm font-semibold text-slate-900">Availability by Site</h2>
                      <p className="text-xs text-slate-500">
                        Mean ONLINE % across ACTIVE & UNDER MAINTENANCE devices
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Download className="w-3.5 h-3.5" />}
                      onClick={() => {
                        const fn = buildReportFilename(tenantCode, 'availability-by-site', from, to, 'csv');
                        downloadCsvFile(fn, {
                          headers: ['Site', 'Devices', 'Eligible', 'Online Hours', 'Eligible Hours', 'Availability %'],
                          rows: availabilityQuery.data.bySite.map((s) => [
                            s.name,
                            s.deviceCount,
                            s.eligibleDeviceCount,
                            s.onlineHours,
                            s.eligibleHours,
                            s.availabilityPct !== null ? `${s.availabilityPct}%` : 'N/A',
                          ]),
                        });
                        exportAuditMutation.mutate({
                          format: 'CSV',
                          reportType: 'availability-by-site',
                          from,
                          to,
                          siteId: siteId || null,
                          modelId: modelId || null,
                          tenantId: paTenantId || null,
                          rowCount: availabilityQuery.data.bySite.length,
                        });
                        toast({ kind: 'success', title: 'CSV exported', description: fn });
                      }}
                    >
                      CSV
                    </Button>
                  </div>
                  <div className="h-60 w-full">
                    {availabilityQuery.data.bySite.length > 0 ? (
                      <>
                        <p className="sr-only">
                          Availability by site:{' '}
                          {availabilityQuery.data.bySite
                            .map((s) => `${s.name} ${s.availabilityPct ?? 'N/A'}%`)
                            .join(', ')}
                          .
                        </p>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={availabilityQuery.data.bySite.map((s) => ({
                              name: s.name,
                              pct: s.availabilityPct ?? 0,
                            }))}
                            margin={{ top: 8, right: 16, left: -8, bottom: 4 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                            <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#475569' }} />
                            <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 11, fill: '#475569' }} />
                            <Tooltip formatter={(v) => [`${String(v)}%`, 'Availability']} />
                            <Bar dataKey="pct" fill="#4f46e5" radius={[6, 6, 0, 0]} isAnimationActive={false} />
                          </BarChart>
                        </ResponsiveContainer>
                      </>
                    ) : (
                      <EmptyState
                        title="No site data"
                        description="No devices match the active filters."
                        action={
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              updateParams({ siteId: null, modelId: null, tenantId: null })
                            }
                          >
                            Reset filters
                          </Button>
                        }
                      />
                    )}
                  </div>
                </Card>

                <Card className="p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h2 className="text-sm font-semibold text-slate-900">Availability by Model</h2>
                      <p className="text-xs text-slate-500">Mean availability per hardware family</p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Download className="w-3.5 h-3.5" />}
                      onClick={() => {
                        const fn = buildReportFilename(tenantCode, 'availability-by-model', from, to, 'csv');
                        downloadCsvFile(fn, {
                          headers: ['Model', 'Devices', 'Eligible', 'Online Hours', 'Eligible Hours', 'Availability %'],
                          rows: availabilityQuery.data.byModel.map((m) => [
                            m.name,
                            m.deviceCount,
                            m.eligibleDeviceCount,
                            m.onlineHours,
                            m.eligibleHours,
                            m.availabilityPct !== null ? `${m.availabilityPct}%` : 'N/A',
                          ]),
                        });
                        exportAuditMutation.mutate({
                          format: 'CSV',
                          reportType: 'availability-by-model',
                          from,
                          to,
                          siteId: siteId || null,
                          modelId: modelId || null,
                          tenantId: paTenantId || null,
                          rowCount: availabilityQuery.data.byModel.length,
                        });
                        toast({ kind: 'success', title: 'CSV exported', description: fn });
                      }}
                    >
                      CSV
                    </Button>
                  </div>
                  <div className="h-60 w-full">
                    {availabilityQuery.data.byModel.length > 0 ? (
                      <>
                        <p className="sr-only">
                          Availability by model:{' '}
                          {availabilityQuery.data.byModel
                            .map((m) => `${m.name} ${m.availabilityPct ?? 'N/A'}%`)
                            .join(', ')}
                          .
                        </p>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={availabilityQuery.data.byModel.map((m) => ({
                              name: m.name.split(' ')[0],
                              pct: m.availabilityPct ?? 0,
                            }))}
                            margin={{ top: 8, right: 16, left: -8, bottom: 4 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                            <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#475569' }} />
                            <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 11, fill: '#475569' }} />
                            <Tooltip formatter={(v) => [`${String(v)}%`, 'Availability']} />
                            <Bar dataKey="pct" fill="#059669" radius={[6, 6, 0, 0]} isAnimationActive={false} />
                          </BarChart>
                        </ResponsiveContainer>
                      </>
                    ) : (
                      <EmptyState
                        title="No model data"
                        description="No devices match the active filters."
                        action={
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              updateParams({ siteId: null, modelId: null, tenantId: null })
                            }
                          >
                            Reset filters
                          </Button>
                        }
                      />
                    )}
                  </div>
                </Card>
              </div>

              <Card className="overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">
                      Device Availability Breakdown ({availabilityQuery.data.devices.length})
                    </h2>
                    <p className="text-xs text-slate-500">
                      ONLINE duration divided by ACTIVE + UNDER MAINTENANCE time inside range.
                    </p>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                        <th className="px-5 py-3">Device</th>
                        <th className="px-4 py-3">Site</th>
                        <th className="px-4 py-3">Model</th>
                        <th className="px-4 py-3">State</th>
                        <th className="px-4 py-3">Connectivity</th>
                        <th className="px-4 py-3 text-right">Online / Eligible (h)</th>
                        <th className="px-5 py-3 text-right">Availability</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {availabilityQuery.data.devices.map((row) => (
                        <tr key={row.deviceId} className="hover:bg-slate-50">
                          <td className="px-5 py-3">
                            {isPA ? (
                              <span className="font-medium text-slate-900">{row.deviceName}</span>
                            ) : (
                              <Link
                                to={`/devices/${row.deviceId}`}
                                className="font-medium text-indigo-600 hover:underline"
                              >
                                {row.deviceName}
                              </Link>
                            )}
                            <p className="font-mono text-[11px] text-slate-500">{row.serialNumber}</p>
                          </td>
                          <td className="px-4 py-3 text-slate-700">{row.siteName}</td>
                          <td className="px-4 py-3 text-slate-700">{row.modelName}</td>
                          <td className="px-4 py-3">
                            <StatusChip status={row.state} />
                          </td>
                          <td className="px-4 py-3">
                            <StatusChip status={row.connectivity} />
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-600">
                            {row.onlineHours} / {row.eligibleHours}
                          </td>
                          <td className="px-5 py-3 text-right font-mono font-semibold tabular-nums">
                            {row.availabilityPct !== null ? (
                              <span
                                className={
                                  row.availabilityPct >= 95
                                    ? 'text-emerald-700'
                                    : row.availabilityPct >= 80
                                      ? 'text-amber-700'
                                      : 'text-red-700'
                                }
                              >
                                {row.availabilityPct}%
                              </span>
                            ) : (
                              <span className="text-slate-600">N/A</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          ) : null}
        </div>
      )}

      {/* TAB 2: Alerts */}
      {activeTab === 'alerts' && (
        <div className="space-y-6">
          {alertsQuery.isError ? (
            <ErrorState message="Unable to load alerts report." onRetry={() => void alertsQuery.refetch()} />
          ) : alertsQuery.isLoading ? (
            <div className="h-72 rounded-xl bg-white border border-slate-200 animate-pulse" />
          ) : alertsQuery.data ? (
            <>
              <Card className="p-5">
                <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">
                      Daily Alert Trend by Severity
                    </h2>
                    <p className="text-xs text-slate-500">
                      Total {alertsQuery.data.total} alert(s): {alertsQuery.data.bySeverity.CRITICAL}{' '}
                      Critical · {alertsQuery.data.bySeverity.WARNING} Warning
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <SeverityChip severity="CRITICAL" />
                    <span className="font-mono text-xs font-semibold text-slate-800">
                      {alertsQuery.data.bySeverity.CRITICAL}
                    </span>
                    <SeverityChip severity="WARNING" />
                    <span className="font-mono text-xs font-semibold text-slate-800">
                      {alertsQuery.data.bySeverity.WARNING}
                    </span>
                  </div>
                </div>
                <div className="h-64 w-full">
                  <p className="sr-only">
                    Daily alert trend from {from} to {to}: {alertsQuery.data.bySeverity.CRITICAL}{' '}
                    critical alerts and {alertsQuery.data.bySeverity.WARNING} warning alerts.
                  </p>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={alertsQuery.data.dailyTrend} margin={{ top: 8, right: 16, left: -8, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#475569' }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#475569' }} />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: '12px' }} />
                      <Line type="monotone" dataKey="CRITICAL" name="Critical" stroke="#dc2626" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                      <Line type="monotone" dataKey="WARNING" name="Warning" stroke="#d97706" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card className="overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200">
                  <h2 className="text-sm font-semibold text-slate-900">
                    Alerts Created in Range ({alertsQuery.data.items.length})
                  </h2>
                </div>
                {alertsQuery.data.items.length === 0 ? (
                  <EmptyState
                    icon={<CheckCircle2 className="w-8 h-8 text-emerald-600" />}
                    title="No alerts in this range"
                    description="Adjust the date range or filters to inspect historical alerts."
                    action={
                      <Button size="sm" variant="secondary" onClick={() => applyDatePreset(30)}>
                        Expand to Last 30 days
                      </Button>
                    }
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                          <th className="px-5 py-3">Severity</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3">Device & Site</th>
                          <th className="px-4 py-3">Rule & Message</th>
                          <th className="px-5 py-3 text-right">Created</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs">
                        {alertsQuery.data.items.map((a) => (
                          <tr key={a.id} className="hover:bg-slate-50">
                            <td className="px-5 py-3">
                              <SeverityChip severity={a.severity} />
                            </td>
                            <td className="px-4 py-3">
                              <StatusChip status={a.status} />
                            </td>
                            <td className="px-4 py-3">
                              <p className="font-medium text-slate-900">{a.deviceName}</p>
                              <p className="text-slate-500">{a.siteName}</p>
                            </td>
                            <td className="px-4 py-3">
                              <p className="font-medium text-slate-800">{a.ruleName}</p>
                              <p className="text-slate-500 line-clamp-1">{a.message}</p>
                            </td>
                            <td className="px-5 py-3 text-right font-mono text-slate-500 whitespace-nowrap">
                              {formatLocalDateTime(a.createdAt)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </>
          ) : null}
        </div>
      )}

      {/* TAB 3: Tickets & MTTR */}
      {activeTab === 'tickets' && (
        <div className="space-y-6">
          {ticketsQuery.isError ? (
            <ErrorState message="Unable to load tickets report." onRetry={() => void ticketsQuery.refetch()} />
          ) : ticketsQuery.isLoading ? (
            <div className="h-72 rounded-xl bg-white border border-slate-200 animate-pulse" />
          ) : ticketsQuery.data ? (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <Card className="p-5">
                  <h2 className="text-sm font-semibold text-slate-900">Open Tickets by Priority</h2>
                  <p className="text-xs text-slate-500 mb-3">
                    Tickets with status not CLOSED at the end of the selected range ({ticketsQuery.data.openAtRangeEndCount} open).
                  </p>
                  <div className="h-56 w-full">
                    <p className="sr-only">
                      Open tickets by priority: {ticketsQuery.data.openByPriority.CRITICAL} critical,{' '}
                      {ticketsQuery.data.openByPriority.HIGH} high,{' '}
                      {ticketsQuery.data.openByPriority.MEDIUM} medium,{' '}
                      {ticketsQuery.data.openByPriority.LOW} low.
                    </p>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={[
                          { priority: 'Critical', count: ticketsQuery.data.openByPriority.CRITICAL },
                          { priority: 'High', count: ticketsQuery.data.openByPriority.HIGH },
                          { priority: 'Medium', count: ticketsQuery.data.openByPriority.MEDIUM },
                          { priority: 'Low', count: ticketsQuery.data.openByPriority.LOW },
                        ]}
                        margin={{ top: 8, right: 16, left: -12, bottom: 4 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="priority" tick={{ fontSize: 11, fill: '#475569' }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#475569' }} />
                        <Tooltip />
                        <Bar dataKey="count" name="Open Tickets" fill="#4f46e5" radius={[6, 6, 0, 0]} isAnimationActive={false} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>

                <Card className="p-5 flex flex-col justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">MTTR & Open Status Breakdown</h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Mean of (resolvedAt − createdAt) for tickets resolved within the range.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 my-4">
                    <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-4">
                      <p className="text-xs font-medium text-indigo-800">Mean Time To Resolution</p>
                      <p className="text-2xl font-bold font-mono text-indigo-950 mt-1">
                        {ticketsQuery.data.mttrHours !== null ? `${ticketsQuery.data.mttrHours} h` : 'N/A'}
                      </p>
                      <p className="text-xs text-indigo-700 mt-1">
                        Across {ticketsQuery.data.resolvedInRangeCount} resolved ticket(s)
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-1.5 text-xs">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Open</span>
                        <span className="font-mono font-semibold text-slate-900">{ticketsQuery.data.openByStatus.OPEN}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">In Progress</span>
                        <span className="font-mono font-semibold text-slate-900">{ticketsQuery.data.openByStatus.IN_PROGRESS}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Waiting on Client</span>
                        <span className="font-mono font-semibold text-slate-900">{ticketsQuery.data.openByStatus.WAITING_ON_CLIENT}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Resolved (awaiting confirm)</span>
                        <span className="font-mono font-semibold text-slate-900">{ticketsQuery.data.openByStatus.RESOLVED}</span>
                      </div>
                    </div>
                  </div>
                </Card>
              </div>

              <Card className="overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200">
                  <h2 className="text-sm font-semibold text-slate-900">
                    Tickets in Scope ({ticketsQuery.data.items.length})
                  </h2>
                </div>
                {ticketsQuery.data.items.length === 0 ? (
                  <EmptyState
                    title="No tickets in scope"
                    description="No tickets match the selected filters."
                    action={
                      <Button size="sm" variant="secondary" onClick={() => applyDatePreset(30)}>
                        Expand to Last 30 days
                      </Button>
                    }
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                          <th className="px-5 py-3">Ticket</th>
                          <th className="px-4 py-3">Priority</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3">Device & Site</th>
                          <th className="px-4 py-3">Assignee</th>
                          <th className="px-5 py-3 text-right">Resolution Time</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs">
                        {ticketsQuery.data.items.map((t) => (
                          <tr key={t.id} className="hover:bg-slate-50">
                            <td className="px-5 py-3">
                              {isPA ? (
                                <span className="font-mono font-semibold text-slate-900">{t.number}</span>
                              ) : (
                                <Link to={`/tickets/${t.id}`} className="font-mono font-semibold text-indigo-600 hover:underline">
                                  {t.number}
                                </Link>
                              )}
                              <p className="text-slate-700 mt-0.5 line-clamp-1">{t.title}</p>
                            </td>
                            <td className="px-4 py-3">
                              <StatusChip status={t.priority} />
                            </td>
                            <td className="px-4 py-3">
                              <StatusChip status={t.status} />
                            </td>
                            <td className="px-4 py-3">
                              <p className="text-slate-800">{t.deviceName}</p>
                              <p className="text-slate-500">{t.siteName}</p>
                            </td>
                            <td className="px-4 py-3 text-slate-700">{t.assigneeName ?? 'Unassigned'}</td>
                            <td className="px-5 py-3 text-right font-mono tabular-nums text-slate-700">
                              {t.resolutionHours !== null ? `${t.resolutionHours} h` : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </>
          ) : null}
        </div>
      )}

      {/* TAB 4: Firmware Compliance */}
      {activeTab === 'firmware' && canSeeFullReports && (
        <div className="space-y-6">
          {firmwareQuery.isError ? (
            <ErrorState message="Unable to load firmware compliance report." onRetry={() => void firmwareQuery.refetch()} />
          ) : firmwareQuery.isLoading ? (
            <div className="h-72 rounded-xl bg-white border border-slate-200 animate-pulse" />
          ) : firmwareQuery.data ? (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <Card className="p-5">
                  <h2 className="text-sm font-semibold text-slate-900">Compliance % by Device Model</h2>
                  <p className="text-xs text-slate-500 mb-3">
                    Devices running the latest RELEASED firmware version of their model.
                  </p>
                  <div className="h-56 w-full">
                    <p className="sr-only">
                      Firmware compliance by model:{' '}
                      {firmwareQuery.data.byModel
                        .map((m) => `${m.modelName} ${m.compliancePct ?? 'N/A'}%`)
                        .join(', ')}
                      .
                    </p>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={firmwareQuery.data.byModel.map((m) => ({
                          name: m.modelName.split(' ')[0],
                          pct: m.compliancePct ?? 0,
                        }))}
                        margin={{ top: 8, right: 16, left: -8, bottom: 4 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#475569' }} />
                        <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 11, fill: '#475569' }} />
                        <Tooltip formatter={(v) => [`${String(v)}%`, 'Compliance']} />
                        <Bar dataKey="pct" fill="#059669" radius={[6, 6, 0, 0]} isAnimationActive={false} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>

                <Card className="overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-200">
                    <h2 className="text-sm font-semibold text-slate-900">Per-Model Release Summary</h2>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                          <th className="px-5 py-3">Model</th>
                          <th className="px-4 py-3">Latest Released</th>
                          <th className="px-4 py-3 text-right">Compliant / Eligible</th>
                          <th className="px-5 py-3 text-right">Compliance %</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs">
                        {firmwareQuery.data.byModel.map((m) => (
                          <tr key={m.modelId}>
                            <td className="px-5 py-3 font-medium text-slate-900">{m.modelName}</td>
                            <td className="px-4 py-3 font-mono text-indigo-700 font-semibold">
                              {m.latestReleasedVersion ? `v${m.latestReleasedVersion}` : 'None'}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-slate-700">
                              {m.compliantDevices} / {m.eligibleDevices}
                            </td>
                            <td className="px-5 py-3 text-right font-mono font-semibold text-slate-900">
                              {m.compliancePct !== null ? `${m.compliancePct}%` : 'N/A'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>

              <Card className="overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">
                      Non-Compliant Devices ({firmwareQuery.data.nonCompliantDevices.length})
                    </h2>
                    <p className="text-xs text-slate-500">
                      Devices not yet running the latest RELEASED firmware for their model.
                    </p>
                  </div>
                  {(user?.role === 'CLIENT_ADMIN' || user?.role === 'SUPPORT_ENGINEER') &&
                    firmwareQuery.data.nonCompliantDevices.length > 0 && (
                      <Link
                        to="/rollouts"
                        className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
                      >
                        Plan OTA Rollout →
                      </Link>
                    )}
                </div>
                {firmwareQuery.data.nonCompliantDevices.length === 0 ? (
                  <EmptyState
                    icon={<ShieldCheck className="w-8 h-8 text-emerald-600" />}
                    title="100% firmware compliant"
                    description="All eligible devices are running the latest RELEASED version for their model."
                    action={
                      !isPA ? (
                        <Link
                          to="/rollouts"
                          className="inline-flex items-center justify-center h-8 px-3 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-800 hover:bg-slate-50 transition-colors"
                        >
                          View OTA Rollouts
                        </Link>
                      ) : undefined
                    }
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                          <th className="px-5 py-3">Device</th>
                          <th className="px-4 py-3">Site</th>
                          <th className="px-4 py-3">Model</th>
                          <th className="px-4 py-3">State</th>
                          <th className="px-4 py-3">Current Version</th>
                          <th className="px-5 py-3 text-right">Latest Released</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs">
                        {firmwareQuery.data.nonCompliantDevices.map((nc) => (
                          <tr key={nc.deviceId} className="hover:bg-slate-50">
                            <td className="px-5 py-3">
                              {isPA ? (
                                <span className="font-medium text-slate-900">{nc.deviceName}</span>
                              ) : (
                                <Link
                                  to={`/devices/${nc.deviceId}`}
                                  className="font-medium text-indigo-600 hover:underline"
                                >
                                  {nc.deviceName}
                                </Link>
                              )}
                              <p className="font-mono text-[11px] text-slate-500">{nc.serialNumber}</p>
                            </td>
                            <td className="px-4 py-3 text-slate-700">{nc.siteName}</td>
                            <td className="px-4 py-3 text-slate-700">{nc.modelName}</td>
                            <td className="px-4 py-3">
                              <StatusChip status={nc.state} />
                            </td>
                            <td className="px-4 py-3 font-mono text-amber-700 font-semibold">
                              {nc.currentVersion ? `v${nc.currentVersion}` : 'Unreported'}
                            </td>
                            <td className="px-5 py-3 text-right font-mono text-emerald-700 font-semibold">
                              v{nc.latestReleasedVersion}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </>
          ) : null}
        </div>
      )}

      {/* TAB 5: Maintenance */}
      {activeTab === 'maintenance' && canSeeFullReports && (
        <div className="space-y-6">
          {maintenanceQuery.isError ? (
            <ErrorState message="Unable to load maintenance report." onRetry={() => void maintenanceQuery.refetch()} />
          ) : maintenanceQuery.isLoading ? (
            <div className="h-72 rounded-xl bg-white border border-slate-200 animate-pulse" />
          ) : maintenanceQuery.data ? (
            <>
              <Card className="p-5">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">
                      Planned vs. Completed Work Orders by Type
                    </h2>
                    <p className="text-xs text-slate-500">
                      Completion rate:{' '}
                      <strong className="font-mono text-slate-900">
                        {maintenanceQuery.data.completionRatePct !== null
                          ? `${maintenanceQuery.data.completionRatePct}%`
                          : 'N/A'}
                      </strong>{' '}
                      ({maintenanceQuery.data.completedCount} completed of{' '}
                      {maintenanceQuery.data.plannedNonCancelledCount} non-cancelled scheduled in range;{' '}
                      {maintenanceQuery.data.cancelledCount} cancelled excluded)
                    </p>
                  </div>
                </div>
                <div className="h-56 w-full">
                  <p className="sr-only">
                    Maintenance completion by type: Preventive {maintenanceQuery.data.byType.PREVENTIVE.completed}{' '}
                    of {maintenanceQuery.data.byType.PREVENTIVE.planned}, Corrective{' '}
                    {maintenanceQuery.data.byType.CORRECTIVE.completed} of{' '}
                    {maintenanceQuery.data.byType.CORRECTIVE.planned}.
                  </p>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={[
                        {
                          type: 'Preventive',
                          planned: maintenanceQuery.data.byType.PREVENTIVE.planned,
                          completed: maintenanceQuery.data.byType.PREVENTIVE.completed,
                        },
                        {
                          type: 'Corrective',
                          planned: maintenanceQuery.data.byType.CORRECTIVE.planned,
                          completed: maintenanceQuery.data.byType.CORRECTIVE.completed,
                        },
                      ]}
                      margin={{ top: 8, right: 16, left: -12, bottom: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="type" tick={{ fontSize: 11, fill: '#475569' }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#475569' }} />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: '12px' }} />
                      <Bar dataKey="planned" name="Planned (non-cancelled)" fill="#64748b" radius={[6, 6, 0, 0]} isAnimationActive={false} />
                      <Bar dataKey="completed" name="Completed" fill="#059669" radius={[6, 6, 0, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card className="overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200">
                  <h2 className="text-sm font-semibold text-slate-900">
                    Work Orders Scheduled in Range ({maintenanceQuery.data.items.length})
                  </h2>
                </div>
                {maintenanceQuery.data.items.length === 0 ? (
                  <EmptyState
                    icon={<Wrench className="w-8 h-8 text-slate-500" />}
                    title="No scheduled work orders in this range"
                    description="Widen the date range to include upcoming or past maintenance schedules."
                    action={
                      <Button size="sm" variant="secondary" onClick={() => applyDatePreset(30)}>
                        Expand to Last 30 days
                      </Button>
                    }
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                          <th className="px-5 py-3">Work Order</th>
                          <th className="px-4 py-3">Type</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3">Device & Site</th>
                          <th className="px-4 py-3">Technician</th>
                          <th className="px-4 py-3">Planned Start</th>
                          <th className="px-5 py-3 text-right">Outcome / Time</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs">
                        {maintenanceQuery.data.items.map((w) => (
                          <tr key={w.id} className="hover:bg-slate-50">
                            <td className="px-5 py-3">
                              {isPA ? (
                                <span className="font-mono font-semibold text-slate-900">{w.number}</span>
                              ) : (
                                <Link
                                  to={`/work-orders/${w.id}`}
                                  className="font-mono font-semibold text-indigo-600 hover:underline"
                                >
                                  {w.number}
                                </Link>
                              )}
                              <p className="text-slate-700 mt-0.5 line-clamp-1">{w.title}</p>
                            </td>
                            <td className="px-4 py-3">
                              <StatusChip status={w.type} />
                            </td>
                            <td className="px-4 py-3">
                              <StatusChip status={w.status} />
                            </td>
                            <td className="px-4 py-3">
                              <p className="text-slate-800">{w.deviceName}</p>
                              <p className="text-slate-500">{w.siteName}</p>
                            </td>
                            <td className="px-4 py-3 text-slate-700">
                              {w.assignedToName ?? 'Unassigned'}
                            </td>
                            <td className="px-4 py-3 font-mono text-slate-600 whitespace-nowrap">
                              {w.plannedStart ? formatLocalDateTime(w.plannedStart) : '—'}
                            </td>
                            <td className="px-5 py-3 text-right font-mono text-slate-700">
                              {w.outcome ? `${w.outcome}${w.timeSpentMin ? ` (${w.timeSpentMin}m)` : ''}` : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </>
          ) : null}
        </div>
      )}

      {/* TAB 6: Platform Health (PA only) */}
      {activeTab === 'platform' && isPA && (
        <div className="space-y-6">
          {platformHealthQuery.isError ? (
            <ErrorState
              message="Unable to load platform health report."
              onRetry={() => void platformHealthQuery.refetch()}
            />
          ) : platformHealthQuery.isLoading ? (
            <div className="h-72 rounded-xl bg-white border border-slate-200 animate-pulse" />
          ) : platformHealthQuery.data ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiCard
                  label="Messages / Min (Last Hour)"
                  value={`${platformHealthQuery.data.messagesPerMinute} /m`}
                  subtext={`${platformHealthQuery.data.messagesLastHour} msgs · ${platformHealthQuery.data.invalidPayloadRate}% invalid`}
                />
                <KpiCard
                  label="Open Critical Alerts"
                  value={platformHealthQuery.data.openCriticalAlerts}
                  subtext="Platform-wide"
                  tone={platformHealthQuery.data.openCriticalAlerts > 0 ? 'red' : 'emerald'}
                />
                <KpiCard
                  label="Email Delivery Failures"
                  value={platformHealthQuery.data.emailOutbox.failed}
                  subtext={`${platformHealthQuery.data.emailOutbox.queued} queued · ${platformHealthQuery.data.emailOutbox.sent} sent`}
                  tone={platformHealthQuery.data.emailOutbox.failed > 0 ? 'red' : 'emerald'}
                />
                <KpiCard
                  label="Firmware Packages"
                  value={platformHealthQuery.data.firmwarePackages.total}
                  subtext={`${platformHealthQuery.data.firmwarePackages.released} released · ${platformHealthQuery.data.firmwarePackages.draft} draft`}
                />
              </div>

              <Card className="overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">
                      Organizations Health Breakdown
                    </h2>
                    <p className="text-xs text-slate-500">
                      Per-tenant device fleet, online percentage, critical alerts, and open tickets.
                    </p>
                  </div>
                  <Link to="/platform" className="text-xs font-medium text-indigo-600 hover:underline">
                    Open Platform Console →
                  </Link>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                        <th className="px-5 py-3">Organization</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3 text-right">Devices</th>
                        <th className="px-4 py-3 text-right">Online %</th>
                        <th className="px-4 py-3 text-right">Critical Alerts</th>
                        <th className="px-4 py-3 text-right">Open Tickets</th>
                        <th className="px-5 py-3 text-right">Active Users</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {platformHealthQuery.data.tenantBreakdown.map((t) => (
                        <tr key={t.id} className="hover:bg-slate-50">
                          <td className="px-5 py-3">
                            <Link to={`/tenants/${t.id}`} className="font-medium text-indigo-600 hover:underline">
                              {t.name}
                            </Link>
                            <span className="ml-2 font-mono text-slate-500">{t.code}</span>
                          </td>
                          <td className="px-4 py-3">
                            <StatusChip status={t.status} />
                          </td>
                          <td className="px-4 py-3 text-right font-mono">{t.deviceCount}</td>
                          <td className="px-4 py-3 text-right font-mono font-semibold text-slate-800">
                            {t.onlinePercentage !== null ? `${t.onlinePercentage}%` : '—'}
                          </td>
                          <td className="px-4 py-3 text-right font-mono">
                            <span className={t.openCriticalAlerts > 0 ? 'text-red-600 font-semibold' : 'text-slate-600'}>
                              {t.openCriticalAlerts}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-mono">{t.openTickets}</td>
                          <td className="px-5 py-3 text-right font-mono">
                            {t.activeUserCount} / {t.userCount}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          ) : null}
        </div>
      )}

      {/* Subtle footnote */}
      <div className="flex items-center gap-2 text-xs text-slate-600">
        <Cpu className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
        <span>
          Every CSV and PDF export is recorded in the append-only Audit Log as{' '}
          <code className="font-mono text-slate-700">REPORT_EXPORTED</code>.
        </span>
      </div>
    </div>
  );
}
