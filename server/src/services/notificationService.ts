import type { NotificationItem, NotificationsResponse } from '../../../shared/types.ts';
import type {
  INotificationRepository,
  TenantContext,
  UserRecord,
} from '../repositories/types.ts';
import { Errors } from '../utils/errors.ts';
import { generateId } from '../utils/ids.ts';
import type { EmailService } from './emailService.ts';

export interface DispatchNotificationInput {
  tenantId: string | null;
  type: string;
  title: string;
  body: string;
  link: string | null;
  emailSubject: string;
  emailSummary: string;
  emailFacts: Array<{ label: string; value: string }>;
  emailCtaLabel?: string;
  relatedType?: string | null;
  relatedId?: string | null;
}

export class NotificationService {
  constructor(
    private readonly notifications: INotificationRepository,
    private readonly emailService: EmailService,
  ) {}

  listForCurrentUser(
    ctx: TenantContext,
    filter: { unreadOnly?: boolean; page: number; pageSize: number },
  ): NotificationsResponse {
    const result = this.notifications.listForUser(ctx.userId, filter);
    return {
      items: result.items,
      total: result.total,
      unreadCount: result.unreadCount,
      page: filter.page,
      pageSize: filter.pageSize,
    };
  }

  markRead(ctx: TenantContext, id: string): NotificationItem {
    const updated = this.notifications.markReadForUser(ctx.userId, id);
    if (!updated) {
      throw Errors.notFound('Notification not found');
    }
    return updated;
  }

  markAllRead(ctx: TenantContext): { markedCount: number } {
    const markedCount = this.notifications.markAllReadForUser(ctx.userId);
    return { markedCount };
  }

  /**
   * Creates in-app notifications AND non-blocking queued email outbox rows for each unique user.
   */
  notifyUsersSystem(users: UserRecord[], input: DispatchNotificationInput): void {
    const seen = new Set<string>();
    for (const user of users) {
      if (user.status !== 'ACTIVE') continue;
      if (seen.has(user.id)) continue;
      seen.add(user.id);

      this.notifications.insertSystem({
        id: generateId('ntf'),
        tenantId: input.tenantId,
        userId: user.id,
        type: input.type,
        title: input.title,
        body: input.body,
        link: input.link,
        read: false,
      });

      this.emailService.enqueue({
        tenantId: input.tenantId,
        to: user.email,
        subject: input.emailSubject,
        summary: input.emailSummary,
        facts: input.emailFacts,
        ctaLabel: input.emailCtaLabel,
        ctaPath: input.link ?? undefined,
        relatedType: input.relatedType ?? null,
        relatedId: input.relatedId ?? null,
      });
    }
  }
}
