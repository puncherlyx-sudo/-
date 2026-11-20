import type express from 'express';
import helmet from 'helmet';

export interface SecurityHeadersOptions {
  isProd: boolean;
  allowEmbedOrigins?: string[];
}

export function parseAllowEmbedOrigins(rawEnv = process.env.ALLOW_EMBED_ORIGINS || ''): string[] {
  return rawEnv
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^https:\/\//.test(s));
}

/**
 * Централизованный middleware жёстких HTTP-заголовков безопасности:
 * - Строгий Content-Security-Policy (без unsafe-eval, с ограниченным connect-src для Gemini, Firebase, бирж и новостей)
 * - HSTS (365 дней + includeSubDomains + preload)
 * - X-Content-Type-Options: nosniff
 * - X-Frame-Options: DENY (если не заданы доверенные ALLOW_EMBED_ORIGINS)
 * - Permissions-Policy: camera=(), microphone=(), geolocation=()
 * - Referrer-Policy: strict-origin-when-cross-origin
 */
export function applySecurityHeaders(app: express.Express, options: SecurityHeadersOptions): void {
  const { isProd } = options;
  const allowEmbedOrigins = options.allowEmbedOrigins ?? parseAllowEmbedOrigins();

  app.disable('x-powered-by');

  const connectSrc = [
    "'self'",
    'https://generativelanguage.googleapis.com',
    'https://*.googleapis.com',
    'https://firestore.googleapis.com',
    'https://identitytoolkit.googleapis.com',
    'https://securetoken.googleapis.com',
    'https://*.firebaseio.com',
    'https://*.firebaseapp.com',
    'wss://*.firebaseio.com',
    'https://api.binance.com',
    'https://fapi.binance.com',
    'https://api.bybit.com',
    'https://www.okx.com',
    'https://api.alternative.me',
    'https://api.coingecko.com',
    'https://min-api.cryptocompare.com',
    'https://cryptopanic.com',
  ];

  const cspDirectives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", 'https://apis.google.com'],
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'connect-src': connectSrc,
    'frame-src': [
      "'self'",
      'https://*.firebaseapp.com',
      'https://accounts.google.com',
      'https://apis.google.com',
      'https://www.tradingview-widget.com',
      'https://s.tradingview.com',
      'https://*.tradingview.com',
    ],
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors':
      allowEmbedOrigins.length > 0 ? ["'self'", ...allowEmbedOrigins] : ["'none'"],
    'upgrade-insecure-requests': [],
  };

  app.use(
    helmet({
      // В production действует строгий CSP без unsafe-eval; в dev Vite требует inline-модули.
      contentSecurityPolicy: isProd
        ? {
            useDefaults: false,
            directives: cspDirectives,
          }
        : false,
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
      frameguard: isProd && allowEmbedOrigins.length === 0 ? { action: 'deny' } : false,
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
      noSniff: true,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    })
  );

  app.use((_req, res, next) => {
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()'
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    if (isProd && allowEmbedOrigins.length === 0) {
      res.setHeader('X-Frame-Options', 'DENY');
    }
    next();
  });
}
