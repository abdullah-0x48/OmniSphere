import nodemailer from 'nodemailer';
import type { EmailOutboxItem } from '../../../shared/types.ts';
import { config, isSmtpConfigured } from '../config.ts';
import type {
  EmailOutboxListFilter,
  IEmailOutboxRepository,
  TenantContext,
} from '../repositories/types.ts';
import { generateId } from '../utils/ids.ts';
import { logger } from '../utils/logger.ts';
import { computeEmailRetryDelayMs } from './alertEvaluationLogic.ts';

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export interface SendEmailInput {
  tenantId: string | null;
  to: string;
  subject: string;
  summary: string;
  facts: Array<{ label: string; value: string }>;
  ctaLabel?: string;
  ctaPath?: string;
  relatedType?: string | null;
  relatedId?: string | null;
}

export type EmailSenderFn = (payload: {
  from: string;
  to: string;
  subject: string;
  html: string;
}) => Promise<void>;

export class EmailService {
  private customSender: EmailSenderFn | null = null;
  private onPermanentFailure: ((item: EmailOutboxItem) => void) | null = null;
  private autoKickWorker = true;
  private processing = false;

  constructor(private readonly outboxRepo: IEmailOutboxRepository) {}

  setOnPermanentFailure(cb: ((item: EmailOutboxItem) => void) | null): void {
    this.onPermanentFailure = cb;
  }

  /**
   * Allows deterministic automated tests (Test 6) to simulate SMTP failures or slow servers
   * without touching external networks.
   */
  setCustomSenderForTesting(sender: EmailSenderFn | null, options?: { autoKickWorker?: boolean }): void {
    this.customSender = sender;
    if (options?.autoKickWorker !== undefined) {
      this.autoKickWorker = options.autoKickWorker;
    }
  }

  private renderHtml(input: SendEmailInput): string {
    const factsRows = input.facts
      .map(
        (f) =>
          `<tr><td style="padding:6px 12px 6px 0;color:#64748b;font-size:13px;">${escapeHtml(f.label)}</td><td style="padding:6px 0;color:#0f172a;font-size:13px;font-weight:600;">${escapeHtml(f.value)}</td></tr>`,
      )
      .join('');

    const ctaHref = input.ctaPath ? `${config.publicBaseUrl}${input.ctaPath}` : null;
    const ctaHtml =
      ctaHref && input.ctaLabel
        ? `<p style="margin:24px 0 0 0;"><a href="${escapeHtml(ctaHref)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px;">${escapeHtml(input.ctaLabel)}</a></p>`
        : '';

    return `<!doctype html>
<html>
  <body style="font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;padding:24px;color:#0f172a;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:24px;">
      <p style="margin:0 0 8px 0;font-size:12px;font-weight:600;color:#4f46e5;letter-spacing:0.04em;">OMNISPHERE</p>
      <h1 style="margin:0 0 12px 0;font-size:18px;color:#0f172a;">${escapeHtml(input.subject)}</h1>
      <p style="margin:0 0 16px 0;font-size:14px;line-height:1.6;color:#334155;">${escapeHtml(input.summary)}</p>
      ${factsRows ? `<table style="border-collapse:collapse;width:100%;margin-top:8px;">${factsRows}</table>` : ''}
      ${ctaHtml}
    </div>
  </body>
</html>`;
  }

