import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ExchangeAssetBalance,
  ExchangeId,
  PortfolioHolding,
  TickerOverview,
} from '../types/domain';

export const PORTFOLIO_STORAGE_KEY = 'aegisquant_paper_portfolio_v1';
export const PORTFOLIO_SOURCE_STORAGE_KEY = 'aegisquant_portfolio_source_v1';

const STABLE_SYMBOLS = new Set(['USDTUSDT', 'USDCUSDT', 'FDUSDUSDT', 'BUSDUSDT', 'DAIUSDT', 'TUSDUSDT', 'USDEUSDT']);

export interface PortfolioSourceMeta {
  mode: 'manual' | 'exchange';
  exchange?: ExchangeId;
  label?: string;
  syncedAt?: string;
}

export interface PortfolioIdentity {
  portfolioId: string;
  portfolioLabel: string;
}

export function getPortfolioIdentity(source: PortfolioSourceMeta): PortfolioIdentity {
  if (source.mode === 'exchange' && source.exchange) {
    const exchangeCode = source.exchange.toUpperCase();
    const label = source.label?.trim()
      ? `${exchangeCode} (${source.label.trim()})`
      : exchangeCode;
    return {
      portfolioId: `exchange_${source.exchange}`,
      portfolioLabel: label.slice(0, 80),
    };
  }
  return {
    portfolioId: 'manual',
    portfolioLabel: 'Локальный портфель',
  };
}

export const PORTFOLIO_COLORS = [
  '#10B981',
  '#22D3EE',
  '#F59E0B',
  '#A78BFA',
  '#FB7185',
  '#38BDF8',
] as const;

export const DEFAULT_PORTFOLIO_HOLDINGS: PortfolioHolding[] = [
  { id: 'seed-btc', symbol: 'BTCUSDT', amount: 0.045, avgEntryPrice: 86500 },
  { id: 'seed-eth', symbol: 'ETHUSDT', amount: 0.85, avgEntryPrice: 3020 },
  { id: 'seed-sol', symbol: 'SOLUSDT', amount: 12, avgEntryPrice: 196 },
];

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

