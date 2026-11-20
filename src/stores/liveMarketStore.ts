import { useSyncExternalStore } from 'react';
import type { MarketType, TickerOverview } from '../types/domain';
import { fetchJsonWithBackoff } from '../lib/marketCache';
import { CACHE_TTL, getSwrCache, isPageVisible, setSwrCache } from '../utils/cache';

/**
 * Изолированный стор живых котировок вне корневого React-дерева App.tsx.
 * - Единый разделяемый поллинг на вкладку/приложение (без дублирования запросов).
 * - Батчинг и троттлинг обновлений UI (не чаще 1 раза в 650 мс).
 * - Автоматическая пауза при сворачивании вкладки (Page Visibility API) для экономии батареи.
 * - Подписка по конкретному символу (useLiveTicker) перерисовывает только нужную карточку/строку.
 */

interface MarketChannelState {
  tickers: TickerOverview[];
  bySymbol: Record<string, TickerOverview>;
  isOnline: boolean;
  updatedAtMs: number;
}

const THROTTLE_NOTIFY_MS = 650;
const POLL_INTERVAL_MS = 20_000;

const EMPTY_STATE: MarketChannelState = {
  tickers: [],
  bySymbol: {},
  isOnline: false,
  updatedAtMs: 0,
};

function buildStateFromTickers(tickers: TickerOverview[], isOnline: boolean): MarketChannelState {
  const bySymbol: Record<string, TickerOverview> = {};
  for (const t of tickers) {
    bySymbol[t.symbol] = t;
  }
  return {
    tickers,
    bySymbol,
    isOnline,
    updatedAtMs: Date.now(),
  };
}

class LiveMarketChannel {
  private readonly marketType: MarketType;
  private readonly cacheKey: string;
  private state: MarketChannelState;
  private listeners = new Set<() => void>();
  private pollTimer: number | null = null;
  private notifyTimer: number | null = null;
  private lastNotifyMs = 0;
  private inFlight = false;
  private visibilityBound = false;

  constructor(marketType: MarketType) {
    this.marketType = marketType;
    this.cacheKey = `live_market_overview_${marketType}`;
    const cached = getSwrCache<TickerOverview[]>(this.cacheKey);
    this.state = cached?.data?.length
      ? buildStateFromTickers(cached.data, false)
      : EMPTY_STATE;
  }

  getSnapshot = (): MarketChannelState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) {
      this.start();
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.stop();
      }
    };
  };

  private emitThrottled(): void {
    const now = Date.now();
    const elapsed = now - this.lastNotifyMs;
    if (elapsed >= THROTTLE_NOTIFY_MS) {
      this.lastNotifyMs = now;
      for (const listener of this.listeners) {
        listener();
      }
      return;
    }
    if (this.notifyTimer !== null) return;
    this.notifyTimer = window.setTimeout(() => {
      this.notifyTimer = null;
      this.lastNotifyMs = Date.now();
      for (const listener of this.listeners) {
        listener();
      }
    }, THROTTLE_NOTIFY_MS - elapsed);
  }

  private handleVisibilityChange = (): void => {
    if (typeof document === 'undefined') return;
    if (document.visibilityState === 'visible') {
      if (Date.now() - this.state.updatedAtMs >= CACHE_TTL.LIVE_OVERVIEW_MS) {
        void this.refresh(false);
      }
      this.ensureTimer();
    } else if (this.pollTimer !== null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  };

  private ensureTimer(): void {
    if (this.pollTimer !== null || typeof window === 'undefined') return;
    this.pollTimer = window.setInterval(() => {
      if (isPageVisible()) {
        void this.refresh(false);
      }
    }, POLL_INTERVAL_MS);
  }

  private start(): void {
    if (typeof window === 'undefined') return;
    if (!this.visibilityBound && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
      this.visibilityBound = true;
    }
    if (isPageVisible()) {
      void this.refresh(false);
      this.ensureTimer();
    }
  }

  private stop(): void {
    if (this.pollTimer !== null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.notifyTimer !== null) {
      window.clearTimeout(this.notifyTimer);
      this.notifyTimer = null;
    }
    if (this.visibilityBound && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
      this.visibilityBound = false;
    }
  }

  /** Позволяет другим модулям (напр. MarketTerminalView) напрямую обновлять стор без дубль-запроса */
  ingestTickers(tickers: TickerOverview[], isOnline = true): void {
    if (!Array.isArray(tickers) || tickers.length === 0) return;
    setSwrCache(this.cacheKey, tickers, CACHE_TTL.LIVE_OVERVIEW_MS);
    this.state = buildStateFromTickers(tickers, isOnline);
    this.emitThrottled();
  }

  async refresh(force = false): Promise<void> {
    if (this.inFlight) return;
    if (!force) {
      const cached = getSwrCache<TickerOverview[]>(this.cacheKey);
      if (cached && cached.isFresh && this.state.tickers.length > 0) {
        return;
      }
    }
    this.inFlight = true;
    try {
      const res = await fetchJsonWithBackoff<{ tickers?: TickerOverview[] }>(
        `/api/market/overview?marketType=${this.marketType}`,
        { retries: 1, timeoutMs: 8000 }
      );
      if (res.ok && Array.isArray(res.data?.tickers) && res.data.tickers.length > 0) {
        setSwrCache(this.cacheKey, res.data.tickers, CACHE_TTL.LIVE_OVERVIEW_MS);
        this.state = buildStateFromTickers(res.data.tickers, true);
        this.emitThrottled();
      }
    } finally {
      this.inFlight = false;
    }
  }
}

const channels: Record<MarketType, LiveMarketChannel> = {
  spot: new LiveMarketChannel('spot'),
  futures: new LiveMarketChannel('futures'),
};

export function ingestLiveTickers(marketType: MarketType, tickers: TickerOverview[], isOnline = true): void {
  channels[marketType].ingestTickers(tickers, isOnline);
}

export function refreshLiveTickers(marketType: MarketType, force = false): Promise<void> {
  return channels[marketType].refresh(force);
}

export function useLiveMarketSnapshot(marketType: MarketType = 'spot'): MarketChannelState {
  const ch = channels[marketType];
  return useSyncExternalStore(ch.subscribe, ch.getSnapshot, ch.getSnapshot);
}

export function useLiveTicker(symbol: string, marketType: MarketType = 'spot'): TickerOverview | null {
  const ch = channels[marketType];
  const upper = symbol.toUpperCase();
  return useSyncExternalStore(
    ch.subscribe,
    () => ch.getSnapshot().bySymbol[upper] ?? null,
    () => ch.getSnapshot().bySymbol[upper] ?? null
  );
}
