import type { StrategyTemplate } from '../types/domain';

export const STRATEGY_CATALOG: StrategyTemplate[] = [
  {
    key: 'spot_dca_accumulation',
    marketType: 'spot',
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
    key: 'futures_momentum_atr',
    marketType: 'futures',
    name: 'Трендовый импульс с ATR-стопом',
    shortTag: 'Фьючерсы · Импульс',
    timeframeDefault: '1h',
    riskProfile: 'Сбалансированная',
    description:
      'Направленные сделки Long/Short по тренду на фьючерсах с динамическим расчетом Stop-Loss по волатильности ATR(14).',
    rulesSummary:
      'Строгое выравнивание EMA20/EMA50 по тренду, фильтр Funding Rate (не экстремальный), стоп 1.5×ATR, три цели TP1–TP3.',
    indicatorsUsed: ['EMA 20 / 50', 'ATR (14)', 'Funding Rate'],
    defaultLeverage: 5,
    defaultRiskPct: 1.0,
  },
  {
    key: 'futures_liquidity_sweep',
    marketType: 'futures',
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
    name: 'Контртренд перегретого Funding',
    shortTag: 'Фьючерсы · Контртренд',
    timeframeDefault: '4h',
    riskProfile: 'Агрессивная',
    description:
      'Отработка разворота перегруженных позиций, когда ставка финансирования и полосы Боллинджера указывают на истощение.',
    rulesSummary:
      'Отклонение цены за границу BB(20,2), перегретый RSI (>72 или <28) и разворот гистограммы MACD.',
    indicatorsUsed: ['Funding Rate', 'Bollinger Bands', 'MACD + RSI'],
    defaultLeverage: 3,
    defaultRiskPct: 1.0,
  },
];

export const TRADING_PAIRS = [
  { symbol: 'BTCUSDT', label: 'BTC / USDT', name: 'Bitcoin' },
  { symbol: 'ETHUSDT', label: 'ETH / USDT', name: 'Ethereum' },
  { symbol: 'SOLUSDT', label: 'SOL / USDT', name: 'Solana' },
  { symbol: 'BNBUSDT', label: 'BNB / USDT', name: 'BNB' },
  { symbol: 'TONUSDT', label: 'TON / USDT', name: 'Toncoin' },
  { symbol: 'XRPUSDT', label: 'XRP / USDT', name: 'Ripple' },
  { symbol: 'AVAXUSDT', label: 'AVAX / USDT', name: 'Avalanche' },
  { symbol: 'LINKUSDT', label: 'LINK / USDT', name: 'Chainlink' },
  { symbol: 'DOGEUSDT', label: 'DOGE / USDT', name: 'Dogecoin' },
  { symbol: 'ARBUSDT', label: 'ARB / USDT', name: 'Arbitrum' },
];
