import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  ArrowUpRight,
  BellRing,
  BookOpen,
  CheckCircle2,
  History,
  Lock,
  PieChart as PieChartIcon,
  RotateCcw,
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react';
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  DailyPnlSummary,
  PaperPortfolioReport,
  PortfolioIdentity,
  PortfolioSourceMeta,
} from '../hooks/usePaperPortfolio';
import { usePlan } from '../contexts/PlanContext';
import { db } from '../lib/firebase';
import { computeJournalStats, tradePnlPct, tradeRMultiple } from '../lib/journalStats';
import type {
  AnalysisRecord,
  CandlePoint,
  MarketType,
  PortfolioTargetRecord,
  TickerOverview,
  TradeRecord,
} from '../types/domain';
import { PortfolioStressTestCard } from './PortfolioStressTestCard';

const STABLE_SYMBOLS = new Set(['USDTUSDT', 'USDCUSDT', 'FDUSDUSDT', 'BUSDUSDT', 'DAIUSDT', 'TUSDUSDT', 'USDEUSDT']);

interface PortfolioDetailsModalProps {
  open: boolean;
  onClose: () => void;
  uid: string | null;
  isSignedIn: boolean;
  report: PaperPortfolioReport;
  dailyPnl: DailyPnlSummary;
  portfolioSource?: PortfolioSourceMeta;
  portfolioIdentity: PortfolioIdentity;
  portfolioTargets: PortfolioTargetRecord[];
  pushSubscribed: boolean;
  notifyPortfolioPnlEnabled: boolean;
  spotTickers: TickerOverview[];
  analyses: AnalysisRecord[];
  onRequireLogin: () => void;
  onOpenPairOnMarket: (symbol: string, marketType: MarketType) => void;
  onManageInScreener: () => void;
  onOpenTradeJournal: () => void;
  onOpenExchangeIntegrations?: () => void;
  onOpenPushSettings: () => void;
  onSavePortfolioTarget: (params: {
    portfolioId: string;
    portfolioLabel: string;
    targetBalanceUsdt: number;
    baselineBalanceUsdt: number;
    targetPnlPct: number;
  }) => Promise<void>;
  onDeletePortfolioTarget: (targetId: string) => Promise<void>;
  onRemoveHolding: (id: string) => void;
  onClearPortfolio: () => void;
  onResetDemo: () => void;
}

type ModalTab = 'breakdown' | 'history';
type TradeFilter = 'all' | 'open' | 'closed';
type BreakdownSort = 'value' | 'totalPnl' | 'dailyPnl';
type ChartRange = '24h' | '7d' | '30d';

const CHART_RANGE_CONFIG: Record<
  ChartRange,
  {
    label: string;
    title: string;
    candleInterval: '15m' | '4h';
    intervalLabel: string;
    durationMs: number;
    stableCount: number;
    stableStepMs: number;
  }
> = {
  '24h': {
    label: '24ч',
    title: 'за последние 24 часа',
    candleInterval: '15m',
    intervalLabel: '15м',
    durationMs: 24 * 60 * 60 * 1000,
    stableCount: 25,
    stableStepMs: 60 * 60 * 1000,
  },
  '7d': {
    label: '7д',
    title: 'за последние 7 дней',
    candleInterval: '4h',
    intervalLabel: '4ч',
    durationMs: 7 * 24 * 60 * 60 * 1000,
    stableCount: 43,
    stableStepMs: 4 * 60 * 60 * 1000,
  },
  '30d': {
    label: '30д',
    title: 'за последние 30 дней',
    candleInterval: '4h',
    intervalLabel: '4ч',
    durationMs: 30 * 24 * 60 * 60 * 1000,
    stableCount: 31,
    stableStepMs: 24 * 60 * 60 * 1000,
  },
};

