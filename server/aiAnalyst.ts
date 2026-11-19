import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type { IndicatorSnapshot } from './market.ts';

export class AiServiceError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'AiServiceError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

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

// Shared circuit-breaker cooldown when Gemini API project/daily quota is exhausted
let geminiQuotaCooldownUntil = 0;
let lastQuotaWarnAt = 0;

interface ClassifiedGeminiError {
  statusCode: number;
  code: string;
  isQuotaExhausted: boolean;
  isTransientRateLimit: boolean;
  cooldownMs: number;
  userMessage: string;
}

function classifyGeminiError(err: unknown): ClassifiedGeminiError {
  const rawMessage = err instanceof Error ? err.message : String(err ?? '');
  const lower = rawMessage.toLowerCase();
  const statusProp =
    typeof err === 'object' && err !== null && 'status' in err
      ? Number((err as { status?: number }).status)
      : NaN;

  const is429 =
    statusProp === 429 ||
    lower.includes('"code":429') ||
    lower.includes('resource_exhausted') ||
    lower.includes('too many requests');

  const isHardQuotaExhausted =
    lower.includes('exceeded your current quota') ||
    lower.includes('check your plan and billing details') ||
    lower.includes('limit: 0');

  if (is429) {
    return {
      statusCode: 429,
      code: 'RESOURCE_EXHAUSTED',
      isQuotaExhausted: isHardQuotaExhausted,
      isTransientRateLimit: !isHardQuotaExhausted,
      cooldownMs: isHardQuotaExhausted ? 10 * 60_000 : 45_000,
      userMessage:
        'Исчерпана текущая квота Gemini API (429 RESOURCE_EXHAUSTED). Повторите позже или выберите API-ключ с биллингом в панели Settings > Secrets.',
    };
  }

  if (
    statusProp === 403 ||
    lower.includes('permission_denied') ||
    lower.includes('"code":403')
  ) {
    return {
      statusCode: 403,
      code: 'PERMISSION_DENIED',
      isQuotaExhausted: false,
      isTransientRateLimit: false,
      cooldownMs: 5 * 60_000,
      userMessage:
        'Доступ к Gemini API отклонён (403 PERMISSION_DENIED). Проверьте API-ключ в панели Settings > Secrets.',
    };
  }

  if (
    statusProp === 400 ||
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid')
  ) {
    return {
      statusCode: 400,
      code: 'API_KEY_INVALID',
      isQuotaExhausted: false,
      isTransientRateLimit: false,
      cooldownMs: 5 * 60_000,
      userMessage:
        'Некорректный ключ Gemini API (400 API_KEY_INVALID). Укажите действительный ключ в панели Settings > Secrets.',
    };
  }

  if (statusProp === 404 || lower.includes('not_found') || lower.includes('"code":404')) {
    return {
      statusCode: 404,
      code: 'NOT_FOUND',
      isQuotaExhausted: false,
      isTransientRateLimit: false,
      cooldownMs: 0,
      userMessage: 'Запрошенная модель Gemini недоступна (404 NOT_FOUND).',
    };
  }

  if (
    lower.includes('upstream_timeout') ||
    lower.includes('aborterror') ||
    lower.includes('timed out') ||
    lower.includes('deadline_exceeded')
  ) {
    return {
      statusCode: 504,
      code: 'UPSTREAM_TIMEOUT',
      isQuotaExhausted: false,
      isTransientRateLimit: true,
      cooldownMs: 0,
      userMessage: 'Превышено время ожидания ответа от Gemini. Повторите запрос или откройте вкладку FAQ.',
    };
  }

  return {
    statusCode: 503,
    code: 'UPSTREAM_UNAVAILABLE',
    isQuotaExhausted: false,
    isTransientRateLimit: statusProp === 503 || lower.includes('unavailable') || lower.includes('fetch failed'),
    cooldownMs: 0,
    userMessage: 'Сервис Gemini временно недоступен. Попробуйте повторить запрос чуть позже.',
  };
}

function logQuotaCooldownOnce(scope: string, message: string): void {
  const now = Date.now();
  if (now - lastQuotaWarnAt > 60_000) {
    lastQuotaWarnAt = now;
    console.warn(`[gemini:${scope}] ${message}`);
  }
}

