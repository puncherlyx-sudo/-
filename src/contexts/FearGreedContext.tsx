import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { FearAndGreedSnapshot } from '../types/domain';

interface FearGreedContextValue {
  data: FearAndGreedSnapshot | null;
  value: number | null;
  label: string | null;
  loading: boolean;
  refresh: (forceRefresh?: boolean) => Promise<void>;
  syncFromExternal: (partial: {
    value: number;
    classificationRu: string;
    yesterdayValue?: number;
    weekAgoValue?: number;
    monthAgoValue?: number;
  }) => void;
}

const FearGreedContext = createContext<FearGreedContextValue>({
  data: null,
  value: null,
  label: null,
  loading: true,
  refresh: async () => undefined,
  syncFromExternal: () => undefined,
});

const FG_STORAGE_KEY = 'vernier_fear_greed_cache_v1';

function readCachedFearGreed(): FearAndGreedSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(FG_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ts?: number; data?: FearAndGreedSnapshot };
    if (parsed?.data && typeof parsed.data.value === 'number' && parsed.ts && Date.now() - parsed.ts < 30 * 60_000) {
      return parsed.data;
    }
    return null;
  } catch {
    return null;
  }
}

function writeCachedFearGreed(snapshot: FearAndGreedSnapshot): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(FG_STORAGE_KEY, JSON.stringify({ ts: Date.now(), data: snapshot }));
  } catch {
    // ignore storage limits
  }
}

export const FearGreedProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [data, setData] = useState<FearAndGreedSnapshot | null>(() => readCachedFearGreed());
  const [loading, setLoading] = useState<boolean>(() => !readCachedFearGreed());

  const refresh = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    try {
      const url = forceRefresh ? '/api/market/fear-greed?refresh=1' : '/api/market/fear-greed';
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) {
        const json = (await res.json()) as FearAndGreedSnapshot;
        if (typeof json?.value === 'number') {
          setData(json);
          writeCachedFearGreed(json);
        }
      }
    } catch {
      // Keep prior value on transient network failure
    } finally {
      setLoading(false);
    }
  }, []);

  const syncFromExternal = useCallback(
    (partial: {
      value: number;
      classificationRu: string;
      yesterdayValue?: number;
      weekAgoValue?: number;
      monthAgoValue?: number;
    }) => {
      if (typeof partial.value !== 'number' || !Number.isFinite(partial.value)) return;
      setData((prev) => {
        const next: FearAndGreedSnapshot = prev
          ? {
              ...prev,
              value: partial.value,
              classificationRu: partial.classificationRu || prev.classificationRu,
              yesterdayValue: partial.yesterdayValue ?? prev.yesterdayValue,
              weekAgoValue: partial.weekAgoValue ?? prev.weekAgoValue,
              monthAgoValue: partial.monthAgoValue ?? prev.monthAgoValue,
            }
          : {
              value: partial.value,
              classification: partial.classificationRu,
              classificationRu: partial.classificationRu,
              yesterdayValue: partial.yesterdayValue ?? partial.value,
              weekAgoValue: partial.weekAgoValue ?? partial.value,
              monthAgoValue: partial.monthAgoValue ?? partial.value,
              history: [],
              nextUpdateSeconds: 0,
              source: 'live',
              updatedAt: new Date().toISOString(),
            };
        writeCachedFearGreed(next);
        return next;
      });
      setLoading(false);
    },
    []
  );

  useEffect(() => {
    void refresh(false);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refresh(false);
      }
    }, 5 * 60_000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refresh(false);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [refresh]);

  return (
    <FearGreedContext.Provider
      value={{
        data,
        value: data?.value ?? null,
        label: data?.classificationRu ?? null,
        loading,
        refresh,
        syncFromExternal,
      }}
    >
      {children}
    </FearGreedContext.Provider>
  );
};

export function useFearGreed(): FearGreedContextValue {
  return useContext(FearGreedContext);
}
