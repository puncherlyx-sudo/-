import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { motion } from 'motion/react';
import type { SecurityAuditLog } from '../types/domain';

interface SecurityAuditActivityChartProps {
  auditLogs: SecurityAuditLog[];
}

type ViewMode = 'hourly' | 'daily';

interface ActivityChartDatum {
  label: string;
  success: number;
  warning: number;
  blocked: number;
  total: number;
  hour?: number;
  dayKey?: string;
  fullDate?: string;
  peakHourLabel?: string;
}

type HourlyBucket = ActivityChartDatum & { hour: number };
type DailyBucket = ActivityChartDatum & {
  dayKey: string;
  fullDate: string;
  peakHourLabel: string;
};

function getLogSeconds(log: SecurityAuditLog): number | null {
  const sec = (log.createdAt as { seconds?: number } | undefined)?.seconds;
  return typeof sec === 'number' && Number.isFinite(sec) ? sec : null;
}

function formatDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ payload?: HourlyBucket | DailyBucket }>;
  viewMode: ViewMode;
}

const ActivityTooltip: React.FC<CustomTooltipProps> = ({ active, payload, viewMode }) => {
  if (!active || !payload || payload.length === 0 || !payload[0]?.payload) return null;
  const item = payload[0].payload;
  const isHourly = viewMode === 'hourly';
  const hourBucket = item as HourlyBucket;
  const dayBucket = item as DailyBucket;

  return (
    <div className="rounded-xl border border-white/15 bg-[#0B0F17]/95 px-3.5 py-2.5 text-xs shadow-xl backdrop-blur-md space-y-1.5 font-mono tabular-nums">
      <div className="font-sans font-semibold text-white">
        {isHourly
          ? `Интервал ${String(hourBucket.hour).padStart(2, '0')}:00 – ${String(hourBucket.hour).padStart(2, '0')}:59`
          : dayBucket.fullDate}
      </div>
      <div className="flex items-center justify-between gap-5">
        <span className="font-sans text-emerald-300">Успешные (SUCCESS):</span>
        <span className="text-white font-semibold">{item.success}</span>
      </div>
      <div className="flex items-center justify-between gap-5">
        <span className="font-sans text-amber-300">Предупреждения (WARNING):</span>
        <span className="text-white font-semibold">{item.warning}</span>
      </div>
      <div className="flex items-center justify-between gap-5">
        <span className="font-sans text-rose-300">Блокировки (BLOCKED):</span>
        <span className="text-white font-semibold">{item.blocked}</span>
      </div>
      <div className="flex items-center justify-between gap-5 pt-1 border-t border-white/10">
        <span className="font-sans text-slate-400">
          {isHourly ? 'Всего в этот час:' : `Пиковый час (${dayBucket.peakHourLabel}):`}
        </span>
        <span className="text-emerald-400 font-semibold">{item.total}</span>
      </div>
    </div>
  );
};

