import type { PlanTier, PriceAlertRecord, TradeJournalEntry } from '../types/domain';
import { clearDecryptedSecretsFromMemory } from './securityDlp';

export type ThemeMode = 'emerald' | 'oled';

export interface DemoPlanOverride {
  tier: PlanTier;
  maxMultiplier: 10 | 20;
}

export interface DemoStrategyOverride {
  enabled: boolean;
  dailySignalLimit: number;
  minConfidence: number;
  riskPerTradePct: number;
  leverage: number;
  pairs: string[];
  updatedAt: string;
}

export interface LegalConsentRecord {
  acceptedAt: string;
  version: string;
  isAdult: boolean;
  acceptedTerms: boolean;
  acceptedAiProcessing: boolean;
  acceptedDisclaimer: boolean;
}

export interface LocalReadOnlyExchangeKey {
  id: string;
  exchange: 'binance' | 'bybit' | 'okx';
  label: string;
  maskedKey: string;
  encryptedPayload: string;
  readOnlyVerified: true;
  createdAt: string;
}

export const LEGAL_CONSENT_VERSION = '2026.05-UA-GP';

export const STORAGE_KEYS = {
  theme: 'vernier_theme_mode_v1',
  privacyMode: 'vernier_privacy_mode_v1',
  pinHash: 'vernier_pin_hash_v1',
  pinSalt: 'vernier_pin_salt_v2',
  pinTimeoutMin: 'vernier_pin_timeout_min_v1',
  antiPhishing: 'vernier_anti_phishing_v1',
  demoPlan: 'vernier_demo_plan_override_v1',
  demoStrategyOverrides: 'vernier_demo_strategy_overrides_v1',
  legalConsent: 'vernier_legal_consent_v1',
  localTrades: 'vernier_local_trades_v1',
  localAlerts: 'vernier_local_alerts_v1',
  localReadOnlyKeys: 'vernier_local_ro_keys_v1',
  aiReports: 'vernier_ai_reports_v1',
  oauthCsrfState: 'vernier_oauth_csrf_state_v1',
} as const;

export const VERNIER_TRADES_EVENT = 'vernier:trades-updated';

function safeGet<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeSet(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    if (value === null || value === undefined) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, JSON.stringify(value));
    }
  } catch {
    // Игнорируем переполнение хранилища
  }
}

export function getThemeMode(): ThemeMode {
  const val = safeGet<string>(STORAGE_KEYS.theme, 'emerald');
  return val === 'oled' ? 'oled' : 'emerald';
}

export function setThemeMode(mode: ThemeMode): void {
  safeSet(STORAGE_KEYS.theme, mode);
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', mode);
  }
}

export function getPrivacyMode(): boolean {
  return safeGet<boolean>(STORAGE_KEYS.privacyMode, false);
}

export function setPrivacyMode(enabled: boolean): void {
  safeSet(STORAGE_KEYS.privacyMode, enabled);
}

export function getPinHash(): string | null {
  return safeGet<string | null>(STORAGE_KEYS.pinHash, null);
}

export function setPinHash(hash: string | null): void {
  safeSet(STORAGE_KEYS.pinHash, hash);
  if (!hash) {
    safeSet(STORAGE_KEYS.pinSalt, null);
  }
}

export function getPinSalt(): string | null {
  return safeGet<string | null>(STORAGE_KEYS.pinSalt, null);
}

export function setPinSalt(salt: string | null): void {
  safeSet(STORAGE_KEYS.pinSalt, salt);
}

export function getPinTimeoutMinutes(): 0 | 1 | 5 | 15 {
  const val = safeGet<number>(STORAGE_KEYS.pinTimeoutMin, 5);
  if (val === 0 || val === 1 || val === 5 || val === 15) return val;
  return 5;
}

export function setPinTimeoutMinutes(mins: 0 | 1 | 5 | 15): void {
  safeSet(STORAGE_KEYS.pinTimeoutMin, mins);
}

export function getAntiPhishingCode(): string {
  return safeGet<string>(STORAGE_KEYS.antiPhishing, '');
}

export function setAntiPhishingCode(code: string): void {
  safeSet(STORAGE_KEYS.antiPhishing, code.trim().slice(0, 24));
}

