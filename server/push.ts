import fs from 'fs';
import path from 'path';
import {
  generateVAPIDKeys,
  sendNotification,
  setVapidDetails,
  type PushSubscription,
} from 'web-push';
import { getMarketOverview } from './market.ts';

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export interface StoredPushEntry {
  uid: string;
  endpoint: string;
  subscription: PushSubscription;
  notifySignals: boolean;
  notifyMarketMoves: boolean;
  notifyVolatilitySpikes: boolean;
  volatilityThresholdPct: number;
  notifyNews: boolean;
  notifyAuthLogins: boolean;
  notifyStrategyChanges: boolean;
  notifySignalLimits: boolean;
  enabled: boolean;
  updatedAt: number;
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  tag: string;
  url: string;
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  category:
    | 'signal'
    | 'market'
    | 'volatility_spike'
    | 'news'
    | 'auth_login'
    | 'strategy_change'
    | 'signal_limit'
    | 'price_alert'
    | 'test';
}

export interface ServerPriceAlert {
  id: string;
  uid: string;
  symbol: string;
  marketType: 'spot' | 'futures';
  condition: 'above' | 'below';
  targetPrice: number;
  active: boolean;
  updatedAtMs?: number;
}

export interface TriggeredPriceAlertResult {
  id: string;
  symbol: string;
  marketType: 'spot' | 'futures';
  condition: 'above' | 'below';
  targetPrice: number;
  triggeredPrice: number;
  triggeredAt: string;
}

const VAPID_FILE = path.resolve(process.cwd(), '.vapid-keys.json');

function loadOrCreateVapidKeys(): VapidKeys {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY,
    };
  }
  try {
    if (fs.existsSync(VAPID_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8')) as VapidKeys;
      if (parsed.publicKey && parsed.privateKey) {
        return parsed;
      }
    }
  } catch {
    // Regenerate if unreadable
  }
  const generated = generateVAPIDKeys();
  try {
    fs.writeFileSync(VAPID_FILE, JSON.stringify(generated, null, 2), 'utf8');
  } catch {
    // Non-fatal if read-only fs
  }
  return generated;
}

const vapidKeys = loadOrCreateVapidKeys();
setVapidDetails('mailto:security@aegisquant.app', vapidKeys.publicKey, vapidKeys.privateKey);

// Keyed by endpoint so each browser/device has a single canonical entry
const subscriptionRegistry = new Map<string, StoredPushEntry>();
const priceAlertRegistry = new Map<string, ServerPriceAlert[]>();
const triggeredPriceAlerts = new Map<string, TriggeredPriceAlertResult & { triggeredAtMs: number }>();
const lastPriceSnapshot = new Map<string, number>();
const alertCooldowns = new Map<string, number>();
let monitorStarted = false;

export function getVapidPublicKey(): string {
  return vapidKeys.publicKey;
}

export function registerPushSubscription(entry: Omit<StoredPushEntry, 'updatedAt'>): void {
  subscriptionRegistry.set(entry.endpoint, {
    ...entry,
    updatedAt: Date.now(),
  });
}

export function unregisterPushSubscription(endpoint: string, uid: string): void {
  const existing = subscriptionRegistry.get(endpoint);
  if (existing && existing.uid === uid) {
    subscriptionRegistry.delete(endpoint);
  }
}

export async function dispatchPushToEntry(
  entry: StoredPushEntry,
  payload: PushNotificationPayload
): Promise<boolean> {
  try {
    await sendNotification(entry.subscription, JSON.stringify(payload), {
      TTL: 60 * 60,
      urgency: payload.impact === 'HIGH' ? 'high' : 'normal',
    });
    return true;
  } catch (err: unknown) {
    const statusCode = (err as { statusCode?: number } | undefined)?.statusCode;
    if (statusCode === 404 || statusCode === 410) {
      subscriptionRegistry.delete(entry.endpoint);
    }
    return false;
  }
}

