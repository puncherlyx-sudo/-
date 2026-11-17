import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { FREE_DAILY_SIGNAL_LIMIT, FREE_WEEKLY_QUOTA, PRO_MONTHLY_QUOTA } from '../src/data/strategies.ts';
import { getAdminDb } from './billing.ts';

/**
 * Учёт кредитов и тарифа НА СЕРВЕРЕ.
 *
 * Приложению на телефоне доверять нельзя: оно может быть изменено. Поэтому кредиты списывает, пополняет
 * и проверяет только сервер (правила Firestore запрещают клиенту менять кредиты).
 *
 * Правила квоты:
 *  - Free: FREE_WEEKLY_QUOTA кредитов, пополнение раз в 7 дней.
 *  - PRO (активная подписка): PRO_MONTHLY_QUOTA кредитов, пополнение раз в 30 дней
 *    (в том числе при годовой подписке — квота обновляется каждый месяц).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface QuotaInput {
  plan?: unknown;
  proUntil?: unknown;
  creditsRemaining?: unknown;
  nextResetAt?: unknown;
}

export interface QuotaView {
  isPro: boolean;
  quota: number;
  creditsRemaining: number;
  nextResetAt: string;
  /** true — значения изменились (был сброс или поправка) и их нужно записать в базу */
  changed: boolean;
}

/** Приводит состояние пользователя к актуальному на момент nowMs: сброс квоты, потолок кредитов. */
export function normalizeQuota(input: QuotaInput, nowMs: number): QuotaView {
  const proUntil = Number(input.proUntil) || 0;
  const isPro = input.plan === 'pro' && proUntil > nowMs;
  const quota = isPro ? PRO_MONTHLY_QUOTA : FREE_WEEKLY_QUOTA;
  const periodMs = (isPro ? 30 : 7) * DAY_MS;

  let credits = Math.max(0, Math.floor(Number(input.creditsRemaining) || 0));
  const resetMs = Date.parse(String(input.nextResetAt ?? ''));
  let nextResetMs = Number.isFinite(resetMs) ? resetMs : 0;
  let changed = false;

  if (!Number.isFinite(resetMs) || resetMs <= nowMs) {
    // период закончился (или даты нет) — выдаём полную квоту на новый период
    credits = quota;
    nextResetMs = nowMs + periodMs;
    changed = true;
  } else if (nextResetMs > nowMs + periodMs) {
    // например, после окончания PRO дата пополнения осталась «на месяц вперёд» — для Free не ждём дольше недели
    nextResetMs = nowMs + periodMs;
    changed = true;
  }
  if (credits > quota) {
    credits = quota;
    changed = true;
  }
  return { isPro, quota, creditsRemaining: credits, nextResetAt: new Date(nextResetMs).toISOString(), changed };
}

export type ChargeFailureCode = 'INSUFFICIENT_CREDITS' | 'DAILY_LIMIT' | 'NO_PROFILE';

export type ChargeResult =
  | {
      ok: true;
      /** false — учёт не настроен (нет ключа Firebase на сервере), кредиты не списываются */
      enforced: boolean;
      isPro: boolean;
      creditsRemaining: number;
      quota: number;
      nextResetAt: string;
    }
  | {
      ok: false;
      status: number;
      code: ChargeFailureCode;
      message: string;
      isPro: boolean;
      creditsRemaining: number;
      quota: number;
    };

export interface ChargeOptions {
  /** Для анализа на Free: ключ стратегии для дневного лимита сигналов. */
  dailySignalKey?: string;
  nowMs?: number;
}

export function utcDayKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function safeCounterKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'unknown';
}

let warnedUnconfigured = false;

