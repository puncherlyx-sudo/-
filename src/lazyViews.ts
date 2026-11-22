import { lazy } from 'react';

/**
 * Все тяжёлые экраны вкладок подключаются лениво (React.lazy):
 * неактивные вкладки размонтируются при переключении, освобождая память на мобильных устройствах.
 */
const loaders = {
  market: () => import('./components/MarketTerminalView'),
  screener: () => import('./components/MarketScreenerView'),
  strategies: () => import('./components/StrategiesView'),
  news: () => import('./components/NewsFeedView'),
  security: () => import('./components/SecurityCenterView'),
  widgets: () => import('./components/AndroidWidgetsModal'),
  portfolioModal: () => import('./components/PortfolioDetailsModal'),
  standalone: () => import('./components/StandaloneWidgetView'),
  pricingModal: () => import('./components/PricingModal'),
  quickAnswers: () => import('./components/QuickAnswersCard'),
};

export const MarketTerminalView = lazy(() =>
  loaders.market().then((m) => ({ default: m.MarketTerminalView }))
);
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
export const PortfolioDetailsModal = lazy(() =>
  loaders.portfolioModal().then((m) => ({ default: m.PortfolioDetailsModal }))
);
export const StandaloneWidgetView = lazy(() =>
  loaders.standalone().then((m) => ({ default: m.StandaloneWidgetView }))
);
export const PricingModal = lazy(() =>
  loaders.pricingModal().then((m) => ({ default: m.PricingModal }))
);
export const QuickAnswersCard = lazy(() =>
  loaders.quickAnswers().then((m) => ({ default: m.QuickAnswersCard }))
);

/**
 * Заранее подгружает остальные экраны, когда браузер свободен, чтобы переключение вкладок было мгновенным.
 * Уважает режим экономии трафика (Save-Data) и медленные мобильные сети (2G/3G), чтобы не мешать первому рендеру графика.
 */
export function prefetchViews(): void {
  const nav = navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  };
  if (nav.connection?.saveData) return;
  const netType = nav.connection?.effectiveType;
  if (netType === 'slow-2g' || netType === '2g' || netType === '3g') return;

  const queue = [
    loaders.screener,
    loaders.strategies,
    loaders.news,
    loaders.security,
  ];

  const runStaggered = () => {
    queue.forEach((load, index) => {
      window.setTimeout(() => {
        if (document.visibilityState === 'hidden') return;
        void load().catch(() => {
          // нет сети — подгрузится при первом открытии вкладки
        });
      }, index * 450);
    });
  };

  const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
  if (typeof w.requestIdleCallback === 'function') {
    w.requestIdleCallback(runStaggered, { timeout: 6000 });
  } else {
    window.setTimeout(runStaggered, 3500);
  }
}