export async function dispatchPushToUser(
  uid: string,
  payload: PushNotificationPayload
): Promise<{ sent: number; failed: number }> {
  const targets = Array.from(subscriptionRegistry.values()).filter((item) => {
    if (item.uid !== uid || !item.enabled) return false;
    if (payload.category === 'signal') return item.notifySignals;
    if (payload.category === 'market') return item.notifyMarketMoves;
    if (payload.category === 'volatility_spike') return item.notifyVolatilitySpikes;
    if (payload.category === 'news') return item.notifyNews;
    if (payload.category === 'auth_login') return item.notifyAuthLogins;
    if (payload.category === 'strategy_change') return item.notifyStrategyChanges;
    if (payload.category === 'signal_limit') return item.notifySignalLimits;
    return true;
  });
  let sent = 0;
  let failed = 0;
  for (const target of targets) {
    const ok = await dispatchPushToEntry(target, payload);
    if (ok) sent += 1;
    else failed += 1;
  }
  return { sent, failed };
}

export async function scanMarketAndNotify(): Promise<{
  checkedPairs: number;
  alertsSent: number;
  summary: string;
}> {
  const tickers = await getMarketOverview('futures');
  const activeMarketSubs = Array.from(subscriptionRegistry.values()).filter(
    (s) => s.enabled && s.notifyMarketMoves
  );
  const activeVolatilitySubs = Array.from(subscriptionRegistry.values()).filter(
    (s) => s.enabled && s.notifyVolatilitySpikes
  );
  let alertsSent = 0;
  const triggeredSymbols: string[] = [];
  const volatilitySymbols: string[] = [];

  for (const t of tickers) {
    const prevPrice = lastPriceSnapshot.get(t.symbol);
    lastPriceSnapshot.set(t.symbol, t.price);

    const deltaFromPrevPct = prevPrice ? ((t.price - prevPrice) / prevPrice) * 100 : 0;
    const spark = t.sparkline24h;
    const prevHourPrice = spark && spark.length >= 2 ? spark[spark.length - 2] : undefined;
    const hourlyChangePct =
      prevHourPrice && prevHourPrice > 0
        ? ((t.price - prevHourPrice) / prevHourPrice) * 100
        : deltaFromPrevPct;

    // 1. Dedicated hourly volatility spike alerts (> threshold % per hour, default 5%)
    for (const sub of activeVolatilitySubs) {
      const threshold = Math.max(1, Math.min(25, sub.volatilityThresholdPct || 5));
      const spikePct =
        Math.abs(hourlyChangePct) >= Math.abs(deltaFromPrevPct) ? hourlyChangePct : deltaFromPrevPct;
      if (Math.abs(spikePct) >= threshold) {
        const volCooldownKey = `vol:${sub.uid}:${t.symbol}`;
        const lastVolAlert = alertCooldowns.get(volCooldownKey) ?? 0;
        if (Date.now() - lastVolAlert >= 30 * 60_000) {
          alertCooldowns.set(volCooldownKey, Date.now());
          const shortSym = t.symbol.replace('USDT', '');
          if (!volatilitySymbols.includes(shortSym)) volatilitySymbols.push(shortSym);

          const payload: PushNotificationPayload = {
            title: `AegisQuant · Скачок волатильности ${t.baseAsset}/USDT (${spikePct >= 0 ? '+' : ''}${spikePct.toFixed(1)}% за 1ч)`,
            body: `Аномальное движение ${t.baseAsset} ($${t.price.toLocaleString('en-US')}) превысило порог ±${threshold}% за час. Проверьте уровни и риски.`,
            tag: `volatility-${t.symbol}`,
            url: '/?tab=market',
            impact: 'HIGH',
            category: 'volatility_spike',
          };
          const ok = await dispatchPushToEntry(sub, payload);
          if (ok) alertsSent += 1;
        }
      }
    }

    // 2. General market moves & Funding Rate alerts
    const isVolatilitySpike = Math.abs(deltaFromPrevPct) >= 1.1;
    const isStrong24hMove = Math.abs(t.change24hPct) >= 4.5;
    const isExtremeFunding =
      t.fundingRatePct !== undefined && (t.fundingRatePct >= 0.035 || t.fundingRatePct <= -0.025);

    if (isVolatilitySpike || isStrong24hMove || isExtremeFunding) {
      const cooldownKey = `${t.symbol}:${isExtremeFunding ? 'funding' : 'move'}`;
      const lastAlert = alertCooldowns.get(cooldownKey) ?? 0;
      if (Date.now() - lastAlert < 30 * 60_000) continue;

      alertCooldowns.set(cooldownKey, Date.now());
      triggeredSymbols.push(t.symbol.replace('USDT', ''));

      const reason = isExtremeFunding
        ? `Перегрев Funding Rate: ${t.fundingRatePct?.toFixed(4)}%`
        : `Движение ${t.change24hPct >= 0 ? '+' : ''}${t.change24hPct}% за 24ч`;

      const payload: PushNotificationPayload = {
        title: `AegisQuant · Рыночный импульс ${t.baseAsset}/USDT`,
        body: `Цена $${t.price.toLocaleString('en-US')} · ${reason}. Проверьте сигналы стратегий.`,
        tag: `market-${t.symbol}`,
        url: '/?tab=market',
        impact: 'HIGH',
        category: 'market',
      };

      for (const sub of activeMarketSubs) {
        const ok = await dispatchPushToEntry(sub, payload);
        if (ok) alertsSent += 1;
      }
    }
  }

  const summaryParts: string[] = [];
  if (volatilitySymbols.length > 0) {
    summaryParts.push(`Скачки волатильности за 1ч: ${volatilitySymbols.join(', ')}`);
  }
  if (triggeredSymbols.length > 0) {
    summaryParts.push(`Импульсы/Funding: ${triggeredSymbols.join(', ')}`);
  }

  return {
    checkedPairs: tickers.length,
    alertsSent,
    summary:
      summaryParts.length > 0
        ? summaryParts.join(' · ')
        : 'Резких аномалий на рынке не зафиксировано (рынок в норме).',
  };
}

