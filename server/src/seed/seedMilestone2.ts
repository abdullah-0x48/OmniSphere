import type {
  DeviceConnectivity,
  DeviceLifecycleState,
  MetricDefinition,
  RoleCode,
} from '../../../shared/types.ts';
import type { Repositories } from '../repositories/index.ts';
import type { TenantContext } from '../repositories/types.ts';
import { AuditService } from '../services/auditService.ts';
import { generateDeviceApiKey } from '../services/deviceLifecycle.ts';
import { generateId } from '../utils/ids.ts';
import { seedMilestone1Data } from './seedData.ts';

const SYSTEM_PA_CTX: TenantContext = {
  userId: 'SYSTEM',
  role: 'PLATFORM_ADMIN',
  allTenants: true,
  tenantIds: [],
  activeTenantId: null,
};

interface SeedSiteDef {
  id: string;
  tenantId: string;
  shortCode: string;
  name: string;
  location: string;
}

const DEMO_SITES: SeedSiteDef[] = [
  {
    id: 'sit_ktl_dye',
    tenantId: 'ten_ktl',
    shortCode: 'DYE',
    name: 'Dyeing Plant',
    location: 'Chattogram Industrial Zone, Block A',
  },
  {
    id: 'sit_ktl_pck',
    tenantId: 'ten_ktl',
    shortCode: 'PCK',
    name: 'Packing Line',
    location: 'Chattogram Industrial Zone, Block B',
  },
  {
    id: 'sit_mfp_cld',
    tenantId: 'ten_mfp',
    shortCode: 'CLD',
    name: 'Cold Storage',
    location: 'Narayanganj Processing Park, Hall 1',
  },
  {
    id: 'sit_mfp_bot',
    tenantId: 'ten_mfp',
    shortCode: 'BOT',
    name: 'Bottling Line',
    location: 'Narayanganj Processing Park, Hall 2',
  },
  {
    id: 'sit_scw_kln',
    tenantId: 'ten_scw',
    shortCode: 'KLN',
    name: 'Kiln Unit 1',
    location: 'Mongla Cement Plant, North Sector',
  },
  {
    id: 'sit_scw_grn',
    tenantId: 'ten_scw',
    shortCode: 'GRN',
    name: 'Grinding Mill',
    location: 'Mongla Cement Plant, West Sector',
  },
];

interface SeedModelDef {
  id: string;
  shortCode: string;
  name: string;
  manufacturer: string;
  hardwareRevision: string;
  supportedFirmwareFamily: string;
  metrics: MetricDefinition[];
}

const DEMO_MODELS: SeedModelDef[] = [
  {
    id: 'mdl_th200',
    shortCode: 'TH',
    name: 'TH-200 Temperature and Humidity Sensor',
    manufacturer: 'Sensirion Industrial',
    hardwareRevision: 'Rev 2.1',
    supportedFirmwareFamily: 'th200-rtos',
    metrics: [
      { key: 'temperature', label: 'Temperature', type: 'number', unit: '°C', min: 0, max: 120 },
      { key: 'humidity', label: 'Humidity', type: 'number', unit: '%', min: 0, max: 100 },
    ],
  },
  {
    id: 'mdl_vm310',
    shortCode: 'VM',
    name: 'VM-310 Vibration Monitor',
    manufacturer: 'Bosch Industrial IoT',
    hardwareRevision: 'Rev 3.0',
    supportedFirmwareFamily: 'vm310-edge',
    metrics: [
      {
        key: 'vibration_rms',
        label: 'Vibration RMS',
        type: 'number',
        unit: 'mm/s',
        min: 0,
        max: 50,
      },
      { key: 'temperature', label: 'Temperature', type: 'number', unit: '°C', min: 0, max: 150 },
    ],
  },
  {
    id: 'mdl_em120',
    shortCode: 'EM',
    name: 'EM-120 Energy Meter',
    manufacturer: 'Schneider GridEdge',
    hardwareRevision: 'Rev 1.4',
    supportedFirmwareFamily: 'em120-fw',
    metrics: [
      { key: 'voltage', label: 'Voltage', type: 'number', unit: 'V', min: 0, max: 500 },
      { key: 'current', label: 'Current', type: 'number', unit: 'A', min: 0, max: 200 },
      { key: 'power_kw', label: 'Power', type: 'number', unit: 'kW', min: 0, max: 150 },
      { key: 'energy_kwh', label: 'Energy', type: 'number', unit: 'kWh', min: 0, max: 100000 },
    ],
  },
];

// 12 devices per tenant (Section 15): 8 ACTIVE, 1 PROVISIONED, 1 SUSPENDED, 1 UNDER_MAINTENANCE, 1 DECOMMISSIONED
interface DeviceSlotSpec {
  index: number;
  siteIdx: 0 | 1;
  modelIdx: 0 | 1 | 2;
  state: DeviceLifecycleState;
  connectivity: DeviceConnectivity;
  firmwareVersion: string | null;
  tags: string[];
}

