import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        registerType: 'autoUpdate',
        includeAssets: [
          'icon.svg',
          'apple-touch-icon.png',
          'pwa-192x192.png',
          'pwa-512x512.png',
          'pwa-maskable-512x512.png',
          'brand/vernier-app-icon.svg',
          'brand/vernier-mark.svg',
          'brand/vernier-mono.svg',
          'brand/vernier-lockup.svg',
        ],
        manifest: {
          id: '/',
          name: 'Vernier Crypto Terminal',
          short_name: 'Vernier',
          description: 'Защищенный терминал анализа крипторынка, новостей и стратегий Спот и Фьючерсы с 2FA.',
          theme_color: '#0B0F17',
          background_color: '#0B0F17',
          display: 'standalone',
          display_override: ['standalone', 'minimal-ui'],
          orientation: 'portrait-primary',
          categories: ['finance', 'productivity'],
          lang: 'ru',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
          shortcuts: [
            {
              name: 'Виджет графика (BTC)',
              short_name: 'График',
              description: 'Живой свечной график, тренд и уровни',
              url: '/?widget=chart&symbol=BTCUSDT&tf=1h',
              icons: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
            },
            {
              name: 'Виджет цены',
              short_name: 'Цена',
              description: 'Курс пары, 24ч изменение и быстрый алерты',
              url: '/?widget=price&symbol=BTCUSDT',
              icons: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
            },
            {
              name: 'Виджет позиции',
              short_name: 'Позиция',
              description: 'Расчет объема лота, риска и стоп-лосса',
              url: '/?widget=position&symbol=BTCUSDT',
              icons: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
            },
            {
              name: 'Виджет доходности',
              short_name: 'Доходность',
              description: 'Стоимость портфеля, PnL и индекс страха/жадности',
              url: '/?widget=pnl',
              icons: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
            },
            {
              name: 'Стратегии',
              short_name: 'Стратегии',
              description: 'Активные стратегии и параметры риска',
              url: '/?widget=strategies',
              icons: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
            },
          ],
          // W3C Web App Widgets spec (cast safely for ManifestOptions compatibility)
          widgets: [
            {
              name: 'Vernier · Виджет графика',
              short_name: 'График',
              description: 'Тренд, RSI(14) и ключевые уровни выбранной пары',
              tag: 'chart-widget',
              template: 'aegis-chart',
              ms_ac_template: '/api/widgets/template/chart',
              data: '/api/widgets/feed?symbol=BTCUSDT',
              type: 'application/json',
              update: 60,
              icons: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
            },
            {
              name: 'Vernier · Виджет цены',
              short_name: 'Цена',
              description: 'Актуальная цена и изменение за 24 часа',
              tag: 'price-widget',
              template: 'aegis-price',
              ms_ac_template: '/api/widgets/template/price',
              data: '/api/widgets/feed?symbol=BTCUSDT',
              type: 'application/json',
              update: 30,
              icons: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
            },
            {
              name: 'Vernier · Виджет позиции',
              short_name: 'Позиция',
              description: 'Расчет объема лота и риск на сделку',
              tag: 'position-widget',
              template: 'aegis-position',
              ms_ac_template: '/api/widgets/template/position',
              data: '/api/widgets/feed?symbol=BTCUSDT',
              type: 'application/json',
              update: 300,
              icons: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
            },
            {
              name: 'Vernier · Виджет доходности',
              short_name: 'Доходность',
              description: 'Сводка доходности, лидеров рынка и настроений',
              tag: 'pnl-widget',
              template: 'aegis-pnl',
              ms_ac_template: '/api/widgets/template/pnl',
              data: '/api/widgets/feed?symbol=BTCUSDT',
              type: 'application/json',
              update: 60,
              icons: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
            },
            {
              name: 'Vernier · Стратегии',
              short_name: 'Стратегии',
              description: 'Сигналы торговых стратегий и волатильность',
              tag: 'strategies-widget',
              template: 'aegis-strategies',
              ms_ac_template: '/api/widgets/template/strategies',
              data: '/api/widgets/feed?symbol=BTCUSDT',
              type: 'application/json',
              update: 120,
              icons: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
            },
          ],
        } as Record<string, unknown>,
        injectManifest: {
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          const srcAssets = path.resolve(__dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
        },
      },
    ],
    build: {
      // Библиотеки выносим в отдельные файлы: они меняются редко, поэтому после обновления приложения
      // телефон перекачивает только изменившийся код, а не всё целиком.
      chunkSizeWarningLimit: 700,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              { name: 'vendor-firebase', test: /node_modules[\\/](firebase|@firebase)[\\/]/, priority: 30 },
              { name: 'vendor-charts', test: /node_modules[\\/](recharts|d3-[^\\/]+|victory-vendor|internmap|decimal\.js-light)[\\/]/, priority: 20 },
              { name: 'vendor-motion', test: /node_modules[\\/](framer-motion|motion|motion-dom|motion-utils)[\\/]/, priority: 10 },
            ],
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
