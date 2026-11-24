import fs from 'node:fs';
import path from 'node:path';
import type { FirmwarePackagePublic, FirmwareStatus } from '../../../shared/types.ts';
import { config } from '../config.ts';
import type { Repositories } from '../repositories/index.ts';
import { toFirmwarePublic, type FirmwareRecord, type TenantContext } from '../repositories/types.ts';
import { Errors } from '../utils/errors.ts';
import { generateId } from '../utils/ids.ts';
import type { AuditService } from './auditService.ts';
import {
  computeSha256Hex,
  isValidSemver,
  MAX_FIRMWARE_BYTES,
  resolveSafeFirmwarePath,
  validateFirmwareStatusTransition,
  verifySha256Checksum,
} from './otaAndConfigLogic.ts';

export class FirmwareService {
  constructor(
    private readonly repos: Repositories,
    private readonly audit: AuditService,
    private readonly storageDir: string = config.firmwareStorageDir,
  ) {}

  getStorageDir(): string {
    return path.resolve(this.storageDir);
  }

  /**
   * Lists firmware packages (Section 8.7 #1):
   * - PA and SE see all packages across all statuses.
   * - CA and CM see ONLY RELEASED packages for device models present in their tenant.
   */
  list(
    ctx: TenantContext,
    filter: { q?: string; modelId?: string; status?: FirmwareStatus; page: number; pageSize: number },
  ): { items: FirmwarePackagePublic[]; total: number } {
    const isClientRole = ctx.role === 'CLIENT_ADMIN' || ctx.role === 'CLIENT_MANAGER';
    let allowedModelIds: string[] | null = null;

    if (isClientRole) {
      const tenantId = ctx.activeTenantId ?? ctx.tenantIds[0];
      if (!tenantId) {
        return { items: [], total: 0 };
      }
      allowedModelIds = this.repos.devices.listDistinctModelIdsInTenantSystem(tenantId);
    }

    return this.repos.firmware.list({
      q: filter.q,
      modelId: filter.modelId,
      status: isClientRole ? 'RELEASED' : filter.status,
      onlyReleased: isClientRole,
      allowedModelIds,
      page: filter.page,
      pageSize: filter.pageSize,
    });
  }

  getById(ctx: TenantContext, id: string): FirmwarePackagePublic {
    const record = this.repos.firmware.findById(id);
    if (!record) {
      throw Errors.notFound('Firmware package not found');
    }
    const isClientRole = ctx.role === 'CLIENT_ADMIN' || ctx.role === 'CLIENT_MANAGER';
    if (isClientRole) {
      const tenantId = ctx.activeTenantId ?? ctx.tenantIds[0];
      const modelIds = tenantId
        ? this.repos.devices.listDistinctModelIdsInTenantSystem(tenantId)
        : [];
      if (record.status !== 'RELEASED' || !modelIds.includes(record.modelId)) {
        throw Errors.notFound('Firmware package not found');
      }
    }
    return toFirmwarePublic(record);
  }