/**
 * Demo Tier Switcher строго изолирован в DEV-сборке (`import.meta.env.DEV`).
 * В production всегда возвращает null и игнорирует любые попытки записи.
 */
export function getDemoPlanOverride(): DemoPlanOverride | null {
  if (!import.meta.env.DEV) return null;
  const val = safeGet<DemoPlanOverride | null>(STORAGE_KEYS.demoPlan, null);
  if (!val || (val.tier !== 'free' && val.tier !== 'pro' && val.tier !== 'max')) return null;
  return {
    tier: val.tier,
    maxMultiplier: val.maxMultiplier === 20 ? 20 : 10,
  };
}

export function setDemoPlanOverride(override: DemoPlanOverride | null): void {
  if (!import.meta.env.DEV) {
    safeSet(STORAGE_KEYS.demoPlan, null);
    return;
  }
  safeSet(STORAGE_KEYS.demoPlan, override);
}

export function readDemoStrategyOverrides(): Record<string, DemoStrategyOverride> {
  const raw = safeGet<Record<string, DemoStrategyOverride> | null>(STORAGE_KEYS.demoStrategyOverrides, null);
  return raw && typeof raw === 'object' ? raw : {};
}

export function saveDemoStrategyOverride(
  strategyId: string,
  patch: Omit<DemoStrategyOverride, 'updatedAt'>
): Record<string, DemoStrategyOverride> {
  const current = readDemoStrategyOverrides();
  const next: Record<string, DemoStrategyOverride> = {
    ...current,
    [strategyId]: {
      ...patch,
      pairs: patch.pairs.length > 0 ? patch.pairs.slice(0, 10) : ['BTCUSDT'],
      updatedAt: new Date().toISOString(),
    },
  };
  safeSet(STORAGE_KEYS.demoStrategyOverrides, next);
  return next;
}

export function clearDemoStrategyOverrides(): void {
  safeSet(STORAGE_KEYS.demoStrategyOverrides, null);
}

export function getLegalConsent(): LegalConsentRecord | null {
  const rec = safeGet<LegalConsentRecord | null>(STORAGE_KEYS.legalConsent, null);
  if (
    !rec ||
    !rec.isAdult ||
    !rec.acceptedTerms ||
    !rec.acceptedAiProcessing ||
    !rec.acceptedDisclaimer
  ) {
    return null;
  }
  return rec;
}

export function saveLegalConsent(record: LegalConsentRecord): void {
  safeSet(STORAGE_KEYS.legalConsent, record);
}

export function revokeLegalConsent(): void {
  safeSet(STORAGE_KEYS.legalConsent, null);
}

const DEFAULT_DEMO_TRADES: TradeJournalEntry[] = [
  {
    id: 'demo-trade-1',
    uid: 'local-demo',
    symbol: 'BTCUSDT',
    marketType: 'spot',
    direction: 'LONG',
    status: 'CLOSED',
    entryPrice: 64200,
    exitPrice: 66850,
    stopLoss: 62900,
    takeProfit: 67200,
    positionSizeUsdt: 600,
    leverage: 1,
    pnlUsdt: 24.77,
    pnlPct: 4.13,
    strategyName: 'Пробой тренда + EMA',
    note: 'Закрепление выше EMA50 на 1H, подтверждённый объём.',
    openedAt: new Date(Date.now() - 48 * 3600_000).toISOString(),
    closedAt: new Date(Date.now() - 36 * 3600_000).toISOString(),
  },
  {
    id: 'demo-trade-2',
    uid: 'local-demo',
    symbol: 'ETHUSDT',
    marketType: 'futures',
    direction: 'SHORT',
    status: 'CLOSED',
    entryPrice: 3240,
    exitPrice: 3155,
    stopLoss: 3295,
    takeProfit: 3140,
    positionSizeUsdt: 500,
    leverage: 3,
    pnlUsdt: 39.35,
    pnlPct: 7.87,
    strategyName: 'RSI Дивергенция (PRO)',
    note: 'Медвежья дивергенция на 4H сопротивлении.',
    openedAt: new Date(Date.now() - 28 * 3600_000).toISOString(),
    closedAt: new Date(Date.now() - 20 * 3600_000).toISOString(),
  },
];

