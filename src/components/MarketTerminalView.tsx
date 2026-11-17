import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpDown,
  ArrowUpRight,
  BarChart3,
  BellPlus,
  BookOpen,
  Bot,
  CandlestickChart as ChartIcon,
  ChevronDown,
  Clock,
  Crown,
  Flame,
  Gauge,
  History,
  Layers,
  Lock,
  PieChart as PieChartIcon,
  PlusCircle,
  RefreshCw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Star,
  X,
} from 'lucide-react';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import {
  CREDIT_COSTS,
  FREE_DAILY_SIGNAL_LIMIT,
  FREE_MAX_LEVERAGE,
  FREE_WEEKLY_QUOTA,
  PRO_MONTHLY_QUOTA,
  STRATEGY_CATALOG,
  TRADING_PAIRS,
  countTodayStrategySignals,
  formatProUntilDate,
  getCreditQuotaForProfile,
  isProSubscriptionActive,
  isProSubscriptionExpired,
} from '../data/strategies';
import { parseJsonResponse } from '../utils/safeFetchJson';
import type {
  AnalysisRecord,
  AnalysisResultPayload,
  CandlePoint,
  IndicatorSnapshot,
  MarketType,
  PriceAlertCondition,
  PriceAlertRecord,
  RibbonPeriods,
  RibbonType,
  SupportTicketCategory,
  SupportTicketRecord,
  TickerOverview,
  Timeframe,
  UserProfile,
} from '../types/domain';
import { CandlestickChart } from './CandlestickChart';
import { ChartQuickAlertWidget } from './ChartQuickAlertWidget';
import {
  ColumnSelectorMenu,
  DEFAULT_MARKET_COLUMNS,
  type MarketVisibleColumns,
} from './ColumnSelectorMenu';
import { FearGreedWidget } from './FearGreedWidget';
import { MarketDominanceWidget } from './MarketDominanceWidget';
import {
  AssetStripSkeleton,
  OscillatorsSkeleton,
  PairsListSkeleton,
  skeletonSwapVariants,
} from './MarketSkeletons';
import { MiniSparkline } from './MiniSparkline';
import { NATIVE_PILL_SPRING, NATIVE_SPRING, StaggerDeck, WorkspaceShell } from './MotionPrimitives';
import { OrderBookPanel } from './OrderBookPanel';
import { QuickAnswersCard } from './QuickAnswersCard';
import { QuickAssetAlertModal, type QuickAlertTargetAsset } from './QuickAssetAlertModal';
import {
  VirtualizedAssetStrip,
  VirtualizedPairsList,
  type EnrichedMarketPair,
} from './VirtualizedAssetLists';
import { authFetch } from '../lib/authFetch';

type MarketSection = 'chart' | 'ai' | 'depth' | 'oscillators' | 'sentiment' | 'pairs';
type AssetQuickFilter = 'all' | 'volume' | 'volatile' | 'new_listings' | 'favorites';
type AssetSortOption =
  | 'default'
  | 'name_asc'
  | 'name_desc'
  | 'price_desc'
  | 'price_asc'
  | 'change_desc'
  | 'change_asc';

const FAVORITES_STORAGE_KEY = 'aegis_market_favorite_pairs';
const SORT_STORAGE_KEY = 'aegis_market_asset_sort';
const COLUMNS_STORAGE_KEY = 'aegis_market_visible_columns';
const DEFAULT_FAVORITE_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
const VALID_SORT_OPTIONS: ReadonlySet<AssetSortOption> = new Set([
  'default',
  'name_asc',
  'name_desc',
  'price_desc',
  'price_asc',
  'change_desc',
  'change_asc',
]);

interface MarketTerminalViewProps {
  profile: UserProfile | null;
  isSignedIn: boolean;
  userEmail?: string;
  analyses: AnalysisRecord[];
  priceAlerts: PriceAlertRecord[];
  supportTickets: SupportTicketRecord[];
  pushSubscribed: boolean;
  externalSelection?: { symbol: string; marketType: MarketType; nonce: number } | null;
  onRequireLogin: () => void;
  onUpgradePro: () => void;
  onOpenPushSettings: () => void;
  onOpenFullFaq?: () => void;
  onStartTour?: () => void;
  onCreateSupportTicket: (params: {
    contactEmail: string;
    category: SupportTicketCategory;
    subject: string;
    message: string;
  }) => Promise<string>;
  onCreatePriceAlert: (params: {
    symbol: string;
    marketType: MarketType;
    condition: PriceAlertCondition;
    targetPrice: number;
  }) => Promise<void>;
  onTogglePriceAlert: (alertId: string, nextActive: boolean) => Promise<void>;
  onDeletePriceAlert: (alertId: string) => Promise<void>;
  onCheckPriceAlertsNow: () => Promise<{
    checkedAlerts: number;
    alertsSent: number;
    triggeredCount: number;
  }>;
  onConsumeAndSave: (params: {
    symbol: string;
    marketType: MarketType;
    timeframe: string;
    strategyKey: string;
    strategyName: string;
    creditCost?: number;
    result: AnalysisResultPayload;
  }) => Promise<void>;
  onSignalEmitted?: (params: {
    symbol: string;
    marketType: MarketType;
    direction: 'LONG' | 'SHORT' | 'WAIT';
    confidence: number;
    strategyName: string;
    entryZone: string;
  }) => Promise<void>;
}

const RIBBON_PRESETS: Array<{ id: string; label: string; type: RibbonType; periods: RibbonPeriods }> = [
  { id: 'scalp', label: 'Скальпинг 5·8·13·21', type: 'EMA', periods: [5, 8, 13, 21] },
  { id: 'swing', label: 'Свинг 8·13·21·55', type: 'EMA', periods: [8, 13, 21, 55] },
  { id: 'position', label: 'Позиционный 20·50·100·200', type: 'SMA', periods: [20, 50, 100, 200] },
];

const RIBBON_SWATCHES = ['#34D399', '#22D3EE', '#FBBF24', '#FB7185'] as const;

function formatUsd(val: number): string {
  if (val >= 1000) return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (val >= 10) return `$${val.toFixed(3)}`;
  return `$${val.toFixed(4)}`;
}

function formatUsdAbbrev(val?: number): string {
  if (!val || !Number.isFinite(val) || val <= 0) return '—';
  if (val >= 1_000_000_000_000) return `$${(val / 1_000_000_000_000).toFixed(2)}T`;
  if (val >= 1_000_000_000) return `$${(val / 1_000_000_000).toFixed(2)}B`;
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
}

function formatResetCountdown(iso?: string): string {
  if (!iso) return '7 дн.';
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'Готово к обновлению';
  const days = Math.floor(diff / (24 * 3600 * 1000));
  const hours = Math.floor((diff % (24 * 3600 * 1000)) / (3600 * 1000));
  return `${days}д ${hours}ч`;
}

