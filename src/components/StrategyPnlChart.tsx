import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowDownRight, ArrowUpRight, Crown, Lock, RefreshCw, Sparkles, TrendingUp } from 'lucide-react';
import {
  CREDIT_COSTS,
  FREE_MAX_LEVERAGE,
  FREE_WEEKLY_QUOTA,
  MAX_X10_MONTHLY_QUOTA,
  MAX_X20_MONTHLY_QUOTA,
  PRO_MONTHLY_QUOTA,
  STRATEGY_CATALOG,
  canAccessStrategy,
  getStrategyTemplate,
} from '../data/strategies';
import { authFetch } from '../lib/authFetch';
import type {
  EquityCurvePoint,
  StrategyBreakdownResult,
  StrategyConfig,
  StrategyPerformanceReport,
} from '../types/domain';

interface StrategyPnlChartProps {
  strategies: StrategyConfig[];
  isPro: boolean;
  isMax?: boolean;
  isSignedIn?: boolean;
  creditsRemaining?: number;
  creditQuota?: number;
  onUpgradePro?: () => void;
  onUpgradeMax?: () => void;
  onConsumeCredits?: (amount: number, auditReason?: string) => Promise<boolean>;
}

function shortenStrategyName(name: string): string {
  if (name.length <= 22) return name;
  return `${name.slice(0, 20).trimEnd()}…`;
}

function formatSignedPct(val: number): string {
  return `${val >= 0 ? '+' : ''}${val.toFixed(2)}%`;
}

