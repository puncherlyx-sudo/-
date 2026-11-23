import { serverLogger } from './logger.ts';
import fs from 'fs';
import path from 'path';
import { applicationDefault, cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore';

/**
 * Серверный каталог тарифов PRO / MAX, расчёт переходов между планами
 * и фоновый мониторинг истечения оплаченных подписок.
 */

export type BillingPeriod = 'month' | 'year';
export type SubscriptionTier = 'pro' | 'max';
export type MaxMultiplier = 10 | 20;

const PERIOD_DAYS: Record<BillingPeriod, number> = { month: 30, year: 365 };
const DAY_MS = 24 * 60 * 60 * 1000;

function readPrice(envName: string, fallback: number): number {
  const value = Number(process.env[envName]);
  return Number.isFinite(value) && value > 0 && value <= 100_000 ? value : fallback;
}

export function getPlanPrices(): Record<BillingPeriod, { priceUsd: number; days: number }> {
  return {
    month: { priceUsd: readPrice('PRO_PRICE_MONTH_USD', 29), days: PERIOD_DAYS.month },
    year: { priceUsd: readPrice('PRO_PRICE_YEAR_USD', 264), days: PERIOD_DAYS.year },
  };
}

export function getMaxMultiplierPlans(): Record<
  MaxMultiplier,
  Record<BillingPeriod, { priceUsd: number; days: number; credits: number }>
> {
  return {
    10: {
      month: { priceUsd: readPrice('MAX_X10_PRICE_MONTH_USD', readPrice('MAX_PRICE_MONTH_USD', 79)), days: PERIOD_DAYS.month, credits: 1000 },
      year: { priceUsd: readPrice('MAX_X10_PRICE_YEAR_USD', readPrice('MAX_PRICE_YEAR_USD', 744)), days: PERIOD_DAYS.year, credits: 1000 },
    },
    20: {
      month: { priceUsd: readPrice('MAX_X20_PRICE_MONTH_USD', 129), days: PERIOD_DAYS.month, credits: 2000 },
      year: { priceUsd: readPrice('MAX_X20_PRICE_YEAR_USD', 1188), days: PERIOD_DAYS.year, credits: 2000 },
    },
  };
}

export function getTieredPlanPrices(): Record<
  SubscriptionTier,
  Record<BillingPeriod, { priceUsd: number; days: number; credits: number }>
> {
  const maxPlans = getMaxMultiplierPlans();
  return {
    pro: {
      month: { priceUsd: readPrice('PRO_PRICE_MONTH_USD', 29), days: PERIOD_DAYS.month, credits: 100 },
      year: { priceUsd: readPrice('PRO_PRICE_YEAR_USD', 264), days: PERIOD_DAYS.year, credits: 100 },
    },
    max: maxPlans[10],
  };
}

// ---------- Firebase Admin (проверка и истечение тарифа на сервере) ----------

let cachedDb: Firestore | null | undefined;

function getDb(): Firestore | null {
  if (cachedDb !== undefined) return cachedDb;
  try {
    const config = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'firebase-applet-config.json'), 'utf8'),
    ) as { projectId: string; firestoreDatabaseId?: string };

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
        cachedDb = null;
        return null;
      }
    }
    cachedDb = config.firestoreDatabaseId
      ? getFirestore(app, config.firestoreDatabaseId)
      : getFirestore(app);
  } catch (err) {
    serverLogger.error('billing', 'Не удалось инициализировать Firebase Admin:', err instanceof Error ? err.message : err);
    cachedDb = null;
  }
  return cachedDb;
}

// ---------- Расчёт срока при продлении или смене тарифа (Audit H1: без сгорания остатка дней) ----------

export interface PlanTransitionInput {
  currentPlan: 'free' | 'pro' | 'max';
  currentMultiplier: MaxMultiplier;
  currentUntilMs: number;
  targetTier: SubscriptionTier;
  targetMultiplier: MaxMultiplier;
  targetPeriod: BillingPeriod;
  nowMs?: number;
}

export interface PlanTransitionResult {
  proUntil: number;
  isSamePlan: boolean;
  proratedCreditDays: number;
  grantedPeriodDays: number;
  creditsGrant: number;
  nextResetAtIso: string;
}

function getDailyPlanValueUsd(tier: SubscriptionTier, mult: MaxMultiplier): number {
  if (tier === 'max') {
    const monthly = getMaxMultiplierPlans()[mult].month;
    return monthly.priceUsd / monthly.days;
  }
  const monthly = getTieredPlanPrices().pro.month;
  return monthly.priceUsd / monthly.days;
}

