import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Cpu, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { DevicePublic, PaginatedResponse } from '../../../shared/types.ts';
import { apiRequest } from '../../api/client.ts';
import { useAuth } from '../../auth/AuthContext.tsx';
import { StatusChip } from '../ui/index.ts';

/**
 * Global Device Search in the top bar (Section 10.1):
 * Searches devices by serial, name, hardware ID, or ID and navigates straight to /devices/:id.
 */
export function GlobalDeviceSearch() {
  const { activeTenantId } = useAuth();
  const navigate = useNavigate();
  const [queryText, setQueryText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(queryText.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [queryText]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const searchQuery = useQuery({
    queryKey: ['global-device-search', activeTenantId, debounced],
    enabled: debounced.length >= 2,
    queryFn: () =>
      apiRequest<PaginatedResponse<DevicePublic>>('/devices', {
        query: { q: debounced, page: 1, pageSize: 8 },
      }),
  });

  const results = searchQuery.data?.items ?? [];

  return (
    <div ref={containerRef} className="relative hidden md:block w-64 lg:w-80">
      <Search
        className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
        aria-hidden="true"
      />
      <input
        type="search"
        aria-label="Global device search"
        value={queryText}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQueryText(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false);
          } else if (e.key === 'Enter' && results.length > 0) {
            e.preventDefault();
            setOpen(false);
            setQueryText('');
            navigate(`/devices/${results[0].id}`);
          }
        }}
        placeholder="Jump to device (name, serial, ID)..."
        className="w-full h-8 pl-9 pr-3 rounded-lg border border-slate-300 bg-slate-50/70 text-xs text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
      />

      {open && debounced.length >= 2 && (
        <div
          role="listbox"
          aria-label="Device search results"
          className="absolute left-0 right-0 mt-1.5 rounded-xl bg-white border border-slate-200 shadow-lg overflow-hidden z-40"
        >
          {searchQuery.isLoading ? (
            <p className="px-3.5 py-3 text-xs text-slate-500">Searching devices...</p>
          ) : results.length === 0 ? (
            <p className="px-3.5 py-3 text-xs text-slate-500">No devices matching "{debounced}"</p>
          ) : (
            <ul className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
              {results.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected="false"
                    onClick={() => {
                      setOpen(false);
                      setQueryText('');
                      navigate(`/devices/${d.id}`);
                    }}
                    className="w-full px-3.5 py-2.5 text-left hover:bg-slate-50 flex items-center justify-between gap-2 cursor-pointer"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Cpu className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="text-xs font-medium text-slate-900 truncate">
                          {d.name}
                        </span>
                      </div>
                      <p className="text-[11px] font-mono text-slate-500 truncate mt-0.5">
                        {d.serialNumber} · {d.siteName ?? d.siteId}
                      </p>
                    </div>
                    <StatusChip status={d.state} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
