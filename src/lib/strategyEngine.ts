import type {
  AnalysisRecord,
  ExchangeKeyRecord,
  ExchangeOrderResult,
  LiveScannerOpportunity,
  MarketType,
  StrategyConfig,
  StrategyLiveTelemetry,
} from '../types/domain';
import {
  classifyExchangeSyncError,
  type ExchangeSyncErrorLogEntry,
} from './exchangeSyncErrorLog';

export type StrategyEngineState = 'Idle' | 'Monitoring' | 'Execution';
export type StrategyOperatingMode = 'paper' | 'live';
export type StrategyStreamStatus = 'idle' | 'connecting' | 'connected';

export type StrategySignalPhase =
  | 'IN_ENTRY'
  | 'MOVING_TO_TP1'
  | 'TP1_HIT'
  | 'TP2_HIT'
  | 'DRAWDOWN'
  | 'SL_HIT';

export interface ActiveStrategySignalOverlay {
  strategyKey: string;
  strategyName: string;
  symbol: string;
  marketType: MarketType;
  direction: 'LONG' | 'SHORT';
  confidence: number;
  entryPrice: number;
  stopLossPrice: number;
  tp1Price: number;
  takeProfitPrice: number;
  riskRewardRatio: number;
  engineState: StrategyEngineState;
  mode: StrategyOperatingMode;
  emittedAt: string;
  isProjected?: boolean;
}

export interface StrategySignalEvent {
  id: string;
  seq: number;
  dedupeKey: string;
  emittedAt: string;
  strategyKey: string;
  strategyName: string;
  symbol: string;
  marketType: MarketType;
  direction: 'LONG' | 'SHORT';
  confidence: number;
  entryPrice: number;
  entryZoneLow: number;
  entryZoneHigh: number;
  stopLossPrice: number;
  tp1Price: number;
  takeProfitPrice: number;
  riskRewardRatio: number;
  rsi14: number;
  trendBias: 'BULLISH' | 'BEARISH' | 'RANGE';
  change24hPct: number;
  summary: string;
  mode: StrategyOperatingMode;
  engineState: StrategyEngineState;
  orderId?: string;
  exchange?: string;
  opportunity: LiveScannerOpportunity;
}

export interface StrategyStateTransition {
  strategyKey: string;
  from: StrategyEngineState;
  to: StrategyEngineState;
  reason: string;
  timestamp: string;
}

export interface StrategySignalProgress {
  /** Позиция текущей цены на отрезке Stop-Loss (0%) -> TP2 (100%) */
  trackPct: number;
  /** Позиция точки входа на отрезке SL..TP2 (%) */
  entryMarkerPct: number;
  /** Позиция TP1 на отрезке SL..TP2 (%) */
  tp1MarkerPct: number;
  /** Прогресс от Входа до TP2 в процентах (-100% на SL, 0% на Entry, +100% на TP2) */
  rewardProgressPct: number;
  /** Нереализованное изменение цены от входа (%) с учётом LONG/SHORT */
  pnlFromEntryPct: number;
  /** Расстояние до Stop-Loss (%) */
  distToSlPct: number;
  /** Расстояние до TP2 (%) */
  distToTp2Pct: number;
  phase: StrategySignalPhase;
  phaseLabelRu: string;
}

export interface LiveExecutionIntent {
  ready: boolean;
  reasonRu: string;
  exchangeKey: ExchangeKeyRecord | null;
  orderPayload: {
    symbol: string;
    marketType: MarketType;
    side: 'BUY' | 'SELL';
    orderType: 'MARKET';
    quantity: number;
    stopLoss: number;
    takeProfit: number;
  } | null;
}

const SIGNAL_FEED_STORAGE_KEY = 'vernier_strategy_signal_feed_v1';
const MAX_STREAM_HISTORY = 50;

export const ENGINE_STATE_META: Record<
  StrategyEngineState,
  { labelRu: string; shortRu: string; descriptionRu: string }
> = {
  Idle: {
    labelRu: 'Ожидание (Idle)',
    shortRu: 'Ожидание',
    descriptionRu: 'Стратегия отключена и не отслеживает рыночные свечи.',
  },
  Monitoring: {
    labelRu: 'Мониторинг (Monitoring)',
    shortRu: 'Мониторинг',
    descriptionRu: 'Движок непрерывно сканирует свечи и ждёт совпадения индикаторов выше порога уверенности.',
  },
  Execution: {
    labelRu: 'Исполнение (Execution)',
    shortRu: 'Исполнение',
    descriptionRu: 'Сигнал сработал или ордер отправлен — отслеживается прогресс цены между SL, Входом и TP.',
  },
};

/**
 * Рассчитывает явное состояние конечного автомата стратегии:
 * Idle -> Monitoring -> Execution
 */
export function resolveStrategyEngineState(params: {
  enabled: boolean;
  hasActiveSignal: boolean;
  hasPlacedOrder: boolean;
}): StrategyEngineState {
  if (!params.enabled) return 'Idle';
  if (params.hasPlacedOrder || params.hasActiveSignal) return 'Execution';
  return 'Monitoring';
}