/**
 * Честный расчёт срока подписки:
 * - Продление того же тарифа (и того же множителя MAX): суммирует срок от max(now, currentUntil).
 * - Переход между тарифами (PRO ↔ MAX×10 ↔ MAX×20) при активной подписке: остаток оплаченных дней
 *   НЕ сгорает, а пропорционально конвертируется по соотношению суточной стоимости тарифов
 *   в эквивалентные дни нового тарифа (cap: 730 дн.).
 */
export function computeSubscriptionTransition(input: PlanTransitionInput): PlanTransitionResult {
  const now = input.nowMs ?? Date.now();
  const grantedPeriodDays = PERIOD_DAYS[input.targetPeriod];
  const creditsGrant =
    input.targetTier === 'max' ? (input.targetMultiplier === 20 ? 2000 : 1000) : 100;

  const isSamePlan =
    input.currentPlan === input.targetTier &&
    (input.targetTier !== 'max' || input.currentMultiplier === input.targetMultiplier);

  if (isSamePlan) {
    const base = Math.max(now, input.currentUntilMs);
    const proUntil = base + grantedPeriodDays * DAY_MS;
    return {
      proUntil,
      isSamePlan: true,
      proratedCreditDays: 0,
      grantedPeriodDays,
      creditsGrant,
      nextResetAtIso: new Date(Math.min(proUntil, now + 30 * DAY_MS)).toISOString(),
    };
  }

  let proratedCreditDays = 0;
  if ((input.currentPlan === 'pro' || input.currentPlan === 'max') && input.currentUntilMs > now) {
    const remainingDays = (input.currentUntilMs - now) / DAY_MS;
    const oldDailyUsd = getDailyPlanValueUsd(input.currentPlan, input.currentMultiplier);
    const newDailyUsd = getDailyPlanValueUsd(input.targetTier, input.targetMultiplier);
    if (oldDailyUsd > 0 && newDailyUsd > 0) {
      const converted = (remainingDays * oldDailyUsd) / newDailyUsd;
      proratedCreditDays = Math.min(730, Math.max(0, Math.round(converted)));
    }
  }

  const proUntil = now + (grantedPeriodDays + proratedCreditDays) * DAY_MS;
  return {
    proUntil,
    isSamePlan: false,
    proratedCreditDays,
    grantedPeriodDays,
    creditsGrant,
    nextResetAtIso: new Date(Math.min(proUntil, now + 30 * DAY_MS)).toISOString(),
  };
}

// ---------- Чтение тарифа пользователя ----------

export async function getUserPlanTier(uid: string): Promise<'free' | 'pro' | 'max' | null> {
  const db = getDb();
  if (!db) return null;
  try {
    const snap = await db.collection('users').doc(uid).get();
    if (!snap.exists) return null;
    const data = snap.data() as { plan?: unknown; proUntil?: unknown };
    if ((data.plan === 'pro' || data.plan === 'max') && Number(data.proUntil || 0) > Date.now()) {
      return data.plan;
    }
    return 'free';
  } catch {
    return null;
  }
}

// ---------- Истечение подписки ----------

/**
 * Возвращает на бесплатный тариф всех, у кого PRO/MAX истёк или не подтверждён оплатой
 * (в том числе тех, кто включил тариф вручную до появления оплаты).
 */
export async function downgradeExpiredPro(): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const snap = await db.collection('users').where('plan', 'in', ['pro', 'max']).get();
  const now = Date.now();
  const expired = snap.docs.filter((d) => (Number((d.data() as { proUntil?: unknown }).proUntil) || 0) <= now);
  // Firestore: не более 500 операций в одном пакете
  for (let i = 0; i < expired.length; i += 400) {
    const batch = db.batch();
    for (const docSnap of expired.slice(i, i + 400)) {
      const credits = Number((docSnap.data() as { creditsRemaining?: unknown }).creditsRemaining) || 0;
      batch.update(docSnap.ref, {
        plan: 'free',
        creditsRemaining: Math.min(25, credits),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }
  const count = expired.length;
  return count;
}

export function startProExpiryMonitor(): void {
  if (!getDb()) {
    if (process.env.NODE_ENV === 'production') {
      serverLogger.error(
        'billing',
        'PRODUCTION WARNING: FIREBASE_SERVICE_ACCOUNT_JSON не задан — фоновый мониторинг истёкших подписок не запущен.'
      );
    }
    return;
  }
  const run = () => {
    void downgradeExpiredPro()
      .then((n) => {
        if (n > 0) serverLogger.info('billing', `Возвращено на бесплатный тариф: ${n}`);
      })
      .catch((err) => serverLogger.error('billing', 'Ошибка проверки истёкших подписок:', err instanceof Error ? err.message : err));
  };
  run();
  setInterval(run, 60 * 60 * 1000);
}
