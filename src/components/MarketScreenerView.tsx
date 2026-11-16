import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownUp,
  ArrowRight,
  BarChart2,
  Flame,
  PieChart as PieChartIcon,
  Plus,
  RefreshCw,
  Search,
  Star,
  Table2,
  Trash2,
  Wallet,
} from 'lucide-react';
import { motion } from 'motion/react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TRADING_PAIRS } from '../data/strategies';
import type { PaperPortfolioReport } from '../hooks/usePaperPortfolio';
import type { MarketType, PortfolioHolding, TickerOverview } from '../types/domain';
import { StaggerDeck, WorkspaceShell } from './MotionPrimitives';

export type ScreenerSection = 'table' | 'momentum' | 'portfolio';

interface MarketScreenerViewProps {
  onOpenPairOnMarket: (symbol: string, marketType: MarketType) => void;
  holdings: PortfolioHolding[];
  portfolioReport: PaperPortfolioReport;
  onAddHolding: (symbol: string, amount: number, avgEntryPrice: number) => void;
  onRemoveHolding: (id: string) => void;
  externalSection?: { section: ScreenerSection; nonce: number } | null;
}

const WATCHLIST_KEY = 'aegisquant_watchlist_v1';

const ALLOCATION_COLORS = ['#10B981', '#22D3EE', '#F59E0B', '#A78BFA', '#FB7185', '#38BDF8'];

type ScreenerFilter = 'all' | 'gainers' | 'losers' | 'volume' | 'watchlist';
type SortField = 'volume' | 'change' | 'price' | 'range';

function formatUsd(val: number): string {
  if (val >= 1000) return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (val >= 10) return `$${val.toFixed(3)}`;
  return `$${val.toFixed(4)}`;
}

