import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import {
  pruneExchangeSyncLogsOlderThan,
  sanitizeTechnicalDetails,
  sanitizeTechnicalString,
  SYNC_LOG_AUTO_CLEANUP_DAYS,
  type ExchangeSyncErrorCategory,
  type ExchangeSyncErrorLogEntry,
  type ExchangeSyncSeverity,
} from './exchangeSyncErrorLog';
import type { ExchangeId } from '../types/domain';

export const MAX_CLOUD_SYNC_LOGS = 60;
const SHORT_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export interface CloudSyncLogDocument {
  id: string;
  userId: string;
  keyId: string;
  exchange: ExchangeId;
  label: string;
  testnet: boolean;
  severity: ExchangeSyncSeverity;
  category: ExchangeSyncErrorCategory;
  errorMessage: string;
  occurredAt: string;
  occurredAtMs: number;
  source: 'background' | 'manual';
  balanceUsdt: number;
  assetsCount: number;
  httpStatus: number;
  endpoint: string;
  rawApiResponse: string;
  stackTrace: string;
}

export function sanitizeCloudLogId(rawId: string, fallbackMs: number): string {
  const cleaned = rawId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  if (SHORT_ID_RE.test(cleaned)) return cleaned;
  return `synclog_${Math.max(1, Math.floor(fallbackMs))}`;
}

export function serializeSyncLogForFirestore(
  uid: string,
  entry: ExchangeSyncErrorLogEntry
): CloudSyncLogDocument {
  const safeMs =
    Number.isFinite(entry.occurredAtMs) && entry.occurredAtMs > 0
      ? Math.floor(entry.occurredAtMs)
      : Date.now();
  const safeId = sanitizeCloudLogId(entry.id, safeMs);
  const tech = sanitizeTechnicalDetails(entry.technicalDetails);
  const safeMessage =
    sanitizeTechnicalString(entry.errorMessage, 300) ??
    entry.errorMessage.trim().slice(0, 300) ??
    'Событие синхронизации';

  return {
    id: safeId,
    userId: uid,
    keyId: (entry.keyId || '').slice(0, 80),
    exchange: entry.exchange,
    label: (entry.label || entry.exchange.toUpperCase()).trim().slice(0, 64) || entry.exchange.toUpperCase(),
    testnet: Boolean(entry.testnet),
    severity: entry.severity,
    category: entry.category,
    errorMessage: safeMessage.slice(0, 300) || 'Событие синхронизации',
    occurredAt: (entry.occurredAt || new Date(safeMs).toISOString()).slice(0, 64),
    occurredAtMs: safeMs,
    source: entry.source === 'manual' ? 'manual' : 'background',
    balanceUsdt:
      typeof entry.balanceUsdt === 'number' && Number.isFinite(entry.balanceUsdt) && entry.balanceUsdt >= 0
        ? Math.min(1_000_000_000, entry.balanceUsdt)
        : 0,
    assetsCount:
      typeof entry.assetsCount === 'number' && Number.isFinite(entry.assetsCount) && entry.assetsCount >= 0
        ? Math.min(10_000, Math.floor(entry.assetsCount))
        : 0,
    httpStatus:
      typeof tech?.httpStatus === 'number' && tech.httpStatus >= 100 && tech.httpStatus <= 599
        ? tech.httpStatus
        : 0,
    endpoint: (tech?.endpoint ?? '').slice(0, 240),
    rawApiResponse: (tech?.rawApiResponse ?? '').slice(0, 1600),
    stackTrace: (tech?.stackTrace ?? '').slice(0, 1600),
  };
}

export function deserializeCloudSyncLogDoc(raw: unknown): ExchangeSyncErrorLogEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Partial<CloudSyncLogDocument>;
  if (d.exchange !== 'binance' && d.exchange !== 'bybit' && d.exchange !== 'okx') {
    return null;
  }
  if (typeof d.errorMessage !== 'string' || !d.errorMessage.trim()) {
    return null;
  }
  const occurredAtMs = Number(d.occurredAtMs);
  if (!Number.isFinite(occurredAtMs) || occurredAtMs <= 0) return null;

  const severity: ExchangeSyncSeverity =
    d.severity === 'success' || d.severity === 'warning' || d.severity === 'critical'
      ? d.severity
      : 'warning';
  const category: ExchangeSyncErrorCategory =
    d.category === 'success' ||
    d.category === 'rate_limit' ||
    d.category === 'auth' ||
    d.category === 'network' ||
    d.category === 'exchange_api' ||
    d.category === 'unknown'
      ? d.category
      : 'unknown';

  const technicalDetails = sanitizeTechnicalDetails({
    httpStatus: typeof d.httpStatus === 'number' && d.httpStatus >= 100 ? d.httpStatus : undefined,
    endpoint: typeof d.endpoint === 'string' && d.endpoint ? d.endpoint : undefined,
    rawApiResponse: typeof d.rawApiResponse === 'string' && d.rawApiResponse ? d.rawApiResponse : undefined,
    stackTrace: typeof d.stackTrace === 'string' && d.stackTrace ? d.stackTrace : undefined,
  });

  return {
    id: sanitizeCloudLogId(typeof d.id === 'string' ? d.id : '', occurredAtMs),
    keyId: typeof d.keyId === 'string' ? d.keyId.slice(0, 80) : '',
    exchange: d.exchange,
    label:
      typeof d.label === 'string' && d.label.trim()
        ? d.label.slice(0, 64)
        : d.exchange.toUpperCase(),
    testnet: Boolean(d.testnet),
    severity,
    category,
    errorMessage: d.errorMessage.slice(0, 300),
    balanceUsdt:
      typeof d.balanceUsdt === 'number' && Number.isFinite(d.balanceUsdt) && d.balanceUsdt > 0
        ? d.balanceUsdt
        : undefined,
    assetsCount:
      typeof d.assetsCount === 'number' && Number.isFinite(d.assetsCount) && d.assetsCount > 0
        ? Math.floor(d.assetsCount)
        : undefined,
    occurredAt:
      typeof d.occurredAt === 'string' && d.occurredAt.trim()
        ? d.occurredAt.slice(0, 64)
        : new Date(occurredAtMs).toISOString(),
    occurredAtMs: Math.floor(occurredAtMs),
    source: d.source === 'manual' ? 'manual' : 'background',
    ...(technicalDetails ? { technicalDetails } : {}),
  };
}