function formatUsd(val: number): string {
  const abs = Math.abs(val);
  if (abs >= 1000) {
    return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (abs >= 1) return `$${val.toFixed(2)}`;
  return `$${val.toFixed(4)}`;
}

function formatSignedUsd(val: number): string {
  const sign = val >= 0 ? '+' : '-';
  const abs = Math.abs(val);
  return `${sign}$${abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatPrice(val: number): string {
  if (val >= 1000) return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (val >= 1) return val.toFixed(3);
  return val.toFixed(5);
}

function formatCompactUsd(val: number): string {
  const abs = Math.abs(val);
  if (abs >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `$${(val / 1_000).toFixed(1)}k`;
  if (abs >= 1_000) return `$${(val / 1_000).toFixed(2)}k`;
  if (abs >= 100) return `$${Math.round(val)}`;
  return `$${val.toFixed(0)}`;
}

interface PortfolioCurvePoint {
  time: number;
  dateLabel: string;
  fullDateLabel: string;
  valueUsdt: number;
}

const PortfolioValueTooltip: React.FC<{
  active?: boolean;
  payload?: Array<{ payload?: PortfolioCurvePoint }>;
  startValue: number;
  periodLabel: string;
}> = ({ active, payload, startValue, periodLabel }) => {
  if (!active || !payload || payload.length === 0 || !payload[0]?.payload) return null;
  const pt = payload[0].payload;
  const deltaUsd = pt.valueUsdt - startValue;
  const deltaPct = startValue > 0 ? (deltaUsd / startValue) * 100 : 0;
  const isUp = deltaUsd >= 0;
  return (
    <div className="rounded-xl border border-white/15 bg-[#0E1420]/95 px-3 py-2 text-xs shadow-lg backdrop-blur-md space-y-1 font-mono tabular-nums">
      <div className="font-sans text-[11px] text-slate-400">{pt.fullDateLabel}</div>
      <div className="text-sm font-bold text-white">{formatUsd(pt.valueUsdt)}</div>
      <div className={`text-[11px] ${isUp ? 'text-emerald-400' : 'text-rose-400'}`}>
        {formatSignedUsd(deltaUsd)} ({isUp ? '+' : ''}
        {deltaPct.toFixed(2)}%) за {periodLabel}
      </div>
    </div>
  );
};

function formatTradeDate(t: TradeRecord): string {
  if (t.status === 'closed' && t.closedAt) {
    const ms = Date.parse(t.closedAt);
    if (Number.isFinite(ms)) {
      return new Date(ms).toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    }
  }
  const sec = t.createdAt?.seconds;
  if (typeof sec === 'number' && sec > 0) {
    return new Date(sec * 1000).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  return '—';
}

export const PortfolioDetailsModal: React.FC<PortfolioDetailsModalProps> = ({
  open,
  onClose,
  uid,
  isSignedIn,
  report,
  dailyPnl,
  portfolioSource,
  portfolioIdentity,
  portfolioTargets,
  pushSubscribed,
  notifyPortfolioPnlEnabled,
  spotTickers,
  analyses,
  onRequireLogin,
  onOpenPairOnMarket,
  onManageInScreener,
  onOpenTradeJournal,
  onOpenExchangeIntegrations,
  onOpenPushSettings,
  onSavePortfolioTarget,
  onDeletePortfolioTarget,
  onRemoveHolding,
  onClearPortfolio,
  onResetDemo,
}) => {
  const { maskValue } = usePlan();
  const [activeTab, setActiveTab] = useState<ModalTab>('breakdown');
  const [sortBy, setSortBy] = useState<BreakdownSort>('value');
  const [tradeFilter, setTradeFilter] = useState<TradeFilter>('all');
  const [historySource, setHistorySource] = useState<'journal' | 'signals'>('journal');
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [tradesError, setTradesError] = useState<string | null>(null);
  const [futuresPrices, setFuturesPrices] = useState<Record<string, number>>({});
  const [confirmClear, setConfirmClear] = useState(false);
  const [chartRange, setChartRange] = useState<ChartRange>('7d');
  const [candlesByKey, setCandlesByKey] = useState<Record<string, CandlePoint[]>>({});
  const candlesByKeyRef = useRef(candlesByKey);
  candlesByKeyRef.current = candlesByKey;
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);
  const [chartReloadTick, setChartReloadTick] = useState(0);
  const lastReloadTickRef = useRef(0);

  // Target PnL state for the selected portfolio
  const [targetPortfolioId, setTargetPortfolioId] = useState<string>(portfolioIdentity.portfolioId);
  const [targetBalanceInput, setTargetBalanceInput] = useState<string>('');
  const [targetPctInput, setTargetPctInput] = useState<string>('10');
  const [targetSaving, setTargetSaving] = useState(false);
  const [targetError, setTargetError] = useState<string | null>(null);
  const [targetFeedback, setTargetFeedback] = useState<string | null>(null);

  const portfolioOptions = useMemo(() => {
    const map = new Map<string, { id: string; label: string }>();
    map.set(portfolioIdentity.portfolioId, {
      id: portfolioIdentity.portfolioId,
      label: portfolioIdentity.portfolioLabel,
    });
    for (const t of portfolioTargets) {
      if (!map.has(t.portfolioId)) {
        map.set(t.portfolioId, { id: t.portfolioId, label: t.portfolioLabel });
      }
    }
    return Array.from(map.values());
  }, [portfolioIdentity.portfolioId, portfolioIdentity.portfolioLabel, portfolioTargets]);

  const activePortfolioTarget = useMemo(
    () => portfolioTargets.find((t) => t.portfolioId === portfolioIdentity.portfolioId) ?? null,
    [portfolioTargets, portfolioIdentity.portfolioId]
  );

  const selectedPortfolioTarget = useMemo(
    () => portfolioTargets.find((t) => t.portfolioId === targetPortfolioId) ?? null,
    [portfolioTargets, targetPortfolioId]
  );

  const selectedPortfolioLabel = useMemo(
    () => portfolioOptions.find((o) => o.id === targetPortfolioId)?.label ?? portfolioIdentity.portfolioLabel,
    [portfolioOptions, targetPortfolioId, portfolioIdentity.portfolioLabel]
  );

  // Close on Escape and lock body scroll while modal is open
  useEffect(() => {
    if (!open) return;
    setConfirmClear(false);
    setTargetPortfolioId(portfolioIdentity.portfolioId);
    setTargetError(null);
    setTargetFeedback(null);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKey);
    };
  }, [open, onClose, portfolioIdentity.portfolioId]);

  // Synchronize Target PnL inputs when switching target portfolio or opening modal
  useEffect(() => {
    if (!open) return;
    const isCurrentPortfolio = targetPortfolioId === portfolioIdentity.portfolioId;
    const baseVal = isCurrentPortfolio
      ? report.totalValue
      : (selectedPortfolioTarget?.baselineBalanceUsdt ?? 0);

    if (selectedPortfolioTarget) {
      setTargetBalanceInput(selectedPortfolioTarget.targetBalanceUsdt.toFixed(2));
      setTargetPctInput(selectedPortfolioTarget.targetPnlPct.toFixed(1));
    } else if (baseVal > 0) {
      const defaultPct = 10;
      setTargetPctInput('10');
      setTargetBalanceInput((baseVal * (1 + defaultPct / 100)).toFixed(2));
    } else {
      setTargetPctInput('10');
      setTargetBalanceInput('');
    }
    setTargetError(null);
  }, [
    open,
    targetPortfolioId,
    portfolioIdentity.portfolioId,
    selectedPortfolioTarget,
    report.totalValue,
  ]);

  // Live subscription to user's Firestore trade journal while modal is open
  useEffect(() => {
    if (!open || !uid || !isSignedIn) {
      setTrades([]);
      setTradesError(null);
      return;
    }
    setTradesError(null);
    const q = query(collection(db, 'users', uid, 'trades'), where('userId', '==', uid));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => d.data() as TradeRecord);
        list.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
        setTrades(list);
      },
      () => {
        setTradesError('Не удалось загрузить историю сделок. Попробуйте открыть дневник напрямую.');
      }
    );
    return unsub;
  }, [open, uid, isSignedIn]);

  // Fetch futures live prices if there are open futures trades in history
  useEffect(() => {
    if (!open) return;
    const needsFutures = trades.some((t) => t.status === 'open' && t.marketType === 'futures');
    if (!needsFutures) return;
    let cancelled = false;
    fetch('/api/market/overview?marketType=futures')
      .then((r) => (r.ok ? (r.json() as Promise<{ tickers?: TickerOverview[] }>) : null))
      .then((data) => {
        if (cancelled || !data?.tickers) return;
        const map: Record<string, number> = {};
        for (const t of data.tickers) map[t.symbol] = t.price;
        setFuturesPrices(map);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, trades]);

  const spotPriceMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of spotTickers) map[t.symbol] = t.price;
    return map;
  }, [spotTickers]);

  const sortedAssetBreakdown = useMemo(() => {
    const list = report.allocations.map((alloc) => {
      const lots = report.rows.filter((r) => r.symbol === alloc.symbol);
      const totalAmount = lots.reduce((acc, r) => acc + r.amount, 0);
      const totalCostUsdt = lots.reduce((acc, r) => acc + r.costUsdt, 0);
      const avgEntryPrice = totalAmount > 0 ? totalCostUsdt / totalAmount : 0;
      const livePrice = lots[0]?.livePrice ?? 0;
      return {
        ...alloc,
        lots,
        totalAmount,
        totalCostUsdt,
        avgEntryPrice,
        livePrice,
      };
    });

    list.sort((a, b) => {
      if (sortBy === 'totalPnl') return b.pnlUsdt - a.pnlUsdt;
      if (sortBy === 'dailyPnl') return b.dailyPnlUsdt - a.dailyPnlUsdt;
      return b.valueUsdt - a.valueUsdt;
    });
    return list;
  }, [report.allocations, report.rows, sortBy]);

  const bestDailyAsset = useMemo(() => {
    if (!report.hasLive24hData || report.allocations.length === 0) return null;
    return [...report.allocations].sort((a, b) => b.dailyPnlPct - a.dailyPnlPct)[0];
  }, [report.allocations, report.hasLive24hData]);

  const journalStats = useMemo(() => computeJournalStats(trades), [trades]);

  const filteredTrades = useMemo(() => {
    if (tradeFilter === 'open') return trades.filter((t) => t.status === 'open');
    if (tradeFilter === 'closed') return trades.filter((t) => t.status === 'closed');
    return trades;
  }, [trades, tradeFilter]);

  const assetAmounts = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of report.rows) {
      totals.set(row.symbol, (totals.get(row.symbol) ?? 0) + row.amount);
    }
    return Array.from(totals.entries())
      .map(([symbol, amount]) => ({ symbol, amount }))
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [report.rows]);

  const assetHoldingsKey = useMemo(
    () => assetAmounts.map((a) => `${a.symbol}:${a.amount}`).join('|'),
    [assetAmounts]
  );

  const activeRangeMeta = CHART_RANGE_CONFIG[chartRange];

  // Fetch spot candles (15m for 24h, 4h for 7d/30d) for each non-stable portfolio asset
  useEffect(() => {
    const volatileAssets = assetAmounts.filter((a) => !STABLE_SYMBOLS.has(a.symbol.toUpperCase()));
    if (!open || volatileAssets.length === 0) {
      setChartLoading(false);
      setChartError(null);
      return;
    }

    const isManualReload = chartReloadTick !== lastReloadTickRef.current;
    lastReloadTickRef.current = chartReloadTick;

    const interval = activeRangeMeta.candleInterval;
    const missingAssets = isManualReload
      ? volatileAssets
      : volatileAssets.filter((a) => !(candlesByKeyRef.current[`${interval}:${a.symbol}`]?.length > 0));

    if (missingAssets.length === 0) {
      setChartLoading(false);
      setChartError(null);
      return;
    }

    let cancelled = false;
    setChartLoading(true);
    setChartError(null);

    Promise.allSettled(
      missingAssets.map(async ({ symbol }) => {
        const res = await fetch(
          `/api/market/candles?symbol=${encodeURIComponent(symbol)}&interval=${interval}&marketType=spot`
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { candles?: CandlePoint[] };
        return { symbol, candles: Array.isArray(data.candles) ? data.candles : [] };
      })
    ).then((results) => {
      if (cancelled) return;
      const nextMap: Record<string, CandlePoint[]> = {};
      let okCount = 0;
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.candles.length > 0) {
          nextMap[`${interval}:${r.value.symbol}`] = r.value.candles;
          okCount += 1;
        }
      }
      if (okCount === 0) {
        setChartError(`Не удалось загрузить исторические свечи для графика (${activeRangeMeta.label}).`);
      } else {
        setCandlesByKey((prev) => ({ ...prev, ...nextMap }));
      }
      setChartLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [open, assetHoldingsKey, assetAmounts, activeRangeMeta.candleInterval, activeRangeMeta.label, chartReloadTick]);

  const chartSeries = useMemo(() => {
    if (assetAmounts.length === 0) return null;
    const interval = activeRangeMeta.candleInterval;
    const referenceAsset = assetAmounts.find(
      (a) =>
        !STABLE_SYMBOLS.has(a.symbol.toUpperCase()) &&
        (candlesByKey[`${interval}:${a.symbol}`]?.length ?? 0) > 0
    );

    const nowMs = Date.now();
    let baseTimeline: Array<{ time: number }> = [];

    if (referenceAsset) {
      const refCandles = candlesByKey[`${interval}:${referenceAsset.symbol}`] ?? [];
      if (refCandles.length < 2) return null;
      const latestTs = refCandles[refCandles.length - 1].time;
      const cutoffTs = latestTs - activeRangeMeta.durationMs;
      const windowCandles = refCandles.filter((c) => c.time >= cutoffTs);
      baseTimeline = windowCandles.length >= 2 ? windowCandles : refCandles.slice(-Math.min(refCandles.length, 43));
    } else {
      // Stablecoin-only portfolio fallback: generate clean timestamps over active timeframe
      const allStables = assetAmounts.every((a) => STABLE_SYMBOLS.has(a.symbol.toUpperCase()));
      if (!allStables) return null;
      for (let i = activeRangeMeta.stableCount - 1; i >= 0; i -= 1) {
        baseTimeline.push({ time: nowMs - i * activeRangeMeta.stableStepMs });
      }
    }

    const points: PortfolioCurvePoint[] = baseTimeline.map((pt, idx) => {
      const ts = pt.time;
      let totalUsdt = 0;

      for (const { symbol, amount } of assetAmounts) {
        if (STABLE_SYMBOLS.has(symbol.toUpperCase())) {
          totalUsdt += amount;
          continue;
        }
        const series = candlesByKey[`${interval}:${symbol}`];
        if (series && series.length > 0) {
          // Find latest candle at or before `ts`
          let matchedClose = series[0].close;
          for (let i = series.length - 1; i >= 0; i -= 1) {
            if (series[i].time <= ts) {
              matchedClose = series[i].close;
              break;
            }
          }
          totalUsdt += amount * matchedClose;
        } else {
          // Fallback to live price if candle stream for one minor asset wasn't available
          const live = report.allocations.find((a) => a.symbol === symbol);
          if (live && amount > 0) totalUsdt += live.valueUsdt;
        }
      }

      // Anchor final point cleanly to live portfolio valuation
      if (idx === baseTimeline.length - 1 && report.totalValue > 0) {
        totalUsdt = report.totalValue;
      }

      const dt = new Date(ts);
      const dateLabel =
        chartRange === '24h'
          ? dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
          : dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
      const fullDateLabel = dt.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });

      return {
        time: ts,
        dateLabel,
        fullDateLabel,
        valueUsdt: Number(totalUsdt.toFixed(2)),
      };
    });

    if (points.length < 2) return null;
    const startValue = points[0].valueUsdt;
    const endValue = points[points.length - 1].valueUsdt;
    const changeUsdt = endValue - startValue;
    const changePct = startValue > 0 ? (changeUsdt / startValue) * 100 : 0;
    let minVal = points[0].valueUsdt;
    let maxVal = points[0].valueUsdt;
    for (const p of points) {
      if (p.valueUsdt < minVal) minVal = p.valueUsdt;
      if (p.valueUsdt > maxVal) maxVal = p.valueUsdt;
    }
    const span = Math.max(maxVal - minVal, Math.max(endValue * 0.01, 1));
    const yMin = Math.max(0, minVal - span * 0.14);
    const yMax = maxVal + span * 0.14;

    return {
      points,
      startValue,
      endValue,
      changeUsdt,
      changePct,
      minVal,
      maxVal,
      yMin,
      yMax,
    };
  }, [assetAmounts, candlesByKey, activeRangeMeta, chartRange, report.allocations, report.totalValue]);

  const isPositiveTotal = report.totalPnl >= 0;
  const isPositiveDaily = dailyPnl.dailyPnlUsdt >= 0;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="portfolio-details-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label="Детали портфеля и история сделок"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm p-0 sm:p-4"
        >
          <motion.div
            key="portfolio-details-dialog"
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-3xl max-h-[92dvh] flex flex-col rounded-t-2xl sm:rounded-2xl border border-white/10 bg-[#111827] shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <header className="px-4 sm:px-6 py-4 border-b border-white/8 flex items-start justify-between gap-3 bg-[#0E1420]">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                  <Wallet className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base sm:text-lg font-bold text-white truncate">
                    Портфель и история сделок
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5 flex flex-wrap items-center gap-1.5">
                    <span>Позиций: {report.rows.length}</span>
                    <span aria-hidden="true">·</span>
                    <span>Активов: {report.allocations.length}</span>
                    <span aria-hidden="true">·</span>
                    <span>Сделок в журнале: {trades.length}</span>
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="Закрыть окно портфеля"
                className="min-h-[40px] min-w-[40px] rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 flex items-center justify-center transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </header>

            {/* Top KPI Summary Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-white/8 border-b border-white/8 bg-[#0B0F17]/70">
              <div className="px-4 py-3">
                <div className="text-[11px] text-slate-400">Общий баланс</div>
                <div className="mt-1 text-base sm:text-lg font-bold font-mono tabular-nums text-white">
                  {maskValue(formatUsd(report.totalValue))}
                </div>
                <div className="text-[11px] font-mono tabular-nums text-slate-500">
                  Вход: {maskValue(formatUsd(report.totalCost))}
                </div>
              </div>

              <div className="px-4 py-3">
                <div className="text-[11px] text-slate-400">Дневной PnL (24ч)</div>
                <div
                  className={`mt-1 text-base sm:text-lg font-bold font-mono tabular-nums ${
                    !dailyPnl.hasLive24hData || report.rows.length === 0
                      ? 'text-slate-400'
                      : isPositiveDaily
                        ? 'text-emerald-400'
                        : 'text-rose-400'
                  }`}
                >
                  {dailyPnl.hasLive24hData && report.rows.length > 0
                    ? maskValue(formatSignedUsd(dailyPnl.dailyPnlUsdt))
                    : '—'}
                </div>
                <div className="text-[11px] font-mono tabular-nums text-slate-400">
                  {dailyPnl.hasLive24hData && report.rows.length > 0
                    ? `${dailyPnl.dailyPnlPct >= 0 ? '+' : ''}${dailyPnl.dailyPnlPct.toFixed(2)}% за 24ч`
                    : 'Ожидание котировок'}
                </div>
              </div>

              <div className="px-4 py-3">
                <div className="text-[11px] text-slate-400">Общий PnL</div>
                <div
                  className={`mt-1 text-base sm:text-lg font-bold font-mono tabular-nums ${
                    report.rows.length === 0
                      ? 'text-slate-400'
                      : isPositiveTotal
                        ? 'text-emerald-400'
                        : 'text-rose-400'
                  }`}
                >
                  {report.rows.length > 0 ? maskValue(formatSignedUsd(report.totalPnl)) : '—'}
                </div>
                <div
                  className={`text-[11px] font-mono tabular-nums ${
                    report.rows.length === 0
                      ? 'text-slate-500'
                      : isPositiveTotal
                        ? 'text-emerald-400/80'
                        : 'text-rose-400/80'
                  }`}
                >
                  {report.rows.length > 0
                    ? `${isPositiveTotal ? '+' : ''}${report.totalPnlPct.toFixed(2)}% от входа`
                    : 'Нет позиций'}
                </div>
              </div>

              <div className="px-4 py-3">
                <div className="text-[11px] text-slate-400">Винрейт дневника</div>
                <div className="mt-1 text-base sm:text-lg font-bold font-mono tabular-nums text-white">
                  {journalStats.winRatePct !== null ? `${Math.round(journalStats.winRatePct)}%` : '—'}
                </div>
                <div className="text-[11px] font-mono tabular-nums text-slate-400">
                  {journalStats.avgR !== null
                    ? `Ср. ${journalStats.avgR >= 0 ? '+' : ''}${journalStats.avgR.toFixed(2)}R · `
                    : ''}
                  {journalStats.closedCount} закр. / {journalStats.openCount} откр.
                </div>
              </div>
            </div>

            {/* Modal Sub-Navigation Tabs */}
            <div className="px-4 sm:px-6 pt-3 pb-2 border-b border-white/8 flex flex-wrap items-center justify-between gap-2 bg-[#111827]">
              <div
                role="tablist"
                aria-label="Разделы портфеля"
                className="inline-flex items-center p-1 rounded-xl bg-[#0B0F17] border border-white/8"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'breakdown'}
                  onClick={() => setActiveTab('breakdown')}
                  className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
                    activeTab === 'breakdown'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <PieChartIcon className="w-3.5 h-3.5" />
                  <span>Разбивка PnL по активам</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'history'}
                  onClick={() => setActiveTab('history')}
                  className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
                    activeTab === 'history'
                      ? 'bg-cyan-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <History className="w-3.5 h-3.5" />
                  <span>История сделок</span>
                  <span className="font-mono text-[11px] opacity-80">({trades.length})</span>
                </button>
              </div>

              {activeTab === 'breakdown' && sortedAssetBreakdown.length > 0 && (
                <div className="inline-flex items-center gap-1 text-[11px]">
                  <span className="text-slate-500 mr-1 hidden sm:inline">Сортировка:</span>
                  {(
                    [
                      { id: 'value', label: 'Доля' },
                      { id: 'dailyPnl', label: 'PnL 24ч' },
                      { id: 'totalPnl', label: 'Общий PnL' },
                    ] as Array<{ id: BreakdownSort; label: string }>
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setSortBy(opt.id)}
                      className={`min-h-[30px] px-2.5 rounded-lg border transition-colors ${
                        sortBy === opt.id
                          ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200 font-medium'
                          : 'border-white/8 bg-white/[0.03] text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}

              {activeTab === 'history' && (
                <div className="inline-flex items-center gap-1.5 text-[11px]">
                  <div className="inline-flex items-center p-0.5 rounded-lg bg-[#0B0F17] border border-white/8">
                    <button
                      type="button"
                      onClick={() => setHistorySource('journal')}
                      className={`min-h-[28px] px-2.5 rounded-md font-medium transition-colors ${
                        historySource === 'journal'
                          ? 'bg-white/12 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Дневник ({trades.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setHistorySource('signals')}
                      className={`min-h-[28px] px-2.5 rounded-md font-medium transition-colors ${
                        historySource === 'signals'
                          ? 'bg-white/12 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      AI-сигналы ({analyses.length})
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Scrollable Body */}
            <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
              {activeTab === 'breakdown' ? (
                sortedAssetBreakdown.length === 0 ? (
                  <div className="py-10 text-center space-y-3">
                    <div className="mx-auto w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-slate-400">
                      <Wallet className="w-6 h-6" />
                    </div>
                    <h3 className="text-sm font-semibold text-white">В портфеле пока нет активов</h3>
                    <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                      Добавьте позиции в разделе Скринера или восстановите демонстрационный портфель (BTC, ETH, SOL), чтобы отслеживать дневной и общий PnL.
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={onResetDemo}
                        className="min-h-[40px] px-4 rounded-xl border border-cyan-500/35 bg-cyan-500/12 hover:bg-cyan-500/20 text-xs font-semibold text-cyan-200 inline-flex items-center gap-1.5 transition-colors"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Восстановить демо</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onManageInScreener();
                        }}
                        className="min-h-[40px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white inline-flex items-center gap-1.5 transition-colors"
                      >
                        <span>Добавить в Скринере</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Portfolio Value LineChart (Recharts) with 24h / 7d / 30d timeframe switcher */}
                    <div className="pb-4 border-b border-white/8 space-y-2.5">
                      <div className="flex flex-wrap items-start justify-between gap-2.5">
                        <div>
                          <div className="text-xs font-semibold text-white">
                            Стоимость портфеля {activeRangeMeta.title}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            Динамика оценки текущего состава активов по {activeRangeMeta.intervalLabel} рыночным свечам
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 ml-auto">
                          <div
                            role="group"
                            aria-label="Таймфрейм графика стоимости портфеля"
                            className="inline-flex items-center p-0.5 rounded-lg bg-[#0B0F17] border border-white/10"
                          >
                            {(['24h', '7d', '30d'] as ChartRange[]).map((rangeKey) => {
                              const active = chartRange === rangeKey;
                              return (
                                <button
                                  key={rangeKey}
                                  type="button"
                                  aria-pressed={active}
                                  onClick={() => setChartRange(rangeKey)}
                                  className={`min-h-[28px] px-2.5 rounded-md text-[11px] font-semibold font-mono transition-colors ${
                                    active
                                      ? 'bg-emerald-600 text-white shadow-sm'
                                      : 'text-slate-400 hover:text-slate-200'
                                  }`}
                                >
                                  {CHART_RANGE_CONFIG[rangeKey].label}
                                </button>
                              );
                            })}
                          </div>

                          {chartSeries && (
                            <div className="flex items-center gap-2.5 font-mono tabular-nums text-xs">
                              <span className="hidden md:inline text-[11px] text-slate-400">
                                Мин {formatUsd(chartSeries.minVal)} · Макс {formatUsd(chartSeries.maxVal)}
                              </span>
                              <span
                                className={`font-semibold ${
                                  chartSeries.changeUsdt >= 0 ? 'text-emerald-400' : 'text-rose-400'
                                }`}
                              >
                                {formatSignedUsd(chartSeries.changeUsdt)} ({chartSeries.changePct >= 0 ? '+' : ''}
                                {chartSeries.changePct.toFixed(2)}%)
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {chartLoading && !chartSeries ? (
                        <div className="h-[195px] w-full rounded-xl bg-[#0B0F17] border border-white/8 animate-pulse flex items-center justify-center text-xs text-slate-400">
                          Загрузка графика стоимости за {activeRangeMeta.label}…
                        </div>
                      ) : chartError && !chartSeries ? (
                        <div className="h-[140px] w-full rounded-xl bg-[#0B0F17] border border-rose-500/25 flex flex-col items-center justify-center gap-2 px-4 text-center">
                          <span className="text-xs text-rose-300">{chartError}</span>
                          <button
                            type="button"
                            onClick={() => setChartReloadTick((t) => t + 1)}
                            className="min-h-[32px] px-3 rounded-lg bg-white/8 hover:bg-white/15 text-xs text-slate-200 transition-colors"
                          >
                            Повторить
                          </button>
                        </div>
                      ) : chartSeries ? (
                        <div className="h-[195px] w-full rounded-xl bg-[#0B0F17] border border-white/8 pt-3 pr-2 pb-1">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart
                              data={chartSeries.points}
                              margin={{ top: 8, right: 12, left: 0, bottom: 2 }}
                            >
                              <CartesianGrid
                                stroke="rgba(255,255,255,0.06)"
                                strokeDasharray="3 3"
                                vertical={false}
                              />
                              <XAxis
                                dataKey="dateLabel"
                                tick={{ fill: '#94a3b8', fontSize: 11 }}
                                tickLine={false}
                                axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                                minTickGap={30}
                              />
                              <YAxis
                                tick={{ fill: '#94a3b8', fontSize: 11 }}
                                tickLine={false}
                                axisLine={false}
                                width={60}
                                domain={[chartSeries.yMin, chartSeries.yMax]}
                                tickFormatter={formatCompactUsd}
                              />
                              <ReferenceLine
                                y={chartSeries.startValue}
                                stroke="rgba(255,255,255,0.16)"
                                strokeDasharray="4 4"
                              />
                              {activePortfolioTarget?.active &&
                                activePortfolioTarget.targetBalanceUsdt >= chartSeries.yMin &&
                                activePortfolioTarget.targetBalanceUsdt <= chartSeries.yMax && (
                                  <ReferenceLine
                                    y={activePortfolioTarget.targetBalanceUsdt}
                                    stroke="#22d3ee"
                                    strokeDasharray="5 3"
                                    label={{
                                      value: `Цель ${formatCompactUsd(activePortfolioTarget.targetBalanceUsdt)}`,
                                      position: 'insideTopRight',
                                      fill: '#67e8f9',
                                      fontSize: 10,
                                    }}
                                  />
                                )}
                              <Tooltip
                                content={
                                  <PortfolioValueTooltip
                                    startValue={chartSeries.startValue}
                                    periodLabel={activeRangeMeta.label}
                                  />
                                }
                              />
                              <Line
                                type="monotone"
                                dataKey="valueUsdt"
                                stroke={chartSeries.changeUsdt >= 0 ? '#10b981' : '#fb7185'}
                                strokeWidth={2.2}
                                dot={false}
                                activeDot={{
                                  r: 4,
                                  fill: chartSeries.changeUsdt >= 0 ? '#10b981' : '#fb7185',
                                  stroke: '#0B0F17',
                                  strokeWidth: 2,
                                }}
                                isAnimationActive={false}
                              />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      ) : null}
                    </div>

                    {/* Target PnL / Balance Alert Configuration */}
                    {(() => {
                      const isCurrentSelected = targetPortfolioId === portfolioIdentity.portfolioId;
                      const currentBalanceForSelected = isCurrentSelected
                        ? report.totalValue
                        : (selectedPortfolioTarget?.baselineBalanceUsdt ?? 0);
                      const parsedTargetUsd = Number(targetBalanceInput.replace(',', '.'));
                      const parsedTargetPct = Number(targetPctInput.replace(',', '.'));
                      const canComputeProgress =
                        Boolean(selectedPortfolioTarget) &&
                        isCurrentSelected &&
                        report.totalValue > 0 &&
                        (selectedPortfolioTarget?.targetBalanceUsdt ?? 0) > 0;
                      const progressRaw = canComputeProgress && selectedPortfolioTarget
                        ? selectedPortfolioTarget.baselineBalanceUsdt > 0 &&
                          selectedPortfolioTarget.targetBalanceUsdt > selectedPortfolioTarget.baselineBalanceUsdt
                          ? ((report.totalValue - selectedPortfolioTarget.baselineBalanceUsdt) /
                              (selectedPortfolioTarget.targetBalanceUsdt -
                                selectedPortfolioTarget.baselineBalanceUsdt)) *
                            100
                          : (report.totalValue / selectedPortfolioTarget.targetBalanceUsdt) * 100
                        : 0;
                      const progressPct = Math.max(0, Math.min(100, progressRaw));
                      const remainingUsd =
                        canComputeProgress && selectedPortfolioTarget
                          ? Math.max(0, selectedPortfolioTarget.targetBalanceUsdt - report.totalValue)
                          : 0;

                      const handleBalanceInputChange = (raw: string) => {
                        setTargetBalanceInput(raw);
                        setTargetError(null);
                        setTargetFeedback(null);
                        const num = Number(raw.replace(',', '.'));
                        if (Number.isFinite(num) && num > 0 && currentBalanceForSelected > 0) {
                          const impliedPct = ((num - currentBalanceForSelected) / currentBalanceForSelected) * 100;
                          setTargetPctInput(impliedPct.toFixed(1));
                        }
                      };

                      const handlePctInputChange = (raw: string) => {
                        setTargetPctInput(raw);
                        setTargetError(null);
                        setTargetFeedback(null);
                        const pct = Number(raw.replace(',', '.'));
                        if (Number.isFinite(pct) && currentBalanceForSelected > 0) {
                          const nextUsd = currentBalanceForSelected * (1 + pct / 100);
                          if (nextUsd > 0) {
                            setTargetBalanceInput(nextUsd.toFixed(2));
                          }
                        }
                      };

                      const handleApplyPreset = (pct: number) => {
                        setTargetError(null);
                        setTargetFeedback(null);
                        setTargetPctInput(String(pct));
                        if (currentBalanceForSelected > 0) {
                          setTargetBalanceInput((currentBalanceForSelected * (1 + pct / 100)).toFixed(2));
                        }
                      };

                      const handleSaveGoal = async (e: React.FormEvent) => {
                        e.preventDefault();
                        setTargetError(null);
                        setTargetFeedback(null);

                        if (!Number.isFinite(parsedTargetUsd) || parsedTargetUsd <= 0) {
                          setTargetError('Укажите корректный целевой баланс в USDT (> 0).');
                          return;
                        }
                        if (isCurrentSelected && report.totalValue > 0 && parsedTargetUsd <= report.totalValue) {
                          setTargetError(
                            `Целевой баланс должен быть выше текущего (${formatUsd(report.totalValue)}).`
                          );
                          return;
                        }

                        const baseline =
                          currentBalanceForSelected > 0
                            ? currentBalanceForSelected
                            : parsedTargetUsd / (1 + (Number.isFinite(parsedTargetPct) ? parsedTargetPct : 10) / 100);
                        const computedPct =
                          baseline > 0
                            ? ((parsedTargetUsd - baseline) / baseline) * 100
                            : Number.isFinite(parsedTargetPct)
                              ? parsedTargetPct
                              : 0;

                        setTargetSaving(true);
                        try {
                          await onSavePortfolioTarget({
                            portfolioId: targetPortfolioId,
                            portfolioLabel: selectedPortfolioLabel,
                            targetBalanceUsdt: Number(parsedTargetUsd.toFixed(2)),
                            baselineBalanceUsdt: Number(Math.max(0, baseline).toFixed(2)),
                            targetPnlPct: Number(computedPct.toFixed(2)),
                          });
                          setTargetFeedback(
                            `Цель $${parsedTargetUsd.toLocaleString('en-US', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })} сохранена для «${selectedPortfolioLabel}».`
                          );
                        } catch (err) {
                          setTargetError(err instanceof Error ? err.message : 'Не удалось сохранить цель.');
                        } finally {
                          setTargetSaving(false);
                        }
                      };

                      return (
                        <div className="pb-4 border-b border-white/8">
                          <div className="rounded-xl border border-white/10 bg-[#0B0F17]/90 p-3.5 sm:p-4 space-y-3">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="flex items-start gap-2.5 min-w-0">
                                <div className="w-8 h-8 rounded-lg bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-300 shrink-0">
                                  <Target className="w-4 h-4" />
                                </div>
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <h3 className="text-xs sm:text-sm font-semibold text-white">
                                      Целевая доходность (Target PnL)
                                    </h3>
                                    {selectedPortfolioTarget && (
                                      <span
                                        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                                          selectedPortfolioTarget.active
                                            ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                                            : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                        }`}
                                      >
                                        {selectedPortfolioTarget.active ? 'Отслеживается' : 'Достигнута'}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[11px] text-slate-400 mt-0.5">
                                    Push-уведомление сработает, как только баланс портфеля достигнет заданной цели.
                                  </p>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                {portfolioOptions.length > 1 ? (
                                  <select
                                    aria-label="Выберите портфель для целевой доходности"
                                    value={targetPortfolioId}
                                    onChange={(e) => {
                                      setTargetPortfolioId(e.target.value);
                                      setTargetFeedback(null);
                                    }}
                                    className="min-h-[30px] rounded-lg border border-white/10 bg-[#111827] px-2.5 text-[11px] font-medium text-slate-200 focus:border-cyan-500 focus:outline-none"
                                  >
                                    {portfolioOptions.map((opt) => (
                                      <option key={opt.id} value={opt.id}>
                                        {opt.label}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <span className="text-[11px] font-medium text-slate-300 px-2.5 py-1 rounded-lg bg-white/5 border border-white/8">
                                    {selectedPortfolioLabel}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Active Target Progress Bar */}
                            {selectedPortfolioTarget && (
                              <div className="rounded-lg border border-white/8 bg-[#111827]/75 px-3 py-2.5 space-y-2">
                                <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums">
                                  <span className="font-sans text-[11px] text-slate-400">
                                    {selectedPortfolioTarget.active ? (
                                      <>
                                        Цель для «<strong className="text-slate-200">{selectedPortfolioTarget.portfolioLabel}</strong>»
                                      </>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 text-emerald-300 font-medium">
                                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                        Цель достигнута ({formatUsd(selectedPortfolioTarget.triggeredBalanceUsdt || selectedPortfolioTarget.targetBalanceUsdt)})
                                      </span>
                                    )}
                                  </span>
                                  <span className="text-white font-semibold">
                                    {formatUsd(selectedPortfolioTarget.targetBalanceUsdt)}
                                    <span className="text-cyan-300 ml-1.5">
                                      ({selectedPortfolioTarget.targetPnlPct >= 0 ? '+' : ''}
                                      {selectedPortfolioTarget.targetPnlPct.toFixed(1)}%)
                                    </span>
                                  </span>
                                </div>

                                {canComputeProgress && selectedPortfolioTarget.active && (
                                  <>
                                    <div className="h-1.5 w-full rounded-full bg-white/8 overflow-hidden">
                                      <div
                                        className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-300"
                                        style={{ width: `${Math.max(3, progressPct)}%` }}
                                      />
                                    </div>
                                    <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-400">
                                      <span>Прогресс: {progressPct.toFixed(0)}%</span>
                                      <span>
                                        {remainingUsd > 0
                                          ? `Осталось +${formatUsd(remainingUsd)}`
                                          : 'Баланс достиг цели'}
                                      </span>
                                    </div>
                                  </>
                                )}
                              </div>
                            )}

                            {/* Target Configuration Form */}
                            <form onSubmit={handleSaveGoal} className="space-y-2.5">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-[11px] text-slate-400 mr-1">Быстрая цель:</span>
                                {[5, 10, 25, 50].map((pct) => {
                                  const isPresetActive = Math.abs(parsedTargetPct - pct) < 0.05;
                                  return (
                                    <button
                                      key={pct}
                                      type="button"
                                      onClick={() => handleApplyPreset(pct)}
                                      className={`min-h-[28px] px-2.5 rounded-lg border text-[11px] font-mono font-semibold transition-colors ${
                                        isPresetActive
                                          ? 'border-cyan-500/45 bg-cyan-500/15 text-cyan-200'
                                          : 'border-white/10 bg-white/[0.03] text-slate-300 hover:text-white hover:bg-white/8'
                                      }`}
                                    >
                                      +{pct}%
                                    </button>
                                  );
                                })}
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                                <div className="sm:col-span-5">
                                  <label htmlFor="target-balance-usdt" className="block text-[11px] text-slate-400 mb-1">
                                    Целевой баланс (USDT)
                                  </label>
                                  <input
                                    id="target-balance-usdt"
                                    type="number"
                                    step="any"
                                    min="0.01"
                                    value={targetBalanceInput}
                                    onChange={(e) => handleBalanceInputChange(e.target.value)}
                                    placeholder={report.totalValue > 0 ? (report.totalValue * 1.1).toFixed(2) : '10000'}
                                    className="w-full min-h-[38px] rounded-xl border border-white/10 bg-[#111827] px-3 text-xs font-mono tabular-nums text-white focus:border-cyan-500 focus:outline-none"
                                  />
                                </div>

                                <div className="sm:col-span-3">
                                  <label htmlFor="target-pnl-pct" className="block text-[11px] text-slate-400 mb-1">
                                    Целевой рост (%)
                                  </label>
                                  <input
                                    id="target-pnl-pct"
                                    type="number"
                                    step="0.1"
                                    value={targetPctInput}
                                    onChange={(e) => handlePctInputChange(e.target.value)}
                                    placeholder="10"
                                    className="w-full min-h-[38px] rounded-xl border border-white/10 bg-[#111827] px-3 text-xs font-mono tabular-nums text-white focus:border-cyan-500 focus:outline-none"
                                  />
                                </div>

                                <div className="sm:col-span-4 flex items-center gap-1.5">
                                  <button
                                    type="submit"
                                    disabled={targetSaving}
                                    className="flex-1 min-h-[38px] px-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-xs font-semibold text-white inline-flex items-center justify-center gap-1.5 transition-colors"
                                  >
                                    <Target className="w-3.5 h-3.5 shrink-0" />
                                    <span>
                                      {targetSaving
                                        ? 'Сохранение…'
                                        : selectedPortfolioTarget
                                          ? 'Обновить цель'
                                          : 'Задать цель'}
                                    </span>
                                  </button>

                                  {selectedPortfolioTarget && (
                                    <button
                                      type="button"
                                      disabled={targetSaving}
                                      onClick={() => void onDeletePortfolioTarget(selectedPortfolioTarget.id)}
                                      aria-label="Удалить целевую доходность"
                                      title="Удалить цель"
                                      className="min-h-[38px] min-w-[38px] rounded-xl border border-rose-500/25 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 flex items-center justify-center transition-colors"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            </form>

                            {targetError && (
                              <div className="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-lg px-2.5 py-1.5">
                                {targetError}
                              </div>
                            )}

                            {targetFeedback && (
                              <div className="text-[11px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 rounded-lg px-2.5 py-1.5">
                                {targetFeedback}
                              </div>
                            )}

                            {/* Push Delivery Status */}
                            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px]">
                              {isSignedIn && pushSubscribed && notifyPortfolioPnlEnabled ? (
                                <span className="inline-flex items-center gap-1.5 text-emerald-400">
                                  <BellRing className="w-3.5 h-3.5 shrink-0" />
                                  <span>Push-канал портфеля активен</span>
                                </span>
                              ) : !isSignedIn ? (
                                <span className="text-slate-400">
                                  Цель сохранена локально.{' '}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      onClose();
                                      onRequireLogin();
                                    }}
                                    className="text-cyan-300 hover:text-cyan-200 underline underline-offset-2"
                                  >
                                    Войдите и включите Push
                                  </button>{' '}
                                  для фоновых уведомлений.
                                </span>
                              ) : (
                                <span className="text-amber-300/90 inline-flex flex-wrap items-center gap-1.5">
                                  <BellRing className="w-3.5 h-3.5 shrink-0" />
                                  <span>
                                    {!pushSubscribed
                                      ? 'Push на этом устройстве не подключён.'
                                      : 'Уведомления о портфеле отключены в настройках Push.'}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      onClose();
                                      onOpenPushSettings();
                                    }}
                                    className="text-cyan-300 hover:text-cyan-200 font-semibold underline underline-offset-2"
                                  >
                                    Настроить Push
                                  </button>
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Allocation Donut + Quick Insight Strip */}
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center pb-4 border-b border-white/8">
                      <div className="md:col-span-4 h-[175px] relative">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={report.allocations}
                              dataKey="valueUsdt"
                              nameKey="baseAsset"
                              cx="50%"
                              cy="50%"
                              innerRadius={48}
                              outerRadius={72}
                              paddingAngle={3}
                              stroke="none"
                            >
                              {report.allocations.map((entry) => (
                                <Cell key={`modal-${entry.symbol}`} fill={entry.color} />
                              ))}
                            </Pie>
                            <Tooltip
                              contentStyle={{
                                backgroundColor: '#0E1420',
                                borderColor: 'rgba(255,255,255,0.12)',
                                borderRadius: '10px',
                                fontSize: '12px',
                                color: '#F1F5F9',
                              }}
                              formatter={(value, _name, item) => {
                                const payload = item?.payload as { sharePct?: number } | undefined;
                                const pct = payload?.sharePct ? ` (${payload.sharePct.toFixed(1)}%)` : '';
                                return [`$${Number(value ?? 0).toFixed(2)}${pct}`, 'Оценка'];
                              }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                          <span className="text-[10px] text-slate-400">Активы</span>
                          <span className="text-sm font-bold font-mono tabular-nums text-white">
                            {report.allocations.length}
                          </span>
                        </div>
                      </div>

                      <div className="md:col-span-8 space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="text-slate-400">Распределение долей</span>
                          {bestDailyAsset && (
                            <span className="text-[11px] text-slate-300 font-mono tabular-nums">
                              Лидер 24ч:{' '}
                              <strong className={bestDailyAsset.dailyPnlPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                                {bestDailyAsset.baseAsset}{' '}
                                {bestDailyAsset.dailyPnlPct >= 0 ? '+' : ''}
                                {bestDailyAsset.dailyPnlPct.toFixed(2)}%
                              </strong>
                            </span>
                          )}
                        </div>

                        {/* Proportional bar */}
                        <div className="h-2.5 w-full rounded-full overflow-hidden flex bg-[#0B0F17]">
                          {report.allocations.map((alloc) => (
                            <div
                              key={`bar-${alloc.symbol}`}
                              style={{
                                width: `${Math.max(2, alloc.sharePct)}%`,
                                backgroundColor: alloc.color,
                              }}
                              title={`${alloc.baseAsset}: ${alloc.sharePct.toFixed(1)}%`}
                              className="h-full"
                            />
                          ))}
                        </div>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                          {report.allocations.map((alloc) => (
                            <span key={`legend-${alloc.symbol}`} className="inline-flex items-center gap-1.5">
                              <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: alloc.color }}
                              />
                              <span className="font-medium text-slate-200">{alloc.baseAsset}</span>
                              <span className="font-mono tabular-nums text-slate-400">
                                {alloc.sharePct.toFixed(1)}%
                              </span>
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Detailed Per-Asset PnL Breakdown */}
                    <div className="divide-y divide-white/8">
                      {sortedAssetBreakdown.map((asset) => {
                        const totalPos = asset.pnlUsdt >= 0;
                        const dailyPos = asset.dailyPnlUsdt >= 0;
                        return (
                          <div key={asset.symbol} className="py-3.5 space-y-2.5">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <span
                                  className="w-3 h-3 rounded-full shrink-0"
                                  style={{ backgroundColor: asset.color }}
                                />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 text-sm font-semibold text-white">
                                    <span>{asset.baseAsset} / USDT</span>
                                    <span className="text-xs font-mono font-normal text-slate-400">
                                      {asset.sharePct.toFixed(1)}% портфеля
                                    </span>
                                  </div>
                                  <div className="text-[11px] font-mono tabular-nums text-slate-400 mt-0.5">
                                    {asset.totalAmount.toLocaleString('en-US', { maximumFractionDigits: 6 })} {asset.baseAsset}
                                    <span className="text-slate-600 mx-1.5">·</span>
                                    ср. вход ${formatPrice(asset.avgEntryPrice)}
                                    <span className="text-slate-600 mx-1.5">·</span>
                                    сейчас ${formatPrice(asset.livePrice)}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-4 sm:gap-6 font-mono tabular-nums ml-auto">
                                <div className="text-right">
                                  <div className="text-[10px] font-sans text-slate-500">Стоимость</div>
                                  <div className="text-sm font-bold text-white">
                                    {formatUsd(asset.valueUsdt)}
                                  </div>
                                </div>

                                <div className="text-right min-w-[82px]">
                                  <div className="text-[10px] font-sans text-slate-500">PnL за 24ч</div>
                                  <div
                                    className={`text-xs font-semibold ${
                                      !report.hasLive24hData
                                        ? 'text-slate-500'
                                        : dailyPos
                                          ? 'text-emerald-400'
                                          : 'text-rose-400'
                                    }`}
                                  >
                                    {report.hasLive24hData ? formatSignedUsd(asset.dailyPnlUsdt) : '—'}
                                  </div>
                                  {report.hasLive24hData && (
                                    <div
                                      className={`text-[11px] ${
                                        dailyPos ? 'text-emerald-400/80' : 'text-rose-400/80'
                                      }`}
                                    >
                                      {dailyPos ? '+' : ''}
                                      {asset.dailyPnlPct.toFixed(2)}%
                                    </div>
                                  )}
                                </div>

                                <div className="text-right min-w-[86px]">
                                  <div className="text-[10px] font-sans text-slate-500">Общий PnL</div>
                                  <div
                                    className={`text-xs font-bold ${
                                      totalPos ? 'text-emerald-400' : 'text-rose-400'
                                    }`}
                                  >
                                    {formatSignedUsd(asset.pnlUsdt)}
                                  </div>
                                  <div
                                    className={`text-[11px] ${
                                      totalPos ? 'text-emerald-400/85' : 'text-rose-400/85'
                                    }`}
                                  >
                                    {totalPos ? '+' : ''}
                                    {asset.pnlPct.toFixed(2)}%
                                  </div>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => {
                                    onClose();
                                    onOpenPairOnMarket(asset.symbol, 'spot');
                                  }}
                                  aria-label={`Открыть график ${asset.baseAsset}`}
                                  title={`Открыть ${asset.baseAsset}/USDT на графике`}
                                  className="min-h-[36px] min-w-[36px] rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white inline-flex items-center justify-center transition-colors shrink-0"
                                >
                                  <ArrowUpRight className="w-4 h-4" />
                                </button>
                              </div>
                            </div>

                            {/* Individual lots for this asset (allows removing a specific entry) */}
                            {asset.lots.length > 0 && (
                              <div className="pl-5 space-y-1">
                                {asset.lots.map((lot) => {
                                  const lotPos = lot.pnlUsdt >= 0;
                                  return (
                                    <div
                                      key={lot.id}
                                      className="flex items-center justify-between gap-2 text-[11px] text-slate-400 py-1 px-2.5 rounded-lg bg-[#0B0F17]/75"
                                    >
                                      <span className="font-mono tabular-nums truncate">
                                        Лот: {lot.amount} {lot.baseAsset} @ ${formatPrice(lot.avgEntryPrice)}
                                      </span>
                                      <div className="flex items-center gap-3 shrink-0 font-mono tabular-nums">
                                        <span className={lotPos ? 'text-emerald-400' : 'text-rose-400'}>
                                          {formatSignedUsd(lot.pnlUsdt)} ({lotPos ? '+' : ''}
                                          {lot.pnlPct.toFixed(1)}%)
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() => onRemoveHolding(lot.id)}
                                          aria-label={`Удалить лот ${lot.baseAsset}`}
                                          className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* MAX #9: Стресс-тест портфеля («Что если?») */}
                    <div className="pt-2">
                      <PortfolioStressTestCard
                        holdings={report.allocations.map((a) => ({
                          symbol: a.symbol,
                          valueUsdt: a.valueUsdt,
                        }))}
                        totalValueUsdt={report.totalValue}
                      />
                    </div>
                  </>
                )
              ) : historySource === 'journal' ? (
                !isSignedIn || !uid ? (
                  <div className="py-10 text-center space-y-3">
                    <div className="mx-auto w-12 h-12 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                      <Lock className="w-5 h-5" />
                    </div>
                    <h3 className="text-sm font-semibold text-white">История сделок привязана к аккаунту</h3>
                    <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
                      Войдите через Google, чтобы просматривать открытые и закрытые сделки из вашего защищённого дневника.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onRequireLogin();
                      }}
                      className="min-h-[42px] px-5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-xs font-semibold text-white inline-flex items-center justify-center"
                    >
                      Войти в аккаунт
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Filter Bar */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="inline-flex items-center gap-1">
                        {(
                          [
                            { id: 'all', label: `Все (${trades.length})` },
                            { id: 'open', label: `Открытые (${journalStats.openCount})` },
                            { id: 'closed', label: `Закрытые (${journalStats.closedCount})` },
                          ] as Array<{ id: TradeFilter; label: string }>
                        ).map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setTradeFilter(opt.id)}
                            className={`min-h-[32px] px-2.5 rounded-lg border text-xs transition-colors ${
                              tradeFilter === opt.id
                                ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-200 font-medium'
                                : 'border-white/8 bg-white/[0.03] text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenTradeJournal();
                        }}
                        className="min-h-[34px] px-3 rounded-lg border border-emerald-500/35 bg-emerald-500/10 hover:bg-emerald-500/20 text-xs font-medium text-emerald-300 inline-flex items-center gap-1.5 transition-colors"
                      >
                        <BookOpen className="w-3.5 h-3.5" />
                        <span>Открыть дневник</span>
                      </button>
                    </div>

                    {tradesError && (
                      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200">
                        {tradesError}
                      </div>
                    )}

                    {filteredTrades.length === 0 ? (
                      <div className="py-8 text-center rounded-xl border border-dashed border-white/10 space-y-2">
                        <p className="text-xs text-slate-400">
                          {trades.length === 0
                            ? 'В дневнике пока нет записанных сделок.'
                            : 'Нет сделок по выбранному фильтру.'}
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onOpenTradeJournal();
                          }}
                          className="min-h-[36px] px-3.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white inline-flex items-center gap-1.5"
                        >
                          <span>Записать сделку в дневнике</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="divide-y divide-white/8">
                        {filteredTrades.map((t) => {
                          const isOpen = t.status === 'open';
                          const livePrice =
                            t.marketType === 'futures'
                              ? futuresPrices[t.symbol] ?? spotPriceMap[t.symbol]
                              : spotPriceMap[t.symbol];
                          const refPrice = isOpen ? livePrice : t.exitPrice;
                          const pnlPct = refPrice ? tradePnlPct(t, refPrice) : null;
                          const rMult = refPrice ? tradeRMultiple(t, refPrice) : null;
                          const isWin = (pnlPct ?? 0) >= 0;

                          return (
                            <div
                              key={t.id}
                              className="py-3 flex flex-wrap items-start justify-between gap-3"
                            >
                              <div className="min-w-0 space-y-1">
                                <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm">
                                  <span className="font-semibold text-white">
                                    {t.symbol.replace('USDT', '')} / USDT
                                  </span>
                                  <span
                                    className={`inline-flex items-center gap-1 font-bold text-[11px] ${
                                      t.side === 'LONG' ? 'text-emerald-400' : 'text-rose-400'
                                    }`}
                                  >
                                    {t.side === 'LONG' ? (
                                      <TrendingUp className="w-3.5 h-3.5" />
                                    ) : (
                                      <TrendingDown className="w-3.5 h-3.5" />
                                    )}
                                    {t.side === 'LONG' ? 'ЛОНГ' : 'ШОРТ'}
                                  </span>
                                  <span className="text-[11px] text-slate-500">
                                    {t.marketType === 'futures' ? 'фьючерсы' : 'спот'} ·{' '}
                                    {isOpen ? 'открыта' : 'закрыта'} · {formatTradeDate(t)}
                                  </span>
                                </div>

                                <div className="text-[11px] font-mono tabular-nums text-slate-400">
                                  Вход: ${formatPrice(t.entryPrice)}
                                  {t.stopPrice > 0 && ` · Стоп: $${formatPrice(t.stopPrice)}`}
                                  {!isOpen
                                    ? ` · Выход: $${formatPrice(t.exitPrice)}`
                                    : livePrice
                                      ? ` · Рынок: $${formatPrice(livePrice)}`
                                      : ''}
                                </div>

                                {t.note && (
                                  <p className="text-xs text-slate-300 leading-relaxed">{t.note}</p>
                                )}
                              </div>

                              <div className="flex items-center gap-3 shrink-0 ml-auto">
                                <div className="text-right font-mono tabular-nums">
                                  {pnlPct !== null ? (
                                    <>
                                      <div
                                        className={`text-sm font-bold ${
                                          isWin ? 'text-emerald-400' : 'text-rose-400'
                                        }`}
                                      >
                                        {pnlPct >= 0 ? '+' : ''}
                                        {pnlPct.toFixed(2)}%
                                      </div>
                                      {rMult !== null && (
                                        <div
                                          className={`text-[11px] ${
                                            rMult >= 0 ? 'text-emerald-400/80' : 'text-rose-400/80'
                                          }`}
                                        >
                                          {rMult >= 0 ? '+' : ''}
                                          {rMult.toFixed(2)}R
                                        </div>
                                      )}
                                    </>
                                  ) : (
                                    <span className="text-xs text-slate-500">нет цены</span>
                                  )}
                                </div>

                                <button
                                  type="button"
                                  onClick={() => {
                                    onClose();
                                    onOpenPairOnMarket(t.symbol, t.marketType);
                                  }}
                                  aria-label={`Перейти к графику ${t.symbol}`}
                                  className="min-h-[36px] min-w-[36px] rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white inline-flex items-center justify-center transition-colors"
                                >
                                  <ArrowUpRight className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )
              ) : analyses.length === 0 ? (
                <div className="py-10 text-center text-xs text-slate-400">
                  Сохранённых AI-сигналов пока нет. Запустите анализ во вкладке «Рынок», чтобы сформировать историю сигналов.
                </div>
              ) : (
                <div className="divide-y divide-white/8">
                  {analyses.slice(0, 20).map((a) => (
                    <div
                      key={a.id}
                      className="py-3 flex flex-wrap items-start justify-between gap-3"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm">
                          <span className="font-semibold text-white">
                            {a.symbol.replace('USDT', '')} / USDT
                          </span>
                          <span
                            className={`font-bold text-[11px] ${
                              a.direction === 'LONG'
                                ? 'text-emerald-400'
                                : a.direction === 'SHORT'
                                  ? 'text-rose-400'
                                  : 'text-amber-300'
                            }`}
                          >
                            {a.direction}
                          </span>
                          <span className="text-[11px] text-slate-500">
                            {a.strategyName} · {a.marketType === 'futures' ? 'фьючерсы' : 'спот'} · {a.timeframe}
                          </span>
                        </div>
                        <div className="text-[11px] font-mono tabular-nums text-slate-400">
                          Вход: {a.entryZone} · SL: {a.stopLoss} · R:R {a.riskReward}
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0 ml-auto">
                        <span className="text-xs font-mono tabular-nums text-cyan-300 font-semibold">
                          {a.confidence}% увер.
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onOpenPairOnMarket(a.symbol, a.marketType);
                          }}
                          aria-label={`Открыть ${a.symbol} на графике`}
                          className="min-h-[36px] min-w-[36px] rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white inline-flex items-center justify-center transition-colors"
                        >
                          <ArrowUpRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <footer className="px-4 sm:px-6 py-3 border-t border-white/8 bg-[#0E1420] flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onManageInScreener();
                  }}
                  className="min-h-[38px] px-3.5 rounded-xl border border-emerald-500/35 bg-emerald-500/12 hover:bg-emerald-500/20 text-xs font-semibold text-emerald-200 inline-flex items-center gap-1.5 transition-colors"
                >
                  <span>Редактировать состав</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenTradeJournal();
                  }}
                  className="min-h-[38px] px-3.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-medium text-slate-200 inline-flex items-center gap-1.5 transition-colors"
                >
                  <BookOpen className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Дневник сделок</span>
                </button>
                {onOpenExchangeIntegrations && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenExchangeIntegrations();
                    }}
                    className="min-h-[38px] px-3.5 rounded-xl border border-cyan-500/35 bg-cyan-500/10 hover:bg-cyan-500/20 text-xs font-medium text-cyan-200 inline-flex items-center gap-1.5 transition-colors"
                  >
                    <span>
                      {portfolioSource?.mode === 'exchange' && portfolioSource.exchange
                        ? `Биржа: ${portfolioSource.exchange.toUpperCase()}`
                        : 'Синхр. с биржей'}
                    </span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2 ml-auto">
                {report.rows.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (confirmClear) {
                        onClearPortfolio();
                        setConfirmClear(false);
                      } else {
                        setConfirmClear(true);
                      }
                    }}
                    onBlur={() => setConfirmClear(false)}
                    className={`min-h-[38px] px-3 rounded-xl border text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${
                      confirmClear
                        ? 'border-rose-500/50 bg-rose-500/20 text-rose-200'
                        : 'border-rose-500/25 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300'
                    }`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{confirmClear ? 'Подтвердить очистку' : 'Очистить портфель'}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onResetDemo}
                    className="min-h-[38px] px-3 rounded-xl border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20 text-xs font-medium text-cyan-200 inline-flex items-center gap-1.5 transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Демо-портфель</span>
                  </button>
                )}
              </div>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
