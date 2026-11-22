import fs from 'fs';
import { serverLogger } from './logger.ts';
import path from 'path';
import { applicationDefault, cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore';

/**
 * Авторитетный серверный модуль учёта тарифов, квот и списания AI-кредитов VERNIER.
 *
 * Правила безопасности:
 *  - Клиент не может самостоятельно изменять creditsRemaining, weeklyQuota, nextResetAt, plan, proUntil.
 *  - Все стоимости операций, лимиты кредитного плеча и размеры квот заданы в неизменяемых серверных таблицах.
 *  - Списание выполняется атомарно (Firestore Transaction при наличии Admin SDK и per-UID mutex в памяти процесса).
 */

export type PlanTier = 'free' | 'pro' | 'max';

export type BillableAction =
  | 'ai_analysis'
  | 'ai_assistant'
  | 'sentiment_pro'
  | 'pnl_backtest'
  | 'strategy_scan';

export const IMMUTABLE_CREDIT_COSTS: Readonly<Record<BillableAction, number>> = Object.freeze({
  ai_analysis: 1,
  ai_assistant: 1,
  sentiment_pro: 0,
  pnl_backtest: 0,
  strategy_scan: 1,
});

export const IMMUTABLE_WEEKLY_QUOTAS = Object.freeze({
  free: 25,
  pro: 100,
  max10: 1000,
  max20: 2000,
} as const);

export const IMMUTABLE_MAX_LEVERAGE: Readonly<Record<PlanTier, number>> = Object.freeze({
  free: 3,
  pro: 20,
  max: 50,
});

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

export function parseTimestampMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d+$/.test(trimmed)) {
      const num = Number(trimmed);
      return Number.isFinite(num) && num > 0 ? num : null;
    }
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  if (value && typeof value === 'object' && 'toMillis' in value && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    const ms = (value as { toMillis: () => number }).toMillis();
    return Number.isFinite(ms) && ms > 0 ? ms : null;
  }
  return null;
}

export interface EntitlementSnapshot {
  uid: string;
  plan: PlanTier;
  proUntil: number;
  maxMultiplier?: 10 | 20;
  creditsRemaining: number;
  weeklyQuota: number;
  nextResetAt: number;
  maxLeverage: number;
  source: 'firestore_admin' | 'server_memory';
}

export class EntitlementError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, statusCode = 403, code = 'ENTITLEMENT_DENIED') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

let cachedAdminDb: Firestore | null | undefined;

export function getAdminDb(): Firestore | null {
  if (cachedAdminDb !== undefined) return cachedAdminDb;
  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (!fs.existsSync(configPath)) {
      cachedAdminDb = null;
      return null;
    }
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
      projectId: string;
      firestoreDatabaseId?: string;
    };

    let app: App | undefined = getApps()[0];
    if (!app) {
      const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
      if (rawJson) {
        const decoded = rawJson.trim().startsWith('{')
          ? rawJson
          : Buffer.from(rawJson, 'base64').toString('utf8');
        app = initializeApp({ credential: cert(JSON.parse(decoded)), projectId: config.projectId });
      } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        app = initializeApp({ credential: applicationDefault(), projectId: config.projectId });
      } else {
        cachedAdminDb = null;
        return null;
      }
    }
    cachedAdminDb = config.firestoreDatabaseId
      ? getFirestore(app, config.firestoreDatabaseId)
      : getFirestore(app);
  } catch (err) {
    serverLogger.warn(
      'entitlements',
      'Admin SDK недоступен:',
      err instanceof Error ? err.message : 'unknown'
    );
    cachedAdminDb = null;
  }
  return cachedAdminDb;
}

function assertDevFallbackAllowed(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new EntitlementError(
      'Сервер учёта тарифов и квот временно недоступен (Firebase Admin SDK не сконфигурирован в production).',
      503,
      'ENTITLEMENTS_UNAVAILABLE',
    );
  }
}

// ---------- Per-UID mutex (защита от race condition / double spend) ----------

const uidLocks = new Map<string, Promise<unknown>>();

async function withUidLock<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  const prev = uidLocks.get(uid) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = prev.then(() => next);
  uidLocks.set(uid, chained);

  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (uidLocks.get(uid) === chained) {
      uidLocks.delete(uid);
    }
  }
}

// ---------- Fallback server ledger (строго для dev/preview, в production блокируется 503) ----------

