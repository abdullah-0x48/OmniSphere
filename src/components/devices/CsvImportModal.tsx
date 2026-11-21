import React, { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react';
import type {
  DeviceImportResponse,
  DeviceImportRowInput,
  Site,
} from '../../../shared/types.ts';
import { ApiClientError, apiRequest } from '../../api/client.ts';
import {
  buildSampleDeviceCsv,
  downloadJsonFile,
  downloadTextFile,
  parseDeviceImportCsv,
} from '../../utils/csv.ts';
import { Button, Modal, Textarea, useToast } from '../ui/index.ts';

interface CsvImportModalProps {
  open: boolean;
  onClose: () => void;
  sites: Site[];
  onImported: () => void;
}

export function CsvImportModal({ open, onClose, sites, onImported }: CsvImportModalProps) {
  const { toast } = useToast();
  const [csvText, setCsvText] = useState('');
  const [parsedRows, setParsedRows] = useState<DeviceImportRowInput[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [dryRunReport, setDryRunReport] = useState<DeviceImportResponse | null>(null);
  const [commitReport, setCommitReport] = useState<DeviceImportResponse | null>(null);

  useEffect(() => {
    if (open) {
      setCsvText('');
      setParsedRows([]);
      setParseError(null);
      setDryRunReport(null);
      setCommitReport(null);
    }
  }, [open]);

  const dryRunMutation = useMutation({
    mutationFn: (rows: DeviceImportRowInput[]) =>
      apiRequest<DeviceImportResponse>('/devices/import', {
        method: 'POST',
        query: { dryRun: true },
        body: { rows },
      }),
    onSuccess: (res) => {
      setDryRunReport(res);
    },
    onError: (err) => {
      const msg = err instanceof ApiClientError ? err.message : 'Validation failed';
      setParseError(msg);
      toast({ kind: 'error', title: 'CSV validation failed', description: msg });
    },
  });

  const commitMutation = useMutation({
    mutationFn: (rows: DeviceImportRowInput[]) =>
      apiRequest<DeviceImportResponse>('/devices/import', {
        method: 'POST',
        query: { dryRun: false },
        body: { rows },
      }),
    onSuccess: (res) => {
      setCommitReport(res);
      onImported();
      toast({
        kind: 'success',
        title: `Imported ${res.createdCount} ${res.createdCount === 1 ? 'device' : 'devices'}`,
        description:
          res.errorCount > 0 ? `${res.errorCount} invalid row(s) skipped.` : 'All rows imported.',
      });
    },
    onError: (err) => {
      const msg = err instanceof ApiClientError ? err.message : 'Import failed';
      toast({ kind: 'error', title: 'CSV import failed', description: msg });
    },
  });

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setCsvText(text);
    setParseError(null);
    setDryRunReport(null);
    setCommitReport(null);
  };

  const handleValidate = () => {
    setParseError(null);
    const { rows, headerError } = parseDeviceImportCsv(csvText);
    if (headerError) {
      setParseError(headerError);
      return;
    }
    if (rows.length > 200) {
      setParseError('Maximum 200 rows per import batch.');
      return;
    }
    setParsedRows(rows);
    dryRunMutation.mutate(rows);
  };

  const handleDownloadSample = () => {
    const sampleSite = sites[0]?.name ?? 'Dyeing Plant';
    downloadTextFile('omnisphere-devices-sample.csv', buildSampleDeviceCsv(sampleSite));
  };

  const handleDownloadBundle = () => {
    if (!commitReport) return;
    const filename = `omnisphere-provisioning-batch-${new Date().toISOString().slice(0, 10)}.json`;
    downloadJsonFile(filename, commitReport.provisioningFiles);
    toast({ kind: 'success', title: `Downloaded ${filename}` });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Bulk Import Devices (CSV)"
      description="Validate CSV rows with a dry run first, then register all valid devices and download their provisioning keys."
      size="lg"
      footer={
        commitReport ? (
          <div className="flex items-center justify-between w-full gap-3 flex-wrap">
            {commitReport.provisioningFiles.length > 0 ? (
              <Button
                variant="primary"
                onClick={handleDownloadBundle}
                icon={<Download className="w-4 h-4" />}
              >
                Download Provisioning JSON ({commitReport.provisioningFiles.length})
              </Button>
            ) : (
              <span />
            )}
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        ) : dryRunReport ? (
          <>
            <Button
              variant="secondary"
              onClick={() => setDryRunReport(null)}
              disabled={commitMutation.isPending}
            >
              Back to CSV
            </Button>
            <Button
              variant="primary"
              onClick={() => commitMutation.mutate(parsedRows)}
              loading={commitMutation.isPending}
              disabled={dryRunReport.validCount === 0}
            >
              Import {dryRunReport.validCount} Valid{' '}
              {dryRunReport.validCount === 1 ? 'Device' : 'Devices'}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleValidate}
              loading={dryRunMutation.isPending}
              disabled={!csvText.trim()}
            >
              Validate CSV (Dry Run)
            </Button>
          </>
        )
      }
    >
      {/* Step 3: Commit Result */}
      {commitReport ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-emerald-900">
                Created {commitReport.createdCount} of {commitReport.totalRows} devices
              </p>
              <p className="text-xs text-emerald-800 mt-1">
                Download the combined provisioning JSON before closing this dialog — API keys cannot
                be shown again.
              </p>
            </div>
          </div>

          <div className="border border-slate-200 rounded-lg overflow-hidden max-h-64 overflow-y-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-semibold">Row</th>
                  <th className="px-3 py-2 font-semibold">Serial</th>
                  <th className="px-3 py-2 font-semibold">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {commitReport.rows.map((r) => (
                  <tr key={r.rowNumber}>
                    <td className="px-3 py-2 font-mono text-slate-500">#{r.rowNumber}</td>
                    <td className="px-3 py-2 font-mono text-slate-800">{r.serialNumber || '—'}</td>
                    <td className="px-3 py-2">
                      {r.createdDeviceId ? (
                        <span className="text-emerald-700 font-medium">
                          Created ({r.createdDeviceId})
                        </span>
                      ) : (
                        <span className="text-red-700">{r.errors.join('; ')}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : dryRunReport ? (
        /* Step 2: Dry Run Validation Report */
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Total Rows</p>
              <p className="text-lg font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
                {dryRunReport.totalRows}
              </p>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-xs text-emerald-700">Ready to Import</p>
              <p className="text-lg font-semibold font-mono tabular-nums text-emerald-800 mt-0.5">
                {dryRunReport.validCount}
              </p>
            </div>
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="text-xs text-red-700">Row Errors</p>
              <p className="text-lg font-semibold font-mono tabular-nums text-red-800 mt-0.5">
                {dryRunReport.errorCount}
              </p>
            </div>
          </div>

          {dryRunReport.errorCount > 0 && dryRunReport.validCount > 0 && (
            <p className="text-xs text-slate-600">
              Valid rows will be registered even though {dryRunReport.errorCount} row(s) have
              errors. Invalid rows will be skipped.
            </p>
          )}

          <div className="border border-slate-200 rounded-lg overflow-hidden max-h-72 overflow-y-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-semibold">Row</th>
                  <th className="px-3 py-2 font-semibold">Name / Serial</th>
                  <th className="px-3 py-2 font-semibold">Model / Site</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dryRunReport.rows.map((r) => (
                  <tr key={r.rowNumber} className={r.valid ? '' : 'bg-red-50/40'}>
                    <td className="px-3 py-2 font-mono text-slate-500">#{r.rowNumber}</td>
                    <td className="px-3 py-2">
                      <p className="font-medium text-slate-800">{r.name || '—'}</p>
                      <p className="font-mono text-slate-500">{r.serialNumber || '—'}</p>
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      <p>{r.modelName ?? 'Unmatched model'}</p>
                      <p className="text-slate-400">{r.siteName ?? 'Unmatched site'}</p>
                    </td>
                    <td className="px-3 py-2">
                      {r.valid ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Valid
                        </span>
                      ) : (
                        <ul className="space-y-0.5 text-red-700">
                          {r.errors.map((e, idx) => (
                            <li key={idx} className="flex items-start gap-1">
                              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                              <span>{e}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Step 1: Upload or Paste CSV */
        <div className="space-y-4">
          {parseError && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700"
            >
              {parseError}
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4">
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="w-6 h-6 text-indigo-600 shrink-0" />
              <div>
                <p className="text-sm font-medium text-slate-800">Upload a CSV file</p>
                <p className="text-xs text-slate-500">
                  Columns: <span className="font-mono">serialNumber, hardwareId, model, site, tags, name</span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="ghost" size="sm" onClick={handleDownloadSample}>
                Sample CSV
              </Button>
              <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 cursor-pointer">
                <Upload className="w-3.5 h-3.5" />
                Choose File
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => void handleFileSelected(e)}
                  className="sr-only"
                />
              </label>
            </div>
          </div>

          <Textarea
            label="Or paste CSV content directly"
            rows={7}
            value={csvText}
            onChange={(e) => {
              setCsvText(e.target.value);
              setParseError(null);
            }}
            placeholder={
              'serialNumber,hardwareId,model,site,tags,name\nSN-IMP-001,AA:BB:CC:00:01:01,TH-200 Temperature and Humidity Sensor,Dyeing Plant,"line-1,critical",Sensor-01'
            }
            className="font-mono text-xs"
          />
        </div>
      )}
    </Modal>
  );
}
