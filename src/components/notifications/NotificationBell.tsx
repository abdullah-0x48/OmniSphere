import React, { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, ExternalLink } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import type { NotificationItem, NotificationsResponse } from '../../../shared/types.ts';
import { apiRequest } from '../../api/client.ts';
import { useAuth } from '../../auth/AuthContext.tsx';
import { RelativeTime } from '../ui/index.ts';

export function NotificationBell() {
  const { user, activeTenantId, setActiveTenantId } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const query = useQuery({
    queryKey: ['notifications-bell', user?.id],
    enabled: Boolean(user),
    queryFn: () =>
      apiRequest<NotificationsResponse>('/notifications', {
        query: { page: 1, pageSize: 10 },
      }),
    refetchInterval: 5000,
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications-bell'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications-list'] });
    },
  });

  const markAllMutation = useMutation({
    mutationFn: () => apiRequest('/notifications/read-all', { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications-bell'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications-list'] });
    },
  });

  const unreadCount = query.data?.unreadCount ?? 0;
  const items = query.data?.items ?? [];

  const handleOpenItem = (item: NotificationItem) => {
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
    setOpen(false);
    if (item.link) {
      navigate(item.link);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={
          unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'
        }
        aria-expanded={open}
        aria-haspopup="menu"
        className="relative inline-flex items-center justify-center w-9 h-9 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
      >
        <Bell className="w-[18px] h-[18px]" />
        {unreadCount > 0 && (
          <span
            data-testid="notification-unread-badge"
            className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-semibold font-mono tabular-nums flex items-center justify-center border-2 border-white"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Recent notifications"
          className="absolute right-0 mt-1.5 w-80 sm:w-96 rounded-xl bg-white border border-slate-200 shadow-lg z-40 overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-semibold text-slate-900">Notifications</h2>
              {unreadCount > 0 && (
                <span className="text-[11px] font-mono font-medium text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">
                  {unreadCount} unread
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                disabled={markAllMutation.isPending}
                onClick={() => markAllMutation.mutate()}
                className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700 cursor-pointer disabled:opacity-50"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
            {items.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-slate-500">
                No notifications yet. Alert and escalation updates will appear here.
              </div>
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  onClick={() => handleOpenItem(item)}
                  className={`w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors cursor-pointer flex items-start gap-2.5 ${
                    item.read ? 'bg-white' : 'bg-indigo-50/35'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                      item.read ? 'bg-transparent' : 'bg-indigo-600'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-xs leading-snug ${
                        item.read ? 'font-medium text-slate-700' : 'font-semibold text-slate-900'
                      }`}
                    >
                      {item.title}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{item.body}</p>
                    <p className="text-[11px] text-slate-400 mt-1">
                      <RelativeTime iso={item.createdAt} />
                    </p>
                  </div>
                  {item.link && (
                    <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                  )}
                </button>
              ))
            )}
          </div>

          <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50/70 flex items-center justify-between">
            <Link
              to="/notifications"
              onClick={() => setOpen(false)}
              className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
            >
              View all notifications
            </Link>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs text-slate-500 hover:text-slate-700 cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
