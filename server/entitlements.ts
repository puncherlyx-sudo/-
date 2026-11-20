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

function getAdminDb(): Firestore | null {
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
      'Admin SDK недоступен, используется серверный ledger в памяти:',
      err instanceof Error ? err.message : 'unknown'
    );
    cachedAdminDb = null;
  }
  return cachedAdminDb;
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

// ---------- Fallback server ledger (когда Admin SDK не сконфигурирован в dev) ----------

const memoryLedger = new Map<string, EntitlementSnapshot>();

function getOrCreateMemoryEntry(uid: string): EntitlementSnapshot {
  const now = Date.now();
  const existing = memoryLedger.get(uid);
  if (existing) {
    if (existing.plan === 'free' && existing.nextResetAt <= now) {
      existing.creditsRemaining = IMMUTABLE_WEEKLY_QUOTAS.free;
      existing.weeklyQuota = IMMUTABLE_WEEKLY_QUOTAS.free;
      existing.nextResetAt = now + WEEK_MS;
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
  memoryLedger.set(uid, fresh);
  return { ...fresh };
}

function normalizeFirestoreState(
  uid: string,
  data: Record<string, unknown>,
  now: number,
): {
  snapshot: EntitlementSnapshot;
  patch: Record<string, unknown> | null;
} {
  const rawPlan = data.plan === 'pro' || data.plan === 'max' ? data.plan : 'free';
  const proUntil = Number(data.proUntil) || 0;
  const maxMultiplier: 10 | 20 = Number(data.maxMultiplier) === 20 ? 20 : 10;
  let plan: PlanTier = rawPlan;
  let creditsRemaining = Number.isFinite(Number(data.creditsRemaining))
    ? Math.max(0, Math.floor(Number(data.creditsRemaining)))
    : IMMUTABLE_WEEKLY_QUOTAS.free;
  let weeklyQuota = Number.isFinite(Number(data.weeklyQuota))
    ? Math.max(1, Math.floor(Number(data.weeklyQuota)))
    : IMMUTABLE_WEEKLY_QUOTAS.free;
  let nextResetAt = Number(data.nextResetAt) || now + WEEK_MS;

  const patch: Record<string, unknown> = {};

  // Проверка истечения оплаченной подписки
  if ((plan === 'pro' || plan === 'max') && proUntil <= now) {
    plan = 'free';
    weeklyQuota = IMMUTABLE_WEEKLY_QUOTAS.free;
    creditsRemaining = Math.min(IMMUTABLE_WEEKLY_QUOTAS.free, creditsRemaining);
    patch.plan = 'free';
    patch.weeklyQuota = weeklyQuota;
    patch.creditsRemaining = creditsRemaining;
  }

  // Еженедельное обновление квоты Free и миграция старых квот (10/15 -> 25)
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
      patch.nextResetAt = nextResetAt;
    }
  } else if (plan === 'pro') {
    weeklyQuota = IMMUTABLE_WEEKLY_QUOTAS.pro;
  } else if (plan === 'max') {
    weeklyQuota = maxMultiplier === 20 ? IMMUTABLE_WEEKLY_QUOTAS.max20 : IMMUTABLE_WEEKLY_QUOTAS.max10;
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
      memoryLedger.set(uid, snapshot);
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
      memoryLedger.set(uid, updated);
      return { snapshot: updated, deducted: cost };
    }

    const userRef = db.collection('users').doc(uid);
    const updatedSnapshot = await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists) {
        // Пользователь ещё не завершил первичный bootstrap — используем консервативный серверный учёт
        const mem = getOrCreateMemoryEntry(uid);
        if (cost > 0 && mem.creditsRemaining < cost) {
          throw new EntitlementError(
            `Недостаточно AI-кредитов (требуется ${cost}, доступно ${mem.creditsRemaining}).`,
            402,
            'INSUFFICIENT_CREDITS',
          );
        }
        const nextMem = { ...mem, creditsRemaining: Math.max(0, mem.creditsRemaining - cost) };
        memoryLedger.set(uid, nextMem);
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
      memoryLedger.set(uid, finalSnap);
      return finalSnap;
    });

    return { snapshot: updatedSnapshot, deducted: cost };
  });
}

const TIER_RANK: Record<PlanTier, number> = { free: 0, pro: 1, max: 2 };

export function isPlanAtLeast(actual: PlanTier, required: PlanTier): boolean {
  return TIER_RANK[actual] >= TIER_RANK[required];
}

export function isDemoPreviewHost(): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  if (process.env.ALLOW_DEMO_TIER === 'true') return true;
  const appUrl = (process.env.APP_URL || '').toLowerCase();
  if (appUrl.includes('ais-dev-') || appUrl.includes('ais-pre-')) {
    return true;
  }
  return false;
}

export async function resolveAuthoritativePlan(
  uid: string | undefined,
  devDemoTier?: unknown,
): Promise<PlanTier> {
  // В production на боевом домене demoTier ПОЛНОСТЬЮ игнорируется на сервере.
  // В dev и на превью-стендах AI Studio (ais-dev / ais-pre) разрешаем тестирование Demo PRO / Demo MAX.
  if (isDemoPreviewHost() && (devDemoTier === 'pro' || devDemoTier === 'max')) {
    return devDemoTier;
  }

  if (!uid) {
    return 'free';
  }

  const entitlements = await getUserEntitlements(uid);
  return entitlements.plan;
}

export function isValidBillableAction(value: unknown): value is BillableAction {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(IMMUTABLE_CREDIT_COSTS, value)
  );
}
