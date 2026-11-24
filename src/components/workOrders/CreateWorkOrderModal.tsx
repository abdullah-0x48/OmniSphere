import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import type {
  DevicePublic,
  PaginatedResponse,
  StaffOption,
  WorkOrderPublic,
  WorkOrderType,
} from '../../../shared/types.ts';
import { ApiClientError, apiRequest } from '../../api/client.ts';
import { useAuth } from '../../auth/AuthContext.tsx';
import { Button, Input, Modal, Select, Textarea, useToast } from '../ui/index.ts';

function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultWindowLocal(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getTime() + 60 * 60_000);
  start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 2 * 60 * 60_000);
  return {
    start: toDatetimeLocalValue(start.toISOString()),
    end: toDatetimeLocalValue(end.toISOString()),
  };
}

export interface CreateWorkOrderModalProps {
  open: boolean;
  onClose: () => void;
  defaultDeviceId?: string | null;
  defaultTicketId?: string | null;
  defaultTitle?: string;
  defaultInstructions?: string;
  onCreated?: (wo: WorkOrderPublic) => void;
}

export function CreateWorkOrderModal({
  open,
  onClose,
  defaultDeviceId,
  defaultTicketId,
  defaultTitle,
  defaultInstructions,
  onCreated,
}: CreateWorkOrderModalProps) {
  const { activeTenantId } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [deviceId, setDeviceId] = useState(defaultDeviceId ?? '');
  const [type, setType] = useState<WorkOrderType>('CORRECTIVE');
  const [title, setTitle] = useState(defaultTitle ?? '');
  const [instructions, setInstructions] = useState(defaultInstructions ?? '');
  const [assignedTo, setAssignedTo] = useState('');
  const [plannedStart, setPlannedStart] = useState('');
  const [plannedEnd, setPlannedEnd] = useState('');
  const [downtimeRequired, setDowntimeRequired] = useState(true);
  const [checklist, setChecklist] = useState<string[]>([
    'Verify safe equipment isolation and PPE',
    'Perform inspection / corrective procedure',
    'Confirm device returns ONLINE with nominal readings',
  ]);
  const [newStep, setNewStep] = useState('');

  useEffect(() => {
    if (!open) return;
    const win = defaultWindowLocal();
    setDeviceId(defaultDeviceId ?? '');
    setType(defaultTicketId ? 'CORRECTIVE' : 'CORRECTIVE');
    setTitle(defaultTitle ?? '');
    setInstructions(defaultInstructions ?? '');
    setAssignedTo('');
    setPlannedStart(win.start);
    setPlannedEnd(win.end);
    setDowntimeRequired(true);
    setChecklist([
      'Verify safe equipment isolation and PPE',
      'Perform inspection / corrective procedure',
      'Confirm device returns ONLINE with nominal readings',
    ]);
    setNewStep('');
  }, [open, defaultDeviceId, defaultTicketId, defaultTitle, defaultInstructions]);

  const devicesQuery = useQuery({
    queryKey: ['wo-modal-devices', activeTenantId],
    enabled: open,
    queryFn: () =>
      apiRequest<PaginatedResponse<DevicePublic>>('/devices', {
        query: { page: 1, pageSize: 200, sort: 'name:asc' },
      }),
  });

  const techniciansQuery = useQuery({
    queryKey: ['wo-technicians', activeTenantId],
    enabled: open,
    queryFn: () => apiRequest<{ items: StaffOption[] }>('/work-orders/technicians'),
  });

  const eligibleDevices = (devicesQuery.data?.items ?? []).filter(
    (d) => d.state !== 'DECOMMISSIONED',
  );
  const technicians = techniciansQuery.data?.items ?? [];

  const createMutation = useMutation({
    mutationFn: () =>
      apiRequest<WorkOrderPublic>('/work-orders', {
        method: 'POST',
        body: {
          deviceId,
          ticketId: defaultTicketId ?? null,
          type,
          title: title.trim(),
          instructions: instructions.trim(),
          checklist: checklist
            .map((t) => t.trim())
            .filter(Boolean)
            .map((text) => ({ text, done: false })),
          assignedTo: assignedTo || null,
          plannedStart: plannedStart ? new Date(plannedStart).toISOString() : null,
          plannedEnd: plannedEnd ? new Date(plannedEnd).toISOString() : null,
          downtimeRequired,
        },
      }),
    onSuccess: (created) => {
      toast({
        kind: 'success',
        title: `Work order ${created.number} created`,
        description:
          created.approvalStatus === 'PENDING'
            ? 'Sent to Client Manager for downtime window approval.'
            : created.assignedToName
              ? `Assigned to ${created.assignedToName}.`
              : 'Ready for technician assignment.',
      });
      void queryClient.invalidateQueries({ queryKey: ['work-orders-list'] });
      void queryClient.invalidateQueries({ queryKey: ['ticket-detail'] });
      void queryClient.invalidateQueries({ queryKey: ['device-work-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['fleet-summary'] });
      void queryClient.invalidateQueries({ queryKey: ['fleet-overview'] });
      onCreated?.(created);
      onClose();
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Unable to create work order',
        description: err instanceof ApiClientError ? err.message : 'Please check the form fields.',
      });
    },
  });

  const addChecklistStep = () => {
    const clean = newStep.trim();
    if (!clean) return;
    setChecklist((prev) => [...prev, clean]);
    setNewStep('');
  };

  const canSubmit =
    Boolean(deviceId) &&
    title.trim().length >= 3 &&
    instructions.trim().length >= 3 &&
    (!plannedStart || !plannedEnd || Date.parse(plannedEnd) > Date.parse(plannedStart));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create Work Order"
      description={
        defaultTicketId
          ? 'Dispatch field maintenance linked to this support ticket.'
          : 'Schedule corrective or preventive maintenance for a device.'
      }
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={createMutation.isPending}
            disabled={!canSubmit}
            onClick={() => createMutation.mutate()}
          >
            Create Work Order
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select
            label="Target Device"
            required
            value={deviceId}
            disabled={Boolean(defaultDeviceId)}
            onChange={(e) => setDeviceId(e.target.value)}
          >
            <option value="">Select device...</option>
            {eligibleDevices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.siteName ?? d.siteId})
              </option>
            ))}
          </Select>

          <Select
            label="Work Order Type"
            value={type}
            onChange={(e) => setType(e.target.value as WorkOrderType)}
            options={[
              { value: 'CORRECTIVE', label: 'Corrective' },
              { value: 'PREVENTIVE', label: 'Preventive' },
            ]}
          />
        </div>

        <Input
          label="Title"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Inspect sensor probe and replace seal"
        />

        <Textarea
          label="Field Instructions"
          required
          rows={3}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="Step-by-step instructions, tools required, safety notes..."
        />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Select
            label="Assign Field Technician"
            value={assignedTo}
            onChange={(e) => setAssignedTo(e.target.value)}
          >
            <option value="">Unassigned (Planned)</option>
            {technicians.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>

          <Input
            label="Planned Start"
            type="datetime-local"
            value={plannedStart}
            onChange={(e) => setPlannedStart(e.target.value)}
          />

          <Input
            label="Planned End"
            type="datetime-local"
            value={plannedEnd}
            onChange={(e) => setPlannedEnd(e.target.value)}
          />
        </div>

        {/* Downtime toggle */}
        <label className="flex items-start gap-3 p-3.5 rounded-xl border border-slate-200 bg-slate-50/70 cursor-pointer">
          <input
            type="checkbox"
            checked={downtimeRequired}
            onChange={(e) => setDowntimeRequired(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          <span className="text-sm">
            <span className="font-medium text-slate-900 block">Downtime required</span>
            <span className="text-xs text-slate-500">
              When enabled on organizations requiring maintenance approval, a Client Manager must
              approve the window before the Field Technician can start work.
            </span>
          </span>
        </label>

        {/* Checklist builder */}
        <div className="space-y-2">
          <label className="block text-xs font-medium text-slate-700">Field Checklist</label>
          <div className="space-y-2">
            {checklist.map((step, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  value={step}
                  onChange={(e) => {
                    const val = e.target.value;
                    setChecklist((prev) => prev.map((item, i) => (i === idx ? val : item)));
                  }}
                  className="flex-1 h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                />
                <button
                  type="button"
                  onClick={() => setChecklist((prev) => prev.filter((_, i) => i !== idx))}
                  aria-label={`Remove checklist step ${idx + 1}`}
                  className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 pt-1">
            <input
              type="text"
              value={newStep}
              onChange={(e) => setNewStep(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addChecklistStep();
                }
              }}
              placeholder="Add checklist step..."
              className="flex-1 h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={addChecklistStep}
              icon={<Plus className="w-3.5 h-3.5" />}
            >
              Add Step
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