/**
 * Конечный автомат стратегий: фиксирует переходы Idle / Monitoring / Execution
 * и сохраняет журнал последних переходов в памяти.
 */
export class StrategyStateMachine {
  private states = new Map<string, StrategyEngineState>();
  private transitions: StrategyStateTransition[] = [];

  getState(strategyKey: string): StrategyEngineState {
    return this.states.get(strategyKey) ?? 'Idle';
  }

  transition(strategyKey: string, next: StrategyEngineState, reason: string): StrategyStateTransition | null {
    const prev = this.getState(strategyKey);
    if (prev === next) return null;
    this.states.set(strategyKey, next);
    const record: StrategyStateTransition = {
      strategyKey,
      from: prev,
      to: next,
      reason,
      timestamp: new Date().toISOString(),
    };
    this.transitions = [record, ...this.transitions].slice(0, 60);
    return record;
  }

  getRecentTransitions(strategyKey?: string): StrategyStateTransition[] {
    if (!strategyKey) return this.transitions;
    return this.transitions.filter((t) => t.strategyKey === strategyKey);
  }
}

/**
 * Рассчитывает живой прогресс текущего сигнала по текущей рыночной цене:
 * положение на шкале SL (0%) -> Entry -> TP1 -> TP2 (100%) и фазу отработки.
 */
export function calculateSignalProgress(
  signal: Pick<
    ActiveStrategySignalOverlay,
    'direction' | 'entryPrice' | 'stopLossPrice' | 'tp1Price' | 'takeProfitPrice'
  >,
  livePrice: number
): StrategySignalProgress {
  const safePrice = Number.isFinite(livePrice) && livePrice > 0 ? livePrice : signal.entryPrice;
  const isLong = signal.direction === 'LONG';
  const sl = signal.stopLossPrice;
  const entry = signal.entryPrice;
  const tp2 = signal.takeProfitPrice;
  const tp1 =
    Number.isFinite(signal.tp1Price) && signal.tp1Price > 0
      ? signal.tp1Price
      : entry + (tp2 - entry) * 0.5;

  const fullSpan = isLong ? tp2 - sl : sl - tp2;
  const safeSpan = Math.abs(fullSpan) > 1e-9 ? Math.abs(fullSpan) : Math.max(entry * 0.02, 1e-6);

  const rawTrack = isLong ? ((safePrice - sl) / safeSpan) * 100 : ((sl - safePrice) / safeSpan) * 100;
  const trackPct = Math.max(0, Math.min(100, rawTrack));

  const rawEntryMarker = isLong ? ((entry - sl) / safeSpan) * 100 : ((sl - entry) / safeSpan) * 100;
  const entryMarkerPct = Math.max(5, Math.min(95, rawEntryMarker));

  const rawTp1Marker = isLong ? ((tp1 - sl) / safeSpan) * 100 : ((sl - tp1) / safeSpan) * 100;
  const tp1MarkerPct = Math.max(entryMarkerPct + 4, Math.min(96, rawTp1Marker));

  const pnlFromEntryPct =
    entry > 0 ? ((isLong ? safePrice - entry : entry - safePrice) / entry) * 100 : 0;

  const rewardSpan = Math.abs(tp2 - entry) > 1e-9 ? Math.abs(tp2 - entry) : safeSpan * 0.65;
  const riskSpan = Math.abs(entry - sl) > 1e-9 ? Math.abs(entry - sl) : safeSpan * 0.35;

  const favorableMove = isLong ? safePrice - entry : entry - safePrice;
  const rewardProgressPct =
    favorableMove >= 0
      ? Math.min(130, (favorableMove / rewardSpan) * 100)
      : Math.max(-130, (favorableMove / riskSpan) * 100);

  const distToSlPct =
    safePrice > 0 ? ((isLong ? safePrice - sl : sl - safePrice) / safePrice) * 100 : 0;
  const distToTp2Pct =
    safePrice > 0 ? ((isLong ? tp2 - safePrice : safePrice - tp2) / safePrice) * 100 : 0;

  let phase: StrategySignalPhase = 'IN_ENTRY';
  let phaseLabelRu = 'В зоне входа';

  if (isLong ? safePrice <= sl : safePrice >= sl) {
    phase = 'SL_HIT';
    phaseLabelRu = 'Достигнут Stop-Loss';
  } else if (isLong ? safePrice >= tp2 : safePrice <= tp2) {
    phase = 'TP2_HIT';
    phaseLabelRu = 'Цель TP2 достигнута';
  } else if (isLong ? safePrice >= tp1 : safePrice <= tp1) {
    phase = 'TP1_HIT';
    phaseLabelRu = 'TP1 пробит · путь к TP2';
  } else if (Math.abs(pnlFromEntryPct) <= 0.2) {
    phase = 'IN_ENTRY';
    phaseLabelRu = 'В зоне входа';
  } else if (pnlFromEntryPct > 0.2) {
    phase = 'MOVING_TO_TP1';
    phaseLabelRu = 'В плюсе · движение к TP1';
  } else {
    phase = 'DRAWDOWN';
    phaseLabelRu = 'Откат к Stop-Loss';
  }

  return {
    trackPct,
    entryMarkerPct,
    tp1MarkerPct,
    rewardProgressPct,
    pnlFromEntryPct,
    distToSlPct,
    distToTp2Pct,
    phase,
    phaseLabelRu,
  };
}