export const SecurityAuditActivityChart: React.FC<SecurityAuditActivityChartProps> = ({
  auditLogs,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('hourly');
  const [selectedDayKey, setSelectedDayKey] = useState<string>('all');

  const { dayTabs, weeklyLogs, hourlyData, dailyData, summary } = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysAgoSec = Math.floor((todayStart.getTime() - 6 * 24 * 60 * 60 * 1000) / 1000);

    // Build ordered 7-day tabs from 6 days ago to today
    const days: Array<{ key: string; shortLabel: string; fullDate: string }> = [];
    for (let i = 6; i >= 0; i -= 1) {
      const dt = new Date(todayStart.getTime() - i * 24 * 60 * 60 * 1000);
      const shortWeekday = dt
        .toLocaleDateString('ru-RU', { weekday: 'short' })
        .replace('.', '');
      const capWeekday = shortWeekday.charAt(0).toUpperCase() + shortWeekday.slice(1);
      days.push({
        key: formatDayKey(dt),
        shortLabel: i === 0 ? 'Сегодня' : capWeekday,
        fullDate: dt.toLocaleDateString('ru-RU', {
          weekday: 'short',
          day: '2-digit',
          month: 'short',
        }),
      });
    }

    const recentLogs = auditLogs.filter((log) => {
      const sec = getLogSeconds(log);
      if (sec === null) return true; // Newly optimistic serverTimestamp
      return sec >= sevenDaysAgoSec;
    });

    // Build 24 hourly buckets (filtered by selectedDayKey or all 7 days)
    const hours: HourlyBucket[] = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      label: `${String(hour).padStart(2, '0')}:00`,
      success: 0,
      warning: 0,
      blocked: 0,
      total: 0,
    }));

    for (const log of recentLogs) {
      const sec = getLogSeconds(log);
      const dt = sec ? new Date(sec * 1000) : now;
      const dayKey = formatDayKey(dt);
      if (selectedDayKey !== 'all' && dayKey !== selectedDayKey) continue;

      const hr = dt.getHours();
      const bucket = hours[hr];
      if (!bucket) continue;
      if (log.status === 'BLOCKED') bucket.blocked += 1;
      else if (log.status === 'WARNING') bucket.warning += 1;
      else bucket.success += 1;
      bucket.total += 1;
    }

    // Build 7 daily buckets
    const dailyMap = new Map<string, DailyBucket & { hourCounts: number[] }>();
    for (const d of days) {
      dailyMap.set(d.key, {
        dayKey: d.key,
        label: d.shortLabel,
        fullDate: d.fullDate,
        success: 0,
        warning: 0,
        blocked: 0,
        total: 0,
        peakHourLabel: '—',
        hourCounts: Array.from({ length: 24 }, () => 0),
      });
    }

    for (const log of recentLogs) {
      const sec = getLogSeconds(log);
      const dt = sec ? new Date(sec * 1000) : now;
      const key = formatDayKey(dt);
      const dayBucket = dailyMap.get(key);
      if (!dayBucket) continue;
      if (log.status === 'BLOCKED') dayBucket.blocked += 1;
      else if (log.status === 'WARNING') dayBucket.warning += 1;
      else dayBucket.success += 1;
      dayBucket.total += 1;
      dayBucket.hourCounts[dt.getHours()] += 1;
    }

    const daily: DailyBucket[] = Array.from(dailyMap.values()).map((d) => {
      let peakHr = -1;
      let peakCnt = 0;
      d.hourCounts.forEach((cnt, hr) => {
        if (cnt > peakCnt) {
          peakCnt = cnt;
          peakHr = hr;
        }
      });
      return {
        dayKey: d.dayKey,
        label: d.label,
        fullDate: d.fullDate,
        success: d.success,
        warning: d.warning,
        blocked: d.blocked,
        total: d.total,
        peakHourLabel: peakHr >= 0 ? `${String(peakHr).padStart(2, '0')}:00` : '—',
      };
    });

    let peakHour: HourlyBucket | null = null;
    for (const b of hours) {
      if (!peakHour || b.total > peakHour.total) peakHour = b;
    }

    const activeViewTotal = hours.reduce((acc, h) => acc + h.total, 0);
    const successCount = hours.reduce((acc, h) => acc + h.success, 0);
    const alertCount = hours.reduce((acc, h) => acc + h.warning + h.blocked, 0);

    return {
      dayTabs: days,
      weeklyLogs: recentLogs,
      hourlyData: hours,
      dailyData: daily,
      summary: {
        total7d: recentLogs.length,
        activeViewTotal,
        successCount,
        alertCount,
        peakLabel:
          peakHour && peakHour.total > 0
            ? `${String(peakHour.hour).padStart(2, '0')}:00 (${peakHour.total})`
            : '—',
      },
    };
  }, [auditLogs, selectedDayKey]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      aria-labelledby="audit-activity-chart-heading"
      className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-6 space-y-5"
    >
      {/* Header & Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="text-xs text-slate-400 tabular-nums">
            Статистика журнала аудита · Скользящее окно 7 дней · Локальное время
          </div>
          <h2 id="audit-activity-chart-heading" className="mt-1 text-lg font-semibold text-white">
            Активность безопасности по часам недели
          </h2>
        </div>

        {/* Segmented View Switch */}
        <div
          role="tablist"
          aria-label="Режим отображения графика активности"
          className="inline-flex items-center gap-1 p-1 rounded-xl bg-[#0B0F17] border border-white/8 self-start lg:self-auto"
        >
          {(
            [
              { id: 'hourly', label: 'По часам (00–23)' },
              { id: 'daily', label: 'По дням (7 дн.)' },
            ] as const
          ).map((mode) => {
            const isActive = viewMode === mode.id;
            return (
              <motion.button
                key={mode.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                whileTap={{ scale: 0.96 }}
                onClick={() => setViewMode(mode.id)}
                className={`relative min-h-[38px] px-3.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                  isActive ? 'text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                {isActive && (
                  <motion.span
                    layoutId="audit-chart-mode-bg"
                    transition={{ type: 'spring', stiffness: 450, damping: 34 }}
                    className="absolute inset-0 rounded-lg bg-emerald-600"
                  />
                )}
                <span className="relative z-10">{mode.label}</span>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* KPI Strip (zero-pill, hairline divider) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-3.5 border-y border-white/8 text-xs">
        <div>
          <div className="text-slate-400">Событий за 7 дней</div>
          <div className="mt-1 text-base font-bold font-mono tabular-nums text-white">
            {summary.total7d}
          </div>
        </div>
        <div>
          <div className="text-slate-400">В выбранном фильтре</div>
          <div className="mt-1 text-base font-bold font-mono tabular-nums text-emerald-400">
            {viewMode === 'hourly' ? summary.activeViewTotal : summary.total7d}
          </div>
        </div>
        <div>
          <div className="text-slate-400">Пиковый час</div>
          <div className="mt-1 text-base font-bold font-mono tabular-nums text-amber-300">
            {summary.peakLabel}
          </div>
        </div>
        <div>
          <div className="text-slate-400">Успех / Предупр.</div>
          <div className="mt-1 text-base font-bold font-mono tabular-nums text-slate-200">
            <span className="text-emerald-400">{summary.successCount}</span>
            <span className="text-slate-600 mx-1">/</span>
            <span className={summary.alertCount > 0 ? 'text-amber-300' : 'text-slate-400'}>
              {summary.alertCount}
            </span>
          </div>
        </div>
      </div>

      {/* Day Filter Tabs when in Hourly Mode */}
      {viewMode === 'hourly' && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSelectedDayKey('all')}
            className={`min-h-[34px] px-3 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              selectedDayKey === 'all'
                ? 'bg-emerald-500/18 text-emerald-300 border border-emerald-500/35'
                : 'bg-[#0B0F17] text-slate-400 border border-white/8 hover:text-white'
            }`}
          >
            Вся неделя
          </button>
          {dayTabs.map((d) => {
            const active = selectedDayKey === d.key;
            return (
              <button
                key={d.key}
                type="button"
                onClick={() => setSelectedDayKey(d.key)}
                className={`min-h-[34px] px-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-emerald-500/18 text-emerald-300 border border-emerald-500/35'
                    : 'bg-[#0B0F17] text-slate-400 border border-white/8 hover:text-white'
                }`}
              >
                {d.shortLabel}
              </button>
            );
          })}
        </div>
      )}

      {/* Recharts Bar Visualization */}
      {weeklyLogs.length === 0 ? (
        <div className="h-[240px] rounded-xl border border-white/8 bg-[#0B0F17] flex flex-col items-center justify-center p-6 text-center space-y-2">
          <div className="text-sm font-medium text-slate-200">
            За последние 7 дней события аудита пока не зафиксированы
          </div>
          <p className="text-xs text-slate-400 max-w-md">
            После входа в аккаунт, настройки 2FA, изменения параметров стратегий или управления сессиями график
            почасовой активности заполнится автоматически.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={(viewMode === 'hourly' ? hourlyData : dailyData) as ActivityChartDatum[]}
                margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
                barCategoryGap={viewMode === 'hourly' ? '22%' : '32%'}
              >
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#94A3B8', fontSize: 11, fontFamily: 'JetBrains Mono' }}
                  axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                  tickLine={false}
                  interval={viewMode === 'hourly' ? 1 : 0}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fill: '#64748B', fontSize: 11, fontFamily: 'JetBrains Mono' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  content={<ActivityTooltip viewMode={viewMode} />}
                />
                <Bar
                  dataKey="success"
                  stackId="audit"
                  fill="#10B981"
                  radius={[0, 0, 0, 0]}
                  name="Успешные"
                />
                <Bar
                  dataKey="warning"
                  stackId="audit"
                  fill="#F59E0B"
                  radius={[0, 0, 0, 0]}
                  name="Предупреждения"
                />
                <Bar
                  dataKey="blocked"
                  stackId="audit"
                  fill="#F43F5E"
                  radius={[4, 4, 0, 0]}
                  name="Блокировки"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Unboxed Legend */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
            <div className="flex flex-wrap items-center gap-4">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" aria-hidden="true" />
                <span>Успешные операции</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-amber-500" aria-hidden="true" />
                <span>Предупреждения (2FA / сессии)</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-rose-500" aria-hidden="true" />
                <span>Блокировки</span>
              </span>
            </div>
            <span className="text-[11px] text-slate-500">
              Наведите или нажмите на столбец для детализации
            </span>
          </div>
        </div>
      )}
    </motion.section>
  );
};
