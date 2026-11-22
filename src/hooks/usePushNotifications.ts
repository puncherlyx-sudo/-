import { useCallback, useEffect, useRef, useState } from 'react';
import type { PushSubscriptionRecord } from '../types/domain';
import { authFetch } from '../lib/authFetch';

export interface PushPreferences {
  notifySignals: boolean;
  notifyMarketMoves: boolean;
  notifyVolatilitySpikes: boolean;
  volatilityThresholdPct: number;
  notifyPortfolioPnl: boolean;
  portfolioPnlThresholdPct: number;
  notifyNews: boolean;
  notifyAuthLogins: boolean;
  notifyStrategyChanges: boolean;
  notifySignalLimits: boolean;
}

export interface PortfolioPnlCheckInput {
  dailyPnlPct: number;
  dailyPnlUsdt: number;
  totalValue: number;
  hasLive24hData: boolean;
  thresholdPct?: number;
}

export interface PortfolioPnlCheckResult {
  triggered: boolean;
  notified: boolean;
  direction?: 'gain' | 'loss';
  thresholdPct: number;
  reason?: 'disabled' | 'no_live_data' | 'below_threshold' | 'not_subscribed' | 'cooldown' | 'sent' | 'error';
}

export interface PortfolioTargetCheckInput {
  targetId: string;
  portfolioId: string;
  portfolioLabel: string;
  targetBalanceUsdt: number;
  baselineBalanceUsdt: number;
  targetPnlPct: number;
  currentBalanceUsdt: number;
  hasLive24hData: boolean;
}

export interface PortfolioTargetCheckResult {
  triggered: boolean;
  notified: boolean;
  reason?: 'no_live_data' | 'below_target' | 'disabled' | 'not_subscribed' | 'cooldown' | 'sent' | 'error';
}

export interface CriticalExchangeSyncPushInput {
  keyId: string;
  exchange: 'binance' | 'bybit' | 'okx';
  label: string;
  category: 'auth' | 'exchange_api' | 'unknown';
  errorMessage: string;
  testnet?: boolean;
}

export interface CriticalExchangeSyncPushResult {
  notified: boolean;
  reason: 'disabled' | 'not_subscribed' | 'cooldown' | 'sent' | 'error';
}

const PORTFOLIO_PNL_COOLDOWN_MS = 60 * 60_000;
const PORTFOLIO_PNL_COOLDOWN_KEY = 'aegisquant_portfolio_pnl_push_v1';
const PORTFOLIO_TARGET_COOLDOWN_MS = 5 * 60_000;
const PORTFOLIO_TARGET_COOLDOWN_KEY = 'aegisquant_portfolio_target_push_v1';
const EXCHANGE_SYNC_CRITICAL_COOLDOWN_MS = 30 * 60_000;
const EXCHANGE_SYNC_CRITICAL_COOLDOWN_KEY = 'vernier_exchange_sync_critical_push_v1';

interface UsePushNotificationsParams {
  uid: string | undefined;
  isSignedIn: boolean;
  pushSubscriptions: PushSubscriptionRecord[];
  onSaveSubscription: (params: {
    endpoint: string;
    p256dh: string;
    auth: string;
    notifySignals: boolean;
    notifyMarketMoves: boolean;
    notifyVolatilitySpikes: boolean;
    volatilityThresholdPct: number;
    notifyPortfolioPnl: boolean;
    portfolioPnlThresholdPct: number;
    notifyNews: boolean;
    notifyAuthLogins: boolean;
    notifyStrategyChanges: boolean;
    notifySignalLimits: boolean;
    enabled: boolean;
    logAudit?: boolean;
  }) => Promise<void>;
  onDeleteSubscription: (endpoint: string) => Promise<void>;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function extractKeys(sub: PushSubscription): { endpoint: string; p256dh: string; auth: string } | null {
  const json = sub.toJSON();
  const endpoint = sub.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!endpoint || !p256dh || !auth) return null;
  return { endpoint, p256dh, auth };
}

