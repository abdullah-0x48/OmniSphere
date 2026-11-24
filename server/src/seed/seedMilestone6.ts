import fs from 'node:fs';
import path from 'node:path';
import type { FirmwareStatus, RoleCode } from '../../../shared/types.ts';
import { config } from '../config.ts';
import type { Repositories } from '../repositories/index.ts';
import type { TenantContext } from '../repositories/types.ts';
import { AuditService } from '../services/auditService.ts';
import { computeSha256Hex, resolveSafeFirmwarePath } from '../services/otaAndConfigLogic.ts';

const SYSTEM_PA_CTX: TenantContext = {
  userId: 'SYSTEM',
  role: 'PLATFORM_ADMIN',
  allTenants: true,
  tenantIds: [],
  activeTenantId: null,
};

interface SeedFirmwareSpec {
  id: string;
  modelId: string;
  version: string;
  status: FirmwareStatus;
  releaseNotes: string;
  ageDays: number;
}

const DEMO_FIRMWARE: SeedFirmwareSpec[] = [
  // TH-200 Temperature & Humidity Sensor
  {
    id: 'fwp_th200_1_0_0',
    modelId: 'mdl_th200',
    version: '1.0.0',
    status: 'RELEASED',
    releaseNotes: 'Initial factory RTOS release for TH-200 Rev 2.1.',
    ageDays: 45,
  },
  {
    id: 'fwp_th200_1_1_0',
    modelId: 'mdl_th200',
    version: '1.1.0',
    status: 'RELEASED',
    releaseNotes: 'Improved humidity compensation curve and reduced deep-sleep drift by 18%.',
    ageDays: 14,
  },
  {
    id: 'fwp_th200_1_2_0',
    modelId: 'mdl_th200',
    version: '1.2.0',
    status: 'DRAFT',
    releaseNotes: 'Candidate build adding TLS session resumption and faster OTA verification.',
    ageDays: 2,
  },
  // VM-310 Vibration Monitor
  {
    id: 'fwp_vm310_1_0_0',
    modelId: 'mdl_vm310',
    version: '1.0.0',
    status: 'RELEASED',
    releaseNotes: 'Baseline FFT vibration RMS pipeline for VM-310 Rev 3.0.',
    ageDays: 42,
  },
  {
    id: 'fwp_vm310_1_1_0',
    modelId: 'mdl_vm310',
    version: '1.1.0',
    status: 'RELEASED',
    releaseNotes: 'Added bearing harmonic filter and hardened watchdog boot recovery.',
    ageDays: 12,
  },
  {
    id: 'fwp_vm310_1_2_0',
    modelId: 'mdl_vm310',
    version: '1.2.0',
    status: 'DRAFT',
    releaseNotes: 'QA staging build with dual-axis sampling calibration.',
    ageDays: 1,
  },
  // EM-120 Energy Meter
  {
    id: 'fwp_em120_1_0_0',
    modelId: 'mdl_em120',
    version: '1.0.0',
    status: 'RELEASED',
    releaseNotes: 'Initial certified 3-phase metering firmware for EM-120 Rev 1.4.',
    ageDays: 40,
  },
  {
    id: 'fwp_em120_1_1_0',
    modelId: 'mdl_em120',
    version: '1.1.0',
    status: 'RELEASED',
    releaseNotes: 'Added power-factor stability smoothing and Modbus register diagnostics.',
    ageDays: 10,
  },
  {
    id: 'fwp_em120_1_2_0',
    modelId: 'mdl_em120',
    version: '1.2.0',
    status: 'DRAFT',
    releaseNotes: 'Pre-release harmonic distortion telemetry extension.',
    ageDays: 1,
  },
];

function buildDeterministicFirmwareBuffer(spec: SeedFirmwareSpec): Buffer {
  const header = `OMNISPHERE-FW-IMG|model=${spec.modelId}|version=${spec.version}|status=${spec.status}\n`;
  const bodyChunk = `payload:${spec.id}:${spec.releaseNotes}\n`;
  // Produce a realistic ~24 KB deterministic binary artifact
  const parts = [Buffer.from(header, 'utf8')];
  for (let i = 0; i < 240; i += 1) {
    parts.push(Buffer.from(`${String(i).padStart(4, '0')}:${bodyChunk}`, 'utf8'));
  }
  return Buffer.concat(parts);
}

interface SeedProfileTemplate {
  suffix: string;
  label: string;
  payloadForModel: (modelId: string) => Record<string, unknown>;
}

