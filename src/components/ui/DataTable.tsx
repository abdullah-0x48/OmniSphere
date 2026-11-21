import React from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './Button.tsx';
import { EmptyState, ErrorState } from './Feedback.tsx';

export interface Column<T> {
  key: string;
  header: string;
  sortKey?: string;
  align?: 'left' | 'right';
  render: (row: T) => React.ReactNode;
  hideOnMobile?: boolean;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  sort?: string;
  onSortChange?: (sort: string) => void;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  onRowClick?: (row: T) => void;
  expandedRowId?: string | null;
  renderExpanded?: (row: T) => React.ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  total,
  page,
  pageSize,
  onPageChange,
  sort,
  onSortChange,
  isLoading = false,
  error,
  onRetry,
  emptyTitle = 'No records found',
  emptyDescription = 'Try adjusting your search or filter criteria.',
  emptyAction,
  onRowClick,
  expandedRowId,
  renderExpanded,
}: DataTableProps<T>) {
  if (error) {
    return <ErrorState message={error} onRetry={onRetry} />;
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const [sortField, sortDir] = sort ? sort.split(':') : ['', ''];

  const handleSort = (sortKey: string) => {
    if (!onSortChange) return;
    if (sortField === sortKey) {
      onSortChange(`${sortKey}:${sortDir === 'asc' ? 'desc' : 'asc'}`);
    } else {
      onSortChange(`${sortKey}:asc`);
    }
  };

  if (!isLoading && rows.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl">
        <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* Desktop Table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/70">
              {columns.map((col) => {
                const isSorted = col.sortKey && sortField === col.sortKey;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    className={`px-4 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap ${
                      col.align === 'right' ? 'text-right' : 'text-left'
                    }`}
                  >
                    {col.sortKey && onSortChange ? (
                      <button
                        type="button"
                        onClick={() => handleSort(col.sortKey!)}
                        className="inline-flex items-center gap-1 hover:text-slate-900 cursor-pointer"
                      >
                        <span>{col.header}</span>
                        {isSorted ? (
                          sortDir === 'asc' ? (
                            <ArrowUp className="w-3.5 h-3.5 text-indigo-600" />
                          ) : (
                            <ArrowDown className="w-3.5 h-3.5 text-indigo-600" />
                          )
                        ) : (
                          <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                        )}
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading
              ? Array.from({ length: 5 }).map((_, idx) => (
                  <tr key={idx}>
                    {columns.map((col) => (
                      <td key={col.key} className="px-4 py-3.5">
                        <div className="h-4 bg-slate-100 rounded animate-pulse w-3/4" />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((row) => {
                  const id = rowKey(row);
                  const isExpanded = expandedRowId === id;
                  return (
                    <React.Fragment key={id}>
                      <tr
                        onClick={onRowClick ? () => onRowClick(row) : undefined}
                        className={`transition-colors ${
                          onRowClick ? 'hover:bg-slate-50 cursor-pointer' : 'hover:bg-slate-50/60'
                        }`}
                      >
                        {columns.map((col) => (
                          <td
                            key={col.key}
                            className={`px-4 py-3 text-sm text-slate-700 align-middle ${
                              col.align === 'right' ? 'text-right' : 'text-left'
                            }`}
                          >
                            {col.render(row)}
                          </td>
                        ))}
                      </tr>
                      {isExpanded && renderExpanded && (
                        <tr className="bg-slate-50/80">
                          <td colSpan={columns.length} className="px-4 py-4">
                            {renderExpanded(row)}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
          </tbody>
        </table>
      </div>

      {/* Mobile Stacked Cards (Section 10.1) */}
      <div className="md:hidden divide-y divide-slate-200">
        {isLoading
          ? Array.from({ length: 3 }).map((_, idx) => (
              <div key={idx} className="p-4 space-y-2.5">
                <div className="h-4 bg-slate-100 rounded w-1/2 animate-pulse" />
                <div className="h-3.5 bg-slate-100 rounded w-3/4 animate-pulse" />
              </div>
            ))
          : rows.map((row) => {
              const id = rowKey(row);
              const isExpanded = expandedRowId === id;
              return (
                <div
                  key={id}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`p-4 space-y-2 ${onRowClick ? 'cursor-pointer active:bg-slate-50' : ''}`}
                >
                  {columns
                    .filter((c) => !c.hideOnMobile)
                    .map((col) => (
                      <div key={col.key} className="flex items-start justify-between gap-3 text-sm">
                        <span className="text-xs font-medium text-slate-500 shrink-0">
                          {col.header}
                        </span>
                        <div className="text-right min-w-0">{col.render(row)}</div>
                      </div>
                    ))}
                  {isExpanded && renderExpanded && (
                    <div className="pt-3 border-t border-slate-200">{renderExpanded(row)}</div>
                  )}
                </div>
              );
            })}
      </div>

      {/* Pagination Bar */}
      <div className="flex items-center justify-between gap-4 px-4 py-3 border-t border-slate-200 bg-slate-50/50 text-xs text-slate-600">
        <span className="font-mono tabular-nums">
          {total === 0
            ? '0 results'
            : `Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}
        </span>
        <div className="flex items-center gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1 || isLoading}
            icon={<ChevronLeft className="w-3.5 h-3.5" />}
          >
            Previous
          </Button>
          <span className="px-2 font-mono tabular-nums text-slate-700">
            {page} / {totalPages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages || isLoading}
          >
            <span className="inline-flex items-center gap-1">
              Next <ChevronRight className="w-3.5 h-3.5" />
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
}
