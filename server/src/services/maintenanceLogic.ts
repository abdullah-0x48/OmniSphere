import type {
  DeviceConnectivity,
  TicketPriority,
  TicketStatus,
  WorkOrderApprovalStatus,
  WorkOrderPublic,
  WorkOrderStatus,
} from '../../../shared/types.ts';

/**
 * Pure business-rule helpers for Milestone 5 (Sections 5.3 and 8.5).
 * Decoupled from Express and SQLite so rules can be unit-tested deterministically.
 */

export function mapAlertSeverityToTicketPriority(severity: 'WARNING' | 'CRITICAL'): TicketPriority {
  return severity === 'CRITICAL' ? 'CRITICAL' : 'HIGH';
}

export function deriveInitialWorkOrderApproval(
  downtimeRequired: boolean,
  requireMaintenanceApproval: boolean,
): WorkOrderApprovalStatus {
  if (downtimeRequired && requireMaintenanceApproval) {
    return 'PENDING';
  }
  return 'NOT_REQUIRED';
}

/**
 * Section 5.3:
 * "If a CM rejects, the SE must change the window or details, which resets approval to PENDING."
 * Also if downtimeRequired is turned on for a tenant requiring maintenance approval, or the planned
 * window changes on a previously approved/rejected downtime work order, reset approval to PENDING.
 */
export function computeApprovalAfterEdit(params: {
  currentDowntimeRequired: boolean;
  currentApprovalStatus: WorkOrderApprovalStatus;
  currentPlannedStart: string | null;
  currentPlannedEnd: string | null;
  nextDowntimeRequired: boolean;
  nextPlannedStart: string | null;
  nextPlannedEnd: string | null;
  requireMaintenanceApproval: boolean;
  detailsChanged: boolean;
}): { approvalStatus: WorkOrderApprovalStatus; clearNote: boolean; notifyManagers: boolean } {
  const {
    currentApprovalStatus,
    currentPlannedStart,
    currentPlannedEnd,
    nextDowntimeRequired,
    nextPlannedStart,
    nextPlannedEnd,
    requireMaintenanceApproval,
    detailsChanged,
  } = params;

  if (!nextDowntimeRequired || !requireMaintenanceApproval) {
    return {
      approvalStatus: 'NOT_REQUIRED',
      clearNote: currentApprovalStatus !== 'NOT_REQUIRED',
      notifyManagers: false,
    };
  }

  const windowChanged =
    currentPlannedStart !== nextPlannedStart || currentPlannedEnd !== nextPlannedEnd;

  if (currentApprovalStatus === 'REJECTED' && (windowChanged || detailsChanged)) {
    return { approvalStatus: 'PENDING', clearNote: true, notifyManagers: true };
  }

  if (currentApprovalStatus === 'NOT_REQUIRED') {
    return { approvalStatus: 'PENDING', clearNote: true, notifyManagers: true };
  }

  if (currentApprovalStatus === 'APPROVED' && windowChanged) {
    return { approvalStatus: 'PENDING', clearNote: true, notifyManagers: true };
  }

  return {
    approvalStatus: currentApprovalStatus,
    clearNote: false,
    notifyManagers: false,
  };
}

/**
 * Section 5.3 & 8.5:
 * An FT can start a work order only when:
 * - They are the assigned technician
 * - The work order is ASSIGNED (or PLANNED with assignedTo === userId)
 * - Approval is APPROVED or NOT_REQUIRED (never PENDING or REJECTED)
 */
export function validateWorkOrderStart(
  wo: Pick<WorkOrderPublic, 'status' | 'assignedTo' | 'downtimeRequired' | 'approvalStatus'>,
  actorUserId: string,
): { ok: true } | { ok: false; code: 'FORBIDDEN' | 'INVALID_TRANSITION'; message: string } {
  if (wo.assignedTo !== actorUserId) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      message: 'Only the assigned Field Technician can start this work order',
    };
  }
  if (wo.status === 'IN_PROGRESS') {
    return { ok: false, code: 'INVALID_TRANSITION', message: 'Work order is already in progress' };
  }
  if (wo.status === 'COMPLETED' || wo.status === 'CANCELLED') {
    return {
      ok: false,
      code: 'INVALID_TRANSITION',
      message: `Cannot start a work order in status ${wo.status}`,
    };
  }
  if (wo.approvalStatus === 'PENDING') {
    return {
      ok: false,
      code: 'INVALID_TRANSITION',
      message: 'Maintenance window requires Client Manager approval before work can start',
    };
  }
  if (wo.approvalStatus === 'REJECTED') {
    return {
      ok: false,
      code: 'INVALID_TRANSITION',
      message:
        'Maintenance window was rejected by Client Manager; Support Engineer must update the plan for re-approval',
    };
  }
  return { ok: true };
}

