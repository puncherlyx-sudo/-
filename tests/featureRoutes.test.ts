import assert from 'node:assert/strict';
import express from 'express';
import type { Firestore } from 'firebase-admin/firestore';
import { chargeCredits, getEntitlementSnapshot } from '../server/entitlements.ts';
import { registerFeatureRoutes, sanitizeReviewTrades } from '../server/featureRoutes.ts';
import type { ScanReport } from '../server/setupScanner.ts';

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

type Doc = Record<string, unknown>;
function makeDb(initial: Record<string, Doc>) {
  const store = new Map<string, Doc>(Object.entries(initial));
  const ref = (path: string) => ({ path, collection: (n: string) => ({ doc: (id: string) => ref(`${path}/${n}/${id}`) }) });
  const db = {
    collection: (n: string) => ({ doc: (id: string) => ref(`${n}/${id}`) }),
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        get: async (r: { path: string }) => ({ exists: store.has(r.path), data: () => (store.has(r.path) ? structuredClone(store.get(r.path)) : undefined) }),
        update: (r: { path: string }, d: Doc) => store.set(r.path, { ...(store.get(r.path) ?? {}), ...d }),
        set: (r: { path: string }, d: Doc, o?: { merge?: boolean }) => store.set(r.path, o?.merge ? { ...(store.get(r.path) ?? {}), ...d } : d),
      }),
  };
  return { db: db as unknown as Firestore, store };
}

const fresh = (extra: Doc = {}): Doc => ({ plan: 'free', creditsRemaining: 15, nextResetAt: iso(Date.now() + 3 * DAY), ...extra });

const { db, store } = makeDb({
  'users/free1': fresh(),
  'users/poor': fresh({ creditsRemaining: 1 }),
  'users/pro1': fresh({ plan: 'pro', proUntil: Date.now() + 90 * DAY, creditsRemaining: 100, nextResetAt: iso(Date.now() + 20 * DAY) }),
});

let liveScan = true;
const scan = async (marketType: 'spot' | 'futures'): Promise<ScanReport> => ({
  marketType, scannedPairs: 10, live: liveScan, generatedAt: new Date().toISOString(), setups: [], skippedNoDirection: 10,
});

const app = express();
app.use(express.json());
// подставная авторизация: пользователь берётся из заголовка (в настоящем сервере — из проверенного токена)
const fakeAuth: express.RequestHandler = (req, res, next) => {
  const uid = req.headers['x-test-uid'];
  if (typeof uid !== 'string') { res.status(401).json({ error: 'auth' }); return; }
  req.user = { uid, email: null };
  next();
};
registerFeatureRoutes(app, {
  requireAuth: fakeAuth,
  limiter: (_q, _s, n) => n(),
  charge: (uid, cost, opts) => chargeCredits(uid, cost, opts, db),
  snapshot: (uid) => getEntitlementSnapshot(uid, Date.now(), db),
  scan,
  isEnforced: () => true,
});

const server = app.listen(0);
const port = (server.address() as { port: number }).port;
const call = async (method: string, path: string, uid?: string, body?: unknown) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(uid ? { 'x-test-uid': uid } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, any> };
};
const credits = (uid: string) => store.get(`users/${uid}`)!.creditsRemaining;

const trade = (side: 'LONG' | 'SHORT', entry: number, exit: number, stop = 0) => ({ symbol: 'BTCUSDT', side, entryPrice: entry, exitPrice: exit, stopPrice: stop, status: 'closed' });
const eight = Array.from({ length: 8 }, (_, i) => trade('LONG', 100, i % 2 ? 104 : 98, 98));

