import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { applicationDefault, cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore';

/**
 * Оплата PRO через NOWPayments (криптовалюта), счёт-инвойс + подписанные IPN-уведомления.
 *
 * Принципы безопасности:
 *  - Тариф PRO выдаёт ТОЛЬКО сервер, после проверки подписи IPN (HMAC-SHA512, секрет IPN).
 *  - Сумма и валюта из уведомления сверяются с заказом, сохранённым на сервере.
 *  - Повторное уведомление не продлевает подписку второй раз (идемпотентность).
 *  - Ключи API/IPN и сервисный аккаунт хранятся только в переменных окружения сервера.
 */

export type BillingPeriod = 'month' | 'year';

const PERIOD_DAYS: Record<BillingPeriod, number> = { month: 30, year: 365 };
const DAY_MS = 24 * 60 * 60 * 1000;
const ORDER_ID_PATTERN = /^aq-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NOWPAYMENTS_INVOICE_URL = 'https://api.nowpayments.io/v1/invoice';

function readPrice(envName: string, fallback: number): number {
  const value = Number(process.env[envName]);
  return Number.isFinite(value) && value > 0 && value <= 100_000 ? value : fallback;
}

export function getPlanPrices(): Record<BillingPeriod, { priceUsd: number; days: number }> {
  return {
    month: { priceUsd: readPrice('PRO_PRICE_MONTH_USD', 29), days: PERIOD_DAYS.month },
    year: { priceUsd: readPrice('PRO_PRICE_YEAR_USD', 290), days: PERIOD_DAYS.year },
  };
}

function getAppUrl(): string {
  return (process.env.APP_URL || '').replace(/\/+$/, '');
}

export function isBillingConfigured(): boolean {
  return Boolean(
    process.env.NOWPAYMENTS_API_KEY &&
      process.env.NOWPAYMENTS_IPN_SECRET &&
      /^https:\/\//.test(getAppUrl()) &&
      getDb(),
  );
}

// ---------- Firebase Admin (запись тарифа в обход клиентских правил) ----------

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
    console.error('[billing] Не удалось инициализировать Firebase Admin:', err instanceof Error ? err.message : err);
    cachedDb = null;
  }
  return cachedDb;
}

// ---------- Создание счёта ----------

