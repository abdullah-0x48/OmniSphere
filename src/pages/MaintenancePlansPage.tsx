import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarSync, Pencil, Plus, Trash2 } from 'lucide-react';
import type {
  DevicePublic,
  MaintenancePlanPublic,
  MaintenanceScopeType,
  PaginatedResponse,
  Site,
  StaffOption,
} from '../../shared/types.ts';
import { ApiClientError, apiRequest } from '../api/client.ts';
import { useAuth } from '../auth/AuthContext.tsx';
import {
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  IconButton,
  Input,
  Modal,
  PageHeader,
  RelativeTime,
  Select,
  StatusChip,
  Textarea,
  useToast,
  type Column,
} from '../components/ui/index.ts';
import { formatLocalDateTime } from '../utils/format.ts';

function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function MaintenancePlansPage() {
  const { activeTenantId } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<MaintenancePlanPublic | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MaintenancePlanPublic | null>(null);

  const [name, setName] = useState('');
  const [scopeType, setScopeType] = useState<MaintenanceScopeType>('TAG');
  const [scopeValue, setScopeValue] = useState('critical');
  const [everyDays, setEveryDays] = useState('30');
  const [nextRunAt, setNextRunAt] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [templateTitle, setTemplateTitle] = useState('');
  const [templateInstructions, setTemplateInstructions] = useState('');
  const [templateChecklist, setTemplateChecklist] = useState<string[]>([
    'Inspect physical mounting and enclosure seal',
    'Verify sensor accuracy against reference gauge',
  ]);
  const [newStep, setNewStep] = useState('');
  const [downtimeRequired, setDowntimeRequired] = useState(false);

  const plansQuery = useQuery({
    queryKey: ['maintenance-plans', activeTenantId],
    queryFn: () =>
      apiRequest<PaginatedResponse<MaintenancePlanPublic>>('/maintenance-plans', {
        query: { page: 1, pageSize: 100 },
      }),
  });

  const devicesQuery = useQuery({
    queryKey: ['mp-devices', activeTenantId],
    enabled: modalOpen,
    queryFn: () =>
      apiRequest<PaginatedResponse<DevicePublic>>('/devices', {
        query: { page: 1, pageSize: 200, sort: 'name:asc' },
      }),
  });

  const sitesQuery = useQuery({
    queryKey: ['mp-sites', activeTenantId],
    enabled: modalOpen,
    queryFn: () =>
      apiRequest<PaginatedResponse<Site>>('/sites', {
        query: { page: 1, pageSize: 200 },
      }),
  });

  const techniciansQuery = useQuery({
    queryKey: ['wo-technicians', activeTenantId],
    enabled: modalOpen,
    queryFn: () => apiRequest<{ items: StaffOption[] }>('/work-orders/technicians'),
  });

  const openCreate = () => {
    setEditing(null);
    setName('');
    setScopeType('TAG');
    setScopeValue('critical');
    setEveryDays('30');
    setNextRunAt(toDatetimeLocalValue(new Date(Date.now() + 7 * 86400_000).toISOString()));
    setAssignedTo('');
    setTemplateTitle('');
    setTemplateInstructions('');
    setTemplateChecklist([
      'Inspect physical mounting and enclosure seal',
      'Verify sensor accuracy against reference gauge',
    ]);
    setNewStep('');
    setDowntimeRequired(false);
    setModalOpen(true);
  };

  const openEdit = (plan: MaintenancePlanPublic) => {
    setEditing(plan);
    setName(plan.name);
    setScopeType(plan.scopeType);
    setScopeValue(plan.scopeValue);
    setEveryDays(String(plan.everyDays));
    setNextRunAt(toDatetimeLocalValue(plan.nextRunAt));
    setAssignedTo(plan.assignedTo ?? '');
    setTemplateTitle(plan.template.title);
    setTemplateInstructions(plan.template.instructions);
    setTemplateChecklist(plan.template.checklist.length > 0 ? plan.template.checklist : ['']);
    setNewStep('');
    setDowntimeRequired(plan.template.downtimeRequired);
    setModalOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: name.trim(),
        scopeType,
        scopeValue: scopeValue.trim(),
        everyDays: Number(everyDays) || 30,
        nextRunAt: new Date(nextRunAt).toISOString(),
        assignedTo: assignedTo || null,
        template: {
          title: templateTitle.trim(),
          instructions: templateInstructions.trim(),
          checklist: templateChecklist.map((s) => s.trim()).filter(Boolean),
          downtimeRequired,
        },
      };
      if (editing) {
        return apiRequest<MaintenancePlanPublic>(`/maintenance-plans/${editing.id}`, {
          method: 'PATCH',
          body: payload,
        });
      }
      return apiRequest<MaintenancePlanPublic>('/maintenance-plans', {
        method: 'POST',
        body: { ...payload, enabled: true },
      });
    },
    onSuccess: () => {
      toast({
        kind: 'success',
        title: editing ? 'Maintenance plan updated' : 'Maintenance plan created',
      });
      setModalOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['maintenance-plans'] });
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Save failed',
        description: err instanceof ApiClientError ? err.message : 'Unable to save plan.',
      });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (plan: MaintenancePlanPublic) =>
      apiRequest<MaintenancePlanPublic>(`/maintenance-plans/${plan.id}`, {
        method: 'PATCH',
        body: { enabled: !plan.enabled },
      }),
    onSuccess: (updated) => {
      toast({
        kind: 'info',
        title: `${updated.name} ${updated.enabled ? 'enabled' : 'paused'}`,
      });
      void queryClient.invalidateQueries({ queryKey: ['maintenance-plans'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/maintenance-plans/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast({ kind: 'info', title: 'Maintenance plan deleted' });
      setDeleteTarget(null);
      void queryClient.invalidateQueries({ queryKey: ['maintenance-plans'] });
    },
  });

  const columns: Column<MaintenancePlanPublic>[] = [
    {
      key: 'name',
      header: 'Plan',
      render: (p) => (
        <div>
          <p className="font-medium text-slate-900">{p.name}</p>
          <p className="text-xs text-slate-500 mt-0.5 truncate max-w-sm">{p.template.title}</p>
        </div>
      ),
    },
    {
      key: 'scope',
      header: 'Scope',
      render: (p) => (
        <div className="text-xs">
          <span className="font-mono text-slate-700">{p.scopeLabel ?? p.scopeValue}</span>
          <p className="text-slate-500">
            {p.matchedDeviceCount ?? 0} matched{' '}
            {(p.matchedDeviceCount ?? 0) === 1 ? 'device' : 'devices'}
          </p>
        </div>
      ),
    },
    {
      key: 'cadence',
      header: 'Cadence',
      render: (p) => (
        <span className="font-mono text-xs text-slate-700">Every {p.everyDays}d</span>
      ),
    },
    {
      key: 'nextRunAt',
      header: 'Next Run',
      render: (p) => (
        <div className="text-xs font-mono text-slate-600 whitespace-nowrap">
          <p>{formatLocalDateTime(p.nextRunAt)}</p>
          {p.lastRunAt && (
            <p className="text-[11px] text-slate-500">
              Last: <RelativeTime iso={p.lastRunAt} />
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'assignedTo',
      header: 'Technician',
      render: (p) => (
        <span className="text-xs text-slate-700">{p.assignedToName ?? 'Unassigned'}</span>
      ),
    },
    {
      key: 'enabled',
      header: 'Status',
      render: (p) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toggleMutation.mutate(p);
          }}
          className="cursor-pointer"
          title={p.enabled ? 'Click to pause plan' : 'Click to enable plan'}
        >
          <StatusChip status={p.enabled ? 'ACTIVE' : 'INACTIVE'} label={p.enabled ? 'Enabled' : 'Paused'} />
        </button>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (p) => (
        <div
          className="inline-flex items-center justify-end gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          <IconButton label={`Edit ${p.name}`} size="sm" onClick={() => openEdit(p)}>
            <Pencil className="w-4 h-4" />
          </IconButton>
          <IconButton label={`Delete ${p.name}`} size="sm" onClick={() => setDeleteTarget(p)}>
            <Trash2 className="w-4 h-4 text-red-600" />
          </IconButton>
        </div>
      ),
    },
  ];

  const canSubmit =
    name.trim().length >= 3 &&
    scopeValue.trim().length >= 1 &&
    Number(everyDays) >= 1 &&
    Boolean(nextRunAt) &&
    templateTitle.trim().length >= 3 &&
    templateInstructions.trim().length >= 3;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Maintenance Plans"
        description="Recurring preventive schedules that automatically generate PREVENTIVE work orders for matching devices."
        actions={
          <Button size="sm" onClick={openCreate} icon={<Plus className="w-4 h-4" />}>
            New Maintenance Plan
          </Button>
        }
      />

      <Card className="p-4 flex items-center gap-3 text-xs text-slate-600 bg-slate-50/70">
        <CalendarSync className="w-4 h-4 text-indigo-600 shrink-0" />
        <span>
          The background maintenance scheduler checks due enabled plans every 5 minutes, generates
          one <strong className="font-mono">PREVENTIVE</strong> work order per matching active
          device, and advances <strong className="font-mono">nextRunAt</strong> automatically.
        </span>
      </Card>

      <DataTable
        columns={columns}
        rows={plansQuery.data?.items ?? []}
        rowKey={(p) => p.id}
        total={plansQuery.data?.total ?? 0}
        page={1}
        pageSize={100}
        onPageChange={() => {}}
        isLoading={plansQuery.isLoading}
        error={
          plansQuery.isError
            ? plansQuery.error instanceof ApiClientError
              ? plansQuery.error.message
              : 'Unable to load maintenance plans.'
            : null
        }
        onRetry={() => void plansQuery.refetch()}
        emptyTitle="No recurring maintenance plans"
        emptyDescription="Create a recurring schedule by device, site, or tag to automate preventive work order dispatch."
        emptyAction={
          <Button size="sm" onClick={openCreate} icon={<Plus className="w-4 h-4" />}>
            New Maintenance Plan
          </Button>
        }
      />

      {/* Create / Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit ${editing.name}` : 'New Maintenance Plan'}
        description="Configure target scope, recurrence cadence, and work order template."
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={saveMutation.isPending}
              disabled={!canSubmit}
              onClick={() => saveMutation.mutate()}
            >
              {editing ? 'Save Changes' : 'Create Plan'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Plan Name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Monthly Vibration Sensor Calibration"
          />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Select
              label="Scope Type"
              value={scopeType}
              onChange={(e) => {
                const next = e.target.value as MaintenanceScopeType;
                setScopeType(next);
                setScopeValue('');
              }}
              options={[
                { value: 'TAG', label: 'Device Tag' },
                { value: 'SITE', label: 'Site' },
                { value: 'DEVICE', label: 'Single Device' },
              ]}
            />

            {scopeType === 'TAG' ? (
              <Input
                label="Tag Value"
                required
                value={scopeValue}
                onChange={(e) => setScopeValue(e.target.value)}
                placeholder="critical"
              />
            ) : scopeType === 'SITE' ? (
              <Select
                label="Target Site"
                required
                value={scopeValue}
                onChange={(e) => setScopeValue(e.target.value)}
              >
                <option value="">Select site...</option>
                {(sitesQuery.data?.items ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            ) : (
              <Select
                label="Target Device"
                required
                value={scopeValue}
                onChange={(e) => setScopeValue(e.target.value)}
              >
                <option value="">Select device...</option>
                {(devicesQuery.data?.items ?? [])
                  .filter((d) => d.state !== 'DECOMMISSIONED')
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </Select>
            )}

            <Input
              label="Repeat Every (days)"
              type="number"
              min={1}
              required
              value={everyDays}
              onChange={(e) => setEveryDays(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Next Run Date & Time"
              type="datetime-local"
              required
              value={nextRunAt}
              onChange={(e) => setNextRunAt(e.target.value)}
            />
            <Select
              label="Default Field Technician"
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
            >
              <option value="">Unassigned</option>
              {(techniciansQuery.data?.items ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="pt-3 border-t border-slate-100 space-y-3">
            <p className="text-xs font-semibold text-slate-700">
              Generated Work Order Template
            </p>
            <Input
              label="Work Order Title Template"
              required
              value={templateTitle}
              onChange={(e) => setTemplateTitle(e.target.value)}
              placeholder="e.g. Routine Preventive Calibration"
            />
            <Textarea
              label="Instructions Template"
              required
              rows={3}
              value={templateInstructions}
              onChange={(e) => setTemplateInstructions(e.target.value)}
            />

            <label className="flex items-center gap-2.5 text-sm text-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={downtimeRequired}
                onChange={(e) => setDowntimeRequired(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600"
              />
              <span>Requires planned downtime (triggers Client Manager approval)</span>
            </label>

            <div className="space-y-2">
              <label className="block text-xs font-medium text-slate-700">Checklist Steps</label>
              {templateChecklist.map((step, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={step}
                    onChange={(e) => {
                      const val = e.target.value;
                      setTemplateChecklist((prev) => prev.map((s, i) => (i === idx ? val : s)));
                    }}
                    className="flex-1 h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm"
                  />
                  <button
                    type="button"
                    aria-label={`Remove checklist step ${idx + 1}`}
                    onClick={() =>
                      setTemplateChecklist((prev) => prev.filter((_, i) => i !== idx))
                    }
                    className="p-2 text-slate-500 hover:text-red-600 rounded-lg cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newStep}
                  onChange={(e) => setNewStep(e.target.value)}
                  placeholder="Add step..."
                  className="flex-1 h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    if (!newStep.trim()) return;
                    setTemplateChecklist((prev) => [...prev, newStep.trim()]);
                    setNewStep('');
                  }}
                >
                  Add
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
        }}
        title={`Delete "${deleteTarget?.name ?? ''}"`}
        message="Deleting this maintenance plan stops future preventive work orders from being created. Existing work orders are not affected."
        confirmLabel="Delete Plan"
        variant="danger"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
