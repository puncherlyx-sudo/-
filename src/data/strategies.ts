import type { AnalysisRecord, PlanTier, StrategyTemplate, UserProfile } from '../types/domain';

export const FREE_WEEKLY_QUOTA = 25;
export const PRO_MONTHLY_QUOTA = 100;
export const MAX_X10_MONTHLY_QUOTA = 1000;
export const MAX_X20_MONTHLY_QUOTA = 2000;
export const MAX_MONTHLY_QUOTA = MAX_X10_MONTHLY_QUOTA;
export const FREE_MAX_LEVERAGE = 3;
export const FREE_DAILY_SIGNAL_LIMIT = 1;
export const CREDIT_COSTS = {
  spotAnalysis: 1,
  futuresAnalysis: 2,
  portfolioBacktest: 1,
  sentimentForecast: 1,
  liveScanner: 0,
} as const;

export function getActivePlanTier(
  profile?: Pick<UserProfile, 'plan' | 'proUntil'> | null,
  nowMs: number = Date.now()
): PlanTier {
  if (!profile) return 'free';
  const isPaidPlan = profile.plan === 'pro' || profile.plan === 'max';
  if (!isPaidPlan) return 'free';
  const hasValidExpiry =
    typeof profile.proUntil === 'number' && Number.isFinite(profile.proUntil) && profile.proUntil > nowMs;
  if (!hasValidExpiry) return 'free';
  return profile.plan === 'max' ? 'max' : 'pro';
}

export function isMaxSubscriptionActive(
  profile?: Pick<UserProfile, 'plan' | 'proUntil'> | null,
  nowMs: number = Date.now()
): boolean {
  return getActivePlanTier(profile, nowMs) === 'max';
}

export function isProSubscriptionActive(
  profile?: Pick<UserProfile, 'plan' | 'proUntil'> | null,
  nowMs: number = Date.now()
): boolean {
  const tier = getActivePlanTier(profile, nowMs);
  return tier === 'pro' || tier === 'max';
}

export function isProSubscriptionExpired(
  profile?: Pick<UserProfile, 'plan' | 'proUntil'> | null,
  nowMs: number = Date.now()
): boolean {
  if (!profile || (profile.plan !== 'pro' && profile.plan !== 'max')) return false;
  return !isProSubscriptionActive(profile, nowMs);
}