async function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withAttemptTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`UPSTREAM_TIMEOUT after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function callGeminiWithBackoff<T>(
  scope: string,
  fn: (ai: GoogleGenAI) => Promise<T>,
  options?: { maxAttempts?: number; timeoutMs?: number }
): Promise<T> {
  const ai = getAiClient();
  if (!ai) {
    throw new AiServiceError(
      503,
      'MISSING_API_KEY',
      'Ключ GEMINI_API_KEY не настроен. Укажите API-ключ в панели Settings > Secrets.'
    );
  }

  const now = Date.now();
  if (now < geminiQuotaCooldownUntil) {
    throw new AiServiceError(
      429,
      'RESOURCE_EXHAUSTED',
      'Исчерпана текущая квота Gemini API (429 RESOURCE_EXHAUSTED). Повторите позже или выберите API-ключ с биллингом в панели Settings > Secrets.'
    );
  }

  const maxAttempts = options?.maxAttempts ?? 3;
  const timeoutMs = options?.timeoutMs ?? 14_000;
  let lastClassified: ClassifiedGeminiError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await withAttemptTimeout(fn(ai), timeoutMs);
    } catch (err) {
      const classified = classifyGeminiError(err);
      lastClassified = classified;

      if (classified.isQuotaExhausted) {
        geminiQuotaCooldownUntil = Date.now() + classified.cooldownMs;
        logQuotaCooldownOnce(scope, `Quota exhausted; pausing Gemini calls for ${Math.round(classified.cooldownMs / 60_000)}m.`);
        throw new AiServiceError(classified.statusCode, classified.code, classified.userMessage);
      }

      if (classified.isTransientRateLimit && attempt < maxAttempts) {
        const delayMs = 600 * 2 ** (attempt - 1) + Math.floor(Math.random() * 200);
        await sleepMs(delayMs);
        continue;
      }

      if (classified.cooldownMs > 0) {
        geminiQuotaCooldownUntil = Date.now() + classified.cooldownMs;
        logQuotaCooldownOnce(scope, `${classified.code}: ${classified.userMessage}`);
      } else {
        const reason = err instanceof Error ? err.message.slice(0, 140) : String(err ?? '');
        console.warn(`[gemini:${scope}] ${classified.code} (${reason})`);
      }
      throw new AiServiceError(classified.statusCode, classified.code, classified.userMessage);
    }
  }

  throw new AiServiceError(
    lastClassified?.statusCode ?? 503,
    lastClassified?.code ?? 'UPSTREAM_UNAVAILABLE',
    lastClassified?.userMessage ?? 'Сервис Gemini временно недоступен.'
  );
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

export interface GroundedNewsResponse {
  items: GroundedNewsItem[];
  grounded: boolean;
  source: 'gemini' | 'rss' | 'unavailable';
  notice?: string;
  updatedAt: string;
}

const NEWS_CACHE_TTL_MS = 3 * 60_000;
const RSS_CACHE_TTL_MS = 2 * 60_000;

const newsCache = new Map<string, { expiresAt: number; updatedAt: string; items: GroundedNewsItem[] }>();
const newsInFlight = new Map<string, Promise<GroundedNewsResponse>>();
let rssNewsCache: { expiresAt: number; updatedAt: string; items: Array<GroundedNewsItem & { publishedAtMs: number }> } | null = null;

const SERVER_NAMED_ENTITIES: Record<string, string> = {
  quot: '"',
  amp: '&',
  apos: "'",
  lt: '<',
  gt: '>',
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
};

function decodeHtmlEntitiesServer(str: string): string {
  const once = (s: string) =>
    s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, ent: string) => {
      if (ent.startsWith('#x') || ent.startsWith('#X')) {
        const code = parseInt(ent.slice(2), 16);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : match;
      }
      if (ent.startsWith('#')) {
        const code = parseInt(ent.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : match;
      }
      const mapped = SERVER_NAMED_ENTITIES[ent.toLowerCase()];
      return mapped !== undefined ? mapped : match;
    });
  return once(once(str));
}

function stripHtmlAndCdata(input: string): string {
  const stripped = input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ');
  return decodeHtmlEntitiesServer(stripped).replace(/\s+/g, ' ').trim();
}

function inferAssetFromText(text: string): string {
  const upper = text.toUpperCase();
  if (/\b(BITCOIN|BTC)\b/.test(upper)) return 'BTC';
  if (/\b(ETHEREUM|ETH|ETHER)\b/.test(upper)) return 'ETH';
  if (/\b(SOLANA|SOL)\b/.test(upper)) return 'SOL';
  if (/\b(TONCOIN|TELEGRAM|TON)\b/.test(upper)) return 'TON';
  if (/\b(BINANCE|BNB)\b/.test(upper)) return 'BNB';
  if (/\b(RIPPLE|XRP)\b/.test(upper)) return 'XRP';
  if (/\b(CARDANO|ADA)\b/.test(upper)) return 'ADA';
  if (/\b(POLKADOT|DOT)\b/.test(upper)) return 'DOT';
  if (/\b(CHAINLINK|LINK)\b/.test(upper)) return 'LINK';
  if (/\b(UNISWAP|UNI)\b/.test(upper)) return 'UNI';
  if (/\b(POLYGON|MATIC|POL)\b/.test(upper)) return 'POL';
  return 'MARKET';
}

function inferSentimentFromText(text: string): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
  const lower = text.toLowerCase();
  if (/(surge|rally|soar|gain|inflow|approve|adoption|record high|bull|breakout|jump|etf inflow|cut)/.test(lower)) {
    return 'BULLISH';
  }
  if (/(dump|slump|crash|drop|hack|exploit|outflow|lawsuit|ban|bear|selloff|liquidat|plunge|tumble)/.test(lower)) {
    return 'BEARISH';
  }
  return 'NEUTRAL';
}

function formatPublishedLabel(pubDateRaw: string): string {
  const parsed = Date.parse(pubDateRaw);
  if (!Number.isFinite(parsed)) return 'Сегодня';
  const diffMin = Math.max(0, Math.round((Date.now() - parsed) / 60_000));
  if (diffMin <= 2) return 'только что';
  if (diffMin < 60) return `${diffMin} мин назад`;
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `${diffHours} ч назад`;
  return new Date(parsed).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}

interface RssFeedSource {
  id: string;
  label: string;
  url: string;
  fallbackLink: string;
}

const CRYPTO_RSS_SOURCES: RssFeedSource[] = [
  {
    id: 'coindesk',
    label: 'CoinDesk',
    url: 'https://www.coindesk.com/arc/outboundfeeds/rss/',
    fallbackLink: 'https://www.coindesk.com/',
  },
  {
    id: 'cointelegraph',
    label: 'Cointelegraph',
    url: 'https://cointelegraph.com/rss',
    fallbackLink: 'https://cointelegraph.com/',
  },
  {
    id: 'decrypt',
    label: 'Decrypt',
    url: 'https://decrypt.co/feed',
    fallbackLink: 'https://decrypt.co/',
  },
];

async function fetchSingleRssFeed(
  source: RssFeedSource,
  timeoutMs = 5000
): Promise<Array<GroundedNewsItem & { publishedAtMs: number }>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(source.url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
        'User-Agent': 'Vernier-Terminal/1.0',
      },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const itemMatches = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
    const results: Array<GroundedNewsItem & { publishedAtMs: number }> = [];
    for (let idx = 0; idx < Math.min(12, itemMatches.length); idx++) {
      const block = itemMatches[idx];
      const title = stripHtmlAndCdata(block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '');
      if (!title || title.length < 6) continue;
      const link = stripHtmlAndCdata(block.match(/<link>([\s\S]*?)<\/link>/i)?.[1] ?? source.fallbackLink);
      const desc = stripHtmlAndCdata(
        block.match(/<description>([\s\S]*?)<\/description>/i)?.[1] ?? ''
      );
      const pubDate = stripHtmlAndCdata(block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] ?? '');
      const parsedMs = Date.parse(pubDate);
      const publishedAtMs = Number.isFinite(parsedMs) ? parsedMs : Date.now() - idx * 600_000;
      const combined = `${title} ${desc}`;
      const asset = inferAssetFromText(combined);
      const sentiment = inferSentimentFromText(combined);
      const summary = desc && desc.length > 20 ? desc.slice(0, 260) : title;
      results.push({
        id: `rss_${source.id}_${idx}_${publishedAtMs}`,
        title,
        summary,
        asset,
        sentiment,
        impact: asset === 'BTC' || asset === 'ETH' || /sec|fed|etf|fomc|cpi/i.test(combined) ? 'HIGH' : 'MEDIUM',
        publishedLabel: formatPublishedLabel(pubDate),
        sourceTitle: source.label,
        sourceUrl: link.startsWith('http') ? link : source.fallbackLink,
        publishedAtMs,
      });
    }
    return results;
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchMultiSourceCryptoNews(
  symbolFilter = 'ALL',
  forceRefresh = false
): Promise<{ items: GroundedNewsItem[]; updatedAt: string }> {
  const now = Date.now();
  if (forceRefresh || !rssNewsCache || rssNewsCache.expiresAt <= now) {
    try {
      const settled = await Promise.allSettled(CRYPTO_RSS_SOURCES.map((src) => fetchSingleRssFeed(src, 5500)));
      const merged: Array<GroundedNewsItem & { publishedAtMs: number }> = [];
      for (const entry of settled) {
        if (entry.status === 'fulfilled') {
          merged.push(...entry.value);
        }
      }

      // Deduplicate by normalized headline and sort strictly newest-first
      const seenTitles = new Set<string>();
      const uniqueSorted = merged
        .sort((a, b) => b.publishedAtMs - a.publishedAtMs)
        .filter((item) => {
          const norm = item.title.toLowerCase().replace(/[^a-z0-9а-яё]+/g, ' ').trim();
          if (!norm || seenTitles.has(norm)) return false;
          seenTitles.add(norm);
          return true;
        })
        .slice(0, 24);

      if (uniqueSorted.length > 0) {
        rssNewsCache = {
          expiresAt: Date.now() + RSS_CACHE_TTL_MS,
          updatedAt: new Date().toISOString(),
          items: uniqueSorted,
        };
      }
    } catch {
      // Keep stale RSS cache on transient outage
    }
  }

  const allItems = (rssNewsCache?.items ?? []).map(({ publishedAtMs: _ts, ...rest }) => rest);
  const updatedAt = rssNewsCache?.updatedAt ?? new Date().toISOString();
  if (!symbolFilter || symbolFilter === 'ALL') {
    return { items: allItems.slice(0, 8), updatedAt };
  }
  const base = symbolFilter.replace('USDT', '').toUpperCase();
  const matched = allItems.filter(
    (item) => item.asset === base || item.title.toUpperCase().includes(base)
  );
  return {
    items: (matched.length >= 2 ? matched : allItems).slice(0, 8),
    updatedAt,
  };
}

export async function fetchGroundedCryptoNews(
  symbolFilter = 'ALL',
  forceRefresh = false
): Promise<GroundedNewsResponse> {
  const cacheKey = `news:${symbolFilter}`;
  const cached = !forceRefresh ? newsCache.get(cacheKey) : undefined;
  if (cached && cached.expiresAt > Date.now()) {
    return { items: cached.items, grounded: true, source: 'gemini', updatedAt: cached.updatedAt };
  }

  const existingInFlight = !forceRefresh ? newsInFlight.get(cacheKey) : undefined;
  if (existingInFlight) {
    return existingInFlight;
  }

  const task = (async (): Promise<GroundedNewsResponse> => {
    const todayIso = new Date().toISOString().slice(0, 10);
    const topic =
      symbolFilter && symbolFilter !== 'ALL'
        ? `криптовалюта ${symbolFilter.replace('USDT', '')} и общий крипторынок`
        : 'криптовалютный рынок Bitcoin Ethereum Solana TON ETF регуляция деривативы';

    try {
      const response = await callGeminiWithBackoff('news', (ai) =>
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `Сегодня ${todayIso}. Найди 6 самых свежих и значимых новостей за последние 24 часа по теме: ${topic}.
Для каждой новости верни заголовок на русском, краткую рыночную суть (2 предложения), тикер актива (BTC, ETH, SOL, TON, BNB или MARKET), настроение (BULLISH, BEARISH или NEUTRAL) и степень влияния (HIGH, MEDIUM или LOW).
Формат ответа — строго JSON-массив объектов с полями: title, summary, asset, sentiment, impact, publishedLabel.`,
          config: {
            tools: [{ googleSearch: {} }],
            systemInstruction:
              'Ты аналитик криптовалютного деска. Пиши кратко, по делу, на русском языке. Возвращай валидный JSON массив без markdown-обертки.',
          },
        })
      );

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
          const updatedAt = new Date().toISOString();
          newsCache.set(cacheKey, {
            expiresAt: Date.now() + NEWS_CACHE_TTL_MS,
            updatedAt,
            items,
          });
          return { items, grounded: true, source: 'gemini', updatedAt };
        }
      }

      throw new AiServiceError(
        502,
        'EMPTY_RESPONSE',
        'Поиск Gemini не вернул структурированный список новостей.'
      );
    } catch (err) {
      const isQuotaOrKey =
        err instanceof AiServiceError &&
        (err.code === 'RESOURCE_EXHAUSTED' || err.code === 'MISSING_API_KEY');
      const liveRss = await fetchMultiSourceCryptoNews(symbolFilter, forceRefresh);
      if (liveRss.items.length > 0) {
        return {
          items: liveRss.items,
          grounded: false,
          source: 'rss',
          updatedAt: liveRss.updatedAt,
          notice: isQuotaOrKey
            ? 'Прямая лента CoinDesk, Cointelegraph и Decrypt с мгновенным локальным RU/EN переводом.'
            : 'Прямая лента CoinDesk, Cointelegraph и Decrypt.',
        };
      }

      return {
        items: [],
        grounded: false,
        source: 'unavailable',
        updatedAt: new Date().toISOString(),
        notice:
          err instanceof AiServiceError
            ? err.message
            : 'Не удалось обновить новостную ленту.',
      };
    } finally {
      newsInFlight.delete(cacheKey);
    }
  })();

  if (!forceRefresh) {
    newsInFlight.set(cacheKey, task);
  }
  return task;
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

export interface EconomicCalendarResponse {
  events: EconomicCalendarEvent[];
  grounded: boolean;
  source: 'gemini' | 'live_feeds';
  notice?: string;
  updatedAt: string;
}

const CALENDAR_CACHE_TTL_MS = 5 * 60_000;
const calendarCache = new Map<
  string,
  { expiresAt: number; response: EconomicCalendarResponse }
>();
let calendarInFlight: Promise<EconomicCalendarResponse> | null = null;

function formatShortRuDateFromMs(ms: number): string {
  return new Date(ms).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', timeZone: 'UTC' }).replace('.', '');
}

function formatUtcHhMm(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm} UTC`;
}

