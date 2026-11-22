import React, { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Activity, AlertTriangle, Check, CheckCircle2, FileDown } from 'lucide-react';
import {
  buildHourlyErrorIntensitySeries,
  type ExchangeSyncErrorLogEntry,
  type HourlyErrorIntensityPoint,
} from '../lib/exchangeSyncErrorLog';
import type { ExchangeId } from '../types/domain';
import { downloadAnomalyPdfReport } from '../utils/anomalyPdfReport';
import { triggerHaptic } from '../lib/securityDlp';

interface SyncErrorIntensityChartProps {
  logs: ExchangeSyncErrorLogEntry[];
  exchangeFilter?: 'all' | ExchangeId;
  compact?: boolean;
}

interface IntensityTooltipProps {
  active?: boolean;
  payload?: Array<{ payload?: HourlyErrorIntensityPoint }>;
  anomalyThreshold: number;
}

const IntensityTooltip: React.FC<IntensityTooltipProps> = ({
  active,
  payload,
  anomalyThreshold,
}) => {
  if (!active || !payload || payload.length === 0 || !payload[0]?.payload) return null;
  const point = payload[0].payload;

  return (
    <div className="rounded-xl border border-white/15 bg-[#070B12]/95 px-3 py-2 text-xs shadow-xl backdrop-blur-md space-y-1 font-mono tabular-nums">
      <div className="font-sans font-semibold text-white flex items-center justify-between gap-3">
        <span>{point.fullRangeLabel}</span>
        {point.isAnomaly && (
          <span className="rounded bg-rose-500/25 border border-rose-500/40 px-1.5 py-0.5 text-[10px] font-semibold text-rose-200">
            Аномалия
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="font-sans text-rose-300">Всего ошибок / час:</span>
        <span className="text-white font-bold">{point.errors}</span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="font-sans text-rose-400/90">Критические:</span>
        <span className="text-rose-200 font-semibold">{point.critical}</span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="font-sans text-amber-300">Предупреждения:</span>
        <span className="text-amber-200 font-semibold">{point.warning}</span>
      </div>
      <div className="pt-1 border-t border-white/10 text-[10px] font-sans text-slate-400">
        Порог аномалии: ≥{anomalyThreshold} ош./ч
      </div>
    </div>
  );
};

interface AnomalyDotProps {
  cx?: number;
  cy?: number;
  payload?: HourlyErrorIntensityPoint;
}

const AnomalyMarkerDot: React.FC<AnomalyDotProps> = ({ cx, cy, payload }) => {
  if (typeof cx !== 'number' || typeof cy !== 'number' || !payload) return null;
  if (payload.isAnomaly) {
    return (
      <g>
        <circle cx={cx} cy={cy} r={8} fill="rgba(244, 63, 94, 0.24)" />
        <circle cx={cx} cy={cy} r={4.5} fill="#F43F5E" stroke="#FFE4E6" strokeWidth={1.5} />
      </g>
    );
  }
  if (payload.errors > 0) {
    return <circle cx={cx} cy={cy} r={2.8} fill="#FB7185" stroke="#0B0F17" strokeWidth={1} />;
  }
  return null;
};

export const SyncErrorIntensityChart: React.FC<SyncErrorIntensityChartProps> = React.memo(
  ({ logs, exchangeFilter = 'all', compact = false }) => {
    const [windowHours, setWindowHours] = useState<24 | 72>(24);
    const [pdfStatus, setPdfStatus] = useState<'idle' | 'done' | 'error'>('idle');

    const scopedLogs = useMemo(
      () =>
        exchangeFilter === 'all'
          ? logs
          : logs.filter((entry) => entry.exchange === exchangeFilter),
      [logs, exchangeFilter]
    );

    const series = useMemo(
      () => buildHourlyErrorIntensitySeries(scopedLogs, { windowHours }),
      [scopedLogs, windowHours]
    );

    const handleDownloadPdf = () => {
      triggerHaptic(10);
      try {
        downloadAnomalyPdfReport(logs, { windowHours, exchangeFilter });
        setPdfStatus('done');
        window.setTimeout(() => setPdfStatus('idle'), 2200);
      } catch {
        setPdfStatus('error');
        window.setTimeout(() => setPdfStatus('idle'), 2600);
      }
    };

    const yMax = Math.max(series.peakErrorsPerHour + 1, series.anomalyThreshold + 1, 3);
    const xTickInterval = windowHours === 72 ? 11 : 3;

    return (
      <div
        className={
          compact
            ? 'space-y-3 pt-2 border-t border-white/8'
            : 'rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-5 space-y-4'
        }
      >
        {/* Header + Window Selector + PDF Export */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Activity
                className={`w-3.5 h-3.5 shrink-0 ${
                  series.anomalyHoursCount > 0
                    ? 'text-rose-400'
                    : series.totalErrors > 0
                      ? 'text-amber-400'
                      : 'text-emerald-400'
                }`}
              />
              <h3 className={compact ? 'text-xs font-semibold text-white' : 'text-base font-semibold text-white'}>
                Интенсивность ошибок синхронизации (ошибки/час)
                {exchangeFilter !== 'all' ? ` · ${exchangeFilter.toUpperCase()}` : ''}
              </h3>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Линейный тренд сбоев API бирж по часам с выделением периодов аномальной активности.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            {series.anomalyHoursCount > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-rose-200 tabular-nums">
                <AlertTriangle className="w-3 h-3 text-rose-400 shrink-0" />
                <span>Аномалий: {series.anomalyHoursCount}ч</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-medium text-emerald-300">
                <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                <span>Без аномалий</span>
              </span>
            )}

            <div
              role="group"
              aria-label="Период графика интенсивности ошибок"
              className="inline-flex items-center rounded-lg border border-white/10 bg-[#070B12] p-0.5"
            >
              {([24, 72] as const).map((hrs) => {
                const active = windowHours === hrs;
                return (
                  <button
                    key={hrs}
                    type="button"
                    onClick={() => setWindowHours(hrs)}
                    className={`min-h-[26px] px-2 rounded-md font-mono text-[10px] font-semibold transition-colors ${
                      active
                        ? 'bg-emerald-500/25 text-emerald-200 border border-emerald-500/40'
                        : 'text-slate-400 hover:text-white border border-transparent'
                    }`}
                  >
                    {hrs}ч
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={handleDownloadPdf}
              className={`min-h-[28px] px-2.5 rounded-lg border text-[11px] font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                pdfStatus === 'done'
                  ? 'border-emerald-400/50 bg-emerald-500/25 text-emerald-100'
                  : pdfStatus === 'error'
                    ? 'border-rose-400/50 bg-rose-500/20 text-rose-200'
                    : 'border-emerald-500/35 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200'
              }`}
              title={`Скачать краткую PDF-сводку аномалий за ${windowHours}ч`}
            >
              {pdfStatus === 'done' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
                  <span>PDF скачан</span>
                </>
              ) : pdfStatus === 'error' ? (
                <>
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-300 shrink-0" />
                  <span>Ошибка PDF</span>
                </>
              ) : (
                <>
                  <FileDown className="w-3.5 h-3.5 shrink-0" />
                  <span>Скачать PDF-отчет</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
          <div className="rounded-lg border border-white/8 bg-[#070B12]/70 px-2.5 py-1.5">
            <div className="text-slate-400 text-[10px]">Ошибок за {windowHours}ч</div>
            <div className="mt-0.5 font-mono tabular-nums text-sm font-bold text-white">
              {series.totalErrors}
            </div>
          </div>
          <div className="rounded-lg border border-white/8 bg-[#070B12]/70 px-2.5 py-1.5">
            <div className="text-slate-400 text-[10px]">Пик (ош./час)</div>
            <div className="mt-0.5 font-mono tabular-nums text-sm font-bold text-rose-300 truncate">
              {series.peakHourLabel}
            </div>
          </div>
          <div className="rounded-lg border border-white/8 bg-[#070B12]/70 px-2.5 py-1.5">
            <div className="text-slate-400 text-[10px]">Среднее / час</div>
            <div className="mt-0.5 font-mono tabular-nums text-sm font-bold text-slate-200">
              {series.avgErrorsPerHour.toFixed(2)}
            </div>
          </div>
          <div className="rounded-lg border border-white/8 bg-[#070B12]/70 px-2.5 py-1.5">
            <div className="text-slate-400 text-[10px]">Порог аномалии</div>
            <div className="mt-0.5 font-mono tabular-nums text-sm font-bold text-amber-300">
              ≥{series.anomalyThreshold} ош./ч
            </div>
          </div>
        </div>

        {/* Line Chart */}
        <div className="rounded-xl border border-white/8 bg-[#070B12]/80 px-2 pt-3 pb-2">
          <div className={compact ? 'h-[190px] w-full' : 'h-[225px] w-full'}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={series.points}
                margin={{ top: 10, right: 10, left: -22, bottom: 0 }}
              >
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#94A3B8', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                  axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                  tickLine={false}
                  interval={xTickInterval}
                  minTickGap={16}
                />
                <YAxis
                  allowDecimals={false}
                  domain={[0, yMax]}
                  tick={{ fill: '#64748B', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ stroke: 'rgba(255,255,255,0.16)', strokeDasharray: '3 3' }}
                  content={<IntensityTooltip anomalyThreshold={series.anomalyThreshold} />}
                />
                <ReferenceLine
                  y={series.anomalyThreshold}
                  stroke="#F59E0B"
                  strokeDasharray="4 4"
                  strokeOpacity={0.75}
                />
                <Line
                  type="monotone"
                  dataKey="errors"
                  name="Все ошибки / час"
                  stroke="#F43F5E"
                  strokeWidth={2.2}
                  dot={<AnomalyMarkerDot />}
                  activeDot={{ r: 5, fill: '#F43F5E', stroke: '#FFE4E6', strokeWidth: 1.5 }}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="critical"
                  name="Критические / час"
                  stroke="#FB923C"
                  strokeWidth={1.5}
                  strokeDasharray="3 3"
                  dot={false}
                  activeDot={{ r: 4, fill: '#FB923C', stroke: '#070B12', strokeWidth: 1 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-2 px-1 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-400">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-0.5 rounded bg-rose-500" aria-hidden="true" />
                <span>Все ошибки / ч</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-0.5 rounded border-t border-dashed border-orange-400" aria-hidden="true" />
                <span>Критические / ч</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-0.5 rounded border-t border-dashed border-amber-400" aria-hidden="true" />
                <span>Порог аномалии</span>
              </span>
            </div>
            <span className="font-mono text-slate-500">
              Красное кольцо — аномальный всплеск
            </span>
          </div>
        </div>
      </div>
    );
  }
);

SyncErrorIntensityChart.displayName = 'SyncErrorIntensityChart';
