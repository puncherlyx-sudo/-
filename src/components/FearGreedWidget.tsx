import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Flame, RefreshCw } from 'lucide-react';
import { motion } from 'motion/react';
import type { FearAndGreedSnapshot } from '../types/domain';

type HorizonKey = 'today' | 'yesterday' | 'week' | 'month';

interface SentimentZone {
  id: 'extreme_fear' | 'fear' | 'neutral' | 'greed' | 'extreme_greed';
  min: number;
  max: number;
  mid: number;
  label: string;
  color: string;
  textColor: string;
  hint: string;
}

const SENTIMENT_ZONES: SentimentZone[] = [
  {
    id: 'extreme_fear',
    min: 0,
    max: 24,
    mid: 12,
    label: 'Экстремальный страх',
    color: '#EF4444',
    textColor: 'text-rose-400',
    hint: 'Массовая паника на рынке. Исторически зона повышенного внимания для поэтапного спот-накопления.',
  },
  {
    id: 'fear',
    min: 25,
    max: 44,
    mid: 35,
    label: 'Страх',
    color: '#F97316',
    textColor: 'text-orange-400',
    hint: 'Осторожность участников. Покупатели ждут подтверждения разворота или ретеста поддержек.',
  },
  {
    id: 'neutral',
    min: 45,
    max: 55,
    mid: 50,
    label: 'Нейтрально',
    color: '#F59E0B',
    textColor: 'text-amber-300',
    hint: 'Баланс спроса и предложения. Направление движения определяется техническими пробоями.',
  },
  {
    id: 'greed',
    min: 56,
    max: 74,
    mid: 65,
    label: 'Жадность',
    color: '#22C55E',
    textColor: 'text-emerald-400',
    hint: 'Устойчивый приток ликвидности и спроса. Требуется дисциплина по уровням Stop-Loss.',
  },
  {
    id: 'extreme_greed',
    min: 75,
    max: 100,
    mid: 88,
    label: 'Экстремальная жадность',
    color: '#10B981',
    textColor: 'text-teal-300',
    hint: 'Эйфория и перегретый фандинг. Повышенный риск резкого отката и фиксации прибыли.',
  },
];

function getZoneForValue(val: number): SentimentZone {
  return (
    SENTIMENT_ZONES.find((z) => val >= z.min && val <= z.max) ?? SENTIMENT_ZONES[2]
  );
}

// Convert index 0..100 into SVG gauge angle (180° left -> 0° right in math degrees where 180 is left)
function valueToPoint(cx: number, cy: number, r: number, val: number) {
  const clamped = Math.max(0, Math.min(100, val));
  const angleRad = Math.PI - (clamped / 100) * Math.PI;
  return {
    x: cx + r * Math.cos(angleRad),
    y: cy - r * Math.sin(angleRad),
  };
}

function describeGaugeArc(cx: number, cy: number, r: number, startVal: number, endVal: number): string {
  const startPt = valueToPoint(cx, cy, r, startVal);
  const endPt = valueToPoint(cx, cy, r, endVal);
  return `M ${startPt.x.toFixed(2)} ${startPt.y.toFixed(2)} A ${r} ${r} 0 0 1 ${endPt.x.toFixed(2)} ${endPt.y.toFixed(2)}`;
}