function formatShortRuDate(offsetDays: number): string {
  return formatShortRuDateFromMs(Date.now() + offsetDays * 86_400_000);
}

async function fetchJsonSafe<T>(url: string, timeoutMs = 4500): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Vernier-Terminal/1.0',
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchXmlTextSafe(url: string, timeoutMs = 4500): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
        'User-Agent': 'Vernier-Terminal/1.0',
      },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function parseDeribitExpiryMs(instrumentName: string): number | null {
  // Format: BTC-28NOV26-90000-C
  const part = instrumentName.split('-')[1];
  if (!part) return null;
  const match = part.match(/^(\d{1,2})([A-Z]{3})(\d{2})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const monthIdx = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'].indexOf(
    match[2]
  );
  const year = 2000 + Number(match[3]);
  if (monthIdx < 0 || !Number.isFinite(day) || !Number.isFinite(year)) return null;
  return Date.UTC(year, monthIdx, day, 8, 0, 0);
}

async function fetchLiveFallbackCalendar(): Promise<EconomicCalendarEvent[]> {
  const [fedXml, investingXml, deribitBtc, deribitEth, okxBtcFunding, okxEthFunding] = await Promise.all([
    fetchXmlTextSafe('https://www.federalreserve.gov/feeds/press_all.xml'),
    fetchXmlTextSafe('https://www.investing.com/rss/news_14.rss'),
    fetchJsonSafe<{
      result?: Array<{ instrument_name?: string; open_interest?: number; underlying_price?: number }>;
    }>('https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option'),
    fetchJsonSafe<{
      result?: Array<{ instrument_name?: string; open_interest?: number; underlying_price?: number }>;
    }>('https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=ETH&kind=option'),
    fetchJsonSafe<{
      data?: Array<{ fundingRate?: string; fundingTime?: string; nextFundingTime?: string }>;
    }>('https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP'),
    fetchJsonSafe<{
      data?: Array<{ fundingRate?: string; fundingTime?: string; nextFundingTime?: string }>;
    }>('https://www.okx.com/api/v5/public/funding-rate?instId=ETH-USDT-SWAP'),
  ]);

  const events: Array<EconomicCalendarEvent & { sortMs: number }> = [];
  const nowMs = Date.now();

  // 1. Live OKX 8h Perpetual Funding Settlements
  const fundingPairs: Array<{
    asset: 'BTC' | 'ETH';
    res: typeof okxBtcFunding;
  }> = [
    { asset: 'BTC', res: okxBtcFunding },
    { asset: 'ETH', res: okxEthFunding },
  ];
  for (const fp of fundingPairs) {
    const row = fp.res?.data?.[0];
    if (!row) continue;
    const nextMs = Number(row.nextFundingTime || row.fundingTime || nowMs + 4 * 3600_000);
    const ratePct = Number(row.fundingRate || 0) * 100;
    const rateStr = `${ratePct >= 0 ? '+' : ''}${ratePct.toFixed(4)}%`;
    events.push({
      id: `okx_funding_${fp.asset}_${nextMs}`,
      sortMs: nextMs,
      dateLabel: formatShortRuDateFromMs(nextMs),
      timeUtcLabel: formatUtcHhMm(nextMs),
      regionOrAsset: `${fp.asset} · Деривативы`,
      category: 'derivatives',
      title: `Расчёт ставки финансирования ${fp.asset}-USDT-SWAP (OKX 8h)`,
      description:
        ratePct > 0.03
          ? 'Перегретый положительный фандинг — лонги платят шортам, возможен краткосрочный сквиз.'
          : ratePct < -0.01
            ? 'Отрицательный фандинг — доминируют короткие позиции, риск шорт-сквиза.'
            : 'Сбалансированная ставка финансирования бессрочных фьючерсов без экстремального перекоса.',
      impact: Math.abs(ratePct) >= 0.03 ? 'HIGH' : 'MEDIUM',
      previous: '0.0100%',
      forecast: rateStr,
      actual: rateStr,
      marketBias: ratePct > 0.03 ? 'VOLATILITY' : ratePct < -0.01 ? 'BULLISH' : 'NEUTRAL',
      sourceUrl: 'https://www.okx.com/trade-swap/btc-usdt-swap',
    });
  }

  // 2. Live Deribit Option Expirations (grouped by nearest upcoming expiry date)
  const deribitSets: Array<{ asset: 'BTC' | 'ETH'; res: typeof deribitBtc }> = [
    { asset: 'BTC', res: deribitBtc },
    { asset: 'ETH', res: deribitEth },
  ];
  for (const ds of deribitSets) {
    const list = ds.res?.result ?? [];
    if (list.length === 0) continue;
    const byExpiry = new Map<number, { oiUsd: number; contracts: number }>();
    for (const item of list) {
      if (!item.instrument_name) continue;
      const expMs = parseDeribitExpiryMs(item.instrument_name);
      if (!expMs || expMs < nowMs - 3600_000) continue;
      const oi = Number(item.open_interest || 0);
      const spot = Number(item.underlying_price || (ds.asset === 'BTC' ? 65000 : 2500));
      const cur = byExpiry.get(expMs) ?? { oiUsd: 0, contracts: 0 };
      cur.oiUsd += oi * spot;
      cur.contracts += oi;
      byExpiry.set(expMs, cur);
    }
    const upcomingExpiries = Array.from(byExpiry.entries())
      .sort((a, b) => a[0] - b[0])
      .slice(0, 2);

    for (const [expMs, stats] of upcomingExpiries) {
      const oiMillions = stats.oiUsd / 1_000_000;
      const oiLabel = oiMillions >= 1000 ? `$${(oiMillions / 1000).toFixed(2)}B OI` : `$${Math.round(oiMillions)}M OI`;
      events.push({
        id: `deribit_exp_${ds.asset}_${expMs}`,
        sortMs: expMs,
        dateLabel: formatShortRuDateFromMs(expMs),
        timeUtcLabel: '08:00 UTC',
        regionOrAsset: `${ds.asset} · Опционы Deribit`,
        category: 'derivatives',
        title: `Экспирация опционов ${ds.asset} на Deribit (${Math.round(stats.contracts).toLocaleString('en-US')} контр.)`,
        description:
          'Закрытие открытого интереса на Deribit часто вызывает рост волатильности около уровней Max Pain перед расчётом в 08:00 UTC.',
        impact: oiMillions >= 250 ? 'HIGH' : 'MEDIUM',
        previous: '—',
        forecast: oiLabel,
        actual: 'Ожидается',
        marketBias: 'VOLATILITY',
        sourceUrl: `https://www.deribit.com/options/${ds.asset}`,
      });
    }
  }

  // 3. Federal Reserve Official Press & Monetary Policy Releases
  if (fedXml) {
    const fedItems = fedXml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
    for (let i = 0; i < Math.min(3, fedItems.length); i++) {
      const block = fedItems[i];
      const title = stripHtmlAndCdata(block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '');
      const link = stripHtmlAndCdata(block.match(/<link>([\s\S]*?)<\/link>/i)?.[1] ?? 'https://www.federalreserve.gov/');
      const pubDate = stripHtmlAndCdata(block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] ?? '');
      if (!title) continue;
      const pubMs = Date.parse(pubDate);
      const safeMs = Number.isFinite(pubMs) ? pubMs : nowMs - i * 3600_000;
      const isHigh = /fomc|rate|monetary|policy|inflation|minutes|powell/i.test(title);
      events.push({
        id: `fed_rss_${i}_${safeMs}`,
        sortMs: safeMs,
        dateLabel: formatShortRuDateFromMs(safeMs),
        timeUtcLabel: formatUtcHhMm(safeMs),
        regionOrAsset: 'USD · ФРС США',
        category: 'macro',
        title: `ФРС США: ${title}`,
        description:
          'Официальный релиз Федеральной резервной системы США. Влияет на доходность трежерис, DXY и риск-аппетит в BTC/ETH.',
        impact: isHigh ? 'HIGH' : 'MEDIUM',
        previous: '—',
        forecast: 'Релиз ФРС',
        actual: 'Опубликовано',
        marketBias: 'VOLATILITY',
        sourceUrl: link.startsWith('http') ? link : 'https://www.federalreserve.gov/',
      });
    }
  }

  // 4. Investing.com Economy & Macro Headlines RSS
  if (investingXml) {
    const invItems = investingXml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
    for (let i = 0; i < Math.min(4, invItems.length); i++) {
      const block = invItems[i];
      const title = stripHtmlAndCdata(block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '');
      const link = stripHtmlAndCdata(block.match(/<link>([\s\S]*?)<\/link>/i)?.[1] ?? 'https://www.investing.com/economic-calendar/');
      const pubDate = stripHtmlAndCdata(block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] ?? '');
      if (!title) continue;
      const pubMs = Date.parse(pubDate);
      const safeMs = Number.isFinite(pubMs) ? pubMs : nowMs - i * 3600_000;
      const isMacro = /cpi|ppi|gdp|payroll|jobs|fed|inflation|ecb|treasury|rate|bitcoin|crypto/i.test(title);
      events.push({
        id: `inv_macro_${i}_${safeMs}`,
        sortMs: safeMs,
        dateLabel: formatShortRuDateFromMs(safeMs),
        timeUtcLabel: formatUtcHhMm(safeMs),
        regionOrAsset: /bitcoin|crypto|ethereum/i.test(title) ? 'BTC · Макро-фон' : 'USD · Макроэкономика',
        category: /bitcoin|crypto|ethereum/i.test(title) ? 'crypto' : 'macro',
        title,
        description:
          'Оперативная макроэкономическая публикация с глобальных рынков капитала (Investing Economy Feed).',
        impact: isMacro ? 'HIGH' : 'MEDIUM',
        previous: '—',
        forecast: 'Макро-фон',
        actual: 'Вышло',
        marketBias: inferSentimentFromText(title) === 'NEUTRAL' ? 'VOLATILITY' : inferSentimentFromText(title),
        sourceUrl: link.startsWith('http') ? link : 'https://www.investing.com/economic-calendar/',
      });
    }
  }

  // Sort upcoming/recent events by closest time to now and strip helper field
  return events
    .sort((a, b) => Math.abs(a.sortMs - nowMs) - Math.abs(b.sortMs - nowMs))
    .slice(0, 10)
    .map(({ sortMs: _s, ...ev }) => ev);
}

