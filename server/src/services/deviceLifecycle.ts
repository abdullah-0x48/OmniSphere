import crypto from 'crypto';
import type {
  DeviceLifecycleAction,
  DeviceLifecycleState,
  RoleCode,
} from '../../../shared/types.ts';
import { Errors } from '../utils/errors.ts';

export interface GeneratedDeviceKey {
  apiKey: string;
  apiKeyHash: string;
  apiKeyLast4: string;
}

/**
 * Generates an industrial device API key per Section 6:
 * `omk_` + 32 random bytes encoded as base64url. Only the SHA-256 hash and last 4 chars are stored.
 */
export function generateDeviceApiKey(): GeneratedDeviceKey {
  const apiKey = `omk_${crypto.randomBytes(32).toString('base64url')}`;
  const apiKeyHash = hashDeviceApiKey(apiKey);
  const apiKeyLast4 = apiKey.slice(-4);
  return { apiKey, apiKeyHash, apiKeyLast4 };
}

export function hashDeviceApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

export function verifyDeviceApiKey(apiKey: string, storedHash: string | null): boolean {
  if (!storedHash) return false;
  const candidate = hashDeviceApiKey(apiKey);
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Section 5.1 Device Lifecycle State Machine (FR-LCM-01)
 *
 * | From | To | Trigger | Who |
 * | PROVISIONED | ACTIVE | First successful device handshake | SYSTEM |
 * | ACTIVE | UNDER_MAINTENANCE | Work order started, or manual | SYSTEM, SE, CA |
 * | UNDER_MAINTENANCE | ACTIVE | Work order completed, or manual | SYSTEM, SE, CA |
 * | ACTIVE | SUSPENDED | Suspend (reason required) | SE, CA |
 * | SUSPENDED | ACTIVE | Resume | SE, CA |
 * | PROVISIONED, ACTIVE, UNDER_MAINTENANCE, SUSPENDED | DECOMMISSIONED | Decommission (reason required) | CA only |
 * | DECOMMISSIONED | (none) | Terminal state | |
 */

interface TransitionRule {
  to: DeviceLifecycleState;
  allowedActors: ReadonlyArray<RoleCode | 'SYSTEM'>;
  reasonRequired: boolean;
}

const TRANSITION_TABLE: Record<DeviceLifecycleState, readonly TransitionRule[]> = {
  PROVISIONED: [
    { to: 'ACTIVE', allowedActors: ['SYSTEM'], reasonRequired: false },
    { to: 'DECOMMISSIONED', allowedActors: ['CLIENT_ADMIN'], reasonRequired: true },
  ],
  ACTIVE: [
    {
      to: 'UNDER_MAINTENANCE',
      allowedActors: ['SYSTEM', 'SUPPORT_ENGINEER', 'CLIENT_ADMIN'],
      reasonRequired: false,
    },
    {
      to: 'SUSPENDED',
      allowedActors: ['SUPPORT_ENGINEER', 'CLIENT_ADMIN'],
      reasonRequired: true,
    },
    { to: 'DECOMMISSIONED', allowedActors: ['CLIENT_ADMIN'], reasonRequired: true },
  ],
  UNDER_MAINTENANCE: [
    {
      to: 'ACTIVE',
      allowedActors: ['SYSTEM', 'SUPPORT_ENGINEER', 'CLIENT_ADMIN'],
      reasonRequired: false,
    },
    { to: 'DECOMMISSIONED', allowedActors: ['CLIENT_ADMIN'], reasonRequired: true },
  ],
  SUSPENDED: [
    {
      to: 'ACTIVE',
      allowedActors: ['SUPPORT_ENGINEER', 'CLIENT_ADMIN'],
      reasonRequired: false,
    },
    { to: 'DECOMMISSIONED', allowedActors: ['CLIENT_ADMIN'], reasonRequired: true },
  ],
  DECOMMISSIONED: [],
};

export function getAllStructuralTransitions(from: DeviceLifecycleState): DeviceLifecycleState[] {
  return TRANSITION_TABLE[from].map((r) => r.to);
}

export function getAllowedTransitionsForActor(
  from: DeviceLifecycleState,
  actorRole: RoleCode | 'SYSTEM',
): DeviceLifecycleState[] {
  return TRANSITION_TABLE[from]
    .filter((r) => r.allowedActors.includes(actorRole))
    .map((r) => r.to);
}

export function actionToTargetState(action: DeviceLifecycleAction): DeviceLifecycleState {
  switch (action) {
    case 'SUSPEND':
      return 'SUSPENDED';
    case 'RESUME':
    case 'SET_ACTIVE':
      return 'ACTIVE';
    case 'SET_UNDER_MAINTENANCE':
      return 'UNDER_MAINTENANCE';
    case 'DECOMMISSION':
      return 'DECOMMISSIONED';
  }
}

export interface TransitionValidationInput {
  from: DeviceLifecycleState;
  action?: DeviceLifecycleAction;
  to: DeviceLifecycleState;
  actorRole: RoleCode | 'SYSTEM';
  reason?: string;
}

/**
 * Validates a lifecycle state transition strictly against Section 5.1.
 * Throws:
 * - 403 FORBIDDEN when the transition exists structurally (e.g. DECOMMISSIONED) but the role is not permitted
 * - 409 INVALID_TRANSITION with `allowedTransitions` when the transition is illegal from the current state
 * - 400 VALIDATION_ERROR when a required reason (SUSPEND / DECOMMISSION) is missing
 */
export function validateLifecycleTransition(input: TransitionValidationInput): {
  targetState: DeviceLifecycleState;
  normalizedReason: string;
} {
  const { from, action, to, actorRole, reason } = input;
  const allowedForActor = getAllowedTransitionsForActor(from, actorRole);

  // Action-specific source-state guards so RESUME cannot bypass UNDER_MAINTENANCE and SET_ACTIVE cannot bypass SUSPENDED/PROVISIONED
  if (action === 'RESUME' && from !== 'SUSPENDED') {
    throw Errors.invalidTransition(
      `Cannot resume a device from state ${from}; only SUSPENDED devices can be resumed.`,
      { currentState: from, targetState: to, allowedTransitions: allowedForActor },
    );
  }
  if (action === 'SET_ACTIVE' && from !== 'UNDER_MAINTENANCE') {
    throw Errors.invalidTransition(
      `Cannot set device active from state ${from}; only UNDER_MAINTENANCE devices can use SET_ACTIVE.`,
      { currentState: from, targetState: to, allowedTransitions: allowedForActor },
    );
  }

  // Decommission role check comes before terminal-state check only when not already decommissioned
  if (to === 'DECOMMISSIONED' && from !== 'DECOMMISSIONED' && actorRole !== 'CLIENT_ADMIN') {
    throw Errors.forbidden('Only a Client Admin can decommission devices');
  }

  const rule = TRANSITION_TABLE[from].find((r) => r.to === to);
  if (!rule) {
    const allowedText =
      allowedForActor.length > 0 ? allowedForActor.join(', ') : 'none (terminal state)';
    throw Errors.invalidTransition(
      `Invalid device lifecycle transition from ${from} to ${to}. Allowed transitions: ${allowedText}.`,
      {
        currentState: from,
        targetState: to,
        allowedTransitions: allowedForActor,
      },
    );
  }

  if (!rule.allowedActors.includes(actorRole)) {
    if (from === 'PROVISIONED' && to === 'ACTIVE') {
      throw Errors.invalidTransition(
        'PROVISIONED devices transition to ACTIVE automatically on first authenticated device handshake.',
        {
          currentState: from,
          targetState: to,
          allowedTransitions: allowedForActor,
        },
      );
    }
    throw Errors.forbidden(`Role ${actorRole} is not allowed to transition device from ${from} to ${to}`);
  }

  const trimmedReason = reason?.trim() ?? '';
  if (rule.reasonRequired && trimmedReason.length === 0) {
    throw Errors.validation(`A reason is required to transition a device to ${to}`, {
      field: 'reason',
    });
  }

  const defaultReason =
    to === 'UNDER_MAINTENANCE'
      ? 'Set under maintenance'
      : to === 'ACTIVE' && from === 'SUSPENDED'
        ? 'Resumed from suspended state'
        : to === 'ACTIVE' && from === 'UNDER_MAINTENANCE'
          ? 'Returned to active operation'
          : to === 'ACTIVE' && from === 'PROVISIONED'
            ? 'First authenticated device handshake'
            : `Transitioned to ${to}`;

  return {
    targetState: to,
    normalizedReason: trimmedReason || defaultReason,
  };
}