export const FearGreedWidget: React.FC = () => {
  const [data, setData] = useState<FearAndGreedSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [horizon, setHorizon] = useState<HorizonKey>('today');
  const [hoveredZone, setHoveredZone] = useState<SentimentZone | null>(null);
  const [hoveredBarIdx, setHoveredBarIdx] = useState<number | null>(null);

  const loadSentiment = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    try {
      const url = forceRefresh ? '/api/market/fear-greed?refresh=1' : '/api/market/fear-greed';
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) {
        const json = (await res.json()) as FearAndGreedSnapshot;
        setData(json);
      }
    } catch {
      // Keep prior state on transient offline glitch
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSentiment(false);
    const timer = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        void loadSentiment(false);
      }
    }, 5 * 60_000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void loadSentiment(false);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [loadSentiment]);

  const baseHorizonValue = useMemo(() => {
    if (!data) return 50;
    if (horizon === 'yesterday') return data.yesterdayValue;
    if (horizon === 'week') return data.weekAgoValue;
    if (horizon === 'month') return data.monthAgoValue;
    return data.value;
  }, [data, horizon]);

  const inspectedBar =
    data && hoveredBarIdx !== null && data.history[hoveredBarIdx]
      ? data.history[hoveredBarIdx]
      : null;

  const displayValue = hoveredZone
    ? hoveredZone.mid
    : inspectedBar
      ? inspectedBar.value
      : baseHorizonValue;

  const activeZone = hoveredZone ?? getZoneForValue(displayValue);

  const needleRotationDeg = useMemo(() => {
    const clamped = Math.max(0, Math.min(100, displayValue));
    return -90 + (clamped / 100) * 180;
  }, [displayValue]);

  const deltaFromYesterday = data ? data.value - data.yesterdayValue : 0;

  const contextLabel = useMemo(() => {
    if (hoveredZone) {
      return `Предпросмотр диапазона ${hoveredZone.min}–${hoveredZone.max}`;
    }
    if (inspectedBar) {
      return `Архив за ${inspectedBar.dateLabel}`;
    }
    if (horizon === 'yesterday') return 'Значение вчера';
    if (horizon === 'week') return '7 дней назад';
    if (horizon === 'month') return '30 дней назад';
    return data?.source === 'live' ? 'Индекс Alternative.me' : 'Композитный индекс рынка';
  }, [hoveredZone, inspectedBar, horizon, data?.source]);

  return (
    <section
      aria-label="Crypto Fear & Greed Index"
      className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-5 space-y-4"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Flame className="w-4 h-4 text-amber-400" />
            <span>Crypto Fear &amp; Greed Index</span>
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
            <span>{contextLabel}</span>
            {data && (
              <>
                <span aria-hidden="true">·</span>
                <span
                  className={`font-mono tabular-nums ${
                    deltaFromYesterday >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {deltaFromYesterday >= 0 ? '+' : ''}
                  {deltaFromYesterday} пт за 24ч
                </span>
              </>
            )}
          </div>
        </div>

        <motion.button
          type="button"
          whileTap={{ scale: 0.94 }}
          onClick={() => void loadSentiment(true)}
          disabled={loading}
          aria-label="Обновить индекс страха и жадности"
          className="min-h-[38px] min-w-[38px] rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 flex items-center justify-center transition-colors shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </motion.button>
      </div>

      {/* Interactive Semicircular SVG Gauge */}
      <div className="relative flex flex-col items-center">
        <svg viewBox="0 0 280 160" className="w-full max-w-[300px] h-auto select-none overflow-visible">
          {/* Segmented Arcs (Clickable & Hoverable Zones) */}
          {SENTIMENT_ZONES.map((zone, idx) => {
            const gapStart = idx === 0 ? zone.min : zone.min + 0.8;
            const gapEnd = idx === SENTIMENT_ZONES.length - 1 ? zone.max : zone.max - 0.8;
            const isActive = activeZone.id === zone.id;
            return (
              <path
                key={zone.id}
                d={describeGaugeArc(140, 134, 102, gapStart, gapEnd)}
                fill="none"
                stroke={zone.color}
                strokeWidth={isActive ? 19 : 14}
                strokeLinecap="butt"
                strokeOpacity={isActive ? 1 : 0.42}
                className="cursor-pointer transition-all duration-200"
                onMouseEnter={() => setHoveredZone(zone)}
                onMouseLeave={() => setHoveredZone(null)}
                onClick={() => setHoveredZone((prev) => (prev?.id === zone.id ? null : zone))}
              />
            );
          })}

          {/* Scale Tick Marks 0, 25, 50, 75, 100 */}
          {[0, 25, 50, 75, 100].map((tick) => {
            const pt = valueToPoint(140, 134, 80, tick);
            return (
              <text
                key={tick}
                x={pt.x}
                y={pt.y + 3}
                textAnchor="middle"
                fill="#64748B"
                fontSize="9"
                fontFamily="JetBrains Mono, monospace"
              >
                {tick}
              </text>
            );
          })}

          {/* Animated Needle */}
          <motion.g
            initial={false}
            animate={{ rotate: needleRotationDeg }}
            transition={{ type: 'spring', stiffness: 210, damping: 24 }}
            style={{ originX: '140px', originY: '134px' }}
          >
            <polygon points="136.5,134 140,42 143.5,134" fill="#F8FAFC" fillOpacity="0.92" />
            <circle cx="140" cy="134" r="7" fill="#0B0F17" stroke={activeZone.color} strokeWidth="3" />
          </motion.g>
        </svg>

        {/* Central Numeric Score & Classification */}
        <div className="-mt-2 text-center">
          <div className="text-3xl font-bold font-mono tabular-nums text-white leading-none">
            {loading && !data ? '—' : displayValue}
          </div>
          <div className={`mt-1.5 text-sm font-semibold ${activeZone.textColor}`}>
            {activeZone.label}
          </div>
        </div>
      </div>

      {/* Interactive Horizon Switcher */}
      <div className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-[#0B0F17] border border-white/8 text-[11px]">
        {(
          [
            { id: 'today', label: 'Сегодня', val: data?.value },
            { id: 'yesterday', label: 'Вчера', val: data?.yesterdayValue },
            { id: 'week', label: '7 дн.', val: data?.weekAgoValue },
            { id: 'month', label: '30 дн.', val: data?.monthAgoValue },
          ] as Array<{ id: HorizonKey; label: string; val?: number }>
        ).map((item) => {
          const isSelected = horizon === item.id && !hoveredZone && !inspectedBar;
          return (
            <motion.button
              key={item.id}
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={() => {
                setHoveredZone(null);
                setHoveredBarIdx(null);
                setHorizon(item.id);
              }}
              className={`min-h-[40px] px-1.5 py-1 rounded-lg flex flex-col items-center justify-center transition-colors ${
                isSelected
                  ? 'bg-white/12 text-white'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
              }`}
            >
              <span className="leading-tight">{item.label}</span>
              <span className="font-mono tabular-nums text-[10px] text-slate-300 font-semibold">
                {item.val ?? '—'}
              </span>
            </motion.button>
          );
        })}
      </div>

      {/* Interactive 14-Day Sentiment History Sparkline Bars */}
      {data && data.history.length > 0 && (
        <div className="space-y-1.5 pt-1 border-t border-white/8">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>Динамика за 14 дней</span>
            <span className="font-mono tabular-nums text-slate-300">
              {inspectedBar
                ? `${inspectedBar.dateLabel} · ${inspectedBar.value}`
                : `Диапазон ${Math.min(...data.history.map((h) => h.value))}–${Math.max(
                    ...data.history.map((h) => h.value)
                  )}`}
            </span>
          </div>
          <div
            className="h-12 flex items-end gap-1 pt-1"
            onMouseLeave={() => setHoveredBarIdx(null)}
          >
            {data.history.map((pt, idx) => {
              const zone = getZoneForValue(pt.value);
              const isHover = hoveredBarIdx === idx;
              return (
                <button
                  key={`${pt.timestamp}-${idx}`}
                  type="button"
                  aria-label={`${pt.dateLabel}: индекс ${pt.value} (${pt.classificationRu})`}
                  onMouseEnter={() => setHoveredBarIdx(idx)}
                  onFocus={() => setHoveredBarIdx(idx)}
                  onClick={() => setHoveredBarIdx((prev) => (prev === idx ? null : idx))}
                  className="flex-1 h-full flex items-end group focus:outline-none"
                >
                  <span
                    style={{
                      height: `${Math.max(16, pt.value)}%`,
                      backgroundColor: zone.color,
                      opacity: hoveredBarIdx === null || isHover ? 0.9 : 0.35,
                    }}
                    className={`w-full rounded-t-sm transition-all duration-150 ${
                      isHover ? 'ring-1 ring-white/80' : ''
                    }`}
                  />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Active Zone Behavioral Context */}
      <p className="text-xs text-slate-400 leading-relaxed border-t border-white/8 pt-3">
        <strong className={activeZone.textColor}>
          {activeZone.label} ({activeZone.min}–{activeZone.max}):{' '}
        </strong>
        {activeZone.hint}
      </p>
    </section>
  );
};
