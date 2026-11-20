import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownUp,
  ArrowRight,
  BarChart2,
  Download,
  Flame,
  Grid2x2,
  Link2,
  ListChecks,
  Lock,
  PieChart as PieChartIcon,
  Plus,
  Radar,
  RefreshCw,
  Repeat,
  Search,
  ShieldCheck,
  Star,
  Table2,
  Target,
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
import type { PaperPortfolioReport, PortfolioSourceMeta } from '../hooks/usePaperPortfolio';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import {
  getCachedValue,
  setCachedValue,
} from '../lib/marketCache';
import { ingestLiveTickers } from '../stores/liveMarketStore';
import { CACHE_TTL, fetchWithSWR, isPageVisible, subscribePageVisibility } from '../utils/cache';
import { parseJsonResponse } from '../utils/safeFetchJson';
import { usePlan } from '../contexts/PlanContext';
import { FeatureGuide } from './FeatureGuide';
import {
  readCustomWatchlists,
  writeCustomWatchlists,
  type CustomWatchlist,
} from '../lib/proMaxStore';
import { sanitizePlainText, triggerHaptic } from '../lib/securityDlp';
import type {
  ExchangeKeyRecord,
  MarketType,
  PortfolioHolding,
  PortfolioTargetRecord,
  TickerOverview,
} from '../types/domain';
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
        className="cv-list-item hover:bg-emerald-500/[0.06] active:bg-emerald-500/[0.1] cursor-pointer transition-colors"
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
  portfolioSource?: PortfolioSourceMeta;
  exchangeKeys?: ExchangeKeyRecord[];
  activeTarget?: PortfolioTargetRecord | null;
  onOpenPortfolioDetails?: () => void;
  onOpenExchangeIntegrations?: () => void;
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
  portfolioSource,
  exchangeKeys = [],
  activeTarget,
  onOpenPortfolioDetails,
  onOpenExchangeIntegrations,
  onAddHolding: _onAddHolding,
  onUpdateHolding: _onUpdateHolding,
  onRemoveHolding: _onRemoveHolding,
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
  const debouncedSearch = useDebouncedValue(search, 250);
  const [filter, setFilter] = useState<ScreenerFilter>('all');
  const [sortBy, setSortBy] = useState<SortField>('volume');
  const [sortAsc, setSortAsc] = useState(false);
  const [visibleCount, setVisibleCount] = useState<number>(20);

  // PRO #10: Кастомные вотчлисты (до 5 списков в localStorage)
  const [customWatchlists, setCustomWatchlists] = useState<CustomWatchlist[]>(() => readCustomWatchlists());
  const [activeWatchlistId, setActiveWatchlistId] = useState<string | null>(null);
  const [creatingWl, setCreatingWl] = useState(false);
  const [newWlName, setNewWlName] = useState('');
  const [selectedMomentumSymbol, setSelectedMomentumSymbol] = useState<string | null>(null);

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

  const enabledExchangesCount = useMemo(
    () => exchangeKeys.filter((k) => k.enabled).length,
    [exchangeKeys]
  );

  useEffect(() => {
    setVisibleCount(20);
  }, [debouncedSearch, filter, marketType]);

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

  const overviewAbortRef = useRef<AbortController | null>(null);

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

      overviewAbortRef.current?.abort();
      const controller = new AbortController();
      overviewAbortRef.current = controller;

      try {
        const refreshParam = forceRefresh ? '&refresh=1' : '';
        const data = await fetchWithSWR<{ tickers?: TickerOverview[]; updatedAt?: string }>(
          `market:overview:${marketType}`,
          async (signal) => {
            const res = await fetch(`/api/market/overview?marketType=${marketType}${refreshParam}`, {
              cache: 'no-store',
              signal,
            });
            const parsed = await parseJsonResponse<{ tickers?: TickerOverview[]; updatedAt?: string }>(res);
            if (!parsed.ok || !parsed.data) {
              throw new Error(parsed.errorMessage || 'Failed to load overview');
            }
            return parsed.data;
          },
          {
            ttlMs: CACHE_TTL.LIVE_OVERVIEW_MS,
            forceRefresh,
            signal: controller.signal,
            onBackgroundUpdate: (fresh) => {
              const list = fresh.tickers || [];
              const updatedAt = fresh.updatedAt || new Date().toISOString();
              if (list.length > 0) {
                setTickers(list);
                setLastUpdatedAt(updatedAt);
                setCachedValue(cacheKey, { tickers: list, updatedAt }, 25_000);
                ingestLiveTickers(marketType, list, true);
              }
            },
          }
        );

        if (!controller.signal.aborted) {
          const list = data.tickers || [];
          const updatedAt = data.updatedAt || new Date().toISOString();
          setTickers(list);
          setLastUpdatedAt(updatedAt);
          setCachedValue(cacheKey, { tickers: list, updatedAt }, 25_000);
          if (list.length > 0) {
            ingestLiveTickers(marketType, list, true);
          }
        }
      } catch {
        // Keep prior tickers if network glitch or aborted
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    },
    [marketType]
  );

  useEffect(() => {
    void loadOverview(false);
    const intervalId = window.setInterval(() => {
      if (isPageVisible()) {
        void loadOverview(false);
      }
    }, 15_000);
    const unsubVis = subscribePageVisibility((visible) => {
      if (visible) {
        void loadOverview(false);
      }
    });
    return () => {
      window.clearInterval(intervalId);
      unsubVis();
      overviewAbortRef.current?.abort();
    };
  }, [loadOverview]);

  const toggleWatchlist = useCallback(
    (sym: string) => {
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
    },
    [activeWatchlistId, effIsPro]
  );

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
    const q = debouncedSearch.trim().toUpperCase();
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
  }, [tickers, debouncedSearch, filter, activeWatchlistSymbols, sortBy, sortAsc]);

  const momentumChartData = useMemo(
    () =>
      tickers.map((t) => ({
        symbol: t.symbol,
        name: t.baseAsset,
        price: t.price,
        changePct: t.change24hPct,
        volumeM: Number((t.volume24hUsdt / 1_000_000).toFixed(1)),
      })),
    [tickers]
  );

  const selectedMomentumItem = useMemo(
    () =>
      momentumChartData.find((d) => d.symbol === selectedMomentumSymbol) ??
      momentumChartData[0] ??
      null,
    [momentumChartData, selectedMomentumSymbol]
  );


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
          <section className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <BarChart2 className="w-4 h-4 text-cyan-400" />
                  <span>Карта импульса 24ч (%)</span>
                </h3>
                <p className="mt-0.5 text-xs text-slate-400">
                  Нажмите на любой столбец графика, чтобы увидеть цену монеты и сразу открыть график.
                </p>
              </div>
              <span className="text-xs font-mono text-slate-400">
                {marketType === 'futures' ? 'Фьючерсы' : 'Спот'}
              </span>
            </div>

            {selectedMomentumItem && (
              <div className="rounded-xl border border-emerald-500/30 bg-[#0B0F17] px-3.5 py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono tabular-nums text-xs">
                  <div className="font-sans">
                    <span className="text-sm font-bold text-white">{selectedMomentumItem.name}</span>
                    <span className="text-slate-500 ml-1">/ USDT</span>
                  </div>
                  <div>
                    <span className="text-slate-400 font-sans mr-1.5">Цена:</span>
                    <span className="font-semibold text-white">
                      {formatUsd(selectedMomentumItem.price)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 font-sans mr-1.5">24ч:</span>
                    <span
                      className={`font-bold ${
                        selectedMomentumItem.changePct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {selectedMomentumItem.changePct >= 0 ? '+' : ''}
                      {selectedMomentumItem.changePct.toFixed(2)}%
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 font-sans mr-1.5">Объём:</span>
                    <span className="text-slate-200">${selectedMomentumItem.volumeM}M</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(10);
                    onOpenPairOnMarket(selectedMomentumItem.symbol, marketType);
                  }}
                  className="min-h-[34px] px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                >
                  <span>Открыть график</span>
                  <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                </button>
              </div>
            )}

            <div className="h-[320px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={momentumChartData}
                  margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
                  onClick={(state) => {
                    const activeLabel = state?.activeLabel;
                    if (typeof activeLabel === 'string') {
                      const found = momentumChartData.find((d) => d.name === activeLabel);
                      if (found) {
                        triggerHaptic(8);
                        setSelectedMomentumSymbol(found.symbol);
                      }
                    }
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: '#94A3B8', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fill: '#64748B', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => `${v}%`}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                    content={({ active, payload }) => {
                      if (!active || !payload || !payload[0]?.payload) return null;
                      const pt = payload[0].payload as (typeof momentumChartData)[number];
                      return (
                        <div className="rounded-xl border border-white/15 bg-[#0E1420] px-3 py-2 text-xs shadow-lg font-mono tabular-nums space-y-1">
                          <div className="font-sans font-bold text-white">{pt.name}/USDT</div>
                          <div className="text-slate-300">Цена: {formatUsd(pt.price)}</div>
                          <div className={pt.changePct >= 0 ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>
                            24ч: {pt.changePct >= 0 ? '+' : ''}
                            {pt.changePct.toFixed(2)}%
                          </div>
                          <div className="text-slate-400">Объём: ${pt.volumeM}M</div>
                        </div>
                      );
                    }}
                  />
                  <Bar
                    dataKey="changePct"
                    radius={[6, 6, 0, 0]}
                    cursor="pointer"
                    onClick={(data) => {
                      const sym = (data as { symbol?: string })?.symbol;
                      if (sym) {
                        triggerHaptic(8);
                        setSelectedMomentumSymbol(sym);
                      }
                    }}
                  >
                    {momentumChartData.map((entry, idx) => {
                      const isSelected = selectedMomentumItem?.symbol === entry.symbol;
                      return (
                        <Cell
                          key={`bar-${entry.name}-${idx}`}
                          fill={entry.changePct >= 0 ? '#10B981' : '#EF4444'}
                          fillOpacity={isSelected ? 1 : 0.78}
                          stroke={isSelected ? '#FFFFFF' : 'none'}
                          strokeWidth={isSelected ? 1.5 : 0}
                        />
                      );
                    })}
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
                  <span>Биржевой портфель (API)</span>
                </h3>
                <p className="mt-0.5 text-xs text-slate-400">
                  VERNIER не хранит средства — отображаются только балансы, синхронизированные с ваших бирж (Binance, Bybit, OKX).
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2.5">
                {onOpenExchangeIntegrations && (
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic(8);
                      onOpenExchangeIntegrations();
                    }}
                    className="min-h-[36px] px-3 rounded-xl border border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                  >
                    <Link2 className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
                    <span>
                      {enabledExchangesCount > 0 ? 'Синхр. / биржи' : 'Подключить биржу'}
                    </span>
                  </button>
                )}
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
                    24ч PnL:{' '}
                    {privacyMode
                      ? '•••••'
                      : `${portfolioReport.dailyPnlUsdt >= 0 ? '+' : ''}$${portfolioReport.dailyPnlUsdt.toFixed(2)}`}{' '}
                    ({portfolioReport.dailyPnlPct >= 0 ? '+' : ''}
                    {portfolioReport.dailyPnlPct.toFixed(2)}%)
                  </div>
                </div>
              </div>
            </div>

            {/* Non-custodial source status bar */}
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 min-w-0 text-slate-200">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="min-w-0">
                  {portfolioSource?.mode === 'exchange' && portfolioSource.exchange ? (
                    <>
                      Источник баланса:{' '}
                      <strong className="text-emerald-300">
                        {portfolioSource.exchange.toUpperCase()}
                        {portfolioSource.label ? ` (${portfolioSource.label})` : ''}
                      </strong>
                      {portfolioSource.syncedAt && (
                        <span className="text-slate-400 font-mono text-[11px]">
                          {' '}· обновлён {new Date(portfolioSource.syncedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      Режим <strong className="text-white">Non-Custodial</strong>: подключите Read-Only или Trade API ключ биржи в «Защита → Биржи API», чтобы видеть реальный баланс.
                    </>
                  )}
                </span>
              </div>
              {onOpenExchangeIntegrations && (
                <button
                  type="button"
                  onClick={onOpenExchangeIntegrations}
                  className="text-emerald-300 hover:text-emerald-200 font-semibold whitespace-nowrap shrink-0"
                >
                  Настроить API →
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
              <div className="md:col-span-7 overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-white/8 text-slate-400">
                      <th className="py-2 font-medium">Актив биржи</th>
                      <th className="py-2 font-medium text-right">Оценка</th>
                      <th className="py-2 font-medium text-right">24ч %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/6 font-mono tabular-nums">
                    {portfolioReport.rows.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="py-7 text-center font-sans text-slate-400 space-y-2.5">
                          <p>
                            Нет синхронизированных балансов бирж. Для виртуальной тренировки используйте тренажёр Paper Trading в разделе «Рынок».
                          </p>
                          {onOpenExchangeIntegrations && (
                            <button
                              type="button"
                              onClick={onOpenExchangeIntegrations}
                              className="min-h-[36px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                            >
                              <Link2 className="w-3.5 h-3.5" />
                              <span>Подключить Binance / Bybit / OKX</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    ) : (
                      portfolioReport.rows.map((row) => (
                        <tr
                          key={row.id}
                          onClick={() => onOpenPairOnMarket(row.symbol, 'spot')}
                          className="hover:bg-white/[0.03] cursor-pointer transition-colors"
                        >
                          <td className="py-2.5 font-sans">
                            <div className="font-semibold text-white">{row.baseAsset}</div>
                            <div className="text-[11px] font-mono text-slate-400">
                              {effPrivacy ? '••••' : row.amount} × {formatUsd(row.livePrice)}
                            </div>
                          </td>
                          <td className="py-2.5 text-right text-slate-100 whitespace-nowrap">
                            {effPrivacy ? '•••••' : `$${row.valueUsdt.toFixed(2)}`}
                          </td>
                          <td
                            className={`py-2.5 text-right font-semibold whitespace-nowrap ${
                              row.dailyPnlPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {row.dailyPnlPct >= 0 ? '+' : ''}
                            {row.dailyPnlPct.toFixed(2)}%
                          </td>
                        </tr>
                      ))
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
