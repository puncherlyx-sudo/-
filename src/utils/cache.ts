/**
 * Единый слой кэширования (Stale-While-Revalidate + TTL), дедупликация параллельных запросов,
 * отмена устаревших запросов через AbortController и утилита Page Visibility API.
 */

export const CACHE_TTL = {
  /** Мульти-таймфреймы 15m / 1h / 4h / 1d */
  MULTI_TF_MS: 60_000,
  /** Индекс Fear & Greed (единый на всё приложение) */
  FEAR_GREED_MS: 10 * 60_000,
  /** Новости, AI-переводы и экономический календарь */
  NEWS_AND_CALENDAR_MS: 15 * 60_000,
  /** Метаданные пар и секторов */
  PAIR_METADATA_MS: 5 * 60_000,
  /** Живые обзоры котировок */
  LIVE_OVERVIEW_MS: 15_000,
} as const;

interface SwrEntry<T> {
  data: T;
  updatedAtMs: number;
  ttlMs: number;
}

const MAX_CACHE_ENTRIES = 250;
const swrStore = new Map<string, SwrEntry<unknown>>();
const inFlightRequests = new Map<string, Promise<unknown>>();

function pruneIfNeeded(): void {
  if (swrStore.size <= MAX_CACHE_ENTRIES) return;
  const oldestKey = swrStore.keys().next().value;
  if (oldestKey !== undefined) {
    swrStore.delete(oldestKey);
  }
}

export function getSwrCache<T>(key: string): { data: T; isFresh: boolean; ageMs: number } | null {
  const entry = swrStore.get(key) as SwrEntry<T> | undefined;
  if (!entry) return null;
  const ageMs = Date.now() - entry.updatedAtMs;
  return {
    data: entry.data,
    isFresh: ageMs <= entry.ttlMs,
    ageMs,
  };
}

export function setSwrCache<T>(key: string, data: T, ttlMs: number): void {
  if (swrStore.has(key)) {
    swrStore.delete(key);
  }
  swrStore.set(key, {
    data,
    updatedAtMs: Date.now(),
    ttlMs,
  });
  pruneIfNeeded();
}

export function invalidateSwrCache(prefix?: string): void {
  if (!prefix) {
    swrStore.clear();
    return;
  }
  for (const key of Array.from(swrStore.keys())) {
    if (key.startsWith(prefix)) {
      swrStore.delete(key);
    }
  }
}

export interface SwrFetchOptions<T> {
  ttlMs: number;
  forceRefresh?: boolean;
  signal?: AbortSignal;
  /** Вызывается при фоновом обновлении устаревшего (stale) кэша */
  onRevalidated?: (freshData: T) => void;
  /** Алиас для onRevalidated */
  onBackgroundUpdate?: (freshData: T) => void;
}

/**
 * Stale-While-Revalidate + дедупликация одновременных запросов по ключу.
 * - Если кэш свежий и !forceRefresh -> возвращает сразу без сети.
 * - Если кэш устарел -> мгновенно возвращает stale-данные и запускает 1 фоновое обновление.
 * - Если несколько компонентов запрашивают один URL одновременно -> выполняется ровно 1 HTTP-запрос.
 */
export async function fetchWithSWR<T>(
  key: string,
  fetcher: (signal?: AbortSignal) => Promise<T>,
  options: SwrFetchOptions<T>
): Promise<T> {
  const { ttlMs, forceRefresh = false, signal, onRevalidated, onBackgroundUpdate } = options;
  const notifyFresh = onRevalidated ?? onBackgroundUpdate;
  const cached = getSwrCache<T>(key);

  if (cached && cached.isFresh && !forceRefresh) {
    return cached.data;
  }

  const runNetwork = (): Promise<T> => {
    const existing = inFlightRequests.get(key) as Promise<T> | undefined;
    if (existing && !forceRefresh) {
      return existing;
    }
    const promise = fetcher(signal)
      .then((fresh) => {
        setSwrCache(key, fresh, ttlMs);
        return fresh;
      })
      .finally(() => {
        if (inFlightRequests.get(key) === promise) {
          inFlightRequests.delete(key);
        }
      });
    inFlightRequests.set(key, promise);
    return promise;
  };

  if (cached && !forceRefresh) {
    // Stale-While-Revalidate: мгновенно отдаём кэш, обновляем в фоне
    void runNetwork()
      .then((fresh) => {
        if (!signal?.aborted) {
          notifyFresh?.(fresh);
        }
      })
      .catch(() => undefined);
    return cached.data;
  }

  return runNetwork();
}

/**
 * Управляет отменой устаревших сетевых запросов при быстром переключении пары или таймфрейма.
 */
export class LatestRequestController {
  private current: AbortController | null = null;

  next(): AbortSignal {
    this.abort();
    this.current = new AbortController();
    return this.current.signal;
  }

  abort(): void {
    if (this.current) {
      this.current.abort();
      this.current = null;
    }
  }
}

/**
 * Безопасный Page Visibility подпищик для паузы поллинга в фоне и экономии батареи.
 */
export function subscribePageVisibility(
  callbacksOrHandler:
    | ((visible: boolean) => void)
    | {
        onVisible?: () => void;
        onHidden?: () => void;
      }
): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const handler = () => {
    const visible = document.visibilityState === 'visible';
    if (typeof callbacksOrHandler === 'function') {
      callbacksOrHandler(visible);
    } else if (visible) {
      callbacksOrHandler.onVisible?.();
    } else {
      callbacksOrHandler.onHidden?.();
    }
  };
  document.addEventListener('visibilitychange', handler);
  return () => document.removeEventListener('visibilitychange', handler);
}

export function isPageVisible(): boolean {
  if (typeof document === 'undefined') return true;
  return document.visibilityState === 'visible';
}