export function canTransitionTicketStatusBySe(from: TicketStatus, to: TicketStatus): boolean {
  if (from === to) return true;
  if (from === 'CLOSED') return false;
  // SE can move OPEN/IN_PROGRESS/WAITING_ON_CLIENT among themselves via PATCH;
  // RESOLVED and CLOSED use dedicated /resolve and /close endpoints with required fields.
  const editableStates: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'WAITING_ON_CLIENT'];
  return editableStates.includes(from) && editableStates.includes(to);
}

/**
 * Section 8.5:
 * "If the device is not ONLINE within 5 minutes after completion, show a warning banner on the
 * linked ticket (informational only)."
 */
export function shouldShowPostMaintenanceOfflineWarning(
  workOrders: Array<Pick<WorkOrderPublic, 'status' | 'completedAt'>>,
  deviceConnectivity: DeviceConnectivity | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!deviceConnectivity || deviceConnectivity === 'ONLINE') {
    return false;
  }
  const FIVE_MINUTES_MS = 5 * 60 * 1000;
  for (const wo of workOrders) {
    if (wo.status !== 'COMPLETED' || !wo.completedAt) continue;
    const completedMs = Date.parse(wo.completedAt);
    if (Number.isFinite(completedMs) && nowMs - completedMs >= FIVE_MINUTES_MS) {
      return true;
    }
  }
  return false;
}

/**
 * Advances a recurring maintenance plan's `nextRunAt` by integer multiples of `everyDays`
 * until it is strictly after `nowMs`, keeping scheduled cadence aligned and idempotent.
 */
export function advanceMaintenanceNextRunAt(
  currentNextRunAtIso: string,
  everyDays: number,
  nowMs = Date.now(),
): string {
  const safeDays = Math.max(1, Math.floor(everyDays));
  const stepMs = safeDays * 24 * 60 * 60 * 1000;
  let nextMs = Date.parse(currentNextRunAtIso);
  if (!Number.isFinite(nextMs)) {
    nextMs = nowMs;
  }
  while (nextMs <= nowMs) {
    nextMs += stepMs;
  }
  return new Date(nextMs).toISOString();
}

export interface GroupedTechnicianWorkOrders {
  today: WorkOrderPublic[];
  upcoming: WorkOrderPublic[];
  completed: WorkOrderPublic[];
}

/**
 * Groups an FT's assigned work orders into Today (including IN_PROGRESS and overdue active),
 * Upcoming (future PLANNED/ASSIGNED), and Completed (COMPLETED/CANCELLED).
 */
export function groupWorkOrdersForTechnician(
  items: WorkOrderPublic[],
  now = new Date(),
): GroupedTechnicianWorkOrders {
  const today: WorkOrderPublic[] = [];
  const upcoming: WorkOrderPublic[] = [];
  const completed: WorkOrderPublic[] = [];

  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const endOfTodayMs = endOfToday.getTime();

  for (const wo of items) {
    if (wo.status === 'COMPLETED' || wo.status === 'CANCELLED') {
      completed.push(wo);
      continue;
    }
    if (wo.status === 'IN_PROGRESS') {
      today.push(wo);
      continue;
    }
    if (!wo.plannedStart) {
      today.push(wo);
      continue;
    }
    const startMs = Date.parse(wo.plannedStart);
    if (!Number.isFinite(startMs) || startMs <= endOfTodayMs) {
      today.push(wo);
    } else {
      upcoming.push(wo);
    }
  }

  // In-progress first in Today, then earliest plannedStart
  const statusWeight: Record<WorkOrderStatus, number> = {
    IN_PROGRESS: 0,
    ASSIGNED: 1,
    PLANNED: 2,
    COMPLETED: 3,
    CANCELLED: 4,
  };
  today.sort((a, b) => {
    const sw = statusWeight[a.status] - statusWeight[b.status];
    if (sw !== 0) return sw;
    return (a.plannedStart ?? a.createdAt).localeCompare(b.plannedStart ?? b.createdAt);
  });
  upcoming.sort((a, b) =>
    (a.plannedStart ?? a.createdAt).localeCompare(b.plannedStart ?? b.createdAt),
  );
  completed.sort((a, b) =>
    (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt),
  );

  return { today, upcoming, completed };
}
