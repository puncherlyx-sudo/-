export type MarketType = 'spot' | 'futures';
export type PlanTier = 'free' | 'pro';
export type Timeframe = '15m' | '1h' | '4h' | '1d';
export type AppTab = 'market' | 'screener' | 'strategies' | 'news' | 'security';
export type RibbonType = 'EMA' | 'SMA';
export type RibbonPeriods = [number, number, number, number];
export type AndroidWidgetKind = 'chart' | 'price' | 'position' | 'pnl' | 'strategies';

export interface WidgetFeedPayload {
  updatedAt: string;
  symbol: string;
  marketType: MarketType;
  interval: string;
  price: {
    symbol: string;
    baseAsset: string;
    price: number;
    formatted: string;
    change24hPct: number;
    high24h: number;
    low24h: number;
    volume24hUsdt: number;
    source: 'live' | 'cached';
  };
  chart: {
    symbol: string;
    interval: string;
    trendBias: 'BULLISH' | 'BEARISH' | 'RANGE';
    rsi14: number;
    ema20: number;
    ema50: number;
    support: number;
    resistance: number;
    sparkline: number[];
    candles: Array<{
      time: number;
      open: number;
      high: number;
      low: number;
      close: number;
    }>;
  };
  position: {
    symbol: string;
    entryPrice: number;
    stopPrice: number;
    takeProfitPrice: number;
    depositUsdt: number;
    riskPct: number;
    stopPct: number;
    riskUsdt: number;
    lotQty: number;
    notionalUsdt: number;
    rrRatio: string;
  };
  pnl: {
    btcChange24hPct: number;
    marketSentimentValue: number;
    marketSentimentLabel: string;
    topGainer: { symbol: string; change24hPct: number } | null;
    topLoser: { symbol: string; change24hPct: number } | null;
  };
  strategies: {
    recommendedBias: string;
    volatilityPct: number;
    fearGreedValue: number;
    fearGreedLabel: string;
  };
}

export interface OrderBookLevel {
  price: number;
  size: number;
  totalSize: number;
  notionalUsdt: number;
  depthPct: number;
}

export interface OrderBookSnapshot {
  symbol: string;
  marketType: MarketType;
  source: 'live' | 'cached';
  bestBid: number;
  bestAsk: number;
  spreadUsdt: number;
  spreadPct: number;
  bidDominancePct: number;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  updatedAt: string;
}

export interface PortfolioHolding {
  id: string;
  symbol: string;
  amount: number;
  avgEntryPrice: number;
}

export interface FearAndGreedHistoryPoint {
  dateLabel: string;
  value: number;
  classificationRu: string;
  timestamp: number;
}

