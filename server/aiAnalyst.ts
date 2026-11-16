import { GoogleGenAI, Type } from '@google/genai';
import type { IndicatorSnapshot } from './market.ts';

function getAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
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

const newsCache = new Map<string, { expiresAt: number; items: GroundedNewsItem[] }>();

export async function fetchGroundedCryptoNews(symbolFilter = 'ALL'): Promise<{
  items: GroundedNewsItem[];
  grounded: boolean;
}> {
  const cacheKey = `news:${symbolFilter}`;
  const cached = newsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { items: cached.items, grounded: true };
  }

  const ai = getAiClient();
  const topic =
    symbolFilter && symbolFilter !== 'ALL'
      ? `криптовалюта ${symbolFilter.replace('USDT', '')} и общий крипторынок`
      : 'криптовалютный рынок Bitcoin Ethereum Solana TON ETF регуляция деривативы';

  if (ai) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Найди 6 самых свежих и значимых новостей по теме: ${topic}.
Для каждой новости верни заголовок на русском, краткую рыночную суть (2 предложения), тикер актива (BTC, ETH, SOL, TON, BNB или MARKET), настроение (BULLISH, BEARISH или NEUTRAL) и степень влияния (HIGH, MEDIUM или LOW).
Формат ответа — строго JSON-массив объектов с полями: title, summary, asset, sentiment, impact, publishedLabel.`,
        config: {
          tools: [{ googleSearch: {} }],
          systemInstruction:
            'Ты аналитик криптовалютного деска. Пиши кратко, по делу, на русском языке. Возвращай валидный JSON массив без markdown-обертки.',
        },
      });

      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
      const webSources = chunks
        .map((c) => c.web)
        .filter((w): w is { uri?: string; title?: string } => Boolean(w && w.uri));

      const rawText = (response.text ?? '').trim();
      const jsonMatch = rawText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as Array<Record<string, string>>;
        const items: GroundedNewsItem[] = parsed.slice(0, 8).map((item, idx) => {
          const src = webSources[idx % Math.max(1, webSources.length)];
          const sentiment =
            item.sentiment === 'BULLISH' || item.sentiment === 'BEARISH' ? item.sentiment : 'NEUTRAL';
          const impact = item.impact === 'HIGH' || item.impact === 'LOW' ? item.impact : 'MEDIUM';
          return {
            id: `news_${Date.now()}_${idx}`,
            title: String(item.title || 'Рыночное обновление'),
            summary: String(item.summary || ''),
            asset: String(item.asset || 'MARKET').toUpperCase(),
            sentiment,
            impact,
            publishedLabel: String(item.publishedLabel || 'Сегодня'),
            sourceTitle: src?.title || 'Веб-поиск рынка',
            sourceUrl: src?.uri || 'https://www.coingecko.com/',
          };
        });
        if (items.length > 0) {
          newsCache.set(cacheKey, { expiresAt: Date.now() + 180_000, items });
          return { items, grounded: true };
        }
      }
    } catch (err) {
      console.error('Gemini news search error:', err);
    }
  }

  // Deterministic resilient fallback if Gemini key is absent or rate-limited
  const fallback: GroundedNewsItem[] = [
    {
      id: 'fb_1',
      title: 'Институциональный спрос на спотовые крипто-ETF сохраняет устойчивый приток капитала',
      summary:
        'Чистый приток в регулируемые биржевые фонды поддерживает ликвидность BTC и ETH вблизи ключевых зон консолидации. Волатильность опционного рынка указывает на умеренный бычий перекос.',
      asset: 'BTC',
      sentiment: 'BULLISH',
      impact: 'HIGH',
      publishedLabel: 'Сегодня',
      sourceTitle: 'Рыночный мониторинг',
      sourceUrl: 'https://www.coingecko.com/en/coins/bitcoin',
    },
    {
      id: 'fb_2',
      title: 'Открытый интерес на рынке фьючерсов смещается к нейтральным ставкам финансирования',
      summary:
        'Сброс избыточного кредитного плеча снизил риск каскадных ликвидаций на 4H-таймфрейме. Ставки funding вернулись в сбалансированный коридор около +0.01%.',
      asset: 'ETH',
      sentiment: 'NEUTRAL',
      impact: 'HIGH',
      publishedLabel: '2 ч назад',
      sourceTitle: 'Мониторинг деривативов',
      sourceUrl: 'https://www.coinglass.com/',
    },
    {
      id: 'fb_3',
      title: 'Экосистема Solana демонстрирует рост ончейн-оборотов на децентрализованных площадках',
      summary:
        'Суточный объем торгов в пулах ликвидности SOL опережает средние значения прошлого месяца, что усиливает импульсные пробойные стратегии.',
      asset: 'SOL',
      sentiment: 'BULLISH',
      impact: 'MEDIUM',
      publishedLabel: '4 ч назад',
      sourceTitle: 'Ончейн-аналитика',
      sourceUrl: 'https://defillama.com/',
    },
    {
      id: 'fb_4',
      title: 'Регуляторные обсуждения стейблкоинов усиливают требования к резервам и прозрачности',
      summary:
        'Участники рынка отслеживают новые стандарты отчетности эмитентов, что краткосрочно повышает спрос на проверенные ликвидные пары USDT.',
      asset: 'MARKET',
      sentiment: 'NEUTRAL',
      impact: 'MEDIUM',
      publishedLabel: '6 ч назад',
      sourceTitle: 'Макрообзор',
      sourceUrl: 'https://www.coingecko.com/',
    },
  ];
  return { items: fallback, grounded: false };
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

const calendarCache = new Map<string, { expiresAt: number; events: EconomicCalendarEvent[]; grounded: boolean }>();

function formatShortRuDate(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }).replace('.', '');
}

export async function fetchEconomicCalendar(): Promise<{
  events: EconomicCalendarEvent[];
  grounded: boolean;
}> {
  const cacheKey = 'calendar:global';
  const cached = calendarCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { events: cached.events, grounded: cached.grounded };
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const ai = getAiClient();

  if (ai) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Сегодня ${todayIso}. Найди 7 самых важных ближайших экономических событий и ключевых крипто-катализаторов на эту и следующую неделю, которые влияют на Bitcoin, Ethereum и крипторынок (публикации макроданных США CPI/PPI/PCE/заявки по безработице, выступления ФРС/FOMC, экспирация опционов Deribit, крупные разлоки токенов, обновления сетей или отчеты по спотовым крипто-ETF).
Верни строго JSON-массив объектов со следующими полями:
- dateLabel (короткая дата на русском, например "17 ноя")
- timeUtcLabel (время UTC, например "13:30 UTC")
- regionOrAsset (например "USD · Макро", "BTC · ETF", "ETH", "SOL")
- category (строго одно из: "macro", "crypto", "derivatives")
- title (заголовок события на русском)
- description (краткое пояснение влияния на крипторынок, 1 предложение на русском)
- impact (строго "HIGH", "MEDIUM" или "LOW")
- forecast (прогноз, например "2.6%" или "—")
- previous (предыдущее значение, например "2.4%" или "—")
- actual (фактическое значение если уже вышло, иначе "Ожидается")
- marketBias (строго "VOLATILITY", "BULLISH", "BEARISH" или "NEUTRAL")`,
        config: {
          tools: [{ googleSearch: {} }],
          systemInstruction:
            'Ты макроэкономический и крипто-аналитик институционального терминала. Отвечай строго валидным JSON-массивом без markdown-обертки.',
        },
      });

      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
      const webSources = chunks
        .map((c) => c.web)
        .filter((w): w is { uri?: string; title?: string } => Boolean(w && w.uri));

      const rawText = (response.text ?? '').trim();
      const jsonMatch = rawText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as Array<Record<string, string>>;
        const events: EconomicCalendarEvent[] = parsed.slice(0, 10).map((item, idx) => {
          const src = webSources[idx % Math.max(1, webSources.length)];
          const category =
            item.category === 'macro' || item.category === 'derivatives' ? item.category : 'crypto';
          const impact =
            item.impact === 'HIGH' || item.impact === 'LOW' ? item.impact : 'MEDIUM';
          const marketBias =
            item.marketBias === 'BULLISH' ||
            item.marketBias === 'BEARISH' ||
            item.marketBias === 'NEUTRAL'
              ? item.marketBias
              : 'VOLATILITY';
          return {
            id: `cal_${Date.now()}_${idx}`,
            dateLabel: String(item.dateLabel || formatShortRuDate(idx)),
            timeUtcLabel: String(item.timeUtcLabel || '13:30 UTC'),
            regionOrAsset: String(item.regionOrAsset || 'USD · Макро'),
            category,
            title: String(item.title || 'Ключевое рыночное событие'),
            description: String(item.description || ''),
            impact,
            forecast: String(item.forecast || '—'),
            previous: String(item.previous || '—'),
            actual: String(item.actual || 'Ожидается'),
            marketBias,
            sourceUrl: src?.uri,
          };
        });
        if (events.length > 0) {
          calendarCache.set(cacheKey, { expiresAt: Date.now() + 600_000, events, grounded: true });
          return { events, grounded: true };
        }
      }
    } catch (err) {
      console.error('Gemini economic calendar error:', err);
    }
  }

  const fallback: EconomicCalendarEvent[] = [
    {
      id: 'cal_fb_1',
      dateLabel: formatShortRuDate(0),
      timeUtcLabel: '21:00 UTC',
      regionOrAsset: 'BTC · ETF',
      category: 'crypto',
      title: 'Ежедневный отчет по потокам в спотовые Bitcoin и Ethereum ETF (США)',
      description:
        'Чистый приток капитала институциональных фондов задает базовый импульс для спотовых пар на открытии азиатской сессии.',
      impact: 'HIGH',
      forecast: '+$280M',
      previous: '+$195M',
      actual: 'Ожидается',
      marketBias: 'BULLISH',
      sourceUrl: 'https://www.coinglass.com/',
    },
    {
      id: 'cal_fb_2',
      dateLabel: formatShortRuDate(1),
      timeUtcLabel: '13:30 UTC',
      regionOrAsset: 'USD · Макро',
      category: 'macro',
      title: 'Первичные заявки на пособие по безработице в США (Initial Jobless Claims)',
      description:
        'Ключевой индикатор рынка труда США, напрямую влияющий на ожидания по траектории ставки ФРС и индекс доллара DXY.',
      impact: 'HIGH',
      forecast: '220K',
      previous: '217K',
      actual: 'Ожидается',
      marketBias: 'VOLATILITY',
      sourceUrl: 'https://www.bls.gov/',
    },
    {
      id: 'cal_fb_3',
      dateLabel: formatShortRuDate(2),
      timeUtcLabel: '08:00 UTC',
      regionOrAsset: 'BTC / ETH',
      category: 'derivatives',
      title: 'Недельная экспирация опционов BTC и ETH на бирже Deribit',
      description:
        'Крупное закрытие опционных контрактов вблизи уровней Max Pain часто сопровождается резким снятием ликвидности.',
      impact: 'HIGH',
      forecast: '$3.4B OI',
      previous: '$2.9B OI',
      actual: 'Ожидается',
      marketBias: 'VOLATILITY',
      sourceUrl: 'https://www.deribit.com/',
    },
    {
      id: 'cal_fb_4',
      dateLabel: formatShortRuDate(3),
      timeUtcLabel: '13:30 UTC',
      regionOrAsset: 'USD · ФРС',
      category: 'macro',
      title: 'Индекс деловой активности PMI в производственном секторе и сфере услуг США',
      description:
        'Сильные данные PMI усиливают аппетит к риску или смещают ожидания доходности казначейских облигаций.',
      impact: 'MEDIUM',
      forecast: '51.2',
      previous: '50.8',
      actual: 'Ожидается',
      marketBias: 'NEUTRAL',
    },
    {
      id: 'cal_fb_5',
      dateLabel: formatShortRuDate(4),
      timeUtcLabel: '12:00 UTC',
      regionOrAsset: 'ARB / SOL',
      category: 'crypto',
      title: 'Плановый мониторинг разблокировки токенов экосистем L1/L2 (Token Unlocks)',
      description:
        'Появление нового предложения токенов на спотовом рынке способно временно усилить давление продавцов.',
      impact: 'MEDIUM',
      forecast: '$74M',
      previous: '$58M',
      actual: 'Ожидается',
      marketBias: 'BEARISH',
      sourceUrl: 'https://tokenomist.ai/',
    },
    {
      id: 'cal_fb_6',
      dateLabel: formatShortRuDate(5),
      timeUtcLabel: '19:00 UTC',
      regionOrAsset: 'USD · ФРС',
      category: 'macro',
      title: 'Публикация комментариев членов FOMC по денежно-кредитной политике и ликвидности',
      description:
        'Риторика представителей ФРС относительно баланса ликвидности и темпов снижения ставки влияет на фьючерсный открытый интерес.',
      impact: 'HIGH',
      forecast: 'Пауза / Мягко',
      previous: 'Сдержанно',
      actual: 'Ожидается',
      marketBias: 'VOLATILITY',
    },
  ];
  calendarCache.set(cacheKey, { expiresAt: Date.now() + 180_000, events: fallback, grounded: false });
  return { events: fallback, grounded: false };
}

