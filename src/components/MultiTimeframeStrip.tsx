import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { IndicatorSnapshot, MarketType, Timeframe } from '../types/domain';

const FRAMES: Array<{ tf: Timeframe; label: string }> = [
  { tf: '15m', label: '15м' },
  { tf: '1h', label: '1ч' },
  { tf: '4h', label: '4ч' },
  { tf: '1d', label: '1д' },
];

const REFRESH_MS = 60_000;

type Bias = IndicatorSnapshot['trendBias'];

interface FrameState {
  bias: Bias;
  rsi: number;
  live: boolean;
}

interface MultiTimeframeStripProps {
  symbol: string;
  marketType: MarketType;
  /** Текущий выбранный таймфрейм графика (подсвечивается). */
  activeTimeframe?: Timeframe;
  onSelectTimeframe?: (tf: Timeframe) => void;
}

const BIAS_UI: Record<Bias, { label: string; arrow: string; cls: string; ring: string }> = {
  BULLISH: { label: 'Рост', arrow: '▲', cls: 'text-emerald-400', ring: 'border-emerald-500/30 bg-emerald-500/10' },
  BEARISH: { label: 'Падение', arrow: '▼', cls: 'text-rose-400', ring: 'border-rose-500/30 bg-rose-500/10' },
  RANGE: { label: 'Боковик', arrow: '■', cls: 'text-slate-300', ring: 'border-white/10 bg-white/5' },
};

/**
 * Тренд сразу на четырёх таймфреймах: видно, совпадают ли они (сильный сигнал)
 * или спорят друг с другом (осторожность). Данные берутся из тех же индикаторов, что и график.
 */
export const MultiTimeframeStrip: React.FC<MultiTimeframeStripProps> = ({
  symbol,
  marketType,
  activeTimeframe,
  onSelectTimeframe,
}) => {
  const [frames, setFrames] = useState<Partial<Record<Timeframe, FrameState>>>({});

  useEffect(() => {
    let cancelled = false;
    setFrames({});
    const load = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      const results = await Promise.all(
        FRAMES.map(async ({ tf }) => {
          try {
            const res = await fetch(`/api/market/candles?symbol=${symbol}&interval=${tf}&marketType=${marketType}`);
            if (!res.ok) return null;
            const data = (await res.json()) as { indicators?: IndicatorSnapshot; source?: 'live' | 'cached' };
            if (!data.indicators) return null;
            return [tf, { bias: data.indicators.trendBias, rsi: data.indicators.rsi14, live: data.source === 'live' }] as const;
          } catch {
            return null;
          }
        })
      );
      if (cancelled) return;
      setFrames((prev) => {
        const next = { ...prev };
        for (const item of results) if (item) next[item[0]] = item[1];
        return next;
      });
    };
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [symbol, marketType]);

  const known = FRAMES.map((f) => frames[f.tf]).filter((f): f is FrameState => Boolean(f));
  const bulls = known.filter((f) => f.bias === 'BULLISH').length;
  const bears = known.filter((f) => f.bias === 'BEARISH').length;

  const allLive = known.length > 0 && known.every((f) => f.live);
  let verdict = 'Загрузка…';
  let verdictCls = 'text-slate-400';
  if (known.length === FRAMES.length && !allLive) {
    verdict = 'Резервные данные (нет связи с биржей): сравнение таймфреймов недоступно';
    verdictCls = 'text-amber-400';
  } else if (known.length === FRAMES.length) {
    if (bulls === FRAMES.length) {
      verdict = 'Все таймфреймы вверх: сильное согласие';
      verdictCls = 'text-emerald-400';
    } else if (bears === FRAMES.length) {
      verdict = 'Все таймфреймы вниз: сильное согласие';
      verdictCls = 'text-rose-400';
    } else if (bulls > 0 && bears > 0) {
      verdict = 'Таймфреймы спорят: повышенная осторожность';
      verdictCls = 'text-amber-400';
    } else {
      verdict = 'Явного согласия нет: рынок без чёткого тренда';
      verdictCls = 'text-slate-300';
    }
  }

  return (
    <div className="rounded-xl border border-white/8 bg-[#0B0F17]/70 p-3" aria-label="Тренд по таймфреймам">
      <div className="grid grid-cols-4 gap-2">
        {FRAMES.map(({ tf, label }) => {
          const f = frames[tf];
          const ui = f ? BIAS_UI[f.bias] : null;
          const isActive = activeTimeframe === tf;
          return (
            <motion.button
              key={tf}
              type="button"
              whileTap={{ scale: 0.95 }}
              onClick={() => onSelectTimeframe?.(tf)}
              className={`min-h-[64px] rounded-lg border px-2 py-2 text-center transition-colors ${
                ui ? ui.ring : 'border-white/10 bg-white/5'
              } ${isActive ? 'ring-1 ring-cyan-400/60' : ''}`}
              aria-label={`${label}: ${ui ? ui.label : 'загрузка'}`}
            >
              <div className="text-[10px] font-semibold text-slate-400">{label}</div>
              {ui && f ? (
                <>
                  <div className={`mt-0.5 text-sm font-bold ${ui.cls}`}>
                    {ui.arrow} <span className="text-[11px] font-semibold">{ui.label}</span>
                  </div>
                  <div className="text-[10px] font-mono tabular-nums text-slate-500">RSI {Math.round(f.rsi)}</div>
                </>
              ) : (
                <div className="mt-2 h-4 w-10 mx-auto rounded bg-white/10 animate-pulse" />
              )}
            </motion.button>
          );
        })}
      </div>
      <p className={`mt-2 text-[11px] font-medium ${verdictCls}`}>{verdict}</p>
    </div>
  );
};
