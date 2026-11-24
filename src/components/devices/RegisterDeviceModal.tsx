import React, { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type {
  ConfigProfilePublic,
  DeviceModel,
  DeviceRegistrationResponse,
  PaginatedResponse,
  Site,
} from '../../../shared/types.ts';
import { ApiClientError, apiRequest } from '../../api/client.ts';
import { Button, Input, Modal, Select, useToast } from '../ui/index.ts';

interface RegisterDeviceModalProps {
  open: boolean;
  onClose: () => void;
  sites: Site[];
  models: DeviceModel[];
  onRegistered: (result: DeviceRegistrationResponse) => void;
}

export function RegisterDeviceModal({
  open,
  onClose,
  sites,
  models,
  onRegistered,
}: RegisterDeviceModalProps) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [hardwareId, setHardwareId] = useState('');
  const [modelId, setModelId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [configProfileId, setConfigProfileId] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const configProfilesQuery = useQuery({
    queryKey: ['register-modal-config-profiles', modelId],
    enabled: open && Boolean(modelId),
    queryFn: () =>
      apiRequest<PaginatedResponse<ConfigProfilePublic>>('/config-profiles', {
        query: { modelId, page: 1, pageSize: 100 },
      }),
  });

  useEffect(() => {
    if (open) {
      setName('');
      setSerialNumber('');
      setHardwareId('');
      setModelId(models[0]?.id ?? '');
      setSiteId(sites[0]?.id ?? '');
      setTagsText('');
      setConfigProfileId('');
      setFieldErrors({});
      setFormError(null);
    }
  }, [open, models, sites]);

  const registerMutation = useMutation({
    mutationFn: () => {
      const tags = tagsText
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      return apiRequest<DeviceRegistrationResponse>('/devices', {
        method: 'POST',
        body: {
          name: name.trim(),
          serialNumber: serialNumber.trim(),
          hardwareId: hardwareId.trim(),
          modelId,
          siteId,
          tags,
          configProfileId: configProfileId || undefined,
        },
      });
    },
    onSuccess: (res) => {
      toast({
        kind: 'success',
        title: `Device "${res.device.name}" registered`,
        description: 'Download or copy the one-time provisioning JSON.',
      });
      onClose();
      onRegistered(res);
    },
    onError: (err) => {
      if (err instanceof ApiClientError) {
        const details = err.details as { field?: string } | undefined;
        if (details?.field) {
          setFieldErrors({ [details.field]: err.message });
        } else {
          setFormError(err.message);
        }
        toast({ kind: 'error', title: 'Registration failed', description: err.message });
      } else {
        setFormError('Failed to register device');
      }
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (name.trim().length < 2) errs.name = 'Device name must be at least 2 characters';
    if (serialNumber.trim().length < 2) errs.serialNumber = 'Serial number is required';
    if (hardwareId.trim().length < 2) errs.hardwareId = 'Hardware ID (MAC or IMEI) is required';
    if (!modelId) errs.modelId = 'Select a device model';
    if (!siteId) errs.siteId = 'Select a site';

    setFieldErrors(errs);
    setFormError(null);
    if (Object.keys(errs).length > 0) return;

    registerMutation.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Register Device"
      description="Create a device in PROVISIONED state and generate its one-time API credentials."
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={registerMutation.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="register-device-form"
            loading={registerMutation.isPending}
            disabled={sites.length === 0 || models.length === 0}
          >
            Register Device
          </Button>
        </>
      }
    >
      <form id="register-device-form" onSubmit={handleSubmit} className="space-y-4">
        {formError && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700"
          >
            {formError}
          </div>
        )}

        {sites.length === 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
            Create at least one site under Sites before registering a device.
          </div>
        )}

        <Input
          label="Device Name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. KTL-DYE-TH-015"
          error={fieldErrors.name}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Serial Number"
            required
            value={serialNumber}
            onChange={(e) => setSerialNumber(e.target.value)}
            placeholder="e.g. SN-KTL-TH-2026015"
            error={fieldErrors.serialNumber}
          />
          <Input
            label="Hardware ID (MAC / IMEI)"
            required
            value={hardwareId}
            onChange={(e) => setHardwareId(e.target.value)}
            placeholder="e.g. 00:1A:2B:3C:4D:5E"
            error={fieldErrors.hardwareId}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select
            label="Device Model"
            required
            value={modelId}
            onChange={(e) => {
              setModelId(e.target.value);
              setConfigProfileId('');
            }}
            error={fieldErrors.modelId}
          >
            <option value="">Select model...</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>

          <Select
            label="Assigned Site"
            required
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            error={fieldErrors.siteId}
          >
            <option value="">Select site...</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>

        <Select
          label="Initial Config Profile (optional)"
          value={configProfileId}
          onChange={(e) => setConfigProfileId(e.target.value)}
          hint="If selected, the device receives this configuration automatically on its first handshake."
        >
          <option value="">None (configure later)</option>
          {(configProfilesQuery.data?.items ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} (v{p.version})
            </option>
          ))}
        </Select>

        <Input
          label="Tags (optional)"
          value={tagsText}
          onChange={(e) => setTagsText(e.target.value)}
          placeholder="critical, line-1, outdoor"
          hint="Comma-separated tags used for filtering and bulk operations."
        />
      </form>
    </Modal>
  );
}