export function usePushNotifications({
  uid,
  isSignedIn,
  pushSubscriptions,
  onSaveSubscription,
  onDeleteSubscription,
}: UsePushNotificationsParams) {
  const isSupported =
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;

  const [permission, setPermission] = useState<NotificationPermission>(() =>
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [activeEndpoint, setActiveEndpoint] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const portfolioCooldownRef = useRef<Map<string, number>>(new Map());
  const portfolioTargetCooldownRef = useRef<Map<string, number>>(new Map());
  const syncCriticalCooldownRef = useRef<Map<string, number>>(new Map());
  const [preferences, setPreferences] = useState<PushPreferences>({
    notifySignals: true,
    notifyMarketMoves: true,
    notifyVolatilitySpikes: true,
    volatilityThresholdPct: 5,
    notifyPortfolioPnl: true,
    portfolioPnlThresholdPct: 5,
    notifyNews: true,
    notifyAuthLogins: true,
    notifyStrategyChanges: true,
    notifySignalLimits: true,
  });

  // Sync preferences from stored Firestore record when available
  useEffect(() => {
    if (!activeEndpoint) return;
    const matched = pushSubscriptions.find((s) => s.endpoint === activeEndpoint);
    if (matched) {
      setPreferences({
        notifySignals: matched.notifySignals !== false,
        notifyMarketMoves: matched.notifyMarketMoves !== false,
        notifyVolatilitySpikes: matched.notifyVolatilitySpikes !== false,
        volatilityThresholdPct:
          typeof matched.volatilityThresholdPct === 'number' && matched.volatilityThresholdPct >= 1
            ? matched.volatilityThresholdPct
            : 5,
        notifyPortfolioPnl: matched.notifyPortfolioPnl !== false,
        portfolioPnlThresholdPct:
          typeof matched.portfolioPnlThresholdPct === 'number' && matched.portfolioPnlThresholdPct >= 1
            ? matched.portfolioPnlThresholdPct
            : 5,
        notifyNews: matched.notifyNews !== false,
        notifyAuthLogins: matched.notifyAuthLogins !== false,
        notifyStrategyChanges: matched.notifyStrategyChanges !== false,
        notifySignalLimits: matched.notifySignalLimits !== false,
      });
    }
  }, [activeEndpoint, pushSubscriptions]);

  // Check existing Service Worker Push subscription & sync with backend on load/login
  useEffect(() => {
    if (!isSupported) return;
    let cancelled = false;

    const syncExisting = async () => {
      try {
        setPermission(Notification.permission);
        const reg = await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();
        if (cancelled) return;

        if (!existing) {
          setIsSubscribed(false);
          setActiveEndpoint(null);
          return;
        }

        const keys = extractKeys(existing);
        if (!keys) return;

        setIsSubscribed(true);
        setActiveEndpoint(keys.endpoint);

        if (isSignedIn && uid) {
          const saved = pushSubscriptions.find((s) => s.endpoint === keys.endpoint);
          const prefs: PushPreferences = saved
            ? {
                notifySignals: saved.notifySignals !== false,
                notifyMarketMoves: saved.notifyMarketMoves !== false,
                notifyVolatilitySpikes: saved.notifyVolatilitySpikes !== false,
                volatilityThresholdPct:
                  typeof saved.volatilityThresholdPct === 'number' && saved.volatilityThresholdPct >= 1
                    ? saved.volatilityThresholdPct
                    : 5,
                notifyPortfolioPnl: saved.notifyPortfolioPnl !== false,
                portfolioPnlThresholdPct:
                  typeof saved.portfolioPnlThresholdPct === 'number' && saved.portfolioPnlThresholdPct >= 1
                    ? saved.portfolioPnlThresholdPct
                    : 5,
                notifyNews: saved.notifyNews !== false,
                notifyAuthLogins: saved.notifyAuthLogins !== false,
                notifyStrategyChanges: saved.notifyStrategyChanges !== false,
                notifySignalLimits: saved.notifySignalLimits !== false,
              }
            : preferences;

          await authFetch('/api/push/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              uid,
              subscription: {
                endpoint: keys.endpoint,
                keys: { p256dh: keys.p256dh, auth: keys.auth },
              },
              ...prefs,
              enabled: saved ? saved.enabled : true,
            }),
          });
        }
      } catch {
        // Silent sync fallback if browser blocks push service
      }
    };

    void syncExisting();
    return () => {
      cancelled = true;
    };
  }, [isSupported, isSignedIn, uid, pushSubscriptions.length]);

  const subscribe = useCallback(async () => {
    if (!isSupported) {
      setError('Ваш браузер не поддерживает фоновые Web Push-уведомления.');
      return;
    }
    if (!uid || !isSignedIn) {
      setError('Войдите в аккаунт для привязки Push-уведомлений.');
      return;
    }

    setLoading(true);
    setError(null);
    setStatusMessage(null);

    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') {
        throw new Error(
          perm === 'denied'
            ? 'Доступ к уведомлениям заблокирован в настройках браузера. Разрешите уведомления для этого сайта.'
            : 'Разрешение на уведомления не было выдано.'
        );
      }

      const keyRes = await fetch('/api/push/vapid-public-key');
      const keyData = (await keyRes.json()) as { publicKey?: string; error?: string };
      if (!keyRes.ok || !keyData.publicKey) {
        throw new Error(keyData.error || 'Не удалось получить публичный VAPID-ключ сервера.');
      }

      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const appServerKey = urlBase64ToUint8Array(keyData.publicKey);
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: appServerKey.buffer as ArrayBuffer,
        });
      }

      const keys = extractKeys(sub);
      if (!keys) {
        throw new Error('Браузер вернул неполные криптографические ключи подписки.');
      }

      const apiRes = await authFetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid,
          subscription: {
            endpoint: keys.endpoint,
            keys: { p256dh: keys.p256dh, auth: keys.auth },
          },
          ...preferences,
          enabled: true,
        }),
      });
      if (!apiRes.ok) {
        const errData = (await apiRes.json()) as { error?: string };
        throw new Error(errData.error || 'Сервер не принял Push-подписку.');
      }

      await onSaveSubscription({
        ...keys,
        ...preferences,
        enabled: true,
        logAudit: true,
      });

      setIsSubscribed(true);
      setActiveEndpoint(keys.endpoint);
      setStatusMessage('Фоновые Push-уведомления успешно подключены для этого устройства.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка подключения Push-уведомлений');
    } finally {
      setLoading(false);
    }
  }, [isSupported, uid, isSignedIn, preferences, onSaveSubscription]);

  const unsubscribe = useCallback(async () => {
    if (!isSupported) return;
    setLoading(true);
    setError(null);
    setStatusMessage(null);

    try {
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      const endpointToRemove = existing?.endpoint || activeEndpoint;

      if (existing) {
        await existing.unsubscribe();
      }
      if (endpointToRemove) {
        await authFetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: endpointToRemove }),
        });
        await onDeleteSubscription(endpointToRemove);
      }

      setIsSubscribed(false);
      setActiveEndpoint(null);
      setStatusMessage('Push-уведомления для этого устройства отключены.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка отключения Push-уведомлений');
    } finally {
      setLoading(false);
    }
  }, [isSupported, activeEndpoint, onDeleteSubscription]);

  const updatePreferences = useCallback(
    async (nextPrefs: PushPreferences) => {
      setPreferences(nextPrefs);
      setError(null);
      if (!isSupported || !isSubscribed || !uid || !isSignedIn) return;

      try {
        const reg = await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();
        if (!existing) return;
        const keys = extractKeys(existing);
        if (!keys) return;

        await authFetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uid,
            subscription: {
              endpoint: keys.endpoint,
              keys: { p256dh: keys.p256dh, auth: keys.auth },
            },
            ...nextPrefs,
            enabled: true,
          }),
        });

        await onSaveSubscription({
          ...keys,
          ...nextPrefs,
          enabled: true,
          logAudit: false,
        });
        setStatusMessage('Предпочтения Push-каналов обновлены.');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не удалось обновить настройки уведомлений');
      }
    },
    [isSupported, isSubscribed, uid, isSignedIn, onSaveSubscription]
  );

  const sendTestPush = useCallback(async () => {
    if (!uid || !isSignedIn) {
      setError('Войдите в аккаунт для тестирования Push.');
      return;
    }
    setLoading(true);
    setError(null);
    setStatusMessage(null);
    try {
      const res = await authFetch('/api/push/send-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Не удалось отправить тестовое уведомление.');
      }
      setStatusMessage('Тестовое Push-уведомление отправлено через Service Worker.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка отправки тест-уведомления');
    } finally {
      setLoading(false);
    }
  }, [uid, isSignedIn]);

  const scanMarketNow = useCallback(async () => {
    setLoading(true);
    setError(null);
    setStatusMessage(null);
    try {
      const res = await authFetch('/api/push/scan-market', { method: 'POST' });
      const data = (await res.json()) as {
        checkedPairs?: number;
        alertsSent?: number;
        summary?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || 'Ошибка сканирования рынка.');
      }
      setStatusMessage(
        `${data.summary || 'Сканирование завершено.'} (Проверено пар: ${data.checkedPairs ?? 0}, отправлено Push: ${data.alertsSent ?? 0})`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка проверки рынка');
    } finally {
      setLoading(false);
    }
  }, []);

  const triggerSecurityPush = useCallback(
    async (params: {
      category: 'auth_login' | 'strategy_change' | 'signal_limit';
      title: string;
      body: string;
      url?: string;
      overrideUid?: string;
    }) => {
      const targetUid = params.overrideUid || uid;
      if (!targetUid || !isSubscribed) return;
      if (params.category === 'auth_login' && !preferences.notifyAuthLogins) return;
      if (params.category === 'strategy_change' && !preferences.notifyStrategyChanges) return;
      if (params.category === 'signal_limit' && !preferences.notifySignalLimits) return;

      try {
        await authFetch('/api/push/security-event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uid: targetUid,
            category: params.category,
            title: params.title,
            body: params.body,
            url: params.url || '/?tab=security',
          }),
        });
      } catch {
        // Non-blocking background dispatch
      }
    },
    [uid, isSubscribed, preferences]
  );

  const checkAndNotifyPortfolioPnl = useCallback(
    async (params: PortfolioPnlCheckInput): Promise<PortfolioPnlCheckResult> => {
      const rawThreshold =
        typeof params.thresholdPct === 'number' && Number.isFinite(params.thresholdPct)
          ? params.thresholdPct
          : preferences.portfolioPnlThresholdPct;
      const thresholdPct = Math.max(1, Math.min(50, Math.round(rawThreshold * 10) / 10));

      if (!preferences.notifyPortfolioPnl) {
        return { triggered: false, notified: false, thresholdPct, reason: 'disabled' };
      }

      if (
        !params.hasLive24hData ||
        !Number.isFinite(params.dailyPnlPct) ||
        !Number.isFinite(params.dailyPnlUsdt) ||
        !Number.isFinite(params.totalValue) ||
        params.totalValue <= 0
      ) {
        return { triggered: false, notified: false, thresholdPct, reason: 'no_live_data' };
      }

      if (Math.abs(params.dailyPnlPct) < thresholdPct) {
        return { triggered: false, notified: false, thresholdPct, reason: 'below_threshold' };
      }

      const direction: 'gain' | 'loss' = params.dailyPnlPct >= 0 ? 'gain' : 'loss';

      if (!uid || !isSignedIn || !isSubscribed) {
        return { triggered: true, notified: false, direction, thresholdPct, reason: 'not_subscribed' };
      }

      const cooldownKey = `${uid}:${direction}`;
      const now = Date.now();
      let lastSentAt = portfolioCooldownRef.current.get(cooldownKey) ?? 0;

      if (typeof window !== 'undefined') {
        try {
          const rawStored = window.sessionStorage.getItem(`${PORTFOLIO_PNL_COOLDOWN_KEY}:${cooldownKey}`);
          const parsedStored = rawStored ? Number(rawStored) : 0;
          if (Number.isFinite(parsedStored) && parsedStored > lastSentAt) {
            lastSentAt = parsedStored;
          }
        } catch {
          // Ignore sessionStorage restrictions
        }
      }

      if (now - lastSentAt < PORTFOLIO_PNL_COOLDOWN_MS) {
        return { triggered: true, notified: false, direction, thresholdPct, reason: 'cooldown' };
      }

      // Mark optimistically to prevent duplicate dispatches across rapid/StrictMode effects
      portfolioCooldownRef.current.set(cooldownKey, now);

      try {
        const res = await authFetch('/api/push/portfolio-pnl', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dailyPnlPct: params.dailyPnlPct,
            dailyPnlUsdt: params.dailyPnlUsdt,
            totalValue: params.totalValue,
            thresholdPct,
          }),
        });
        if (!res.ok) {
          portfolioCooldownRef.current.delete(cooldownKey);
          return { triggered: true, notified: false, direction, thresholdPct, reason: 'error' };
        }
        const data = (await res.json()) as { sent?: number; skipped?: boolean };
        if (typeof window !== 'undefined' && (data.sent ?? 0) > 0) {
          try {
            window.sessionStorage.setItem(`${PORTFOLIO_PNL_COOLDOWN_KEY}:${cooldownKey}`, String(now));
          } catch {
            // Ignore sessionStorage restrictions
          }
        }
        return {
          triggered: true,
          notified: (data.sent ?? 0) > 0,
          direction,
          thresholdPct,
          reason: (data.sent ?? 0) > 0 ? 'sent' : 'cooldown',
        };
      } catch {
        portfolioCooldownRef.current.delete(cooldownKey);
        return { triggered: true, notified: false, direction, thresholdPct, reason: 'error' };
      }
    },
    [uid, isSignedIn, isSubscribed, preferences.notifyPortfolioPnl, preferences.portfolioPnlThresholdPct]
  );

  const checkAndNotifyPortfolioTarget = useCallback(
    async (params: PortfolioTargetCheckInput): Promise<PortfolioTargetCheckResult> => {
      if (
        !params.hasLive24hData ||
        !Number.isFinite(params.currentBalanceUsdt) ||
        !Number.isFinite(params.targetBalanceUsdt) ||
        params.currentBalanceUsdt <= 0 ||
        params.targetBalanceUsdt <= 0
      ) {
        return { triggered: false, notified: false, reason: 'no_live_data' };
      }

      if (params.currentBalanceUsdt < params.targetBalanceUsdt) {
        return { triggered: false, notified: false, reason: 'below_target' };
      }

      const dedupeKey = `${uid || 'guest'}:${params.portfolioId}:${params.targetBalanceUsdt.toFixed(2)}`;
      const now = Date.now();
      let lastSentAt = portfolioTargetCooldownRef.current.get(dedupeKey) ?? 0;

      if (typeof window !== 'undefined') {
        try {
          const rawStored = window.sessionStorage.getItem(`${PORTFOLIO_TARGET_COOLDOWN_KEY}:${dedupeKey}`);
          const parsedStored = rawStored ? Number(rawStored) : 0;
          if (Number.isFinite(parsedStored) && parsedStored > lastSentAt) {
            lastSentAt = parsedStored;
          }
        } catch {
          // Ignore sessionStorage restrictions
        }
      }

      if (now - lastSentAt < PORTFOLIO_TARGET_COOLDOWN_MS) {
        return { triggered: true, notified: false, reason: 'cooldown' };
      }

      portfolioTargetCooldownRef.current.set(dedupeKey, now);

      if (!preferences.notifyPortfolioPnl) {
        return { triggered: true, notified: false, reason: 'disabled' };
      }

      if (!uid || !isSignedIn || !isSubscribed) {
        return { triggered: true, notified: false, reason: 'not_subscribed' };
      }

      try {
        const res = await authFetch('/api/push/portfolio-target', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            portfolioId: params.portfolioId,
            portfolioLabel: params.portfolioLabel,
            targetBalanceUsdt: params.targetBalanceUsdt,
            currentBalanceUsdt: params.currentBalanceUsdt,
            baselineBalanceUsdt: params.baselineBalanceUsdt,
            targetPnlPct: params.targetPnlPct,
          }),
        });
        if (!res.ok) {
          portfolioTargetCooldownRef.current.delete(dedupeKey);
          return { triggered: true, notified: false, reason: 'error' };
        }
        const data = (await res.json()) as { sent?: number };
        if (typeof window !== 'undefined' && (data.sent ?? 0) > 0) {
          try {
            window.sessionStorage.setItem(`${PORTFOLIO_TARGET_COOLDOWN_KEY}:${dedupeKey}`, String(now));
          } catch {
            // Ignore sessionStorage restrictions
          }
        }
        return {
          triggered: true,
          notified: (data.sent ?? 0) > 0,
          reason: (data.sent ?? 0) > 0 ? 'sent' : 'cooldown',
        };
      } catch {
        portfolioTargetCooldownRef.current.delete(dedupeKey);
        return { triggered: true, notified: false, reason: 'error' };
      }
    },
    [uid, isSignedIn, isSubscribed, preferences.notifyPortfolioPnl]
  );

  const notifyCriticalExchangeSyncError = useCallback(
    async (params: CriticalExchangeSyncPushInput): Promise<CriticalExchangeSyncPushResult> => {
      if (!preferences.notifyAuthLogins) {
        return { notified: false, reason: 'disabled' };
      }
      if (!uid || !isSignedIn || !isSubscribed) {
        return { notified: false, reason: 'not_subscribed' };
      }

      const cooldownKey = `${uid}:${params.keyId}:${params.category}`;
      const now = Date.now();
      let lastSentAt = syncCriticalCooldownRef.current.get(cooldownKey) ?? 0;

      if (typeof window !== 'undefined') {
        try {
          const rawStored = window.sessionStorage.getItem(
            `${EXCHANGE_SYNC_CRITICAL_COOLDOWN_KEY}:${cooldownKey}`
          );
          const parsedStored = rawStored ? Number(rawStored) : 0;
          if (Number.isFinite(parsedStored) && parsedStored > lastSentAt) {
            lastSentAt = parsedStored;
          }
        } catch {
          // Ignore sessionStorage restrictions
        }
      }

      if (now - lastSentAt < EXCHANGE_SYNC_CRITICAL_COOLDOWN_MS) {
        return { notified: false, reason: 'cooldown' };
      }

      syncCriticalCooldownRef.current.set(cooldownKey, now);

      try {
        const res = await authFetch('/api/push/exchange-sync-error', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        });
        if (!res.ok) {
          syncCriticalCooldownRef.current.delete(cooldownKey);
          return { notified: false, reason: 'error' };
        }
        const data = (await res.json()) as { sent?: number; skipped?: boolean };
        const wasSent = (data.sent ?? 0) > 0;
        if (typeof window !== 'undefined' && wasSent) {
          try {
            window.sessionStorage.setItem(
              `${EXCHANGE_SYNC_CRITICAL_COOLDOWN_KEY}:${cooldownKey}`,
              String(now)
            );
          } catch {
            // Ignore sessionStorage restrictions
          }
        }
        return {
          notified: wasSent,
          reason: wasSent ? 'sent' : 'cooldown',
        };
      } catch {
        syncCriticalCooldownRef.current.delete(cooldownKey);
        return { notified: false, reason: 'error' };
      }
    },
    [uid, isSignedIn, isSubscribed, preferences.notifyAuthLogins]
  );

  return {
    isSupported,
    permission,
    isSubscribed,
    preferences,
    loading,
    statusMessage,
    error,
    subscribe,
    unsubscribe,
    updatePreferences,
    sendTestPush,
    scanMarketNow,
    triggerSecurityPush,
    checkAndNotifyPortfolioPnl,
    checkAndNotifyPortfolioTarget,
    notifyCriticalExchangeSyncError,
  };
}
