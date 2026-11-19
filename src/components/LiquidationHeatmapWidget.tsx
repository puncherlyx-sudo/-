import React, { useMemo, useState } from 'react';
import { Flame, Magnet, Sparkles } from 'lucide-react';
import { usePlan } from '../contexts/PlanContext';
import { triggerHaptic } from '../lib/securityDlp';
import { PaywallGate } from './PaywallGate';

interface LiquidationHeatmapWidgetProps {
  symbol: string;
  currentPrice: number;
  volatilityPct?: number;
  fundingRatePct?: number;
}

type LeverageFilter = 10 | 25 | 50 | 100;

interface LiqLevel {
  price: number;
  distPct: number;
  side: 'SHORT_LIQ' | 'LONG_LIQ';
  volumeUsdM: number;
  intensity: number; // 0..100
  isMagnet: boolean;
}

function fmtPrice(p: number): string {
  if (p >= 1000) return `$${p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (p >= 10) return `$${p.toFixed(3)}`;
  return `$${p.toFixed(4)}`;
}

export const LiquidationHeatmapWidget: React.FC<LiquidationHeatmapWidgetProps> = ({
  symbol,
  currentPrice,
  volatilityPct = 2.4,
  fundingRatePct = 0.01,
}) => {
  const { isMax, maskValue } = usePlan();
  const [leverageFilter, setLeverageFilter] = useState<LeverageFilter>(25);

  const safePrice = currentPrice > 0 ? currentPrice : 94000;

  const { shortLevels, longLevels, topShortMagnet, topLongMagnet } = useMemo(() => {
    // Дистанция ликвидации примерно обратно пропорциональна плечу (с буфером поддерживающей маржи)
    const baseStepPct = Math.max(0.45, Math.min(8.5, (92 / leverageFilter) * 0.42));
    const fundingBias = Math.max(-0.35, Math.min(0.35, fundingRatePct * 12));
    const volFactor = Math.max(0.7, Math.min(2.2, volatilityPct / 2));

    const buildSide = (side: 'SHORT_LIQ' | 'LONG_LIQ'): LiqLevel[] => {
      const steps = [0.65, 1.0, 1.45, 2.0, 2.75];
      const raw = steps.map((mult, idx) => {
        const dist = Number((baseStepPct * mult).toFixed(2));
        const price =
          side === 'SHORT_LIQ' ? safePrice * (1 + dist / 100) : Math.max(0.0001, safePrice * (1 - dist / 100));
        // Детерминированное распределение плотности ликвидаций вокруг ключевых уровней плеча
        const seedHash =
          ((symbol.charCodeAt(0) * 31 + symbol.charCodeAt(1) * 17 + idx * 13 + leverageFilter) % 37) / 37;
        const peakWeight = idx === 1 ? 1.45 : idx === 2 ? 1.25 : idx === 0 ? 0.9 : 0.72;
        const sideBias = side === 'LONG_LIQ' ? 1 + fundingBias : 1 - fundingBias;
        const volumeUsdM = Number((Math.max(1.2, (8 + seedHash * 18) * peakWeight * sideBias * volFactor)).toFixed(1));
        return { price, distPct: dist, side, volumeUsdM };
      });
      const maxVol = Math.max(...raw.map((r) => r.volumeUsdM), 1);
      const maxIdx = raw.reduce((best, r, i) => (r.volumeUsdM > raw[best].volumeUsdM ? i : best), 0);
      return raw.map((r, i) => ({
        ...r,
        intensity: Math.round((r.volumeUsdM / maxVol) * 100),
        isMagnet: i === maxIdx,
      }));
    };

    const shorts = buildSide('SHORT_LIQ').reverse(); // Сверху вниз к текущей цене
    const longs = buildSide('LONG_LIQ');
    return {
      shortLevels: shorts,
      longLevels: longs,
      topShortMagnet: shorts.find((l) => l.isMagnet) ?? shorts[0],
      topLongMagnet: longs.find((l) => l.isMagnet) ?? longs[0],
    };
  }, [safePrice, leverageFilter, volatilityPct, fundingRatePct, symbol]);

  return (
    <PaywallGate
      requiredPlan="MAX"
      unlocked={isMax}
      title="Карта ликвидаций (Liquidation Heatmap)"
      description="Визуальная тепловая шкала скопления ликвидаций лонгов и шортов с фильтром плеч 10x / 25x / 50x / 100x и подсветкой магнитных зон."
    >
      <div className="space-y-3">
        {/* Верхняя панель и фильтр плеч */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-semibold text-white flex items-center gap-1.5">
            <Flame className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>Карта ликвидаций · {symbol}</span>
          </div>

          <div className="inline-flex items-center gap-1 p-0.5 rounded-lg bg-[var(--surface-0)] border border-white/10">
            {([10, 25, 50, 100] as const).map((lev) => (
              <button
                key={lev}
                type="button"
                onClick={() => {
                  triggerHaptic(8);
                  setLeverageFilter(lev);
                }}
                className={`min-h-[30px] px-2 rounded-md text-[11px] font-mono font-semibold transition-colors ${
                  leverageFilter === lev
                    ? 'bg-cyan-400 text-slate-950'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {lev}x
              </button>
            ))}
          </div>
        </div>

        {/* Ближайшие магнитные зоны */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/[0.07] p-2.5 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] text-rose-300 font-semibold flex items-center gap-1">
                <Magnet className="w-3 h-3 shrink-0" />
                <span>Магнит Шортов (выше)</span>
              </div>
              <div className="font-mono tabular-nums font-bold text-white mt-0.5">
                {fmtPrice(topShortMagnet.price)}{' '}
                <span className="text-[11px] text-rose-300">(+{topShortMagnet.distPct}%)</span>
              </div>
            </div>
            <div className="text-right font-mono tabular-nums shrink-0">
              <div className="text-xs font-bold text-amber-300">
                {maskValue(`$${topShortMagnet.volumeUsdM}M`)}
              </div>
              <div className="text-[10px] text-slate-400">{leverageFilter}x кластер</div>
            </div>
          </div>

          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.07] p-2.5 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] text-emerald-300 font-semibold flex items-center gap-1">
                <Magnet className="w-3 h-3 shrink-0" />
                <span>Магнит Лонгов (ниже)</span>
              </div>
              <div className="font-mono tabular-nums font-bold text-white mt-0.5">
                {fmtPrice(topLongMagnet.price)}{' '}
                <span className="text-[11px] text-emerald-300">(-{topLongMagnet.distPct}%)</span>
              </div>
            </div>
            <div className="text-right font-mono tabular-nums shrink-0">
              <div className="text-xs font-bold text-cyan-300">
                {maskValue(`$${topLongMagnet.volumeUsdM}M`)}
              </div>
              <div className="text-[10px] text-slate-400">{leverageFilter}x кластер</div>
            </div>
          </div>
        </div>

        {/* Тепловая шкала уровней */}
        <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] p-3 space-y-1.5 font-mono tabular-nums text-[11px]">
          <div className="text-[10px] font-sans text-rose-300/90 flex items-center justify-between pb-1">
            <span>Ликвидации Шортов (Short Squeeze зоны выше цены)</span>
            <span>Оценка объёма</span>
          </div>

          {shortLevels.map((lvl) => (
            <div key={`s-${lvl.distPct}`} className="relative rounded-md overflow-hidden py-1 px-2 flex items-center justify-between gap-2">
              <div
                style={{ width: `${lvl.intensity}%` }}
                className={`absolute inset-y-0 right-0 transition-all ${
                  lvl.isMagnet
                    ? 'bg-gradient-to-l from-amber-400/40 via-rose-500/30 to-transparent'
                    : 'bg-rose-500/18'
                }`}
              />
              <div className="relative z-10 flex items-center gap-2 min-w-0">
                <span className="text-rose-200 font-semibold">{fmtPrice(lvl.price)}</span>
                <span className="text-slate-400 text-[10px]">+{lvl.distPct}%</span>
                {lvl.isMagnet && (
                  <span className="font-sans text-[10px] font-bold text-amber-300 inline-flex items-center gap-0.5">
                    <Sparkles className="w-2.5 h-2.5" /> Магнит
                  </span>
                )}
              </div>
              <span className="relative z-10 text-white font-semibold shrink-0">
                {maskValue(`$${lvl.volumeUsdM}M`)}
              </span>
            </div>
          ))}

          {/* Текущая цена */}
          <div className="my-1.5 py-1.5 px-2.5 rounded-lg border border-cyan-400/40 bg-cyan-500/12 flex items-center justify-between text-xs">
            <span className="font-sans text-cyan-200 font-semibold">Текущая цена</span>
            <span className="text-white font-bold">{fmtPrice(safePrice)}</span>
          </div>

          {longLevels.map((lvl) => (
            <div key={`l-${lvl.distPct}`} className="relative rounded-md overflow-hidden py-1 px-2 flex items-center justify-between gap-2">
              <div
                style={{ width: `${lvl.intensity}%` }}
                className={`absolute inset-y-0 right-0 transition-all ${
                  lvl.isMagnet
                    ? 'bg-gradient-to-l from-cyan-400/35 via-emerald-500/30 to-transparent'
                    : 'bg-emerald-500/18'
                }`}
              />
              <div className="relative z-10 flex items-center gap-2 min-w-0">
                <span className="text-emerald-200 font-semibold">{fmtPrice(lvl.price)}</span>
                <span className="text-slate-400 text-[10px]">-{lvl.distPct}%</span>
                {lvl.isMagnet && (
                  <span className="font-sans text-[10px] font-bold text-cyan-300 inline-flex items-center gap-0.5">
                    <Sparkles className="w-2.5 h-2.5" /> Магнит
                  </span>
                )}
              </div>
              <span className="relative z-10 text-white font-semibold shrink-0">
                {maskValue(`$${lvl.volumeUsdM}M`)}
              </span>
            </div>
          ))}

          <div className="text-[10px] font-sans text-emerald-300/90 pt-1">
            Ликвидации Лонгов (Long Liquidation зоны ниже цены)
          </div>
        </div>
      </div>
    </PaywallGate>
  );
};
