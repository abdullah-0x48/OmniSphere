import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, RotateCcw, Search } from 'lucide-react';
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
  type Column,
} from '../components/ui/index.ts';
import { formatLocalDateTime } from '../utils/format.ts';

export function AuditPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const isPA = user?.role === 'PLATFORM_ADMIN';

  const actor = searchParams.get('actor') ?? '';
  const action = searchParams.get('action') ?? '';
  const targetType = searchParams.get('targetType') ?? '';
  const outcome = searchParams.get('outcome') ?? '';
  const tenantId = searchParams.get('tenantId') ?? '';
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const page = Number(searchParams.get('page') ?? '1') || 1;
  const sort = searchParams.get('sort') ?? 'at:desc';

  const [actorInput, setActorInput] = useState(actor);
  const [actionInput, setActionInput] = useState(action);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    setActorInput(actor);
    setActionInput(action);
  }, [actor, action]);

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
    queryKey: ['audit-logs', { actor, action, targetType, outcome, tenantId, from, to, page, sort }],
    queryFn: () =>
      apiRequest<PaginatedResponse<AuditLog>>('/audit', {
        query: {
          actor,
          action,
          targetType,
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

  const columns: Column<AuditLog>[] = [
    {
      key: 'expand',
      header: '',
      hideOnMobile: true,
      render: (row) => (
        <span className="text-slate-400">
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
            ? 'Append-only record of critical platform and tenant events across all organizations.'
            : 'Append-only record of critical events within your organization. Click any row to inspect details.'
        }
      />

      <Card className="p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            updateParams({
              actor: actorInput.trim() || null,
              action: actionInput.trim() || null,
              page: '1',
            });
          }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end"
        >
          <Input
            label="Actor"
            placeholder="Email or ID..."
            value={actorInput}
            onChange={(e) => setActorInput(e.target.value)}
          />
          <Input
            label="Action"
            placeholder="e.g. TENANT_CREATED"
            value={actionInput}
            onChange={(e) => setActionInput(e.target.value)}
          />
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
          {isPA ? (
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
          ) : (
            <Select
              label="Target type"
              value={targetType}
              onChange={(e) => updateParams({ targetType: e.target.value || null, page: '1' })}
              options={[
                { value: '', label: 'All targets' },
                { value: 'USER', label: 'User' },
                { value: 'TENANT', label: 'Tenant' },
              ]}
            />
          )}
          <Input
            label="From date"
            type="date"
            value={from}
            onChange={(e) => updateParams({ from: e.target.value || null, page: '1' })}
          />
          <div className="flex items-center gap-2">
            <Button type="submit" variant="secondary" icon={<Search className="w-4 h-4" />} className="flex-1">
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
          <div className="space-y-2">
            <div className="flex items-center gap-3 text-xs text-slate-500">
              <span>Event ID: <span className="font-mono text-slate-700">{row.id}</span></span>
              <span aria-hidden="true">·</span>
              <span>IP: <span className="font-mono text-slate-700">{row.ip}</span></span>
              <span aria-hidden="true">·</span>
              <span>UTC: <span className="font-mono text-slate-700">{row.at}</span></span>
            </div>
            <pre className="rounded-lg bg-slate-900 text-slate-100 p-3.5 text-xs font-mono overflow-x-auto">
              {JSON.stringify(row.details, null, 2)}
            </pre>
          </div>
        )}
        emptyTitle="No matching audit entries"
        emptyDescription="Audit entries are created automatically for sign-ins, account changes, and tenant operations."
      />
    </div>
  );
}