/** Списывает кредиты (транзакция). Для PRO дневной лимит не действует, кредиты списываются так же. */
export async function chargeCredits(
  uid: string,
  cost: number,
  options: ChargeOptions = {},
  dbOverride?: Firestore | null
): Promise<ChargeResult> {
  const db = dbOverride === undefined ? getAdminDb() : dbOverride;
  if (!db) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.warn(
        '[entitlements] Ключ Firebase (FIREBASE_SERVICE_ACCOUNT_JSON) не настроен: кредиты и лимиты НЕ применяются. Настройте ключ по BILLING_SETUP.md.'
      );
    }
    return { ok: true, enforced: false, isPro: false, creditsRemaining: 0, quota: 0, nextResetAt: '' };
  }

  const nowMs = options.nowMs ?? Date.now();
  const amount = Math.max(1, Math.round(cost));
  const userRef = db.collection('users').doc(uid);
  const usageRef = db.collection('users').doc(uid).collection('usage').doc(utcDayKey(nowMs));
  const counterKey = options.dailySignalKey ? safeCounterKey(options.dailySignalKey) : null;

  return db.runTransaction(async (tx): Promise<ChargeResult> => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) {
      return {
        ok: false,
        status: 404,
        code: 'NO_PROFILE',
        message: 'Профиль не найден. Войдите в аккаунт заново.',
        isPro: false,
        creditsRemaining: 0,
        quota: 0,
      };
    }
    const view = normalizeQuota(userSnap.data() as QuotaInput, nowMs);
    const usageSnap = counterKey && !view.isPro ? await tx.get(usageRef) : null;

    const persistView = (credits: number) => {
      tx.update(userRef, {
        creditsRemaining: credits,
        nextResetAt: view.nextResetAt,
        ...(view.isPro ? {} : { weeklyQuota: FREE_WEEKLY_QUOTA }),
        updatedAt: FieldValue.serverTimestamp(),
      });
    };

    if (counterKey && !view.isPro) {
      const used = Number(((usageSnap?.data() as { signals?: Record<string, number> } | undefined)?.signals ?? {})[counterKey]) || 0;
      if (used >= FREE_DAILY_SIGNAL_LIMIT) {
        if (view.changed) persistView(view.creditsRemaining);
        return {
          ok: false,
          status: 429,
          code: 'DAILY_LIMIT',
          message: `Дневной лимит бесплатного тарифа: ${FREE_DAILY_SIGNAL_LIMIT} сигнал в день на стратегию. PRO снимает это ограничение.`,
          isPro: false,
          creditsRemaining: view.creditsRemaining,
          quota: view.quota,
        };
      }
    }

    if (view.creditsRemaining < amount) {
      if (view.changed) persistView(view.creditsRemaining);
      return {
        ok: false,
        status: 402,
        code: 'INSUFFICIENT_CREDITS',
        message: view.isPro
          ? `Кредиты PRO на этот месяц закончились (нужно ${amount}, осталось ${view.creditsRemaining}). Они обновятся ${new Date(view.nextResetAt).toLocaleDateString('ru-RU')}.`
          : `Недостаточно кредитов (нужно ${amount}, осталось ${view.creditsRemaining} из ${view.quota}). Они обновятся ${new Date(view.nextResetAt).toLocaleDateString('ru-RU')}, а PRO даёт ${PRO_MONTHLY_QUOTA} кредитов в месяц.`,
        isPro: view.isPro,
        creditsRemaining: view.creditsRemaining,
        quota: view.quota,
      };
    }

    const after = view.creditsRemaining - amount;
    persistView(after);
    if (counterKey && !view.isPro) {
      const prev = ((usageSnap?.data() as { signals?: Record<string, number> } | undefined)?.signals ?? {}) as Record<string, number>;
      tx.set(
        usageRef,
        { signals: { ...prev, [counterKey]: (Number(prev[counterKey]) || 0) + 1 }, updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
    }
    return {
      ok: true,
      enforced: true,
      isPro: view.isPro,
      creditsRemaining: after,
      quota: view.quota,
      nextResetAt: view.nextResetAt,
    };
  });
}

/** Возвращает кредиты, если функция не выполнилась (ошибка ИИ/биржи) после списания. */
export async function refundCredits(
  uid: string,
  cost: number,
  options: ChargeOptions = {},
  dbOverride?: Firestore | null
): Promise<void> {
  const db = dbOverride === undefined ? getAdminDb() : dbOverride;
  if (!db) return;
  const nowMs = options.nowMs ?? Date.now();
  const amount = Math.max(1, Math.round(cost));
  const userRef = db.collection('users').doc(uid);
  const usageRef = db.collection('users').doc(uid).collection('usage').doc(utcDayKey(nowMs));
  const counterKey = options.dailySignalKey ? safeCounterKey(options.dailySignalKey) : null;

  await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) return;
    const view = normalizeQuota(userSnap.data() as QuotaInput, nowMs);
    const usageSnap = counterKey && !view.isPro ? await tx.get(usageRef) : null;
    tx.update(userRef, {
      creditsRemaining: Math.min(view.quota, view.creditsRemaining + amount),
      nextResetAt: view.nextResetAt,
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (counterKey && !view.isPro && usageSnap?.exists) {
      const prev = ((usageSnap.data() as { signals?: Record<string, number> }).signals ?? {}) as Record<string, number>;
      const current = Number(prev[counterKey]) || 0;
      if (current > 0) tx.set(usageRef, { signals: { ...prev, [counterKey]: current - 1 } }, { merge: true });
    }
  });
}

export interface EntitlementSnapshot {
  enforced: boolean;
  isPro: boolean;
  plan: 'free' | 'pro';
  proUntil: number | null;
  creditsRemaining: number;
  quota: number;
  nextResetAt: string;
}

/** Актуальное состояние тарифа и кредитов (с записью сброса квоты, если период закончился). */
export async function getEntitlementSnapshot(
  uid: string,
  nowMs: number = Date.now(),
  dbOverride?: Firestore | null
): Promise<EntitlementSnapshot | null> {
  const db = dbOverride === undefined ? getAdminDb() : dbOverride;
  if (!db) return null;
  const userRef = db.collection('users').doc(uid);
  return db.runTransaction(async (tx): Promise<EntitlementSnapshot | null> => {
    const snap = await tx.get(userRef);
    if (!snap.exists) return null;
    const data = snap.data() as QuotaInput;
    const view = normalizeQuota(data, nowMs);
    if (view.changed) {
      tx.update(userRef, {
        creditsRemaining: view.creditsRemaining,
        nextResetAt: view.nextResetAt,
        ...(view.isPro ? {} : { weeklyQuota: FREE_WEEKLY_QUOTA }),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    return {
      enforced: true,
      isPro: view.isPro,
      plan: view.isPro ? 'pro' : 'free',
      proUntil: Number(data.proUntil) > 0 ? Number(data.proUntil) : null,
      creditsRemaining: view.creditsRemaining,
      quota: view.quota,
      nextResetAt: view.nextResetAt,
    };
  });
}