/**
 * Чистое слияние локальных и облачных логов синхронизации (PRO/MAX):
 * дедупликация по ID, сортировка от новых к старым, ограничение до maxLogs
 * и опциональная авто-очистка записей старше 30 дней.
 */
export function mergeLocalAndCloudSyncLogs(
  localLogs: ExchangeSyncErrorLogEntry[],
  cloudLogs: ExchangeSyncErrorLogEntry[],
  options?: {
    maxLogs?: number;
    autoCleanup30d?: boolean;
    nowMs?: number;
  }
): {
  merged: ExchangeSyncErrorLogEntry[];
  localOnlyToPush: ExchangeSyncErrorLogEntry[];
} {
  const maxLogs = Math.max(1, Math.min(200, options?.maxLogs ?? MAX_CLOUD_SYNC_LOGS));
  const nowMs = options?.nowMs ?? Date.now();
  const autoCleanup30d = options?.autoCleanup30d ?? true;

  const cloudIds = new Set(cloudLogs.map((e) => e.id));
  const byId = new Map<string, ExchangeSyncErrorLogEntry>();

  for (const entry of cloudLogs) {
    byId.set(entry.id, entry);
  }
  for (const entry of localLogs) {
    const existing = byId.get(entry.id);
    if (!existing || entry.occurredAtMs >= existing.occurredAtMs) {
      byId.set(entry.id, entry);
    }
  }

  let combined = Array.from(byId.values()).sort((a, b) => b.occurredAtMs - a.occurredAtMs);
  if (autoCleanup30d) {
    combined = pruneExchangeSyncLogsOlderThan(combined, SYNC_LOG_AUTO_CLEANUP_DAYS, nowMs).logs;
  }
  const merged = combined.slice(0, maxLogs);
  const localOnlyToPush = merged.filter((entry) => !cloudIds.has(entry.id)).slice(0, 15);

  return { merged, localOnlyToPush };
}

/**
 * Фоновая загрузка облачной истории логов ошибок синхронизации из Firestore (только PRO/MAX).
 */
export async function pullCloudExchangeSyncLogs(
  uid: string
): Promise<{ logs: ExchangeSyncErrorLogEntry[]; ok: boolean }> {
  if (!uid) return { logs: [], ok: false };
  try {
    const { db } = await import('./firebase');
    const q = query(
      collection(db, 'users', uid, 'syncErrorLogs'),
      where('userId', '==', uid),
      limit(MAX_CLOUD_SYNC_LOGS)
    );
    const snap = await getDocs(q);
    const logs = snap.docs
      .map((docSnap) => deserializeCloudSyncLogDoc(docSnap.data()))
      .filter((item): item is ExchangeSyncErrorLogEntry => item !== null)
      .sort((a, b) => b.occurredAtMs - a.occurredAtMs);
    return { logs, ok: true };
  } catch {
    return { logs: [], ok: false };
  }
}

/**
 * Неблокирующая запись нового события синхронизации в Firestore для PRO/MAX пользователей.
 */
export async function pushExchangeSyncLogToCloud(
  uid: string,
  entry: ExchangeSyncErrorLogEntry
): Promise<boolean> {
  if (!uid) return false;
  try {
    const { db } = await import('./firebase');
    const payload = serializeSyncLogForFirestore(uid, entry);
    const ref = doc(db, 'users', uid, 'syncErrorLogs', payload.id);
    await setDoc(ref, {
      ...payload,
      createdAt: serverTimestamp(),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Фоновая очистка облачной истории логов ошибок в Firestore при ручном сбросе пользователем.
 */
export async function clearCloudExchangeSyncLogs(uid: string): Promise<number> {
  if (!uid) return 0;
  try {
    const { db } = await import('./firebase');
    const q = query(
      collection(db, 'users', uid, 'syncErrorLogs'),
      where('userId', '==', uid),
      limit(100)
    );
    const snap = await getDocs(q);
    await Promise.allSettled(snap.docs.map((d) => deleteDoc(d.ref)));
    return snap.docs.length;
  } catch {
    return 0;
  }
}