/**
 * Строит полную структуру уровней (Вход / Stop-Loss / TP1 / TP2) для отображения на графике:
 * - Если у стратегии есть сработавший сигнал (`emittedSignal`), берёт его точные уровни;
 * - Если стратегия в состоянии `Monitoring`, рассчитывает проектные уровни от текущей цены тикера
 *   и риск-параметров стратегии, чтобы пользователь всегда мог открыть график и увидеть зоны входа/SL/TP.
 */
export function buildStrategySignalOverlay(params: {
  strategyKey: string;
  strategyName: string;
  symbol: string;
  marketType: MarketType;
  mode: StrategyOperatingMode;
  emittedSignal?: LiveScannerOpportunity;
  telemetry?: StrategyLiveTelemetry;
  livePrice?: number;
  riskPerTradePct?: number;
  hasPlacedOrder?: boolean;
}): ActiveStrategySignalOverlay {
  if (params.emittedSignal) {
    const opp = params.emittedSignal;
    const tp1 = opp.entryPrice + (opp.takeProfitPrice - opp.entryPrice) * 0.5;
    return {
      strategyKey: opp.strategyKey,
      strategyName: opp.strategyName,
      symbol: opp.symbol,
      marketType: opp.marketType,
      direction: opp.direction,
      confidence: opp.confidence,
      entryPrice: opp.entryPrice,
      stopLossPrice: opp.stopLossPrice,
      tp1Price: tp1,
      takeProfitPrice: opp.takeProfitPrice,
      riskRewardRatio: opp.riskRewardRatio,
      engineState: 'Execution',
      mode: params.mode,
      emittedAt: new Date().toISOString(),
      isProjected: false,
    };
  }

  const direction: 'LONG' | 'SHORT' =
    params.telemetry?.bestDirection === 'SHORT' ? 'SHORT' : 'LONG';
  const basePrice =
    params.livePrice && Number.isFinite(params.livePrice) && params.livePrice > 0
      ? params.livePrice
      : 100;
  const riskPct = Math.max(0.6, Math.min(3.5, (params.riskPerTradePct ?? 1.5) * 0.9)) / 100;
  const rewardPct = riskPct * 2.2;
  const stopLossPrice =
    direction === 'LONG' ? basePrice * (1 - riskPct) : basePrice * (1 + riskPct);
  const takeProfitPrice =
    direction === 'LONG' ? basePrice * (1 + rewardPct) : basePrice * (1 - rewardPct);
  const tp1Price = basePrice + (takeProfitPrice - basePrice) * 0.5;

  return {
    strategyKey: params.strategyKey,
    strategyName: params.strategyName,
    symbol: params.symbol,
    marketType: params.marketType,
    direction,
    confidence: params.telemetry?.bestConfidence ?? 0,
    entryPrice: basePrice,
    stopLossPrice,
    tp1Price,
    takeProfitPrice,
    riskRewardRatio: 2.2,
    engineState: params.hasPlacedOrder ? 'Execution' : 'Monitoring',
    mode: params.mode,
    emittedAt: new Date().toISOString(),
    isProjected: true,
  };
}

/**
 * Simulation Runner (Paper Trading): оценивает набор активных стратегий на симулированных данных терминала,
 * обновляет переходы автомата Idle/Monitoring/Execution и возвращает сводку состояния.
 */
export function runPaperSimulationStep(params: {
  strategies: StrategyConfig[];
  opportunities: LiveScannerOpportunity[];
  placedOrders: Record<string, { strategyKey: string }>;
  machine: StrategyStateMachine;
}): {
  statesByKey: Record<string, StrategyEngineState>;
  counts: { idle: number; monitoring: number; execution: number };
} {
  const oppByStrategy = new Map<string, LiveScannerOpportunity>();
  for (const opp of params.opportunities) {
    if (!oppByStrategy.has(opp.strategyKey)) {
      oppByStrategy.set(opp.strategyKey, opp);
    }
  }

  const statesByKey: Record<string, StrategyEngineState> = {};
  const counts = { idle: 0, monitoring: 0, execution: 0 };

  for (const cfg of params.strategies) {
    const hasSignal = oppByStrategy.has(cfg.strategyKey);
    const hasOrder = Boolean(params.placedOrders[cfg.strategyKey]);
    const nextState = resolveStrategyEngineState({
      enabled: cfg.enabled,
      hasActiveSignal: hasSignal,
      hasPlacedOrder: hasOrder,
    });
    const reason =
      nextState === 'Execution'
        ? hasOrder
          ? 'Ордер отправлен через API'
          : 'Сигнал превысил порог уверенности'
        : nextState === 'Monitoring'
          ? 'Активный мониторинг свечей 1H'
          : 'Стратегия выключена';

    params.machine.transition(cfg.strategyKey, nextState, reason);
    statesByKey[cfg.strategyKey] = nextState;

    if (nextState === 'Execution') counts.execution += 1;
    else if (nextState === 'Monitoring') counts.monitoring += 1;
    else counts.idle += 1;
  }

  return { statesByKey, counts };
}

