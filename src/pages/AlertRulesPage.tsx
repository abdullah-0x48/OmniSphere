import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import {
  HEALTH_METRIC_KEYS,
  ROLE_LABELS,
  type AlertOperator,
  type AlertRecipient,
  type AlertRule,
  type AlertRuleKind,
  type AlertScopeType,
  type AlertSeverity,
  type DeviceModel,
  type DevicePublic,
  type PaginatedResponse,
  type RoleCode,
  type Site,
} from '../../shared/types.ts';
import { ApiClientError, apiRequest } from '../api/client.ts';
import { useAuth } from '../auth/AuthContext.tsx';
import {
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  DataTable,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Select,
  SeverityChip,
  StatusChip,
  useToast,
  type Column,
} from '../components/ui/index.ts';

const OPERATOR_LABELS: Record<AlertOperator, string> = {
  GT: '> (greater than)',
  GTE: '>= (greater or equal)',
  LT: '< (less than)',
  LTE: '<= (less or equal)',
};

const OPERATOR_SYMBOLS: Record<AlertOperator, string> = {
  GT: '>',
  GTE: '>=',
  LT: '<',
  LTE: '<=',
};

const HEALTH_KEY_LABELS: Record<string, string> = {
  cpuLoad: 'CPU Load (%)',
  memoryUsage: 'Memory Usage (%)',
  batteryLevel: 'Battery Level (%)',
  signalStrength: 'Signal Strength (dBm)',
};

const RECIPIENT_ROLE_OPTIONS: RoleCode[] = [
  'CLIENT_ADMIN',
  'CLIENT_OPERATOR',
  'CLIENT_MANAGER',
  'SUPPORT_ENGINEER',
  'PLATFORM_ADMIN',
];

interface RuleFormState {
  name: string;
  kind: AlertRuleKind;
  severity: AlertSeverity;
  scopeType: AlertScopeType;
  scopeId: string;
  metricKey: string;
  operator: AlertOperator;
  threshold: string;
  durationSec: string;
  recipientRoles: RoleCode[];
  enabled: boolean;
}

const EMPTY_FORM: RuleFormState = {
  name: '',
  kind: 'THRESHOLD',
  severity: 'WARNING',
  scopeType: 'MODEL',
  scopeId: '',
  metricKey: 'temperature',
  operator: 'GT',
  threshold: '80',
  durationSec: '30',
  recipientRoles: [],
  enabled: true,
};

function formatRuleCondition(rule: AlertRule): string {
  if (rule.kind === 'OFFLINE') {
    return `Offline for ${rule.durationSec}s`;
  }
  const op = rule.operator ? OPERATOR_SYMBOLS[rule.operator] : '';
  const dur = rule.durationSec > 0 ? ` for ${rule.durationSec}s` : ' (immediate)';
  return `${rule.metricKey ?? '?'} ${op} ${rule.threshold ?? '?'}${dur}`;
}