function formatSignedUsdt(val: number): string {
  const abs = Math.abs(val).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${val >= 0 ? '+' : '-'}$${abs}`;
}

interface CustomEquityTooltipProps {
  active?: boolean;
  payload?: Array<{ payload?: EquityCurvePoint }>;
  unitMode: 'pct' | 'usdt';
}

const EquityTooltip: React.FC<CustomEquityTooltipProps> = ({ active, payload, unitMode }) => {
  if (!active || !payload || payload.length === 0 || !payload[0]?.payload) return null;
  const pt = payload[0].payload;
  return (
    <div className="rounded-xl border border-white/15 bg-[#0B0F17]/95 px-3.5 py-2.5 text-xs shadow-lg backdrop-blur-md space-y-1.5 font-mono tabular-nums">
      <div className="font-sans text-slate-400">{pt.label}</div>
      <div className="flex items-center justify-between gap-4">
        <span className="font-sans text-slate-300">Портфель:</span>
        <span className={pt.portfolioPnlPct >= 0 ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>
          {unitMode === 'pct'
            ? `${formatSignedPct(pt.portfolioPnlPct)} (${formatSignedUsdt(pt.portfolioPnlUsdt)})`
            : `${formatSignedUsdt(pt.portfolioPnlUsdt)} (${formatSignedPct(pt.portfolioPnlPct)})`}
        </span>
      </div>
      <div className="flex items-center justify-between gap-4 text-[11px]">
        <span className="font-sans text-sky-300">Спот:</span>
        <span className="text-slate-200">{formatSignedPct(pt.spotPnlPct)}</span>
      </div>
      <div className="flex items-center justify-between gap-4 text-[11px]">
        <span className="font-sans text-amber-300">Фьючерсы:</span>
        <span className="text-slate-200">{formatSignedPct(pt.futuresPnlPct)}</span>
      </div>
      <div className="flex items-center justify-between gap-4 text-[11px] pt-1 border-t border-white/10">
        <span className="font-sans text-slate-400">Просадка:</span>
        <span className="text-rose-300">{pt.drawdownPct.toFixed(2)}%</span>
      </div>
    </div>
  );
};

interface CustomBarTooltipProps {
  active?: boolean;
  payload?: Array<{ payload?: StrategyBreakdownResult }>;
}

const StrategyBarTooltip: React.FC<CustomBarTooltipProps> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0 || !payload[0]?.payload) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-xl border border-white/15 bg-[#0B0F17]/95 px-3.5 py-2.5 text-xs shadow-lg backdrop-blur-md space-y-1 font-mono tabular-nums max-w-[260px]">
      <div className="font-sans font-semibold text-white">{row.name}</div>
      <div className="font-sans text-[11px] text-slate-400">
        {row.marketType === 'futures' ? 'Фьючерсы' : 'Спот'} · {row.enabled ? 'Активна' : 'Отключена'}
      </div>
      <div className="flex items-center justify-between gap-4 pt-1">
        <span className="font-sans text-slate-300">PnL:</span>
        <span className={row.totalPnlPct >= 0 ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>
          {formatSignedPct(row.totalPnlPct)} ({formatSignedUsdt(row.totalPnlUsdt)})
        </span>
      </div>
      <div className="flex items-center justify-between gap-4 text-[11px]">
        <span className="font-sans text-slate-400">Винрейт / Сделки:</span>
        <span className="text-slate-200">{row.winRatePct}% · {row.tradesCount}</span>
      </div>
      <div className="flex items-center justify-between gap-4 text-[11px]">
        <span className="font-sans text-slate-400">Просадка / PF:</span>
        <span className="text-slate-200">{row.maxDrawdownPct}% · {row.profitFactor}</span>
      </div>
    </div>
  );
};

export const StrategyPnlChart: React.FC<StrategyPnlChartProps> = ({
  strategies,
  isPro,
  isMax = false,
  isSignedIn = false,
  creditsRemaining,
  creditQuota = FREE_WEEKLY_QUOTA,
  onUpgradePro,
  onUpgradeMax,
  onConsumeCredits,
}) => {
  const [interval, setInterval] = useState<'1h' | '4h' | '1d'>('1h');
  const [scope, setScope] = useState<'active' | 'all'>('active');
  const [unitMode, setUnitMode] = useState<'pct' | 'usdt'>('pct');
  const [depositUsdt, setDepositUsdt] = useState<number>(2500);

  const [report, setReport] = useState<StrategyPerformanceReport | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const isOutOfCredits = Boolean(
    isSignedIn &&
      !isMax &&
      typeof creditsRemaining === 'number' &&
      creditsRemaining < CREDIT_COSTS.portfolioBacktest
  );

  useEffect(() => {
    if (!isPro) {
      if (interval !== '1h') setInterval('1h');
      if (scope !== 'active') setScope('active');
    } else if (!isMax && interval === '1d') {
      setInterval('4h');
    }
  }, [isPro, isMax, interval, scope]);

  const simulationPayload = useMemo(() => {
    const activeTier = isMax ? 'max' : isPro ? 'pro' : 'free';
    return STRATEGY_CATALOG.map((tpl) => {
      const cfg = strategies.find((s) => s.strategyKey === tpl.key);
      const isAllowed = canAccessStrategy(tpl.key, activeTier);
      const defaultEnabled = tpl.key === 'spot_trend_breakout' || tpl.key === 'futures_momentum_atr';
      return {
        strategyKey: tpl.key,
        name: tpl.name,
        shortTag: tpl.shortTag,
        marketType: tpl.marketType,
        enabled: isAllowed ? (cfg ? cfg.enabled : defaultEnabled) : false,
        dailySignalLimit: cfg ? (isPro ? cfg.dailySignalLimit : 1) : 1,
        minConfidence: cfg ? cfg.minConfidence : 70,
        riskPerTradePct: cfg ? cfg.riskPerTradePct : tpl.defaultRiskPct,
        leverage: cfg
          ? isPro
            ? cfg.leverage
            : Math.min(FREE_MAX_LEVERAGE, cfg.leverage)
          : Math.min(isPro ? 20 : FREE_MAX_LEVERAGE, tpl.defaultLeverage),
        pairs: cfg?.pairs?.length ? cfg.pairs : ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
      };
    });
  }, [strategies, isPro, isMax]);

  const activeSelectedCount = useMemo(
    () => simulationPayload.filter((s) => s.enabled).length,
    [simulationPayload]
  );

  const fetchBacktest = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch('/api/strategies/pnl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategies: simulationPayload,
          interval,
          depositUsdt,
          scope,
        }),
      });
      const data = (await res.json()) as StrategyPerformanceReport & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Не удалось рассчитать доходность стратегий.');
      }
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки статистики PnL');
    } finally {
      setLoading(false);
    }
  }, [simulationPayload, interval, depositUsdt, scope]);

  const handleManualRecalculate = async () => {
    setError(null);
    if (isOutOfCredits) {
      onUpgradePro?.();
      return;
    }
    if (isSignedIn && !isMax && onConsumeCredits) {
      try {
        await onConsumeCredits(CREDIT_COSTS.portfolioBacktest, 'Ручной пересчёт бэктеста PnL');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Недостаточно кредитов для пересчёта.');
        return;
      }
    }
    await fetchBacktest();
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchBacktest();
    }, 180);
    return () => clearTimeout(timer);
  }, [fetchBacktest]);

  const totalPositive = (report?.summary.totalPnlPct ?? 0) >= 0;
  const barChartData = useMemo(() => {
    if (!report) return [];
    const list =
      scope === 'active'
        ? report.breakdown.filter((b) => b.enabled)
        : report.breakdown;
    return list.map((item) => ({
      ...item,
      shortName: shortenStrategyName(item.name),
    }));
  }, [report, scope]);

  return (
    <section className="rounded-2xl border border-white/8 bg-[#111827] p-5 sm:p-6 space-y-5">
      {/* Header & Interactive Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span>Бэктест по реальным свечам OHLCV</span>
            <span aria-hidden="true">·</span>
            <span>{report?.dataSource === 'live' ? 'Биржевой поток' : 'Исторический фид'}</span>
            <span aria-hidden="true">·</span>
            <span>Комиссия 0.08% учтена</span>
          </div>
          <h2 className="mt-1 text-lg sm:text-xl font-bold text-white flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-emerald-400 shrink-0" />
            <span>Оценка доходности выбранных стратегий (PnL)</span>
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Scope Segmented Control */}
          <div className="inline-flex items-center p-1 rounded-xl bg-[#0B0F17] border border-white/8">
            <button
              type="button"
              onClick={() => setScope('active')}
              className={`min-h-[36px] px-3 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                scope === 'active' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Активные ({activeSelectedCount})
            </button>
            <button
              type="button"
              onClick={() => {
                if (!isPro) {
                  onUpgradePro?.();
                  return;
                }
                setScope('all');
              }}
              className={`min-h-[36px] px-3 rounded-lg text-xs font-medium inline-flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                scope === 'all' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {!isPro && <Lock className="w-3 h-3 text-amber-400 shrink-0" />}
              <span>Все ({STRATEGY_CATALOG.length})</span>
            </button>
          </div>

          {/* Interval Segmented Control */}
          <div className="inline-flex items-center p-1 rounded-xl bg-[#0B0F17] border border-white/8">
            <button
              type="button"
              onClick={() => setInterval('1h')}
              className={`min-h-[36px] px-3 rounded-lg text-xs font-mono font-medium transition-colors whitespace-nowrap shrink-0 ${
                interval === '1h' ? 'bg-white/12 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              1H · ~4д
            </button>
            <button
              type="button"
              onClick={() => {
                if (!isPro) {
                  onUpgradePro?.();
                  return;
                }
                setInterval('4h');
              }}
              className={`min-h-[36px] px-3 rounded-lg text-xs font-mono font-medium inline-flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                interval === '4h' ? 'bg-white/12 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {!isPro && <Lock className="w-3 h-3 text-amber-400 shrink-0" />}
              <span>4H · ~15д</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (!isMax) {
                  (onUpgradeMax ?? onUpgradePro)?.();
                  return;
                }
                setInterval('1d');
              }}
              className={`min-h-[36px] px-3 rounded-lg text-xs font-mono font-medium inline-flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                interval === '1d'
                  ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-500/40'
                  : 'text-slate-400 hover:text-cyan-200'
              }`}
              title="Глубокий 3-месячный бэктест доступен в MAX"
            >
              {!isMax ? (
                <Lock className="w-3 h-3 text-cyan-400 shrink-0" />
              ) : (
                <Sparkles className="w-3 h-3 text-cyan-300 shrink-0" />
              )}
              <span>1D · ~90д</span>
            </button>
          </div>

          {/* Unit Toggle (% vs $) */}
          <div className="inline-flex items-center p-1 rounded-xl bg-[#0B0F17] border border-white/8">
            <button
              type="button"
              onClick={() => setUnitMode('pct')}
              className={`min-h-[36px] px-3 rounded-lg text-xs font-mono font-medium transition-colors whitespace-nowrap shrink-0 ${
                unitMode === 'pct' ? 'bg-amber-500 text-slate-950 font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              %
            </button>
            <button
              type="button"
              onClick={() => setUnitMode('usdt')}
              className={`min-h-[36px] px-3 rounded-lg text-xs font-mono font-medium transition-colors whitespace-nowrap shrink-0 ${
                unitMode === 'usdt' ? 'bg-amber-500 text-slate-950 font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              $ USDT
            </button>
          </div>

          {/* Deposit Simulator Input */}
          <label className="inline-flex items-center gap-1.5 min-h-[40px] rounded-xl border border-white/10 bg-[#0B0F17] px-3 text-xs text-slate-400">
            <span>Депозит $</span>
            <input
              type="number"
              min={100}
              max={1000000}
              step={100}
              value={depositUsdt}
              onChange={(e) => setDepositUsdt(Math.max(100, Number(e.target.value) || 100))}
              aria-label="Симуляция депозита в USDT"
              className="w-20 bg-transparent font-mono text-white font-semibold focus:outline-none"
            />
          </label>

          {isOutOfCredits ? (
            <button
              type="button"
              onClick={() => (isPro && !isMax ? (onUpgradeMax ?? onUpgradePro)?.() : onUpgradePro?.())}
              className="cta-shimmer min-h-[40px] px-3.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            >
              <Crown className="w-3.5 h-3.5 shrink-0" />
              <span>
                {isPro
                  ? `Безлимит в MAX (${MAX_X10_MONTHLY_QUOTA}–${MAX_X20_MONTHLY_QUOTA} кр.)`
                  : 'Перейти на PRO / MAX'}
              </span>
            </button>
          ) : (
            <button
              type="button"
              disabled={loading}
              onClick={() => void handleManualRecalculate()}
              aria-label="Пересчитать PnL стратегий"
              className="min-h-[40px] px-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 text-xs inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">
                {isMax
                  ? 'Пересчитать (0 кр. · MAX)'
                  : isSignedIn
                    ? `Пересчитать (${CREDIT_COSTS.portfolioBacktest} кр.)`
                    : 'Пересчитать'}
              </span>
            </button>
          )}
        </div>
      </div>

      {isOutOfCredits && (
        <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-start gap-2.5 text-amber-100">
            <Crown className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-amber-200">
                {isPro
                  ? `Кредиты PRO исчерпаны (${creditsRemaining ?? 0}/${PRO_MONTHLY_QUOTA} кр.)`
                  : `Лимит бесплатных кредитов достигнут (${creditsRemaining ?? 0}/${creditQuota} кр.)`}
              </div>
              <p className="mt-0.5 text-amber-200/80">
                {isPro
                  ? `Продлите PRO (+${PRO_MONTHLY_QUOTA} кр.) или перейдите на MAX X10 / X20 (${MAX_X10_MONTHLY_QUOTA}–${MAX_X20_MONTHLY_QUOTA} кр. и 0 кр. за бэктесты).`
                  : `Перейдите на PRO (${PRO_MONTHLY_QUOTA} кр.) или MAX (${MAX_X10_MONTHLY_QUOTA}–${MAX_X20_MONTHLY_QUOTA} кр.): 4H/1D-бэктесты всех ${STRATEGY_CATALOG.length} стратегий и безлимит сигналов.`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => (isPro && !isMax ? (onUpgradeMax ?? onUpgradePro)?.() : onUpgradePro?.())}
            className="cta-shimmer min-h-[38px] px-3.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold whitespace-nowrap shrink-0 transition-colors"
          >
            {isPro ? 'Открыть MAX (X10 / X20)' : 'Оформить PRO / MAX'}
          </button>
        </div>
      )}

      {/* 4-Column Tabular KPI Strip (Hairline Dividers, Zero Cards-in-Cards) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 py-4 border-y border-white/8 text-xs">
        <div>
          <div className="text-slate-400">Суммарный PnL</div>
          <div
            className={`mt-1 text-lg sm:text-xl font-bold font-mono tabular-nums inline-flex items-center gap-1 ${
              totalPositive ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {totalPositive ? (
              <ArrowUpRight className="w-4 h-4 shrink-0" />
            ) : (
              <ArrowDownRight className="w-4 h-4 shrink-0" />
            )}
            <span>
              {report ? formatSignedPct(report.summary.totalPnlPct) : '—'}
            </span>
          </div>
          <div className="mt-0.5 text-[11px] font-mono tabular-nums text-slate-400">
            {report ? formatSignedUsdt(report.summary.totalPnlUsdt) : 'Расчет…'}
          </div>
        </div>

        <div>
          <div className="text-slate-400">Винрейт (Win Rate)</div>
          <div className="mt-1 text-lg sm:text-xl font-bold font-mono tabular-nums text-white">
            {report ? `${report.summary.winRatePct}%` : '—'}
          </div>
          <div className="mt-0.5 text-[11px] font-mono tabular-nums text-slate-400">
            {report ? `${report.summary.totalTrades} симулированных сделок` : '—'}
          </div>
        </div>

        <div>
          <div className="text-slate-400">Profit Factor</div>
          <div
            className={`mt-1 text-lg sm:text-xl font-bold font-mono tabular-nums ${
              (report?.summary.profitFactor ?? 0) >= 1.2 ? 'text-emerald-400' : 'text-amber-300'
            }`}
          >
            {report ? report.summary.profitFactor.toFixed(2) : '—'}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-400">
            Отношение прибыли к убытку
          </div>
        </div>

        <div>
          <div className="text-slate-400">Макс. просадка</div>
          <div className="mt-1 text-lg sm:text-xl font-bold font-mono tabular-nums text-rose-400">
            {report ? `${report.summary.maxDrawdownPct.toFixed(2)}%` : '—'}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-400">
            Пиковый откат кривой капитала
          </div>
        </div>
      </div>

      {/* State Handling: Loading / Error / Empty Active / Recharts Visualization */}
      {loading && !report ? (
        <div className="h-[300px] w-full rounded-xl bg-[#0B0F17] border border-white/8 animate-pulse flex items-center justify-center text-xs text-slate-400">
          Симуляция доходности стратегий по свечам рынка…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-6 text-center space-y-3">
          <p className="text-xs text-rose-300">{error}</p>
          <button
            type="button"
            onClick={() => void fetchBacktest()}
            className="min-h-[40px] px-4 rounded-xl bg-rose-500/20 text-rose-200 text-xs font-medium"
          >
            Повторить расчет
          </button>
        </div>
      ) : scope === 'active' && activeSelectedCount === 0 ? (
        <div className="rounded-xl border border-white/8 bg-[#0B0F17] p-8 text-center space-y-3">
          <p className="text-sm text-slate-300">
            Нет активных стратегий для построения совокупной кривой PnL.
          </p>
          <p className="text-xs text-slate-400">
            Включите хотя бы одну стратегию выше или переключите режим просмотра на все доступные алгоритмы.
          </p>
          {isPro ? (
            <button
              type="button"
              onClick={() => setScope('all')}
              className="min-h-[40px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white transition-colors"
            >
              Показать все {STRATEGY_CATALOG.length} стратегий
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onUpgradePro?.()}
              className="min-h-[40px] px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-xs font-semibold text-slate-950 transition-colors"
            >
              Открыть все {STRATEGY_CATALOG.length} стратегий в PRO
            </button>
          )}
        </div>
      ) : report ? (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Left: Cumulative Equity Curve (Area + Spot/Futures Line Comparison) */}
          <div className="xl:col-span-7 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-medium text-white">Кривая кумулятивного PnL</span>
              <div className="flex flex-wrap items-center gap-3 text-slate-400">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-0.5 bg-emerald-400 inline-block" />
                  <span>Портфель</span>
                </span>
                {unitMode === 'pct' && (
                  <>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-0.5 bg-sky-400 inline-block" />
                      <span>Спот</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-0.5 bg-amber-400 inline-block" />
                      <span>Фьючерсы</span>
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="h-[280px] w-full rounded-xl bg-[#0B0F17] border border-white/8 pt-3 pr-2 pb-1">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={report.equityCurve} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                  <defs>
                    <linearGradient id="pnlAreaPos" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.32} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="pnlAreaNeg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.28} />
                      <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                    minTickGap={28}
                  />
                  <YAxis
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={58}
                    tickFormatter={(v: number) =>
                      unitMode === 'pct' ? `${v > 0 ? '+' : ''}${v}%` : `$${Math.round(v)}`
                    }
                  />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.18)" strokeDasharray="4 4" />
                  <Tooltip content={<EquityTooltip unitMode={unitMode} />} />
                  <Area
                    type="monotone"
                    dataKey={unitMode === 'pct' ? 'portfolioPnlPct' : 'portfolioPnlUsdt'}
                    stroke={totalPositive ? '#10b981' : '#f43f5e'}
                    strokeWidth={2.2}
                    fill={totalPositive ? 'url(#pnlAreaPos)' : 'url(#pnlAreaNeg)'}
                    isAnimationActive={false}
                  />
                  {unitMode === 'pct' && (
                    <>
                      <Line
                        type="monotone"
                        dataKey="spotPnlPct"
                        stroke="#38bdf8"
                        strokeWidth={1.5}
                        dot={false}
                        strokeDasharray="4 3"
                        isAnimationActive={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="futuresPnlPct"
                        stroke="#f59e0b"
                        strokeWidth={1.5}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </>
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Right: Per-Strategy PnL Breakdown BarChart */}
          <div className="xl:col-span-5 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-white">Доходность по каждой стратегии</span>
              <span className="text-slate-400">PnL % за период</span>
            </div>

            <div className="h-[280px] w-full rounded-xl bg-[#0B0F17] border border-white/8 pt-3 pr-3 pb-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={barChartData}
                  layout="vertical"
                  margin={{ top: 4, right: 16, left: 6, bottom: 4 }}
                >
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                    tickFormatter={(v: number) => `${v > 0 ? '+' : ''}${v}%`}
                  />
                  <YAxis
                    type="category"
                    dataKey="shortName"
                    width={136}
                    tick={{ fill: '#cbd5e1', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <ReferenceLine x={0} stroke="rgba(255,255,255,0.22)" />
                  <Tooltip content={<StrategyBarTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                  <Bar dataKey="totalPnlPct" radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false}>
                    {barChartData.map((entry) => (
                      <Cell
                        key={entry.strategyKey}
                        fill={entry.totalPnlPct >= 0 ? '#10b981' : '#f43f5e'}
                        fillOpacity={entry.enabled ? 0.92 : 0.45}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Dense Tabular Strategy Comparison Strip */}
          <div className="xl:col-span-12 overflow-x-auto pt-2 border-t border-white/8">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-white/8 text-slate-400">
                  <th className="py-2.5 pr-4 font-medium">Стратегия</th>
                  <th className="py-2.5 px-3 font-medium">Рынок</th>
                  <th className="py-2.5 px-3 font-medium">Статус</th>
                  <th className="py-2.5 px-3 font-medium text-right">Сделки</th>
                  <th className="py-2.5 px-3 font-medium text-right">Винрейт</th>
                  <th className="py-2.5 px-3 font-medium text-right">Просадка</th>
                  <th className="py-2.5 pl-3 font-medium text-right">PnL (% / $)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/6 font-mono tabular-nums">
                {report.breakdown.map((row) => {
                  const tplTier = getStrategyTemplate(row.strategyKey)?.tier;
                  return (
                    <tr key={row.strategyKey} className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-2.5 pr-4 font-sans font-medium text-white whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          {tplTier === 'max' && (
                            <span className="font-mono text-[10px] font-semibold text-cyan-300">MAX</span>
                          )}
                          <span>{row.name}</span>
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-sans text-slate-400 whitespace-nowrap">
                        {row.marketType === 'futures' ? 'Фьючерсы' : 'Спот'}
                      </td>
                      <td
                        className={`py-2.5 px-3 font-sans font-medium whitespace-nowrap ${
                          row.enabled ? 'text-emerald-400' : 'text-slate-500'
                        }`}
                      >
                        {row.enabled ? 'Активен' : 'Неактивен'}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-300">{row.tradesCount}</td>
                      <td
                        className={`py-2.5 px-3 text-right ${
                          row.winRatePct >= 55 ? 'text-emerald-300 font-semibold' : 'text-slate-200'
                        }`}
                      >
                        {row.winRatePct}%
                      </td>
                      <td className="py-2.5 px-3 text-right text-rose-300">{row.maxDrawdownPct}%</td>
                      <td
                        className={`py-2.5 pl-3 text-right font-semibold whitespace-nowrap ${
                          row.totalPnlPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {formatSignedPct(row.totalPnlPct)} · {formatSignedUsdt(row.totalPnlUsdt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
};
