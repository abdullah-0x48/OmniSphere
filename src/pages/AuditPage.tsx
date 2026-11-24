import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  FileSpreadsheet,
  Lock,
  RotateCcw,
  Search,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import type { AuditLog, PaginatedResponse, TenantSummary } from '../../shared/types.ts';
import { ApiClientError, apiRequest } from '../api/client.ts';
import { useAuth } from '../auth/AuthContext.tsx';
import {
  Button,
  Card,
  DataTable,
  Input,
  PageHeader,
  Select,
  StatusChip,
  useToast,
  type Column,
} from '../components/ui/index.ts';
import { formatLocalDateTime } from '../utils/format.ts';
import { buildReportFilename, downloadCsvFile } from '../utils/reportExport.ts';

const TARGET_TYPE_OPTIONS = [
  { value: '', label: 'All target types' },
  { value: 'TENANT', label: 'Tenant' },
  { value: 'USER', label: 'User' },
  { value: 'SITE', label: 'Site' },
  { value: 'DEVICE_MODEL', label: 'Device Model' },
  { value: 'DEVICE', label: 'Device' },
  { value: 'ALERT_RULE', label: 'Alert Rule' },
  { value: 'ALERT', label: 'Alert' },
  { value: 'TICKET', label: 'Ticket' },
  { value: 'WORK_ORDER', label: 'Work Order' },
  { value: 'MAINTENANCE_PLAN', label: 'Maintenance Plan' },
  { value: 'CONFIG_PROFILE', label: 'Config Profile' },
  { value: 'FIRMWARE', label: 'Firmware' },
  { value: 'ROLLOUT', label: 'Rollout' },
  { value: 'REPORT', label: 'Report' },
];

