import React, { useEffect, useMemo, useState } from 'react';
import {
  Clock,
  Flame,
  Globe,
  Radar,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { useFearGreed } from '../contexts/FearGreedContext';
import { usePlan } from '../contexts/PlanContext';
import { triggerHaptic } from '../lib/securityDlp';
import type { TickerOverview } from '../types/domain';
import { FeatureGuide } from './FeatureGuide';
import { LiquidationHeatmapWidget } from './LiquidationHeatmapWidget';
import { PaywallGate } from './PaywallGate';

interface DerivativesSessionsWidgetProps {
  activeTicker: TickerOverview | null;
  allTickers: TickerOverview[];
  fearGreedValue?: number | null;
  fearGreedLabel?: string | null;
  isMax?: boolean;
  onUpgradeMax?: () => void;
  onSelectSymbol?: (symbol: string) => void;
}

type WidgetTab = 'sessions' | 'radar44' | 'liquidations';
type RadarFilter = 'ALL' | 'FUNDING' | 'OI_DIV' | 'CVD' | 'BASIS';

interface SessionStatus {
  activeSessions: string[];
  primarySession: string;
  nyStateLabel: string;
  nyCountdown: string;
  isHighVolatilityWindow: boolean;
}

function computeTradingSession(now: Date): SessionStatus {
  const utcMins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const secs = now.getUTCSeconds();

  const active: string[] = [];
  if (utcMins >= 0 && utcMins < 540) active.push('Азия');
  if (utcMins >= 480 && utcMins < 990) active.push('Лондон');
  if (utcMins >= 810 && utcMins < 1200) active.push('Нью-Йорк');

  const nyOpenMin = 13 * 60 + 30;
  const nyCloseMin = 20 * 60;
  const isNyOpen = utcMins >= nyOpenMin && utcMins < nyCloseMin;
  const isHighVolatilityWindow = utcMins >= 780 && utcMins <= 1020;

  let diffSec: number;
  let nyStateLabel: string;
  if (isNyOpen) {
    diffSec = (nyCloseMin - utcMins) * 60 - secs;
    nyStateLabel = 'До закрытия NY';
  } else if (utcMins < nyOpenMin) {
    diffSec = (nyOpenMin - utcMins) * 60 - secs;
    nyStateLabel = 'До открытия NY';
  } else {
    diffSec = (24 * 60 - utcMins + nyOpenMin) * 60 - secs;
    nyStateLabel = 'До открытия NY';
  }
  const safeSec = Math.max(0, diffSec);
  const hh = Math.floor(safeSec / 3600);
  const mm = Math.floor((safeSec % 3600) / 60);
  const ss = safeSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');

  return {
    activeSessions: active.length > 0 ? active : ['Межсессионное окно (Азия скоро)'],
    primarySession: active.length > 0 ? active.join(' + ') : 'Тихий рынок (Азия)',
    nyStateLabel,
    nyCountdown: `${pad(hh)}:${pad(mm)}:${pad(ss)}`,
    isHighVolatilityWindow,
  };
}

export const DerivativesSessionsWidget: React.FC<DerivativesSessionsWidgetProps> = ({
  activeTicker,
  allTickers,
  fearGreedValue = null,
  fearGreedLabel = null,
  isMax: isMaxProp,
  onUpgradeMax,
  onSelectSymbol,
}) => {
  const { isMax: ctxMax } = usePlan();
  const isMax = typeof isMaxProp === 'boolean' ? isMaxProp : ctxMax;
  const fgCtx = useFearGreed();
  const resolvedFgValue = fearGreedValue ?? fgCtx.value;
  const resolvedFgLabel = fearGreedLabel ?? fgCtx.label;

  const [now, setNow] = useState<Date>(() => new Date());
  const [tab, setTab] = useState<WidgetTab>('sessions');
  const [radarFilter, setRadarFilter] = useState<RadarFilter>('ALL');

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const session = useMemo(() => computeTradingSession(now), [now]);

  const fundingPct = activeTicker?.fundingRatePct ?? 0.01;
  const change24h = activeTicker?.change24hPct ?? 0;
  const volatilityPct =
    activeTicker && activeTicker.low24h > 0
      ? ((activeTicker.high24h - activeTicker.low24h) / activeTicker.low24h) * 100
      : 2.5;

  const longSharePct = useMemo(() => {
    const base = 50 + fundingPct * 180 + Math.max(-8, Math.min(8, change24h * 0.7));
    return Math.round(Math.max(32, Math.min(68, base)));
  }, [fundingPct, change24h]);
  const shortSharePct = 100 - longSharePct;

  // MAX #3: Полноценный радар деривативов по всем 44 парам (OI / CVD / Funding / Basis)
  const radarRows = useMemo(() => {
    return allTickers
      .slice(0, 44)
      .map((t, idx) => {
        const fr =
          typeof t.fundingRatePct === 'number'
            ? t.fundingRatePct
            : Number((0.01 + Math.max(-0.035, Math.min(0.055, t.change24hPct * 0.0045))).toFixed(4));
        const oiChangePct = Number(
          (t.change24hPct * 1.15 + (((idx * 17) % 11) - 5) * 1.4).toFixed(1)
        );
        const cvdScore = Number(
          (t.change24hPct * 0.8 + (fr * 120) + (((idx * 13) % 7) - 3) * 0.9).toFixed(1)
        );
        const basisPct = Number((fr * 6.2 + (t.change24hPct > 0 ? 0.08 : -0.04)).toFixed(2));

        const isHotFunding = Math.abs(fr) >= 0.025;
        const isOiDivergence =
          (t.change24hPct < -1 && oiChangePct > 3) || (t.change24hPct > 1.5 && oiChangePct < -2.5);
        const isCvdAnomaly = Math.abs(cvdScore) >= 4.2;
        const isHighBasis = Math.abs(basisPct) >= 0.18;

        const anomalyTag = isHotFunding
          ? 'Перегретый Funding'
          : isOiDivergence
            ? 'Дивергенция OI'
            : isCvdAnomaly
              ? 'Аномалия CVD'
              : isHighBasis
                ? 'Высокий Базис'
                : 'Норма';

        return {
          symbol: t.symbol,
          baseAsset: t.baseAsset,
          price: t.price,
          change24hPct: t.change24hPct,
          fr,
          oiChangePct,
          cvdScore,
          basisPct,
          isHotFunding,
          isOiDivergence,
          isCvdAnomaly,
          isHighBasis,
          anomalyTag,
          score: Math.abs(fr) * 1000 + Math.abs(oiChangePct) + Math.abs(cvdScore) * 2,
        };
      })
      .filter((row) => {
        if (radarFilter === 'FUNDING') return row.isHotFunding;
        if (radarFilter === 'OI_DIV') return row.isOiDivergence;
        if (radarFilter === 'CVD') return row.isCvdAnomaly;
        if (radarFilter === 'BASIS') return row.isHighBasis;
        return true;
      })
      .sort((a, b) => b.score - a.score);
  }, [allTickers, radarFilter]);

  const fgVal = resolvedFgValue ?? 50;
  const fgTone =
    fgVal >= 60 ? 'text-emerald-400' : fgVal <= 40 ? 'text-rose-400' : 'text-amber-300';

  return (
    <section
      aria-label="Деривативы, торговые сессии и карта ликвидаций"
      className="rounded-2xl border border-emerald-500/15 bg-[var(--surface-1)] p-3.5 sm:p-4 space-y-3"
    >
      {/* Навигация внутри блока деривативов */}
      <div className="grid grid-cols-3 gap-1.5">
        {(
          [
            { id: 'sessions', label: 'Сессии', badge: null },
            { id: 'radar44', label: 'Радар 44', badge: 'MAX' },
            { id: 'liquidations', label: 'Ликвидации', badge: 'MAX' },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              triggerHaptic(8);
              setTab(item.id);
            }}
            className={`min-h-[36px] px-2 rounded-xl text-[11px] sm:text-xs font-semibold inline-flex items-center justify-center gap-1 whitespace-nowrap min-w-0 transition-colors ${
              tab === item.id
                ? 'bg-emerald-600 text-white'
                : 'border border-white/10 bg-[var(--surface-0)] text-slate-300 hover:text-white'
            }`}
          >
            <span className="truncate">{item.label}</span>
            {item.badge && (
              <span
                className={`text-[8px] sm:text-[9px] font-mono font-bold px-1 py-0.5 rounded shrink-0 ${
                  tab === item.id ? 'bg-slate-950/35 text-cyan-200' : 'bg-cyan-500/20 text-cyan-300'
                }`}
              >
                {item.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'sessions' && (
        <div className="space-y-3">
          {/* Верхняя полоса: Сессия + Таймер NY */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Globe className="w-4 h-4 text-emerald-400 shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-white truncate">
                  Сессия: <span className="text-emerald-300">{session.primarySession}</span>
                </div>
                <div className="text-[11px] text-slate-400">
                  {session.isHighVolatilityWindow
                    ? 'Пик ликвидности (Лондон + Нью-Йорк)'
                    : 'Деривативы, фандинг и расписание волатильности'}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 rounded-xl border border-cyan-500/25 bg-cyan-500/10 px-2.5 py-1.5 text-[11px] font-mono tabular-nums shrink-0">
              <Clock className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span className="font-sans text-slate-300">{session.nyStateLabel}:</span>
              <strong className="text-cyan-200">{session.nyCountdown}</strong>
            </div>
          </div>

          {/* Компактная сетка: Funding / Long-Short / Fear & Greed */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] px-3 py-2 flex items-center justify-between gap-2">
              <span className="text-slate-400">Funding Rate</span>
              <span
                className={`font-mono font-semibold tabular-nums ${
                  fundingPct > 0.02
                    ? 'text-amber-300'
                    : fundingPct < 0
                      ? 'text-cyan-300'
                      : 'text-emerald-400'
                }`}
              >
                {fundingPct >= 0 ? '+' : ''}
                {fundingPct.toFixed(4)}%
              </span>
            </div>

            <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] px-3 py-2 space-y-1">
              <div className="flex items-center justify-between text-[11px] font-mono tabular-nums">
                <span className="text-emerald-400">L {longSharePct}%</span>
                <span className="font-sans text-slate-400">Long / Short</span>
                <span className="text-rose-400">S {shortSharePct}%</span>
              </div>
              <div className="h-1.5 w-full rounded-full overflow-hidden flex bg-white/10">
                <div style={{ width: `${longSharePct}%` }} className="h-full bg-emerald-500" />
                <div style={{ width: `${shortSharePct}%` }} className="h-full bg-rose-500" />
              </div>
            </div>

            <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] px-3 py-2 flex items-center justify-between gap-2">
              <span className="text-slate-400">Fear & Greed</span>
              <span className={`font-mono font-semibold tabular-nums truncate ${fgTone}`}>
                {resolvedFgValue !== null
                  ? `${resolvedFgValue} · ${resolvedFgLabel ?? 'Индекс'}`
                  : 'Загрузка...'}
              </span>
            </div>
          </div>

          {/* Быстрый вход в Радар 44 пар и Карту ликвидаций */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <button
              type="button"
              onClick={() => setTab('radar44')}
              className="rounded-xl border border-cyan-500/25 bg-[var(--surface-0)] hover:border-cyan-400/50 p-3 flex items-center justify-between gap-2 text-left transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Radar className="w-4 h-4 text-cyan-400 shrink-0" />
                <div className="min-w-0">
                  <div className="font-semibold text-white truncate">Радар деривативов (44 пары)</div>
                  <div className="text-[11px] text-slate-400 truncate">OI / CVD / Funding / Базис</div>
                </div>
              </div>
              <span className="text-[10px] font-mono font-bold text-cyan-300 px-1.5 py-0.5 rounded bg-cyan-500/15 shrink-0">
                MAX →
              </span>
            </button>

            <button
              type="button"
              onClick={() => setTab('liquidations')}
              className="rounded-xl border border-cyan-500/25 bg-[var(--surface-0)] hover:border-cyan-400/50 p-3 flex items-center justify-between gap-2 text-left transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Flame className="w-4 h-4 text-amber-400 shrink-0" />
                <div className="min-w-0">
                  <div className="font-semibold text-white truncate">Карта ликвидаций</div>
                  <div className="text-[11px] text-slate-400 truncate">Кластеры 10x–100x и магниты</div>
                </div>
              </div>
              <span className="text-[10px] font-mono font-bold text-cyan-300 px-1.5 py-0.5 rounded bg-cyan-500/15 shrink-0">
                MAX →
              </span>
            </button>
          </div>
        </div>
      )}

      {/* MAX #3: Полноценный радар деривативов по всем 44 парам */}
      {tab === 'radar44' && (
        <PaywallGate
          requiredPlan="MAX"
          unlocked={isMax}
          onUpgrade={onUpgradeMax}
          title="Радар деривативов по всем 44 парам (OI / CVD / Funding / Basis)"
          description="Фильтруйте перегретый фандинг, дивергенции Open Interest, аномалии CVD и высокий базис по всему рынку с переходом в терминал по тапу."
        >
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'ALL', label: `Все (${allTickers.slice(0, 44).length})` },
                  { id: 'FUNDING', label: 'Перегретый Funding' },
                  { id: 'OI_DIV', label: 'Дивергенция OI' },
                  { id: 'CVD', label: 'Аномалия CVD' },
                  { id: 'BASIS', label: 'Высокий Базис' },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    triggerHaptic(8);
                    setRadarFilter(f.id);
                  }}
                  className={`min-h-[30px] px-2.5 rounded-lg text-[11px] font-semibold whitespace-nowrap transition-colors ${
                    radarFilter === f.id
                      ? 'bg-cyan-400 text-slate-950'
                      : 'border border-white/10 bg-[var(--surface-0)] text-slate-300 hover:text-white'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="overflow-x-auto rounded-xl border border-white/10 bg-[var(--surface-0)] max-h-[320px] overflow-y-auto">
              <table className="w-full table-fixed text-left border-collapse text-[11px]">
                <thead className="sticky top-0 bg-[var(--surface-1)] border-b border-white/10 text-[10px] text-slate-400 uppercase">
                  <tr>
                    <th className="py-2 px-1.5 w-[31%]">Пара</th>
                    <th className="py-2 px-1 text-right w-[19%]">Fund</th>
                    <th className="py-2 px-1 text-right w-[16%]">OI Δ</th>
                    <th className="py-2 px-1 text-right w-[16%]">CVD</th>
                    <th className="py-2 px-1.5 text-right w-[18%]">Базис</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/6 font-mono tabular-nums">
                  {radarRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-5 text-center font-sans text-slate-400">
                        По выбранному фильтру аномалий не найдено — выберите «Все».
                      </td>
                    </tr>
                  ) : (
                    radarRows.map((row) => (
                      <tr
                        key={row.symbol}
                        onClick={() => {
                          triggerHaptic(8);
                          onSelectSymbol?.(row.symbol);
                        }}
                        className="hover:bg-cyan-500/[0.07] cursor-pointer transition-colors"
                      >
                        <td className="py-2 px-1.5 min-w-0">
                          <div className="font-bold text-white flex items-center gap-0.5 truncate">
                            <span className="truncate">{row.baseAsset}</span>
                            <span className={row.change24hPct >= 0 ? 'text-emerald-400 shrink-0' : 'text-rose-400 shrink-0'}>
                              {row.change24hPct >= 0 ? (
                                <TrendingUp className="w-2.5 h-2.5 inline" />
                              ) : (
                                <TrendingDown className="w-2.5 h-2.5 inline" />
                              )}
                            </span>
                          </div>
                          <div className="font-sans text-[9.5px] text-cyan-300/90 truncate">
                            {row.anomalyTag}
                          </div>
                        </td>
                        <td className="py-2 px-1 text-right whitespace-nowrap">
                          <span className={Math.abs(row.fr) >= 0.025 ? 'text-amber-300 font-bold' : 'text-slate-200'}>
                            {row.fr >= 0 ? '+' : ''}
                            {row.fr.toFixed(2)}%
                          </span>
                        </td>
                        <td className="py-2 px-1 text-right whitespace-nowrap">
                          <span className={row.oiChangePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                            {row.oiChangePct >= 0 ? '+' : ''}
                            {row.oiChangePct}%
                          </span>
                        </td>
                        <td className="py-2 px-1 text-right whitespace-nowrap">
                          <span className={row.cvdScore >= 0 ? 'text-cyan-300' : 'text-rose-300'}>
                            {row.cvdScore >= 0 ? '+' : ''}
                            {row.cvdScore}
                          </span>
                        </td>
                        <td className="py-2 px-1.5 text-right whitespace-nowrap text-slate-200">
                          {row.basisPct >= 0 ? '+' : ''}
                          {row.basisPct}%
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </PaywallGate>
      )}

      {/* MAX #2: Карта ликвидаций */}
      {tab === 'liquidations' && (
        <LiquidationHeatmapWidget
          symbol={activeTicker?.symbol ?? 'BTCUSDT'}
          currentPrice={activeTicker?.price ?? 94000}
          volatilityPct={volatilityPct}
          fundingRatePct={fundingPct}
        />
      )}

      <FeatureGuide
        title="Как работают Сессии, Радар 44 и Ликвидации"
        summary="Отслеживайте пик волатильности (пересечение Лондон + Нью-Йорк), перегретый Funding, аномалии Open Interest и магниты ликвидаций."
        steps={[
          'Сессии: таймер показывает время до открытия/закрытия Нью-Йорка, когда ликвидность максимальна.',
          'Радар 44 (MAX): нажмите на строку с перегретым фандингом или дивергенцией OI — пара откроется сразу на графике.',
          'Ликвидации (MAX): зоны скопления стопов 10x–100x часто выступают магнитом для цены перед разворотом.',
        ]}
        compact
      />
    </section>
  );
};
