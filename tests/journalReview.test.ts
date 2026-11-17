import assert from 'node:assert/strict';
import { reviewJournal, type ReviewTrade } from '../src/lib/journalReview.ts';

const t = (symbol: string, side: 'LONG' | 'SHORT', entry: number, exit: number, stop = 0): ReviewTrade => ({
  symbol, side, entryPrice: entry, exitPrice: exit, stopPrice: stop, status: 'closed',
});

// 1. Малая выборка: честно говорим, что выводов делать нельзя
{
  const r = reviewJournal([t('BTCUSDT', 'LONG', 100, 110, 95), t('BTCUSDT', 'LONG', 100, 90, 95)]);
  assert.equal(r.sample.enough, false);
  assert.equal(r.insights[0].title, 'Мало данных');
  assert.equal(r.headline.tone, 'neutral');
}

// 2. Классическая ошибка: много маленьких прибылей и редкие большие убытки без стопа
{
  const trades: ReviewTrade[] = [];
  for (let i = 0; i < 7; i++) trades.push(t('ETHUSDT', 'LONG', 100, 101)); // +1% x7, без стопа
  trades.push(t('ETHUSDT', 'LONG', 100, 85)); // -15%
  trades.push(t('ETHUSDT', 'LONG', 100, 86)); // -14%
  const r = reviewJournal(trades);
  assert.equal(r.sample.enough, true);
  assert.equal(r.sample.closed, 9);
  assert.ok(Math.abs((r.metrics.winRatePct ?? 0) - (7 / 9) * 100) < 1e-9);
  assert.ok((r.metrics.expectancyPct ?? 0) < 0, 'ожидание отрицательное: 7*1 - 29 = -22 за 9 сделок');
  assert.equal(r.headline.tone, 'bad');
  const titles = r.insights.map((i) => i.title);
  assert.ok(titles.includes('Система пока в минусе'));
  assert.ok(titles.includes('Убытки больше прибылей'), 'винрейт 78% при payoff<1');
  assert.ok(titles.includes('Сделки без стопа'));
  assert.ok(r.stops.withoutStopPct === 100);
  assert.ok(r.metrics.payoffRatio! < 0.1);
}

// 3. Серия убытков
{
  const trades: ReviewTrade[] = [
    t('BTCUSDT', 'LONG', 100, 105, 97), t('BTCUSDT', 'LONG', 100, 105, 97),
    t('BTCUSDT', 'LONG', 100, 97, 97), t('BTCUSDT', 'LONG', 100, 97, 97),
    t('BTCUSDT', 'LONG', 100, 97, 97), t('BTCUSDT', 'LONG', 100, 97, 97),
    t('BTCUSDT', 'LONG', 100, 108, 97), t('BTCUSDT', 'LONG', 100, 108, 97),
  ];
  const r = reviewJournal(trades);
  assert.equal(r.metrics.maxLossStreak, 4);
  assert.ok(r.insights.some((i) => i.title === 'Серия убытков'));
}

// 4. Лонги против шортов
{
  const trades: ReviewTrade[] = [];
  for (let i = 0; i < 4; i++) trades.push(t('BTCUSDT', 'LONG', 100, 106, 96)); // 4 выигрыша
  for (let i = 0; i < 4; i++) trades.push(t('BTCUSDT', 'SHORT', 100, 104, 104)); // 4 проигрыша (цена выросла)
  const r = reviewJournal(trades);
  const side = r.insights.find((i) => i.title.includes('лучше'));
  assert.ok(side && side.title === 'Лонги получаются лучше шортов');
  assert.equal(r.bySide.find((s) => s.side === 'LONG')!.winRatePct, 100);
  assert.equal(r.bySide.find((s) => s.side === 'SHORT')!.winRatePct, 0);
}

// 5. Плохая пара
{
  const trades: ReviewTrade[] = [];
  for (let i = 0; i < 5; i++) trades.push(t('BTCUSDT', 'LONG', 100, 103, 98));
  for (let i = 0; i < 3; i++) trades.push(t('DOGEUSDT', 'LONG', 100, 97, 97));
  const r = reviewJournal(trades);
  assert.equal(r.bySymbol[0].symbol, 'BTCUSDT');
  assert.equal(r.bySymbol[r.bySymbol.length - 1].symbol, 'DOGEUSDT');
  assert.ok(r.insights.some((i) => i.title === 'Пара DOGE съедает результат'));
}

// 6. Здоровая система
{
  const trades: ReviewTrade[] = [];
  for (let i = 0; i < 6; i++) trades.push(t('BTCUSDT', 'LONG', 100, 104, 98));
  for (let i = 0; i < 3; i++) trades.push(t('BTCUSDT', 'LONG', 100, 98, 98));
  const r = reviewJournal(trades);
  assert.equal(r.headline.tone, 'good');
  assert.ok(r.insights.some((i) => i.title === 'Система в плюсе'));
  assert.ok(r.metrics.profitFactor! > 1);
  assert.ok(Math.abs(r.metrics.expectancyR! - (6 * 2 - 3 * 1) / 9) < 1e-9, 'R: выигрыш +2R, проигрыш -1R');
}

// 7. Пусто / только открытые: без падений
{
  const r = reviewJournal([]);
  assert.equal(r.sample.closed, 0);
  assert.equal(r.metrics.winRatePct, null);
  const open = reviewJournal([{ symbol: 'BTCUSDT', side: 'LONG', entryPrice: 1, stopPrice: 0, exitPrice: 0, status: 'open' }]);
  assert.equal(open.sample.open, 1);
  assert.equal(open.sample.closed, 0);
}

console.log('journalReview: все проверки пройдены');
