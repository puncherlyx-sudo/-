import React, { useMemo, useState } from 'react';
import { PieChart as PieChartIcon } from 'lucide-react';
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
import type { MarketType, TickerOverview } from '../types/domain';

interface MarketDominanceWidgetProps {
  tickers: TickerOverview[];
  marketType: MarketType;
  selectedSymbol: string;
  onSelectSymbol?: (symbol: string) => void;
}

type DominanceViewMode = 'groups' | 'top';

interface DominanceSlice {
  id: string;
  name: string;
  volumeUsdt: number;
  sharePct: number;
  weightedChangePct: number;
  color: string;
  symbol?: string;
}

const ALT_PALETTE = ['#10B981', '#A78BFA', '#FB7185', '#38BDF8', '#FBBF24', '#94A3B8'];

function formatCompactVolume(volUsdt: number): string {
  if (volUsdt >= 1_000_000_000) {
    return `$${(volUsdt / 1_000_000_000).toFixed(2)}B`;
  }
  if (volUsdt >= 1_000_000) {
    return `$${(volUsdt / 1_000_000).toFixed(0)}M`;
  }
  return `$${Math.round(volUsdt).toLocaleString('en-US')}`;
}

export const MarketDominanceWidget: React.FC<MarketDominanceWidgetProps> = ({
  tickers,
  marketType,
  selectedSymbol,
  onSelectSymbol,
}) => {
  const [viewMode, setViewMode] = useState<DominanceViewMode>('groups');
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const { totalVolumeUsdt, groupSlices, topAssetSlices, btcDomPct, altDomPct, marketRegime } =
    useMemo(() => {
      if (tickers.length === 0) {
        return {
          totalVolumeUsdt: 0,
          groupSlices: [] as DominanceSlice[],
          topAssetSlices: [] as DominanceSlice[],
          btcDomPct: 0,
          altDomPct: 0,
          marketRegime: 'Ожидание рыночных данных...',
        };
      }

      const totalVol = tickers.reduce((acc, t) => acc + Math.max(0, t.volume24hUsdt), 0);
      const safeTotal = totalVol > 0 ? totalVol : 1;

      const btc = tickers.find((t) => t.symbol === 'BTCUSDT' || t.baseAsset === 'BTC');
      const eth = tickers.find((t) => t.symbol === 'ETHUSDT' || t.baseAsset === 'ETH');
      const alts = tickers.filter(
        (t) =>
          t.symbol !== btc?.symbol &&
          t.symbol !== eth?.symbol &&
          t.baseAsset !== 'BTC' &&
          t.baseAsset !== 'ETH'
      );

      const btcVol = btc ? Math.max(0, btc.volume24hUsdt) : 0;
      const ethVol = eth ? Math.max(0, eth.volume24hUsdt) : 0;
      const altsVol = alts.reduce((acc, t) => acc + Math.max(0, t.volume24hUsdt), 0);

      const altsWeightedChange =
        altsVol > 0
          ? alts.reduce((acc, t) => acc + t.change24hPct * Math.max(0, t.volume24hUsdt), 0) / altsVol
          : 0;

      const groups: DominanceSlice[] = [
        {
          id: 'BTC',
          name: 'Bitcoin (BTC)',
          volumeUsdt: btcVol,
          sharePct: (btcVol / safeTotal) * 100,
          weightedChangePct: btc?.change24hPct ?? 0,
          color: '#F59E0B',
          symbol: btc?.symbol ?? 'BTCUSDT',
        },
        {
          id: 'ETH',
          name: 'Ethereum (ETH)',
          volumeUsdt: ethVol,
          sharePct: (ethVol / safeTotal) * 100,
          weightedChangePct: eth?.change24hPct ?? 0,
          color: '#22D3EE',
          symbol: eth?.symbol ?? 'ETHUSDT',
        },
        {
          id: 'ALTS',
          name: `Альткоины (${alts.length})`,
          volumeUsdt: altsVol,
          sharePct: (altsVol / safeTotal) * 100,
          weightedChangePct: altsWeightedChange,
          color: '#10B981',
        },
      ].filter((g) => g.volumeUsdt > 0);

      const sortedByVol = [...tickers].sort((a, b) => b.volume24hUsdt - a.volume24hUsdt);
      const top5 = sortedByVol.slice(0, 5);
      const rest = sortedByVol.slice(5);
      const restVol = rest.reduce((acc, t) => acc + Math.max(0, t.volume24hUsdt), 0);
      const restChange =
        restVol > 0
          ? rest.reduce((acc, t) => acc + t.change24hPct * Math.max(0, t.volume24hUsdt), 0) / restVol
          : 0;

      const topAssets: DominanceSlice[] = top5.map((t, idx) => ({
        id: t.baseAsset,
        name: t.baseAsset,
        volumeUsdt: Math.max(0, t.volume24hUsdt),
        sharePct: (Math.max(0, t.volume24hUsdt) / safeTotal) * 100,
        weightedChangePct: t.change24hPct,
        color:
          t.baseAsset === 'BTC'
            ? '#F59E0B'
            : t.baseAsset === 'ETH'
              ? '#22D3EE'
              : ALT_PALETTE[idx % ALT_PALETTE.length],
        symbol: t.symbol,
      }));

      if (restVol > 0) {
        topAssets.push({
          id: 'OTHER',
          name: `Прочие (${rest.length})`,
          volumeUsdt: restVol,
          sharePct: (restVol / safeTotal) * 100,
          weightedChangePct: restChange,
          color: '#64748B',
        });
      }

      const btcShare = (btcVol / safeTotal) * 100;
      const altShare = (altsVol / safeTotal) * 100;

      let regime = 'Сбалансированное распределение оборота между BTC и альткоинами';
      if (btcShare >= 48) {
        regime = 'Концентрация ликвидности в BTC · высокая доля главного актива';
      } else if (altShare >= 45) {
        regime = 'Ротация объема в альткоины · повышенная активность второго эшелона';
      }

      return {
        totalVolumeUsdt: totalVol,
        groupSlices: groups,
        topAssetSlices: topAssets,
        btcDomPct: btcShare,
        altDomPct: altShare,
        marketRegime: regime,
      };
    }, [tickers]);

  const activeSlice = useMemo(() => {
    if (!hoveredId) return null;
    return (
      groupSlices.find((s) => s.id === hoveredId) ??
      topAssetSlices.find((s) => s.id === hoveredId) ??
      null
    );
  }, [hoveredId, groupSlices, topAssetSlices]);

  return (
    <section
      aria-label="Индикатор рыночного доминирования"
      className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-5 space-y-4"
    >
      {/* Header + Segmented View Switch */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <PieChartIcon className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>Индикатор рыночного доминирования</span>
          </h3>
          <p className="mt-0.5 text-xs text-slate-400">
            Доли объема торгов 24ч · {marketType === 'futures' ? 'Фьючерсы USDT-M' : 'Спот'}
          </p>
        </div>

        <div className="inline-flex items-center p-0.5 rounded-xl bg-[#0B0F17] border border-white/8 shrink-0">
          <motion.button
            type="button"
            whileTap={{ scale: 0.96 }}
            onClick={() => setViewMode('groups')}
            className={`relative min-h-[34px] px-2.5 rounded-lg text-[11px] font-medium transition-colors whitespace-nowrap ${
              viewMode === 'groups' ? 'text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {viewMode === 'groups' && (
              <motion.span
                layoutId="dom-mode-pill"
                transition={{ type: 'spring', stiffness: 450, damping: 34 }}
                className="absolute inset-0 rounded-lg bg-cyan-500/20 border border-cyan-500/35"
              />
            )}
            <span className="relative z-10">BTC / ETH / Альты</span>
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.96 }}
            onClick={() => setViewMode('top')}
            className={`relative min-h-[34px] px-2.5 rounded-lg text-[11px] font-medium transition-colors whitespace-nowrap ${
              viewMode === 'top' ? 'text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {viewMode === 'top' && (
              <motion.span
                layoutId="dom-mode-pill"
                transition={{ type: 'spring', stiffness: 450, damping: 34 }}
                className="absolute inset-0 rounded-lg bg-cyan-500/20 border border-cyan-500/35"
              />
            )}
            <span className="relative z-10">Топ активы</span>
          </motion.button>
        </div>
      </div>

      {tickers.length === 0 ? (
        <div className="h-[190px] rounded-xl bg-[#0B0F17] border border-white/8 flex items-center justify-center text-xs text-slate-500">
          Загрузка распределения объема торгов...
        </div>
      ) : viewMode === 'groups' ? (
        <>
          {/* Donut Chart + Center Readout */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center">
            <div className="sm:col-span-5 relative h-[175px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={groupSlices}
                    dataKey="volumeUsdt"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={48}
                    outerRadius={72}
                    paddingAngle={3}
                    stroke="none"
                    onMouseEnter={(_, idx) => setHoveredId(groupSlices[idx]?.id ?? null)}
                    onMouseLeave={() => setHoveredId(null)}
                  >
                    {groupSlices.map((slice) => (
                      <Cell
                        key={slice.id}
                        fill={slice.color}
                        opacity={hoveredId && hoveredId !== slice.id ? 0.45 : 1}
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
                    formatter={(value, _name, item) => {
                      const slice = item?.payload as DominanceSlice | undefined;
                      const pct = slice ? `${slice.sharePct.toFixed(1)}%` : '';
                      return [`${formatCompactVolume(Number(value ?? 0))} (${pct})`, 'Объем 24ч'];
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>

              {/* Center Metric Overlay */}
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center px-2">
                <span className="text-[10px] text-slate-400">
                  {activeSlice ? activeSlice.id : 'Оборот 24ч'}
                </span>
                <span className="text-sm font-bold font-mono tabular-nums text-white mt-0.5">
                  {activeSlice
                    ? `${activeSlice.sharePct.toFixed(1)}%`
                    : formatCompactVolume(totalVolumeUsdt)}
                </span>
              </div>
            </div>

            {/* Breakdown Table */}
            <div className="sm:col-span-7 divide-y divide-white/8 text-xs">
              {groupSlices.map((slice) => {
                const isHighlighted =
                  hoveredId === slice.id || (slice.symbol && slice.symbol === selectedSymbol);
                return (
                  <button
                    key={slice.id}
                    type="button"
                    disabled={!slice.symbol || !onSelectSymbol}
                    onMouseEnter={() => setHoveredId(slice.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    onClick={() => slice.symbol && onSelectSymbol?.(slice.symbol)}
                    className={`w-full py-2.5 px-2 -mx-2 rounded-lg flex items-center justify-between gap-2 text-left transition-colors ${
                      isHighlighted ? 'bg-white/[0.04]' : 'hover:bg-white/[0.02]'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: slice.color }}
                      />
                      <div className="min-w-0">
                        <div className="font-medium text-white truncate">{slice.name}</div>
                        <div className="text-[11px] font-mono tabular-nums text-slate-400">
                          {formatCompactVolume(slice.volumeUsdt)}
                        </div>
                      </div>
                    </div>

                    <div className="text-right font-mono tabular-nums shrink-0">
                      <div className="font-bold text-white">{slice.sharePct.toFixed(1)}%</div>
                      <div
                        className={`text-[11px] ${
                          slice.weightedChangePct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {slice.weightedChangePct >= 0 ? '+' : ''}
                        {slice.weightedChangePct.toFixed(2)}%
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Proportional Stacked Bar */}
          <div className="space-y-1.5">
            <div className="h-2.5 w-full rounded-full overflow-hidden flex bg-[#0B0F17]">
              {groupSlices.map((slice) => (
                <div
                  key={`bar-${slice.id}`}
                  style={{
                    width: `${Math.max(2, slice.sharePct)}%`,
                    backgroundColor: slice.color,
                  }}
                  title={`${slice.name}: ${slice.sharePct.toFixed(1)}%`}
                  className="h-full transition-all duration-300"
                />
              ))}
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono tabular-nums">
              <span>BTC: {btcDomPct.toFixed(1)}%</span>
              <span>Альткоины: {altDomPct.toFixed(1)}%</span>
            </div>
          </div>
        </>
      ) : (
        /* Top Assets Horizontal/Vertical Recharts Bar Breakdown */
        <div className="space-y-3">
          <div className="h-[190px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topAssetSlices} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis
                  dataKey="id"
                  tick={{ fill: '#94A3B8', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: '#64748B', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0E1420',
                    borderColor: 'rgba(255,255,255,0.12)',
                    borderRadius: '10px',
                    fontSize: '12px',
                    color: '#F1F5F9',
                  }}
                  formatter={(value, _name, item) => {
                    const slice = item?.payload as DominanceSlice | undefined;
                    const volText = slice ? formatCompactVolume(slice.volumeUsdt) : '';
                    return [`${Number(value ?? 0).toFixed(1)}% (${volText})`, 'Доля оборота'];
                  }}
                />
                <Bar
                  dataKey="sharePct"
                  radius={[6, 6, 0, 0]}
                  onClick={(entry) => {
                    const payload = entry as unknown as DominanceSlice | undefined;
                    if (payload?.symbol && onSelectSymbol) {
                      onSelectSymbol(payload.symbol);
                    }
                  }}
                >
                  {topAssetSlices.map((slice) => (
                    <Cell
                      key={`top-bar-${slice.id}`}
                      fill={slice.color}
                      cursor={slice.symbol ? 'pointer' : 'default'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="text-[11px] text-slate-400 flex items-center justify-between font-mono tabular-nums">
            <span>Совокупный объем выборки:</span>
            <strong className="text-slate-200">{formatCompactVolume(totalVolumeUsdt)}</strong>
          </div>
        </div>
      )}

      {/* Market Regime Note */}
      <div className="pt-2.5 border-t border-white/8 text-[11px] text-slate-400 leading-relaxed">
        {marketRegime}
      </div>
    </section>
  );
};