export interface FearAndGreedSnapshot {
  value: number;
  classification: string;
  classificationRu: string;
  yesterdayValue: number;
  weekAgoValue: number;
  monthAgoValue: number;
  nextUpdateSeconds: number;
  source: 'live' | 'derived';
  history: FearAndGreedHistoryPoint[];
  updatedAt: string;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface CandlePoint {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ema20?: number;
  ema50?: number;
  bbUpper?: number;
  bbMiddle?: number;
  bbLower?: number;
  rsi14?: number;
}

export interface TickerOverview {
  symbol: string;
  baseAsset: string;
  price: number;
  change24hPct: number;
  high24h: number;
  low24h: number;
  volume24hUsdt: number;
  fundingRatePct?: number;
  openInterestUsdt?: number;
  source: 'live' | 'cached';
}

export interface IndicatorSnapshot {
  lastPrice: number;
  ema20: number;
  ema50: number;
  ema200: number;
  rsi14: number;
  macdLine: number;
  macdSignal: number;
  macdHistogram: number;
  atr14: number;
  bbUpper: number;
  bbLower: number;
  supportLevel: number;
  resistanceLevel: number;
  trendBias: 'BULLISH' | 'BEARISH' | 'RANGE';
  volatilityPct: number;
}

export interface StrategyTemplate {
  key: string;
  marketType: MarketType;
  name: string;
  shortTag: string;
  timeframeDefault: Timeframe;
  riskProfile: 'Консервативная' | 'Сбалансированная' | 'Агрессивная';
  description: string;
  rulesSummary: string;
  indicatorsUsed: string[];
  defaultLeverage: number;
  defaultRiskPct: number;
}

export interface StrategyConfig {
  id: string;
  userId: string;
  marketType: MarketType;
  strategyKey: string;
  name: string;
  enabled: boolean;
  dailySignalLimit: number;
  minConfidence: number;
  riskPerTradePct: number;
  leverage: number;
  pairs: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AnalysisResultPayload {
  direction: 'LONG' | 'SHORT' | 'WAIT';
  confidence: number;
  entryZone: string;
  stopLoss: string;
  takeProfits: [string, string, string];
  riskReward: string;
  newsSentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  newsSourcesCount: number;
  keyCatalysts: string[];
  invalidationRule: string;
  summary: string;
  riskMetrics: {
    riskAmountUsdt: number;
    positionSizeUsdt: number;
    recommendedLeverage: number;
    estimatedLiquidationPrice: string | null;
  };
}

export interface AnalysisRecord {
  id: string;
  userId: string;
  symbol: string;
  marketType: MarketType;
  timeframe: string;
  strategyKey: string;
  strategyName: string;
  direction: 'LONG' | 'SHORT' | 'WAIT';
  confidence: number;
  entryZone: string;
  stopLoss: string;
  takeProfits: string[];
  riskReward: string;
  summary: string;
  newsSentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  newsSourcesCount: number;
  createdAt?: { seconds?: number } | unknown;
}

export interface GroundedNewsItem {
  id: string;
  title: string;
  summary: string;
  asset: string;
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  publishedLabel: string;
  sourceTitle: string;
  sourceUrl: string;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  plan: PlanTier;
  creditsRemaining: number;
  weeklyQuota: number;
  nextResetAt: string;
  twoFactorEnabled: boolean;
  autoLockMinutes: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface UserPrivateSecurity {
  uid: string;
  email: string;
  totpEncryptedSecret: string;
  totpPendingSecret: string;
  backupCodeHashes: string[];
  last2faVerifiedAt: string;
  updatedAt?: unknown;
}

export interface SecurityAuditLog {
  id: string;
  userId: string;
  eventType: string;
  description: string;
  deviceLabel: string;
  status: 'SUCCESS' | 'BLOCKED' | 'WARNING';
  createdAt?: { seconds?: number } | unknown;
}

export interface PushSubscriptionRecord {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  notifySignals: boolean;
  notifyMarketMoves: boolean;
  notifyNews: boolean;
  notifyAuthLogins: boolean;
  notifyStrategyChanges: boolean;
  notifySignalLimits: boolean;
  enabled: boolean;
  deviceLabel: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type SessionDeviceType = 'mobile' | 'desktop' | 'pwa';

export interface UserSessionRecord {
  id: string;
  userId: string;
  deviceLabel: string;
  deviceType: SessionDeviceType;
  browserLabel: string;
  status: 'active' | 'revoked';
  ipAddress?: string;
  city?: string;
  country?: string;
  countryCode?: string;
  latitude?: number;
  longitude?: number;
  isSuspicious?: boolean;
  lastLoginAt?: { seconds?: number } | unknown;
  lastActiveAt?: { seconds?: number } | unknown;
  createdAt?: { seconds?: number } | unknown;
  updatedAt?: { seconds?: number } | unknown;
}

export type PriceAlertCondition = 'above' | 'below';

export interface PriceAlertRecord {
  id: string;
  userId: string;
  symbol: string;
  marketType: MarketType;
  condition: PriceAlertCondition;
  targetPrice: number;
  active: boolean;
  triggeredAt: string;
  triggeredPrice: number;
  createdAt?: { seconds?: number } | unknown;
  updatedAt?: { seconds?: number } | unknown;
}

export interface StrategyBreakdownResult {
  strategyKey: string;
  name: string;
  shortTag: string;
  marketType: MarketType;
  enabled: boolean;
  totalPnlPct: number;
  totalPnlUsdt: number;
  winRatePct: number;
  tradesCount: number;
  profitFactor: number;
  maxDrawdownPct: number;
  avgRiskReward: string;
}

export interface EquityCurvePoint {
  label: string;
  timestamp: number;
  portfolioPnlPct: number;
  portfolioPnlUsdt: number;
  spotPnlPct: number;
  futuresPnlPct: number;
  drawdownPct: number;
}

export interface StrategyPerformanceReport {
  interval: '1h' | '4h';
  depositUsdt: number;
  scope: 'active' | 'all';
  dataSource: 'live' | 'cached';
  summary: {
    totalPnlPct: number;
    totalPnlUsdt: number;
    winRatePct: number;
    profitFactor: number;
    maxDrawdownPct: number;
    totalTrades: number;
    activeStrategiesCount: number;
  };
  equityCurve: EquityCurvePoint[];
  breakdown: StrategyBreakdownResult[];
}

export interface EconomicCalendarEvent {
  id: string;
  dateLabel: string;
  timeUtcLabel: string;
  regionOrAsset: string;
  category: 'macro' | 'crypto' | 'derivatives';
  title: string;
  description: string;
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  forecast: string;
  previous: string;
  actual: string;
  marketBias: 'VOLATILITY' | 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  sourceUrl?: string;
}
