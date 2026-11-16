import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  Calculator,
  CandlestickChart,
  Check,
  Copy,
  Layers,
  PieChart as PieChartIcon,
  PlusSquare,
  RefreshCw,
  Smartphone,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { motion } from 'motion/react';
import {
  Area,
  AreaChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { STRATEGY_CATALOG } from '../data/strategies';
import type { PaperPortfolioReport } from '../hooks/usePaperPortfolio';
import { usePWAInstall } from '../hooks/usePWAInstall';
import type {
  AndroidWidgetKind,
  AppTab,
  StrategyConfig,
  Timeframe,
  WidgetFeedPayload,
} from '../types/domain';

interface StandaloneWidgetViewProps {
  widgetKind: AndroidWidgetKind;
  initialSymbol?: string;
  initialTimeframe?: Timeframe;
  portfolioReport: PaperPortfolioReport;
  holdingsCount: number;
  strategies: StrategyConfig[];
  onChangeWidget: (kind: AndroidWidgetKind, symbol: string, tf: Timeframe) => void;
  onExitToTerminal: (targetTab: AppTab, symbol?: string) => void;
}

const PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'TONUSDT'];
const WIDGET_TABS: Array<{ kind: AndroidWidgetKind; label: string; tab: AppTab }> = [
  { kind: 'chart', label: 'График', tab: 'market' },
  { kind: 'price', label: 'Цена', tab: 'market' },
  { kind: 'position', label: 'Позиция', tab: 'strategies' },
  { kind: 'pnl', label: 'Доходность', tab: 'screener' },
  { kind: 'strategies', label: 'Стратегии', tab: 'strategies' },
];