export function readLocalTrades(): TradeJournalEntry[] {
  const stored = safeGet<TradeJournalEntry[] | null>(STORAGE_KEYS.localTrades, null);
  if (stored === null) {
    safeSet(STORAGE_KEYS.localTrades, DEFAULT_DEMO_TRADES);
    return DEFAULT_DEMO_TRADES;
  }
  return Array.isArray(stored) ? stored : [];
}

export function writeLocalTrades(trades: TradeJournalEntry[]): void {
  safeSet(STORAGE_KEYS.localTrades, trades);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(VERNIER_TRADES_EVENT));
  }
}

export function addLocalTrade(entry: Omit<TradeJournalEntry, 'id' | 'uid' | 'openedAt'>): TradeJournalEntry {
  const current = readLocalTrades();
  const created: TradeJournalEntry = {
    ...entry,
    id: `loc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    uid: 'local-demo',
    openedAt: new Date().toISOString(),
  };
  writeLocalTrades([created, ...current]);
  return created;
}

export function updateLocalTrade(id: string, patch: Partial<TradeJournalEntry>): TradeJournalEntry[] {
  const next = readLocalTrades().map((t) => (t.id === id ? { ...t, ...patch } : t));
  writeLocalTrades(next);
  return next;
}

export function deleteLocalTrade(id: string): TradeJournalEntry[] {
  const next = readLocalTrades().filter((t) => t.id !== id);
  writeLocalTrades(next);
  return next;
}

/**
 * Проверка Анти-FOMO: зафиксировано ли 3 убыточные сделки подряд за последние 24 часа.
 */
export function hasThreeConsecutiveLosses24h(trades: TradeJournalEntry[]): boolean {
  const cutoffMs = Date.now() - 24 * 3600_000;
  const recentClosed = trades
    .filter((t) => {
      if (t.status !== 'CLOSED' || typeof t.pnlUsdt !== 'number') return false;
      const ts = Date.parse(t.closedAt || t.openedAt);
      return Number.isFinite(ts) && ts >= cutoffMs;
    })
    .sort((a, b) => Date.parse(b.closedAt || b.openedAt) - Date.parse(a.closedAt || a.openedAt));

  if (recentClosed.length < 3) return false;
  return (
    (recentClosed[0].pnlUsdt ?? 0) < 0 &&
    (recentClosed[1].pnlUsdt ?? 0) < 0 &&
    (recentClosed[2].pnlUsdt ?? 0) < 0
  );
}

export function readLocalPriceAlerts(): PriceAlertRecord[] {
  return safeGet<PriceAlertRecord[]>(STORAGE_KEYS.localAlerts, []);
}

export function writeLocalPriceAlerts(alerts: PriceAlertRecord[]): void {
  safeSet(STORAGE_KEYS.localAlerts, alerts);
}

export function readLocalReadOnlyKeys(): LocalReadOnlyExchangeKey[] {
  return safeGet<LocalReadOnlyExchangeKey[]>(STORAGE_KEYS.localReadOnlyKeys, []);
}

export function writeLocalReadOnlyKeys(keys: LocalReadOnlyExchangeKey[]): void {
  safeSet(STORAGE_KEYS.localReadOnlyKeys, keys);
}

export function saveAiReportTicket(report: {
  source: string;
  reason: string;
  comment: string;
  snippet?: string;
}): void {
  const prev = safeGet<Array<Record<string, unknown>>>(STORAGE_KEYS.aiReports, []);
  safeSet(STORAGE_KEYS.aiReports, [
    {
      id: `air-${Date.now()}`,
      createdAt: new Date().toISOString(),
      ...report,
    },
    ...prev.slice(0, 49),
  ]);
}

export function createOAuthCsrfState(): string {
  const bytes = new Uint8Array(16);
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(bytes);
  }
  const token = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  try {
    window.sessionStorage.setItem(STORAGE_KEYS.oauthCsrfState, token);
  } catch {
    // Ignore storage restriction
  }
  return token;
}

export function verifyOAuthCsrfState(expected: string): boolean {
  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEYS.oauthCsrfState);
    window.sessionStorage.removeItem(STORAGE_KEYS.oauthCsrfState);
    return Boolean(stored && stored === expected);
  } catch {
    return true;
  }
}

export function exportAllUserDataJson(extra?: Record<string, unknown>): string {
  const payload = {
    exportedAt: new Date().toISOString(),
    app: 'VERNIER Terminal',
    legalConsent: getLegalConsent(),
    preferences: {
      theme: getThemeMode(),
      privacyMode: getPrivacyMode(),
      pinLockEnabled: Boolean(getPinHash()),
      pinTimeoutMinutes: getPinTimeoutMinutes(),
      antiPhishingConfigured: Boolean(getAntiPhishingCode()),
    },
    localTrades: readLocalTrades(),
    localPriceAlerts: readLocalPriceAlerts(),
    localReadOnlyKeysMeta: readLocalReadOnlyKeys().map((k) => ({
      id: k.id,
      exchange: k.exchange,
      label: k.label,
      maskedKey: k.maskedKey,
      readOnlyVerified: k.readOnlyVerified,
      createdAt: k.createdAt,
    })),
    ...(extra ?? {}),
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Полная очистка всех локальных данных (GDPR / Закон Украины № 2297-VI):
 * - Очистка оперативной памяти расшифрованных секретов
 * - localStorage и sessionStorage
 * - Всех баз IndexedDB (включая Firebase/Firestore кэш)
 * - Всех кэшей Service Worker (Cache Storage)
 */
export async function wipeAllLocalAppData(): Promise<void> {
  clearDecryptedSecretsFromMemory();
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.clear();
  } catch {
    // ignore
  }
  try {
    window.sessionStorage.clear();
  } catch {
    // ignore
  }

  // Полная очистка IndexedDB
  if (typeof indexedDB !== 'undefined') {
    const dbNames = new Set<string>([
      'firebaseLocalStorageDb',
      'firebase-heartbeat-database',
      'firebase-installations-database',
    ]);
    try {
      const idbWithList = indexedDB as IDBFactory & {
        databases?: () => Promise<Array<{ name?: string }>>;
      };
      if (typeof idbWithList.databases === 'function') {
        const list = await idbWithList.databases();
        for (const item of list) {
          if (item?.name) dbNames.add(item.name);
        }
      }
    } catch {
      // Fallback на базовый список
    }

    await Promise.all(
      Array.from(dbNames).map(
        (name) =>
          new Promise<void>((resolve) => {
            try {
              const req = indexedDB.deleteDatabase(name);
              req.onsuccess = () => resolve();
              req.onerror = () => resolve();
              req.onblocked = () => resolve();
            } catch {
              resolve();
            }
          })
      )
    );
  }

  // Полная очистка кэшей Service Worker
  if ('caches' in window) {
    try {
      const keys = await window.caches.keys();
      await Promise.all(keys.map((k) => window.caches.delete(k)));
    } catch {
      // ignore
    }
  }
}

const DEPRECATED_EXACT_KEYS = new Set<string>([
  // Устаревший небезопасный сырой AES-ключ до миграции на PBKDF2
  'vernier_vault_key_v1',
  'aegisquant_vault_key_v1',
  'aegisquant_local_aes_key',
  'aegisquant_demo_plan_v0',
  'aegis_news_cache_v0',
  'aegis_market_cache_v0',
  'vernier_news_cache_v0',
  'vernier_candles_cache_v0',
  'vernier_legacy_pin_v0',
]);

const DEPRECATED_KEY_PREFIXES = [
  'aegisquant_v0_',
  'aegis_old_',
  'aegis_legacy_',
  'vernier_legacy_',
  'vernier_tmp_',
];

/**
 * Очищает устаревшие ключи localStorage от прошлых версий приложения,
 * сохраняя footprint браузера компактным и удаляя устаревшие кэши.
 */
export function cleanupOldCache(): { removedKeys: string[]; freedBytes: number } {
  const removedKeys: string[] = [];
  let freedBytes = 0;
  if (typeof window === 'undefined') return { removedKeys, freedBytes };

  try {
    const keysToDelete: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key) continue;
      const isDeprecatedExact = DEPRECATED_EXACT_KEYS.has(key);
      const isDeprecatedPrefix = DEPRECATED_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
      if (isDeprecatedExact || isDeprecatedPrefix) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      const raw = window.localStorage.getItem(key);
      freedBytes += (key.length + (raw?.length ?? 0)) * 2;
      window.localStorage.removeItem(key);
      removedKeys.push(key);
    }
  } catch {
    // ignore storage access errors
  }

  return { removedKeys, freedBytes };
}