const MAX_MEMORY_LEDGER_SIZE = 5_000;
const memoryLedger = new Map<string, EntitlementSnapshot>();

function setMemoryLedgerEntry(uid: string, snapshot: EntitlementSnapshot): void {
  if (!memoryLedger.has(uid) && memoryLedger.size >= MAX_MEMORY_LEDGER_SIZE) {
    const oldestUid = memoryLedger.keys().next().value;
    if (oldestUid) memoryLedger.delete(oldestUid);
  }
  memoryLedger.set(uid, snapshot);
}

function getOrCreateMemoryEntry(uid: string): EntitlementSnapshot {
  const now = Date.now();
  const existing = memoryLedger.get(uid);
  if (existing) {
    if (existing.plan === 'free' && existing.nextResetAt <= now) {
      existing.creditsRemaining = IMMUTABLE_WEEKLY_QUOTAS.free;
      existing.weeklyQuota = IMMUTABLE_WEEKLY_QUOTAS.free;
      existing.nextResetAt = now + WEEK_MS;
    } else if ((existing.plan === 'pro' || existing.plan === 'max') && existing.proUntil > now && existing.nextResetAt <= now) {
      const paidQuota =
        existing.plan === 'pro'
          ? IMMUTABLE_WEEKLY_QUOTAS.pro
          : existing.maxMultiplier === 20
            ? IMMUTABLE_WEEKLY_QUOTAS.max20
            : IMMUTABLE_WEEKLY_QUOTAS.max10;
      existing.creditsRemaining = paidQuota;
      existing.weeklyQuota = paidQuota;
      existing.nextResetAt = Math.min(existing.proUntil, now + MONTH_MS);
    }
    return { ...existing };
  }
  const fresh: EntitlementSnapshot = {
    uid,
    plan: 'free',
    proUntil: 0,
    creditsRemaining: IMMUTABLE_WEEKLY_QUOTAS.free,
    weeklyQuota: IMMUTABLE_WEEKLY_QUOTAS.free,
    nextResetAt: now + WEEK_MS,
    maxLeverage: IMMUTABLE_MAX_LEVERAGE.free,
    source: 'server_memory',
  };
  setMemoryLedgerEntry(uid, fresh);
  return { ...fresh };
}

