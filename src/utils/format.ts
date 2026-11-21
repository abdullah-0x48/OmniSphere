import { format, formatDistanceToNow } from 'date-fns';

/**
 * Formats a UTC ISO timestamp in the user's local browser time (NFR-12, Section 11).
 * Example: "21 Nov 2026, 14:05"
 */
export function formatLocalDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return format(date, 'dd MMM yyyy, HH:mm');
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return formatDistanceToNow(date, { addSuffix: true });
}
