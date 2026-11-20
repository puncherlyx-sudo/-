import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BellRing,
  BookOpen,
  Calculator,
  Check,
  CheckCircle2,
  CircleOff,
  Clock,
  Copy,
  Crown,
  Download,
  Gauge,
  Info,
  KeyRound,
  Layers,
  LineChart,
  Link2,
  Lock,
  PauseCircle,
  Plus,
  Radar,
  Radio,
  RefreshCw,
  Send,
  ShieldCheck,
  Sliders,
  Sparkles,
  Trash2,
  TrendingUp,
  Webhook,
  Wifi,
  X,
  Zap,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { usePlan } from '../contexts/PlanContext';
import {
  FREE_DAILY_SIGNAL_LIMIT,
  FREE_MAX_LEVERAGE,
  FREE_WEEKLY_QUOTA,
  FUTURES_STRATEGIES_COUNT,
  MAX_EXCLUSIVE_STRATEGIES_COUNT,
  MAX_X10_MONTHLY_QUOTA,
  MAX_X20_MONTHLY_QUOTA,
  PRO_AND_FREE_STRATEGIES_COUNT,
  PRO_MONTHLY_QUOTA,
  SPOT_STRATEGIES_COUNT,
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
import { authFetch } from '../lib/authFetch';
import { downloadCsvWithBom } from '../lib/csvExport';
import type { ExchangeSyncCacheMap } from '../lib/exchangeSyncCache';
import {
  classifyExchangeSyncError,
  type ExchangeSyncErrorLogEntry,
} from '../lib/exchangeSyncErrorLog';
import { triggerHaptic } from '../lib/securityDlp';
import { runLocalLiveScanner } from '../lib/localAnalyticsEngine';
import { useLiveMarketSnapshot, useLiveTicker } from '../stores/liveMarketStore';
import { isPageVisible, subscribePageVisibility } from '../utils/cache';
import { parseJsonResponse } from '../utils/safeFetchJson';
import type {
  AnalysisRecord,
  ExchangeKeyRecord,
  ExchangeOrderResult,
  LiveScannerOpportunity,
  LiveScannerReport,
  MarketType,
  PlanTier,
  StrategyBreakdownResult,
  StrategyConfig,
  StrategyLiveTelemetry,
  StrategyPerformanceReport,
  UserProfile,
} from '../types/domain';
import {
  deleteCustomNoCodeStrategy,
  readCustomNoCodeStrategies,
  VERNIER_PRO_MAX_EVENT,
  type CustomNoCodeStrategy,
} from '../lib/proMaxStore';
import {
  buildStrategySignalOverlay,
  calculateSignalProgress,
  ENGINE_STATE_META,
  executeLiveStrategyOrder,
  prepareLiveExecutionIntent,
  readLiveExecutionPrefs,
  resolveStrategyStatusBadge,
  runPaperSimulationStep,
  saveLiveExecutionPrefs,
  strategyEventStream,
  strategyStateMachine,
  verifyLiveExchangeConnection,
  type ActiveStrategySignalOverlay,
  type StrategyEngineState,
  type StrategyOperatingMode,
  type StrategySignalEvent,
  type StrategyStreamStatus,
} from '../lib/strategyEngine';
import { AdvancedMarketSentiment } from './AdvancedMarketSentiment';
import { ExchangeApiGuideModal } from './ExchangeApiGuide';
import { FeatureGuide } from './FeatureGuide';
import { StaggerDeck, WorkspaceShell } from './MotionPrimitives';
import { PositionSizeCalculator } from './PositionSizeCalculator';
import { StrategyPnlChart } from './StrategyPnlChart';
import { StrategyComparisonPanel } from './StrategyProMaxTools';
import { NonCustodialRiskNotice } from './TradeRiskConfirmModal';

const MonteCarloSimulator = lazy(() =>
  import('./MonteCarloSimulator').then((m) => ({ default: m.MonteCarloSimulator }))
);
const TradeJournal = lazy(() =>
  import('./TradeJournal').then((m) => ({ default: m.TradeJournal }))
);
const NoCodeStrategyBuilderModal = lazy(() =>
  import('./StrategyProMaxTools').then((m) => ({ default: m.NoCodeStrategyBuilderModal }))
);
const WebhookBuilderModal = lazy(() =>
  import('./WebhookBuilderModal').then((m) => ({ default: m.WebhookBuilderModal }))
);

export type StrategiesSection =
  | 'catalog'
  | 'signals'
  | 'scanner'
  | 'sentiment'
  | 'analytics'
  | 'calculator'
  | 'journal'
  | 'plans';
type StrategyExecutionMode = 'signals' | 'api_confirm';
const EXEC_MODE_STORAGE_KEY = 'vernier_strategy_exec_mode_v1';
const PLACED_ORDERS_STORAGE_KEY = 'vernier_strategy_placed_orders_v1';

interface PlacedStrategyOrderRecord {
  strategyKey: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  exchange: string;
  orderId: string;
  placedAt: string;
}

type ExchangeConnectionHealth = 'synced' | 'active' | 'paused' | 'reauth';

interface ExchangeConnectionMeta {
  health: ExchangeConnectionHealth;
  labelRu: string;
  detailRu: string;
  syncedAt?: string;
  balanceUsdt?: number;
}

function resolveExchangeConnectionStatus(
  key: ExchangeKeyRecord,
  syncCache?: ExchangeSyncCacheMap,
  errorLogs: ExchangeSyncErrorLogEntry[] = []
): ExchangeConnectionMeta {
  const cached = syncCache?.[key.id];
  const latestSyncIso = cached?.syncedAt || key.lastSyncedAt || '';
  const latestSyncMs = latestSyncIso ? Date.parse(latestSyncIso) : 0;

  // Проверяем последнюю запись лога по этому ключу
  const latestKeyLog = errorLogs.find((entry) => entry.keyId === key.id);
  const hasNewerAuthOrCriticalError = Boolean(
    latestKeyLog &&
      latestKeyLog.severity !== 'success' &&
      (latestKeyLog.category === 'auth' || latestKeyLog.severity === 'critical') &&
      (!Number.isFinite(latestSyncMs) || latestKeyLog.occurredAtMs >= latestSyncMs)
  );
  const inlineErrorCategory = key.lastSyncError ? classifyExchangeSyncError(key.lastSyncError) : null;

  if (inlineErrorCategory === 'auth' || hasNewerAuthOrCriticalError) {
    return {
      health: 'reauth',
      labelRu: 'Переавторизация',
      detailRu:
        latestKeyLog?.errorMessage ||
        key.lastSyncError ||
        'Ключ или подпись отклонены биржей — обновите API-ключ',
      syncedAt: latestSyncIso || undefined,
      balanceUsdt: cached?.totalBalanceUsdt ?? key.lastBalanceUsdt,
    };
  }

  if (!key.enabled) {
    return {
      health: 'paused',
      labelRu: 'На паузе',
      detailRu: 'Ключ временно отключён пользователем',
      syncedAt: latestSyncIso || undefined,
      balanceUsdt: cached?.totalBalanceUsdt ?? key.lastBalanceUsdt,
    };
  }

  if (latestSyncIso) {
    const syncTimeText = Number.isFinite(latestSyncMs)
      ? new Date(latestSyncMs).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
      : '';
    return {
      health: 'synced',
      labelRu: 'Синхронизирован',
      detailRu: syncTimeText ? `Синхр. в ${syncTimeText}` : 'Баланс синхронизирован',
      syncedAt: latestSyncIso,
      balanceUsdt: cached?.totalBalanceUsdt ?? key.lastBalanceUsdt,
    };
  }

  return {
    health: 'active',
    labelRu: 'Активен',
    detailRu: 'Подключён · ожидает первой синхронизации',
    balanceUsdt: key.lastBalanceUsdt,
  };
}

function readStoredPlacedOrders(): Record<string, PlacedStrategyOrderRecord> {
  try {
    const raw = window.localStorage.getItem(PLACED_ORDERS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, PlacedStrategyOrderRecord>;
    }
  } catch {
    // ignore storage errors
  }
  return {};
}

function readStoredExecMode(): StrategyExecutionMode {
  try {
    const raw = window.localStorage.getItem(EXEC_MODE_STORAGE_KEY);
    return raw === 'api_confirm' ? 'api_confirm' : 'signals';
  } catch {
    return 'signals';
  }
}

interface StrategiesViewProps {
  profile: UserProfile | null;
  strategies: StrategyConfig[];
  analyses?: AnalysisRecord[];
  isSignedIn: boolean;
  uid?: string | null;
  privacyMode?: boolean;
  pushSubscribed?: boolean;
  portfolioBalanceUsdt?: number;
  exchangeKeys?: ExchangeKeyRecord[];
  exchangeSyncCache?: ExchangeSyncCacheMap;
  exchangeSyncErrorLogs?: ExchangeSyncErrorLogEntry[];
  onOpenPushSettings?: () => void;
  onOpenExchangeIntegrations?: () => void;
  onRequireLogin: () => void;
  onSwitchPlan: (target: PlanTier, maxMultiplier?: 10 | 20) => Promise<void> | void;
  onConsumeCredits?: (amount: number, auditReason?: string) => Promise<boolean>;
  onOpenPairOnMarket?: (
    symbol: string,
    marketType: MarketType,
    signalOverlay?: ActiveStrategySignalOverlay | null
  ) => void;
  onSaveStrategy: (
    strategyId: string,
    updates: {
      enabled: boolean;
      dailySignalLimit: number;
      minConfidence: number;
      riskPerTradePct: number;
      leverage: number;
      pairs: string[];
    }
  ) => Promise<void>;
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
  onSignalEmitted?: (params: {
    symbol: string;
    marketType: MarketType;
    direction: 'LONG' | 'SHORT' | 'WAIT';
    confidence: number;
    strategyName: string;
    entryZone: string;
  }) => Promise<void>;
  externalSection?: { section: StrategiesSection; nonce: number } | null;
}

function formatScannerPrice(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—';
  if (value >= 1000) return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (value >= 10) return `$${value.toFixed(3)}`;
  if (value >= 1) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(5)}`;
}

/**
 * Живая панель активной стратегии с конечным автоматом (Idle / Monitoring / Execution):
 * - Чёткий статус-бейдж состояния автомата и режима (Paper / Live API);
 * - Изолированная подписка на тикер ведущей пары из liveMarketStore (60 FPS);
 * - Живой трек прогресса SL -> Вход -> TP1 -> TP2 при сработавшем сигнале;
 * - Кнопка «График сигнала (SL / Вход / TP)» доступна на каждой активной стратегии.
 */
const ActiveStrategyLiveProgress = React.memo(
  ({
    strategyKey,
    strategyName,
    leadSymbol,
    pairsCount,
    marketType,
    minConfidence,
    riskPerTradePct,
    isMaxStrategy,
    operatingMode,
    engineState,
    verifiedLive,
    telemetry,
    emittedSignal,
    placedOrder,
    isScanning,
    hasTradeApiKey,
    onOpenPairOnMarket,
    onExecuteSignalViaApi,
    onClearPlacedOrder,
  }: {
    strategyKey: string;
    strategyName: string;
    leadSymbol: string;
    pairsCount: number;
    marketType: MarketType;
    minConfidence: number;
    riskPerTradePct: number;
    isMaxStrategy: boolean;
    operatingMode: StrategyOperatingMode;
    engineState: StrategyEngineState;
    verifiedLive: boolean;
    telemetry?: StrategyLiveTelemetry;
    emittedSignal?: LiveScannerOpportunity;
    placedOrder?: PlacedStrategyOrderRecord;
    isScanning: boolean;
    hasTradeApiKey: boolean;
    onOpenPairOnMarket?: (
      symbol: string,
      marketType: MarketType,
      signalOverlay?: ActiveStrategySignalOverlay | null
    ) => void;
    onExecuteSignalViaApi?: (opp: LiveScannerOpportunity) => void;
    onClearPlacedOrder?: () => void;
  }) => {
    const watchSymbol = placedOrder?.symbol || emittedSignal?.symbol || telemetry?.bestSymbol || leadSymbol;
    const ticker = useLiveTicker(watchSymbol, marketType);
    const livePrice = ticker?.price ?? emittedSignal?.entryPrice ?? 0;

    const statusBadge = useMemo(
      () =>
        resolveStrategyStatusBadge({
          engineState,
          hasPlacedOrder: Boolean(placedOrder),
          hasEmittedSignal: Boolean(emittedSignal),
        }),
      [engineState, placedOrder, emittedSignal]
    );

    const signalOverlay = useMemo(
      () =>
        buildStrategySignalOverlay({
          strategyKey,
          strategyName,
          symbol: watchSymbol,
          marketType,
          mode: operatingMode,
          emittedSignal,
          telemetry,
          livePrice,
          riskPerTradePct,
          hasPlacedOrder: Boolean(placedOrder),
        }),
      [
        strategyKey,
        strategyName,
        watchSymbol,
        marketType,
        operatingMode,
        emittedSignal,
        telemetry,
        livePrice,
        riskPerTradePct,
        placedOrder,
      ]
    );

    const signalProgress = useMemo(
      () => calculateSignalProgress(signalOverlay, livePrice || signalOverlay.entryPrice),
      [signalOverlay, livePrice]
    );

    const readyPct = emittedSignal
      ? 100
      : typeof telemetry?.readinessPct === 'number'
        ? telemetry.readinessPct
        : isScanning
          ? 28
          : 20;

    const reasonText = placedOrder
      ? `Ордер ${placedOrder.direction} ${placedOrder.symbol} размещён на ${placedOrder.exchange.toUpperCase()} (${new Date(placedOrder.placedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}) · ID ${placedOrder.orderId}`
      : emittedSignal
        ? `Сигнал ${emittedSignal.direction} (${emittedSignal.confidence}%) по ${emittedSignal.symbol.replace('USDT', '/USDT')} · R:R 1:${emittedSignal.riskRewardRatio}`
        : telemetry?.reasonRu || 'Ожидание закрытия свечи 1H и совпадения индикаторов';

    const priceLabel =
      ticker && ticker.price > 0
        ? formatScannerPrice(ticker.price)
        : emittedSignal
          ? formatScannerPrice(emittedSignal.entryPrice)
          : '—';
    const changePct = ticker ? ticker.change24hPct : emittedSignal ? emittedSignal.change24hPct : null;

    return (
      <div
        className={`mt-2.5 rounded-xl border p-2.5 space-y-2 ${
          placedOrder
            ? 'border-emerald-400/50 bg-emerald-500/[0.10]'
            : emittedSignal
              ? emittedSignal.direction === 'LONG'
                ? 'border-emerald-400/45 bg-emerald-500/[0.08]'
                : 'border-rose-400/45 bg-rose-500/[0.08]'
              : isMaxStrategy
                ? 'border-cyan-400/30 bg-cyan-500/[0.06]'
                : 'border-emerald-500/25 bg-emerald-500/[0.05]'
        }`}
      >
        {/* Строка 1: Динамический статус-бейдж (Idle / Monitoring Signal / Order Placed (Live)) + пара и цена */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            {statusBadge.code === 'Order Placed (Live)' ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-emerald-400/55 bg-emerald-500/20 text-emerald-200 font-semibold text-[10px] shrink-0">
                <CheckCircle2 className="w-3 h-3 text-emerald-300 shrink-0" />
                <span>Order Placed (Live)</span>
              </span>
            ) : statusBadge.code === 'Idle' ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-white/10 bg-white/5 text-slate-400 font-semibold text-[10px] shrink-0">
                <PauseCircle className="w-3 h-3 text-slate-500 shrink-0" />
                <span>Idle</span>
              </span>
            ) : (
              <span
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border font-semibold text-[10px] shrink-0 ${
                  statusBadge.hasSignalReady
                    ? 'border-emerald-400/45 bg-emerald-500/18 text-emerald-200'
                    : 'border-cyan-400/40 bg-cyan-500/15 text-cyan-200'
                }`}
              >
                <span className="live-dot shrink-0" aria-hidden="true" />
                <span>Monitoring Signal</span>
              </span>
            )}

            {verifiedLive && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-emerald-400/45 bg-emerald-500/15 text-emerald-200 font-mono text-[9.5px] font-bold shrink-0">
                <ShieldCheck className="w-3 h-3 text-emerald-300 shrink-0" />
                <span>Verified Live</span>
              </span>
            )}

            {emittedSignal && !placedOrder && (
              <span
                className={`px-1.5 py-0.5 rounded-md border font-mono text-[10px] font-bold shrink-0 ${
                  emittedSignal.direction === 'LONG'
                    ? 'border-emerald-400/45 bg-emerald-500/20 text-emerald-200'
                    : 'border-rose-400/45 bg-rose-500/20 text-rose-200'
                }`}
              >
                {emittedSignal.direction} · {emittedSignal.confidence}%
              </span>
            )}

            <span className="inline-flex items-center gap-1 font-mono font-semibold text-white truncate">
              <Activity className="w-3 h-3 text-slate-400 shrink-0" />
              <span className="truncate">{watchSymbol.replace('USDT', '')}/USDT</span>
              {pairsCount > 1 && (
                <span className="text-[10px] text-slate-400">+{pairsCount - 1}</span>
              )}
            </span>
          </div>

          <span className="font-mono tabular-nums text-[11px] flex items-center gap-1.5 shrink-0">
            <span className="text-slate-100 font-semibold">{priceLabel}</span>
            {changePct !== null && (
              <span className={changePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                {changePct >= 0 ? '+' : ''}
                {changePct.toFixed(2)}%
              </span>
            )}
          </span>
        </div>

        {/* Строка 2: Телеметрия движка */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px]">
          <span className="text-slate-400 leading-snug min-w-0 flex-1">{reasonText}</span>
          <div className="flex items-center gap-1.5 shrink-0 font-mono tabular-nums">
            <span className="px-1.5 py-0.5 rounded border border-white/10 bg-[#070B12]/80 text-slate-400">
              {operatingMode === 'live' ? 'Live API' : 'Paper'}
            </span>
            {!placedOrder && (
              <span className="px-1.5 py-0.5 rounded border border-white/10 bg-[#070B12]/80 text-slate-300">
                Порог {minConfidence}% · <strong className="text-white">{readyPct}%</strong>
              </span>
            )}
            {placedOrder && onClearPlacedOrder && (
              <button
                type="button"
                onClick={onClearPlacedOrder}
                className="font-sans text-[10px] text-slate-400 hover:text-white underline underline-offset-2"
              >
                Сбросить
              </button>
            )}
          </div>
        </div>

        {/* Живой трек прогресса сигнала (SL -> Вход -> TP1 -> TP2) + 4 уровня */}
        {emittedSignal ? (
          <div className="pt-1.5 border-t border-white/10 space-y-2">
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-[10px] font-mono tabular-nums">
                <span className="font-sans text-slate-300 font-medium truncate">
                  {signalProgress.phaseLabelRu}
                </span>
                <span
                  className={`font-bold shrink-0 ${
                    signalProgress.pnlFromEntryPct >= 0 ? 'text-emerald-300' : 'text-rose-300'
                  }`}
                >
                  {signalProgress.pnlFromEntryPct >= 0 ? '+' : ''}
                  {signalProgress.pnlFromEntryPct.toFixed(2)}% от входа
                </span>
              </div>
              <div className="relative h-2 rounded-full bg-[#070B12] border border-white/10 overflow-visible">
                <div
                  className="absolute inset-y-0 left-0 rounded-l-full bg-rose-500/25"
                  style={{ width: `${signalProgress.entryMarkerPct}%` }}
                />
                <div
                  className="absolute inset-y-0 right-0 rounded-r-full bg-emerald-500/25"
                  style={{ left: `${signalProgress.entryMarkerPct}%` }}
                />
                <span
                  aria-hidden="true"
                  className="absolute -top-0.5 -bottom-0.5 w-[1.5px] bg-sky-300"
                  style={{ left: `${signalProgress.entryMarkerPct}%` }}
                />
                <span
                  aria-hidden="true"
                  className="absolute top-0 bottom-0 w-[1.5px] bg-emerald-300/80"
                  style={{ left: `${signalProgress.tp1MarkerPct}%` }}
                />
                <span
                  aria-hidden="true"
                  className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full border border-white shadow-sm ${
                    signalProgress.pnlFromEntryPct >= 0 ? 'bg-emerald-400' : 'bg-rose-400'
                  }`}
                  style={{ left: `${signalProgress.trackPct}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[9px] font-mono text-slate-500">
                <span className="text-rose-400">SL</span>
                <span className="text-sky-300">Вход</span>
                <span className="text-emerald-300">TP1</span>
                <span className="text-emerald-400">TP2</span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[10px] font-mono tabular-nums">
              <div className="rounded-lg bg-[#070B12]/90 px-2 py-1">
                <div className="font-sans text-[9px] text-rose-400">Stop-Loss</div>
                <div className="text-rose-300 font-semibold truncate">
                  {formatScannerPrice(signalOverlay.stopLossPrice)}
                </div>
              </div>
              <div className="rounded-lg bg-[#070B12]/90 px-2 py-1">
                <div className="font-sans text-[9px] text-sky-400">Вход</div>
                <div className="text-white font-semibold truncate">
                  {formatScannerPrice(signalOverlay.entryPrice)}
                </div>
              </div>
              <div className="rounded-lg bg-[#070B12]/90 px-2 py-1">
                <div className="font-sans text-[9px] text-emerald-300">TP1</div>
                <div className="text-emerald-300 font-semibold truncate">
                  {formatScannerPrice(signalOverlay.tp1Price)}
                </div>
              </div>
              <div className="rounded-lg bg-[#070B12]/90 px-2 py-1">
                <div className="font-sans text-[9px] text-emerald-400">TP2</div>
                <div className="text-emerald-400 font-semibold truncate">
                  {formatScannerPrice(signalOverlay.takeProfitPrice)}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* Кнопки действий активной стратегии: вход в график с SL / Входом / TP доступен всегда */}
        <div className="pt-1 border-t border-white/8 flex flex-wrap items-center gap-1.5">
          {onOpenPairOnMarket && (
            <button
              type="button"
              onClick={() => {
                triggerHaptic(8);
                onOpenPairOnMarket(signalOverlay.symbol, signalOverlay.marketType, signalOverlay);
              }}
              className="flex-1 min-h-[30px] px-2.5 rounded-lg border border-cyan-500/35 bg-cyan-500/12 hover:bg-cyan-500/22 text-[11px] font-semibold text-cyan-100 inline-flex items-center justify-center gap-1.5 transition-colors"
            >
              <LineChart className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
              <span>
                {emittedSignal ? 'График сигнала (SL/Вход/TP)' : 'Открыть график (SL/Вход/TP)'}
              </span>
              <ArrowUpRight className="w-3 h-3 shrink-0" />
            </button>
          )}
          {emittedSignal && onExecuteSignalViaApi && (
            <button
              type="button"
              onClick={() => onExecuteSignalViaApi(emittedSignal)}
              className={`min-h-[30px] px-2.5 rounded-lg text-[11px] font-semibold inline-flex items-center justify-center gap-1 transition-colors shrink-0 ${
                hasTradeApiKey
                  ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                  : 'border border-amber-400/40 bg-amber-500/15 hover:bg-amber-500/25 text-amber-200'
              }`}
            >
              <Send className="w-3 h-3" />
              <span>{hasTradeApiKey ? 'Через API' : 'Подкл. API'}</span>
            </button>
          )}
        </div>
      </div>
    );
  }
);
ActiveStrategyLiveProgress.displayName = 'ActiveStrategyLiveProgress';