export async function fetchEconomicCalendar(forceRefresh = false): Promise<EconomicCalendarResponse> {
  const cacheKey = 'calendar:global';
  const cached = !forceRefresh ? calendarCache.get(cacheKey) : undefined;
  if (cached && cached.expiresAt > Date.now()) {
    return cached.response;
  }

  if (!forceRefresh && calendarInFlight) {
    return calendarInFlight;
  }

  const task = (async (): Promise<EconomicCalendarResponse> => {
    const todayIso = new Date().toISOString().slice(0, 10);
    try {
      const response = await callGeminiWithBackoff('calendar', (ai) =>
        ai.models.generateContent({
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
        })
      );

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
          const resPayload: EconomicCalendarResponse = {
            events,
            grounded: true,
            source: 'gemini',
            updatedAt: new Date().toISOString(),
          };
          calendarCache.set(cacheKey, {
            expiresAt: Date.now() + CALENDAR_CACHE_TTL_MS,
            response: resPayload,
          });
          return resPayload;
        }
      }

      throw new AiServiceError(
        502,
        'EMPTY_RESPONSE',
        'Экономический календарь Gemini вернул пустой ответ.'
      );
    } catch {
      const liveEvents = await fetchLiveFallbackCalendar();
      if (liveEvents.length > 0) {
        const fallbackPayload: EconomicCalendarResponse = {
          events: liveEvents,
          grounded: false,
          source: 'live_feeds',
          updatedAt: new Date().toISOString(),
          notice:
            'Показаны живые данные деривативов и макро-ленты (Deribit, OKX Funding, ФРС США и Investing RSS).',
        };
        calendarCache.set(cacheKey, {
          expiresAt: Date.now() + 2 * 60_000,
          response: fallbackPayload,
        });
        return fallbackPayload;
      }
      throw new AiServiceError(
        503,
        'CALENDAR_UNAVAILABLE',
        'Не удалось получить данные экономического календаря. Повторите попытку чуть позже.'
      );
    } finally {
      if (!forceRefresh) {
        calendarInFlight = null;
      }
    }
  })();

  if (!forceRefresh) {
    calendarInFlight = task;
  }
  return task;
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
  planTier?: 'free' | 'pro' | 'max';
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
  const { indicators, marketType, symbol, timeframe, strategyName, strategyRules, depositUsdt, riskPerTradePct, leverage, isPro, planTier } =
    req;
  const isMax = planTier === 'max';

  // Reuse cached Gemini news or multi-source live RSS digest to avoid making 2 Gemini calls per analysis
  const cachedNews = newsCache.get(`news:${symbol}`) ?? newsCache.get('news:ALL');
  const newsItems =
    cachedNews && cachedNews.expiresAt > Date.now()
      ? cachedNews.items
      : (await fetchMultiSourceCryptoNews(symbol)).items;
  const relevantNews = newsItems.slice(0, isMax ? 6 : isPro ? 4 : 2);
  const newsDigest =
    relevantNews.length > 0
      ? relevantNews.map((n) => `- [${n.sentiment}] ${n.title}: ${n.summary}`).join('\n')
      : '- Свежие заголовки по активу не обнаружены; ориентируйся на ценовую структуру и индикаторы.';

  const safeLeverage = marketType === 'spot' ? 1 : Math.min(Math.max(1, leverage), 20);
  const riskAmountUsdt = Number(((depositUsdt * riskPerTradePct) / 100).toFixed(2));
  const slDistancePct = Math.max(0.6, Math.min(6.5, (indicators.atr14 * 1.5 * 100) / indicators.lastPrice));
  const rawPositionUsdt = (riskAmountUsdt * 100) / slDistancePct;
  const maxNotional = depositUsdt * safeLeverage;
  const positionSizeUsdt = Number(Math.min(rawPositionUsdt, maxNotional).toFixed(2));

  const depthLabel = isMax
    ? 'ИНСТИТУЦИОНАЛЬНЫЙ MAX (глубокий мульти-факторный и макро-разбор по 6 источникам, три цели TP1-TP3 с распределением фиксации, оценка волатильности и хеджирования риска)'
    : isPro
      ? 'ПОЛНЫЙ PRO (детальный мульти-факторный разбор, три цели TP1-TP3, катализаторы и условия отмены)'
      : 'БАЗОВЫЙ (сдержанный разбор по основной структуре)';

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

