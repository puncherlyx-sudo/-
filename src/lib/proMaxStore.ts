import { addLocalTrade } from './localDemoStore';

export const VERNIER_PRO_MAX_EVENT = 'vernier:promax-store-updated';

function emitStoreUpdate() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(VERNIER_PRO_MAX_EVENT));
  }
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    emitStoreUpdate();
  } catch {
    // Ignore storage quota errors
  }
}

// ============================================================================
// 1. SMART INDICATOR ALERTS (PRO #1)
// ============================================================================
export type SmartAlertConditionType =
  | 'rsi_above_70'
  | 'rsi_below_30'
  | 'ema_50_200_cross'
  | 'volume_2x'
  | 'bollinger_squeeze'
  | 'funding_extreme';

export interface SmartAlertRule {
  id: string;
  symbol: string;
  timeframe: '15m' | '1h' | '4h';
  conditionType: SmartAlertConditionType;
  thresholdLabel: string;
  active: boolean;
  createdAt: string;
  lastTriggeredAt?: string;
}

export interface SmartAlertHistoryEntry {
  id: string;
  symbol: string;
  title: string;
  price: number;
  triggeredAt: string;
  kind: 'price' | 'indicator';
}

const KEY_SMART_ALERTS = 'vernier_smart_alerts_v1';
const KEY_SMART_HISTORY = 'vernier_smart_alert_history_v1';

export const SMART_CONDITION_META: Record<
  SmartAlertConditionType,
  { label: string; shortLabel: string; defaultThreshold: string }
> = {
  rsi_above_70: { label: 'RSI(14) > 70 (Перекупленность)', shortLabel: 'RSI > 70', defaultThreshold: 'RSI > 70' },
  rsi_below_30: { label: 'RSI(14) < 30 (Перепроданность)', shortLabel: 'RSI < 30', defaultThreshold: 'RSI < 30' },
  ema_50_200_cross: { label: 'Пересечение EMA50 / EMA200', shortLabel: 'EMA 50/200', defaultThreshold: 'Golden / Death Cross' },
  volume_2x: { label: 'Всплеск объёма > 2× от среднего', shortLabel: 'Объём > 2x', defaultThreshold: 'Vol > 2.0x SMA20' },
  bollinger_squeeze: { label: 'Bollinger Squeeze (сжатие полос)', shortLabel: 'BB Squeeze', defaultThreshold: 'Ширина < 2.2%' },
  funding_extreme: { label: 'Funding Rate аномалия (> ±0.03%)', shortLabel: 'Funding', defaultThreshold: '|FR| ≥ 0.03%' },
};

export function readSmartAlerts(): SmartAlertRule[] {
  return readJson<SmartAlertRule[]>(KEY_SMART_ALERTS, [
    {
      id: 'smart-seed-1',
      symbol: 'BTCUSDT',
      timeframe: '1h',
      conditionType: 'rsi_below_30',
      thresholdLabel: 'RSI < 30',
      active: true,
      createdAt: new Date(Date.now() - 86_400_000).toISOString(),
    },
    {
      id: 'smart-seed-2',
      symbol: 'ETHUSDT',
      timeframe: '4h',
      conditionType: 'bollinger_squeeze',
      thresholdLabel: 'Ширина < 2.2%',
      active: true,
      createdAt: new Date(Date.now() - 43_200_000).toISOString(),
    },
  ]);
}

export function writeSmartAlerts(rules: SmartAlertRule[]): void {
  writeJson(KEY_SMART_ALERTS, rules);
}

export function readSmartAlertHistory(): SmartAlertHistoryEntry[] {
  return readJson<SmartAlertHistoryEntry[]>(KEY_SMART_HISTORY, [
    {
      id: 'hist-1',
      symbol: 'BTCUSDT',
      title: 'Bollinger Squeeze (1H) — пробой диапазона',
      price: 94120,
      triggeredAt: new Date(Date.now() - 5 * 3600_000).toISOString(),
      kind: 'indicator',
    },
    {
      id: 'hist-2',
      symbol: 'SOLUSDT',
      title: 'Объём > 2.1× от среднего (15m)',
      price: 186.4,
      triggeredAt: new Date(Date.now() - 14 * 3600_000).toISOString(),
      kind: 'indicator',
    },
    {
      id: 'hist-3',
      symbol: 'ETHUSDT',
      title: 'Ценовой уровень ≥ $3,350',
      price: 3352.1,
      triggeredAt: new Date(Date.now() - 29 * 3600_000).toISOString(),
      kind: 'price',
    },
  ]);
}