const PROFILE_TEMPLATES: SeedProfileTemplate[] = [
  {
    suffix: 'std30',
    label: 'Standard 30 s',
    payloadForModel: (modelId) => {
      if (modelId === 'mdl_th200') {
        return {
          reportingIntervalSec: 30,
          heartbeatIntervalSec: 30,
          temperatureUnit: 'C',
          humidityCompensation: true,
          powerMode: 'balanced',
        };
      }
      if (modelId === 'mdl_vm310') {
        return {
          reportingIntervalSec: 30,
          heartbeatIntervalSec: 30,
          fftWindowSamples: 1024,
          lowPassFilterHz: 500,
          powerMode: 'balanced',
        };
      }
      return {
        reportingIntervalSec: 30,
        heartbeatIntervalSec: 30,
        meteringPhaseMode: '3-phase-wye',
        demandWindowMin: 15,
        powerMode: 'continuous',
      };
    },
  },
  {
    suffix: 'fast10',
    label: 'Fast 10 s',
    payloadForModel: (modelId) => {
      if (modelId === 'mdl_th200') {
        return {
          reportingIntervalSec: 10,
          heartbeatIntervalSec: 15,
          temperatureUnit: 'C',
          humidityCompensation: true,
          powerMode: 'high_frequency',
        };
      }
      if (modelId === 'mdl_vm310') {
        return {
          reportingIntervalSec: 10,
          heartbeatIntervalSec: 15,
          fftWindowSamples: 2048,
          lowPassFilterHz: 1000,
          powerMode: 'high_frequency',
        };
      }
      return {
        reportingIntervalSec: 10,
        heartbeatIntervalSec: 15,
        meteringPhaseMode: '3-phase-wye',
        demandWindowMin: 5,
        powerMode: 'continuous',
      };
    },
  },
];

