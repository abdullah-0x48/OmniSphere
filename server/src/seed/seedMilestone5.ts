import type { RoleCode } from '../../../shared/types.ts';
import type { Repositories } from '../repositories/index.ts';
import type { TenantContext } from '../repositories/types.ts';
import { AuditService } from '../services/auditService.ts';
import { generateId } from '../utils/ids.ts';

const SYSTEM_PA_CTX: TenantContext = {
  userId: 'SYSTEM',
  role: 'PLATFORM_ADMIN',
  allTenants: true,
  tenantIds: [],
  activeTenantId: null,
};

interface SeedTenantM5Config {
  tenantId: string;
  code: string;
  name: string;
  primarySeId: string;
  primarySiteId: string;
  secondarySiteId: string;
}

const TENANT_M5_CONFIGS: SeedTenantM5Config[] = [
  {
    tenantId: 'ten_ktl',
    code: 'KTL',
    name: 'Karnafuli Textiles Ltd',
    primarySeId: 'usr_se_noc1',
    primarySiteId: 'sit_ktl_dye',
    secondarySiteId: 'sit_ktl_pck',
  },
  {
    tenantId: 'ten_mfp',
    code: 'MFP',
    name: 'Meghna Food Processing',
    primarySeId: 'usr_se_noc1',
    primarySiteId: 'sit_mfp_cld',
    secondarySiteId: 'sit_mfp_bot',
  },
  {
    tenantId: 'ten_scw',
    code: 'SCW',
    name: 'Sundarban Cement Works',
    primarySeId: 'usr_se_noc2',
    primarySiteId: 'sit_scw_kln',
    secondarySiteId: 'sit_scw_grn',
  },
];

/**
 * Seeds Milestone 5 demo data (Section 15):
 * Per tenant:
 * - 3 tickets in different statuses (IN_PROGRESS, WAITING_ON_CLIENT service request, RESOLVED ready to confirm)
 *   Note: leaves the seeded OPEN CRITICAL alert unlinked so SE can test Convert-to-Ticket immediately.
 * - 3 work orders (1 ASSIGNED awaiting CM approval for tomorrow, 1 ASSIGNED for Today to tech1 ready to start,
 *   1 COMPLETED with parts replaced)
 * - 1 recurring preventive maintenance plan (every 30 days)
 */
