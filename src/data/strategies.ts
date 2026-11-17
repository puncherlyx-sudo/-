import type { AnalysisRecord, StrategyTemplate, UserProfile } from '../types/domain';

export const FREE_WEEKLY_QUOTA = 15;
export const PRO_MONTHLY_QUOTA = 100;
export const FREE_MAX_LEVERAGE = 5;
export const FREE_DAILY_SIGNAL_LIMIT = 1;
export const CREDIT_COSTS = {
  spotAnalysis: 1,
  futuresAnalysis: 2,
  portfolioBacktest: 1,
  setupScanner: 2,
  journalReview: 3,
} as const;

/** Сколько ценовых алертов может одновременно отслеживать сервер. */
export const FREE_MAX_ACTIVE_ALERTS = 3;
export const PRO_MAX_ACTIVE_ALERTS = 50;

/**
 * Что входит в тариф. Единый список для окна оплаты и подсказок в интерфейсе.
 * access: 'credits' — доступно всем за кредиты (у PRO кредитов больше), 'pro' — только с подпиской.
 */
export interface PlanFeature {
  key: string;
  title: string;
  description: string;
  access: 'credits' | 'pro' | 'both';
  /** Стоимость в кредитах (для access: 'credits'). */
  cost?: number;
  free: string;
  pro: string;
}

export const PLAN_FEATURES: PlanFeature[] = [
  {
    key: 'credits',
    title: 'Кредиты на AI-функции',
    description: 'Расходуются на анализ, сканер и разбор дневника.',
    access: 'both',
    free: `${FREE_WEEKLY_QUOTA} в неделю`,
    pro: `${PRO_MONTHLY_QUOTA} в месяц`,
  },
  {
    key: 'analysis',
    title: 'AI-анализ графика и новостей',
    description: 'Сигнал с зоной входа, стопом и целями по выбранной стратегии.',
    access: 'credits',
    cost: CREDIT_COSTS.spotAnalysis,
    free: `1 кр. (фьючерсы ${CREDIT_COSTS.futuresAnalysis} кр.), 1 сигнал в день на стратегию`,
    pro: 'Без дневных лимитов',
  },
  {
    key: 'scanner',
    title: 'Сканер сетапов',
    description: 'Ищет по всем парам самые согласованные входы на четырёх таймфреймах.',
    access: 'credits',
    cost: CREDIT_COSTS.setupScanner,
    free: `${CREDIT_COSTS.setupScanner} кр. за запуск`,
    pro: `${CREDIT_COSTS.setupScanner} кр., кредитов в разы больше`,
  },
  {
    key: 'journal_review',
    title: 'Глубокий разбор дневника',
    description: 'Где вы теряете деньги: направления, пары, стопы, серии убытков.',
    access: 'credits',
    cost: CREDIT_COSTS.journalReview,
    free: `${CREDIT_COSTS.journalReview} кр. за разбор`,
    pro: `${CREDIT_COSTS.journalReview} кр., кредитов в разы больше`,
  },
  {
    key: 'strategies',
    title: 'PRO-стратегии',
    description: 'Расширенные стратегии с фьючерсами и пробоями.',
    access: 'pro',
    free: 'Только базовые',
    pro: 'Все стратегии',
  },
  {
    key: 'leverage',
    title: 'Кредитное плечо в анализе',
    description: 'Расчёт сценариев с плечом.',
    access: 'pro',
    free: `До ${FREE_MAX_LEVERAGE}x`,
    pro: 'До 20x',
  },
  {
    key: 'orderbook_ribbon',
    title: 'Стакан TOP-10 и MA Ribbon',
    description: 'Глубина рынка и конструктор скользящих (EMA/SMA).',
    access: 'pro',
    free: 'Базовые',
    pro: 'Полный набор',
  },
  {
    key: 'backtest_4h',
    title: 'Бэктест 4H по всем стратегиям',
    description: 'Расширенная оценка доходности на старшем таймфрейме.',
    access: 'pro',
    free: 'Только 1H, активные',
    pro: '4H и все стратегии',
  },
  {
    key: 'alerts',
    title: 'Ценовые алерты',
    description: 'Push-уведомление при пересечении уровня, даже при закрытом приложении.',
    access: 'pro',
    free: `${FREE_MAX_ACTIVE_ALERTS} активных`,
    pro: `До ${PRO_MAX_ACTIVE_ALERTS} активных`,
  },
  {
    key: 'csv',
    title: 'Экспорт дневника в CSV',
    description: 'Выгрузка сделок для Excel и Google Таблиц.',
    access: 'pro',
    free: 'Недоступно',
    pro: 'Доступно',
  },
];