/**
 * Live Execution Placeholder & Validation Bridge:
 * Проверяет наличие активного Trade API-ключа и рассчитывает безопасный размер ордера.
 * Фактическая отправка выполняется только через защищённый обработчик с обязательным подтверждением пользователя.
 */
export function prepareLiveExecutionIntent(params: {
  opportunity: LiveScannerOpportunity;
  strategyConfig?: StrategyConfig;
  exchangeKeys: ExchangeKeyRecord[];
  selectedExchangeKeyId?: string | null;
  portfolioBalanceUsdt?: number;
}): LiveExecutionIntent {
  const tradeKeys = params.exchangeKeys.filter((k) => k.enabled && k.permissions === 'trade');
  const tradeKey =
    (params.selectedExchangeKeyId
      ? tradeKeys.find((k) => k.id === params.selectedExchangeKeyId)
      : null) ??
    tradeKeys[0] ??
    null;
  if (!tradeKey) {
    const hasReadOnly = params.exchangeKeys.some((k) => k.enabled);
    return {
      ready: false,
      exchangeKey: null,
      orderPayload: null,
      reasonRu: hasReadOnly
        ? 'Подключён Read-Only ключ. Для Live Trading добавьте API-ключ с правом «Торговля» в «Защита → Биржи API».'
        : 'Для Live Trading подключите активный API-ключ биржи (Binance / Bybit / OKX) в «Защита → Биржи API».',
    };
  }

  const opp = params.opportunity;
  const balance = Math.max(100, params.portfolioBalanceUsdt || 1000);
  const riskPct = params.strategyConfig?.riskPerTradePct ?? 1.5;
  const leverage = opp.marketType === 'futures' ? Math.max(1, params.strategyConfig?.leverage ?? 3) : 1;
  const slDistancePct = Math.max(
    0.004,
    Math.abs(opp.entryPrice - opp.stopLossPrice) / Math.max(1e-9, opp.entryPrice)
  );
  const riskUsdt = (balance * riskPct) / 100;
  const rawNotional = Math.min(balance * leverage * 0.25, riskUsdt / slDistancePct);
  const notionalUsdt = Math.max(12, Math.min(rawNotional, tradeKey.testnet ? 50 : rawNotional));
  const quantity = Number(
    (notionalUsdt / Math.max(1e-9, opp.entryPrice)).toFixed(opp.entryPrice >= 100 ? 4 : 2)
  );

  return {
    ready: true,
    exchangeKey: tradeKey,
    reasonRu: `Готово к подтверждению и отправке на ${tradeKey.exchange.toUpperCase()} (${tradeKey.label}${tradeKey.testnet ? ' · Testnet' : ''}).`,
    orderPayload: {
      symbol: opp.symbol,
      marketType: opp.marketType,
      side: opp.direction === 'LONG' ? 'BUY' : 'SELL',
      orderType: 'MARKET',
      quantity: Math.max(0.0001, quantity),
      stopLoss: opp.stopLossPrice,
      takeProfit: opp.takeProfitPrice,
    },
  };
}

/**
 * Live Execution runner (non-custodial):
 * Никогда не отправляет сделки в обход подтверждения ответственности — делегирует выполнение
 * в `onPlaceExchangeOrder`, который всегда открывает TradeRiskConfirmModal (+ 2FA).
 */
export async function executeLiveStrategyOrder(params: {
  intent: LiveExecutionIntent;
  onPlaceExchangeOrder?: (
    key: ExchangeKeyRecord,
    orderParams: NonNullable<LiveExecutionIntent['orderPayload']>
  ) => Promise<ExchangeOrderResult>;
}): Promise<ExchangeOrderResult> {
  if (!params.intent.ready || !params.intent.exchangeKey || !params.intent.orderPayload) {
    throw new Error(params.intent.reasonRu);
  }
  if (!params.onPlaceExchangeOrder) {
    throw new Error('Обработчик биржевых ордеров недоступен. Подключите API-ключ в разделе «Защита → Биржи API».');
  }
  return params.onPlaceExchangeOrder(params.intent.exchangeKey, params.intent.orderPayload);
}

/**
 * WebSocket-подобный поток событий сигналов движка (Pub/Sub Event Stream):
 * - Хранит кольцевой буфер сигналов в localStorage;
 * - Оповещает подписанные компоненты (`LiveSignalFeed`) при появлении каждого нового LONG/SHORT сигнала,
 *   обновлении статуса исполнения ордера и сердцебиении потока.
 */
type StreamListener = (events: StrategySignalEvent[], status: StrategyStreamStatus, lastHeartbeatAt: string | null) => void;

