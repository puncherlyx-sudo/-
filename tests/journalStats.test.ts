import assert from 'node:assert/strict';
import { computeJournalStats, tradePnlPct, tradeRMultiple, type TradeLike } from '../src/lib/journalStats.ts';

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

// LONG: вход 100, выход 110 → +10%
near(tradePnlPct({ side: 'LONG', entryPrice: 100 }, 110), 10);
// SHORT: вход 100, выход 90 → +10%; выход 110 → -10%
near(tradePnlPct({ side: 'SHORT', entryPrice: 100 }, 90), 10);
near(tradePnlPct({ side: 'SHORT', entryPrice: 100 }, 110), -10);

// R: LONG вход 100, стоп 95 (риск 5%), выход 110 (+10%) → +2R; выход 95 → -1R
const long: TradeLike = { side: 'LONG', entryPrice: 100, stopPrice: 95, exitPrice: 110, status: 'closed' };
near(tradeRMultiple(long, 110)!, 2);
near(tradeRMultiple(long, 95)!, -1);
// стоп не задан → null; стоп с неверной стороны → null
assert.equal(tradeRMultiple({ ...long, stopPrice: 0 }, 110), null);
assert.equal(tradeRMultiple({ ...long, stopPrice: 105 }, 110), null);
// SHORT: вход 100, стоп 105 (риск 5%), выход 90 (+10%) → +2R
near(tradeRMultiple({ side: 'SHORT', entryPrice: 100, stopPrice: 105, exitPrice: 90, status: 'closed' }, 90)!, 2);

// Статистика: 2 прибыльные (+10%, +5%), 1 убыточная (-4%), 1 открытая
const trades: TradeLike[] = [
  { side: 'LONG', entryPrice: 100, stopPrice: 95, exitPrice: 110, status: 'closed' }, // +10%, +2R
  { side: 'SHORT', entryPrice: 200, stopPrice: 210, exitPrice: 190, status: 'closed' }, // +5%, риск 5% → +1R
  { side: 'LONG', entryPrice: 50, stopPrice: 0, exitPrice: 48, status: 'closed' }, // -4%, без стопа
  { side: 'LONG', entryPrice: 10, stopPrice: 9, exitPrice: 0, status: 'open' },
];
const s = computeJournalStats(trades);
assert.equal(s.closedCount, 3);
assert.equal(s.openCount, 1);
assert.equal(s.wins, 2);
assert.equal(s.losses, 1);
near(s.winRatePct!, (2 / 3) * 100);
near(s.totalPnlPct, 11);
near(s.avgPnlPct!, 11 / 3);
near(s.avgR!, 1.5); // только сделки со стопом: (2 + 1) / 2
near(s.bestPnlPct!, 10);
near(s.worstPnlPct!, -4);

// Пустой журнал
const empty = computeJournalStats([]);
assert.equal(empty.winRatePct, null);
assert.equal(empty.avgR, null);

console.log('journalStats: все проверки пройдены');