Уровень глубины анализа: ${depthLabel}.
Помни: для СПОТ рынка направление не может быть SHORT — только LONG или WAIT. Для ФЬЮЧЕРСОВ допустимы LONG, SHORT или WAIT.`;

  const response = await callGeminiWithBackoff('analyze', (ai) =>
    ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        systemInstruction:
          'Ты риск-аналитик криптовалютного терминала Vernier. Давай строгий, взвешенный технический и новостной разбор на русском языке без гарантий доходности.',
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
    })
  );

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

  const tps =
    Array.isArray(parsed.takeProfits) && parsed.takeProfits.length >= 1
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
    entryZone: String(
      parsed.entryZone ||
        `${formatPrice(indicators.lastPrice * 0.995)} – ${formatPrice(indicators.lastPrice * 1.005)}`
    ),
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
      parsed.invalidationRule ||
        `Закрытие свечи ${timeframe} ниже ключевой зоны ${formatPrice(indicators.supportLevel)}.`
    ),
    summary: String(parsed.summary || '').slice(0, 2400),
    riskMetrics: {
      riskAmountUsdt,
      positionSizeUsdt,
      recommendedLeverage: safeLeverage,
      estimatedLiquidationPrice,
    },
  };
}

export interface TerminalChatTurn {
  role: 'user' | 'model';
  text: string;
}

const TERMINAL_ASSISTANT_INSTRUCTION = `Ты — встроенный справочный ассистент криптотерминала Vernier. Отвечай строго на русском языке, кратко, чётко и по делу (обычно 2–5 предложений или компактный список шагов).

