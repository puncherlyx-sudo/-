import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownUp,
  ArrowRight,
  BarChart2,
  Check,
  Download,
  Flame,
  Grid2x2,
  ListChecks,
  Lock,
  Pencil,
  PieChart as PieChartIcon,
  Plus,
  Radar,
  RefreshCw,
  Repeat,
  Search,
  Star,
  Table2,
  Target,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TRADING_PAIRS } from '../data/strategies';
import type { PaperPortfolioReport } from '../hooks/usePaperPortfolio';
import {
  fetchJsonWithBackoff,
  getCachedValue,
  setCachedValue,
  shouldApplyThrottledUpdate,
} from '../lib/marketCache';
import { usePlan } from '../contexts/PlanContext';
import { FeatureGuide } from './FeatureGuide';
import {
  readCustomWatchlists,
  writeCustomWatchlists,
  type CustomWatchlist,
} from '../lib/proMaxStore';
import { parseLocalePositiveNumber, sanitizePlainText, triggerHaptic } from '../lib/securityDlp';
import type { MarketType, PortfolioHolding, PortfolioTargetRecord, TickerOverview } from '../types/domain';
import { FlashValue, StaggerDeck, WorkspaceShell } from './MotionPrimitives';
import { MiniSparkline } from './MiniSparkline';
import { PortfolioStressTestCard } from './PortfolioStressTestCard';
import {
  FundingArbitrageScannerTab,
  LivePatternScannerTab,
  SectorHeatmapCorrelationTab,
} from './ScreenerProMaxTabs';

function deriveSparklineFromTicker(t: TickerOverview): number[] {
  const existing = (t as TickerOverview & { sparkline24h?: number[] }).sparkline24h;
  if (Array.isArray(existing) && existing.length >= 4) return existing;
  const low = t.low24h > 0 ? t.low24h : t.price * 0.97;
  const high = t.high24h > low ? t.high24h : t.price * 1.03;
  const openEst = t.price / (1 + (t.change24hPct || 0) / 100);
  const seed = t.symbol.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const pts: number[] = [];
  for (let i = 0; i < 8; i += 1) {
    const prog = i / 7;
    const base = openEst + (t.price - openEst) * prog;
    const wave = Math.sin(seed * 0.37 + i * 1.15) * (high - low) * 0.16;
    pts.push(Math.max(low, Math.min(high, base + wave)));
  }
  pts[pts.length - 1] = t.price;
  return pts;
}

function deriveEstimatedRsi(t: TickerOverview): number {
  const span = Math.max(1e-9, t.high24h - t.low24h);
  const pos = Math.max(0, Math.min(1, (t.price - t.low24h) / span));
  const momentum = Math.max(-18, Math.min(18, t.change24hPct * 1.9));
  return Math.max(18, Math.min(86, Math.round(32 + pos * 36 + momentum)));
}

interface ScreenerTableRowProps {
  ticker: TickerOverview;
  marketType: MarketType;
  isStarred: boolean;
  onToggleWatchlist: (symbol: string) => void;
  onOpenPair: (symbol: string, marketType: MarketType) => void;
}

const ScreenerTableRow: React.FC<ScreenerTableRowProps> = React.memo(
  ({ ticker: t, marketType, isStarred, onToggleWatchlist, onOpenPair }) => {
    const span = Math.max(1e-9, t.high24h - t.low24h);
    const posInRange = Math.max(0, Math.min(100, Math.round(((t.price - t.low24h) / span) * 100)));
    const rangePct = t.low24h > 0 ? ((span / t.low24h) * 100).toFixed(1) : '0.0';
    const sparkData = deriveSparklineFromTicker(t);
    const rsi = deriveEstimatedRsi(t);
    const fundingPct = t.fundingRatePct ?? 0.01;

    return (
      <tr
        role="button"
        tabIndex={0}
        onClick={() => {
          triggerHaptic(8);
          onOpenPair(t.symbol, marketType);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            triggerHaptic(8);
            onOpenPair(t.symbol, marketType);
          }
        }}
        aria-label={`Открыть график ${t.symbol}`}
        className="hover:bg-emerald-500/[0.06] active:bg-emerald-500/[0.1] cursor-pointer transition-colors"
      >
        <td className="py-2.5 pl-2.5 pr-1.5 sm:px-4 font-sans">
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                triggerHaptic(8);
                onToggleWatchlist(t.symbol);
              }}
              aria-label={`Добавить ${t.symbol} в избранное`}
              className={`p-1 rounded-md transition-colors shrink-0 ${
                isStarred ? 'text-amber-400' : 'text-slate-600 hover:text-slate-300'
              }`}
            >
              <Star className={`w-3.5 h-3.5 ${isStarred ? 'fill-amber-400' : ''}`} />
            </button>
            <div className="min-w-0">
              <span className="font-semibold text-white">{t.baseAsset}</span>
              <span className="text-slate-500 hidden sm:inline"> / USDT</span>
            </div>
          </div>
        </td>
        <td className="py-2.5 px-1.5 sm:px-3 text-right font-mono tabular-nums text-slate-100 whitespace-nowrap text-[11px] sm:text-xs">
          <FlashValue value={t.price}>{formatUsd(t.price)}</FlashValue>
        </td>
        <td
          style={{
            backgroundColor: `${
              t.change24hPct >= 0 ? 'rgba(16,185,129,' : 'rgba(244,63,94,'
            }${Math.min(0.26, 0.03 + (Math.abs(t.change24hPct) / 10) * 0.23).toFixed(3)})`,
          }}
          className={`py-2.5 px-1.5 sm:px-3 text-right font-mono tabular-nums font-semibold whitespace-nowrap text-[11px] sm:text-xs ${
            t.change24hPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
          }`}
        >
          {t.change24hPct >= 0 ? '+' : ''}
          {t.change24hPct.toFixed(2)}%
        </td>
        <td className="py-2.5 px-3 hidden md:table-cell">
          <div className="w-28 space-y-1">
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div
                style={{ width: `${Math.max(6, posInRange)}%` }}
                className="h-full rounded-full bg-gradient-to-r from-rose-400 via-amber-400 to-emerald-400"
              />
            </div>
            <div className="flex justify-between text-[10px] text-slate-500">
              <span>{rangePct}%</span>
            </div>
          </div>
        </td>
        <td className="py-2.5 px-3 text-right text-slate-300 hidden sm:table-cell whitespace-nowrap">
          ${(t.volume24hUsdt / 1_000_000).toFixed(1)}M
        </td>
        <td className="py-2 pl-1.5 pr-2.5 sm:px-4 text-right">
          <div className="inline-flex items-center justify-end gap-1.5 sm:gap-2">
            <MiniSparkline
              data={sparkData}
              changePct={t.change24hPct}
              width={46}
              height={18}
              showArea={false}
            />
            {marketType === 'futures' ? (
              <span
                className={`text-[10px] font-mono tabular-nums font-semibold px-1.5 py-0.5 rounded border whitespace-nowrap ${
                  fundingPct >= 0.02
                    ? 'border-amber-500/35 bg-amber-500/12 text-amber-300'
                    : fundingPct < 0
                      ? 'border-rose-500/35 bg-rose-500/12 text-rose-300'
                      : 'border-white/10 bg-white/5 text-slate-300'
                }`}
              >
                {fundingPct >= 0 ? '+' : ''}
                {fundingPct.toFixed(3)}%
              </span>
            ) : (
              <span
                className={`text-[10px] font-mono tabular-nums font-semibold px-1.5 py-0.5 rounded border whitespace-nowrap ${
                  rsi >= 70
                    ? 'border-rose-500/35 bg-rose-500/12 text-rose-300'
                    : rsi <= 30
                      ? 'border-emerald-500/35 bg-emerald-500/12 text-emerald-300'
                      : 'border-white/10 bg-white/5 text-slate-300'
                }`}
              >
                RSI {rsi}
              </span>
            )}
          </div>
        </td>
      </tr>
    );
  }
);
ScreenerTableRow.displayName = 'ScreenerTableRow';