export function seedMilestone5Data(
  repos: Repositories,
  options: { actorId?: string; actorRole?: RoleCode | 'SYSTEM'; ip?: string } = {},
): { ticketsCreated: number; workOrdersCreated: number; maintenancePlansCreated: number } {
  const audit = new AuditService(repos.audit);
  const ip = options.ip ?? '127.0.0.1';
  const nowMs = Date.now();

  let ticketsCreated = 0;
  let workOrdersCreated = 0;
  let maintenancePlansCreated = 0;

  for (const tc of TENANT_M5_CONFIGS) {
    if (!repos.tenants.findByIdSystem(tc.tenantId)) continue;
    const codeLower = tc.code.toLowerCase();

    const dev2Id = `dev_${codeLower}_002`;
    const dev4Id = `dev_${codeLower}_004`;
    const dev5Id = `dev_${codeLower}_005`;
    const dev6Id = `dev_${codeLower}_006`;
    const co1Id = `usr_${codeLower}_co1`;
    const cmId = `usr_${codeLower}_cm`;

    // 1. Ticket 1: IN_PROGRESS corrective ticket linked to device 002
    const tkt1Id = `tkt_${codeLower}_01`;
    if (!repos.tickets.findByIdSystem(tkt1Id) && repos.devices.findByIdSystem(dev2Id)) {
      const createdAt = new Date(nowMs - 26 * 3600_000).toISOString();
      const created = repos.tickets.createSystem({
        id: tkt1Id,
        tenantId: tc.tenantId,
        deviceId: dev2Id,
        siteId: tc.primarySiteId,
        source: 'INTERNAL',
        alertId: null,
        title: `Elevated vibration trend on ${tc.code} motor monitor`,
        description:
          'Baseline vibration RMS has drifted upward by 28% over the past week. Inspect bearing housing alignment and recalibrate accelerometer mounting.',
        priority: 'HIGH',
        status: 'IN_PROGRESS',
        assigneeId: tc.primarySeId,
        createdBy: tc.primarySeId,
        comments: [
          {
            id: `cmt_${codeLower}_1a`,
            authorId: tc.primarySeId,
            authorRole: 'SUPPORT_ENGINEER',
            authorName: tc.primarySeId === 'usr_se_noc1' ? 'Rafiqul Islam' : 'Nadia Chowdhury',
            body: 'Scheduled corrective maintenance window with downtime approval requested from Client Manager.',
            at: new Date(nowMs - 22 * 3600_000).toISOString(),
          },
        ],
        createdAt,
      });
      ticketsCreated += 1;
      audit.record({
        actorId: tc.primarySeId,
        actorRole: 'SUPPORT_ENGINEER',
        tenantId: tc.tenantId,
        action: 'TICKET_CREATED',
        targetType: 'TICKET',
        targetId: created.id,
        outcome: 'SUCCESS',
        ip,
        details: { number: created.number, source: created.source, seeded: true },
      });
    }

    // 2. Ticket 2: SERVICE_REQUEST in WAITING_ON_CLIENT (client comment auto-resumes to IN_PROGRESS)
    const tkt2Id = `tkt_${codeLower}_02`;
    if (!repos.tickets.findByIdSystem(tkt2Id) && repos.devices.findByIdSystem(dev5Id)) {
      const createdAt = new Date(nowMs - 14 * 3600_000).toISOString();
      const created = repos.tickets.createSystem({
        id: tkt2Id,
        tenantId: tc.tenantId,
        deviceId: dev5Id,
        siteId: tc.secondarySiteId,
        source: 'SERVICE_REQUEST',
        alertId: null,
        title: 'Request recalibration certificate for ambient humidity probe',
        description:
          'QA audit next week requires an updated sensor offset check on the secondary line TH-200 unit.',
        priority: 'MEDIUM',
        status: 'WAITING_ON_CLIENT',
        assigneeId: tc.primarySeId,
        createdBy: co1Id,
        comments: [
          {
            id: `cmt_${codeLower}_2a`,
            authorId: tc.primarySeId,
            authorRole: 'SUPPORT_ENGINEER',
            authorName: tc.primarySeId === 'usr_se_noc1' ? 'Rafiqul Islam' : 'Nadia Chowdhury',
            body: 'Please confirm which shift window is best for a 20-minute non-intrusive probe verification.',
            at: new Date(nowMs - 8 * 3600_000).toISOString(),
          },
        ],
        createdAt,
      });
      ticketsCreated += 1;
      audit.record({
        actorId: co1Id,
        actorRole: 'CLIENT_OPERATOR',
        tenantId: tc.tenantId,
        action: 'TICKET_CREATED',
        targetType: 'TICKET',
        targetId: created.id,
        outcome: 'SUCCESS',
        ip,
        details: { number: created.number, source: created.source, seeded: true },
      });
    }

    // 3. Ticket 3: RESOLVED ticket ready for client confirmation
    const tkt3Id = `tkt_${codeLower}_03`;
    if (!repos.tickets.findByIdSystem(tkt3Id) && repos.devices.findByIdSystem(dev6Id)) {
      const createdAt = new Date(nowMs - 48 * 3600_000).toISOString();
      const resolvedAt = new Date(nowMs - 6 * 3600_000).toISOString();
      const created = repos.tickets.createSystem({
        id: tkt3Id,
        tenantId: tc.tenantId,
        deviceId: dev6Id,
        siteId: tc.secondarySiteId,
        source: 'SERVICE_REQUEST',
        alertId: null,
        title: 'Intermittent sensor housing resonance on Line 2',
        description:
          'Operators noted brief vibration spikes during belt startup. Replaced mounting gasket and re-torqued sensor bracket.',
        priority: 'LOW',
        status: 'RESOLVED',
        assigneeId: tc.primarySeId,
        createdBy: co1Id,
        rootCause: 'Worn mounting gasket allowed bracket micro-play during motor ramp-up.',
        resolutionNotes:
          'Field technician replaced bearing seal kit and mounting gasket; verified telemetry steady below 4.0 mm/s.',
        resolvedAt,
        comments: [
          {
            id: `cmt_${codeLower}_3a`,
            authorId: 'SYSTEM',
            authorRole: 'SYSTEM',
            authorName: 'Maintenance System',
            body: 'Field maintenance completed (FIXED) in 55 min. Replaced bearing seal kit and mounting gasket.',
            at: new Date(nowMs - 18 * 3600_000).toISOString(),
          },
        ],
        createdAt,
      });
      ticketsCreated += 1;
      audit.record({
        actorId: tc.primarySeId,
        actorRole: 'SUPPORT_ENGINEER',
        tenantId: tc.tenantId,
        action: 'TICKET_RESOLVED',
        targetType: 'TICKET',
        targetId: created.id,
        outcome: 'SUCCESS',
        ip,
        details: { number: created.number, seeded: true },
      });
    }

    // 4. Work Order 1: PENDING CM approval (downtimeRequired: true), planned tomorrow
    const wo1Id = `wo_${codeLower}_01`;
    if (!repos.workOrders.findByIdSystem(wo1Id) && repos.devices.findByIdSystem(dev2Id)) {
      const plannedStart = new Date(nowMs + 20 * 3600_000).toISOString();
      const plannedEnd = new Date(nowMs + 22 * 3600_000).toISOString();
      const created = repos.workOrders.createSystem({
        id: wo1Id,
        tenantId: tc.tenantId,
        deviceId: dev2Id,
        ticketId: repos.tickets.findByIdSystem(tkt1Id) ? tkt1Id : null,
        planId: null,
        type: 'CORRECTIVE',
        title: `Inspect & realign vibration sensor mount on ${tc.code} Line 1`,
        instructions:
          'Isolate motor drive power, inspect accelerometer stud torque, replace isolation pad if cracked, and run 5-minute baseline test.',
        checklist: [
          { id: `chk_${codeLower}_1_1`, text: 'Lock out drive power and verify zero energy', done: false },
          { id: `chk_${codeLower}_1_2`, text: 'Inspect mounting stud and bearing housing alignment', done: false },
          { id: `chk_${codeLower}_1_3`, text: 'Confirm telemetry stream returns ONLINE after restart', done: false },
        ],
        assignedTo: 'usr_ft_tech1',
        plannedStart,
        plannedEnd,
        downtimeRequired: true,
        approvalStatus: 'PENDING',
        status: 'ASSIGNED',
        createdBy: tc.primarySeId,
        createdAt: new Date(nowMs - 20 * 3600_000).toISOString(),
      });
      workOrdersCreated += 1;

      // Seed notification for Client Manager so /approvals shows immediately
      repos.notifications.insertSystem({
        id: generateId('ntf'),
        tenantId: tc.tenantId,
        userId: cmId,
        type: 'MAINTENANCE_APPROVAL_REQUESTED',
        title: `Maintenance approval needed: ${created.number}`,
        body: `${created.title} requires a 2-hour downtime window.`,
        link: '/approvals',
        read: false,
      });

      audit.record({
        actorId: tc.primarySeId,
        actorRole: 'SUPPORT_ENGINEER',
        tenantId: tc.tenantId,
        action: 'WORK_ORDER_CREATED',
        targetType: 'WORK_ORDER',
        targetId: created.id,
        outcome: 'SUCCESS',
        ip,
        details: { number: created.number, approvalStatus: 'PENDING', seeded: true },
      });
    }

    // 5. Work Order 2: ASSIGNED to tech1 for Today (no downtime required -> ready to Start)
    const wo2Id = `wo_${codeLower}_02`;
    if (!repos.workOrders.findByIdSystem(wo2Id) && repos.devices.findByIdSystem(dev4Id)) {
      const plannedStart = new Date(nowMs + 45 * 60_000).toISOString();
      const plannedEnd = new Date(nowMs + 165 * 60_000).toISOString();
      const created = repos.workOrders.createSystem({
        id: wo2Id,
        tenantId: tc.tenantId,
        deviceId: dev4Id,
        ticketId: null,
        planId: null,
        type: 'PREVENTIVE',
        title: `Quarterly enclosure & sensor filter inspection (${tc.code})`,
        instructions:
          'Clean intake dust filter, verify waterproof cable gland seal, check battery voltage and RF signal strength against reference meter.',
        checklist: [
          { id: `chk_${codeLower}_2_1`, text: 'Clean PTFE breathable sensor filter cap', done: false },
          { id: `chk_${codeLower}_2_2`, text: 'Inspect outdoor IP67 enclosure seal and cable glands', done: false },
          { id: `chk_${codeLower}_2_3`, text: 'Cross-check temperature reading with handheld calibrator', done: false },
          { id: `chk_${codeLower}_2_4`, text: 'Verify battery level > 70% and RSSI > -80 dBm', done: false },
        ],
        assignedTo: 'usr_ft_tech1',
        plannedStart,
        plannedEnd,
        downtimeRequired: false,
        approvalStatus: 'NOT_REQUIRED',
        status: 'ASSIGNED',
        createdBy: tc.primarySeId,
        createdAt: new Date(nowMs - 10 * 3600_000).toISOString(),
      });
      workOrdersCreated += 1;

      audit.record({
        actorId: tc.primarySeId,
        actorRole: 'SUPPORT_ENGINEER',
        tenantId: tc.tenantId,
        action: 'WORK_ORDER_CREATED',
        targetType: 'WORK_ORDER',
        targetId: created.id,
        outcome: 'SUCCESS',
        ip,
        details: { number: created.number, approvalStatus: 'NOT_REQUIRED', seeded: true },
      });
    }

    // 6. Work Order 3: COMPLETED with parts replaced
    const wo3Id = `wo_${codeLower}_03`;
    if (!repos.workOrders.findByIdSystem(wo3Id) && repos.devices.findByIdSystem(dev6Id)) {
      const plannedStart = new Date(nowMs - 20 * 3600_000).toISOString();
      const plannedEnd = new Date(nowMs - 18 * 3600_000).toISOString();
      const startedAt = new Date(nowMs - 19 * 3600_000).toISOString();
      const completedAt = new Date(nowMs - 18 * 3600_000).toISOString();
      const created = repos.workOrders.createSystem({
        id: wo3Id,
        tenantId: tc.tenantId,
        deviceId: dev6Id,
        ticketId: repos.tickets.findByIdSystem(tkt3Id) ? tkt3Id : null,
        planId: null,
        type: 'CORRECTIVE',
        title: `Replace mounting gasket & torque sensor bracket (${tc.code})`,
        instructions:
          'Replace worn elastomeric gasket on VM-310 mount, torque fastener to 12 Nm, and confirm vibration readings return to nominal band.',
        checklist: [
          { id: `chk_${codeLower}_3_1`, text: 'Verify safe machine stop before bracket removal', done: true },
          { id: `chk_${codeLower}_3_2`, text: 'Install replacement mounting gasket and bearing seal kit', done: true },
          { id: `chk_${codeLower}_3_3`, text: 'Confirm vibration RMS < 4.5 mm/s under load', done: true },
        ],
        assignedTo: 'usr_ft_tech2',
        plannedStart,
        plannedEnd,
        downtimeRequired: true,
        approvalStatus: 'APPROVED',
        approvalNote: 'Approved during scheduled Line 2 changeover.',
        approvedBy: cmId,
        approvedAt: new Date(nowMs - 26 * 3600_000).toISOString(),
        status: 'COMPLETED',
        startedAt,
        completedAt,
        completion: {
          actionsTaken:
            'Removed fatigued elastomeric mounting gasket, cleaned flange mating surface, installed OEM replacement seal kit and torqued bracket bolts to 12 Nm.',
          partsReplaced: ['VM-310 Mounting Gasket (PN-4402)', 'Bearing Seal Kit (PN-1180)'],
          notes: 'Post-maintenance 10-minute run showed steady 3.6 mm/s vibration RMS and 46 °C housing temp.',
          timeSpentMin: 55,
          outcome: 'FIXED',
        },
        createdBy: tc.primarySeId,
        createdAt: new Date(nowMs - 30 * 3600_000).toISOString(),
      });
      workOrdersCreated += 1;

      audit.record({
        actorId: 'usr_ft_tech2',
        actorRole: 'FIELD_TECHNICIAN',
        tenantId: tc.tenantId,
        action: 'WORK_ORDER_COMPLETED',
        targetType: 'WORK_ORDER',
        targetId: created.id,
        outcome: 'SUCCESS',
        ip,
        details: { number: created.number, outcome: 'FIXED', seeded: true },
      });
    }

    // 7. Recurring Preventive Maintenance Plan (every 30 days)
    const mplId = `mpl_${codeLower}_01`;
    if (!repos.maintenancePlans.findById(SYSTEM_PA_CTX, mplId)) {
      const nextRunAt = new Date(nowMs + 14 * 86400_000).toISOString();
      repos.maintenancePlans.create(SYSTEM_PA_CTX, {
        id: mplId,
        tenantId: tc.tenantId,
        name: `Monthly Critical Asset Calibration (${tc.code})`,
        scopeType: 'TAG',
        scopeValue: 'critical',
        everyDays: 30,
        nextRunAt,
        lastRunAt: new Date(nowMs - 16 * 86400_000).toISOString(),
        template: {
          title: 'Monthly Critical Sensor Calibration & Health Check',
          instructions:
            'Verify sensor zero-point calibration, inspect power supply terminals, clean filter screens, and confirm telemetry freshness.',
          checklist: [
            'Inspect physical enclosure and cable strain relief',
            'Perform reference sensor reading cross-check',
            'Verify heartbeat and telemetry ingestion in OmniSphere',
          ],
          downtimeRequired: false,
        },
        assignedTo: 'usr_ft_tech1',
        enabled: true,
        createdBy: tc.primarySeId,
        createdAt: new Date(nowMs - 45 * 86400_000).toISOString(),
      });
      maintenancePlansCreated += 1;

      audit.record({
        actorId: tc.primarySeId,
        actorRole: 'SUPPORT_ENGINEER',
        tenantId: tc.tenantId,
        action: 'MAINTENANCE_PLAN_CREATED',
        targetType: 'MAINTENANCE_PLAN',
        targetId: mplId,
        outcome: 'SUCCESS',
        ip,
        details: { name: `Monthly Critical Asset Calibration (${tc.code})`, seeded: true },
      });
    }
  }

  return { ticketsCreated, workOrdersCreated, maintenancePlansCreated };
}