export async function createCheckout(
  uid: string,
  period: BillingPeriod,
): Promise<{ invoiceUrl: string; orderId: string }> {
  const db = getDb();
  if (!isBillingConfigured() || !db) {
    throw new Error('Оплата ещё не настроена владельцем приложения.');
  }
  const plan = getPlanPrices()[period];
  const orderId = `aq-${crypto.randomUUID()}`;
  const appUrl = getAppUrl();

  await db.collection('payments').doc(orderId).set({
    uid,
    period,
    priceUsd: plan.priceUsd,
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
  });

  const res = await fetch(NOWPAYMENTS_INVOICE_URL, {
    method: 'POST',
    headers: {
      'x-api-key': process.env.NOWPAYMENTS_API_KEY as string,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      price_amount: plan.priceUsd,
      price_currency: 'usd',
      order_id: orderId,
      order_description: `AegisQuant PRO (${period === 'year' ? '1 год' : '1 месяц'})`,
      ipn_callback_url: `${appUrl}/api/billing/ipn`,
      success_url: `${appUrl}/?payment=success`,
      cancel_url: `${appUrl}/?payment=cancel`,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  const data = (await res.json().catch(() => ({}))) as { invoice_url?: unknown; message?: unknown };
  const invoiceUrl = typeof data.invoice_url === 'string' ? data.invoice_url : '';
  if (!res.ok || !/^https:\/\/([a-z0-9-]+\.)?nowpayments\.io\//i.test(invoiceUrl)) {
    await db.collection('payments').doc(orderId).update({ status: 'failed_to_create' });
    throw new Error('Платёжный сервис не создал счёт. Попробуйте позже.');
  }
  return { invoiceUrl, orderId };
}

// ---------- Проверка подписи IPN ----------

function sortObjectDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectDeep);
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortObjectDeep((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

export function verifyIpnSignature(payload: unknown, signature: string | undefined): boolean {
  const secret = process.env.NOWPAYMENTS_IPN_SECRET;
  if (!secret || typeof signature !== 'string' || !/^[0-9a-f]{128}$/i.test(signature)) return false;
  const expected = crypto
    .createHmac('sha512', secret)
    .update(JSON.stringify(sortObjectDeep(payload)))
    .digest();
  const received = Buffer.from(signature, 'hex');
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

// ---------- Обработка уведомления об оплате ----------

export async function processIpn(payload: Record<string, unknown>): Promise<void> {
  const db = getDb();
  if (!db) return;
  const orderId = typeof payload.order_id === 'string' ? payload.order_id : '';
  const status = typeof payload.payment_status === 'string' ? payload.payment_status : '';
  if (!ORDER_ID_PATTERN.test(orderId) || !status) return;

  const orderRef = db.collection('payments').doc(orderId);

  await db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) return;
    const order = orderSnap.data() as { uid: string; period: BillingPeriod; priceUsd: number; status: string };
    if (order.status === 'paid') return; // идемпотентность

    if (status !== 'finished') {
      tx.update(orderRef, { status: `ipn_${status}`.slice(0, 40), updatedAt: FieldValue.serverTimestamp() });
      return;
    }

    const paidOk =
      String(payload.price_currency || '').toLowerCase() === 'usd' &&
      Number(payload.price_amount) >= order.priceUsd &&
      (!Number.isFinite(Number(payload.pay_amount)) ||
        !Number.isFinite(Number(payload.actually_paid)) ||
        Number(payload.actually_paid) >= Number(payload.pay_amount));
    if (!paidOk) {
      tx.update(orderRef, { status: 'amount_mismatch', updatedAt: FieldValue.serverTimestamp() });
      return;
    }

    const userRef = db.collection('users').doc(order.uid);
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) {
      tx.update(orderRef, { status: 'user_missing', updatedAt: FieldValue.serverTimestamp() });
      return;
    }
    const currentUntil = Number((userSnap.data() as { proUntil?: unknown }).proUntil) || 0;
    const base = Math.max(Date.now(), currentUntil);
    const proUntil = base + PERIOD_DAYS[order.period] * DAY_MS;

    tx.update(userRef, {
      plan: 'pro',
      proUntil,
      creditsRemaining: 100,
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.update(orderRef, { status: 'paid', paidAt: FieldValue.serverTimestamp() });
  });
}

// ---------- Истечение подписки ----------

/**
 * Возвращает на бесплатный тариф всех, у кого PRO истёк или не подтверждён оплатой
 * (в том числе тех, кто включил PRO вручную до появления оплаты).
 */
export async function downgradeExpiredPro(): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const snap = await db.collection('users').where('plan', '==', 'pro').get();
  const now = Date.now();
  const expired = snap.docs.filter((d) => (Number((d.data() as { proUntil?: unknown }).proUntil) || 0) <= now);
  // Firestore: не более 500 операций в одном пакете
  for (let i = 0; i < expired.length; i += 400) {
    const batch = db.batch();
    for (const docSnap of expired.slice(i, i + 400)) {
      const credits = Number((docSnap.data() as { creditsRemaining?: unknown }).creditsRemaining) || 0;
      batch.update(docSnap.ref, {
        plan: 'free',
        creditsRemaining: Math.min(10, credits),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }
  const count = expired.length;
  return count;
}

export function startProExpiryMonitor(): void {
  if (!getDb()) return;
  const run = () => {
    void downgradeExpiredPro()
      .then((n) => {
        if (n > 0) console.log(`[billing] Возвращено на бесплатный тариф: ${n}`);
      })
      .catch((err) => console.error('[billing] Ошибка проверки истёкших подписок:', err instanceof Error ? err.message : err));
  };
  run();
  setInterval(run, 60 * 60 * 1000);
}