export type ScreenerSection = 'table' | 'patterns' | 'sectors' | 'arbitrage' | 'momentum' | 'portfolio';

interface MarketScreenerViewProps {
  isPro?: boolean;
  privacyMode?: boolean;
  onUpgradePro?: () => void;
  onOpenPairOnMarket: (symbol: string, marketType: MarketType) => void;
  holdings: PortfolioHolding[];
  portfolioReport: PaperPortfolioReport;
  activeTarget?: PortfolioTargetRecord | null;
  onOpenPortfolioDetails?: () => void;
  onAddHolding: (symbol: string, amount: number, avgEntryPrice: number) => void;
  onUpdateHolding?: (id: string, amount: number, avgEntryPrice: number) => void;
  onRemoveHolding: (id: string) => void;
  externalSection?: { section: ScreenerSection; nonce: number } | null;
}

const WATCHLIST_KEY = 'aegisquant_watchlist_v1';

const ALLOCATION_COLORS = ['#10B981', '#22D3EE', '#F59E0B', '#A78BFA', '#FB7185', '#38BDF8'];

type ScreenerFilter = 'all' | 'gainers' | 'losers' | 'volume' | 'watchlist';
type SortField = 'volume' | 'change' | 'price' | 'range';

function formatUsd(val: number): string {
  if (val >= 1000) return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (val >= 10) return `$${val.toFixed(3)}`;
  return `$${val.toFixed(4)}`;
}