export function appendSmartAlertHistory(entry: Omit<SmartAlertHistoryEntry, 'id'>): void {
  const list = readSmartAlertHistory();
  writeJson(KEY_SMART_HISTORY, [{ ...entry, id: `sh-${Date.now()}` }, ...list].slice(0, 40));
}

// ============================================================================
// 2. CUSTOM WATCHLISTS (PRO #10 — up to 5 lists)
// ============================================================================
export interface CustomWatchlist {
  id: string;
  name: string;
  symbols: string[];
}

const KEY_WATCHLISTS = 'vernier_custom_watchlists_v1';

export const DEFAULT_WATCHLISTS: CustomWatchlist[] = [
  { id: 'wl-scalp', name: 'Скальпинг', symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'PEPEUSDT', 'SUIUSDT'] },
  { id: 'wl-invest', name: 'Инвест', symbols: ['BTCUSDT', 'ETHUSDT', 'LINKUSDT', 'AVAXUSDT', 'AAVEUSDT'] },
  { id: 'wl-altseason', name: 'Альтсезон', symbols: ['SOLUSDT', 'INJUSDT', 'FETUSDT', 'RENDERUSDT', 'ARBUSDT', 'ONDOUSDT'] },
];

export function readCustomWatchlists(): CustomWatchlist[] {
  const data = readJson<CustomWatchlist[]>(KEY_WATCHLISTS, DEFAULT_WATCHLISTS);
  return Array.isArray(data) && data.length > 0 ? data.slice(0, 5) : DEFAULT_WATCHLISTS;
}

export function writeCustomWatchlists(lists: CustomWatchlist[]): void {
  writeJson(KEY_WATCHLISTS, lists.slice(0, 5));
}

// ============================================================================
// 3. PAPER TRADING ENGINE (MAX #5)
// ============================================================================
export interface PaperPosition {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  orderType: 'MARKET' | 'LIMIT';
  entryPrice: number;
  marginUsdt: number;
  notionalUsdt: number;
  leverage: number;
  stopLoss?: number;
  takeProfit?: number;
  openedAt: string;
}

export interface PaperAccountState {
  balanceUsdt: number;
  initialBalanceUsdt: number;
  realizedPnlUsdt: number;
  positions: PaperPosition[];
}

const KEY_PAPER_ACCOUNT = 'vernier_paper_trading_v1';
export const DEFAULT_PAPER_BALANCE = 10_000;

export function readPaperAccount(): PaperAccountState {
  return readJson<PaperAccountState>(KEY_PAPER_ACCOUNT, {
    balanceUsdt: DEFAULT_PAPER_BALANCE,
    initialBalanceUsdt: DEFAULT_PAPER_BALANCE,
    realizedPnlUsdt: 0,
    positions: [],
  });
}

export function writePaperAccount(state: PaperAccountState): void {
  writeJson(KEY_PAPER_ACCOUNT, state);
}

export function resetPaperAccount(): PaperAccountState {
  const fresh: PaperAccountState = {
    balanceUsdt: DEFAULT_PAPER_BALANCE,
    initialBalanceUsdt: DEFAULT_PAPER_BALANCE,
    realizedPnlUsdt: 0,
    positions: [],
  };
  writePaperAccount(fresh);
  return fresh;
}