const TENANT_DEVICE_SLOTS: DeviceSlotSpec[] = [
  { index: 1, siteIdx: 0, modelIdx: 0, state: 'ACTIVE', connectivity: 'ONLINE', firmwareVersion: '1.0.0', tags: ['critical', 'line-1'] },
  { index: 2, siteIdx: 0, modelIdx: 1, state: 'ACTIVE', connectivity: 'ONLINE', firmwareVersion: '1.0.0', tags: ['critical', 'line-1'] },
  { index: 3, siteIdx: 0, modelIdx: 2, state: 'ACTIVE', connectivity: 'ONLINE', firmwareVersion: '1.1.0', tags: ['line-1'] },
  { index: 4, siteIdx: 0, modelIdx: 0, state: 'ACTIVE', connectivity: 'ONLINE', firmwareVersion: '1.0.0', tags: ['outdoor'] },
  { index: 5, siteIdx: 1, modelIdx: 0, state: 'ACTIVE', connectivity: 'ONLINE', firmwareVersion: '1.1.0', tags: ['line-2'] },
  { index: 6, siteIdx: 1, modelIdx: 1, state: 'ACTIVE', connectivity: 'ONLINE', firmwareVersion: '1.0.0', tags: ['critical', 'line-2'] },
  { index: 7, siteIdx: 1, modelIdx: 2, state: 'ACTIVE', connectivity: 'OFFLINE', firmwareVersion: '1.0.0', tags: ['line-2'] },
  { index: 8, siteIdx: 1, modelIdx: 1, state: 'ACTIVE', connectivity: 'ONLINE', firmwareVersion: '1.1.0', tags: ['outdoor'] },
  { index: 9, siteIdx: 0, modelIdx: 0, state: 'PROVISIONED', connectivity: 'UNKNOWN', firmwareVersion: null, tags: ['line-1'] },
  { index: 10, siteIdx: 0, modelIdx: 2, state: 'SUSPENDED', connectivity: 'OFFLINE', firmwareVersion: '1.0.0', tags: ['outdoor'] },
  { index: 11, siteIdx: 1, modelIdx: 1, state: 'UNDER_MAINTENANCE', connectivity: 'OFFLINE', firmwareVersion: '1.0.0', tags: ['critical'] },
  { index: 12, siteIdx: 1, modelIdx: 0, state: 'DECOMMISSIONED', connectivity: 'OFFLINE', firmwareVersion: '1.0.0', tags: ['legacy'] },
];

function sampleMetricsForModel(modelId: string, seedOffset: number): Record<string, number> {
  if (modelId === 'mdl_th200') {
    return {
      temperature: Number((26.5 + (seedOffset % 9) * 1.4).toFixed(1)),
      humidity: Number((52 + (seedOffset % 7) * 3.1).toFixed(1)),
    };
  }
  if (modelId === 'mdl_vm310') {
    return {
      vibration_rms: Number((3.4 + (seedOffset % 6) * 0.85).toFixed(2)),
      temperature: Number((44.2 + (seedOffset % 8) * 2.1).toFixed(1)),
    };
  }
  return {
    voltage: Number((228.5 + (seedOffset % 5) * 1.6).toFixed(1)),
    current: Number((41.2 + (seedOffset % 7) * 4.3).toFixed(1)),
    power_kw: Number((18.4 + (seedOffset % 6) * 3.2).toFixed(1)),
    energy_kwh: Number((14200 + seedOffset * 385).toFixed(0)),
  };
}

function sampleHealth(modelId: string, seedOffset: number) {
  return {
    cpuLoad: Number((24 + (seedOffset % 15) * 2.3).toFixed(1)),
    memoryUsage: Number((41 + (seedOffset % 11) * 2.1).toFixed(1)),
    batteryLevel: modelId === 'mdl_em120' ? null : Number((72 + (seedOffset % 6) * 4).toFixed(0)),
    signalStrength: -58 - (seedOffset % 18),
    uptimeSec: 86400 * (3 + (seedOffset % 14)) + seedOffset * 137,
  };
}