export function AlertRulesPage() {
  const { user, activeTenantId } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const canWrite = user?.role === 'CLIENT_ADMIN' || user?.role === 'SUPPORT_ENGINEER';

  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [page, setPage] = useState(1);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null);
  const [form, setForm] = useState<RuleFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AlertRule | null>(null);

  const rulesQuery = useQuery({
    queryKey: ['alert-rules', { search, kindFilter, severityFilter, page, activeTenantId }],
    queryFn: () =>
      apiRequest<PaginatedResponse<AlertRule>>('/alert-rules', {
        query: {
          search: search.trim() || undefined,
          kind: kindFilter || undefined,
          severity: severityFilter || undefined,
          page,
          pageSize: 25,
        },
      }),
  });

  const sitesQuery = useQuery({
    queryKey: ['alert-rules-sites', activeTenantId],
    queryFn: () =>
      apiRequest<PaginatedResponse<Site>>('/sites', { query: { page: 1, pageSize: 100 } }),
  });

  const modelsQuery = useQuery({
    queryKey: ['alert-rules-models'],
    queryFn: () =>
      apiRequest<PaginatedResponse<DeviceModel>>('/device-models', {
        query: { page: 1, pageSize: 100 },
      }),
  });

  const devicesQuery = useQuery({
    queryKey: ['alert-rules-devices', activeTenantId],
    queryFn: () =>
      apiRequest<PaginatedResponse<DevicePublic>>('/devices', {
        query: { page: 1, pageSize: 100 },
      }),
  });

  const sites = sitesQuery.data?.items ?? [];
  const models = modelsQuery.data?.items ?? [];
  const devices = devicesQuery.data?.items ?? [];

  const scopeNameLookup = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sites) map.set(`SITE:${s.id}`, s.name);
    for (const m of models) map.set(`MODEL:${m.id}`, m.name);
    for (const d of devices) map.set(`DEVICE:${d.id}`, d.name);
    return map;
  }, [sites, models, devices]);

  // Compute valid numeric metrics based on chosen scope
  const availableMetrics = useMemo(() => {
    const list: Array<{ value: string; label: string }> = [];
    const seen = new Set<string>();
    let targetModels = models;

    if (form.scopeType === 'MODEL' && form.scopeId) {
      targetModels = models.filter((m) => m.id === form.scopeId);
    } else if (form.scopeType === 'DEVICE' && form.scopeId) {
      const dev = devices.find((d) => d.id === form.scopeId);
      if (dev) targetModels = models.filter((m) => m.id === dev.modelId);
    }

    for (const m of targetModels) {
      for (const metric of m.metrics) {
        if (metric.type !== 'number' || seen.has(metric.key)) continue;
        seen.add(metric.key);
        list.push({
          value: metric.key,
          label: `${metric.label} (${metric.key}${metric.unit ? `, ${metric.unit}` : ''})`,
        });
      }
    }

    for (const hk of HEALTH_METRIC_KEYS) {
      if (seen.has(hk)) continue;
      seen.add(hk);
      list.push({
        value: hk,
        label: `Health: ${HEALTH_KEY_LABELS[hk] ?? hk}`,
      });
    }

    return list;
  }, [form.scopeType, form.scopeId, models, devices]);

  const invalidateRules = () => {
    void queryClient.invalidateQueries({ queryKey: ['alert-rules'] });
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const recipients: AlertRecipient[] = form.recipientRoles.map((role) => ({
        type: 'ROLE',
        role,
      }));
      const durationSec = Number(form.durationSec);
      const body =
        form.kind === 'OFFLINE'
          ? {
              name: form.name.trim(),
              kind: 'OFFLINE' as const,
              metricKey: null,
              operator: null,
              threshold: null,
              durationSec,
              severity: form.severity,
              scopeType: form.scopeType,
              scopeId: form.scopeId,
              recipients,
              enabled: form.enabled,
            }
          : {
              name: form.name.trim(),
              kind: 'THRESHOLD' as const,
              metricKey: form.metricKey,
              operator: form.operator,
              threshold: Number(form.threshold),
              durationSec,
              severity: form.severity,
              scopeType: form.scopeType,
              scopeId: form.scopeId,
              recipients,
              enabled: form.enabled,
            };

      if (editingRule) {
        return apiRequest<AlertRule>(`/alert-rules/${editingRule.id}`, {
          method: 'PATCH',
          body,
        });
      }
      return apiRequest<AlertRule>('/alert-rules', {
        method: 'POST',
        body,
      });
    },
    onSuccess: () => {
      toast({
        kind: 'success',
        title: editingRule ? 'Alert rule updated' : 'Alert rule created',
      });
      setModalOpen(false);
      setEditingRule(null);
      setFormError(null);
      invalidateRules();
    },
    onError: (err) => {
      const msg = err instanceof ApiClientError ? err.message : 'Unable to save alert rule';
      setFormError(msg);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (vars: { id: string; enabled: boolean }) =>
      apiRequest<AlertRule>(`/alert-rules/${vars.id}`, {
        method: 'PATCH',
        body: { enabled: vars.enabled },
      }),
    onSuccess: (updated) => {
      toast({
        kind: 'info',
        title: updated.enabled ? `Enabled "${updated.name}"` : `Disabled "${updated.name}"`,
      });
      invalidateRules();
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Toggle failed',
        description: err instanceof ApiClientError ? err.message : 'Unable to update rule.',
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/alert-rules/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast({ kind: 'success', title: 'Alert rule deleted' });
      setDeleteTarget(null);
      invalidateRules();
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Delete failed',
        description: err instanceof ApiClientError ? err.message : 'Unable to delete rule.',
      });
    },
  });

  const openCreateModal = () => {
    const defaultModelId = models[0]?.id ?? '';
    const defaultMetric = models[0]?.metrics[0]?.key ?? 'temperature';
    setEditingRule(null);
    setForm({
      ...EMPTY_FORM,
      scopeType: defaultModelId ? 'MODEL' : 'SITE',
      scopeId: defaultModelId || sites[0]?.id || '',
      metricKey: defaultMetric,
    });
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (rule: AlertRule) => {
    setEditingRule(rule);
    setForm({
      name: rule.name,
      kind: rule.kind,
      severity: rule.severity,
      scopeType: rule.scopeType,
      scopeId: rule.scopeId,
      metricKey: rule.metricKey ?? 'temperature',
      operator: rule.operator ?? 'GT',
      threshold: rule.threshold !== null ? String(rule.threshold) : '80',
      durationSec: String(rule.durationSec),
      recipientRoles: rule.recipients
        .filter((r) => r.type === 'ROLE' && r.role)
        .map((r) => r.role as RoleCode),
      enabled: rule.enabled,
    });
    setFormError(null);
    setModalOpen(true);
  };

  const handleScopeTypeChange = (nextType: AlertScopeType) => {
    let nextId = '';
    if (nextType === 'SITE') nextId = sites[0]?.id ?? '';
    else if (nextType === 'MODEL') nextId = models[0]?.id ?? '';
    else if (nextType === 'DEVICE') nextId = devices[0]?.id ?? '';
    setForm((prev) => ({ ...prev, scopeType: nextType, scopeId: nextId }));
  };

  const toggleRecipientRole = (role: RoleCode) => {
    setForm((prev) => ({
      ...prev,
      recipientRoles: prev.recipientRoles.includes(role)
        ? prev.recipientRoles.filter((r) => r !== role)
        : [...prev.recipientRoles, role],
    }));
  };

  const columns: Column<AlertRule>[] = [
    {
      key: 'name',
      header: 'Rule Name',
      render: (r) => (
        <div>
          <p className="font-medium text-slate-900">{r.name}</p>
          <p className="text-xs font-mono text-slate-500 mt-0.5">{formatRuleCondition(r)}</p>
        </div>
      ),
    },
    {
      key: 'severity',
      header: 'Severity',
      render: (r) => <SeverityChip severity={r.severity} />,
    },
    {
      key: 'scope',
      header: 'Scope',
      render: (r) => {
        const label = scopeNameLookup.get(`${r.scopeType}:${r.scopeId}`) ?? r.scopeId;
        return (
          <div className="text-xs">
            <span className="font-mono text-[11px] text-slate-600 mr-1.5">{r.scopeType}</span>
            <span className="font-medium text-slate-800">{label}</span>
          </div>
        );
      },
    },
    {
      key: 'recipients',
      header: 'Recipients',
      render: (r) =>
        r.recipients.length === 0 ? (
          <span className="text-xs text-slate-500">Default (CA, CO, SE)</span>
        ) : (
          <span className="text-xs text-slate-700">
            {r.recipients
              .map((rec) => (rec.type === 'ROLE' && rec.role ? ROLE_LABELS[rec.role] : rec.userId))
              .join(', ')}
          </span>
        ),
    },
    {
      key: 'enabled',
      header: 'Status',
      render: (r) =>
        canWrite ? (
          <button
            type="button"
            role="switch"
            aria-checked={r.enabled}
            aria-label={`${r.enabled ? 'Disable' : 'Enable'} rule ${r.name}`}
            disabled={toggleMutation.isPending}
            onClick={(e) => {
              e.stopPropagation();
              toggleMutation.mutate({ id: r.id, enabled: !r.enabled });
            }}
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
              r.enabled ? 'bg-indigo-600' : 'bg-slate-300'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                r.enabled ? 'translate-x-4.5' : 'translate-x-1'
              }`}
            />
          </button>
        ) : (
          <StatusChip status={r.enabled ? 'ACTIVE' : 'INACTIVE'} label={r.enabled ? 'Enabled' : 'Disabled'} />
        ),
    },
    ...(canWrite
      ? [
          {
            key: 'actions',
            header: 'Actions',
            align: 'right' as const,
            render: (r: AlertRule) => (
              <div className="inline-flex items-center justify-end gap-1">
                <IconButton
                  label={`Edit rule ${r.name}`}
                  size="sm"
                  onClick={() => openEditModal(r)}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </IconButton>
                <IconButton
                  label={`Delete rule ${r.name}`}
                  size="sm"
                  variant="danger"
                  onClick={() => setDeleteTarget(r)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </IconButton>
              </div>
            ),
          },
        ]
      : []),
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (form.name.trim().length < 2) {
      setFormError('Rule name must be at least 2 characters.');
      return;
    }
    if (!form.scopeId) {
      setFormError('Select a target site, model, or device.');
      return;
    }
    if (form.kind === 'THRESHOLD' && (form.threshold.trim() === '' || Number.isNaN(Number(form.threshold)))) {
      setFormError('Enter a valid numeric threshold.');
      return;
    }
    const dur = Number(form.durationSec);
    if (!Number.isInteger(dur) || dur < 0) {
      setFormError('Duration must be a whole number of seconds (0 or greater).');
      return;
    }
    saveMutation.mutate();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Alert Rules"
        description="Threshold and offline detection rules evaluated in real time. Rules are suppressed for Suspended and Under Maintenance devices."
        actions={
          canWrite ? (
            <Button
              size="sm"
              onClick={openCreateModal}
              icon={<Plus className="w-4 h-4" />}
            >
              Create Rule
            </Button>
          ) : undefined
        }
      />

      {/* Filters */}
      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <Input
            label="Search rules"
            placeholder="Name or metric key..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <Select
            label="Rule Kind"
            value={kindFilter}
            onChange={(e) => {
              setKindFilter(e.target.value);
              setPage(1);
            }}
            options={[
              { value: '', label: 'All kinds' },
              { value: 'THRESHOLD', label: 'Threshold' },
              { value: 'OFFLINE', label: 'Offline' },
            ]}
          />
          <Select
            label="Severity"
            value={severityFilter}
            onChange={(e) => {
              setSeverityFilter(e.target.value);
              setPage(1);
            }}
            options={[
              { value: '', label: 'All severities' },
              { value: 'CRITICAL', label: 'Critical' },
              { value: 'WARNING', label: 'Warning' },
            ]}
          />
          <div className="flex items-end">
            {(search || kindFilter || severityFilter) && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setSearch('');
                  setKindFilter('');
                  setSeverityFilter('');
                  setPage(1);
                }}
              >
                Clear filters
              </Button>
            )}
          </div>
        </div>
      </Card>

      <DataTable
        columns={columns}
        rows={rulesQuery.data?.items ?? []}
        rowKey={(r) => r.id}
        total={rulesQuery.data?.total ?? 0}
        page={page}
        pageSize={25}
        onPageChange={setPage}
        isLoading={rulesQuery.isLoading}
        error={
          rulesQuery.isError
            ? rulesQuery.error instanceof ApiClientError
              ? rulesQuery.error.message
              : 'Unable to load alert rules.'
            : null
        }
        onRetry={() => void rulesQuery.refetch()}
        emptyTitle="No alert rules configured"
        emptyDescription="Create a threshold or offline detection rule to monitor telemetry anomalies and generate alerts."
        emptyAction={
          search || kindFilter || severityFilter ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setSearch('');
                setKindFilter('');
                setSeverityFilter('');
                setPage(1);
              }}
            >
              Clear filters
            </Button>
          ) : canWrite ? (
            <Button size="sm" onClick={openCreateModal} icon={<Plus className="w-4 h-4" />}>
              Create Rule
            </Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => void rulesQuery.refetch()}>
              Refresh
            </Button>
          )
        }
      />

      {/* Create / Edit Rule Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingRule ? 'Edit Alert Rule' : 'Create Alert Rule'}
        description="Threshold rules evaluate incoming telemetry & health snapshots; Offline rules fire when a device stops reporting."
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button loading={saveMutation.isPending} onClick={handleSubmit}>
              {editingRule ? 'Save Rule' : 'Create Rule'}
            </Button>
          </>
        }
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700 flex items-center gap-2"
            >
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Rule Name"
              required
              placeholder="e.g. High bearing temperature"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
            <Select
              label="Severity"
              required
              value={form.severity}
              onChange={(e) =>
                setForm((f) => ({ ...f, severity: e.target.value as AlertSeverity }))
              }
              options={[
                { value: 'CRITICAL', label: 'Critical (triggers escalation SLA)' },
                { value: 'WARNING', label: 'Warning' },
              ]}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Select
              label="Rule Kind"
              required
              value={form.kind}
              onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as AlertRuleKind }))}
              options={[
                { value: 'THRESHOLD', label: 'Threshold (Metric / Health)' },
                { value: 'OFFLINE', label: 'Device Offline' },
              ]}
            />
            <Select
              label="Scope Type"
              required
              value={form.scopeType}
              onChange={(e) => handleScopeTypeChange(e.target.value as AlertScopeType)}
              options={[
                { value: 'MODEL', label: 'Device Model' },
                { value: 'SITE', label: 'Site' },
                { value: 'DEVICE', label: 'Single Device' },
              ]}
            />
            <Select
              label={
                form.scopeType === 'SITE'
                  ? 'Target Site'
                  : form.scopeType === 'MODEL'
                    ? 'Target Model'
                    : 'Target Device'
              }
              required
              value={form.scopeId}
              onChange={(e) => setForm((f) => ({ ...f, scopeId: e.target.value }))}
            >
              <option value="">Select target...</option>
              {form.scopeType === 'SITE' &&
                sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              {form.scopeType === 'MODEL' &&
                models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              {form.scopeType === 'DEVICE' &&
                devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.serialNumber})
                  </option>
                ))}
            </Select>
          </div>

          {form.kind === 'THRESHOLD' ? (
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div className="sm:col-span-2">
                <Select
                  label="Metric or Health Field"
                  required
                  value={form.metricKey}
                  onChange={(e) => setForm((f) => ({ ...f, metricKey: e.target.value }))}
                >
                  {availableMetrics.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </Select>
              </div>
              <Select
                label="Operator"
                required
                value={form.operator}
                onChange={(e) =>
                  setForm((f) => ({ ...f, operator: e.target.value as AlertOperator }))
                }
                options={Object.entries(OPERATOR_LABELS).map(([value, label]) => ({
                  value,
                  label,
                }))}
              />
              <Input
                label="Threshold"
                type="number"
                step="any"
                required
                value={form.threshold}
                onChange={(e) => setForm((f) => ({ ...f, threshold: e.target.value }))}
              />
            </div>
          ) : null}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
            <Input
              label="Sustained Duration (seconds)"
              type="number"
              min={0}
              max={86400}
              required
              value={form.durationSec}
              onChange={(e) => setForm((f) => ({ ...f, durationSec: e.target.value }))}
              hint={
                form.kind === 'OFFLINE'
                  ? 'Minimum seconds silent before firing (e.g. 90).'
                  : 'Seconds the metric must breach continuously (0 = fire immediately).'
              }
            />
            <div className="pt-4">
              <Checkbox
                label="Rule enabled immediately"
                checked={form.enabled}
                onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
              />
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100">
            <p className="text-xs font-medium text-slate-700 mb-1">
              Notification Recipients (optional)
            </p>
            <p className="text-xs text-slate-500 mb-2.5">
              Leave all unchecked to notify default recipients: Tenant Client Admins, Client
              Operators, and assigned Support Engineers.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {RECIPIENT_ROLE_OPTIONS.map((role) => (
                <Checkbox
                  key={role}
                  label={ROLE_LABELS[role]}
                  checked={form.recipientRoles.includes(role)}
                  onChange={() => toggleRecipientRole(role)}
                />
              ))}
            </div>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
        }}
        title="Delete Alert Rule"
        message={`Delete "${deleteTarget?.name ?? ''}"? Existing historical alerts created by this rule will remain in the alert log, but no new alerts will be raised.`}
        confirmLabel="Delete Rule"
        variant="danger"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
