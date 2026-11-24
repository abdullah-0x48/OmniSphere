import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Cpu,
  MapPin,
  Play,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import type { PaginatedResponse, WorkOrderPublic } from '../../shared/types.ts';
import { ApiClientError, apiRequest } from '../api/client.ts';
import { useAuth } from '../auth/AuthContext.tsx';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  StatusChip,
} from '../components/ui/index.ts';

type TechBucket = 'today' | 'upcoming' | 'completed';

function formatShortWindow(start: string | null, end: string | null): string {
  if (!start) return 'Unscheduled';
  const s = new Date(start);
  const datePart = s.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const startTime = s.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (!end) return `${datePart}, ${startTime}`;
  const e = new Date(end);
  const endTime = e.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${datePart} · ${startTime}–${endTime}`;
}

function groupWorkOrders(items: WorkOrderPublic[]) {
  const today: WorkOrderPublic[] = [];
  const upcoming: WorkOrderPublic[] = [];
  const completed: WorkOrderPublic[] = [];

  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const endMs = endOfToday.getTime();

  for (const wo of items) {
    if (wo.status === 'COMPLETED' || wo.status === 'CANCELLED') {
      completed.push(wo);
    } else if (wo.status === 'IN_PROGRESS' || !wo.plannedStart || Date.parse(wo.plannedStart) <= endMs) {
      today.push(wo);
    } else {
      upcoming.push(wo);
    }
  }

  return { today, upcoming, completed };
}

/**
 * Field Technician Mobile-First Workspace (/my-work-orders — Section 10.2 & 10.5).
 * Designed for one-handed phone ergonomics (>= 44px touch targets, clear field contrast,
 * 0px horizontal overflow on 375–430px viewports) and scales cleanly to desktop grids.
 */
export function MyWorkOrdersPage() {
  const { user } = useAuth();
  const [bucket, setBucket] = useState<TechBucket>('today');

  const query = useQuery({
    queryKey: ['ft-my-work-orders'],
    queryFn: () =>
      apiRequest<PaginatedResponse<WorkOrderPublic>>('/work-orders', {
        query: { page: 1, pageSize: 100 },
      }),
    refetchInterval: 8000,
  });

  const allItems = query.data?.items ?? [];
  const grouped = useMemo(() => groupWorkOrders(allItems), [allItems]);
  const activeInProgress = allItems.find((wo) => wo.status === 'IN_PROGRESS') ?? null;

  const visibleList =
    bucket === 'today'
      ? grouped.today
      : bucket === 'upcoming'
        ? grouped.upcoming
        : grouped.completed;

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      {/* Compact Field Header */}
      <header className="space-y-1">
        <p className="text-xs font-medium text-indigo-700">Field Assignments</p>
        <h1 className="text-xl sm:text-2xl font-semibold text-slate-900 tracking-tight">
          My Work Orders
        </h1>
        <p className="text-sm text-slate-600">
          {user?.name} · {grouped.today.length} due today · {grouped.upcoming.length} upcoming
        </p>
      </header>

      {/* Active In-Progress Job Callout (thumb-reachable jump back into live job) */}
      {activeInProgress && (
        <Link
          to={`/work-orders/${activeInProgress.id}`}
          className="block rounded-xl bg-indigo-600 text-white p-4 sm:p-5 shadow-sm hover:bg-indigo-700 active:scale-[0.99] transition-all"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-mono font-semibold text-indigo-100">
                  In Progress · {activeInProgress.number}
                </span>
              </div>
              <p className="text-base font-semibold leading-snug">{activeInProgress.title}</p>
              <p className="text-xs text-indigo-100 truncate">
                {activeInProgress.deviceName ?? activeInProgress.deviceId} ·{' '}
                {activeInProgress.siteName ?? activeInProgress.tenantCode}
              </p>
            </div>
            <span className="inline-flex items-center justify-center min-h-[44px] px-3.5 rounded-lg bg-white/15 text-xs font-semibold text-white shrink-0">
              Continue
              <ArrowRight className="w-4 h-4 ml-1" aria-hidden="true" />
            </span>
          </div>
        </Link>
      )}

      {/* Mobile-First Segmented Tab Control (>= 44px touch targets) */}
      <div
        role="tablist"
        aria-label="Work order schedule filter"
        className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-slate-200/75"
      >
        {(
          [
            { id: 'today', label: 'Today', count: grouped.today.length },
            { id: 'upcoming', label: 'Upcoming', count: grouped.upcoming.length },
            { id: 'completed', label: 'Completed', count: grouped.completed.length },
          ] as const
        ).map((tab) => {
          const isActive = bucket === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setBucket(tab.id)}
              className={`min-h-[44px] px-2 rounded-lg text-sm font-semibold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                isActive
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>{tab.label}</span>
              <span
                className={`font-mono text-xs tabular-nums px-1.5 py-0.5 rounded-md ${
                  isActive ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-300/60 text-slate-600'
                }`}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Job Cards List (1 col on mobile, 2 cols on tablet/desktop) */}
      {query.isError ? (
        <ErrorState
          message={
            query.error instanceof ApiClientError
              ? query.error.message
              : 'Unable to load your assigned work orders.'
          }
          onRetry={() => void query.refetch()}
        />
      ) : query.isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" aria-busy="true" aria-label="Loading work orders">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div
              key={idx}
              className="rounded-xl bg-white border border-slate-200 p-4 sm:p-5 space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="h-5 w-24 bg-slate-200 rounded animate-pulse" />
                <div className="h-5 w-20 bg-slate-100 rounded-full animate-pulse" />
              </div>
              <div className="h-5 w-3/4 bg-slate-200 rounded animate-pulse" />
              <div className="space-y-2 pt-1">
                <div className="h-3.5 w-2/3 bg-slate-100 rounded animate-pulse" />
                <div className="h-3.5 w-1/2 bg-slate-100 rounded animate-pulse" />
              </div>
              <div className="h-11 w-full bg-slate-100 rounded-xl animate-pulse mt-2" />
            </div>
          ))}
        </div>
      ) : visibleList.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ClipboardCheck className="w-8 h-8" />}
            title={
              bucket === 'today'
                ? 'No work orders due today'
                : bucket === 'upcoming'
                  ? 'No upcoming work orders'
                  : 'No completed work orders yet'
            }
            description={
              bucket === 'today'
                ? 'Check the Upcoming tab to preview future scheduled maintenance windows.'
                : 'Work orders assigned to you by Support Engineers will appear here automatically.'
            }
            action={
              bucket === 'today' && grouped.upcoming.length > 0 ? (
                <Button variant="secondary" onClick={() => setBucket('upcoming')}>
                  View Upcoming ({grouped.upcoming.length})
                </Button>
              ) : bucket !== 'today' && grouped.today.length > 0 ? (
                <Button variant="secondary" onClick={() => setBucket('today')}>
                  View Today ({grouped.today.length})
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => void query.refetch()}>
                  Refresh assignments
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {visibleList.map((wo) => {
            const totalSteps = wo.checklist.length;
            const doneSteps = wo.checklist.filter((c) => c.done).length;
            const needsApproval = wo.approvalStatus === 'PENDING';
            const isRejected = wo.approvalStatus === 'REJECTED';
            const canStartNow =
              (wo.status === 'ASSIGNED' || wo.status === 'PLANNED') &&
              (wo.approvalStatus === 'APPROVED' || wo.approvalStatus === 'NOT_REQUIRED');

            return (
              <Card
                key={wo.id}
                className={`p-4 sm:p-5 flex flex-col justify-between gap-4 transition-colors ${
                  wo.status === 'IN_PROGRESS'
                    ? 'border-indigo-400 ring-1 ring-indigo-500/15'
                    : 'hover:border-indigo-300'
                }`}
              >
                <div className="space-y-3">
                  {/* Top row: WO number + org code + status */}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-md">
                        {wo.number}
                      </span>
                      {wo.tenantCode && (
                        <span className="font-mono text-xs font-semibold text-slate-500">
                          {wo.tenantCode}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <StatusChip status={wo.type} />
                      <StatusChip status={wo.status} />
                    </div>
                  </div>

                  {/* Title */}
                  <h2 className="text-base font-semibold text-slate-900 leading-snug">
                    {wo.title}
                  </h2>

                  {/* Device, Site & Window details */}
                  <div className="space-y-1.5 text-xs text-slate-600">
                    <div className="flex items-center gap-2 min-w-0">
                      <Cpu className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
                      <span className="font-medium text-slate-800 truncate">
                        {wo.deviceName ?? wo.deviceId}
                      </span>
                      {wo.deviceState && <StatusChip status={wo.deviceState} />}
                    </div>
                    <div className="flex items-center gap-2 min-w-0">
                      <MapPin className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
                      <span className="truncate">
                        {wo.siteName ?? 'Site'}
                        {wo.siteLocation ? ` — ${wo.siteLocation}` : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CalendarClock className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
                      <span className="font-mono text-slate-700">
                        {formatShortWindow(wo.plannedStart, wo.plannedEnd)}
                      </span>
                    </div>
                  </div>

                  {/* Approval Gate Status Cue */}
                  {wo.downtimeRequired && wo.status !== 'COMPLETED' && wo.status !== 'CANCELLED' && (
                    <div
                      className={`rounded-xl px-3 py-2 text-xs font-medium flex items-center gap-2 ${
                        needsApproval
                          ? 'bg-amber-50 border border-amber-200 text-amber-900'
                          : isRejected
                            ? 'bg-red-50 border border-red-200 text-red-900'
                            : 'bg-emerald-50 border border-emerald-200 text-emerald-900'
                      }`}
                    >
                      {needsApproval ? (
                        <>
                          <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
                          <span>Waiting for Client Manager downtime approval</span>
                        </>
                      ) : isRejected ? (
                        <>
                          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                          <span>Downtime window rejected — awaiting SE update</span>
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                          <span>Downtime window approved — clear to start</span>
                        </>
                      )}
                    </div>
                  )}

                  {/* Checklist Progress */}
                  {totalSteps > 0 && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span>Checklist progress</span>
                        <span className="font-mono tabular-nums font-medium text-slate-700">
                          {doneSteps}/{totalSteps}
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className="h-full bg-indigo-600 rounded-full transition-all"
                          style={{ width: `${Math.round((doneSteps / totalSteps) * 100)}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Primary Full-Width Thumb-Friendly Action (>= 44px height) */}
                <Link
                  to={`/work-orders/${wo.id}`}
                  className={`w-full min-h-[46px] px-4 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${
                    wo.status === 'IN_PROGRESS'
                      ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                      : canStartNow
                        ? 'bg-slate-900 text-white hover:bg-slate-800'
                        : 'bg-slate-100 text-slate-800 hover:bg-slate-200'
                  }`}
                >
                  {wo.status === 'IN_PROGRESS' ? (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      Open & Complete Job
                    </>
                  ) : canStartNow ? (
                    <>
                      <Play className="w-4 h-4" />
                      Open & Start Job
                    </>
                  ) : (
                    <>
                      View Work Order
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </Link>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