export function closePaperPositionToJournal(
  position: PaperPosition,
  exitPrice: number,
  note = 'Закрыто из Paper Trading MAX'
): { nextState: PaperAccountState; pnlUsdt: number; roePct: number } {
  const state = readPaperAccount();
  const priceMovePct =
    position.side === 'LONG'
      ? (exitPrice - position.entryPrice) / position.entryPrice
      : (position.entryPrice - exitPrice) / position.entryPrice;
  const pnlUsdt = Number((position.notionalUsdt * priceMovePct).toFixed(2));
  const roePct = Number((priceMovePct * position.leverage * 100).toFixed(2));

  const nextState: PaperAccountState = {
    ...state,
    balanceUsdt: Number(Math.max(0, state.balanceUsdt + position.marginUsdt + pnlUsdt).toFixed(2)),
    realizedPnlUsdt: Number((state.realizedPnlUsdt + pnlUsdt).toFixed(2)),
    positions: state.positions.filter((p) => p.id !== position.id),
  };
  writePaperAccount(nextState);

  // Автосохранение в Дневник сделок
  addLocalTrade({
    symbol: position.symbol,
    marketType: position.leverage > 1 ? 'futures' : 'spot',
    direction: position.side,
    status: 'CLOSED',
    entryPrice: position.entryPrice,
    stopLoss: position.stopLoss,
    takeProfit: position.takeProfit,
    exitPrice,
    positionSizeUsdt: position.notionalUsdt,
    leverage: position.leverage,
    pnlUsdt,
    pnlPct: roePct,
    strategyName: `Paper Trading (${position.orderType})`,
    note,
    closedAt: new Date().toISOString(),
  });

  // Проверяем Tilt-Guard при убытке
  if (pnlUsdt < 0) {
    evaluateTiltGuardAfterLoss(pnlUsdt, state.initialBalanceUsdt);
  }

  return { nextState, pnlUsdt, roePct };
}

// ============================================================================
// 4. TILT-GUARD / ANTI-FOMO (MAX #6)
// ============================================================================
export interface TiltGuardConfig {
  enabled: boolean;
  dailyLossMode: 'pct' | 'usdt';
  dailyLossLimit: number;
  maxLossStreak: 2 | 3 | 4 | 5;
  cooldownMinutes: 15 | 30 | 60;
  cooldownUntilMs: number | null;
  todayLossUsdt: number;
  todayDateKey: string;
  currentLossStreak: number;
  totalTriggers: number;
  checklistsCompleted: number;
}

const KEY_TILT_GUARD = 'vernier_tilt_guard_v1';

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function readTiltGuardConfig(): TiltGuardConfig {
  const cfg = readJson<TiltGuardConfig>(KEY_TILT_GUARD, {
    enabled: true,
    dailyLossMode: 'pct',
    dailyLossLimit: 3,
    maxLossStreak: 3,
    cooldownMinutes: 30,
    cooldownUntilMs: null,
    todayLossUsdt: 0,
    todayDateKey: todayKey(),
    currentLossStreak: 0,
    totalTriggers: 0,
    checklistsCompleted: 4,
  });
  if (cfg.todayDateKey !== todayKey()) {
    return {
      ...cfg,
      todayDateKey: todayKey(),
      todayLossUsdt: 0,
      currentLossStreak: 0,
    };
  }
  return cfg;
}

export function writeTiltGuardConfig(cfg: TiltGuardConfig): void {
  writeJson(KEY_TILT_GUARD, cfg);
}

export function evaluateTiltGuardAfterLoss(lossUsdt: number, baseEquity = 10_000): TiltGuardConfig {
  const cfg = readTiltGuardConfig();
  if (!cfg.enabled || lossUsdt >= 0) return cfg;

  const absLoss = Math.abs(lossUsdt);
  const nextDailyLoss = Number((cfg.todayLossUsdt + absLoss).toFixed(2));
  const nextStreak = cfg.currentLossStreak + 1;
  const limitUsdt =
    cfg.dailyLossMode === 'pct' ? (baseEquity * cfg.dailyLossLimit) / 100 : cfg.dailyLossLimit;

  const shouldTrigger = nextStreak >= cfg.maxLossStreak || nextDailyLoss >= limitUsdt;
  const next: TiltGuardConfig = {
    ...cfg,
    todayLossUsdt: nextDailyLoss,
    currentLossStreak: nextStreak,
    cooldownUntilMs: shouldTrigger ? Date.now() + cfg.cooldownMinutes * 60_000 : cfg.cooldownUntilMs,
    totalTriggers: shouldTrigger ? cfg.totalTriggers + 1 : cfg.totalTriggers,
  };
  writeTiltGuardConfig(next);
  return next;
}

