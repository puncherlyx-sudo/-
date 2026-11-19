/**
 * In-memory кэш между вкладками (Рынок, Скринер, Новости),
 * троттлинг обновлений котировок (1000мс) и fetch с exponential backoff.
 */

interface CacheEntry<T> {
  data: T;
  updatedAtMs: number;
  ttlMs: number;
}

const memoryCache = new Map<string, CacheEntry<unknown>>();
const throttleStamp = new Map<string, number>();

export function getCachedValue<T>(key: string): { data: T; isFresh: boolean; updatedAtMs: number } | null {
  const entry = memoryCache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  const age = Date.now() - entry.updatedAtMs;
  return {
    data: entry.data,
    isFresh: age <= entry.ttlMs,
    updatedAtMs: entry.updatedAtMs,
  };
}

export function setCachedValue<T>(key: string, data: T, ttlMs = 30_000): void {
  memoryCache.set(key, {
    data,
    updatedAtMs: Date.now(),
    ttlMs,
  });
}

export function clearMemoryCache(): void {
  memoryCache.clear();
  throttleStamp.clear();
}

/**
 * Возвращает true, если с последнего рендера по ключу прошло >= minIntervalMs (по умолчанию 1000мс).
 */
export function shouldApplyThrottledUpdate(key: string, minIntervalMs = 1000): boolean {
  const now = Date.now();
  const prev = throttleStamp.get(key) ?? 0;
  if (now - prev < minIntervalMs) {
    return false;
  }
  throttleStamp.set(key, now);
  return true;
}

/**
 * Запрос JSON с exponential backoff при сетевых сбоях, 429 (rate limit) и 5xx.
 */
export async function fetchJsonWithBackoff<T>(
  url: string,
  options?: {
    init?: RequestInit;
    retries?: number;
    baseDelayMs?: number;
    timeoutMs?: number;
  }
): Promise<{ ok: boolean; status: number; data: T | null; errorMessage: string | null }> {
  const retries = options?.retries ?? 2;
  const baseDelayMs = options?.baseDelayMs ?? 600;
  const timeoutMs = options?.timeoutMs ?? 12000;

  let lastStatus = 0;
  let lastError = 'Сетевая ошибка при получении данных.';

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...options?.init,
        signal: controller.signal,
      });
      window.clearTimeout(timer);
      lastStatus = res.status;

      if (res.status === 429 || res.status >= 500) {
        if (attempt < retries) {
          const jitter = Math.floor(Math.random() * 250);
          await new Promise((r) => setTimeout(r, baseDelayMs * Math.pow(2, attempt) + jitter));
          continue;
        }
        return {
          ok: false,
          status: res.status,
          data: null,
          errorMessage:
            res.status === 429
              ? 'Превышен лимит запросов к API (429). Автоматическая пауза.'
              : `Временная недоступность сервера (${res.status}).`,
        };
      }

      const json = (await res.json()) as T & { error?: string };
      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          data: json,
          errorMessage: json?.error || `Ошибка сервера (${res.status}).`,
        };
      }
      return { ok: true, status: res.status, data: json, errorMessage: null };
    } catch (err) {
      window.clearTimeout(timer);
      lastError =
        err instanceof DOMException && err.name === 'AbortError'
          ? 'Превышено время ожидания ответа сервера.'
          : 'Нет соединения с сервером.';
      if (attempt < retries) {
        const jitter = Math.floor(Math.random() * 200);
        await new Promise((r) => setTimeout(r, baseDelayMs * Math.pow(2, attempt) + jitter));
        continue;
      }
    }
  }

  return { ok: false, status: lastStatus, data: null, errorMessage: lastError };
}
