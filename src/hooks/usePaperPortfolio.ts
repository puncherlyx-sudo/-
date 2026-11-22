import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ingestLiveTickers } from '../stores/liveMarketStore';
import { CACHE_TTL, fetchWithSWR, isPageVisible, subscribePageVisibility } from '../utils/cache';
import { parseJsonResponse } from '../utils/safeFetchJson';
import type {
  ExchangeAssetBalance,
  ExchangeId,
  PortfolioHolding,
  TickerOverview,
} from '../types/domain';

import {
  buildPnlCacheKey,
  clearPnlCache,
  computeOrGetCachedPnl,
  getPnlCacheMetrics,
  PORTFOLIO_COLORS,
  STABLE_PORTFOLIO_SYMBOLS,
  type CachedPnlBundle,
  type DailyPnlSummary,
  type PaperPortfolioReport,
  type PortfolioAllocationItem,
  type PortfolioEvaluatedRow,
} from '../utils/portfolioPnlCache';

export {
  buildPnlCacheKey,
  clearPnlCache,
  computeOrGetCachedPnl,
  getPnlCacheMetrics,
  PORTFOLIO_COLORS,
  type CachedPnlBundle,
  type DailyPnlSummary,
  type PaperPortfolioReport,
  type PortfolioAllocationItem,
  type PortfolioEvaluatedRow,
};

export const PORTFOLIO_STORAGE_KEY = 'aegisquant_paper_portfolio_v1';
export const PORTFOLIO_SOURCE_STORAGE_KEY = 'aegisquant_portfolio_source_v1';

const STABLE_SYMBOLS = STABLE_PORTFOLIO_SYMBOLS;

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
    portfolioId: 'exchange_unlinked',
    portfolioLabel: 'Биржевой портфель (не подключён)',
  };
}

/** VERNIER не хранит средства пользователей: портфель отображает только балансы, синхронизированные с бирж по API. */
export const DEFAULT_PORTFOLIO_HOLDINGS: PortfolioHolding[] = [];

let lastKnownSpotTickers: TickerOverview[] = [];

function areTickerListsEquivalent(
  prev: readonly TickerOverview[],
  next: readonly TickerOverview[]
): boolean {
  if (prev === next) return true;
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i += 1) {
    if (
      prev[i].symbol !== next[i].symbol ||
      prev[i].price !== next[i].price ||
      prev[i].change24hPct !== next[i].change24hPct
    ) {
      return false;
    }
  }
  return true;
}

export function usePaperPortfolio() {
  const [holdings, setHoldings] = useState<PortfolioHolding[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const sourceRaw = window.localStorage.getItem(PORTFOLIO_SOURCE_STORAGE_KEY);
      const sourceParsed = sourceRaw ? (JSON.parse(sourceRaw) as Partial<PortfolioSourceMeta>) : null;
      // Показываем сохранённые балансы только если они реально синхронизированы с подключённой биржи
      if (sourceParsed?.mode !== 'exchange') {
        return [];
      }
      const raw = window.localStorage.getItem(PORTFOLIO_STORAGE_KEY);
      if (raw !== null) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) return parsed as PortfolioHolding[];
      }
    } catch {
      // Ignore private browsing storage error
    }
    return [];
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

  const [spotTickers, setSpotTickers] = useState<TickerOverview[]>(() => lastKnownSpotTickers);

  const commitSpotTickers = useCallback((nextTickers: TickerOverview[]) => {
    if (!Array.isArray(nextTickers) || nextTickers.length === 0) return;
    lastKnownSpotTickers = nextTickers;
    setSpotTickers((prev) => (areTickerListsEquivalent(prev, nextTickers) ? prev : nextTickers));
    ingestLiveTickers('spot', nextTickers, true);
  }, []);

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

  const abortRef = useRef<AbortController | null>(null);

  const refreshSpotPrices = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const data = await fetchWithSWR<{ tickers?: TickerOverview[]; updatedAt?: string }>(
        'market:overview:spot',
        async (signal) => {
          const res = await fetch('/api/market/overview?marketType=spot', { signal });
          const parsed = await parseJsonResponse<{ tickers?: TickerOverview[]; updatedAt?: string }>(res);
          if (!parsed.ok || !parsed.data) {
            throw new Error(parsed.errorMessage || 'Failed to load spot overview');
          }
          return parsed.data;
        },
        {
          ttlMs: CACHE_TTL.LIVE_OVERVIEW_MS,
          signal: controller.signal,
          onBackgroundUpdate: (fresh) => {
            if (Array.isArray(fresh.tickers) && fresh.tickers.length > 0) {
              commitSpotTickers(fresh.tickers);
            }
          },
        }
      );
      if (!controller.signal.aborted && Array.isArray(data.tickers) && data.tickers.length > 0) {
        commitSpotTickers(data.tickers);
      }
    } catch {
      // Retain existing prices on temporary offline hiccup or abort
    }
  }, [commitSpotTickers]);

  useEffect(() => {
    void refreshSpotPrices();
    const timer = window.setInterval(() => {
      if (isPageVisible()) {
        void refreshSpotPrices();
      }
    }, 45_000);
    const unsubVis = subscribePageVisibility((visible) => {
      if (visible) {
        void refreshSpotPrices();
      }
    });
    return () => {
      window.clearInterval(timer);
      unsubVis();
      abortRef.current?.abort();
    };
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
    setHoldings([]);
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

  // Кэшированный расчёт PnL и аллокаций: при неизменных позициях и котировках активов
  // (включая переключение вкладок и обновления посторонних тикеров) возвращается готовый объект из LRU-кэша.
  const { report, dailyPnl } = useMemo(
    () => computeOrGetCachedPnl(holdings, tickerMap, hasLive24hData),
    [holdings, tickerMap, hasLive24hData]
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
