import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  CheckCircle2,
  Copy,
  Eye,
  FileCode2,
  Search,
  Upload,
  X,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import type {
  DeviceModel,
  FirmwarePackagePublic,
  FirmwareStatus,
  PaginatedResponse,
} from '../../shared/types.ts';
import { ApiClientError, apiRequest } from '../api/client.ts';
import { useAuth } from '../auth/AuthContext.tsx';
import {
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  Drawer,
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function computeBrowserSha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await window.crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function FirmwarePage() {
  const { user, activeTenantId } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const canManage = user?.role === 'PLATFORM_ADMIN' || user?.role === 'SUPPORT_ENGINEER';

  const q = searchParams.get('q') ?? '';
  const modelId = searchParams.get('modelId') ?? '';
  const status = searchParams.get('status') ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);

  const [searchInput, setSearchInput] = useState(q);
  const [inspectPkg, setInspectPkg] = useState<FirmwarePackagePublic | null>(null);

  // Upload modal state
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadModelId, setUploadModelId] = useState('');
  const [uploadVersion, setUploadVersion] = useState('');
  const [uploadNotes, setUploadNotes] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [computedSha, setComputedSha] = useState<string>('');
  const [expectedSha, setExpectedSha] = useState<string>('');
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Status transition confirmation dialog
  const [statusDialog, setStatusDialog] = useState<{
    pkg: FirmwarePackagePublic;
    targetStatus: FirmwareStatus;
  } | null>(null);

  const updateParams = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(updates)) {
      if (!v) next.delete(k);
      else next.set(k, v);
    }
    setSearchParams(next, { replace: true });
  };

  const firmwareQuery = useQuery({
    queryKey: ['firmware-list', { activeTenantId, q, modelId, status, page }],
    queryFn: () =>
      apiRequest<PaginatedResponse<FirmwarePackagePublic>>('/firmware', {
        query: { q, modelId, status: canManage ? status : undefined, page, pageSize: 25 },
      }),
  });

  const modelsQuery = useQuery({
    queryKey: ['device-models-options'],
    queryFn: () =>
      apiRequest<PaginatedResponse<DeviceModel>>('/device-models', {
        query: { page: 1, pageSize: 200 },
      }),
  });

  const uploadMutation = useMutation({
    mutationFn: () => {
      if (!uploadFile) throw new Error('Select a binary file');
      const form = new FormData();
      form.append('modelId', uploadModelId);
      form.append('version', uploadVersion.trim());
      form.append('releaseNotes', uploadNotes.trim());
      if (expectedSha.trim()) {
        form.append('checksumSha256', expectedSha.trim());
      }
      form.append('file', uploadFile);
      return apiRequest<FirmwarePackagePublic>('/firmware', {
        method: 'POST',
        body: form,
      });
    },
    onSuccess: (created) => {
      toast({
        kind: 'success',
        title: `Uploaded firmware ${created.version}`,
        description: 'SHA-256 verified on server. Package starts in DRAFT status.',
      });
      setUploadOpen(false);
      setUploadFile(null);
      setComputedSha('');
      setExpectedSha('');
      setUploadVersion('');
      setUploadNotes('');
      setUploadError(null);
      void queryClient.invalidateQueries({ queryKey: ['firmware-list'] });
    },
    onError: (err) => {
      const msg = err instanceof ApiClientError ? err.message : 'Unable to upload firmware package.';
      setUploadError(msg);
      toast({ kind: 'error', title: 'Upload rejected', description: msg });
    },
  });

  const statusMutation = useMutation({
    mutationFn: (vars: { id: string; status: FirmwareStatus }) =>
      apiRequest<FirmwarePackagePublic>(`/firmware/${vars.id}/status`, {
        method: 'PATCH',
        body: { status: vars.status },
      }),
    onSuccess: (updated) => {
      toast({
        kind: 'success',
        title:
          updated.status === 'RELEASED'
            ? `Firmware ${updated.version} released`
            : `Firmware ${updated.version} withdrawn`,
      });
      setStatusDialog(null);
      if (inspectPkg?.id === updated.id) setInspectPkg(updated);
      void queryClient.invalidateQueries({ queryKey: ['firmware-list'] });
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Status update failed',
        description: err instanceof ApiClientError ? err.message : 'Unable to update status.',
      });
    },
  });

  const copyChecksum = async (sha: string) => {
    try {
      await navigator.clipboard.writeText(sha);
      toast({ kind: 'info', title: 'SHA-256 checksum copied' });
    } catch {
      toast({ kind: 'error', title: 'Copy failed' });
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setUploadFile(file);
    setUploadError(null);
    if (!file) {
      setComputedSha('');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setUploadError('File exceeds the maximum 5 MB firmware size limit.');
      setComputedSha('');
      return;
    }
    try {
      const sha = await computeBrowserSha256Hex(file);
      setComputedSha(sha);
    } catch {
      setComputedSha('');
    }
  };

  const openUploadModal = () => {
    setUploadModelId(modelsQuery.data?.items?.[0]?.id ?? '');
    setUploadVersion('');
    setUploadNotes('');
    setUploadFile(null);
    setComputedSha('');
    setExpectedSha('');
    setUploadError(null);
    setUploadOpen(true);
  };

  const columns: Column<FirmwarePackagePublic>[] = [
    {
      key: 'model',
      header: 'Model & Version',
      render: (f) => (
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold text-slate-900">{f.version}</span>
            <StatusChip status={f.status} />
          </div>
          <p className="text-xs text-slate-500 mt-0.5">{f.modelName ?? f.modelId}</p>
        </div>
      ),
    },
    {
      key: 'checksum',
      header: 'SHA-256 Checksum',
      hideOnMobile: true,
      render: (f) => (
        <div
          className="inline-flex items-center gap-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          <span
            className="font-mono text-xs text-slate-700"
            title={f.checksumSha256}
          >
            {f.checksumSha256.slice(0, 16)}…
          </span>
          <button
            type="button"
            onClick={() => void copyChecksum(f.checksumSha256)}
            aria-label={`Copy SHA-256 for ${f.version}`}
            className="p-1 rounded text-slate-500 hover:text-indigo-700 cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
        </div>
      ),
    },
    {
      key: 'size',
      header: 'Size',
      align: 'right',
      hideOnMobile: true,
      render: (f) => (
        <span className="font-mono text-xs tabular-nums text-slate-600">
          {formatBytes(f.sizeBytes)}
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: 'Uploaded',
      hideOnMobile: true,
      render: (f) => <RelativeTime iso={f.createdAt} />,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (f) => (
        <div
          className="inline-flex items-center gap-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setInspectPkg(f)}
            icon={<Eye className="w-3.5 h-3.5" />}
          >
            Inspect
          </Button>
          {canManage && f.status === 'DRAFT' && (
            <Button
              size="sm"
              onClick={() => setStatusDialog({ pkg: f, targetStatus: 'RELEASED' })}
              icon={<CheckCircle2 className="w-3.5 h-3.5" />}
            >
              Release
            </Button>
          )}
          {canManage && (f.status === 'DRAFT' || f.status === 'RELEASED') && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setStatusDialog({ pkg: f, targetStatus: 'WITHDRAWN' })}
              icon={<Ban className="w-3.5 h-3.5" />}
            >
              Withdraw
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Firmware Repository"
        description={
          canManage
            ? 'Upload verified firmware binaries (max 5 MB), inspect SHA-256 digests, and control release lifecycle.'
            : 'Released firmware packages available for device models in your organization.'
        }
        actions={
          canManage ? (
            <Button onClick={openUploadModal} icon={<Upload className="w-4 h-4" />}>
              Upload Firmware
            </Button>
          ) : undefined
        }
      />

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              updateParams({ q: searchInput.trim() || null, page: '1' });
            }}
            className="flex items-center gap-2 flex-1"
          >
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                aria-label="Search firmware packages"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search by version, model, or release notes..."
                className="w-full h-9 pl-9 pr-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
              />
            </div>
            <Button type="submit" variant="secondary" size="sm">
              Search
            </Button>
          </form>

          <div className="w-full sm:w-56">
            <Select
              aria-label="Filter by device model"
              value={modelId}
              onChange={(e) => updateParams({ modelId: e.target.value || null, page: '1' })}
              className="h-9 py-1.5"
            >
              <option value="">All Models</option>
              {(modelsQuery.data?.items ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </div>

          {canManage && (
            <div className="w-full sm:w-44">
              <Select
                aria-label="Filter by firmware status"
                value={status}
                onChange={(e) => updateParams({ status: e.target.value || null, page: '1' })}
                className="h-9 py-1.5"
              >
                <option value="">All Statuses</option>
                <option value="DRAFT">Draft</option>
                <option value="RELEASED">Released</option>
                <option value="WITHDRAWN">Withdrawn</option>
              </Select>
            </div>
          )}

          {(q || modelId || status) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchInput('');
                setSearchParams(new URLSearchParams(), { replace: true });
              }}
              icon={<X className="w-3.5 h-3.5" />}
            >
              Clear
            </Button>
          )}
        </div>
      </Card>

      <DataTable
        columns={columns}
        rows={firmwareQuery.data?.items ?? []}
        rowKey={(f) => f.id}
        total={firmwareQuery.data?.total ?? 0}
        page={page}
        pageSize={25}
        onPageChange={(next) => updateParams({ page: String(next) })}
        isLoading={firmwareQuery.isLoading}
        error={
          firmwareQuery.isError
            ? firmwareQuery.error instanceof ApiClientError
              ? firmwareQuery.error.message
              : 'Unable to load firmware packages.'
            : null
        }
        onRetry={() => void firmwareQuery.refetch()}
        onRowClick={(f) => setInspectPkg(f)}
        emptyTitle="No firmware packages found"
        emptyDescription={
          q || modelId || status
            ? 'No firmware packages match your active filters.'
            : canManage
              ? 'Upload a firmware binary to begin staged OTA distribution.'
              : 'No released firmware packages match your organization’s device models yet.'
        }
        emptyAction={
          q || modelId || status ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setSearchInput('');
                setSearchParams(new URLSearchParams(), { replace: true });
              }}
            >
              Clear filters
            </Button>
          ) : canManage ? (
            <Button onClick={openUploadModal} icon={<Upload className="w-4 h-4" />}>
              Upload Firmware
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => void firmwareQuery.refetch()}>
              Refresh
            </Button>
          )
        }
      />

      {/* Upload Firmware Modal */}
      <Modal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title="Upload Firmware Package"
        description="Binary files up to 5 MB are verified with SHA-256 on the server and saved in DRAFT status."
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setUploadOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={uploadMutation.isPending}
              disabled={!uploadModelId || !uploadVersion.trim() || !uploadFile}
              onClick={() => uploadMutation.mutate()}
              icon={<Upload className="w-4 h-4" />}
            >
              Upload Binary
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {uploadError && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700"
            >
              {uploadError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="Device Model"
              required
              value={uploadModelId}
              onChange={(e) => setUploadModelId(e.target.value)}
            >
              <option value="">Select model...</option>
              {(modelsQuery.data?.items ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>

            <Input
              label="Semantic Version"
              required
              value={uploadVersion}
              onChange={(e) => setUploadVersion(e.target.value)}
              placeholder="e.g. 1.3.0"
              hint="Format: major.minor.patch"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="firmware-binary-file"
              className="block text-sm font-medium text-slate-700"
            >
              Firmware Binary File <span className="text-red-600">*</span>
            </label>
            <input
              id="firmware-binary-file"
              type="file"
              onChange={(e) => void handleFileChange(e)}
              className="block w-full text-xs text-slate-700 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-slate-300 file:text-xs file:font-medium file:bg-white file:text-slate-700 hover:file:bg-slate-50 cursor-pointer"
            />
            {uploadFile && (
              <p className="text-xs text-slate-500">
                Selected <span className="font-mono">{uploadFile.name}</span> ({formatBytes(uploadFile.size)})
              </p>
            )}
          </div>

          {computedSha && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 space-y-1">
              <p className="text-xs font-medium text-emerald-900">
                Computed Local SHA-256 (server will independently re-verify)
              </p>
              <p className="font-mono text-[11px] text-emerald-800 break-all">{computedSha}</p>
            </div>
          )}

          <Input
            label="Expected SHA-256 Checksum (optional)"
            value={expectedSha}
            onChange={(e) => setExpectedSha(e.target.value)}
            placeholder="64-character hex digest to verify on server"
            hint="If provided, upload is rejected with 400 if the server-computed digest does not match."
            className="font-mono text-xs"
          />

          <Textarea
            label="Release Notes"
            rows={3}
            value={uploadNotes}
            onChange={(e) => setUploadNotes(e.target.value)}
            placeholder="Summarize fixes, calibration updates, or security patches..."
          />
        </div>
      </Modal>

      {/* Inspect Firmware Drawer */}
      <Drawer
        open={Boolean(inspectPkg)}
        onClose={() => setInspectPkg(null)}
        title={inspectPkg ? `Firmware ${inspectPkg.version}` : 'Firmware Details'}
        subtitle={inspectPkg ? inspectPkg.modelName ?? inspectPkg.modelId : undefined}
      >
        {inspectPkg && (
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-2">
              <StatusChip status={inspectPkg.status} />
              <span className="font-mono text-xs text-slate-500">
                {formatBytes(inspectPkg.sizeBytes)}
              </span>
            </div>

            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-slate-500">Package ID</dt>
                <dd className="font-mono text-xs text-slate-900 mt-0.5">{inspectPkg.id}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">SHA-256 Checksum</dt>
                <dd className="mt-1 flex items-start gap-2">
                  <code className="flex-1 rounded-lg bg-slate-100 border border-slate-200 p-2 font-mono text-[11px] text-slate-800 break-all">
                    {inspectPkg.checksumSha256}
                  </code>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void copyChecksum(inspectPkg.checksumSha256)}
                    icon={<Copy className="w-3.5 h-3.5" />}
                  >
                    Copy
                  </Button>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Uploaded By</dt>
                <dd className="text-slate-900 mt-0.5">
                  {inspectPkg.uploadedByName ?? inspectPkg.uploadedBy} ·{' '}
                  <span className="font-mono text-xs text-slate-500">
                    {formatLocalDateTime(inspectPkg.createdAt)}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Release Notes</dt>
                <dd className="mt-1 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 whitespace-pre-wrap">
                  {inspectPkg.releaseNotes || 'No release notes provided.'}
                </dd>
              </div>
            </dl>

            <div className="rounded-lg border border-indigo-200 bg-indigo-50/70 p-3 text-xs text-indigo-900 flex items-start gap-2">
              <FileCode2 className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
              <p>
                Devices download this binary directly from{' '}
                <code className="font-mono">/device/v1/firmware/{inspectPkg.id}/download</code>{' '}
                using their device API key headers when an active rollout job exists.
              </p>
            </div>

            {canManage && (inspectPkg.status === 'DRAFT' || inspectPkg.status === 'RELEASED') && (
              <div className="pt-2 border-t border-slate-200 flex items-center gap-2">
                {inspectPkg.status === 'DRAFT' && (
                  <Button
                    size="sm"
                    onClick={() => setStatusDialog({ pkg: inspectPkg, targetStatus: 'RELEASED' })}
                    icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                  >
                    Release Package
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setStatusDialog({ pkg: inspectPkg, targetStatus: 'WITHDRAWN' })}
                  icon={<Ban className="w-3.5 h-3.5" />}
                >
                  Withdraw
                </Button>
              </div>
            )}
          </div>
        )}
      </Drawer>

      {/* Release / Withdraw Confirmation */}
      <ConfirmDialog
        open={Boolean(statusDialog)}
        onClose={() => setStatusDialog(null)}
        onConfirm={() => {
          if (!statusDialog) return;
          statusMutation.mutate({
            id: statusDialog.pkg.id,
            status: statusDialog.targetStatus,
          });
        }}
        title={
          statusDialog?.targetStatus === 'RELEASED'
            ? `Release Firmware ${statusDialog.pkg.version}?`
            : `Withdraw Firmware ${statusDialog?.pkg.version ?? ''}?`
        }
        message={
          statusDialog?.targetStatus === 'RELEASED'
            ? `Releasing ${statusDialog.pkg.version} makes it visible to client organizations using ${statusDialog.pkg.modelName ?? statusDialog.pkg.modelId} and eligible for OTA rollouts.`
            : 'Withdrawing prevents this package from being selected in new rollouts. This transition is permanent.'
        }
        confirmLabel={
          statusDialog?.targetStatus === 'RELEASED' ? 'Release Firmware' : 'Withdraw Package'
        }
        variant={statusDialog?.targetStatus === 'WITHDRAWN' ? 'danger' : 'primary'}
        loading={statusMutation.isPending}
      />
    </div>
  );
}
