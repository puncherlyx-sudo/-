import type { PortfolioHolding, TickerOverview } from '../types/domain';

export const STABLE_PORTFOLIO_SYMBOLS = new Set([
  'USDTUSDT',
  'USDCUSDT',
  'FDUSDUSDT',
  'BUSDUSDT',
  'DAIUSDT',
  'TUSDUSDT',
  'USDEUSDT',
]);

export const PORTFOLIO_COLORS = [
  '#10B981',
  '#22D3EE',
  '#F59E0B',
  '#A78BFA',
  '#FB7185',
  '#38BDF8',
] as const;

export interface PortfolioEvaluatedRow extends PortfolioHolding {
  baseAsset: string;
  livePrice: number;
  valueUsdt: number;
  costUsdt: number;
  pnlUsdt: number;
  pnlPct: number;
  dailyPnlUsdt: number;
  dailyPnlPct: number;
}

export interface PortfolioAllocationItem {
  symbol: string;
  baseAsset: string;
  valueUsdt: number;
  sharePct: number;
  pnlUsdt: number;
  pnlPct: number;
  dailyPnlUsdt: number;
  dailyPnlPct: number;
  color: string;
}

export interface DailyPnlSummary {
  dailyPnlUsdt: number;
  dailyPnlPct: number;
  hasLive24hData: boolean;
}

export interface PaperPortfolioReport {
  rows: PortfolioEvaluatedRow[];
  allocations: PortfolioAllocationItem[];
  totalValue: number;
  totalCost: number;
  totalPnl: number;
  totalPnlPct: number;
  dailyPnlUsdt: number;
  dailyPnlPct: number;
  hasLive24hData: boolean;
}

export interface CachedPnlBundle {
  report: PaperPortfolioReport;
  dailyPnl: DailyPnlSummary;
}

const MAX_PNL_CACHE_ENTRIES = 32;
const pnlReportCache = new Map<string, CachedPnlBundle>();
let pnlCacheHits = 0;
let pnlCacheMisses = 0;

/**
 * Формирует детерминированный ключ кэша PnL исключительно по позициям портфеля
 * и актуальным котировкам активов, входящих в портфель (изменения цен сторонних монет ключ не меняют).
 */
export function buildPnlCacheKey(
  holdings: readonly PortfolioHolding[],
  tickerMap: ReadonlyMap<string, TickerOverview>,
  hasLive24hData: boolean
): string {
  const parts: string[] = [hasLive24hData ? '1' : '0'];
  for (let i = 0; i < holdings.length; i += 1) {
    const h = holdings[i];
    const upperSymbol = h.symbol.toUpperCase();
    const isStable = STABLE_PORTFOLIO_SYMBOLS.has(upperSymbol);
    const ticker = isStable ? undefined : tickerMap.get(h.symbol);
    const livePrice = isStable ? 1 : (ticker?.price ?? h.avgEntryPrice);
    const change24hPct = isStable
      ? 0
      : ticker && Number.isFinite(ticker.change24hPct)
        ? ticker.change24hPct
        : 0;
    parts.push(`${h.id}|${upperSymbol}|${h.amount}|${h.avgEntryPrice}|${livePrice}|${change24hPct}`);
  }
  return parts.join(';');
}

/**
 * Возвращает закэшированный отчёт PnL (referentially stable), если позиции и котировки активов не изменились.
 * При промахе выполняет расчёт один раз и сохраняет результат в ограниченный LRU-кэш.
 */
