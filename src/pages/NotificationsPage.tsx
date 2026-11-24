import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, CheckCheck, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { NotificationItem, NotificationsResponse } from '../../shared/types.ts';
import { ApiClientError, apiRequest } from '../api/client.ts';
import { useAuth } from '../auth/AuthContext.tsx';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  RelativeTime,
  Tabs,
  useToast,
} from '../components/ui/index.ts';
import { formatLocalDateTime } from '../utils/format.ts';

export function NotificationsPage() {
  const { user, activeTenantId, setActiveTenantId } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const listQuery = useQuery({
    queryKey: ['notifications-list', { tab, page, userId: user?.id }],
    queryFn: () =>
      apiRequest<NotificationsResponse>('/notifications', {
        query: {
          unreadOnly: tab === 'unread' ? 'true' : undefined,
          page,
          pageSize,
        },
      }),
    refetchInterval: 5000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['notifications-list'] });
    void queryClient.invalidateQueries({ queryKey: ['notifications-bell'] });
  };

  const markReadMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: invalidate,
  });

  const markAllMutation = useMutation({
    mutationFn: () => apiRequest<{ markedCount: number }>('/notifications/read-all', { method: 'POST' }),
    onSuccess: (res) => {
      invalidate();
      toast({
        kind: 'success',
        title:
          res.markedCount > 0
            ? `Marked ${res.markedCount} notification${res.markedCount === 1 ? '' : 's'} as read`
            : 'All notifications are already read',
      });
    },
  });

  const data = listQuery.data;
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const openNotification = (item: NotificationItem) => {
    if (!item.read) {
      markReadMutation.mutate(item.id);
    }
    if (
      user?.role === 'SUPPORT_ENGINEER' &&
      item.tenantId &&
      item.tenantId !== activeTenantId
    ) {
      setActiveTenantId(item.tenantId);
    }
    if (item.link) {
      navigate(item.link);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description="In-app operational alerts, escalation notices, and status updates delivered to your account."
        actions={
          <Button
            variant="secondary"
            size="sm"
            disabled={(data?.unreadCount ?? 0) === 0}
            loading={markAllMutation.isPending}
            onClick={() => markAllMutation.mutate()}
            icon={<CheckCheck className="w-4 h-4" />}
          >
            Mark all read
          </Button>
        }
      />

      <Tabs
        tabs={[
          { id: 'all', label: 'All', count: tab === 'all' ? total : undefined },
          { id: 'unread', label: 'Unread', count: data?.unreadCount ?? 0 },
        ]}
        active={tab}
        onChange={(next) => {
          setTab(next as 'all' | 'unread');
          setPage(1);
        }}
      />

      {listQuery.isError ? (
        <ErrorState
          message={
            listQuery.error instanceof ApiClientError
              ? listQuery.error.message
              : 'Unable to load notifications.'
          }
          onRetry={() => void listQuery.refetch()}
        />
      ) : listQuery.isLoading ? (
        <Card className="p-5 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-14 rounded-lg bg-slate-100 animate-pulse" />
          ))}
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Bell className="w-7 h-7" />}
            title={tab === 'unread' ? 'You are all caught up' : 'No notifications yet'}
            description={
              tab === 'unread'
                ? 'All notifications in your inbox have been marked as read.'
                : 'Alerts and escalations routed to your account will appear here automatically.'
            }
            action={
              tab === 'unread' ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setTab('all');
                    setPage(1);
                  }}
                >
                  Show all notifications
                </Button>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => void listQuery.refetch()}>
                  Refresh
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-slate-100">
            {items.map((item) => (
              <li
                key={item.id}
                className={`px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                  item.read ? 'bg-white' : 'bg-indigo-50/35'
                }`}
              >
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <span
                    className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${
                      item.read ? 'bg-slate-200' : 'bg-indigo-600'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => openNotification(item)}
                        className={`text-sm text-left hover:text-indigo-700 cursor-pointer ${
                          item.read ? 'font-medium text-slate-800' : 'font-semibold text-slate-900'
                        }`}
                      >
                        {item.title}
                      </button>
                      <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                        {item.type.replaceAll('_', ' ')}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-1">{item.body}</p>
                    <p className="text-xs text-slate-500 mt-1 font-mono">
                      {formatLocalDateTime(item.createdAt)} · <RelativeTime iso={item.createdAt} />
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {!item.read && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => markReadMutation.mutate(item.id)}
                      icon={<Check className="w-3.5 h-3.5" />}
                    >
                      Mark read
                    </Button>
                  )}
                  {item.link && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => openNotification(item)}
                      icon={<ExternalLink className="w-3.5 h-3.5" />}
                    >
                      Open
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {totalPages > 1 && (
            <div className="px-5 py-3 border-t border-slate-200 bg-slate-50/70 flex items-center justify-between text-xs text-slate-600">
              <span>
                Page {page} of {totalPages} ({total} total)
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