  /**
   * Uploads a firmware binary (PA and SE only, Section 8.7 #2):
   * - Max 5 MB
   * - Validates semver and unique (modelId, version)
   * - Computes SHA-256 on server; rejects with 400 if uploader-supplied checksum mismatches
   * - Stores binary in strictly confined `./data/firmware/<id>.bin`
   * - Starts in DRAFT status
   */
  upload(
    ctx: TenantContext,
    input: {
      modelId: string;
      version: string;
      releaseNotes?: string;
      expectedChecksumSha256?: string;
      fileBuffer: Buffer;
    },
    ip: string,
  ): FirmwarePackagePublic {
    const model = this.repos.deviceModels.findById(input.modelId.trim());
    if (!model) {
      throw Errors.validation('Selected device model does not exist', { field: 'modelId' });
    }

    const version = input.version.trim();
    if (!isValidSemver(version)) {
      throw Errors.validation('Version must follow semantic versioning (e.g. 1.2.0)', {
        field: 'version',
      });
    }

    if (!input.fileBuffer || input.fileBuffer.length === 0) {
      throw Errors.validation('Firmware binary file is required and cannot be empty', {
        field: 'file',
      });
    }

    if (input.fileBuffer.length > MAX_FIRMWARE_BYTES) {
      throw Errors.validation('Firmware binary exceeds the maximum 5 MB file size limit', {
        field: 'file',
      });
    }

    const existing = this.repos.firmware.findByModelAndVersion(model.id, version);
    if (existing) {
      throw Errors.conflict(
        `Firmware version ${version} already exists for model ${model.name}`,
        { field: 'version' },
      );
    }

    const computedSha256 = computeSha256Hex(input.fileBuffer);
    if (input.expectedChecksumSha256 && input.expectedChecksumSha256.trim().length > 0) {
      if (!verifySha256Checksum(input.expectedChecksumSha256, computedSha256)) {
        throw Errors.validation(
          `SHA-256 checksum mismatch: uploaded file hashes to ${computedSha256}`,
          { field: 'checksumSha256', computedSha256 },
        );
      }
    }

    const id = generateId('fwp');
    const fileRef = `${id}.bin`;
    const baseDir = this.getStorageDir();
    fs.mkdirSync(baseDir, { recursive: true });
    const fullPath = resolveSafeFirmwarePath(baseDir, fileRef);
    fs.writeFileSync(fullPath, input.fileBuffer);

    const created = this.repos.firmware.create({
      id,
      modelId: model.id,
      version,
      releaseNotes: (input.releaseNotes ?? '').trim(),
      checksumSha256: computedSha256,
      sizeBytes: input.fileBuffer.length,
      fileRef,
      status: 'DRAFT',
      uploadedBy: ctx.userId,
    });

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: null,
      action: 'FIRMWARE_UPLOADED',
      targetType: 'FIRMWARE',
      targetId: created.id,
      outcome: 'SUCCESS',
      ip,
      details: {
        modelId: created.modelId,
        modelName: model.name,
        version: created.version,
        sizeBytes: created.sizeBytes,
        checksumSha256: created.checksumSha256,
      },
    });

    return toFirmwarePublic(created);
  }

  changeStatus(
    ctx: TenantContext,
    id: string,
    targetStatus: FirmwareStatus,
    ip: string,
  ): FirmwarePackagePublic {
    const existing = this.repos.firmware.findById(id);
    if (!existing) {
      throw Errors.notFound('Firmware package not found');
    }

    const check = validateFirmwareStatusTransition(existing.status, targetStatus);
    if (!check.ok) {
      throw Errors.invalidTransition(check.error ?? 'Invalid firmware status transition', {
        from: existing.status,
        to: targetStatus,
      });
    }

    const updated = this.repos.firmware.updateStatus(id, targetStatus);
    if (!updated) {
      throw Errors.notFound('Firmware package not found');
    }

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: null,
      action: targetStatus === 'RELEASED' ? 'FIRMWARE_RELEASED' : 'FIRMWARE_WITHDRAWN',
      targetType: 'FIRMWARE',
      targetId: updated.id,
      outcome: 'SUCCESS',
      ip,
      details: {
        modelId: updated.modelId,
        version: updated.version,
        from: existing.status,
        to: updated.status,
      },
    });

    return toFirmwarePublic(updated);
  }

  /**
   * Reads a firmware binary from confined local storage and verifies integrity before serving
   * to an authenticated device (Section 6 & NFR-06).
   */
  readBinaryForDevice(firmwareId: string): { record: FirmwareRecord; buffer: Buffer } {
    const record = this.repos.firmware.findById(firmwareId);
    if (!record) {
      throw Errors.notFound('Firmware package not found');
    }

    const fullPath = resolveSafeFirmwarePath(this.getStorageDir(), record.fileRef);
    if (!fs.existsSync(fullPath)) {
      throw Errors.notFound('Firmware binary artifact missing from storage');
    }

    const buffer = fs.readFileSync(fullPath);
    const actualSha = computeSha256Hex(buffer);
    if (!verifySha256Checksum(record.checksumSha256, actualSha)) {
      throw Errors.internal('Firmware binary integrity verification failed on server');
    }

    return { record, buffer };
  }
}