export async function seedMilestone2Data(
  repos: Repositories,
  options: { actorId?: string; actorRole?: RoleCode | 'SYSTEM'; ip?: string } = {},
): Promise<{ sitesCreated: number; modelsCreated: number; devicesCreated: number }> {
  const audit = new AuditService(repos.audit);
  const actorId = options.actorId ?? 'SYSTEM';
  const actorRole = options.actorRole ?? 'SYSTEM';
  const ip = options.ip ?? '127.0.0.1';

  let sitesCreated = 0;
  let modelsCreated = 0;
  let devicesCreated = 0;

  // 1. Seed global device models
  for (const m of DEMO_MODELS) {
    const existing = repos.deviceModels.findById(m.id) ?? repos.deviceModels.findByName(m.name);
    if (!existing) {
      repos.deviceModels.create({
        id: m.id,
        name: m.name,
        manufacturer: m.manufacturer,
        hardwareRevision: m.hardwareRevision,
        supportedFirmwareFamily: m.supportedFirmwareFamily,
        metrics: m.metrics,
      });
      modelsCreated += 1;
      audit.record({
        actorId,
        actorRole,
        tenantId: null,
        action: 'DEVICE_MODEL_CREATED',
        targetType: 'DEVICE_MODEL',
        targetId: m.id,
        outcome: 'SUCCESS',
        ip,
        details: { name: m.name, manufacturer: m.manufacturer, seeded: true },
      });
    }
  }

  // 2. Seed sites per tenant
  for (const s of DEMO_SITES) {
    const tenant = repos.tenants.findByIdSystem(s.tenantId);
    if (!tenant) continue;
    const existing =
      repos.sites.findById(SYSTEM_PA_CTX, s.id) ??
      repos.sites.findByNameInTenant(SYSTEM_PA_CTX, s.tenantId, s.name);
    if (!existing) {
      repos.sites.create(SYSTEM_PA_CTX, {
        id: s.id,
        tenantId: s.tenantId,
        name: s.name,
        location: s.location,
      });
      sitesCreated += 1;
      audit.record({
        actorId,
        actorRole,
        tenantId: s.tenantId,
        action: 'SITE_CREATED',
        targetType: 'SITE',
        targetId: s.id,
        outcome: 'SUCCESS',
        ip,
        details: { name: s.name, location: s.location, seeded: true },
      });
    }
  }

  // 3. Seed 12 devices per demo tenant (36 total)
  const tenantConfigs = [
    { tenantId: 'ten_ktl', code: 'KTL', macPrefix: '00:1A:2B', sites: DEMO_SITES.slice(0, 2) },
    { tenantId: 'ten_mfp', code: 'MFP', macPrefix: '00:1C:3D', sites: DEMO_SITES.slice(2, 4) },
    { tenantId: 'ten_scw', code: 'SCW', macPrefix: '00:1E:4F', sites: DEMO_SITES.slice(4, 6) },
  ];

  const nowMs = Date.now();

  for (let tIdx = 0; tIdx < tenantConfigs.length; tIdx += 1) {
    const tc = tenantConfigs[tIdx];
    if (!repos.tenants.findByIdSystem(tc.tenantId)) continue;

    for (const slot of TENANT_DEVICE_SLOTS) {
      const site = tc.sites[slot.siteIdx];
      const model = DEMO_MODELS[slot.modelIdx];
      const padded = String(slot.index).padStart(3, '0');
      const deviceId = `dev_${tc.code.toLowerCase()}_${padded}`;
      const name = `${tc.code}-${site.shortCode}-${model.shortCode}-${padded}`;
      const serialNumber = `SN-${tc.code}-${model.shortCode}-2026${padded}`;
      const hardwareId = `${tc.macPrefix}:10:${String(slot.index).padStart(2, '0')}:A${tIdx + 1}`;

      if (
        repos.devices.findById(SYSTEM_PA_CTX, deviceId) ||
        repos.devices.findBySerialSystem(serialNumber)
      ) {
        continue;
      }

      const seedOffset = tIdx * 12 + slot.index;
      const isDecommissioned = slot.state === 'DECOMMISSIONED';
      const generated = isDecommissioned ? null : generateDeviceApiKey();
      const createdAtIso = new Date(nowMs - (30 - slot.index) * 86400_000).toISOString();
      const lastSeenAt =
        slot.connectivity === 'ONLINE'
          ? new Date(nowMs - (slot.index * 5 + 8) * 1000).toISOString()
          : slot.connectivity === 'OFFLINE'
            ? new Date(nowMs - (slot.index * 45 + 120) * 60_000).toISOString()
            : null;

      repos.devices.createWithUniqueKeys(
        SYSTEM_PA_CTX,
        {
          id: deviceId,
          tenantId: tc.tenantId,
          siteId: site.id,
          modelId: model.id,
          name,
          serialNumber,
          hardwareId,
          tags: slot.tags,
          state: 'PROVISIONED',
          connectivity: slot.connectivity,
          lastSeenAt,
          firmwareVersion: slot.firmwareVersion,
          apiKeyHash: generated?.apiKeyHash ?? null,
          apiKeyLast4: generated?.apiKeyLast4 ?? null,
          config:
            slot.state === 'PROVISIONED'
              ? { profileId: null, version: null, status: 'NONE', error: null }
              : { profileId: null, version: 1, status: 'APPLIED', error: null },
          latestMetrics:
            slot.state === 'PROVISIONED' ? {} : sampleMetricsForModel(model.id, seedOffset),
          latestHealth: slot.state === 'PROVISIONED' ? {} : sampleHealth(model.id, seedOffset),
        },
        {
          id: generateId('dsh'),
          tenantId: tc.tenantId,
          deviceId,
          from: null,
          to: 'PROVISIONED',
          reason: 'Initial fleet registration',
          actorId,
          at: createdAtIso,
        },
      );

      // Replay realistic lifecycle progression so Timeline reflects real state history
      if (slot.state !== 'PROVISIONED') {
        const activatedAt = new Date(nowMs - (28 - slot.index) * 86400_000).toISOString();
        repos.devices.transitionState(
          SYSTEM_PA_CTX,
          deviceId,
          { state: 'ACTIVE' },
          {
            id: generateId('dsh'),
            tenantId: tc.tenantId,
            deviceId,
            from: 'PROVISIONED',
            to: 'ACTIVE',
            reason: 'First authenticated device handshake',
            actorId: 'SYSTEM',
            at: activatedAt,
          },
        );

        repos.devices.insertConnectivityEvent({
          id: generateId('cev'),
          tenantId: tc.tenantId,
          deviceId,
          state: 'ONLINE',
          at: activatedAt,
        });

        if (slot.connectivity === 'OFFLINE' && lastSeenAt) {
          repos.devices.insertConnectivityEvent({
            id: generateId('cev'),
            tenantId: tc.tenantId,
            deviceId,
            state: 'OFFLINE',
            at: lastSeenAt,
          });
        }
      }

      if (slot.state === 'SUSPENDED') {
        repos.devices.transitionState(
          SYSTEM_PA_CTX,
          deviceId,
          { state: 'SUSPENDED' },
          {
            id: generateId('dsh'),
            tenantId: tc.tenantId,
            deviceId,
            from: 'ACTIVE',
            to: 'SUSPENDED',
            reason: 'Temporary line shutdown requested by plant operations',
            actorId: `usr_${tc.code.toLowerCase()}_ca`,
            at: new Date(nowMs - 4 * 86400_000).toISOString(),
          },
        );
      } else if (slot.state === 'UNDER_MAINTENANCE') {
        repos.devices.transitionState(
          SYSTEM_PA_CTX,
          deviceId,
          { state: 'UNDER_MAINTENANCE' },
          {
            id: generateId('dsh'),
            tenantId: tc.tenantId,
            deviceId,
            from: 'ACTIVE',
            to: 'UNDER_MAINTENANCE',
            reason: 'Scheduled sensor calibration window',
            actorId: 'usr_se_noc1',
            at: new Date(nowMs - 12 * 3600_000).toISOString(),
          },
        );
      } else if (slot.state === 'DECOMMISSIONED') {
        const decommAt = new Date(nowMs - 6 * 86400_000).toISOString();
        repos.devices.transitionState(
          SYSTEM_PA_CTX,
          deviceId,
          {
            state: 'DECOMMISSIONED',
            decommissionedAt: decommAt,
            decommissionReason: 'Replaced by upgraded hardware revision',
            revokeKey: true,
          },
          {
            id: generateId('dsh'),
            tenantId: tc.tenantId,
            deviceId,
            from: 'ACTIVE',
            to: 'DECOMMISSIONED',
            reason: 'Replaced by upgraded hardware revision',
            actorId: `usr_${tc.code.toLowerCase()}_ca`,
            at: decommAt,
          },
        );
      }

      // Section 15: store server-only simulator credentials for ACTIVE devices
      if (slot.state === 'ACTIVE' && generated) {
        repos.devices.setSimulatorCredential(deviceId, tc.tenantId, generated.apiKey);
      }

      audit.record({
        actorId,
        actorRole,
        tenantId: tc.tenantId,
        action: 'DEVICE_REGISTERED',
        targetType: 'DEVICE',
        targetId: deviceId,
        outcome: 'SUCCESS',
        ip,
        details: {
          name,
          serialNumber,
          modelId: model.id,
          siteId: site.id,
          state: slot.state,
          seeded: true,
        },
      });

      devicesCreated += 1;
    }
  }

  return { sitesCreated, modelsCreated, devicesCreated };
}

export async function seedAllDemoData(
  repos: Repositories,
  options: { resetExisting?: boolean; actorId?: string; actorRole?: RoleCode | 'SYSTEM'; ip?: string } = {},
) {
  const m1 = await seedMilestone1Data(repos, options);
  const m2 = await seedMilestone2Data(repos, options);
  return { ...m1, ...m2 };
}