export function isProSubscriptionActive(
  profile?: Pick<UserProfile, 'plan' | 'proUntil'> | null,
  nowMs: number = Date.now()
): boolean {
  if (!profile || profile.plan !== 'pro') return false;
  return typeof profile.proUntil === 'number' && Number.isFinite(profile.proUntil) && profile.proUntil > nowMs;
}

export function isProSubscriptionExpired(
  profile?: Pick<UserProfile, 'plan' | 'proUntil'> | null,
  nowMs: number = Date.now()
): boolean {
  if (!profile || profile.plan !== 'pro') return false;
  return !isProSubscriptionActive(profile, nowMs);
}

export function formatProUntilDate(proUntil?: number): string {
  if (typeof proUntil !== 'number' || !Number.isFinite(proUntil) || proUntil <= 0) return '—';
  return new Date(proUntil).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function extractCreatedAtMs(createdAt: unknown): number {
  if (typeof createdAt === 'number' && Number.isFinite(createdAt)) return createdAt;
  if (createdAt instanceof Date) return createdAt.getTime();
  if (createdAt && typeof createdAt === 'object') {
    const rec = createdAt as { seconds?: number; toMillis?: () => number };
    if (typeof rec.toMillis === 'function') return rec.toMillis();
    if (typeof rec.seconds === 'number') return rec.seconds * 1000;
  }
  return 0;
}

export function countTodayStrategySignals(
  analyses: ReadonlyArray<Pick<AnalysisRecord, 'strategyKey' | 'createdAt'>>,
  strategyKey: string,
  now: Date = new Date()
): number {
  if (!strategyKey) return 0;
  const startOfTodayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  let count = 0;
  for (const item of analyses) {
    if (item.strategyKey !== strategyKey) continue;
    if (extractCreatedAtMs(item.createdAt) >= startOfTodayMs) {
      count += 1;
    }
  }
  return count;
}

export function getCreditQuotaForProfile(
  profile?: Pick<UserProfile, 'plan' | 'proUntil' | 'weeklyQuota'> | null,
  nowMs: number = Date.now()
): number {
  if (isProSubscriptionActive(profile, nowMs)) return PRO_MONTHLY_QUOTA;
  return profile?.weeklyQuota || FREE_WEEKLY_QUOTA;
}

export const STRATEGY_CATALOG: StrategyTemplate[] = [
  {
    key: 'spot_dca_accumulation',
    marketType: 'spot',
    tier: 'free',
    creditCost: 1,
    marketCondition: 'Накопление / Откат',
    expectedHorizon: '2–7 дней',
    name: 'DCA и накопление на просадках',
    shortTag: 'Спот · Накопление',
    timeframeDefault: '4h',
    riskProfile: 'Консервативная',
    description:
      'Поиск зон институционального спроса без кредитного плеча. Подходит для поэтапного набора позиции на откатах к EMA50/200.',
    rulesSummary:
      'Вход при RSI(14) < 42 вблизи поддержки EMA50/EMA200 и положительном институциональном новостном фоне. Без плеча.',
    indicatorsUsed: ['EMA 50 / 200', 'RSI (14)', 'Объемная поддержка'],
    defaultLeverage: 1,
    defaultRiskPct: 2.0,
  },
  {
    key: 'spot_trend_breakout',
    marketType: 'spot',
    tier: 'free',
    creditCost: 1,
    marketCondition: 'Восходящий тренд',
    expectedHorizon: '6–36 часов',
    name: 'Импульсный пробой тренда',
    shortTag: 'Спот · Пробой',
    timeframeDefault: '1h',
    riskProfile: 'Сбалансированная',
    description:
      'Фиксация выхода цены из диапазона консолидации с подтверждением объема и пересечением MACD вверх.',
    rulesSummary:
      'Подтверждение пробоя локального сопротивления, EMA20 > EMA50, положительная гистограмма MACD и отсутствие медвежьих новостей.',
    indicatorsUsed: ['EMA 20 / 50', 'MACD', 'Пробой сопротивления'],
    defaultLeverage: 1,
    defaultRiskPct: 1.5,
  },
  {
    key: 'spot_mean_reversion',
    marketType: 'spot',
    tier: 'free',
    creditCost: 1,
    marketCondition: 'Флэт / Диапазон',
    expectedHorizon: '4–24 часа',
    name: 'Возврат к среднему (Bollinger)',
    shortTag: 'Спот · Канал',
    timeframeDefault: '1h',
    riskProfile: 'Сбалансированная',
    description:
      'Отработка отскока от нижней границы полос Боллинджера к медианной скользящей при перепроданности.',
    rulesSummary:
      'Цена касается нижней границы BB(20,2), RSI < 34 формирует дивергенцию. Цель фиксации — средняя и верхняя полосы.',
    indicatorsUsed: ['Bollinger Bands (20,2)', 'RSI (14)', 'ATR (14)'],
    defaultLeverage: 1,
    defaultRiskPct: 1.25,
  },
  {
    key: 'spot_ema_ribbon_pullback',
    marketType: 'spot',
    tier: 'pro',
    creditCost: 1,
    marketCondition: 'Коррекция в тренде',
    expectedHorizon: '1–4 дня',
    name: 'Волновой откат к EMA Ribbon',
    shortTag: 'Спот · Ribbon',
    timeframeDefault: '4h',
    riskProfile: 'Сбалансированная',
    description:
      'Вход по основному восходящему тренду на контролируемом откате к динамической зоне поддержки EMA20–EMA50 без покупки на хаях.',
    rulesSummary:
      'EMA20 > EMA50, тень свечи тестирует зону EMA20/EMA50 с закрытием выше открытия и RSI в зоне 40–65.',
    indicatorsUsed: ['EMA Ribbon (20/50)', 'RSI (14)', 'Динамическая поддержка'],
    defaultLeverage: 1,
    defaultRiskPct: 1.5,
  },
  {
    key: 'spot_bb_squeeze_breakout',
    marketType: 'spot',
    tier: 'pro',
    creditCost: 1,
    marketCondition: 'Сжатие волатильности',
    expectedHorizon: '4–18 часов',
    name: 'Сжатие волатильности (BB Squeeze)',
    shortTag: 'Спот · Squeeze',
    timeframeDefault: '1h',
    riskProfile: 'Агрессивная',
    description:
      'Выявление фазы низковолатильного сжатия полос Боллинджера и захват раннего импульсного выхода вверх на повышенном объёме.',
    rulesSummary:
      'Ширина канала BB(20,2) сужается < 5.5%, цена пробивает верхнюю границу при всплеске объёма выше среднего.',
    indicatorsUsed: ['BB Width Squeeze', 'Volume Spike', 'ATR (14)'],
    defaultLeverage: 1,
    defaultRiskPct: 1.25,
  },
  {
    key: 'futures_momentum_atr',
    marketType: 'futures',
    tier: 'free',
    creditCost: 2,
    marketCondition: 'Устойчивый тренд',
    expectedHorizon: '4–24 часа',
    name: 'Трендовый импульс с ATR-стопом',
    shortTag: 'Фьючерсы · Импульс',
    timeframeDefault: '1h',
    riskProfile: 'Сбалансированная',
    description:
      'Направленные сделки Long/Short по тренду на фьючерсах с динамическим расчетом Stop-Loss по волатильности ATR(14).',
    rulesSummary:
      'Строгое выравнивание EMA20/EMA50 по тренду, фильтр Funding Rate (не экстремальный), стоп 1.5×ATR, три цели TP1–TP3.',
    indicatorsUsed: ['EMA 20 / 50', 'ATR (14)', 'Funding Rate'],
    defaultLeverage: 3,
    defaultRiskPct: 1.0,
  },
  {
    key: 'futures_liquidity_sweep',
    marketType: 'futures',
    tier: 'pro',
    creditCost: 2,
    marketCondition: 'Сбор стопов / Скальп',
    expectedHorizon: '15–120 мин',
    name: 'Снятие ликвидности и Ордер-флоу',
    shortTag: 'Фьючерсы · Скальп',
    timeframeDefault: '15m',
    riskProfile: 'Агрессивная',
    description:
      'Определение ложных пробоев уровней (Stop-Hunt) на младших таймфреймах с учетом перекоса открытого интереса.',
    rulesSummary:
      'Ложный вынос за локальный экстремум с быстрым возвратом, дивергенция RSI на 15m, короткий стоп и повышенный R:R.',
    indicatorsUsed: ['Open Interest', 'RSI (14)', 'Уровни ликвидности'],
    defaultLeverage: 8,
    defaultRiskPct: 0.75,
  },
  {
    key: 'futures_funding_reversal',
    marketType: 'futures',
    tier: 'pro',
    creditCost: 2,
    marketCondition: 'Перегрев деривативов',
    expectedHorizon: '8–48 часов',
    name: 'Контртренд перегретого Funding',
    shortTag: 'Фьючерсы · Контртренд',
    timeframeDefault: '4h',
    riskProfile: 'Агрессивная',
    description:
      'Отработка разворота перегруженных позиций, когда ставка финансирования и полосы Боллинджера указывают на истощение.',
    rulesSummary:
      'Отклонение цены за границу BB(20,2), перегретый RSI (>72 или <28) и разворот гистограммы MACD.',
    indicatorsUsed: ['Funding Rate', 'Bollinger Bands', 'MACD + RSI'],
    defaultLeverage: 4,
    defaultRiskPct: 1.0,
  },
  {
    key: 'futures_oi_volatility_breakout',
    marketType: 'futures',
    tier: 'pro',
    creditCost: 2,
    marketCondition: 'Расширение ATR + OI',
    expectedHorizon: '2–16 часов',
    name: 'Пробой ATR + Open Interest (Futures)',
    shortTag: 'Фьючерсы · Пробой OI',
    timeframeDefault: '1h',
    riskProfile: 'Агрессивная',
    description:
      'Захват ускорения импульса в обе стороны при расширении волатильности ATR(14) и пробое локального экстремума.',
    rulesSummary:
      'Расширение ATR относительно средних значений >12%, согласованность с EMA20/50 и пробой 6-свечного экстремума.',
    indicatorsUsed: ['ATR Expansion', 'Open Interest', 'EMA 20 / 50'],
    defaultLeverage: 6,
    defaultRiskPct: 0.9,
  },
];

export function getStrategyTemplate(strategyKey: string): StrategyTemplate | undefined {
  return STRATEGY_CATALOG.find((s) => s.key === strategyKey);
}

export function isProOnlyStrategy(strategyKey: string): boolean {
  return STRATEGY_CATALOG.some((s) => s.key === strategyKey && s.tier === 'pro');
}

export const TRADING_PAIRS: Array<{
  symbol: string;
  label: string;
  name: string;
  category: string;
  isNewListing?: boolean;
  aliases?: string[];
}> = [
  { symbol: 'BTCUSDT', label: 'BTC / USDT', name: 'Bitcoin', category: 'Major' },
  { symbol: 'ETHUSDT', label: 'ETH / USDT', name: 'Ethereum', category: 'Major' },
  { symbol: 'SOLUSDT', label: 'SOL / USDT', name: 'Solana', category: 'L1', isNewListing: true },
  { symbol: 'BNBUSDT', label: 'BNB / USDT', name: 'BNB', category: 'Exchange' },
  { symbol: 'TONUSDT', label: 'TON / USDT', name: 'Toncoin', category: 'L1', isNewListing: true },
  { symbol: 'XRPUSDT', label: 'XRP / USDT', name: 'Ripple', category: 'Payments' },
  { symbol: 'AVAXUSDT', label: 'AVAX / USDT', name: 'Avalanche', category: 'L1', isNewListing: true },
  { symbol: 'LINKUSDT', label: 'LINK / USDT', name: 'Chainlink', category: 'Oracle / DeFi' },
  { symbol: 'DOGEUSDT', label: 'DOGE / USDT', name: 'Dogecoin', category: 'Meme' },
  { symbol: 'ARBUSDT', label: 'ARB / USDT', name: 'Arbitrum', category: 'L2', isNewListing: true },
  { symbol: 'SUIUSDT', label: 'SUI / USDT', name: 'Sui', category: 'L1', isNewListing: true },
  { symbol: 'APTUSDT', label: 'APT / USDT', name: 'Aptos', category: 'L1', isNewListing: true },
  { symbol: 'NEARUSDT', label: 'NEAR / USDT', name: 'NEAR Protocol', category: 'AI / L1' },
  { symbol: 'ADAUSDT', label: 'ADA / USDT', name: 'Cardano', category: 'L1' },
  { symbol: 'DOTUSDT', label: 'DOT / USDT', name: 'Polkadot', category: 'L0 / L1' },
  { symbol: 'OPUSDT', label: 'OP / USDT', name: 'Optimism', category: 'L2', isNewListing: true },
  { symbol: 'INJUSDT', label: 'INJ / USDT', name: 'Injective', category: 'DeFi / L1', isNewListing: true },
  { symbol: 'AAVEUSDT', label: 'AAVE / USDT', name: 'Aave', category: 'DeFi' },
  { symbol: 'UNIUSDT', label: 'UNI / USDT', name: 'Uniswap', category: 'DeFi' },
  { symbol: 'LTCUSDT', label: 'LTC / USDT', name: 'Litecoin', category: 'Payments' },
  { symbol: 'TRXUSDT', label: 'TRX / USDT', name: 'TRON', category: 'Payments' },
  { symbol: 'ATOMUSDT', label: 'ATOM / USDT', name: 'Cosmos', category: 'L0 / IBC' },
  { symbol: 'TIAUSDT', label: 'TIA / USDT', name: 'Celestia', category: 'Modular L1', isNewListing: true },
  { symbol: 'WLDUSDT', label: 'WLD / USDT', name: 'Worldcoin', category: 'AI / ID', isNewListing: true },
  { symbol: 'ENAUSDT', label: 'ENA / USDT', name: 'Ethena', category: 'DeFi', isNewListing: true },
  { symbol: 'SEIUSDT', label: 'SEI / USDT', name: 'Sei', category: 'L1', isNewListing: true },
  {
    symbol: 'POLUSDT',
    label: 'POL / USDT',
    name: 'Polygon (ex-MATIC)',
    category: 'L2',
    aliases: ['MATIC', 'MATICUSDT', 'Polygon'],
  },
  {
    symbol: 'RENDERUSDT',
    label: 'RENDER / USDT',
    name: 'Render',
    category: 'AI / GPU',
    isNewListing: true,
    aliases: ['RNDR', 'RNDRUSDT'],
  },
  {
    symbol: 'FETUSDT',
    label: 'FET / USDT',
    name: 'Fetch.ai (ASI)',
    category: 'AI / L1',
    aliases: ['ASI', 'AGIX', 'OCEAN'],
  },
  { symbol: 'FILUSDT', label: 'FIL / USDT', name: 'Filecoin', category: 'Storage / DePIN' },
  { symbol: 'BCHUSDT', label: 'BCH / USDT', name: 'Bitcoin Cash', category: 'Payments' },
  { symbol: 'ETCUSDT', label: 'ETC / USDT', name: 'Ethereum Classic', category: 'L1' },
  { symbol: 'HBARUSDT', label: 'HBAR / USDT', name: 'Hedera', category: 'L1' },
  { symbol: 'ICPUSDT', label: 'ICP / USDT', name: 'Internet Computer', category: 'L1' },
  { symbol: 'STXUSDT', label: 'STX / USDT', name: 'Stacks', category: 'BTC L2' },
  { symbol: 'IMXUSDT', label: 'IMX / USDT', name: 'Immutable', category: 'Gaming / L2' },
  { symbol: 'JUPUSDT', label: 'JUP / USDT', name: 'Jupiter', category: 'DeFi', isNewListing: true },
  { symbol: 'PYTHUSDT', label: 'PYTH / USDT', name: 'Pyth Network', category: 'Oracle', isNewListing: true },
  { symbol: 'ORDIUSDT', label: 'ORDI / USDT', name: 'ORDI', category: 'BRC-20', isNewListing: true },
  { symbol: 'LDOUSDT', label: 'LDO / USDT', name: 'Lido DAO', category: 'DeFi' },
  { symbol: 'CRVUSDT', label: 'CRV / USDT', name: 'Curve DAO', category: 'DeFi' },
  { symbol: 'GRTUSDT', label: 'GRT / USDT', name: 'The Graph', category: 'AI / Indexing' },
  { symbol: 'ALGOUSDT', label: 'ALGO / USDT', name: 'Algorand', category: 'L1' },
  { symbol: 'XLMUSDT', label: 'XLM / USDT', name: 'Stellar', category: 'Payments' },
];

/** Стоимость одного анализа в кредитах: у стратегии может быть своя, иначе по типу рынка. Единая для клиента и сервера. */
export function getAnalysisCreditCost(strategyKey: string, marketType: 'spot' | 'futures'): number {
  const strategy = STRATEGY_CATALOG.find((s) => s.key === strategyKey);
  return (
    strategy?.creditCost ?? (marketType === 'futures' ? CREDIT_COSTS.futuresAnalysis : CREDIT_COSTS.spotAnalysis)
  );
}