export function normalizeFirestoreState(
  uid: string,
  data: Record<string, unknown>,
  now: number,
): {
  snapshot: EntitlementSnapshot;
  patch: Record<string, unknown> | null;
} {
  const rawPlan = data.plan === 'pro' || data.plan === 'max' ? data.plan : 'free';
  const proUntil = parseTimestampMs(data.proUntil) ?? 0;
  const maxMultiplier: 10 | 20 = Number(data.maxMultiplier) === 20 ? 20 : 10;
  let plan: PlanTier = rawPlan;
  let creditsRemaining = Number.isFinite(Number(data.creditsRemaining))
    ? Math.max(0, Math.floor(Number(data.creditsRemaining)))
    : IMMUTABLE_WEEKLY_QUOTAS.free;
  let weeklyQuota = Number.isFinite(Number(data.weeklyQuota))
    ? Math.max(1, Math.floor(Number(data.weeklyQuota)))
    : IMMUTABLE_WEEKLY_QUOTAS.free;
  const parsedNextReset = parseTimestampMs(data.nextResetAt);
  let nextResetAt = parsedNextReset ?? now + (plan === 'free' ? WEEK_MS : MONTH_MS);

  const patch: Record<string, unknown> = {};

  // Проверка истечения оплаченной подписки
  if ((plan === 'pro' || plan === 'max') && proUntil <= now) {
    plan = 'free';
    weeklyQuota = IMMUTABLE_WEEKLY_QUOTAS.free;
    creditsRemaining = Math.min(IMMUTABLE_WEEKLY_QUOTAS.free, creditsRemaining);
    nextResetAt = now + WEEK_MS;
    patch.plan = 'free';
    patch.weeklyQuota = weeklyQuota;
    patch.creditsRemaining = creditsRemaining;
    patch.nextResetAt = new Date(nextResetAt).toISOString();
  }

  // Еженедельное обновление квоты Free (7 дней) и миграция старых квот (10/15 -> 25)
  if (plan === 'free') {
    if (weeklyQuota < IMMUTABLE_WEEKLY_QUOTAS.free) {
      weeklyQuota = IMMUTABLE_WEEKLY_QUOTAS.free;
      creditsRemaining = Math.max(creditsRemaining, IMMUTABLE_WEEKLY_QUOTAS.free);
      patch.weeklyQuota = weeklyQuota;
      patch.creditsRemaining = creditsRemaining;
    }
    if (nextResetAt <= now) {
      nextResetAt = now + WEEK_MS;
      creditsRemaining = IMMUTABLE_WEEKLY_QUOTAS.free;
      weeklyQuota = IMMUTABLE_WEEKLY_QUOTAS.free;
      patch.creditsRemaining = creditsRemaining;
      patch.weeklyQuota = weeklyQuota;
      // Пишем в ISO-строке, чтобы соответствовать схеме firestore.rules (nextResetAt is string)
      patch.nextResetAt = new Date(nextResetAt).toISOString();
    } else if (parsedNextReset === null) {
      patch.nextResetAt = new Date(nextResetAt).toISOString();
    }
  } else {
    // Ежемесячное обновление квоты PRO / MAX (каждые 30 дней, включая годовые подписки)
    const expectedPaidQuota =
      plan === 'pro'
        ? IMMUTABLE_WEEKLY_QUOTAS.pro
        : maxMultiplier === 20
          ? IMMUTABLE_WEEKLY_QUOTAS.max20
          : IMMUTABLE_WEEKLY_QUOTAS.max10;
    if (weeklyQuota !== expectedPaidQuota) {
      weeklyQuota = expectedPaidQuota;
      patch.weeklyQuota = weeklyQuota;
    }
    if (nextResetAt <= now) {
      nextResetAt = Math.min(proUntil, now + MONTH_MS);
      creditsRemaining = expectedPaidQuota;
      patch.creditsRemaining = creditsRemaining;
      patch.weeklyQuota = expectedPaidQuota;
      patch.nextResetAt = new Date(nextResetAt).toISOString();
    } else if (parsedNextReset === null) {
      nextResetAt = Math.min(proUntil, now + MONTH_MS);
      patch.nextResetAt = new Date(nextResetAt).toISOString();
    }
  }

  const snapshot: EntitlementSnapshot = {
    uid,
    plan,
    proUntil,
    ...(plan === 'max' ? { maxMultiplier } : {}),
    creditsRemaining,
    weeklyQuota,
    nextResetAt,
    maxLeverage: IMMUTABLE_MAX_LEVERAGE[plan],
    source: 'firestore_admin',
  };

  return {
    snapshot,
    patch: Object.keys(patch).length > 0 ? patch : null,
  };
}

export async function getUserEntitlements(uid: string): Promise<EntitlementSnapshot> {
  return withUidLock(uid, async () => {
    const db = getAdminDb();
    const now = Date.now();
    if (!db) {
      assertDevFallbackAllowed();
      return getOrCreateMemoryEntry(uid);
    }

    const userRef = db.collection('users').doc(uid);
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists) {
        return getOrCreateMemoryEntry(uid);
      }
      const { snapshot, patch } = normalizeFirestoreState(
        uid,
        (snap.data() || {}) as Record<string, unknown>,
        now,
      );
      if (patch) {
        tx.update(userRef, { ...patch, updatedAt: FieldValue.serverTimestamp() });
      }
      setMemoryLedgerEntry(uid, snapshot);
      return snapshot;
    });
  });
}