(async () => {
  // без входа — отказ
  assert.equal((await call('GET', '/api/entitlements')).status, 401);
  assert.equal((await call('POST', '/api/scanner/setups')).status, 401);
  assert.equal((await call('POST', '/api/journal/review')).status, 401);

  // состояние тарифа
  const e = await call('GET', '/api/entitlements', 'free1');
  assert.equal(e.status, 200);
  assert.equal(e.json.plan, 'free');
  assert.equal(e.json.creditsRemaining, 15);
  assert.equal(e.json.limits.maxActiveAlerts, 3);
  assert.equal((await call('GET', '/api/entitlements', 'pro1')).json.limits.maxActiveAlerts, 50);
  assert.equal((await call('GET', '/api/entitlements', 'ghost')).status, 404);

  // сканер: списывает 2 кредита
  const s1 = await call('POST', '/api/scanner/setups', 'free1', { marketType: 'spot' });
  assert.equal(s1.status, 200);
  assert.equal(s1.json.charged, 2);
  assert.equal(s1.json.credits.remaining, 13);
  assert.equal(credits('free1'), 13);

  // сканер: данные не живые → не оплачивается
  liveScan = false;
  const sDeg = await call('POST', '/api/scanner/setups', 'free1', {});
  assert.equal(sDeg.json.degraded, true);
  assert.equal(sDeg.json.charged, 0);
  assert.equal(credits('free1'), 13, 'при резервных данных кредиты не списываются');
  liveScan = true;

  // сканер: не хватает кредитов → 402 и подсказка про PRO
  const poor = await call('POST', '/api/scanner/setups', 'poor', {});
  assert.equal(poor.status, 402);
  assert.equal(poor.json.code, 'INSUFFICIENT_CREDITS');
  assert.equal(poor.json.upgrade, true);
  assert.equal(credits('poor'), 1, 'при отказе ничего не списано');

  // разбор дневника: мало сделок → бесплатно
  const few = await call('POST', '/api/journal/review', 'free1', { trades: eight.slice(0, 3) });
  assert.equal(few.status, 200);
  assert.equal(few.json.charged, 0);
  assert.equal(credits('free1'), 13);
  assert.equal(few.json.report.sample.enough, false);

  // разбор дневника: достаточно сделок → 3 кредита
  const rev = await call('POST', '/api/journal/review', 'free1', { trades: eight });
  assert.equal(rev.status, 200);
  assert.equal(rev.json.charged, 3);
  assert.equal(credits('free1'), 10);
  assert.equal(rev.json.report.sample.enough, true);

  // PRO: тоже списываются, но квота больше
  const pro = await call('POST', '/api/journal/review', 'pro1', { trades: eight });
  assert.equal(pro.json.credits.remaining, 97);
  assert.equal(pro.json.credits.isPro, true);

  // мусор в запросе
  assert.equal((await call('POST', '/api/journal/review', 'free1', { trades: 'x' })).status, 400);
  assert.equal((await call('POST', '/api/journal/review', 'free1', { trades: [] })).status, 400);
  const dirty = sanitizeReviewTrades([
    { symbol: 'btcusdt', side: 'LONG', entryPrice: 100, stopPrice: 0, exitPrice: 110, status: 'closed' },
    { symbol: '<script>', side: 'LONG', entryPrice: 100, status: 'closed' },
    { symbol: 'ETHUSDT', side: 'UP', entryPrice: 100, status: 'closed' },
    { symbol: 'ETHUSDT', side: 'LONG', entryPrice: -5, status: 'closed' },
    { symbol: 'ETHUSDT', side: 'LONG', entryPrice: 1e12, status: 'closed' },
    null, 5, 'str',
  ]);
  assert.equal(dirty.length, 1, 'остаётся только корректная сделка');
  assert.equal(dirty[0].symbol, 'BTCUSDT');
  assert.equal(sanitizeReviewTrades(Array.from({ length: 900 }, () => trade('LONG', 1, 2))).length, 500, 'не больше 500 сделок');

  // выигрыш хитрого клиента: 100 параллельных запросов не уводят баланс в минус
  const burst = await Promise.all(Array.from({ length: 10 }, () => call('POST', '/api/scanner/setups', 'poor', {})));
  assert.ok(burst.every((b) => b.status === 402));
  assert.equal(credits('poor'), 1);

  console.log('featureRoutes: все проверки пройдены');
  server.close();
})().catch((err) => {
  console.error(err);
  server.close();
  process.exit(1);
});