function buildSignalEvent(
  opp: LiveScannerOpportunity,
  mode: StrategyOperatingMode,
  nowIso: string,
  seq: number
): StrategySignalEvent {
  const hourBucket = nowIso.slice(0, 13);
  const dedupeKey = `${opp.strategyKey}|${opp.symbol}|${opp.direction}|${hourBucket}`;
  const band = opp.entryPrice * 0.0015;
  const entryZoneLow = Math.max(0, opp.entryPrice - band);
  const entryZoneHigh = opp.entryPrice + band;
  const tp1Price = opp.entryPrice + (opp.takeProfitPrice - opp.entryPrice) * 0.5;
  const biasLabel =
    opp.trendBias === 'BULLISH'
      ? 'восходящая структура'
      : opp.trendBias === 'BEARISH'
        ? 'нисходящая структура'
        : 'боковой диапазон';
  const summary = `ТФ ${opp.timeframe.toUpperCase()}: ${biasLabel}, RSI(14) = ${opp.rsi14}, импульс 24ч ${opp.change24hPct >= 0 ? '+' : ''}${opp.change24hPct.toFixed(2)}%, R:R 1:${opp.riskRewardRatio}.`;

  return {
    id: `sig-${Date.now()}-${seq}-${Math.random().toString(36).slice(2, 5)}`,
    seq,
    dedupeKey,
    emittedAt: nowIso,
    strategyKey: opp.strategyKey,
    strategyName: opp.strategyName,
    symbol: opp.symbol,
    marketType: opp.marketType,
    direction: opp.direction,
    confidence: opp.confidence,
    entryPrice: opp.entryPrice,
    entryZoneLow,
    entryZoneHigh,
    stopLossPrice: opp.stopLossPrice,
    tp1Price,
    takeProfitPrice: opp.takeProfitPrice,
    riskRewardRatio: opp.riskRewardRatio,
    rsi14: opp.rsi14,
    trendBias: opp.trendBias,
    change24hPct: opp.change24hPct,
    summary,
    mode,
    engineState: 'Execution',
    opportunity: opp,
  };
}

export class StrategyEventStream {
  private events: StrategySignalEvent[] = [];
  private listeners = new Set<StreamListener>();
  private status: StrategyStreamStatus = 'idle';
  private lastHeartbeatAt: string | null = null;
  private seq = 1;

  constructor() {
    this.events = this.loadFromStorage();
    if (this.events.length > 0) {
      this.seq = Math.max(...this.events.map((e) => e.seq || 0), 1) + 1;
    }
  }

  private loadFromStorage(): StrategySignalEvent[] {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(SIGNAL_FEED_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return (parsed as Partial<StrategySignalEvent>[])
          .filter((item): item is StrategySignalEvent => Boolean(item && item.symbol && item.strategyKey))
          .map((item, idx): StrategySignalEvent => ({
            ...item,
            seq: typeof item.seq === 'number' ? item.seq : idx + 1,
            mode: item.mode === 'live' ? 'live' : 'paper',
            engineState: item.engineState || 'Execution',
          }))
          .slice(0, MAX_STREAM_HISTORY);
      }
    } catch {
      // ignore storage errors
    }
    return [];
  }

  private persist(): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(SIGNAL_FEED_STORAGE_KEY, JSON.stringify(this.events));
    } catch {
      // ignore storage quota errors
    }
  }

  private notify(): void {
    const snapshot = [...this.events];
    for (const listener of this.listeners) {
      listener(snapshot, this.status, this.lastHeartbeatAt);
    }
  }

  getEvents(): StrategySignalEvent[] {
    return [...this.events];
  }

  getStatus(): { status: StrategyStreamStatus; lastHeartbeatAt: string | null } {
    return { status: this.status, lastHeartbeatAt: this.lastHeartbeatAt };
  }

  setStatus(nextStatus: StrategyStreamStatus): void {
    this.status = nextStatus;
    if (nextStatus === 'connected') {
      this.lastHeartbeatAt = new Date().toISOString();
    }
    this.notify();
  }

  heartbeat(): void {
    this.status = 'connected';
    this.lastHeartbeatAt = new Date().toISOString();
    this.notify();
  }

  subscribe(listener: StreamListener): () => void {
    this.listeners.add(listener);
    listener([...this.events], this.status, this.lastHeartbeatAt);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publishOpportunities(opportunities: LiveScannerOpportunity[], mode: StrategyOperatingMode): number {
    this.status = 'connected';
    this.lastHeartbeatAt = new Date().toISOString();
    if (!opportunities || opportunities.length === 0) {
      this.notify();
      return 0;
    }
    const nowIso = this.lastHeartbeatAt;
    const existingKeys = new Set(this.events.map((e) => e.dedupeKey));
    const additions: StrategySignalEvent[] = [];

    for (const opp of opportunities) {
      const candidate = buildSignalEvent(opp, mode, nowIso, this.seq);
      if (!existingKeys.has(candidate.dedupeKey)) {
        existingKeys.add(candidate.dedupeKey);
        this.seq += 1;
        additions.push(candidate);
      }
    }

    if (additions.length > 0) {
      this.events = [...additions, ...this.events].slice(0, MAX_STREAM_HISTORY);
      this.persist();
    }
    this.notify();
    return additions.length;
  }

  markOrderExecuted(params: {
    strategyKey: string;
    symbol: string;
    direction: 'LONG' | 'SHORT';
    orderId: string;
    exchange: string;
  }): void {
    let changed = false;
    this.events = this.events.map((ev) => {
      if (
        ev.strategyKey === params.strategyKey &&
        ev.symbol === params.symbol &&
        ev.direction === params.direction
      ) {
        changed = true;
        return {
          ...ev,
          mode: 'live',
          engineState: 'Execution',
          orderId: params.orderId,
          exchange: params.exchange,
        };
      }
      return ev;
    });
    if (changed) {
      this.persist();
      this.notify();
    }
  }

  clear(): void {
    this.events = [];
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(SIGNAL_FEED_STORAGE_KEY);
      } catch {
        // ignore storage errors
      }
    }
    this.notify();
  }
}