function downloadCsvWithBom(
  filename: string,
  headers: string[],
  rows: Array<Array<string | number>>
): void {
  const escapeCell = (val: string | number) => {
    const str = String(val);
    if (/[",\n;]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const csvBody = [
    headers.map(escapeCell).join(','),
    ...rows.map((r) => r.map(escapeCell).join(',')),
  ].join('\r\n');
  const blob = new Blob([`\uFEFF${csvBody}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const MarketScreenerView: React.FC<MarketScreenerViewProps> = ({
  isPro = false,
  privacyMode = false,
  onUpgradePro,
  onOpenPairOnMarket,
  holdings,
  portfolioReport,
  activeTarget,
  onOpenPortfolioDetails,
  onAddHolding,
  onUpdateHolding,
  onRemoveHolding,
  externalSection,
}) => {
  const planCtx = usePlan();
  const effIsPro = isPro || planCtx.isPro;
  const effPrivacy = privacyMode || planCtx.privacyMode;

  const [screenerSection, setScreenerSection] = useState<ScreenerSection>('table');
  const [marketType, setMarketType] = useState<MarketType>('spot');
  const [tickers, setTickers] = useState<TickerOverview[]>(() => {
    const cached = getCachedValue<{ tickers: TickerOverview[]; updatedAt?: string }>('screener_overview_spot');
    return cached?.data.tickers ?? [];
  });
  const [loading, setLoading] = useState(() => !getCachedValue('screener_overview_spot'));
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(() => {
    const cached = getCachedValue<{ tickers: TickerOverview[]; updatedAt?: string }>('screener_overview_spot');
    return cached?.data.updatedAt ?? null;
  });

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ScreenerFilter>('all');
  const [sortBy, setSortBy] = useState<SortField>('volume');
  const [sortAsc, setSortAsc] = useState(false);
  const [visibleCount, setVisibleCount] = useState<number>(20);

  // PRO #10: Кастомные вотчлисты (до 5 списков в localStorage)
  const [customWatchlists, setCustomWatchlists] = useState<CustomWatchlist[]>(() => readCustomWatchlists());
  const [activeWatchlistId, setActiveWatchlistId] = useState<string | null>(null);
  const [creatingWl, setCreatingWl] = useState(false);
  const [newWlName, setNewWlName] = useState('');

  const [watchlist, setWatchlist] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(WATCHLIST_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string');
      }
    } catch {
      // Ignore storage error
    }
    return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
  });

  const [newSymbol, setNewSymbol] = useState('BTCUSDT');
  const [newAmount, setNewAmount] = useState('0.1');
  const [newEntryPrice, setNewEntryPrice] = useState('90000');
  const [portfolioError, setPortfolioError] = useState<string | null>(null);
  const [editingHoldingId, setEditingHoldingId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState<string>('');
  const [editEntryPrice, setEditEntryPrice] = useState<string>('');

  useEffect(() => {
    setVisibleCount(20);
  }, [search, filter, marketType]);

  useEffect(() => {
    if (externalSection) {
      setScreenerSection(externalSection.section);
    }
  }, [externalSection]);

  useEffect(() => {
    const handleTourFocus = (evt: Event) => {
      const targetId = (evt as CustomEvent<string>).detail;
      if (targetId === 'tour-screener-overview') {
        setScreenerSection('table');
      }
    };
    window.addEventListener('aegis:tour-focus', handleTourFocus);
    return () => window.removeEventListener('aegis:tour-focus', handleTourFocus);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist));
    } catch {
      // Ignore storage errors
    }
  }, [watchlist]);

  const loadOverview = useCallback(
    async (forceRefresh = false) => {
      const cacheKey = `screener_overview_${marketType}`;
      if (!forceRefresh) {
        const cached = getCachedValue<{ tickers: TickerOverview[]; updatedAt?: string }>(cacheKey);
        if (cached && cached.data.tickers.length > 0) {
          setTickers(cached.data.tickers);
          setLastUpdatedAt(cached.data.updatedAt ?? null);
          setLoading(false);
        }
      }
      if (forceRefresh) {
        setLoading(true);
      }
      try {
        const refreshParam = forceRefresh ? '&refresh=1' : '';
        const res = await fetchJsonWithBackoff<{ tickers: TickerOverview[]; updatedAt?: string }>(
          `/api/market/overview?marketType=${marketType}${refreshParam}`,
          { init: { cache: 'no-store' }, retries: 2 }
        );
        if (res.ok && res.data && (forceRefresh || shouldApplyThrottledUpdate(cacheKey, 1000))) {
          const list = res.data.tickers || [];
          const updatedAt = res.data.updatedAt || new Date().toISOString();
          setTickers(list);
          setLastUpdatedAt(updatedAt);
          setCachedValue(cacheKey, { tickers: list, updatedAt }, 25_000);
        }
      } catch {
        // Keep prior tickers if network glitch
      } finally {
        setLoading(false);
      }
    },
    [marketType]
  );

  useEffect(() => {
    void loadOverview();
    const intervalId = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        void loadOverview(false);
      }
    }, 15_000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void loadOverview(false);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [loadOverview]);

  const toggleWatchlist = (sym: string) => {
    if (activeWatchlistId && effIsPro) {
      setCustomWatchlists((prev) => {
        const next = prev.map((wl) => {
          if (wl.id !== activeWatchlistId) return wl;
          const exists = wl.symbols.includes(sym);
          return {
            ...wl,
            symbols: exists ? wl.symbols.filter((s) => s !== sym) : [...wl.symbols, sym],
          };
        });
        writeCustomWatchlists(next);
        return next;
      });
      return;
    }
    setWatchlist((prev) => (prev.includes(sym) ? prev.filter((s) => s !== sym) : [...prev, sym]));
  };

  const handleCreateCustomWatchlist = (e: React.FormEvent) => {
    e.preventDefault();
    if (!effIsPro) {
      onUpgradePro?.();
      return;
    }
    const clean = sanitizePlainText(newWlName, 24);
    if (!clean || customWatchlists.length >= 5) return;
    triggerHaptic(10);
    const created: CustomWatchlist = {
      id: `wl-${Date.now()}`,
      name: clean,
      symbols: watchlist.slice(0, 5),
    };
    const next = [...customWatchlists, created].slice(0, 5);
    setCustomWatchlists(next);
    writeCustomWatchlists(next);
    setActiveWatchlistId(created.id);
    setFilter('watchlist');
    setNewWlName('');
    setCreatingWl(false);
  };

  const handleDeleteCustomWatchlist = (id: string) => {
    const next = customWatchlists.filter((w) => w.id !== id);
    setCustomWatchlists(next);
    writeCustomWatchlists(next);
    if (activeWatchlistId === id) {
      setActiveWatchlistId(null);
      setFilter('all');
    }
  };

  const activeWatchlistSymbols = useMemo(() => {
    if (activeWatchlistId && effIsPro) {
      return customWatchlists.find((w) => w.id === activeWatchlistId)?.symbols ?? [];
    }
    return watchlist;
  }, [activeWatchlistId, effIsPro, customWatchlists, watchlist]);

  const handleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortAsc((v) => !v);
    } else {
      setSortBy(field);
      setSortAsc(false);
    }
  };

  const marketSummary = useMemo(() => {
    if (tickers.length === 0) {
      return { avgChange: 0, totalVolM: 0, gainers: 0, losers: 0, topLeader: null as TickerOverview | null };
    }
    const avgChange = tickers.reduce((acc, t) => acc + t.change24hPct, 0) / tickers.length;
    const totalVolM = tickers.reduce((acc, t) => acc + t.volume24hUsdt, 0) / 1_000_000;
    const gainers = tickers.filter((t) => t.change24hPct > 0).length;
    const losers = tickers.filter((t) => t.change24hPct < 0).length;
    const topLeader = [...tickers].sort((a, b) => b.change24hPct - a.change24hPct)[0] ?? null;
    return { avgChange, totalVolM, gainers, losers, topLeader };
  }, [tickers]);

  const filteredTickers = useMemo(() => {
    const q = search.trim().toUpperCase();
    const list = tickers.filter((t) => {
      if (q && !t.symbol.includes(q) && !t.baseAsset.includes(q)) return false;
      if (filter === 'gainers') return t.change24hPct > 0;
      if (filter === 'losers') return t.change24hPct < 0;
      if (filter === 'volume') return t.volume24hUsdt >= 150_000_000;
      if (filter === 'watchlist') return activeWatchlistSymbols.includes(t.symbol);
      return true;
    });

    const sorted = [...list].sort((a, b) => {
      let diff = 0;
      if (sortBy === 'volume') diff = a.volume24hUsdt - b.volume24hUsdt;
      else if (sortBy === 'change') diff = a.change24hPct - b.change24hPct;
      else if (sortBy === 'price') diff = a.price - b.price;
      else {
        const rangeA = a.low24h > 0 ? ((a.high24h - a.low24h) / a.low24h) * 100 : 0;
        const rangeB = b.low24h > 0 ? ((b.high24h - b.low24h) / b.low24h) * 100 : 0;
        diff = rangeA - rangeB;
      }
      return sortAsc ? diff : -diff;
    });

    return sorted;
  }, [tickers, search, filter, activeWatchlistSymbols, sortBy, sortAsc]);

  const momentumChartData = useMemo(
    () =>
      tickers.map((t) => ({
        name: t.baseAsset,
        changePct: t.change24hPct,
        volumeM: Number((t.volume24hUsdt / 1_000_000).toFixed(1)),
      })),
    [tickers]
  );

  const handlePrefillMarketPrice = (sym: string) => {
    const found = tickers.find((t) => t.symbol === sym);
    if (found) {
      setNewEntryPrice(String(found.price));
    }
  };

  const handleAddHolding = (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = parseLocalePositiveNumber(newAmount);
    const entryNum = parseLocalePositiveNumber(newEntryPrice);
    if (!amountNum || !entryNum) {
      setPortfolioError('Введите корректные положительные числа (можно через точку или запятую).');
      return;
    }
    setPortfolioError(null);
    triggerHaptic(10);
    onAddHolding(newSymbol, amountNum, entryNum);
  };

  const handleStartEditHolding = (row: { id: string; amount: number; avgEntryPrice: number }) => {
    setEditingHoldingId(row.id);
    setEditAmount(String(row.amount));
    setEditEntryPrice(String(row.avgEntryPrice));
    setPortfolioError(null);
  };

  const handleSaveEditHolding = (id: string) => {
    const amountNum = parseLocalePositiveNumber(editAmount);
    const entryNum = parseLocalePositiveNumber(editEntryPrice);
    if (!amountNum || !entryNum) {
      setPortfolioError('Количество и цена входа должны быть положительными числами.');
      return;
    }
    setPortfolioError(null);
    triggerHaptic(10);
    onUpdateHolding?.(id, amountNum, entryNum);
    setEditingHoldingId(null);
  };

  const handleExportScreenerCsv = () => {
    if (!isPro) {
      onUpgradePro?.();
      return;
    }
    const headers = [
      'Пара',
      'Рынок',
      'Цена USDT',
      'Изменение 24ч %',
      'Минимум 24ч',
      'Максимум 24ч',
      'Объем 24ч USDT',
      ...(marketType === 'futures' ? ['Funding %'] : []),
    ];
    const rows = filteredTickers.map((t) => [
      t.symbol,
      marketType === 'futures' ? 'Futures' : 'Spot',
      t.price,
      t.change24hPct,
      t.low24h,
      t.high24h,
      Math.round(t.volume24hUsdt),
      ...(marketType === 'futures' ? [(t.fundingRatePct ?? 0.01).toFixed(4)] : []),
    ]);
    const dateStamp = new Date().toISOString().slice(0, 10);
    downloadCsvWithBom(`aegisquant-screener-${marketType}-${dateStamp}.csv`, headers, rows);
  };

  const handleExportPortfolioCsv = () => {
    if (!isPro) {
      onUpgradePro?.();
      return;
    }
    const headers = ['Тикер', 'Количество', 'Средняя цена входа $', 'Оценка $', 'PnL %'];
    const rows = portfolioReport.rows.map((r) => [
      r.baseAsset,
      r.amount,
      r.avgEntryPrice,
      r.valueUsdt.toFixed(2),
      r.pnlPct.toFixed(2),
    ]);
    const dateStamp = new Date().toISOString().slice(0, 10);
    downloadCsvWithBom(`aegisquant-portfolio-${dateStamp}.csv`, headers, rows);
  };

  const sectionTabs = useMemo(
    () => [
      {
        id: 'table' as const,
        label: 'Таблица',
        icon: <Table2 className="w-3.5 h-3.5 text-cyan-400" />,
        meta: tickers.length || 44,
      },
      {
        id: 'patterns' as const,
        label: 'Паттерны',
        icon: <Radar className="w-3.5 h-3.5 text-amber-400" />,
        meta: 'PRO',
      },
      {
        id: 'sectors' as const,
        label: 'Сектора',
        icon: <Grid2x2 className="w-3.5 h-3.5 text-emerald-400" />,
        meta: 'PRO',
      },
      {
        id: 'arbitrage' as const,
        label: 'Арбитраж',
        icon: <Repeat className="w-3.5 h-3.5 text-cyan-300" />,
        meta: 'MAX',
      },
      {
        id: 'momentum' as const,
        label: 'Импульс',
        icon: <BarChart2 className="w-3.5 h-3.5 text-emerald-400" />,
      },
      {
        id: 'portfolio' as const,
        label: 'Портфель',
        icon: <Wallet className="w-3.5 h-3.5 text-amber-400" />,
        meta: holdings.length > 0 ? holdings.length : undefined,
      },
    ],
    [tickers.length, holdings.length]
  );

  const sidebarControls = (
    <div data-tour-id="tour-screener-overview" className="space-y-2.5">
      <div className="grid grid-cols-2 p-1 rounded-xl bg-[#0B0F17] border border-white/8">
        <button
          type="button"
          onClick={() => setMarketType('spot')}
          className={`min-h-[34px] rounded-lg text-xs font-semibold transition-colors ${
            marketType === 'spot' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Спот
        </button>
        <button
          type="button"
          onClick={() => setMarketType('futures')}
          className={`min-h-[34px] rounded-lg text-xs font-semibold transition-colors ${
            marketType === 'futures' ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Фьючерсы
        </button>
      </div>

      <button
        type="button"
        onClick={() => void loadOverview(true)}
        disabled={loading}
        className="w-full min-h-[34px] px-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-xs text-slate-200 inline-flex items-center justify-center gap-1.5 transition-colors"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        <span>Обновить котировки</span>
      </button>
      {lastUpdatedAt && (
        <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono tabular-nums px-1">
          <span className="inline-flex items-center gap-1.5">
            <span className="live-dot" aria-hidden="true" />
            <span className="font-sans">Онлайн</span>
          </span>
          <span>
            {new Date(lastUpdatedAt).toLocaleTimeString('ru-RU', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </span>
        </div>
      )}
    </div>
  );

  const sidebarBottom = (
    <div className="space-y-1.5 text-xs font-mono tabular-nums">
      <div className="flex items-center justify-between">
        <span className="font-sans text-slate-400">Импульс 24ч</span>
        <span className={marketSummary.avgChange >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
          {marketSummary.avgChange >= 0 ? '+' : ''}
          {marketSummary.avgChange.toFixed(2)}%
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className="font-sans text-slate-400">Объем 24ч</span>
        <span className="text-cyan-300">${marketSummary.totalVolM.toFixed(0)}M</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="font-sans text-slate-400">Рост / Падение</span>
        <span>
          <span className="text-emerald-400">{marketSummary.gainers}</span>
          <span className="text-slate-600">/</span>
          <span className="text-rose-400">{marketSummary.losers}</span>
        </span>
      </div>
    </div>
  );

  return (
    <StaggerDeck>
      <WorkspaceShell
        title="Скринер рынка"
        subtitle={
          marketSummary.topLeader
            ? `Лидер: ${marketSummary.topLeader.baseAsset} (${marketSummary.topLeader.change24hPct >= 0 ? '+' : ''}${marketSummary.topLeader.change24hPct}%)`
            : `${TRADING_PAIRS.length} ликвидные пары`
        }
        icon={<Flame className="w-5 h-5 text-cyan-400" />}
        items={sectionTabs}
        activeId={screenerSection}
        onChange={setScreenerSection}
        layoutId="screener-workspace-nav"
        accent="cyan"
        sidebarTopSlot={sidebarControls}
        sidebarBottomSlot={sidebarBottom}
      >
        <div className="mb-3">
          <FeatureGuide
            title="Как пользоваться Скринером рынка"
            summary="Сравнивайте 44 ликвидные пары по объёму, импульсу, паттернам, секторам (L1/L2/DeFi/AI/Meme/RWA) и ставкам Funding в одном окне."
            steps={[
              'Таблица: фильтруйте по Споту/Фьючерсам и сортируйте по изменению за 24ч или объёму; тап по паре открывает график.',
              'Паттерны и Сектора (PRO): находите сжатие Bollinger, пробои уровней и самые сильные сектора дня.',
              'Арбитраж (MAX) и Портфель: оценивайте годовой APR фандинга и ведите учёт позиций с живым PnL.',
            ]}
            compact
          />
        </div>
        {screenerSection === 'table' && (
          <section className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow overflow-hidden">
            <div className="p-4 border-b border-white/8 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { id: 'all', label: `Все (${tickers.length})` },
                    { id: 'gainers', label: 'В плюсе' },
                    { id: 'losers', label: 'В минусе' },
                    { id: 'volume', label: 'Топ объём' },
                    { id: 'watchlist', label: `Избранное (${watchlist.length})` },
                  ] as const
                ).map((f) => {
                  const active = filter === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setFilter(f.id)}
                      className={`min-h-[34px] px-2.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
                        active
                          ? 'border-cyan-500/45 bg-cyan-500/15 text-cyan-200'
                          : 'border-white/8 bg-[#0B0F17] text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {f.label}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-2 w-full xl:w-auto">
                <div className="relative flex-1 xl:w-56">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Поиск пары (BTC, SOL)..."
                    className="w-full min-h-[36px] rounded-xl border border-white/10 bg-[#0B0F17] pl-8 pr-3 text-xs text-white placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleExportScreenerCsv}
                  className={`min-h-[36px] px-3 rounded-xl border text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                    effIsPro
                      ? 'border-cyan-500/35 bg-cyan-500/12 hover:bg-cyan-500/20 text-cyan-200'
                      : 'border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-200'
                  }`}
                >
                  {effIsPro ? (
                    <Download className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  ) : (
                    <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  )}
                  <span>{effIsPro ? 'Экспорт CSV' : 'CSV (PRO)'}</span>
                </button>
              </div>
            </div>

            {/* PRO #10: Кастомные вотчлисты (до 5 списков) */}
            <div className="px-4 py-2.5 border-b border-white/8 bg-[#0B0F17]/60 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400 mr-1">
                <ListChecks className="w-3.5 h-3.5 text-amber-400" />
                <span>Вотчлисты:</span>
              </span>
              {customWatchlists.map((wl) => {
                const selected = filter === 'watchlist' && activeWatchlistId === wl.id;
                return (
                  <div
                    key={wl.id}
                    className={`inline-flex items-center rounded-lg border transition-colors ${
                      selected
                        ? 'border-amber-400/50 bg-amber-500/15 text-amber-200'
                        : 'border-white/10 bg-[#111827] text-slate-300'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic(8);
                        if (!effIsPro) {
                          onUpgradePro?.();
                          return;
                        }
                        if (selected) {
                          setActiveWatchlistId(null);
                          setFilter('all');
                        } else {
                          setActiveWatchlistId(wl.id);
                          setFilter('watchlist');
                        }
                      }}
                      className="min-h-[28px] px-2.5 text-[11px] font-medium inline-flex items-center gap-1 whitespace-nowrap"
                    >
                      {!effIsPro && <Lock className="w-3 h-3 text-amber-400 shrink-0" />}
                      <span>{wl.name}</span>
                      <span className="text-[10px] font-mono text-slate-400">({wl.symbols.length})</span>
                    </button>
                    {effIsPro && customWatchlists.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleDeleteCustomWatchlist(wl.id)}
                        aria-label={`Удалить список ${wl.name}`}
                        className="pr-1.5 text-slate-500 hover:text-rose-400"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                );
              })}

              {customWatchlists.length < 5 && (
                creatingWl ? (
                  <form onSubmit={handleCreateCustomWatchlist} className="inline-flex items-center gap-1">
                    <input
                      type="text"
                      value={newWlName}
                      onChange={(e) => setNewWlName(e.target.value)}
                      placeholder="Название..."
                      maxLength={24}
                      className="w-28 min-h-[28px] rounded-lg border border-amber-500/40 bg-[#111827] px-2 text-[11px] text-white focus:outline-none"
                    />
                    <button
                      type="submit"
                      className="min-h-[28px] px-2 rounded-lg bg-amber-500 text-slate-950 text-[11px] font-semibold"
                    >
                      OK
                    </button>
                    <button
                      type="button"
                      onClick={() => setCreatingWl(false)}
                      className="min-h-[28px] px-1.5 text-slate-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      if (!effIsPro) {
                        onUpgradePro?.();
                        return;
                      }
                      setCreatingWl(true);
                    }}
                    className="min-h-[28px] px-2 rounded-lg border border-dashed border-amber-500/35 bg-amber-500/[0.06] hover:bg-amber-500/15 text-[11px] font-medium text-amber-300 inline-flex items-center gap-1 whitespace-nowrap"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Список ({customWatchlists.length}/5)</span>
                  </button>
                )
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-white/8 text-slate-400">
                    <th className="py-2.5 pl-2.5 pr-1.5 sm:px-4 font-medium">Пара</th>
                    <th className="py-2.5 px-1.5 sm:px-3 font-medium text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleSort('price')}
                        className="inline-flex items-center gap-1 hover:text-white"
                      >
                        <span>Цена</span>
                        <ArrowDownUp className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="py-2.5 px-1.5 sm:px-3 font-medium text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleSort('change')}
                        className="inline-flex items-center gap-1 hover:text-white"
                      >
                        <span>24ч %</span>
                        <ArrowDownUp className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="py-2.5 px-3 font-medium hidden md:table-cell">
                      <button
                        type="button"
                        onClick={() => handleSort('range')}
                        className="inline-flex items-center gap-1 hover:text-white"
                      >
                        <span>Диапазон</span>
                        <ArrowDownUp className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="py-2.5 px-3 font-medium text-right hidden sm:table-cell whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleSort('volume')}
                        className="inline-flex items-center gap-1 hover:text-white"
                      >
                        <span>Объем</span>
                        <ArrowDownUp className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="py-2.5 pl-1.5 pr-2.5 sm:px-4 font-medium text-right whitespace-nowrap">
                      {marketType === 'futures' ? '24ч · Fund' : '24ч · RSI'}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/6 font-mono tabular-nums">
                  {filteredTickers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center font-sans text-slate-400">
                        По выбранным фильтрам пары не найдены.
                      </td>
                    </tr>
                  ) : (
                    filteredTickers.slice(0, visibleCount).map((t) => (
                      <ScreenerTableRow
                        key={t.symbol}
                        ticker={t}
                        marketType={marketType}
                        isStarred={activeWatchlistSymbols.includes(t.symbol)}
                        onToggleWatchlist={toggleWatchlist}
                        onOpenPair={onOpenPairOnMarket}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {filteredTickers.length > visibleCount && (
              <div className="p-3 border-t border-white/8 flex items-center justify-center">
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(8);
                    setVisibleCount((v) => v + 24);
                  }}
                  className="min-h-[36px] px-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-medium text-slate-200 transition-colors"
                >
                  Показать ещё ({filteredTickers.length - visibleCount} пар)
                </button>
              </div>
            )}

            <div className="px-4 py-2.5 border-t border-white/6 text-[11px] text-slate-500">
              Рыночные данные предоставлены публичными API криптобирж и агрегаторов. Упоминания торговых площадок носят информационный характер.
            </div>
          </section>
        )}

        {screenerSection === 'patterns' && (
          <section className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-4 sm:p-5">
            <LivePatternScannerTab
              tickers={tickers}
              marketType={marketType}
              onOpenPair={onOpenPairOnMarket}
            />
          </section>
        )}

        {screenerSection === 'sectors' && (
          <section className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-4 sm:p-5">
            <SectorHeatmapCorrelationTab
              tickers={tickers}
              marketType={marketType}
              onOpenPair={onOpenPairOnMarket}
            />
          </section>
        )}

        {screenerSection === 'arbitrage' && (
          <section className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-4 sm:p-5">
            <FundingArbitrageScannerTab
              tickers={tickers}
              onOpenPair={onOpenPairOnMarket}
            />
          </section>
        )}

        {screenerSection === 'momentum' && (
          <section className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <BarChart2 className="w-4 h-4 text-cyan-400" />
                  <span>Карта импульса 24ч (%)</span>
                </h3>
                <p className="mt-0.5 text-xs text-slate-400">
                  Сравнение относительной силы ликвидных активов за последние 24 часа.
                </p>
              </div>
              <span className="text-xs font-mono text-slate-400">
                {marketType === 'futures' ? 'Фьючерсы' : 'Спот'}
              </span>
            </div>

            <div className="h-[320px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={momentumChartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: '#94A3B8', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fill: '#64748B', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => `${v}%`}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                    contentStyle={{
                      backgroundColor: '#0E1420',
                      borderColor: 'rgba(255,255,255,0.12)',
                      borderRadius: '12px',
                      fontSize: '12px',
                      color: '#F1F5F9',
                    }}
                    formatter={(value) => {
                      const num = Number(value ?? 0);
                      return [`${num >= 0 ? '+' : ''}${num}%`, 'Изменение 24ч'];
                    }}
                  />
                  <Bar dataKey="changePct" radius={[6, 6, 0, 0]}>
                    {momentumChartData.map((entry, idx) => (
                      <Cell
                        key={`bar-${entry.name}-${idx}`}
                        fill={entry.changePct >= 0 ? '#10B981' : '#EF4444'}
                        fillOpacity={0.85}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        )}

        {screenerSection === 'portfolio' && (
          <section className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-emerald-400" />
                  <span>Симулятор спот-портфеля</span>
                </h3>
                <p className="mt-0.5 text-xs text-slate-400">
                  Учебный портфель с автоматической переоценкой по живым котировкам.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {onOpenPortfolioDetails && (
                  <button
                    type="button"
                    onClick={onOpenPortfolioDetails}
                    className={`min-h-[36px] px-3 rounded-xl border text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                      activeTarget?.active
                        ? 'border-cyan-500/40 bg-cyan-500/12 hover:bg-cyan-500/20 text-cyan-200'
                        : 'border-white/12 bg-white/5 hover:bg-white/10 text-slate-200'
                    }`}
                  >
                    <Target className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                    <span>
                      {activeTarget?.active
                        ? `Цель: $${activeTarget.targetBalanceUsdt.toLocaleString('en-US', {
                            maximumFractionDigits: activeTarget.targetBalanceUsdt >= 100 ? 0 : 2,
                          })}`
                        : 'Задать Target PnL'}
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleExportPortfolioCsv}
                  className={`min-h-[36px] px-3 rounded-xl border text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                    isPro
                      ? 'border-emerald-500/35 bg-emerald-500/12 hover:bg-emerald-500/20 text-emerald-200'
                      : 'border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-200'
                  }`}
                >
                  {isPro ? (
                    <Download className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  ) : (
                    <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  )}
                  <span>{isPro ? 'Экспорт CSV' : 'CSV (PRO)'}</span>
                </button>
                <div className="text-right font-mono tabular-nums">
                  <div className="text-lg font-bold text-white">
                    {privacyMode
                      ? '•••••'
                      : `$${portfolioReport.totalValue.toLocaleString('en-US', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}`}
                  </div>
                  <div
                    className={`text-xs font-semibold ${
                      portfolioReport.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    Всего PnL:{' '}
                    {privacyMode
                      ? '•••••'
                      : `${portfolioReport.totalPnl >= 0 ? '+' : ''}$${portfolioReport.totalPnl.toFixed(2)}`}{' '}
                    ({portfolioReport.totalPnlPct >= 0 ? '+' : ''}
                    {portfolioReport.totalPnlPct.toFixed(2)}%)
                  </div>
                </div>
              </div>
            </div>

            {portfolioError && (
              <div className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                {portfolioError}
              </div>
            )}

            <form onSubmit={handleAddHolding} className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
              <div className="sm:col-span-4">
                <label htmlFor="pf-symbol" className="block text-[11px] text-slate-400 mb-1">
                  Актив
                </label>
                <select
                  id="pf-symbol"
                  value={newSymbol}
                  onChange={(e) => {
                    setNewSymbol(e.target.value);
                    handlePrefillMarketPrice(e.target.value);
                  }}
                  className="w-full min-h-[38px] rounded-xl border border-white/10 bg-[#0B0F17] px-3 text-xs font-mono text-white focus:border-emerald-500 focus:outline-none"
                >
                  {TRADING_PAIRS.map((p) => (
                    <option key={p.symbol} value={p.symbol}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-3">
                <label htmlFor="pf-amount" className="block text-[11px] text-slate-400 mb-1">
                  Кол-во (точка или запятая)
                </label>
                <input
                  id="pf-amount"
                  type="text"
                  inputMode="decimal"
                  value={newAmount}
                  onChange={(e) => setNewAmount(e.target.value)}
                  placeholder="0,15"
                  className="w-full min-h-[38px] rounded-xl border border-white/10 bg-[#0B0F17] px-3 text-xs font-mono text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div className="sm:col-span-3">
                <label htmlFor="pf-price" className="block text-[11px] text-slate-400 mb-1">
                  Цена входа ($)
                </label>
                <input
                  id="pf-price"
                  type="text"
                  inputMode="decimal"
                  value={newEntryPrice}
                  onChange={(e) => setNewEntryPrice(e.target.value)}
                  placeholder="64000,50"
                  className="w-full min-h-[38px] rounded-xl border border-white/10 bg-[#0B0F17] px-3 text-xs font-mono text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div className="sm:col-span-2">
                <button
                  type="submit"
                  className="w-full min-h-[38px] rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold inline-flex items-center justify-center gap-1 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Добавить</span>
                </button>
              </div>
            </form>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
              <div className="md:col-span-7 overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-white/8 text-slate-400">
                      <th className="py-2 font-medium">Актив</th>
                      <th className="py-2 font-medium text-right">Оценка</th>
                      <th className="py-2 font-medium text-right">PnL %</th>
                      <th className="py-2 font-medium text-right" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/6 font-mono tabular-nums">
                    {portfolioReport.rows.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-6 text-center font-sans text-slate-400">
                          Добавьте первый актив, чтобы рассчитать распределение портфеля.
                        </td>
                      </tr>
                    ) : (
                      portfolioReport.rows.map((row) => {
                        const isEditingRow = editingHoldingId === row.id;
                        return (
                          <tr key={row.id}>
                            <td className="py-2 font-sans">
                              <div className="font-semibold text-white">{row.baseAsset}</div>
                              {isEditingRow ? (
                                <div className="mt-1 flex items-center gap-1.5 font-mono">
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={editAmount}
                                    onChange={(e) => setEditAmount(e.target.value)}
                                    aria-label="Новое количество"
                                    className="w-20 rounded-lg border border-emerald-500/40 bg-[#0B0F17] px-2 py-1 text-[11px] text-white"
                                  />
                                  <span className="text-slate-500">×</span>
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={editEntryPrice}
                                    onChange={(e) => setEditEntryPrice(e.target.value)}
                                    aria-label="Новая цена входа"
                                    className="w-24 rounded-lg border border-emerald-500/40 bg-[#0B0F17] px-2 py-1 text-[11px] text-white"
                                  />
                                </div>
                              ) : (
                                <div className="text-[11px] font-mono text-slate-400">
                                  {effPrivacy ? '••••' : row.amount} × {formatUsd(row.avgEntryPrice)}
                                </div>
                              )}
                            </td>
                            <td className="py-2 text-right text-slate-100 whitespace-nowrap">
                              {effPrivacy ? '•••••' : `$${row.valueUsdt.toFixed(2)}`}
                            </td>
                            <td
                              className={`py-2 text-right font-semibold whitespace-nowrap ${
                                row.pnlPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {row.pnlPct >= 0 ? '+' : ''}
                              {row.pnlPct.toFixed(1)}%
                            </td>
                            <td className="py-2 text-right">
                              <div className="inline-flex items-center gap-1">
                                {isEditingRow ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => handleSaveEditHolding(row.id)}
                                      aria-label="Сохранить позицию"
                                      className="p-1.5 rounded-lg text-emerald-400 hover:bg-emerald-500/15 transition-colors"
                                    >
                                      <Check className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditingHoldingId(null)}
                                      aria-label="Отменить редактирование"
                                      className="p-1.5 rounded-lg text-slate-400 hover:bg-white/10 transition-colors"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    {onUpdateHolding && (
                                      <button
                                        type="button"
                                        onClick={() => handleStartEditHolding(row)}
                                        aria-label={`Изменить позицию ${row.baseAsset}`}
                                        className="p-1.5 rounded-lg text-slate-500 hover:text-emerald-300 hover:bg-emerald-500/10 transition-colors"
                                      >
                                        <Pencil className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => onRemoveHolding(row.id)}
                                      aria-label={`Удалить позицию ${row.baseAsset}`}
                                      className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div className="md:col-span-5 flex flex-col items-center">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mb-1">
                  <PieChartIcon className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Распределение</span>
                </div>
                <div className="h-[180px] w-full">
                  {portfolioReport.rows.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={portfolioReport.rows}
                          dataKey="valueUsdt"
                          nameKey="baseAsset"
                          cx="50%"
                          cy="50%"
                          innerRadius={44}
                          outerRadius={70}
                          paddingAngle={3}
                          stroke="none"
                        >
                          {portfolioReport.rows.map((entry, idx) => (
                            <Cell
                              key={`slice-${entry.id}`}
                              fill={ALLOCATION_COLORS[idx % ALLOCATION_COLORS.length]}
                            />
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
                          formatter={(value) => [`$${Number(value ?? 0).toFixed(2)}`, 'Стоимость']}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-xs text-slate-500">Нет активов</div>
                  )}
                </div>
              </div>
            </div>

            {/* MAX #9: Стресс-тест портфеля («Что если?») */}
            <PortfolioStressTestCard
              holdings={portfolioReport.allocations.map((a) => ({
                symbol: a.symbol,
                valueUsdt: a.valueUsdt,
              }))}
              totalValueUsdt={portfolioReport.totalValue}
            />
          </section>
        )}
      </WorkspaceShell>
    </StaggerDeck>
  );
};