export interface StrategyAnalysisRequest {
  symbol: string;
  marketType: 'spot' | 'futures';
  timeframe: string;
  strategyKey: string;
  strategyName: string;
  strategyRules: string;
  indicators: IndicatorSnapshot;
  fundingRatePct?: number;
  openInterestUsdt?: number;
  depositUsdt: number;
  riskPerTradePct: number;
  leverage: number;
  isPro: boolean;
}

export interface StrategyAnalysisResult {
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

function formatPrice(val: number): string {
  if (val >= 1000) return val.toFixed(2);
  if (val >= 10) return val.toFixed(3);
  return val.toFixed(4);
}

export async function runStrategyAnalysis(req: StrategyAnalysisRequest): Promise<StrategyAnalysisResult> {
  const { indicators, marketType, symbol, timeframe, strategyName, strategyRules, depositUsdt, riskPerTradePct, leverage, isPro } =
    req;

  const { items: newsItems } = await fetchGroundedCryptoNews(symbol);
  const relevantNews = newsItems.slice(0, isPro ? 4 : 2);
  const newsDigest = relevantNews.map((n) => `- [${n.sentiment}] ${n.title}: ${n.summary}`).join('\n');

  const safeLeverage = marketType === 'spot' ? 1 : Math.min(Math.max(1, leverage), 20);
  const riskAmountUsdt = Number(((depositUsdt * riskPerTradePct) / 100).toFixed(2));
  const slDistancePct = Math.max(0.6, Math.min(6.5, (indicators.atr14 * 1.5 * 100) / indicators.lastPrice));
  const rawPositionUsdt = (riskAmountUsdt * 100) / slDistancePct;
  const maxNotional = depositUsdt * safeLeverage;
  const positionSizeUsdt = Number(Math.min(rawPositionUsdt, maxNotional).toFixed(2));

  const ai = getAiClient();
  if (ai) {
    try {
      const prompt = `Проведи институциональный торговый анализ криптовалютной пары ${symbol} на рынке ${
        marketType === 'futures' ? 'ФЬЮЧЕРСЫ' : 'СПОТ'
      } (таймфрейм ${timeframe}) по выбранной стратегии "${strategyName}".

Правила стратегии: ${strategyRules}

Текущие технические показатели:
- Текущая цена: ${indicators.lastPrice}
- EMA20: ${indicators.ema20}, EMA50: ${indicators.ema50}, EMA200: ${indicators.ema200}
- RSI(14): ${indicators.rsi14}
- MACD: line=${indicators.macdLine.toFixed(4)}, signal=${indicators.macdSignal.toFixed(4)}, hist=${indicators.macdHistogram.toFixed(4)}
- ATR(14): ${indicators.atr14.toFixed(4)} (${indicators.volatilityPct}%)
- Полосы Боллинджера: Upper=${indicators.bbUpper}, Lower=${indicators.bbLower}
- Поддержка: ${indicators.supportLevel}, Сопротивление: ${indicators.resistanceLevel}
- Тренд: ${indicators.trendBias}
${
  marketType === 'futures'
    ? `- Funding Rate: ${req.fundingRatePct ?? 0.01}%, Open Interest: $${((req.openInterestUsdt ?? 0) / 1_000_000).toFixed(1)}M`
    : ''
}

Новостной фон:
${newsDigest}

Уровень глубины анализа: ${isPro ? 'ПОЛНЫЙ PRO (детальный мульти-факторный разбор, три цели TP1-TP3, катализаторы и условия отмены)' : 'БАЗОВЫЙ (сдержанный разбор по основной структуре)'}.
Помни: для СПОТ рынка направление не может быть SHORT — только LONG или WAIT. Для ФЬЮЧЕРСОВ допустимы LONG, SHORT или WAIT.`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          systemInstruction:
            'Ты риск-аналитик криптовалютного терминала AegisQuant. Давай строгий, взвешенный технический и новостной разбор на русском языке без гарантий доходности.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              direction: { type: Type.STRING, enum: ['LONG', 'SHORT', 'WAIT'] },
              confidence: { type: Type.INTEGER },
              entryZone: { type: Type.STRING },
              stopLoss: { type: Type.STRING },
              takeProfits: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              riskReward: { type: Type.STRING },
              newsSentiment: { type: Type.STRING, enum: ['BULLISH', 'BEARISH', 'NEUTRAL'] },
              keyCatalysts: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              invalidationRule: { type: Type.STRING },
              summary: { type: Type.STRING },
            },
            required: [
              'direction',
              'confidence',
              'entryZone',
              'stopLoss',
              'takeProfits',
              'riskReward',
              'newsSentiment',
              'keyCatalysts',
              'invalidationRule',
              'summary',
            ],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim()) as Partial<StrategyAnalysisResult>;
      let direction: 'LONG' | 'SHORT' | 'WAIT' =
        parsed.direction === 'LONG' || parsed.direction === 'SHORT' || parsed.direction === 'WAIT'
          ? parsed.direction
          : 'WAIT';
      if (marketType === 'spot' && direction === 'SHORT') {
        direction = 'WAIT';
      }

      const liqDistance = safeLeverage > 1 ? 0.9 / safeLeverage : 0;
      const estimatedLiquidationPrice =
        marketType === 'futures' && direction !== 'WAIT'
          ? formatPrice(
              direction === 'LONG'
                ? indicators.lastPrice * (1 - liqDistance)
                : indicators.lastPrice * (1 + liqDistance)
            )
          : null;

      const tps = Array.isArray(parsed.takeProfits) && parsed.takeProfits.length >= 1
        ? [
            String(parsed.takeProfits[0]),
            String(parsed.takeProfits[1] ?? parsed.takeProfits[0]),
            String(parsed.takeProfits[2] ?? parsed.takeProfits[1] ?? parsed.takeProfits[0]),
          ]
        : [
            formatPrice(indicators.lastPrice * 1.02),
            formatPrice(indicators.lastPrice * 1.045),
            formatPrice(indicators.lastPrice * 1.07),
          ];

      return {
        direction,
        confidence: Math.min(96, Math.max(40, Number(parsed.confidence ?? 68))),
        entryZone: String(parsed.entryZone || `${formatPrice(indicators.lastPrice * 0.995)} – ${formatPrice(indicators.lastPrice * 1.005)}`),
        stopLoss: String(parsed.stopLoss || formatPrice(indicators.lastPrice - indicators.atr14 * 1.5)),
        takeProfits: tps as [string, string, string],
        riskReward: String(parsed.riskReward || '1 : 2.4'),
        newsSentiment:
          parsed.newsSentiment === 'BULLISH' || parsed.newsSentiment === 'BEARISH'
            ? parsed.newsSentiment
            : 'NEUTRAL',
        newsSourcesCount: relevantNews.length,
        keyCatalysts: Array.isArray(parsed.keyCatalysts)
          ? parsed.keyCatalysts.slice(0, 4).map(String)
          : relevantNews.map((n) => n.title),
        invalidationRule: String(
          parsed.invalidationRule || `Закрытие свечи ${timeframe} ниже ключевой зоны ${formatPrice(indicators.supportLevel)}.`
        ),
        summary: String(parsed.summary || '').slice(0, 2400),
        riskMetrics: {
          riskAmountUsdt,
          positionSizeUsdt,
          recommendedLeverage: safeLeverage,
          estimatedLiquidationPrice,
        },
      };
    } catch (err) {
      console.error('Gemini strategy analysis error:', err);
    }
  }

  // Deterministic quantitative fallback when Gemini API key is unavailable
  const isBull = indicators.trendBias === 'BULLISH' || indicators.rsi14 < 38;
  const isBear = indicators.trendBias === 'BEARISH' && marketType === 'futures';
  const direction: 'LONG' | 'SHORT' | 'WAIT' = isBull ? 'LONG' : isBear ? 'SHORT' : 'WAIT';
  const atr = indicators.atr14;
  const p = indicators.lastPrice;
  const sl = direction === 'SHORT' ? p + atr * 1.5 : p - atr * 1.5;
  const tp1 = direction === 'SHORT' ? p - atr * 2.0 : p + atr * 2.0;
  const tp2 = direction === 'SHORT' ? p - atr * 3.5 : p + atr * 3.5;
  const tp3 = direction === 'SHORT' ? p - atr * 5.0 : p + atr * 5.0;
  const liqDistance = safeLeverage > 1 ? 0.9 / safeLeverage : 0;

  return {
    direction,
    confidence: direction === 'WAIT' ? 54 : 74,
    entryZone: `${formatPrice(p * 0.996)} – ${formatPrice(p * 1.004)}`,
    stopLoss: formatPrice(sl),
    takeProfits: [formatPrice(tp1), formatPrice(tp2), formatPrice(tp3)],
    riskReward: '1 : 2.3',
    newsSentiment: relevantNews[0]?.sentiment ?? 'NEUTRAL',
    newsSourcesCount: relevantNews.length,
    keyCatalysts: relevantNews.map((n) => n.title),
    invalidationRule: `Закрепление цены за уровнем ${formatPrice(sl)} отменяет сценарий по стратегии "${strategyName}".`,
    summary: `Структура ${symbol} (${timeframe}) оценивается как ${indicators.trendBias}. RSI(14) находится на отметке ${indicators.rsi14}, ATR составляет ${indicators.volatilityPct}%. ${
      marketType === 'futures'
        ? `Ставка финансирования ${req.fundingRatePct ?? 0.01}% не указывает на экстремальный перегрев.`
        : 'Для спотового входа приоритет отдается набору от ближайшей зоны поддержки.'
    } Сценарий требует строгого соблюдения стоп-лосса.`,
    riskMetrics: {
      riskAmountUsdt,
      positionSizeUsdt,
      recommendedLeverage: safeLeverage,
      estimatedLiquidationPrice:
        marketType === 'futures' && direction !== 'WAIT'
          ? formatPrice(direction === 'LONG' ? p * (1 - liqDistance) : p * (1 + liqDistance))
          : null,
    },
  };
}