export function usePaperPortfolio() {
  const [holdings, setHoldings] = useState<PortfolioHolding[]>(() => {
    if (typeof window === 'undefined') return DEFAULT_PORTFOLIO_HOLDINGS;
    try {
      const raw = window.localStorage.getItem(PORTFOLIO_STORAGE_KEY);
      if (raw !== null) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) return parsed as PortfolioHolding[];
      }
    } catch {
      // Ignore private browsing storage error
    }
    return DEFAULT_PORTFOLIO_HOLDINGS;
  });

  const [portfolioSource, setPortfolioSource] = useState<PortfolioSourceMeta>(() => {
    if (typeof window === 'undefined') return { mode: 'manual' };
    try {
      const raw = window.localStorage.getItem(PORTFOLIO_SOURCE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as PortfolioSourceMeta;
        if (parsed && (parsed.mode === 'manual' || parsed.mode === 'exchange')) return parsed;
      }
    } catch {
      // Ignore storage error
    }
    return { mode: 'manual' };
  });

  const [spotTickers, setSpotTickers] = useState<TickerOverview[]>([]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(holdings));
    } catch {
      // Ignore storage errors
    }
  }, [holdings]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PORTFOLIO_SOURCE_STORAGE_KEY, JSON.stringify(portfolioSource));
    } catch {
      // Ignore storage errors
    }
  }, [portfolioSource]);

  const refreshSpotPrices = useCallback(async () => {
    try {
      const res = await fetch('/api/market/overview?marketType=spot');
      if (res.ok) {
        const data = (await res.json()) as { tickers?: TickerOverview[] };
        if (Array.isArray(data.tickers)) {
          setSpotTickers(data.tickers);
        }
      }
    } catch {
      // Retain existing prices on temporary offline hiccup
    }
  }, []);

  useEffect(() => {
    void refreshSpotPrices();
    const timer = setInterval(() => {
      void refreshSpotPrices();
    }, 30_000);
    return () => clearInterval(timer);
  }, [refreshSpotPrices]);

  const addHolding = useCallback((symbol: string, amount: number, avgEntryPrice: number) => {
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(avgEntryPrice) || avgEntryPrice <= 0) {
      return;
    }
    setPortfolioSource({ mode: 'manual' });
    setHoldings((prev) => [
      {
        id: `pos-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        symbol: symbol.toUpperCase(),
        amount,
        avgEntryPrice,
      },
      ...prev,
    ]);
  }, []);

  const updateHolding = useCallback((id: string, amount: number, avgEntryPrice: number) => {
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(avgEntryPrice) || avgEntryPrice <= 0) {
      return;
    }
    setPortfolioSource({ mode: 'manual' });
    setHoldings((prev) =>
      prev.map((item) => (item.id === id ? { ...item, amount, avgEntryPrice } : item))
    );
  }, []);

  const removeHolding = useCallback((id: string) => {
    setHoldings((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const clearHoldings = useCallback(() => {
    setHoldings([]);
    setPortfolioSource({ mode: 'manual' });
  }, []);

  const resetDemoPortfolio = useCallback(() => {
    setHoldings(DEFAULT_PORTFOLIO_HOLDINGS);
    setPortfolioSource({ mode: 'manual' });
  }, []);

  const syncFromExchange = useCallback(
    (exchange: ExchangeId, label: string, assets: ExchangeAssetBalance[], syncedAt: string) => {
      const nextHoldings: PortfolioHolding[] = assets
        .filter((a) => a.total > 0 && (a.priceUsdt > 0 || STABLE_SYMBOLS.has(a.symbol)))
        .map((a, idx) => ({
          id: `ex-${exchange}-${a.asset}-${idx}`,
          symbol: a.symbol,
          amount: Number(a.total.toFixed(8)),
          avgEntryPrice: a.priceUsdt > 0 ? a.priceUsdt : 1,
        }));
      setHoldings(nextHoldings);
      setPortfolioSource({
        mode: 'exchange',
        exchange,
        label,
        syncedAt,
      });
    },
    []
  );

  const tickerMap = useMemo(
    () => new Map(spotTickers.map((t) => [t.symbol, t])),
    [spotTickers]
  );

  const hasLive24hData = spotTickers.length > 0;

  const { rows, totalValue, totalCost, totalPnl, totalPnlPct } = useMemo(() => {
    const evaluatedRows: PortfolioEvaluatedRow[] = holdings.map((h) => {
      const isStable = STABLE_SYMBOLS.has(h.symbol.toUpperCase());
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

    const nextTotalValue = evaluatedRows.reduce((acc, r) => acc + r.valueUsdt, 0);
    const nextTotalCost = evaluatedRows.reduce((acc, r) => acc + r.costUsdt, 0);
    const nextTotalPnl = nextTotalValue - nextTotalCost;
    const nextTotalPnlPct = nextTotalCost > 0 ? (nextTotalPnl / nextTotalCost) * 100 : 0;

    return {
      rows: evaluatedRows,
      totalValue: nextTotalValue,
      totalCost: nextTotalCost,
      totalPnl: nextTotalPnl,
      totalPnlPct: nextTotalPnlPct,
    };
  }, [holdings, tickerMap]);

  // Мемоизированный расчёт дневного PnL (24ч) — пересчитывается только при изменении позиций или живых котировок
  const dailyPnl: DailyPnlSummary = useMemo(() => {
    if (!hasLive24hData || rows.length === 0) {
      return {
        dailyPnlUsdt: 0,
        dailyPnlPct: 0,
        hasLive24hData,
      };
    }

    const dailyPnlUsdt = rows.reduce((acc, r) => acc + r.dailyPnlUsdt, 0);
    const totalValue24hAgo = totalValue - dailyPnlUsdt;
    const dailyPnlPct = totalValue24hAgo > 0 ? (dailyPnlUsdt / totalValue24hAgo) * 100 : 0;

    return {
      dailyPnlUsdt,
      dailyPnlPct,
      hasLive24hData,
    };
  }, [rows, totalValue, hasLive24hData]);

  const allocations: PortfolioAllocationItem[] = useMemo(() => {
    // Aggregate by symbol for clean Recharts donut distribution
    const grouped = new Map<
      string,
      { symbol: string; baseAsset: string; valueUsdt: number; costUsdt: number; dailyPnlUsdt: number }
    >();
    for (const r of rows) {
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

    return Array.from(grouped.values())
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
  }, [rows, totalValue]);

  const report: PaperPortfolioReport = useMemo(
    () => ({
      rows,
      allocations,
      totalValue,
      totalCost,
      totalPnl,
      totalPnlPct,
      dailyPnlUsdt: dailyPnl.dailyPnlUsdt,
      dailyPnlPct: dailyPnl.dailyPnlPct,
      hasLive24hData: dailyPnl.hasLive24hData,
    }),
    [rows, allocations, totalValue, totalCost, totalPnl, totalPnlPct, dailyPnl]
  );

  const portfolioIdentity = useMemo(
    () => getPortfolioIdentity(portfolioSource),
    [portfolioSource]
  );

  return useMemo(
    () => ({
      holdings,
      portfolioSource,
      portfolioIdentity,
      report,
      dailyPnl,
      spotTickers,
      addHolding,
      updateHolding,
      removeHolding,
      clearHoldings,
      resetDemoPortfolio,
      syncFromExchange,
    }),
    [
      holdings,
      portfolioSource,
      portfolioIdentity,
      report,
      dailyPnl,
      spotTickers,
      addHolding,
      updateHolding,
      removeHolding,
      clearHoldings,
      resetDemoPortfolio,
      syncFromExchange,
    ]
  );
}
