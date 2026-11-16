import { useCallback, useEffect, useState } from 'react';
import type { PushSubscriptionRecord } from '../types/domain';

export interface PushPreferences {
  notifySignals: boolean;
  notifyMarketMoves: boolean;
  notifyNews: boolean;
  notifyAuthLogins: boolean;
  notifyStrategyChanges: boolean;
  notifySignalLimits: boolean;
}

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
  const [preferences, setPreferences] = useState<PushPreferences>({
    notifySignals: true,
    notifyMarketMoves: true,
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
                notifyNews: saved.notifyNews !== false,
                notifyAuthLogins: saved.notifyAuthLogins !== false,
                notifyStrategyChanges: saved.notifyStrategyChanges !== false,
                notifySignalLimits: saved.notifySignalLimits !== false,
              }
            : preferences;

          await fetch('/api/push/subscribe', {
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

      const apiRes = await fetch('/api/push/subscribe', {
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
        await fetch('/api/push/unsubscribe', {
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

        await fetch('/api/push/subscribe', {
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
      const res = await fetch('/api/push/send-test', {
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
      const res = await fetch('/api/push/scan-market', { method: 'POST' });
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
        await fetch('/api/push/security-event', {
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
  };
}
