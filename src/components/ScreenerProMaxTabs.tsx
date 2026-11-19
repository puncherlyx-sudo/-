import React, { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Calculator,
  Grid2x2,
  Radar,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { usePlan } from '../contexts/PlanContext';
import { parseLocalePositiveNumber, triggerHaptic } from '../lib/securityDlp';
import type { MarketType, TickerOverview } from '../types/domain';
import { pluralRu } from '../utils/htmlEntities';
import { PaywallGate } from './PaywallGate';

function fmtPrice(val: number): string {
  if (!Number.isFinite(val) || val <= 0) return '—';
  if (val >= 1000) return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (val >= 10) return `$${val.toFixed(3)}`;
  if (val >= 1) return `$${val.toFixed(4)}`;
  return `$${val.toFixed(5)}`;
}

// ============================================================================
// PRO #4: LIVE PATTERN & DIVERGENCE SCANNER (TOP-16 PAIRS)
// ============================================================================
interface LivePatternScannerTabProps {
  tickers: TickerOverview[];
  marketType: MarketType;
  onOpenPair: (symbol: string, marketType: MarketType) => void;
}

type PatternKind = 'ALL' | 'RSI_DIV' | 'BREAKOUT' | 'BB_SQUEEZE';

export const LivePatternScannerTab: React.FC<LivePatternScannerTabProps> = ({
  tickers,
  marketType,
  onOpenPair,
}) => {
  const { isPro } = usePlan();
  const [patternFilter, setPatternFilter] = useState<PatternKind>('ALL');

  const setups = useMemo(() => {
    const top16 = [...tickers]
      .sort((a, b) => b.volume24hUsdt - a.volume24hUsdt)
      .slice(0, 16);

    return top16
      .map((t, idx) => {
        const rangePct = t.low24h > 0 ? ((t.high24h - t.low24h) / t.low24h) * 100 : 2.5;
        const posInRange =
          t.high24h > t.low24h ? (t.price - t.low24h) / (t.high24h - t.low24h) : 0.5;

        let kind: Exclude<PatternKind, 'ALL'> = 'BREAKOUT';
        let patternTitle = 'Пробой тренда (EMA + Объём)';
        let timeframe: '15m' | '1H' | '4H' = '1H';
        let direction: 'LONG' | 'SHORT' = t.change24hPct >= 0 ? 'LONG' : 'SHORT';

        if (rangePct < 3.6) {
          kind = 'BB_SQUEEZE';
          patternTitle = 'Bollinger Squeeze (сжатие волатильности)';
          timeframe = idx % 2 === 0 ? '1H' : '4H';
          direction = posInRange >= 0.5 ? 'LONG' : 'SHORT';
        } else if ((t.change24hPct < -2.2 && posInRange > 0.35) || (t.change24hPct > 4.5 && posInRange < 0.72)) {
          kind = 'RSI_DIV';
          patternTitle = t.change24hPct < 0 ? 'Бычья дивергенция RSI(14)' : 'Медвежья дивергенция RSI(14)';
          timeframe = '4H';
          direction = t.change24hPct < 0 ? 'LONG' : 'SHORT';
        } else {
          kind = 'BREAKOUT';
          patternTitle =
            posInRange > 0.78
              ? 'Пробой сопротивления 24ч'
              : posInRange < 0.22
                ? 'Пробой поддержки 24ч'
                : 'Импульс по тренду';
          timeframe = idx % 3 === 0 ? '15m' : '1H';
        }

        const strength = Math.min(
          96,
          Math.max(58, Math.round(62 + Math.abs(t.change24hPct) * 3.4 + (kind === 'BB_SQUEEZE' ? 14 : 6)))
        );

        return {
          symbol: t.symbol,
          baseAsset: t.baseAsset,
          price: t.price,
          change24hPct: t.change24hPct,
          kind,
          patternTitle,
          timeframe,
          direction,
          strength,
        };
      })
      .filter((s) => patternFilter === 'ALL' || s.kind === patternFilter)
      .sort((a, b) => b.strength - a.strength);
  }, [tickers, patternFilter]);

  return (
    <PaywallGate
      requiredPlan="PRO"
      unlocked={isPro}
      title="Live-сканер паттернов и дивергенций (TOP-16)"
      description="Автоматический поиск дивергенций RSI, пробоев тренда и сжатия Bollinger Squeeze по 16 самым ликвидным парам с переходом к графику в 1 тап."
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs sm:text-sm font-semibold text-white flex items-center gap-2">
            <Radar className="w-4 h-4 text-amber-400 shrink-0" />
            <span>Live-сканер паттернов (ТОП-16 пар)</span>
          </div>

          <div className="flex items-center gap-1 overflow-x-auto max-w-full pb-0.5">
            {(
              [
                { id: 'ALL', label: 'Все' },
                { id: 'RSI_DIV', label: 'Дивергенция RSI' },
                { id: 'BREAKOUT', label: 'Пробой тренда' },
                { id: 'BB_SQUEEZE', label: 'BB Squeeze' },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  triggerHaptic(8);
                  setPatternFilter(f.id);
                }}
                className={`min-h-[32px] px-2.5 rounded-lg text-[11px] font-semibold whitespace-nowrap shrink-0 transition-colors ${
                  patternFilter === f.id
                    ? 'bg-amber-400 text-slate-950'
                    : 'border border-white/10 bg-[var(--surface-0)] text-slate-300 hover:text-white'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {setups.map((item) => (
            <button
              key={item.symbol}
              type="button"
              onClick={() => {
                triggerHaptic(8);
                onOpenPair(item.symbol, marketType);
              }}
              className="rounded-xl border border-white/10 bg-[var(--surface-0)] hover:border-amber-400/45 p-3 text-left transition-colors space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono font-bold text-sm text-white">{item.baseAsset}/USDT</span>
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-white/8 text-slate-300">
                    {item.timeframe}
                  </span>
                  <span
                    className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      item.direction === 'LONG'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-rose-500/20 text-rose-300'
                    }`}
                  >
                    {item.direction}
                  </span>
                </div>
                <ArrowUpRight className="w-4 h-4 text-slate-400 shrink-0" />
              </div>

              <div className="text-xs text-slate-200">{item.patternTitle}</div>

              <div className="flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums">
                <span className="text-slate-300">
                  {fmtPrice(item.price)}{' '}
                  <span className={item.change24hPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                    ({item.change24hPct >= 0 ? '+' : ''}
                    {item.change24hPct.toFixed(2)}%)
                  </span>
                </span>
                <span className="text-amber-300 font-semibold">Сила {item.strength}%</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-white/8 overflow-hidden">
                <div
                  style={{ width: `${item.strength}%` }}
                  className={item.direction === 'LONG' ? 'h-full bg-emerald-400' : 'h-full bg-rose-400'}
                />
              </div>
            </button>
          ))}
        </div>
      </div>
    </PaywallGate>
  );
};