function parseFirstPrice(text?: string): number | null {
  if (!text) return null;
  const cleaned = text.replace(/,/g, '');
  const match = cleaned.match(/\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
}

export const MarketTerminalView: React.FC<MarketTerminalViewProps> = ({
  profile,
  isSignedIn,
  userEmail,
  analyses,
  priceAlerts,
  supportTickets,
  pushSubscribed,
  externalSelection,
  onRequireLogin,
  onUpgradePro,
  onOpenPushSettings,
  onOpenFullFaq,
  onStartTour,
  onCreateSupportTicket,
  onCreatePriceAlert,
  onTogglePriceAlert,
  onDeletePriceAlert,
  onCheckPriceAlertsNow,
  onConsumeAndSave,
  onSignalEmitted,
}) => {
  const [marketSection, setMarketSection] = useState<MarketSection>('chart');
  const [assetFilter, setAssetFilter] = useState<AssetQuickFilter>('all');
  const [assetSort, setAssetSort] = useState<AssetSortOption>(() => {
    if (typeof window === 'undefined') return 'default';
    try {
      const saved = window.localStorage.getItem(SORT_STORAGE_KEY) as AssetSortOption | null;
      return saved && VALID_SORT_OPTIONS.has(saved) ? saved : 'default';
    } catch {
      return 'default';
    }
  });
  const [favoriteSymbols, setFavoriteSymbols] = useState<string[]>(() => {
    if (typeof window === 'undefined') return DEFAULT_FAVORITE_SYMBOLS;
    try {
      const raw = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
      if (!raw) return DEFAULT_FAVORITE_SYMBOLS;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')
        ? parsed
        : DEFAULT_FAVORITE_SYMBOLS;
    } catch {
      return DEFAULT_FAVORITE_SYMBOLS;
    }
  });
  const [sentimentSub, setSentimentSub] = useState<'fear' | 'dominance'>('fear');
  const [pairsSub, setPairsSub] = useState<'list' | 'history'>('list');

  const [marketType, setMarketType] = useState<MarketType>('spot');
  const [symbol, setSymbol] = useState<string>('BTCUSDT');
  const [timeframe, setTimeframe] = useState<Timeframe>('1h');
  const [strategyKey, setStrategyKey] = useState<string>('spot_trend_breakout');

  const [tickers, setTickers] = useState<TickerOverview[]>([]);
  const [candles, setCandles] = useState<CandlePoint[]>([]);
  const [indicators, setIndicators] = useState<IndicatorSnapshot | null>(null);
  const [fundingRatePct, setFundingRatePct] = useState<number | undefined>();
  const [openInterestUsdt, setOpenInterestUsdt] = useState<number | undefined>();
  const [dataSource, setDataSource] = useState<'live' | 'cached'>('live');

  const [showEma, setShowEma] = useState(false);
  const [showBollinger, setShowBollinger] = useState(false);
  const [showRibbon, setShowRibbon] = useState(true);
  const [showRibbonSettings, setShowRibbonSettings] = useState(false);
  const [showQuickAlert, setShowQuickAlert] = useState(false);
  const [ribbonType, setRibbonType] = useState<RibbonType>('EMA');
  const [ribbonPeriods, setRibbonPeriods] = useState<RibbonPeriods>([8, 13, 21, 55]);

  const [depositUsdt, setDepositUsdt] = useState<number>(2500);
  const [riskPct, setRiskPct] = useState<number>(1.5);
  const [leverage, setLeverage] = useState<number>(5);

  const [loadingChart, setLoadingChart] = useState(true);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [activeResult, setActiveResult] = useState<AnalysisResultPayload | null>(null);
  const [signalAnimVersion, setSignalAnimVersion] = useState(0);
  const [analysesAnimVersion, setAnalysesAnimVersion] = useState(0);
  const [telemetryAnimVersion, setTelemetryAnimVersion] = useState(0);
  const [lastMarketUpdatedAt, setLastMarketUpdatedAt] = useState<string | null>(null);
  const [draftAlertPrice, setDraftAlertPrice] = useState<number | null>(null);
  const [notifyAsset, setNotifyAsset] = useState<QuickAlertTargetAsset | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [visibleColumns, setVisibleColumns] = useState<MarketVisibleColumns>(() => {
    if (typeof window === 'undefined') return DEFAULT_MARKET_COLUMNS;
    try {
      const raw = window.localStorage.getItem(COLUMNS_STORAGE_KEY);
      if (!raw) return DEFAULT_MARKET_COLUMNS;
      const parsed = JSON.parse(raw) as Partial<MarketVisibleColumns>;
      return {
        sparkline: typeof parsed.sparkline === 'boolean' ? parsed.sparkline : DEFAULT_MARKET_COLUMNS.sparkline,
        price: typeof parsed.price === 'boolean' ? parsed.price : DEFAULT_MARKET_COLUMNS.price,
        change24h: typeof parsed.change24h === 'boolean' ? parsed.change24h : DEFAULT_MARKET_COLUMNS.change24h,
        volume: typeof parsed.volume === 'boolean' ? parsed.volume : DEFAULT_MARKET_COLUMNS.volume,
        marketCap: typeof parsed.marketCap === 'boolean' ? parsed.marketCap : DEFAULT_MARKET_COLUMNS.marketCap,
      };
    } catch {
      return DEFAULT_MARKET_COLUMNS;
    }
  });
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const prevMarketTypeRef = useRef<MarketType | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(visibleColumns));
    } catch {
      // Ignore storage quota/privacy restrictions
    }
  }, [visibleColumns]);

  useEffect(() => {
    const handleTourFocus = (evt: Event) => {
      const targetId = (evt as CustomEvent<string>).detail;
      if (targetId === 'tour-market-toolbar' || targetId === 'tour-ma-ribbon') {
        setMarketSection('chart');
      } else if (targetId === 'tour-market-ai') {
        setMarketSection('ai');
      }
    };
    window.addEventListener('aegis:tour-focus', handleTourFocus);
    return () => window.removeEventListener('aegis:tour-focus', handleTourFocus);
  }, []);

  useEffect(() => {
    if (!externalSelection) return;
    setSymbol(externalSelection.symbol);
    setMarketType(externalSelection.marketType);
    setActiveResult(null);
    setDraftAlertPrice(null);
    setMarketSection('chart');
  }, [externalSelection]);

  useEffect(() => {
    setDraftAlertPrice(null);
  }, [symbol, marketType]);

  const isPro = isProSubscriptionActive(profile);
  const isExpiredPro = isProSubscriptionExpired(profile);
  const totalCreditQuota = getCreditQuotaForProfile(profile);

  const filteredStrategies = useMemo(
    () => STRATEGY_CATALOG.filter((s) => s.marketType === marketType),
    [marketType]
  );

  useEffect(() => {
    if (!filteredStrategies.some((s) => s.key === strategyKey)) {
      const first =
        filteredStrategies.find((s) => isPro || s.tier === 'free') ?? filteredStrategies[0];
      if (first) {
        setStrategyKey(first.key);
        setLeverage(
          first.marketType === 'spot'
            ? 1
            : isPro
              ? first.defaultLeverage
              : Math.min(FREE_MAX_LEVERAGE, first.defaultLeverage)
        );
        setRiskPct(first.defaultRiskPct);
      }
    }
  }, [filteredStrategies, strategyKey, isPro]);

  useEffect(() => {
    if (!isPro && leverage > FREE_MAX_LEVERAGE) {
      setLeverage(FREE_MAX_LEVERAGE);
    }
  }, [isPro, leverage]);

  const activeStrategy = useMemo(
    () => filteredStrategies.find((s) => s.key === strategyKey) ?? filteredStrategies[0],
    [filteredStrategies, strategyKey]
  );

  const isSelectedStrategyLocked = Boolean(!isPro && activeStrategy?.tier === 'pro');
  const requiredCredits =
    activeStrategy?.creditCost ??
    (marketType === 'futures' ? CREDIT_COSTS.futuresAnalysis : CREDIT_COSTS.spotAnalysis);

  const todayStrategySignalsUsed = useMemo(
    () => (isSignedIn && activeStrategy ? countTodayStrategySignals(analyses, activeStrategy.key) : 0),
    [isSignedIn, analyses, activeStrategy]
  );
  const hasReachedCreditsLimit = Boolean(
    isSignedIn && profile && profile.creditsRemaining < requiredCredits
  );
  const hasReachedFreeDailyLimit = Boolean(
    isSignedIn && profile && !isPro && todayStrategySignalsUsed >= FREE_DAILY_SIGNAL_LIMIT
  );

  const loadMarketData = useCallback(
    async (options?: { showOverviewSkeleton?: boolean; forceRefresh?: boolean }) => {
      setLoadingChart(true);
      if (options?.showOverviewSkeleton) {
        setLoadingOverview(true);
      }
      const refreshQuery = options?.forceRefresh ? '&refresh=1' : '';
      try {
        const [overviewRes, candlesRes] = await Promise.all([
          fetch(`/api/market/overview?marketType=${marketType}${refreshQuery}`, {
            cache: 'no-store',
          }),
          fetch(
            `/api/market/candles?symbol=${symbol}&interval=${timeframe}&marketType=${marketType}${refreshQuery}`,
            { cache: 'no-store' }
          ),
        ]);
        let nextUpdatedIso: string | null = null;
        if (overviewRes.ok) {
          const ov = (await overviewRes.json()) as {
            tickers: TickerOverview[];
            updatedAt?: string;
          };
          setTickers(ov.tickers || []);
          if (ov.updatedAt) nextUpdatedIso = ov.updatedAt;
        }
        if (candlesRes.ok) {
          const cd = (await candlesRes.json()) as {
            candles: CandlePoint[];
            indicators: IndicatorSnapshot;
            fundingRatePct?: number;
            openInterestUsdt?: number;
            source: 'live' | 'cached';
            updatedAt?: string;
          };
          setCandles(cd.candles || []);
          setIndicators(cd.indicators || null);
          setFundingRatePct(cd.fundingRatePct);
          setOpenInterestUsdt(cd.openInterestUsdt);
          setDataSource(cd.source);
          setTelemetryAnimVersion((v) => v + 1);
          if (cd.updatedAt) nextUpdatedIso = cd.updatedAt;
        }
        setLastMarketUpdatedAt(nextUpdatedIso || new Date().toISOString());
      } catch {
        // Retain existing candles if temporary offline hiccup
      } finally {
        setLoadingChart(false);
        setLoadingOverview(false);
      }
    },
    [marketType, symbol, timeframe]
  );

  useEffect(() => {
    const isInitialOrMarketSwitch =
      prevMarketTypeRef.current === null || prevMarketTypeRef.current !== marketType;
    prevMarketTypeRef.current = marketType;
    void loadMarketData({ showOverviewSkeleton: isInitialOrMarketSwitch });

    const intervalId = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        void loadMarketData({ showOverviewSkeleton: false });
      }
    }, 15_000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void loadMarketData({ showOverviewSkeleton: false });
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loadMarketData, marketType]);

  const analysesSignature = useMemo(
    () => analyses.slice(0, 10).map((a) => a.id).join('|'),
    [analyses]
  );
  useEffect(() => {
    setAnalysesAnimVersion((v) => v + 1);
  }, [analysesSignature]);

  const activeTicker = useMemo(() => tickers.find((t) => t.symbol === symbol), [tickers, symbol]);

  // Живая цена прямо во вкладке браузера и в переключателе окон: «BTC $91,450.00 ▲ · AegisQuant»
  const tabTitlePrice = indicators?.lastPrice ?? activeTicker?.price;
  const tabTitleBase = activeTicker?.baseAsset;
  const tabTitleUp = (activeTicker?.change24hPct ?? 0) >= 0;
  const originalTitleRef = useRef<string | null>(null);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (originalTitleRef.current === null) originalTitleRef.current = document.title;
    return () => {
      if (originalTitleRef.current !== null) document.title = originalTitleRef.current;
    };
  }, []);
  useEffect(() => {
    if (typeof document === 'undefined' || typeof tabTitlePrice !== 'number' || !tabTitleBase) return;
    document.title = `${tabTitleBase} ${formatUsd(tabTitlePrice)} ${tabTitleUp ? '▲' : '▼'} · AegisQuant`;
  }, [tabTitlePrice, tabTitleBase, tabTitleUp]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favoriteSymbols));
    } catch {
      // Ignore storage quota/privacy restrictions
    }
  }, [favoriteSymbols]);

  const toggleFavoriteSymbol = useCallback((targetSymbol: string) => {
    setFavoriteSymbols((prev) =>
      prev.includes(targetSymbol)
        ? prev.filter((item) => item !== targetSymbol)
        : [...prev, targetSymbol]
    );
  }, []);

  const enrichedPairs = useMemo<EnrichedMarketPair[]>(
    () =>
      TRADING_PAIRS.map((pair) => {
        const live = tickers.find((t) => t.symbol === pair.symbol);
        return {
          symbol: pair.symbol,
          label: pair.label,
          name: pair.name,
          baseAsset: live?.baseAsset ?? pair.symbol.replace(/USDT$/, ''),
          category: pair.category,
          aliases: pair.aliases,
          price: live?.price ?? null,
          change24hPct: live?.change24hPct ?? null,
          volume24hUsdt: live?.volume24hUsdt ?? 0,
          marketCapUsdt: live?.marketCapUsdt,
          fundingRatePct: live?.fundingRatePct,
          sparkline24h: live?.sparkline24h,
          isFavorite: favoriteSymbols.includes(pair.symbol),
          isNewListing: pair.isNewListing,
        };
      }),
    [tickers, favoriteSymbols]
  );

  const openNotifyForAsset = useCallback((asset: EnrichedMarketPair) => {
    setNotifyAsset({
      symbol: asset.symbol,
      baseAsset: asset.baseAsset,
      name: asset.name,
      price: asset.price ?? 0,
    });
  }, []);

  const openNotifyForActive = useCallback(() => {
    const found = enrichedPairs.find((p) => p.symbol === symbol);
    setNotifyAsset({
      symbol,
      baseAsset: found?.baseAsset ?? symbol.replace(/USDT$/, ''),
      name: found?.name ?? symbol,
      price: indicators?.lastPrice ?? found?.price ?? activeTicker?.price ?? 0,
    });
  }, [enrichedPairs, symbol, indicators?.lastPrice, activeTicker?.price]);

  const topVolumePairs = useMemo(
    () => [...enrichedPairs].sort((a, b) => b.volume24hUsdt - a.volume24hUsdt).slice(0, 10),
    [enrichedPairs]
  );

  const volatilePairs = useMemo(() => {
    const sorted = [...enrichedPairs].sort(
      (a, b) => Math.abs(b.change24hPct ?? 0) - Math.abs(a.change24hPct ?? 0)
    );
    const strongMovers = sorted.filter((item) => Math.abs(item.change24hPct ?? 0) >= 1.5);
    return strongMovers.length >= 5 ? strongMovers : sorted.slice(0, 10);
  }, [enrichedPairs]);

  const newListingPairs = useMemo(
    () => enrichedPairs.filter((item) => item.isNewListing),
    [enrichedPairs]
  );

  const favoritePairs = useMemo(
    () => enrichedPairs.filter((item) => item.isFavorite),
    [enrichedPairs]
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(SORT_STORAGE_KEY, assetSort);
    } catch {
      // Ignore storage quota/privacy restrictions
    }
  }, [assetSort]);

  const normalizedSearch = searchQuery.trim().toLowerCase();

  const matchesSearchQuery = useCallback(
    (item: EnrichedMarketPair, query: string): boolean => {
      if (!query) return true;
      return (
        item.baseAsset.toLowerCase().includes(query) ||
        item.symbol.toLowerCase().includes(query) ||
        item.label.toLowerCase().includes(query) ||
        item.name.toLowerCase().includes(query) ||
        (item.category ? item.category.toLowerCase().includes(query) : false) ||
        (item.aliases ? item.aliases.some((alias) => alias.toLowerCase().includes(query)) : false)
      );
    },
    []
  );

  const instantSearchResults = useMemo(() => {
    if (!normalizedSearch) return [];
    const matched = enrichedPairs.filter((item) => matchesSearchQuery(item, normalizedSearch));
    const rankMatch = (item: EnrichedMarketPair): number => {
      const base = item.baseAsset.toLowerCase();
      if (base === normalizedSearch) return 0;
      if (item.aliases?.some((a) => a.toLowerCase() === normalizedSearch)) return 0;
      if (base.startsWith(normalizedSearch)) return 1;
      if (item.aliases?.some((a) => a.toLowerCase().startsWith(normalizedSearch))) return 1;
      if (item.name.toLowerCase().startsWith(normalizedSearch)) return 2;
      return 3;
    };
    matched.sort((a, b) => {
      const diff = rankMatch(a) - rankMatch(b);
      if (diff !== 0) return diff;
      return b.volume24hUsdt - a.volume24hUsdt;
    });
    return matched;
  }, [enrichedPairs, matchesSearchQuery, normalizedSearch]);

  const baseFilteredPairs = useMemo(() => {
    const byTab =
      assetFilter === 'volume'
        ? topVolumePairs
        : assetFilter === 'volatile'
          ? volatilePairs
          : assetFilter === 'new_listings'
            ? newListingPairs
            : assetFilter === 'favorites'
              ? favoritePairs
              : enrichedPairs;
    if (!normalizedSearch) return byTab;
    return byTab.filter((item) => matchesSearchQuery(item, normalizedSearch));
  }, [
    assetFilter,
    enrichedPairs,
    topVolumePairs,
    volatilePairs,
    newListingPairs,
    favoritePairs,
    normalizedSearch,
    matchesSearchQuery,
  ]);

  const filteredPairs = useMemo(() => {
    if (assetSort === 'default') return baseFilteredPairs;
    const copy = [...baseFilteredPairs];
    copy.sort((a, b) => {
      switch (assetSort) {
        case 'name_asc':
          return a.baseAsset.localeCompare(b.baseAsset);
        case 'name_desc':
          return b.baseAsset.localeCompare(a.baseAsset);
        case 'price_desc':
          return (b.price ?? -Infinity) - (a.price ?? -Infinity);
        case 'price_asc':
          return (a.price ?? Infinity) - (b.price ?? Infinity);
        case 'change_desc':
          return (b.change24hPct ?? -Infinity) - (a.change24hPct ?? -Infinity);
        case 'change_asc':
          return (a.change24hPct ?? Infinity) - (b.change24hPct ?? Infinity);
        default:
          return 0;
      }
    });
    return copy;
  }, [baseFilteredPairs, assetSort]);

  const filterMeta = useMemo(
    () => [
      {
        id: 'all' as const,
        label: 'Все',
        count: enrichedPairs.length,
        icon: <Layers className="w-3.5 h-3.5" />,
      },
      {
        id: 'volume' as const,
        label: 'По объёмам',
        count: topVolumePairs.length,
        icon: <BarChart3 className="w-3.5 h-3.5" />,
      },
      {
        id: 'volatile' as const,
        label: 'Волатильность',
        count: volatilePairs.length,
        icon: <Flame className="w-3.5 h-3.5" />,
      },
      {
        id: 'new_listings' as const,
        label: 'Новые листинги',
        count: newListingPairs.length,
        icon: <PlusCircle className="w-3.5 h-3.5" />,
      },
      {
        id: 'favorites' as const,
        label: 'Любимые',
        count: favoritePairs.length,
        icon: <Star className="w-3.5 h-3.5" />,
      },
    ],
    [
      enrichedPairs.length,
      topVolumePairs.length,
      volatilePairs.length,
      newListingPairs.length,
      favoritePairs.length,
    ]
  );

  const activePairAlertsCount = useMemo(
    () => priceAlerts.filter((a) => a.symbol === symbol && a.marketType === marketType && a.active).length,
    [priceAlerts, symbol, marketType]
  );

  const handleUpdateRibbonPeriod = (index: 0 | 1 | 2 | 3, rawVal: number) => {
    const clamped = Number.isFinite(rawVal) ? Math.max(2, Math.min(200, Math.round(rawVal))) : 2;
    setRibbonPeriods((prev) => {
      const next = [...prev] as RibbonPeriods;
      next[index] = clamped;
      return next;
    });
  };

  const handleRunAnalysis = async () => {
    setAnalysisError(null);
    if (!isSignedIn || !profile) {
      onRequireLogin();
      return;
    }
    if (isSelectedStrategyLocked) {
      onUpgradePro();
      return;
    }
    if (profile.creditsRemaining < requiredCredits) {
      setAnalysisError(
        isPro
          ? `Месячная квота кредитов PRO исчерпана (${profile.creditsRemaining}/${PRO_MONTHLY_QUOTA}). Продлите PRO, чтобы пополнить ещё ${PRO_MONTHLY_QUOTA} кредитов.`
          : `Недостаточно кредитов (нужно ${requiredCredits}, доступно ${profile.creditsRemaining}/${totalCreditQuota}). Перейдите на PRO (100 кр./мес.) или дождитесь сброса квоты.`
      );
      return;
    }
    if (!isPro && todayStrategySignalsUsed >= FREE_DAILY_SIGNAL_LIMIT) {
      setAnalysisError(
        `Достигнут дневной лимит Free (${FREE_DAILY_SIGNAL_LIMIT}/день) для выбранной стратегии. Подписка PRO снимает ограничения на количество сигналов в день.`
      );
      return;
    }

    const effectiveLeverage =
      marketType === 'spot' ? 1 : isPro ? leverage : Math.min(FREE_MAX_LEVERAGE, leverage);

    setAnalyzing(true);
    try {
      const res = await authFetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          marketType,
          timeframe,
          strategyKey: activeStrategy.key,
          strategyName: activeStrategy.name,
          strategyRules: activeStrategy.rulesSummary,
          depositUsdt,
          riskPerTradePct: riskPct,
          leverage: effectiveLeverage,
          isPro,
        }),
      });
      const parsed = await parseJsonResponse<{
        analysis?: AnalysisResultPayload;
        indicators?: IndicatorSnapshot;
        error?: string;
      }>(res);
      if (!parsed.ok || !parsed.data?.analysis) {
        throw new Error(parsed.errorMessage || 'Не удалось выполнить анализ графика.');
      }

      const analysis = parsed.data.analysis;
      setActiveResult(analysis);
      setSignalAnimVersion((v) => v + 1);
      if (parsed.data.indicators) {
        setIndicators(parsed.data.indicators);
        setTelemetryAnimVersion((v) => v + 1);
      }

      await onConsumeAndSave({
        symbol,
        marketType,
        timeframe,
        strategyKey: activeStrategy.key,
        strategyName: activeStrategy.name,
        creditCost: requiredCredits,
        result: analysis,
      });

      if (analysis.direction === 'LONG' || analysis.direction === 'SHORT') {
        void onSignalEmitted?.({
          symbol,
          marketType,
          direction: analysis.direction,
          confidence: analysis.confidence,
          strategyName: activeStrategy.name,
          entryZone: analysis.entryZone,
        });
      }
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : 'Ошибка анализа');
    } finally {
      setAnalyzing(false);
    }
  };

  const entryOverlay = parseFirstPrice(activeResult?.entryZone);
  const slOverlay = parseFirstPrice(activeResult?.stopLoss);
  const tpOverlay = parseFirstPrice(activeResult?.takeProfits?.[0]);

  const bbPercentB = useMemo(() => {
    if (!indicators) return 50;
    const span = indicators.bbUpper - indicators.bbLower;
    if (span <= 0) return 50;
    return Math.max(0, Math.min(100, Math.round(((indicators.lastPrice - indicators.bbLower) / span) * 100)));
  }, [indicators]);

  const ema200DeltaPct = useMemo(() => {
    if (!indicators || indicators.ema200 <= 0) return 0;
    return Number((((indicators.lastPrice - indicators.ema200) / indicators.ema200) * 100).toFixed(2));
  }, [indicators]);

  const menuItems = useMemo(
    () => [
      { id: 'chart' as const, label: 'График цены', icon: <ChartIcon className="w-3.5 h-3.5 text-emerald-400" /> },
      { id: 'ai' as const, label: 'AI-анализ и риск', icon: <Bot className="w-3.5 h-3.5 text-cyan-400" /> },
      {
        id: 'depth' as const,
        label: 'Стакан ордеров',
        icon: isPro ? (
          <BookOpen className="w-3.5 h-3.5 text-amber-400" />
        ) : (
          <Lock className="w-3.5 h-3.5 text-amber-400" />
        ),
        meta: !isPro ? 'PRO' : undefined,
      },
      { id: 'oscillators' as const, label: 'Осцилляторы', icon: <Gauge className="w-3.5 h-3.5 text-emerald-400" /> },
      { id: 'sentiment' as const, label: 'Страх и BTC%', icon: <PieChartIcon className="w-3.5 h-3.5 text-cyan-400" /> },
      {
        id: 'pairs' as const,
        label: 'Пары и история',
        icon: <History className="w-3.5 h-3.5 text-slate-300" />,
        meta: analyses.length > 0 ? analyses.length : tickers.length || undefined,
      },
    ],
    [analyses.length, tickers.length, isPro]
  );

  const sidebarControls = (
    <div data-tour-id="tour-market-toolbar" className="space-y-2.5">
      {/* Spot / Futures Switch */}
      <div className="grid grid-cols-2 p-1 rounded-xl bg-[#0B0F17] border border-white/8">
        <button
          type="button"
          onClick={() => {
            setMarketType('spot');
            setActiveResult(null);
          }}
          className={`min-h-[34px] rounded-lg text-xs font-semibold transition-colors ${
            marketType === 'spot' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Спот
        </button>
        <button
          type="button"
          onClick={() => {
            setMarketType('futures');
            setActiveResult(null);
          }}
          className={`min-h-[34px] rounded-lg text-xs font-semibold transition-colors ${
            marketType === 'futures' ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Фьючерсы
        </button>
      </div>

      {/* Pair + Timeframe */}
      <div className="flex flex-col sm:flex-row lg:flex-col gap-2">
        <div className="flex items-center gap-1.5">
          <select
            aria-label="Торговая пара"
            value={symbol}
            onChange={(e) => {
              setSymbol(e.target.value);
              setActiveResult(null);
            }}
            className="w-full min-w-0 min-h-[38px] rounded-xl border border-white/10 bg-[#0B0F17] px-2.5 text-xs font-mono font-medium text-white focus:border-emerald-500 focus:outline-none"
          >
            {!filteredPairs.some((p) => p.symbol === symbol) && (
              <option value={symbol}>{symbol} (текущая)</option>
            )}
            {filteredPairs.map((p) => {
              const priceLabel =
                p.price !== null && p.change24hPct !== null
                  ? ` · ${formatUsd(p.price)} (${p.change24hPct >= 0 ? '+' : ''}${p.change24hPct}%)`
                  : '';
              return (
                <option key={p.symbol} value={p.symbol}>
                  {p.label}
                  {priceLabel}
                </option>
              );
            })}
          </select>
          <button
            type="button"
            onClick={() => toggleFavoriteSymbol(symbol)}
            aria-label={
              favoriteSymbols.includes(symbol)
                ? `Удалить ${symbol} из любимых`
                : `Добавить ${symbol} в любимые`
            }
            title={
              favoriteSymbols.includes(symbol) ? 'Убрать из любимых' : 'Добавить в любимые'
            }
            className={`min-h-[38px] min-w-[38px] rounded-xl border flex items-center justify-center shrink-0 transition-colors ${
              favoriteSymbols.includes(symbol)
                ? 'border-amber-400/45 bg-amber-500/15 text-amber-300'
                : 'border-white/10 bg-[#0B0F17] text-slate-400 hover:text-amber-300'
            }`}
          >
            <Star
              className={`w-3.5 h-3.5 ${favoriteSymbols.includes(symbol) ? 'fill-amber-400 text-amber-300' : ''}`}
            />
          </button>
          <button
            type="button"
            onClick={openNotifyForActive}
            aria-label={`Уведомить по ${symbol}`}
            title="Поставить ценовой алерт"
            className={`min-h-[38px] min-w-[38px] rounded-xl border flex items-center justify-center shrink-0 transition-colors ${
              activePairAlertsCount > 0
                ? 'border-cyan-500/45 bg-cyan-500/15 text-cyan-200'
                : 'border-white/10 bg-[#0B0F17] text-slate-400 hover:text-cyan-200 hover:border-cyan-500/35'
            }`}
          >
            <BellPlus className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-4 p-0.5 rounded-xl bg-[#0B0F17] border border-white/8 shrink-0">
          {(['15m', '1h', '4h', '1d'] as Timeframe[]).map((tf) => (
            <button
              key={tf}
              type="button"
              onClick={() => setTimeframe(tf)}
              className={`min-h-[32px] rounded-lg text-[11px] font-mono font-medium transition-colors ${
                timeframe === tf ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/35' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tf.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  const sidebarBottom = (
    <div className="text-xs space-y-2">
      {profile ? (
        <>
          <div className="flex items-center justify-between gap-2 text-slate-300">
            <span className="font-mono tabular-nums">
              Кредиты:{' '}
              <strong className={profile.creditsRemaining > 0 ? 'text-emerald-400' : 'text-rose-400'}>
                {profile.creditsRemaining}
              </strong>
              /{totalCreditQuota}
            </span>
            {isPro ? (
              <button
                type="button"
                onClick={onUpgradePro}
                className="text-amber-300 hover:text-amber-200 font-semibold whitespace-nowrap"
              >
                {profile.creditsRemaining <= 0 ? 'Пополнить →' : 'PRO'}
              </button>
            ) : (
              <button
                type="button"
                onClick={onUpgradePro}
                className="text-amber-300 hover:text-amber-200 font-semibold whitespace-nowrap"
              >
                {isExpiredPro ? 'Продлить PRO →' : 'PRO →'}
              </button>
            )}
          </div>
          {isPro ? (
            <div className="space-y-0.5 text-[11px] text-slate-400">
              <div className="text-amber-300/90 font-medium">
                PRO активен · до {formatProUntilDate(profile.proUntil)}
              </div>
              <div>Спот = 1 кр. · Фьючерсы = 2 кр. · Сигналы: ∞/день</div>
            </div>
          ) : (
            <div className="space-y-0.5 text-[11px] text-slate-500">
              {isExpiredPro && (
                <div className="text-amber-400 font-medium">
                  Срок PRO истёк ({formatProUntilDate(profile.proUntil)})
                </div>
              )}
              <div>Спот = 1 кр. · Фьючерсы = 2 кр. · {FREE_DAILY_SIGNAL_LIMIT} сигн./день</div>
              <div>Сброс квоты через {formatResetCountdown(profile.nextResetAt)}</div>
            </div>
          )}
        </>
      ) : (
        <button
          type="button"
          onClick={onRequireLogin}
          className="w-full min-h-[36px] rounded-lg bg-emerald-600/20 border border-emerald-500/35 text-emerald-300 font-medium"
        >
          Войти ({FREE_WEEKLY_QUOTA} кредитов)
        </button>
      )}
    </div>
  );

  return (
    <StaggerDeck>
      {/* Horizontal Quick Search + Asset Filter Bar (no page scroll needed to search, filter & switch pairs) */}
      <motion.div
        layout="position"
        transition={NATIVE_SPRING}
        className="mb-3 rounded-2xl border border-white/8 bg-[#111827] card-surface-glow px-3 py-2.5 space-y-2.5"
      >
        {/* Instant Quick Search Bar */}
        <div className="space-y-2">
          <div className="relative flex items-center">
            <Search className="w-4 h-4 text-slate-400 pointer-events-none absolute left-3" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setSearchQuery('');
                  searchInputRef.current?.blur();
                } else if (e.key === 'Enter' && instantSearchResults.length > 0) {
                  const first = instantSearchResults[0];
                  setSymbol(first.symbol);
                  setActiveResult(null);
                }
              }}
              aria-label="Быстрый поиск монеты или категории"
              placeholder="Быстрый поиск: BTC, SOL, ADA, DOT, LINK, UNI, MATIC, DeFi, L2..."
              className="w-full min-h-[40px] rounded-xl border border-white/10 bg-[#0B0F17] pl-9 pr-28 text-xs sm:text-sm text-white placeholder:text-slate-500 focus:border-emerald-500/60 focus:outline-none transition-colors"
            />
            <div className="absolute right-2 flex items-center gap-1.5">
              <span className="hidden sm:inline font-mono tabular-nums text-[11px] text-slate-500 pr-1">
                {normalizedSearch
                  ? `${instantSearchResults.length} / ${enrichedPairs.length}`
                  : `${enrichedPairs.length} пар`}
              </span>
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    searchInputRef.current?.focus();
                  }}
                  aria-label="Очистить поиск"
                  className="min-h-[30px] min-w-[30px] rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white inline-flex items-center justify-center transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Instant Live Results as You Type */}
          <AnimatePresence initial={false}>
            {normalizedSearch.length > 0 && (
              <motion.div
                key="market-instant-search-tray"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                className="rounded-xl border border-emerald-500/25 bg-[#0B0F17] overflow-hidden"
              >
                <div className="px-3 py-1.5 border-b border-white/8 flex items-center justify-between gap-2 text-[11px] text-slate-400">
                  <span>
                    Мгновенные результаты ·{' '}
                    <strong className="font-mono text-slate-200">{instantSearchResults.length}</strong>
                  </span>
                  <span className="hidden sm:inline text-slate-500">
                    Enter — открыть первую пару · Esc — сброс
                  </span>
                </div>

                {instantSearchResults.length === 0 ? (
                  <div className="px-3 py-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                    <span>По запросу «{searchQuery.trim()}» подходящие монеты не найдены.</span>
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery('');
                        searchInputRef.current?.focus();
                      }}
                      className="text-emerald-300 hover:text-emerald-200 font-medium whitespace-nowrap"
                    >
                      Сбросить поиск
                    </button>
                  </div>
                ) : (
                  <div
                    role="list"
                    aria-label="Мгновенные результаты поиска"
                    className="max-h-[248px] overflow-y-auto divide-y divide-white/6"
                  >
                    {instantSearchResults.map((item) => {
                      const isSelected = item.symbol === symbol;
                      const alertsCount = priceAlerts.filter(
                        (a) => a.symbol === item.symbol && a.marketType === marketType && a.active
                      ).length;
                      return (
                        <div
                          key={item.symbol}
                          role="listitem"
                          className={`px-2.5 sm:px-3 py-1.5 flex items-center justify-between gap-2 transition-colors ${
                            isSelected ? 'bg-emerald-500/12' : 'hover:bg-white/[0.03]'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            <button
                              type="button"
                              onClick={() => toggleFavoriteSymbol(item.symbol)}
                              aria-label={
                                item.isFavorite
                                  ? `Убрать ${item.baseAsset} из любимых`
                                  : `Добавить ${item.baseAsset} в любимые`
                              }
                              className="min-h-[34px] min-w-[34px] rounded-lg hover:bg-white/8 text-slate-400 hover:text-amber-300 flex items-center justify-center shrink-0 transition-colors"
                            >
                              <Star
                                className={`w-3.5 h-3.5 ${
                                  item.isFavorite ? 'fill-amber-400 text-amber-300' : ''
                                }`}
                              />
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setSymbol(item.symbol);
                                setActiveResult(null);
                              }}
                              className="min-h-[38px] flex-1 min-w-0 text-left flex items-center justify-between gap-3"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="text-xs sm:text-sm font-semibold text-white truncate">
                                  {item.baseAsset}
                                  <span className="text-slate-500 font-normal"> / USDT</span>
                                  {isSelected && (
                                    <span className="ml-2 text-[11px] font-normal text-emerald-400">
                                      Открыт
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-slate-500 truncate">
                                  <span>{item.name}</span>
                                  {item.category && (
                                    <>
                                      <span aria-hidden="true"> · </span>
                                      <span className="text-slate-400">{item.category}</span>
                                    </>
                                  )}
                                  {item.isNewListing && (
                                    <>
                                      <span aria-hidden="true"> · </span>
                                      <span className="text-cyan-400">Листинг</span>
                                    </>
                                  )}
                                </div>
                              </div>

                              {visibleColumns.sparkline && (
                                <div className="shrink-0 flex items-center px-1">
                                  <MiniSparkline
                                    data={item.sparkline24h}
                                    changePct={item.change24hPct}
                                    width={60}
                                    height={22}
                                    showArea
                                  />
                                </div>
                              )}

                              {(visibleColumns.price || visibleColumns.change24h || visibleColumns.volume || visibleColumns.marketCap) && (
                                <div className="text-right font-mono tabular-nums shrink-0">
                                  {visibleColumns.price && (
                                    <div className="text-xs sm:text-sm text-slate-100 font-semibold">
                                      {item.price !== null ? formatUsd(item.price) : '—'}
                                    </div>
                                  )}
                                  <div className="flex items-center justify-end gap-1.5 text-[11px]">
                                    {visibleColumns.change24h && (
                                      <span
                                        className={`font-semibold ${
                                          (item.change24hPct ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                                        }`}
                                      >
                                        {item.change24hPct !== null
                                          ? `${item.change24hPct >= 0 ? '+' : ''}${item.change24hPct}%`
                                          : '—'}
                                      </span>
                                    )}
                                    {visibleColumns.volume && item.volume24hUsdt > 0 && (
                                      <span className="hidden sm:inline text-slate-400">
                                        V:{formatUsdAbbrev(item.volume24hUsdt)}
                                      </span>
                                    )}
                                    {visibleColumns.marketCap && item.marketCapUsdt && (
                                      <span className="hidden md:inline text-cyan-300/80">
                                        MC:{formatUsdAbbrev(item.marketCapUsdt)}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              )}
                            </button>
                          </div>

                          <button
                            type="button"
                            onClick={() => openNotifyForAsset(item)}
                            className={`min-h-[32px] px-2.5 rounded-lg border text-[11px] font-medium inline-flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors ${
                              alertsCount > 0
                                ? 'border-cyan-500/45 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/22'
                                : 'border-white/12 bg-[#111827] text-slate-200 hover:border-cyan-500/40 hover:text-cyan-200'
                            }`}
                          >
                            <BellPlus className="w-3 h-3 text-cyan-400 shrink-0" />
                            <span>Уведомить{alertsCount > 0 ? ` (${alertsCount})` : ''}</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <LayoutGroup id="market-quick-filter-group">
            <div
              role="tablist"
              aria-label="Быстрые фильтры активов"
              className="flex items-center gap-1 overflow-x-auto no-scrollbar max-w-full"
            >
              {filterMeta.map((item) => {
                const isActive = assetFilter === item.id;
                return (
                  <motion.button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    whileTap={{ scale: 0.96 }}
                    onClick={() => setAssetFilter(item.id)}
                    className={`relative min-h-[36px] px-3 rounded-xl text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                      isActive
                        ? 'text-white'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                    }`}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="market-quick-filter-pill"
                        transition={NATIVE_PILL_SPRING}
                        className="absolute inset-0 rounded-xl border border-emerald-400/40 bg-emerald-500/15"
                      />
                    )}
                    <span
                      className={`relative z-10 inline-flex shrink-0 ${
                        item.id === 'favorites' && isActive
                          ? 'text-amber-300'
                          : (item.id === 'volatile' || item.id === 'new_listings') && isActive
                            ? 'text-cyan-300'
                            : ''
                      }`}
                    >
                      {item.icon}
                    </span>
                    <span className="relative z-10">{item.label}</span>
                    <span className="relative z-10 font-mono tabular-nums text-[11px] text-slate-400">
                      {item.count}
                    </span>
                  </motion.button>
                );
              })}
            </div>
          </LayoutGroup>

          <div className="flex flex-wrap items-center gap-2">
            {/* Sort Dropdown */}
            <div className="relative inline-flex items-center">
              <ArrowUpDown
                className={`w-3.5 h-3.5 pointer-events-none absolute left-2.5 ${
                  assetSort !== 'default' ? 'text-cyan-300' : 'text-slate-400'
                }`}
              />
              <select
                aria-label="Сортировка активов"
                value={assetSort}
                onChange={(e) => setAssetSort(e.target.value as AssetSortOption)}
                className={`appearance-none min-h-[34px] pl-8 pr-7 rounded-xl border text-xs font-medium cursor-pointer transition-colors focus:outline-none ${
                  assetSort !== 'default'
                    ? 'border-cyan-500/40 bg-cyan-500/12 text-cyan-200 focus:border-cyan-400'
                    : 'border-white/10 bg-[#0B0F17] text-slate-300 hover:border-white/20 focus:border-emerald-500'
                }`}
              >
                <option value="default" className="bg-[#0B0F17] text-slate-200">
                  Сортировка: По умолчанию
                </option>
                <option value="name_asc" className="bg-[#0B0F17] text-slate-200">
                  Имя: А → Я
                </option>
                <option value="name_desc" className="bg-[#0B0F17] text-slate-200">
                  Имя: Я → А
                </option>
                <option value="price_desc" className="bg-[#0B0F17] text-slate-200">
                  Цена: по убыванию
                </option>
                <option value="price_asc" className="bg-[#0B0F17] text-slate-200">
                  Цена: по возрастанию
                </option>
                <option value="change_desc" className="bg-[#0B0F17] text-slate-200">
                  24ч %: сначала рост
                </option>
                <option value="change_asc" className="bg-[#0B0F17] text-slate-200">
                  24ч %: сначала падение
                </option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 pointer-events-none absolute right-2 text-slate-400" />
            </div>

            <button
              type="button"
              onClick={() => toggleFavoriteSymbol(symbol)}
              className={`min-h-[34px] px-2.5 rounded-xl border text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                favoriteSymbols.includes(symbol)
                  ? 'border-amber-400/40 bg-amber-500/12 text-amber-200 hover:bg-amber-500/18'
                  : 'border-white/10 bg-[#0B0F17] text-slate-300 hover:text-amber-200 hover:border-amber-400/30'
              }`}
            >
              <Star
                className={`w-3.5 h-3.5 ${
                  favoriteSymbols.includes(symbol) ? 'fill-amber-400 text-amber-300' : 'text-slate-400'
                }`}
              />
              <span>
                {favoriteSymbols.includes(symbol)
                  ? `${symbol.replace(/USDT$/, '')} в любимых`
                  : `В любимые`}
              </span>
            </button>

            <ColumnSelectorMenu columns={visibleColumns} onChange={setVisibleColumns} />

            <motion.button
              type="button"
              whileTap={{ scale: 0.94 }}
              onClick={() => void loadMarketData({ showOverviewSkeleton: true, forceRefresh: true })}
              disabled={loadingOverview || loadingChart}
              aria-label="Обновить список активов"
              title="Обновить котировки списка"
              className="min-h-[34px] min-w-[34px] rounded-xl border border-white/10 bg-[#0B0F17] text-slate-300 hover:text-white hover:border-white/20 flex items-center justify-center shrink-0 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingOverview ? 'animate-spin' : ''}`} />
            </motion.button>
          </div>
        </div>

        {/* Virtualized Horizontal Filtered Asset Strip with Framer Motion Skeleton */}
        <AnimatePresence mode="wait">
          {loadingOverview ? (
            <motion.div
              key="asset-strip-skeleton"
              variants={skeletonSwapVariants}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              <AssetStripSkeleton />
            </motion.div>
          ) : filteredPairs.length > 0 ? (
            <motion.div
              key={`asset-strip-content-${assetFilter}-${assetSort}-${normalizedSearch}`}
              variants={skeletonSwapVariants}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              <VirtualizedAssetStrip
                items={filteredPairs}
                selectedSymbol={symbol}
                marketType={marketType}
                priceAlerts={priceAlerts}
                visibleColumns={visibleColumns}
                onSelectSymbol={(nextSymbol) => {
                  setSymbol(nextSymbol);
                  setActiveResult(null);
                }}
                onToggleFavorite={toggleFavoriteSymbol}
                onNotifyAsset={openNotifyForAsset}
              />
            </motion.div>
          ) : (
            <motion.div
              key="asset-strip-empty"
              variants={skeletonSwapVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/8 bg-[#0B0F17] px-3 py-2 text-xs text-slate-400"
            >
              <span>
                {normalizedSearch
                  ? `В текущей вкладке фильтра по запросу «${searchQuery.trim()}» совпадений нет.`
                  : 'Список «Любимые» пуст — отметьте звёздочкой нужные активы.'}
              </span>
              <button
                type="button"
                onClick={() => {
                  if (normalizedSearch && assetFilter !== 'all') {
                    setAssetFilter('all');
                  } else if (normalizedSearch) {
                    setSearchQuery('');
                  } else {
                    setAssetFilter('all');
                  }
                }}
                className="text-emerald-300 hover:text-emerald-200 font-medium whitespace-nowrap"
              >
                {normalizedSearch && assetFilter === 'all' ? 'Сбросить поиск →' : 'Показать все →'}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <WorkspaceShell
        title="Рынок и терминал"
        subtitle={activeTicker ? `${activeTicker.baseAsset}/USDT · ${formatUsd(activeTicker.price)}` : symbol}
        icon={
          <img
            src="/src/assets/images/terminal_icon_chart_1794855841231.jpg"
            alt="Рынок AegisQuant"
            referrerPolicy="no-referrer"
            className="w-8 h-8 rounded-lg object-cover border border-emerald-500/25"
          />
        }
        items={menuItems}
        activeId={marketSection}
        onChange={setMarketSection}
        layoutId="market-workspace-nav"
        accent="emerald"
        sidebarTopSlot={sidebarControls}
        sidebarBottomSlot={sidebarBottom}
      >
        {marketSection === 'chart' && (
          <div className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-4 sm:p-5">
            {/* Asset Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/8">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  <span>{marketType === 'futures' ? 'Фьючерсы USDT-M' : 'Спот'}</span>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1.5">
                    {dataSource === 'live' && <span className="live-dot" aria-hidden="true" />}
                    {dataSource === 'live' ? 'Живой поток' : 'Резерв'}
                    {lastMarketUpdatedAt && (
                      <span className="font-mono text-[11px] text-slate-500">
                        {new Date(lastMarketUpdatedAt).toLocaleTimeString('ru-RU', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </span>
                    )}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">{timeframe.toUpperCase()}</span>
                </div>
                <div className="mt-0.5 flex items-baseline gap-2.5">
                  <h2 className="text-xl sm:text-2xl font-bold text-white font-mono tabular-nums">
                    {indicators ? formatUsd(indicators.lastPrice) : activeTicker ? formatUsd(activeTicker.price) : '—'}
                  </h2>
                  {activeTicker && (
                    <span
                      className={`inline-flex items-center gap-1 text-xs sm:text-sm font-mono font-semibold tabular-nums ${
                        activeTicker.change24hPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {activeTicker.change24hPct >= 0 ? (
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      ) : (
                        <ArrowDownRight className="w-3.5 h-3.5" />
                      )}
                      {activeTicker.change24hPct >= 0 ? '+' : ''}
                      {activeTicker.change24hPct}%
                    </span>
                  )}
                </div>
              </div>

              {/* Compact Chart Layer Controls */}
              <div className="flex flex-wrap items-center gap-1.5" data-tour-id="tour-ma-ribbon">
                <button
                  type="button"
                  onClick={() => setShowRibbon((v) => !v)}
                  className={`min-h-[34px] px-2.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
                    showRibbon
                      ? 'border-cyan-500/45 bg-cyan-500/12 text-cyan-200'
                      : 'border-white/10 bg-white/5 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Ribbon
                </button>
                {showRibbon && (
                  <button
                    type="button"
                    onClick={() => setShowRibbonSettings((v) => !v)}
                    aria-label="Настроить периоды MA Ribbon"
                    className={`min-h-[34px] px-2.5 rounded-lg text-xs font-medium border transition-colors inline-flex items-center gap-1 whitespace-nowrap ${
                      showRibbonSettings
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                        : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                    }`}
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Периоды</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowEma((v) => !v)}
                  className={`min-h-[34px] px-2.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
                    showEma
                      ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                      : 'border-white/10 bg-white/5 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  EMA
                </button>
                <button
                  type="button"
                  onClick={() => setShowBollinger((v) => !v)}
                  className={`min-h-[34px] px-2.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
                    showBollinger
                      ? 'border-sky-500/40 bg-sky-500/10 text-sky-300'
                      : 'border-white/10 bg-white/5 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  BB
                </button>
                <button
                  type="button"
                  onClick={() => setShowQuickAlert((v) => !v)}
                  className={`min-h-[34px] px-2.5 rounded-lg text-xs font-medium border transition-colors inline-flex items-center gap-1 whitespace-nowrap ${
                    showQuickAlert || activePairAlertsCount > 0
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                      : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                  }`}
                >
                  <BellPlus className="w-3.5 h-3.5" />
                  <span>Алерт{activePairAlertsCount > 0 ? ` (${activePairAlertsCount})` : ''}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMarketSection('ai')}
                  className="min-h-[34px] px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap transition-colors"
                >
                  <Bot className="w-3.5 h-3.5" />
                  <span>AI-анализ</span>
                </button>
                <button
                  type="button"
                  onClick={() => void loadMarketData({ showOverviewSkeleton: true, forceRefresh: true })}
                  disabled={loadingChart}
                  className="min-h-[34px] min-w-[34px] px-2 rounded-lg border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 flex items-center justify-center transition-colors"
                  aria-label="Обновить график"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingChart ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {/* Collapsible MA Ribbon Configurator */}
            <AnimatePresence>
              {showRibbon && showRibbonSettings && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.18 }}
                  className="overflow-hidden"
                >
                  <div className="mt-3 rounded-xl border border-cyan-500/20 bg-[#0B0F17]/90 p-3 space-y-2.5">
                    {!isPro && (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs">
                        <span className="text-amber-200 inline-flex items-center gap-1.5">
                          <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          <span>
                            На тарифе Free активна стандартная лента EMA 8·13·21·55. Кастомные периоды и SMA — в PRO.
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={onUpgradePro}
                          className="text-amber-300 hover:text-amber-200 font-semibold whitespace-nowrap inline-flex items-center gap-1"
                        >
                          <Crown className="w-3.5 h-3.5" />
                          <span>Открыть PRO</span>
                        </button>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="inline-flex p-0.5 rounded-lg bg-[#111827] border border-white/8 text-xs">
                        {(['EMA', 'SMA'] as RibbonType[]).map((typeOption) => (
                          <button
                            key={typeOption}
                            type="button"
                            onClick={() => {
                              if (!isPro) {
                                onUpgradePro();
                                return;
                              }
                              setRibbonType(typeOption);
                            }}
                            className={`min-h-[28px] px-3 rounded-md font-mono font-semibold transition-colors ${
                              ribbonType === typeOption
                                ? 'bg-cyan-500 text-slate-950'
                                : 'text-slate-400 hover:text-slate-200'
                            } ${!isPro && typeOption !== ribbonType ? 'opacity-60' : ''}`}
                          >
                            {typeOption}
                          </button>
                        ))}
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        {RIBBON_PRESETS.map((preset) => {
                          const isSame =
                            ribbonType === preset.type &&
                            preset.periods.every((p, idx) => p === ribbonPeriods[idx]);
                          return (
                            <button
                              key={preset.id}
                              type="button"
                              onClick={() => {
                                if (!isPro) {
                                  onUpgradePro();
                                  return;
                                }
                                setRibbonType(preset.type);
                                setRibbonPeriods(preset.periods);
                              }}
                              className={`min-h-[30px] px-2.5 rounded-lg text-[11px] font-medium border transition-colors whitespace-nowrap ${
                                isSame
                                  ? 'border-emerald-500/45 bg-emerald-500/15 text-emerald-300'
                                  : 'border-white/8 bg-white/5 text-slate-300 hover:bg-white/10'
                              } ${!isPro && !isSame ? 'opacity-65' : ''}`}
                            >
                              {preset.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {([0, 1, 2, 3] as const).map((idx) => (
                        <label
                          key={idx}
                          className="flex items-center justify-between gap-2 rounded-lg border border-white/8 bg-[#111827] px-2.5 py-1 text-xs"
                        >
                          <span className="flex items-center gap-1.5 text-slate-400 whitespace-nowrap">
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: RIBBON_SWATCHES[idx] }}
                            />
                            <span>{ribbonType} {idx + 1}</span>
                          </span>
                          <input
                            type="number"
                            min={2}
                            max={200}
                            disabled={!isPro}
                            aria-label={`Период ${ribbonType} ${idx + 1}`}
                            value={ribbonPeriods[idx]}
                            onChange={(e) => handleUpdateRibbonPeriod(idx, Number(e.target.value))}
                            className="w-14 rounded-md border border-white/10 bg-[#0B0F17] px-1.5 py-0.5 text-right font-mono text-xs text-white focus:border-cyan-400 focus:outline-none disabled:opacity-55"
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Candlestick Chart */}
            <div className="mt-3">
              <CandlestickChart
                candles={candles}
                symbol={symbol}
                showEma={showEma}
                showBollinger={showBollinger}
                showRibbon={showRibbon}
                ribbonType={ribbonType}
                ribbonPeriods={ribbonPeriods}
                entryLevel={entryOverlay}
                stopLossLevel={slOverlay}
                takeProfitLevel={tpOverlay}
                priceAlerts={priceAlerts.filter((a) => a.symbol === symbol && a.marketType === marketType)}
                draftAlertPrice={draftAlertPrice}
                onPickPriceFromChart={(picked) => {
                  setDraftAlertPrice(picked);
                  setShowQuickAlert(true);
                }}
              />
            </div>

            {/* Collapsible Quick Price Alert Widget */}
            <AnimatePresence>
              {showQuickAlert && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <ChartQuickAlertWidget
                    symbol={symbol}
                    marketType={marketType}
                    currentPrice={indicators?.lastPrice ?? activeTicker?.price ?? 0}
                    draftPrice={draftAlertPrice}
                    onDraftPriceChange={setDraftAlertPrice}
                    alerts={priceAlerts}
                    isSignedIn={isSignedIn}
                    pushSubscribed={pushSubscribed}
                    onRequireLogin={onRequireLogin}
                    onOpenPushSettings={onOpenPushSettings}
                    onCreateAlert={onCreatePriceAlert}
                    onToggleAlert={onTogglePriceAlert}
                    onDeleteAlert={onDeletePriceAlert}
                    onCheckNow={onCheckPriceAlertsNow}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Quantitative Telemetry Strip */}
            {indicators && (
              <div className="mt-3 pt-3 border-t border-white/8 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div
                  key={`tel-trend-${symbol}-${timeframe}-${telemetryAnimVersion}`}
                  style={{ '--stagger-idx': 0 } as React.CSSProperties}
                  className="signal-card-enter signal-card-stagger rounded-xl bg-[#0B0F17]/70 border border-white/6 px-3 py-2"
                >
                  <div className="text-slate-400">Тренд</div>
                  <div
                    className={`mt-0.5 font-semibold font-mono ${
                      indicators.trendBias === 'BULLISH'
                        ? 'text-emerald-400'
                        : indicators.trendBias === 'BEARISH'
                          ? 'text-rose-400'
                          : 'text-amber-300'
                    }`}
                  >
                    {indicators.trendBias === 'BULLISH'
                      ? 'Восходящий'
                      : indicators.trendBias === 'BEARISH'
                        ? 'Нисходящий'
                        : 'Боковик'}
                  </div>
                </div>
                <div
                  key={`tel-rsi-${symbol}-${timeframe}-${telemetryAnimVersion}`}
                  style={{ '--stagger-idx': 1 } as React.CSSProperties}
                  className="signal-card-enter signal-card-stagger rounded-xl bg-[#0B0F17]/70 border border-white/6 px-3 py-2"
                >
                  <div className="text-slate-400">RSI (14) / ATR%</div>
                  <div className="mt-0.5 font-mono tabular-nums text-white font-semibold">
                    {indicators.rsi14.toFixed(1)} · {indicators.volatilityPct}%
                  </div>
                </div>
                <div
                  key={`tel-sr-${symbol}-${timeframe}-${telemetryAnimVersion}`}
                  style={{ '--stagger-idx': 2 } as React.CSSProperties}
                  className="signal-card-enter signal-card-stagger rounded-xl bg-[#0B0F17]/70 border border-white/6 px-3 py-2"
                >
                  <div className="text-slate-400">Поддержка / Сопр.</div>
                  <div className="mt-0.5 font-mono tabular-nums text-slate-200">
                    {formatUsd(indicators.supportLevel)} / {formatUsd(indicators.resistanceLevel)}
                  </div>
                </div>
                <div
                  key={`tel-fund-${symbol}-${timeframe}-${telemetryAnimVersion}`}
                  style={{ '--stagger-idx': 3 } as React.CSSProperties}
                  className="signal-card-enter signal-card-stagger rounded-xl bg-[#0B0F17]/70 border border-white/6 px-3 py-2"
                >
                  <div className="text-slate-400">
                    {marketType === 'futures' ? 'Funding / OI' : 'MACD'}
                  </div>
                  <div className="mt-0.5 font-mono tabular-nums text-slate-200">
                    {marketType === 'futures'
                      ? `${fundingRatePct ?? 0.01}% · $${((openInterestUsdt ?? 0) / 1_000_000).toFixed(0)}M`
                      : `${indicators.macdHistogram >= 0 ? '+' : ''}${indicators.macdHistogram.toFixed(3)}`}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {marketSection === 'ai' && (
          <div
            data-tour-id="tour-market-ai"
            className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-5 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/8">
              <div>
                <h3 className="text-base font-semibold text-white">
                  AI-анализ стратегии · {symbol} ({marketType === 'futures' ? 'Фьючерсы' : 'Спот'}, {timeframe.toUpperCase()})
                </h3>
                <p className="mt-0.5 text-xs text-slate-400">
                  Совмещает свечные индикаторы, новостной фон и расчёт риск-менеджмента.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMarketSection('chart')}
                className="text-xs font-medium text-cyan-300 hover:text-cyan-200"
              >
                Открыть график →
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              {/* Left Form */}
              <div className="lg:col-span-6 space-y-4">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="strategy-select" className="block text-xs font-medium text-slate-300">
                      Стратегия
                    </label>
                    <span className="text-[11px] font-mono tabular-nums text-slate-400">
                      {isPro
                        ? `PRO (${profile?.creditsRemaining ?? 0}/${PRO_MONTHLY_QUOTA} кр.) · ${requiredCredits} кр./анализ`
                        : `Стоимость: ${requiredCredits} ${requiredCredits === 1 ? 'кредит' : 'кредита'} · Сигналов сегодня: ${todayStrategySignalsUsed}/${FREE_DAILY_SIGNAL_LIMIT}`}
                    </span>
                  </div>
                  <select
                    id="strategy-select"
                    value={activeStrategy?.key || ''}
                    onChange={(e) => {
                      const found = filteredStrategies.find((s) => s.key === e.target.value);
                      if (found) {
                        setStrategyKey(found.key);
                        setLeverage(
                          found.marketType === 'spot'
                            ? 1
                            : isPro
                              ? found.defaultLeverage
                              : Math.min(FREE_MAX_LEVERAGE, found.defaultLeverage)
                        );
                        setRiskPct(found.defaultRiskPct);
                      }
                    }}
                    className="w-full min-h-[42px] rounded-xl border border-white/10 bg-[#0B0F17] px-3 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  >
                    {filteredStrategies.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.tier === 'pro' && !isPro ? '[PRO] ' : ''}
                        {s.name} ({s.riskProfile})
                      </option>
                    ))}
                  </select>
                  {activeStrategy && (
                    <p className="text-xs text-slate-400 leading-relaxed">
                      {activeStrategy.rulesSummary}{' '}
                      <span className="text-slate-500">· Горизонт: {activeStrategy.expectedHorizon}.</span>
                    </p>
                  )}
                  {isExpiredPro && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                      <span>
                        Срок подписки PRO истёк ({formatProUntilDate(profile?.proUntil)}). Активны ограничения Free.
                      </span>
                      <button
                        type="button"
                        onClick={onUpgradePro}
                        className="font-semibold text-amber-300 hover:underline whitespace-nowrap"
                      >
                        Продлить PRO →
                      </button>
                    </div>
                  )}
                  {isSelectedStrategyLocked && (
                    <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                      <span className="inline-flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span>Алгоритм «{activeStrategy?.name}» доступен только в PRO-подписке.</span>
                      </span>
                      <button
                        type="button"
                        onClick={onUpgradePro}
                        className="font-semibold text-amber-300 hover:underline whitespace-nowrap"
                      >
                        Открыть PRO →
                      </button>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="deposit-input" className="block text-xs text-slate-400 mb-1">
                      Депозит (USDT)
                    </label>
                    <input
                      id="deposit-input"
                      type="number"
                      min={10}
                      max={10000000}
                      value={depositUsdt}
                      onChange={(e) => setDepositUsdt(Math.max(10, Number(e.target.value)))}
                      className="w-full min-h-[40px] rounded-xl border border-white/10 bg-[#0B0F17] px-3 text-sm font-mono text-white focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="risk-input" className="block text-xs text-slate-400 mb-1">
                      Риск на сделку (%)
                    </label>
                    <input
                      id="risk-input"
                      type="number"
                      step="0.25"
                      min={0.25}
                      max={10}
                      value={riskPct}
                      onChange={(e) => setRiskPct(Math.min(10, Math.max(0.25, Number(e.target.value))))}
                      className="w-full min-h-[40px] rounded-xl border border-white/10 bg-[#0B0F17] px-3 text-sm font-mono text-white focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                </div>

                {marketType === 'futures' && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">
                        Кредитное плечо (Futures){!isPro ? ` · Free до ${FREE_MAX_LEVERAGE}x` : ''}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold text-amber-400">{leverage}x</span>
                        {!isPro && (
                          <button
                            type="button"
                            onClick={onUpgradePro}
                            className="text-[11px] font-medium text-amber-300 hover:underline"
                          >
                            PRO до 20x
                          </button>
                        )}
                      </div>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={isPro ? 20 : FREE_MAX_LEVERAGE}
                      value={Math.min(isPro ? 20 : FREE_MAX_LEVERAGE, leverage)}
                      onChange={(e) => setLeverage(Number(e.target.value))}
                      className="w-full accent-amber-500"
                    />
                  </div>
                )}

                {analysisError && !hasReachedCreditsLimit && !hasReachedFreeDailyLimit && (
                  <div className="flex items-start gap-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{analysisError}</span>
                  </div>
                )}

                {isSelectedStrategyLocked ? (
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.98 }}
                    onClick={onUpgradePro}
                    className="cta-shimmer w-full min-h-[46px] rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-semibold flex items-center justify-center gap-2 transition-colors shadow-md"
                  >
                    <Crown className="w-4 h-4" />
                    <span>Открыть стратегию в PRO</span>
                  </motion.button>
                ) : hasReachedCreditsLimit ? (
                  <div className="space-y-3 rounded-xl border border-amber-500/35 bg-amber-500/10 p-3.5">
                    <div className="flex items-start gap-2.5 text-xs text-amber-100 leading-relaxed">
                      <Crown className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <div className="font-semibold text-amber-200">
                          {isPro
                            ? `Месячный пакет кредитов PRO исчерпан (${profile?.creditsRemaining ?? 0}/${PRO_MONTHLY_QUOTA})`
                            : `Лимит бесплатных кредитов достигнут (${profile?.creditsRemaining ?? 0}/${totalCreditQuota})`}
                        </div>
                        <p className="text-amber-200/80">
                          {isPro
                            ? `Для запуска анализа требуется ${requiredCredits} кр. Продлите подписку PRO, чтобы сразу пополнить +${PRO_MONTHLY_QUOTA} кредитов.`
                            : `Для этой операции нужно ${requiredCredits} кр. Перейдите на PRO: получите ${PRO_MONTHLY_QUOTA} кредитов в месяц, все ${STRATEGY_CATALOG.length} стратегий и снятие ограничений на количество сигналов в день.`}
                        </p>
                      </div>
                    </div>
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.98 }}
                      onClick={onUpgradePro}
                      className="cta-shimmer w-full min-h-[46px] rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-semibold flex items-center justify-center gap-2 transition-colors shadow-md"
                    >
                      <Crown className="w-4 h-4" />
                      <span>
                        {isPro ? `Продлить PRO (+${PRO_MONTHLY_QUOTA} кр.)` : `Перейти на PRO (${PRO_MONTHLY_QUOTA} кр./мес.)`}
                      </span>
                    </motion.button>
                  </div>
                ) : hasReachedFreeDailyLimit ? (
                  <div className="space-y-3 rounded-xl border border-amber-500/35 bg-amber-500/10 p-3.5">
                    <div className="flex items-start gap-2.5 text-xs text-amber-100 leading-relaxed">
                      <Crown className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <div className="font-semibold text-amber-200">
                          Дневной лимит Free исчерпан ({todayStrategySignalsUsed}/{FREE_DAILY_SIGNAL_LIMIT} сегодня)
                        </div>
                        <p className="text-amber-200/80">
                          На бесплатном тарифе доступен 1 сигнал в сутки по каждой стратегии. Оформите PRO, чтобы снять дневной лимит сигналов и получить {PRO_MONTHLY_QUOTA} кредитов/мес.
                        </p>
                      </div>
                    </div>
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.98 }}
                      onClick={onUpgradePro}
                      className="cta-shimmer w-full min-h-[46px] rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-semibold flex items-center justify-center gap-2 transition-colors shadow-md"
                    >
                      <Crown className="w-4 h-4" />
                      <span>Перейти на PRO · Снять дневной лимит</span>
                    </motion.button>
                  </div>
                ) : (
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.98 }}
                    onClick={() => void handleRunAnalysis()}
                    disabled={analyzing}
                    className="w-full min-h-[46px] rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:from-emerald-500 hover:via-teal-500 hover:to-cyan-500 disabled:opacity-60 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all shadow-md shadow-emerald-950/50"
                  >
                    <Activity className={`w-4 h-4 ${analyzing ? 'animate-spin' : ''}`} />
                    <span>
                      {analyzing
                        ? 'Анализируем график и новости...'
                        : isPro
                          ? `Запустить PRO-анализ (${requiredCredits} кр.)`
                          : `Проверить рынок (${requiredCredits} ${requiredCredits === 1 ? 'кредит' : 'кредита'})`}
                    </span>
                  </motion.button>
                )}
              </div>

              {/* Right Verdict */}
              <div className="lg:col-span-6">
                {activeResult ? (
                  <div
                    key={`verdict-${symbol}-${signalAnimVersion}`}
                    className="signal-card-enter rounded-xl bg-[#0B0F17] border border-white/10 p-4 space-y-3.5"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs text-slate-400">Вердикт стратегии</div>
                        <div
                          className={`mt-0.5 text-xl font-bold font-mono ${
                            activeResult.direction === 'LONG'
                              ? 'text-emerald-400'
                              : activeResult.direction === 'SHORT'
                                ? 'text-rose-400'
                                : 'text-amber-300'
                          }`}
                        >
                          {activeResult.direction === 'LONG'
                            ? 'LONG · Покупка'
                            : activeResult.direction === 'SHORT'
                              ? 'SHORT · Продажа'
                              : 'WAIT · Ожидание'}
                        </div>
                      </div>
                      <div className="text-right font-mono tabular-nums">
                        <div className="text-xs text-slate-400">Уверенность</div>
                        <div className="text-lg font-bold text-white">{activeResult.confidence}%</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5 text-xs font-mono tabular-nums">
                      <div
                        style={{ '--stagger-idx': 0 } as React.CSSProperties}
                        className="signal-card-enter signal-card-stagger rounded-xl bg-[#111827] border border-white/8 p-2.5"
                      >
                        <div className="font-sans text-slate-400">Зона входа</div>
                        <div className="mt-1 text-white font-semibold">{activeResult.entryZone}</div>
                      </div>
                      <div
                        style={{ '--stagger-idx': 1 } as React.CSSProperties}
                        className="signal-card-enter signal-card-stagger rounded-xl bg-[#111827] border border-white/8 p-2.5"
                      >
                        <div className="font-sans text-slate-400">Stop-Loss</div>
                        <div className="mt-1 text-rose-400 font-semibold">{activeResult.stopLoss}</div>
                      </div>
                      <div
                        style={{ '--stagger-idx': 2 } as React.CSSProperties}
                        className="signal-card-enter signal-card-stagger rounded-xl bg-[#111827] border border-white/8 p-2.5"
                      >
                        <div className="font-sans text-slate-400">Цели Take-Profit</div>
                        <div className="mt-1 text-emerald-400 font-semibold">
                          {activeResult.takeProfits.join(' / ')}
                        </div>
                      </div>
                      <div
                        style={{ '--stagger-idx': 3 } as React.CSSProperties}
                        className="signal-card-enter signal-card-stagger rounded-xl bg-[#111827] border border-white/8 p-2.5"
                      >
                        <div className="font-sans text-slate-400">Риск / Прибыль</div>
                        <div className="mt-1 text-amber-300 font-semibold">{activeResult.riskReward}</div>
                      </div>
                    </div>

                    <div
                      style={{ '--stagger-idx': 4 } as React.CSSProperties}
                      className="signal-card-enter signal-card-stagger rounded-xl bg-[#111827] border border-white/8 p-3 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between text-slate-300">
                        <span>Объем позиции:</span>
                        <strong className="font-mono text-white">${activeResult.riskMetrics.positionSizeUsdt} USDT</strong>
                      </div>
                      <div className="flex items-center justify-between text-slate-400">
                        <span>Допустимый убыток ({riskPct}%):</span>
                        <span className="font-mono text-rose-300">-${activeResult.riskMetrics.riskAmountUsdt} USDT</span>
                      </div>
                      {activeResult.riskMetrics.estimatedLiquidationPrice && (
                        <div className="flex items-center justify-between text-amber-300">
                          <span className="inline-flex items-center gap-1">
                            <ShieldAlert className="w-3.5 h-3.5" />
                            Ликвидация ({activeResult.riskMetrics.recommendedLeverage}x):
                          </span>
                          <strong className="font-mono">{activeResult.riskMetrics.estimatedLiquidationPrice}</strong>
                        </div>
                      )}
                    </div>

                    <div className="text-xs text-slate-300 leading-relaxed">{activeResult.summary}</div>
                    <div className="text-xs text-slate-400 border-t border-white/8 pt-2.5">
                      <strong className="text-slate-200">Условие отмены: </strong>
                      {activeResult.invalidationRule}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl bg-[#0B0F17] border border-white/8 p-6 text-center space-y-2">
                    <Bot className="w-8 h-8 text-cyan-400 mx-auto" />
                    <div className="text-sm font-medium text-white">Готово к анализу {symbol}</div>
                    <p className="text-xs text-slate-400">
                      Выберите стратегию слева и нажмите кнопку запуска — уровни входа, Stop-Loss и Take-Profit также отобразятся прямо на свечном графике.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {marketSection === 'depth' && (
          <OrderBookPanel
            symbol={symbol}
            marketType={marketType}
            isPro={isPro}
            onUpgradePro={onUpgradePro}
          />
        )}

        {marketSection === 'oscillators' && (
          <AnimatePresence mode="wait">
            {!indicators || loadingChart ? (
              <motion.div
                key="osc-skeleton"
                variants={skeletonSwapVariants}
                initial="initial"
                animate="animate"
                exit="exit"
              >
                <OscillatorsSkeleton />
              </motion.div>
            ) : (
              <motion.div
                key={`osc-content-${symbol}-${timeframe}`}
                variants={skeletonSwapVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-5 space-y-4"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Gauge className="w-4 h-4 text-emerald-400" />
                    <span>Матрица осцилляторов и ключевых уровней ({symbol})</span>
                  </h3>
                  <span className="text-xs text-slate-400 font-mono">{timeframe.toUpperCase()}</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                  <div
                    key={`osc-rsi-${symbol}-${timeframe}-${telemetryAnimVersion}`}
                    style={{ '--stagger-idx': 0 } as React.CSSProperties}
                    className="signal-card-enter signal-card-stagger rounded-xl bg-[#0B0F17] border border-white/8 p-4 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Индекс RSI (14)</span>
                      <span
                        className={`font-mono font-bold ${
                          indicators.rsi14 >= 70
                            ? 'text-rose-400'
                            : indicators.rsi14 <= 30
                              ? 'text-emerald-400'
                              : 'text-cyan-300'
                        }`}
                      >
                        {indicators.rsi14.toFixed(1)}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-white/8 overflow-hidden relative">
                      <motion.div
                        initial={false}
                        animate={{ width: `${Math.min(100, Math.max(4, indicators.rsi14))}%` }}
                        transition={{ duration: 0.35 }}
                        className={`h-full rounded-full ${
                          indicators.rsi14 >= 70
                            ? 'bg-rose-500'
                            : indicators.rsi14 <= 30
                              ? 'bg-emerald-500'
                              : 'bg-gradient-to-r from-emerald-400 via-cyan-400 to-amber-400'
                        }`}
                      />
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {indicators.rsi14 >= 70
                        ? 'Зона перекупленности (риск коррекции)'
                        : indicators.rsi14 <= 30
                          ? 'Зона перепроданности (поиск отскока)'
                          : 'Нейтральный импульс (30–70)'}
                    </div>
                  </div>

                  <div
                    key={`osc-bb-${symbol}-${timeframe}-${telemetryAnimVersion}`}
                    style={{ '--stagger-idx': 1 } as React.CSSProperties}
                    className="signal-card-enter signal-card-stagger rounded-xl bg-[#0B0F17] border border-white/8 p-4 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Позиция в Bollinger %B</span>
                      <span className="font-mono font-bold text-slate-100">{bbPercentB}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-white/8 overflow-hidden">
                      <motion.div
                        initial={false}
                        animate={{ width: `${Math.max(4, bbPercentB)}%` }}
                        transition={{ duration: 0.35 }}
                        className="h-full rounded-full bg-gradient-to-r from-sky-500 to-indigo-400"
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-mono text-slate-500">
                      <span>Ниж. {formatUsd(indicators.bbLower)}</span>
                      <span>Верх. {formatUsd(indicators.bbUpper)}</span>
                    </div>
                  </div>

                  <div
                    key={`osc-ema-${symbol}-${timeframe}-${telemetryAnimVersion}`}
                    style={{ '--stagger-idx': 2 } as React.CSSProperties}
                    className="signal-card-enter signal-card-stagger rounded-xl bg-[#0B0F17] border border-white/8 p-4 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Дистанция до EMA(200)</span>
                      <span
                        className={`font-mono font-bold ${
                          ema200DeltaPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {ema200DeltaPct >= 0 ? '+' : ''}
                        {ema200DeltaPct}%
                      </span>
                    </div>
                    <div className="text-xs font-mono text-slate-200">EMA 200: {formatUsd(indicators.ema200)}</div>
                    <div className="text-[11px] text-slate-500">
                      {ema200DeltaPct >= 0
                        ? 'Цена выше долгосрочного тренда EMA 200'
                        : 'Цена под давлением долгосрочной EMA 200'}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}

        {marketSection === 'sentiment' && (
          <div className="space-y-3">
            {/* Compact Switcher so Fear & Greed vs Dominance don't stack vertically */}
            <div className="inline-flex items-center p-1 rounded-xl bg-[#111827] border border-white/8">
              <button
                type="button"
                onClick={() => setSentimentSub('fear')}
                className={`min-h-[36px] px-3.5 rounded-lg text-xs font-medium transition-colors ${
                  sentimentSub === 'fear' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Индекс страха и жадности
              </button>
              <button
                type="button"
                onClick={() => setSentimentSub('dominance')}
                className={`min-h-[36px] px-3.5 rounded-lg text-xs font-medium transition-colors ${
                  sentimentSub === 'dominance' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Рыночное доминирование (BTC/ETH)
              </button>
            </div>

            {sentimentSub === 'fear' ? (
              <FearGreedWidget />
            ) : (
              <MarketDominanceWidget
                tickers={tickers}
                marketType={marketType}
                selectedSymbol={symbol}
                onSelectSymbol={(nextSym) => {
                  setSymbol(nextSym);
                  setActiveResult(null);
                  setMarketSection('chart');
                }}
              />
            )}
          </div>
        )}

        {marketSection === 'pairs' && (
          <div className="space-y-3">
            <div className="inline-flex items-center p-1 rounded-xl bg-[#111827] border border-white/8">
              <button
                type="button"
                onClick={() => setPairsSub('list')}
                className={`min-h-[36px] px-3.5 rounded-lg text-xs font-medium transition-colors ${
                  pairsSub === 'list' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Обзор пар ({filteredPairs.length})
              </button>
              <button
                type="button"
                onClick={() => setPairsSub('history')}
                className={`min-h-[36px] px-3.5 rounded-lg text-xs font-medium transition-colors ${
                  pairsSub === 'history' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                История сигналов ({analyses.length})
              </button>
            </div>

            {pairsSub === 'list' ? (
              <div className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow overflow-hidden">
                <div className="px-4 sm:px-5 py-3 border-b border-white/8 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-white">
                      {filterMeta.find((f) => f.id === assetFilter)?.label ?? 'Ликвидные пары'} ·{' '}
                      {marketType === 'futures' ? 'Фьючерсы' : 'Спот'} ({filteredPairs.length})
                    </h3>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-slate-400 hidden sm:inline">Клик откроет график</span>
                      <ColumnSelectorMenu columns={visibleColumns} onChange={setVisibleColumns} />
                      <motion.button
                        type="button"
                        whileTap={{ scale: 0.94 }}
                        onClick={() => void loadMarketData({ showOverviewSkeleton: true, forceRefresh: true })}
                        disabled={loadingOverview}
                        aria-label="Обновить таблицу пар"
                        className="min-h-[34px] px-2.5 rounded-xl border border-white/10 bg-[#0B0F17] text-xs text-slate-300 hover:text-white inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3 h-3 ${loadingOverview ? 'animate-spin' : ''}`} />
                        <span>Обновить</span>
                      </motion.button>
                    </div>
                  </div>

                  {/* Quick Filters Bar directly above the pairs list */}
                  <LayoutGroup id="market-pairs-quick-filter-group">
                    <div
                      role="tablist"
                      aria-label="Быстрые фильтры списка пар"
                      className="flex items-center gap-1 overflow-x-auto no-scrollbar"
                    >
                      {filterMeta.map((item) => {
                        const isActive = assetFilter === item.id;
                        return (
                          <motion.button
                            key={item.id}
                            type="button"
                            role="tab"
                            aria-selected={isActive}
                            whileTap={{ scale: 0.96 }}
                            onClick={() => setAssetFilter(item.id)}
                            className={`relative min-h-[34px] px-2.5 rounded-xl text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                              isActive
                                ? 'text-white'
                                : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                            }`}
                          >
                            {isActive && (
                              <motion.span
                                layoutId="market-pairs-quick-filter-pill"
                                transition={NATIVE_PILL_SPRING}
                                className="absolute inset-0 rounded-xl border border-emerald-400/40 bg-emerald-500/15"
                              />
                            )}
                            <span
                              className={`relative z-10 inline-flex shrink-0 ${
                                item.id === 'favorites' && isActive
                                  ? 'text-amber-300'
                                  : item.id === 'volatile' || item.id === 'new_listings'
                                    ? isActive
                                      ? 'text-cyan-300'
                                      : ''
                                    : ''
                              }`}
                            >
                              {item.icon}
                            </span>
                            <span className="relative z-10">{item.label}</span>
                            <span className="relative z-10 font-mono tabular-nums text-[11px] text-slate-400">
                              {item.count}
                            </span>
                          </motion.button>
                        );
                      })}
                    </div>
                  </LayoutGroup>
                </div>

                <AnimatePresence mode="wait">
                  {loadingOverview ? (
                    <motion.div
                      key="pairs-list-skeleton"
                      variants={skeletonSwapVariants}
                      initial="initial"
                      animate="animate"
                      exit="exit"
                    >
                      <PairsListSkeleton />
                    </motion.div>
                  ) : filteredPairs.length === 0 ? (
                    <motion.div
                      key="pairs-list-empty"
                      variants={skeletonSwapVariants}
                      initial="initial"
                      animate="animate"
                      exit="exit"
                      className="p-6 text-center space-y-2"
                    >
                      <p className="text-xs text-slate-400">
                        {normalizedSearch
                          ? `По запросу «${searchQuery.trim()}» в этой категории активы не найдены.`
                          : 'В категории «Любимые» пока нет выбранных активов.'}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          if (normalizedSearch && assetFilter === 'all') {
                            setSearchQuery('');
                          } else {
                            setAssetFilter('all');
                          }
                        }}
                        className="min-h-[36px] px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors"
                      >
                        {normalizedSearch && assetFilter === 'all' ? 'Сбросить поиск' : 'Показать все пары'}
                      </button>
                    </motion.div>
                  ) : (
                    <motion.div
                      key={`pairs-list-content-${assetFilter}-${assetSort}-${marketType}-${normalizedSearch}`}
                      variants={skeletonSwapVariants}
                      initial="initial"
                      animate="animate"
                      exit="exit"
                    >
                      <VirtualizedPairsList
                        items={filteredPairs}
                        selectedSymbol={symbol}
                        marketType={marketType}
                        priceAlerts={priceAlerts}
                        visibleColumns={visibleColumns}
                        onOpenChart={(nextSymbol) => {
                          setSymbol(nextSymbol);
                          setActiveResult(null);
                          setMarketSection('chart');
                        }}
                        onToggleFavorite={toggleFavoriteSymbol}
                        onNotifyAsset={openNotifyForAsset}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ) : (
              <div className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Layers className="w-4 h-4 text-emerald-400" />
                    <span>Сохранённые AI-сигналы</span>
                  </h3>
                  <span className="text-xs text-slate-500">{analyses.length} записей</span>
                </div>

                {analyses.length === 0 ? (
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Запустите первый анализ графика и новостей в разделе «AI-анализ и риск» — сохранённые сигналы появятся здесь.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {analyses.slice(0, 10).map((item, idx) => (
                      <button
                        key={`${item.id}-${analysesAnimVersion}`}
                        type="button"
                        style={{ '--stagger-idx': idx } as React.CSSProperties}
                        onClick={() => {
                          setSymbol(item.symbol);
                          setMarketType(item.marketType);
                          setActiveResult({
                            direction: item.direction,
                            confidence: item.confidence,
                            entryZone: item.entryZone,
                            stopLoss: item.stopLoss,
                            takeProfits: [
                              item.takeProfits[0] ?? '',
                              item.takeProfits[1] ?? item.takeProfits[0] ?? '',
                              item.takeProfits[2] ?? item.takeProfits[0] ?? '',
                            ],
                            riskReward: item.riskReward,
                            newsSentiment: item.newsSentiment,
                            newsSourcesCount: item.newsSourcesCount,
                            keyCatalysts: [],
                            invalidationRule: 'См. уровни Stop-Loss.',
                            summary: item.summary,
                            riskMetrics: {
                              riskAmountUsdt: Number(((depositUsdt * riskPct) / 100).toFixed(2)),
                              positionSizeUsdt: depositUsdt,
                              recommendedLeverage: item.marketType === 'futures' ? leverage : 1,
                              estimatedLiquidationPrice: null,
                            },
                          });
                          setSignalAnimVersion((v) => v + 1);
                          setMarketSection('ai');
                        }}
                        className="signal-card-enter signal-card-stagger w-full rounded-xl border border-white/8 bg-[#0B0F17]/75 hover:bg-white/[0.04] hover:border-white/15 px-3.5 py-3 text-left flex items-center justify-between gap-3 transition-colors"
                      >
                        <div>
                          <div className="text-xs font-semibold text-white flex items-center gap-2">
                            <span className="font-mono">{item.symbol}</span>
                            <span className="text-slate-500">·</span>
                            <span className="text-slate-400">{item.marketType === 'futures' ? 'Фьючерсы' : 'Спот'}</span>
                            <span className="text-slate-500">·</span>
                            <span className="font-mono text-slate-400">{item.timeframe}</span>
                          </div>
                          <div className="mt-0.5 text-xs text-slate-400 truncate max-w-[260px]">{item.strategyName}</div>
                        </div>
                        <div className="text-right font-mono tabular-nums">
                          <div
                            className={`text-xs font-bold ${
                              item.direction === 'LONG'
                                ? 'text-emerald-400'
                                : item.direction === 'SHORT'
                                  ? 'text-rose-400'
                                  : 'text-amber-300'
                            }`}
                          >
                            {item.direction}
                          </div>
                          <div className="text-[11px] text-slate-500 flex items-center justify-end gap-1">
                            <Clock className="w-3 h-3" />
                            <span>{item.confidence}%</span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </WorkspaceShell>

      <QuickAnswersCard
        isSignedIn={isSignedIn}
        userEmail={userEmail}
        supportTickets={supportTickets}
        onRequireLogin={onRequireLogin}
        onCreateSupportTicket={onCreateSupportTicket}
        onOpenPushSettings={onOpenPushSettings}
        onOpenAiSection={() => setMarketSection('ai')}
        onUpgradePro={onUpgradePro}
        onOpenFullFaq={onOpenFullFaq}
        onStartTour={onStartTour}
      />

      <QuickAssetAlertModal
        open={Boolean(notifyAsset)}
        target={notifyAsset}
        marketType={marketType}
        alerts={priceAlerts}
        isSignedIn={isSignedIn}
        pushSubscribed={pushSubscribed}
        onClose={() => setNotifyAsset(null)}
        onRequireLogin={onRequireLogin}
        onOpenPushSettings={onOpenPushSettings}
        onCreateAlert={onCreatePriceAlert}
        onToggleAlert={onTogglePriceAlert}
        onDeleteAlert={onDeletePriceAlert}
      />
    </StaggerDeck>
  );
};
