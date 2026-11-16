import 'dotenv/config';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import path from 'path';
import QRCode from 'qrcode';
import { createServer as createViteServer } from 'vite';
import { isAllowedPushEndpoint, requireAuth } from './server/auth.ts';
import {
  createCheckout,
  getPlanPrices,
  isBillingConfigured,
  processIpn,
  startProExpiryMonitor,
  verifyIpnSignature,
  type BillingPeriod,
} from './server/billing.ts';
import {
  fetchEconomicCalendar,
  fetchGroundedCryptoNews,
  runStrategyAnalysis,
} from './server/aiAnalyst.ts';
import { getFearAndGreedIndex, getMarketCandles, getMarketDepth, getMarketOverview } from './server/market.ts';
import { runStrategyPortfolioBacktest, type StrategySimulationInput } from './server/strategyBacktest.ts';
import {
  checkPriceAlertsForUser,
  dispatchPushToUser,
  getVapidPublicKey,
  notifyHighImpactNews,
  registerPushSubscription,
  scanMarketAndNotify,
  startMarketAlertMonitor,
  syncUserPriceAlerts,
  unregisterPushSubscription,
} from './server/push.ts';
import {
  buildOtpAuthUri,
  decryptSecret,
  encryptSecret,
  generateBackupCodes,
  generateBase32Secret,
  hashBackupCode,
  verifyTotpCode,
} from './server/security.ts';