Реальные возможности терминала Vernier (используй только эти факты, ничего не выдумывай):
1. Раздел «Рынок» (главный экран):
   - 44 ликвидные пары в режимах «Спот» и «Фьючерсы USDT-M» (BTC, ETH, SOL, ADA, DOT, LINK, UNI, POL с поиском по алиасу MATIC, RENDER/RNDR, TON, XRP, AVAX, NEAR, ARB, OP, SUI, APT и др.).
   - Строка быстрого поиска сверху мгновенно находит пары по тикеру, названию, алиасу или категории (DeFi, L1, L2, AI).
   - Быстрые фильтры: «Все пары», «Топ объём», «Волатильность», «Новые листинги», «Любимые» (звёздочка) + сортировка.
   - Кнопка «Колонки» открывает меню выбора отображаемых столбцов (Цена, 24ч %, Объём 24ч, Капитализация, График 24ч / sparkline); настройки сохраняются локально.
   - На графике доступны таймфреймы 15M, 1H, 4H, 1D, индикаторы MA Ribbon, EMA, Bollinger Bands (BB), RSI (14), ATR%, уровни поддержки/сопротивления и индекс страха и жадности.
2. Стратегии и тарифная модель (Free vs PRO):
   - Всего в терминале 9 стратегий: 4 базовые доступны на Free (3 Спот + 1 Фьючерсы: «DCA и накопление», «Импульсный пробой тренда», «Возврат к среднему Bollinger», «Трендовый импульс с ATR-стопом») и 5 продвинутых стратегий открываются только на тарифе PRO («Волновой откат к EMA Ribbon», «Сжатие волатильности BB Squeeze», «Снятие ликвидности и Ордер-флоу», «Контртренд перегретого Funding», «Пробой ATR + Open Interest»).
   - На тарифе Free даётся 15 бесплатных кредитов на 7 дней:
     * AI-анализ пары на Спот — 1 кредит;
     * Глубокий AI-анализ Фьючерсов (с Funding Rate, Open Interest и ценой ликвидации) — 2 кредита;
     * Ручной пересчёт симуляции бэктеста PnL с новыми параметрами — 1 кредит.
   - Ограничения Free: макс. плечо на Фьючерсах до 5x, лимит 1 сигнал/день на стратегию, 1H бэктест по активным стратегиям.
   - Тариф PRO начисляет 100 кредитов в месяц (Spot-анализ 1 кр., Futures 2 кр., бэктест 1 кр.), полностью снимает ограничения на количество сигналов в день (∞/день или свой порог 1–100), открывает все 9 стратегий, Биржевой стакан ордеров (Order Book TOP-10), конструктор периодов MA Ribbon (EMA/SMA), фьючерсное плечо до 20x, сравнение всех 9 стратегий и 4H-бэктест, а также экспорт скринера рынка в CSV. Оплата PRO работает через NOWPayments.