export const StandaloneWidgetView: React.FC<StandaloneWidgetViewProps> = ({
  widgetKind,
  initialSymbol = 'BTCUSDT',
  initialTimeframe = '1h',
  portfolioReport,
  holdingsCount,
  strategies,
  onChangeWidget,
  onExitToTerminal,
}) => {
  const [symbol, setSymbol] = useState(
    PAIRS.includes(initialSymbol.toUpperCase()) ? initialSymbol.toUpperCase() : 'BTCUSDT'
  );
  const [timeframe, setTimeframe] = useState<Timeframe>(initialTimeframe);
  const [depositUsdt, setDepositUsdt] = useState(2500);
  const [riskPct, setRiskPct] = useState(1.5);
  const [stopPct, setStopPct] = useState(2.5);
  const [feed, setFeed] = useState<WidgetFeedPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPinHint, setShowPinHint] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();

  const fetchFeed = useCallback(async () => {
    try {
      setError(null);
      const params = new URLSearchParams({
        symbol,
        interval: timeframe,
        deposit: String(depositUsdt),
        risk: String(riskPct),
        stopPct: String(stopPct),
      });
      const res = await fetch(`/api/widgets/feed?${params.toString()}`);
      const json = (await res.json()) as WidgetFeedPayload & { error?: string };
      if (!res.ok) {
        throw new Error(json.error || 'Не удалось обновить виджет');
      }
      setFeed(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки данных виджета');
    } finally {
      setLoading(false);
    }
  }, [symbol, timeframe, depositUsdt, riskPct, stopPct]);

  useEffect(() => {
    setLoading(true);
    void fetchFeed();
    const timer = setInterval(() => void fetchFeed(), 15_000);
    return () => clearInterval(timer);
  }, [fetchFeed]);

  // Keep page title synchronized so Chrome "Add to Home Screen" names the shortcut clearly
  useEffect(() => {
    const labelMap: Record<AndroidWidgetKind, string> = {
      chart: `График ${symbol}`,
      price: `Цена ${symbol}`,
      position: `Позиция ${symbol}`,
      pnl: 'Доходность портфеля',
      strategies: 'Стратегии AegisQuant',
    };
    document.title = `${labelMap[widgetKind]} · AegisQuant`;
    return () => {
      document.title = 'AegisQuant — Терминал анализа крипторынка и стратегий';
    };
  }, [widgetKind, symbol]);

  const chartSeries = useMemo(() => {
    if (!feed?.chart.candles) return [];
    return feed.chart.candles.map((c) => ({
      time: new Date(c.time * 1000).toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
      }),
      close: c.close,
    }));
  }, [feed]);

  const activeStrategiesList = useMemo(() => {
    if (strategies.length > 0) {
      return strategies;
    }
    return STRATEGY_CATALOG.slice(0, 4).map((t) => ({
      id: t.key,
      userId: 'guest',
      marketType: t.marketType,
      strategyKey: t.key,
      name: t.name,
      enabled: true,
      dailySignalLimit: 3,
      minConfidence: 68,
      riskPerTradePct: t.defaultRiskPct,
      leverage: t.defaultLeverage,
      pairs: ['BTCUSDT', 'ETHUSDT'],
    }));
  }, [strategies]);

  const handleCopyWidgetUrl = async () => {
    if (typeof window === 'undefined') return;
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      setShowPinHint(true);
    }
  };

  const handlePinWidgetToDesktop = async () => {
    if (isInstallable) {
      const ok = await install();
      if (ok) return;
    }
    setShowPinHint((prev) => !prev);
  };

  const targetTerminalTab =
    WIDGET_TABS.find((t) => t.kind === widgetKind)?.tab ?? 'market';

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex flex-col justify-between p-4 sm:p-6">
      <div className="w-full max-w-xl mx-auto space-y-4">
        {/* Compact Widget Mode Top Navigation */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/10">
          <button
            type="button"
            onClick={() => onExitToTerminal(targetTerminalTab, symbol)}
            className="min-h-[42px] px-3 rounded-xl border border-white/10 bg-[#111827] hover:bg-white/5 text-xs font-medium text-slate-200 inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
          >
            <ArrowLeft className="w-4 h-4 text-emerald-400" />
            <span>Полный терминал</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void fetchFeed()}
              aria-label="Обновить данные виджета"
              className="min-h-[42px] min-w-[42px] flex items-center justify-center rounded-xl border border-white/10 bg-[#111827] hover:bg-white/5 text-slate-300 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-emerald-400' : ''}`} />
            </button>

            {!isInstalled && (
              <button
                type="button"
                onClick={() => void handlePinWidgetToDesktop()}
                className="min-h-[42px] px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
              >
                <PlusSquare className="w-4 h-4" />
                <span>На рабочий стол Android</span>
              </button>
            )}
          </div>
        </div>

        {/* Pin-to-Android-Desktop Instructions Drawer */}
        {showPinHint && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-emerald-500/30 bg-[#111827] p-4 space-y-2.5 text-xs text-slate-300"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold text-white flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-emerald-400" />
                <span>Закрепить этот виджет на экране Android</span>
              </div>
              <button
                type="button"
                onClick={() => void handleCopyWidgetUrl()}
                className="min-h-[34px] px-2.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-200 inline-flex items-center gap-1 whitespace-nowrap"
              >
                {copiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedUrl ? 'Скопировано' : 'Ссылка'}</span>
              </button>
            </div>
            {isIOS ? (
              <p className="leading-relaxed text-slate-300">
                Нажмите <strong className="text-white">Поделиться</strong> →{' '}
                <strong className="text-white">На экран «Домой»</strong>, чтобы закрепить этот конкретный виджет как отдельную иконку.
              </p>
            ) : (
              <ol className="list-decimal list-inside space-y-1 text-slate-300 leading-relaxed">
                <li>
                  Откройте меню <strong className="text-white">Chrome (⋮)</strong> в правом верхнем углу.
                </li>
                <li>
                  Нажмите <strong className="text-white">Добавить на главный экран</strong> — Android закрепит именно этот виджет (<strong className="text-emerald-300">{document.title.split(' · ')[0]}</strong>).
                </li>
                <li>
                  Либо установите <strong className="text-white">AegisQuant</strong> и удерживайте иконку на рабочем столе для доступа ко всем 5 быстрым ярлыкам.
                </li>
              </ol>
            )}
          </motion.div>
        )}

        {/* Widget Type Switcher */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {WIDGET_TABS.map((item) => {
            const active = widgetKind === item.kind;
            return (
              <button
                key={item.kind}
                type="button"
                onClick={() => onChangeWidget(item.kind, symbol, timeframe)}
                className={`min-h-[40px] px-3 rounded-xl text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                  active
                    ? 'bg-emerald-600 text-white'
                    : 'bg-[#111827] border border-white/10 text-slate-300 hover:text-white'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {/* Pair Selector */}
        {(widgetKind === 'chart' || widgetKind === 'price' || widgetKind === 'position') && (
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 overflow-x-auto">
              {PAIRS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    setSymbol(p);
                    onChangeWidget(widgetKind, p, timeframe);
                  }}
                  className={`min-h-[36px] px-2.5 rounded-lg text-xs font-mono whitespace-nowrap transition-colors ${
                    symbol === p
                      ? 'bg-white/15 text-white border border-white/25'
                      : 'bg-[#111827] text-slate-400 border border-white/8 hover:text-white'
                  }`}
                >
                  {p.replace('USDT', '')}
                </button>
              ))}
            </div>

            {widgetKind === 'chart' && (
              <div className="flex items-center gap-1 bg-[#111827] border border-white/10 rounded-lg p-0.5">
                {(['15m', '1h', '4h'] as Timeframe[]).map((tf) => (
                  <button
                    key={tf}
                    type="button"
                    onClick={() => {
                      setTimeframe(tf);
                      onChangeWidget(widgetKind, symbol, tf);
                    }}
                    className={`min-h-[32px] px-2.5 rounded-md text-xs font-mono transition-colors ${
                      timeframe === tf ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {tf}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
            {error}
          </div>
        )}

        {/* MAIN ANDROID WIDGET CARD */}
        <div className="rounded-3xl border border-white/12 bg-[#111827] p-5 shadow-2xl space-y-4">
          {widgetKind === 'price' && (
            <>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center font-mono font-bold text-emerald-300 text-sm">
                    {symbol.replace('USDT', '')}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">{symbol}</div>
                    <div className="text-xs text-slate-400">
                      Спот · {feed?.price.source === 'live' ? 'Биржа live' : 'Кэш'}
                    </div>
                  </div>
                </div>
                <div
                  className={`text-sm font-mono font-semibold tabular-nums flex items-center gap-1 ${
                    (feed?.price.change24hPct ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {(feed?.price.change24hPct ?? 0) >= 0 ? (
                    <TrendingUp className="w-4 h-4" />
                  ) : (
                    <TrendingDown className="w-4 h-4" />
                  )}
                  {(feed?.price.change24hPct ?? 0) >= 0 ? '+' : ''}
                  {(feed?.price.change24hPct ?? 0).toFixed(2)}%
                </div>
              </div>

              <div className="text-4xl font-bold font-mono tabular-nums tracking-tight text-white">
                {feed?.price.formatted ?? '—'}
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-white/8 text-xs">
                <div>
                  <div className="text-slate-400">Максимум 24ч</div>
                  <div className="font-mono font-semibold tabular-nums text-slate-100 mt-0.5">
                    ${feed?.price.high24h.toLocaleString('en-US') ?? '—'}
                  </div>
                </div>
                <div>
                  <div className="text-slate-400">Минимум 24ч</div>
                  <div className="font-mono font-semibold tabular-nums text-slate-100 mt-0.5">
                    ${feed?.price.low24h.toLocaleString('en-US') ?? '—'}
                  </div>
                </div>
              </div>
            </>
          )}

          {widgetKind === 'chart' && (
            <>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs text-slate-400 flex items-center gap-1.5">
                    <CandlestickChart className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Виджет графика · {timeframe}</span>
                  </div>
                  <div className="text-xl font-bold font-mono tabular-nums text-white mt-0.5">
                    {symbol} · {feed?.price.formatted ?? '—'}
                  </div>
                </div>
                <div className="text-right text-xs font-mono tabular-nums">
                  <div
                    className={
                      feed?.chart.trendBias === 'BULLISH'
                        ? 'text-emerald-400 font-semibold'
                        : feed?.chart.trendBias === 'BEARISH'
                          ? 'text-rose-400 font-semibold'
                          : 'text-amber-300 font-semibold'
                    }
                  >
                    {feed?.chart.trendBias === 'BULLISH'
                      ? 'Восходящий тренд'
                      : feed?.chart.trendBias === 'BEARISH'
                        ? 'Нисходящий тренд'
                        : 'Боковой диапазон'}
                  </div>
                  <div className="text-slate-400 mt-0.5">RSI(14): {feed?.chart.rsi14 ?? '—'}</div>
                </div>
              </div>

              <div className="h-[190px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartSeries} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="widgetChartFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10B981" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#10B981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="time" hide />
                    <YAxis domain={['auto', 'auto']} hide />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0B0F17',
                        borderColor: 'rgba(255,255,255,0.12)',
                        borderRadius: '10px',
                        fontSize: '12px',
                      }}
                      formatter={(value) => [`$${Number(value ?? 0).toLocaleString('en-US')}`, symbol]}
                    />
                    <Area
                      type="monotone"
                      dataKey="close"
                      stroke="#10B981"
                      strokeWidth={2}
                      fill="url(#widgetChartFill)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-white/8 text-xs font-mono tabular-nums">
                <div>
                  <div className="text-slate-400 font-sans">Поддержка</div>
                  <div className="text-emerald-300 font-semibold mt-0.5">${feed?.chart.support ?? '—'}</div>
                </div>
                <div>
                  <div className="text-slate-400 font-sans">EMA 20</div>
                  <div className="text-slate-100 font-semibold mt-0.5">${feed?.chart.ema20 ?? '—'}</div>
                </div>
                <div>
                  <div className="text-slate-400 font-sans">Сопротивление</div>
                  <div className="text-rose-300 font-semibold mt-0.5">${feed?.chart.resistance ?? '—'}</div>
                </div>
              </div>
            </>
          )}

          {widgetKind === 'position' && (
            <>
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-white flex items-center gap-2">
                  <Calculator className="w-4 h-4 text-emerald-400" />
                  <span>Виджет позиции · {symbol}</span>
                </div>
                <span className="text-xs font-mono tabular-nums text-slate-300">
                  {feed?.price.formatted ?? '—'}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs">
                <label className="space-y-1">
                  <span className="text-slate-400">Депозит ($)</span>
                  <input
                    type="number"
                    min={50}
                    step={100}
                    value={depositUsdt}
                    onChange={(e) => setDepositUsdt(Math.max(50, Number(e.target.value) || 50))}
                    className="w-full min-h-[40px] rounded-xl border border-white/10 bg-[#0B0F17] px-2.5 text-white font-mono tabular-nums"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-slate-400">Риск (%)</span>
                  <input
                    type="number"
                    min={0.25}
                    max={10}
                    step={0.25}
                    value={riskPct}
                    onChange={(e) => setRiskPct(Math.min(10, Math.max(0.25, Number(e.target.value) || 1)))}
                    className="w-full min-h-[40px] rounded-xl border border-white/10 bg-[#0B0F17] px-2.5 text-white font-mono tabular-nums"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-slate-400">Стоп (%)</span>
                  <input
                    type="number"
                    min={0.25}
                    max={25}
                    step={0.25}
                    value={stopPct}
                    onChange={(e) => setStopPct(Math.min(25, Math.max(0.25, Number(e.target.value) || 1)))}
                    className="w-full min-h-[40px] rounded-xl border border-white/10 bg-[#0B0F17] px-2.5 text-white font-mono tabular-nums"
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3 rounded-2xl border border-white/8 bg-[#0B0F17] p-3.5 text-xs font-mono tabular-nums">
                <div>
                  <div className="text-slate-400 font-sans">Объем лота ({symbol.replace('USDT', '')})</div>
                  <div className="text-xl font-bold text-emerald-400 mt-0.5">
                    {feed?.position.lotQty ?? '—'}
                  </div>
                </div>
                <div>
                  <div className="text-slate-400 font-sans">Объем позиции (USDT)</div>
                  <div className="text-xl font-bold text-white mt-0.5">
                    ${feed?.position.notionalUsdt.toLocaleString('en-US') ?? '—'}
                  </div>
                </div>
                <div>
                  <div className="text-slate-400 font-sans">Макс. риск / Стоп</div>
                  <div className="text-rose-300 mt-0.5">
                    -${feed?.position.riskUsdt ?? '—'} ({feed?.position.stopPrice ?? '—'})
                  </div>
                </div>
                <div>
                  <div className="text-slate-400 font-sans">Цель (R/R {feed?.position.rrRatio ?? '1:2.5'})</div>
                  <div className="text-emerald-300 mt-0.5">${feed?.position.takeProfitPrice ?? '—'}</div>
                </div>
              </div>
            </>
          )}

          {widgetKind === 'pnl' && (
            <>
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-white flex items-center gap-2">
                  <PieChartIcon className="w-4 h-4 text-emerald-400" />
                  <span>Виджет доходности</span>
                </div>
                <span className="text-xs text-slate-400">
                  Fear & Greed: {feed?.pnl.marketSentimentValue ?? '—'}/100
                </span>
              </div>

              {holdingsCount > 0 && portfolioReport.allocations.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center">
                  <div className="sm:col-span-5 h-[140px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={portfolioReport.allocations}
                          dataKey="valueUsdt"
                          nameKey="baseAsset"
                          cx="50%"
                          cy="50%"
                          innerRadius={36}
                          outerRadius={56}
                          paddingAngle={3}
                          stroke="none"
                        >
                          {portfolioReport.allocations.map((item) => (
                            <Cell key={item.symbol} fill={item.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#0B0F17',
                            borderColor: 'rgba(255,255,255,0.12)',
                            borderRadius: '10px',
                            fontSize: '12px',
                          }}
                          formatter={(value) => [`$${Number(value ?? 0).toFixed(2)}`, 'Стоимость']}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="sm:col-span-7 space-y-2">
                    <div className="text-2xl font-bold font-mono tabular-nums text-white">
                      ${portfolioReport.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div
                      className={`text-sm font-mono font-semibold tabular-nums ${
                        portfolioReport.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {portfolioReport.totalPnl >= 0 ? '+' : ''}${portfolioReport.totalPnl.toFixed(2)} (
                      {portfolioReport.totalPnlPct >= 0 ? '+' : ''}
                      {portfolioReport.totalPnlPct.toFixed(1)}%)
                    </div>
                    <div className="text-xs text-slate-400 font-mono tabular-nums">
                      Активов: {holdingsCount} · Вложено: ${portfolioReport.totalCost.toFixed(2)}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-white/8 bg-[#0B0F17] p-4 space-y-2 text-xs text-slate-300">
                  <div className="font-medium text-white">Активы портфеля еще не добавлены</div>
                  <p className="text-slate-400">
                    Добавьте активы во вкладке «Скринер», чтобы видеть суммарный капитал и распределение прямо здесь.
                  </p>
                  <button
                    type="button"
                    onClick={() => onExitToTerminal('screener')}
                    className="min-h-[38px] px-3 rounded-lg bg-emerald-600/20 border border-emerald-500/35 text-emerald-300 font-medium"
                  >
                    Перейти в Скринер
                  </button>
                </div>
              )}

              {feed?.pnl.topGainer && (
                <div className="pt-2 border-t border-white/8 flex items-center justify-between text-xs text-slate-400 font-mono tabular-nums">
                  <span>
                    Лидер 24ч: <strong className="text-emerald-400">{feed.pnl.topGainer.symbol}</strong> (+
                    {feed.pnl.topGainer.change24hPct}%)
                  </span>
                  <span>BTC: {feed.pnl.btcChange24hPct >= 0 ? '+' : ''}{feed.pnl.btcChange24hPct}%</span>
                </div>
              )}
            </>
          )}

          {widgetKind === 'strategies' && (
            <>
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-white flex items-center gap-2">
                  <Layers className="w-4 h-4 text-emerald-400" />
                  <span>Виджет стратегий</span>
                </div>
                <span className="text-xs text-slate-400 flex items-center gap-1">
                  <Activity className="w-3.5 h-3.5 text-cyan-400" />
                  Волат. {feed?.strategies.volatilityPct ?? '—'}%
                </span>
              </div>

              <div className="rounded-xl border border-white/8 bg-[#0B0F17] px-3.5 py-2.5 text-xs">
                <div className="text-slate-400">Режим рынка ({symbol})</div>
                <div className="text-sm font-semibold text-emerald-300 mt-0.5">
                  {feed?.strategies.recommendedBias ?? 'Анализ параметров...'}
                </div>
              </div>

              <div className="divide-y divide-white/8 text-xs">
                {activeStrategiesList.slice(0, 4).map((st) => (
                  <div key={st.id} className="py-2.5 flex items-center justify-between gap-2">
                    <div>
                      <div className="font-medium text-white">{st.name}</div>
                      <div className="text-slate-400 font-mono tabular-nums">
                        {st.marketType === 'futures' ? `Фьючерсы x${st.leverage}` : 'Спот'} · Риск {st.riskPerTradePct}%
                      </div>
                    </div>
                    <span className={st.enabled ? 'text-emerald-400 font-medium' : 'text-slate-500'}>
                      {st.enabled ? 'Активна' : 'Пауза'}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <footer className="w-full max-w-xl mx-auto pt-4 flex items-center justify-between text-[11px] text-slate-500">
        <span>AegisQuant · Автообновление 15 сек</span>
        <span>
          {feed?.updatedAt
            ? new Date(feed.updatedAt).toLocaleTimeString('ru-RU')
            : 'Синхронизация...'}
        </span>
      </footer>
    </div>
  );
};