export const strategyEventStream = new StrategyEventStream();
export const strategyStateMachine = new StrategyStateMachine();

/* -------------------------------------------------------------------------- */
/* Dynamic Strategy Status Badge (Idle / Monitoring Signal / Order Placed)    */
/* -------------------------------------------------------------------------- */

export type StrategyBadgeCode = 'Idle' | 'Monitoring Signal' | 'Order Placed (Live)';

export interface StrategyStatusBadgeMeta {
  code: StrategyBadgeCode;
  labelRu: string;
  tone: 'idle' | 'monitoring' | 'signal' | 'live_placed';
  hasSignalReady: boolean;
}

/**
 * Преобразует внутреннее состояние `strategyEngine` (Idle / Monitoring / Execution)
 * в явный динамический бейдж статуса для карточки стратегии:
 * - 'Idle' — стратегия выключена;
 * - 'Monitoring Signal' — активный мониторинг (или сигнал готов к подтверждению);
 * - 'Order Placed (Live)' — ордер реально размещён на подключённой бирже.
 */
export function resolveStrategyStatusBadge(params: {
  engineState: StrategyEngineState;
  hasPlacedOrder: boolean;
  hasEmittedSignal: boolean;
}): StrategyStatusBadgeMeta {
  if (params.engineState === 'Idle') {
    return {
      code: 'Idle',
      labelRu: 'Ожидание',
      tone: 'idle',
      hasSignalReady: false,
    };
  }
  if (params.hasPlacedOrder) {
    return {
      code: 'Order Placed (Live)',
      labelRu: 'Ордер размещён (Live)',
      tone: 'live_placed',
      hasSignalReady: true,
    };
  }
  return {
    code: 'Monitoring Signal',
    labelRu: params.hasEmittedSignal ? 'Сигнал найден' : 'Мониторинг сигнала',
    tone: params.hasEmittedSignal ? 'signal' : 'monitoring',
    hasSignalReady: params.hasEmittedSignal,
  };
}

/* -------------------------------------------------------------------------- */
/* Explicit Live Execution Toggle & Verified Live Exchange Status             */
/* -------------------------------------------------------------------------- */

const LIVE_EXEC_ENABLED_KEY = 'vernier_live_exec_enabled_v1';
const LIVE_EXEC_KEY_ID_KEY = 'vernier_live_exec_key_id_v1';

export interface LiveExecutionPrefs {
  enabled: boolean;
  selectedKeyId: string | null;
}

export function readLiveExecutionPrefs(): LiveExecutionPrefs {
  if (typeof window === 'undefined') {
    return { enabled: false, selectedKeyId: null };
  }
  try {
    const enabled = window.localStorage.getItem(LIVE_EXEC_ENABLED_KEY) === 'true';
    const selectedKeyId = window.localStorage.getItem(LIVE_EXEC_KEY_ID_KEY) || null;
    return { enabled, selectedKeyId };
  } catch {
    return { enabled: false, selectedKeyId: null };
  }
}

export function saveLiveExecutionPrefs(prefs: LiveExecutionPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LIVE_EXEC_ENABLED_KEY, prefs.enabled ? 'true' : 'false');
    if (prefs.selectedKeyId) {
      window.localStorage.setItem(LIVE_EXEC_KEY_ID_KEY, prefs.selectedKeyId);
    } else {
      window.localStorage.removeItem(LIVE_EXEC_KEY_ID_KEY);
    }
  } catch {
    // ignore storage quota errors
  }
}

export interface LiveExecutionVerification {
  liveExecutionEnabled: boolean;
  verifiedLive: boolean;
  selectedKey: ExchangeKeyRecord | null;
  availableTradeKeys: ExchangeKeyRecord[];
  statusLabel: 'Verified Live' | 'Требуется Trade API' | 'Ошибка авторизации API' | 'Paper Mode';
  detailRu: string;
}

/**
 * Проверяет подключение выбранного API-ключа биржи для режима Live Execution
 * и возвращает статус верификации (`Verified Live`).
 */