export function AuditPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const isPA = user?.role === 'PLATFORM_ADMIN';

  const actor = searchParams.get('actor') ?? '';
  const action = searchParams.get('action') ?? '';
  const targetType = searchParams.get('targetType') ?? '';
  const target = searchParams.get('target') ?? '';
  const outcome = searchParams.get('outcome') ?? '';
  const tenantId = searchParams.get('tenantId') ?? '';
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const page = Number(searchParams.get('page') ?? '1') || 1;
  const sort = searchParams.get('sort') ?? 'at:desc';

  const [actorInput, setActorInput] = useState(actor);
  const [actionInput, setActionInput] = useState(action);
  const [targetInput, setTargetInput] = useState(target);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    setActorInput(actor);
    setActionInput(action);
    setTargetInput(target);
  }, [actor, action, target]);

  const updateParams = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(updates)) {
      if (!v) next.delete(k);
      else next.set(k, v);
    }
    setSearchParams(next, { replace: true });
  };

  const tenantsQuery = useQuery({
    queryKey: ['audit-tenants-filter'],
    queryFn: () =>
      apiRequest<PaginatedResponse<TenantSummary>>('/tenants', {
        query: { page: 1, pageSize: 200, sort: 'name:asc' },
      }),
    enabled: isPA,
  });

  const auditQuery = useQuery({
    queryKey: [
      'audit-logs',
      { actor, action, targetType, target, outcome, tenantId, from, to, page, sort },
    ],
    queryFn: () =>
      apiRequest<PaginatedResponse<AuditLog>>('/audit', {
        query: {
          actor,
          action,
          targetType,
          target,
          outcome,
          tenantId: isPA ? tenantId : undefined,
          from: from ? new Date(from).toISOString() : undefined,
          to: to ? new Date(`${to}T23:59:59.999Z`).toISOString() : undefined,
          page,
          pageSize: 25,
          sort,
        },
      }),
  });

  const copyJson = async (details: Record<string, unknown>) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(details, null, 2));
      toast({ kind: 'info', title: 'Audit details copied' });
    } catch {
      toast({ kind: 'error', title: 'Copy failed' });
    }
  };

  const exportVisibleCsv = () => {
    const rows = auditQuery.data?.items ?? [];
    const today = new Date().toISOString().slice(0, 10);
    const filename = buildReportFilename(
      isPA ? 'PLATFORM' : 'TENANT',
      'audit-log',
      from || today,
      to || today,
      'csv',
    );
    downloadCsvFile(filename, {
      headers: [
        'Timestamp (UTC)',
        'Action',
        'Actor Email',
        'Actor Role',
        'Tenant',
        'Target Type',
        'Target ID',
        'Outcome',
        'IP',
        'Details JSON',
      ],
      rows: rows.map((r) => [
        r.at,
        r.action,
        r.actorEmail ?? r.actorId,
        r.actorRole,
        r.tenantCode ?? (r.tenantId ? r.tenantId : 'Platform'),
        r.targetType,
        r.targetId,
        r.outcome,
        r.ip,
        JSON.stringify(r.details),
      ]),
    });
    toast({ kind: 'success', title: 'Audit log exported', description: `${filename} (${rows.length} rows).` });
  };

  const columns: Column<AuditLog>[] = [
    {
      key: 'expand',
      header: '',
      hideOnMobile: true,
      render: (row) => (
        <span className="text-slate-500">
          {expandedId === row.id ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
        </span>
      ),
    },
    {
      key: 'at',
      header: 'Timestamp',
      sortKey: 'at',
      render: (row) => (
        <span className="font-mono text-xs tabular-nums text-slate-600 whitespace-nowrap">
          {formatLocalDateTime(row.at)}
        </span>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      render: (row) => (
        <span className="font-mono text-xs font-semibold text-slate-900">{row.action}</span>
      ),
    },
    {
      key: 'actor',
      header: 'Actor',
      render: (row) => (
        <div>
          <p className="text-xs font-medium text-slate-800">{row.actorEmail ?? row.actorId}</p>
          <p className="text-[11px] text-slate-500">{row.actorRole}</p>
        </div>
      ),
    },
    ...(isPA
      ? [
          {
            key: 'tenant',
            header: 'Tenant',
            render: (row: AuditLog) => (
              <span className="font-mono text-xs text-slate-600">
                {row.tenantCode ?? (row.tenantId ? row.tenantId : 'Platform')}
              </span>
            ),
          },
        ]
      : []),
    {
      key: 'target',
      header: 'Target',
      render: (row) => (
        <span className="font-mono text-xs text-slate-700">
          {row.targetType} · {row.targetId}
        </span>
      ),
    },
    {
      key: 'outcome',
      header: 'Outcome',
      render: (row) => <StatusChip status={row.outcome} />,
    },
    {
      key: 'ip',
      header: 'IP',
      hideOnMobile: true,
      render: (row) => <span className="font-mono text-xs text-slate-500">{row.ip}</span>,
    },
  ];

  const resetFilters = () => {
    setSearchParams({}, { replace: true });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Log"
        description={
          isPA
            ? 'Append-only, read-only security record across all organizations. Click any row to inspect details JSON.'
            : 'Append-only, read-only security record scoped strictly to your organization. Click any row to inspect details JSON.'
        }
        actions={
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-600 px-2.5 py-1.5 rounded-lg bg-slate-100 border border-slate-200">
              <Lock className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
              Immutable · Read-only
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={exportVisibleCsv}
              disabled={(auditQuery.data?.items ?? []).length === 0}
              icon={<FileSpreadsheet className="w-4 h-4" />}
            >
              Export CSV
            </Button>
          </div>
        }
      />

      <Card className="p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            updateParams({
              actor: actorInput.trim() || null,
              action: actionInput.trim() || null,
              target: targetInput.trim() || null,
              page: '1',
            });
          }}
          className="space-y-3"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Input
              label="Actor"
              placeholder="Email, name, or ID..."
              value={actorInput}
              onChange={(e) => setActorInput(e.target.value)}
            />
            <div>
              <Input
                label="Action"
                list="audit-action-suggestions"
                placeholder="e.g. REPORT_EXPORTED"
                value={actionInput}
                onChange={(e) => setActionInput(e.target.value)}
              />
              <datalist id="audit-action-suggestions">
                <option value="LOGIN_SUCCESS" />
                <option value="LOGIN_FAILED" />
                <option value="REPORT_EXPORTED" />
                <option value="DEVICE_REGISTERED" />
                <option value="DEVICE_STATE_CHANGED" />
                <option value="DEVICE_DECOMMISSIONED" />
                <option value="FIRMWARE_UPLOADED" />
                <option value="FIRMWARE_STATUS_CHANGED" />
                <option value="ROLLOUT_CREATED" />
                <option value="ROLLOUT_APPROVED" />
                <option value="CONFIG_PUSHED" />
                <option value="WORK_ORDER_COMPLETED" />
              </datalist>
            </div>
            <Select
              label="Target type"
              value={targetType}
              onChange={(e) => updateParams({ targetType: e.target.value || null, page: '1' })}
              options={TARGET_TYPE_OPTIONS}
            />
            <Input
              label="Target ID"
              placeholder="e.g. dev_ktl_001 or rol_..."
              value={targetInput}
              onChange={(e) => setTargetInput(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
            <Select
              label="Outcome"
              value={outcome}
              onChange={(e) => updateParams({ outcome: e.target.value || null, page: '1' })}
              options={[
                { value: '', label: 'All outcomes' },
                { value: 'SUCCESS', label: 'Success' },
                { value: 'FAILURE', label: 'Failure' },
              ]}
            />
            {isPA && (
              <Select
                label="Organization"
                value={tenantId}
                onChange={(e) => updateParams({ tenantId: e.target.value || null, page: '1' })}
                options={[
                  { value: '', label: 'All organizations' },
                  ...(tenantsQuery.data?.items ?? []).map((t) => ({
                    value: t.id,
                    label: `${t.code} — ${t.name}`,
                  })),
                ]}
              />
            )}
            <Input
              label="From date"
              type="date"
              value={from}
              onChange={(e) => updateParams({ from: e.target.value || null, page: '1' })}
            />
            <Input
              label="To date"
              type="date"
              value={to}
              onChange={(e) => updateParams({ to: e.target.value || null, page: '1' })}
            />
            <div className="flex items-center gap-2">
              <Button
                type="submit"
                variant="secondary"
                icon={<Search className="w-4 h-4" />}
                className="flex-1"
              >
                Apply
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="md"
                onClick={resetFilters}
                aria-label="Reset filters"
                icon={<RotateCcw className="w-4 h-4" />}
              >
                Reset
              </Button>
            </div>
          </div>
        </form>
      </Card>

      <DataTable
        columns={columns}
        rows={auditQuery.data?.items ?? []}
        rowKey={(row) => row.id}
        total={auditQuery.data?.total ?? 0}
        page={page}
        pageSize={25}
        onPageChange={(nextPage) => updateParams({ page: String(nextPage) })}
        sort={sort}
        onSortChange={(nextSort) => updateParams({ sort: nextSort, page: '1' })}
        isLoading={auditQuery.isLoading}
        error={
          auditQuery.isError
            ? auditQuery.error instanceof ApiClientError
              ? auditQuery.error.message
              : 'Unable to load audit logs.'
            : null
        }
        onRetry={() => void auditQuery.refetch()}
        onRowClick={(row) => setExpandedId((prev) => (prev === row.id ? null : row.id))}
        expandedRowId={expandedId}
        renderExpanded={(row) => (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3 text-xs text-slate-500 flex-wrap">
                <span>
                  Event ID: <span className="font-mono text-slate-700">{row.id}</span>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  IP: <span className="font-mono text-slate-700">{row.ip}</span>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  UTC: <span className="font-mono text-slate-700">{row.at}</span>
                </span>
              </div>
              <Button
                size="sm"
                variant="secondary"
                icon={<Copy className="w-3.5 h-3.5" />}
                onClick={(e) => {
                  e.stopPropagation();
                  void copyJson(row.details);
                }}
              >
                Copy JSON
              </Button>
            </div>
            <pre className="rounded-lg bg-slate-900 text-slate-100 p-3.5 text-xs font-mono overflow-x-auto">
              {JSON.stringify(row.details, null, 2)}
            </pre>
          </div>
        )}
        emptyTitle="No matching audit entries"
        emptyDescription="Audit entries are created automatically for sign-ins, device operations, rollouts, and report exports."
        emptyAction={
          actor || action || targetType || target || outcome || tenantId || from || to ? (
            <Button size="sm" variant="secondary" onClick={resetFilters}>
              Reset filters
            </Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => void auditQuery.refetch()}>
              Refresh
            </Button>
          )
        }
      />
    </div>
  );
}