  /**
   * Non-blocking enqueue (Section 8.8): writes to `email_outbox` as QUEUED and returns immediately.
   * Alert creation calls this so a slow or failing SMTP server can NEVER block alert creation.
   */
  enqueue(input: SendEmailInput): EmailOutboxItem {
    const id = generateId('eml');
    const html = this.renderHtml(input);
    const nowIso = new Date().toISOString();
    const outbox = this.outboxRepo.insert({
      id,
      tenantId: input.tenantId,
      to: input.to,
      subject: input.subject,
      body: html,
      status: 'QUEUED',
      attempts: 0,
      nextAttemptAt: nowIso,
      lastError: null,
      relatedType: input.relatedType ?? null,
      relatedId: input.relatedId ?? null,
    });

    if (this.autoKickWorker) {
      setImmediate(() => {
        void this.processOutboxOnce().catch((err) => {
          logger.error('Async email worker kick failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      });
    }

    return outbox;
  }

  /**
   * Queues an email and attempts immediate delivery (used by password reset flow).
   */
  async enqueueAndSend(input: SendEmailInput): Promise<EmailOutboxItem> {
    const id = generateId('eml');
    const html = this.renderHtml(input);
    const nowIso = new Date().toISOString();
    const outbox = this.outboxRepo.insert({
      id,
      tenantId: input.tenantId,
      to: input.to,
      subject: input.subject,
      body: html,
      status: 'QUEUED',
      attempts: 0,
      nextAttemptAt: nowIso,
      lastError: null,
      relatedType: input.relatedType ?? null,
      relatedId: input.relatedId ?? null,
    });

    await this.deliverItem(outbox, Date.now());
    return this.outboxRepo.findByIdSystem(id) ?? outbox;
  }

  /**
   * Processes due QUEUED rows from `email_outbox` (Section 8.8 & 8.9).
   * Retries failed deliveries up to 3 more times (30s, 60s, 120s); after the 4th failed attempt
   * marks status FAILED and invokes `onPermanentFailure` so related alerts show the failure warning.
   */
  async processOutboxOnce(nowMs = Date.now()): Promise<{
    processed: number;
    sent: number;
    retried: number;
    failed: number;
  }> {
    if (this.processing) {
      return { processed: 0, sent: 0, retried: 0, failed: 0 };
    }
    this.processing = true;
    let processed = 0;
    let sent = 0;
    let retried = 0;
    let failed = 0;

    try {
      const nowIso = new Date(nowMs).toISOString();
      const dueItems = this.outboxRepo.listDueQueuedSystem(nowIso, 50);

      for (const item of dueItems) {
        const outcome = await this.deliverItem(item, nowMs);
        processed += 1;
        if (outcome === 'SENT') sent += 1;
        else if (outcome === 'RETRIED') retried += 1;
        else if (outcome === 'FAILED') failed += 1;
      }
    } finally {
      this.processing = false;
    }

    return { processed, sent, retried, failed };
  }

  private async deliverItem(
    item: EmailOutboxItem,
    nowMs: number,
  ): Promise<'SENT' | 'RETRIED' | 'FAILED'> {
    const nextAttempts = item.attempts + 1;

    // Outbox-only mode when SMTP is unconfigured and no test sender is injected
    if (!this.customSender && !isSmtpConfigured()) {
      this.outboxRepo.updateDeliveryStatus(item.id, {
        status: 'SENT',
        attempts: nextAttempts,
        nextAttemptAt: null,
        lastError: null,
      });
      return 'SENT';
    }

    try {
      if (this.customSender) {
        await this.customSender({
          from: config.smtp.from,
          to: item.to,
          subject: item.subject,
          html: item.body,
        });
      } else {
        const transporter = nodemailer.createTransport({
          host: config.smtp.host,
          port: config.smtp.port,
          secure: config.smtp.port === 465,
          connectionTimeout: 5000,
          greetingTimeout: 5000,
          socketTimeout: 5000,
          auth:
            config.smtp.user || config.smtp.pass
              ? { user: config.smtp.user, pass: config.smtp.pass }
              : undefined,
        });
        await transporter.sendMail({
          from: config.smtp.from,
          to: item.to,
          subject: item.subject,
          html: item.body,
        });
      }

      this.outboxRepo.updateDeliveryStatus(item.id, {
        status: 'SENT',
        attempts: nextAttempts,
        nextAttemptAt: null,
        lastError: null,
      });
      return 'SENT';
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'SMTP delivery failed';
      const retryDelayMs = computeEmailRetryDelayMs(nextAttempts);

      if (retryDelayMs !== null) {
        const nextRetryIso = new Date(nowMs + retryDelayMs).toISOString();
        logger.warn('Email delivery failed; scheduled retry', {
          emailId: item.id,
          attempts: nextAttempts,
          nextAttemptAt: nextRetryIso,
          error: errMsg,
        });
        this.outboxRepo.updateDeliveryStatus(item.id, {
          status: 'QUEUED',
          attempts: nextAttempts,
          nextAttemptAt: nextRetryIso,
          lastError: errMsg,
        });
        return 'RETRIED';
      }

      logger.error('Email delivery permanently failed after 3 retries', {
        emailId: item.id,
        attempts: nextAttempts,
        relatedType: item.relatedType,
        relatedId: item.relatedId,
        error: errMsg,
      });
      this.outboxRepo.updateDeliveryStatus(item.id, {
        status: 'FAILED',
        attempts: nextAttempts,
        nextAttemptAt: null,
        lastError: errMsg,
      });

      const failedItem: EmailOutboxItem = {
        ...item,
        status: 'FAILED',
        attempts: nextAttempts,
        nextAttemptAt: null,
        lastError: errMsg,
      };
      this.onPermanentFailure?.(failedItem);
      return 'FAILED';
    }
  }

  listOutbox(
    ctx: TenantContext,
    filter: EmailOutboxListFilter,
  ): { items: EmailOutboxItem[]; total: number } {
    return this.outboxRepo.list(ctx, filter);
  }
}
