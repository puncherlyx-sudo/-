import 'dotenv/config';
import crypto from 'crypto';
import compression from 'compression';
import express from 'express';
import rateLimit from 'express-rate-limit';
import http from 'http';
import path from 'path';
import QRCode from 'qrcode';
import { createServer as createViteServer } from 'vite';
import { serverLogger } from './server/logger.ts';
import { applySecurityHeaders } from './server/middleware/securityHeaders.ts';
import {
  isAllowedPushEndpoint,
  requireAuth,
  requireFreshAuth,
  revokeUserRefreshTokens,
  verifyFirebaseIdToken,
} from './server/auth.ts';
import {
  authorize2faMutation,
  clearMemoryTotpRecord,
  getMemoryLastTotpStep,
  getMemoryTotpRecord,
  recordServerSecurityEvent,
  requireStepUpForUser,
  resolveUser2faState,
  setMemoryLastTotpStep,
  setMemoryStepUpUntil,
  setMemoryTotpRecord,
  STEP_UP_TTL_MS,
} from './server/securityGuard.ts';
import {
  getMaxMultiplierPlans,
  getPlanPrices,
  getTieredPlanPrices,
  startProExpiryMonitor,
} from './server/billing.ts';
import {
  consumeUserCredits,
  EntitlementError,
  getAdminDb,
  getUserEntitlements,
  IMMUTABLE_CREDIT_COSTS,
  IMMUTABLE_MAX_LEVERAGE,
  isValidBillableAction,
  refundUserCredits,
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
  notifyCriticalExchangeSyncError,
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
  matchBackupCodeHash,
  verifyTotpCodeWithStep,
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

  // Audit G4: Диагностика критических переменных окружения при старте в production
  if (isProd) {
    const missingWarnings: string[] = [];
    if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      missingWarnings.push('FIREBASE_SERVICE_ACCOUNT_JSON (серверная проверка 2FA/квот/биллинга будет fail-closed 503)');
    }
    if (!process.env.BACKUP_CODE_PEPPER) {
      missingWarnings.push('BACKUP_CODE_PEPPER (рекомендуется отдельный секретный перец для резервных кодов 2FA)');
    }
    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'MY_GEMINI_API_KEY') {
      missingWarnings.push('GEMINI_API_KEY (AI-анализ и чат недоступны)');
    }
    if (missingWarnings.length > 0) {
      serverLogger.warn('boot', `Production security/config checklist: отсутствуют ${missingWarnings.join('; ')}`);
    }
  }

  app.set('trust proxy', 1);

  // Централизованные строгие HTTP-заголовки безопасности (CSP без unsafe-eval, HSTS, nosniff, DENY, Permissions-Policy)
  applySecurityHeaders(app, { isProd });

  // Audit I3: Сжатие HTTP-ответов (gzip/deflate)
  app.use(compression());

  // Audit I3: Стандартный /.well-known/security.txt (RFC 9116)
  app.get('/.well-known/security.txt', (_req, res) => {
    const contact = process.env.SECURITY_CONTACT_EMAIL || 'security@vernier-terminal.app';
    const expires = new Date(Date.now() + 365 * 86_400_000).toISOString();
    res.set({
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    });
    res.send(
      [
        `Contact: mailto:${contact}`,
        `Expires: ${expires}`,
        'Preferred-Languages: ru, en',
        'Policy: /?tab=security',
      ].join('\n') + '\n'
    );
  });

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
      if (k) {
        try {
          out[k] = decodeURIComponent(v);
        } catch {
          out[k] = v;
        }
      }
    }
    return out;
  }

  function issueCsrfCookie(req: express.Request, res: express.Response, existingToken?: string): string {
    const token =
      existingToken && /^[0-9a-f]{64}$/.test(existingToken)
        ? existingToken
        : crypto.randomBytes(32).toString('hex');
    const isHttps =
      isProd ||
      req.secure ||
      String(req.headers['x-forwarded-proto'] || '').toLowerCase().includes('https');
    const cookieParts = [
      `${CSRF_COOKIE_NAME}=${token}`,
      'Path=/',
      isHttps ? 'SameSite=None' : 'SameSite=Lax',
      'Max-Age=43200',
    ];
    if (isHttps) {
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

  // Запрет передачи auth-токенов в URL query parameters и единый Cache-Control: no-store для всех /api/*
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
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
    const csrfToken = issueCsrfCookie(req, res, cookies[CSRF_COOKIE_NAME]);
    res.set('Cache-Control', 'no-store');
    res.json({ csrfToken });
  });

  // Извлекаем верифицированного пользователя (если передан Bearer-токен) ДО лимитера и CSRF-проверки
  app.use('/api', async (req, _res, next) => {
    const header = req.headers.authorization;
    const match = typeof header === 'string' ? /^Bearer\s+(\S+)$/i.exec(header) : null;
    if (match) {
      req.rawBearerToken = match[1];
      try {
        req.user = await verifyFirebaseIdToken(match[1]);
      } catch {
        // Невалидный токен будет отклонён в requireAuth на защищённых маршрутах
      }
    }
    next();
  });

  // Проверка Origin / CSRF на всех мутирующих /api/* маршрутах
  app.use('/api', (req, res, next) => {
    const method = req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      next();
      return;
    }

    if (!isTrustedOrigin(req)) {
      res.status(403).json({ error: 'Запрос отклонён политикой безопасности Origin/CSRF.' });
      return;
    }

    // Если запрос аутентифицирован верифицированным заголовком Authorization: Bearer,
    // двойная cookie не требуется (браузер не прикрепляет Authorization автоматически при CSRF) —
    // строгая проверка Origin выше уже защищает маршрут и исключает сбои в iframe.
    if (req.user?.uid) {
      next();
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

  // ---------- Устойчивый Rate-Limiting (ТОЛЬКО верифицированный UID или доверенный req.ip; клиентские заголовки исключены) ----------
  function getCompositeRateLimitKey(req: express.Request): string {
    if (req.user?.uid) {
      return `uid:${req.user.uid}`;
    }
    const trustedIp = (req.ip || req.socket.remoteAddress || 'unknown').replace(/^::ffff:/, '');
    return `ip:${trustedIp}`;
  }

  // Экспоненциальный backoff и временная блокировка после 5 неудачных попыток (2FA / биржевые операции)
  const MAX_AUTH_FAILURE_ENTRIES = 5_000;
  const authFailureTracker = new Map<string, { failures: number; lockedUntil: number; updatedAt: number }>();

  function pruneAuthFailureTracker(now: number): void {
    if (authFailureTracker.size < MAX_AUTH_FAILURE_ENTRIES) return;
    for (const [k, v] of authFailureTracker.entries()) {
      if (now - v.updatedAt > 30 * 60_000 && v.lockedUntil <= now) {
        authFailureTracker.delete(k);
      }
    }
    while (authFailureTracker.size >= MAX_AUTH_FAILURE_ENTRIES) {
      const oldest = authFailureTracker.keys().next().value;
      if (!oldest) break;
      authFailureTracker.delete(oldest);
    }
  }

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
    pruneAuthFailureTracker(now);
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
    res.json({
      ok: true,
      securityMode: isProd ? 'production-strict' : 'dev',
      timestamp: new Date().toISOString(),
    });
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

  // Серверный лимит принудительного обновления (?refresh=1): не чаще 1 раза в 60 сек на весь сервер
  const REFRESH_COOLDOWN_MS = 60_000;
  const lastForcedRefreshAt = new Map<string, number>();
  function allowForcedRefresh(feedKey: string): boolean {
    const now = Date.now();
    const prev = lastForcedRefreshAt.get(feedKey) ?? 0;
    if (now - prev < REFRESH_COOLDOWN_MS) {
      return false;
    }
    lastForcedRefreshAt.set(feedKey, now);
    return true;
  }

  // Grounded crypto news feed (with live RSS fallback + explicit notice on quota limits)
  app.get('/api/news', async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      // Только известные активы: иначе произвольный текст попадал бы в запрос к ИИ и в ключ кэша
      const requested = String(req.query.symbol || 'ALL').toUpperCase().slice(0, 12);
      const allowedNews = new Set(['ALL', ...SUPPORTED_SYMBOLS.map((s) => s.replace('USDT', ''))]);
      const symbol = allowedNews.has(requested) ? requested : 'ALL';
      const forceRefresh = req.query.refresh === '1' && allowForcedRefresh(`news:${symbol}`);
      const budgetContext = req.user?.uid
        ? { uid: req.user.uid, tier: await resolveAuthoritativePlan(req.user.uid) }
        : undefined;
      const news = await fetchGroundedCryptoNews(symbol, forceRefresh, budgetContext);
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

  // Batch full-sentence Russian translation for English RSS/news headlines (requires sign-in to protect Gemini quota)
  app.post('/api/news/translate', requireAuth, expensiveLimiter, async (req, res) => {
    try {
      const body = req.body as { items?: Array<{ id: string; title: string; summary: string }> };
      const list = Array.isArray(body?.items)
        ? body.items
            .slice(0, 12)
            .filter((item) => item && typeof item.id === 'string' && typeof item.title === 'string')
            .map((item) => ({
              id: item.id.slice(0, 80),
              title: item.title.slice(0, 280),
              summary: typeof item.summary === 'string' ? item.summary.slice(0, 480) : '',
            }))
        : [];
      if (list.length === 0) {
        res.json({ translations: {} });
        return;
      }
      const userTier = await resolveAuthoritativePlan(req.user!.uid);
      const translations = await translateNewsBatchToRussian(list, {
        uid: req.user!.uid,
        tier: userTier,
      });
      res.json({ translations });
    } catch {
      res.json({ translations: {} });
    }
  });

  // Grounded macro & crypto economic calendar (with live Deribit/OKX/Fed/Investing fallback)
  app.get('/api/economic-calendar', async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      const forceRefresh = req.query.refresh === '1' && allowForcedRefresh('economic-calendar');
      const budgetContext = req.user?.uid
        ? { uid: req.user.uid, tier: await resolveAuthoritativePlan(req.user.uid) }
        : undefined;
      const calendar = await fetchEconomicCalendar(forceRefresh, budgetContext);
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

      // Серверная проверка и атомарное списание 1 AI-кредита перед вызовом Gemini (с автовозвратом при сбое)
      let creditDeducted = false;
      const { snapshot: postCreditSnapshot } = await consumeUserCredits(req.user!.uid, 'ai_analysis');
      creditDeducted = true;

      try {
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
          budgetContext: { uid: req.user!.uid, tier: dbPlan },
        });

        res.json({
          analysis,
          indicators: marketData.indicators,
          source: marketData.source,
          entitlements: postCreditSnapshot,
        });
      } catch (innerErr) {
        if (creditDeducted) {
          await refundUserCredits(req.user!.uid, 'ai_analysis').catch((refundErr) => {
            serverLogger.warn('entitlements', 'Не удалось вернуть кредит после сбоя анализа:', refundErr);
          });
        }
        throw innerErr;
      }
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

  // Helper to optionally resolve verified UID & authoritative plan tier (demoTier полностью исключён на сервере)
  const resolveOptionalUid = async (req: express.Request): Promise<string | undefined> => {
    if (req.user?.uid) return req.user.uid;
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

  // Серверный кэш результатов бэктеста PnL (45с для авторизованных, 3 мин для анонимных — Audit H3)
  const pnlBacktestCache = new Map<string, { report: unknown; expiresAt: number }>();
  const anonScannerCache = new Map<string, { payload: unknown; expiresAt: number }>();
  const anonSentimentPreviewCache = new Map<string, { payload: unknown; expiresAt: number }>();
  const FREE_STRATEGY_KEYS = new Set(STRATEGY_CATALOG.filter((s) => s.tier === 'free').map((s) => s.key));

  // Quantitative Strategy PnL Portfolio Backtest (based on live/cached exchange candles)
  app.post('/api/strategies/pnl', expensiveLimiter, async (req, res) => {
    try {
      const body = req.body as {
        strategies?: StrategySimulationInput[];
        interval?: string;
        depositUsdt?: number;
        scope?: string;
      };
      if (!Array.isArray(body.strategies) || body.strategies.length === 0) {
        res.status(400).json({ error: 'Передайте хотя бы одну стратегию для расчета PnL.' });
        return;
      }
      const uid = await resolveOptionalUid(req);
      const tier = await resolveAuthoritativePlan(uid);
      let requestedInterval: '1h' | '4h' | '1d' =
        body.interval === '1d' ? '1d' : body.interval === '4h' ? '4h' : '1h';
      if (requestedInterval === '1d' && tier !== 'max') {
        requestedInterval = '4h';
      }
      if (!uid) {
        requestedInterval = '1h';
      }

      // Audit H3: для неавторизованных ограничиваем бэктест 3 бесплатными стратегиями и кэшируем на 3 мин
      const strategiesSlice = uid
        ? body.strategies.slice(0, 40)
        : body.strategies
            .filter((st) => FREE_STRATEGY_KEYS.has(String(st.strategyKey || '')))
            .slice(0, 3);
      if (strategiesSlice.length === 0) {
        res.status(400).json({ error: 'Для гостей доступен расчёт базовых бесплатных стратегий.' });
        return;
      }

      const depositUsdt = Number(body.depositUsdt || 2500);
      const scope = body.scope === 'all' ? 'all' : 'active';
      const cacheKey = crypto
        .createHash('sha1')
        .update(
          JSON.stringify({
            anon: !uid,
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
      pnlBacktestCache.set(cacheKey, { report, expiresAt: Date.now() + (uid ? 45_000 : 180_000) });
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
        activeStrategyConfigs?: Array<{
          strategyKey?: string;
          minConfidence?: number;
          pairs?: string[];
        }>;
      };
      const uid = await resolveOptionalUid(req);
      const tier = await resolveAuthoritativePlan(uid);

      const maxPairs = tier === 'max' ? SUPPORTED_SYMBOLS.length : tier === 'pro' ? 16 : 3;
      const timeframe: '1h' | '4h' = tier === 'max' && body.timeframe === '4h' ? '4h' : '1h';
      const minConfidence = Math.min(95, Math.max(55, Number(body.minConfidence || 70)));
      const marketFilter = body.marketFilter === 'spot' || body.marketFilter === 'futures' ? body.marketFilter : 'all';

      // Audit H3: для анонимных пользователей отдаём 3-минутный кэш публичного Free-скана
      const anonScanKey = !uid ? `anon:${marketFilter}:${minConfidence}` : '';
      if (anonScanKey) {
        const cachedScan = anonScannerCache.get(anonScanKey);
        if (cachedScan && cachedScan.expiresAt > Date.now()) {
          res.json(cachedScan.payload);
          return;
        }
      }

      const customCfgMap = new Map<string, { minConfidence?: number; pairs?: string[] }>();
      const hasExplicitActiveFilter =
        Boolean(uid) && Array.isArray(body.activeStrategyConfigs) && body.activeStrategyConfigs.length > 0;
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

      const responsePayload = {
        tier,
        scannedPairsCount: scanSymbols.length,
        totalPairsAvailable: SUPPORTED_SYMBOLS.length,
        timeframe,
        opportunities,
        strategyTelemetry,
        updatedAt: new Date().toISOString(),
      };

      if (anonScanKey) {
        if (anonScannerCache.size >= 24) {
          const oldest = anonScannerCache.keys().next().value;
          if (oldest) anonScannerCache.delete(oldest);
        }
        anonScannerCache.set(anonScanKey, { payload: responsePayload, expiresAt: Date.now() + 180_000 });
      }

      res.json(responsePayload);
    } catch (err) {
      serverLogger.error('strategies:scanner', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Ошибка сканера торговых сетапов' });
    }
  });

  // Exclusive PRO/MAX Advanced Market Sentiment forecast + real Free-vs-Sentiment backtest comparison
  app.post('/api/strategies/sentiment', expensiveLimiter, async (req, res) => {
    try {
      const uid = await resolveOptionalUid(req);
      const body = req.body as { asset?: string; interval?: string };
      // Авторитетный тариф определяется исключительно по токену и базе данных (demoTier запрещён на сервере)
      const tier = await resolveAuthoritativePlan(uid);
      const rawAsset = String(body.asset || 'ALL').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'ALL';
      const allowedAssets = new Set(['ALL', ...SUPPORTED_SYMBOLS.map((s) => s.replace('USDT', ''))]);
      const asset = allowedAssets.has(rawAsset) ? rawAsset : 'ALL';

      if (tier === 'free') {
        const cachedFree = anonSentimentPreviewCache.get(asset);
        if (cachedFree && cachedFree.expiresAt > Date.now()) {
          res.json(cachedFree.payload);
          return;
        }
      }

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
        const lockedPayload = {
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
        };
        if (anonSentimentPreviewCache.size >= 32) {
          const oldest = anonSentimentPreviewCache.keys().next().value;
          if (oldest) anonSentimentPreviewCache.delete(oldest);
        }
        anonSentimentPreviewCache.set(asset, { payload: lockedPayload, expiresAt: Date.now() + 120_000 });
        res.json(lockedPayload);
        return;
      }

      const newsPromise = fetchGroundedCryptoNews(asset, false, { uid, tier }).catch(() => ({
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

  // Audit G3: Серверный статус 2FA (включая обнаружение legacy-конфигураций, требующих миграции)
  app.get('/api/security/2fa-status', requireAuth, async (req, res) => {
    try {
      const uid = req.user!.uid;
      const state = await resolveUser2faState(uid);
      const nowMs = Date.now();
      res.json({
        enabled: state.enabled,
        hasServerSecret: state.hasServerSecret,
        needsMigration: state.needsMigration,
        stepUpActive: state.stepUpUntil > nowMs,
        stepUpUntil: state.stepUpUntil,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Ошибка проверки статуса 2FA' });
    }
  });

  // Audit I2: Серверный отзыв refresh-токенов пользователя (для «Завершить остальные сессии»)
  app.post('/api/security/revoke-sessions', requireAuth, requireFreshAuth(), strictAuthLimiter, async (req, res) => {
    try {
      const uid = req.user!.uid;
      const result = await revokeUserRefreshTokens(uid);
      await recordServerSecurityEvent(uid, {
        event: 'SESSIONS_REVOKED',
        title: 'Vernier · Сессии завершены',
        details: result.revoked
          ? 'Все refresh-токены других устройств отозваны на сервере.'
          : 'Инициировано завершение других сессий (клиентская ревокация).',
        severity: 'warning',
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Ошибка отзыва сессий' });
    }
  });

  // 2FA Step 1 (Audit G1 + I2): Generate TOTP secret + QR code; blocks takeover if 2FA already active without step-up/currentCode
  app.post('/api/security/totp/setup', requireAuth, requireFreshAuth(), strictAuthLimiter, async (req, res) => {
    if (checkAuthBackoffLock(req, res, 'totp')) return;
    try {
      const uid = req.user!.uid;
      const body = req.body as { email?: unknown; currentCode?: unknown };
      const authz = await authorize2faMutation(uid, {
        currentCode: typeof body?.currentCode === 'string' ? body.currentCode : undefined,
        isProd,
      });
      if (!authz.ok) {
        res.status(authz.status || 403).json({ error: authz.error, code: authz.code });
        return;
      }

      const email =
        req.user!.email ||
        (typeof body?.email === 'string' ? String(body.email).slice(0, 254) : '');
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
      const encryptedPendingSecret = encryptSecret(plainSecret, uid, 'totp');

      res.json({
        qrDataUrl,
        manualKey: plainSecret,
        encryptedPendingSecret,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Ошибка генерации 2FA' });
    }
  });

  // 2FA Step 2 (Audit G1 + I2): Verify initial 6-digit TOTP code and issue 8 HMAC-SHA256 10-char backup codes
  app.post('/api/security/totp/confirm', requireAuth, requireFreshAuth(), strictAuthLimiter, async (req, res) => {
    if (checkAuthBackoffLock(req, res, 'totp')) return;
    try {
      const uid = req.user!.uid;
      const { encryptedPendingSecret, code, currentCode } = req.body as {
        encryptedPendingSecret?: string;
        code?: string;
        currentCode?: string;
      };
      if (!encryptedPendingSecret || !code) {
        res.status(400).json({ error: 'Укажите код подтверждения 2FA.' });
        return;
      }

      const authz = await authorize2faMutation(uid, { currentCode, isProd });
      if (!authz.ok) {
        res.status(authz.status || 403).json({ error: authz.error, code: authz.code });
        return;
      }

      const plainSecret = decryptSecret(encryptedPendingSecret, uid, 'totp');
      const check = verifyTotpCodeWithStep(plainSecret, code, 1);
      if (!check.valid || check.matchedStep === null) {
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
      const nowMs = Date.now();
      const stepUpUntil = nowMs + STEP_UP_TTL_MS;

      const { plaintext, hashes } = generateBackupCodes(8);
      const encryptedSecret = encryptSecret(plainSecret, uid, 'totp');

      setMemoryTotpRecord(uid, {
        totpEncryptedSecret: encryptedSecret,
        backupCodeHashes: hashes,
        lastTotpStep: check.matchedStep,
        stepUpUntil,
        updatedAtMs: nowMs,
      });

      const adminDb = getAdminDb();
      if (adminDb) {
        await Promise.all([
          adminDb
            .collection('users')
            .doc(uid)
            .collection('serverSecurity')
            .doc('totp')
            .set(
              {
                totpEncryptedSecret: encryptedSecret,
                backupCodeHashes: hashes,
                lastTotpStep: check.matchedStep,
                stepUpUntil,
                updatedAtMs: nowMs,
              },
              { merge: true }
            ),
          adminDb
            .collection('users')
            .doc(uid)
            .set({ twoFactorEnabled: true, updatedAtMs: nowMs }, { merge: true }),
        ]);
      }

      await recordServerSecurityEvent(uid, {
        event: authz.isAlreadyEnabled ? '2FA_RECONFIGURED' : '2FA_ENABLED',
        title: 'Vernier · Обновлена настройка 2FA',
        details: authz.isAlreadyEnabled
          ? 'Секрет двухфакторной аутентификации (TOTP) перенастроен и выпущены новые резервные коды.'
          : 'Активирована двухфакторная аутентификация TOTP и выпущены 8 резервных кодов.',
        severity: authz.isAlreadyEnabled ? 'warning' : 'info',
      });

      res.json({
        verified: true,
        encryptedSecret,
        backupCodes: plaintext,
        backupCodeHashes: hashes,
        stepUpUntil,
        serverPersisted: Boolean(adminDb),
      });
    } catch {
      recordAuthFailure(req, 'totp');
      res.status(400).json({ error: 'Не удалось расшифровать или проверить 2FA секрет.' });
    }
  });

  // Audit G1 + I2: Серверное отключение 2FA (требует активный step-up или действующий код 2FA)
  app.post('/api/security/totp/disable', requireAuth, requireFreshAuth(), strictAuthLimiter, async (req, res) => {
    if (checkAuthBackoffLock(req, res, 'totp')) return;
    try {
      const uid = req.user!.uid;
      const body = req.body as { code?: unknown; currentCode?: unknown };
      const providedCode =
        typeof body?.code === 'string'
          ? body.code
          : typeof body?.currentCode === 'string'
            ? body.currentCode
            : undefined;

      const authz = await authorize2faMutation(uid, {
        currentCode: providedCode,
        isProd,
      });
      if (!authz.ok) {
        recordAuthFailure(req, 'totp');
        res.status(authz.status || 403).json({ error: authz.error, code: authz.code });
        return;
      }

      clearAuthFailure(req, 'totp');
      clearMemoryTotpRecord(uid);

      const adminDb = getAdminDb();
      if (adminDb) {
        await Promise.all([
          adminDb
            .collection('users')
            .doc(uid)
            .collection('serverSecurity')
            .doc('totp')
            .delete()
            .catch(() => undefined),
          adminDb
            .collection('users')
            .doc(uid)
            .set({ twoFactorEnabled: false, updatedAtMs: Date.now() }, { merge: true }),
        ]);
      }

      await recordServerSecurityEvent(uid, {
        event: '2FA_DISABLED',
        title: 'Vernier · 2FA отключена',
        details: 'Двухфакторная аутентификация (TOTP) отключена. Если это были не вы — немедленно завершите сессии.',
        severity: 'critical',
      });

      res.json({ ok: true, disabled: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Ошибка отключения 2FA.' });
    }
  });

  // 2FA Step-Up & Lock Screen Verification (Audit G3: запрет клиентских секретов/хешей в prod + anti-replay + server stepUpUntil)
  app.post('/api/security/totp/verify', requireAuth, strictAuthLimiter, async (req, res) => {
    if (checkAuthBackoffLock(req, res, 'totp')) return;
    try {
      const uid = req.user!.uid;
      const { encryptedSecret: clientEncryptedSecret, code, backupCodeHashes: clientBackupHashes } = req.body as {
        encryptedSecret?: string;
        code?: string;
        backupCodeHashes?: string[];
      };
      if (typeof code !== 'string' || !code.trim()) {
        res.status(400).json({ error: 'Недостаточно данных для проверки 2FA.' });
        return;
      }
      const cleanCode = code.trim();
      const adminDb = getAdminDb();

      if (isProd && !adminDb) {
        res.status(503).json({
          error: 'Серверная проверка 2FA временно недоступна в production (Admin SDK не настроен).',
          code: 'SECURITY_UNAVAILABLE',
        });
        return;
      }

      const state = await resolveUser2faState(uid, { adminDb });
      if (state.needsMigration) {
        res.status(403).json({
          error: 'Требуется миграция 2FA на серверное хранилище. Откройте Центр защиты → 2FA и завершите обновление.',
          code: '2FA_MIGRATION_REQUIRED',
        });
        return;
      }

      let authoritativeEncryptedSecret = state.totpEncryptedSecret;
      let authoritativeBackupHashes = [...state.backupCodeHashes];
      const lastAcceptedStep = Math.max(state.lastTotpStep, getMemoryLastTotpStep(uid));

      // В non-production без Admin SDK и без серверной записи допускаем локальный fallback для dev/preview
      if (!isProd && !adminDb && !authoritativeEncryptedSecret) {
        if (typeof clientEncryptedSecret === 'string' && clientEncryptedSecret) {
          authoritativeEncryptedSecret = clientEncryptedSecret;
        }
        if (authoritativeBackupHashes.length === 0 && Array.isArray(clientBackupHashes)) {
          authoritativeBackupHashes = clientBackupHashes
            .filter((h): h is string => typeof h === 'string')
            .slice(0, 8);
        }
      }

      if (!authoritativeEncryptedSecret) {
        res.status(400).json({ error: 'Секрет 2FA не найден. Повторите настройку 2FA.' });
        return;
      }

      const plainSecret = decryptSecret(authoritativeEncryptedSecret, uid, 'totp');
      const check = verifyTotpCodeWithStep(plainSecret, cleanCode, 1);
      if (check.valid && check.matchedStep !== null) {
        if (check.matchedStep <= lastAcceptedStep) {
          const penalty = recordAuthFailure(req, 'totp');
          res.status(401).json({
            error:
              penalty.lockSeconds > 0
                ? `Этот 6-значный код уже использовался. Доступ заблокирован на ${penalty.lockSeconds} сек.`
                : 'Этот 6-значный код уже использовался. Дождитесь следующего кода (30 сек).',
          });
          return;
        }
        clearAuthFailure(req, 'totp');
        setMemoryLastTotpStep(uid, check.matchedStep);
        const stepUpUntil = Date.now() + STEP_UP_TTL_MS;
        setMemoryStepUpUntil(uid, stepUpUntil);
        if (adminDb) {
          await adminDb
            .collection('users')
            .doc(uid)
            .collection('serverSecurity')
            .doc('totp')
            .set({ lastTotpStep: check.matchedStep, stepUpUntil, updatedAtMs: Date.now() }, { merge: true });
        }
        res.json({ verified: true, method: 'totp', consumedBackupHash: null, stepUpUntil });
        return;
      }

      const matchedHash = matchBackupCodeHash(cleanCode, authoritativeBackupHashes);
      if (matchedHash) {
        clearAuthFailure(req, 'totp');
        const stepUpUntil = Date.now() + STEP_UP_TTL_MS;
        setMemoryStepUpUntil(uid, stepUpUntil);

        const memRec = getMemoryTotpRecord(uid);
        if (memRec) {
          memRec.backupCodeHashes = memRec.backupCodeHashes.filter((h) => h !== matchedHash);
          memRec.stepUpUntil = stepUpUntil;
          memRec.updatedAtMs = Date.now();
        }

        if (adminDb) {
          const secDocRef = adminDb.collection('users').doc(uid).collection('serverSecurity').doc('totp');
          await adminDb.runTransaction(async (tx) => {
            const snap = await tx.get(secDocRef);
            const currentHashes = Array.isArray(snap.data()?.backupCodeHashes)
              ? (snap.data()!.backupCodeHashes as string[])
              : authoritativeBackupHashes;
            const remaining = currentHashes.filter((h) => h !== matchedHash);
            tx.set(secDocRef, { backupCodeHashes: remaining, stepUpUntil, updatedAtMs: Date.now() }, { merge: true });
          });
        }

        await recordServerSecurityEvent(uid, {
          event: '2FA_BACKUP_CODE_USED',
          title: 'Vernier · Использован резервный код 2FA',
          details: 'Выполнено подтверждение входа с помощью одноразового резервного кода.',
          severity: 'warning',
        });

        res.json({
          verified: true,
          method: 'backup_code',
          consumedBackupHash: matchedHash,
          stepUpUntil,
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
  const MAX_GEO_CACHE_ENTRIES = 1_000;
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

  function setGeoCacheEntry(
    key: string,
    data: {
      ipAddress: string;
      city: string;
      country: string;
      countryCode: string;
      latitude: number;
      longitude: number;
    },
  ): void {
    const now = Date.now();
    if (geoCache.size >= MAX_GEO_CACHE_ENTRIES) {
      for (const [k, v] of geoCache.entries()) {
        if (v.expiresAt <= now) geoCache.delete(k);
      }
      while (geoCache.size >= MAX_GEO_CACHE_ENTRIES) {
        const oldest = geoCache.keys().next().value;
        if (!oldest) break;
        geoCache.delete(oldest);
      }
    }
    geoCache.set(key, { data, expiresAt: now + 10 * 60_000 });
  }

  app.get('/api/security/session-geo', requireAuth, expensiveLimiter, async (req, res) => {
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
          setGeoCacheEntry(cacheKey, resolved);
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
          setGeoCacheEntry(cacheKey, resolved);
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

  // Каталог тарифов PRO / MAX и серверные цены
  app.get('/api/billing/plans', (_req, res) => {
    res.json({
      enabled: false,
      plans: getPlanPrices(),
      tiers: getTieredPlanPrices(),
      maxMultipliers: getMaxMultiplierPlans(),
      creditCosts: CREDIT_COSTS,
    });
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

  // Web Push: Critical exchange sync error (expired/revoked API key or critical exchange failure)
  app.post('/api/push/exchange-sync-error', requireAuth, expensiveLimiter, async (req, res) => {
    try {
      const body = req.body as {
        keyId?: unknown;
        exchange?: unknown;
        label?: unknown;
        category?: unknown;
        errorMessage?: unknown;
        testnet?: unknown;
      };
      const exchange =
        body.exchange === 'binance' || body.exchange === 'bybit' || body.exchange === 'okx'
          ? body.exchange
          : null;
      const category =
        body.category === 'auth' || body.category === 'exchange_api' || body.category === 'unknown'
          ? body.category
          : 'unknown';
      const keyId = typeof body.keyId === 'string' ? body.keyId.trim().slice(0, 64) : '';
      const label = typeof body.label === 'string' ? body.label.trim().slice(0, 64) : '';
      const errorMessage =
        typeof body.errorMessage === 'string' ? body.errorMessage.trim().slice(0, 280) : '';

      if (!exchange || !keyId || !errorMessage) {
        res.status(400).json({ error: 'Некорректные параметры уведомления о сбое синхронизации.' });
        return;
      }

      const result = await notifyCriticalExchangeSyncError(req.user!.uid, {
        keyId,
        exchange,
        label: label || exchange.toUpperCase(),
        category,
        errorMessage,
        testnet: Boolean(body.testnet),
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Ошибка отправки Push о критическом сбое биржи',
      });
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

  // Exchange Integration: Verify API credentials against exchange, fetch initial balances, encrypt secrets (Audit G2 + I2)
  app.post('/api/exchanges/connect', requireAuth, requireFreshAuth(), strictAuthLimiter, async (req, res) => {
    if (checkAuthBackoffLock(req, res, 'exchange_connect')) return;
    try {
      const uid = req.user!.uid;
      const stepUpCheck = await requireStepUpForUser(uid, {
        actionLabel: 'подключения или обновления API-ключа биржи',
        isProd,
      });
      if (!stepUpCheck.ok) {
        res.status(stepUpCheck.status || 403).json({ error: stepUpCheck.error, code: stepUpCheck.code });
        return;
      }

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
        res.status(err.statusCode).json({
          error: err.message,
          details: {
            httpStatus: err.httpStatus ?? err.statusCode,
            endpoint: err.endpoint,
            rawResponse: err.rawResponse,
          },
        });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : 'Ошибка подключения биржи' });
    }
  });

  // Exchange Integration: Decrypt stored user credentials on server and sync live wallet balances (Audit G2)
  app.post('/api/exchanges/sync', requireAuth, expensiveLimiter, async (req, res) => {
    try {
      const uid = req.user!.uid;
      const stepUpCheck = await requireStepUpForUser(uid, {
        actionLabel: 'синхронизации балансов биржи',
        isProd,
      });
      if (!stepUpCheck.ok) {
        res.status(stepUpCheck.status || 403).json({ error: stepUpCheck.error, code: stepUpCheck.code });
        return;
      }

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
        res.status(err.statusCode).json({
          error: err.message,
          details: {
            httpStatus: err.httpStatus ?? err.statusCode,
            endpoint: err.endpoint,
            rawResponse: err.rawResponse,
          },
        });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : 'Ошибка синхронизации баланса биржи' });
    }
  });

  // Exchange Integration: Execute Testnet Spot/Futures order (Audit G2 + I2; Live Trade заблокирован на сервере)
  app.post('/api/exchanges/order', requireAuth, requireFreshAuth(), strictAuthLimiter, async (req, res) => {
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

      const stepUpCheck = await requireStepUpForUser(uid, {
        actionLabel: 'отправки торгового ордера',
        isProd,
      });
      if (!stepUpCheck.ok) {
        res.status(stepUpCheck.status || 403).json({ error: stepUpCheck.error, code: stepUpCheck.code });
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
      recordAuthFailure(req, 'exchange_order');
      if (err instanceof ExchangeApiError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: 'Ошибка исполнения ордера на бирже.' });
    }
  });

  // Audit H4: Антиспам-лимитер обращений в поддержку (5/день на IP, 3/день на email, TTL 180 дней)
  const SUPPORT_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const SUPPORT_IP_DAILY_CAP = 5;
  const SUPPORT_EMAIL_DAILY_CAP = 3;
  const SUPPORT_TTL_DAYS = 180;
  const supportDailyCounters = new Map<string, number>();
  let supportCounterDayKey = new Date().toISOString().slice(0, 10);

  async function checkAndConsumeSupportQuota(ip: string, email: string): Promise<{ allowed: boolean; reason?: string }> {
    const todayKey = new Date().toISOString().slice(0, 10);
    if (todayKey !== supportCounterDayKey) {
      supportCounterDayKey = todayKey;
      supportDailyCounters.clear();
    }
    const ipHash = crypto.createHash('sha256').update(`ip:${ip}`).digest('hex').slice(0, 24);
    const emailHash = crypto.createHash('sha256').update(`email:${email.toLowerCase()}`).digest('hex').slice(0, 24);
    const ipKey = `ip_${todayKey}_${ipHash}`;
    const emailKey = `em_${todayKey}_${emailHash}`;

    const adminDb = getAdminDb();
    if (adminDb) {
      const ipRef = adminDb.collection('supportRateLimits').doc(ipKey);
      const emailRef = adminDb.collection('supportRateLimits').doc(emailKey);
      return adminDb.runTransaction(async (tx) => {
        const [ipSnap, emSnap] = await Promise.all([tx.get(ipRef), tx.get(emailRef)]);
        const ipCount = typeof ipSnap.data()?.count === 'number' ? (ipSnap.data()!.count as number) : 0;
        const emCount = typeof emSnap.data()?.count === 'number' ? (emSnap.data()!.count as number) : 0;
        if (ipCount >= SUPPORT_IP_DAILY_CAP) {
          return { allowed: false, reason: 'Превышен суточный лимит обращений с этого IP-адреса (макс. 5 в день).' };
        }
        if (emCount >= SUPPORT_EMAIL_DAILY_CAP) {
          return { allowed: false, reason: 'Превышен суточный лимит обращений для этого email (макс. 3 в день).' };
        }
        const expiresAt = new Date(Date.now() + 2 * 86_400_000);
        tx.set(ipRef, { count: ipCount + 1, dayKey: todayKey, expiresAt }, { merge: true });
        tx.set(emailRef, { count: emCount + 1, dayKey: todayKey, expiresAt }, { merge: true });
        return { allowed: true };
      });
    }

    const curIp = supportDailyCounters.get(ipKey) ?? 0;
    const curEm = supportDailyCounters.get(emailKey) ?? 0;
    if (curIp >= SUPPORT_IP_DAILY_CAP) {
      return { allowed: false, reason: 'Превышен суточный лимит обращений с этого IP-адреса (макс. 5 в день).' };
    }
    if (curEm >= SUPPORT_EMAIL_DAILY_CAP) {
      return { allowed: false, reason: 'Превышен суточный лимит обращений для этого email (макс. 3 в день).' };
    }
    if (supportDailyCounters.size >= 5_000) {
      supportDailyCounters.clear();
    }
    supportDailyCounters.set(ipKey, curIp + 1);
    supportDailyCounters.set(emailKey, curEm + 1);
    return { allowed: true };
  }

  // Support & Feedback intake (Audit H4: strict email regex, per-IP/email daily limits, 180d TTL)
  app.post('/api/support', expensiveLimiter, async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const contactEmail = typeof body.contactEmail === 'string' ? body.contactEmail.trim() : '';
      const category = typeof body.category === 'string' ? body.category : 'other';
      const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
      const message = typeof body.message === 'string' ? body.message.trim() : '';

      const allowedCategories = new Set(['alerts', 'chart', 'billing', 'security', 'other']);
      if (
        !contactEmail ||
        contactEmail.length < 5 ||
        contactEmail.length > 200 ||
        !SUPPORT_EMAIL_REGEX.test(contactEmail)
      ) {
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

      const trustedIp = (req.ip || req.socket.remoteAddress || 'unknown').replace(/^::ffff:/, '');
      const quota = await checkAndConsumeSupportQuota(trustedIp, contactEmail);
      if (!quota.allowed) {
        res.status(429).json({
          error: quota.reason || 'Превышен суточный лимит обращений в поддержку.',
          code: 'SUPPORT_RATE_LIMIT',
        });
        return;
      }

      const nowMs = Date.now();
      const ticketId = `sup_${nowMs}_${crypto.randomBytes(4).toString('hex')}`;
      const createdAtIso = new Date(nowMs).toISOString();
      const expiresAtMs = nowMs + SUPPORT_TTL_DAYS * 86_400_000;
      const adminDb = getAdminDb();

      if (adminDb) {
        await adminDb.collection('supportInbox').doc(ticketId).set({
          id: ticketId,
          uid: req.user?.uid ?? null,
          contactEmail,
          category,
          subject,
          message,
          status: 'open',
          createdAtIso,
          createdAtMs: nowMs,
          expiresAt: new Date(expiresAtMs),
          expiresAtMs,
        });
      } else if (isProd) {
        serverLogger.error('support', 'Не удалось сохранить обращение: Firebase Admin SDK не настроен в production.');
        res.status(503).json({
          error: 'Служба приёма обращений временно недоступна. Попробуйте повторить отправку позже.',
        });
        return;
      }

      serverLogger.info('support', `Зарегистрировано обращение ${ticketId} (категория: ${category}).`);
      res.json({ ok: true, ticketId, createdAt: createdAtIso });
    } catch (err) {
      serverLogger.error('support', err);
      res.status(500).json({ error: 'Не удалось сохранить обращение в поддержку.' });
    }
  });

  // Gemini-powered Terminal Help Assistant Chat (requires sign-in to protect Gemini quota)
  app.post('/api/support/chat', requireAuth, expensiveLimiter, async (req, res) => {
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

      const userTier = await resolveAuthoritativePlan(req.user!.uid);
      const reply = await askTerminalAssistant({
        message,
        history,
        budgetContext: { uid: req.user!.uid, tier: userTier },
      });
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
      if (status >= 500) {
        serverLogger.error('api:unhandled', err);
      }
      const msg =
        isProd && status >= 500
          ? 'Внутренняя ошибка API. Повторите запрос позже.'
          : err instanceof Error
            ? err.message
            : 'Внутренняя ошибка API.';
      res.status(status).json({ error: msg });
    }
  );

  // Корневой обработчик ошибок Express (ловит ошибки express.json() 400/413 до маршрутов /api)
  app.use(
    (
      err: unknown,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      if (!req.originalUrl.startsWith('/api')) {
        next(err);
        return;
      }
      const status =
        typeof err === 'object' && err !== null && 'status' in err
          ? Number((err as { status?: number }).status) || 400
          : 500;
      if (status >= 500) {
        serverLogger.error('api:root-error', err);
      }
      const msg =
        status === 413
          ? 'Превышен максимальный размер запроса (256 КБ).'
          : status === 400
            ? 'Некорректный формат JSON в теле запроса.'
            : isProd
              ? 'Внутренняя ошибка API. Повторите запрос позже.'
              : err instanceof Error
                ? err.message
                : 'Внутренняя ошибка API.';
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
    app.use(
      express.static(distDir, {
        etag: true,
        setHeaders(res, filePath) {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          } else if (
            filePath.endsWith('index.html') ||
            filePath.endsWith('sw.js') ||
            filePath.endsWith('manifest.webmanifest')
          ) {
            res.setHeader('Cache-Control', 'no-cache, must-revalidate');
          } else {
            res.setHeader('Cache-Control', 'public, max-age=86400');
          }
        },
      })
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
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
