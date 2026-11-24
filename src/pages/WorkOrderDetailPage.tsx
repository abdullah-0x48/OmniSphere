import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cpu,
  ExternalLink,
  History,
  MapPin,
  Pencil,
  Play,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserCheck,
  Wrench,
  XCircle,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import type {
  StaffOption,
  WorkOrderChecklistItem,
  WorkOrderDetail,
  WorkOrderOutcome,
} from '../../shared/types.ts';
import { ApiClientError, apiRequest } from '../api/client.ts';
import { useAuth } from '../auth/AuthContext.tsx';
import {
  Button,
  Card,
  ConfirmDialog,
  ErrorState,
  Input,
  Modal,
  RelativeTime,
  Select,
  StatusChip,
  Textarea,
  useToast,
} from '../components/ui/index.ts';
import { formatLocalDateTime } from '../utils/format.ts';

function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Work Order Detail & Field Execution Page (/work-orders/:id — Section 10.5).
 * Genuinely mobile-first for Field Technicians (large >= 48px checklist rows, full-width h-12
 * Start / Complete actions, collapsible history, repeatable parts replaced, 0px overflow) while
 * expanding cleanly into a two-column operations view on desktop.
 */
export function WorkOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, activeTenantId } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const isFT = user?.role === 'FIELD_TECHNICIAN';
  const isSE = user?.role === 'SUPPORT_ENGINEER';

  const [localChecklist, setLocalChecklist] = useState<WorkOrderChecklistItem[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Completion form state (FT)
  const [actionsTaken, setActionsTaken] = useState('');
  const [parts, setParts] = useState<string[]>(['']);
  const [notes, setNotes] = useState('');
  const [timeSpentMin, setTimeSpentMin] = useState('45');
  const [outcome, setOutcome] = useState<WorkOrderOutcome>('FIXED');

  // SE modals state
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editInstructions, setEditInstructions] = useState('');
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');
  const [editDowntime, setEditDowntime] = useState(false);

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTechId, setAssignTechId] = useState('');
  const [assignStart, setAssignStart] = useState('');
  const [assignEnd, setAssignEnd] = useState('');

  const [cancelOpen, setCancelOpen] = useState(false);

  const detailQuery = useQuery({
    queryKey: ['work-order-detail', id],
    enabled: Boolean(id),
    queryFn: () => apiRequest<WorkOrderDetail>(`/work-orders/${id}`),
    refetchInterval: 8000,
  });

  const techniciansQuery = useQuery({
    queryKey: ['wo-technicians', activeTenantId],
    enabled: isSE && assignOpen,
    queryFn: () => apiRequest<{ items: StaffOption[] }>('/work-orders/technicians'),
  });

  useEffect(() => {
    if (detailQuery.data) {
      setLocalChecklist(detailQuery.data.checklist);
    }
  }, [detailQuery.data?.id, detailQuery.data?.updatedAt]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['work-order-detail', id] });
    void queryClient.invalidateQueries({ queryKey: ['work-orders-list'] });
    void queryClient.invalidateQueries({ queryKey: ['ft-my-work-orders'] });
    void queryClient.invalidateQueries({ queryKey: ['ticket-detail'] });
    void queryClient.invalidateQueries({ queryKey: ['device'] });
    void queryClient.invalidateQueries({ queryKey: ['fleet-summary'] });
  };

  const checklistMutation = useMutation({
    mutationFn: (nextItems: WorkOrderChecklistItem[]) =>
      apiRequest<WorkOrderDetail>(`/work-orders/${id}/checklist`, {
        method: 'PATCH',
        body: { checklist: nextItems },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['work-order-detail', id] });
      void queryClient.invalidateQueries({ queryKey: ['ft-my-work-orders'] });
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Checklist save failed',
        description: err instanceof ApiClientError ? err.message : 'Unable to save checklist.',
      });
    },
  });

  const startMutation = useMutation({
    mutationFn: () => apiRequest<WorkOrderDetail>(`/work-orders/${id}/start`, { method: 'POST' }),
    onSuccess: (updated) => {
      toast({
        kind: 'success',
        title: `${updated.number} started`,
        description: `${updated.deviceName ?? 'Device'} is now UNDER MAINTENANCE and alerts are suppressed.`,
      });
      invalidate();
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Cannot start work order',
        description: err instanceof ApiClientError ? err.message : 'Unable to start work order.',
      });
    },
  });

  const completeMutation = useMutation({
    mutationFn: () =>
      apiRequest<WorkOrderDetail>(`/work-orders/${id}/complete`, {
        method: 'POST',
        body: {
          actionsTaken: actionsTaken.trim(),
          partsReplaced: parts.map((p) => p.trim()).filter(Boolean),
          notes: notes.trim(),
          timeSpentMin: Number(timeSpentMin) || 1,
          outcome,
          checklist: localChecklist.map((c) => ({ id: c.id, done: c.done })),
        },
      }),
    onSuccess: (updated) => {
      toast({
        kind: 'success',
        title: `${updated.number} completed (${outcome})`,
        description: `${updated.deviceName ?? 'Device'} returned to ACTIVE state.`,
      });
      invalidate();
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Completion failed',
        description: err instanceof ApiClientError ? err.message : 'Check completion fields.',
      });
    },
  });

  const editMutation = useMutation({
    mutationFn: () =>
      apiRequest<WorkOrderDetail>(`/work-orders/${id}`, {
        method: 'PATCH',
        body: {
          title: editTitle.trim(),
          instructions: editInstructions.trim(),
          plannedStart: editStart ? new Date(editStart).toISOString() : null,
          plannedEnd: editEnd ? new Date(editEnd).toISOString() : null,
          downtimeRequired: editDowntime,
        },
      }),
    onSuccess: (updated) => {
      toast({
        kind: 'success',
        title: 'Work order updated',
        description:
          updated.approvalStatus === 'PENDING'
            ? 'Submitted to Client Manager for approval.'
            : undefined,
      });
      setEditOpen(false);
      invalidate();
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Update failed',
        description: err instanceof ApiClientError ? err.message : 'Unable to update work order.',
      });
    },
  });

  const assignMutation = useMutation({
    mutationFn: () =>
      apiRequest<WorkOrderDetail>(`/work-orders/${id}/assign`, {
        method: 'POST',
        body: {
          assignedTo: assignTechId || null,
          plannedStart: assignStart ? new Date(assignStart).toISOString() : null,
          plannedEnd: assignEnd ? new Date(assignEnd).toISOString() : null,
        },
      }),
    onSuccess: () => {
      toast({ kind: 'success', title: 'Technician assignment updated' });
      setAssignOpen(false);
      invalidate();
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Assignment failed',
        description: err instanceof ApiClientError ? err.message : 'Unable to assign.',
      });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () =>
      apiRequest<WorkOrderDetail>(`/work-orders/${id}/cancel`, {
        method: 'POST',
        body: { reason: 'Cancelled by Support Engineer' },
      }),
    onSuccess: () => {
      toast({ kind: 'info', title: 'Work order cancelled' });
      setCancelOpen(false);
      invalidate();
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Cancel failed',
        description: err instanceof ApiClientError ? err.message : 'Unable to cancel.',
      });
    },
  });

  const toggleChecklistItem = (itemId: string) => {
    if (!detailQuery.data) return;
    if (detailQuery.data.status === 'COMPLETED' || detailQuery.data.status === 'CANCELLED') return;
    if (!isFT && !isSE) return;
    const next = localChecklist.map((c) => (c.id === itemId ? { ...c, done: !c.done } : c));
    setLocalChecklist(next);
    checklistMutation.mutate(next);
  };

  if (detailQuery.isLoading) {
    return (
      <div className="space-y-5 max-w-5xl mx-auto" aria-busy="true" aria-label="Loading work order">
        <div className="space-y-2.5">
          <div className="h-5 w-40 bg-slate-200 rounded animate-pulse" />
          <div className="flex items-center gap-2">
            <div className="h-5 w-20 bg-slate-200 rounded animate-pulse" />
            <div className="h-5 w-24 bg-slate-100 rounded-full animate-pulse" />
          </div>
          <div className="h-7 w-2/3 bg-slate-200 rounded-lg animate-pulse" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-8 space-y-4">
            <div className="h-36 bg-white border border-slate-200 rounded-xl animate-pulse" />
            <div className="h-56 bg-white border border-slate-200 rounded-xl animate-pulse" />
          </div>
          <div className="lg:col-span-4 space-y-4">
            <div className="h-44 bg-white border border-slate-200 rounded-xl animate-pulse" />
            <div className="h-40 bg-white border border-slate-200 rounded-xl animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <div className="space-y-4 max-w-5xl mx-auto">
        <Link
          to={isFT ? '/my-work-orders' : '/work-orders'}
          className="inline-flex items-center gap-1.5 min-h-[44px] text-sm font-medium text-indigo-700 hover:text-indigo-800"
        >
          <ArrowLeft className="w-4 h-4" />
          {isFT ? 'Back to My Work Orders' : 'Back to Work Orders'}
        </Link>
        <ErrorState
          message={
            detailQuery.error instanceof ApiClientError
              ? detailQuery.error.message
              : 'Unable to load work order details.'
          }
          onRetry={() => void detailQuery.refetch()}
        />
      </div>
    );
  }

  const wo = detailQuery.data;
  const backHref = isFT ? '/my-work-orders' : '/work-orders';
  const isAssignedTech = isFT && wo.assignedTo === user?.id;
  const isStartableStatus = wo.status === 'ASSIGNED' || wo.status === 'PLANNED';
  const approvalBlocked = wo.approvalStatus === 'PENDING' || wo.approvalStatus === 'REJECTED';
  const canSeEdit = isSE && (wo.status === 'PLANNED' || wo.status === 'ASSIGNED');

  const openEditModal = () => {
    setEditTitle(wo.title);
    setEditInstructions(wo.instructions);
    setEditStart(toDatetimeLocalValue(wo.plannedStart));
    setEditEnd(toDatetimeLocalValue(wo.plannedEnd));
    setEditDowntime(wo.downtimeRequired);
    setEditOpen(true);
  };

  const openAssignModal = () => {
    setAssignTechId(wo.assignedTo ?? '');
    setAssignStart(toDatetimeLocalValue(wo.plannedStart));
    setAssignEnd(toDatetimeLocalValue(wo.plannedEnd));
    setAssignOpen(true);
  };

  const doneSteps = localChecklist.filter((c) => c.done).length;

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      {/* Mobile-Friendly Back Bar + Header */}
      <div className="space-y-3">
        <Link
          to={backHref}
          className="inline-flex items-center gap-1.5 min-h-[44px] text-sm font-medium text-indigo-600 hover:text-indigo-700"
        >
          <ArrowLeft className="w-4 h-4" />
          {isFT ? 'Back to My Work Orders' : 'Back to Work Orders'}
        </Link>

        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="space-y-1.5 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-md">
                {wo.number}
              </span>
              <StatusChip status={wo.type} />
              <StatusChip status={wo.status} />
              {wo.tenantCode && (
                <span className="font-mono text-xs text-slate-500">{wo.tenantCode}</span>
              )}
            </div>
            <h1 className="text-xl sm:text-2xl font-semibold text-slate-900 tracking-tight leading-snug">
              {wo.title}
            </h1>
          </div>

          {canSeEdit && (
            <div className="flex items-center gap-2 flex-wrap shrink-0">
              <Button
                size="sm"
                variant="secondary"
                onClick={openEditModal}
                icon={<Pencil className="w-3.5 h-3.5" />}
              >
                {wo.approvalStatus === 'REJECTED' ? 'Edit & Resubmit' : 'Edit'}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={openAssignModal}
                icon={<UserCheck className="w-3.5 h-3.5" />}
              >
                Assign
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setCancelOpen(true)}
                icon={<XCircle className="w-3.5 h-3.5" />}
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Downtime Approval Banner */}
      {wo.downtimeRequired && (
        <div
          role="status"
          className={`rounded-xl border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
            wo.approvalStatus === 'PENDING'
              ? 'bg-amber-50 border-amber-300 text-amber-950'
              : wo.approvalStatus === 'REJECTED'
                ? 'bg-red-50 border-red-300 text-red-950'
                : 'bg-emerald-50 border-emerald-200 text-emerald-950'
          }`}
        >
          <div className="flex items-start gap-3">
            {wo.approvalStatus === 'PENDING' ? (
              <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            ) : wo.approvalStatus === 'REJECTED' ? (
              <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            ) : (
              <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            )}
            <div className="text-sm space-y-0.5">
              <p className="font-semibold">
                {wo.approvalStatus === 'PENDING'
                  ? 'Waiting for Client Manager approval'
                  : wo.approvalStatus === 'REJECTED'
                    ? 'Maintenance window rejected by Client Manager'
                    : 'Downtime window approved'}
              </p>
              <p className="text-xs opacity-90">
                {wo.approvalStatus === 'PENDING'
                  ? 'This work order requires planned downtime. Field work cannot start until approved on /approvals.'
                  : wo.approvalStatus === 'REJECTED'
                    ? `Reason: ${wo.approvalNote ?? 'No note recorded.'} Support must update the window or details to resubmit.`
                    : `Approved by ${wo.approvedByName ?? 'Client Manager'}${wo.approvedAt ? ` on ${formatLocalDateTime(wo.approvedAt)}` : ''}${wo.approvalNote ? ` · "${wo.approvalNote}"` : ''}`}
              </p>
            </div>
          </div>
          {wo.approvalStatus === 'REJECTED' && canSeEdit && (
            <Button size="sm" onClick={openEditModal}>
              Edit Window & Resubmit
            </Button>
          )}
        </div>
      )}

      {/* Primary FT Start Action Card (prominent, thumb-friendly h-12 button) */}
      {isAssignedTech && isStartableStatus && (
        <Card className="p-4 sm:p-5 border-indigo-200 bg-indigo-50/40 space-y-3">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-slate-900">Ready to begin field work?</h2>
            <p className="text-xs text-slate-600">
              Starting moves <strong className="font-mono">{wo.deviceName ?? wo.deviceId}</strong>{' '}
              into <strong>UNDER MAINTENANCE</strong> and suppresses device alerts until completion.
            </p>
          </div>
          <button
            type="button"
            disabled={approvalBlocked || startMutation.isPending}
            onClick={() => startMutation.mutate()}
            className={`w-full min-h-[48px] rounded-xl text-base font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer ${
              approvalBlocked
                ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                : 'bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800'
            }`}
          >
            <Play className="w-5 h-5" />
            {startMutation.isPending
              ? 'Starting Work Order...'
              : approvalBlocked
                ? 'Waiting for Manager Approval'
                : 'Start Work Order'}
          </button>
        </Card>
      )}

      {/* Main Responsive Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Primary Column (Instructions, Checklist, Completion Form / Report) */}
        <div className="lg:col-span-8 space-y-5">
          {/* Instructions Card */}
          <Card className="p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <Wrench className="w-4 h-4 text-indigo-600" />
                Work Instructions
              </h2>
              {wo.plannedStart && (
                <span className="inline-flex items-center gap-1 text-xs font-mono text-slate-500">
                  <CalendarClock className="w-3.5 h-3.5" />
                  {formatLocalDateTime(wo.plannedStart)}
                </span>
              )}
            </div>
            <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
              {wo.instructions}
            </p>
          </Card>

          {/* Interactive Mobile-First Checklist (>= 48px touch rows) */}
          <Card className="p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">Field Checklist</h2>
              <span className="font-mono text-xs font-semibold text-slate-600 tabular-nums">
                {doneSteps}/{localChecklist.length} completed
              </span>
            </div>

            {localChecklist.length === 0 ? (
              <p className="text-xs text-slate-500">No checklist steps defined.</p>
            ) : (
              <ul className="space-y-2">
                {localChecklist.map((item) => {
                  const interactive =
                    (isFT || isSE) && wo.status !== 'COMPLETED' && wo.status !== 'CANCELLED';
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        disabled={!interactive}
                        onClick={() => toggleChecklistItem(item.id)}
                        className={`w-full min-h-[50px] px-3.5 py-3 rounded-xl border text-left flex items-center gap-3 transition-colors ${
                          item.done
                            ? 'bg-emerald-50/70 border-emerald-200 text-slate-700'
                            : 'bg-white border-slate-200 text-slate-900 hover:border-indigo-300'
                        } ${interactive ? 'cursor-pointer active:scale-[0.99]' : 'cursor-default'}`}
                      >
                        <span
                          className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 border transition-colors ${
                            item.done
                              ? 'bg-emerald-600 border-emerald-600 text-white'
                              : 'bg-white border-slate-300'
                          }`}
                        >
                          {item.done && <Check className="w-4 h-4 stroke-[2.5]" />}
                        </span>
                        <span
                          className={`text-sm leading-snug ${
                            item.done ? 'line-through text-slate-500' : 'font-medium'
                          }`}
                        >
                          {item.text}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {/* FT Completion Form (shown when IN_PROGRESS & assigned to current FT) */}
          {isAssignedTech && wo.status === 'IN_PROGRESS' && (
            <Card className="p-4 sm:p-5 border-emerald-300 space-y-4">
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  Complete Work Order
                </h2>
                <p className="text-xs text-slate-600">
                  Submitting returns{' '}
                  <strong className="font-mono">{wo.deviceName ?? wo.deviceId}</strong> to{' '}
                  <strong>ACTIVE</strong> and posts a completion note to any linked ticket.
                </p>
              </div>

              {/* Outcome Segmented Touch Buttons (>= 44px) */}
              <div className="space-y-1.5">
                <span className="block text-xs font-medium text-slate-700">Outcome *</span>
                <div className="grid grid-cols-3 gap-2" role="group" aria-label="Completion outcome">
                  {(['FIXED', 'PARTIAL', 'REPLACED'] as const).map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      aria-pressed={outcome === opt}
                      onClick={() => setOutcome(opt)}
                      className={`min-h-[44px] rounded-xl text-sm font-semibold border transition-colors cursor-pointer ${
                        outcome === opt
                          ? 'bg-indigo-600 border-indigo-600 text-white'
                          : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {opt === 'FIXED' ? 'Fixed' : opt === 'PARTIAL' ? 'Partial' : 'Replaced'}
                    </button>
                  ))}
                </div>
              </div>

              <Textarea
                label="Actions Taken"
                required
                rows={3}
                value={actionsTaken}
                onChange={(e) => setActionsTaken(e.target.value)}
                placeholder="Describe inspection findings, repairs made, and verification readings..."
              />

              {/* Repeatable Parts Replaced Rows */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-700">
                    Parts Replaced (optional)
                  </label>
                  <button
                    type="button"
                    onClick={() => setParts((prev) => [...prev, ''])}
                    className="inline-flex items-center gap-1 min-h-[36px] px-2.5 rounded-lg text-xs font-semibold text-indigo-600 hover:bg-indigo-50 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Part
                  </button>
                </div>
                <div className="space-y-2">
                  {parts.map((part, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={part}
                        onChange={(e) => {
                          const val = e.target.value;
                          setParts((prev) => prev.map((p, i) => (i === idx ? val : p)));
                        }}
                        placeholder="e.g. Sensor gasket PN-4402"
                        className="flex-1 min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                      />
                      {parts.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setParts((prev) => prev.filter((_, i) => i !== idx))}
                          aria-label={`Remove part ${idx + 1}`}
                          className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-slate-500 hover:text-red-700 hover:bg-red-50 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="Time Spent (minutes)"
                  type="number"
                  min={1}
                  required
                  value={timeSpentMin}
                  onChange={(e) => setTimeSpentMin(e.target.value)}
                />
                <Input
                  label="Additional Notes (optional)"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Follow-up notes or observations..."
                />
              </div>

              <button
                type="button"
                disabled={
                  actionsTaken.trim().length < 3 ||
                  Number(timeSpentMin) < 1 ||
                  completeMutation.isPending
                }
                onClick={() => completeMutation.mutate()}
                className="w-full min-h-[48px] rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:bg-slate-200 disabled:text-slate-500 text-white text-base font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:cursor-not-allowed"
              >
                <CheckCircle2 className="w-5 h-5" />
                {completeMutation.isPending ? 'Submitting Completion...' : 'Complete Work Order'}
              </button>
            </Card>
          )}

          {/* Completion Report Card (when COMPLETED) */}
          {wo.status === 'COMPLETED' && wo.completion && (
            <Card className="p-4 sm:p-5 border-emerald-200 bg-emerald-50/30 space-y-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h2 className="text-sm font-semibold text-emerald-950 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  Completion Report
                </h2>
                <div className="flex items-center gap-2">
                  <StatusChip status={wo.completion.outcome} />
                  <span className="font-mono text-xs text-slate-600">
                    {wo.completion.timeSpentMin} min
                  </span>
                </div>
              </div>
              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-xs font-semibold text-slate-600">Actions Taken</p>
                  <p className="text-slate-800 mt-0.5 whitespace-pre-wrap">
                    {wo.completion.actionsTaken}
                  </p>
                </div>
                {wo.completion.partsReplaced.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-slate-600">Parts Replaced</p>
                    <ul className="mt-1 list-disc list-inside text-slate-800 space-y-0.5">
                      {wo.completion.partsReplaced.map((part, idx) => (
                        <li key={idx}>{part}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {wo.completion.notes && (
                  <div>
                    <p className="text-xs font-semibold text-slate-600">Notes</p>
                    <p className="text-slate-700 mt-0.5">{wo.completion.notes}</p>
                  </div>
                )}
                {wo.completedAt && (
                  <p className="text-xs font-mono text-slate-600 pt-2 border-t border-emerald-200/70">
                    Completed {formatLocalDateTime(wo.completedAt)}
                    {wo.assignedToName ? ` by ${wo.assignedToName}` : ''}
                  </p>
                )}
              </div>
            </Card>
          )}

          {/* Collapsible Recent Device History */}
          <Card className="overflow-hidden">
            <button
              type="button"
              aria-expanded={historyOpen}
              onClick={() => setHistoryOpen((o) => !o)}
              className="w-full min-h-[50px] px-4 sm:px-5 py-3 flex items-center justify-between text-left hover:bg-slate-50 cursor-pointer"
            >
              <span className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <History className="w-4 h-4 text-indigo-600" aria-hidden="true" />
                Recent Device History ({wo.recentDeviceHistory.length})
              </span>
              {historyOpen ? (
                <ChevronUp className="w-4 h-4 text-slate-600" aria-hidden="true" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-600" aria-hidden="true" />
              )}
            </button>
            {historyOpen && (
              <div className="px-4 sm:px-5 pb-4 border-t border-slate-100">
                {wo.recentDeviceHistory.length === 0 ? (
                  <p className="text-xs text-slate-500 pt-3">No recent events recorded.</p>
                ) : (
                  <ol className="divide-y divide-slate-100">
                    {wo.recentDeviceHistory.map((ev) => (
                      <li key={ev.id} className="py-2.5 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-800">{ev.title}</p>
                          <p className="text-xs text-slate-500 mt-0.5">{ev.description}</p>
                        </div>
                        <RelativeTime iso={ev.at} />
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </Card>
        </div>

        {/* Context Sidebar (Device, Site, Schedule, Linked Ticket) */}
        <div className="lg:col-span-4 space-y-4">
          <Card className="p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <Cpu className="w-4 h-4 text-indigo-600" />
                Device & Site
              </h2>
              {wo.device && <StatusChip status={wo.device.connectivity} />}
            </div>

            <div className="space-y-1">
              <Link
                to={`/devices/${wo.deviceId}`}
                className="text-sm font-semibold text-indigo-600 hover:text-indigo-700 inline-flex items-center gap-1"
              >
                {wo.deviceName ?? wo.deviceId}
                <ExternalLink className="w-3.5 h-3.5" />
              </Link>
              {wo.deviceSerial && (
                <p className="font-mono text-xs text-slate-500">{wo.deviceSerial}</p>
              )}
              {wo.modelName && <p className="text-xs text-slate-500">{wo.modelName}</p>}
            </div>

            {wo.device && (
              <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-100">
                <span className="text-slate-500">Lifecycle state</span>
                <StatusChip status={wo.device.state} />
              </div>
            )}

            <div className="pt-2 border-t border-slate-100 text-xs text-slate-600 flex items-start gap-2">
              <MapPin className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="font-medium text-slate-800">{wo.siteName ?? 'Site'}</p>
                {wo.siteLocation && <p className="text-slate-600">{wo.siteLocation}</p>}
              </div>
            </div>
          </Card>

          <Card className="p-4 sm:p-5 space-y-3">
            <h2 className="text-sm font-semibold text-slate-900">Schedule & Assignment</h2>
            <dl className="space-y-2 text-xs">
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Technician</dt>
                <dd className="font-medium text-slate-900">
                  {wo.assignedToName ?? 'Unassigned'}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Planned Start</dt>
                <dd className="font-mono text-slate-700 text-right">
                  {wo.plannedStart ? formatLocalDateTime(wo.plannedStart) : '—'}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Planned End</dt>
                <dd className="font-mono text-slate-700 text-right">
                  {wo.plannedEnd ? formatLocalDateTime(wo.plannedEnd) : '—'}
                </dd>
              </div>
              {wo.startedAt && (
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Started</dt>
                  <dd className="font-mono text-slate-700 text-right">
                    {formatLocalDateTime(wo.startedAt)}
                  </dd>
                </div>
              )}
              {wo.completedAt && (
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Completed</dt>
                  <dd className="font-mono text-slate-700 text-right">
                    {formatLocalDateTime(wo.completedAt)}
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Downtime</dt>
                <dd className="font-medium text-slate-800">
                  {wo.downtimeRequired ? 'Required' : 'Not required'}
                </dd>
              </div>
            </dl>
          </Card>

          {wo.linkedTicket && (
            <Card className="p-4 sm:p-5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900">Linked Ticket</h2>
                <StatusChip status={wo.linkedTicket.status} />
              </div>
              <p className="font-mono text-xs font-semibold text-indigo-600">
                {wo.linkedTicket.number}
              </p>
              <p className="text-xs font-medium text-slate-800">{wo.linkedTicket.title}</p>
              <Link
                to={`/tickets/${wo.linkedTicket.id}`}
                className="inline-flex items-center min-h-[36px] text-xs font-semibold text-indigo-600 hover:text-indigo-700"
              >
                Open ticket →
              </Link>
            </Card>
          )}
        </div>
      </div>

      {/* SE Edit Modal (Resets REJECTED approval to PENDING) */}
      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title={`Edit ${wo.number}`}
        description={
          wo.approvalStatus === 'REJECTED'
            ? 'Updating the window or details resets approval to PENDING and notifies Client Managers.'
            : 'Update maintenance instructions or planned window.'
        }
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={editMutation.isPending}
              disabled={editTitle.trim().length < 3 || editInstructions.trim().length < 3}
              onClick={() => editMutation.mutate()}
            >
              {wo.approvalStatus === 'REJECTED' ? 'Save & Resubmit for Approval' : 'Save Changes'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Title"
            required
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
          />
          <Textarea
            label="Instructions"
            required
            rows={3}
            value={editInstructions}
            onChange={(e) => setEditInstructions(e.target.value)}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Planned Start"
              type="datetime-local"
              value={editStart}
              onChange={(e) => setEditStart(e.target.value)}
            />
            <Input
              label="Planned End"
              type="datetime-local"
              value={editEnd}
              onChange={(e) => setEditEnd(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2.5 text-sm text-slate-800 cursor-pointer">
            <input
              type="checkbox"
              checked={editDowntime}
              onChange={(e) => setEditDowntime(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600"
            />
            <span>Downtime required (requires Client Manager approval)</span>
          </label>
        </div>
      </Modal>

      {/* SE Assign Technician Modal */}
      <Modal
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        title={`Assign ${wo.number}`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAssignOpen(false)}>
              Cancel
            </Button>
            <Button loading={assignMutation.isPending} onClick={() => assignMutation.mutate()}>
              Save Assignment
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select
            label="Field Technician"
            value={assignTechId}
            onChange={(e) => setAssignTechId(e.target.value)}
          >
            <option value="">Unassigned (Planned)</option>
            {(techniciansQuery.data?.items ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
          <Input
            label="Planned Start"
            type="datetime-local"
            value={assignStart}
            onChange={(e) => setAssignStart(e.target.value)}
          />
          <Input
            label="Planned End"
            type="datetime-local"
            value={assignEnd}
            onChange={(e) => setAssignEnd(e.target.value)}
          />
        </div>
      </Modal>

      {/* SE Cancel Dialog */}
      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={() => cancelMutation.mutate()}
        title={`Cancel ${wo.number}`}
        message="Cancel this work order? It will no longer appear in the Field Technician's active assignments."
        confirmLabel="Cancel Work Order"
        variant="danger"
        loading={cancelMutation.isPending}
      />
    </div>
  );
}