export async function notifyHighImpactNews(item: {
  title: string;
  asset: string;
  impact: string;
}): Promise<number> {
  if (item.impact !== 'HIGH' || subscriptionRegistry.size === 0) return 0;
  const cooldownKey = `news:${item.asset}:${item.title.slice(0, 48)}`;
  const lastAlert = alertCooldowns.get(cooldownKey) ?? 0;
  if (Date.now() - lastAlert < 60 * 60_000) return 0;
  alertCooldowns.set(cooldownKey, Date.now());

  const activeSubs = Array.from(subscriptionRegistry.values()).filter(
    (s) => s.enabled && s.notifyNews
  );
  if (activeSubs.length === 0) return 0;

  const payload: PushNotificationPayload = {
    title: `AegisQuant · Важная новость (${item.asset})`,
    body: item.title,
    tag: `news-${item.asset}`,
    url: '/?tab=news',
    impact: 'HIGH',
    category: 'news',
  };

  let sent = 0;
  for (const sub of activeSubs) {
    const ok = await dispatchPushToEntry(sub, payload);
    if (ok) sent += 1;
  }
  return sent;
}

export function syncUserPriceAlerts(
  uid: string,
  alerts: ServerPriceAlert[]
): TriggeredPriceAlertResult[] {
  const sanitized: ServerPriceAlert[] = [];
  const pendingTriggered: TriggeredPriceAlertResult[] = [];

  for (const alert of alerts.slice(0, 30)) {
    const triggerKey = `${uid}:${alert.id}`;
    const existingTriggered = triggeredPriceAlerts.get(triggerKey);

    if (!alert.active) {
      triggeredPriceAlerts.delete(triggerKey);
      continue;
    }

    // If user reactivated or updated the alert after it was triggered, clear old trigger marker
    if (existingTriggered) {
      if (alert.updatedAtMs && alert.updatedAtMs > existingTriggered.triggeredAtMs + 1500) {
        triggeredPriceAlerts.delete(triggerKey);
      } else {
        pendingTriggered.push({
          id: existingTriggered.id,
          symbol: existingTriggered.symbol,
          marketType: existingTriggered.marketType,
          condition: existingTriggered.condition,
          targetPrice: existingTriggered.targetPrice,
          triggeredPrice: existingTriggered.triggeredPrice,
          triggeredAt: existingTriggered.triggeredAt,
        });
        continue;
      }
    }

    sanitized.push({
      id: alert.id,
      uid,
      symbol: alert.symbol.toUpperCase(),
      marketType: alert.marketType === 'futures' ? 'futures' : 'spot',
      condition: alert.condition === 'below' ? 'below' : 'above',
      targetPrice: Number(alert.targetPrice),
      active: true,
      updatedAtMs: alert.updatedAtMs,
    });
  }

  priceAlertRegistry.set(uid, sanitized);
  return pendingTriggered;
}

