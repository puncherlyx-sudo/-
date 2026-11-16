import React, { useEffect, useMemo, useState } from 'react';
import {
  Calculator,
  CandlestickChart,
  Check,
  Code2,
  Copy,
  Download,
  ExternalLink,
  Layers,
  PieChart as PieChartIcon,
  Smartphone,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import type { PaperPortfolioReport } from '../hooks/usePaperPortfolio';
import { usePWAInstall } from '../hooks/usePWAInstall';
import type {
  AndroidWidgetKind,
  StrategyConfig,
  Timeframe,
  WidgetFeedPayload,
} from '../types/domain';

const WIDGET_DECK_STORAGE_KEY = 'aegisquant_android_widgets_v1';

interface AndroidWidgetsModalProps {
  open: boolean;
  onClose: () => void;
  portfolioReport: PaperPortfolioReport;
  holdingsCount: number;
  strategies: StrategyConfig[];
  onLaunchStandaloneWidget: (kind: AndroidWidgetKind, symbol: string, tf: Timeframe) => void;
}

interface WidgetCatalogItem {
  kind: AndroidWidgetKind;
  title: string;
  sizeLabel: string;
  description: string;
  icon: React.FC<{ className?: string }>;
  imageSrc: string;
}

const WIDGET_CATALOG: WidgetCatalogItem[] = [
  {
    kind: 'chart',
    title: 'Виджет графика',
    sizeLabel: '4×2',
    description: 'Живой график цены, направление тренда, RSI(14) и уровни поддержки/сопротивления.',
    icon: CandlestickChart,
    imageSrc: '/src/assets/images/terminal_icon_chart_1794855841231.jpg',
  },
  {
    kind: 'price',
    title: 'Виджет цены',
    sizeLabel: '2×2',
    description: 'Текущая цена выбранной пары, суточное изменение (%) и диапазон 24ч.',
    icon: TrendingUp,
    imageSrc: '/src/assets/images/aegis_terminal_emblem_1794855840828.jpg',
  },
  {
    kind: 'position',
    title: 'Виджет позиции',
    sizeLabel: '2×2',
    description: 'Автоматический расчет объема лота, риска в USDT и тейк-профита.',
    icon: Calculator,
    imageSrc: '/src/assets/images/terminal_icon_vault_1794855844198.jpg',
  },
  {
    kind: 'pnl',
    title: 'Виджет доходности',
    sizeLabel: '4×2',
    description: 'Сводка портфеля, нереализованный PnL, доли активов и индекс страха/жадности.',
    icon: PieChartIcon,
    imageSrc: '/src/assets/images/terminal_icon_chart_1794855841231.jpg',
  },
  {
    kind: 'strategies',
    title: 'Стратегии',
    sizeLabel: '4×1',
    description: 'Статус активных стратегий, плечо, риск и рекомендуемый рыночный режим.',
    icon: Layers,
    imageSrc: '/src/assets/images/terminal_icon_strategy_1794855842754.jpg',
  },
];

const PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'TONUSDT'];

