import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import http from 'http';
import path from 'path';
import QRCode from 'qrcode';
import { createServer as createViteServer } from 'vite';
import { serverLogger } from './server/logger.ts';
import { applySecurityHeaders } from './server/middleware/securityHeaders.ts';
import { isAllowedPushEndpoint, requireAuth, verifyFirebaseIdToken } from './server/auth.ts';
import {
  createCheckout,
  getMaxMultiplierPlans,
  getPlanPrices,
  getTieredPlanPrices,
  isBillingConfigured,
  processIpn,
  startProExpiryMonitor,
  verifyIpnSignature,
  type BillingPeriod,
  type MaxMultiplier,
  type SubscriptionTier,
} from './server/billing.ts';
import {
  consumeUserCredits,
  EntitlementError,
  getUserEntitlements,
  IMMUTABLE_CREDIT_COSTS,
  IMMUTABLE_MAX_LEVERAGE,
  isValidBillableAction,
  resolveAuthoritativePlan,
} from './server/entitlements.ts';
import { CREDIT_COSTS, FREE_MAX_LEVERAGE, STRATEGY_CATALOG, isProOnlyStrategy } from './src/data/strategies.ts';
import {
  AiServiceError,
  askTerminalAssistant,
  fetchEconomicCalendar,
  fetchGroundedCryptoNews,
  runStrategyAnalysis,
  translateNewsBatchToRussian,
  type TerminalChatTurn,
} from './server/aiAnalyst.ts';
import {
  getFearAndGreedIndex,
  getMarketCandles,
  getMarketDepth,
  getMarketOverview,
  SUPPORTED_SYMBOLS,
} from './server/market.ts';
import {
  runLiveStrategyScannerWithTelemetry,
  runStrategyPortfolioBacktest,
  type StrategySimulationInput,
} from './server/strategyBacktest.ts';
import {
  checkPriceAlertsForUser,
  dispatchPushToUser,
  getVapidPublicKey,
  notifyHighImpactNews,
  notifyPortfolioDailyPnl,
  notifyPortfolioTargetReached,
  registerPushSubscription,
  scanMarketAndNotify,
  startMarketAlertMonitor,
  syncUserPriceAlerts,
  unregisterPushSubscription,
} from './server/push.ts';
import {
  assertSecurityEnvConfigured,
  buildOtpAuthUri,
  decryptSecret,
  encryptSecret,
  generateBackupCodes,
  generateBase32Secret,
  hashBackupCode,
  verifyTotpCode,
} from './server/security.ts';
import {
  connectAndEncryptExchange,
  ExchangeApiError,
  executeEncryptedExchangeOrder,
  isValidExchangeId,
  isValidPermissions,
  MAX_TESTNET_ORDER_USDT,
  syncEncryptedExchangeBalances,
} from './server/exchanges.ts';