export function triggerManualCooldown(): TiltGuardConfig {
  const cfg = readTiltGuardConfig();
  const next: TiltGuardConfig = {
    ...cfg,
    cooldownUntilMs: Date.now() + cfg.cooldownMinutes * 60_000,
    totalTriggers: cfg.totalTriggers + 1,
  };
  writeTiltGuardConfig(next);
  return next;
}

export function clearCooldownWithChecklist(): TiltGuardConfig {
  const cfg = readTiltGuardConfig();
  const next: TiltGuardConfig = {
    ...cfg,
    cooldownUntilMs: null,
    currentLossStreak: 0,
    checklistsCompleted: cfg.checklistsCompleted + 1,
  };
  writeTiltGuardConfig(next);
  return next;
}

export function computeDisciplineIndex(cfg: TiltGuardConfig, closedTradesCount: number, badStreaks: number): number {
  let score = 84;
  if (cfg.enabled) score += 8;
  score += Math.min(12, cfg.checklistsCompleted * 2);
  score -= Math.min(28, cfg.totalTriggers * 7);
  score -= Math.min(20, badStreaks * 8);
  if (closedTradesCount >= 3) score += 4;
  return Math.max(12, Math.min(100, Math.round(score)));
}

// ============================================================================
// 5. NO-CODE CUSTOM STRATEGIES (MAX #8)
// ============================================================================
export type NoCodeIndicator = 'RSI' | 'EMA' | 'VOLUME' | 'FUNDING' | 'OI';
export type NoCodeOperator = '<' | '>' | 'cross_up' | 'cross_down';

export interface NoCodeRule {
  id: string;
  indicator: NoCodeIndicator;
  operator: NoCodeOperator;
  value: number;
}

export interface CustomNoCodeStrategy {
  id: string;
  name: string;
  marketType: 'spot' | 'futures';
  logic: 'AND' | 'OR';
  rules: NoCodeRule[];
  backtestWinRatePct: number;
  backtestRoiPct: number;
  backtestProfitFactor: number;
  createdAt: string;
}

const KEY_NOCODE_STRATEGIES = 'vernier_nocode_strategies_v1';

export function readCustomNoCodeStrategies(): CustomNoCodeStrategy[] {
  return readJson<CustomNoCodeStrategy[]>(KEY_NOCODE_STRATEGIES, []);
}

export function saveCustomNoCodeStrategy(strategy: CustomNoCodeStrategy): CustomNoCodeStrategy[] {
  const list = readCustomNoCodeStrategies();
  const next = [strategy, ...list.filter((s) => s.id !== strategy.id)].slice(0, 12);
  writeJson(KEY_NOCODE_STRATEGIES, next);
  return next;
}

export function deleteCustomNoCodeStrategy(id: string): CustomNoCodeStrategy[] {
  const next = readCustomNoCodeStrategies().filter((s) => s.id !== id);
  writeJson(KEY_NOCODE_STRATEGIES, next);
  return next;
}

// ============================================================================
// 6. WEBHOOK / TELEGRAM SIGNAL CONFIG (MAX #12)
// ============================================================================
export interface WebhookTemplateConfig {
  channel: 'telegram' | 'webhook';
  endpointUrl: string;
  telegramChatId: string;
  payloadTemplate: string;
  updatedAt: string;
}

const KEY_WEBHOOK_CONFIG = 'vernier_webhook_template_v1';

export const DEFAULT_WEBHOOK_PAYLOAD = JSON.stringify(
  {
    source: 'VERNIER_MAX',
    ticker: '{{ticker}}',
    side: '{{side}}',
    entry: '{{price}}',
    stop_loss: '{{sl}}',
    take_profit: '{{tp}}',
  },
  null,
  2
);

export function readWebhookConfig(): WebhookTemplateConfig {
  return readJson<WebhookTemplateConfig>(KEY_WEBHOOK_CONFIG, {
    channel: 'telegram',
    endpointUrl: 'https://api.example-bot.com/v1/signals',
    telegramChatId: '@vernier_signals_channel',
    payloadTemplate: DEFAULT_WEBHOOK_PAYLOAD,
    updatedAt: new Date().toISOString(),
  });
}

export function writeWebhookConfig(cfg: WebhookTemplateConfig): void {
  writeJson(KEY_WEBHOOK_CONFIG, { ...cfg, updatedAt: new Date().toISOString() });
}
