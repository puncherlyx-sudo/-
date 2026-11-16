import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PortfolioHolding, TickerOverview } from '../types/domain';

export const PORTFOLIO_STORAGE_KEY = 'aegisquant_paper_portfolio_v1';

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
}

export interface PortfolioAllocationItem {
  symbol: string;
  baseAsset: string;
  valueUsdt: number;
  sharePct: number;
  pnlUsdt: number;
  pnlPct: number;
  color: string;
}

export interface PaperPortfolioReport {
  rows: PortfolioEvaluatedRow[];
  allocations: PortfolioAllocationItem[];
  totalValue: number;
  totalCost: number;
  totalPnl: number;
  totalPnlPct: number;
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

  const [spotTickers, setSpotTickers] = useState<TickerOverview[]>([]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(holdings));
    } catch {
      // Ignore storage errors
    }
  }, [holdings]);

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

  const removeHolding = useCallback((id: string) => {
    setHoldings((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const clearHoldings = useCallback(() => {
    setHoldings([]);
  }, []);

  const resetDemoPortfolio = useCallback(() => {
    setHoldings(DEFAULT_PORTFOLIO_HOLDINGS);
  }, []);

  const report: PaperPortfolioReport = useMemo(() => {
    const priceMap = new Map(spotTickers.map((t) => [t.symbol, t.price]));
    const rows: PortfolioEvaluatedRow[] = holdings.map((h) => {
      const livePrice = priceMap.get(h.symbol) ?? h.avgEntryPrice;
      const valueUsdt = h.amount * livePrice;
      const costUsdt = h.amount * h.avgEntryPrice;
      const pnlUsdt = valueUsdt - costUsdt;
      const pnlPct = costUsdt > 0 ? (pnlUsdt / costUsdt) * 100 : 0;
      return {
        ...h,
        baseAsset: h.symbol.replace('USDT', ''),
        livePrice,
        valueUsdt,
        costUsdt,
        pnlUsdt,
        pnlPct,
      };
    });

    const totalValue = rows.reduce((acc, r) => acc + r.valueUsdt, 0);
    const totalCost = rows.reduce((acc, r) => acc + r.costUsdt, 0);
    const totalPnl = totalValue - totalCost;
    const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

    // Aggregate by symbol for clean Recharts donut distribution
    const grouped = new Map<
      string,
      { symbol: string; baseAsset: string; valueUsdt: number; costUsdt: number }
    >();
    for (const r of rows) {
      const cur = grouped.get(r.symbol) ?? {
        symbol: r.symbol,
        baseAsset: r.baseAsset,
        valueUsdt: 0,
        costUsdt: 0,
      };
      cur.valueUsdt += r.valueUsdt;
      cur.costUsdt += r.costUsdt;
      grouped.set(r.symbol, cur);
    }

    const allocations: PortfolioAllocationItem[] = Array.from(grouped.values())
      .sort((a, b) => b.valueUsdt - a.valueUsdt)
      .map((item, idx) => {
        const pnlUsdt = item.valueUsdt - item.costUsdt;
        const pnlPct = item.costUsdt > 0 ? (pnlUsdt / item.costUsdt) * 100 : 0;
        const sharePct = totalValue > 0 ? (item.valueUsdt / totalValue) * 100 : 0;
        return {
          symbol: item.symbol,
          baseAsset: item.baseAsset,
          valueUsdt: item.valueUsdt,
          sharePct,
          pnlUsdt,
          pnlPct,
          color: PORTFOLIO_COLORS[idx % PORTFOLIO_COLORS.length],
        };
      });

    return { rows, allocations, totalValue, totalCost, totalPnl, totalPnlPct };
  }, [holdings, spotTickers]);

  return {
    holdings,
    report,
    spotTickers,
    addHolding,
    removeHolding,
    clearHoldings,
    resetDemoPortfolio,
  };
}
