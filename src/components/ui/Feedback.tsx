import React, { createContext, useCallback, useContext, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, RefreshCw, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatLocalDateTime, formatRelativeTime } from '../../utils/format.ts';
import { Button } from './Button.tsx';

// --- Toast System (aria-live) ---

type ToastKind = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
}

interface ToastContextValue {
  toast: (input: { kind?: ToastKind; title: string; description?: string }) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback(
    (input: { kind?: ToastKind; title: string; description?: string }) => {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      const item: ToastItem = {
        id,
        kind: input.kind ?? 'info',
        title: input.title,
        description: input.description,
      };
      setToasts((prev) => [...prev.slice(-3), item]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4500);
    },
    [],
  );

  const dismiss = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="fixed bottom-20 md:bottom-4 right-0 md:right-4 z-50 flex flex-col gap-2 w-full max-w-sm pointer-events-none px-4 md:px-0"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto flex items-start gap-3 rounded-xl bg-white border border-slate-200 shadow-lg p-3.5 text-sm"
          >
            {t.kind === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
            ) : t.kind === 'error' ? (
              <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
            ) : (
              <Info className="w-4 h-4 text-indigo-600 mt-0.5 shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p className="font-medium text-slate-900">{t.title}</p>
              {t.description && <p className="text-xs text-slate-600 mt-0.5">{t.description}</p>}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              className="p-1 -m-1 rounded text-slate-500 hover:text-slate-700 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

// --- Status & Severity Indicators (Section 11 exact color map, always paired with text) ---

type SemanticTone = 'emerald' | 'red' | 'amber' | 'sky' | 'slate';

const STATUS_TONE_MAP: Record<string, SemanticTone> = {
  ONLINE: 'emerald',
  ACTIVE: 'emerald',
  VERIFIED: 'emerald',
  APPLIED: 'emerald',
  RELEASED: 'emerald',
  COMPLETED: 'emerald',
  RESOLVED: 'emerald',
  FIXED: 'emerald',
  SUCCESS: 'emerald',
  SENT: 'emerald',
  APPROVED: 'emerald',

  OFFLINE: 'red',
  FAILED: 'red',
  FAILURE: 'red',
  CRITICAL: 'red',
  REJECTED: 'red',

  WARNING: 'amber',
  HIGH: 'amber',
  PARTIAL: 'amber',
  ACKNOWLEDGED: 'amber',
  PENDING: 'amber',
  PENDING_APPROVAL: 'amber',
  UNDER_MAINTENANCE: 'amber',
  WAITING_ON_CLIENT: 'amber',
  IN_PROGRESS: 'amber',
  DOWNLOADING: 'amber',
  INSTALLING: 'amber',
  ROLLED_BACK: 'amber',

  PROVISIONED: 'sky',
  QUEUED: 'sky',
  DRAFT: 'sky',
  OPEN: 'sky',
  PLANNED: 'sky',
  ASSIGNED: 'sky',
  MEDIUM: 'sky',
  REPLACED: 'sky',
  PREVENTIVE: 'sky',
  CORRECTIVE: 'amber',
  RUNNING: 'sky',
  INFO: 'sky',

  LOW: 'slate',
  NONE: 'slate',
  NOT_REQUIRED: 'slate',
  SUSPENDED: 'slate',
  CANCELLED: 'slate',
  DECOMMISSIONED: 'slate',
  WITHDRAWN: 'slate',
  CLOSED: 'slate',
  INACTIVE: 'slate',
  UNKNOWN: 'slate',
};

const TONE_CLASSES: Record<SemanticTone, string> = {
  emerald: 'text-emerald-800 bg-emerald-50 border-emerald-200',
  red: 'text-red-800 bg-red-50 border-red-200',
  amber: 'text-amber-900 bg-amber-50 border-amber-300',
  sky: 'text-sky-800 bg-sky-50 border-sky-200',
  slate: 'text-slate-700 bg-slate-100 border-slate-300',
};

function formatEnumLabel(value: string): string {
  return value
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function StatusChip({ status, label }: { status: string; label?: string }) {
  const tone = STATUS_TONE_MAP[status.toUpperCase()] ?? 'slate';
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-md border whitespace-nowrap ${TONE_CLASSES[tone]}`}
    >
      {label ?? formatEnumLabel(status)}
    </span>
  );
}

export function SeverityChip({ severity }: { severity: 'WARNING' | 'CRITICAL' | string }) {
  return <StatusChip status={severity} />;
}

// --- Surface & Layout Components ---

export function Card({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-white border border-slate-200 rounded-xl ${className}`}>{children}</div>
  );
}

export function KpiCard({
  label,
  value,
  subtext,
  tone = 'default',
  loading = false,
}: {
  label: string;
  value: string | number;
  subtext?: string;
  tone?: 'default' | 'emerald' | 'amber' | 'red';
  loading?: boolean;
}) {
  if (loading) {
    return (
      <Card className="p-5">
        <div className="h-3.5 w-24 rounded bg-slate-200/80 animate-pulse" />
        <div className="mt-3 h-7 w-20 rounded bg-slate-200 animate-pulse" />
        <div className="mt-2.5 h-3 w-32 rounded bg-slate-100 animate-pulse" />
      </Card>
    );
  }

  const valueCls =
    tone === 'emerald'
      ? 'text-emerald-700'
      : tone === 'amber'
        ? 'text-amber-800'
        : tone === 'red'
          ? 'text-red-700'
          : 'text-slate-900';

  return (
    <Card className="p-5">
      <p className="text-xs font-medium text-slate-600">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tracking-tight font-mono tabular-nums ${valueCls}`}>
        {value}
      </p>
      {subtext && <p className="mt-1.5 text-xs text-slate-600">{subtext}</p>}
    </Card>
  );
}

export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
}: {
  title: string;
  description?: string;
  breadcrumbs?: Array<{ label: string; to?: string }>;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 pb-6">
      <div className="min-w-0">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-slate-600 mb-1.5">
            {breadcrumbs.map((crumb, idx) => (
              <React.Fragment key={crumb.label}>
                {idx > 0 && <span aria-hidden="true">/</span>}
                {crumb.to ? (
                  <Link to={crumb.to} className="hover:text-indigo-600 transition-colors rounded">
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="text-slate-800 font-medium">{crumb.label}</span>
                )}
              </React.Fragment>
            ))}
          </nav>
        )}
        <h1 className="text-xl font-semibold text-slate-900 tracking-tight text-balance">{title}</h1>
        {description && <p className="text-sm text-slate-600 mt-1">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0 flex-wrap">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6">
      {icon && <div className="text-slate-500 mb-3">{icon}</div>}
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <p className="text-sm text-slate-600 mt-1 max-w-md">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center text-center py-10 px-6 bg-white border border-red-200 rounded-xl"
    >
      <AlertCircle className="w-6 h-6 text-red-600 mb-2" />
      <h3 className="text-sm font-semibold text-slate-900">Unable to load data</h3>
      <p className="text-sm text-slate-600 mt-1 max-w-md">{message}</p>
      {onRetry && (
        <div className="mt-4">
          <Button variant="secondary" size="sm" onClick={onRetry} icon={<RefreshCw className="w-3.5 h-3.5" />}>
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}

export function RelativeTime({ iso }: { iso: string | null | undefined }) {
  if (!iso) {
    return <span className="text-slate-500 text-xs">Never</span>;
  }
  const absolute = formatLocalDateTime(iso);
  return (
    <time dateTime={iso} title={absolute} className="font-mono text-xs tabular-nums text-slate-600">
      {formatRelativeTime(iso)}
    </time>
  );
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ id: string; label: string; count?: number }>;
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="border-b border-slate-200 flex items-center gap-6 overflow-x-auto" role="tablist">
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={`pb-3 pt-1 px-0.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer rounded-t focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-1 ${
              isActive
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className="ml-1.5 font-mono text-xs tabular-nums text-slate-500">
                ({tab.count})
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
