import type Database from 'better-sqlite3';
import type { EmailOutboxItem, EmailOutboxStatus } from '../../../shared/types.ts';
import type {
  CreateEmailOutboxInput,
  EmailOutboxListFilter,
  IEmailOutboxRepository,
  TenantContext,
} from './types.ts';

interface EmailRow {
  id: string;
  tenant_id: string | null;
  to_email: string;
  subject: string;
  body: string;
  status: EmailOutboxStatus;
  attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  related_type: string | null;
  related_id: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(row: EmailRow): EmailOutboxItem {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    to: row.to_email,
    subject: row.subject,
    body: row.body,
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
    relatedType: row.related_type,
    relatedId: row.related_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteEmailOutboxRepository implements IEmailOutboxRepository {
  constructor(private readonly db: Database.Database) {}

  insert(input: CreateEmailOutboxInput): EmailOutboxItem {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO email_outbox (
          id, tenant_id, to_email, subject, body, status,
          attempts, next_attempt_at, last_error, related_type, related_id,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.tenantId,
        input.to.toLowerCase(),
        input.subject,
        input.body,
        input.status,
        input.attempts,
        input.nextAttemptAt,
        input.lastError,
        input.relatedType,
        input.relatedId,
        now,
        now,
      );
    const row = this.db
      .prepare('SELECT * FROM email_outbox WHERE id = ?')
      .get(input.id) as EmailRow;
    return mapRow(row);
  }

  list(ctx: TenantContext, filter: EmailOutboxListFilter): { items: EmailOutboxItem[]; total: number } {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (ctx.allTenants) {
      if (filter.tenantId) {
        conditions.push('tenant_id = ?');
        params.push(filter.tenantId);
      }
    } else if (ctx.activeTenantId) {
      conditions.push('tenant_id = ?');
      params.push(ctx.activeTenantId);
    } else if (ctx.tenantIds.length > 0) {
      const placeholders = ctx.tenantIds.map(() => '?').join(', ');
      conditions.push(`tenant_id IN (${placeholders})`);
      params.push(...ctx.tenantIds);
    } else {
      conditions.push('1 = 0');
    }

    if (filter.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    }

    const where = conditions.length > 0 ? conditions.join(' AND ') : '1 = 1';
    const countRow = this.db
      .prepare(`SELECT COUNT(*) AS count FROM email_outbox WHERE ${where}`)
      .get(...params) as { count: number };

    const offset = (filter.page - 1) * filter.pageSize;
    const rows = this.db
      .prepare(
        `SELECT * FROM email_outbox WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, filter.pageSize, offset) as EmailRow[];

    return {
      items: rows.map(mapRow),
      total: countRow.count,
    };
  }

  updateDeliveryStatus(
    id: string,
    patch: {
      status: EmailOutboxStatus;
      attempts: number;
      nextAttemptAt: string | null;
      lastError: string | null;
    },
  ): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE email_outbox
         SET status = ?, attempts = ?, next_attempt_at = ?, last_error = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(patch.status, patch.attempts, patch.nextAttemptAt, patch.lastError, now, id);
  }

  countQueuedOrFailed(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM email_outbox WHERE status IN ('QUEUED', 'FAILED')")
      .get() as { count: number };
    return row.count;
  }
}
