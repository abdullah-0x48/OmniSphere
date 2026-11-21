import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TenantSettings, TenantSummary } from '../../shared/types.ts';
import { ApiClientError, apiRequest } from '../api/client.ts';
import { useAuth } from '../auth/AuthContext.tsx';
import {
  Button,
  Card,
  Checkbox,
  ErrorState,
  Input,
  PageHeader,
  useToast,
} from '../components/ui/index.ts';

export function SettingsPage() {
  const { user, refreshMe } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const tenantId = user?.tenantId ?? '';
  const [form, setForm] = useState<TenantSettings>({
    heartbeatIntervalSec: 30,
    offlineAfterMissedIntervals: 3,
    criticalAckMinutes: 15,
    requireRolloutApproval: false,
    requireMaintenanceApproval: true,
  });

  const tenantQuery = useQuery({
    queryKey: ['own-tenant-settings', tenantId],
    queryFn: () => apiRequest<TenantSummary>(`/tenants/${tenantId}`),
    enabled: Boolean(tenantId),
  });

  useEffect(() => {
    if (tenantQuery.data?.settings) {
      setForm(tenantQuery.data.settings);
    }
  }, [tenantQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (payload: TenantSettings) =>
      apiRequest(`/tenants/${tenantId}/settings`, {
        method: 'PATCH',
        body: payload,
      }),
    onSuccess: () => {
      toast({ kind: 'success', title: 'Organization settings updated' });
      void queryClient.invalidateQueries({ queryKey: ['own-tenant-settings', tenantId] });
      void refreshMe();
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Save failed',
        description: err instanceof ApiClientError ? err.message : 'Unable to save settings.',
      });
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organization Settings"
        description={
          tenantQuery.data
            ? `Operational policies for ${tenantQuery.data.name} (${tenantQuery.data.code}).`
            : 'Configure fleet connectivity thresholds, alert escalation windows, and approval gates.'
        }
      />

      {tenantQuery.isError ? (
        <ErrorState
          message={
            tenantQuery.error instanceof ApiClientError
              ? tenantQuery.error.message
              : 'Unable to load organization settings.'
          }
          onRetry={() => void tenantQuery.refetch()}
        />
      ) : (
        <Card className="p-6 max-w-2xl">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveMutation.mutate(form);
            }}
            className="space-y-6"
          >
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-slate-900">Connectivity & Escalation</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Input
                  label="Heartbeat interval (sec)"
                  type="number"
                  min={10}
                  max={3600}
                  disabled={tenantQuery.isLoading}
                  value={form.heartbeatIntervalSec}
                  onChange={(e) =>
                    setForm({ ...form, heartbeatIntervalSec: Number(e.target.value) })
                  }
                  hint="Default: 30 s"
                />
                <Input
                  label="Offline after missed intervals"
                  type="number"
                  min={1}
                  max={20}
                  disabled={tenantQuery.isLoading}
                  value={form.offlineAfterMissedIntervals}
                  onChange={(e) =>
                    setForm({ ...form, offlineAfterMissedIntervals: Number(e.target.value) })
                  }
                  hint={`Offline at ${form.heartbeatIntervalSec * form.offlineAfterMissedIntervals} s`}
                />
                <Input
                  label="Critical ack timeout (min)"
                  type="number"
                  min={1}
                  max={1440}
                  disabled={tenantQuery.isLoading}
                  value={form.criticalAckMinutes}
                  onChange={(e) =>
                    setForm({ ...form, criticalAckMinutes: Number(e.target.value) })
                  }
                  hint="Before Level-1 escalation"
                />
              </div>
            </div>

            <div className="pt-5 border-t border-slate-200 space-y-4">
              <h2 className="text-sm font-semibold text-slate-900">Change Approval Gates</h2>
              <Checkbox
                label="Require Client Manager approval for firmware rollouts"
                description="When enabled, new OTA rollouts enter PENDING_APPROVAL until approved by a Client Manager."
                disabled={tenantQuery.isLoading}
                checked={form.requireRolloutApproval}
                onChange={(e) => setForm({ ...form, requireRolloutApproval: e.target.checked })}
              />
              <Checkbox
                label="Require Client Manager approval for downtime maintenance windows"
                description="When enabled, work orders requiring downtime must be approved before a Field Technician can start."
                disabled={tenantQuery.isLoading}
                checked={form.requireMaintenanceApproval}
                onChange={(e) => setForm({ ...form, requireMaintenanceApproval: e.target.checked })}
              />
            </div>

            <div className="pt-2 flex items-center gap-3">
              <Button type="submit" loading={saveMutation.isPending} disabled={tenantQuery.isLoading}>
                Save settings
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