export function getTierDisplayName(tier: PlanTier): string {
  if (tier === 'max') return 'MAX';
  if (tier === 'pro') return 'PRO';
  return 'Free';
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
  profile?: Pick<UserProfile, 'plan' | 'proUntil' | 'weeklyQuota' | 'maxMultiplier' | 'creditsRemaining'> | null,
  nowMs: number = Date.now()
): number {
  const tier = getActivePlanTier(profile, nowMs);
  if (tier === 'max') {
    if (profile?.maxMultiplier === 20 || (profile?.creditsRemaining ?? 0) > MAX_X10_MONTHLY_QUOTA) {
      return MAX_X20_MONTHLY_QUOTA;
    }
    return MAX_X10_MONTHLY_QUOTA;
  }
  if (tier === 'pro') return PRO_MONTHLY_QUOTA;
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
    key: 'spot_golden_cross_swing',
    marketType: 'spot',
    tier: 'free',
    creditCost: 1,
    marketCondition: 'Устойчивый свинг-тренд',
    expectedHorizon: '2–6 дней',
    name: 'Золотой крест EMA20/50 + Тренд-свинг',
    shortTag: 'Спот · Свинг',
    timeframeDefault: '4h',
    riskProfile: 'Консервативная',
    description:
      'Классическая спотовая стратегия по тренду без плеча: фиксирует закрепление EMA20 выше EMA50 на здоровом импульсе RSI без перекупленности.',
    rulesSummary:
      'EMA20 >= EMA50, восходящий наклон обеих средних, закрытие выше EMA20 и RSI(14) в комфортной зоне 46–68.',
    indicatorsUsed: ['EMA 20 / 50 Cross', 'RSI (14)', 'Тренд-фильтр'],
    defaultLeverage: 1,
    defaultRiskPct: 1.75,
  },
  {
    key: 'spot_support_bounce_rsi',
    marketType: 'spot',
    tier: 'free',
    creditCost: 1,
    marketCondition: 'Отскок от поддержки',
    expectedHorizon: '8–36 часов',
    name: 'Отскок от локальной поддержки + RSI',
    shortTag: 'Спот · Отскок',
    timeframeDefault: '1h',
    riskProfile: 'Сбалансированная',
    description:
      'Спотовая ловля отскоков у локальных уровней спроса за 10 свечей при развороте свечи вверх и снятии перепроданности по RSI.',
    rulesSummary:
      'Тест минимума 10 свечей с бычьим закрытием выше открытия, RSI(14) < 48 и подтверждение тенью снизу.',
    indicatorsUsed: ['Support 10-Bar', 'RSI (14)', 'Свечной откуп'],
    defaultLeverage: 1,
    defaultRiskPct: 1.5,
  },
  {
    key: 'spot_mean_reversion',
    marketType: 'spot',
    tier: 'pro',
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
    key: 'spot_advanced_market_sentiment',
    marketType: 'spot',
    tier: 'pro',
    creditCost: 1,
    marketCondition: 'Синхронизация тренда и сентимента',
    expectedHorizon: '12–72 часа',
    name: 'Advanced Market Sentiment (Настроения + Импульс)',
    shortTag: 'Спот · Sentiment PRO',
    timeframeDefault: '4h',
    riskProfile: 'Сбалансированная',
    description:
      'Эксклюзивная PRO/MAX-стратегия: фильтрует только подтверждённые развороты бычьего сентимента при поддержке объёма, ширины рынка и наклона EMA20/EMA50.',
    rulesSummary:
      'Закрытие в верхней зоне свечи выше EMA20 при восходящем уклоне EMA20/EMA50, RSI(14) 46–67, объём ≥ 0.95× среднего и позитивный сдвиг индекса настроений.',
    indicatorsUsed: ['Fear & Greed Shift', 'Market Breadth', 'EMA 20 / 50 + Volume'],
    defaultLeverage: 1,
    defaultRiskPct: 1.75,
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
    key: 'spot_vwap_trend_reclaim',
    marketType: 'spot',
    tier: 'pro',
    creditCost: 1,
    marketCondition: 'Возврат в тренд',
    expectedHorizon: '8–36 часов',
    name: 'Возврат над EMA20 после снятия стопов',
    shortTag: 'Спот · Reclaim',
    timeframeDefault: '1h',
    riskProfile: 'Сбалансированная',
    description:
      'Захват продолжения тренда после неглубокого сбора ликвидности: цена возвращается выше EMA20 и локального открытия на повышенном объёме.',
    rulesSummary:
      'Закрытие выше EMA20 и предыдущего максимума тела после прокола поддержки, EMA20 >= EMA50×0.992, RSI 45–68.',
    indicatorsUsed: ['EMA 20 / 50', 'Volume Reclaim', 'RSI (14)'],
    defaultLeverage: 1,
    defaultRiskPct: 1.5,
  },
  {
    key: 'spot_rsi_bull_divergence',
    marketType: 'spot',
    tier: 'pro',
    creditCost: 1,
    marketCondition: 'Разворот импульса',
    expectedHorizon: '1–5 дней',
    name: 'Бычья дивергенция RSI + Объемное подтверждение',
    shortTag: 'Спот · Дивергенция',
    timeframeDefault: '4h',
    riskProfile: 'Сбалансированная',
    description:
      'Поиск разворота на истощении продавца: цена обновляет или тестирует локальный минимум, тогда как RSI формирует более высокий минимум.',
    rulesSummary:
      'RSI(14) выше локального минимума 5 свечей назад при снижении цены, бычья свеча закрытия выше BB Lower и приток объёма.',
    indicatorsUsed: ['RSI Divergence', 'Bollinger Lower', 'Volume Flow'],
    defaultLeverage: 1,
    defaultRiskPct: 1.75,
  },
  {
    key: 'spot_donchian_channel_breakout',
    marketType: 'spot',
    tier: 'pro',
    creditCost: 1,
    marketCondition: 'Пробой диапазона 12 свечей',
    expectedHorizon: '1–5 дней',
    name: 'Пробой канала Дончиана + Объём (Spot)',
    shortTag: 'Спот · Дончиан',
    timeframeDefault: '4h',
    riskProfile: 'Сбалансированная',
    description:
      'Систематическая трендовая стратегия на споте: вход при выходе цены за верхнюю границу 12-свечного канала Дончиана на повышенном торговом объёме.',
    rulesSummary:
      'Закрытие выше 12-свечного максимума, цена выше EMA50, объём ≥ 1.1× среднего и RSI(14) ≤ 74.',
    indicatorsUsed: ['Donchian (12)', 'Volume Spike', 'EMA 50 Filter'],
    defaultLeverage: 1,
    defaultRiskPct: 1.5,
  },
  {
    key: 'spot_atr_pullback_continuation',
    marketType: 'spot',
    tier: 'pro',
    creditCost: 1,
    marketCondition: 'Волатильный откат в тренде',
    expectedHorizon: '6–30 часов',
    name: 'Откат по ATR в восходящем тренде (Spot)',
    shortTag: 'Спот · ATR Откат',
    timeframeDefault: '1h',
    riskProfile: 'Сбалансированная',
    description:
      'Точечный набор спотовой позиции на контролируемой коррекции 0.8×ATR внутри бычьего тренда при возврате цены выше середины предыдущей свечи.',
    rulesSummary:
      'EMA20 > EMA50, коррекция в зону EMA20 ± 0.8×ATR с бычьей свечой возврата и RSI(14) 42–64.',
    indicatorsUsed: ['ATR Pullback', 'EMA 20 / 50', 'RSI (14)'],
    defaultLeverage: 1,
    defaultRiskPct: 1.5,
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
  {
    key: 'futures_trend_pyramid',
    marketType: 'futures',
    tier: 'pro',
    creditCost: 2,
    marketCondition: 'Направленный свинг',
    expectedHorizon: '12–72 часа',
    name: 'Свинг-продолжение EMA20/50 + Пробой диапазона',
    shortTag: 'Фьючерсы · Свинг',
    timeframeDefault: '4h',
    riskProfile: 'Сбалансированная',
    description:
      'Систематическая торговля в сторону устоявшегося тренда при пробое локальной базы с контролем волатильности по ATR.',
    rulesSummary:
      'Устойчивый наклон EMA20 над/под EMA50, уверенное тело свечи закрытия за 4-свечным диапазоном и отсутствие перекупленности.',
    indicatorsUsed: ['EMA 20 / 50 Slope', 'Range Breakout', 'ATR Filter'],
    defaultLeverage: 5,
    defaultRiskPct: 1.25,
  },
  {
    key: 'futures_squeeze_expansion',
    marketType: 'futures',
    tier: 'pro',
    creditCost: 2,
    marketCondition: 'Выход из сжатия',
    expectedHorizon: '2–24 часа',
    name: 'Экспансия сжатия BB + Volume Impulse (Long/Short)',
    shortTag: 'Фьючерсы · Squeeze',
    timeframeDefault: '1h',
    riskProfile: 'Агрессивная',
    description:
      'Двусторонний захват выхода фьючерсной пары из узкого ценового сжатия Боллинджера с подтверждением всплеска торгового объёма.',
    rulesSummary:
      'Ширина полос Боллинджера < 6%, прорыв верхней или нижней границы на объёме ≥1.15× среднего и подтверждение RSI.',
    indicatorsUsed: ['BB Squeeze', 'Volume Impulse', 'ATR (14)'],
    defaultLeverage: 7,
    defaultRiskPct: 1.0,
  },
  // ==================== MAX-EXCLUSIVE STRATEGIES (55%+ WR EXECUTION PROFILE) ====================
  {
    key: 'spot_max_smc_orderblock_mitigation',
    marketType: 'spot',
    tier: 'max',
    creditCost: 1,
    marketCondition: 'Митигация зоны спроса (SMC)',
    expectedHorizon: '12–72 часа',
    name: 'Smart Money: Митигация Order Block (MAX)',
    shortTag: 'Спот · SMC MAX',
    timeframeDefault: '4h',
    riskProfile: 'Консервативная',
    description:
      'Эксклюзивный MAX-алгоритм с профилем высокой вероятности (WR 55%+): вход на тесте институционального Order Block с поглощением объёма, быстрым частичным тейком и переводом в безубыток.',
    rulesSummary:
      'Тест зоны спроса EMA20/EMA50 или локального минимума с длинной нижней тенью, закрытие выше открытия, RSI(14) 34–64, перенос стопа в безубыток после +0.55×ATR.',
    indicatorsUsed: ['Order Block Demand', 'EMA 20 / 50', 'ATR Breakeven'],
    defaultLeverage: 1,
    defaultRiskPct: 1.5,
  },
  {
    key: 'spot_max_institutional_vwap_reversion',
    marketType: 'spot',
    tier: 'max',
    creditCost: 1,
    marketCondition: 'Возврат к балансу VWAP / BB',
    expectedHorizon: '4–20 часов',
    name: 'Институциональный возврат к VWAP / BB (MAX)',
    shortTag: 'Спот · VWAP MAX',
    timeframeDefault: '1h',
    riskProfile: 'Консервативная',
    description:
      'Эксклюзивная MAX-стратегия статистического возврата: отбирает перепроданные отклонения ниже средней VWAP/BB с подтверждённой свечой откупа и фиксирует прибыль у медианы.',
    rulesSummary:
      'Отклонение ниже средней зоны BB/VWAP, RSI(14) 24–50, бычья реакция закрытия в верхней половине свечи, тейк-профит 1.05×ATR с защитой безубытка.',
    indicatorsUsed: ['Rolling VWAP', 'BB Median', 'RSI (14) + Volume'],
    defaultLeverage: 1,
    defaultRiskPct: 1.5,
  },
  {
    key: 'spot_max_multi_confluence_momentum',
    marketType: 'spot',
    tier: 'max',
    creditCost: 1,
    marketCondition: 'Мульти-конфлюэнс импульс',
    expectedHorizon: '6–30 часов',
    name: 'Мульти-конфлюэнс импульс + Динамический трейлинг (MAX)',
    shortTag: 'Спот · Quant MAX',
    timeframeDefault: '1h',
    riskProfile: 'Сбалансированная',
    description:
      'Многофакторная MAX-модель на стыке тренда EMA20/50, силы закрытия свечи и объёмного притока. Исключает покупки на перегретых хаях и фиксирует цель высокой вероятности.',
    rulesSummary:
      'Наклон EMA20 >= EMA50, закрытие в топ-45% диапазона свечи, RSI(14) 44–68, объём ≥ 0.9× среднего и динамическая фиксация безубытка.',
    indicatorsUsed: ['Multi-Factor EMA', 'Close Strength', 'Trailing Lock'],
    defaultLeverage: 1,
    defaultRiskPct: 1.75,
  },
  {
    key: 'futures_max_liquidity_grab_reclaim',
    marketType: 'futures',
    tier: 'max',
    creditCost: 2,
    marketCondition: 'Захват стопов + Reclaim',
    expectedHorizon: '1–12 часов',
    name: 'Институциональный захват ликвидности + Reclaim (MAX)',
    shortTag: 'Фьючерсы · SMC MAX',
    timeframeDefault: '15m',
    riskProfile: 'Сбалансированная',
    description:
      'Двусторонний MAX-алгоритм (Long/Short): выявляет прокол локального пула ликвидности за 8 свечей с моментальным возвратом цены в диапазон и высокой точностью отработки первой цели.',
    rulesSummary:
      'Вынос за 8-свечной High/Low с возвратным закрытием, фильтр RSI (Long < 58 / Short > 42), быстрая цель 1.08×ATR и авто-безубыток.',
    indicatorsUsed: ['Liquidity Sweep (8)', 'Range Reclaim', 'ATR Trailing'],
    defaultLeverage: 6,
    defaultRiskPct: 1.0,
  },
  {
    key: 'futures_max_delta_absorption_scalp',
    marketType: 'futures',
    tier: 'max',
    creditCost: 2,
    marketCondition: 'Поглощение объёма / Delta',
    expectedHorizon: '2–14 часов',
    name: 'Поглощение объёма и Delta-импульс (MAX)',
    shortTag: 'Фьючерсы · Delta MAX',
    timeframeDefault: '1h',
    riskProfile: 'Агрессивная',
    description:
      'Высокочастотная MAX-стратегия по потоку заявок: ловит свечи объёмного поглощения с выраженным перевесом покупателя или продавца и контролируемым риском на фьючерсах.',
    rulesSummary:
      'Объём ≥ 1.05× среднего при направленном закрытии тела (≥55% диапазона), согласованность с EMA20 и ранний перевод в безубыток.',
    indicatorsUsed: ['Volume Absorption', 'Candle Delta Proxy', 'EMA 20 + ATR'],
    defaultLeverage: 8,
    defaultRiskPct: 0.9,
  },
  {
    key: 'futures_max_quant_regime_adaptive',
    marketType: 'futures',
    tier: 'max',
    creditCost: 2,
    marketCondition: 'Адаптация: Тренд + Флэт',
    expectedHorizon: '6–36 часов',
    name: 'Адаптивный квант-режим: Тренд + Флэт (MAX)',
    shortTag: 'Фьючерсы · Quant MAX',
    timeframeDefault: '4h',
    riskProfile: 'Сбалансированная',
    description:
      'Флагманский адаптивный MAX-алгоритм: автоматически переключается между продолжением тренда при расширении волатильности и контртрендом от границ Боллинджера во флэте.',
    rulesSummary:
      'Детектор режима по ширине BB и наклону EMA20/50; вход только при свечном подтверждении направления, асимметричный High-WR тейк 1.1×ATR + безубыток.',
    indicatorsUsed: ['Regime Switcher', 'BB Width + EMA', 'High-WR Execution'],
    defaultLeverage: 5,
    defaultRiskPct: 1.25,
  },
  {
    key: 'spot_max_fvg_imbalance_fill',
    marketType: 'spot',
    tier: 'max',
    creditCost: 1,
    marketCondition: 'Заполнение дисбаланса FVG',
    expectedHorizon: '6–36 часов',
    name: 'Smart Money: Заполнение Fair Value Gap (MAX)',
    shortTag: 'Спот · FVG MAX',
    timeframeDefault: '1h',
    riskProfile: 'Сбалансированная',
    description:
      'Эксклюзивная спотовая MAX-стратегия (WR 55%+): фиксирует возврат цены в бычью зону имбаланса Fair Value Gap с подтверждением откупа и автоматическим переводом стопа в безубыток.',
    rulesSummary:
      'Тест локальной зоны имбаланса (FVG / EMA20) на откате, уверенное бычье закрытие (≥50% диапазона), RSI(14) 36–66 и быстрая фиксация первой цели по ATR.',
    indicatorsUsed: ['Fair Value Gap', 'Volume Reclaim', 'ATR Breakeven'],
    defaultLeverage: 1,
    defaultRiskPct: 1.6,
  },
  {
    key: 'spot_max_wyckoff_spring_accumulation',
    marketType: 'spot',
    tier: 'max',
    creditCost: 1,
    marketCondition: 'Фаза накопления / Spring',
    expectedHorizon: '1–4 дня',
    name: 'Вайкофф Spring: Сбор ликвидности на споте (MAX)',
    shortTag: 'Спот · Wyckoff MAX',
    timeframeDefault: '4h',
    riskProfile: 'Консервативная',
    description:
      'Институциональная спотовая модель по Вайкоффу (WR 55%+): находит ложный прокол нижней границы 10-свечного накопления с мгновенным выкупом и повышенной вероятностью отработки цели.',
    rulesSummary:
      'Прокол 10-свечного минимума с закрытием обратно внутри диапазона, длинная нижняя тень или бычье тело, RSI(14) 26–56 и защита безубытка.',
    indicatorsUsed: ['Wyckoff Spring (10)', 'Wick Rejection', 'ATR Trailing'],
    defaultLeverage: 1,
    defaultRiskPct: 1.5,
  },
  {
    key: 'spot_max_keltner_mean_reclaim',
    marketType: 'spot',
    tier: 'max',
    creditCost: 1,
    marketCondition: 'Отклонение канала Кельтнера',
    expectedHorizon: '4–24 часа',
    name: 'Возврат в канал Кельтнера + ATR (MAX)',
    shortTag: 'Спот · Keltner MAX',
    timeframeDefault: '1h',
    riskProfile: 'Консервативная',
    description:
      'Квантовая спотовая MAX-стратегия возврата к среднему (WR 55%+): отслеживает растяжение цены ниже нижней границы канала Кельтнера (EMA20 − 1.2×ATR) и берёт импульс возврата к медиане.',
    rulesSummary:
      'Минимум свечи ниже EMA20 − 1.15×ATR, закрытие в верхней половине свечи выше открытия, RSI(14) 24–54 и авто-безубыток после +0.46×ATR.',
    indicatorsUsed: ['Keltner Channel (ATR)', 'EMA 20 Median', 'High-WR Lock'],
    defaultLeverage: 1,
    defaultRiskPct: 1.5,
  },
];

