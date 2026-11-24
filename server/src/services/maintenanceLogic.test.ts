import test from 'node:test';
import assert from 'node:assert/strict';
import type { WorkOrderPublic } from '../../../shared/types.ts';
import {
  advanceMaintenanceNextRunAt,
  canTransitionTicketStatusBySe,
  computeApprovalAfterEdit,
  deriveInitialWorkOrderApproval,
  groupWorkOrdersForTechnician,
  mapAlertSeverityToTicketPriority,
  shouldShowPostMaintenanceOfflineWarning,
  validateWorkOrderStart,
} from './maintenanceLogic.ts';

test('mapAlertSeverityToTicketPriority maps CRITICAL -> CRITICAL and WARNING -> HIGH', () => {
  assert.equal(mapAlertSeverityToTicketPriority('CRITICAL'), 'CRITICAL');
  assert.equal(mapAlertSeverityToTicketPriority('WARNING'), 'HIGH');
});

test('deriveInitialWorkOrderApproval enforces tenant requireMaintenanceApproval only when downtimeRequired', () => {
  assert.equal(deriveInitialWorkOrderApproval(true, true), 'PENDING');
  assert.equal(deriveInitialWorkOrderApproval(true, false), 'NOT_REQUIRED');
  assert.equal(deriveInitialWorkOrderApproval(false, true), 'NOT_REQUIRED');
  assert.equal(deriveInitialWorkOrderApproval(false, false), 'NOT_REQUIRED');
});

test('computeApprovalAfterEdit resets REJECTED to PENDING when SE edits window or details', () => {
  const res = computeApprovalAfterEdit({
    currentDowntimeRequired: true,
    currentApprovalStatus: 'REJECTED',
    currentPlannedStart: '2026-11-22T09:00:00.000Z',
    currentPlannedEnd: '2026-11-22T11:00:00.000Z',
    nextDowntimeRequired: true,
    nextPlannedStart: '2026-11-23T09:00:00.000Z',
    nextPlannedEnd: '2026-11-23T11:00:00.000Z',
    requireMaintenanceApproval: true,
    detailsChanged: false,
  });
  assert.equal(res.approvalStatus, 'PENDING');
  assert.equal(res.clearNote, true);
  assert.equal(res.notifyManagers, true);
});

test('validateWorkOrderStart blocks unapproved downtime work orders and non-assigned technicians', () => {
  const pending = validateWorkOrderStart(
    { status: 'ASSIGNED', assignedTo: 'usr_ft1', downtimeRequired: true, approvalStatus: 'PENDING' },
    'usr_ft1',
  );
  assert.equal(pending.ok, false);
  if (!pending.ok) assert.equal(pending.code, 'INVALID_TRANSITION');

  const wrongTech = validateWorkOrderStart(
    { status: 'ASSIGNED', assignedTo: 'usr_ft1', downtimeRequired: false, approvalStatus: 'NOT_REQUIRED' },
    'usr_ft2',
  );
  assert.equal(wrongTech.ok, false);
  if (!wrongTech.ok) assert.equal(wrongTech.code, 'FORBIDDEN');

  const okApproved = validateWorkOrderStart(
    { status: 'ASSIGNED', assignedTo: 'usr_ft1', downtimeRequired: true, approvalStatus: 'APPROVED' },
    'usr_ft1',
  );
  assert.equal(okApproved.ok, true);
});

test('canTransitionTicketStatusBySe restricts CLOSED and dedicated resolve/close states', () => {
  assert.equal(canTransitionTicketStatusBySe('OPEN', 'IN_PROGRESS'), true);
  assert.equal(canTransitionTicketStatusBySe('IN_PROGRESS', 'WAITING_ON_CLIENT'), true);
  assert.equal(canTransitionTicketStatusBySe('CLOSED', 'IN_PROGRESS'), false);
  assert.equal(canTransitionTicketStatusBySe('OPEN', 'RESOLVED'), false);
});

test('shouldShowPostMaintenanceOfflineWarning triggers only when offline >= 5 min after completion', () => {
  const nowMs = Date.parse('2026-11-21T12:10:00.000Z');
  assert.equal(
    shouldShowPostMaintenanceOfflineWarning(
      [{ status: 'COMPLETED', completedAt: '2026-11-21T12:04:00.000Z' }],
      'OFFLINE',
      nowMs,
    ),
    true,
  );
  assert.equal(
    shouldShowPostMaintenanceOfflineWarning(
      [{ status: 'COMPLETED', completedAt: '2026-11-21T12:07:00.000Z' }],
      'OFFLINE',
      nowMs,
    ),
    false,
  );
  assert.equal(
    shouldShowPostMaintenanceOfflineWarning(
      [{ status: 'COMPLETED', completedAt: '2026-11-21T12:00:00.000Z' }],
      'ONLINE',
      nowMs,
    ),
    false,
  );
});

test('advanceMaintenanceNextRunAt advances strictly into the future in everyDays increments', () => {
  const nowMs = Date.parse('2026-11-21T12:00:00.000Z');
  const next = advanceMaintenanceNextRunAt('2026-10-20T08:00:00.000Z', 30, nowMs);
  assert.ok(Date.parse(next) > nowMs);
  assert.equal(next, '2026-12-19T08:00:00.000Z');
});

test('groupWorkOrdersForTechnician groups IN_PROGRESS & today vs future vs completed', () => {
  const now = new Date('2026-11-21T10:00:00.000Z');
  const mk = (overrides: Partial<WorkOrderPublic>): WorkOrderPublic => ({
    id: 'wo_1',
    number: 'WO-0001',
    tenantId: 'ten_ktl',
    deviceId: 'dev_1',
    ticketId: null,
    planId: null,
    type: 'CORRECTIVE',
    title: 'Check bearing',
    instructions: 'Inspect',
    checklist: [],
    assignedTo: 'usr_ft1',
    plannedStart: '2026-11-21T14:00:00.000Z',
    plannedEnd: '2026-11-21T16:00:00.000Z',
    downtimeRequired: false,
    approvalStatus: 'NOT_REQUIRED',
    approvalNote: null,
    approvedBy: null,
    approvedAt: null,
    status: 'ASSIGNED',
    startedAt: null,
    completedAt: null,
    completion: null,
    createdBy: 'usr_se1',
    createdAt: '2026-11-21T08:00:00.000Z',
    updatedAt: '2026-11-21T08:00:00.000Z',
    ...overrides,
  });

  const grouped = groupWorkOrdersForTechnician(
    [
      mk({ id: 'wo_assigned_today', status: 'ASSIGNED', plannedStart: '2026-11-21T15:00:00.000Z' }),
      mk({ id: 'wo_in_prog', status: 'IN_PROGRESS', plannedStart: '2026-11-25T15:00:00.000Z' }),
      mk({ id: 'wo_future', status: 'ASSIGNED', plannedStart: '2026-11-24T10:00:00.000Z' }),
      mk({ id: 'wo_done', status: 'COMPLETED', completedAt: '2026-11-20T12:00:00.000Z' }),
    ],
    now,
  );

  assert.deepEqual(
    grouped.today.map((w) => w.id),
    ['wo_in_prog', 'wo_assigned_today'],
  );
  assert.deepEqual(
    grouped.upcoming.map((w) => w.id),
    ['wo_future'],
  );
  assert.deepEqual(
    grouped.completed.map((w) => w.id),
    ['wo_done'],
  );
});