3. Алерты и Web Push-уведомления:
   - Значок колокольчика «Уведомить» в списке активов, ленте или панели графика открывает установку ценового алерта (выше/ниже целевой цены) без ухода с экрана.
   - В разделе «Безопасность → Push» можно подключить фоновые Web Push-уведомления и включить переключатель «Резкие скачки волатильности» с порогом >3%, >5% (по умолчанию) или >10% за час, а также проверить доставку кнопкой «Тест Push».
4. Бумажный портфель, Скринер, Новости и Календарь:
   - Вкладка «Скринер» содержит фильтры рынка, карту импульса, экспорт в CSV (PRO) и бумажный портфель для расчёта PnL и аллокации без риска реальными средствами.
   - Вкладка «Новости» показывает ленту криптоновостей и экономический календарь макрособытий (США CPI/ФРС, ETF, опционы Deribit).
5. Безопасность и Android PWA:
   - Терминал работает по Non-Custodial модели: торговые или выводные API-ключи бирж не запрашиваются и не хранятся.
   - В разделе «Безопасность» можно включить TOTP 2FA (Google Authenticator / Authy, RFC 6238, AES-256-GCM + 8 одноразовых резервных кодов), настроить автоблокировку (5–60 мин) и управлять активными сессиями на карте устройств.
   - На Android в Chrome нажмите «Установить PWA» в верхней панели (или меню браузера ⋮ → «Установить приложение»). Доступны и виджеты для главного экрана.

