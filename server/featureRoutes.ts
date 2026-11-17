import type { Express, NextFunction, Request, RequestHandler, Response } from 'express';
import { CREDIT_COSTS, FREE_MAX_ACTIVE_ALERTS, PRO_MAX_ACTIVE_ALERTS } from '../src/data/strategies.ts';
import { MIN_TRADES_FOR_REVIEW, reviewJournal, type ReviewTrade } from '../src/lib/journalReview.ts';
import { getAdminDb } from './billing.ts';
import {
  chargeCredits,
  getEntitlementSnapshot,
  type ChargeResult,
} from './entitlements.ts';
import { scanSetups, type ScanReport } from './setupScanner.ts';

export interface FeatureRouteDeps {
  requireAuth: RequestHandler;
  limiter: (req: Request, res: Response, next: NextFunction) => void;
  charge?: typeof chargeCredits;
  snapshot?: typeof getEntitlementSnapshot;
  scan?: (marketType: 'spot' | 'futures') => Promise<ScanReport>;
  isEnforced?: () => boolean;
}

type ChargeFailure = Extract<ChargeResult, { ok: false }>;

export function respondChargeFailure(res: Response, failure: ChargeFailure): void {
  res.status(failure.status).json({
    error: failure.message,
    code: failure.code,
    credits: { remaining: failure.creditsRemaining, quota: failure.quota },
    // подсказка интерфейсу: показать предложение PRO (у PRO кредиты тоже конечны, но это уже продление)
    upgrade: failure.code !== 'NO_PROFILE',
    isPro: failure.isPro,
  });
}

const SYMBOL_PATTERN = /^[A-Z0-9]{3,24}$/;
const MAX_PRICE = 100_000_000;

/** Проверка сделок из запроса: всё приводится к числам и допустимым значениям, мусор отбрасывается. */
export function sanitizeReviewTrades(raw: unknown): ReviewTrade[] {
  if (!Array.isArray(raw)) return [];
  const out: ReviewTrade[] = [];
  for (const item of raw.slice(0, 500)) {
    if (!item || typeof item !== 'object') continue;
    const t = item as Record<string, unknown>;
    const symbol = typeof t.symbol === 'string' ? t.symbol.toUpperCase() : '';
    const side = t.side === 'LONG' || t.side === 'SHORT' ? t.side : null;
    const entryPrice = Number(t.entryPrice);
    const stopPrice = Number(t.stopPrice ?? 0);
    const exitPrice = Number(t.exitPrice ?? 0);
    const status = t.status === 'closed' ? 'closed' : t.status === 'open' ? 'open' : null;
    if (!SYMBOL_PATTERN.test(symbol) || !side || !status) continue;
    if (!(entryPrice > 0 && entryPrice <= MAX_PRICE)) continue;
    if (!(stopPrice >= 0 && stopPrice <= MAX_PRICE) || !(exitPrice >= 0 && exitPrice <= MAX_PRICE)) continue;
    out.push({ symbol, side, entryPrice, stopPrice, exitPrice, status });
  }
  return out;
}

export function registerFeatureRoutes(app: Express, deps: FeatureRouteDeps): void {
  const charge = deps.charge ?? chargeCredits;
  const snapshot = deps.snapshot ?? getEntitlementSnapshot;
  const scan = deps.scan ?? ((m) => scanSetups(m));
  const isEnforced = deps.isEnforced ?? (() => getAdminDb() !== null);

  // Состояние тарифа и кредитов (заодно записывает сброс квоты, если период закончился)
  app.get('/api/entitlements', deps.requireAuth, async (req, res) => {
    try {
      if (!isEnforced()) {
        res.json({ enforced: false });
        return;
      }
      const snap = await snapshot(req.user!.uid);
      if (!snap) {
        res.status(404).json({ error: 'Профиль не найден.', code: 'NO_PROFILE' });
        return;
      }
      res.json({
        ...snap,
        limits: { maxActiveAlerts: snap.isPro ? PRO_MAX_ACTIVE_ALERTS : FREE_MAX_ACTIVE_ALERTS },
      });
    } catch {
      res.status(500).json({ error: 'Не удалось получить состояние тарифа.' });
    }
  });

  // Сканер сетапов: данные считаются заранее; если биржевые данные недоступны — результат не оплачивается
  app.post('/api/scanner/setups', deps.requireAuth, deps.limiter, async (req, res) => {
    try {
      const marketType = (req.body as { marketType?: unknown } | undefined)?.marketType === 'futures' ? 'futures' : 'spot';
      const report = await scan(marketType);
      if (!report.live) {
        res.json({ ...report, degraded: true, charged: 0, credits: null });
        return;
      }
      const result = await charge(req.user!.uid, CREDIT_COSTS.setupScanner);
      if (!result.ok) {
        respondChargeFailure(res, result);
        return;
      }
      res.json({
        ...report,
        degraded: false,
        charged: result.enforced ? CREDIT_COSTS.setupScanner : 0,
        credits: result.enforced
          ? { remaining: result.creditsRemaining, quota: result.quota, isPro: result.isPro }
          : null,
      });
    } catch {
      res.status(500).json({ error: 'Не удалось выполнить сканирование. Кредиты не списаны.' });
    }
  });

  // Глубокий разбор дневника: если закрытых сделок мало для выводов, разбор показывается бесплатно
  app.post('/api/journal/review', deps.requireAuth, deps.limiter, async (req, res) => {
    try {
      const trades = sanitizeReviewTrades((req.body as { trades?: unknown } | undefined)?.trades);
      const closed = trades.filter((t) => t.status === 'closed' && t.exitPrice > 0).length;
      if (closed === 0) {
        res.status(400).json({ error: 'В дневнике нет закрытых сделок для разбора.', code: 'NO_CLOSED_TRADES' });
        return;
      }
      const report = reviewJournal(trades);
      if (closed < MIN_TRADES_FOR_REVIEW) {
        res.json({ report, charged: 0, credits: null });
        return;
      }
      const result = await charge(req.user!.uid, CREDIT_COSTS.journalReview);
      if (!result.ok) {
        respondChargeFailure(res, result);
        return;
      }
      res.json({
        report,
        charged: result.enforced ? CREDIT_COSTS.journalReview : 0,
        credits: result.enforced
          ? { remaining: result.creditsRemaining, quota: result.quota, isPro: result.isPro }
          : null,
      });
    } catch {
      res.status(500).json({ error: 'Не удалось выполнить разбор. Кредиты не списаны.' });
    }
  });
}