/**
 * Карточка одного сигнала в потоке LiveSignalFeed:
 * Подписывается на тикер пары (60 FPS) и отображает живой прогресс SL -> Вход -> TP1 -> TP2.
 */
const LiveSignalFeedRow = React.memo(
  ({
    event,
    isBusy,
    isPushDone,
    isOrderPlaced,
    pushSubscribed,
    hasTradeApiKey,
    onOpenChart,
    onSendPush,
    onExecuteApi,
  }: {
    event: StrategySignalEvent;
    isBusy: boolean;
    isPushDone: boolean;
    isOrderPlaced: boolean;
    pushSubscribed: boolean;
    hasTradeApiKey: boolean;
    onOpenChart?: (overlay: ActiveStrategySignalOverlay) => void;
    onSendPush: (opp: LiveScannerOpportunity) => void;
    onExecuteApi: (opp: LiveScannerOpportunity) => void;
  }) => {
    const ticker = useLiveTicker(event.symbol, event.marketType);
    const livePrice = ticker?.price ?? event.entryPrice;
    const [copied, setCopied] = useState(false);

    const handleCopySignal = async () => {
      const pair = `${event.symbol.replace('USDT', '')}/USDT`;
      const text = [
        `VERNIER · ${pair} (${event.marketType === 'futures' ? 'Futures' : 'Spot'}) · ${event.direction}`,
        `Стратегия: ${event.strategyName} (${event.confidence}%)`,
        `Вход: ${formatScannerPrice(event.entryPrice)} (${formatScannerPrice(event.entryZoneLow)}–${formatScannerPrice(event.entryZoneHigh)})`,
        `Stop-Loss: ${formatScannerPrice(event.stopLossPrice)}`,
        `TP1: ${formatScannerPrice(event.tp1Price)} · TP2: ${formatScannerPrice(event.takeProfitPrice)} (R:R 1:${event.riskRewardRatio})`,
      ].join('\n');
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        }
        triggerHaptic(8);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      } catch {
        // ignore clipboard denial
      }
    };

    const overlay: ActiveStrategySignalOverlay = useMemo(
      () => ({
        strategyKey: event.strategyKey,
        strategyName: event.strategyName,
        symbol: event.symbol,
        marketType: event.marketType,
        direction: event.direction,
        confidence: event.confidence,
        entryPrice: event.entryPrice,
        stopLossPrice: event.stopLossPrice,
        tp1Price: event.tp1Price,
        takeProfitPrice: event.takeProfitPrice,
        riskRewardRatio: event.riskRewardRatio,
        engineState: 'Execution',
        mode: event.mode,
        emittedAt: event.emittedAt,
        isProjected: false,
      }),
      [event]
    );

    const progress = useMemo(
      () => calculateSignalProgress(overlay, livePrice),
      [overlay, livePrice]
    );

    const tsFormatted = new Date(event.emittedAt).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    return (
      <article
        className={`rounded-xl border bg-[#0B0F17] p-3.5 space-y-3 ${
          event.direction === 'LONG' ? 'border-emerald-500/35' : 'border-rose-500/35'
        }`}
      >
        {/* Заголовок события + номер потока и время */}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[10px] text-slate-500">#{event.seq}</span>
              <span className="font-mono text-sm font-bold text-white">
                {event.symbol.replace('USDT', '')}/USDT
              </span>
              <span
                className={`px-2 py-0.5 rounded-md font-mono text-[10px] font-bold border ${
                  event.direction === 'LONG'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                }`}
              >
                {event.direction}
              </span>
              <span className="px-1.5 py-0.5 rounded bg-white/8 text-[10px] font-mono text-slate-300">
                {event.marketType === 'futures' ? 'Futures' : 'Spot'}
              </span>
              <span className="px-1.5 py-0.5 rounded border border-white/10 bg-white/[0.04] text-[10px] font-mono text-slate-300">
                {event.mode === 'live' ? 'Live API' : 'Paper'}
              </span>
              {(isOrderPlaced || event.orderId) && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-emerald-400/45 bg-emerald-500/20 text-[10px] font-semibold text-emerald-200">
                  <CheckCircle2 className="w-3 h-3 shrink-0" />
                  <span>Ордер отправлен</span>
                </span>
              )}
            </div>
            <div className="text-xs text-slate-300 font-medium">{event.strategyName}</div>
          </div>

          <div className="text-right shrink-0 space-y-0.5">
            <div className="font-mono text-sm font-bold text-cyan-300">
              {event.confidence}% увер.
            </div>
            <div className="inline-flex items-center gap-1 font-mono text-[10px] text-slate-400">
              <Clock className="w-3 h-3 shrink-0" />
              <span>{tsFormatted}</span>
            </div>
          </div>
        </div>

        {/* Живой трек прогресса сигнала (SL -> Вход -> TP1 -> TP2) */}
        <div className="rounded-lg border border-white/8 bg-[#070B12]/90 p-2.5 space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <span className="text-slate-200 font-medium">{progress.phaseLabelRu}</span>
            <span className="font-mono tabular-nums flex items-center gap-2">
              <span className="text-slate-400">
                Сейчас: <strong className="text-white">{formatScannerPrice(livePrice)}</strong>
              </span>
              <span
                className={`font-bold ${
                  progress.pnlFromEntryPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {progress.pnlFromEntryPct >= 0 ? '+' : ''}
                {progress.pnlFromEntryPct.toFixed(2)}%
              </span>
            </span>
          </div>
          <div className="relative h-2 rounded-full bg-white/[0.06] border border-white/10 overflow-visible">
            <div
              className="absolute inset-y-0 left-0 rounded-l-full bg-rose-500/25"
              style={{ width: `${progress.entryMarkerPct}%` }}
            />
            <div
              className="absolute inset-y-0 right-0 rounded-r-full bg-emerald-500/25"
              style={{ left: `${progress.entryMarkerPct}%` }}
            />
            <span
              aria-hidden="true"
              className="absolute -top-0.5 -bottom-0.5 w-[2px] bg-sky-300"
              style={{ left: `${progress.entryMarkerPct}%` }}
            />
            <span
              aria-hidden="true"
              className="absolute top-0 bottom-0 w-[1.5px] bg-emerald-300/80"
              style={{ left: `${progress.tp1MarkerPct}%` }}
            />
            <span
              aria-hidden="true"
              className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full border-2 border-white shadow ${
                progress.pnlFromEntryPct >= 0 ? 'bg-emerald-400' : 'bg-rose-400'
              }`}
              style={{ left: `${progress.trackPct}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[9px] font-mono text-slate-500">
            <span className="text-rose-400">SL ({formatScannerPrice(event.stopLossPrice)})</span>
            <span className="text-sky-300">Вход</span>
            <span className="text-emerald-300">TP1</span>
            <span className="text-emerald-400">TP2 ({formatScannerPrice(event.takeProfitPrice)})</span>
          </div>
        </div>

        {/* Целевые ценовые зоны (Зона входа / SL / TP1 / TP2) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono tabular-nums">
          <div className="rounded-lg border border-white/8 bg-white/[0.03] px-2.5 py-1.5">
            <div className="font-sans text-[10px] text-slate-500">Зона входа</div>
            <div className="text-white font-semibold text-[10.5px] leading-snug mt-0.5">
              {formatScannerPrice(event.entryZoneLow)} – {formatScannerPrice(event.entryZoneHigh)}
            </div>
          </div>
          <div className="rounded-lg border border-rose-500/20 bg-rose-500/[0.04] px-2.5 py-1.5">
            <div className="font-sans text-[10px] text-slate-500">Stop-Loss</div>
            <div className="text-rose-400 font-semibold mt-0.5">
              {formatScannerPrice(event.stopLossPrice)}
            </div>
          </div>
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] px-2.5 py-1.5">
            <div className="font-sans text-[10px] text-slate-500">Цель TP1 (50%)</div>
            <div className="text-emerald-300 font-semibold mt-0.5">
              {formatScannerPrice(event.tp1Price)}
            </div>
          </div>
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.08] px-2.5 py-1.5">
            <div className="font-sans text-[10px] text-slate-500">
              Цель TP2 · R:R 1:{event.riskRewardRatio}
            </div>
            <div className="text-emerald-400 font-bold mt-0.5">
              {formatScannerPrice(event.takeProfitPrice)}
            </div>
          </div>
        </div>

        {/* Что «думает» движок */}
        <div className="rounded-lg border border-white/6 bg-white/[0.02] px-2.5 py-2 text-[11px] text-slate-300 space-y-1">
          <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-slate-400">
            <span>
              RSI(14): <strong className="text-slate-200">{event.rsi14}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Тренд:{' '}
              <strong
                className={
                  event.trendBias === 'BULLISH'
                    ? 'text-emerald-300'
                    : event.trendBias === 'BEARISH'
                      ? 'text-rose-300'
                      : 'text-amber-300'
                }
              >
                {event.trendBias}
              </strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              24ч:{' '}
              <strong className={event.change24hPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                {event.change24hPct >= 0 ? '+' : ''}
                {event.change24hPct.toFixed(2)}%
              </strong>
            </span>
          </div>
          {event.summary && <p className="text-slate-300 leading-relaxed">{event.summary}</p>}
        </div>

        {/* Действия по сигналу */}
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {onOpenChart && (
            <button
              type="button"
              onClick={() => {
                triggerHaptic(8);
                onOpenChart(overlay);
              }}
              className="min-h-[32px] px-3 rounded-lg border border-cyan-500/35 bg-cyan-500/12 hover:bg-cyan-500/22 text-xs font-semibold text-cyan-100 inline-flex items-center gap-1.5 transition-colors"
            >
              <LineChart className="w-3.5 h-3.5 text-cyan-300" />
              <span>График сигнала</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleCopySignal()}
            className={`min-h-[32px] px-2.5 rounded-lg border text-xs font-medium inline-flex items-center gap-1 transition-colors ${
              copied
                ? 'border-emerald-500/45 bg-emerald-500/15 text-emerald-200'
                : 'border-white/12 bg-white/5 hover:bg-white/10 text-slate-200'
            }`}
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-emerald-300" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-slate-300" />
            )}
            <span>{copied ? 'Скопировано' : 'Копировать'}</span>
          </button>
          <button
            type="button"
            onClick={() => onSendPush(event.opportunity)}
            className="min-h-[32px] px-3 rounded-lg border border-white/12 bg-white/5 hover:bg-white/10 text-xs font-medium text-slate-200 inline-flex items-center gap-1 transition-colors"
          >
            <BellRing className="w-3.5 h-3.5 text-cyan-300" />
            <span>{isPushDone ? 'Отправлено' : pushSubscribed ? 'В Push' : 'Вкл. Push'}</span>
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={() => onExecuteApi(event.opportunity)}
            className={`ml-auto min-h-[32px] px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
              hasTradeApiKey
                ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                : 'border border-amber-400/40 bg-amber-500/15 hover:bg-amber-500/25 text-amber-200'
            }`}
          >
            <Send className="w-3.5 h-3.5" />
            <span>
              {isBusy ? 'Отправка…' : hasTradeApiKey ? 'Исполнить через API' : 'Подключить API'}
            </span>
          </button>
        </div>
      </article>
    );
  }
);
LiveSignalFeedRow.displayName = 'LiveSignalFeedRow';

/**
 * Компонент LiveSignalFeed:
 * Подписывается на WebSocket-подобный поток событий `strategyEventStream` из `src/lib/strategyEngine.ts`
 * и в реальном времени выводит сигналы LONG / SHORT с метками времени, зонами целей и прогрессом.
 */
const LiveSignalFeed: React.FC<{
  activeCount: number;
  analyses: AnalysisRecord[];
  operatingMode: StrategyOperatingMode;
  verifiedLive: boolean;
  verifiedExchangeLabel?: string | null;
  monitorLoading: boolean;
  apiOrderBusyKey: string | null;
  pushSentKeys: Record<string, boolean>;
  placedOrdersByStrategy: Record<string, PlacedStrategyOrderRecord>;
  pushSubscribed: boolean;
  hasTradeApiKey: boolean;
  exchangeStrip: React.ReactNode;
  onRefreshStream: () => void;
  onOpenModeInfo: () => void;
  onOpenApiGuide?: () => void;
  onGoToCatalog: () => void;
  onOpenPairOnMarket?: (
    symbol: string,
    marketType: MarketType,
    signalOverlay?: ActiveStrategySignalOverlay | null
  ) => void;
  onSendSignalPush: (opp: LiveScannerOpportunity) => void;
  onExecuteSignalViaApi: (opp: LiveScannerOpportunity) => void;
}> = ({
  activeCount,
  analyses,
  operatingMode,
  verifiedLive,
  verifiedExchangeLabel,
  monitorLoading,
  apiOrderBusyKey,
  pushSentKeys,
  placedOrdersByStrategy,
  pushSubscribed,
  hasTradeApiKey,
  exchangeStrip,
  onRefreshStream,
  onOpenModeInfo,
  onOpenApiGuide,
  onGoToCatalog,
  onOpenPairOnMarket,
  onSendSignalPush,
  onExecuteSignalViaApi,
}) => {
  const [events, setEvents] = useState<StrategySignalEvent[]>(() => strategyEventStream.getEvents());
  const [streamStatus, setStreamStatus] = useState<StrategyStreamStatus>(
    () => strategyEventStream.getStatus().status
  );
  const [lastHeartbeatAt, setLastHeartbeatAt] = useState<string | null>(
    () => strategyEventStream.getStatus().lastHeartbeatAt
  );
  const [directionFilter, setDirectionFilter] = useState<'all' | 'LONG' | 'SHORT'>('all');
  const [csvDownloadedCount, setCsvDownloadedCount] = useState<number | null>(null);

  useEffect(() => {
    return strategyEventStream.subscribe((nextEvents, nextStatus, nextHeartbeat) => {
      setEvents(nextEvents);
      setStreamStatus(nextStatus);
      setLastHeartbeatAt(nextHeartbeat);
    });
  }, []);

  const filteredEvents = useMemo(() => {
    if (directionFilter === 'all') return events;
    return events.filter((ev) => ev.direction === directionFilter);
  }, [events, directionFilter]);

  const historicalExportableAnalyses = useMemo(() => {
    return analyses.filter((rec) => {
      if (rec.direction !== 'LONG' && rec.direction !== 'SHORT') return false;
      if (directionFilter !== 'all' && rec.direction !== directionFilter) return false;
      return true;
    });
  }, [analyses, directionFilter]);

  const totalExportableSignals = filteredEvents.length + historicalExportableAnalyses.length;

  const handleDownloadSignalsCsv = () => {
    if (totalExportableSignals === 0) return;
    triggerHaptic(10);

    const normalizeCreatedIso = (raw: unknown): string => {
      if (typeof raw === 'string' && raw.trim()) return raw;
      if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw.toISOString();
      if (typeof raw === 'number' && Number.isFinite(raw)) return new Date(raw).toISOString();
      if (raw && typeof raw === 'object') {
        const obj = raw as { toDate?: () => Date; seconds?: number };
        if (typeof obj.toDate === 'function') return obj.toDate().toISOString();
        if (typeof obj.seconds === 'number') return new Date(obj.seconds * 1000).toISOString();
      }
      return new Date().toISOString();
    };

    const headers = [
      'Timestamp (ISO)',
      'Source',
      'Strategy',
      'Symbol',
      'Market',
      'Direction',
      'Confidence (%)',
      'Entry',
      'Stop-Loss',
      'TP1',
      'TP2',
      'R:R',
      'Mode',
      'Order ID',
      'RSI(14)',
      'Trend',
      'Summary',
    ];

    const streamRows = filteredEvents.map((ev) => {
      const placed = placedOrdersByStrategy[ev.strategyKey];
      const orderId =
        ev.orderId ||
        (placed && placed.symbol === ev.symbol && placed.direction === ev.direction
          ? placed.orderId
          : '');
      return [
        ev.emittedAt,
        'Live Stream',
        ev.strategyName,
        ev.symbol,
        ev.marketType.toUpperCase(),
        ev.direction,
        ev.confidence,
        ev.entryPrice,
        ev.stopLossPrice,
        ev.tp1Price,
        ev.takeProfitPrice,
        `1:${ev.riskRewardRatio}`,
        ev.mode === 'live' ? 'Live API' : 'Paper',
        orderId,
        ev.rsi14,
        ev.trendBias,
        ev.summary || '',
      ];
    });

    const historicalRows = historicalExportableAnalyses.map((rec) => [
      normalizeCreatedIso(rec.createdAt),
      'Historical Analysis',
      rec.strategyName,
      rec.symbol,
      rec.marketType.toUpperCase(),
      rec.direction,
      rec.confidence,
      rec.entryZone,
      rec.stopLoss,
      rec.takeProfits?.[0] ?? '',
      rec.takeProfits?.[1] ?? rec.takeProfits?.[0] ?? '',
      rec.riskReward || '',
      'Historical',
      '',
      '',
      rec.newsSentiment || '',
      rec.summary || '',
    ]);

    const allRows = [...streamRows, ...historicalRows];
    const dateStamp = new Date().toISOString().slice(0, 10);
    downloadCsvWithBom(`vernier-signals-${dateStamp}.csv`, headers, allRows);
    setCsvDownloadedCount(allRows.length);
    window.setTimeout(() => setCsvDownloadedCount(null), 2600);
  };

  const longCount = useMemo(() => events.filter((e) => e.direction === 'LONG').length, [events]);
  const shortCount = useMemo(() => events.filter((e) => e.direction === 'SHORT').length, [events]);

  const heartbeatText = lastHeartbeatAt
    ? new Date(lastHeartbeatAt).toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : null;

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-emerald-500/25 bg-[#111827] card-surface-glow p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <Radio className="w-4 h-4 text-emerald-400 animate-pulse shrink-0" />
                <span>Поток живых сигналов (Live Signal Feed)</span>
              </h2>
                <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border font-mono text-[10px] font-bold whitespace-nowrap shrink-0 ${
                  streamStatus === 'connected'
                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
                    : streamStatus === 'connecting'
                      ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-200'
                      : 'border-white/10 bg-white/5 text-slate-400'
                }`}
                title={heartbeatText ? `Последний сигнал: ${heartbeatText}` : undefined}
              >
                <Wifi className="w-3 h-3 shrink-0" />
                <span>
                  {streamStatus === 'connected'
                    ? heartbeatText
                      ? `Live · ${heartbeatText}`
                      : 'Live'
                    : streamStatus === 'connecting'
                      ? 'Синхр.'
                      : 'Ожидание'}
                </span>
              </span>
              {verifiedLive ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-emerald-400/50 bg-emerald-500/20 font-mono text-[10px] font-bold text-emerald-200 whitespace-nowrap">
                  <ShieldCheck className="w-3 h-3 text-emerald-300 shrink-0" />
                  <span>
                    Verified Live{verifiedExchangeLabel ? ` · ${verifiedExchangeLabel}` : ''}
                  </span>
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-md border border-white/12 bg-white/[0.04] font-mono text-[10px] font-semibold text-slate-200 whitespace-nowrap">
                  {operatingMode === 'live' ? 'Read-Only / Testnet API' : 'Paper Trading'}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 max-w-2xl leading-relaxed">
              Событийный поток сигналов LONG / SHORT от активных стратегий с точным временем, целевыми зонами и живым прогрессом отработки SL → Вход → TP1 → TP2.
            </p>
          </div>

          <div className="w-full sm:w-auto flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2 shrink-0">
            <div className="grid grid-cols-3 sm:flex sm:flex-wrap items-center gap-1.5">
              <button
                type="button"
                disabled={totalExportableSignals === 0}
                onClick={handleDownloadSignalsCsv}
                title={
                  totalExportableSignals > 0
                    ? `Экспортировать ${totalExportableSignals} сигналов в CSV для внешнего анализа`
                    : 'Пока нет сигналов для экспорта в CSV'
                }
                className={`min-h-[36px] px-2 sm:px-3 rounded-xl border text-[11px] sm:text-xs font-semibold inline-flex items-center justify-center gap-1 whitespace-nowrap transition-colors disabled:opacity-45 disabled:cursor-not-allowed ${
                  csvDownloadedCount !== null
                    ? 'border-emerald-400/55 bg-emerald-500/20 text-emerald-100'
                    : 'border-emerald-500/35 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-200'
                }`}
              >
                {csvDownloadedCount !== null ? (
                  <Check className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
                ) : (
                  <Download className="w-3.5 h-3.5 shrink-0" />
                )}
                <span className="truncate">
                  {csvDownloadedCount !== null
                    ? `CSV (${csvDownloadedCount})`
                    : totalExportableSignals > 0
                      ? `CSV (${totalExportableSignals})`
                      : 'Экспорт CSV'}
                </span>
              </button>
              {onOpenApiGuide && (
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(8);
                    onOpenApiGuide();
                  }}
                  className="min-h-[36px] px-2 sm:px-3 rounded-xl border border-white/12 bg-white/5 hover:bg-white/10 text-slate-200 text-[11px] sm:text-xs font-medium inline-flex items-center justify-center gap-1 whitespace-nowrap transition-colors"
                >
                  <BookOpen className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
                  <span className="truncate">Гайд по API</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  triggerHaptic(8);
                  onOpenModeInfo();
                }}
                className="min-h-[36px] px-2 sm:px-3 rounded-xl border border-cyan-500/35 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-200 text-[11px] sm:text-xs font-medium inline-flex items-center justify-center gap-1 whitespace-nowrap transition-colors"
              >
                <Info className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">Paper vs Live</span>
              </button>
            </div>
            <button
              type="button"
              disabled={monitorLoading || activeCount === 0}
              onClick={onRefreshStream}
              className="min-h-[36px] px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${monitorLoading ? 'animate-spin' : ''}`} />
              <span>{monitorLoading ? 'Синхр.…' : 'Обновить поток'}</span>
            </button>
          </div>
        </div>

        {/* Статус подключённых бирж */}
        {exchangeStrip}

        {/* Фильтры потока */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="inline-flex items-center p-1 rounded-xl bg-[#0B0F17] border border-white/8 text-xs">
            {(
              [
                { id: 'all', label: `Все (${events.length})` },
                { id: 'LONG', label: `LONG (${longCount})` },
                { id: 'SHORT', label: `SHORT (${shortCount})` },
              ] as const
            ).map((tab) => {
              const active = directionFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setDirectionFilter(tab.id)}
                  className={`min-h-[32px] px-3 rounded-lg font-medium transition-colors whitespace-nowrap ${
                    active
                      ? tab.id === 'LONG'
                        ? 'bg-emerald-600 text-white'
                        : tab.id === 'SHORT'
                          ? 'bg-rose-600 text-white'
                          : 'bg-white/12 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {events.length > 0 && (
            <button
              type="button"
              onClick={() => {
                triggerHaptic(8);
                strategyEventStream.clear();
              }}
              className="min-h-[32px] px-2.5 rounded-lg border border-white/10 bg-white/5 hover:bg-rose-500/15 hover:border-rose-500/35 text-xs text-slate-400 hover:text-rose-200 inline-flex items-center gap-1.5 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Очистить</span>
            </button>
          )}
        </div>

        {filteredEvents.length === 0 ? (
          <div className="rounded-xl border border-white/8 bg-[#0B0F17] p-6 text-center space-y-3">
            <div className="mx-auto w-11 h-11 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-400">
              <Radio className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-white">
                {activeCount === 0
                  ? 'Нет активных стратегий в мониторинге'
                  : 'Новых событий по заданному порогу пока нет'}
              </h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                {activeCount === 0
                  ? 'Активируйте стратегии в «Каталоге» — конечный автомат переведёт их в состояние Monitoring, и каждый найденный LONG / SHORT сигнал сразу появится в этом потоке.'
                  : `Сейчас ${activeCount} активн. стратегий находятся в состоянии Monitoring. Как только свечной сигнал превысит порог уверенности, запись с зонами входа, SL и TP мгновенно придёт сюда.`}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              {activeCount === 0 ? (
                <button
                  type="button"
                  onClick={onGoToCatalog}
                  className="min-h-[38px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors"
                >
                  Перейти в Каталог стратегий
                </button>
              ) : (
                <button
                  type="button"
                  disabled={monitorLoading}
                  onClick={onRefreshStream}
                  className="min-h-[38px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${monitorLoading ? 'animate-spin' : ''}`} />
                  <span>Проверить свечи сейчас</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredEvents.map((event) => {
              const opKey = `${event.strategyKey}-${event.symbol}-${event.direction}`;
              const placedForStrat = placedOrdersByStrategy[event.strategyKey];
              const isOrderPlaced = Boolean(
                placedForStrat &&
                  placedForStrat.symbol === event.symbol &&
                  placedForStrat.direction === event.direction
              );
              return (
                <LiveSignalFeedRow
                  key={event.id}
                  event={event}
                  isBusy={apiOrderBusyKey === opKey}
                  isPushDone={Boolean(pushSentKeys[opKey])}
                  isOrderPlaced={isOrderPlaced}
                  pushSubscribed={pushSubscribed}
                  hasTradeApiKey={hasTradeApiKey}
                  onOpenChart={
                    onOpenPairOnMarket
                      ? (overlay) => onOpenPairOnMarket(overlay.symbol, overlay.marketType, overlay)
                      : undefined
                  }
                  onSendPush={onSendSignalPush}
                  onExecuteApi={onExecuteSignalViaApi}
                />
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};

export const StrategiesView: React.FC<StrategiesViewProps> = ({
  profile,
  strategies,
  analyses = [],
  isSignedIn,
  uid = null,
  privacyMode = false,
  pushSubscribed = false,
  portfolioBalanceUsdt,
  exchangeKeys = [],
  exchangeSyncCache,
  exchangeSyncErrorLogs = [],
  onOpenPushSettings,
  onOpenExchangeIntegrations,
  onRequireLogin,
  onSwitchPlan,
  onConsumeCredits,
  onOpenPairOnMarket,
  onSaveStrategy,
  onPlaceExchangeOrder,
  onSignalEmitted,
  externalSection,
}) => {
  const planCtx = usePlan();
  const [section, setSection] = useState<StrategiesSection>('catalog');
  const [scannerSubTab, setScannerSubTab] = useState<'scanner' | 'signals'>('scanner');
  const [executionMode, setExecutionMode] = useState<StrategyExecutionMode>(() => readStoredExecMode());
  const [liveExecutionEnabled, setLiveExecutionEnabled] = useState<boolean>(
    () => readLiveExecutionPrefs().enabled || readStoredExecMode() === 'api_confirm'
  );
  const [selectedExchangeKeyId, setSelectedExchangeKeyId] = useState<string | null>(
    () => readLiveExecutionPrefs().selectedKeyId
  );
  const operatingMode: StrategyOperatingMode =
    liveExecutionEnabled || executionMode === 'api_confirm' ? 'live' : 'paper';
  const [modeInfoOpen, setModeInfoOpen] = useState(false);
  const [apiGuideOpen, setApiGuideOpen] = useState(false);
  const [strategyModeTooltipOpen, setStrategyModeTooltipOpen] = useState(false);
  const [placedOrdersByStrategy, setPlacedOrdersByStrategy] = useState<
    Record<string, PlacedStrategyOrderRecord>
  >(() => readStoredPlacedOrders());
  const [signalStreamCount, setSignalStreamCount] = useState<number>(
    () => strategyEventStream.getEvents().length
  );
  const [selectedMaxMultiplier, setSelectedMaxMultiplier] = useState<10 | 20>(() =>
    profile?.maxMultiplier === 20 ? 20 : 10
  );
  const dispatchedLiveSignalsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    return strategyEventStream.subscribe((events) => {
      setSignalStreamCount(events.length);
    });
  }, []);

  useEffect(() => {
    if (!modeInfoOpen && !strategyModeTooltipOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setModeInfoOpen(false);
        setStrategyModeTooltipOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [modeInfoOpen, strategyModeTooltipOpen]);

  const handleSetExecutionMode = useCallback(
    (next: StrategyExecutionMode) => {
      triggerHaptic(10);
      setExecutionMode(next);
      const nextLive = next === 'api_confirm';
      setLiveExecutionEnabled(nextLive);
      saveLiveExecutionPrefs({ enabled: nextLive, selectedKeyId: selectedExchangeKeyId });
      try {
        window.localStorage.setItem(EXEC_MODE_STORAGE_KEY, next);
      } catch {
        // ignore storage quota errors
      }
    },
    [selectedExchangeKeyId]
  );

  const handleSelectExchangeKey = useCallback(
    (nextKeyId: string | null) => {
      triggerHaptic(6);
      setSelectedExchangeKeyId(nextKeyId);
      saveLiveExecutionPrefs({ enabled: liveExecutionEnabled, selectedKeyId: nextKeyId });
    },
    [liveExecutionEnabled]
  );

  const persistPlacedOrders = useCallback((next: Record<string, PlacedStrategyOrderRecord>) => {
    setPlacedOrdersByStrategy(next);
    try {
      window.localStorage.setItem(PLACED_ORDERS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore storage quota errors
    }
  }, []);

  useEffect(() => {
    if (externalSection?.section) {
      if (externalSection.section === 'signals') {
        setSection('scanner');
        setScannerSubTab('signals');
      } else {
        setSection(externalSection.section);
      }
    }
  }, [externalSection]);

  const [proMonthPrice, setProMonthPrice] = useState<number | null>(null);
  const [maxMonthPrice, setMaxMonthPrice] = useState<number | null>(null);
  const selectedMaxQuota = selectedMaxMultiplier === 20 ? MAX_X20_MONTHLY_QUOTA : MAX_X10_MONTHLY_QUOTA;
  const activeMaxQuota = profile?.maxMultiplier === 20 ? MAX_X20_MONTHLY_QUOTA : MAX_X10_MONTHLY_QUOTA;
  useEffect(() => {
    let cancelled = false;
    fetch('/api/billing/plans')
      .then(
        (r) =>
          r.json() as Promise<{
            plans?: { month?: { priceUsd?: number } };
            tiers?: {
              pro?: { month?: { priceUsd?: number } };
              max?: { month?: { priceUsd?: number } };
            };
          }>
      )
      .then((d) => {
        if (cancelled) return;
        const pPrice = d.tiers?.pro?.month?.priceUsd ?? d.plans?.month?.priceUsd;
        const mPrice = d.tiers?.max?.month?.priceUsd;
        if (typeof pPrice === 'number') setProMonthPrice(pPrice);
        if (typeof mPrice === 'number') setMaxMonthPrice(mPrice);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const [marketFilter, setMarketFilter] = useState<'all' | MarketType>('all');
  const [tierFilter, setTierFilter] = useState<'all' | PlanTier>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLimit, setDraftLimit] = useState<number>(0);
  const [draftConfidence, setDraftConfidence] = useState<number>(72);
  const [draftRisk, setDraftRisk] = useState<number>(1.5);
  const [draftLeverage, setDraftLeverage] = useState<number>(5);
  const [draftPairs, setDraftPairs] = useState<string[]>(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  // MAX #8 & #12: No-Code конструктор стратегий + Webhook / Telegram
  const [customStrategies, setCustomStrategies] = useState<CustomNoCodeStrategy[]>(() =>
    readCustomNoCodeStrategies()
  );
  const [builderOpen, setBuilderOpen] = useState(false);
  const [webhookOpen, setWebhookOpen] = useState(false);

  useEffect(() => {
    const sync = () => setCustomStrategies(readCustomNoCodeStrategies());
    window.addEventListener(VERNIER_PRO_MAX_EVENT, sync);
    return () => window.removeEventListener(VERNIER_PRO_MAX_EVENT, sync);
  }, []);

  // Real OHLCV backtest breakdown for catalog comparison badges (never fabricated)
  const [catalogBacktest, setCatalogBacktest] = useState<Record<string, StrategyBreakdownResult>>({});
  useEffect(() => {
    const controller = new AbortController();
    const payload = {
      interval: '1h',
      depositUsdt: 2500,
      scope: 'all',
      strategies: STRATEGY_CATALOG.map((tpl) => ({
        strategyKey: tpl.key,
        name: tpl.name,
        shortTag: tpl.shortTag,
        marketType: tpl.marketType,
        enabled: true,
        riskPerTradePct: tpl.defaultRiskPct,
        leverage: tpl.marketType === 'futures' ? tpl.defaultLeverage : 1,
        pairs: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'],
      })),
    };
    authFetch('/api/strategies/pnl', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
      .then((res) => parseJsonResponse<StrategyPerformanceReport>(res))
      .then((parsed) => {
        if (controller.signal.aborted || !parsed.ok || !parsed.data?.breakdown) return;
        const map: Record<string, StrategyBreakdownResult> = {};
        for (const item of parsed.data.breakdown) {
          map[item.strategyKey] = item;
        }
        setCatalogBacktest(map);
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
    };
  }, []);

  const freeBaselineAvgPnlPct = useMemo(() => {
    const freeKeys = STRATEGY_CATALOG.filter((t) => t.tier === 'free').map((t) => t.key);
    const values = freeKeys
      .map((k) => catalogBacktest[k]?.totalPnlPct)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (values.length === 0) return null;
    return values.reduce((acc, v) => acc + v, 0) / values.length;
  }, [catalogBacktest]);

  const freeBaselineAvgWinRatePct = useMemo(() => {
    const freeKeys = STRATEGY_CATALOG.filter((t) => t.tier === 'free').map((t) => t.key);
    const values = freeKeys
      .map((k) => catalogBacktest[k]?.winRatePct)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
    if (values.length === 0) return null;
    return values.reduce((acc, v) => acc + v, 0) / values.length;
  }, [catalogBacktest]);

  const maxStrategiesAvgWinRatePct = useMemo(() => {
    const maxKeys = STRATEGY_CATALOG.filter((t) => t.tier === 'max').map((t) => t.key);
    const values = maxKeys
      .map((k) => catalogBacktest[k]?.winRatePct)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
    if (values.length === 0) return null;
    return values.reduce((acc, v) => acc + v, 0) / values.length;
  }, [catalogBacktest]);

  const activePlanTier: PlanTier =
    planCtx.plan === 'MAX' ? 'max' : planCtx.plan === 'PRO' ? 'pro' : getActivePlanTier(profile);
  const isMax = planCtx.isMax || isMaxSubscriptionActive(profile);
  const isPro = planCtx.isPro || isProSubscriptionActive(profile) || isMax;
  const isExpiredPro = !isPro && isProSubscriptionExpired(profile);
  const totalCreditQuota = getCreditQuotaForProfile(profile);
  const tierLabel = getTierDisplayName(activePlanTier);
  const isCreditsExhausted = Boolean(isSignedIn && !planCtx.isDemoOverride && profile && profile.creditsRemaining <= 0);

  // Верификация Live Execution и выбор активного Trade API-ключа биржи
  const liveVerification = useMemo(
    () =>
      verifyLiveExchangeConnection({
        liveExecutionEnabled,
        selectedExchangeKeyId,
        exchangeKeys,
        errorLogs: exchangeSyncErrorLogs,
      }),
    [liveExecutionEnabled, selectedExchangeKeyId, exchangeKeys, exchangeSyncErrorLogs]
  );
  const activeTradeApiKey = liveVerification.selectedKey;
  const hasAnyExchangeKey = exchangeKeys.some((k) => k.enabled);

  // Статусы подключения каждой добавленной биржи (Синхронизирован / Активен / Пауза / Требуется переавторизация)
  const exchangeConnections = useMemo(
    () =>
      exchangeKeys.map((key) => ({
        key,
        meta: resolveExchangeConnectionStatus(key, exchangeSyncCache, exchangeSyncErrorLogs),
      })),
    [exchangeKeys, exchangeSyncCache, exchangeSyncErrorLogs]
  );

  // Живой движок сигналов активных стратегий (реальные свечные индикаторы + телеметрия совпадения)
  const [activeMonitorReport, setActiveMonitorReport] = useState<LiveScannerReport | null>(null);
  const [monitorLoading, setMonitorLoading] = useState(false);
  const [apiOrderBusyKey, setApiOrderBusyKey] = useState<string | null>(null);
  const [pushSentKeys, setPushSentKeys] = useState<Record<string, boolean>>({});
  const monitorAbortRef = useRef<AbortController | null>(null);

  const activeStrategiesForMonitor = useMemo(
    () => strategies.filter((s) => s.enabled && canAccessStrategy(s.strategyKey, activePlanTier)),
    [strategies, activePlanTier]
  );

  const activeMonitorSignature = useMemo(
    () =>
      activeStrategiesForMonitor
        .map((s) => `${s.strategyKey}:${s.minConfidence}:${s.pairs.join(',')}`)
        .sort()
        .join('|'),
    [activeStrategiesForMonitor]
  );

  const runActiveStrategiesMonitor = useCallback(async () => {
    if (activeStrategiesForMonitor.length === 0) {
      setActiveMonitorReport(null);
      strategyEventStream.setStatus('idle');
      return;
    }
    if (monitorAbortRef.current) {
      monitorAbortRef.current.abort();
    }
    const controller = new AbortController();
    monitorAbortRef.current = controller;
    setMonitorLoading(true);
    strategyEventStream.setStatus('connecting');
    try {
      const minConfAcrossActive = Math.min(
        ...activeStrategiesForMonitor.map((s) => Math.max(55, Math.min(90, s.minConfidence || 70)))
      );
      const res = await authFetch('/api/strategies/scanner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timeframe: '1h',
          minConfidence: minConfAcrossActive,
          marketFilter: 'all',
          ...(activePlanTier !== 'free' ? { demoTier: activePlanTier } : {}),
          activeStrategyConfigs: activeStrategiesForMonitor.map((s) => ({
            strategyKey: s.strategyKey,
            minConfidence: s.minConfidence,
            pairs: s.pairs,
          })),
        }),
        signal: controller.signal,
      });
      const parsed = await parseJsonResponse<LiveScannerReport & { error?: string }>(res);
      if (!controller.signal.aborted && parsed.ok && parsed.data) {
        setActiveMonitorReport(parsed.data);
        if (Array.isArray(parsed.data.opportunities) && parsed.data.opportunities.length > 0) {
          strategyEventStream.publishOpportunities(parsed.data.opportunities, operatingMode);
        } else {
          strategyEventStream.heartbeat();
        }
      }
    } catch {
      // Non-blocking background monitor
    } finally {
      if (!controller.signal.aborted) {
        setMonitorLoading(false);
      }
    }
  }, [activeStrategiesForMonitor, activePlanTier, operatingMode]);

  useEffect(() => {
    if (activeStrategiesForMonitor.length === 0) {
      setActiveMonitorReport(null);
      strategyEventStream.setStatus('idle');
      return;
    }
    void runActiveStrategiesMonitor();
    const intervalId = window.setInterval(() => {
      if (isPageVisible()) {
        void runActiveStrategiesMonitor();
      }
    }, 60_000);
    const unsubVis = subscribePageVisibility((visible) => {
      if (visible) {
        void runActiveStrategiesMonitor();
      }
    });
    return () => {
      window.clearInterval(intervalId);
      unsubVis();
      monitorAbortRef.current?.abort();
    };
  }, [activeMonitorSignature, activePlanTier, runActiveStrategiesMonitor, activeStrategiesForMonitor.length]);

  // Конечный автомат стратегий (Idle / Monitoring / Execution) и simulation runner
  const simulationSnapshot = useMemo(
    () =>
      runPaperSimulationStep({
        strategies,
        opportunities: activeMonitorReport?.opportunities ?? [],
        placedOrders: placedOrdersByStrategy,
        machine: strategyStateMachine,
      }),
    [strategies, activeMonitorReport, placedOrdersByStrategy]
  );

  const handleExecuteSignalViaApi = useCallback(
    async (opp: LiveScannerOpportunity, overrideKeyId?: string | null) => {
      triggerHaptic(12);
      const stratCfg = strategies.find((s) => s.strategyKey === opp.strategyKey);
      const intent = prepareLiveExecutionIntent({
        opportunity: opp,
        strategyConfig: stratCfg,
        exchangeKeys,
        selectedExchangeKeyId: overrideKeyId ?? liveVerification.selectedKey?.id ?? selectedExchangeKeyId,
        portfolioBalanceUsdt,
      });
      if (!intent.ready || !intent.exchangeKey || !onPlaceExchangeOrder) {
        setFeedback({
          text: `${intent.reasonRu} VERNIER никогда не открывает сделки без вашего подтверждения.`,
          tone: 'error',
        });
        onOpenExchangeIntegrations?.();
        return;
      }
      const opKey = `${opp.strategyKey}-${opp.symbol}-${opp.direction}`;
      setApiOrderBusyKey(opKey);
      setFeedback(null);
      try {
        const result = await executeLiveStrategyOrder({
          intent,
          onPlaceExchangeOrder,
        });
        const orderRecord: PlacedStrategyOrderRecord = {
          strategyKey: opp.strategyKey,
          symbol: opp.symbol,
          direction: opp.direction,
          exchange: intent.exchangeKey.exchange,
          orderId: result.orderId || 'OK',
          placedAt: result.submittedAt || new Date().toISOString(),
        };
        persistPlacedOrders({
          ...placedOrdersByStrategy,
          [opp.strategyKey]: orderRecord,
        });
        strategyEventStream.markOrderExecuted({
          strategyKey: opp.strategyKey,
          symbol: opp.symbol,
          direction: opp.direction,
          orderId: orderRecord.orderId,
          exchange: intent.exchangeKey.exchange,
        });
        setFeedback({
          text: `Order Placed (Live): ${opp.direction} ${opp.symbol} на ${intent.exchangeKey.exchange.toUpperCase()} (${intent.exchangeKey.label}) · ID: ${result.orderId || 'OK'}.`,
          tone: 'success',
        });
      } catch (err) {
        setFeedback({
          text: err instanceof Error ? err.message : 'Отправка ордера через API отменена или завершилась ошибкой.',
          tone: 'error',
        });
      } finally {
        setApiOrderBusyKey(null);
      }
    },
    [
      exchangeKeys,
      liveVerification.selectedKey?.id,
      selectedExchangeKeyId,
      onPlaceExchangeOrder,
      onOpenExchangeIntegrations,
      portfolioBalanceUsdt,
      strategies,
      persistPlacedOrders,
      placedOrdersByStrategy,
    ]
  );

  // При включённом Live Execution + Verified Live:
  // инициируем размещение ордера в реальном времени по новому входящему сигналу (всегда через защищённое окно подтверждения).
  useEffect(() => {
    if (!liveExecutionEnabled || !liveVerification.verifiedLive || !liveVerification.selectedKey) {
      return;
    }
    if (apiOrderBusyKey) return;
    const incomingOpps = activeMonitorReport?.opportunities ?? [];
    if (incomingOpps.length === 0) return;

    const nextCandidate = incomingOpps.find((opp) => {
      const dispatchKey = `${opp.strategyKey}|${opp.symbol}|${opp.direction}`;
      if (dispatchedLiveSignalsRef.current.has(dispatchKey)) return false;
      const placed = placedOrdersByStrategy[opp.strategyKey];
      if (placed && placed.symbol === opp.symbol && placed.direction === opp.direction) return false;
      return true;
    });

    if (!nextCandidate) return;
    const dispatchKey = `${nextCandidate.strategyKey}|${nextCandidate.symbol}|${nextCandidate.direction}`;
    dispatchedLiveSignalsRef.current.add(dispatchKey);
    void handleExecuteSignalViaApi(nextCandidate, liveVerification.selectedKey.id);
  }, [
    liveExecutionEnabled,
    liveVerification.verifiedLive,
    liveVerification.selectedKey,
    activeMonitorReport,
    placedOrdersByStrategy,
    apiOrderBusyKey,
    handleExecuteSignalViaApi,
  ]);

  const handleToggleLiveExecution = useCallback(() => {
    triggerHaptic(12);
    const next = !liveExecutionEnabled;
    if (next && liveVerification.availableTradeKeys.length === 0) {
      setLiveExecutionEnabled(true);
      setExecutionMode('api_confirm');
      saveLiveExecutionPrefs({ enabled: true, selectedKeyId: null });
      setFeedback({
        text: 'Для активации Verified Live подключите API-ключ биржи с правом «Торговля» в «Защита → Биржи API».',
        tone: 'error',
      });
      return;
    }
    const keyToUse =
      selectedExchangeKeyId && liveVerification.availableTradeKeys.some((k) => k.id === selectedExchangeKeyId)
        ? selectedExchangeKeyId
        : liveVerification.availableTradeKeys[0]?.id ?? null;
    setLiveExecutionEnabled(next);
    setExecutionMode(next ? 'api_confirm' : 'signals');
    setSelectedExchangeKeyId(keyToUse);
    saveLiveExecutionPrefs({ enabled: next, selectedKeyId: keyToUse });
    try {
      window.localStorage.setItem(EXEC_MODE_STORAGE_KEY, next ? 'api_confirm' : 'signals');
    } catch {
      // ignore
    }
    if (next && keyToUse) {
      const chosen = liveVerification.availableTradeKeys.find((k) => k.id === keyToUse);
      setFeedback({
        text: `Live Execution включён · Verified Live (${chosen?.exchange.toUpperCase() ?? 'API'} · ${chosen?.label ?? ''}). Входящие сигналы инициируют размещение ордера через выбранный API-ключ с обязательным подтверждением.`,
        tone: 'success',
      });
    } else {
      setFeedback({
        text: 'Live Execution выключен — стратегии переведены в безопасный режим Paper Trading.',
        tone: 'success',
      });
    }
  }, [liveExecutionEnabled, liveVerification.availableTradeKeys, selectedExchangeKeyId]);

  const handleSendSignalPush = useCallback(
    async (opp: LiveScannerOpportunity) => {
      triggerHaptic(10);
      if (!pushSubscribed || !onSignalEmitted) {
        onOpenPushSettings?.();
        return;
      }
      const key = `${opp.strategyKey}-${opp.symbol}-${opp.direction}`;
      await onSignalEmitted({
        symbol: opp.symbol,
        marketType: opp.marketType,
        direction: opp.direction,
        confidence: opp.confidence,
        strategyName: opp.strategyName,
        entryZone: `${formatScannerPrice(opp.entryPrice)} · SL ${formatScannerPrice(opp.stopLossPrice)} · TP ${formatScannerPrice(opp.takeProfitPrice)}`,
      });
      setPushSentKeys((prev) => ({ ...prev, [key]: true }));
      setFeedback({
        text: `Push-сигнал ${opp.direction} ${opp.symbol} (${opp.strategyName}) отправлен на ваше устройство.`,
        tone: 'success',
      });
    },
    [pushSubscribed, onSignalEmitted, onOpenPushSettings]
  );

  // Live Multi-Pair Setup Scanner state (PRO: TOP-16, MAX: ALL 44 + 4H)
  const spotLiveSnap = useLiveMarketSnapshot('spot');
  const futuresLiveSnap = useLiveMarketSnapshot('futures');
  const spotTickersRef = useRef(spotLiveSnap.tickers);
  const futuresTickersRef = useRef(futuresLiveSnap.tickers);
  useEffect(() => {
    spotTickersRef.current = spotLiveSnap.tickers;
  }, [spotLiveSnap.tickers]);
  useEffect(() => {
    futuresTickersRef.current = futuresLiveSnap.tickers;
  }, [futuresLiveSnap.tickers]);

  const [scannerTf, setScannerTf] = useState<'1h' | '4h'>('1h');
  const [scannerMarket, setScannerMarket] = useState<'all' | MarketType>('all');
  const [scannerMinConf, setScannerMinConf] = useState<number>(72);
  const [scannerReport, setScannerReport] = useState<LiveScannerReport | null>(null);
  const [scannerIsLocal, setScannerIsLocal] = useState(false);
  const [scannerLoading, setScannerLoading] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const scannerInitRef = useRef(false);
  const scannerReqIdRef = useRef(0);

  const runLiveScanner = useCallback(
    async (
      tfOverride?: '1h' | '4h',
      opts?: { minConf?: number; market?: 'all' | MarketType; forceLocal?: boolean }
    ) => {
      const targetTf = tfOverride ?? (isMax ? scannerTf : '1h');
      const targetMinConf = opts?.minConf ?? scannerMinConf;
      const targetMarket = opts?.market ?? scannerMarket;
      const reqId = ++scannerReqIdRef.current;

      if (opts?.forceLocal) {
        const local = runLocalLiveScanner({
          tier: activePlanTier,
          timeframe: targetTf,
          minConfidence: targetMinConf,
          marketFilter: targetMarket,
          spotTickers: spotTickersRef.current,
          futuresTickers: futuresTickersRef.current,
          totalPairsAvailable: TRADING_PAIRS.length,
        });
        setScannerReport(local);
        setScannerIsLocal(true);
        setScannerError(null);
        setScannerLoading(false);
        return;
      }

      setScannerLoading(true);
      setScannerError(null);
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 2200);

      try {
        const res = await authFetch('/api/strategies/scanner', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            timeframe: targetTf,
            minConfidence: targetMinConf,
            marketFilter: targetMarket,
            ...(activePlanTier !== 'free' ? { demoTier: activePlanTier } : {}),
          }),
          signal: controller.signal,
        });
        const parsed = await parseJsonResponse<LiveScannerReport & { error?: string }>(res);
        if (reqId !== scannerReqIdRef.current) return;
        if (!parsed.ok || !parsed.data || !Array.isArray(parsed.data.opportunities)) {
          throw new Error(parsed.errorMessage || 'Fallback to local scanner');
        }
        setScannerReport(parsed.data);
        setScannerIsLocal(false);
        setScannerError(null);
      } catch {
        if (reqId !== scannerReqIdRef.current) return;
        // Мгновенный (<10 мс) локальный расчёт сетапов — кнопка никогда не зависает
        const local = runLocalLiveScanner({
          tier: activePlanTier,
          timeframe: targetTf,
          minConfidence: targetMinConf,
          marketFilter: targetMarket,
          spotTickers: spotTickersRef.current,
          futuresTickers: futuresTickersRef.current,
          totalPairsAvailable: TRADING_PAIRS.length,
        });
        setScannerReport(local);
        setScannerIsLocal(true);
        setScannerError(null);
      } finally {
        window.clearTimeout(timeoutId);
        if (reqId === scannerReqIdRef.current) {
          setScannerLoading(false);
        }
      }
    },
    [isMax, scannerTf, scannerMinConf, scannerMarket, activePlanTier]
  );

  // Однократный автозапуск при первом входе в «AI-сканер» (без бесконечного цикла при ошибке)
  useEffect(() => {
    if (section === 'scanner' && !scannerInitRef.current) {
      scannerInitRef.current = true;
      void runLiveScanner();
    }
  }, [section, runLiveScanner]);

  // Мгновенное обновление выдачи при изменении фильтра рынка или порога уверенности
  useEffect(() => {
    if (section !== 'scanner' || !scannerInitRef.current) return;
    const timer = window.setTimeout(() => {
      void runLiveScanner(undefined, { forceLocal: scannerIsLocal });
    }, 140);
    return () => window.clearTimeout(timer);
  }, [section, scannerMarket, scannerMinConf, scannerIsLocal, runLiveScanner]);

  useEffect(() => {
    const handleTourFocus = (evt: Event) => {
      const targetId = (evt as CustomEvent<string>).detail;
      if (targetId === 'tour-strategies-pnl') {
        setSection('analytics');
      }
    };
    window.addEventListener('aegis:tour-focus', handleTourFocus);
    return () => window.removeEventListener('aegis:tour-focus', handleTourFocus);
  }, []);

  const startEdit = (cfg: StrategyConfig) => {
    setEditingId(cfg.id);
    setDraftLimit(isPro ? (cfg.dailySignalLimit === 1 ? 0 : cfg.dailySignalLimit) : FREE_DAILY_SIGNAL_LIMIT);
    setDraftConfidence(cfg.minConfidence);
    setDraftRisk(cfg.riskPerTradePct);
    setDraftLeverage(isPro ? cfg.leverage : Math.min(FREE_MAX_LEVERAGE, cfg.leverage));
    setDraftPairs(cfg.pairs);
    setFeedback(null);
  };

  const handleSave = async (cfg: StrategyConfig) => {
    setSavingId(cfg.id);
    setFeedback(null);
    try {
      await onSaveStrategy(cfg.id, {
        enabled: cfg.enabled,
        dailySignalLimit: isPro ? draftLimit : FREE_DAILY_SIGNAL_LIMIT,
        minConfidence: draftConfidence,
        riskPerTradePct: draftRisk,
        leverage: cfg.marketType === 'spot' ? 1 : isPro ? draftLeverage : Math.min(FREE_MAX_LEVERAGE, draftLeverage),
        pairs: draftPairs.length > 0 ? draftPairs : ['BTCUSDT'],
      });
      setEditingId(null);
      setFeedback({ text: `Параметры стратегии «${cfg.name}» сохранены.`, tone: 'success' });
    } catch (err) {
      setFeedback({
        text: err instanceof Error ? err.message : 'Ошибка сохранения стратегии',
        tone: 'error',
      });
    } finally {
      setSavingId(null);
    }
  };

  const handleToggle = async (cfg: StrategyConfig) => {
    setSavingId(cfg.id);
    setFeedback(null);
    try {
      const nextEnabled = !cfg.enabled;
      await onSaveStrategy(cfg.id, {
        enabled: nextEnabled,
        dailySignalLimit: isPro ? cfg.dailySignalLimit : FREE_DAILY_SIGNAL_LIMIT,
        minConfidence: cfg.minConfidence,
        riskPerTradePct: cfg.riskPerTradePct,
        leverage: cfg.marketType === 'spot' ? 1 : isPro ? cfg.leverage : Math.min(FREE_MAX_LEVERAGE, cfg.leverage),
        pairs: cfg.pairs.length > 0 ? cfg.pairs : ['BTCUSDT'],
      });
      setFeedback({
        text: `Стратегия «${cfg.name}» ${nextEnabled ? 'активирована' : 'приостановлена'}.`,
        tone: 'success',
      });
    } catch (err) {
      setFeedback({
        text: err instanceof Error ? err.message : 'Не удалось изменить статус стратегии',
        tone: 'error',
      });
    } finally {
      setSavingId(null);
    }
  };

  const scopedCatalog = useMemo(
    () =>
      STRATEGY_CATALOG.filter(
        (tpl) =>
          (marketFilter === 'all' || tpl.marketType === marketFilter) &&
          (tierFilter === 'all' || tpl.tier === tierFilter)
      ).map((tpl) => {
        const existing = strategies.find((s) => s.strategyKey === tpl.key);
        const isLockedForUser = !canAccessStrategy(tpl.key, activePlanTier);
        const isEnabled = Boolean(existing?.enabled) && !isLockedForUser;
        return { tpl, cfg: existing, isEnabled };
      }),
    [marketFilter, tierFilter, strategies, activePlanTier]
  );

  const statusCounts = useMemo(() => {
    let active = 0;
    for (const item of scopedCatalog) {
      if (item.isEnabled) active += 1;
    }
    return {
      total: scopedCatalog.length,
      active,
      inactive: scopedCatalog.length - active,
    };
  }, [scopedCatalog]);

  const displayList = useMemo(
    () =>
      scopedCatalog.filter(({ isEnabled }) => {
        if (statusFilter === 'all') return true;
        return statusFilter === 'active' ? isEnabled : !isEnabled;
      }),
    [scopedCatalog, statusFilter]
  );

  const activeStrategies = useMemo(
    () => strategies.filter((s) => s.enabled && canAccessStrategy(s.strategyKey, activePlanTier)),
    [strategies, activePlanTier]
  );
  const activeCount = activeStrategies.length;
  const hasUnlimitedProSignals = isPro && activeStrategies.some((s) => s.dailySignalLimit === 0);
  const totalConfiguredSignals = activeStrategies.reduce(
    (acc, s) => acc + (isPro ? s.dailySignalLimit : FREE_DAILY_SIGNAL_LIMIT),
    0
  );

  const sectionTabs = useMemo(
    () => [
      {
        id: 'catalog' as const,
        label: 'Каталог',
        icon: <Layers className="w-3.5 h-3.5 text-emerald-400" />,
        meta: `${activeCount}/${STRATEGY_CATALOG.length}`,
      },
      {
        id: 'scanner' as const,
        label: 'AI-сканер',
        icon: <Radar className="w-3.5 h-3.5 text-cyan-400" />,
        meta: signalStreamCount > 0 ? String(signalStreamCount) : isMax ? '44' : isPro ? 'PRO' : undefined,
      },
      {
        id: 'sentiment' as const,
        label: 'Sentiment',
        icon: <Gauge className="w-3.5 h-3.5 text-emerald-400" />,
        meta: isPro ? 'LIVE' : 'PRO',
      },
      {
        id: 'analytics' as const,
        label: 'Доходность PnL',
        icon: <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />,
      },
      {
        id: 'calculator' as const,
        label: 'Калькулятор',
        icon: <Calculator className="w-3.5 h-3.5 text-amber-400" />,
      },
      {
        id: 'journal' as const,
        label: 'Дневник',
        icon: <BookOpen className="w-3.5 h-3.5 text-emerald-400" />,
      },
    ],
    [activeCount, signalStreamCount, isMax, isPro]
  );

  // Компактный блок «Статус подключённых бирж» (используется в Движке и в Ленте сигналов)
  const renderExchangeConnectionStrip = () => (
    <div className="rounded-xl border border-white/10 bg-[#0B0F17]/90 p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-200">
          <Link2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          <span>Статус подключённых бирж</span>
          <span className="font-mono text-[10px] text-slate-400">
            ({exchangeConnections.length})
          </span>
        </div>
        {onOpenExchangeIntegrations && (
          <button
            type="button"
            onClick={() => {
              triggerHaptic(8);
              onOpenExchangeIntegrations();
            }}
            className="text-[11px] font-semibold text-emerald-300 hover:text-emerald-200 transition-colors"
          >
            {exchangeConnections.length > 0 ? 'Управлять API →' : '+ Подключить биржу'}
          </button>
        )}
      </div>

      {exchangeConnections.length === 0 ? (
        <div className="text-[11px] text-slate-400 leading-relaxed">
          Биржи не подключены — стратегии работают в режиме <strong className="text-slate-200">Paper / Сигналы</strong>. Для Live-ордеров и отображения реального баланса подключите Binance, Bybit или OKX в «Защита → Биржи API».
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {exchangeConnections.map(({ key, meta }) => {
            const badgeStyle =
              meta.health === 'synced'
                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                : meta.health === 'reauth'
                  ? 'border-rose-500/45 bg-rose-500/15 text-rose-300'
                  : meta.health === 'paused'
                    ? 'border-amber-500/35 bg-amber-500/12 text-amber-200'
                    : 'border-cyan-500/40 bg-cyan-500/15 text-cyan-200';
            return (
              <div
                key={key.id}
                className={`rounded-lg border px-2.5 py-2 flex items-center justify-between gap-2 text-[11px] ${
                  meta.health === 'reauth'
                    ? 'border-rose-500/35 bg-rose-500/[0.06]'
                    : 'border-white/8 bg-white/[0.02]'
                }`}
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono font-bold text-white uppercase">
                      {key.exchange}
                    </span>
                    <span className="text-slate-400 truncate max-w-[110px]">{key.label}</span>
                    <span
                      className={`px-1 py-0.5 rounded font-mono text-[9px] font-semibold ${
                        key.permissions === 'trade'
                          ? 'bg-cyan-500/15 text-cyan-200 border border-cyan-400/30'
                          : 'bg-white/8 text-slate-300 border border-white/10'
                      }`}
                    >
                      {key.permissions === 'trade' ? 'Trade' : 'Read-Only'}
                    </span>
                    {key.testnet && (
                      <span className="px-1 py-0.5 rounded font-mono text-[9px] bg-amber-500/15 text-amber-300 border border-amber-500/30">
                        Testnet
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-400 truncate">
                    {meta.detailRu}
                    {typeof meta.balanceUsdt === 'number' && meta.balanceUsdt > 0 && meta.health !== 'reauth' && (
                      <span className="font-mono text-slate-300">
                        {' '}· {privacyMode ? '•••••' : `$${meta.balanceUsdt.toLocaleString('en-US', { maximumFractionDigits: 2 })}`}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-semibold whitespace-nowrap ${badgeStyle}`}>
                    {meta.health === 'synced' && <CheckCircle2 className="w-3 h-3 shrink-0" />}
                    {meta.health === 'reauth' && <AlertTriangle className="w-3 h-3 shrink-0" />}
                    {meta.health === 'paused' && <PauseCircle className="w-3 h-3 shrink-0" />}
                    {meta.health === 'active' && <Activity className="w-3 h-3 shrink-0" />}
                    <span>{meta.labelRu}</span>
                  </span>
                  {meta.health === 'reauth' && onOpenExchangeIntegrations && (
                    <button
                      type="button"
                      onClick={onOpenExchangeIntegrations}
                      className="px-2 py-0.5 rounded-md bg-rose-500/20 hover:bg-rose-500/30 border border-rose-400/40 text-[10px] font-semibold text-rose-100 transition-colors"
                    >
                      Обновить
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const dailySignalsLabel = isPro
    ? hasUnlimitedProSignals || activeCount > 0
      ? `Без ограничений (${tierLabel})`
      : '0'
    : `${totalConfiguredSignals} / день (Free)`;

  const sidebarBottom = (
    <div className="space-y-1.5 text-xs font-mono tabular-nums">
      {profile && (
        <div className="flex items-center justify-between">
          <span className="font-sans text-slate-400">Кредиты</span>
          <span className={profile.creditsRemaining > 0 ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>
            {profile.creditsRemaining} / {totalCreditQuota}
          </span>
        </div>
      )}
      <div className="flex items-center justify-between">
        <span className="font-sans text-slate-400">Сигналов/день</span>
        <span className="text-emerald-400 font-semibold">{dailySignalsLabel}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="font-sans text-slate-400">Тариф</span>
        <span
          className={
            isMax
              ? 'text-cyan-300 font-semibold'
              : isPro
                ? 'text-amber-400 font-semibold'
                : isExpiredPro
                  ? 'text-rose-400 font-semibold'
                  : 'text-slate-200'
          }
        >
          {isPro
            ? `${tierLabel} · до ${formatProUntilDate(profile?.proUntil)}`
            : isExpiredPro
              ? 'Подписка истекла'
              : 'Бесплатный'}
        </span>
      </div>
      {(!isMax || isCreditsExhausted) && (
        <button
          type="button"
          onClick={() => void onSwitchPlan(isPro && !isCreditsExhausted ? 'max' : isMax ? 'max' : 'pro', selectedMaxMultiplier)}
          className={`pt-1 font-sans text-left font-semibold transition-colors ${
            isPro ? 'text-cyan-300 hover:text-cyan-200' : 'text-amber-300 hover:text-amber-200'
          }`}
        >
          {isCreditsExhausted && isMax
            ? `Продлить MAX (+${activeMaxQuota.toLocaleString('ru-RU')} кр.) →`
            : isCreditsExhausted && isPro
              ? `Продлить PRO (+${PRO_MONTHLY_QUOTA} кр.) →`
              : isPro
                ? `Перейти на MAX (до ${MAX_X20_MONTHLY_QUOTA.toLocaleString('ru-RU')} кр.) →`
                : isExpiredPro
                  ? 'Продлить подписку →'
                  : 'Перейти на PRO / MAX →'}
        </button>
      )}
      {onOpenPushSettings && (
        <button
          type="button"
          onClick={onOpenPushSettings}
          className={`pt-1 font-sans text-left font-medium transition-colors block ${
            pushSubscribed ? 'text-emerald-400 hover:text-emerald-300' : 'text-amber-300 hover:text-amber-200'
          }`}
        >
          {pushSubscribed ? 'Push-оповещения активны' : 'Включить Push-сигналы →'}
        </button>
      )}
    </div>
  );

  return (
    <StaggerDeck>
      <WorkspaceShell
        title="Стратегии"
        subtitle={`${activeCount} активных · ${isPro ? `${tierLabel} ∞/день` : `${totalConfiguredSignals}/день`}`}
        icon={
          <img
            src="/src/assets/images/terminal_icon_strategy_1794855842754.jpg"
            alt="Стратегии Vernier"
            width={32}
            height={32}
            referrerPolicy="no-referrer"
            className="w-8 h-8 rounded-lg object-cover border border-amber-500/25"
          />
        }
        items={sectionTabs}
        activeId={section}
        onChange={setSection}
        layoutId="strategies-workspace-nav"
        accent="amber"
        sidebarBottomSlot={sidebarBottom}
      >
        {section === 'catalog' && (
          <div className="space-y-4">
            {(isCreditsExhausted || isExpiredPro) && (
              <div className="rounded-2xl border border-amber-500/35 bg-amber-500/10 p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-start gap-2.5 text-xs text-amber-100 max-w-2xl">
                  <Crown className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <div className="font-semibold text-amber-200">
                      {isExpiredPro
                        ? `Срок действия подписки истёк (${formatProUntilDate(profile?.proUntil)})`
                        : isMax
                          ? `Месячные кредиты MAX исчерпаны (0/${activeMaxQuota.toLocaleString('ru-RU')})`
                          : isPro
                            ? `Месячные кредиты PRO исчерпаны (0/${PRO_MONTHLY_QUOTA})`
                            : `Лимит бесплатных кредитов достигнут (0/${totalCreditQuota})`}
                    </div>
                    <p className="text-amber-200/80 leading-relaxed">
                      {isMax
                        ? `Продлите тариф MAX, чтобы сразу пополнить +${activeMaxQuota.toLocaleString('ru-RU')} кредитов для анализа, сканера и 1D-бэктеста.`
                        : isPro
                          ? `Продлите PRO (+${PRO_MONTHLY_QUOTA} кр.) или перейдите на MAX X10 / X20 (1 000–2 000 кредитов в месяц).`
                          : `Перейдите на PRO (${PRO_MONTHLY_QUOTA} кр./мес) или MAX (1 000–2 000 кр./мес): доступ ко всем ${STRATEGY_CATALOG.length} стратегиям, плечу до 20x и снятие лимита сигналов.`}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void onSwitchPlan(isMax ? 'max' : 'pro', selectedMaxMultiplier)}
                  className="cta-shimmer min-h-[40px] px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                >
                  <Crown className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {isMax
                      ? `Продлить MAX (+${activeMaxQuota.toLocaleString('ru-RU')} кр.)`
                      : isPro
                        ? `Продлить PRO (+${PRO_MONTHLY_QUOTA} кр.)`
                        : isExpiredPro
                          ? 'Продлить подписку'
                          : 'Перейти на PRO / MAX'}
                  </span>
                </button>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex items-center p-1 rounded-xl bg-[#111827] border border-white/8">
                  {(
                    [
                      { id: 'all', label: `Все (${STRATEGY_CATALOG.length})` },
                      { id: 'spot', label: `Спот (${SPOT_STRATEGIES_COUNT})` },
                      { id: 'futures', label: `Фьючерсы (${FUTURES_STRATEGIES_COUNT})` },
                    ] as const
                  ).map((tab) => {
                    const active = marketFilter === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setMarketFilter(tab.id)}
                        className={`min-h-[34px] px-3 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                          active ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>

                <div className="inline-flex items-center p-1 rounded-xl bg-[#111827] border border-white/8">
                  {(
                    [
                      { id: 'all', label: 'Все тарифы' },
                      { id: 'free', label: 'Free' },
                      { id: 'pro', label: 'PRO' },
                      { id: 'max', label: `MAX (${MAX_EXCLUSIVE_STRATEGIES_COUNT})` },
                    ] as const
                  ).map((tr) => {
                    const active = tierFilter === tr.id;
                    return (
                      <button
                        key={tr.id}
                        type="button"
                        onClick={() => setTierFilter(tr.id)}
                        className={`min-h-[34px] px-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                          active
                            ? tr.id === 'max'
                              ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-400/40'
                              : tr.id === 'pro'
                                ? 'bg-amber-500/25 text-amber-200 border border-amber-400/40'
                                : 'bg-white/12 text-white'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {tr.label}
                      </button>
                    );
                  })}
                </div>

                <div className="inline-flex items-center p-1 rounded-xl bg-[#111827] border border-white/8">
                  {(
                    [
                      { id: 'all', label: `Все (${statusCounts.total})` },
                      { id: 'active', label: `Активные (${statusCounts.active})` },
                      { id: 'inactive', label: `Неактивные (${statusCounts.inactive})` },
                    ] as const
                  ).map((st) => {
                    const active = statusFilter === st.id;
                    return (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() => setStatusFilter(st.id)}
                        className={`min-h-[34px] px-3 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                          active
                            ? st.id === 'active'
                              ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/35'
                              : 'bg-white/12 text-white'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {st.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(10);
                    setBuilderOpen(true);
                  }}
                  className="min-h-[36px] px-3 rounded-xl border border-cyan-500/40 bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-200 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
                >
                  <Plus className="w-3.5 h-3.5 shrink-0" />
                  <span>Создать стратегию</span>
                  <span className="text-[9px] font-mono px-1 rounded bg-cyan-400/20">MAX</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(10);
                    setWebhookOpen(true);
                  }}
                  className="min-h-[36px] px-3 rounded-xl border border-white/12 bg-white/5 hover:bg-white/10 text-slate-200 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
                >
                  <Webhook className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
                  <span>Webhook / TG</span>
                </button>
              </div>
              {feedback && (
                <div
                  className={`w-full rounded-xl border px-3 py-2 text-xs ${
                    feedback.tone === 'error'
                      ? 'border-rose-500/35 bg-rose-500/10 text-rose-200'
                      : 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200'
                  }`}
                >
                  {feedback.text}
                </div>
              )}
            </div>

            {/* Движок работы активных стратегий: прозрачный режим + лента живых сигналов */}
            {(() => {
              const activeSignals = activeMonitorReport?.opportunities ?? [];
              const watchedPairsCount = new Set(activeStrategies.flatMap((s) => s.pairs)).size;
              return (
                <section className="rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/[0.07] via-[#0E1522] to-[#0B0F17] p-4 space-y-3.5">
                  <div className="flex flex-wrap items-start justify-between gap-2.5">
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-300">
                          <Radio className="w-3.5 h-3.5 animate-pulse shrink-0" />
                          <span>Движок активных стратегий</span>
                        </span>
                        {liveVerification.verifiedLive && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-emerald-400/55 bg-emerald-500/20 font-mono text-[10px] font-bold text-emerald-200 shadow-[0_0_12px_-4px_rgba(16,185,129,0.75)]">
                            <ShieldCheck className="w-3 h-3 text-emerald-300 shrink-0" />
                            <span>Verified Live</span>
                          </span>
                        )}
                        <span className="px-2 py-0.5 rounded-md border border-emerald-500/35 bg-emerald-500/15 font-mono text-[10px] font-bold text-emerald-200">
                          {activeCount} / {STRATEGY_CATALOG.length} акт.
                        </span>
                        <span className="px-2 py-0.5 rounded-md border border-white/10 bg-white/5 font-mono text-[10px] text-slate-300">
                          {watchedPairsCount} пар
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-md border font-mono text-[10px] font-bold ${
                            Object.keys(placedOrdersByStrategy).length > 0
                              ? 'border-emerald-400/45 bg-emerald-500/20 text-emerald-200'
                              : 'border-white/10 bg-white/5 text-slate-400'
                          }`}
                          title={ENGINE_STATE_META.Execution.descriptionRu}
                        >
                          Order Placed (Live): {Object.keys(placedOrdersByStrategy).length}
                        </span>
                        <span
                          className="px-2 py-0.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 font-mono text-[10px] text-cyan-200"
                          title={ENGINE_STATE_META.Monitoring.descriptionRu}
                        >
                          Monitoring Signal: {simulationSnapshot.counts.monitoring + simulationSnapshot.counts.execution}
                        </span>
                        <span
                          className="px-2 py-0.5 rounded-md border border-white/10 bg-white/5 font-mono text-[10px] text-slate-400"
                          title={ENGINE_STATE_META.Idle.descriptionRu}
                        >
                          Idle: {simulationSnapshot.counts.idle}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-300 leading-relaxed">
                        {liveVerification.verifiedLive
                          ? liveVerification.detailRu
                          : 'Включите «Live Execution» для подключения к выбранному API-ключу биржи и реального размещения ордеров, либо работайте в безопасном режиме симуляции Paper Trading.'}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          triggerHaptic(8);
                          setModeInfoOpen(true);
                        }}
                        className="min-h-[34px] px-2.5 rounded-xl border border-cyan-500/35 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-200 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
                      >
                        <Info className="w-3.5 h-3.5 shrink-0" />
                        <span>Paper vs Live</span>
                      </button>
                      <button
                        type="button"
                        disabled={monitorLoading || activeCount === 0}
                        onClick={() => void runActiveStrategiesMonitor()}
                        className="min-h-[34px] px-3 rounded-xl border border-emerald-500/35 bg-emerald-500/15 hover:bg-emerald-500/25 disabled:opacity-50 text-emerald-200 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${monitorLoading ? 'animate-spin' : ''}`} />
                        <span>{monitorLoading ? 'Проверяем свечи…' : 'Проверить сигналы'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Явный переключатель Live Execution + выбор API-ключа биржи + бейдж Verified Live */}
                  <div
                    className={`rounded-xl border p-3 space-y-2.5 transition-colors ${
                      liveVerification.verifiedLive
                        ? 'border-emerald-400/50 bg-emerald-500/[0.09]'
                        : liveExecutionEnabled
                          ? 'border-amber-400/45 bg-amber-500/[0.07]'
                          : 'border-white/10 bg-[#0B0F17]/95'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={liveExecutionEnabled}
                          aria-label="Включить Live Execution (реальное исполнение ордеров через API биржи)"
                          onClick={handleToggleLiveExecution}
                          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors ${
                            liveExecutionEnabled
                              ? liveVerification.verifiedLive
                                ? 'border-emerald-400/60 bg-emerald-500'
                                : 'border-amber-400/60 bg-amber-500'
                              : 'border-white/15 bg-white/10'
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                              liveExecutionEnabled ? 'translate-x-5' : 'translate-x-1'
                            }`}
                          />
                        </button>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-white">
                            <span>Live Execution (Реальное исполнение)</span>
                            {liveVerification.verifiedLive ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-emerald-400/55 bg-emerald-500/20 font-mono text-[10px] font-bold text-emerald-200">
                                <ShieldCheck className="w-3 h-3 text-emerald-300 shrink-0" />
                                <span>Verified Live</span>
                              </span>
                            ) : liveExecutionEnabled ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-amber-400/45 bg-amber-500/15 font-mono text-[10px] font-bold text-amber-200">
                                <AlertTriangle className="w-3 h-3 shrink-0" />
                                <span>{liveVerification.statusLabel}</span>
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-md border border-white/10 bg-white/5 font-mono text-[10px] text-slate-400">
                                Paper Mode
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400 leading-snug mt-0.5">
                            {liveVerification.detailRu}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {liveVerification.availableTradeKeys.length > 0 ? (
                          <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-300">
                            <KeyRound className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
                            <select
                              aria-label="Выбор API-ключа биржи для Live Execution"
                              value={liveVerification.selectedKey?.id ?? ''}
                              onChange={(e) => handleSelectExchangeKey(e.target.value || null)}
                              className="min-h-[32px] rounded-lg border border-white/15 bg-[#070B12] px-2.5 text-xs font-mono text-white focus:border-emerald-400 focus:outline-none"
                            >
                              {liveVerification.availableTradeKeys.map((k) => (
                                <option key={k.id} value={k.id}>
                                  {k.exchange.toUpperCase()} · {k.label}
                                  {k.testnet ? ' (Testnet)' : ' (Mainnet)'}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : (
                          onOpenExchangeIntegrations && (
                            <button
                              type="button"
                              onClick={() => {
                                triggerHaptic(8);
                                onOpenExchangeIntegrations();
                              }}
                              className="min-h-[32px] px-3 rounded-lg border border-amber-400/45 bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                            >
                              <KeyRound className="w-3.5 h-3.5 shrink-0" />
                              <span>Подключить Trade API</span>
                            </button>
                          )
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            triggerHaptic(8);
                            setApiGuideOpen(true);
                          }}
                          className="min-h-[32px] px-2.5 rounded-lg border border-cyan-500/35 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-200 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
                        >
                          <BookOpen className="w-3.5 h-3.5 shrink-0" />
                          <span>Гайд по API</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Индикатор статуса подключённых бирж */}
                  {renderExchangeConnectionStrip()}

                  {/* Переключатель режима работы стратегий */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => handleSetExecutionMode('signals')}
                      className={`text-left rounded-xl border p-2.5 transition-colors ${
                        !liveExecutionEnabled
                          ? 'border-emerald-400/50 bg-emerald-500/12 text-white'
                          : 'border-white/8 bg-[#0B0F17] text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs font-semibold">
                        <span className="inline-flex items-center gap-1.5">
                          <BellRing className="w-3.5 h-3.5 text-emerald-400" />
                          <span>1. Paper Trading (Симуляция + Push)</span>
                        </span>
                        {!liveExecutionEnabled && (
                          <span className="text-[10px] font-mono text-emerald-300">АКТИВЕН</span>
                        )}
                      </div>
                      <div className="mt-1 text-[10px] text-slate-400">
                        Симуляция без риска для средств: вы получаете точки входа, SL и TP и отслеживаете прогресс на графике.
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSetExecutionMode('api_confirm')}
                      className={`text-left rounded-xl border p-2.5 transition-colors ${
                        liveExecutionEnabled
                          ? 'border-cyan-400/50 bg-cyan-500/12 text-white'
                          : 'border-white/8 bg-[#0B0F17] text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs font-semibold">
                        <span className="inline-flex items-center gap-1.5">
                          <KeyRound className="w-3.5 h-3.5 text-cyan-300" />
                          <span>2. Live Execution (API + подтверждение)</span>
                        </span>
                        {liveExecutionEnabled && (
                          <span className="text-[10px] font-mono text-cyan-200">
                            {liveVerification.verifiedLive ? 'VERIFIED LIVE' : 'АКТИВЕН'}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-[10px] text-slate-400">
                        {activeTradeApiKey
                          ? `Выбран ключ: ${activeTradeApiKey.exchange.toUpperCase()} (${activeTradeApiKey.label}${activeTradeApiKey.testnet ? ' · Testnet' : ''})`
                          : hasAnyExchangeKey
                            ? 'Подключён Read-Only ключ — для Live-ордеров нужен ключ с правом «Торговля».'
                            : 'Ключ биржи не подключён — добавьте в «Защита → Биржи API».'}
                      </div>
                    </button>
                  </div>

                  {/* Лента живых сигналов, сгенерированных активными стратегиями */}
                  {activeCount === 0 ? (
                    <div className="rounded-xl border border-white/8 bg-[#0B0F17] px-3 py-2.5 text-xs text-slate-400">
                      Включите хотя бы одну стратегию в каталоге ниже (кнопка «Выкл → Активен»), чтобы движок начал мониторить её пары и выдавать сигналы.
                    </div>
                  ) : activeSignals.length > 0 ? (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                        <span className="font-semibold text-white inline-flex items-center gap-1.5">
                          <Zap className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Живые сигналы ваших стратегий ({activeSignals.length})</span>
                        </span>
                        <div className="flex items-center gap-2.5">
                          {activeMonitorReport?.updatedAt && (
                            <span className="font-mono text-[10px] text-slate-400">
                              Скан: {new Date(activeMonitorReport.updatedAt).toLocaleTimeString('ru-RU')}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setSection('scanner');
                              setScannerSubTab('signals');
                            }}
                            className="text-emerald-300 hover:text-emerald-200 font-semibold whitespace-nowrap"
                          >
                            Вся лента ({signalStreamCount}) →
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                        {activeSignals.slice(0, 6).map((opp) => {
                          const opKey = `${opp.strategyKey}-${opp.symbol}-${opp.direction}`;
                          const isBusy = apiOrderBusyKey === opKey;
                          const isPushDone = Boolean(pushSentKeys[opKey]);
                          const stratCfg = strategies.find((s) => s.strategyKey === opp.strategyKey);
                          return (
                            <div
                              key={opKey}
                              className={`rounded-xl border bg-[#0B0F17] p-3 space-y-2 ${
                                opp.direction === 'LONG' ? 'border-emerald-500/35' : 'border-rose-500/35'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="font-mono text-xs font-bold text-white">{opp.symbol}</span>
                                    <span
                                      className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-bold ${
                                        opp.direction === 'LONG'
                                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/35'
                                          : 'bg-rose-500/20 text-rose-300 border border-rose-500/35'
                                      }`}
                                    >
                                      {opp.direction}
                                    </span>
                                    <span className="font-mono text-[10px] text-slate-400">
                                      {opp.marketType === 'futures'
                                        ? `Futures ${stratCfg?.leverage ?? 3}x`
                                        : 'Spot'}{' '}
                                      · Риск {stratCfg?.riskPerTradePct ?? 1.5}%
                                    </span>
                                  </div>
                                  <div className="mt-0.5 text-[11px] text-slate-300 truncate">{opp.strategyName}</div>
                                </div>
                                <span className="font-mono text-xs font-bold text-cyan-300 shrink-0">
                                  {opp.confidence}%
                                </span>
                              </div>

                              <div className="grid grid-cols-3 gap-1.5 text-[10px] font-mono tabular-nums">
                                <div className="rounded-lg border border-white/6 bg-white/[0.03] px-2 py-1">
                                  <div className="font-sans text-[9px] text-slate-500">Вход</div>
                                  <div className="text-white font-semibold truncate">{formatScannerPrice(opp.entryPrice)}</div>
                                </div>
                                <div className="rounded-lg border border-white/6 bg-white/[0.03] px-2 py-1">
                                  <div className="font-sans text-[9px] text-slate-500">Stop-Loss</div>
                                  <div className="text-rose-400 font-semibold truncate">{formatScannerPrice(opp.stopLossPrice)}</div>
                                </div>
                                <div className="rounded-lg border border-white/6 bg-white/[0.03] px-2 py-1">
                                  <div className="font-sans text-[9px] text-slate-500">Take-Profit</div>
                                  <div className="text-emerald-400 font-semibold truncate">{formatScannerPrice(opp.takeProfitPrice)}</div>
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                                {onOpenPairOnMarket && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onOpenPairOnMarket(
                                        opp.symbol,
                                        opp.marketType,
                                        buildStrategySignalOverlay({
                                          strategyKey: opp.strategyKey,
                                          strategyName: opp.strategyName,
                                          symbol: opp.symbol,
                                          marketType: opp.marketType,
                                          mode: operatingMode,
                                          emittedSignal: opp,
                                        })
                                      )
                                    }
                                    className="min-h-[30px] px-2.5 rounded-lg border border-cyan-500/35 bg-cyan-500/12 hover:bg-cyan-500/22 text-[11px] font-semibold text-cyan-100 inline-flex items-center gap-1 transition-colors"
                                  >
                                    <LineChart className="w-3 h-3 text-cyan-300" />
                                    <span>График</span>
                                    <ArrowUpRight className="w-3 h-3" />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => void handleSendSignalPush(opp)}
                                  className="min-h-[30px] px-2.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20 text-[11px] font-medium text-cyan-200 inline-flex items-center gap-1 transition-colors"
                                >
                                  <BellRing className="w-3 h-3" />
                                  <span>{isPushDone ? 'Отправлено' : pushSubscribed ? 'В Push' : 'Вкл. Push'}</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => void handleExecuteSignalViaApi(opp)}
                                  className={`ml-auto min-h-[30px] px-2.5 rounded-lg text-[11px] font-semibold inline-flex items-center gap-1 transition-colors ${
                                    activeTradeApiKey
                                      ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                                      : 'border border-amber-400/40 bg-amber-500/15 hover:bg-amber-500/25 text-amber-200'
                                  }`}
                                >
                                  <Send className="w-3 h-3" />
                                  <span>
                                    {isBusy
                                      ? 'Отправка…'
                                      : activeTradeApiKey
                                        ? 'Через API'
                                        : 'Подкл. API'}
                                  </span>
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-white/8 bg-[#0B0F17] px-3 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="text-slate-300">
                        {monitorLoading
                          ? `Сканируем свечи 1H по ${watchedPairsCount} парам для ${activeCount} активных стратегий…`
                          : `Сейчас ни одна из ${activeCount} активных стратегий не достигла порога уверенности. Реальный % близости и причина ожидания указаны на каждой активной карточке ниже.`}
                      </span>
                      <button
                        type="button"
                        onClick={() => setSection('scanner')}
                        className="text-cyan-300 hover:text-cyan-200 font-semibold whitespace-nowrap"
                      >
                        Сканировать все пары →
                      </button>
                    </div>
                  )}
                </section>
              );
            })()}

            <FeatureGuide
              title="Как работает Каталог стратегий (Спот + Фьючерсы)"
              summary="Включайте и настраивайте 27 алгоритмических стратегий под свой риск, плечо и список пар. Прогресс на активной карточке показывает реальное совпадение индикаторов до срабатывания сигнала."
              steps={[
                'Включите нужные стратегии и выберите режим: «Сигналы (Экран + Push / TG)» или «API биржи (вход в 1 клик с обязательным подтверждением)».',
                'Нажмите «Настроить», чтобы задать % риска на сделку, плечо, порог уверенности (например 65–75%) и отслеживаемые пары.',
                'Когда условия на свечах совпадают выше вашего порога — сигнал сразу появляется в «Ленте живых сигналов» сверху и на самой карточке стратегии.',
              ]}
              compact
            />

            {/* MAX #8: Пользовательские No-Code стратегии */}
            {customStrategies.length > 0 && (
              <div className="rounded-2xl border border-cyan-500/25 bg-cyan-500/[0.05] p-3.5 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-cyan-200 inline-flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-cyan-300" />
                    <span>Ваши No-Code стратегии ({customStrategies.length})</span>
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">Сохранено локально</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {customStrategies.map((cs) => (
                    <div
                      key={cs.id}
                      className="rounded-xl border border-white/10 bg-[#0B0F17] p-3 flex items-start justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold text-white truncate">{cs.name}</span>
                          <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-200 font-mono text-[10px]">
                            {cs.marketType === 'futures' ? 'Futures' : 'Spot'} · {cs.logic === 'AND' ? 'И' : 'ИЛИ'}
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-slate-400 flex flex-wrap gap-x-2">
                          {cs.rules.map((r) => (
                            <span key={r.id}>
                              {r.indicator} {r.operator} {r.value}
                            </span>
                          ))}
                        </div>
                        <div className="text-[11px] font-mono tabular-nums text-emerald-400">
                          Оценка: +{cs.backtestRoiPct}% ROI · WR {cs.backtestWinRatePct}%
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          deleteCustomNoCodeStrategy(cs.id);
                          setCustomStrategies(readCustomNoCodeStrategies());
                        }}
                        aria-label={`Удалить стратегию ${cs.name}`}
                        className="p-1.5 rounded-lg border border-rose-500/25 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(tierFilter === 'all' || tierFilter === 'max') && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                className="rounded-2xl border border-cyan-400/25 bg-gradient-to-r from-cyan-500/[0.08] via-[#111827] to-emerald-500/[0.06] px-4 py-3 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-white">
                    <span
                      className={`badge-shimmer-max inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-cyan-400/45 bg-cyan-500/20 text-cyan-200 font-mono text-[10px] font-bold tracking-wide ${
                        maxStrategiesAvgWinRatePct !== null && maxStrategiesAvgWinRatePct > 55
                          ? 'max-badge-wr-pulse'
                          : ''
                      }`}
                    >
                      <Sparkles className="w-3 h-3 shrink-0" />
                      <span>MAX EXCLUSIVE</span>
                    </span>
                    <span>{MAX_EXCLUSIVE_STRATEGIES_COUNT} институциональных стратегий (Спот + Фьючерсы) с Win Rate 55%+</span>
                  </div>
                  <div className="text-[11px] text-slate-300 font-mono tabular-nums flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    {maxStrategiesAvgWinRatePct !== null ? (
                      <>
                        <span>
                          Ср. Win Rate (1H бэктест):{' '}
                          <strong className="text-emerald-300">{maxStrategiesAvgWinRatePct.toFixed(1)}%</strong>
                        </span>
                        {freeBaselineAvgWinRatePct !== null &&
                          maxStrategiesAvgWinRatePct > freeBaselineAvgWinRatePct && (
                            <>
                              <span className="text-slate-600" aria-hidden="true">·</span>
                              <span className="text-cyan-300">
                                +{(maxStrategiesAvgWinRatePct - freeBaselineAvgWinRatePct).toFixed(1)} п.п. к ср. Free
                              </span>
                            </>
                          )}
                      </>
                    ) : (
                      <span className="font-sans text-slate-400">
                        SMC Order Block · FVG Fill · Wyckoff Spring · Keltner · VWAP · Quant Regime
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.96 }}
                    onClick={() => setTierFilter(tierFilter === 'max' ? 'all' : 'max')}
                    className="min-h-[34px] px-3 rounded-lg border border-cyan-400/35 bg-cyan-500/12 hover:bg-cyan-500/22 text-cyan-200 text-xs font-semibold whitespace-nowrap transition-colors"
                  >
                    {tierFilter === 'max' ? 'Показать все тарифы' : `Только MAX (${MAX_EXCLUSIVE_STRATEGIES_COUNT})`}
                  </motion.button>
                  {!isMax && (
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.96 }}
                      onClick={() => void onSwitchPlan('max')}
                      className="cta-shimmer min-h-[34px] px-3 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-slate-950 text-xs font-bold whitespace-nowrap transition-colors"
                    >
                      Открыть MAX
                    </motion.button>
                  )}
                </div>
              </motion.div>
            )}

            {/* Заголовок списка стратегий с поясняющей подсказкой Strategy Mode (Paper vs Live) */}
            <div className="relative rounded-xl border border-white/8 bg-[#111827]/90 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <span className="text-xs font-semibold text-white">Список стратегий</span>
                <span className="text-[11px] font-mono text-slate-400">
                  ({displayList.length} из {STRATEGY_CATALOG.length})
                </span>
                <span className="text-slate-600" aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-300">
                  <span>Режим:</span>
                  <strong
                    className={
                      operatingMode === 'live' ? 'text-cyan-300 font-semibold' : 'text-emerald-300 font-semibold'
                    }
                  >
                    {operatingMode === 'live' ? 'Live Trading (API)' : 'Paper Trading'}
                  </strong>
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic(6);
                      setStrategyModeTooltipOpen((prev) => !prev);
                    }}
                    aria-expanded={strategyModeTooltipOpen}
                    aria-label="Пояснение режима работы стратегий: Paper Trading и Live Trading"
                    className={`w-5 h-5 rounded-full inline-flex items-center justify-center border transition-colors ${
                      strategyModeTooltipOpen
                        ? 'border-cyan-400/60 bg-cyan-500/20 text-cyan-200'
                        : 'border-white/15 bg-white/5 text-slate-300 hover:text-white hover:border-cyan-400/45'
                    }`}
                  >
                    <Info className="w-3 h-3" />
                  </button>
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono text-slate-400">
                {liveVerification.verifiedLive && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-400/50 text-emerald-200 font-bold">
                    <ShieldCheck className="w-3 h-3 text-emerald-300 shrink-0" />
                    <span>Verified Live</span>
                  </span>
                )}
                <span className="px-1.5 py-0.5 rounded bg-emerald-500/12 border border-emerald-500/25 text-emerald-300">
                  В активной стратегии нажмите «График» → видны SL / Вход / TP
                </span>
              </div>

              {strategyModeTooltipOpen && (
                <div
                  role="tooltip"
                  className="w-full mt-1 rounded-xl border border-cyan-400/35 bg-[#070B12] p-3 text-xs space-y-2 shadow-xl"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-white">
                      Режим работы стратегий (Strategy Mode)
                    </span>
                    <button
                      type="button"
                      onClick={() => setStrategyModeTooltipOpen(false)}
                      aria-label="Закрыть подсказку"
                      className="text-slate-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] leading-relaxed">
                    <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] p-2.5">
                      <div className="font-semibold text-emerald-300 mb-0.5">
                        Paper Trading (Симуляция)
                      </div>
                      <p className="text-slate-300">
                        Работает внутри симулированных данных терминала: движок генерирует сигналы (Вход, SL, TP1, TP2) и отслеживает их прогресс без использования реальных средств.
                      </p>
                    </div>
                    <div className="rounded-lg border border-cyan-500/25 bg-cyan-500/[0.06] p-2.5">
                      <div className="font-semibold text-cyan-200 mb-0.5">
                        Live Trading (Биржевые ордера)
                      </div>
                      <p className="text-slate-300">
                        Требует активный API-ключ биржи (Binance / Bybit / OKX) с правами торговли для исполнения ордеров на вашей бирже с обязательным подтверждением каждого ордера.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                    <span className="text-[10px] text-slate-400">
                      Состояния автомата: Idle (выкл) → Monitoring (поиск сигнала) → Execution (сигнал / ордер).
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setStrategyModeTooltipOpen(false);
                        setModeInfoOpen(true);
                      }}
                      className="text-[11px] font-semibold text-cyan-300 hover:text-cyan-200"
                    >
                      Подробное сравнение →
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <AnimatePresence mode="popLayout" initial={false}>
                {displayList.map(({ tpl, cfg }, idx) => {
                  const isEditing = cfg && editingId === cfg.id;
                  const isMaxStrategy = tpl.tier === 'max';
                  const isProStrategy = tpl.tier === 'pro';
                  const isLockedForUser = !canAccessStrategy(tpl.key, activePlanTier);
                  const isActive = Boolean(cfg?.enabled) && !isLockedForUser;
                  const usedSignalsToday = isSignedIn ? countTodayStrategySignals(analyses, tpl.key) : 0;
                  const isDailyFreeLimitHit = !isPro && isSignedIn && usedSignalsToday >= FREE_DAILY_SIGNAL_LIMIT;
                  const isProUnlimitedLimit = isPro && (cfg?.dailySignalLimit ?? 0) === 0;
                  const bt = catalogBacktest[tpl.key];
                  const isHighWinRate = Boolean(bt && bt.winRatePct >= 55);
                  const isMaxWinRatePulse = Boolean(isMaxStrategy && bt && bt.winRatePct > 55);
                  const wrDeltaVsFree =
                    bt && freeBaselineAvgWinRatePct !== null
                      ? Number((bt.winRatePct - freeBaselineAvgWinRatePct).toFixed(1))
                      : null;
                  const isRealOutperformer = Boolean(
                    bt &&
                      bt.totalPnlPct > 0 &&
                      freeBaselineAvgPnlPct !== null &&
                      bt.totalPnlPct > freeBaselineAvgPnlPct
                  );

                  return (
                    <motion.div
                      key={tpl.key}
                      layout="position"
                      initial={{ opacity: 0, y: 12, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -10, scale: 0.96 }}
                      whileHover={{ y: -2 }}
                      transition={{ duration: 0.22, delay: Math.min(idx * 0.02, 0.14), ease: [0.22, 1, 0.36, 1] }}
                      className={`cv-card-item relative overflow-hidden rounded-2xl border card-surface-glow p-4 flex flex-col justify-between gap-3.5 transition-colors ${
                        isMaxStrategy
                          ? 'bg-gradient-to-br from-cyan-500/[0.06] via-[#111827] to-emerald-500/[0.04]'
                          : 'bg-[#111827]'
                      } ${
                        isLockedForUser
                          ? isMaxStrategy
                            ? 'border-cyan-400/35'
                            : 'border-amber-500/20'
                          : isActive
                            ? isMaxStrategy
                              ? 'border-cyan-400/45 shadow-[0_0_24px_-12px_rgba(34,211,238,0.4)]'
                              : 'border-emerald-500/30'
                            : isMaxStrategy
                              ? 'border-cyan-500/25'
                              : 'border-white/8'
                      }`}
                    >
                      {isMaxStrategy && (
                        <div
                          aria-hidden="true"
                          className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-cyan-400 via-emerald-400 to-cyan-400/20"
                        />
                      )}
                      <div>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                              {isMaxStrategy && (
                                <span
                                  className={`badge-shimmer-max px-1.5 py-0.5 rounded-md border border-cyan-400/45 bg-gradient-to-r from-cyan-500/20 to-emerald-500/15 font-mono text-[10px] font-bold text-cyan-200 tracking-wide inline-flex items-center gap-1 shrink-0 ${
                                    isMaxWinRatePulse ? 'max-badge-wr-pulse' : ''
                                  }`}
                                  title={
                                    isMaxWinRatePulse && bt
                                      ? `MAX стратегия · Win Rate ${bt.winRatePct}% (> 55%)`
                                      : 'Эксклюзивная стратегия тарифа MAX'
                                  }
                                >
                                  <Sparkles className="w-3 h-3 text-cyan-300 shrink-0" />
                                  <span>MAX</span>
                                </span>
                              )}
                            {isProStrategy && (
                              <span className="px-1.5 py-0.5 rounded-md border border-amber-400/35 bg-amber-500/12 font-mono text-[10px] font-semibold text-amber-300 inline-flex items-center gap-1 shrink-0">
                                <Crown className="w-3 h-3 shrink-0" />
                                <span>PRO</span>
                              </span>
                            )}
                            <span>{tpl.shortTag}</span>
                            <span aria-hidden="true">·</span>
                            <span>{tpl.riskProfile}</span>
                            <span aria-hidden="true">·</span>
                            <span>ТФ {tpl.timeframeDefault.toUpperCase()}</span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono text-slate-300">{`${tpl.creditCost} кр.`}</span>
                          </div>
                          <h3 className="mt-1.5 text-sm font-semibold text-white leading-snug">{tpl.name}</h3>
                        </div>

                        {isLockedForUser ? (
                          <button
                            type="button"
                            onClick={() => void onSwitchPlan(isMaxStrategy ? 'max' : 'pro')}
                            className={`min-h-[34px] px-2.5 rounded-lg text-xs font-semibold border inline-flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors ${
                              isMaxStrategy
                                ? 'border-cyan-400/50 bg-cyan-500/20 text-cyan-100 hover:bg-cyan-500/30'
                                : 'border-amber-500/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25'
                            }`}
                          >
                            <Lock className="w-3.5 h-3.5 shrink-0" />
                            <span>{isMaxStrategy ? 'MAX' : 'PRO'}</span>
                          </button>
                        ) : (
                          cfg && (
                            <button
                              type="button"
                              disabled={savingId === cfg.id}
                              onClick={() => void handleToggle(cfg)}
                              aria-pressed={cfg.enabled}
                              className={`min-h-[34px] px-2.5 rounded-lg text-xs font-semibold border inline-flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                                cfg.enabled
                                  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                                  : 'border-white/10 bg-white/5 text-slate-400 hover:text-white hover:bg-white/10'
                              }`}
                            >
                              {cfg.enabled ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                              ) : (
                                <CircleOff className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                              )}
                              <span>{cfg.enabled ? 'Активен' : 'Выкл'}</span>
                            </button>
                          )
                        )}
                      </div>

                      <p className="mt-2 text-xs text-slate-300 leading-relaxed">{tpl.description}</p>
                      <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px] text-slate-400 min-w-0">
                        <div className="min-w-0 leading-snug">
                          <span className="text-slate-500">Осцилляторы: </span>
                          <span className="text-slate-300 font-mono tabular-nums break-words">
                            {tpl.indicatorsUsed.join(' · ')}
                          </span>
                        </div>
                        <div className="min-w-0 sm:text-right text-slate-400 leading-snug truncate">
                          {tpl.marketCondition}
                        </div>
                      </div>

                      {bt ? (
                        <div
                          className={`mt-2.5 rounded-xl border p-2.5 space-y-2 ${
                            isMaxStrategy
                              ? 'border-cyan-400/30 bg-gradient-to-r from-cyan-500/[0.08] via-[#0B0F17] to-emerald-500/[0.07]'
                              : 'border-white/8 bg-[#0B0F17]'
                          }`}
                        >
                          <div className="grid grid-cols-3 gap-1.5 text-[11px] font-mono tabular-nums min-w-0 items-end">
                            <div className="min-w-0">
                              <div className="font-sans text-[10px] text-slate-500 leading-none">Бэктест 1H</div>
                              <div
                                className={`mt-1 font-semibold whitespace-nowrap ${
                                  bt.totalPnlPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                                }`}
                              >
                                {bt.totalPnlPct >= 0 ? '+' : ''}
                                {bt.totalPnlPct.toFixed(2)}%
                              </div>
                            </div>
                            <div className="min-w-0 text-center">
                              <div className="font-sans text-[10px] text-slate-400 leading-none flex items-center justify-center gap-1">
                                <span>Win Rate</span>
                                {isHighWinRate && (
                                  <span className="font-mono text-[9px] font-bold text-emerald-300">
                                    55%+
                                  </span>
                                )}
                              </div>
                              <div
                                className={`mt-1 whitespace-nowrap ${
                                  isMaxStrategy && isHighWinRate
                                    ? 'text-sm font-bold text-emerald-300'
                                    : isHighWinRate
                                      ? 'font-bold text-emerald-300'
                                      : 'font-semibold text-slate-200'
                                }`}
                              >
                                {bt.winRatePct}%
                              </div>
                            </div>
                            <div className="min-w-0 text-right">
                              <div className="font-sans text-[10px] text-slate-500 leading-none">Сделок</div>
                              <div className="mt-1 text-slate-300 whitespace-nowrap">{bt.tradesCount}</div>
                            </div>
                          </div>

                          {(isMaxStrategy || isHighWinRate) && (
                            <div className="flex flex-wrap items-center justify-between gap-1 pt-1 border-t border-white/6 text-[10px] font-mono tabular-nums">
                              <span className={isMaxStrategy ? 'text-cyan-300 font-semibold' : 'text-emerald-300'}>
                                {isMaxStrategy
                                  ? `MAX High-WR · ${bt.winRatePct}% (порог 55%)`
                                  : `Повышенный WR · ${bt.winRatePct}%`}
                              </span>
                              {wrDeltaVsFree !== null && wrDeltaVsFree > 0 && (
                                <span className="text-emerald-300 font-semibold">
                                  +{wrDeltaVsFree} п.п. к Free
                                </span>
                              )}
                            </div>
                          )}

                          {!isMaxStrategy && isRealOutperformer && isProStrategy && (
                            <div className="pt-1 border-t border-white/6 text-[11px] font-sans font-semibold text-emerald-300 tabular-nums">
                              Выше ср. Free ({freeBaselineAvgPnlPct! >= 0 ? '+' : ''}
                              {freeBaselineAvgPnlPct!.toFixed(2)}%)
                            </div>
                          )}
                        </div>
                      ) : isMaxStrategy ? (
                        <div className="mt-2.5 rounded-xl border border-cyan-400/20 bg-cyan-500/[0.05] px-2.5 py-2 flex items-center justify-between gap-2 text-[11px]">
                          <span className="text-cyan-200 font-medium">Профиль высокой точности MAX (WR 55%+)</span>
                          <span className="font-mono text-[10px] text-slate-400">Бэктест 1H…</span>
                        </div>
                      ) : null}

                      {isActive && cfg ? (
                        <ActiveStrategyLiveProgress
                          strategyKey={tpl.key}
                          strategyName={tpl.name}
                          leadSymbol={cfg.pairs[0] || 'BTCUSDT'}
                          pairsCount={cfg.pairs.length}
                          marketType={tpl.marketType}
                          minConfidence={cfg.minConfidence}
                          riskPerTradePct={cfg.riskPerTradePct}
                          isMaxStrategy={isMaxStrategy}
                          operatingMode={operatingMode}
                          engineState={simulationSnapshot.statesByKey[tpl.key] ?? 'Monitoring'}
                          verifiedLive={liveVerification.verifiedLive}
                          telemetry={activeMonitorReport?.strategyTelemetry?.[tpl.key]}
                          emittedSignal={activeMonitorReport?.opportunities.find(
                            (o) => o.strategyKey === tpl.key
                          )}
                          placedOrder={placedOrdersByStrategy[tpl.key]}
                          isScanning={monitorLoading}
                          hasTradeApiKey={Boolean(activeTradeApiKey)}
                          onOpenPairOnMarket={onOpenPairOnMarket}
                          onExecuteSignalViaApi={(opp) => void handleExecuteSignalViaApi(opp)}
                          onClearPlacedOrder={() => {
                            const next = { ...placedOrdersByStrategy };
                            delete next[tpl.key];
                            persistPlacedOrders(next);
                          }}
                        />
                      ) : !isLockedForUser ? (
                        <div className="mt-2.5 rounded-xl border border-white/8 bg-[#0B0F17]/70 px-2.5 py-2 flex items-center justify-between gap-2 text-[11px]">
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-white/10 bg-white/5 text-slate-400 font-semibold text-[10px]">
                            <PauseCircle className="w-3 h-3 text-slate-500 shrink-0" />
                            <span>Idle</span>
                          </span>
                          <span className="text-[10px] text-slate-500 truncate">
                            Включите стратегию для перехода в Monitoring Signal
                          </span>
                        </div>
                      ) : null}
                    </div>

                    {isLockedForUser ? (
                      <div className="pt-3 border-t border-white/8 flex items-center justify-between gap-2">
                        <span className="text-xs text-slate-400 inline-flex items-center gap-1.5">
                          <Lock className={`w-3.5 h-3.5 shrink-0 ${isMaxStrategy ? 'text-cyan-400' : 'text-amber-400'}`} />
                          <span>{isMaxStrategy ? 'Эксклюзив тарифа MAX' : 'Доступно в PRO и MAX'}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => void onSwitchPlan(isMaxStrategy ? 'max' : 'pro')}
                          className={`min-h-[34px] px-3 rounded-lg text-slate-950 text-xs font-semibold whitespace-nowrap transition-colors ${
                            isMaxStrategy
                              ? 'bg-cyan-400 hover:bg-cyan-300'
                              : 'bg-amber-500 hover:bg-amber-400'
                          }`}
                        >
                          {isMaxStrategy ? 'Открыть MAX' : 'Открыть'}
                        </button>
                      </div>
                    ) : cfg ? (
                      isEditing ? (
                        <div className="pt-3 border-t border-white/10 space-y-3">
                          <div>
                            <div className="flex items-center justify-between text-xs mb-1.5">
                              <span className="text-slate-300 flex items-center gap-1.5">
                                <BellRing className="w-3.5 h-3.5 text-amber-400" />
                                <span>Сигналов в день</span>
                              </span>
                              <span className="font-mono font-bold text-amber-400">
                                {isPro
                                  ? draftLimit === 0
                                    ? `Без ограничений (${tierLabel})`
                                    : `${draftLimit} / день`
                                  : `${FREE_DAILY_SIGNAL_LIMIT} / день (Free)`}
                              </span>
                            </div>
                            {isPro ? (
                              <div className="space-y-2">
                                <div className="grid grid-cols-2 p-1 rounded-xl bg-[#0B0F17] border border-white/8 text-xs">
                                  <button
                                    type="button"
                                    onClick={() => setDraftLimit(0)}
                                    className={`min-h-[32px] rounded-lg font-medium transition-colors ${
                                      draftLimit === 0
                                        ? 'bg-emerald-600 text-white'
                                        : 'text-slate-400 hover:text-slate-200'
                                    }`}
                                  >
                                    Без ограничений
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setDraftLimit((prev) => (prev > 0 ? prev : 10))}
                                    className={`min-h-[32px] rounded-lg font-medium transition-colors ${
                                      draftLimit > 0
                                        ? 'bg-amber-500 text-slate-950 font-semibold'
                                        : 'text-slate-400 hover:text-slate-200'
                                    }`}
                                  >
                                    Свой порог
                                  </button>
                                </div>
                                {draftLimit > 0 && (
                                  <input
                                    type="range"
                                    min={1}
                                    max={100}
                                    value={draftLimit}
                                    onChange={(e) => setDraftLimit(Number(e.target.value))}
                                    className="w-full accent-amber-500"
                                  />
                                )}
                              </div>
                            ) : (
                              <div className="flex items-center justify-between rounded-xl bg-[#0B0F17] border border-white/8 px-3 py-2 text-xs text-slate-400">
                                <span className="flex items-center gap-1.5">
                                  <Lock className="w-3.5 h-3.5 text-amber-400" />
                                  Снятие дневного лимита в PRO
                                </span>
                                <button
                                  type="button"
                                  onClick={() => void onSwitchPlan('pro')}
                                  className="text-amber-400 hover:underline font-medium"
                                >
                                  PRO
                                </button>
                              </div>
                            )}
                          </div>

                          <div className="grid grid-cols-2 gap-2.5 text-xs">
                            <div>
                              <label className="block text-slate-400 mb-1">Уверенность (%)</label>
                              <input
                                type="number"
                                min={50}
                                max={95}
                                value={draftConfidence}
                                onChange={(e) => setDraftConfidence(Number(e.target.value))}
                                className="w-full min-h-[36px] rounded-xl border border-white/10 bg-[#0B0F17] px-2.5 font-mono text-white"
                              />
                            </div>
                            <div>
                              <label className="block text-slate-400 mb-1">Риск (%)</label>
                              <input
                                type="number"
                                step="0.25"
                                min={0.25}
                                max={10}
                                value={draftRisk}
                                onChange={(e) => setDraftRisk(Number(e.target.value))}
                                className="w-full min-h-[36px] rounded-xl border border-white/10 bg-[#0B0F17] px-2.5 font-mono text-white"
                              />
                            </div>
                          </div>

                          {cfg.marketType === 'futures' && (
                            <div>
                              <div className="flex items-center justify-between text-xs mb-1">
                                <span className="text-slate-400">
                                  Макс. плечо{!isPro ? ` (Free до ${FREE_MAX_LEVERAGE}x)` : ''}
                                </span>
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-amber-300">{draftLeverage}x</span>
                                  {!isPro && (
                                    <button
                                      type="button"
                                      onClick={() => void onSwitchPlan('pro')}
                                      className="text-[11px] font-medium text-amber-400 hover:underline"
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
                                value={Math.min(isPro ? 20 : FREE_MAX_LEVERAGE, draftLeverage)}
                                onChange={(e) => setDraftLeverage(Number(e.target.value))}
                                className="w-full accent-amber-500"
                              />
                            </div>
                          )}

                          <div>
                            <div className="text-xs text-slate-400 mb-1">Пары</div>
                            <div className="flex flex-wrap gap-1.5">
                              {TRADING_PAIRS.slice(0, 6).map((p) => {
                                const selected = draftPairs.includes(p.symbol);
                                return (
                                  <button
                                    key={p.symbol}
                                    type="button"
                                    onClick={() =>
                                      setDraftPairs((prev) =>
                                        selected ? prev.filter((x) => x !== p.symbol) : [...prev, p.symbol]
                                      )
                                    }
                                    className={`min-h-[30px] px-2 rounded-lg text-xs font-mono border transition-colors ${
                                      selected
                                        ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                                        : 'border-white/10 bg-[#0B0F17] text-slate-400'
                                    }`}
                                  >
                                    {p.symbol.replace('USDT', '')}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="flex-1 min-h-[38px] rounded-xl border border-white/10 bg-white/5 text-xs font-medium text-slate-300"
                            >
                              Отмена
                            </button>
                            <button
                              type="button"
                              disabled={savingId === cfg.id}
                              onClick={() => void handleSave(cfg)}
                              className="flex-1 min-h-[38px] rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white"
                            >
                              {savingId === cfg.id ? 'Сохранение...' : 'Сохранить'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="pt-3 border-t border-white/8 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2.5 text-xs font-mono tabular-nums text-slate-300">
                            <span>
                              {isPro
                                ? isProUnlimitedLimit
                                  ? '∞/день'
                                  : `${cfg.dailySignalLimit}/день`
                                : `${usedSignalsToday}/${FREE_DAILY_SIGNAL_LIMIT} сегодня`}
                            </span>
                            <span>{cfg.minConfidence}%</span>
                            {cfg.marketType === 'futures' && <span>{cfg.leverage}x</span>}
                            {isDailyFreeLimitHit && (
                              <button
                                type="button"
                                onClick={() => void onSwitchPlan('pro')}
                                className="font-sans text-[11px] font-semibold text-amber-300 hover:underline"
                              >
                                Лимит Free · PRO →
                              </button>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => startEdit(cfg)}
                            className="min-h-[34px] px-3 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-medium text-white inline-flex items-center gap-1.5 transition-colors"
                          >
                            <Sliders className="w-3.5 h-3.5" />
                            <span>Настроить</span>
                          </button>
                        </div>
                      )
                    ) : (
                      <div className="pt-3 border-t border-white/8 flex items-center justify-between">
                        <span className="text-xs text-slate-500">Войдите для настройки</span>
                        <button
                          type="button"
                          onClick={onRequireLogin}
                          className="min-h-[34px] px-3 rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 text-xs font-medium"
                        >
                          Войти
                        </button>
                      </div>
                    )}
                  </motion.div>
                );
              })}
              </AnimatePresence>
            </div>

            <NonCustodialRiskNotice
              variant="card"
              text="VERNIER не принимает, не хранит и не управляет средствами клиентов. Исторические бэктесты и Win Rate не гарантируют будущую доходность. Вход в позицию на вашей бирже через API или вручную выполняется исключительно по вашему согласию под вашу полную финансовую ответственность."
            />

            {displayList.length === 0 && (
              <div className="rounded-2xl border border-white/8 bg-[#111827] p-8 text-center space-y-3">
                <p className="text-sm text-slate-300">По выбранным фильтрам стратегии не найдены.</p>
                <button
                  type="button"
                  onClick={() => {
                    setMarketFilter('all');
                    setStatusFilter('all');
                  }}
                  className="min-h-[38px] px-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-medium text-white transition-colors"
                >
                  Сбросить фильтры
                </button>
              </div>
            )}
          </div>
        )}

        {(section === 'scanner' || section === 'signals') && (
          <div className="space-y-4">
            {/* Sub-tab Switcher: AI-Сканер | Лента сигналов (keeps main nav symmetric 2x3) */}
            <div
              role="tablist"
              aria-label="Подраздел AI-сканера"
              className="grid grid-cols-2 gap-1 p-1 rounded-xl border border-white/10 bg-[#0B0F17]"
            >
              <button
                type="button"
                role="tab"
                aria-selected={scannerSubTab === 'scanner' && section !== 'signals'}
                onClick={() => {
                  triggerHaptic(8);
                  setSection('scanner');
                  setScannerSubTab('scanner');
                }}
                className={`min-h-[38px] px-3 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors ${
                  scannerSubTab === 'scanner' && section !== 'signals'
                    ? 'bg-cyan-500 text-slate-950'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Radar className="w-3.5 h-3.5 shrink-0" />
                <span>AI-сканер</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={scannerSubTab === 'signals' || section === 'signals'}
                onClick={() => {
                  triggerHaptic(8);
                  setSection('scanner');
                  setScannerSubTab('signals');
                }}
                className={`min-h-[38px] px-3 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors ${
                  scannerSubTab === 'signals' || section === 'signals'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Radio className="w-3.5 h-3.5 shrink-0" />
                <span>Лента сигналов</span>
                {signalStreamCount > 0 && (
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-black/25">
                    {signalStreamCount}
                  </span>
                )}
              </button>
            </div>

            {scannerSubTab === 'signals' || section === 'signals' ? (
              <LiveSignalFeed
                activeCount={activeCount}
                analyses={analyses}
                operatingMode={operatingMode}
                verifiedLive={liveVerification.verifiedLive}
                verifiedExchangeLabel={
                  liveVerification.selectedKey
                    ? `${liveVerification.selectedKey.exchange.toUpperCase()} · ${liveVerification.selectedKey.label}`
                    : null
                }
                monitorLoading={monitorLoading}
                apiOrderBusyKey={apiOrderBusyKey}
                pushSentKeys={pushSentKeys}
                placedOrdersByStrategy={placedOrdersByStrategy}
                pushSubscribed={pushSubscribed}
                hasTradeApiKey={Boolean(activeTradeApiKey)}
                exchangeStrip={renderExchangeConnectionStrip()}
                onRefreshStream={() => void runActiveStrategiesMonitor()}
                onOpenModeInfo={() => setModeInfoOpen(true)}
                onOpenApiGuide={() => setApiGuideOpen(true)}
                onGoToCatalog={() => setSection('catalog')}
                onOpenPairOnMarket={onOpenPairOnMarket}
                onSendSignalPush={(opp) => void handleSendSignalPush(opp)}
                onExecuteSignalViaApi={(opp) => void handleExecuteSignalViaApi(opp)}
              />
            ) : (
            <div className="space-y-4">
            <div className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-4 sm:p-5 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-white flex items-center gap-2">
                    <Radar className="w-4 h-4 text-cyan-400" />
                    <span>AI-сканер живых торговых сетапов</span>
                  </h2>
                  <p className="mt-1 text-xs text-slate-400 max-w-2xl">
                    Автоматический отбор активных точек входа по реальным свечным индикаторам (EMA, RSI, MACD, Bollinger, ATR) сразу по десяткам пар.
                  </p>
                </div>

                <button
                  type="button"
                  disabled={scannerLoading}
                  onClick={() => void runLiveScanner()}
                  className="min-h-[38px] px-3.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-60 text-slate-950 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${scannerLoading ? 'animate-spin' : ''}`} />
                  <span>{scannerLoading ? 'Сканируем пары...' : 'Сканировать рынок'}</span>
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 text-xs">
                <div className="inline-flex items-center p-1 rounded-xl bg-[#0B0F17] border border-white/8">
                  <button
                    type="button"
                    onClick={() => {
                      setScannerTf('1h');
                      void runLiveScanner('1h');
                    }}
                    className={`min-h-[32px] px-3 rounded-lg font-mono font-medium transition-colors ${
                      scannerTf === '1h' ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/35' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    1H
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!isMax) {
                        void onSwitchPlan('max');
                        return;
                      }
                      setScannerTf('4h');
                      void runLiveScanner('4h');
                    }}
                    className={`min-h-[32px] px-3 rounded-lg font-mono font-medium inline-flex items-center gap-1 transition-colors ${
                      scannerTf === '4h' && isMax
                        ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/35'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {!isMax && <Lock className="w-3 h-3 text-cyan-300" />}
                    <span>4H · MAX</span>
                  </button>
                </div>

                <div className="inline-flex items-center p-1 rounded-xl bg-[#0B0F17] border border-white/8">
                  {(
                    [
                      { id: 'all', label: 'Все рынки' },
                      { id: 'spot', label: 'Спот' },
                      { id: 'futures', label: 'Фьючерсы' },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setScannerMarket(m.id)}
                      className={`min-h-[32px] px-3 rounded-lg font-medium transition-colors ${
                        scannerMarket === m.id ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2 rounded-xl border border-white/8 bg-[#0B0F17] px-3 py-1.5">
                  <span className="text-slate-400">Мин. уверенность:</span>
                  <input
                    type="range"
                    min={65}
                    max={85}
                    value={scannerMinConf}
                    onChange={(e) => setScannerMinConf(Number(e.target.value))}
                    className="w-24 accent-cyan-400"
                  />
                  <span className="font-mono font-semibold text-cyan-300">{scannerMinConf}%</span>
                </div>

                {scannerReport && (
                  <span className="ml-auto font-mono text-[11px] text-slate-400">
                    {scannerIsLocal && (
                      <span className="text-emerald-300 font-sans font-medium mr-1.5">
                        Локальный расчёт ·
                      </span>
                    )}
                    Охват: {scannerReport.scannedPairsCount}/{scannerReport.totalPairsAvailable} пар · Найдено:{' '}
                    <strong className="text-white">{scannerReport.opportunities.length}</strong>
                  </span>
                )}
              </div>

              {!isMax && (
                <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/[0.07] px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-cyan-100">
                    {!isPro
                      ? `На Free сканируются только 3 пары (3 базовые стратегии). В PRO доступны TOP-16 пар и ${PRO_AND_FREE_STRATEGIES_COUNT} стратегий, а в MAX — все ${TRADING_PAIRS.length} пар + ${MAX_EXCLUSIVE_STRATEGIES_COUNT} MAX-алгоритмов (WR 55%+) + 4H.`
                      : `Тариф PRO сканирует TOP-16 пар на 1H. Тариф MAX открывает все ${TRADING_PAIRS.length} пар, 4H и ${MAX_EXCLUSIVE_STRATEGIES_COUNT} эксклюзивных MAX-стратегий (WR 55%+).`}
                  </span>
                  <button
                    type="button"
                    onClick={() => void onSwitchPlan(isPro ? 'max' : 'pro')}
                    className="font-semibold text-cyan-300 hover:text-cyan-200 whitespace-nowrap"
                  >
                    {isPro ? 'Открыть 44 пары в MAX →' : 'Открыть сканер PRO →'}
                  </button>
                </div>
              )}

              {scannerError && (
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">
                  {scannerError}
                </div>
              )}
            </div>

            {scannerReport && scannerReport.opportunities.length === 0 && !scannerLoading && (
              <div className="rounded-2xl border border-white/8 bg-[#111827] p-6 sm:p-8 text-center space-y-3">
                <p className="text-sm font-semibold text-white">
                  Сетапов с уверенностью ≥{scannerMinConf}% сейчас нет
                </p>
                <p className="text-xs text-slate-400">
                  Понизьте минимальный порог уверенности или расширьте фильтр рынка до «Все рынки».
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                  {scannerMinConf > 70 && (
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic(8);
                        setScannerMinConf(70);
                        void runLiveScanner(undefined, { minConf: 70, forceLocal: scannerIsLocal });
                      }}
                      className="min-h-[38px] px-4 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-semibold transition-colors"
                    >
                      Снизить порог до 70%
                    </button>
                  )}
                  {scannerMarket !== 'all' && (
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic(8);
                        setScannerMarket('all');
                        void runLiveScanner(undefined, { market: 'all', forceLocal: scannerIsLocal });
                      }}
                      className="min-h-[38px] px-4 rounded-xl border border-white/12 bg-white/5 hover:bg-white/10 text-slate-200 text-xs font-medium transition-colors"
                    >
                      Показать все рынки
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {(scannerReport?.opportunities ?? []).map((opp, idx) => (
                <motion.div
                  key={`${opp.symbol}-${opp.strategyKey}-${opp.direction}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.24, delay: Math.min(idx * 0.035, 0.28), ease: [0.22, 1, 0.36, 1] }}
                  whileHover={{ y: -2 }}
                  className={`rounded-2xl border bg-[#111827] p-4 space-y-3 transition-[border-color,box-shadow] hover:shadow-[0_10px_28px_-14px_rgba(16,185,129,0.28)] ${
                    opp.direction === 'LONG' ? 'border-emerald-500/25 hover:border-emerald-500/45' : 'border-rose-500/25 hover:border-rose-500/45'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold font-mono text-white">{opp.symbol}</span>
                        <span
                          className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded-md ${
                            opp.direction === 'LONG'
                              ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                              : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                          }`}
                        >
                          {opp.direction}
                        </span>
                        <span className="text-[11px] font-mono text-slate-400 uppercase">
                          {opp.marketType === 'futures' ? 'Futures' : 'Spot'} · {opp.timeframe}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-slate-300">{opp.strategyName}</div>
                    </div>

                    <div className="text-right font-mono tabular-nums">
                      <div className="text-[11px] text-slate-400">Уверенность</div>
                      <div className="text-sm font-bold text-cyan-300">{opp.confidence}%</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-1.5 sm:gap-2 text-[11px] font-mono tabular-nums min-w-0">
                    <div className="rounded-xl border border-white/8 bg-[#0B0F17] p-2 min-w-0 overflow-hidden">
                      <div className="font-sans text-[10px] text-slate-500 truncate">Вход</div>
                      <div className="mt-0.5 text-white font-semibold truncate">{formatScannerPrice(opp.entryPrice)}</div>
                    </div>
                    <div className="rounded-xl border border-white/8 bg-[#0B0F17] p-2 min-w-0 overflow-hidden">
                      <div className="font-sans text-[10px] text-slate-500 truncate">Stop-Loss</div>
                      <div className="mt-0.5 text-rose-400 font-semibold truncate">{formatScannerPrice(opp.stopLossPrice)}</div>
                    </div>
                    <div className="rounded-xl border border-white/8 bg-[#0B0F17] p-2 min-w-0 overflow-hidden">
                      <div className="font-sans text-[10px] text-slate-500 truncate">Take-Profit</div>
                      <div className="mt-0.5 text-emerald-400 font-semibold truncate">{formatScannerPrice(opp.takeProfitPrice)}</div>
                    </div>
                  </div>

                  <div className="flex flex-col min-[380px]:flex-row min-[380px]:items-center justify-between gap-2 pt-1 text-[11px] font-mono tabular-nums text-slate-400">
                    <div className="grid grid-cols-3 gap-1.5 min-w-0 flex-1">
                      <span className="text-amber-300 font-semibold whitespace-nowrap truncate">
                        R:R 1:{opp.riskRewardRatio}
                      </span>
                      <span className="text-slate-300 whitespace-nowrap truncate text-center">
                        RSI {opp.rsi14}
                      </span>
                      <span
                        className={`whitespace-nowrap truncate text-right font-semibold ${
                          opp.change24hPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        24ч {opp.change24hPct >= 0 ? '+' : ''}
                        {opp.change24hPct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      {onOpenPairOnMarket && (
                        <motion.button
                          whileTap={{ scale: 0.96 }}
                          type="button"
                          onClick={() =>
                            onOpenPairOnMarket(
                              opp.symbol,
                              opp.marketType,
                              buildStrategySignalOverlay({
                                strategyKey: opp.strategyKey,
                                strategyName: opp.strategyName,
                                symbol: opp.symbol,
                                marketType: opp.marketType,
                                mode: operatingMode,
                                emittedSignal: opp,
                              })
                            )
                          }
                          className="font-sans min-h-[32px] px-2.5 rounded-lg border border-cyan-500/35 bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-200 font-semibold inline-flex items-center justify-center gap-1 whitespace-nowrap shrink-0 transition-colors"
                        >
                          <LineChart className="w-3.5 h-3.5 shrink-0" />
                          <span>На график</span>
                          <ArrowUpRight className="w-3.5 h-3.5 shrink-0" />
                        </motion.button>
                      )}
                      <motion.button
                        whileTap={{ scale: 0.96 }}
                        type="button"
                        disabled={apiOrderBusyKey === `${opp.strategyKey}-${opp.symbol}-${opp.direction}`}
                        onClick={() => void handleExecuteSignalViaApi(opp)}
                        className={`font-sans min-h-[32px] px-2.5 rounded-lg font-semibold inline-flex items-center justify-center gap-1 whitespace-nowrap shrink-0 transition-colors ${
                          activeTradeApiKey
                            ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                            : 'border border-amber-400/35 bg-amber-500/12 hover:bg-amber-500/22 text-amber-200'
                        }`}
                      >
                        <Send className="w-3 h-3 shrink-0" />
                        <span>{activeTradeApiKey ? 'Через API' : 'API биржи'}</span>
                      </motion.button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>

            <NonCustodialRiskNotice
              text="Сигналы Live-сканера носят аналитический характер. VERNIER не принимает и не хранит ваши деньги; любые реальные сделки на бирже (вручную или через API) открываются исключительно по вашему решению и под вашу финансовую ответственность."
            />
            </div>
            )}
          </div>
        )}

        {section === 'sentiment' && (
          <AdvancedMarketSentiment
            isPro={isPro}
            isMax={isMax}
            isSignedIn={isSignedIn}
            creditsRemaining={profile?.creditsRemaining}
            onUpgradePro={() => void onSwitchPlan('pro')}
            onUpgradeMax={(mult) => void onSwitchPlan('max', mult ?? selectedMaxMultiplier)}
            onConsumeCredits={onConsumeCredits}
            onOpenPairOnMarket={onOpenPairOnMarket}
          />
        )}

        {section === 'analytics' && (
          <div data-tour-id="tour-strategies-pnl" className="space-y-4">
            <StrategyPnlChart
              strategies={strategies}
              isPro={isPro}
              isMax={isMax}
              isSignedIn={isSignedIn}
              creditsRemaining={profile?.creditsRemaining}
              creditQuota={totalCreditQuota}
              onUpgradePro={() => void onSwitchPlan('pro')}
              onUpgradeMax={() => void onSwitchPlan('max', selectedMaxMultiplier)}
              onConsumeCredits={onConsumeCredits}
            />
            {/* PRO #9: Сравнение 2 стратегий бок о бок с комиссией и проскальзыванием */}
            <StrategyComparisonPanel breakdown={Object.values(catalogBacktest)} />
            {/* MAX #7: Симулятор Монте-Карло (500 прогонов) + Критерий Келли (ленивая загрузка) */}
            <Suspense
              fallback={
                <div className="h-[340px] rounded-2xl border border-white/8 bg-[#111827] shimmer-skeleton" />
              }
            >
              <MonteCarloSimulator
                isMax={isMax}
                onUpgradeMax={() => void onSwitchPlan('max', selectedMaxMultiplier)}
              />
            </Suspense>
          </div>
        )}

        {section === 'calculator' && (
          <PositionSizeCalculator
            strategies={strategies}
            isPro={isPro}
            isMax={isMax}
            portfolioBalanceUsdt={portfolioBalanceUsdt}
            onUpgradePro={() => void onSwitchPlan('pro')}
            onSavedToJournal={() => setSection('journal')}
          />
        )}

        {section === 'journal' && (
          <Suspense
            fallback={
              <div className="h-[380px] rounded-2xl border border-white/8 bg-[#111827] shimmer-skeleton" />
            }
          >
            <TradeJournal
              uid={isSignedIn ? uid : null}
              isPro={isPro}
              isMax={isMax}
              privacyMode={privacyMode}
              onUpgradePro={() => void onSwitchPlan('pro')}
              onRequireLogin={onRequireLogin}
            />
          </Suspense>
        )}

        {section === 'plans' && (
          <div className="space-y-4">
            <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Free */}
              <div className="rounded-2xl border border-white/8 bg-[#111827] p-5 flex flex-col justify-between gap-4">
                <div>
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-semibold text-white">Базовый (Free)</h2>
                    <span className="font-mono text-sm font-semibold text-slate-300">$0 / мес</span>
                  </div>
                  <p className="mt-1.5 text-xs text-slate-400">
                    Для знакомства с терминалом на базовом скринере, классических стратегиях и локальном дневнике.
                  </p>
                  <ul className="mt-3.5 space-y-2 text-xs sm:text-sm text-slate-300">
                    <li className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <span>
                        {FREE_WEEKLY_QUOTA} кредитов каждые 7 дней (до 3 AI-анализов в день)
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <span>Классические базовые стратегии, плечо до {FREE_MAX_LEVERAGE}x и 1 сигнал/день</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <span>Базовый скринер, калькулятор риска, локальный дневник сделок и PIN-блокировка</span>
                    </li>
                  </ul>
                </div>
                <div className="min-h-[40px] rounded-xl border border-white/10 bg-[#0B0F17] text-slate-400 text-xs font-medium flex items-center justify-center">
                  {activePlanTier === 'free' ? 'Текущий базовый тариф' : 'Базовый функционал включён'}
                </div>
              </div>

              {/* PRO — gold-emerald highlight */}
              <div className="relative rounded-2xl border-2 border-amber-400/60 bg-gradient-to-b from-emerald-500/[0.11] via-[#111827] to-[#111827] p-5 flex flex-col justify-between gap-4 shadow-lg shadow-amber-500/10">
                <div className="absolute -top-3 left-5 px-2.5 py-0.5 rounded-full bg-gradient-to-r from-amber-400 to-emerald-400 text-slate-950 text-[10px] font-bold tracking-wider uppercase">
                  ХИТ · РЕКОМЕНДУЕМ
                </div>
                <div>
                  <div className="flex items-center justify-between pt-1">
                    <h2 className="text-base font-semibold text-white flex items-center gap-2">
                      <Crown className="w-5 h-5 text-amber-400" />
                      <span>PRO Терминал</span>
                    </h2>
                    <span className="font-mono text-sm font-semibold text-amber-400">
                      {proMonthPrice !== null ? `$${proMonthPrice} / мес` : '$19 / мес'}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-slate-300">
                    {PRO_MONTHLY_QUOTA} кредитов в месяц и полный набор рабочих инструментов активного трейдера.
                  </p>
                  <ul className="mt-3.5 space-y-2 text-xs sm:text-sm text-slate-200">
                    <li className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <span>{PRO_MONTHLY_QUOTA} кредитов/мес + безлимитный AI-перевод и разбор новостей</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <span>Все {STRATEGY_CATALOG.length} стратегий (Smart Money / Order Blocks, RSI дивергенции, BB Squeeze)</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <span>Мульти-таймфрейм консенсус (15m + 1H + 4H), Sentiment PRO и сканер TOP-16 пар</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <span>Multi-TP 30/40/30% матрица, 4H-бэктест, экспорт дневника и скринера в CSV</span>
                    </li>
                  </ul>
                </div>

                {isMax ? (
                  <div className="min-h-[40px] w-full rounded-xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-200 text-xs font-semibold flex items-center justify-center">
                    Все возможности PRO включены в MAX
                  </div>
                ) : isPro ? (
                  <div className="space-y-2">
                    <div className="min-h-[40px] w-full rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-xs font-semibold flex items-center justify-center gap-2">
                      <ShieldCheck className="w-4 h-4" />
                      <span>
                        PRO до {formatProUntilDate(profile?.proUntil)} · {profile?.creditsRemaining ?? 0}/{PRO_MONTHLY_QUOTA} кр.
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void onSwitchPlan('pro')}
                      className="min-h-[40px] w-full rounded-xl border border-amber-500/40 bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 text-xs font-semibold transition-colors"
                    >
                      Продлить PRO в Google Play
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => void onSwitchPlan('pro')}
                    className="cta-shimmer min-h-[42px] w-full rounded-xl bg-gradient-to-r from-amber-400 to-emerald-400 hover:brightness-105 text-slate-950 text-sm font-bold transition-all"
                  >
                    {isExpiredPro ? 'Продлить PRO · Google Play' : 'Оформить PRO · Google Play'}
                  </button>
                )}
              </div>

              {/* MAX with interactive X10 / X20 toggles */}
              <div className="rounded-2xl border-2 border-cyan-400/55 bg-gradient-to-b from-cyan-500/[0.12] to-[#111827] p-5 flex flex-col justify-between gap-4">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-base font-semibold text-white flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-cyan-300" />
                      <span>MAX ×{selectedMaxMultiplier}</span>
                    </h2>
                    <span className="font-mono text-sm font-semibold text-cyan-300">
                      {selectedMaxMultiplier === 20
                        ? `$${maxMonthPrice ? Math.round(maxMonthPrice * 1.65) : 79} / мес`
                        : `$${maxMonthPrice ?? 49} / мес`}
                    </span>
                  </div>

                  {/* Interactive X10 / X20 Toggle */}
                  <div className="mt-3 p-1 rounded-xl bg-[#071010] border border-cyan-500/30 grid grid-cols-2 gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic(10);
                        setSelectedMaxMultiplier(10);
                      }}
                      className={`min-h-[34px] rounded-lg text-xs font-mono font-bold transition-all ${
                        selectedMaxMultiplier === 10
                          ? 'bg-cyan-400 text-slate-950 shadow-sm'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      X10 · 1 000 кр.
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic(10);
                        setSelectedMaxMultiplier(20);
                      }}
                      className={`min-h-[34px] rounded-lg text-xs font-mono font-bold transition-all ${
                        selectedMaxMultiplier === 20
                          ? 'bg-gradient-to-r from-cyan-400 to-emerald-400 text-slate-950 shadow-sm'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      X20 · 2 000 кр.
                    </button>
                  </div>

                  <p className="mt-2.5 text-xs text-cyan-100/85">
                    Всё из PRO + <strong>{selectedMaxQuota.toLocaleString('ru-RU')} кредитов/мес (×{selectedMaxMultiplier} квоты PRO)</strong> и институциональные модули.
                  </p>
                  <ul className="mt-3 space-y-2 text-xs sm:text-sm text-slate-100">
                    <li className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-cyan-300 shrink-0 mt-0.5" />
                      <span>«AI-Консилиум» (3 оценки: Тех. анализ, Деривативы/Фандинг, Риск-менеджмент)</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-cyan-300 shrink-0 mt-0.5" />
                      <span>Радар аномалий фандинга и ликвидаций + сканер всех {TRADING_PAIRS.length} пар (1H/4H)</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-cyan-300 shrink-0 mt-0.5" />
                      <span>«Анти-FOMO защита», симулятор Монте-Карло и 1D-бэктест без списания кредитов (0 кр.)</span>
                    </li>
                  </ul>
                </div>

                {isMax ? (
                  <div className="space-y-2">
                    <div className="min-h-[40px] w-full rounded-xl border border-cyan-500/35 bg-cyan-500/15 text-cyan-200 text-xs font-semibold flex items-center justify-center gap-2">
                      <ShieldCheck className="w-4 h-4" />
                      <span>
                        MAX до {formatProUntilDate(profile?.proUntil)} · {profile?.creditsRemaining ?? 0}/
                        {activeMaxQuota.toLocaleString('ru-RU')} кр.
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void onSwitchPlan('max', selectedMaxMultiplier)}
                      className="min-h-[40px] w-full rounded-xl border border-cyan-500/45 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-100 text-xs font-semibold transition-colors"
                    >
                      Управлять MAX ×{selectedMaxMultiplier} · Google Play
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => void onSwitchPlan('max', selectedMaxMultiplier)}
                    className="cta-shimmer min-h-[42px] w-full rounded-xl bg-cyan-400 hover:bg-cyan-300 text-slate-950 text-sm font-bold transition-colors"
                  >
                    Оформить MAX ×{selectedMaxMultiplier} ({selectedMaxQuota.toLocaleString('ru-RU')} кр.)
                  </button>
                )}
              </div>
            </section>

            <div className="rounded-xl border border-white/8 bg-[#0B0F17] px-4 py-2.5 text-[11px] text-slate-400 leading-relaxed">
              Оплата подписок осуществляется в фиатной валюте через <strong className="text-slate-200">Google Play Billing</strong> (Google Pay / банковская карта). Автопродление можно отменить в любой момент в настройках Google Play.
            </div>
          </div>
        )}
      </WorkspaceShell>

      {builderOpen && (
        <Suspense fallback={null}>
          <NoCodeStrategyBuilderModal
            open={builderOpen}
            onClose={() => setBuilderOpen(false)}
            onSaved={(nextList) => {
              setCustomStrategies(nextList);
              setFeedback({
                text: `Пользовательская стратегия «${nextList[0]?.name ?? 'Новая'}» добавлена в каталог.`,
                tone: 'success',
              });
            }}
          />
        </Suspense>
      )}

      {webhookOpen && (
        <Suspense fallback={null}>
          <WebhookBuilderModal
            open={webhookOpen}
            onClose={() => setWebhookOpen(false)}
            sampleSymbol="BTCUSDT"
            samplePrice={94250}
          />
        </Suspense>
      )}

      {/* Информационная модалка: Paper Trading (Сигналы) vs Live Trading (API биржи) */}
      <AnimatePresence>
        {modeInfoOpen && (
          <motion.div
            key="strategy-mode-info-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => setModeInfoOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-label="Сравнение режимов Paper Trading и Live Trading"
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4"
          >
            <motion.div
              key="strategy-mode-info-card"
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-xl max-h-[90dvh] flex flex-col rounded-t-2xl sm:rounded-2xl border border-white/12 bg-[#0E1420] shadow-2xl overflow-hidden"
            >
              <header className="px-4 sm:px-5 py-3.5 border-b border-white/8 flex items-center justify-between gap-3 bg-[#090D16]">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-cyan-500/15 border border-cyan-500/35 flex items-center justify-center text-cyan-300 shrink-0">
                    <Info className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm sm:text-base font-bold text-white truncate">
                      Paper Trading vs Live Trading
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      Как именно работают ваши активные стратегии прямо сейчас
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setModeInfoOpen(false)}
                  aria-label="Закрыть справку по режимам"
                  className="min-h-[36px] min-w-[36px] rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 flex items-center justify-center shrink-0 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </header>

              <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-3.5 text-xs">
                {/* Текущий статус */}
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.08] px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-slate-200">
                    Ваш текущий режим:{' '}
                    <strong className={executionMode === 'api_confirm' ? 'text-cyan-300' : 'text-emerald-300'}>
                      {executionMode === 'api_confirm'
                        ? 'Live Trading (API биржи + подтверждение)'
                        : 'Paper Trading / Сигналы'}
                    </strong>
                  </span>
                  <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-black/40 text-slate-300">
                    {activeTradeApiKey
                      ? `Trade API: ${activeTradeApiKey.exchange.toUpperCase()}`
                      : 'Trade API не подключён'}
                  </span>
                </div>

                {/* Карточка 1: Paper Trading / Сигналы */}
                <div
                  className={`rounded-xl border p-3.5 space-y-2 ${
                    executionMode === 'signals'
                      ? 'border-emerald-400/50 bg-emerald-500/[0.06]'
                      : 'border-white/10 bg-[#111827]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-white inline-flex items-center gap-1.5 text-sm">
                      <BellRing className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>1. Paper Trading / Режим сигналов</span>
                    </span>
                    {executionMode === 'signals' && (
                      <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 border border-emerald-400/40 font-mono text-[10px] font-bold text-emerald-300">
                        ВЫБРАН
                      </span>
                    )}
                  </div>
                  <p className="text-slate-300 leading-relaxed">
                    Движок анализирует реальные биржевые свечи и публикует готовые сигналы (Зона входа, Stop-Loss, TP1, TP2) в «Ленте сигналов» и Push/Telegram-уведомлениях.
                  </p>
                  <ul className="space-y-1 text-slate-400">
                    <li>• <strong className="text-slate-200">Нулевой риск реальных средств:</strong> ордера на биржу не отправляются.</li>
                    <li>• Можно тестировать идеи на виртуальном тренажёре Paper Trading ($10,000) в разделе «Рынок» или открывать сделки вручную.</li>
                    <li>• API-ключ биржи не требуется.</li>
                  </ul>
                  {executionMode !== 'signals' && (
                    <button
                      type="button"
                      onClick={() => {
                        handleSetExecutionMode('signals');
                        setModeInfoOpen(false);
                      }}
                      className="mt-1 min-h-[34px] px-3 rounded-lg border border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200 font-semibold transition-colors"
                    >
                      Переключиться на Paper / Сигналы
                    </button>
                  )}
                </div>

                {/* Карточка 2: Read-Only / Testnet API (безопасный режим без реального автоисполнения) */}
                <div
                  className={`rounded-xl border p-3.5 space-y-2 ${
                    executionMode === 'api_confirm'
                      ? 'border-cyan-400/50 bg-cyan-500/[0.06]'
                      : 'border-white/10 bg-[#111827]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-white inline-flex items-center gap-1.5 text-sm">
                      <KeyRound className="w-4 h-4 text-cyan-400 shrink-0" />
                      <span>2. Read-Only / Testnet API биржи</span>
                    </span>
                    {executionMode === 'api_confirm' && (
                      <span className="px-2 py-0.5 rounded-md bg-cyan-500/20 border border-cyan-400/40 font-mono text-[10px] font-bold text-cyan-200">
                        ВЫБРАН
                      </span>
                    )}
                  </div>
                  <p className="text-slate-300 leading-relaxed">
                    Синхронизирует реальный баланс портфеля с Binance, Bybit или OKX по ключу Read-Only и позволяет проверять исполнение ордеров в безопасной песочнице Testnet.
                  </p>
                  <ul className="space-y-1 text-slate-400">
                    <li>• <strong className="text-amber-200">Политика безопасности сервера:</strong> реальное автоисполнение ордеров на Mainnet отключено в целях защиты капитала.</li>
                    <li>• <strong className="text-slate-200">Non-Custodial:</strong> деньги всегда остаются на вашей бирже — права на вывод средств (Withdrawals) никогда не запрашиваются.</li>
                    <li>• Каждое тестовое действие в Testnet требует ручного подтверждения (+ 2FA при включении).</li>
                  </ul>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {executionMode !== 'api_confirm' && (
                      <button
                        type="button"
                        onClick={() => {
                          handleSetExecutionMode('api_confirm');
                          setModeInfoOpen(false);
                        }}
                        className="min-h-[34px] px-3 rounded-lg border border-cyan-500/40 bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-200 font-semibold transition-colors"
                      >
                        Подключить Read-Only / Testnet API
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic(8);
                        setModeInfoOpen(false);
                        setApiGuideOpen(true);
                      }}
                      className="min-h-[34px] px-3 rounded-lg border border-cyan-500/35 bg-cyan-500/12 hover:bg-cyan-500/20 text-cyan-200 font-medium inline-flex items-center gap-1.5 transition-colors"
                    >
                      <BookOpen className="w-3.5 h-3.5 shrink-0" />
                      <span>Как получить API-ключ?</span>
                    </button>
                    {onOpenExchangeIntegrations && (
                      <button
                        type="button"
                        onClick={() => {
                          setModeInfoOpen(false);
                          window.requestAnimationFrame(() => {
                            window.setTimeout(() => onOpenExchangeIntegrations(), 60);
                          });
                        }}
                        className="min-h-[34px] px-3 rounded-lg border border-white/12 bg-white/5 hover:bg-white/10 text-slate-200 font-medium inline-flex items-center gap-1.5 transition-colors"
                      >
                        <Link2 className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Настроить API-ключи</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <footer className="px-4 sm:px-5 py-3 border-t border-white/8 bg-[#090D16] flex items-center justify-between gap-2 text-[11px] text-slate-400">
                <span className="inline-flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Ключи шифруются AES-256-GCM · без прав на вывод</span>
                </span>
                <button
                  type="button"
                  onClick={() => setModeInfoOpen(false)}
                  className="min-h-[34px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors"
                >
                  Понятно
                </button>
              </footer>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ExchangeApiGuideModal
        open={apiGuideOpen}
        onClose={() => setApiGuideOpen(false)}
        onOpenExchangeIntegrations={onOpenExchangeIntegrations}
      />
    </StaggerDeck>
  );
};

