import assert from 'node:assert/strict';
import type { Firestore } from 'firebase-admin/firestore';
import {
  chargeCredits,
  getEntitlementSnapshot,
  normalizeQuota,
  refundCredits,
} from '../server/entitlements.ts';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 17, 12, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();

// ---------- чистая логика квоты ----------
{
  const r = normalizeQuota({ plan: 'free', creditsRemaining: 2, nextResetAt: iso(NOW - 1000) }, NOW);
  assert.equal(r.creditsRemaining, 15, 'Free: после окончания недели — 15 кредитов');
  assert.equal(r.changed, true);
  assert.equal(Date.parse(r.nextResetAt), NOW + 7 * DAY);
}
{
  const r = normalizeQuota({ plan: 'free', creditsRemaining: 3, nextResetAt: iso(NOW + 2 * DAY) }, NOW);
  assert.equal(r.creditsRemaining, 3);
  assert.equal(r.changed, false, 'Free: в середине недели ничего не меняется');
}
{
  // после окончания PRO: 100 кредитов и дата «через месяц» не должны сохраняться у Free
  const r = normalizeQuota(
    { plan: 'pro', proUntil: NOW - DAY, creditsRemaining: 100, nextResetAt: iso(NOW + 30 * DAY) },
    NOW
  );
  assert.equal(r.isPro, false);
  assert.equal(r.creditsRemaining, 15, 'потолок кредитов Free после окончания PRO');
  assert.equal(Date.parse(r.nextResetAt), NOW + 7 * DAY, 'ждать пополнения не дольше недели');
}
{
  const r = normalizeQuota({ plan: 'pro', proUntil: NOW + 100 * DAY, creditsRemaining: 40, nextResetAt: iso(NOW + 10 * DAY) }, NOW);
  assert.equal(r.isPro, true);
  assert.equal(r.quota, 100);
  assert.equal(r.creditsRemaining, 40);
  assert.equal(r.changed, false);
}
{
  const r = normalizeQuota({ plan: 'pro', proUntil: NOW + 300 * DAY, creditsRemaining: 0, nextResetAt: iso(NOW - 1) }, NOW);
  assert.equal(r.creditsRemaining, 100, 'PRO (в т.ч. годовой): ежемесячное пополнение до 100');
  assert.equal(Date.parse(r.nextResetAt), NOW + 30 * DAY);
}
{
  const r = normalizeQuota({ plan: 'free', creditsRemaining: 'мусор', nextResetAt: 'не дата' }, NOW);
  assert.equal(r.creditsRemaining, 15, 'повреждённые данные → безопасная выдача квоты');
}

// ---------- минимальная «база» в памяти ----------
type Doc = Record<string, unknown>;
function makeDb(initial: Record<string, Doc>) {
  const store = new Map<string, Doc>(Object.entries(initial));
  const ref = (path: string) => ({
    path,
    collection: (name: string) => ({ doc: (id: string) => ref(`${path}/${name}/${id}`) }),
  });
  const db = {
    collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        get: async (r: { path: string }) => ({
          exists: store.has(r.path),
          data: () => (store.has(r.path) ? structuredClone(store.get(r.path)) : undefined),
        }),
        update: (r: { path: string }, data: Doc) => store.set(r.path, { ...(store.get(r.path) ?? {}), ...data }),
        set: (r: { path: string }, data: Doc, opts?: { merge?: boolean }) =>
          store.set(r.path, opts?.merge ? { ...(store.get(r.path) ?? {}), ...data } : data),
      };
      return fn(tx);
    },
  };
  return { db: db as unknown as Firestore, store };
}
const user = (extra: Doc = {}): Doc => ({
  plan: 'free',
  creditsRemaining: 15,
  nextResetAt: iso(NOW + 3 * DAY),
  ...extra,
});