export function seedMilestone6Data(
  repos: Repositories,
  options: { actorId?: string; actorRole?: RoleCode | 'SYSTEM'; ip?: string } = {},
): { firmwareCreated: number; configProfilesCreated: number; rolloutsCreated: number } {
  const audit = new AuditService(repos.audit);
  const actorId = options.actorId ?? 'SYSTEM';
  const actorRole = options.actorRole ?? 'SYSTEM';
  const ip = options.ip ?? '127.0.0.1';
  const nowMs = Date.now();

  let firmwareCreated = 0;
  let configProfilesCreated = 0;
  let rolloutsCreated = 0;

  const storageDir = path.resolve(config.firmwareStorageDir);
  fs.mkdirSync(storageDir, { recursive: true });

  // 1. Seed 9 firmware packages (3 models x 1.0.0 RELEASED, 1.1.0 RELEASED, 1.2.0 DRAFT)
  for (const spec of DEMO_FIRMWARE) {
    const model = repos.deviceModels.findById(spec.modelId);
    if (!model) continue;

    const buffer = buildDeterministicFirmwareBuffer(spec);
    const sha256 = computeSha256Hex(buffer);
    const fileRef = `${spec.id}.bin`;
    const filePath = resolveSafeFirmwarePath(storageDir, fileRef);

    // Ensure the actual binary file always exists on disk
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, buffer);
    }

    const existing =
      repos.firmware.findById(spec.id) ??
      repos.firmware.findByModelAndVersion(spec.modelId, spec.version);

    if (!existing) {
      const createdAt = new Date(nowMs - spec.ageDays * 86400_000).toISOString();
      repos.firmware.create({
        id: spec.id,
        modelId: spec.modelId,
        version: spec.version,
        releaseNotes: spec.releaseNotes,
        checksumSha256: sha256,
        sizeBytes: buffer.length,
        fileRef,
        status: spec.status,
        uploadedBy: 'usr_pa_admin',
        createdAt,
      });
      firmwareCreated += 1;

      audit.record({
        actorId,
        actorRole,
        tenantId: null,
        action: 'FIRMWARE_UPLOADED',
        targetType: 'FIRMWARE',
        targetId: spec.id,
        outcome: 'SUCCESS',
        ip,
        details: {
          modelId: spec.modelId,
          version: spec.version,
          status: spec.status,
          checksumSha256: sha256,
          sizeBytes: buffer.length,
          seeded: true,
        },
      });
    }
  }

  // 2. Seed 2 config profiles per model per tenant & assign to ACTIVE devices
  const tenantDefs = [
    { tenantId: 'ten_ktl', code: 'ktl', adminId: 'usr_ktl_ca', managerId: 'usr_ktl_cm' },
    { tenantId: 'ten_mfp', code: 'mfp', adminId: 'usr_mfp_ca', managerId: 'usr_mfp_cm' },
    { tenantId: 'ten_scw', code: 'scw', adminId: 'usr_scw_ca', managerId: 'usr_scw_cm' },
  ];

  const modelShorts = [
    { modelId: 'mdl_th200', short: 'TH-200', slug: 'th200' },
    { modelId: 'mdl_vm310', short: 'VM-310', slug: 'vm310' },
    { modelId: 'mdl_em120', short: 'EM-120', slug: 'em120' },
  ];

  for (const t of tenantDefs) {
    if (!repos.tenants.findByIdSystem(t.tenantId)) continue;

    const tenantCtx: TenantContext = {
      userId: t.adminId,
      role: 'CLIENT_ADMIN',
      allTenants: false,
      tenantIds: [t.tenantId],
      activeTenantId: t.tenantId,
    };

    const profileIdsByModel = new Map<string, { stdId: string; fastId: string }>();

    for (const m of modelShorts) {
      if (!repos.deviceModels.findById(m.modelId)) continue;
      let stdId = '';
      let fastId = '';

      for (const tpl of PROFILE_TEMPLATES) {
        const id = `cfg_${t.code}_${m.slug}_${tpl.suffix}`;
        const name = `${m.short} ${tpl.label}`;
        if (tpl.suffix === 'std30') stdId = id;
        else fastId = id;

        const existing = repos.configProfiles.findById(SYSTEM_PA_CTX, id);
        if (!existing) {
          const createdAt = new Date(nowMs - 20 * 86400_000).toISOString();
          repos.configProfiles.create(tenantCtx, {
            id,
            tenantId: t.tenantId,
            modelId: m.modelId,
            name,
            payload: tpl.payloadForModel(m.modelId),
            createdBy: t.adminId,
            versionId: `cfv_${t.code}_${m.slug}_${tpl.suffix}_v1`,
            createdAt,
          });
          configProfilesCreated += 1;

          audit.record({
            actorId,
            actorRole,
            tenantId: t.tenantId,
            action: 'CONFIG_PROFILE_CREATED',
            targetType: 'CONFIG_PROFILE',
            targetId: id,
            outcome: 'SUCCESS',
            ip,
            details: { name, modelId: m.modelId, version: 1, seeded: true },
          });
        }
      }
      profileIdsByModel.set(m.modelId, { stdId, fastId });
    }

    // Assign seeded config profiles to ACTIVE/SUSPENDED/UNDER_MAINTENANCE devices that don't yet have a profileId
    const devices = repos.devices.listAllInScope(tenantCtx, false);
    for (const dev of devices) {
      if (dev.state === 'PROVISIONED' || dev.config.profileId) continue;
      const pair = profileIdsByModel.get(dev.modelId);
      if (!pair) continue;
      const assignedProfileId = dev.tags.includes('critical') ? pair.fastId : pair.stdId;
      repos.devices.assignConfigSystem(dev.id, {
        profileId: assignedProfileId,
        version: 1,
        status: 'APPLIED',
        error: null,
      });
    }

    // 3. Seed 1 completed rollout per tenant (Section 15: all jobs VERIFIED)
    // Pick the devices in this tenant that already run 1.1.0 for TH-200 / VM-310 / EM-120
    const rolloutId = `rol_${t.code}_init_110`;
    const existingRollout = repos.rollouts.findByIdSystem(rolloutId);
    if (!existingRollout) {
      const targetDevice =
        devices.find((d) => d.modelId === 'mdl_th200' && d.firmwareVersion === '1.1.0') ??
        devices.find((d) => d.modelId === 'mdl_th200' && d.state === 'ACTIVE');

      if (targetDevice) {
        const completedAt = new Date(nowMs - 8 * 86400_000).toISOString();
        const isKtl = t.tenantId === 'ten_ktl';
        repos.rollouts.createWithJobs(
          tenantCtx,
          {
            id: rolloutId,
            tenantId: t.tenantId,
            firmwareId: 'fwp_th200_1_1_0',
            modelId: 'mdl_th200',
            targetType: 'DEVICE',
            targetValue: targetDevice.id,
            scheduledAt: null,
            status: 'COMPLETED',
            createdBy: t.adminId,
            decidedBy: isKtl ? t.managerId : null,
            decisionReason: isKtl ? 'Approved after off-peak pilot check' : null,
            counts: { total: 1, verified: 1, failed: 0, cancelled: 0 },
            createdAt: completedAt,
          },
          [
            {
              id: `rjb_${t.code}_init_110_1`,
              tenantId: t.tenantId,
              rolloutId,
              deviceId: targetDevice.id,
              fromVersion: '1.0.0',
              toVersion: '1.1.0',
              status: 'VERIFIED',
              createdAt: completedAt,
            },
          ],
        );
        rolloutsCreated += 1;

        audit.record({
          actorId,
          actorRole,
          tenantId: t.tenantId,
          action: 'ROLLOUT_COMPLETED',
          targetType: 'ROLLOUT',
          targetId: rolloutId,
          outcome: 'SUCCESS',
          ip,
          details: {
            firmwareId: 'fwp_th200_1_1_0',
            firmwareVersion: '1.1.0',
            verified: 1,
            total: 1,
            seeded: true,
          },
        });
      }
    }
  }

  return { firmwareCreated, configProfilesCreated, rolloutsCreated };
}