export async function consumeUserCredits(
  uid: string,
  action: BillableAction,
): Promise<{ snapshot: EntitlementSnapshot; deducted: number }> {
  const cost = IMMUTABLE_CREDIT_COSTS[action];
  if (typeof cost !== 'number' || cost < 0) {
    throw new EntitlementError('Неизвестный тип тарифицируемой операции.', 400, 'INVALID_ACTION');
  }

  return withUidLock(uid, async () => {
    const db = getAdminDb();
    const now = Date.now();

    if (!db) {
      assertDevFallbackAllowed();
      const entry = getOrCreateMemoryEntry(uid);
      if (cost > 0 && entry.creditsRemaining < cost) {
        throw new EntitlementError(
          `Недостаточно AI-кредитов (требуется ${cost}, доступно ${entry.creditsRemaining}).`,
          402,
          'INSUFFICIENT_CREDITS',
        );
      }
      const updated: EntitlementSnapshot = {
        ...entry,
        creditsRemaining: Math.max(0, entry.creditsRemaining - cost),
      };
      setMemoryLedgerEntry(uid, updated);
      return { snapshot: updated, deducted: cost };
    }

    const userRef = db.collection('users').doc(uid);
    const updatedSnapshot = await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists) {
        const mem = getOrCreateMemoryEntry(uid);
        if (cost > 0 && mem.creditsRemaining < cost) {
          throw new EntitlementError(
            `Недостаточно AI-кредитов (требуется ${cost}, доступно ${mem.creditsRemaining}).`,
            402,
            'INSUFFICIENT_CREDITS',
          );
        }
        const nextMem = { ...mem, creditsRemaining: Math.max(0, mem.creditsRemaining - cost) };
        setMemoryLedgerEntry(uid, nextMem);
        return nextMem;
      }

      const { snapshot, patch } = normalizeFirestoreState(
        uid,
        (snap.data() || {}) as Record<string, unknown>,
        now,
      );

      if (cost > 0 && snapshot.creditsRemaining < cost) {
        throw new EntitlementError(
          `Недостаточно AI-кредитов (требуется ${cost}, доступно ${snapshot.creditsRemaining}). Обновите тариф или дождитесь сброса квоты.`,
          402,
          'INSUFFICIENT_CREDITS',
        );
      }

      const nextCredits = Math.max(0, snapshot.creditsRemaining - cost);
      const updatePayload: Record<string, unknown> = {
        ...(patch || {}),
        creditsRemaining: nextCredits,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (cost > 0 || patch) {
        tx.update(userRef, updatePayload);
      }
      const finalSnap: EntitlementSnapshot = {
        ...snapshot,
        creditsRemaining: nextCredits,
      };
      setMemoryLedgerEntry(uid, finalSnap);
      return finalSnap;
    });

    return { snapshot: updatedSnapshot, deducted: cost };
  });
}

/**
 * Автоматический возврат списанных кредитов при сбое внешнего API (биржа / Gemini)
 * после предварительного списания. Не превышает максимальную квоту тарифа.
 */
export async function refundUserCredits(
  uid: string,
  action: BillableAction,
): Promise<EntitlementSnapshot | null> {
  const refundAmount = IMMUTABLE_CREDIT_COSTS[action];
  if (typeof refundAmount !== 'number' || refundAmount <= 0) return null;

  return withUidLock(uid, async () => {
    const db = getAdminDb();
    const now = Date.now();

    if (!db) {
      if (process.env.NODE_ENV === 'production') return null;
      const entry = getOrCreateMemoryEntry(uid);
      const restored: EntitlementSnapshot = {
        ...entry,
        creditsRemaining: Math.min(entry.weeklyQuota, entry.creditsRemaining + refundAmount),
      };
      setMemoryLedgerEntry(uid, restored);
      return restored;
    }

    const userRef = db.collection('users').doc(uid);
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists) return null;
      const { snapshot, patch } = normalizeFirestoreState(
        uid,
        (snap.data() || {}) as Record<string, unknown>,
        now,
      );
      const nextCredits = Math.min(snapshot.weeklyQuota, snapshot.creditsRemaining + refundAmount);
      tx.update(userRef, {
        ...(patch || {}),
        creditsRemaining: nextCredits,
        updatedAt: FieldValue.serverTimestamp(),
      });
      const finalSnap: EntitlementSnapshot = {
        ...snapshot,
        creditsRemaining: nextCredits,
      };
      setMemoryLedgerEntry(uid, finalSnap);
      return finalSnap;
    });
  });
}

const TIER_RANK: Record<PlanTier, number> = { free: 0, pro: 1, max: 2 };

export function isPlanAtLeast(actual: PlanTier, required: PlanTier): boolean {
  return TIER_RANK[actual] >= TIER_RANK[required];
}

/**
 * Авторитетное определение тарифа на сервере: исключительно из верифицированного UID и базы данных.
 * Клиентские флаги demoTier полностью удалены из серверной логики (исключает обход paywall).
 */
export async function resolveAuthoritativePlan(uid: string | undefined): Promise<PlanTier> {
  if (!uid) {
    return 'free';
  }
  try {
    const entitlements = await getUserEntitlements(uid);
    return entitlements.plan;
  } catch {
    return 'free';
  }
}

export function isValidBillableAction(value: unknown): value is BillableAction {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(IMMUTABLE_CREDIT_COSTS, value)
  );
}