export const MarketScreenerView: React.FC<MarketScreenerViewProps> = ({
  onOpenPairOnMarket,
  holdings,
  portfolioReport,
  onAddHolding,
  onRemoveHolding,
  externalSection,
}) => {
  const [screenerSection, setScreenerSection] = useState<ScreenerSection>('table');
  const [marketType, setMarketType] = useState<MarketType>('spot');
  const [tickers, setTickers] = useState<TickerOverview[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ScreenerFilter>('all');
  const [sortBy, setSortBy] = useState<SortField>('volume');
  const [sortAsc, setSortAsc] = useState(false);

  const [watchlist, setWatchlist] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(WATCHLIST_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string');
      }
    } catch {
      // Ignore storage error
    }
    return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
  });

  const [newSymbol, setNewSymbol] = useState('BTCUSDT');
  const [newAmount, setNewAmount] = useState('0.1');
  const [newEntryPrice, setNewEntryPrice] = useState('90000');

  useEffect(() => {
    if (externalSection) {
      setScreenerSection(externalSection.section);
    }
  }, [externalSection]);

  useEffect(() => {
    const handleTourFocus = (evt: Event) => {
      const targetId = (evt as CustomEvent<string>).detail;
      if (targetId === 'tour-screener-overview') {
        setScreenerSection('table');
      }
    };
    window.addEventListener('aegis:tour-focus', handleTourFocus);
    return () => window.removeEventListener('aegis:tour-focus', handleTourFocus);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist));
    } catch {
      // Ignore storage errors
    }
  }, [watchlist]);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/market/overview?marketType=${marketType}`);
      if (res.ok) {
        const data = (await res.json()) as { tickers: TickerOverview[] };
        setTickers(data.tickers || []);
      }
    } catch {
      // Keep prior tickers if network glitch
    } finally {
      setLoading(false);
    }
  }, [marketType]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const toggleWatchlist = (sym: string) => {
    setWatchlist((prev) => (prev.includes(sym) ? prev.filter((s) => s !== sym) : [...prev, sym]));
  };

  const handleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortAsc((v) => !v);
    } else {
      setSortBy(field);
      setSortAsc(false);
    }
  };

  const marketSummary = useMemo(() => {
    if (tickers.length === 0) {
      return { avgChange: 0, totalVolM: 0, gainers: 0, losers: 0, topLeader: null as TickerOverview | null };
    }
    const avgChange = tickers.reduce((acc, t) => acc + t.change24hPct, 0) / tickers.length;
    const totalVolM = tickers.reduce((acc, t) => acc + t.volume24hUsdt, 0) / 1_000_000;
    const gainers = tickers.filter((t) => t.change24hPct > 0).length;
    const losers = tickers.filter((t) => t.change24hPct < 0).length;
    const topLeader = [...tickers].sort((a, b) => b.change24hPct - a.change24hPct)[0] ?? null;
    return { avgChange, totalVolM, gainers, losers, topLeader };
  }, [tickers]);

  const filteredTickers = useMemo(() => {
    const q = search.trim().toUpperCase();
    const list = tickers.filter((t) => {
      if (q && !t.symbol.includes(q) && !t.baseAsset.includes(q)) return false;
      if (filter === 'gainers') return t.change24hPct > 0;
      if (filter === 'losers') return t.change24hPct < 0;
      if (filter === 'volume') return t.volume24hUsdt >= 150_000_000;
      if (filter === 'watchlist') return watchlist.includes(t.symbol);
      return true;
    });

    const sorted = [...list].sort((a, b) => {
      let diff = 0;
      if (sortBy === 'volume') diff = a.volume24hUsdt - b.volume24hUsdt;
      else if (sortBy === 'change') diff = a.change24hPct - b.change24hPct;
      else if (sortBy === 'price') diff = a.price - b.price;
      else {
        const rangeA = a.low24h > 0 ? ((a.high24h - a.low24h) / a.low24h) * 100 : 0;
        const rangeB = b.low24h > 0 ? ((b.high24h - b.low24h) / b.low24h) * 100 : 0;
        diff = rangeA - rangeB;
      }
      return sortAsc ? diff : -diff;
    });

    return sorted;
  }, [tickers, search, filter, watchlist, sortBy, sortAsc]);

  const momentumChartData = useMemo(
    () =>
      tickers.map((t) => ({
        name: t.baseAsset,
        changePct: t.change24hPct,
        volumeM: Number((t.volume24hUsdt / 1_000_000).toFixed(1)),
      })),
    [tickers]
  );

  const handlePrefillMarketPrice = (sym: string) => {
    const found = tickers.find((t) => t.symbol === sym);
    if (found) {
      setNewEntryPrice(String(found.price));
    }
  };

  const handleAddHolding = (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = Number(newAmount);
    const entryNum = Number(newEntryPrice);
    if (!Number.isFinite(amountNum) || amountNum <= 0 || !Number.isFinite(entryNum) || entryNum <= 0) {
      return;
    }
    onAddHolding(newSymbol, amountNum, entryNum);
  };

  const sectionTabs = useMemo(
    () => [
      {
        id: 'table' as const,
        label: 'Таблица пар',
        icon: <Table2 className="w-3.5 h-3.5 text-cyan-400" />,
        meta: tickers.length || undefined,
      },
      {
        id: 'momentum' as const,
        label: 'Карта импульса',
        icon: <BarChart2 className="w-3.5 h-3.5 text-emerald-400" />,
      },
      {
        id: 'portfolio' as const,
        label: 'Портфель',
        icon: <Wallet className="w-3.5 h-3.5 text-amber-400" />,
        meta: holdings.length > 0 ? holdings.length : undefined,
      },
    ],
    [tickers.length, holdings.length]
  );

  const sidebarControls = (
    <div data-tour-id="tour-screener-overview" className="space-y-2.5">
      <div className="grid grid-cols-2 p-1 rounded-xl bg-[#0B0F17] border border-white/8">
        <button
          type="button"
          onClick={() => setMarketType('spot')}
          className={`min-h-[34px] rounded-lg text-xs font-semibold transition-colors ${
            marketType === 'spot' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Спот
        </button>
        <button
          type="button"
          onClick={() => setMarketType('futures')}
          className={`min-h-[34px] rounded-lg text-xs font-semibold transition-colors ${
            marketType === 'futures' ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Фьючерсы
        </button>
      </div>

      <button
        type="button"
        onClick={() => void loadOverview()}
        disabled={loading}
        className="w-full min-h-[34px] px-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-xs text-slate-200 inline-flex items-center justify-center gap-1.5 transition-colors"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        <span>Обновить котировки</span>
      </button>
    </div>
  );

  const sidebarBottom = (
    <div className="space-y-1.5 text-xs font-mono tabular-nums">
      <div className="flex items-center justify-between">
        <span className="font-sans text-slate-400">Импульс 24ч</span>
        <span className={marketSummary.avgChange >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
          {marketSummary.avgChange >= 0 ? '+' : ''}
          {marketSummary.avgChange.toFixed(2)}%
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className="font-sans text-slate-400">Объем 24ч</span>
        <span className="text-cyan-300">${marketSummary.totalVolM.toFixed(0)}M</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="font-sans text-slate-400">Рост / Падение</span>
        <span>
          <span className="text-emerald-400">{marketSummary.gainers}</span>
          <span className="text-slate-600">/</span>
          <span className="text-rose-400">{marketSummary.losers}</span>
        </span>
      </div>
    </div>
  );

  return (
    <StaggerDeck>
      <WorkspaceShell
        title="Скринер рынка"
        subtitle={
          marketSummary.topLeader
            ? `Лидер: ${marketSummary.topLeader.baseAsset} (${marketSummary.topLeader.change24hPct >= 0 ? '+' : ''}${marketSummary.topLeader.change24hPct}%)`
            : '10 ликвидных пар'
        }
        icon={<Flame className="w-5 h-5 text-cyan-400" />}
        items={sectionTabs}
        activeId={screenerSection}
        onChange={setScreenerSection}
        layoutId="screener-workspace-nav"
        accent="cyan"
        sidebarTopSlot={sidebarControls}
        sidebarBottomSlot={sidebarBottom}
      >
        {screenerSection === 'table' && (
          <section className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow overflow-hidden">
            <div className="p-4 border-b border-white/8 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { id: 'all', label: `Все (${tickers.length})` },
                    { id: 'gainers', label: 'В плюсе' },
                    { id: 'losers', label: 'В минусе' },
                    { id: 'volume', label: 'Топ объём' },
                    { id: 'watchlist', label: `Избранное (${watchlist.length})` },
                  ] as const
                ).map((f) => {
                  const active = filter === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setFilter(f.id)}
                      className={`min-h-[34px] px-2.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
                        active
                          ? 'border-cyan-500/45 bg-cyan-500/15 text-cyan-200'
                          : 'border-white/8 bg-[#0B0F17] text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {f.label}
                    </button>
                  );
                })}
              </div>

              <div className="relative w-full xl:w-56">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Поиск пары (BTC, SOL)..."
                  className="w-full min-h-[36px] rounded-xl border border-white/10 bg-[#0B0F17] pl-8 pr-3 text-xs text-white placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-white/8 text-slate-400">
                    <th className="py-2.5 px-4 font-medium">Пара</th>
                    <th className="py-2.5 px-3 font-medium text-right">
                      <button
                        type="button"
                        onClick={() => handleSort('price')}
                        className="inline-flex items-center gap-1 hover:text-white"
                      >
                        <span>Цена</span>
                        <ArrowDownUp className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="py-2.5 px-3 font-medium text-right">
                      <button
                        type="button"
                        onClick={() => handleSort('change')}
                        className="inline-flex items-center gap-1 hover:text-white"
                      >
                        <span>24ч %</span>
                        <ArrowDownUp className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="py-2.5 px-3 font-medium hidden md:table-cell">
                      <button
                        type="button"
                        onClick={() => handleSort('range')}
                        className="inline-flex items-center gap-1 hover:text-white"
                      >
                        <span>Диапазон</span>
                        <ArrowDownUp className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="py-2.5 px-3 font-medium text-right">
                      <button
                        type="button"
                        onClick={() => handleSort('volume')}
                        className="inline-flex items-center gap-1 hover:text-white"
                      >
                        <span>Объем</span>
                        <ArrowDownUp className="w-3 h-3" />
                      </button>
                    </th>
                    {marketType === 'futures' && <th className="py-2.5 px-3 font-medium text-right">Funding</th>}
                    <th className="py-2.5 px-4 font-medium text-right">График</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/6 font-mono tabular-nums">
                  {filteredTickers.length === 0 ? (
                    <tr>
                      <td colSpan={marketType === 'futures' ? 7 : 6} className="py-8 text-center font-sans text-slate-400">
                        По выбранным фильтрам пары не найдены.
                      </td>
                    </tr>
                  ) : (
                    filteredTickers.map((t) => {
                      const isStarred = watchlist.includes(t.symbol);
                      const span = Math.max(1e-9, t.high24h - t.low24h);
                      const posInRange = Math.max(0, Math.min(100, Math.round(((t.price - t.low24h) / span) * 100)));
                      const rangePct = t.low24h > 0 ? ((span / t.low24h) * 100).toFixed(1) : '0.0';

                      return (
                        <tr key={t.symbol} className="hover:bg-white/[0.03] transition-colors">
                          <td className="py-2.5 px-4 font-sans">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => toggleWatchlist(t.symbol)}
                                aria-label={`Добавить ${t.symbol} в избранное`}
                                className={`p-1 rounded-md transition-colors ${
                                  isStarred ? 'text-amber-400' : 'text-slate-600 hover:text-slate-300'
                                }`}
                              >
                                <Star className={`w-3.5 h-3.5 ${isStarred ? 'fill-amber-400' : ''}`} />
                              </button>
                              <div>
                                <span className="font-semibold text-white">{t.baseAsset}</span>
                                <span className="text-slate-500"> / USDT</span>
                              </div>
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-100">{formatUsd(t.price)}</td>
                          <td
                            className={`py-2.5 px-3 text-right font-semibold ${
                              t.change24hPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {t.change24hPct >= 0 ? '+' : ''}
                            {t.change24hPct}%
                          </td>
                          <td className="py-2.5 px-3 hidden md:table-cell">
                            <div className="w-28 space-y-1">
                              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                                <div
                                  style={{ width: `${Math.max(6, posInRange)}%` }}
                                  className="h-full rounded-full bg-gradient-to-r from-rose-400 via-amber-400 to-emerald-400"
                                />
                              </div>
                              <div className="flex justify-between text-[10px] text-slate-500">
                                <span>{rangePct}%</span>
                              </div>
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-300">
                            ${(t.volume24hUsdt / 1_000_000).toFixed(1)}M
                          </td>
                          {marketType === 'futures' && (
                            <td className="py-2.5 px-3 text-right text-amber-300">
                              {(t.fundingRatePct ?? 0.01).toFixed(4)}%
                            </td>
                          )}
                          <td className="py-2.5 px-4 text-right font-sans">
                            <button
                              type="button"
                              onClick={() => onOpenPairOnMarket(t.symbol, marketType)}
                              className="min-h-[30px] px-2.5 rounded-lg border border-emerald-500/35 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 text-xs font-medium inline-flex items-center gap-1 whitespace-nowrap transition-colors"
                            >
                              <span>Открыть</span>
                              <ArrowRight className="w-3 h-3" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {screenerSection === 'momentum' && (
          <section className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <BarChart2 className="w-4 h-4 text-cyan-400" />
                  <span>Карта импульса 24ч (%)</span>
                </h3>
                <p className="mt-0.5 text-xs text-slate-400">
                  Сравнение относительной силы ликвидных активов за последние 24 часа.
                </p>
              </div>
              <span className="text-xs font-mono text-slate-400">
                {marketType === 'futures' ? 'Фьючерсы' : 'Спот'}
              </span>
            </div>

            <div className="h-[320px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={momentumChartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: '#94A3B8', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fill: '#64748B', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => `${v}%`}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                    contentStyle={{
                      backgroundColor: '#0E1420',
                      borderColor: 'rgba(255,255,255,0.12)',
                      borderRadius: '12px',
                      fontSize: '12px',
                      color: '#F1F5F9',
                    }}
                    formatter={(value) => {
                      const num = Number(value ?? 0);
                      return [`${num >= 0 ? '+' : ''}${num}%`, 'Изменение 24ч'];
                    }}
                  />
                  <Bar dataKey="changePct" radius={[6, 6, 0, 0]}>
                    {momentumChartData.map((entry, idx) => (
                      <Cell
                        key={`bar-${entry.name}-${idx}`}
                        fill={entry.changePct >= 0 ? '#10B981' : '#EF4444'}
                        fillOpacity={0.85}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        )}

        {screenerSection === 'portfolio' && (
          <section className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-emerald-400" />
                  <span>Симулятор спот-портфеля</span>
                </h3>
                <p className="mt-0.5 text-xs text-slate-400">
                  Учебный портфель с автоматической переоценкой по живым котировкам.
                </p>
              </div>
              <div className="text-right font-mono tabular-nums">
                <div className="text-lg font-bold text-white">
                  ${portfolioReport.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div
                  className={`text-xs font-semibold ${
                    portfolioReport.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  PnL: {portfolioReport.totalPnl >= 0 ? '+' : ''}${portfolioReport.totalPnl.toFixed(2)} (
                  {portfolioReport.totalPnlPct >= 0 ? '+' : ''}
                  {portfolioReport.totalPnlPct.toFixed(2)}%)
                </div>
              </div>
            </div>

            <form onSubmit={handleAddHolding} className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
              <div className="sm:col-span-4">
                <label htmlFor="pf-symbol" className="block text-[11px] text-slate-400 mb-1">
                  Актив
                </label>
                <select
                  id="pf-symbol"
                  value={newSymbol}
                  onChange={(e) => {
                    setNewSymbol(e.target.value);
                    handlePrefillMarketPrice(e.target.value);
                  }}
                  className="w-full min-h-[38px] rounded-xl border border-white/10 bg-[#0B0F17] px-3 text-xs font-mono text-white focus:border-emerald-500 focus:outline-none"
                >
                  {TRADING_PAIRS.map((p) => (
                    <option key={p.symbol} value={p.symbol}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-3">
                <label htmlFor="pf-amount" className="block text-[11px] text-slate-400 mb-1">
                  Кол-во
                </label>
                <input
                  id="pf-amount"
                  type="number"
                  step="any"
                  min="0.0001"
                  value={newAmount}
                  onChange={(e) => setNewAmount(e.target.value)}
                  className="w-full min-h-[38px] rounded-xl border border-white/10 bg-[#0B0F17] px-3 text-xs font-mono text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div className="sm:col-span-3">
                <label htmlFor="pf-price" className="block text-[11px] text-slate-400 mb-1">
                  Цена входа ($)
                </label>
                <input
                  id="pf-price"
                  type="number"
                  step="any"
                  min="0.0001"
                  value={newEntryPrice}
                  onChange={(e) => setNewEntryPrice(e.target.value)}
                  className="w-full min-h-[38px] rounded-xl border border-white/10 bg-[#0B0F17] px-3 text-xs font-mono text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div className="sm:col-span-2">
                <button
                  type="submit"
                  className="w-full min-h-[38px] rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold inline-flex items-center justify-center gap-1 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Добавить</span>
                </button>
              </div>
            </form>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
              <div className="md:col-span-7 overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-white/8 text-slate-400">
                      <th className="py-2 font-medium">Актив</th>
                      <th className="py-2 font-medium text-right">Оценка</th>
                      <th className="py-2 font-medium text-right">PnL %</th>
                      <th className="py-2 font-medium text-right" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/6 font-mono tabular-nums">
                    {portfolioReport.rows.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-6 text-center font-sans text-slate-400">
                          Добавьте первый актив, чтобы рассчитать распределение портфеля.
                        </td>
                      </tr>
                    ) : (
                      portfolioReport.rows.map((row) => (
                        <tr key={row.id}>
                          <td className="py-2 font-sans">
                            <div className="font-semibold text-white">{row.baseAsset}</div>
                            <div className="text-[11px] font-mono text-slate-400">
                              {row.amount} × {formatUsd(row.avgEntryPrice)}
                            </div>
                          </td>
                          <td className="py-2 text-right text-slate-100">${row.valueUsdt.toFixed(2)}</td>
                          <td
                            className={`py-2 text-right font-semibold ${
                              row.pnlPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {row.pnlPct >= 0 ? '+' : ''}
                            {row.pnlPct.toFixed(1)}%
                          </td>
                          <td className="py-2 text-right">
                            <button
                              type="button"
                              onClick={() => onRemoveHolding(row.id)}
                              aria-label={`Удалить позицию ${row.baseAsset}`}
                              className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="md:col-span-5 flex flex-col items-center">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mb-1">
                  <PieChartIcon className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Распределение</span>
                </div>
                <div className="h-[180px] w-full">
                  {portfolioReport.rows.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={portfolioReport.rows}
                          dataKey="valueUsdt"
                          nameKey="baseAsset"
                          cx="50%"
                          cy="50%"
                          innerRadius={44}
                          outerRadius={70}
                          paddingAngle={3}
                          stroke="none"
                        >
                          {portfolioReport.rows.map((entry, idx) => (
                            <Cell
                              key={`slice-${entry.id}`}
                              fill={ALLOCATION_COLORS[idx % ALLOCATION_COLORS.length]}
                            />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#0E1420',
                            borderColor: 'rgba(255,255,255,0.12)',
                            borderRadius: '10px',
                            fontSize: '12px',
                            color: '#F1F5F9',
                          }}
                          formatter={(value) => [`$${Number(value ?? 0).toFixed(2)}`, 'Стоимость']}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-xs text-slate-500">Нет активов</div>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}
      </WorkspaceShell>
    </StaggerDeck>
  );
};