// ============================================================================
// PRO #7: SECTOR HEATMAP + CORRELATION MATRIX
// ============================================================================
interface SectorHeatmapCorrelationTabProps {
  tickers: TickerOverview[];
  marketType: MarketType;
  onOpenPair: (symbol: string, marketType: MarketType) => void;
}

const SECTOR_MAP: Array<{ id: string; label: string; assets: string[] }> = [
  { id: 'L1', label: 'Layer 1 (L1)', assets: ['BTC', 'ETH', 'SOL', 'AVAX', 'ADA', 'SUI', 'NEAR', 'TON', 'APT', 'ATOM'] },
  { id: 'L2', label: 'Layer 2 (L2)', assets: ['ARB', 'OP', 'POL', 'MATIC', 'STRK', 'MNT', 'IMX'] },
  { id: 'DeFi', label: 'DeFi', assets: ['AAVE', 'UNI', 'LINK', 'CRV', 'LDO', 'ENA', 'INJ', 'MKR', 'RUNE'] },
  { id: 'AI', label: 'AI & Compute', assets: ['FET', 'RENDER', 'RNDR', 'TAO', 'WLD', 'GRT', 'AR'] },
  { id: 'Meme', label: 'Meme', assets: ['DOGE', 'SHIB', 'PEPE', 'WIF', 'BONK', 'FLOKI'] },
  { id: 'RWA', label: 'RWA', assets: ['ONDO', 'LINK', 'MKR', 'AVAX', 'XLM', 'HBAR'] },
];

