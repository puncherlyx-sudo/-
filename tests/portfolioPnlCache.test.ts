import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearPnlCache,
  computeOrGetCachedPnl,
  getPnlCacheMetrics,
} from '../src/utils/portfolioPnlCache.ts';
import type { PortfolioHolding, TickerOverview } from '../src/types/domain.ts';

function makeTicker(symbol: string, price: number, change24hPct: number): TickerOverview {
  return {
    symbol,
    baseAsset: symbol.replace('USDT', ''),
    price,
    change24hPct,
    high24h: price * 1.03,
    low24h: price * 0.97,
    volume24hUsdt: 1_000_000,
    source: 'live',
  };
}

test('PnL cache returns identical cached reference when holdings and held prices are unchanged (including unrelated ticker changes)', () => {
  clearPnlCache();

  const holdings: PortfolioHolding[] = [
    { id: 'h1', symbol: 'BTCUSDT', amount: 0.5, avgEntryPrice: 60000 },
    { id: 'h2', symbol: 'USDTUSDT', amount: 1000, avgEntryPrice: 1 },
  ];

  const map1 = new Map<string, TickerOverview>([
    ['BTCUSDT', makeTicker('BTCUSDT', 66000, 10)],
    ['DOGEUSDT', makeTicker('DOGEUSDT', 0.15, 2)],
  ]);

  const first = computeOrGetCachedPnl(holdings, map1, true);
  assert.equal(first.report.totalValue, 34000);
  assert.equal(first.report.totalCost, 31000);
  assert.equal(first.report.totalPnl, 3000);
  assert.equal(getPnlCacheMetrics().misses, 1);
  assert.equal(getPnlCacheMetrics().hits, 0);

  // Unrelated ticker DOGEUSDT moves — BTCUSDT price & holdings identical -> must be a cache HIT
  const map2 = new Map<string, TickerOverview>([
    ['BTCUSDT', makeTicker('BTCUSDT', 66000, 10)],
    ['DOGEUSDT', makeTicker('DOGEUSDT', 0.25, 40)],
  ]);
  const second = computeOrGetCachedPnl([...holdings], map2, true);
  assert.strictEqual(second, first, 'Expected exact referential cache hit');
  assert.strictEqual(second.report, first.report);
  assert.equal(getPnlCacheMetrics().hits, 1);
  assert.equal(getPnlCacheMetrics().misses, 1);
});

test('PnL cache invalidates when held asset price or quantity changes and enforces LRU size bound', () => {
  clearPnlCache();

  const holdings: PortfolioHolding[] = [
    { id: 'h1', symbol: 'ETHUSDT', amount: 2, avgEntryPrice: 3000 },
  ];

  const before = computeOrGetCachedPnl(
    holdings,
    new Map([['ETHUSDT', makeTicker('ETHUSDT', 3300, 5)]]),
    true
  );
  const after = computeOrGetCachedPnl(
    holdings,
    new Map([['ETHUSDT', makeTicker('ETHUSDT', 3500, 8)]]),
    true
  );

  assert.notStrictEqual(after, before);
  assert.equal(before.report.totalPnl, 600);
  assert.equal(after.report.totalPnl, 1000);

  // Fill beyond maxSize to confirm bounded LRU eviction
  const { maxSize } = getPnlCacheMetrics();
  for (let i = 0; i < maxSize + 10; i += 1) {
    computeOrGetCachedPnl(
      holdings,
      new Map([['ETHUSDT', makeTicker('ETHUSDT', 3000 + i, 1)]]),
      true
    );
  }
  assert.equal(getPnlCacheMetrics().size, maxSize, 'LRU cache must never exceed maxSize');
});
