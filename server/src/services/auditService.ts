import type { AuditLog, AuditOutcome, RoleCode } from '../../../shared/types.ts';
import type { AuditListFilter, IAuditRepository, TenantContext } from '../repositories/types.ts';
import { generateId } from '../utils/ids.ts';

const REDACTED_KEYS = new Set([
  'password',
  'passwordHash',
  'currentPassword',
  'newPassword',
  'token',
  'resetToken',
  'apiKey',
  'apiKeyHash',
  'secret',
]);

function sanitizeDetails(details: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!details) return {};
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(details)) {
    if (REDACTED_KEYS.has(k)) {
      clean[k] = '[REDACTED]';
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      clean[k] = sanitizeDetails(v as Record<string, unknown>);
    } else {
      clean[k] = v;
    }
  }
  return clean;
}

export interface AuditEventInput {
  actorId: string;
  actorRole: RoleCode | 'SYSTEM' | 'ANONYMOUS';
  tenantId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  outcome: AuditOutcome;
  ip: string;
  details?: Record<string, unknown>;
}

export class AuditService {
  constructor(private readonly auditRepo: IAuditRepository) {}

  record(input: AuditEventInput): AuditLog {
    return this.auditRepo.insert({
      id: generateId('aud'),
      at: new Date().toISOString(),
      actorId: input.actorId,
      actorRole: input.actorRole,
      tenantId: input.tenantId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      outcome: input.outcome,
      ip: input.ip || 'unknown',
      details: sanitizeDetails(input.details),
    });
  }

  list(ctx: TenantContext, filter: AuditListFilter): { items: AuditLog[]; total: number } {
    return this.auditRepo.list(ctx, filter);
  }
}