export const MAX_EXCLUSIVE_STRATEGIES_COUNT = STRATEGY_CATALOG.filter((s) => s.tier === 'max').length;
export const PRO_AND_FREE_STRATEGIES_COUNT = STRATEGY_CATALOG.filter((s) => s.tier !== 'max').length;
export const SPOT_STRATEGIES_COUNT = STRATEGY_CATALOG.filter((s) => s.marketType === 'spot').length;
export const FUTURES_STRATEGIES_COUNT = STRATEGY_CATALOG.filter((s) => s.marketType === 'futures').length;

export function getStrategyTemplate(strategyKey: string): StrategyTemplate | undefined {
  return STRATEGY_CATALOG.find((s) => s.key === strategyKey);
}

export function isProOnlyStrategy(strategyKey: string): boolean {
  return STRATEGY_CATALOG.some((s) => s.key === strategyKey && (s.tier === 'pro' || s.tier === 'max'));
}

export function isMaxOnlyStrategy(strategyKey: string): boolean {
  return STRATEGY_CATALOG.some((s) => s.key === strategyKey && s.tier === 'max');
}

export function canAccessStrategy(strategyKey: string, tier: PlanTier): boolean {
  const tpl = getStrategyTemplate(strategyKey);
  if (!tpl || tpl.tier === 'free') return true;
  if (tpl.tier === 'pro') return tier === 'pro' || tier === 'max';
  return tier === 'max';
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
