import React, { useState } from 'react';
import { AlertTriangle, Check, Copy, Download } from 'lucide-react';
import type { DeviceProvisioningPayload } from '../../../shared/types.ts';
import { downloadJsonFile } from '../../utils/csv.ts';
import { Button, Modal, useToast } from '../ui/index.ts';

interface ProvisioningModalProps {
  provisioning: DeviceProvisioningPayload | null;
  deviceName?: string;
  onClose: () => void;
}

export function ProvisioningModal({ provisioning, deviceName, onClose }: ProvisioningModalProps) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  if (!provisioning) return null;

  const formattedJson = JSON.stringify(provisioning, null, 2);
  const fileName = `${provisioning.deviceId}-provisioning.json`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formattedJson);
      setCopied(true);
      toast({ kind: 'success', title: 'Provisioning JSON copied to clipboard' });
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      toast({ kind: 'error', title: 'Unable to copy to clipboard; use Download instead.' });
    }
  };

  const handleDownload = () => {
    downloadJsonFile(fileName, provisioning);
    toast({ kind: 'success', title: `Downloaded ${fileName}` });
  };

  return (
    <Modal
      open={Boolean(provisioning)}
      onClose={onClose}
      title="Device Provisioning Credentials"
      description={deviceName ? `One-time API credentials for ${deviceName}` : 'One-time API credentials'}
      size="lg"
      footer={
        <div className="flex items-center justify-between w-full gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => void handleCopy()}
              icon={copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
            >
              {copied ? 'Copied' : 'Copy JSON'}
            </Button>
            <Button
              variant="primary"
              onClick={handleDownload}
              icon={<Download className="w-4 h-4" />}
            >
              Download {fileName}
            </Button>
          </div>
          <Button variant="ghost" onClick={onClose}>
            Done
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-900"
        >
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="font-semibold">Save this API key now — it cannot be shown again.</p>
            <p className="text-xs text-amber-800 mt-0.5">
              OmniSphere stores only a one-way SHA-256 hash of this key. If lost, use Regenerate
              Key on the device detail page to issue a replacement.
            </p>
          </div>
        </div>

        <div>
          <p className="text-xs font-medium text-slate-600 mb-1.5">
            Provisioning file ({fileName})
          </p>
          <pre className="rounded-lg bg-slate-900 text-slate-100 p-4 text-xs font-mono overflow-x-auto leading-relaxed select-all">
            {formattedJson}
          </pre>
        </div>
      </div>
    </Modal>
  );
}