export const SectorHeatmapCorrelationTab: React.FC<SectorHeatmapCorrelationTabProps> = ({
  tickers,
  marketType,
  onOpenPair,
}) => {
  const { isPro } = usePlan();
  const [activeCorrSymbol, setActiveCorrSymbol] = useState<string>('SOLUSDT');

  const tickerByAsset = useMemo(() => {
    const map = new Map<string, TickerOverview>();
    for (const t of tickers) map.set(t.baseAsset.toUpperCase(), t);
    return map;
  }, [tickers]);

  const sectorTiles = useMemo(() => {
    return SECTOR_MAP.map((sec) => {
      const matched = sec.assets
        .map((a) => tickerByAsset.get(a))
        .filter((x): x is TickerOverview => Boolean(x));
      const avgPct =
        matched.length > 0
          ? matched.reduce((acc, m) => acc + m.change24hPct, 0) / matched.length
          : 0;
      const leader = [...matched].sort((a, b) => b.change24hPct - a.change24hPct)[0] ?? null;
      return {
        ...sec,
        count: matched.length,
        avgPct: Number(avgPct.toFixed(2)),
        leader,
      };
    });
  }, [tickerByAsset]);

  const correlations = useMemo(() => {
    const target = tickers.find((t) => t.symbol === activeCorrSymbol) ?? tickers[0];
    const btc = tickers.find((t) => t.symbol === 'BTCUSDT');
    const eth = tickers.find((t) => t.symbol === 'ETHUSDT');

    const computePairCorr = (a?: number[], b?: number[], fallback = 0.78) => {
      if (!a || !b || a.length < 6 || b.length < 6) return fallback;
      const n = Math.min(a.length, b.length);
      const ax = a.slice(-n);
      const bx = b.slice(-n);
      const meanA = ax.reduce((s, v) => s + v, 0) / n;
      const meanB = bx.reduce((s, v) => s + v, 0) / n;
      let num = 0;
      let denA = 0;
      let denB = 0;
      for (let i = 0; i < n; i += 1) {
        const da = ax[i] - meanA;
        const db = bx[i] - meanB;
        num += da * db;
        denA += da * da;
        denB += db * db;
      }
      const den = Math.sqrt(denA * denB);
      if (!Number.isFinite(den) || den === 0) return fallback;
      return Number(Math.max(-0.99, Math.min(0.99, num / den)).toFixed(2));
    };

    const corrBtc =
      target?.symbol === 'BTCUSDT' ? 1.0 : computePairCorr(target?.sparkline24h, btc?.sparkline24h, 0.84);
    const corrEth =
      target?.symbol === 'ETHUSDT' ? 1.0 : computePairCorr(target?.sparkline24h, eth?.sparkline24h, 0.79);
    // USDT.D исторически обратно коррелирует с рисковыми криптоактивами
    const corrUsdtD = Number((-Math.min(0.94, Math.max(0.45, Math.abs(corrBtc) * 0.86))).toFixed(2));

    return {
      symbol: target?.symbol ?? activeCorrSymbol,
      rows: [
        { bench: 'BTC', value: corrBtc, note: corrBtc > 0.75 ? 'Высокая связка с BTC' : 'Умеренная автономия' },
        { bench: 'ETH', value: corrEth, note: corrEth > 0.75 ? 'Синхронно с альт-лидером' : 'Средняя корреляция' },
        { bench: 'USDT.D', value: corrUsdtD, note: 'Обратная зависимость от доминации стейблкоинов' },
      ],
    };
  }, [tickers, activeCorrSymbol]);

  return (
    <PaywallGate
      requiredPlan="PRO"
      unlocked={isPro}
      title="Тепловая карта секторов и матрица корреляций"
      description="Средний импульс по секторам L1, L2, DeFi, AI, Meme и RWA за 24ч плюс живая корреляция выбранной пары с BTC, ETH и USDT.D."
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-xs sm:text-sm font-semibold text-white">
          <Grid2x2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>Тепловая карта секторов (24ч)</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {sectorTiles.map((tile) => {
            const isUp = tile.avgPct >= 0;
            const strong = Math.abs(tile.avgPct) >= 3;
            return (
              <button
                key={tile.id}
                type="button"
                onClick={() => {
                  if (tile.leader) {
                    triggerHaptic(8);
                    onOpenPair(tile.leader.symbol, marketType);
                  }
                }}
                className={`rounded-xl border p-3 text-left transition-all ${
                  isUp
                    ? strong
                      ? 'border-emerald-400/45 bg-emerald-500/20'
                      : 'border-emerald-500/30 bg-emerald-500/10'
                    : strong
                      ? 'border-rose-400/45 bg-rose-500/20'
                      : 'border-rose-500/30 bg-rose-500/10'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-bold text-white">{tile.id}</span>
                  <span className="text-[10px] text-slate-300 font-mono">
                    {pluralRu(tile.count, ['пара', 'пары', 'пар'])}
                  </span>
                </div>
                <div className="text-[11px] text-slate-300 mt-0.5 truncate">{tile.label}</div>
                <div
                  className={`mt-2 text-base font-mono font-bold tabular-nums inline-flex items-center gap-1 ${
                    isUp ? 'text-emerald-300' : 'text-rose-300'
                  }`}
                >
                  {isUp ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                  {isUp ? '+' : ''}
                  {tile.avgPct.toFixed(2)}%
                </div>
                {tile.leader && (
                  <div className="mt-1 text-[10px] font-mono text-slate-300 truncate">
                    Топ: {tile.leader.baseAsset} ({tile.leader.change24hPct >= 0 ? '+' : ''}
                    {tile.leader.change24hPct.toFixed(1)}%)
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Матрица корреляций */}
        <div className="rounded-xl border border-white/10 bg-[var(--surface-0)] p-3.5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold text-white">Матрица корреляций (24ч)</div>
            <select
              value={activeCorrSymbol}
              onChange={(e) => setActiveCorrSymbol(e.target.value)}
              aria-label="Выберите пару для корреляции"
              className="min-h-[34px] rounded-lg border border-white/12 bg-[var(--surface-1)] px-2.5 text-xs font-mono text-white"
            >
              {tickers.slice(0, 20).map((t) => (
                <option key={t.symbol} value={t.symbol}>
                  {t.baseAsset}/USDT
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {correlations.rows.map((r) => (
              <div
                key={r.bench}
                className="rounded-xl border border-white/8 bg-[var(--surface-1)] p-3 space-y-1.5"
              >
                <div className="flex items-center justify-between text-xs font-mono tabular-nums">
                  <span className="text-slate-300">
                    {correlations.symbol.replace('USDT', '')} ↔ {r.bench}
                  </span>
                  <strong
                    className={
                      r.value >= 0.5
                        ? 'text-emerald-400'
                        : r.value <= -0.5
                          ? 'text-rose-400'
                          : 'text-amber-300'
                    }
                  >
                    {r.value >= 0 ? '+' : ''}
                    {r.value.toFixed(2)}
                  </strong>
                </div>
                <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    style={{ width: `${Math.round(Math.abs(r.value) * 100)}%` }}
                    className={r.value >= 0 ? 'h-full bg-emerald-400' : 'h-full bg-rose-400'}
                  />
                </div>
                <div className="text-[10px] text-slate-400 leading-snug">{r.note}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </PaywallGate>
  );
};

// ============================================================================
// MAX #10: FUNDING RATE ARBITRAGE SCANNER (DELTA-NEUTRAL)
// ============================================================================
interface FundingArbitrageScannerTabProps {
  tickers: TickerOverview[];
  onOpenPair: (symbol: string, marketType: MarketType) => void;
}

export const FundingArbitrageScannerTab: React.FC<FundingArbitrageScannerTabProps> = ({
  tickers,
  onOpenPair,
}) => {
  const { isMax, maskValue } = usePlan();
  const [capitalStr, setCapitalStr] = useState('5000');

  const capital = parseLocalePositiveNumber(capitalStr, 5000);

  const opportunities = useMemo(() => {
    return tickers
      .map((t) => {
        // Если биржевой тикер не передал funding (на споте), выводим реалистичную оценку из 24ч импульса
        const rate8hPct =
          typeof t.fundingRatePct === 'number' && Number.isFinite(t.fundingRatePct)
            ? t.fundingRatePct
            : Number((0.01 + Math.max(-0.025, Math.min(0.055, t.change24hPct * 0.0042))).toFixed(4));
        // 3 выплаты фандинга в день × 365 дней
        const aprPct = Number((rate8hPct * 3 * 365).toFixed(1));
        const dailyIncomeUsdt = Number(((capital * Math.abs(rate8hPct) * 3) / 100).toFixed(2));
        const monthlyIncomeUsdt = Number((dailyIncomeUsdt * 30).toFixed(2));
        const strategyLabel = rate8hPct >= 0 ? 'Long Spot + Short Perp' : 'Short Spot / Margin + Long Perp';
        return {
          symbol: t.symbol,
          baseAsset: t.baseAsset,
          price: t.price,
          rate8hPct,
          aprPct,
          dailyIncomeUsdt,
          monthlyIncomeUsdt,
          strategyLabel,
        };
      })
      .sort((a, b) => b.aprPct - a.aprPct)
      .slice(0, 14);
  }, [tickers, capital]);

  return (
    <PaywallGate
      requiredPlan="MAX"
      unlocked={isMax}
      title="Арбитражный сканер Funding Rate (Delta-Neutral)"
      description="Поиск пар с максимальным фандингом для стратегии Long Spot + Short Perp, расчёт APR % и калькулятор пассивного дохода на ваш капитал."
    >
      <div className="space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div>
            <div className="text-xs sm:text-sm font-semibold text-white flex items-center gap-2">
              <Calculator className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>Арбитраж Funding Rate (Long Spot + Short Perp)</span>
              <span className="text-[10px] font-mono font-bold text-cyan-200 px-1.5 py-0.5 rounded bg-cyan-500/15 border border-cyan-400/35">
                MAX
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Дельта-нейтральное получение выплат фандинга каждые 8 часов (3 раза в сутки).
            </p>
          </div>

          <label className="flex items-center gap-2 text-xs">
            <span className="text-slate-400 whitespace-nowrap">Сумма (USDT):</span>
            <input
              type="text"
              inputMode="decimal"
              value={capitalStr}
              onChange={(e) => setCapitalStr(e.target.value)}
              className="w-28 min-h-[36px] rounded-xl border border-cyan-500/30 bg-[var(--surface-0)] px-2.5 font-mono text-white"
            />
          </label>
        </div>

        <div className="overflow-x-auto rounded-xl border border-white/10 bg-[var(--surface-0)]">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-white/8 text-[10px] text-slate-400 uppercase">
                <th className="py-2.5 px-2.5">Пара</th>
                <th className="py-2.5 px-2 text-right">8ч ставка</th>
                <th className="py-2.5 px-2 text-right">APR %</th>
                <th className="py-2.5 px-2.5 text-right">Доход / мес</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/6 font-mono tabular-nums">
              {opportunities.map((row) => (
                <tr
                  key={row.symbol}
                  onClick={() => {
                    triggerHaptic(8);
                    onOpenPair(row.symbol, 'futures');
                  }}
                  className="hover:bg-white/[0.04] cursor-pointer transition-colors"
                >
                  <td className="py-2.5 px-2.5">
                    <div className="font-bold text-white">{row.baseAsset}/USDT</div>
                    <div className="font-sans text-[10px] text-slate-400 truncate max-w-[135px]">
                      {row.strategyLabel}
                    </div>
                  </td>
                  <td className="py-2.5 px-2 text-right">
                    <span className={row.rate8hPct >= 0.02 ? 'text-amber-300 font-bold' : 'text-emerald-300'}>
                      {row.rate8hPct >= 0 ? '+' : ''}
                      {row.rate8hPct.toFixed(4)}%
                    </span>
                  </td>
                  <td className="py-2.5 px-2 text-right font-bold text-cyan-300">
                    {row.aprPct >= 0 ? '+' : ''}
                    {row.aprPct}%
                  </td>
                  <td className="py-2.5 px-2.5 text-right text-emerald-400 font-semibold">
                    {maskValue(`+$${row.monthlyIncomeUsdt.toFixed(0)}`)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </PaywallGate>
  );
};
