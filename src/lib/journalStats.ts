export type TradeSide = 'LONG' | 'SHORT';

export interface TradeLike {
  side: TradeSide;
  entryPrice: number;
  stopPrice: number; // 0 — стоп не задан
  exitPrice: number; // 0 — сделка ещё открыта
  status: 'open' | 'closed';
}

/** Результат сделки в % от цены входа (без плеча и комиссий). Для LONG растёт при росте цены, для SHORT — при падении. */
export function tradePnlPct(t: Pick<TradeLike, 'side' | 'entryPrice'>, price: number): number {
  if (!(t.entryPrice > 0) || !(price > 0)) return 0;
  const raw = ((price - t.entryPrice) / t.entryPrice) * 100;
  return t.side === 'LONG' ? raw : -raw;
}

/** Результат в R: во сколько раз прибыль/убыток больше рискованной суммы (расстояние до стопа). null, если стоп не задан или задан неверно. */
export function tradeRMultiple(t: TradeLike, price: number): number | null {
  if (!(t.stopPrice > 0)) return null;
  const riskPct = Math.abs(((t.entryPrice - t.stopPrice) / t.entryPrice) * 100);
  // стоп должен стоять по «плохую» сторону от входа
  const stopOnWrongSide = t.side === 'LONG' ? t.stopPrice >= t.entryPrice : t.stopPrice <= t.entryPrice;
  if (stopOnWrongSide || riskPct === 0) return null;
  return tradePnlPct(t, price) / riskPct;
}

export interface JournalStats {
  closedCount: number;
  openCount: number;
  wins: number;
  losses: number;
  winRatePct: number | null;
  totalPnlPct: number;
  avgPnlPct: number | null;
  avgR: number | null;
  bestPnlPct: number | null;
  worstPnlPct: number | null;
}

export function computeJournalStats(trades: TradeLike[]): JournalStats {
  const closed = trades.filter((t) => t.status === 'closed' && t.exitPrice > 0);
  const pnls = closed.map((t) => tradePnlPct(t, t.exitPrice));
  const rs = closed.map((t) => tradeRMultiple(t, t.exitPrice)).filter((r): r is number => r !== null);
  const wins = pnls.filter((p) => p > 0).length;
  const losses = pnls.filter((p) => p < 0).length;
  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
  return {
    closedCount: closed.length,
    openCount: trades.filter((t) => t.status === 'open').length,
    wins,
    losses,
    winRatePct: closed.length ? (wins / closed.length) * 100 : null,
    totalPnlPct: sum(pnls),
    avgPnlPct: closed.length ? sum(pnls) / closed.length : null,
    avgR: rs.length ? sum(rs) / rs.length : null,
    bestPnlPct: pnls.length ? Math.max(...pnls) : null,
    worstPnlPct: pnls.length ? Math.min(...pnls) : null,
  };
}