export function computeOrGetCachedPnl(
  holdings: readonly PortfolioHolding[],
  tickerMap: ReadonlyMap<string, TickerOverview>,
  hasLive24hData: boolean
): CachedPnlBundle {
  const cacheKey = buildPnlCacheKey(holdings, tickerMap, hasLive24hData);
  const existing = pnlReportCache.get(cacheKey);
  if (existing) {
    // LRU-продвижение записи в конец Map
    pnlReportCache.delete(cacheKey);
    pnlReportCache.set(cacheKey, existing);
    pnlCacheHits += 1;
    return existing;
  }

  pnlCacheMisses += 1;

  const evaluatedRows: PortfolioEvaluatedRow[] = holdings.map((h) => {
    const isStable = STABLE_PORTFOLIO_SYMBOLS.has(h.symbol.toUpperCase());
    const ticker = isStable ? undefined : tickerMap.get(h.symbol);
    const livePrice = isStable ? 1 : (ticker?.price ?? h.avgEntryPrice);
    const valueUsdt = h.amount * livePrice;
    const costUsdt = h.amount * h.avgEntryPrice;
    const pnlUsdt = valueUsdt - costUsdt;
    const pnlPct = costUsdt > 0 ? (pnlUsdt / costUsdt) * 100 : 0;

    const change24hPct = isStable
      ? 0
      : ticker && Number.isFinite(ticker.change24hPct)
        ? ticker.change24hPct
        : 0;
    const factor = 1 + change24hPct / 100;
    const value24hAgo = factor > 0 ? valueUsdt / factor : valueUsdt;
    const dailyPnlUsdt = valueUsdt - value24hAgo;

    return {
      ...h,
      baseAsset: h.symbol.replace('USDT', ''),
      livePrice,
      valueUsdt,
      costUsdt,
      pnlUsdt,
      pnlPct,
      dailyPnlUsdt,
      dailyPnlPct: change24hPct,
    };
  });

  const totalValue = evaluatedRows.reduce((acc, r) => acc + r.valueUsdt, 0);
  const totalCost = evaluatedRows.reduce((acc, r) => acc + r.costUsdt, 0);
  const totalPnl = totalValue - totalCost;
  const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

  let dailyPnlUsdt = 0;
  let dailyPnlPct = 0;
  if (hasLive24hData && evaluatedRows.length > 0) {
    dailyPnlUsdt = evaluatedRows.reduce((acc, r) => acc + r.dailyPnlUsdt, 0);
    const totalValue24hAgo = totalValue - dailyPnlUsdt;
    dailyPnlPct = totalValue24hAgo > 0 ? (dailyPnlUsdt / totalValue24hAgo) * 100 : 0;
  }

  const dailyPnl: DailyPnlSummary = {
    dailyPnlUsdt,
    dailyPnlPct,
    hasLive24hData,
  };

  // Агрегация долей по тикеру для круговой диаграммы распределения
  const grouped = new Map<
    string,
    { symbol: string; baseAsset: string; valueUsdt: number; costUsdt: number; dailyPnlUsdt: number }
  >();
  for (const r of evaluatedRows) {
    const cur = grouped.get(r.symbol) ?? {
      symbol: r.symbol,
      baseAsset: r.baseAsset,
      valueUsdt: 0,
      costUsdt: 0,
      dailyPnlUsdt: 0,
    };
    cur.valueUsdt += r.valueUsdt;
    cur.costUsdt += r.costUsdt;
    cur.dailyPnlUsdt += r.dailyPnlUsdt;
    grouped.set(r.symbol, cur);
  }

  const allocations: PortfolioAllocationItem[] = Array.from(grouped.values())
    .sort((a, b) => b.valueUsdt - a.valueUsdt)
    .map((item, idx) => {
      const pnlUsdt = item.valueUsdt - item.costUsdt;
      const pnlPct = item.costUsdt > 0 ? (pnlUsdt / item.costUsdt) * 100 : 0;
      const sharePct = totalValue > 0 ? (item.valueUsdt / totalValue) * 100 : 0;
      const prev24hVal = item.valueUsdt - item.dailyPnlUsdt;
      const itemDailyPct = prev24hVal > 0 ? (item.dailyPnlUsdt / prev24hVal) * 100 : 0;
      return {
        symbol: item.symbol,
        baseAsset: item.baseAsset,
        valueUsdt: item.valueUsdt,
        sharePct,
        pnlUsdt,
        pnlPct,
        dailyPnlUsdt: item.dailyPnlUsdt,
        dailyPnlPct: itemDailyPct,
        color: PORTFOLIO_COLORS[idx % PORTFOLIO_COLORS.length],
      };
    });

  const bundle: CachedPnlBundle = {
    dailyPnl,
    report: {
      rows: evaluatedRows,
      allocations,
      totalValue,
      totalCost,
      totalPnl,
      totalPnlPct,
      dailyPnlUsdt,
      dailyPnlPct,
      hasLive24hData,
    },
  };

  if (pnlReportCache.size >= MAX_PNL_CACHE_ENTRIES) {
    const oldestKey = pnlReportCache.keys().next().value;
    if (oldestKey !== undefined) {
      pnlReportCache.delete(oldestKey);
    }
  }
  pnlReportCache.set(cacheKey, bundle);
  return bundle;
}

export function clearPnlCache(): void {
  pnlReportCache.clear();
  pnlCacheHits = 0;
  pnlCacheMisses = 0;
}

export function getPnlCacheMetrics(): { size: number; hits: number; misses: number; maxSize: number } {
  return {
    size: pnlReportCache.size,
    hits: pnlCacheHits,
    misses: pnlCacheMisses,
    maxSize: MAX_PNL_CACHE_ENTRIES,
  };
}
