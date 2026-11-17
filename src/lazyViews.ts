import { lazy } from 'react';

/**
 * Тяжёлые экраны подключаются лениво: стартовая вкладка «Рынок» грузится сразу,
 * остальные скачиваются отдельными частями (и заранее, в простое — см. prefetchViews).
 */
const loaders = {
  screener: () => import('./components/MarketScreenerView'),
  strategies: () => import('./components/StrategiesView'),
  news: () => import('./components/NewsFeedView'),
  security: () => import('./components/SecurityCenterView'),
  widgets: () => import('./components/AndroidWidgetsModal'),
  standalone: () => import('./components/StandaloneWidgetView'),
};

export const MarketScreenerView = lazy(() =>
  loaders.screener().then((m) => ({ default: m.MarketScreenerView }))
);
export const StrategiesView = lazy(() => loaders.strategies().then((m) => ({ default: m.StrategiesView })));
export const NewsFeedView = lazy(() => loaders.news().then((m) => ({ default: m.NewsFeedView })));
export const SecurityCenterView = lazy(() =>
  loaders.security().then((m) => ({ default: m.SecurityCenterView }))
);
export const AndroidWidgetsModal = lazy(() =>
  loaders.widgets().then((m) => ({ default: m.AndroidWidgetsModal }))
);
export const StandaloneWidgetView = lazy(() =>
  loaders.standalone().then((m) => ({ default: m.StandaloneWidgetView }))
);

/** Заранее подгружает остальные экраны, когда браузер свободен, чтобы переключение вкладок было мгновенным. */
export function prefetchViews(): void {
  const run = () => {
    for (const load of [loaders.screener, loaders.strategies, loaders.news, loaders.security, loaders.widgets]) {
      void load().catch(() => {
        // нет сети — подгрузится при первом открытии вкладки
      });
    }
  };
  const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
  if (typeof w.requestIdleCallback === 'function') {
    w.requestIdleCallback(run, { timeout: 5000 });
  } else {
    window.setTimeout(run, 3000);
  }
}
