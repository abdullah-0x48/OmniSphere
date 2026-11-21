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

export class EmailService {
  constructor(private readonly outboxRepo: IEmailOutboxRepository) {}

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
   * Queues an email in emailOutbox and attempts immediate delivery.
   * When SMTP_* env vars are absent, runs in outbox-only mode and marks SENT (Section 3).
   */
  async enqueueAndSend(input: SendEmailInput): Promise<EmailOutboxItem> {
    const id = generateId('eml');
    const html = this.renderHtml(input);
    const outbox = this.outboxRepo.insert({
      id,
      tenantId: input.tenantId,
      to: input.to,
      subject: input.subject,
      body: html,
      status: 'QUEUED',
      attempts: 0,
      nextAttemptAt: null,
      lastError: null,
      relatedType: input.relatedType ?? null,
      relatedId: input.relatedId ?? null,
    });

    if (!isSmtpConfigured()) {
      // Outbox-only simulated delivery mode
      this.outboxRepo.updateDeliveryStatus(id, {
        status: 'SENT',
        attempts: 1,
        nextAttemptAt: null,
        lastError: null,
      });
      return { ...outbox, status: 'SENT', attempts: 1 };
    }

    try {
      const transporter = nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.port === 465,
        auth: {
          user: config.smtp.user,
          pass: config.smtp.pass,
        },
      });
      await transporter.sendMail({
        from: config.smtp.from,
        to: input.to,
        subject: input.subject,
        html,
      });
      this.outboxRepo.updateDeliveryStatus(id, {
        status: 'SENT',
        attempts: 1,
        nextAttemptAt: null,
        lastError: null,
      });
      return { ...outbox, status: 'SENT', attempts: 1 };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'SMTP delivery failed';
      logger.warn('Email delivery failed; queued for retry', { emailId: id, error: errMsg });
      const nextRetry = new Date(Date.now() + 30_000).toISOString();
      this.outboxRepo.updateDeliveryStatus(id, {
        status: 'QUEUED',
        attempts: 1,
        nextAttemptAt: nextRetry,
        lastError: errMsg,
      });
      return { ...outbox, status: 'QUEUED', attempts: 1, nextAttemptAt: nextRetry, lastError: errMsg };
    }
  }

  listOutbox(
    ctx: TenantContext,
    filter: EmailOutboxListFilter,
  ): { items: EmailOutboxItem[]; total: number } {
    return this.outboxRepo.list(ctx, filter);
  }
}
