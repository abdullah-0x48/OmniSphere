import type Database from 'better-sqlite3';
import type { NotificationItem } from '../../../shared/types.ts';
import type { CreateNotificationInput, INotificationRepository } from './types.ts';

interface NotificationRow {
  id: string;
  tenant_id: string | null;
  user_id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  read: number;
  created_at: string;
}

function mapRow(row: NotificationRow): NotificationItem {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    type: row.type,
    title: row.title,
    body: row.body,
    link: row.link,
    read: row.read === 1,
    createdAt: row.created_at,
  };
}

export class SqliteNotificationRepository implements INotificationRepository {
  constructor(private readonly db: Database.Database) {}

  insertSystem(input: CreateNotificationInput): NotificationItem {
    const now = input.createdAt ?? new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO notifications (
          id, tenant_id, user_id, type, title, body, link, read, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.tenantId,
        input.userId,
        input.type,
        input.title,
        input.body,
        input.link,
        input.read ? 1 : 0,
        now,
      );
    const row = this.db
      .prepare('SELECT * FROM notifications WHERE id = ?')
      .get(input.id) as NotificationRow;
    return mapRow(row);
  }

  listForUser(
    userId: string,
    filter: { unreadOnly?: boolean; page: number; pageSize: number },
  ): { items: NotificationItem[]; total: number; unreadCount: number } {
    const conditions: string[] = ['user_id = ?'];
    const params: unknown[] = [userId];

    if (filter.unreadOnly) {
      conditions.push('read = 0');
    }

    const where = conditions.join(' AND ');
    const totalRow = this.db
      .prepare(`SELECT COUNT(*) AS count FROM notifications WHERE ${where}`)
      .get(...params) as { count: number };

    const unreadRow = this.db
      .prepare('SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read = 0')
      .get(userId) as { count: number };

    const offset = (filter.page - 1) * filter.pageSize;
    const rows = this.db
      .prepare(
        `SELECT * FROM notifications WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, filter.pageSize, offset) as NotificationRow[];

    return {
      items: rows.map(mapRow),
      total: totalRow.count,
      unreadCount: unreadRow.count,
    };
  }

  markReadForUser(userId: string, id: string): NotificationItem | null {
    const info = this.db
      .prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?')
      .run(id, userId);
    if (info.changes === 0) return null;
    const row = this.db
      .prepare('SELECT * FROM notifications WHERE id = ? AND user_id = ?')
      .get(id, userId) as NotificationRow | undefined;
    return row ? mapRow(row) : null;
  }

  markAllReadForUser(userId: string): number {
    const info = this.db
      .prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0')
      .run(userId);
    return info.changes;
  }
}
