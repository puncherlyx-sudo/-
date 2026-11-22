import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  Check,
  ChevronDown,
  Clock,
  Copy,
  Crown,
  Flame,
  Gauge,
  History,
  Layers,
  Lock,
  Maximize2,
  Minimize2,
  PieChart as PieChartIcon,
  PlusCircle,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  X,
} from 'lucide-react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import {
  CREDIT_COSTS,
  FREE_DAILY_SIGNAL_LIMIT,
  FREE_MAX_LEVERAGE,
  FREE_WEEKLY_QUOTA,
  MAX_MONTHLY_QUOTA,
  PRO_MONTHLY_QUOTA,
  STRATEGY_CATALOG,
  TRADING_PAIRS,
  canAccessStrategy,
  countTodayStrategySignals,
  formatProUntilDate,
  getActivePlanTier,
  getCreditQuotaForProfile,
  getTierDisplayName,
  isMaxSubscriptionActive,
  isProSubscriptionActive,
  isProSubscriptionExpired,
} from '../data/strategies';
import { parseJsonResponse } from '../utils/safeFetchJson';
import type {
  AnalysisRecord,
  AnalysisResultPayload,
  CandlePoint,
  EquityCurvePoint,
  ExchangeKeyRecord,
  ExchangeOrderResult,
  IndicatorSnapshot,
  MarketType,
  PriceAlertCondition,
  PriceAlertRecord,
  RibbonPeriods,
  RibbonType,
  StrategyBreakdownResult,
  StrategyPerformanceReport,
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
import { FeatureGuide } from './FeatureGuide';
import { MarketDominanceWidget } from './MarketDominanceWidget';
import {
  AssetStripSkeleton,
  OscillatorsSkeleton,
  PairsListSkeleton,
  skeletonSwapVariants,
} from './MarketSkeletons';
import { MiniSparkline } from './MiniSparkline';
import {
  FlashValue,
  NATIVE_PILL_SPRING,
  NATIVE_SPRING,
  StaggerDeck,
  WorkspaceShell,
} from './MotionPrimitives';
import { MultiTimeframeStrip } from './MultiTimeframeStrip';
import {
  ChartEngineSwitch,
  readChartEngine,
  saveChartEngine,
  TradingViewChart,
  type ChartEngine,
} from './TradingViewChart';
import { BottomSheet, BottomSheetItem, BottomSheetList } from './BottomSheet';
import { NonCustodialRiskNotice } from './TradeRiskConfirmModal';
import { OrderBookPanel } from './OrderBookPanel';
import { QuickAssetAlertModal, type QuickAlertTargetAsset } from './QuickAssetAlertModal';
import {
  VirtualizedAssetStrip,
  VirtualizedPairsList,
  type EnrichedMarketPair,
} from './VirtualizedAssetLists';
import { authFetch } from '../lib/authFetch';
import { DerivativesSessionsWidget } from './DerivativesSessionsWidget';
import { AiComplianceFooter } from './LegalConsentModal';
import { OrderTransferCard } from './OrderTransferCard';
import { PaperTradingPanel } from './PaperTradingPanel';
import { AiConsiliumMaxPanel, ProLadderCalculator } from './TerminalProMaxModules';
import { readPaperAccount } from '../lib/proMaxStore';
import { DLP_WARNING_MESSAGE, detectSensitiveWalletInput, triggerHaptic } from '../lib/securityDlp';
import {
  buildChartSignalMarkers,
  calculateSignalProgress,
  chartMarkerToSignalOverlay,
  ENGINE_STATE_META,
  strategyEventStream,
  type ActiveStrategySignalOverlay,
  type ChartSignalMarker,
  type StrategySignalEvent,
} from '../lib/strategyEngine';

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
  externalSelection?: {
    symbol: string;
    marketType: MarketType;
    nonce: number;
    signalOverlay?: ActiveStrategySignalOverlay | null;
  } | null;
  onRequireLogin: () => void;
  onUpgradePro: () => void;
  onUpgradeMax?: () => void;
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
  exchangeKeys?: ExchangeKeyRecord[];
  onOpenExchangeIntegrations?: () => void;
  onPlaceExchangeOrder?: (
    key: ExchangeKeyRecord,
    orderParams: {
      symbol: string;
      marketType: MarketType;
      side: 'BUY' | 'SELL';
      orderType: 'MARKET' | 'LIMIT';
      quantity: number;
      limitPrice?: number;
      stopLoss?: number;
      takeProfit?: number;
    }
  ) => Promise<ExchangeOrderResult>;
  portfolioBalanceUsdt?: number;
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
  onUpgradeMax,
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
  exchangeKeys = [],
  onOpenExchangeIntegrations,
  onPlaceExchangeOrder,
  portfolioBalanceUsdt = 0,
}) => {
  const [selectedExecKeyId, setSelectedExecKeyId] = useState<string>('');
  const [executingSignalOrder, setExecutingSignalOrder] = useState(false);
  const [signalOrderStatus, setSignalOrderStatus] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [dlpSearchAlert, setDlpSearchAlert] = useState<string | null>(null);
  const [portfolioDepositHint, setPortfolioDepositHint] = useState<string | null>(null);
  const [strategyPickerOpen, setStrategyPickerOpen] = useState(false);
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
  const [chartEngine, setChartEngine] = useState<ChartEngine>(() => readChartEngine());
  const handleChartEngineChange = useCallback((engine: ChartEngine) => {
    setChartEngine(engine);
    saveChartEngine(engine);
  }, []);
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
  // PRO #2 & #3: Smart Money & Volume Profile (VPVR) chart layers
  const [showSR, setShowSR] = useState<boolean>(false);
  const [showOrderBlocks, setShowOrderBlocks] = useState<boolean>(false);
  const [showFvg, setShowFvg] = useState<boolean>(false);
  const [showBosChoch, setShowBosChoch] = useState<boolean>(false);
  const [showVpvr, setShowVpvr] = useState<boolean>(false);
  // PRO #5 & MAX #5: AI-анализ / Paper-сделка & Базовый / PRO-лесенка
  const [aiPanelMode, setAiPanelMode] = useState<'analysis' | 'paper'>('analysis');
  const [pairSheetOpen, setPairSheetOpen] = useState(false);
  const [pairSheetTab, setPairSheetTab] = useState<'spot' | 'futures' | 'favorites'>('spot');
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [chartFullscreen, setChartFullscreen] = useState(false);
  const [riskCalcMode, setRiskCalcMode] = useState<'basic' | 'ladder'>('basic');
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

  const [activeSignalOverlay, setActiveSignalOverlay] = useState<ActiveStrategySignalOverlay | null>(
    null
  );
  const [selectedChartSignalId, setSelectedChartSignalId] = useState<string | null>(null);
  const [showChartSignals, setShowChartSignals] = useState<boolean>(true);
  const [signalOverlayTab, setSignalOverlayTab] = useState<'levels' | 'backtest'>('levels');
  const [signalBacktestInterval, setSignalBacktestInterval] = useState<'1h' | '4h' | '1d'>('1h');
  const [signalBacktestCache, setSignalBacktestCache] = useState<
    Record<
      string,
      {
        breakdown: StrategyBreakdownResult;
        equityCurve: EquityCurvePoint[];
        dataSource: 'live' | 'cached';
        interval: '1h' | '4h' | '1d';
      }
    >
  >({});
  const [signalBacktestLoading, setSignalBacktestLoading] = useState(false);
  const [signalBacktestError, setSignalBacktestError] = useState<string | null>(null);
  const [copiedSignalPlan, setCopiedSignalPlan] = useState(false);
  const renderedEntryMarkerKeysRef = useRef<Set<string>>(new Set());
  const [streamSignalEvents, setStreamSignalEvents] = useState<StrategySignalEvent[]>(() =>
    strategyEventStream.getEvents()
  );

  useEffect(() => {
    return strategyEventStream.subscribe((events) => {
      setStreamSignalEvents(events);
    });
  }, []);

  useEffect(() => {
    if (!externalSelection) return;
    setSymbol(externalSelection.symbol);
    setMarketType(externalSelection.marketType);
    setActiveResult(null);
    setDraftAlertPrice(null);
    setActiveSignalOverlay(externalSelection.signalOverlay ?? null);
    setSelectedChartSignalId(null);
    if (externalSelection.signalOverlay) {
      setShowChartSignals(true);
      // Включаем нативный свечной график Vernier, чтобы линии и маркеры Entry / SL / TP были видны сразу
      setChartEngine('native');
      saveChartEngine('native');
    }
    setMarketSection('chart');
  }, [externalSelection]);

  useEffect(() => {
    setDraftAlertPrice(null);
    setSelectedChartSignalId(null);
  }, [symbol, marketType]);

  const activePlanTier = getActivePlanTier(profile);
  const isPro = isProSubscriptionActive(profile);
  const isMax = isMaxSubscriptionActive(profile);
  const isExpiredPro = isProSubscriptionExpired(profile);
  const totalCreditQuota = getCreditQuotaForProfile(profile);
  const tierLabel = getTierDisplayName(activePlanTier);

  const filteredStrategies = useMemo(
    () => STRATEGY_CATALOG.filter((s) => s.marketType === marketType),
    [marketType]
  );

  useEffect(() => {
    if (!filteredStrategies.some((s) => s.key === strategyKey)) {
      const first =
        filteredStrategies.find((s) => canAccessStrategy(s.key, activePlanTier)) ?? filteredStrategies[0];
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
  }, [filteredStrategies, strategyKey, isPro, activePlanTier]);

  useEffect(() => {
    if (!isPro && leverage > FREE_MAX_LEVERAGE) {
      setLeverage(FREE_MAX_LEVERAGE);
    }
  }, [isPro, leverage]);

  const activeStrategy = useMemo(
    () => filteredStrategies.find((s) => s.key === strategyKey) ?? filteredStrategies[0],
    [filteredStrategies, strategyKey]
  );

  const isSelectedStrategyLocked = Boolean(
    activeStrategy && !canAccessStrategy(activeStrategy.key, activePlanTier)
  );
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

  // Живая цена прямо во вкладке браузера и в переключателе окон: «BTC $91,450.00 ▲ · Vernier»
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
    document.title = `${tabTitleBase} ${formatUsd(tabTitlePrice)} ${tabTitleUp ? '▲' : '▼'} · Vernier`;
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
          ? `Месячная квота кредитов ${tierLabel} исчерпана (${profile.creditsRemaining}/${totalCreditQuota}). Продлите подписку ${tierLabel}, чтобы пополнить ещё ${totalCreditQuota} кредитов.`
          : `Недостаточно кредитов (нужно ${requiredCredits}, доступно ${profile.creditsRemaining}/${totalCreditQuota}). Перейдите на PRO (${PRO_MONTHLY_QUOTA} кр.) или MAX (${MAX_MONTHLY_QUOTA} кр.).`
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

  const matchedSignalOverlay =
    activeSignalOverlay &&
    activeSignalOverlay.symbol === symbol &&
    activeSignalOverlay.marketType === marketType
      ? activeSignalOverlay
      : null;

  const pairChartSignals = useMemo(
    () =>
      buildChartSignalMarkers({
        symbol,
        marketType,
        activeOverlay: matchedSignalOverlay,
        streamEvents: streamSignalEvents,
        analyses,
      }),
    [symbol, marketType, matchedSignalOverlay, streamSignalEvents, analyses]
  );

  // Если пользователь не выбрал конкретный оверлей вручную, но есть входящий живой сигнал по этой паре —
  // показываем его уровни Entry / TP / SL на графике автоматически при включённом слое сигналов.
  const effectiveSignalOverlay = useMemo<ActiveStrategySignalOverlay | null>(() => {
    if (matchedSignalOverlay) return matchedSignalOverlay;
    if (!showChartSignals) return null;
    const incoming = pairChartSignals.find((m) => m.source === 'incoming');
    return incoming ? chartMarkerToSignalOverlay(incoming) : null;
  }, [matchedSignalOverlay, showChartSignals, pairChartSignals]);

  const handleSelectChartSignalMarker = useCallback((marker: ChartSignalMarker) => {
    triggerHaptic(8);
    setSelectedChartSignalId(marker.id);
    setActiveSignalOverlay(chartMarkerToSignalOverlay(marker));
    setShowChartSignals(true);
    setChartEngine('native');
    saveChartEngine('native');
  }, []);

  const entryOverlay = effectiveSignalOverlay?.entryPrice ?? parseFirstPrice(activeResult?.entryZone);
  const slOverlay = effectiveSignalOverlay?.stopLossPrice ?? parseFirstPrice(activeResult?.stopLoss);
  const tp1Overlay = effectiveSignalOverlay?.tp1Price ?? null;
  const tpOverlay =
    effectiveSignalOverlay?.takeProfitPrice ?? parseFirstPrice(activeResult?.takeProfits?.[0]);
  const liveSignalPrice =
    indicators?.lastPrice ?? activeTicker?.price ?? effectiveSignalOverlay?.entryPrice ?? 0;
  const signalProgress = useMemo(
    () => (effectiveSignalOverlay ? calculateSignalProgress(effectiveSignalOverlay, liveSignalPrice) : null),
    [effectiveSignalOverlay, liveSignalPrice]
  );

  // Trigger haptic notification (12ms) whenever a new 'Entry' signal marker is rendered on the chart
  useEffect(() => {
    if (chartEngine === 'tradingview') return;
    const nextEntryKeys: string[] = [];

    if (typeof entryOverlay === 'number' && Number.isFinite(entryOverlay) && entryOverlay > 0) {
      const overlayKey = [
        'active-entry',
        symbol,
        marketType,
        effectiveSignalOverlay?.strategyKey ?? activeStrategy?.key ?? 'ai',
        effectiveSignalOverlay?.direction ?? activeResult?.direction ?? 'SIG',
        entryOverlay.toFixed(6),
      ].join('|');
      nextEntryKeys.push(overlayKey);
    }

    if (showChartSignals && pairChartSignals.length > 0) {
      for (const marker of pairChartSignals) {
        if (marker.source === 'incoming' || marker.source === 'active') {
          nextEntryKeys.push(
            `marker-entry|${marker.id}|${marker.symbol}|${marker.direction}|${marker.entryPrice.toFixed(6)}`
          );
        }
      }
    }

    let hasNewEntryMarker = false;
    for (const key of nextEntryKeys) {
      if (!renderedEntryMarkerKeysRef.current.has(key)) {
        renderedEntryMarkerKeysRef.current.add(key);
        hasNewEntryMarker = true;
      }
    }

    if (hasNewEntryMarker) {
      triggerHaptic(12);
    }
  }, [
    chartEngine,
    showChartSignals,
    entryOverlay,
    symbol,
    marketType,
    effectiveSignalOverlay?.strategyKey,
    effectiveSignalOverlay?.direction,
    activeStrategy?.key,
    activeResult?.direction,
    pairChartSignals,
  ]);

  const effectiveBacktestInterval: '1h' | '4h' | '1d' =
    signalBacktestInterval === '1d' && !isMax ? '4h' : signalBacktestInterval;
  const signalBacktestCacheKey = effectiveSignalOverlay
    ? `${effectiveSignalOverlay.strategyKey}|${effectiveSignalOverlay.symbol}|${effectiveBacktestInterval}`
    : null;
  const activeSignalBacktest = signalBacktestCacheKey
    ? signalBacktestCache[signalBacktestCacheKey] ?? null
    : null;

  const fetchSignalStrategyBacktest = useCallback(
    async (
      overlay: ActiveStrategySignalOverlay,
      interval: '1h' | '4h' | '1d',
      force = false
    ) => {
      const cacheKey = `${overlay.strategyKey}|${overlay.symbol}|${interval}`;
      if (!force && signalBacktestCache[cacheKey]) return;

      const tpl = STRATEGY_CATALOG.find((s) => s.key === overlay.strategyKey);
      const pairs = Array.from(new Set([overlay.symbol, 'BTCUSDT', 'ETHUSDT', 'SOLUSDT']));

      setSignalBacktestLoading(true);
      setSignalBacktestError(null);
      try {
        const res = await authFetch('/api/strategies/pnl', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            interval,
            depositUsdt: Math.max(100, depositUsdt),
            scope: 'all',
            demoTier: activePlanTier,
            strategies: [
              {
                strategyKey: overlay.strategyKey,
                name: tpl?.name ?? overlay.strategyName,
                shortTag: tpl?.shortTag ?? (overlay.marketType === 'futures' ? 'Фьючерсы' : 'Спот'),
                marketType: tpl?.marketType ?? overlay.marketType,
                enabled: true,
                riskPerTradePct: tpl?.defaultRiskPct ?? riskPct,
                leverage:
                  (tpl?.marketType ?? overlay.marketType) === 'futures'
                    ? tpl?.defaultLeverage ?? Math.max(2, leverage)
                    : 1,
                pairs,
              },
            ],
          }),
        });
        const parsed = await parseJsonResponse<StrategyPerformanceReport>(res);
        if (!parsed.ok || !parsed.data) {
          throw new Error(parsed.errorMessage || 'Не удалось загрузить бэктест стратегии.');
        }
        const matchedRow =
          parsed.data.breakdown.find((row) => row.strategyKey === overlay.strategyKey) ??
          parsed.data.breakdown[0] ?? {
            strategyKey: overlay.strategyKey,
            name: overlay.strategyName,
            shortTag: overlay.marketType === 'futures' ? 'Фьючерсы' : 'Спот',
            marketType: overlay.marketType,
            enabled: true,
            totalPnlPct: parsed.data.summary.totalPnlPct,
            totalPnlUsdt: parsed.data.summary.totalPnlUsdt,
            winRatePct: parsed.data.summary.winRatePct,
            tradesCount: parsed.data.summary.totalTrades,
            profitFactor: parsed.data.summary.profitFactor,
            maxDrawdownPct: parsed.data.summary.maxDrawdownPct,
            avgRiskReward: `1:${overlay.riskRewardRatio}`,
          };

        setSignalBacktestCache((prev) => ({
          ...prev,
          [cacheKey]: {
            breakdown: matchedRow,
            equityCurve: parsed.data!.equityCurve || [],
            dataSource: parsed.data!.dataSource,
            interval: parsed.data!.interval,
          },
        }));
      } catch (err) {
        setSignalBacktestError(
          err instanceof Error ? err.message : 'Ошибка расчёта исторического бэктеста.'
        );
      } finally {
        setSignalBacktestLoading(false);
      }
    },
    [signalBacktestCache, depositUsdt, activePlanTier, riskPct, leverage]
  );

  useEffect(() => {
    if (signalOverlayTab !== 'backtest' || !effectiveSignalOverlay) return;
    void fetchSignalStrategyBacktest(effectiveSignalOverlay, effectiveBacktestInterval);
  }, [signalOverlayTab, effectiveSignalOverlay, effectiveBacktestInterval, fetchSignalStrategyBacktest]);

  const signalPositionSizing = useMemo(() => {
    if (!effectiveSignalOverlay) return null;
    const riskDist = Math.abs(effectiveSignalOverlay.entryPrice - effectiveSignalOverlay.stopLossPrice);
    if (riskDist <= 1e-9 || effectiveSignalOverlay.entryPrice <= 0) return null;
    const riskUsd = Math.max(1, (depositUsdt * riskPct) / 100);
    const units = riskUsd / riskDist;
    const notionalUsd = units * effectiveSignalOverlay.entryPrice;
    const rewardTp2Usd =
      units * Math.abs(effectiveSignalOverlay.takeProfitPrice - effectiveSignalOverlay.entryPrice);
    return {
      riskUsd,
      units,
      notionalUsd,
      rewardTp2Usd,
    };
  }, [effectiveSignalOverlay, depositUsdt, riskPct]);

  const handleCopySignalPlan = useCallback(async () => {
    if (!effectiveSignalOverlay) return;
    const pairTitle = `${effectiveSignalOverlay.symbol.replace('USDT', '')}/USDT`;
    const lines = [
      `VERNIER · ${pairTitle} (${effectiveSignalOverlay.marketType === 'futures' ? 'Futures' : 'Spot'}) · ${effectiveSignalOverlay.direction}`,
      `Стратегия: ${effectiveSignalOverlay.strategyName} (${effectiveSignalOverlay.confidence}%)`,
      `Вход (Entry): ${formatUsd(effectiveSignalOverlay.entryPrice)}`,
      `Stop-Loss: ${formatUsd(effectiveSignalOverlay.stopLossPrice)}`,
      `Take-Profit 1: ${formatUsd(effectiveSignalOverlay.tp1Price)}`,
      `Take-Profit 2: ${formatUsd(effectiveSignalOverlay.takeProfitPrice)} (R:R 1:${effectiveSignalOverlay.riskRewardRatio})`,
    ];
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(lines.join('\n'));
      }
      triggerHaptic(10);
      setCopiedSignalPlan(true);
      window.setTimeout(() => setCopiedSignalPlan(false), 2000);
    } catch {
      // Clipboard blocked silently
    }
  }, [effectiveSignalOverlay]);

  const strategyHistoricalMatchesCount = useMemo(() => {
    if (!effectiveSignalOverlay) return 0;
    return analyses.filter((a) => a.strategyKey === effectiveSignalOverlay.strategyKey).length;
  }, [analyses, effectiveSignalOverlay]);

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

      {/* Pair + Timeframe (BottomSheet trigger replaces native select for smooth mobile UX) */}
      <div className="flex flex-col sm:flex-row lg:flex-col gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            type="button"
            aria-label="Выбрать торговую пару"
            onClick={() => {
              triggerHaptic(8);
              setPairSheetTab(marketType === 'futures' ? 'futures' : 'spot');
              setPairSheetOpen(true);
            }}
            className="w-full min-w-0 min-h-[38px] rounded-xl border border-white/10 hover:border-emerald-500/40 bg-[#0B0F17] px-2.5 text-xs font-mono font-semibold text-white flex items-center justify-between gap-2 transition-colors"
          >
            <span className="truncate">
              {activeTicker ? `${activeTicker.baseAsset} / USDT` : symbol}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          </button>
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

        {/* Dedicated non-clipping live quote bar for <390px screens */}
        {activeTicker && (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-white/8 bg-[#0B0F17]/90 px-2.5 py-1.5 text-xs font-mono tabular-nums min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-semibold text-white shrink-0">{activeTicker.baseAsset} / USDT</span>
              <span className="text-slate-500 shrink-0">•</span>
              <span className="text-slate-100 font-semibold font-mono tabular-nums shrink-0 whitespace-nowrap">
                {formatUsd(activeTicker.price)}
              </span>
            </div>
            <span
              className={`shrink-0 whitespace-nowrap font-mono tabular-nums font-semibold text-[11px] px-1.5 py-0.5 rounded-md ${
                activeTicker.change24hPct >= 0
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : 'bg-rose-500/15 text-rose-300'
              }`}
            >
              ({activeTicker.change24hPct >= 0 ? '+' : ''}
              {activeTicker.change24hPct.toFixed(2)}%)
            </span>
          </div>
        )}

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
                className={`${isMax ? 'text-cyan-300 hover:text-cyan-200' : 'text-amber-300 hover:text-amber-200'} font-semibold whitespace-nowrap`}
              >
                {profile.creditsRemaining <= 0 ? 'Пополнить →' : tierLabel}
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
              <div className={`${isMax ? 'text-cyan-300/90' : 'text-amber-300/90'} font-medium`}>
                {tierLabel} активен · до {formatProUntilDate(profile.proUntil)}
              </div>
              <div>
                Спот = 1 кр. · Фьючерсы = 2 кр. · Сигналы: ∞/день
                {isMax ? ' · Gemini MAX' : ''}
              </div>
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
      {/* Desktop Quick Market Toolbar (hidden on mobile to remove duplicate bar above WorkspaceShell) */}
      <div className="hidden lg:block mb-3 rounded-2xl border border-white/8 bg-[var(--surface-1)] card-surface-glow px-2.5 sm:px-3 py-2 space-y-2">
        <div className="flex items-center justify-between gap-1.5 min-w-0">
          {/* Primary Pair Picker Trigger -> opens Pair BottomSheet */}
          <button
            type="button"
            onClick={() => {
              triggerHaptic(8);
              setPairSheetTab(marketType === 'futures' ? 'futures' : 'spot');
              setPairSheetOpen(true);
            }}
            aria-label="Выбрать торговую пару и поиск монет"
            className="min-h-[38px] flex-1 min-w-0 px-2.5 rounded-xl border border-emerald-500/25 bg-[var(--surface-0)] hover:border-emerald-400/45 flex items-center justify-between gap-2 transition-colors"
          >
            <div className="flex items-center gap-1.5 min-w-0 font-mono tabular-nums text-xs">
              <Search className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="font-bold text-white shrink-0">
                {activeTicker ? activeTicker.baseAsset : symbol.replace(/USDT$/, '')}
                <span className="text-slate-500 font-normal">/USDT</span>
              </span>
              {activeTicker && (
                <span className="text-slate-200 font-semibold whitespace-nowrap truncate">
                  {formatUsd(activeTicker.price)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {activeTicker && (
                <span
                  className={`font-mono tabular-nums text-[11px] font-semibold px-1.5 py-0.5 rounded-md whitespace-nowrap ${
                    activeTicker.change24hPct >= 0
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'bg-rose-500/15 text-rose-300'
                  }`}
                >
                  {activeTicker.change24hPct >= 0 ? '+' : ''}
                  {activeTicker.change24hPct.toFixed(2)}%
                </span>
              )}
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            </div>
          </button>

          {/* Compact Filters & Sort Button -> opens Filters BottomSheet */}
          <button
            type="button"
            onClick={() => {
              triggerHaptic(8);
              setFilterSheetOpen(true);
            }}
            aria-label="Фильтры и сортировка пар"
            className={`min-h-[38px] px-2.5 rounded-xl border text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
              assetFilter !== 'all' || assetSort !== 'default'
                ? 'border-cyan-500/45 bg-cyan-500/15 text-cyan-200'
                : 'border-white/10 bg-[var(--surface-0)] text-slate-300 hover:border-white/20 hover:text-white'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">Фильтры</span>
            {(assetFilter !== 'all' || assetSort !== 'default') && (
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0" />
            )}
          </button>

          {/* Columns Button -> opens Columns BottomSheet */}
          <ColumnSelectorMenu columns={visibleColumns} onChange={setVisibleColumns} />
        </div>

        {/* Desktop-only Quick Asset Strip (hidden on mobile so chart stays immediately above the fold) */}
        <div className="hidden lg:block">
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
            ) : null}
          </AnimatePresence>
        </div>
      </div>

      <WorkspaceShell
        title="Рынок и терминал"
        subtitle={activeTicker ? `${activeTicker.baseAsset}/USDT · ${formatUsd(activeTicker.price)}` : symbol}
        icon={
          <img
            src="/src/assets/images/terminal_icon_chart_1794855841231.jpg"
            alt="Рынок Vernier"
            width={32}
            height={32}
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
                  onClick={() => {
                    triggerHaptic(8);
                    setChartFullscreen(true);
                  }}
                  aria-label="Открыть график на весь экран"
                  title="На весь экран"
                  className="min-h-[34px] px-2.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 hover:border-emerald-500/40 text-slate-200 text-xs font-medium inline-flex items-center gap-1 whitespace-nowrap transition-colors"
                >
                  <Maximize2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="hidden sm:inline">На весь экран</span>
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

            <div className="mt-3">
              <MultiTimeframeStrip
                symbol={symbol}
                marketType={marketType}
                activeTimeframe={timeframe}
                onSelectTimeframe={setTimeframe}
              />
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

            {/* Chart engine switch: our chart or the official TradingView widget */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <ChartEngineSwitch engine={chartEngine} onChange={handleChartEngineChange} />
              {chartEngine === 'tradingview' && (
                <span className="text-[11px] text-slate-500 text-right">
                  Слои Ribbon/EMA/SMC/VPVR относятся к нашему графику
                </span>
              )}
            </div>

            {/* PRO #2 & PRO #3: Smart Money & VPVR Overlay Layer Toggles */}
            {chartEngine !== 'tradingview' && (
              <div className="mt-2.5 space-y-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-mono font-bold text-amber-300/90 shrink-0 px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/10">
                    PRO СЛОИ
                  </span>
                  {(
                    [
                      { id: 'sr', label: 'S/R Уровни', active: showSR, toggle: () => setShowSR((v) => !v) },
                      { id: 'ob', label: 'Order Blocks', active: showOrderBlocks, toggle: () => setShowOrderBlocks((v) => !v) },
                      { id: 'fvg', label: 'FVG', active: showFvg, toggle: () => setShowFvg((v) => !v) },
                      { id: 'bos', label: 'BOS/CHoCH', active: showBosChoch, toggle: () => setShowBosChoch((v) => !v) },
                      { id: 'vpvr', label: 'VPVR', active: showVpvr, toggle: () => setShowVpvr((v) => !v) },
                    ] as const
                  ).map((layer) => (
                    <button
                      key={layer.id}
                      type="button"
                      onClick={() => {
                        triggerHaptic(8);
                        if (!isPro) {
                          onUpgradePro();
                          return;
                        }
                        layer.toggle();
                      }}
                      className={`min-h-[30px] px-2.5 rounded-lg border text-[11px] font-medium inline-flex items-center gap-1 whitespace-nowrap transition-colors ${
                        isPro && layer.active
                          ? 'border-emerald-400/50 bg-emerald-500/18 text-emerald-200'
                          : 'border-white/10 bg-[#0B0F17] text-slate-300 hover:text-white'
                      }`}
                    >
                      {!isPro && <Lock className="w-3 h-3 text-amber-400 shrink-0" />}
                      <span>{layer.label}</span>
                    </button>
                  ))}
                </div>
                <FeatureGuide
                  title="Как работают график и PRO-слои (SMC / VPVR)"
                  summary="Накладывайте уровни поддержки/сопротивления, институциональные Order Blocks, дисбалансы FVG, сломы структуры BOS/CHoCH и профиль объёма VPVR прямо на свечи."
                  steps={[
                    'Нажмите на свечу/уровень на графике, чтобы быстро выставить ценовой алерт.',
                    'Переключайте таймфреймы 15M / 1H / 4H / 1D — все индикаторы и PRO-слои пересчитываются автоматически.',
                    'В разделе «AI-анализ» доступен разбор выбранной пары и AI-Консилиум (MAX).',
                  ]}
                  compact
                />
              </div>
            )}

            {/* Входящие и исторические сигналы стратегий по выбранной паре */}
            {chartEngine !== 'tradingview' && pairChartSignals.length > 0 && (
              <div className="mt-3 rounded-xl border border-white/10 bg-[#0B0F17]/90 px-3 py-2 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold text-white">Сигналы на графике</span>
                    <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 font-mono text-[10px] text-emerald-300">
                      Входящие: {pairChartSignals.filter((m) => m.source === 'incoming' || m.source === 'active').length}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-white/6 border border-white/10 font-mono text-[10px] text-slate-300">
                      История: {pairChartSignals.filter((m) => m.source === 'historical').length}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic(6);
                      setShowChartSignals((v) => !v);
                    }}
                    className={`min-h-[26px] px-2 rounded-lg border text-[10px] font-semibold transition-colors ${
                      showChartSignals
                        ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
                        : 'border-white/10 bg-white/5 text-slate-400 hover:text-white'
                    }`}
                  >
                    {showChartSignals ? 'Маркеры вкл' : 'Маркеры выкл'}
                  </button>
                </div>

                {showChartSignals && (
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
                    {pairChartSignals.map((m) => {
                      const isSelected =
                        selectedChartSignalId === m.id ||
                        (effectiveSignalOverlay &&
                          effectiveSignalOverlay.strategyKey === m.strategyKey &&
                          effectiveSignalOverlay.direction === m.direction &&
                          Math.abs(effectiveSignalOverlay.entryPrice - m.entryPrice) < 1e-6);
                      const timeLabel = new Date(m.emittedAt).toLocaleTimeString('ru-RU', {
                        hour: '2-digit',
                        minute: '2-digit',
                      });
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => handleSelectChartSignalMarker(m)}
                          className={`shrink-0 px-2 py-1 rounded-lg border text-[10px] font-mono inline-flex items-center gap-1.5 transition-colors ${
                            isSelected
                              ? 'border-amber-400/60 bg-amber-500/15 text-amber-100'
                              : m.direction === 'LONG'
                                ? 'border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-200 hover:border-emerald-400/45'
                                : 'border-rose-500/25 bg-rose-500/[0.06] text-rose-200 hover:border-rose-400/45'
                          }`}
                        >
                          <span className="font-bold">{m.direction === 'LONG' ? '▲' : '▼'}</span>
                          <span className="font-sans font-semibold max-w-[110px] truncate">{m.strategyName}</span>
                          <span className="text-[9px] opacity-80">
                            {m.source === 'historical' ? 'Ист.' : 'Live'} · {timeLabel}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Активный сигнал стратегии на графике: вкладки Уровни / Backtest Results */}
            {effectiveSignalOverlay && signalProgress && (
              <div
                className={`mt-3 rounded-xl border p-3 sm:p-3.5 space-y-2.5 ${
                  effectiveSignalOverlay.direction === 'LONG'
                    ? 'border-emerald-500/35 bg-gradient-to-br from-emerald-500/[0.09] via-[#0B1219] to-[#080C12]'
                    : 'border-rose-500/35 bg-gradient-to-br from-rose-500/[0.09] via-[#130D14] to-[#080C12]'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`px-2 py-0.5 rounded-md font-mono text-[10px] font-bold border ${
                          effectiveSignalOverlay.direction === 'LONG'
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                            : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                        }`}
                      >
                        {effectiveSignalOverlay.direction}
                      </span>
                      <span className="text-xs font-semibold text-white truncate">
                        {effectiveSignalOverlay.strategyName}
                      </span>
                      <span className="text-[11px] font-mono text-slate-400">
                        · {ENGINE_STATE_META[effectiveSignalOverlay.engineState].shortRu} ·{' '}
                        {effectiveSignalOverlay.mode === 'live' ? 'Live API' : 'Paper'}
                      </span>
                      {effectiveSignalOverlay.isProjected && (
                        <span className="text-[10px] text-amber-300">· Проектные зоны</span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-300 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="font-medium text-emerald-300">{signalProgress.phaseLabelRu}</span>
                      <span aria-hidden="true" className="text-slate-600">·</span>
                      <span className="font-mono tabular-nums">
                        От входа:{' '}
                        <strong
                          className={
                            signalProgress.pnlFromEntryPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }
                        >
                          {signalProgress.pnlFromEntryPct >= 0 ? '+' : ''}
                          {signalProgress.pnlFromEntryPct.toFixed(2)}%
                        </strong>
                      </span>
                      <span aria-hidden="true" className="text-slate-600">·</span>
                      <span className="font-mono tabular-nums text-slate-400">
                        R:R 1:{effectiveSignalOverlay.riskRewardRatio}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => void handleCopySignalPlan()}
                      title="Скопировать уровни Entry / SL / TP"
                      className={`min-h-[30px] px-2.5 rounded-lg border text-[11px] font-medium inline-flex items-center gap-1 whitespace-nowrap transition-colors ${
                        copiedSignalPlan
                          ? 'border-emerald-500/45 bg-emerald-500/20 text-emerald-200'
                          : 'border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white'
                      }`}
                    >
                      {copiedSignalPlan ? (
                        <Check className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 shrink-0" />
                      )}
                      <span>{copiedSignalPlan ? 'Скопировано' : 'План'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic(8);
                        setDraftAlertPrice(effectiveSignalOverlay.entryPrice);
                        setShowQuickAlert(true);
                      }}
                      title="Поставить ценовой алерт на цену входа"
                      className="min-h-[30px] px-2.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20 text-[11px] font-medium text-cyan-200 inline-flex items-center gap-1 whitespace-nowrap transition-colors"
                    >
                      <BellPlus className="w-3.5 h-3.5 shrink-0" />
                      <span>Алерт</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setActiveSignalOverlay(null);
                        setSelectedChartSignalId(null);
                        setShowChartSignals(false);
                      }}
                      aria-label="Скрыть уровни сигнала с графика"
                      className="min-h-[30px] px-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-[11px] text-slate-400 hover:text-white inline-flex items-center gap-1 shrink-0 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Скрыть</span>
                    </button>
                  </div>
                </div>

                {/* Сегментированный переключатель вкладок внутри панели сигнала */}
                <div
                  role="tablist"
                  aria-label="Вкладки панели сигнала стратегии"
                  className="inline-flex items-center gap-1 p-1 rounded-xl bg-[#070B12] border border-white/10"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={signalOverlayTab === 'levels'}
                    onClick={() => {
                      triggerHaptic(6);
                      setSignalOverlayTab('levels');
                    }}
                    className={`min-h-[32px] px-3 rounded-lg text-[11px] font-semibold whitespace-nowrap transition-colors ${
                      signalOverlayTab === 'levels'
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Уровни и прогресс
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={signalOverlayTab === 'backtest'}
                    onClick={() => {
                      triggerHaptic(6);
                      setSignalOverlayTab('backtest');
                    }}
                    className={`min-h-[32px] px-3 rounded-lg text-[11px] font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                      signalOverlayTab === 'backtest'
                        ? 'bg-cyan-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <BarChart3 className="w-3.5 h-3.5 shrink-0" />
                    <span>Backtest Results</span>
                  </button>
                </div>

                {signalOverlayTab === 'levels' ? (
                  <>
                    {/* Визуальная шкала прогресса цены между SL -> Вход -> TP1 -> TP2 */}
                    <div className="space-y-1.5">
                      <div className="relative h-2.5 w-full rounded-full bg-[#070B12] border border-white/10 overflow-visible">
                        <div
                          className="absolute top-0 bottom-0 left-0 rounded-l-full bg-rose-500/25"
                          style={{ width: `${signalProgress.entryMarkerPct}%` }}
                        />
                        <div
                          className="absolute top-0 bottom-0 right-0 rounded-r-full bg-emerald-500/20"
                          style={{ left: `${signalProgress.entryMarkerPct}%` }}
                        />
                        <div
                          className={`absolute top-0 bottom-0 transition-all duration-300 ${
                            signalProgress.pnlFromEntryPct >= 0 ? 'bg-emerald-400/75' : 'bg-rose-400/75'
                          }`}
                          style={{
                            left: `${Math.min(signalProgress.entryMarkerPct, signalProgress.trackPct)}%`,
                            width: `${Math.max(1.5, Math.abs(signalProgress.trackPct - signalProgress.entryMarkerPct))}%`,
                          }}
                        />
                        <span
                          title="Точка входа"
                          className="absolute -top-0.5 -bottom-0.5 w-[2px] bg-amber-400"
                          style={{ left: `${signalProgress.entryMarkerPct}%` }}
                        />
                        <span
                          title="TP1 (50%)"
                          className="absolute -top-0.5 -bottom-0.5 w-[2px] bg-cyan-400"
                          style={{ left: `${signalProgress.tp1MarkerPct}%` }}
                        />
                        <span
                          title={`Текущая цена: $${liveSignalPrice}`}
                          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-white border-2 border-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.9)] transition-[left] duration-300"
                          style={{ left: `${signalProgress.trackPct}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                        <span className="text-rose-400">SL</span>
                        <span className="text-amber-300">Вход</span>
                        <span className="text-cyan-300">TP1</span>
                        <span className="text-emerald-400">TP2</span>
                      </div>
                    </div>

                    {/* Числовые уровни Стоп / Вход / TP1 / TP2 */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono tabular-nums">
                      <div className="rounded-lg border border-rose-500/25 bg-rose-500/[0.06] px-2.5 py-1.5">
                        <div className="font-sans text-[10px] text-rose-300/80 flex items-center justify-between">
                          <span>Stop-Loss</span>
                          <span>{signalProgress.distToSlPct.toFixed(1)}%</span>
                        </div>
                        <div className="text-rose-400 font-bold mt-0.5">
                          {formatUsd(effectiveSignalOverlay.stopLossPrice)}
                        </div>
                      </div>
                      <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-2.5 py-1.5">
                        <div className="font-sans text-[10px] text-amber-300/80">Вход (Entry)</div>
                        <div className="text-amber-300 font-bold mt-0.5">
                          {formatUsd(effectiveSignalOverlay.entryPrice)}
                        </div>
                      </div>
                      <div className="rounded-lg border border-cyan-500/25 bg-cyan-500/[0.06] px-2.5 py-1.5">
                        <div className="font-sans text-[10px] text-cyan-300/80">Take-Profit 1</div>
                        <div className="text-cyan-300 font-bold mt-0.5">
                          {formatUsd(effectiveSignalOverlay.tp1Price)}
                        </div>
                      </div>
                      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.08] px-2.5 py-1.5">
                        <div className="font-sans text-[10px] text-emerald-300/80 flex items-center justify-between">
                          <span>Take-Profit 2</span>
                          <span>
                            {signalProgress.distToTp2Pct > 0 ? `+${signalProgress.distToTp2Pct.toFixed(1)}%` : 'Цель!'}
                          </span>
                        </div>
                        <div className="text-emerald-400 font-bold mt-0.5">
                          {formatUsd(effectiveSignalOverlay.takeProfitPrice)}
                        </div>
                      </div>
                    </div>

                    {/* Компактный авто-расчёт размера позиции под текущий депозит и риск */}
                    {signalPositionSizing && (
                      <div className="pt-1.5 border-t border-white/8 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] font-mono tabular-nums text-slate-300">
                        <span className="font-sans text-slate-400">
                          Авто-объём (депозит ${depositUsdt.toLocaleString('en-US')}, риск {riskPct}%):
                        </span>
                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                          <span>
                            Позиция:{' '}
                            <strong className="text-white">
                              ${signalPositionSizing.notionalUsd.toFixed(0)}
                            </strong>{' '}
                            <span className="text-slate-400">
                              ({signalPositionSizing.units >= 1
                                ? signalPositionSizing.units.toFixed(3)
                                : signalPositionSizing.units.toFixed(5)}{' '}
                              {effectiveSignalOverlay.symbol.replace('USDT', '')})
                            </span>
                          </span>
                          <span aria-hidden="true" className="text-slate-600">·</span>
                          <span className="text-rose-300">
                            Риск: -${signalPositionSizing.riskUsd.toFixed(1)}
                          </span>
                          <span aria-hidden="true" className="text-slate-600">·</span>
                          <span className="text-emerald-300">
                            TP2: +${signalPositionSizing.rewardTp2Usd.toFixed(1)}
                          </span>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  /* Вкладка Backtest Results: исторический Win Rate, Max Drawdown, PnL и кривая капитала */
                  <div className="space-y-2.5 pt-0.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      <div className="text-slate-400">
                        Исторический OHLCV-бэктест стратегии ·{' '}
                        <span className="text-slate-200 font-mono">
                          {effectiveSignalOverlay.symbol.replace('USDT', '/USDT')}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        {(['1h', '4h', '1d'] as const).map((tfOpt) => {
                          const locked = tfOpt === '1d' && !isMax;
                          const selected = effectiveBacktestInterval === tfOpt;
                          return (
                            <button
                              key={tfOpt}
                              type="button"
                              onClick={() => {
                                if (locked) {
                                  (onUpgradeMax ?? onUpgradePro)();
                                  return;
                                }
                                triggerHaptic(6);
                                setSignalBacktestInterval(tfOpt);
                              }}
                              className={`min-h-[26px] px-2 rounded-md font-mono text-[10px] font-semibold inline-flex items-center gap-1 transition-colors ${
                                selected
                                  ? 'bg-cyan-500/25 border border-cyan-400/50 text-cyan-100'
                                  : 'bg-[#070B12] border border-white/10 text-slate-400 hover:text-white'
                              }`}
                            >
                              {locked && <Lock className="w-2.5 h-2.5 text-amber-400" />}
                              <span>{tfOpt.toUpperCase()}</span>
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          disabled={signalBacktestLoading}
                          onClick={() =>
                            void fetchSignalStrategyBacktest(
                              effectiveSignalOverlay,
                              effectiveBacktestInterval,
                              true
                            )
                          }
                          aria-label="Пересчитать бэктест"
                          className="min-h-[26px] min-w-[26px] rounded-md border border-white/10 bg-[#070B12] hover:bg-white/10 text-slate-300 flex items-center justify-center transition-colors disabled:opacity-50"
                        >
                          <RefreshCw
                            className={`w-3 h-3 ${signalBacktestLoading ? 'animate-spin' : ''}`}
                          />
                        </button>
                      </div>
                    </div>

                    {signalBacktestLoading && !activeSignalBacktest ? (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {[0, 1, 2, 3].map((idx) => (
                          <div
                            key={idx}
                            className="h-14 rounded-lg border border-white/8 bg-[#070B12]/70 animate-pulse"
                          />
                        ))}
                      </div>
                    ) : signalBacktestError && !activeSignalBacktest ? (
                      <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 flex flex-wrap items-center justify-between gap-2 text-xs text-rose-200">
                        <span>{signalBacktestError}</span>
                        <button
                          type="button"
                          onClick={() =>
                            void fetchSignalStrategyBacktest(
                              effectiveSignalOverlay,
                              effectiveBacktestInterval,
                              true
                            )
                          }
                          className="min-h-[30px] px-3 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-400/40 text-xs font-semibold text-rose-100"
                        >
                          Повторить
                        </button>
                      </div>
                    ) : activeSignalBacktest ? (
                      (() => {
                        const bt = activeSignalBacktest.breakdown;
                        const ddAbs = Math.abs(bt.maxDrawdownPct);
                        const ddSeverity =
                          ddAbs <= 6 ? 'Умеренная' : ddAbs <= 14 ? 'Средняя' : 'Повышенная';
                        const winPctClamped = Math.max(0, Math.min(100, bt.winRatePct));
                        const curve = activeSignalBacktest.equityCurve;
                        const svgWidth = 260;
                        const svgHeight = 46;
                        const curvePath = (() => {
                          if (curve.length < 2) return '';
                          const vals = curve.map((p) => p.portfolioPnlPct);
                          const minV = Math.min(...vals, 0);
                          const maxV = Math.max(...vals, 0.5);
                          const span = Math.max(0.1, maxV - minV);
                          return vals
                            .map((v, i) => {
                              const x = (i / (vals.length - 1)) * svgWidth;
                              const y = svgHeight - 4 - ((v - minV) / span) * (svgHeight - 8);
                              return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
                            })
                            .join(' ');
                        })();

                        return (
                          <div className="space-y-2.5">
                            {/* 4 ключевых показателя: Win Rate, Max Drawdown, Total PnL, Profit Factor */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono tabular-nums">
                              <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] px-2.5 py-2">
                                <div className="font-sans text-[10px] text-slate-400">
                                  Успешность (Win Rate)
                                </div>
                                <div className="text-sm font-bold text-emerald-300 mt-0.5">
                                  {bt.winRatePct.toFixed(1)}%
                                </div>
                                <div className="mt-1.5 h-1.5 w-full rounded-full bg-rose-500/25 overflow-hidden">
                                  <div
                                    className="h-full rounded-full bg-emerald-400"
                                    style={{ width: `${winPctClamped}%` }}
                                  />
                                </div>
                              </div>

                              <div className="rounded-lg border border-rose-500/25 bg-rose-500/[0.06] px-2.5 py-2">
                                <div className="font-sans text-[10px] text-slate-400">
                                  Макс. просадка (DD)
                                </div>
                                <div className="text-sm font-bold text-rose-400 mt-0.5">
                                  {bt.maxDrawdownPct <= 0
                                    ? `${bt.maxDrawdownPct.toFixed(2)}%`
                                    : `-${bt.maxDrawdownPct.toFixed(2)}%`}
                                </div>
                                <div className="font-sans text-[10px] text-slate-400 mt-0.5">
                                  Риск: {ddSeverity}
                                </div>
                              </div>

                              <div className="rounded-lg border border-white/10 bg-[#070B12]/80 px-2.5 py-2">
                                <div className="font-sans text-[10px] text-slate-400">
                                  Итоговый PnL ({activeSignalBacktest.interval.toUpperCase()})
                                </div>
                                <div
                                  className={`text-sm font-bold mt-0.5 ${
                                    bt.totalPnlPct >= 0 ? 'text-emerald-300' : 'text-rose-400'
                                  }`}
                                >
                                  {bt.totalPnlPct >= 0 ? '+' : ''}
                                  {bt.totalPnlPct.toFixed(2)}%
                                </div>
                                <div className="text-[10px] text-slate-400 mt-0.5">
                                  {bt.totalPnlUsdt >= 0 ? '+' : ''}
                                  ${bt.totalPnlUsdt.toFixed(0)}
                                </div>
                              </div>

                              <div className="rounded-lg border border-cyan-500/25 bg-cyan-500/[0.06] px-2.5 py-2">
                                <div className="font-sans text-[10px] text-slate-400">
                                  Profit Factor · Сделки
                                </div>
                                <div className="text-sm font-bold text-cyan-300 mt-0.5">
                                  {bt.profitFactor.toFixed(2)}
                                </div>
                                <div className="text-[10px] text-slate-400 mt-0.5">
                                  {bt.tradesCount} сд. · R:R {bt.avgRiskReward}
                                </div>
                              </div>
                            </div>

                            {/* Мини-кривая доходности + счётчик сохранённых сигналов */}
                            <div className="rounded-lg border border-white/8 bg-[#070B12]/90 px-3 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                              <div className="space-y-0.5 text-[11px]">
                                <div className="text-slate-300 font-medium">
                                  Кривая капитала ({activeSignalBacktest.interval.toUpperCase()} OHLCV)
                                </div>
                                <div className="text-[10px] text-slate-400">
                                  Источник: {activeSignalBacktest.dataSource === 'live' ? 'живые свечи биржи' : 'кэш свечей'}
                                  {' · '}Ваших сигналов в истории: <span className="font-mono text-slate-200">{strategyHistoricalMatchesCount}</span>
                                </div>
                              </div>
                              {curvePath && (
                                <svg
                                  viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                                  className="w-full sm:w-44 h-11 shrink-0 overflow-visible"
                                  aria-label="Мини-график кривой доходности стратегии"
                                >
                                  <path
                                    d={curvePath}
                                    fill="none"
                                    stroke={bt.totalPnlPct >= 0 ? '#34D399' : '#FB7185'}
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              )}
                            </div>
                          </div>
                        );
                      })()
                    ) : null}
                  </div>
                )}
              </div>
            )}

            {/* Candlestick Chart */}
            <div className="mt-3">
              {chartEngine === 'tradingview' ? (
                <TradingViewChart symbol={symbol} marketType={marketType} timeframe={timeframe} />
              ) : (
              <CandlestickChart
                candles={candles}
                symbol={symbol}
                showEma={showEma}
                showBollinger={showBollinger}
                showRibbon={showRibbon}
                showSR={isPro && showSR}
                showOrderBlocks={isPro && showOrderBlocks}
                showFvg={isPro && showFvg}
                showBosChoch={isPro && showBosChoch}
                showVpvr={isPro && showVpvr}
                ribbonType={ribbonType}
                ribbonPeriods={ribbonPeriods}
                entryLevel={entryOverlay}
                stopLossLevel={slOverlay}
                takeProfit1Level={tp1Overlay}
                takeProfitLevel={tpOverlay}
                signalDirection={effectiveSignalOverlay?.direction ?? null}
                activeSignalEmittedAt={effectiveSignalOverlay?.emittedAt ?? null}
                signalMarkers={showChartSignals ? pairChartSignals : []}
                selectedSignalId={selectedChartSignalId}
                onSelectSignalMarker={handleSelectChartSignalMarker}
                priceAlerts={priceAlerts.filter((a) => a.symbol === symbol && a.marketType === marketType)}
                draftAlertPrice={draftAlertPrice}
                onPickPriceFromChart={(picked) => {
                  setDraftAlertPrice(picked);
                  setShowQuickAlert(true);
                }}
              />
              )}
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

            {/* Derivatives & Trading Sessions + MAX Anomaly Radar */}
            <div className="mt-4">
              <DerivativesSessionsWidget
                activeTicker={activeTicker ?? null}
                allTickers={tickers}
                isMax={isMax}
                onUpgradeMax={onUpgradeMax ?? onUpgradePro}
                onSelectSymbol={(nextSym) => {
                  setSymbol(nextSym);
                  setActiveResult(null);
                }}
              />
            </div>

            <div className="mt-3 pt-2.5 border-t border-white/6 text-[10px] text-slate-500 leading-relaxed">
              Рыночные данные предоставлены публичными API криптобирж и агрегаторов. Упоминания Binance, Bybit, OKX и TradingView носят исключительно информационный характер и не означают аффилированности.
            </div>
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
                  AI-анализ и риск · {symbol} ({marketType === 'futures' ? 'Фьючерсы' : 'Спот'}, {timeframe.toUpperCase()})
                </h3>
                <p className="mt-0.5 text-xs text-slate-400">
                  Совмещает свечные индикаторы, новостной фон, PRO-лесенку и Paper Trading.
                </p>
              </div>
              <div className="grid grid-cols-3 sm:inline-flex items-center gap-1 p-1 rounded-xl bg-[#0B0F17] border border-white/10 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(8);
                    setAiPanelMode('analysis');
                  }}
                  className={`min-h-[34px] px-2.5 sm:px-3 rounded-lg text-[11px] sm:text-xs font-semibold whitespace-nowrap transition-colors ${
                    aiPanelMode === 'analysis'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Анализ
                </button>
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(8);
                    setAiPanelMode('paper');
                  }}
                  className={`min-h-[34px] px-2 sm:px-3 rounded-lg text-[11px] sm:text-xs font-semibold inline-flex items-center justify-center gap-1 whitespace-nowrap transition-colors ${
                    aiPanelMode === 'paper'
                      ? 'bg-cyan-500 text-slate-950'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <span>Paper</span>
                  <span className="text-[9px] font-mono px-1 rounded bg-black/20">MAX</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(8);
                    setMarketSection('chart');
                  }}
                  className="min-h-[34px] px-2.5 sm:px-3 rounded-lg text-[11px] sm:text-xs font-semibold text-cyan-300 hover:text-cyan-200 hover:bg-white/[0.06] whitespace-nowrap transition-colors"
                >
                  График →
                </button>
              </div>
            </div>

            {aiPanelMode === 'paper' ? (
              <PaperTradingPanel
                symbol={symbol}
                currentPrice={indicators?.lastPrice ?? activeTicker?.price ?? 0}
                allPrices={Object.fromEntries(tickers.map((t) => [t.symbol, t.price]))}
              />
            ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              {/* Left Form */}
              <div className="lg:col-span-6 space-y-4">
                {/* PRO #5: Переключатель Базовый / PRO-лесенка */}
                <div className="flex items-center justify-between gap-2 rounded-xl border border-white/8 bg-[#0B0F17] p-1">
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic(8);
                      setRiskCalcMode('basic');
                    }}
                    className={`flex-1 min-h-[32px] rounded-lg text-xs font-semibold transition-colors ${
                      riskCalcMode === 'basic'
                        ? 'bg-emerald-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Базовый AI-анализ
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic(8);
                      setRiskCalcMode('ladder');
                    }}
                    className={`flex-1 min-h-[32px] rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1 transition-colors ${
                      riskCalcMode === 'ladder'
                        ? 'bg-amber-500 text-slate-950'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {!isPro && <Lock className="w-3 h-3 shrink-0" />}
                    <span>PRO-лесенка (DCA)</span>
                  </button>
                </div>

                {riskCalcMode === 'ladder' ? (
                  <ProLadderCalculator
                    symbol={symbol}
                    marketType={marketType}
                    currentPrice={indicators?.lastPrice ?? activeTicker?.price ?? 0}
                    depositUsdt={depositUsdt}
                    riskPct={riskPct}
                    leverage={leverage}
                    strategyName={activeStrategy?.name}
                  />
                ) : (
                <>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="strategy-select" className="block text-xs font-medium text-slate-300">
                      Стратегия
                    </label>
                    <span className="text-[11px] font-mono tabular-nums text-slate-400">
                      {isPro
                        ? `${tierLabel} (${profile?.creditsRemaining ?? 0}/${totalCreditQuota} кр.) · ${requiredCredits} кр./анализ`
                        : `Стоимость: ${requiredCredits} ${requiredCredits === 1 ? 'кредит' : 'кредита'} · Сигналов сегодня: ${todayStrategySignalsUsed}/${FREE_DAILY_SIGNAL_LIMIT}`}
                    </span>
                  </div>
                  {/* Two-line Strategy Selector (no truncation on mobile) */}
                  <div className="relative">
                    <button
                      id="strategy-select"
                      type="button"
                      aria-expanded={strategyPickerOpen}
                      onClick={() => {
                        triggerHaptic(8);
                        setStrategyPickerOpen((v) => !v);
                      }}
                      className="w-full min-h-[54px] rounded-xl border border-white/12 bg-[#0B0F17] hover:border-emerald-500/40 px-3 py-2 text-left flex items-center justify-between gap-2 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-xs sm:text-sm font-semibold text-white leading-snug">
                          {activeStrategy?.name ?? 'Выберите стратегию'}
                        </div>
                        {activeStrategy && (
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                            <span
                              className={`px-1.5 py-0.2 rounded font-mono font-semibold text-[10px] ${
                                activeStrategy.tier === 'max'
                                  ? 'bg-cyan-500/15 text-cyan-200 border border-cyan-400/35'
                                  : activeStrategy.tier === 'pro'
                                    ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                                    : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                              }`}
                            >
                              {activeStrategy.tier === 'max' ? 'MAX' : activeStrategy.tier === 'pro' ? 'PRO' : 'FREE'}
                            </span>
                            <span>{activeStrategy.riskProfile}</span>
                            <span>·</span>
                            <span className="font-mono uppercase">{activeStrategy.timeframeDefault}</span>
                            <span>·</span>
                            <span className="font-mono text-slate-300">{activeStrategy.creditCost} кр.</span>
                          </div>
                        )}
                      </div>
                      <ChevronDown
                        className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${
                          strategyPickerOpen ? 'rotate-180' : ''
                        }`}
                      />
                    </button>

                    <BottomSheet
                      open={strategyPickerOpen}
                      onClose={() => setStrategyPickerOpen(false)}
                      title="Выбор торговой стратегии"
                      subtitle={`${marketType === 'futures' ? 'Фьючерсы USDT-M' : 'Спот'} · ${filteredStrategies.length} алгоритмов`}
                    >
                      <BottomSheetList className="space-y-2">
                        {filteredStrategies.map((s, idx) => {
                          const isChosen = s.key === activeStrategy?.key;
                          return (
                            <BottomSheetItem key={s.key} index={idx}>
                              <button
                                type="button"
                                onClick={() => {
                                  triggerHaptic(8);
                                  setStrategyKey(s.key);
                                  setLeverage(
                                    s.marketType === 'spot'
                                      ? 1
                                      : isPro
                                        ? s.defaultLeverage
                                        : Math.min(FREE_MAX_LEVERAGE, s.defaultLeverage)
                                  );
                                  setRiskPct(s.defaultRiskPct);
                                  setStrategyPickerOpen(false);
                                }}
                                className={`w-full rounded-2xl border px-3.5 py-3 text-left transition-colors ${
                                  isChosen
                                    ? 'border-emerald-500/45 bg-emerald-500/12'
                                    : 'border-white/8 bg-[var(--surface-0)] hover:border-white/15'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-sm font-semibold text-white">{s.name}</span>
                                  <span
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold shrink-0 ${
                                      s.tier === 'max'
                                        ? 'bg-cyan-500/15 text-cyan-200 border border-cyan-400/35'
                                        : s.tier === 'pro'
                                          ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                                          : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                    }`}
                                  >
                                    {s.tier === 'max' ? 'MAX' : s.tier === 'pro' ? 'PRO' : 'FREE'}
                                  </span>
                                </div>
                                <div className="mt-1 text-xs text-slate-400">
                                  {s.riskProfile} · ТФ {s.timeframeDefault.toUpperCase()} · {s.shortTag} · {s.creditCost} кр.
                                </div>
                              </button>
                            </BottomSheetItem>
                          );
                        })}
                      </BottomSheetList>
                    </BottomSheet>
                  </div>
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
                    <div
                      className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs ${
                        activeStrategy?.tier === 'max'
                          ? 'border-cyan-400/35 bg-cyan-500/10 text-cyan-100'
                          : 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                      }`}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <Lock
                          className={`w-3.5 h-3.5 shrink-0 ${
                            activeStrategy?.tier === 'max' ? 'text-cyan-300' : 'text-amber-400'
                          }`}
                        />
                        <span>
                          Алгоритм «{activeStrategy?.name}» доступен только в подписке{' '}
                          {activeStrategy?.tier === 'max' ? 'MAX' : 'PRO'}.
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={activeStrategy?.tier === 'max' ? (onUpgradeMax ?? onUpgradePro) : onUpgradePro}
                        className={`font-semibold hover:underline whitespace-nowrap ${
                          activeStrategy?.tier === 'max' ? 'text-cyan-300' : 'text-amber-300'
                        }`}
                      >
                        {activeStrategy?.tier === 'max' ? 'Открыть MAX →' : 'Открыть PRO →'}
                      </button>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="flex items-center justify-between gap-1.5 mb-1">
                      <label htmlFor="deposit-input" className="block text-xs text-slate-400 truncate">
                        Депозит (USDT)
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          triggerHaptic(8);
                          if (portfolioBalanceUsdt > 0) {
                            const rounded = Math.max(10, Math.round(portfolioBalanceUsdt));
                            setDepositUsdt(rounded);
                            setPortfolioDepositHint(`Подставлен баланс портфеля ($${rounded.toLocaleString('en-US')})`);
                          } else {
                            const paperBal = Math.max(10, Math.round(readPaperAccount().balanceUsdt || 10000));
                            setDepositUsdt(paperBal);
                            setPortfolioDepositHint(`Портфель $0 — подставлен Paper-счёт ($${paperBal.toLocaleString('en-US')})`);
                          }
                        }}
                        className="text-[10.5px] font-semibold text-emerald-300 hover:text-emerald-200 whitespace-nowrap shrink-0 transition-colors"
                      >
                        Из портфеля
                      </button>
                    </div>
                    <input
                      id="deposit-input"
                      type="number"
                      min={10}
                      max={10000000}
                      value={depositUsdt}
                      onChange={(e) => {
                        setDepositUsdt(Math.max(10, Number(e.target.value)));
                        if (portfolioDepositHint) setPortfolioDepositHint(null);
                      }}
                      className="w-full min-h-[40px] rounded-xl border border-white/10 bg-[#0B0F17] px-3 text-sm font-mono text-white focus:border-emerald-500 focus:outline-none"
                    />
                    {portfolioDepositHint && (
                      <div className="mt-1 text-[10px] text-emerald-300/90 leading-snug">
                        {portfolioDepositHint}
                      </div>
                    )}
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
                            ? `Месячный пакет кредитов ${tierLabel} исчерпан (${profile?.creditsRemaining ?? 0}/${totalCreditQuota})`
                            : `Лимит бесплатных кредитов достигнут (${profile?.creditsRemaining ?? 0}/${totalCreditQuota})`}
                        </div>
                        <p className="text-amber-200/80">
                          {isPro
                            ? `Для запуска анализа требуется ${requiredCredits} кр. Продлите подписку ${tierLabel}, чтобы сразу пополнить +${totalCreditQuota} кредитов.`
                            : `Для этой операции нужно ${requiredCredits} кр. Перейдите на PRO (${PRO_MONTHLY_QUOTA} кр./мес) или MAX (${MAX_MONTHLY_QUOTA} кр./мес): все ${STRATEGY_CATALOG.length} стратегий и безлимит сигналов.`}
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
                        {isPro ? `Продлить ${tierLabel} (+${totalCreditQuota} кр.)` : `Перейти на PRO (${PRO_MONTHLY_QUOTA} кр./мес.)`}
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
                        : isMax
                          ? `Запустить MAX-анализ · 6 ист. (${requiredCredits} кр.)`
                          : isPro
                            ? `Запустить PRO-анализ (${requiredCredits} кр.)`
                            : `Проверить рынок (${requiredCredits} ${requiredCredits === 1 ? 'кредит' : 'кредита'})`}
                    </span>
                  </motion.button>
                )}
                </>
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

                    {(activeResult.direction === 'LONG' || activeResult.direction === 'SHORT') && (
                      <div className="rounded-xl border border-white/10 bg-[#111827] p-3 space-y-2">
                        {(() => {
                          const tradeKeys = exchangeKeys.filter((k) => k.enabled && k.permissions === 'trade');
                          const chosenKey =
                            tradeKeys.find((k) => k.id === selectedExecKeyId) ?? tradeKeys[0] ?? null;
                          const refEntry =
                            parseFirstPrice(activeResult.entryZone) ?? indicators?.lastPrice ?? 0;
                          const rawQty =
                            refEntry > 0
                              ? activeResult.riskMetrics.positionSizeUsdt / refEntry
                              : 0;
                          const suggestedQty = Number(rawQty.toFixed(refEntry >= 1000 ? 4 : 2));
                          const orderSide: 'BUY' | 'SELL' =
                            activeResult.direction === 'LONG' ? 'BUY' : 'SELL';

                          if (!chosenKey || !onPlaceExchangeOrder) {
                            return (
                              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                                <span>
                                  Хотите исполнить сигнал в 1 клик на Binance, Bybit или OKX?
                                </span>
                                {onOpenExchangeIntegrations && (
                                  <button
                                    type="button"
                                    onClick={onOpenExchangeIntegrations}
                                    className="text-emerald-400 hover:text-emerald-300 font-semibold whitespace-nowrap"
                                  >
                                    Подключить биржу →
                                  </button>
                                )}
                              </div>
                            );
                          }

                          return (
                            <>
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-[11px] font-medium text-slate-300">
                                  Исполнение на подключённой бирже
                                </span>
                                {tradeKeys.length > 1 ? (
                                  <select
                                    value={chosenKey.id}
                                    onChange={(e) => setSelectedExecKeyId(e.target.value)}
                                    className="rounded-lg border border-white/10 bg-[#0B0F17] px-2 py-1 text-[11px] text-white"
                                  >
                                    {tradeKeys.map((k) => (
                                      <option key={k.id} value={k.id}>
                                        {k.exchange.toUpperCase()} · {k.label}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <span className="text-[11px] font-mono text-cyan-300">
                                    {chosenKey.exchange.toUpperCase()} · {chosenKey.label}
                                  </span>
                                )}
                              </div>

                              <NonCustodialRiskNotice
                                text="VERNIER не принимает и не хранит ваши средства. При каждом запуске ордера через API биржи требуется ваше явное подтверждение согласия и личной финансовой ответственности."
                              />

                              <button
                                type="button"
                                disabled={executingSignalOrder || suggestedQty <= 0}
                                onClick={() => {
                                  if (!chosenKey || suggestedQty <= 0) return;
                                  setExecutingSignalOrder(true);
                                  setSignalOrderStatus(null);
                                  const sl = parseFirstPrice(activeResult.stopLoss) ?? undefined;
                                  const tp = parseFirstPrice(activeResult.takeProfits[0]) ?? undefined;
                                  void onPlaceExchangeOrder(chosenKey, {
                                    symbol,
                                    marketType,
                                    side: orderSide,
                                    orderType: 'MARKET',
                                    quantity: suggestedQty,
                                    stopLoss: sl,
                                    takeProfit: tp,
                                  })
                                    .then((ord) => {
                                      setSignalOrderStatus({
                                        tone: 'ok',
                                        text: `Ордер #${ord.orderId || 'OK'} отправлен на ${ord.exchange.toUpperCase()} (${ord.side} ${ord.executedQty} ${ord.symbol}).`,
                                      });
                                    })
                                    .catch((err) => {
                                      setSignalOrderStatus({
                                        tone: 'err',
                                        text: err instanceof Error ? err.message : 'Ошибка ордера.',
                                      });
                                    })
                                    .finally(() => setExecutingSignalOrder(false));
                                }}
                                className={`w-full min-h-[38px] px-3 rounded-lg text-xs font-semibold text-white transition-colors disabled:opacity-50 ${
                                  orderSide === 'BUY'
                                    ? 'bg-emerald-600 hover:bg-emerald-500'
                                    : 'bg-rose-600 hover:bg-rose-500'
                                }`}
                              >
                                {executingSignalOrder
                                  ? 'Ожидание подтверждения / отправка...'
                                  : `Открыть ${activeResult.direction} на ${chosenKey.exchange.toUpperCase()} через API (~${suggestedQty} ${symbol.replace('USDT', '')})`}
                              </button>

                              {signalOrderStatus && (
                                <div
                                  className={`text-[11px] px-2.5 py-1.5 rounded-lg border ${
                                    signalOrderStatus.tone === 'ok'
                                      ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200'
                                      : 'border-rose-500/35 bg-rose-500/10 text-rose-200'
                                  }`}
                                >
                                  {signalOrderStatus.text}
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    )}

                    {/* 1-tap Order Transfer Card + GenAI Compliance Footer */}
                    {(() => {
                      const parsedEntry = parseFirstPrice(activeResult.entryZone) ?? indicators?.lastPrice ?? 0;
                      const parsedSl = parseFirstPrice(activeResult.stopLoss) ?? parsedEntry * 0.98;
                      const parsedTp1 = parseFirstPrice(activeResult.takeProfits[0]) ?? parsedEntry * 1.03;
                      return (
                        <>
                          {parsedEntry > 0 && activeResult.direction !== 'WAIT' && (
                            <OrderTransferCard
                              symbol={symbol}
                              direction={activeResult.direction}
                              entryText={formatUsd(parsedEntry)}
                              stopLossText={formatUsd(parsedSl)}
                              tp1Text={formatUsd(parsedTp1)}
                              volumeUsdtText={String(Math.round(activeResult.riskMetrics.positionSizeUsdt))}
                              leverage={activeResult.riskMetrics.recommendedLeverage || leverage}
                              compact
                            />
                          )}
                          <AiComplianceFooter
                            sourceLabel={`${symbol} · ${activeStrategy?.name ?? 'AI-анализ'}`}
                            snippet={activeResult.summary}
                          />
                        </>
                      );
                    })()}
                  </div>
                ) : (
                  /* Live Preview Calculation before running deep AI scan */
                  (() => {
                    const lastP = indicators?.lastPrice ?? activeTicker?.price ?? 0;
                    const atrVal = indicators?.atr14 ?? (lastP > 0 ? lastP * 0.015 : 0);
                    const isBullPreview = (indicators?.trendBias ?? 'BULLISH') !== 'BEARISH';
                    const previewDir: 'LONG' | 'SHORT' = isBullPreview ? 'LONG' : 'SHORT';
                    const slDist = Math.max(atrVal * 1.35, lastP * 0.012);
                    const previewSl = isBullPreview ? Math.max(0.0001, lastP - slDist) : lastP + slDist;
                    const previewTp1 = isBullPreview ? lastP + slDist * 1.6 : Math.max(0.0001, lastP - slDist * 1.6);
                    const previewTp2 = isBullPreview ? lastP + slDist * 2.6 : Math.max(0.0001, lastP - slDist * 2.6);
                    const previewTp3 = isBullPreview ? lastP + slDist * 3.8 : Math.max(0.0001, lastP - slDist * 3.8);
                    const slPct = lastP > 0 ? (Math.abs(lastP - previewSl) / lastP) * 100 : 1.5;
                    const tp1Pct = lastP > 0 ? (Math.abs(previewTp1 - lastP) / lastP) * 100 : 2.4;
                    const riskUsd = (depositUsdt * riskPct) / 100;
                    const previewPosUsdt = slPct > 0 ? Math.min(depositUsdt * leverage, riskUsd / (slPct / 100)) : depositUsdt;

                    return (
                      <div className="rounded-xl bg-[#0B0F17] border border-emerald-500/25 p-4 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Bot className="w-4 h-4 text-emerald-400" />
                            <span className="text-xs font-semibold text-white">
                              Предпросмотр сетапа · {symbol}
                            </span>
                          </div>
                          <span
                            className={`px-2 py-0.5 rounded-md text-[11px] font-mono font-bold ${
                              previewDir === 'LONG'
                                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                            }`}
                          >
                            {previewDir} · LIVE PREVIEW
                          </span>
                        </div>

                        {lastP > 0 ? (
                          <>
                            <div className="grid grid-cols-2 gap-2 text-xs font-mono tabular-nums">
                              <div className="rounded-lg border border-white/8 bg-[#111827] p-2.5">
                                <div className="font-sans text-[11px] text-slate-400">Зона входа</div>
                                <div className="mt-0.5 text-white font-semibold">{formatUsd(lastP)}</div>
                              </div>
                              <div className="rounded-lg border border-white/8 bg-[#111827] p-2.5">
                                <div className="font-sans text-[11px] text-slate-400">Stop-Loss (ATR)</div>
                                <div className="mt-0.5 text-rose-400 font-semibold">
                                  {formatUsd(previewSl)} <span className="text-[10px]">(-{slPct.toFixed(2)}%)</span>
                                </div>
                              </div>
                              <div className="rounded-lg border border-white/8 bg-[#111827] p-2.5">
                                <div className="font-sans text-[11px] text-slate-400">TP1 / TP2 / TP3</div>
                                <div className="mt-0.5 text-emerald-400 font-semibold text-[11px]">
                                  {formatUsd(previewTp1)} (+{tp1Pct.toFixed(1)}%)
                                </div>
                                <div className="text-[10px] text-slate-400">
                                  {formatUsd(previewTp2)} · {formatUsd(previewTp3)}
                                </div>
                              </div>
                              <div className="rounded-lg border border-white/8 bg-[#111827] p-2.5">
                                <div className="font-sans text-[11px] text-slate-400">R:R / Объём</div>
                                <div className="mt-0.5 text-amber-300 font-semibold">1 : 2.6</div>
                                <div className="text-[10px] text-slate-300">
                                  ~${Math.round(previewPosUsdt).toLocaleString('en-US')}
                                </div>
                              </div>
                            </div>

                            <OrderTransferCard
                              symbol={symbol}
                              direction={previewDir}
                              entryText={formatUsd(lastP)}
                              stopLossText={formatUsd(previewSl)}
                              tp1Text={formatUsd(previewTp1)}
                              volumeUsdtText={String(Math.round(previewPosUsdt))}
                              leverage={marketType === 'futures' ? leverage : 1}
                              compact
                            />
                          </>
                        ) : (
                          <p className="text-xs text-slate-400">
                            Загружаем свечные индикаторы для расчёта предварительных уровней...
                          </p>
                        )}
                      </div>
                    );
                  })()
                )}

                {/* PRO Multi-Timeframe Consensus (15m + 1H + 4H) */}
                <div className="rounded-xl border border-amber-500/25 bg-[#0B0F17] p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-amber-400" />
                      <span>Мульти-таймфрейм консенсус (15m · 1H · 4H)</span>
                    </span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                      PRO
                    </span>
                  </div>
                  {isPro ? (
                    <div className="grid grid-cols-3 gap-2 text-xs font-mono tabular-nums">
                      {(
                        [
                          {
                            tf: '15m',
                            bias: (indicators?.rsi14 ?? 50) >= 52 ? 'BULL' : (indicators?.rsi14 ?? 50) <= 45 ? 'BEAR' : 'FLAT',
                          },
                          {
                            tf: '1H',
                            bias:
                              indicators?.trendBias === 'BULLISH'
                                ? 'BULL'
                                : indicators?.trendBias === 'BEARISH'
                                  ? 'BEAR'
                                  : 'FLAT',
                          },
                          {
                            tf: '4H',
                            bias: (indicators?.lastPrice ?? 0) >= (indicators?.ema200 ?? 0) ? 'BULL' : 'BEAR',
                          },
                        ] as const
                      ).map((row) => (
                        <div
                          key={row.tf}
                          className="rounded-lg border border-white/8 bg-[#111827] px-2.5 py-2 text-center"
                        >
                          <div className="text-[10px] text-slate-400">{row.tf}</div>
                          <div
                            className={`mt-1 font-bold inline-flex items-center justify-center gap-1 whitespace-nowrap text-[11px] sm:text-xs ${
                              row.bias === 'BULL'
                                ? 'text-emerald-400'
                                : row.bias === 'BEAR'
                                  ? 'text-rose-400'
                                  : 'text-amber-300'
                            }`}
                          >
                            <span className="leading-none">
                              {row.bias === 'BULL' ? '▲' : row.bias === 'BEAR' ? '▼' : '•'}
                            </span>
                            <span className="leading-none">
                              {row.bias === 'BULL' ? 'ЛОНГ' : row.bias === 'BEAR' ? 'ШОРТ' : 'ФЛЭТ'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
                      <span>Синхронное подтверждение тренда сразу по 3 таймфреймам.</span>
                      <button
                        type="button"
                        onClick={onUpgradePro}
                        className="text-amber-300 hover:underline font-semibold shrink-0"
                      >
                        Открыть PRO →
                      </button>
                    </div>
                  )}
                </div>

                {/* MAX #1: Интерактивный 3-агентный AI-Консилиум */}
                <AiConsiliumMaxPanel
                  symbol={symbol}
                  timeframe={timeframe}
                  indicators={indicators}
                  activeTicker={activeTicker ?? null}
                  fundingRatePct={fundingRatePct ?? null}
                  depositUsdt={depositUsdt}
                  riskPct={riskPct}
                />
              </div>
            </div>
            )}
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

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4 text-xs">
                  <div
                    key={`osc-rsi-${symbol}-${timeframe}-${telemetryAnimVersion}`}
                    style={{ '--stagger-idx': 0 } as React.CSSProperties}
                    className="signal-card-enter signal-card-stagger rounded-xl bg-[#0B0F17] border border-white/8 p-3.5 sm:p-4 space-y-2 min-w-0"
                  >
                    <div className="flex items-center justify-between gap-2 min-w-0">
                      <span className="text-slate-400 truncate">Индекс RSI (14)</span>
                      <span
                        className={`font-mono tabular-nums font-bold shrink-0 ${
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
                    <div className="text-[11px] text-slate-500 leading-snug">
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
                    className="signal-card-enter signal-card-stagger rounded-xl bg-[#0B0F17] border border-white/8 p-3.5 sm:p-4 space-y-2 min-w-0"
                  >
                    <div className="flex items-center justify-between gap-2 min-w-0">
                      <span className="text-slate-400 truncate">Позиция в Bollinger %B</span>
                      <span className="font-mono tabular-nums font-bold text-slate-100 shrink-0">{bbPercentB}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-white/8 overflow-hidden">
                      <motion.div
                        initial={false}
                        animate={{ width: `${Math.max(4, bbPercentB)}%` }}
                        transition={{ duration: 0.35 }}
                        className="h-full rounded-full bg-gradient-to-r from-sky-500 to-indigo-400"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-0.5 min-w-0">
                      <div className="rounded-lg bg-white/[0.03] border border-white/6 px-2 py-1 min-w-0">
                        <div className="text-[10px] text-slate-500 leading-none">Нижн. полоса</div>
                        <div className="mt-1 text-[11px] font-mono tabular-nums text-slate-200 font-medium whitespace-nowrap truncate">
                          {formatUsd(indicators.bbLower)}
                        </div>
                      </div>
                      <div className="rounded-lg bg-white/[0.03] border border-white/6 px-2 py-1 text-right min-w-0">
                        <div className="text-[10px] text-slate-500 leading-none">Верхн. полоса</div>
                        <div className="mt-1 text-[11px] font-mono tabular-nums text-slate-200 font-medium whitespace-nowrap truncate">
                          {formatUsd(indicators.bbUpper)}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div
                    key={`osc-ema-${symbol}-${timeframe}-${telemetryAnimVersion}`}
                    style={{ '--stagger-idx': 2 } as React.CSSProperties}
                    className="signal-card-enter signal-card-stagger rounded-xl bg-[#0B0F17] border border-white/8 p-3.5 sm:p-4 space-y-2 min-w-0"
                  >
                    <div className="flex items-center justify-between gap-2 min-w-0">
                      <span className="text-slate-400 truncate">Дистанция до EMA(200)</span>
                      <span
                        className={`font-mono tabular-nums font-bold shrink-0 ${
                          ema200DeltaPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {ema200DeltaPct >= 0 ? '+' : ''}
                        {ema200DeltaPct}%
                      </span>
                    </div>
                    <div className="text-xs font-mono tabular-nums text-slate-200">
                      EMA 200: {formatUsd(indicators.ema200)}
                    </div>
                    <div className="text-[11px] text-slate-500 leading-snug">
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

      {/* Pair Selector BottomSheet (Quick Search + Favorites / Spot / Futures + Live Prices) */}
      <BottomSheet
        open={pairSheetOpen}
        onClose={() => setPairSheetOpen(false)}
        title="Выбор торговой пары"
        subtitle={`${enrichedPairs.length} ликвидных пар · ${marketType === 'futures' ? 'Фьючерсы USDT-M' : 'Спот'}`}
        bodyClassName="p-3.5 space-y-3"
      >
        {/* Quick Search Input */}
        <div className="space-y-1.5">
          <div className="relative flex items-center">
            <Search className="w-4 h-4 text-slate-400 pointer-events-none absolute left-3" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => {
                const next = e.target.value;
                const dlp = detectSensitiveWalletInput(next);
                if (dlp.blocked) {
                  setDlpSearchAlert(DLP_WARNING_MESSAGE);
                  setSearchQuery('');
                  return;
                }
                setDlpSearchAlert(null);
                setSearchQuery(next);
              }}
              placeholder="Поиск пары: BTC, ETH, SOL, DeFi..."
              aria-label="Поиск торговой пары"
              className="w-full min-h-[42px] rounded-xl border border-white/12 bg-[var(--surface-0)] pl-9 pr-9 text-sm text-white placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Очистить поиск"
                className="absolute right-2 min-h-[30px] min-w-[30px] rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 inline-flex items-center justify-center"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {dlpSearchAlert && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/12 px-3 py-2 text-xs text-rose-200 flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{dlpSearchAlert}</span>
            </div>
          )}
        </div>

        {/* 3-Segment Tabs: Избранное / Спот / Фьючерсы */}
        <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-[var(--surface-0)] border border-white/10">
          {(
            [
              { id: 'favorites' as const, label: `Избр. (${favoriteSymbols.length})` },
              { id: 'spot' as const, label: 'Спот' },
              { id: 'futures' as const, label: 'Фьючерсы' },
            ] as const
          ).map((tab) => {
            const active = pairSheetTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  triggerHaptic(8);
                  setPairSheetTab(tab.id);
                  if (tab.id === 'spot' && marketType !== 'spot') {
                    setMarketType('spot');
                    setActiveResult(null);
                  } else if (tab.id === 'futures' && marketType !== 'futures') {
                    setMarketType('futures');
                    setActiveResult(null);
                  }
                }}
                className={`min-h-[36px] rounded-lg text-xs font-semibold transition-colors ${
                  active
                    ? tab.id === 'futures'
                      ? 'bg-amber-500 text-slate-950'
                      : 'bg-emerald-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Live Pair Rows */}
        {(() => {
          const baseList = normalizedSearch ? instantSearchResults : enrichedPairs;
          const sheetPairs =
            pairSheetTab === 'favorites'
              ? baseList.filter((item) => item.isFavorite)
              : baseList;
          if (sheetPairs.length === 0) {
            return (
              <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] p-6 text-center text-xs text-slate-400 space-y-2">
                <div>
                  {pairSheetTab === 'favorites'
                    ? 'В избранном пока нет пар. Нажмите на звёздочку рядом с монетой.'
                    : `По запросу «${searchQuery.trim()}» пары не найдены.`}
                </div>
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="text-emerald-300 font-semibold"
                  >
                    Сбросить поиск
                  </button>
                )}
              </div>
            );
          }
          return (
            <BottomSheetList className="divide-y divide-white/8 rounded-2xl border border-white/8 bg-[var(--surface-0)] overflow-hidden">
              {sheetPairs.map((item, idx) => {
                const isSelected = item.symbol === symbol;
                return (
                  <BottomSheetItem
                    key={item.symbol}
                    index={idx}
                    className={`px-3 py-2.5 flex items-center justify-between gap-2 transition-colors ${
                      isSelected ? 'bg-emerald-500/14' : 'hover:bg-white/[0.03]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        triggerHaptic(8);
                        toggleFavoriteSymbol(item.symbol);
                      }}
                      aria-label={item.isFavorite ? `Убрать ${item.baseAsset} из избранного` : `Добавить ${item.baseAsset} в избранное`}
                      className="min-h-[38px] min-w-[34px] flex items-center justify-center rounded-lg text-slate-500 hover:text-amber-300 shrink-0"
                    >
                      <Star className={`w-4 h-4 ${item.isFavorite ? 'fill-amber-400 text-amber-300' : ''}`} />
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic(8);
                        setSymbol(item.symbol);
                        setActiveResult(null);
                        setPairSheetOpen(false);
                      }}
                      className="flex-1 min-w-0 min-h-[42px] flex items-center justify-between gap-3 text-left"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-white flex items-center gap-1.5">
                          <span>{item.baseAsset}</span>
                          <span className="text-slate-500 font-normal text-xs">/ USDT</span>
                          {isSelected && (
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                              Активна
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400 truncate">
                          {item.name}
                          {item.category ? ` · ${item.category}` : ''}
                        </div>
                      </div>

                      <div className="text-right font-mono tabular-nums shrink-0">
                        <div className="text-xs sm:text-sm font-semibold text-white whitespace-nowrap">
                          {item.price !== null ? formatUsd(item.price) : '—'}
                        </div>
                        <div
                          className={`text-[11px] font-semibold whitespace-nowrap ${
                            (item.change24hPct ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {item.change24hPct !== null
                            ? `${item.change24hPct >= 0 ? '+' : ''}${item.change24hPct.toFixed(2)}%`
                            : '—'}
                        </div>
                      </div>
                    </button>
                  </BottomSheetItem>
                );
              })}
            </BottomSheetList>
          );
        })()}
      </BottomSheet>

      {/* Filters & Sort BottomSheet */}
      <BottomSheet
        open={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        title="Фильтры и сортировка"
        subtitle="Применяется к обзору пар и ленте активов"
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-300">Быстрый фильтр</div>
            <BottomSheetList className="grid grid-cols-2 gap-2">
              {filterMeta.map((item, idx) => {
                const isActive = assetFilter === item.id;
                return (
                  <BottomSheetItem key={item.id} index={idx}>
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic(8);
                        setAssetFilter(item.id);
                      }}
                      className={`w-full min-h-[44px] px-3 rounded-xl border text-left text-xs font-medium flex items-center justify-between gap-2 transition-colors ${
                        isActive
                          ? 'border-emerald-400/50 bg-emerald-500/15 text-emerald-200'
                          : 'border-white/10 bg-[var(--surface-0)] text-slate-300 hover:border-white/20'
                      }`}
                    >
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className="shrink-0">{item.icon}</span>
                        <span className="truncate">{item.label}</span>
                      </span>
                      <span className="font-mono tabular-nums text-[11px] text-slate-400 shrink-0">
                        {item.count}
                      </span>
                    </button>
                  </BottomSheetItem>
                );
              })}
            </BottomSheetList>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <ArrowUpDown className="w-3.5 h-3.5 text-cyan-400" />
              <span>Сортировка списка</span>
            </div>
            <BottomSheetList className="space-y-1.5">
              {(
                [
                  { id: 'default' as const, label: 'По умолчанию (популярные)' },
                  { id: 'change_desc' as const, label: '24ч %: сначала лидеры роста' },
                  { id: 'change_asc' as const, label: '24ч %: сначала падение' },
                  { id: 'price_desc' as const, label: 'Цена: по убыванию' },
                  { id: 'price_asc' as const, label: 'Цена: по возрастанию' },
                  { id: 'name_asc' as const, label: 'Имя: А → Я' },
                  { id: 'name_desc' as const, label: 'Имя: Я → А' },
                ] as const
              ).map((opt, idx) => {
                const selected = assetSort === opt.id;
                return (
                  <BottomSheetItem key={opt.id} index={idx}>
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic(8);
                        setAssetSort(opt.id);
                      }}
                      className={`w-full min-h-[44px] px-3.5 rounded-xl border text-left text-xs font-medium flex items-center justify-between gap-2 transition-colors ${
                        selected
                          ? 'border-cyan-400/50 bg-cyan-500/14 text-cyan-200'
                          : 'border-white/8 bg-[var(--surface-0)] text-slate-300 hover:border-white/15'
                      }`}
                    >
                      <span>{opt.label}</span>
                      {selected && <Check className="w-4 h-4 text-cyan-300 shrink-0" />}
                    </button>
                  </BottomSheetItem>
                );
              })}
            </BottomSheetList>
          </div>

          <button
            type="button"
            onClick={() => setFilterSheetOpen(false)}
            className="w-full min-h-[46px] rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors"
          >
            Применить
          </button>
        </div>
      </BottomSheet>

      {/* Fullscreen Candlestick Chart Portal Overlay */}
      {chartFullscreen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[9990] bg-[var(--surface-0)] flex flex-col"
            role="dialog"
            aria-modal="true"
            aria-label={`Полноэкранный график ${symbol}`}
          >
            <div className="px-3 sm:px-5 py-2.5 border-b border-white/10 bg-[var(--surface-1)] flex flex-wrap items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0 font-mono tabular-nums">
                <span className="text-sm sm:text-base font-bold text-white">
                  {activeTicker ? `${activeTicker.baseAsset}/USDT` : symbol}
                </span>
                <span className="text-sm font-bold text-emerald-300">
                  {indicators ? formatUsd(indicators.lastPrice) : activeTicker ? formatUsd(activeTicker.price) : '—'}
                </span>
                {activeTicker && (
                  <span
                    className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                      activeTicker.change24hPct >= 0
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : 'bg-rose-500/15 text-rose-300'
                    }`}
                  >
                    {activeTicker.change24hPct >= 0 ? '+' : ''}
                    {activeTicker.change24hPct.toFixed(2)}%
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <div className="inline-flex p-0.5 rounded-xl bg-[var(--surface-0)] border border-white/10">
                  {(['15m', '1h', '4h', '1d'] as Timeframe[]).map((tf) => (
                    <button
                      key={tf}
                      type="button"
                      onClick={() => setTimeframe(tf)}
                      className={`min-h-[32px] px-2.5 rounded-lg text-[11px] font-mono font-semibold transition-colors ${
                        timeframe === tf
                          ? 'bg-emerald-600 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {tf.toUpperCase()}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(8);
                    setChartFullscreen(false);
                  }}
                  aria-label="Выйти из полноэкранного режима"
                  className="min-h-[36px] px-3 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 text-xs font-semibold text-white inline-flex items-center gap-1.5"
                >
                  <Minimize2 className="w-4 h-4 text-emerald-400" />
                  <span>Закрыть</span>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-3 sm:p-5 flex flex-col justify-center">
              {chartEngine === 'tradingview' ? (
                <TradingViewChart symbol={symbol} marketType={marketType} timeframe={timeframe} />
              ) : (
                <CandlestickChart
                  candles={candles}
                  symbol={symbol}
                  showEma={showEma}
                  showBollinger={showBollinger}
                  showRibbon={showRibbon}
                  showSR={isPro && showSR}
                  showOrderBlocks={isPro && showOrderBlocks}
                  showFvg={isPro && showFvg}
                  showBosChoch={isPro && showBosChoch}
                  showVpvr={isPro && showVpvr}
                  ribbonType={ribbonType}
                  ribbonPeriods={ribbonPeriods}
                  entryLevel={entryOverlay}
                  stopLossLevel={slOverlay}
                  takeProfit1Level={tp1Overlay}
                  takeProfitLevel={tpOverlay}
                  signalDirection={effectiveSignalOverlay?.direction ?? null}
                  activeSignalEmittedAt={effectiveSignalOverlay?.emittedAt ?? null}
                  signalMarkers={showChartSignals ? pairChartSignals : []}
                  selectedSignalId={selectedChartSignalId}
                  onSelectSignalMarker={handleSelectChartSignalMarker}
                  priceAlerts={priceAlerts.filter((a) => a.symbol === symbol && a.marketType === marketType)}
                  draftAlertPrice={draftAlertPrice}
                  onPickPriceFromChart={(picked) => {
                    setDraftAlertPrice(picked);
                    setShowQuickAlert(true);
                    setChartFullscreen(false);
                  }}
                />
              )}
            </div>
          </div>,
          document.body
        )}

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
