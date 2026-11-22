/// <reference lib="webworker" />
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { clientsClaim } from 'workbox-core';
import { ExpirationPlugin } from 'workbox-expiration';
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst } from 'workbox-strategies';

declare let self: ServiceWorkerGlobalScope;

self.skipWaiting();
clientsClaim();

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// Cache-First для статических ассетов, иконок и изображений
registerRoute(
  ({ request, url }) =>
    url.origin === self.location.origin &&
    (request.destination === 'image' ||
      request.destination === 'font' ||
      url.pathname.startsWith('/assets/') ||
      url.pathname.startsWith('/brand/')),
  new CacheFirst({
    cacheName: 'vernier-static-assets-v1',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 80,
        maxAgeSeconds: 60 * 60 * 24 * 30,
      }),
    ],
  })
);

// Network-First с безопасным фолбэком для публичных read-only API (котировки, новости, календарь, Fear & Greed)
// Приватные эндпоинты (auth, security, exchanges, entitlements, billing) НИКОГДА не кэшируются!
registerRoute(
  ({ request, url }) =>
    request.method === 'GET' &&
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/api/market/') ||
      url.pathname === '/api/news' ||
      url.pathname === '/api/economic-calendar'),
  new NetworkFirst({
    cacheName: 'vernier-public-api-v1',
    networkTimeoutSeconds: 5,
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({
        maxEntries: 60,
        maxAgeSeconds: 60 * 15,
      }),
    ],
  })
);

registerRoute(
  /^https:\/\/fonts\.googleapis\.com\/.*/i,
  new CacheFirst({
    cacheName: 'google-fonts-cache',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 10,
        maxAgeSeconds: 60 * 60 * 24 * 365,
      }),
    ],
  })
);

registerRoute(
  /^https:\/\/fonts\.gstatic\.com\/.*/i,
  new CacheFirst({
    cacheName: 'gstatic-fonts-cache',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 10,
        maxAgeSeconds: 60 * 60 * 24 * 365,
      }),
    ],
  })
);

interface PushPayload {
  title?: string;
  body?: string;
  tag?: string;
  url?: string;
  impact?: 'HIGH' | 'MEDIUM' | 'LOW';
  category?: string;
}

self.addEventListener('push', (event: PushEvent) => {
  let payload: PushPayload = {
    title: 'Vernier · Рыночный сигнал',
    body: 'Зафиксировано важное движение рынка или новый торговый сигнал.',
    tag: 'vernier-alert',
    url: '/?tab=market',
    impact: 'MEDIUM',
  };

  if (event.data) {
    try {
      const parsed = event.data.json() as PushPayload;
      payload = { ...payload, ...parsed };
    } catch {
      const text = event.data.text();
      if (text) payload.body = text;
    }
  }

  const options: NotificationOptions & { vibrate?: number[] } = {
    body: payload.body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: payload.tag || 'vernier-alert',
    data: {
      url: payload.url || '/?tab=market',
      category: payload.category || 'market',
    },
    vibrate: payload.impact === 'HIGH' ? [200, 100, 200] : [140, 60, 140],
    requireInteraction: payload.impact === 'HIGH',
  };

  event.waitUntil(
    self.registration.showNotification(payload.title || 'Vernier', options)
  );
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const rawUrl = (event.notification.data as { url?: string } | undefined)?.url || '/?tab=market';
  let targetUrl = new URL('/?tab=market', self.location.origin).href;
  try {
    const parsed = new URL(rawUrl, self.location.origin);
    if (parsed.origin === self.location.origin) {
      targetUrl = parsed.href;
    }
  } catch {
    // Fallback to safe same-origin default
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) {
          void client.focus();
          if ('navigate' in client) {
            return client.navigate(targetUrl);
          }
          return client;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});

interface WebWidgetHost {
  updateByTag?: (tag: string, payload: { template: string; data: string }) => Promise<void>;
}

interface WidgetLifecycleEvent extends ExtendableEvent {
  widget?: {
    definition?: {
      tag?: string;
      msAcTemplate?: string;
      data?: string;
    };
  };
  action?: string;
}

const WIDGET_KIND_BY_TAG: Record<string, string> = {
  'chart-widget': 'chart',
  'price-widget': 'price',
  'position-widget': 'position',
  'pnl-widget': 'pnl',
  'strategies-widget': 'strategies',
};

async function syncWidgetByTag(tag: string) {
  const swWithWidgets = self as unknown as { widgets?: WebWidgetHost };
  if (!swWithWidgets.widgets?.updateByTag) return;
  const kind = WIDGET_KIND_BY_TAG[tag] || 'price';
  try {
    const [tplRes, dataRes] = await Promise.all([
      fetch(`/api/widgets/template/${kind}`),
      fetch('/api/widgets/feed?symbol=BTCUSDT'),
    ]);
    if (!tplRes.ok || !dataRes.ok) return;
    const [templateText, dataText] = await Promise.all([tplRes.text(), dataRes.text()]);
    await swWithWidgets.widgets.updateByTag(tag, {
      template: templateText,
      data: dataText,
    });
  } catch {
    // Non-blocking widget refresh
  }
}

self.addEventListener('widgetinstall' as unknown as keyof ServiceWorkerGlobalScopeEventMap, (rawEvent: Event) => {
  const event = rawEvent as WidgetLifecycleEvent;
  const tag = event.widget?.definition?.tag;
  if (tag) {
    event.waitUntil(syncWidgetByTag(tag));
  }
});

self.addEventListener('widgetresume' as unknown as keyof ServiceWorkerGlobalScopeEventMap, (rawEvent: Event) => {
  const event = rawEvent as WidgetLifecycleEvent;
  const tag = event.widget?.definition?.tag;
  if (tag) {
    event.waitUntil(syncWidgetByTag(tag));
  }
});

self.addEventListener('widgetclick' as unknown as keyof ServiceWorkerGlobalScopeEventMap, (rawEvent: Event) => {
  const event = rawEvent as WidgetLifecycleEvent;
  const tag = event.widget?.definition?.tag || 'price-widget';
  const kind = WIDGET_KIND_BY_TAG[tag] || 'price';
  const targetUrl = new URL(`/?widget=${kind}`, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) {
          void client.focus();
          if ('navigate' in client) {
            return client.navigate(targetUrl);
          }
          return client;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});