Если вопрос выходит за рамки работы терминала (например, проблемы с конкретным платежом или аккаунтом) или требует индивидуального разбора — предложи воспользоваться кнопкой «Связаться с поддержкой». Не давай индивидуальных финансовых рекомендаций о покупке или продаже активов.`;

export async function askTerminalAssistant(params: {
  message: string;
  history?: TerminalChatTurn[];
}): Promise<string> {
  const cleanMessage = params.message.trim().slice(0, 800);
  if (cleanMessage.length < 2) {
    throw new AiServiceError(400, 'INVALID_ARGUMENT', 'Введите вопрос (минимум 2 символа).');
  }

  const rawHistory = (params.history ?? [])
    .filter(
      (turn): turn is TerminalChatTurn =>
        (turn.role === 'user' || turn.role === 'model') &&
        typeof turn.text === 'string' &&
        turn.text.trim().length > 0
    )
    .slice(-8);

  // Enforce strict alternating user -> model turns ending on model before sendMessage
  const alternatingTurns: TerminalChatTurn[] = [];
  for (const turn of rawHistory) {
    if (alternatingTurns.length === 0 && turn.role !== 'user') continue;
    const prev = alternatingTurns[alternatingTurns.length - 1];
    if (prev && prev.role === turn.role) continue;
    alternatingTurns.push(turn);
  }
  if (alternatingTurns.length > 0 && alternatingTurns[alternatingTurns.length - 1].role === 'user') {
    alternatingTurns.pop();
  }

  const sanitizedHistory = alternatingTurns.map((turn) => ({
    role: turn.role,
    parts: [{ text: turn.text.trim().slice(0, 1200) }],
  }));

  const response = await callGeminiWithBackoff(
    'support-chat',
    async (ai) => {
      const chat = ai.chats.create({
        model: 'gemini-4-hydrogen',
        history: sanitizedHistory,
        config: {
          systemInstruction: TERMINAL_ASSISTANT_INSTRUCTION,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });
      return chat.sendMessage({ message: cleanMessage });
    },
    { maxAttempts: 1, timeoutMs: 8500 }
  );

  const reply = (response.text ?? '').trim();
  if (!reply) {
    throw new AiServiceError(
      502,
      'EMPTY_RESPONSE',
      'Ассистент Gemini вернул пустой ответ. Попробуйте переформулировать вопрос.'
    );
  }
  return reply.slice(0, 2400);
}

const newsTranslationCache = new Map<string, { title: string; summary: string; ts: number }>();
const NEWS_TRANSLATION_TTL_MS = 6 * 60 * 60 * 1000;

export interface NewsTranslateInput {
  id: string;
  title: string;
  summary: string;
}

const FALLBACK_CRYPTO_PHRASE_DICT: Array<[RegExp, string]> = [
  [/\bUS CPI\b/gi, 'Индекс инфляции США (CPI)'],
  [/\bCore CPI\b/gi, 'Базовая инфляция США (Core CPI)'],
  [/\bFOMC Interest Rate Decision\b/gi, 'Решение ФРС США по процентной ставке'],
  [/\bFed Interest Rate Decision\b/gi, 'Решение ФРС по процентной ставке'],
  [/\bFOMC Minutes\b/gi, 'Протоколы заседания ФРС (FOMC)'],
  [/\bNon-?Farm Payrolls\b/gi, 'Занятость вне сельского хозяйства США (NFP)'],
  [/\bInitial Jobless Claims\b/gi, 'Первичные заявки по безработице США'],
  [/\bCore PCE Price Index\b/gi, 'Базовый индекс расходов PCE США'],
  [/\bPCE Price Index\b/gi, 'Индекс инфляции PCE США'],
  [/\bProducer Price Index\b|\bUS PPI\b/gi, 'Индекс цен производителей США (PPI)'],
  [/\bGDP Growth Rate\b/gi, 'Темпы роста ВВП'],
  [/\bOptions Expiry\b/gi, 'Экспирация опционов'],
  [/\bToken Unlock\b/gi, 'Разблокировка токенов'],
  [/\bSpot Bitcoin ETF\b/gi, 'Спотовый Bitcoin ETF'],
  [/\bSpot Ethereum ETF\b/gi, 'Спотовый Ethereum ETF'],
  [/\bBitcoin ETF\b/gi, 'Bitcoin ETF'],
  [/\bEthereum ETF\b/gi, 'Ethereum ETF'],
  [/\bnet inflows?\b/gi, 'чистый приток капитала'],
  [/\bnet outflows?\b/gi, 'чистый отток капитала'],
  [/\ball[- ]time high\b/gi, 'исторический максимум'],
  [/\bprice surges?\b/gi, 'цена резко растёт'],
  [/\bprice drops?\b/gi, 'цена снижается'],
  [/\binterest rates?\b/gi, 'процентные ставки'],
  [/\bfederal reserve\b/gi, 'ФРС США'],
  [/\bmarket cap\b/gi, 'рыночная капитализация'],
  [/\bopen interest\b/gi, 'открытый интерес (OI)'],
  [/\bfunding rate\b/gi, 'ставка финансирования'],
  [/\bliquidations?\b/gi, 'ликвидации'],
  [/\bwhale(s)?\b/gi, 'крупные держатели (киты)'],
  [/\bexchange(s)?\b/gi, 'криптобиржа'],
  [/\bregulation\b/gi, 'регулирование'],
  [/\bstablecoin(s)?\b/gi, 'стейблкоины'],
  [/\bmining\b/gi, 'майнинг'],
  [/\bstaking\b/gi, 'стейкинг'],
  [/\bapproval\b/gi, 'одобрение'],
  [/\blaunches?\b/gi, 'запускает'],
  [/\bannounces?\b/gi, 'объявляет'],
  [/\bpartners with\b/gi, 'заключает партнёрство с'],
  [/\braises?\b/gi, 'привлекает'],
  [/\brallies\b|\brally\b/gi, 'ралли'],
  [/\bplunge(s)?\b|\bcrash(es)?\b/gi, 'резкое падение'],
  [/\bbreakout\b/gi, 'пробой уровня'],
  [/\bvolatility\b/gi, 'волатильность'],
  [/\binflation\b/gi, 'инфляция'],
  [/\bBitcoin\b/g, 'Биткоин (BTC)'],
  [/\bEthereum\b/g, 'Эфириум (ETH)'],
  [/\bSolana\b/g, 'Solana (SOL)'],
];

function fallbackTranslateCryptoTextToRu(text: string): string {
  let out = decodeHtmlEntitiesServer(text);
  if (!out || /[А-Яа-яЁё]/.test(out)) return out;
  for (const [pattern, replacement] of FALLBACK_CRYPTO_PHRASE_DICT) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * Translates full English crypto news headlines, summaries, and economic calendar events
 * into natural Russian using Gemini structured output with in-memory caching + fallback dictionary.
 */
export async function translateNewsBatchToRussian(
  items: NewsTranslateInput[]
): Promise<Record<string, { title: string; summary: string }>> {
  const now = Date.now();
  const result: Record<string, { title: string; summary: string }> = {};
  const toTranslate: NewsTranslateInput[] = [];

  for (const item of items.slice(0, 24)) {
    const id = String(item.id || '').slice(0, 120);
    const title = decodeHtmlEntitiesServer(String(item.title || '')).trim().slice(0, 260);
    const summary = decodeHtmlEntitiesServer(String(item.summary || '')).trim().slice(0, 600);
    if (!id || !title) continue;

    const cached = newsTranslationCache.get(id);
    if (cached && now - cached.ts < NEWS_TRANSLATION_TTL_MS) {
      result[id] = { title: cached.title, summary: cached.summary };
      continue;
    }

    // Already Russian — keep verbatim (with decoded entities)
    if (/[А-Яа-яЁё]/.test(title) && (!summary || /[А-Яа-яЁё]/.test(summary))) {
      result[id] = { title, summary };
      newsTranslationCache.set(id, { title, summary, ts: now });
      continue;
    }

    toTranslate.push({ id, title, summary });
  }

  if (toTranslate.length === 0) {
    return result;
  }

  const applyFallback = () => {
    for (const item of toTranslate) {
      if (result[item.id]) continue;
      const fbTitle = fallbackTranslateCryptoTextToRu(item.title);
      const fbSummary = item.summary ? fallbackTranslateCryptoTextToRu(item.summary) : '';
      result[item.id] = { title: fbTitle, summary: fbSummary };
    }
  };

  const ai = getAiClient();
  if (!ai || now < geminiQuotaCooldownUntil) {
    applyFallback();
    return result;
  }

  try {
    const prompt = [
      'Переведи каждый заголовок (title) и краткое описание (summary) криптоновостей или событий экономического календаря целиком на естественный, грамотный деловой русский язык.',
      'Сохраняй тикеры и аббревиатуры (BTC, ETH, SOL, USDT, ETF, DeFi, SEC, FOMC, CPI, PPI, NFP, PCE, Deribit, OKX) в оригинале, не оставляй непереведённых английских фраз внутри русского предложения.',
      'Верни JSON-массив объектов с полями id, title, summary в точном соответствии с переданными id.',
      '',
      JSON.stringify(toTranslate),
    ].join('\n');

    const response = await callGeminiWithBackoff(
      'news-translate',
      (client) =>
        client.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: prompt,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  title: { type: Type.STRING },
                  summary: { type: Type.STRING },
                },
                required: ['id', 'title', 'summary'],
              },
            },
          },
        }),
      { maxAttempts: 1, timeoutMs: 12000 }
    );

    const parsed = JSON.parse(response.text || '[]') as Array<{
      id?: string;
      title?: string;
      summary?: string;
    }>;

    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        if (!entry?.id || !entry?.title) continue;
        const cleanTitle = decodeHtmlEntitiesServer(String(entry.title)).trim();
        const cleanSummary = decodeHtmlEntitiesServer(String(entry.summary ?? '')).trim();
        if (cleanTitle) {
          result[entry.id] = { title: cleanTitle, summary: cleanSummary };
          newsTranslationCache.set(entry.id, {
            title: cleanTitle,
            summary: cleanSummary,
            ts: now,
          });
        }
      }
    }
  } catch {
    // Graceful fallback dictionary when Gemini is momentarily unavailable
  }

  applyFallback();
  return result;
}

