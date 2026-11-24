import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Eye } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import type { EmailOutboxItem, PaginatedResponse } from '../../shared/types.ts';
import { ApiClientError, apiRequest } from '../api/client.ts';
import { useAuth } from '../auth/AuthContext.tsx';
import {
  Button,
  Card,
  DataTable,
  Drawer,
  IconButton,
  PageHeader,
  Select,
  StatusChip,
  type Column,
} from '../components/ui/index.ts';
import { formatLocalDateTime } from '../utils/format.ts';

function stripHtmlToLines(html: string): string[] {
  const withoutTags = html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/(p|div|h1|h2|h3|tr|li)>/gi, '\n')
    .replace(/<td[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return withoutTags
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function extractSafeInternalPath(html: string): { path: string; label: string } | null {
  const match = /href="([^"]+)"/i.exec(html);
  if (!match) return null;
  try {
    const parsed = new URL(match[1], window.location.origin);
    if (parsed.pathname.startsWith('/reset-password/')) {
      return { path: parsed.pathname, label: 'Open Password Reset Link' };
    }
    if (parsed.pathname === '/alerts') {
      return { path: `${parsed.pathname}${parsed.search}`, label: 'Open Alert in OmniSphere' };
    }
    if (parsed.pathname.startsWith('/devices/')) {
      return { path: parsed.pathname, label: 'Open Device' };
    }
    if (parsed.pathname.startsWith('/tickets/')) {
      return { path: parsed.pathname, label: 'Open Ticket' };
    }
    if (parsed.pathname.startsWith('/work-orders/')) {
      return { path: parsed.pathname, label: 'Open Work Order' };
    }
    if (parsed.pathname === '/my-work-orders') {
      return { path: parsed.pathname, label: 'Open My Work Orders' };
    }
    if (parsed.pathname === '/approvals') {
      return { path: `${parsed.pathname}${parsed.search}`, label: 'Open Approvals Center' };
    }
    if (parsed.pathname.startsWith('/rollouts/')) {
      return { path: parsed.pathname, label: 'Open Rollout' };
    }
  } catch {
    return null;
  }
  return null;
}

export function EmailOutboxPage() {
  const { activeTenantId } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selected, setSelected] = useState<EmailOutboxItem | null>(null);

  const status = searchParams.get('status') ?? '';
  const page = Number(searchParams.get('page') ?? '1') || 1;

  const updateParams = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(updates)) {
      if (!v) next.delete(k);
      else next.set(k, v);
    }
    setSearchParams(next, { replace: true });
  };

  const outboxQuery = useQuery({
    queryKey: ['email-outbox', { status, page, activeTenantId }],
    queryFn: () =>
      apiRequest<PaginatedResponse<EmailOutboxItem>>('/email-outbox', {
        query: { status, page, pageSize: 25 },
      }),
  });

  const columns: Column<EmailOutboxItem>[] = [
    {
      key: 'createdAt',
      header: 'Queued',
      render: (e) => (
        <span className="font-mono text-xs tabular-nums text-slate-600 whitespace-nowrap">
          {formatLocalDateTime(e.createdAt)}
        </span>
      ),
    },
    {
      key: 'to',
      header: 'Recipient',
      render: (e) => <span className="font-mono text-xs text-slate-800">{e.to}</span>,
    },
    {
      key: 'subject',
      header: 'Subject',
      render: (e) => <span className="font-medium text-slate-900">{e.subject}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (e) => <StatusChip status={e.status} />,
    },
    {
      key: 'attempts',
      header: 'Attempts',
      align: 'right',
      render: (e) => <span className="font-mono text-xs tabular-nums text-slate-600">{e.attempts}</span>,
    },
    {
      key: 'preview',
      header: 'Inspect',
      align: 'right',
      render: (e) => (
        <IconButton label={`Preview email to ${e.to}`} size="sm" onClick={() => setSelected(e)}>
          <Eye className="w-4 h-4" />
        </IconButton>
      ),
    },
  ];

  const internalLink = selected ? extractSafeInternalPath(selected.body) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Email Outbox"
        description="Outbound email log and delivery status. When SMTP is unconfigured, messages are captured here in outbox-only mode."
      />

      <Card className="p-4 max-w-xs">
        <Select
          label="Delivery status"
          value={status}
          onChange={(e) => updateParams({ status: e.target.value || null, page: '1' })}
          options={[
            { value: '', label: 'All statuses' },
            { value: 'SENT', label: 'Sent' },
            { value: 'QUEUED', label: 'Queued' },
            { value: 'FAILED', label: 'Failed' },
          ]}
        />
      </Card>

      <DataTable
        columns={columns}
        rows={outboxQuery.data?.items ?? []}
        rowKey={(e) => e.id}
        total={outboxQuery.data?.total ?? 0}
        page={page}
        pageSize={25}
        onPageChange={(nextPage) => updateParams({ page: String(nextPage) })}
        isLoading={outboxQuery.isLoading}
        error={
          outboxQuery.isError
            ? outboxQuery.error instanceof ApiClientError
              ? outboxQuery.error.message
              : 'Unable to load email outbox.'
            : null
        }
        onRetry={() => void outboxQuery.refetch()}
        onRowClick={(e) => setSelected(e)}
        emptyTitle="No outbound emails yet"
        emptyDescription={
          status
            ? 'No emails match the selected delivery status.'
            : 'Password reset links and operational notifications will appear here once triggered.'
        }
        emptyAction={
          status ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => updateParams({ status: null, page: '1' })}
            >
              Clear filter
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void outboxQuery.refetch()}
            >
              Refresh
            </Button>
          )
        }
      />

      <Drawer
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected?.subject ?? 'Email preview'}
        subtitle={selected ? `To: ${selected.to} · ${formatLocalDateTime(selected.createdAt)}` : undefined}
      >
        {selected && (
          <div className="space-y-5">
            <div className="flex items-center gap-3 text-xs text-slate-600">
              <StatusChip status={selected.status} />
              <span className="font-mono tabular-nums">Attempts: {selected.attempts}</span>
              {selected.relatedType && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">{selected.relatedType}</span>
                </>
              )}
            </div>

            {selected.lastError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">
                Last error: {selected.lastError}
              </div>
            )}

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2 text-sm text-slate-800">
              {stripHtmlToLines(selected.body).map((line, i) => (
                <p key={i} className={i === 0 ? 'text-xs font-semibold text-indigo-600' : ''}>
                  {line}
                </p>
              ))}
            </div>

            {internalLink && (
              <div className="pt-2">
                <Link
                  to={internalLink.path}
                  onClick={() => setSelected(null)}
                  className="inline-flex items-center justify-center h-9 px-4 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
                >
                  {internalLink.label}
                </Link>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
