import type { ExchangeAssetBalance, ExchangeId, ExchangeSyncResult } from '../types/domain';

const CACHE_KEY_PREFIX = 'aegisquant_exchange_sync_cache_v1:';
const MAX_CACHED_ASSETS = 60;

export interface CachedExchangeSyncEntry {
  keyId: string;
  exchange: ExchangeId;
  label: string;
  totalBalanceUsdt: number;
  assets: ExchangeAssetBalance[];
  syncedAt: string;
  accountType?: string;
  testnet: boolean;
  cachedAtMs: number;
}

export type ExchangeSyncCacheMap = Record<string, CachedExchangeSyncEntry>;

function getStorageKey(uid: string): string {
  const safeUid = uid.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  return `${CACHE_KEY_PREFIX}${safeUid}`;
}

function sanitizeAsset(raw: unknown): ExchangeAssetBalance | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Partial<ExchangeAssetBalance>;
  if (typeof item.asset !== 'string' || typeof item.symbol !== 'string') return null;
  const free = Number(item.free);
  const locked = Number(item.locked);
  const total = Number(item.total);
  const priceUsdt = Number(item.priceUsdt);
  const valueUsdt = Number(item.valueUsdt);
  if (!Number.isFinite(total) || total < 0) return null;
  return {
    asset: item.asset.slice(0, 24),
    symbol: item.symbol.slice(0, 32),
    free: Number.isFinite(free) ? free : 0,
    locked: Number.isFinite(locked) ? locked : 0,
    total,
    priceUsdt: Number.isFinite(priceUsdt) ? priceUsdt : 0,
    valueUsdt: Number.isFinite(valueUsdt) ? valueUsdt : 0,
  };
}

function sanitizeEntry(keyId: string, raw: unknown): CachedExchangeSyncEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Partial<CachedExchangeSyncEntry>;
  if (obj.exchange !== 'binance' && obj.exchange !== 'bybit' && obj.exchange !== 'okx') {
    return null;
  }
  const assets = Array.isArray(obj.assets)
    ? obj.assets
        .map(sanitizeAsset)
        .filter((a): a is ExchangeAssetBalance => a !== null)
        .slice(0, MAX_CACHED_ASSETS)
    : [];
  const totalBalanceUsdt = Number(obj.totalBalanceUsdt);
  const cachedAtMs = Number(obj.cachedAtMs);

  return {
    keyId,
    exchange: obj.exchange,
    label: typeof obj.label === 'string' ? obj.label.slice(0, 64) : obj.exchange.toUpperCase(),
    totalBalanceUsdt: Number.isFinite(totalBalanceUsdt) ? totalBalanceUsdt : 0,
    assets,
    syncedAt: typeof obj.syncedAt === 'string' ? obj.syncedAt.slice(0, 64) : '',
    accountType: typeof obj.accountType === 'string' ? obj.accountType.slice(0, 40) : undefined,
    testnet: Boolean(obj.testnet),
    cachedAtMs: Number.isFinite(cachedAtMs) ? cachedAtMs : Date.now(),
  };
}

export function readExchangeSyncCache(uid: string | null | undefined): ExchangeSyncCacheMap {
  if (!uid || typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(getStorageKey(uid));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const result: ExchangeSyncCacheMap = {};
    for (const [keyId, val] of Object.entries(parsed)) {
      const clean = sanitizeEntry(keyId, val);
      if (clean) {
        result[keyId] = clean;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function persistExchangeSyncCache(uid: string, map: ExchangeSyncCacheMap): void {
  if (!uid || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(getStorageKey(uid), JSON.stringify(map));
  } catch {
    // Ignore storage quota / private-mode write errors
  }
}

export function buildCachedExchangeSyncEntry(params: {
  keyId: string;
  label: string;
  testnet: boolean;
  sync: ExchangeSyncResult;
}): CachedExchangeSyncEntry {
  return {
    keyId: params.keyId,
    exchange: params.sync.exchange,
    label: params.label.slice(0, 64),
    totalBalanceUsdt: Math.max(0, Number(params.sync.totalBalanceUsdt) || 0),
    assets: params.sync.assets.slice(0, MAX_CACHED_ASSETS),
    syncedAt: params.sync.syncedAt.slice(0, 64),
    accountType: params.sync.accountType?.slice(0, 40),
    testnet: Boolean(params.testnet),
    cachedAtMs: Date.now(),
  };
}

export function writeExchangeSyncCacheEntry(
  uid: string,
  entry: CachedExchangeSyncEntry
): ExchangeSyncCacheMap {
  const current = readExchangeSyncCache(uid);
  const next: ExchangeSyncCacheMap = {
    ...current,
    [entry.keyId]: entry,
  };
  persistExchangeSyncCache(uid, next);
  return next;
}

export function removeExchangeSyncCacheEntry(uid: string, keyId: string): ExchangeSyncCacheMap {
  const current = readExchangeSyncCache(uid);
  if (!(keyId in current)) return current;
  const next = { ...current };
  delete next[keyId];
  persistExchangeSyncCache(uid, next);
  return next;
}

export function pruneExchangeSyncCache(uid: string, validKeyIds: string[]): ExchangeSyncCacheMap {
  const validSet = new Set(validKeyIds);
  const current = readExchangeSyncCache(uid);
  let changed = false;
  const next: ExchangeSyncCacheMap = {};
  for (const [id, entry] of Object.entries(current)) {
    if (validSet.has(id)) {
      next[id] = entry;
    } else {
      changed = true;
    }
  }
  if (changed) {
    persistExchangeSyncCache(uid, next);
  }
  return changed ? next : current;
}