export function verifyLiveExchangeConnection(params: {
  liveExecutionEnabled: boolean;
  selectedExchangeKeyId: string | null;
  exchangeKeys: ExchangeKeyRecord[];
  errorLogs?: ExchangeSyncErrorLogEntry[];
}): LiveExecutionVerification {
  const availableTradeKeys = params.exchangeKeys.filter(
    (k) => k.enabled && k.permissions === 'trade'
  );
  const selectedKey =
    (params.selectedExchangeKeyId
      ? availableTradeKeys.find((k) => k.id === params.selectedExchangeKeyId)
      : null) ??
    availableTradeKeys[0] ??
    null;

  if (!params.liveExecutionEnabled) {
    return {
      liveExecutionEnabled: false,
      verifiedLive: false,
      selectedKey,
      availableTradeKeys,
      statusLabel: 'Paper Mode',
      detailRu: selectedKey
        ? `Переключите Live Execution, чтобы активировать реальное исполнение через ${selectedKey.exchange.toUpperCase()} (${selectedKey.label}).`
        : 'Активен режим Paper Trading (симуляция внутри терминала без отправки ордеров на биржу).',
    };
  }

  if (!selectedKey) {
    const hasReadOnly = params.exchangeKeys.some((k) => k.enabled);
    return {
      liveExecutionEnabled: true,
      verifiedLive: false,
      selectedKey: null,
      availableTradeKeys,
      statusLabel: 'Требуется Trade API',
      detailRu: hasReadOnly
        ? 'Подключён Read-Only ключ. Для Verified Live добавьте API-ключ с правом «Торговля».'
        : 'Подключите активный API-ключ Binance / Bybit / OKX с правами торговли в «Защита → Биржи API».',
    };
  }

  const latestSyncMs = selectedKey.lastSyncedAt ? Date.parse(selectedKey.lastSyncedAt) : 0;
  const latestKeyLog = (params.errorLogs ?? []).find((entry) => entry.keyId === selectedKey.id);
  const hasAuthLogError = Boolean(
    latestKeyLog &&
      latestKeyLog.severity !== 'success' &&
      (latestKeyLog.category === 'auth' || latestKeyLog.severity === 'critical') &&
      (!Number.isFinite(latestSyncMs) || latestKeyLog.occurredAtMs >= latestSyncMs)
  );
  const inlineAuthErr = selectedKey.lastSyncError
    ? classifyExchangeSyncError(selectedKey.lastSyncError) === 'auth'
    : false;

  if (inlineAuthErr || hasAuthLogError) {
    return {
      liveExecutionEnabled: true,
      verifiedLive: false,
      selectedKey,
      availableTradeKeys,
      statusLabel: 'Ошибка авторизации API',
      detailRu:
        latestKeyLog?.errorMessage ||
        selectedKey.lastSyncError ||
        'Ключ отклонён биржей — обновите API-ключ для возобновления Live Execution.',
    };
  }

  return {
    liveExecutionEnabled: true,
    verifiedLive: true,
    selectedKey,
    availableTradeKeys,
    statusLabel: 'Verified Live',
    detailRu: `Подключён ${selectedKey.exchange.toUpperCase()} · ${selectedKey.label}${selectedKey.testnet ? ' (Testnet)' : ' (Mainnet)'}. Новые сигналы активных стратегий передаются на исполнение с подтверждением.`,
  };
}

/* -------------------------------------------------------------------------- */
/* Chart Signal Markers (Historical + Incoming + Active)                      */
/* -------------------------------------------------------------------------- */

export interface ChartSignalMarker {
  id: string;
  source: 'active' | 'incoming' | 'historical';
  strategyKey: string;
  strategyName: string;
  symbol: string;
  marketType: MarketType;
  direction: 'LONG' | 'SHORT';
  confidence: number;
  emittedAt: string;
  entryPrice: number;
  stopLossPrice: number;
  tp1Price: number;
  takeProfitPrice: number;
  riskRewardRatio: number;
  mode: StrategyOperatingMode;
  engineState: StrategyEngineState;
  isLiveOrder?: boolean;
  isProjected?: boolean;
}

