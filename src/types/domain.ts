export type MarketType = 'spot' | 'futures';
export type PlanTier = 'free' | 'pro' | 'max';
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
  marketCapUsdt?: number;
  fundingRatePct?: number;
  openInterestUsdt?: number;
  sparkline24h?: number[];
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
  tier: PlanTier;
  creditCost: number;
  marketCondition: string;
  expectedHorizon: string;
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
  /** Конец оплаченного периода PRO/MAX (мс). Выставляется только сервером. */
  proUntil?: number;
  /** Множитель токенов для тарифа MAX (10 = 1000 кр., 20 = 2000 кр.). Выставляется только сервером. */
  maxMultiplier?: 10 | 20;
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
  notifyVolatilitySpikes?: boolean;
  volatilityThresholdPct?: number;
  notifyPortfolioPnl?: boolean;
  portfolioPnlThresholdPct?: number;
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

export type SupportTicketCategory = 'alerts' | 'chart' | 'billing' | 'security' | 'other';

export interface SupportTicketRecord {
  id: string;
  userId: string;
  contactEmail: string;
  category: SupportTicketCategory;
  subject: string;
  message: string;
  status: 'open' | 'resolved';
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
  interval: '1h' | '4h' | '1d';
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

export interface LiveScannerOpportunity {
  symbol: string;
  marketType: MarketType;
  timeframe: '1h' | '4h';
  strategyKey: string;
  strategyName: string;
  strategyTier: PlanTier;
  direction: 'LONG' | 'SHORT';
  confidence: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  riskRewardRatio: number;
  rsi14: number;
  trendBias: 'BULLISH' | 'BEARISH' | 'RANGE';
  change24hPct: number;
}

export interface LiveScannerReport {
  tier: PlanTier;
  scannedPairsCount: number;
  totalPairsAvailable: number;
  timeframe: '1h' | '4h';
  opportunities: LiveScannerOpportunity[];
  updatedAt: string;
}

export interface SentimentComparisonRow {
  strategyKey: string;
  name: string;
  tier: PlanTier;
  winRatePct: number;
  totalPnlPct: number;
  profitFactor: number;
  tradesCount: number;
}

export interface AdvancedSentimentReport {
  locked: boolean;
  tier: PlanTier;
  asset: string;
  interval: '1h' | '4h' | '1d';
  compositeScore: number;
  forecastBias: 'BULLISH_EXPANSION' | 'ACCUMULATION_BIAS' | 'NEUTRAL_ROTATION' | 'RISK_OFF_HEDGING';
  forecastHeadline: string;
  forecastSummary: string;
  fearGreed: {
    value: number;
    classificationRu: string;
    yesterdayValue: number;
    weekAgoValue: number;
    monthAgoValue: number;
    delta7d: number;
  };
  marketBreadth: {
    advancingCount: number;
    decliningCount: number;
    totalPairs: number;
    advancingPct: number;
    avgChange24hPct: number;
    avgFundingRatePct: number;
  };
  newsBreakdown: {
    bullishCount: number;
    bearishCount: number;
    neutralCount: number;
    catalysts: GroundedNewsItem[];
  };
  comparison: {
    sentimentStrategy: SentimentComparisonRow | null;
    freeAverageWinRatePct: number;
    freeAveragePnlPct: number;
    winRateDeltaPp: number;
    pnlDeltaPct: number;
    freeStrategies: SentimentComparisonRow[];
  };
  updatedAt: string;
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

export interface TradeRecord {
  id: string;
  userId: string;
  symbol: string;
  marketType: MarketType;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  stopPrice: number;
  exitPrice: number;
  status: 'open' | 'closed';
  note: string;
  closedAt: string;
  createdAt?: { seconds?: number };
}

export interface TradeJournalEntry {
  id: string;
  uid: string;
  symbol: string;
  marketType: MarketType;
  direction: 'LONG' | 'SHORT';
  status: 'OPEN' | 'CLOSED';
  entryPrice: number;
  stopLoss?: number;
  takeProfit?: number;
  exitPrice?: number;
  positionSizeUsdt: number;
  leverage: number;
  pnlUsdt?: number;
  pnlPct?: number;
  strategyName?: string;
  note?: string;
  openedAt: string;
  closedAt?: string;
}

export type ExchangeId = 'binance' | 'bybit' | 'okx';
export type ExchangeKeyPermissions = 'read_only' | 'trade';

export interface ExchangeKeyRecord {
  id: string;
  userId: string;
  exchange: ExchangeId;
  label: string;
  apiKeyPreview: string;
  encryptedApiKey: string;
  encryptedApiSecret: string;
  encryptedPassphrase: string;
  permissions: ExchangeKeyPermissions;
  testnet: boolean;
  enabled: boolean;
  lastSyncedAt: string;
  lastBalanceUsdt: number;
  lastSyncError: string;
  createdAt?: { seconds?: number } | unknown;
  updatedAt?: { seconds?: number } | unknown;
}

export interface ExchangeAssetBalance {
  asset: string;
  symbol: string;
  free: number;
  locked: number;
  total: number;
  priceUsdt: number;
  valueUsdt: number;
}

export interface ExchangeSyncResult {
  exchange: ExchangeId;
  testnet: boolean;
  totalBalanceUsdt: number;
  assets: ExchangeAssetBalance[];
  syncedAt: string;
  accountType?: string;
}

export interface ExchangeOrderResult {
  exchange: ExchangeId;
  orderId: string;
  symbol: string;
  marketType: MarketType;
  side: 'BUY' | 'SELL';
  orderType: 'MARKET' | 'LIMIT';
  status: string;
  executedQty: number;
  price: number;
  testnet: boolean;
  submittedAt: string;
}

export interface PortfolioTargetRecord {
  id: string;
  userId: string;
  portfolioId: string;
  portfolioLabel: string;
  targetBalanceUsdt: number;
  baselineBalanceUsdt: number;
  targetPnlPct: number;
  active: boolean;
  triggeredAt: string;
  triggeredBalanceUsdt: number;
  createdAt?: { seconds?: number } | unknown;
  updatedAt?: { seconds?: number } | unknown;
}