async function startServer() {
  // Проверка криптографического мастер-ключа (fail-fast в production)
  assertSecurityEnvConfigured();

  const app = express();
  const PORT = 3000;
  const isProd = process.env.NODE_ENV === 'production';

  app.set('trust proxy', 1);

  // Централизованные строгие HTTP-заголовки безопасности (CSP без unsafe-eval, HSTS, nosniff, DENY, Permissions-Policy)
  applySecurityHeaders(app, { isProd });

  app.use(express.json({ limit: '256kb' }));

  // ---------- CSRF Protection (Double Submit Cookie + строгая проверка Origin/Referer) ----------
  const CSRF_COOKIE_NAME = 'vernier_csrf';
  const configuredAllowedOrigins = new Set(
    (process.env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((v) => v.trim().replace(/\/+$/, ''))
      .filter(Boolean)
  );
  if (process.env.APP_URL) {
    configuredAllowedOrigins.add(process.env.APP_URL.trim().replace(/\/+$/, ''));
  }

  function parseCookieMap(cookieHeader: string | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    if (!cookieHeader) return out;
    for (const part of cookieHeader.split(';')) {
      const idx = part.indexOf('=');
      if (idx === -1) continue;
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      if (k) out[k] = decodeURIComponent(v);
    }
    return out;
  }

  function issueCsrfCookie(res: express.Response, existingToken?: string): string {
    const token =
      existingToken && /^[0-9a-f]{64}$/.test(existingToken)
        ? existingToken
        : crypto.randomBytes(32).toString('hex');
    const cookieParts = [
      `${CSRF_COOKIE_NAME}=${token}`,
      'Path=/',
      'SameSite=Strict',
      'Max-Age=43200',
    ];
    if (isProd) {
      cookieParts.push('Secure');
    }
    res.setHeader('Set-Cookie', cookieParts.join('; '));
    return token;
  }

  function isTrustedOrigin(req: express.Request): boolean {
    const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
    const refererHeader = typeof req.headers.referer === 'string' ? req.headers.referer.trim() : '';
    const hostHeader = typeof req.headers.host === 'string' ? req.headers.host.trim() : '';

    const candidateUrl = originHeader || refererHeader;
    if (!candidateUrl) {
      // В non-browser или same-origin запросах без Origin допускаем, если присутствует валидный Double Submit CSRF token
      return true;
    }

    try {
      const parsed = new URL(candidateUrl);
      const normalizedOrigin = parsed.origin;
      if (configuredAllowedOrigins.has(normalizedOrigin)) return true;
      if (hostHeader && parsed.host === hostHeader) return true;
      if (!isProd && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // Запрет передачи auth-токенов в URL query parameters
  app.use('/api', (req, res, next) => {
    const forbiddenQueryKeys = ['token', 'idToken', 'id_token', 'access_token', 'authToken', 'authorization'];
    for (const key of forbiddenQueryKeys) {
      if (req.query[key] !== undefined) {
        res.status(400).json({
          error: 'Передача токенов авторизации в URL запрещена. Используйте заголовок Authorization.',
        });
        return;
      }
    }
    next();
  });

  // Выдача / обновление CSRF-токена (Double Submit Cookie)
  app.get('/api/security/csrf-token', (req, res) => {
    const cookies = parseCookieMap(req.headers.cookie);
    const csrfToken = issueCsrfCookie(res, cookies[CSRF_COOKIE_NAME]);
    res.set('Cache-Control', 'no-store');
    res.json({ csrfToken });
  });

  // Проверка CSRF на всех мутирующих /api/* маршрутах (кроме подписанного HMAC-SHA512 IPN webhook)
  app.use('/api', (req, res, next) => {
    const method = req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      next();
      return;
    }
    if (req.path === '/billing/ipn') {
      // Внешний webhook NOWPayments защищён криптографической подписью HMAC-SHA512 (x-nowpayments-sig)
      next();
      return;
    }

    if (!isTrustedOrigin(req)) {
      res.status(403).json({ error: 'Запрос отклонён политикой безопасности Origin/CSRF.' });
      return;
    }

    const cookies = parseCookieMap(req.headers.cookie);
    const cookieToken = cookies[CSRF_COOKIE_NAME] || '';
    const headerToken = typeof req.headers['x-csrf-token'] === 'string' ? req.headers['x-csrf-token'].trim() : '';

    if (
      !cookieToken ||
      !headerToken ||
      cookieToken.length !== 64 ||
      headerToken.length !== 64 ||
      !crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken))
    ) {
      res.status(403).json({
        error: 'Недействительный или отсутствующий CSRF-токен. Обновите страницу и повторите запрос.',
        code: 'CSRF_INVALID',
      });
      return;
    }

    next();
  });

  // ---------- Устойчивый Rate-Limiting (IP из trust proxy=1 + UID / session fingerprint) ----------
  function getCompositeRateLimitKey(req: express.Request): string {
    const trustedIp = (req.ip || req.socket.remoteAddress || 'unknown').replace(/^::ffff:/, '');
    const uid = req.user?.uid ? `uid:${req.user.uid}` : '';
    const clientFp =
      typeof req.headers['x-vernier-client-fp'] === 'string'
        ? req.headers['x-vernier-client-fp'].replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32)
        : '';
    const csrfPrefix = parseCookieMap(req.headers.cookie)[CSRF_COOKIE_NAME]?.slice(0, 16) || '';
    const actor = uid || (clientFp ? `fp:${clientFp}` : csrfPrefix ? `csrf:${csrfPrefix}` : 'anon');
    return `${trustedIp}|${actor}`;
  }

  // Экспоненциальный backoff и временная блокировка после 5 неудачных попыток (2FA / биржевые операции)
  const authFailureTracker = new Map<string, { failures: number; lockedUntil: number; updatedAt: number }>();

  function getAuthFailureKey(req: express.Request, scope: string): string {
    const trustedIp = (req.ip || req.socket.remoteAddress || 'unknown').replace(/^::ffff:/, '');
    const uid = req.user?.uid || 'anon';
    return `${scope}:${uid}:${trustedIp}`;
  }

  function checkAuthBackoffLock(req: express.Request, res: express.Response, scope: string): boolean {
    const key = getAuthFailureKey(req, scope);
    const state = authFailureTracker.get(key);
    if (!state) return false;
    const now = Date.now();
    if (state.lockedUntil > now) {
      const waitSec = Math.ceil((state.lockedUntil - now) / 1000);
      res.setHeader('Retry-After', String(waitSec));
      res.status(429).json({
        error: `Слишком много неудачных попыток. Временная блокировка ещё на ${waitSec} сек.`,
        retryAfterSeconds: waitSec,
        code: 'AUTH_LOCKED',
      });
      return true;
    }
    return false;
  }

  function recordAuthFailure(req: express.Request, scope: string): { failures: number; lockSeconds: number } {
    const key = getAuthFailureKey(req, scope);
    const now = Date.now();
    const prev = authFailureTracker.get(key);
    const failures = prev && now - prev.updatedAt < 30 * 60_000 ? prev.failures + 1 : 1;
    let lockMs = 0;
    if (failures >= 5) {
      // Экспоненциальный backoff: 30с, 60с, 120с, 240с ... макс 15 мин
      lockMs = Math.min(15 * 60_000, 30_000 * 2 ** (failures - 5));
    }
    authFailureTracker.set(key, {
      failures,
      lockedUntil: lockMs > 0 ? now + lockMs : 0,
      updatedAt: now,
    });
    return { failures, lockSeconds: Math.ceil(lockMs / 1000) };
  }

  function clearAuthFailure(req: express.Request, scope: string): void {
    authFailureTracker.delete(getAuthFailureKey(req, scope));
  }

  const generalApiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => getCompositeRateLimitKey(req),
    message: { error: 'Превышен лимит запросов. Повторите через минуту.' },
  });

  const strictAuthLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => getCompositeRateLimitKey(req),
    message: { error: 'Слишком много попыток проверки безопасности. Подождите 5 минут.' },
  });

  const expensiveLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 12,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => getCompositeRateLimitKey(req),
    message: { error: 'Слишком много тяжёлых запросов. Повторите через минуту.' },
  });

  app.use('/api', generalApiLimiter);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });

  // Авторитетные серверные эндпоинты учёта тарифов и квот (клиент больше не может изменять creditsRemaining в Firestore)
  app.get('/api/entitlements/me', requireAuth, async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      const snapshot = await getUserEntitlements(req.user!.uid);
      res.json({
        ok: true,
        entitlements: snapshot,
        creditCosts: IMMUTABLE_CREDIT_COSTS,
      });
    } catch (err) {
      if (err instanceof EntitlementError) {
        res.status(err.statusCode).json({ error: err.message, code: err.code });
        return;
      }
      res.status(500).json({ error: 'Ошибка чтения квот аккаунта.' });
    }
  });

  app.post('/api/entitlements/consume', requireAuth, expensiveLimiter, async (req, res) => {
    try {
      const body = req.body as { action?: unknown };
      const action = isValidBillableAction(body?.action) ? body.action : 'ai_analysis';
      const { snapshot, deducted } = await consumeUserCredits(req.user!.uid, action);
      res.json({
        ok: true,
        deducted,
        entitlements: snapshot,
      });
    } catch (err) {
      if (err instanceof EntitlementError) {
        res.status(err.statusCode).json({ error: err.message, code: err.code });
        return;
      }
      res.status(500).json({ error: 'Ошибка серверного списания кредитов.' });
    }
  });

  // Market tickers (Spot / Futures)
  app.get('/api/market/overview', async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      const marketType = req.query.marketType === 'futures' ? 'futures' : 'spot';
      const forceRefresh = req.query.refresh === '1';
      const tickers = await getMarketOverview(marketType, forceRefresh);
      res.json({ marketType, tickers, updatedAt: new Date().toISOString() });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Ошибка загрузки рынка' });
    }
  });

  // Market OHLCV + technical indicators
  app.get('/api/market/candles', async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      const symbol = String(req.query.symbol || 'BTCUSDT').toUpperCase();
      const interval = String(req.query.interval || '1h');
      const marketType = req.query.marketType === 'futures' ? 'futures' : 'spot';
      const forceRefresh = req.query.refresh === '1';
      const data = await getMarketCandles(symbol, interval, marketType, forceRefresh);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Ошибка загрузки графика' });
    }
  });

  // Market Order Book Depth (Bids / Asks / Spread)
  app.get('/api/market/depth', async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      const symbol = String(req.query.symbol || 'BTCUSDT').toUpperCase();
      const marketType = req.query.marketType === 'futures' ? 'futures' : 'spot';
      const forceRefresh = req.query.refresh === '1';
      const depth = await getMarketDepth(symbol, marketType, forceRefresh);
      res.json(depth);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Ошибка загрузки стакана ордеров' });
    }
  });

  // Crypto Fear & Greed Index (live Alternative.me + quantitative fallback)
  app.get('/api/market/fear-greed', async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      const forceRefresh = req.query.refresh === '1';
      const sentiment = await getFearAndGreedIndex(forceRefresh);
      res.json(sentiment);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Ошибка загрузки индекса настроений' });
    }
  });

  // Live Android / PWA Desktop Widget Feed (JSON for W3C Widgets, KWGT, MacroDroid, and standalone views)
  app.get('/api/widgets/feed', async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      const symbol = String(req.query.symbol || 'BTCUSDT').toUpperCase();
      const interval = String(req.query.interval || '1h');
      const marketType = req.query.marketType === 'futures' ? 'futures' : 'spot';
      const forceRefresh = req.query.refresh === '1';
      const depositUsdt = Math.min(10_000_000, Math.max(50, Number(req.query.deposit || 2500)));
      const riskPct = Math.min(10, Math.max(0.25, Number(req.query.risk || 1.5)));
      const stopPct = Math.min(25, Math.max(0.25, Number(req.query.stopPct || 2.5)));

      const [tickers, candlesData, fearGreed] = await Promise.all([
        getMarketOverview(marketType, forceRefresh),
        getMarketCandles(symbol, interval, marketType, forceRefresh),
        getFearAndGreedIndex(forceRefresh),
      ]);

      const ticker = tickers.find((t) => t.symbol === candlesData.symbol) || tickers[0];
      const lastPrice = candlesData.indicators.lastPrice || ticker?.price || 0;
      const riskUsdt = Number(((depositUsdt * riskPct) / 100).toFixed(2));
      const stopPrice = Number((lastPrice * (1 - stopPct / 100)).toFixed(lastPrice >= 100 ? 2 : 4));
      const takeProfitPrice = Number((lastPrice * (1 + (stopPct * 2.5) / 100)).toFixed(lastPrice >= 100 ? 2 : 4));
      const priceDiff = Math.max(1e-8, Math.abs(lastPrice - stopPrice));
      const lotQty = Number((riskUsdt / priceDiff).toFixed(lastPrice >= 1000 ? 4 : 2));
      const notionalUsdt = Number((lotQty * lastPrice).toFixed(2));

      const sortedByChange = [...tickers].sort((a, b) => b.change24hPct - a.change24hPct);
      const topGainer = sortedByChange[0] || null;
      const topLoser = sortedByChange[sortedByChange.length - 1] || null;
      const btcTicker = tickers.find((t) => t.symbol === 'BTCUSDT') || ticker;

      const formatUsd = (val: number) =>
        val >= 100
          ? `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          : `$${val.toFixed(4)}`;

      const recentCandles = candlesData.candles.slice(-24);

      res.json({
        updatedAt: new Date().toISOString(),
        symbol: candlesData.symbol,
        marketType,
        interval: candlesData.interval,
        price: {
          symbol: candlesData.symbol,
          baseAsset: ticker?.baseAsset || candlesData.symbol.replace('USDT', ''),
          price: lastPrice,
          formatted: formatUsd(lastPrice),
          change24hPct: Number((ticker?.change24hPct ?? 0).toFixed(2)),
          high24h: ticker?.high24h ?? lastPrice,
          low24h: ticker?.low24h ?? lastPrice,
          volume24hUsdt: ticker?.volume24hUsdt ?? 0,
          source: ticker?.source ?? candlesData.source,
        },
        chart: {
          symbol: candlesData.symbol,
          interval: candlesData.interval,
          trendBias: candlesData.indicators.trendBias,
          rsi14: Number(candlesData.indicators.rsi14.toFixed(1)),
          ema20: candlesData.indicators.ema20,
          ema50: candlesData.indicators.ema50,
          support: candlesData.indicators.supportLevel,
          resistance: candlesData.indicators.resistanceLevel,
          sparkline: recentCandles.map((c) => c.close),
          candles: recentCandles.map((c) => ({
            time: c.time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
          })),
        },
        position: {
          symbol: candlesData.symbol,
          entryPrice: lastPrice,
          stopPrice,
          takeProfitPrice,
          depositUsdt,
          riskPct,
          stopPct,
          riskUsdt,
          lotQty,
          notionalUsdt,
          rrRatio: '1 : 2.5',
        },
        pnl: {
          btcChange24hPct: Number((btcTicker?.change24hPct ?? 0).toFixed(2)),
          marketSentimentValue: fearGreed.value,
          marketSentimentLabel: fearGreed.classificationRu,
          topGainer: topGainer
            ? { symbol: topGainer.symbol, change24hPct: Number(topGainer.change24hPct.toFixed(2)) }
            : null,
          topLoser: topLoser
            ? { symbol: topLoser.symbol, change24hPct: Number(topLoser.change24hPct.toFixed(2)) }
            : null,
        },
        strategies: {
          recommendedBias:
            candlesData.indicators.trendBias === 'BULLISH'
              ? 'Трендовый импульс (LONG)'
              : candlesData.indicators.trendBias === 'BEARISH'
                ? 'Защита / Шорт-сценарий (SHORT)'
                : 'Отскок от границ диапазона',
          volatilityPct: Number(candlesData.indicators.volatilityPct.toFixed(2)),
          fearGreedValue: fearGreed.value,
          fearGreedLabel: fearGreed.classificationRu,
        },
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Ошибка формирования ленты виджетов' });
    }
  });

  // W3C Web App Widgets Adaptive Card Templates
  app.get('/api/widgets/template/:kind', (req, res) => {
    const kind = String(req.params.kind || 'price');
    const titles: Record<string, string> = {
      chart: 'Vernier · График',
      price: 'Vernier · Цена',
      position: 'Vernier · Позиция',
      pnl: 'Vernier · Доходность',
      strategies: 'Vernier · Стратегии',
    };
    const title = titles[kind] || 'Vernier · Виджет';

    const bodyByKind: Record<string, unknown[]> = {
      price: [
        { type: 'TextBlock', text: '${price.symbol} (${interval})', weight: 'Bolder', size: 'Medium' },
        { type: 'TextBlock', text: '${price.formatted}', weight: 'Bolder', size: 'ExtraLarge', color: 'Accent' },
        { type: 'TextBlock', text: '24ч: ${price.change24hPct}% · Макс: ${price.high24h}', isSubtle: true, spacing: 'Small' },
      ],
      chart: [
        { type: 'TextBlock', text: 'График ${chart.symbol} · ${chart.interval}', weight: 'Bolder', size: 'Medium' },
        { type: 'TextBlock', text: 'Тренд: ${chart.trendBias} · RSI(14): ${chart.rsi14}', size: 'Default' },
        { type: 'TextBlock', text: 'Поддержка: ${chart.support} · Сопр.: ${chart.resistance}', isSubtle: true },
      ],
      position: [
        { type: 'TextBlock', text: 'Калькулятор позиции · ${position.symbol}', weight: 'Bolder', size: 'Medium' },
        { type: 'TextBlock', text: 'Лот: ${position.lotQty} · Объём: $${position.notionalUsdt}', size: 'Large' },
        { type: 'TextBlock', text: 'Риск: $${position.riskUsdt} (${position.riskPct}%) · R/R ${position.rrRatio}', isSubtle: true },
      ],
      pnl: [
        { type: 'TextBlock', text: 'Рынок и настроения', weight: 'Bolder', size: 'Medium' },
        { type: 'TextBlock', text: 'Fear & Greed: ${pnl.marketSentimentValue}/100 (${pnl.marketSentimentLabel})', size: 'Default' },
        { type: 'TextBlock', text: 'Лидер: ${pnl.topGainer.symbol} (${pnl.topGainer.change24hPct}%)', isSubtle: true },
      ],
      strategies: [
        { type: 'TextBlock', text: 'Сигнал стратегий · ${symbol}', weight: 'Bolder', size: 'Medium' },
        { type: 'TextBlock', text: '${strategies.recommendedBias}', size: 'Default' },
        { type: 'TextBlock', text: 'Волатильность: ${strategies.volatilityPct}%', isSubtle: true },
      ],
    };

    res.json({
      type: 'AdaptiveCard',
      version: '1.5',
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      body: [
        { type: 'TextBlock', text: title, size: 'Small', isSubtle: true },
        ...(bodyByKind[kind] || bodyByKind.price),
      ],
      actions: [
        {
          type: 'Action.OpenUrl',
          title: 'Открыть в Vernier',
          url: `/?widget=${encodeURIComponent(kind)}`,
        },
      ],
    });
  });

  // Grounded crypto news feed (with live RSS fallback + explicit notice on quota limits)
  app.get('/api/news', async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      // Только известные активы: иначе произвольный текст попадал бы в запрос к ИИ и в ключ кэша
      const requested = String(req.query.symbol || 'ALL').toUpperCase().slice(0, 12);
      const allowedNews = new Set(['ALL', ...SUPPORTED_SYMBOLS.map((s) => s.replace('USDT', ''))]);
      const symbol = allowedNews.has(requested) ? requested : 'ALL';
      const forceRefresh = req.query.refresh === '1';
      const news = await fetchGroundedCryptoNews(symbol, forceRefresh);
      const topHigh = news.items.find((n) => n.impact === 'HIGH');
      if (topHigh) {
        void notifyHighImpactNews(topHigh);
      }
      res.json(news);
    } catch (err) {
      if (err instanceof AiServiceError) {
        res.status(err.statusCode).json({ error: err.message, code: err.code });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : 'Ошибка загрузки новостей' });
    }
  });

  // Batch full-sentence Russian translation for English RSS/news headlines
  app.post('/api/news/translate', async (req, res) => {
    try {
      const body = req.body as { items?: Array<{ id: string; title: string; summary: string }> };
      const list = Array.isArray(body?.items) ? body.items.slice(0, 24) : [];
      if (list.length === 0) {
        res.json({ translations: {} });
        return;
      }
      const translations = await translateNewsBatchToRussian(list);
      res.json({ translations });
    } catch {
      res.json({ translations: {} });
    }
  });

  // Grounded macro & crypto economic calendar (with live Deribit/OKX/Fed/Investing fallback)
  app.get('/api/economic-calendar', async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      const forceRefresh = req.query.refresh === '1';
      const calendar = await fetchEconomicCalendar(forceRefresh);
      res.json(calendar);
    } catch (err) {
      if (err instanceof AiServiceError) {
        res.status(err.statusCode).json({ error: err.message, code: err.code });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : 'Ошибка загрузки экономического календаря' });
    }
  });

  // AI Strategy + Chart + News analysis
  app.post('/api/analyze', requireAuth, expensiveLimiter, async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const symbol = String(body.symbol || 'BTCUSDT').toUpperCase();
      const marketType = body.marketType === 'futures' ? 'futures' : 'spot';
      const timeframe = ['15m', '1h', '4h', '1d'].includes(String(body.timeframe)) ? String(body.timeframe) : '1h';
      // Ограничиваем длину текста, который уходит в запрос к ИИ (защита от злоупотребления квотой и подмены инструкций)
      const strategyKey = String(body.strategyKey || 'spot_trend_breakout').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
      const strategyName = String(body.strategyName || 'Импульсный пробой тренда').replace(/[\r\n"]/g, ' ').slice(0, 120);
      const strategyRules = String(body.strategyRules || '').replace(/\r/g, '').slice(0, 1500);
      const depositUsdt = Math.min(10_000_000, Math.max(10, Number(body.depositUsdt || 1000)));
      const riskPerTradePct = Math.min(10, Math.max(0.25, Number(body.riskPerTradePct || 1.5)));
      const entitlements = await getUserEntitlements(req.user!.uid);
      const dbPlan = entitlements.plan;
      const isPro = dbPlan === 'pro' || dbPlan === 'max';

      if (isProOnlyStrategy(strategyKey) && !isPro) {
        res.status(403).json({
          error: 'Выбранная стратегия доступна только в подписке PRO или MAX. Выберите базовую стратегию или обновите тариф.',
          code: 'PRO_REQUIRED',
        });
        return;
      }

      const maxAllowedLeverage = IMMUTABLE_MAX_LEVERAGE[dbPlan] ?? FREE_MAX_LEVERAGE;
      const leverage = Math.min(maxAllowedLeverage, Math.max(1, Number(body.leverage || 1)));

      // Серверная проверка и атомарное списание 1 AI-кредита перед вызовом Gemini
      const { snapshot: postCreditSnapshot } = await consumeUserCredits(req.user!.uid, 'ai_analysis');

      const marketData = await getMarketCandles(symbol, timeframe, marketType);
      const analysis = await runStrategyAnalysis({
        symbol: marketData.symbol,
        marketType,
        timeframe: marketData.interval,
        strategyKey,
        strategyName,
        strategyRules,
        indicators: marketData.indicators,
        fundingRatePct: marketData.fundingRatePct,
        openInterestUsdt: marketData.openInterestUsdt,
        depositUsdt,
        riskPerTradePct,
        leverage,
        isPro,
        planTier: dbPlan,
      });

      res.json({
        analysis,
        indicators: marketData.indicators,
        source: marketData.source,
        entitlements: postCreditSnapshot,
      });
    } catch (err) {
      if (err instanceof EntitlementError) {
        res.status(err.statusCode).json({ error: err.message, code: err.code });
        return;
      }
      if (err instanceof AiServiceError) {
        res.status(err.statusCode).json({ error: err.message, code: err.code });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : 'Ошибка AI-анализа' });
    }
  });

  // Helper to optionally resolve verified UID & plan tier from Authorization header
  const resolveOptionalUid = async (req: express.Request): Promise<string | undefined> => {
    const header = req.headers.authorization;
    const match = typeof header === 'string' ? /^Bearer\s+(\S+)$/i.exec(header) : null;
    if (!match) return undefined;
    try {
      const verified = await verifyFirebaseIdToken(match[1]);
      return verified.uid;
    } catch {
      return undefined;
    }
  };

  const resolveOptionalUserTier = async (
    req: express.Request,
    demoTier?: unknown
  ): Promise<'free' | 'pro' | 'max'> => {
    const uid = await resolveOptionalUid(req);
    return resolveAuthoritativePlan(uid, demoTier);
  };

  // Серверный кэш результатов бэктеста PnL (TTL 45 сек) для предотвращения повторных нагрузок и таймаутов
  const pnlBacktestCache = new Map<string, { report: unknown; expiresAt: number }>();

  // Quantitative Strategy PnL Portfolio Backtest (based on live/cached exchange candles)
  app.post('/api/strategies/pnl', expensiveLimiter, async (req, res) => {
    try {
      const body = req.body as {
        strategies?: StrategySimulationInput[];
        interval?: string;
        depositUsdt?: number;
        scope?: string;
        demoTier?: string;
      };
      if (!Array.isArray(body.strategies) || body.strategies.length === 0) {
        res.status(400).json({ error: 'Передайте хотя бы одну стратегию для расчета PnL.' });
        return;
      }
      let requestedInterval: '1h' | '4h' | '1d' =
        body.interval === '1d' ? '1d' : body.interval === '4h' ? '4h' : '1h';
      if (requestedInterval === '1d') {
        const tier = await resolveOptionalUserTier(req, body.demoTier);
        if (tier !== 'max') {
          requestedInterval = '4h';
        }
      }
      const strategiesSlice = body.strategies.slice(0, 40);
      const depositUsdt = Number(body.depositUsdt || 2500);
      const scope = body.scope === 'all' ? 'all' : 'active';
      const cacheKey = crypto
        .createHash('sha1')
        .update(
          JSON.stringify({
            interval: requestedInterval,
            depositUsdt,
            scope,
            s: strategiesSlice.map((st) => [
              st.strategyKey,
              st.enabled ? 1 : 0,
              st.riskPerTradePct,
              st.leverage,
              Array.isArray(st.pairs) ? st.pairs.slice(0, 6).join(',') : '',
            ]),
          })
        )
        .digest('hex');

      const cached = pnlBacktestCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        res.json(cached.report);
        return;
      }

      const report = await runStrategyPortfolioBacktest({
        strategies: strategiesSlice,
        interval: requestedInterval,
        depositUsdt,
        scope,
      });

      if (pnlBacktestCache.size >= 40) {
        const firstKey = pnlBacktestCache.keys().next().value;
        if (firstKey) pnlBacktestCache.delete(firstKey);
      }
      pnlBacktestCache.set(cacheKey, { report, expiresAt: Date.now() + 45_000 });
      res.json(report);
    } catch (err) {
      serverLogger.error('strategies:pnl', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Ошибка расчета доходности стратегий' });
    }
  });

  // Live Multi-Pair Quantitative Strategy Scanner (PRO: top-16 pairs, MAX: all 44 pairs + 4H)
  app.post('/api/strategies/scanner', expensiveLimiter, async (req, res) => {
    try {
      const body = req.body as {
        timeframe?: string;
        minConfidence?: number;
        marketFilter?: 'all' | 'spot' | 'futures';
        demoTier?: string;
        activeStrategyConfigs?: Array<{
          strategyKey?: string;
          minConfidence?: number;
          pairs?: string[];
        }>;
      };
      const tier = await resolveOptionalUserTier(req, body.demoTier);

      const maxPairs = tier === 'max' ? SUPPORTED_SYMBOLS.length : tier === 'pro' ? 16 : 3;
      const timeframe: '1h' | '4h' = tier === 'max' && body.timeframe === '4h' ? '4h' : '1h';
      const minConfidence = Math.min(95, Math.max(55, Number(body.minConfidence || 70)));
      const marketFilter = body.marketFilter === 'spot' || body.marketFilter === 'futures' ? body.marketFilter : 'all';

      const customCfgMap = new Map<string, { minConfidence?: number; pairs?: string[] }>();
      const hasExplicitActiveFilter =
        Array.isArray(body.activeStrategyConfigs) && body.activeStrategyConfigs.length > 0;
      if (hasExplicitActiveFilter && body.activeStrategyConfigs) {
        for (const item of body.activeStrategyConfigs.slice(0, 32)) {
          if (typeof item?.strategyKey === 'string' && item.strategyKey.length > 0) {
            const validPairs = Array.isArray(item.pairs)
              ? item.pairs
                  .filter((p): p is string => typeof p === 'string' && (SUPPORTED_SYMBOLS as readonly string[]).includes(p))
                  .slice(0, 8)
              : undefined;
            customCfgMap.set(item.strategyKey, {
              minConfidence:
                typeof item.minConfidence === 'number' && Number.isFinite(item.minConfidence)
                  ? Math.min(95, Math.max(50, item.minConfidence))
                  : undefined,
              pairs: validPairs && validPairs.length > 0 ? validPairs : undefined,
            });
          }
        }
      }

      const allowedStrategies = STRATEGY_CATALOG.filter((tpl) => {
        if (marketFilter !== 'all' && tpl.marketType !== marketFilter) return false;
        if (tier === 'free' && tpl.tier !== 'free') return false;
        if (tier === 'pro' && tpl.tier === 'max') return false;
        if (hasExplicitActiveFilter && !customCfgMap.has(tpl.key)) return false;
        return true;
      }).map((tpl) => {
        const customCfg = customCfgMap.get(tpl.key);
        return {
          strategyKey: tpl.key,
          name: tpl.name,
          marketType: tpl.marketType,
          tier: tpl.tier,
          minConfidence: customCfg?.minConfidence,
          pairs: customCfg?.pairs,
        };
      });

      const scanSymbols = hasExplicitActiveFilter
        ? Array.from(
            new Set(
              allowedStrategies.flatMap((s) => (s.pairs && s.pairs.length > 0 ? s.pairs : SUPPORTED_SYMBOLS.slice(0, 6)))
            )
          ).slice(0, maxPairs)
        : SUPPORTED_SYMBOLS.slice(0, maxPairs);

      const { opportunities, strategyTelemetry } = await runLiveStrategyScannerWithTelemetry({
        symbols: scanSymbols.length > 0 ? scanSymbols : SUPPORTED_SYMBOLS.slice(0, Math.min(3, maxPairs)),
        strategies: allowedStrategies,
        timeframe,
        minConfidence,
      });

      res.json({
        tier,
        scannedPairsCount: scanSymbols.length,
        totalPairsAvailable: SUPPORTED_SYMBOLS.length,
        timeframe,
        opportunities,
        strategyTelemetry,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      serverLogger.error('strategies:scanner', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Ошибка сканера торговых сетапов' });
    }
  });

  // Exclusive PRO/MAX Advanced Market Sentiment forecast + real Free-vs-Sentiment backtest comparison
  app.post('/api/strategies/sentiment', expensiveLimiter, async (req, res) => {
    try {
      const uid = await resolveOptionalUid(req);
      const body = req.body as { asset?: string; interval?: string; demoTier?: string };
      // В production demoTier строго игнорируется на сервере; в dev допускается для тестирования
      const tier = await resolveAuthoritativePlan(uid, body.demoTier);
      const rawAsset = String(body.asset || 'ALL').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'ALL';
      const allowedAssets = new Set(['ALL', ...SUPPORTED_SYMBOLS.map((s) => s.replace('USDT', ''))]);
      const asset = allowedAssets.has(rawAsset) ? rawAsset : 'ALL';

      const requestedInterval: '1h' | '4h' | '1d' =
        tier === 'max' && body.interval === '1d'
          ? '1d'
          : tier !== 'free' && body.interval === '4h'
            ? '4h'
            : '1h';

      const [fearGreed, spotTickers, futuresTickers] = await Promise.all([
        getFearAndGreedIndex(),
        getMarketOverview('spot'),
        getMarketOverview('futures'),
      ]);

      const advancingCount = spotTickers.filter((t) => t.change24hPct > 0).length;
      const decliningCount = spotTickers.length - advancingCount;
      const advancingPct =
        spotTickers.length > 0 ? Number(((advancingCount / spotTickers.length) * 100).toFixed(1)) : 50;
      const avgChange24hPct =
        spotTickers.length > 0
          ? Number((spotTickers.reduce((acc, t) => acc + t.change24hPct, 0) / spotTickers.length).toFixed(2))
          : 0;
      const fundingItems = futuresTickers.filter((t) => typeof t.fundingRatePct === 'number');
      const avgFundingRatePct =
        fundingItems.length > 0
          ? Number((fundingItems.reduce((acc, t) => acc + (t.fundingRatePct ?? 0), 0) / fundingItems.length).toFixed(4))
          : 0.01;

      const delta7d = fearGreed.value - fearGreed.weekAgoValue;

      // Locked preview for Free users (never expose full PRO/MAX catalysts or forecasts)
      if (tier === 'free') {
        res.json({
          locked: true,
          tier,
          asset,
          interval: '1h',
          compositeScore: Math.round(fearGreed.value * 0.55 + advancingPct * 0.45),
          forecastBias: 'NEUTRAL_ROTATION',
          forecastHeadline: 'Доступно в подписке PRO и MAX',
          forecastSummary:
            'Модуль «Advanced Market Sentiment» объединяет индекс Fear & Greed, ширину рынка (44 пары), ставки Funding и новостной сентимент с проверкой реального Win Rate на исторических свечах.',
          fearGreed: {
            value: fearGreed.value,
            classificationRu: fearGreed.classificationRu,
            yesterdayValue: fearGreed.yesterdayValue,
            weekAgoValue: fearGreed.weekAgoValue,
            monthAgoValue: fearGreed.monthAgoValue,
            delta7d,
          },
          marketBreadth: {
            advancingCount,
            decliningCount,
            totalPairs: spotTickers.length,
            advancingPct,
            avgChange24hPct,
            avgFundingRatePct,
          },
          newsBreakdown: {
            bullishCount: 0,
            bearishCount: 0,
            neutralCount: 0,
            catalysts: [],
          },
          comparison: {
            sentimentStrategy: null,
            freeAverageWinRatePct: 0,
            freeAveragePnlPct: 0,
            winRateDeltaPp: 0,
            pnlDeltaPct: 0,
            freeStrategies: [],
          },
          updatedAt: new Date().toISOString(),
        });
        return;
      }

      const newsPromise = fetchGroundedCryptoNews(asset, false).catch(() => ({
        items: [],
        notice: '',
        source: 'rss' as const,
      }));

      const freeTemplates = STRATEGY_CATALOG.filter((s) => s.tier === 'free');
      const sentimentTemplate = STRATEGY_CATALOG.find((s) => s.key === 'spot_advanced_market_sentiment');
      const evalPairs =
        asset !== 'ALL' && (SUPPORTED_SYMBOLS as readonly string[]).includes(`${asset}USDT`)
          ? [`${asset}USDT`, 'BTCUSDT']
          : ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];

      const simInputs: StrategySimulationInput[] = [
        ...(sentimentTemplate ? [sentimentTemplate] : []),
        ...freeTemplates,
      ].map((tpl) => ({
        strategyKey: tpl.key,
        name: tpl.name,
        shortTag: tpl.shortTag,
        marketType: tpl.marketType,
        enabled: true,
        dailySignalLimit: tpl.tier === 'pro' ? 0 : 1,
        minConfidence: 70,
        riskPerTradePct: tpl.defaultRiskPct,
        leverage: tpl.marketType === 'futures' ? Math.min(FREE_MAX_LEVERAGE, tpl.defaultLeverage) : 1,
        pairs: evalPairs,
      }));

      const [newsFeed, backtestReport] = await Promise.all([
        newsPromise,
        runStrategyPortfolioBacktest({
          strategies: simInputs,
          interval: requestedInterval,
          depositUsdt: 2500,
          scope: 'all',
        }),
      ]);

      const maxCatalysts = tier === 'max' ? 6 : 3;
      const catalysts = newsFeed.items.slice(0, maxCatalysts);
      const bullishCount = newsFeed.items.filter((i) => i.sentiment === 'BULLISH').length;
      const bearishCount = newsFeed.items.filter((i) => i.sentiment === 'BEARISH').length;
      const neutralCount = newsFeed.items.filter((i) => i.sentiment === 'NEUTRAL').length;
      const newsTotal = Math.max(1, newsFeed.items.length);
      const newsScore = Math.max(0, Math.min(100, Math.round(50 + ((bullishCount - bearishCount) / newsTotal) * 45)));
      const fundingRegimeScore =
        avgFundingRatePct > 0.045 ? 38 : avgFundingRatePct < -0.02 ? 62 : 55 + avgChange24hPct * 1.4;
      const compositeScore = Math.max(
        5,
        Math.min(
          95,
          Math.round(
            fearGreed.value * 0.35 +
              advancingPct * 0.25 +
              Math.max(10, Math.min(90, fundingRegimeScore)) * 0.2 +
              newsScore * 0.2
          )
        )
      );

      let forecastBias: 'BULLISH_EXPANSION' | 'ACCUMULATION_BIAS' | 'NEUTRAL_ROTATION' | 'RISK_OFF_HEDGING' =
        'NEUTRAL_ROTATION';
      let forecastHeadline = 'Нейтральная ротация капитала (24–72ч)';
      let forecastSummary =
        'Рынок сбалансирован без выраженного перегрева деривативов. Оптимальны выборочные входы по подтверждению объёма и откатам к EMA20.';

      if (compositeScore >= 64 && avgFundingRatePct < 0.04) {
        forecastBias = 'BULLISH_EXPANSION';
        forecastHeadline = 'Конструктивный бычий импульс (24–72ч)';
        forecastSummary = `Ширина спотового рынка ${advancingPct}% в плюсе (${advancingCount}/${spotTickers.length} пар), сентимент новостей преобладает позитивный (${bullishCount} против ${bearishCount}), а ставка финансирования (${avgFundingRatePct}%) не перегрета.`;
      } else if (fearGreed.value <= 38 && (delta7d >= -4 || bullishCount >= bearishCount)) {
        forecastBias = 'ACCUMULATION_BIAS';
        forecastHeadline = 'Зона осторожного накопления против толпы (24–72ч)';
        forecastSummary = `Индекс страха (${fearGreed.value}/100) указывает на пессимизм ритейла при умеренном давлении в новостях. Исторически в этой фазе работают поэтапные длинные сетапы от поддержки.`;
      } else if (compositeScore <= 42 || avgFundingRatePct >= 0.05) {
        forecastBias = 'RISK_OFF_HEDGING';
        forecastHeadline = 'Защитный режим / повышенный риск отката (24–72ч)';
        forecastSummary = `Слабая ширина рынка (${advancingPct}% в росте) или перегрев деривативов (Funding ${avgFundingRatePct}%). Рекомендуется сократить риск на сделку и ждать подтверждения разворота.`;
      }

      const sentimentRowRaw = backtestReport.breakdown.find(
        (b) => b.strategyKey === 'spot_advanced_market_sentiment'
      );
      const freeRowsRaw = backtestReport.breakdown.filter((b) =>
        freeTemplates.some((f) => f.key === b.strategyKey)
      );

      const sentimentStrategy = sentimentRowRaw
        ? {
            strategyKey: sentimentRowRaw.strategyKey,
            name: sentimentRowRaw.name,
            tier: 'pro' as const,
            winRatePct: sentimentRowRaw.winRatePct,
            totalPnlPct: sentimentRowRaw.totalPnlPct,
            profitFactor: sentimentRowRaw.profitFactor,
            tradesCount: sentimentRowRaw.tradesCount,
          }
        : null;

      const freeStrategies = freeRowsRaw.map((r) => ({
        strategyKey: r.strategyKey,
        name: r.name,
        tier: 'free' as const,
        winRatePct: r.winRatePct,
        totalPnlPct: r.totalPnlPct,
        profitFactor: r.profitFactor,
        tradesCount: r.tradesCount,
      }));

      const freeAverageWinRatePct =
        freeStrategies.length > 0
          ? Number(
              (
                freeStrategies.reduce((acc, r) => acc + r.winRatePct, 0) / freeStrategies.length
              ).toFixed(1)
            )
          : 0;
      const freeAveragePnlPct =
        freeStrategies.length > 0
          ? Number(
              (
                freeStrategies.reduce((acc, r) => acc + r.totalPnlPct, 0) / freeStrategies.length
              ).toFixed(2)
            )
          : 0;

      const winRateDeltaPp = sentimentStrategy
        ? Number((sentimentStrategy.winRatePct - freeAverageWinRatePct).toFixed(1))
        : 0;
      const pnlDeltaPct = sentimentStrategy
        ? Number((sentimentStrategy.totalPnlPct - freeAveragePnlPct).toFixed(2))
        : 0;

      res.json({
        locked: false,
        tier,
        asset,
        interval: requestedInterval,
        compositeScore,
        forecastBias,
        forecastHeadline,
        forecastSummary,
        fearGreed: {
          value: fearGreed.value,
          classificationRu: fearGreed.classificationRu,
          yesterdayValue: fearGreed.yesterdayValue,
          weekAgoValue: fearGreed.weekAgoValue,
          monthAgoValue: fearGreed.monthAgoValue,
          delta7d,
        },
        marketBreadth: {
          advancingCount,
          decliningCount,
          totalPairs: spotTickers.length,
          advancingPct,
          avgChange24hPct,
          avgFundingRatePct,
        },
        newsBreakdown: {
          bullishCount,
          bearishCount,
          neutralCount,
          catalysts,
        },
        comparison: {
          sentimentStrategy,
          freeAverageWinRatePct,
          freeAveragePnlPct,
          winRateDeltaPp,
          pnlDeltaPct,
          freeStrategies,
        },
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Ошибка загрузки модуля настроений' });
    }
  });

  // 2FA Step 1: Generate TOTP secret + QR code + encrypted pending secret
  app.post('/api/security/totp/setup', requireAuth, strictAuthLimiter, async (req, res) => {
    try {
      const uid = req.user!.uid;
      const email = req.user!.email || (typeof (req.body as { email?: unknown })?.email === 'string'
        ? String((req.body as { email: string }).email).slice(0, 254)
        : '');
      if (!email) {
        res.status(400).json({ error: 'Некорректные параметры пользователя.' });
        return;
      }
      const plainSecret = generateBase32Secret(20);
      const otpauthUri = buildOtpAuthUri(email, 'Vernier', plainSecret);
      const qrDataUrl = await QRCode.toDataURL(otpauthUri, {
        margin: 2,
        width: 220,
        color: { dark: '#0B0F17', light: '#FFFFFF' },
      });
      const encryptedPendingSecret = encryptSecret(plainSecret, uid);

      res.json({
        qrDataUrl,
        manualKey: plainSecret,
        encryptedPendingSecret,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Ошибка генерации 2FA' });
    }
  });

  // 2FA Step 2: Verify initial 6-digit TOTP code and issue 8 SHA-256 hashed backup codes
  app.post('/api/security/totp/confirm', requireAuth, strictAuthLimiter, (req, res) => {
    if (checkAuthBackoffLock(req, res, 'totp')) return;
    try {
      const uid = req.user!.uid;
      const { encryptedPendingSecret, code } = req.body as {
        encryptedPendingSecret?: string;
        code?: string;
      };
      if (!encryptedPendingSecret || !code) {
        res.status(400).json({ error: 'Укажите код подтверждения 2FA.' });
        return;
      }
      const plainSecret = decryptSecret(encryptedPendingSecret, uid);
      if (!verifyTotpCode(plainSecret, code, 1)) {
        const penalty = recordAuthFailure(req, 'totp');
        res.status(401).json({
          error:
            penalty.lockSeconds > 0
              ? `Неверный 6-значный код 2FA. Доступ заблокирован на ${penalty.lockSeconds} сек.`
              : 'Неверный 6-значный код из приложения-аутентификатора.',
        });
        return;
      }
      clearAuthFailure(req, 'totp');
      const { plaintext, hashes } = generateBackupCodes(8);
      res.json({
        verified: true,
        encryptedSecret: encryptSecret(plainSecret, uid),
        backupCodes: plaintext,
        backupCodeHashes: hashes,
      });
    } catch {
      recordAuthFailure(req, 'totp');
      res.status(400).json({ error: 'Не удалось расшифровать или проверить 2FA секрет.' });
    }
  });

  // 2FA Step-Up & Lock Screen Verification (supports TOTP OR single-use backup code)
  app.post('/api/security/totp/verify', requireAuth, strictAuthLimiter, (req, res) => {
    if (checkAuthBackoffLock(req, res, 'totp')) return;
    try {
      const uid = req.user!.uid;
      const { encryptedSecret, code, backupCodeHashes } = req.body as {
        encryptedSecret?: string;
        code?: string;
        backupCodeHashes?: string[];
      };
      if (typeof code !== 'string' || typeof encryptedSecret !== 'string' || !code || !encryptedSecret) {
        res.status(400).json({ error: 'Недостаточно данных для проверки 2FA.' });
        return;
      }
      const cleanCode = code.trim();
      const plainSecret = decryptSecret(encryptedSecret, uid);
      if (verifyTotpCode(plainSecret, cleanCode, 1)) {
        clearAuthFailure(req, 'totp');
        res.json({ verified: true, method: 'totp', consumedBackupHash: null });
        return;
      }

      const candidateHash = hashBackupCode(cleanCode);
      if (Array.isArray(backupCodeHashes) && backupCodeHashes.includes(candidateHash)) {
        clearAuthFailure(req, 'totp');
        res.json({
          verified: true,
          method: 'backup_code',
          consumedBackupHash: candidateHash,
        });
        return;
      }

      const penalty = recordAuthFailure(req, 'totp');
      res.status(401).json({
        error:
          penalty.lockSeconds > 0
            ? `Неверный код 2FA. Временная блокировка на ${penalty.lockSeconds} сек.`
            : 'Неверный код 2FA или резервный код.',
      });
    } catch {
      recordAuthFailure(req, 'totp');
      res.status(400).json({ error: 'Ошибка проверки 2FA.' });
    }
  });

  // Security: Resolve current request IP & geographic coordinates for session map
  const geoCache = new Map<
    string,
    {
      expiresAt: number;
      data: {
        ipAddress: string;
        city: string;
        country: string;
        countryCode: string;
        latitude: number;
        longitude: number;
      };
    }
  >();

  app.get('/api/security/session-geo', async (req, res) => {
    // Используем только req.ip (с доверенным trust proxy=1), игнорируя поддельные X-Forwarded-For от клиента
    const candidateRaw = (req.ip || req.socket.remoteAddress || '').trim();
    const cleanedIp = candidateRaw.replace(/^::ffff:/, '').slice(0, 64);

    const isPrivateIp =
      !cleanedIp ||
      cleanedIp === '::1' ||
      cleanedIp.startsWith('127.') ||
      cleanedIp.startsWith('10.') ||
      cleanedIp.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(cleanedIp) ||
      cleanedIp.startsWith('fc') ||
      cleanedIp.startsWith('fd');

    const cacheKey = isPrivateIp ? '__local_exit__' : cleanedIp;
    const cached = geoCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      res.json(cached.data);
      return;
    }

    const fetchWithTimeout = async (url: string) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      try {
        return await fetch(url, { signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
    };

    try {
      const lookupUrl = isPrivateIp
        ? 'https://ipwho.is/'
        : `https://ipwho.is/${encodeURIComponent(cleanedIp)}`;
      const resp = await fetchWithTimeout(lookupUrl);
      if (resp.ok) {
        const json = (await resp.json()) as {
          success?: boolean;
          ip?: string;
          city?: string;
          country?: string;
          country_code?: string;
          latitude?: number;
          longitude?: number;
        };
        if (json.success !== false && typeof json.latitude === 'number' && typeof json.longitude === 'number') {
          const resolved = {
            ipAddress: String(json.ip || cleanedIp || 'Не определён').slice(0, 64),
            city: String(json.city || 'Неизвестный город').slice(0, 80),
            country: String(json.country || 'Неизвестная страна').slice(0, 80),
            countryCode: String(json.country_code || 'XX').toUpperCase().slice(0, 8),
            latitude: Math.max(-90, Math.min(90, Number(json.latitude))),
            longitude: Math.max(-180, Math.min(180, Number(json.longitude))),
          };
          geoCache.set(cacheKey, { data: resolved, expiresAt: Date.now() + 10 * 60_000 });
          res.json(resolved);
          return;
        }
      }
    } catch {
      // Try secondary geolocation provider below
    }

    try {
      const fallbackUrl = isPrivateIp
        ? 'https://ipapi.co/json/'
        : `https://ipapi.co/${encodeURIComponent(cleanedIp)}/json/`;
      const resp2 = await fetchWithTimeout(fallbackUrl);
      if (resp2.ok) {
        const json2 = (await resp2.json()) as {
          ip?: string;
          city?: string;
          country_name?: string;
          country_code?: string;
          latitude?: number;
          longitude?: number;
          error?: boolean;
        };
        if (!json2.error && typeof json2.latitude === 'number' && typeof json2.longitude === 'number') {
          const resolved = {
            ipAddress: String(json2.ip || cleanedIp || 'Не определён').slice(0, 64),
            city: String(json2.city || 'Неизвестный город').slice(0, 80),
            country: String(json2.country_name || 'Неизвестная страна').slice(0, 80),
            countryCode: String(json2.country_code || 'XX').toUpperCase().slice(0, 8),
            latitude: Math.max(-90, Math.min(90, Number(json2.latitude))),
            longitude: Math.max(-180, Math.min(180, Number(json2.longitude))),
          };
          geoCache.set(cacheKey, { data: resolved, expiresAt: Date.now() + 10 * 60_000 });
          res.json(resolved);
          return;
        }
      }
    } catch {
      // Fall through to header / cloud region fallback
    }

    const headerCountry = String(
      req.headers['cf-ipcountry'] || req.headers['x-appengine-country'] || 'GB'
    )
      .toUpperCase()
      .slice(0, 8);
    const headerCity = String(req.headers['x-appengine-city'] || 'London').slice(0, 80);

    res.json({
      ipAddress: cleanedIp || '127.0.0.1',
      city: isPrivateIp ? 'Локальный хост' : headerCity,
      country: isPrivateIp ? 'Cloud / Edge Node' : headerCountry,
      countryCode: isPrivateIp ? 'EU' : headerCountry,
      latitude: 51.5074,
      longitude: -0.1278,
    });
  });

  // Оплата PRO / MAX (криптовалюта через NOWPayments)
  app.get('/api/billing/plans', (_req, res) => {
    res.json({
      enabled: isBillingConfigured(),
      plans: getPlanPrices(),
      tiers: getTieredPlanPrices(),
      maxMultipliers: getMaxMultiplierPlans(),
      creditCosts: CREDIT_COSTS,
    });
  });

  app.post('/api/billing/checkout', requireAuth, strictAuthLimiter, async (req, res) => {
    try {
      const body = req.body as { period?: unknown; tier?: unknown; maxMultiplier?: unknown };
      const period = body?.period;
      if (period !== 'month' && period !== 'year') {
        res.status(400).json({ error: 'Выберите период подписки: месяц или год.' });
        return;
      }
      const tier: SubscriptionTier = body?.tier === 'max' ? 'max' : 'pro';
      const maxMultiplier: MaxMultiplier = Number(body?.maxMultiplier) === 20 ? 20 : 10;
      const { invoiceUrl } = await createCheckout(req.user!.uid, period as BillingPeriod, tier, maxMultiplier);
      res.json({ invoiceUrl });
    } catch (err) {
      res.status(503).json({ error: err instanceof Error ? err.message : 'Не удалось создать счёт на оплату.' });
    }
  });

  // Уведомления NOWPayments (IPN). Без подписи — отказ; тариф выдаёт только проверенное уведомление.
  app.post('/api/billing/ipn', async (req, res) => {
    const signature = req.headers['x-nowpayments-sig'];
    if (!verifyIpnSignature(req.body, typeof signature === 'string' ? signature : undefined)) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }
    try {
      await processIpn(req.body as Record<string, unknown>);
      res.json({ ok: true });
    } catch (err) {
      serverLogger.error('billing', 'Ошибка обработки IPN:', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'IPN processing failed' }); // NOWPayments повторит доставку
    }
  });

  // Web Push: Public VAPID key for Service Worker subscription
  app.get('/api/push/vapid-public-key', (_req, res) => {
    res.json({ publicKey: getVapidPublicKey() });
  });

  // Web Push: Register or update device push subscription
  app.post('/api/push/subscribe', requireAuth, (req, res) => {
    try {
      const body = req.body as {
        uid?: string;
        subscription?: {
          endpoint?: string;
          keys?: { p256dh?: string; auth?: string };
        };
        notifySignals?: boolean;
        notifyMarketMoves?: boolean;
        notifyVolatilitySpikes?: boolean;
        volatilityThresholdPct?: number;
        notifyPortfolioPnl?: boolean;
        portfolioPnlThresholdPct?: number;
        notifyNews?: boolean;
        notifyAuthLogins?: boolean;
        notifyStrategyChanges?: boolean;
        notifySignalLimits?: boolean;
        enabled?: boolean;
      };
      const uid = req.user!.uid;
      const endpoint = typeof body.subscription?.endpoint === 'string' ? body.subscription.endpoint.trim() : '';
      const p256dh = typeof body.subscription?.keys?.p256dh === 'string' ? body.subscription.keys.p256dh : '';
      const authKey = typeof body.subscription?.keys?.auth === 'string' ? body.subscription.keys.auth : '';

      if (!isAllowedPushEndpoint(endpoint) || !p256dh || !authKey || p256dh.length > 256 || authKey.length > 64) {
        res.status(400).json({ error: 'Некорректные данные Push-подписки.' });
        return;
      }

      const rawVolThreshold = Number(body.volatilityThresholdPct);
      const volatilityThresholdPct =
        Number.isFinite(rawVolThreshold) && rawVolThreshold >= 1 && rawVolThreshold <= 25
          ? Math.round(rawVolThreshold * 10) / 10
          : 5;

      const rawPortfolioThreshold = Number(body.portfolioPnlThresholdPct);
      const portfolioPnlThresholdPct =
        Number.isFinite(rawPortfolioThreshold) && rawPortfolioThreshold >= 1 && rawPortfolioThreshold <= 50
          ? Math.round(rawPortfolioThreshold * 10) / 10
          : 5;

      registerPushSubscription({
        uid,
        endpoint,
        subscription: {
          endpoint,
          keys: { p256dh, auth: authKey },
        },
        notifySignals: body.notifySignals !== false,
        notifyMarketMoves: body.notifyMarketMoves !== false,
        notifyVolatilitySpikes: body.notifyVolatilitySpikes !== false,
        volatilityThresholdPct,
        notifyPortfolioPnl: body.notifyPortfolioPnl !== false,
        portfolioPnlThresholdPct,
        notifyNews: body.notifyNews !== false,
        notifyAuthLogins: body.notifyAuthLogins !== false,
        notifyStrategyChanges: body.notifyStrategyChanges !== false,
        notifySignalLimits: body.notifySignalLimits !== false,
        enabled: body.enabled !== false,
      });

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Ошибка регистрации Push-подписки' });
    }
  });

  // Web Push: Remove device subscription
  app.post('/api/push/unsubscribe', requireAuth, (req, res) => {
    const endpoint = typeof (req.body as { endpoint?: unknown })?.endpoint === 'string'
      ? String((req.body as { endpoint: string }).endpoint).trim()
      : '';
    if (endpoint) {
      unregisterPushSubscription(endpoint, req.user!.uid);
    }
    res.json({ ok: true });
  });

  // Web Push: Dispatch test notification to verify background Service Worker delivery
  app.post('/api/push/send-test', requireAuth, expensiveLimiter, async (req, res) => {
    try {
      const uid = req.user!.uid;
      const result = await dispatchPushToUser(uid, {
        title: 'Vernier · Тест фоновых уведомлений',
        body: 'Push-канал активен. Вы будете получать сигналы стратегий и рыночные импульсы даже при закрытом приложении.',
        tag: 'vernier-test',
        url: '/?tab=security',
        impact: 'HIGH',
        category: 'test',
      });
      if (result.sent === 0) {
        res.status(404).json({
          error: 'Активная Push-подписка не найдена. Нажмите «Включить Push-уведомления» и разрешите показ в браузере.',
        });
        return;
      }
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Ошибка отправки тест-уведомления' });
    }
  });

  // Web Push: Notify user when a strategy analysis issues a LONG or SHORT signal
  app.post('/api/push/trigger-signal', requireAuth, expensiveLimiter, async (req, res) => {
    try {
      const body = req.body as {
        symbol?: string;
        marketType?: string;
        direction?: string;
        confidence?: number;
        strategyName?: string;
        entryZone?: string;
      };
      const uid = req.user!.uid;
      const direction = body.direction === 'LONG' || body.direction === 'SHORT' ? body.direction : '';
      if (!uid || !direction) {
        res.json({ ok: true, skipped: true });
        return;
      }
      const symbol = String(body.symbol || 'BTCUSDT').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
      const marketLabel = body.marketType === 'futures' ? 'Фьючерсы' : 'Спот';
      const confidence = Math.round(Number(body.confidence || 0));
      const strategyName = String(body.strategyName || 'Торговая стратегия').slice(0, 80);
      const entryZone = String(body.entryZone || '').slice(0, 80);

      const result = await dispatchPushToUser(uid, {
        title: `Vernier · Сигнал ${direction} ${symbol}`,
        body: `${strategyName} (${marketLabel}) · Уверенность ${confidence}%${entryZone ? ` · Вход: ${entryZone}` : ''}`,
        tag: `signal-${symbol}-${direction}`,
        url: '/?tab=market',
        impact: confidence >= 75 ? 'HIGH' : 'MEDIUM',
        category: 'signal',
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Ошибка отправки сигнала' });
    }
  });

  // Web Push: Critical security & limit alerts (login, strategy changes, signal limits)
  app.post('/api/push/security-event', requireAuth, expensiveLimiter, async (req, res) => {
    try {
      const body = req.body as {
        category?: string;
        title?: string;
        body?: string;
        url?: string;
      };
      const uid = req.user!.uid;
      const category =
        body.category === 'auth_login' ||
        body.category === 'strategy_change' ||
        body.category === 'signal_limit'
          ? body.category
          : null;
      if (!category || typeof body.title !== 'string' || typeof body.body !== 'string' || !body.title || !body.body) {
        res.status(400).json({ error: 'Некорректные параметры критического уведомления.' });
        return;
      }
      const result = await dispatchPushToUser(uid, {
        title: String(body.title).slice(0, 120),
        body: String(body.body).slice(0, 300),
        tag: `sec-${category}`,
        url: typeof body.url === 'string' && /^\/(?!\/)[^\s]*$/.test(body.url) ? body.url.slice(0, 200) : '/?tab=security',
        impact: 'HIGH',
        category,
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Ошибка отправки критического Push' });
    }
  });

  // Web Push: Notify user when daily portfolio PnL exceeds configured threshold (e.g. ±5%)
  app.post('/api/push/portfolio-pnl', requireAuth, expensiveLimiter, async (req, res) => {
    try {
      const body = req.body as {
        dailyPnlPct?: number;
        dailyPnlUsdt?: number;
        totalValue?: number;
        thresholdPct?: number;
      };
      const dailyPnlPct = Number(body.dailyPnlPct);
      const dailyPnlUsdt = Number(body.dailyPnlUsdt);
      const totalValue = Number(body.totalValue);
      const thresholdPct =
        body.thresholdPct !== undefined ? Number(body.thresholdPct) : undefined;

      if (
        !Number.isFinite(dailyPnlPct) ||
        !Number.isFinite(dailyPnlUsdt) ||
        !Number.isFinite(totalValue) ||
        totalValue <= 0 ||
        (thresholdPct !== undefined && !Number.isFinite(thresholdPct))
      ) {
        res.status(400).json({ error: 'Некорректные метрики дневного PnL портфеля.' });
        return;
      }

      const result = await notifyPortfolioDailyPnl(req.user!.uid, {
        dailyPnlPct,
        dailyPnlUsdt,
        totalValue,
        thresholdPct,
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Ошибка отправки Push по PnL портфеля' });
    }
  });

  // Web Push: Notify user when a specific portfolio reaches its Target PnL / target balance goal
  app.post('/api/push/portfolio-target', requireAuth, expensiveLimiter, async (req, res) => {
    try {
      const body = req.body as {
        portfolioId?: string;
        portfolioLabel?: string;
        targetBalanceUsdt?: number;
        currentBalanceUsdt?: number;
        baselineBalanceUsdt?: number;
        targetPnlPct?: number;
      };
      const portfolioId = String(body.portfolioId || 'manual')
        .replace(/[^a-zA-Z0-9_-]/g, '')
        .slice(0, 64);
      const portfolioLabel = String(body.portfolioLabel || 'Портфель')
        .replace(/[\r\n]/g, ' ')
        .trim()
        .slice(0, 80);
      const targetBalanceUsdt = Number(body.targetBalanceUsdt);
      const currentBalanceUsdt = Number(body.currentBalanceUsdt);
      const baselineBalanceUsdt =
        body.baselineBalanceUsdt !== undefined ? Number(body.baselineBalanceUsdt) : undefined;
      const targetPnlPct =
        body.targetPnlPct !== undefined ? Number(body.targetPnlPct) : undefined;

      if (
        !portfolioId ||
        !portfolioLabel ||
        !Number.isFinite(targetBalanceUsdt) ||
        !Number.isFinite(currentBalanceUsdt) ||
        targetBalanceUsdt <= 0 ||
        currentBalanceUsdt <= 0
      ) {
        res.status(400).json({ error: 'Некорректные параметры цели доходности портфеля.' });
        return;
      }

      const result = await notifyPortfolioTargetReached(req.user!.uid, {
        portfolioId,
        portfolioLabel,
        targetBalanceUsdt,
        currentBalanceUsdt,
        baselineBalanceUsdt: Number.isFinite(baselineBalanceUsdt) ? baselineBalanceUsdt : undefined,
        targetPnlPct: Number.isFinite(targetPnlPct) ? targetPnlPct : undefined,
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Ошибка отправки Push по цели портфеля' });
    }
  });

  // Web Push: On-demand market anomaly & funding rate scan
  app.post('/api/push/scan-market', requireAuth, expensiveLimiter, async (req, res) => {
    try {
      const [marketResult, priceAlertsResult] = await Promise.all([
        scanMarketAndNotify(),
        checkPriceAlertsForUser(req.user!.uid),
      ]);
      res.json({
        ...marketResult,
        alertsSent: marketResult.alertsSent + priceAlertsResult.alertsSent,
        priceAlertsTriggered: priceAlertsResult.triggered.length,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Ошибка сканирования рынка' });
    }
  });

  // Web Push: Sync user custom price threshold alerts for background monitoring
  app.post('/api/push/price-alerts/sync', requireAuth, (req, res) => {
    try {
      const body = req.body as {
        alerts?: Array<{
          id?: string;
          symbol?: string;
          marketType?: string;
          condition?: string;
          targetPrice?: number;
          active?: boolean;
          updatedAtMs?: number;
        }>;
      };
      const uid = req.user!.uid;

      const rawAlerts = Array.isArray(body.alerts) ? body.alerts.slice(0, 100) : [];
      const normalized = rawAlerts
        .filter(
          (a) =>
            typeof a.id === 'string' &&
            typeof a.symbol === 'string' &&
            typeof a.targetPrice === 'number' &&
            a.targetPrice > 0
        )
        .map((a) => ({
          id: String(a.id).slice(0, 64),
          uid,
          symbol: String(a.symbol).toUpperCase().slice(0, 24),
          marketType: (a.marketType === 'futures' ? 'futures' : 'spot') as 'spot' | 'futures',
          condition: (a.condition === 'below' ? 'below' : 'above') as 'above' | 'below',
          targetPrice: Number(a.targetPrice),
          active: Boolean(a.active),
          updatedAtMs: typeof a.updatedAtMs === 'number' ? a.updatedAtMs : undefined,
        }));

      const triggered = syncUserPriceAlerts(uid, normalized);
      res.json({ ok: true, activeCount: normalized.filter((a) => a.active).length, triggered });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Ошибка синхронизации ценовых алертов' });
    }
  });

  // Web Push: Immediately check custom price alerts for user against live prices
  app.post('/api/push/price-alerts/check', requireAuth, expensiveLimiter, async (req, res) => {
    try {
      const uid = req.user!.uid;
      const result = await checkPriceAlertsForUser(uid);
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Ошибка проверки ценовых алертов' });
    }
  });

  // Exchange Integration: Verify API credentials against exchange, fetch initial balances, encrypt secrets
  app.post('/api/exchanges/connect', requireAuth, strictAuthLimiter, async (req, res) => {
    if (checkAuthBackoffLock(req, res, 'exchange_connect')) return;
    try {
      const uid = req.user!.uid;
      const body = req.body as Record<string, unknown>;
      const exchange = body.exchange;
      const permissions = body.permissions;
      const label = typeof body.label === 'string' ? body.label.trim().slice(0, 64) : '';
      const apiKey = typeof body.apiKey === 'string' ? body.apiKey : '';
      const apiSecret = typeof body.apiSecret === 'string' ? body.apiSecret : '';
      const passphrase = typeof body.passphrase === 'string' ? body.passphrase : '';
      const testnet = Boolean(body.testnet);

      if (!isValidExchangeId(exchange)) {
        res.status(400).json({ error: 'Поддерживаются только биржи Binance, Bybit и OKX.' });
        return;
      }
      if (!isValidPermissions(permissions)) {
        res.status(400).json({ error: 'Укажите уровень доступа ключа: только чтение или торговля.' });
        return;
      }
      if (label.length < 2) {
        res.status(400).json({ error: 'Укажите название подключения (минимум 2 символа).' });
        return;
      }

      const result = await connectAndEncryptExchange({
        uid,
        exchange,
        label,
        apiKey,
        apiSecret,
        passphrase,
        permissions,
        testnet,
      });

      clearAuthFailure(req, 'exchange_connect');
      res.json({ ok: true, ...result, maxTestnetOrderUsdt: MAX_TESTNET_ORDER_USDT });
    } catch (err) {
      recordAuthFailure(req, 'exchange_connect');
      if (err instanceof ExchangeApiError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : 'Ошибка подключения биржи' });
    }
  });

  // Exchange Integration: Decrypt stored user credentials on server and sync live wallet balances
  app.post('/api/exchanges/sync', requireAuth, expensiveLimiter, async (req, res) => {
    try {
      const uid = req.user!.uid;
      const body = req.body as Record<string, unknown>;
      const exchange = body.exchange;
      const encryptedApiKey = typeof body.encryptedApiKey === 'string' ? body.encryptedApiKey : '';
      const encryptedApiSecret = typeof body.encryptedApiSecret === 'string' ? body.encryptedApiSecret : '';
      const encryptedPassphrase = typeof body.encryptedPassphrase === 'string' ? body.encryptedPassphrase : '';
      const testnet = Boolean(body.testnet);

      if (!isValidExchangeId(exchange) || !encryptedApiKey || !encryptedApiSecret) {
        res.status(400).json({ error: 'Недостаточно данных для синхронизации баланса биржи.' });
        return;
      }

      const sync = await syncEncryptedExchangeBalances({
        uid,
        exchange,
        encryptedApiKey,
        encryptedApiSecret,
        encryptedPassphrase,
        testnet,
      });

      res.json({ ok: true, sync });
    } catch (err) {
      if (err instanceof ExchangeApiError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : 'Ошибка синхронизации баланса биржи' });
    }
  });

  // Exchange Integration: Execute Testnet Spot/Futures order (Live Trade заблокирован на сервере; клиентские permissions игнорируются)
  app.post('/api/exchanges/order', requireAuth, strictAuthLimiter, async (req, res) => {
    if (checkAuthBackoffLock(req, res, 'exchange_order')) return;
    try {
      const uid = req.user!.uid;
      const body = req.body as Record<string, unknown>;
      const exchange = body.exchange;
      const encryptedApiKey = typeof body.encryptedApiKey === 'string' ? body.encryptedApiKey : '';
      const encryptedApiSecret = typeof body.encryptedApiSecret === 'string' ? body.encryptedApiSecret : '';
      const encryptedPassphrase = typeof body.encryptedPassphrase === 'string' ? body.encryptedPassphrase : '';
      const testnet = Boolean(body.testnet);
      const confirmResponsibility = body.confirmResponsibility === true;
      const confirmStatement = typeof body.confirmStatement === 'string' ? body.confirmStatement.trim() : '';
      const symbol = typeof body.symbol === 'string' ? body.symbol : '';
      const marketType = body.marketType === 'futures' ? 'futures' : 'spot';
      const side = body.side === 'SELL' ? 'SELL' : body.side === 'BUY' ? 'BUY' : null;
      const orderType = body.orderType === 'LIMIT' ? 'LIMIT' : 'MARKET';
      const quantity = Number(body.quantity);
      const limitPrice = body.limitPrice !== undefined ? Number(body.limitPrice) : undefined;
      const stopLoss = body.stopLoss !== undefined ? Number(body.stopLoss) : undefined;
      const takeProfit = body.takeProfit !== undefined ? Number(body.takeProfit) : undefined;

      if (!isValidExchangeId(exchange) || !side) {
        res.status(400).json({ error: 'Некорректные параметры торгового ордера.' });
        return;
      }
      if (!encryptedApiKey || !encryptedApiSecret) {
        res.status(400).json({ error: 'Отсутствуют зашифрованные ключи выбранной биржи.' });
        return;
      }

      const order = await executeEncryptedExchangeOrder({
        uid,
        exchange,
        encryptedApiKey,
        encryptedApiSecret,
        encryptedPassphrase,
        testnet,
        confirmResponsibility,
        confirmStatement,
        symbol,
        marketType,
        side,
        orderType,
        quantity,
        limitPrice,
        stopLoss,
        takeProfit,
      });

      clearAuthFailure(req, 'exchange_order');
      res.json({ ok: true, order });
    } catch (err) {
      if (err instanceof ExchangeApiError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : 'Ошибка исполнения ордера на бирже' });
    }
  });

  // Support & Feedback intake for guest or fallback submissions
  app.post('/api/support', expensiveLimiter, (req, res) => {
    const body = req.body as Record<string, unknown>;
    const contactEmail = typeof body.contactEmail === 'string' ? body.contactEmail.trim() : '';
    const category = typeof body.category === 'string' ? body.category : 'other';
    const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
    const message = typeof body.message === 'string' ? body.message.trim() : '';

    const allowedCategories = new Set(['alerts', 'chart', 'billing', 'security', 'other']);
    if (!contactEmail || contactEmail.length < 3 || contactEmail.length > 200 || !contactEmail.includes('@')) {
      res.status(400).json({ error: 'Укажите корректный email для обратной связи.' });
      return;
    }
    if (!allowedCategories.has(category)) {
      res.status(400).json({ error: 'Некорректная категория обращения.' });
      return;
    }
    if (subject.length < 3 || subject.length > 140) {
      res.status(400).json({ error: 'Тема должна содержать от 3 до 140 символов.' });
      return;
    }
    if (message.length < 10 || message.length > 2000) {
      res.status(400).json({ error: 'Сообщение должно содержать от 10 до 2000 символов.' });
      return;
    }

    const ticketId = `sup_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    res.json({ ok: true, ticketId, createdAt: new Date().toISOString() });
  });

  // Gemini-powered Terminal Help Assistant Chat
  app.post('/api/support/chat', expensiveLimiter, async (req, res) => {
    try {
      const body = req.body as { message?: unknown; history?: unknown };
      const message = typeof body.message === 'string' ? body.message.trim() : '';
      if (message.length < 2 || message.length > 800) {
        res.status(400).json({ error: 'Вопрос должен содержать от 2 до 800 символов.' });
        return;
      }

      const history: TerminalChatTurn[] = Array.isArray(body.history)
        ? body.history
            .filter(
              (item): item is { role: 'user' | 'model'; text: string } =>
                typeof item === 'object' &&
                item !== null &&
                ((item as { role?: unknown }).role === 'user' ||
                  (item as { role?: unknown }).role === 'model') &&
                typeof (item as { text?: unknown }).text === 'string'
            )
            .slice(-8)
        : [];

      const reply = await askTerminalAssistant({ message, history });
      res.json({ reply });
    } catch (err) {
      if (err instanceof AiServiceError) {
        res.status(err.statusCode).json({ error: err.message, code: err.code });
        return;
      }
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Не удалось получить ответ от ассистента.',
      });
    }
  });

  // Ensure /api requests never fall through to Vite/SPA HTML fallback or Express HTML error pages
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API-маршрут не найден.', code: 'NOT_FOUND' });
  });

  app.use(
    '/api',
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      if (err instanceof AiServiceError) {
        res.status(err.statusCode).json({ error: err.message, code: err.code });
        return;
      }
      const status =
        typeof err === 'object' && err !== null && 'status' in err
          ? Number((err as { status?: number }).status) || 500
          : 500;
      const msg = err instanceof Error ? err.message : 'Внутренняя ошибка API.';
      res.status(status).json({ error: msg });
    }
  );

  const httpServer = http.createServer(app);

  // Виджет TradingView (Advanced Real-Time Chart) на ОТДЕЛЬНОЙ странице.
  // Приложение показывает её в <iframe sandbox> без allow-same-origin, поэтому скрипт TradingView
  // не получает доступа ни к вашему аккаунту, ни к данным приложения. У страницы своя строгая CSP.
  const TV_INTERVALS = new Set(['15', '60', '240', 'D']);
  app.get('/embed/tradingview', generalApiLimiter, (req, res) => {
    const requested = String(req.query.symbol || 'BTCUSDT').toUpperCase();
    const symbol = (SUPPORTED_SYMBOLS as readonly string[]).includes(requested) ? requested : 'BTCUSDT';
    const futures = req.query.marketType === 'futures';
    const interval = TV_INTERVALS.has(String(req.query.interval)) ? String(req.query.interval) : '60';
    const tvSymbol = `BINANCE:${symbol}${futures ? '.P' : ''}`; // только [A-Z0-9:.] — безопасно для HTML
    const config = {
      autosize: true,
      symbol: tvSymbol,
      interval,
      timezone: 'Etc/UTC',
      theme: 'dark',
      style: '1',
      locale: 'ru',
      backgroundColor: 'rgba(11, 15, 23, 1)',
      withdateranges: true,
      hide_side_toolbar: false,
      allow_symbol_change: true,
      save_image: false,
      calendar: false,
      support_host: 'https://www.tradingview.com',
    };
    const json = JSON.stringify(config).replace(/</g, '\\u003c');
    const page = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>TradingView</title>
<style>html,body,iframe{margin:0;height:100%;background:#0B0F17;overflow:hidden}
.tradingview-widget-container{height:100%;width:100%;background:#0B0F17}
.tradingview-widget-container__widget{height:calc(100% - 28px);width:100%}
.tradingview-widget-copyright{font:12px/28px system-ui,sans-serif;text-align:center;height:28px;color:#94a3b8}
.tradingview-widget-copyright a{color:#60a5fa;text-decoration:none}</style></head>
<body><div class="tradingview-widget-container"><div class="tradingview-widget-container__widget"></div>
<div class="tradingview-widget-copyright"><a href="https://www.tradingview.com/symbols/${tvSymbol.replace(':', '-')}/" rel="noopener nofollow" target="_blank">${symbol} chart</a> by TradingView</div>
<script type="text/javascript" src="https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js" async>${json}</script>
</div></body></html>`;
    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Content-Security-Policy': [
        "default-src 'none'",
        "script-src https://s3.tradingview.com https://www.tradingview-widget.com",
        "style-src 'unsafe-inline' https:",
        'img-src https: data: blob:',
        'font-src https: data:',
        'connect-src https: wss:',
        'frame-src https://www.tradingview-widget.com https://s.tradingview.com https:',
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'self' https://aistudio.google.com https://*.google.com",
      ].join('; '),
    });
    res.send(page);
  });

  if (!isProd) {
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      plugins: hmrDisabled
        ? [
            {
              name: 'disable-hmr-client-ws',
              enforce: 'post',
              transform(code, id) {
                if (
                  (id.includes('vite/dist/client/client.mjs') || id.endsWith('/@vite/client')) &&
                  code.includes('await wsTransport.connect(handlers);')
                ) {
                  return {
                    code: code
                      .replace('await wsTransport.connect(handlers);', 'return;')
                      .replace('await wsTransport.disconnect();', 'return;')
                      .replace('wsTransport.send(data);', 'void data;'),
                    map: null,
                  };
                }
              },
            },
          ]
        : [],
      server: {
        middlewareMode: true,
        allowedHosts: true,
        ws: hmrDisabled ? false : { server: httpServer },
        hmr: hmrDisabled ? false : true,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  startMarketAlertMonitor();
  startProExpiryMonitor();

  httpServer.listen(PORT, '0.0.0.0', () => {
    serverLogger.info('server', `Vernier server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