function parseNumericPrice(text?: string | null): number | null {
  if (!text) return null;
  const cleaned = text.replace(/,/g, '');
  const match = cleaned.match(/\d+(\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Собирает единый список маркеров сигналов для графика цены в `MarketTerminalView`:
 * - Активный выбранный сигнал (`activeOverlay`);
 * - Входящие живые сигналы из `strategyEventStream` (последние 2 часа -> `incoming`, старше -> `historical`);
 * - Исторические сигналы из сохранённой истории `analyses` по выбранной паре.
 */
export function buildChartSignalMarkers(params: {
  symbol: string;
  marketType: MarketType;
  activeOverlay?: ActiveStrategySignalOverlay | null;
  streamEvents: StrategySignalEvent[];
  analyses: AnalysisRecord[];
}): ChartSignalMarker[] {
  const markers: ChartSignalMarker[] = [];
  const seen = new Set<string>();
  const nowMs = Date.now();

  if (
    params.activeOverlay &&
    params.activeOverlay.symbol === params.symbol &&
    params.activeOverlay.marketType === params.marketType
  ) {
    const ov = params.activeOverlay;
    const key = `active-${ov.strategyKey}-${ov.direction}-${ov.entryPrice.toFixed(4)}`;
    seen.add(key);
    markers.push({
      id: key,
      source: 'active',
      strategyKey: ov.strategyKey,
      strategyName: ov.strategyName,
      symbol: ov.symbol,
      marketType: ov.marketType,
      direction: ov.direction,
      confidence: ov.confidence,
      emittedAt: ov.emittedAt,
      entryPrice: ov.entryPrice,
      stopLossPrice: ov.stopLossPrice,
      tp1Price: ov.tp1Price,
      takeProfitPrice: ov.takeProfitPrice,
      riskRewardRatio: ov.riskRewardRatio,
      mode: ov.mode,
      engineState: ov.engineState,
      isProjected: ov.isProjected,
    });
  }

  for (const ev of params.streamEvents) {
    if (ev.symbol !== params.symbol || ev.marketType !== params.marketType) continue;
    const dedupe = `${ev.strategyKey}-${ev.direction}-${ev.entryPrice.toFixed(4)}`;
    if (seen.has(dedupe) || seen.has(`active-${dedupe}`)) continue;
    seen.add(dedupe);
    const emittedMs = Date.parse(ev.emittedAt);
    const isFresh = Number.isFinite(emittedMs) && nowMs - emittedMs <= 2 * 60 * 60 * 1000;
    markers.push({
      id: ev.id,
      source: isFresh ? 'incoming' : 'historical',
      strategyKey: ev.strategyKey,
      strategyName: ev.strategyName,
      symbol: ev.symbol,
      marketType: ev.marketType,
      direction: ev.direction,
      confidence: ev.confidence,
      emittedAt: ev.emittedAt,
      entryPrice: ev.entryPrice,
      stopLossPrice: ev.stopLossPrice,
      tp1Price: ev.tp1Price,
      takeProfitPrice: ev.takeProfitPrice,
      riskRewardRatio: ev.riskRewardRatio,
      mode: ev.mode,
      engineState: ev.engineState,
      isLiveOrder: Boolean(ev.orderId),
    });
  }

  for (const rec of params.analyses) {
    if (rec.symbol !== params.symbol || rec.marketType !== params.marketType) continue;
    if (rec.direction !== 'LONG' && rec.direction !== 'SHORT') continue;
    const entry = parseNumericPrice(rec.entryZone);
    const sl = parseNumericPrice(rec.stopLoss);
    const tp = parseNumericPrice(rec.takeProfits?.[0]);
    if (!entry || !sl || !tp) continue;
    const dedupe = `hist-${rec.strategyKey}-${rec.direction}-${entry.toFixed(4)}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const tp1 = entry + (tp - entry) * 0.5;
    const risk = Math.abs(entry - sl);
    const rr = risk > 1e-9 ? Number((Math.abs(tp - entry) / risk).toFixed(2)) : 2.0;
    const rawCreated = rec.createdAt as unknown;
    let emittedIso: string;
    if (typeof rawCreated === 'string' && rawCreated.trim()) {
      emittedIso = rawCreated;
    } else if (rawCreated instanceof Date && !Number.isNaN(rawCreated.getTime())) {
      emittedIso = rawCreated.toISOString();
    } else if (typeof rawCreated === 'number' && Number.isFinite(rawCreated)) {
      emittedIso = new Date(rawCreated).toISOString();
    } else if (
      rawCreated &&
      typeof rawCreated === 'object' &&
      'toDate' in rawCreated &&
      typeof (rawCreated as { toDate?: unknown }).toDate === 'function'
    ) {
      emittedIso = (rawCreated as { toDate: () => Date }).toDate().toISOString();
    } else if (
      rawCreated &&
      typeof rawCreated === 'object' &&
      'seconds' in rawCreated &&
      typeof (rawCreated as { seconds?: unknown }).seconds === 'number'
    ) {
      emittedIso = new Date((rawCreated as { seconds: number }).seconds * 1000).toISOString();
    } else {
      emittedIso = new Date().toISOString();
    }
    markers.push({
      id: `hist-${rec.id}`,
      source: 'historical',
      strategyKey: rec.strategyKey,
      strategyName: rec.strategyName,
      symbol: rec.symbol,
      marketType: rec.marketType,
      direction: rec.direction,
      confidence: rec.confidence,
      emittedAt: emittedIso,
      entryPrice: entry,
      stopLossPrice: sl,
      tp1Price: tp1,
      takeProfitPrice: tp,
      riskRewardRatio: rr,
      mode: 'paper',
      engineState: 'Execution',
    });
  }

  return markers
    .sort((a, b) => {
      if (a.source === 'active' && b.source !== 'active') return -1;
      if (b.source === 'active' && a.source !== 'active') return 1;
      return (Date.parse(b.emittedAt) || 0) - (Date.parse(a.emittedAt) || 0);
    })
    .slice(0, 12);
}

export function chartMarkerToSignalOverlay(marker: ChartSignalMarker): ActiveStrategySignalOverlay {
  return {
    strategyKey: marker.strategyKey,
    strategyName: marker.strategyName,
    symbol: marker.symbol,
    marketType: marker.marketType,
    direction: marker.direction,
    confidence: marker.confidence,
    entryPrice: marker.entryPrice,
    stopLossPrice: marker.stopLossPrice,
    tp1Price: marker.tp1Price,
    takeProfitPrice: marker.takeProfitPrice,
    riskRewardRatio: marker.riskRewardRatio,
    engineState: marker.engineState,
    mode: marker.mode,
    emittedAt: marker.emittedAt,
    isProjected: marker.isProjected,
  };
}