export const AndroidWidgetsModal: React.FC<AndroidWidgetsModalProps> = ({
  open,
  onClose,
  portfolioReport,
  holdingsCount,
  strategies,
  onLaunchStandaloneWidget,
}) => {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [timeframe, setTimeframe] = useState<Timeframe>('1h');
  const [installMethodTab, setInstallMethodTab] = useState<'shortcuts' | 'pin' | 'kwgt'>('shortcuts');
  const [enabledWidgets, setEnabledWidgets] = useState<AndroidWidgetKind[]>(() => {
    if (typeof window === 'undefined') return ['chart', 'price', 'position', 'pnl', 'strategies'];
    try {
      const raw = window.localStorage.getItem(WIDGET_DECK_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as AndroidWidgetKind[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // Fallback to all
    }
    return ['chart', 'price', 'position', 'pnl', 'strategies'];
  });
  const [feed, setFeed] = useState<WidgetFeedPayload | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();

  useEffect(() => {
    try {
      window.localStorage.setItem(WIDGET_DECK_STORAGE_KEY, JSON.stringify(enabledWidgets));
    } catch {
      // Ignore storage errors
    }
  }, [enabledWidgets]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/widgets/feed?symbol=${symbol}&interval=${timeframe}`);
        if (!res.ok) return;
        const json = (await res.json()) as WidgetFeedPayload;
        if (!cancelled) setFeed(json);
      } catch {
        // Non-blocking preview fetch
      }
    };
    void load();
    const timer = setInterval(() => void load(), 20_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [open, symbol, timeframe]);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const liveFeedEndpoint = `${origin}/api/widgets/feed?symbol=${symbol}&interval=${timeframe}&deposit=2500&risk=1.5`;

  const chartSparkline = useMemo(() => {
    if (!feed?.chart.sparkline) return [];
    return feed.chart.sparkline.map((val, idx) => ({ idx, val }));
  }, [feed]);

  const toggleWidgetInDeck = (kind: AndroidWidgetKind) => {
    setEnabledWidgets((prev) => {
      if (prev.includes(kind)) {
        return prev.length > 1 ? prev.filter((item) => item !== kind) : prev;
      }
      return [...prev, kind];
    });
  };

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      // Fallback ignored
    }
  };

  if (!open) return null;

  const activeStrategiesCount = strategies.filter((s) => s.enabled).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 sm:p-5 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Виджеты и ярлыки для рабочего стола Android"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-5xl rounded-3xl border border-white/12 bg-[#0E1420] shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col"
      >
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
              <Smartphone className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-semibold text-white truncate">
                Виджеты для рабочего стола Android
              </h2>
              <p className="text-xs text-slate-400 truncate">
                Настройте живые виджеты графика, цены, позиции, доходности и стратегий
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="min-h-[42px] min-w-[42px] flex items-center justify-center rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* LEFT: Live Interactive Android Home Screen Launcher Preview */}
          <div className="lg:col-span-5 flex flex-col items-center">
            <div className="w-full max-w-[340px] rounded-[34px] border-2 border-white/15 bg-gradient-to-b from-[#0A0F1A] via-[#0F172A] to-[#0B1220] p-4 shadow-2xl space-y-3">
              {/* Android Status Bar */}
              <div className="flex items-center justify-between px-2 text-[11px] font-mono text-slate-400">
                <span>12:45</span>
                <span>5G · 94%</span>
              </div>

              {/* Android Widget Grid Preview */}
              <div className="grid grid-cols-2 gap-2.5">
                {/* 1. Chart Widget (4x2 -> col-span-2) */}
                {enabledWidgets.includes('chart') && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onLaunchStandaloneWidget('chart', symbol, timeframe);
                    }}
                    className="col-span-2 text-left rounded-2xl border border-white/12 bg-[#131C2E]/95 p-3 hover:border-emerald-500/40 transition-colors"
                  >
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-white font-mono">
                        {symbol} · {timeframe}
                      </span>
                      <span className="text-emerald-400 font-mono tabular-nums">
                        RSI {feed?.chart.rsi14 ?? '54.2'}
                      </span>
                    </div>
                    <div className="h-[54px] w-full mt-1">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartSparkline}>
                          <Area
                            type="monotone"
                            dataKey="val"
                            stroke="#10B981"
                            strokeWidth={2}
                            fill="#10B981"
                            fillOpacity={0.18}
                            isAnimationActive={false}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono tabular-nums mt-1">
                      <span>П: ${feed?.chart.support ?? '—'}</span>
                      <span>С: ${feed?.chart.resistance ?? '—'}</span>
                    </div>
                  </button>
                )}

                {/* 2. Price Widget (2x2 -> col-span-1) */}
                {enabledWidgets.includes('price') && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onLaunchStandaloneWidget('price', symbol, timeframe);
                    }}
                    className="col-span-1 text-left rounded-2xl border border-white/12 bg-[#131C2E]/95 p-3 hover:border-emerald-500/40 transition-colors flex flex-col justify-between min-h-[106px]"
                  >
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-mono font-semibold text-slate-200">
                        {symbol.replace('USDT', '')}
                      </span>
                      {(feed?.price.change24hPct ?? 0) >= 0 ? (
                        <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
                      )}
                    </div>
                    <div className="text-base font-bold font-mono tabular-nums text-white mt-1">
                      {feed?.price.formatted ?? '—'}
                    </div>
                    <div
                      className={`text-[11px] font-mono font-semibold tabular-nums ${
                        (feed?.price.change24hPct ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {(feed?.price.change24hPct ?? 0) >= 0 ? '+' : ''}
                      {(feed?.price.change24hPct ?? 0).toFixed(2)}% (24ч)
                    </div>
                  </button>
                )}

                {/* 3. Position Widget (2x2 -> col-span-1) */}
                {enabledWidgets.includes('position') && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onLaunchStandaloneWidget('position', symbol, timeframe);
                    }}
                    className="col-span-1 text-left rounded-2xl border border-white/12 bg-[#131C2E]/95 p-3 hover:border-emerald-500/40 transition-colors flex flex-col justify-between min-h-[106px]"
                  >
                    <div className="text-[11px] text-slate-400 flex items-center justify-between">
                      <span>Позиция</span>
                      <Calculator className="w-3.5 h-3.5 text-cyan-400" />
                    </div>
                    <div className="text-sm font-bold font-mono tabular-nums text-emerald-300">
                      {feed?.position.lotQty ?? '—'} {symbol.replace('USDT', '')}
                    </div>
                    <div className="text-[10px] text-slate-400 font-mono tabular-nums">
                      Риск ${feed?.position.riskUsdt ?? '37.5'} · {feed?.position.rrRatio ?? '1:2.5'}
                    </div>
                  </button>
                )}

                {/* 4. PnL / Portfolio Yield Widget (4x2 -> col-span-2) */}
                {enabledWidgets.includes('pnl') && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onLaunchStandaloneWidget('pnl', symbol, timeframe);
                    }}
                    className="col-span-2 text-left rounded-2xl border border-white/12 bg-[#131C2E]/95 p-3 hover:border-emerald-500/40 transition-colors flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="text-[11px] text-slate-400">Доходность портфеля</div>
                      <div className="text-base font-bold font-mono tabular-nums text-white mt-0.5">
                        {holdingsCount > 0
                          ? `$${portfolioReport.totalValue.toLocaleString('en-US', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}`
                          : 'Добавьте активы'}
                      </div>
                      <div
                        className={`text-[11px] font-mono font-semibold tabular-nums ${
                          portfolioReport.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {holdingsCount > 0
                          ? `${portfolioReport.totalPnl >= 0 ? '+' : ''}$${portfolioReport.totalPnl.toFixed(2)} (${
                              portfolioReport.totalPnlPct >= 0 ? '+' : ''
                            }${portfolioReport.totalPnlPct.toFixed(1)}%)`
                          : `F&G: ${feed?.pnl.marketSentimentValue ?? '—'}/100`}
                      </div>
                    </div>

                    {holdingsCount > 0 && portfolioReport.allocations.length > 0 && (
                      <div className="w-12 h-12 shrink-0">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={portfolioReport.allocations}
                              dataKey="valueUsdt"
                              cx="50%"
                              cy="50%"
                              innerRadius={14}
                              outerRadius={22}
                              stroke="none"
                              isAnimationActive={false}
                            >
                              {portfolioReport.allocations.map((a) => (
                                <Cell key={`prev-${a.symbol}`} fill={a.color} />
                              ))}
                            </Pie>
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </button>
                )}

                {/* 5. Strategies Widget (4x1 -> col-span-2) */}
                {enabledWidgets.includes('strategies') && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onLaunchStandaloneWidget('strategies', symbol, timeframe);
                    }}
                    className="col-span-2 text-left rounded-2xl border border-white/12 bg-[#131C2E]/95 px-3 py-2.5 hover:border-emerald-500/40 transition-colors flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-[11px] text-slate-400">Стратегии</div>
                      <div className="text-xs font-medium text-white truncate">
                        {feed?.strategies.recommendedBias ?? 'Трендовый импульс'}
                      </div>
                    </div>
                    <span className="text-[11px] font-mono tabular-nums text-emerald-400 shrink-0">
                      {activeStrategiesCount > 0 ? `${activeStrategiesCount} акт.` : '3 шаблона'}
                    </span>
                  </button>
                )}
              </div>

              {/* Android Launcher Dock */}
              <div className="pt-2 border-t border-white/10 flex items-center justify-around text-[10px] text-slate-400">
                <div className="flex flex-col items-center gap-1">
                  <img
                    src="/src/assets/images/aegis_terminal_emblem_1794855840828.jpg"
                    alt="AegisQuant"
                    referrerPolicy="no-referrer"
                    className="w-9 h-9 rounded-xl object-cover border border-white/15"
                  />
                  <span className="text-slate-200">AegisQuant</span>
                </div>
                <span className="text-[10px] text-slate-500 text-center max-w-[170px]">
                  Нажмите на любой виджет, чтобы открыть его в режиме закрепления
                </span>
              </div>
            </div>
          </div>

          {/* RIGHT: Configuration & Android Installation Methods */}
          <div className="lg:col-span-7 space-y-5">
            {/* Pair & Active Widgets Config */}
            <div className="rounded-2xl border border-white/10 bg-[#111827] p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-white">Параметры предпросмотра и ссылок</span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {PAIRS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setSymbol(p)}
                      className={`min-h-[32px] px-2 rounded-lg text-[11px] font-mono transition-colors ${
                        symbol === p
                          ? 'bg-emerald-600 text-white'
                          : 'bg-[#0B0F17] text-slate-400 border border-white/10 hover:text-white'
                      }`}
                    >
                      {p.replace('USDT', '')}
                    </button>
                  ))}
                  {(['15m', '1h', '4h'] as Timeframe[]).map((tf) => (
                    <button
                      key={tf}
                      type="button"
                      onClick={() => setTimeframe(tf)}
                      className={`min-h-[32px] px-2 rounded-lg text-[11px] font-mono transition-colors ${
                        timeframe === tf
                          ? 'bg-cyan-600 text-white'
                          : 'bg-[#0B0F17] text-slate-400 border border-white/10 hover:text-white'
                      }`}
                    >
                      {tf}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {WIDGET_CATALOG.map((item) => {
                  const selected = enabledWidgets.includes(item.kind);
                  return (
                    <button
                      key={item.kind}
                      type="button"
                      onClick={() => toggleWidgetInDeck(item.kind)}
                      className={`min-h-[34px] px-2.5 rounded-lg text-xs inline-flex items-center gap-1.5 border transition-colors ${
                        selected
                          ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
                          : 'border-white/10 bg-[#0B0F17] text-slate-400 hover:text-white'
                      }`}
                    >
                      <span>{item.title}</span>
                      <span className="text-[10px] font-mono opacity-75">{item.sizeLabel}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Method Switcher */}
            <div className="flex items-center gap-1.5 p-1 rounded-xl bg-[#111827] border border-white/10 overflow-x-auto">
              <button
                type="button"
                onClick={() => setInstallMethodTab('shortcuts')}
                className={`min-h-[38px] px-3 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  installMethodTab === 'shortcuts'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                1. Приложение и ярлыки Android
              </button>
              <button
                type="button"
                onClick={() => setInstallMethodTab('pin')}
                className={`min-h-[38px] px-3 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  installMethodTab === 'pin'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                2. Отдельный виджет (1 клик)
              </button>
              <button
                type="button"
                onClick={() => setInstallMethodTab('kwgt')}
                className={`min-h-[38px] px-3 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  installMethodTab === 'kwgt'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                3. Нативные виджеты (KWGT / JSON)
              </button>
            </div>

            {/* Method 1: PWA + Android Shortcuts */}
            {installMethodTab === 'shortcuts' && (
              <div className="rounded-2xl border border-white/10 bg-[#111827] p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-white">
                      Быстрые ярлыки в лаунчере Android (App Shortcuts)
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Установите PWA на Android — при удержании иконки AegisQuant появятся все 5 виджет-режимов, которые можно перетянуть на рабочий стол.
                    </p>
                  </div>

                  {!isInstalled && isInstallable && (
                    <button
                      type="button"
                      onClick={() => void install()}
                      className="min-h-[42px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white inline-flex items-center gap-2 whitespace-nowrap"
                    >
                      <Download className="w-4 h-4" />
                      <span>Установить на Android</span>
                    </button>
                  )}
                </div>

                <ol className="space-y-2 text-xs text-slate-300 leading-relaxed">
                  <li>
                    <strong className="text-white">Шаг 1.</strong>{' '}
                    {isIOS
                      ? 'В Safari нажмите «Поделиться» → «На экран Домой».'
                      : 'В Chrome на Android нажмите меню (⋮) → «Установить приложение» (или кнопку выше).'}
                  </li>
                  <li>
                    <strong className="text-white">Шаг 2.</strong> На рабочем столе Android удерживайте палец на иконке{' '}
                    <strong className="text-emerald-300">AegisQuant</strong> 1 секунду — откроется системное меню ярлыков: <em>График, Цена, Позиция, Доходность, Стратегии</em>.
                  </li>
                  <li>
                    <strong className="text-white">Шаг 3.</strong> Зажмите нужный пункт (например, <em>График</em> или <em>Цена</em>) и перетащите прямо на свободное место рабочего стола.
                  </li>
                </ol>
              </div>
            )}

            {/* Method 2: Open & Pin Individual Live Widget */}
            {installMethodTab === 'pin' && (
              <div className="rounded-2xl border border-white/10 bg-[#111827] p-4 space-y-3">
                <p className="text-xs text-slate-400">
                  Откройте любой виджет в чистом режиме и нажмите в Chrome <strong className="text-white">⋮ → Добавить на главный экран</strong> — каждый виджет сохранится как отдельная плитка с живыми данными.
                </p>

                <div className="divide-y divide-white/8">
                  {WIDGET_CATALOG.map((item) => {
                    const widgetUrl = `${origin}/?widget=${item.kind}&symbol=${symbol}&tf=${timeframe}`;
                    return (
                      <div
                        key={item.kind}
                        className="py-3 flex flex-wrap items-center justify-between gap-3"
                      >
                        <div className="flex items-start gap-2.5 min-w-0 flex-1">
                          <img
                            src={item.imageSrc}
                            alt={item.title}
                            referrerPolicy="no-referrer"
                            className="w-8 h-8 rounded-lg object-cover border border-white/12 shrink-0 mt-0.5"
                          />
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-white">{item.title}</div>
                            <div className="text-[11px] text-slate-400">{item.description}</div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => void handleCopy(item.kind, widgetUrl)}
                            className="min-h-[36px] px-2.5 rounded-lg border border-white/10 bg-[#0B0F17] hover:bg-white/5 text-xs text-slate-300 inline-flex items-center gap-1 whitespace-nowrap"
                          >
                            {copiedId === item.kind ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                            <span>{copiedId === item.kind ? 'Готово' : 'URL'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              onClose();
                              onLaunchStandaloneWidget(item.kind, symbol, timeframe);
                            }}
                            className="min-h-[36px] px-3 rounded-lg bg-emerald-600/20 border border-emerald-500/35 hover:bg-emerald-600/30 text-xs font-medium text-emerald-300 inline-flex items-center gap-1 whitespace-nowrap"
                          >
                            <span>Открыть</span>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Method 3: Native Android Widget Host (KWGT / JSON Feed / W3C Adaptive Card) */}
            {installMethodTab === 'kwgt' && (
              <div className="rounded-2xl border border-white/10 bg-[#111827] p-4 space-y-3 text-xs">
                <p className="text-slate-300 leading-relaxed">
                  Ограничение Android Chrome: браузерные PWA добавляют на рабочий стол иконки и перетаскиваемые ярлыки, а интерактивные карточки <strong className="text-white">2×2 / 4×2</strong> прямо поверх обоев требуют системного провайдера виджетов (например, <strong className="text-emerald-300">KWGT</strong> или обёртки <strong className="text-white">Android AppWidget</strong>). Терминал уже отдаёт живую JSON-ленту для таких виджетов:
                </p>

                <div className="rounded-xl border border-white/10 bg-[#0B0F17] p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-400 flex items-center gap-1.5">
                      <Code2 className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Live JSON API (обновление в реальном времени)</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleCopy('feed', liveFeedEndpoint)}
                      className="min-h-[32px] px-2.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-200 inline-flex items-center gap-1"
                    >
                      {copiedId === 'feed' ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>{copiedId === 'feed' ? 'Скопировано' : 'Копировать URL'}</span>
                    </button>
                  </div>
                  <div className="font-mono text-[11px] text-emerald-300 break-all select-all">
                    {liveFeedEndpoint}
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-[#0B0F17] p-3 space-y-1.5 font-mono text-[11px] text-slate-300">
                  <div className="text-slate-400 font-sans font-medium mb-1">
                    Формулы для KWGT / Android Widget Host:
                  </div>
                  <div className="truncate">
                    Цена: <span className="text-emerald-300">{`$wg("${liveFeedEndpoint}", json, .price.formatted)$`}</span>
                  </div>
                  <div className="truncate">
                    RSI(14): <span className="text-cyan-300">{`$wg("${liveFeedEndpoint}", json, .chart.rsi14)$`}</span>
                  </div>
                  <div className="truncate">
                    Объём лота: <span className="text-amber-300">{`$wg("${liveFeedEndpoint}", json, .position.lotQty)$`}</span>
                  </div>
                  <div className="truncate">
                    Настроение: <span className="text-slate-200">{`$wg("${liveFeedEndpoint}", json, .pnl.marketSentimentValue)$`}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
};