(async () => {
  // списание и нехватка
  {
    const { db, store } = makeDb({ 'users/u1': user() });
    const r = await chargeCredits('u1', 2, { nowMs: NOW }, db);
    assert.ok(r.ok && r.creditsRemaining === 13 && r.enforced);
    assert.equal(store.get('users/u1')!.creditsRemaining, 13, 'списание записано в базу');
    const big = await chargeCredits('u1', 14, { nowMs: NOW }, db);
    assert.ok(!big.ok && big.code === 'INSUFFICIENT_CREDITS' && big.status === 402);
    assert.equal(store.get('users/u1')!.creditsRemaining, 13, 'при нехватке ничего не списывается');
    assert.match(big.ok ? '' : big.message, /PRO даёт 100/, 'сообщение подсказывает про PRO');
  }
  // нельзя уйти в минус при серии списаний
  {
    const { db, store } = makeDb({ 'users/u1': user({ creditsRemaining: 5 }) });
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await chargeCredits('u1', 2, { nowMs: NOW }, db));
    assert.deepEqual(results.map((r) => r.ok), [true, true, false, false]);
    assert.equal(store.get('users/u1')!.creditsRemaining, 1);
  }
  // еженедельный сброс при списании
  {
    const { db, store } = makeDb({ 'users/u1': user({ creditsRemaining: 0, nextResetAt: iso(NOW - 1) }) });
    const r = await chargeCredits('u1', 1, { nowMs: NOW }, db);
    assert.ok(r.ok && r.creditsRemaining === 14, 'после сброса недели доступны 15 кредитов');
    assert.equal(Date.parse(String(store.get('users/u1')!.nextResetAt)), NOW + 7 * DAY);
  }
  // дневной лимит сигналов на Free и возврат
  {
    const { db, store } = makeDb({ 'users/u1': user() });
    const a = await chargeCredits('u1', 1, { nowMs: NOW, dailySignalKey: 'spot_trend_breakout' }, db);
    assert.ok(a.ok);
    const b = await chargeCredits('u1', 1, { nowMs: NOW, dailySignalKey: 'spot_trend_breakout' }, db);
    assert.ok(!b.ok && b.code === 'DAILY_LIMIT' && b.status === 429);
    assert.equal(store.get('users/u1')!.creditsRemaining, 14, 'при дневном лимите кредит не списан');
    const other = await chargeCredits('u1', 1, { nowMs: NOW, dailySignalKey: 'other_strategy' }, db);
    assert.ok(other.ok, 'лимит считается отдельно по каждой стратегии');
    const nextDay = await chargeCredits('u1', 1, { nowMs: NOW + DAY, dailySignalKey: 'spot_trend_breakout' }, db);
    assert.ok(nextDay.ok, 'на следующий день лимит обновляется');
    await refundCredits('u1', 1, { nowMs: NOW, dailySignalKey: 'spot_trend_breakout' }, db);
    assert.equal(store.get('users/u1')!.creditsRemaining, 13, 'возврат вернул кредит (было 12 после трёх списаний)');
    const again = await chargeCredits('u1', 1, { nowMs: NOW, dailySignalKey: 'spot_trend_breakout' }, db);
    assert.ok(again.ok, 'после возврата дневной лимит снова доступен');
  }
  // PRO: нет дневного лимита, но кредиты ограничены
  {
    const { db } = makeDb({ 'users/p1': user({ plan: 'pro', proUntil: NOW + 60 * DAY, creditsRemaining: 100, nextResetAt: iso(NOW + 20 * DAY) }) });
    for (let i = 0; i < 5; i++) {
      const r = await chargeCredits('p1', 1, { nowMs: NOW, dailySignalKey: 'spot_trend_breakout' }, db);
      assert.ok(r.ok, 'PRO: несколько сигналов в день');
    }
    const drain = await chargeCredits('p1', 95, { nowMs: NOW }, db);
    assert.ok(drain.ok && drain.creditsRemaining === 0 && drain.isPro);
    const over = await chargeCredits('p1', 1, { nowMs: NOW }, db);
    assert.ok(!over.ok && over.code === 'INSUFFICIENT_CREDITS' && /PRO/.test(over.message), 'PRO тоже ограничен месячной квотой');
  }
  // PRO с истёкшей подпиской считается Free
  {
    const { db } = makeDb({ 'users/e1': user({ plan: 'pro', proUntil: NOW - 1, creditsRemaining: 100, nextResetAt: iso(NOW + 5 * DAY) }) });
    const r = await chargeCredits('e1', 1, { nowMs: NOW }, db);
    assert.ok(r.ok && !r.isPro && r.creditsRemaining === 14 && r.quota === 15);
  }
  // нет профиля, нет базы
  {
    const { db } = makeDb({});
    const r = await chargeCredits('ghost', 1, { nowMs: NOW }, db);
    assert.ok(!r.ok && r.code === 'NO_PROFILE');
    const off = await chargeCredits('x', 1, { nowMs: NOW }, null);
    assert.ok(off.ok && !off.enforced, 'без ключа Firebase учёт выключен и это видно по enforced:false');
  }
  // моментальный снимок
  {
    const { db, store } = makeDb({ 'users/s1': user({ creditsRemaining: 1, nextResetAt: iso(NOW - 5) }) });
    const snap = await getEntitlementSnapshot('s1', NOW, db);
    assert.ok(snap && snap.creditsRemaining === 15 && snap.plan === 'free' && snap.quota === 15);
    assert.equal(store.get('users/s1')!.creditsRemaining, 15, 'сброс записан в базу');
  }
  console.log('entitlements: все проверки пройдены');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