async function startServer() {
  const app = express();
  const PORT = 3000;
  const isProd = process.env.NODE_ENV === 'production';

  app.set('trust proxy', 1);

  // Security headers hardened against XSS, MIME sniffing, and clickjacking
  app.use(
    helmet({
      // CSP в разработке отключён (Vite HMR требует inline-скриптов), в продакшене включён.
      contentSecurityPolicy: isProd
        ? {
            useDefaults: false,
            directives: {
              'default-src': ["'self'"],
              'script-src': ["'self'", 'https://apis.google.com'],
              'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
              'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
              'img-src': ["'self'", 'data:', 'blob:', 'https:'],
              'connect-src': [
                "'self'",
                'https://*.googleapis.com',
                'https://*.firebaseio.com',
                'https://*.firebaseapp.com',
                'wss://*.firebaseio.com',
              ],
              'frame-src': ["'self'", 'https://*.firebaseapp.com', 'https://accounts.google.com', 'https://apis.google.com'],
              'worker-src': ["'self'", 'blob:'],
              'manifest-src': ["'self'"],
              'object-src': ["'none'"],
              'base-uri': ["'self'"],
              'form-action': ["'self'"],
              // Запрет встраивания в чужие страницы (защита от clickjacking).
              // Разрешён предпросмотр внутри Google AI Studio.
              'frame-ancestors': ["'self'", 'https://aistudio.google.com', 'https://*.google.com'],
              'upgrade-insecure-requests': [],
            },
          }
        : false,
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }, // нужно для входа Google через popup
      frameguard: false, // замена: frame-ancestors в CSP
      hsts: { maxAge: 31536000, includeSubDomains: true },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    })
  );
  app.disable('x-powered-by');

  app.use(express.json({ limit: '256kb' }));

  const generalApiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Превышен лимит запросов. Повторите через минуту.' },
  });

  const strictAuthLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Слишком много попыток 2FA. Подождите 5 минут для защиты аккаунта.' },
  });

  const expensiveLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 12,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Слишком много тяжёлых запросов. Повторите через минуту.' },
  });

  app.use('/api', generalApiLimiter);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });

  // Market tickers (Spot / Futures)
  app.get('/api/market/overview', async (req, res) => {
    try {
      const marketType = req.query.marketType === 'futures' ? 'futures' : 'spot';
      const tickers = await getMarketOverview(marketType);
      res.json({ marketType, tickers });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Ошибка загрузки рынка' });
    }
  });

  // Market OHLCV + technical indicators
  app.get('/api/market/candles', async (req, res) => {
    try {
      const symbol = String(req.query.symbol || 'BTCUSDT').toUpperCase();
      const interval = String(req.query.interval || '1h');
      const marketType = req.query.marketType === 'futures' ? 'futures' : 'spot';
      const data = await getMarketCandles(symbol, interval, marketType);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Ошибка загрузки графика' });
    }
  });

  // Market Order Book Depth (Bids / Asks / Spread)
  app.get('/api/market/depth', async (req, res) => {
    try {
      const symbol = String(req.query.symbol || 'BTCUSDT').toUpperCase();
      const marketType = req.query.marketType === 'futures' ? 'futures' : 'spot';
      const depth = await getMarketDepth(symbol, marketType);
      res.json(depth);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Ошибка загрузки стакана ордеров' });
    }
  });

  // Crypto Fear & Greed Index (live Alternative.me + quantitative fallback)
  app.get('/api/market/fear-greed', async (_req, res) => {
    try {
      const sentiment = await getFearAndGreedIndex();
      res.json(sentiment);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Ошибка загрузки индекса настроений' });
    }
  });

  // Live Android / PWA Desktop Widget Feed (JSON for W3C Widgets, KWGT, MacroDroid, and standalone views)
  app.get('/api/widgets/feed', async (req, res) => {
    try {
      const symbol = String(req.query.symbol || 'BTCUSDT').toUpperCase();
      const interval = String(req.query.interval || '1h');
      const marketType = req.query.marketType === 'futures' ? 'futures' : 'spot';
      const depositUsdt = Math.min(10_000_000, Math.max(50, Number(req.query.deposit || 2500)));
      const riskPct = Math.min(10, Math.max(0.25, Number(req.query.risk || 1.5)));
      const stopPct = Math.min(25, Math.max(0.25, Number(req.query.stopPct || 2.5)));

      const [tickers, candlesData, fearGreed] = await Promise.all([
        getMarketOverview(marketType),
        getMarketCandles(symbol, interval, marketType),
        getFearAndGreedIndex(),
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
      chart: 'AegisQuant · График',
      price: 'AegisQuant · Цена',
      position: 'AegisQuant · Позиция',
      pnl: 'AegisQuant · Доходность',
      strategies: 'AegisQuant · Стратегии',
    };
    const title = titles[kind] || 'AegisQuant · Виджет';

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
          title: 'Открыть в AegisQuant',
          url: `/?widget=${encodeURIComponent(kind)}`,
        },
      ],
    });
  });

  // Grounded crypto news feed
  app.get('/api/news', async (req, res) => {
    try {
      const symbol = String(req.query.symbol || 'ALL').toUpperCase();
      const news = await fetchGroundedCryptoNews(symbol);
      const topHigh = news.items.find((n) => n.impact === 'HIGH');
      if (topHigh) {
        void notifyHighImpactNews(topHigh);
      }
      res.json(news);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Ошибка загрузки новостей' });
    }
  });

  // Grounded macro & crypto economic calendar
  app.get('/api/economic-calendar', async (_req, res) => {
    try {
      const calendar = await fetchEconomicCalendar();
      res.json(calendar);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Ошибка загрузки экономического календаря' });
    }
  });

  // AI Strategy + Chart + News analysis
  app.post('/api/analyze', requireAuth, expensiveLimiter, async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const symbol = String(body.symbol || 'BTCUSDT').toUpperCase();
      const marketType = body.marketType === 'futures' ? 'futures' : 'spot';
      const timeframe = String(body.timeframe || '1h');
      const strategyKey = String(body.strategyKey || 'trend_breakout');
      const strategyName = String(body.strategyName || 'Пробой тренда');
      const strategyRules = String(body.strategyRules || '');
      const depositUsdt = Math.min(10_000_000, Math.max(10, Number(body.depositUsdt || 1000)));
      const riskPerTradePct = Math.min(10, Math.max(0.25, Number(body.riskPerTradePct || 1.5)));
      const leverage = Math.min(20, Math.max(1, Number(body.leverage || 1)));
      const isPro = Boolean(body.isPro);

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
      });

      res.json({
        analysis,
        indicators: marketData.indicators,
        source: marketData.source,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Ошибка AI-анализа' });
    }
  });

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
      const report = await runStrategyPortfolioBacktest({
        strategies: body.strategies.slice(0, 12),
        interval: body.interval === '4h' ? '4h' : '1h',
        depositUsdt: Number(body.depositUsdt || 2500),
        scope: body.scope === 'all' ? 'all' : 'active',
      });
      res.json(report);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Ошибка расчета доходности стратегий' });
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
      const otpauthUri = buildOtpAuthUri(email, 'AegisQuant', plainSecret);
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
        res.status(401).json({ error: 'Неверный 6-значный код из приложения-аутентификатора.' });
        return;
      }
      const { plaintext, hashes } = generateBackupCodes(8);
      res.json({
        verified: true,
        encryptedSecret: encryptSecret(plainSecret, uid),
        backupCodes: plaintext,
        backupCodeHashes: hashes,
      });
    } catch {
      res.status(400).json({ error: 'Не удалось расшифровать или проверить 2FA секрет.' });
    }
  });

  // 2FA Step-Up & Lock Screen Verification (supports TOTP OR single-use backup code)
  app.post('/api/security/totp/verify', requireAuth, strictAuthLimiter, (req, res) => {
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
        res.json({ verified: true, method: 'totp', consumedBackupHash: null });
        return;
      }

      const candidateHash = hashBackupCode(cleanCode);
      if (Array.isArray(backupCodeHashes) && backupCodeHashes.includes(candidateHash)) {
        res.json({
          verified: true,
          method: 'backup_code',
          consumedBackupHash: candidateHash,
        });
        return;
      }

      res.status(401).json({ error: 'Неверный код 2FA или резервный код.' });
    } catch {
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
    const rawForwarded = req.headers['x-forwarded-for'];
    const forwardedIp = Array.isArray(rawForwarded)
      ? rawForwarded[0]
      : typeof rawForwarded === 'string'
        ? rawForwarded.split(',')[0]
        : '';
    const candidateRaw = (forwardedIp || req.ip || req.socket.remoteAddress || '').trim();
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

  // Оплата PRO (криптовалюта через NOWPayments)
  app.get('/api/billing/plans', (_req, res) => {
    res.json({ enabled: isBillingConfigured(), plans: getPlanPrices() });
  });

  app.post('/api/billing/checkout', requireAuth, strictAuthLimiter, async (req, res) => {
    try {
      const period = (req.body as { period?: unknown })?.period;
      if (period !== 'month' && period !== 'year') {
        res.status(400).json({ error: 'Выберите период подписки: месяц или год.' });
        return;
      }
      const { invoiceUrl } = await createCheckout(req.user!.uid, period as BillingPeriod);
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
      console.error('[billing] Ошибка обработки IPN:', err instanceof Error ? err.message : err);
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

      registerPushSubscription({
        uid,
        endpoint,
        subscription: {
          endpoint,
          keys: { p256dh, auth: authKey },
        },
        notifySignals: body.notifySignals !== false,
        notifyMarketMoves: body.notifyMarketMoves !== false,
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
        title: 'AegisQuant · Тест фоновых уведомлений',
        body: 'Push-канал активен. Вы будете получать сигналы стратегий и рыночные импульсы даже при закрытом приложении.',
        tag: 'aegisquant-test',
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
        title: `AegisQuant · Сигнал ${direction} ${symbol}`,
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

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AegisQuant server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