export async function checkPriceAlertsForUser(targetUid?: string): Promise<{
  checkedAlerts: number;
  alertsSent: number;
  triggered: TriggeredPriceAlertResult[];
}> {
  const entries = targetUid
    ? ([[targetUid, priceAlertRegistry.get(targetUid) ?? []]] as Array<[string, ServerPriceAlert[]]>)
    : Array.from(priceAlertRegistry.entries());

  const activeAlerts = entries.flatMap(([uid, list]) =>
    list.filter((a) => a.active).map((a) => ({ ...a, uid }))
  );

  if (activeAlerts.length === 0) {
    return { checkedAlerts: 0, alertsSent: 0, triggered: [] };
  }

  const needsSpot = activeAlerts.some((a) => a.marketType === 'spot');
  const needsFutures = activeAlerts.some((a) => a.marketType === 'futures');

  const [spotTickers, futuresTickers] = await Promise.all([
    needsSpot ? getMarketOverview('spot') : Promise.resolve([]),
    needsFutures ? getMarketOverview('futures') : Promise.resolve([]),
  ]);

  const spotMap = new Map(spotTickers.map((t) => [t.symbol, t.price]));
  const futuresMap = new Map(futuresTickers.map((t) => [t.symbol, t.price]));

  let alertsSent = 0;
  const triggeredNow: TriggeredPriceAlertResult[] = [];

  for (const alert of activeAlerts) {
    const livePrice =
      alert.marketType === 'futures' ? futuresMap.get(alert.symbol) : spotMap.get(alert.symbol);
    if (!livePrice || livePrice <= 0) continue;

    const crossed =
      alert.condition === 'above'
        ? livePrice >= alert.targetPrice
        : livePrice <= alert.targetPrice;

    if (!crossed) continue;

    alert.active = false;
    const triggeredAt = new Date().toISOString();
    const record: TriggeredPriceAlertResult = {
      id: alert.id,
      symbol: alert.symbol,
      marketType: alert.marketType,
      condition: alert.condition,
      targetPrice: alert.targetPrice,
      triggeredPrice: livePrice,
      triggeredAt,
    };
    triggeredPriceAlerts.set(`${alert.uid}:${alert.id}`, {
      ...record,
      triggeredAtMs: Date.now(),
    });
    triggeredNow.push(record);

    const conditionLabel = alert.condition === 'above' ? 'достигла ≥' : 'опустилась ≤';
    const marketLabel = alert.marketType === 'futures' ? 'Фьючерсы' : 'Спот';

    const pushRes = await dispatchPushToUser(alert.uid, {
      title: `AegisQuant · Ценовой алерт ${alert.symbol}`,
      body: `Цена ${conditionLabel} $${alert.targetPrice.toLocaleString('en-US')} (текущая: $${livePrice.toLocaleString('en-US')} · ${marketLabel}).`,
      tag: `price-alert-${alert.id}`,
      url: '/?tab=market',
      impact: 'HIGH',
      category: 'price_alert',
    });
    alertsSent += pushRes.sent;
  }

  // Prune triggered alerts from active lists
  for (const [uid, list] of entries) {
    priceAlertRegistry.set(
      uid,
      list.filter((a) => a.active)
    );
  }

  return {
    checkedAlerts: activeAlerts.length,
    alertsSent,
    triggered: triggeredNow,
  };
}

export function startMarketAlertMonitor(): void {
  if (monitorStarted) return;
  monitorStarted = true;
  setInterval(() => {
    if (subscriptionRegistry.size === 0) return;
    void scanMarketAndNotify().catch(() => {
      // Ignore transient poll errors
    });
    void checkPriceAlertsForUser().catch(() => {
      // Ignore transient price alert poll errors
    });
  }, 60_000);
}
