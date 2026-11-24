import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Download, Radio } from 'lucide-react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  DeviceDetail,
  DeviceTelemetryResponse,
  TelemetryPoint,
  TelemetryRange,
} from '../../../shared/types.ts';
import { ApiClientError, apiRequest } from '../../api/client.ts';
import { Button, Card, EmptyState, ErrorState } from '../ui/index.ts';
import { downloadTextFile } from '../../utils/csv.ts';

const RANGES: Array<{ value: TelemetryRange; label: string }> = [
  { value: '15m', label: '15m' },
  { value: '1h', label: '1h' },
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
];

const METRIC_COLORS = ['#4f46e5', '#0284c7', '#059669', '#d97706', '#7c3aed'];

function formatChartTime(iso: string, range: TelemetryRange): string {
  const d = new Date(iso);
  if (range === '7d') {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit' });
  }
  if (range === '24h') {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function computeStats(points: TelemetryPoint[]) {
  const nums = points
    .map((p) => p.value)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (nums.length === 0) return null;
  const latest = nums[nums.length - 1];
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const avg = Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
  return { latest, min, max, avg };
}

export function DeviceTelemetryTab({ device }: { device: DeviceDetail }) {
  const [range, setRange] = useState<TelemetryRange>('1h');
  const [liveRefresh, setLiveRefresh] = useState(true);

  const telemetryQuery = useQuery({
    queryKey: ['device-telemetry', device.id, range],
    queryFn: () =>
      apiRequest<DeviceTelemetryResponse>(`/devices/${device.id}/telemetry`, {
        query: { range },
      }),
    refetchInterval: liveRefresh ? 5000 : false,
  });

  const handleExportCsv = () => {
    const data = telemetryQuery.data;
    if (!data) return;

    const metricKeys = data.metrics.map((m) => m.key);
    const byTs = new Map<string, Record<string, string | number | boolean>>();

    for (const key of metricKeys) {
      for (const pt of data.series[key] ?? []) {
        const row = byTs.get(pt.ts) ?? {};
        if (pt.value !== null) {
          row[key] = pt.value;
        }
        byTs.set(pt.ts, row);
      }
    }

    const sortedTimestamps = Array.from(byTs.keys()).sort();
    const header = ['timestamp', ...metricKeys].join(',');
    const lines = sortedTimestamps.map((ts) => {
      const row = byTs.get(ts)!;
      return [ts, ...metricKeys.map((k) => (row[k] !== undefined ? String(row[k]) : ''))].join(',');
    });

    downloadTextFile(
      `${device.serialNumber}-telemetry-${range}.csv`,
      [header, ...lines].join('\n'),
      'text/csv;charset=utf-8',
    );
  };

  const data = telemetryQuery.data;
  const hasAnyPoints =
    data !== undefined &&
    Object.values(data.series).some((pts) => pts.length > 0);

  // Merge CPU + Memory health series by timestamp for a combined diagnostics chart
  const healthChartData = React.useMemo(() => {
    if (!data) return [];
    const map = new Map<string, { ts: string; cpuLoad?: number; memoryUsage?: number }>();
    for (const pt of data.healthSeries.cpuLoad) {
      const entry = map.get(pt.ts) ?? { ts: pt.ts };
      if (typeof pt.value === 'number') entry.cpuLoad = pt.value;
      map.set(pt.ts, entry);
    }
    for (const pt of data.healthSeries.memoryUsage) {
      const entry = map.get(pt.ts) ?? { ts: pt.ts };
      if (typeof pt.value === 'number') entry.memoryUsage = pt.value;
      map.set(pt.ts, entry);
    }
    return Array.from(map.values()).sort((a, b) => (a.ts < b.ts ? -1 : 1));
  }, [data]);

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <Card className="p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5" role="group" aria-label="Telemetry time range">
          {RANGES.map((r) => (
            <button
              key={r.value}
              type="button"
              aria-pressed={range === r.value}
              onClick={() => setRange(r.value)}
              className={`h-8 px-3 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                range === r.value
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            type="button"
            aria-pressed={liveRefresh}
            onClick={() => setLiveRefresh((v) => !v)}
            className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
              liveRefresh
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Radio className="w-3.5 h-3.5" aria-hidden="true" />
            {liveRefresh ? 'Live 5s refresh' : 'Paused'}
          </button>

          <Button
            variant="secondary"
            size="sm"
            disabled={!hasAnyPoints}
            onClick={handleExportCsv}
            icon={<Download className="w-3.5 h-3.5" />}
          >
            Export CSV
          </Button>
        </div>
      </Card>

      {telemetryQuery.isError ? (
        <ErrorState
          message={
            telemetryQuery.error instanceof ApiClientError
              ? telemetryQuery.error.message
              : 'Unable to load telemetry history.'
          }
          onRetry={() => void telemetryQuery.refetch()}
        />
      ) : telemetryQuery.isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-72 bg-white border border-slate-200 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : !hasAnyPoints ? (
        <Card>
          <EmptyState
            icon={<Activity className="w-7 h-7" />}
            title="No telemetry samples in this time range"
            description="Try a wider time range (24h or 7d), or start this device in the Simulator to stream live readings."
            action={
              range !== '7d' ? (
                <Button size="sm" variant="secondary" onClick={() => setRange('7d')}>
                  Switch to 7d range
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => void telemetryQuery.refetch()}>
                  Refresh telemetry
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {(data?.metrics ?? []).map((metric, idx) => {
              const points = data?.series[metric.key] ?? [];
              const stats = computeStats(points);
              const color = METRIC_COLORS[idx % METRIC_COLORS.length];

              return (
                <Card key={metric.key} className="p-5">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">
                        {metric.label}
                        {metric.unit ? (
                          <span className="ml-1.5 text-xs font-mono font-normal text-slate-500">
                            ({metric.unit})
                          </span>
                        ) : null}
                      </h3>
                      <p className="text-xs font-mono text-slate-500 mt-0.5">
                        {metric.key} · {points.length} points
                        {metric.min !== null || metric.max !== null
                          ? ` · limits ${metric.min ?? '−∞'}..${metric.max ?? '+∞'}`
                          : ''}
                      </p>
                    </div>
                    {stats && (
                      <div className="text-right font-mono tabular-nums">
                        <p className="text-lg font-semibold text-slate-900">
                          {stats.latest}
                          {metric.unit ? ` ${metric.unit}` : ''}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          min {stats.min} · avg {stats.avg} · max {stats.max}
                        </p>
                      </div>
                    )}
                  </div>

                  {points.length === 0 ? (
                    <div className="h-56 flex items-center justify-center text-xs text-slate-600">
                      No samples recorded for {metric.label} in the last {range}.
                    </div>
                  ) : (
                    <div className="h-56 w-full" aria-label={`${metric.label} trend chart`}>
                      {stats && (
                        <p className="sr-only">
                          {metric.label} over last {range}: latest {stats.latest}
                          {metric.unit ? ` ${metric.unit}` : ''}, min {stats.min}, average {stats.avg}, max{' '}
                          {stats.max} across {points.length} samples.
                        </p>
                      )}
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                          data={points}
                          margin={{ top: 8, right: 16, left: 0, bottom: 4 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                          <XAxis
                            dataKey="ts"
                            tickFormatter={(v) => formatChartTime(String(v), range)}
                            tick={{ fontSize: 11, fill: '#475569' }}
                            minTickGap={28}
                          />
                          <YAxis
                            tick={{ fontSize: 11, fill: '#475569' }}
                            width={48}
                            domain={['auto', 'auto']}
                          />
                          <Tooltip
                            labelFormatter={(label) => new Date(String(label)).toLocaleString()}
                            formatter={(value) => [
                              `${String(value)}${metric.unit ? ` ${metric.unit}` : ''}`,
                              metric.label,
                            ]}
                            contentStyle={{
                              fontSize: '12px',
                              borderRadius: '8px',
                              borderColor: '#e2e8f0',
                            }}
                          />
                          {metric.max !== null && metric.max <= 500 && (
                            <ReferenceLine
                              y={metric.max}
                              stroke="#ef4444"
                              strokeDasharray="4 4"
                              strokeOpacity={0.5}
                            />
                          )}
                          {metric.min !== null && metric.min > 0 && (
                            <ReferenceLine
                              y={metric.min}
                              stroke="#0284c7"
                              strokeDasharray="4 4"
                              strokeOpacity={0.5}
                            />
                          )}
                          <Line
                            type="monotone"
                            dataKey="value"
                            stroke={color}
                            strokeWidth={2}
                            dot={points.length <= 25 ? { r: 2.5 } : false}
                            isAnimationActive={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>

          {healthChartData.length > 0 && (
            <Card className="p-5">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    System Health (CPU & Memory %)
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Diagnostic readings reported alongside telemetry and heartbeats.
                  </p>
                </div>
              </div>
              <div className="h-52 w-full">
                <p className="sr-only">
                  System health trend over last {range} with {healthChartData.length} CPU and memory
                  samples.
                </p>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={healthChartData}
                    margin={{ top: 8, right: 16, left: 0, bottom: 4 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                      dataKey="ts"
                      tickFormatter={(v) => formatChartTime(String(v), range)}
                      tick={{ fontSize: 11, fill: '#475569' }}
                      minTickGap={28}
                    />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#475569' }} width={40} />
                    <Tooltip
                      labelFormatter={(label) => new Date(String(label)).toLocaleString()}
                      contentStyle={{
                        fontSize: '12px',
                        borderRadius: '8px',
                        borderColor: '#e2e8f0',
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                    <Line
                      type="monotone"
                      dataKey="cpuLoad"
                      name="CPU Load %"
                      stroke="#4f46e5"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="memoryUsage"
                      name="Memory %"
                      stroke="#059669"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
