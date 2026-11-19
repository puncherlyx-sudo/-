import React, { useEffect, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { BellPlus, Star } from 'lucide-react';
import type { MarketType, PriceAlertRecord } from '../types/domain';
import {
  DEFAULT_MARKET_COLUMNS,
  type MarketVisibleColumns,
} from './ColumnSelectorMenu';
import { MiniSparkline } from './MiniSparkline';

export interface EnrichedMarketPair {
  symbol: string;
  label: string;
  name: string;
  baseAsset: string;
  category?: string;
  aliases?: string[];
  price: number | null;
  change24hPct: number | null;
  volume24hUsdt: number;
  marketCapUsdt?: number;
  fundingRatePct?: number;
  sparkline24h?: number[];
  isFavorite: boolean;
  isNewListing?: boolean;
}

function formatUsdCompact(val: number): string {
  if (val >= 1000) return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (val >= 10) return `$${val.toFixed(3)}`;
  return `$${val.toFixed(4)}`;
}

function formatUsdAbbrev(val: number): string {
  if (!Number.isFinite(val) || val <= 0) return '—';
  if (val >= 1_000_000_000_000) return `$${(val / 1_000_000_000_000).toFixed(2)}T`;
  if (val >= 1_000_000_000) return `$${(val / 1_000_000_000).toFixed(2)}B`;
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
}

interface VirtualizedAssetStripProps {
  items: EnrichedMarketPair[];
  selectedSymbol: string;
  marketType: MarketType;
  priceAlerts: PriceAlertRecord[];
  visibleColumns?: MarketVisibleColumns;
  onSelectSymbol: (symbol: string) => void;
  onToggleFavorite: (symbol: string) => void;
  onNotifyAsset: (asset: EnrichedMarketPair) => void;
}

export const VirtualizedAssetStrip: React.FC<VirtualizedAssetStripProps> = ({
  items,
  selectedSymbol,
  marketType,
  priceAlerts,
  visibleColumns = DEFAULT_MARKET_COLUMNS,
  onSelectSymbol,
  onToggleFavorite,
  onNotifyAsset,
}) => {
  const parentRef = useRef<HTMLDivElement | null>(null);

  const estimatedChipWidth = useMemo(() => {
    let w = 188;
    if (visibleColumns.sparkline) w += 44;
    if (visibleColumns.price) w += 82;
    if (visibleColumns.change24h) w += 68;
    if (visibleColumns.volume) w += 64;
    if (visibleColumns.marketCap) w += 68;
    return w;
  }, [visibleColumns]);

  const columnVirtualizer = useVirtualizer({
    horizontal: true,
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimatedChipWidth,
    gap: 8,
    overscan: 3,
  });

  useEffect(() => {
    columnVirtualizer.measure();
  }, [items.length, estimatedChipWidth, columnVirtualizer]);

  return (
    <div
      ref={parentRef}
      role="list"
      aria-label="Виртуализированная лента отфильтрованных активов"
      className="w-full overflow-x-auto no-scrollbar pb-0.5"
    >
      <div
        style={{
          width: `${columnVirtualizer.getTotalSize()}px`,
          height: '38px',
          position: 'relative',
        }}
      >
        {columnVirtualizer.getVirtualItems().map((virtualCol) => {
          const pair = items[virtualCol.index];
          if (!pair) return null;
          const isSelected = pair.symbol === selectedSymbol;
          const activeAlertsForAsset = priceAlerts.filter(
            (a) => a.symbol === pair.symbol && a.marketType === marketType && a.active
          ).length;

          return (
            <div
              key={pair.symbol}
              role="listitem"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                height: '38px',
                width: `${virtualCol.size}px`,
                transform: `translateX(${virtualCol.start}px)`,
              }}
              className={`inline-flex items-center justify-between rounded-xl border transition-colors ${
                isSelected
                  ? 'border-emerald-500/45 bg-emerald-500/12 text-white'
                  : 'border-white/8 bg-[#0B0F17] text-slate-300 hover:border-white/20 hover:text-white'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectSymbol(pair.symbol)}
                className="min-h-[36px] min-w-0 flex-1 pl-2.5 pr-1 inline-flex items-center gap-1.5 text-xs font-mono tabular-nums whitespace-nowrap overflow-hidden"
              >
                <span className="font-sans font-semibold shrink-0">{pair.baseAsset}</span>
                {visibleColumns.sparkline && (
                  <MiniSparkline
                    data={pair.sparkline24h}
                    changePct={pair.change24hPct}
                    width={36}
                    height={16}
                  />
                )}
                {visibleColumns.price && pair.price !== null && (
                  <span className="font-mono tabular-nums text-slate-100 font-semibold shrink-0 whitespace-nowrap">
                    {formatUsdCompact(pair.price)}
                  </span>
                )}
                {visibleColumns.change24h && pair.change24hPct !== null && (
                  <span
                    className={`font-mono tabular-nums text-[11px] font-semibold px-1.5 py-0.5 rounded-md shrink-0 whitespace-nowrap ${
                      pair.change24hPct >= 0
                        ? 'bg-emerald-500/12 text-emerald-300'
                        : 'bg-rose-500/12 text-rose-300'
                    }`}
                  >
                    {pair.change24hPct >= 0 ? '+' : ''}
                    {pair.change24hPct.toFixed(2)}%
                  </span>
                )}
                {visibleColumns.volume && pair.volume24hUsdt > 0 && (
                  <span className="font-mono tabular-nums text-[10px] text-slate-400 shrink-0 whitespace-nowrap">
                    V:{formatUsdAbbrev(pair.volume24hUsdt)}
                  </span>
                )}
                {visibleColumns.marketCap && pair.marketCapUsdt && pair.marketCapUsdt > 0 && (
                  <span className="font-mono tabular-nums text-[10px] text-cyan-300/80 shrink-0 whitespace-nowrap">
                    MC:{formatUsdAbbrev(pair.marketCapUsdt)}
                  </span>
                )}
              </button>

              <div className="flex items-center shrink-0 pr-1">
                <button
                  type="button"
                  onClick={() => onToggleFavorite(pair.symbol)}
                  aria-label={
                    pair.isFavorite
                      ? `Убрать ${pair.baseAsset} из любимых`
                      : `Добавить ${pair.baseAsset} в любимые`
                  }
                  className="min-h-[34px] w-7 inline-flex items-center justify-center text-slate-500 hover:text-amber-300 transition-colors"
                >
                  <Star
                    className={`w-3 h-3 ${pair.isFavorite ? 'fill-amber-400 text-amber-300' : ''}`}
                  />
                </button>
                <button
                  type="button"
                  onClick={() => onNotifyAsset(pair)}
                  aria-label={`Уведомить по ${pair.baseAsset}`}
                  className={`min-h-[28px] px-2 rounded-lg text-[11px] font-medium inline-flex items-center gap-1 whitespace-nowrap transition-colors ${
                    activeAlertsForAsset > 0
                      ? 'bg-cyan-500/18 text-cyan-200 border border-cyan-500/35'
                      : 'bg-white/5 hover:bg-cyan-500/15 text-slate-300 hover:text-cyan-200 border border-white/10'
                  }`}
                >
                  <BellPlus className="w-3 h-3 shrink-0" />
                  <span>Уведомить{activeAlertsForAsset > 0 ? ` (${activeAlertsForAsset})` : ''}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

interface VirtualizedPairsListProps {
  items: EnrichedMarketPair[];
  selectedSymbol: string;
  marketType: MarketType;
  priceAlerts: PriceAlertRecord[];
  visibleColumns?: MarketVisibleColumns;
  onOpenChart: (symbol: string) => void;
  onToggleFavorite: (symbol: string) => void;
  onNotifyAsset: (asset: EnrichedMarketPair) => void;
}

export const VirtualizedPairsList: React.FC<VirtualizedPairsListProps> = ({
  items,
  selectedSymbol,
  marketType,
  priceAlerts,
  visibleColumns = DEFAULT_MARKET_COLUMNS,
  onOpenChart,
  onToggleFavorite,
  onNotifyAsset,
}) => {
  const parentRef = useRef<HTMLDivElement | null>(null);

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 62,
    overscan: 4,
  });

  useEffect(() => {
    rowVirtualizer.measure();
  }, [items.length, visibleColumns, rowVirtualizer]);

  const minTableWidthPx = useMemo(() => {
    let w = 152;
    if (visibleColumns.price) w += 84;
    if (visibleColumns.change24h) w += 68;
    return Math.min(340, w);
  }, [visibleColumns]);

  return (
    <div className="w-full overflow-x-auto">
      <div style={{ minWidth: `${minTableWidthPx}px` }}>
        {/* Aligned Table Header Bar */}
        <div className="px-2 sm:px-4 py-2 border-b border-white/8 bg-[#0B0F17]/75 flex items-center justify-between gap-1.5 sm:gap-2 text-[11px] font-medium text-slate-400">
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1">
            <span className="w-[26px] sm:w-[36px] shrink-0 text-center" aria-hidden="true">
              ★
            </span>
            <div className="min-w-0 flex-1 flex items-center justify-between gap-1.5 sm:gap-2">
              <span className="min-w-[72px] sm:min-w-[115px] flex-1">Актив</span>
              {visibleColumns.sparkline && (
                <span className="w-[54px] sm:w-[76px] text-center shrink-0 hidden min-[420px]:inline">24ч</span>
              )}
              {visibleColumns.price && (
                <span className="w-[84px] sm:w-[96px] text-right shrink-0 whitespace-nowrap">Цена</span>
              )}
              {visibleColumns.change24h && (
                <span className="w-[66px] sm:w-[74px] text-right shrink-0 whitespace-nowrap">24ч %</span>
              )}
              {visibleColumns.volume && (
                <span className="w-[60px] sm:w-[76px] text-right shrink-0 hidden sm:inline">Объём</span>
              )}
              {visibleColumns.marketCap && (
                <span className="w-[64px] sm:w-[80px] text-right shrink-0 hidden md:inline">Капитал.</span>
              )}
            </div>
          </div>
          <span className="w-[36px] sm:w-[110px] text-right shrink-0">
            <span className="hidden sm:inline">Алерт</span>
          </span>
        </div>

        {/* Virtualized Rows */}
        <div
          ref={parentRef}
          role="list"
          aria-label="Виртуализированный список активов"
          className="max-h-[360px] overflow-y-auto"
        >
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const item = items[virtualRow.index];
              if (!item) return null;
              const isSelected = item.symbol === selectedSymbol;
              const activeAlertsCount = priceAlerts.filter(
                (a) => a.symbol === item.symbol && a.marketType === marketType && a.active
              ).length;

              return (
                <div
                  key={item.symbol}
                  role="listitem"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  className={`px-2 sm:px-4 border-b border-white/6 flex items-center justify-between gap-1.5 sm:gap-2 transition-colors ${
                    isSelected ? 'bg-emerald-500/10' : 'hover:bg-white/[0.03]'
                  }`}
                >
                  {/* Left: Star + Asset Identity + Selected Data Columns */}
                  <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => onToggleFavorite(item.symbol)}
                      aria-label={
                        item.isFavorite
                          ? `Убрать ${item.baseAsset} из любимых`
                          : `Добавить ${item.baseAsset} в любимые`
                      }
                      className="min-h-[32px] min-w-[28px] sm:min-h-[36px] sm:min-w-[36px] rounded-lg hover:bg-white/8 text-slate-400 hover:text-amber-300 flex items-center justify-center shrink-0 transition-colors"
                    >
                      <Star
                        className={`w-3.5 h-3.5 ${
                          item.isFavorite ? 'fill-amber-400 text-amber-300' : ''
                        }`}
                      />
                    </button>

                    <button
                      type="button"
                      onClick={() => onOpenChart(item.symbol)}
                      className="min-h-[44px] flex-1 min-w-0 text-left flex items-center justify-between gap-1.5 sm:gap-2"
                    >
                      <div className="min-w-[82px] sm:min-w-[115px] flex-1">
                        <div className="text-xs sm:text-sm font-semibold text-white truncate">
                          {item.baseAsset}
                          <span className="text-slate-500 font-normal hidden sm:inline"> / USDT</span>
                        </div>
                        <div className="text-[10px] sm:text-[11px] text-slate-500 truncate">
                          <span>{item.name}</span>
                          {item.category && (
                            <>
                              <span aria-hidden="true"> · </span>
                              <span className="text-slate-400">{item.category}</span>
                            </>
                          )}
                          {item.isNewListing && (
                            <>
                              <span aria-hidden="true"> · </span>
                              <span className="text-cyan-400">Листинг</span>
                            </>
                          )}
                        </div>
                      </div>

                      {visibleColumns.sparkline && (
                        <div className="w-[54px] sm:w-[76px] shrink-0 hidden min-[420px]:flex items-center justify-center">
                          <MiniSparkline
                            data={item.sparkline24h}
                            changePct={item.change24hPct}
                            width={52}
                            height={22}
                            showArea
                          />
                        </div>
                      )}

                      {visibleColumns.price && (
                        <div className="w-[84px] sm:w-[96px] text-right font-mono tabular-nums shrink-0 whitespace-nowrap">
                          <div className="text-[11px] sm:text-sm text-slate-100 font-semibold font-mono tabular-nums">
                            {item.price !== null ? formatUsdCompact(item.price) : '—'}
                          </div>
                          {marketType === 'futures' && (
                            <div className="text-[10px] font-mono tabular-nums text-amber-300">
                              F: {(item.fundingRatePct ?? 0.01).toFixed(3)}%
                            </div>
                          )}
                        </div>
                      )}

                      {visibleColumns.change24h && (
                        <div className="w-[66px] sm:w-[74px] flex justify-end shrink-0">
                          <span
                            className={`inline-flex items-center justify-end px-1.5 py-0.5 rounded-md font-mono tabular-nums text-[11px] sm:text-xs font-semibold shrink-0 whitespace-nowrap ${
                              (item.change24hPct ?? 0) >= 0
                                ? 'bg-emerald-500/12 text-emerald-300'
                                : 'bg-rose-500/12 text-rose-300'
                            }`}
                          >
                            {item.change24hPct !== null
                              ? `${item.change24hPct >= 0 ? '+' : ''}${item.change24hPct.toFixed(2)}%`
                              : '—'}
                          </span>
                        </div>
                      )}

                      {visibleColumns.volume && (
                        <div className="w-[60px] sm:w-[76px] text-right font-mono tabular-nums text-xs text-slate-300 shrink-0 hidden sm:block whitespace-nowrap">
                          {formatUsdAbbrev(item.volume24hUsdt)}
                        </div>
                      )}

                      {visibleColumns.marketCap && (
                        <div className="w-[64px] sm:w-[80px] text-right font-mono tabular-nums text-xs text-cyan-200/90 shrink-0 hidden md:block whitespace-nowrap">
                          {formatUsdAbbrev(item.marketCapUsdt ?? 0)}
                        </div>
                      )}
                    </button>
                  </div>

                  {/* Right: Dedicated Notify Button (icon-only on narrow mobile so prices never clip) */}
                  <div className="w-[36px] sm:w-[110px] flex justify-end shrink-0">
                    <button
                      type="button"
                      onClick={() => onNotifyAsset(item)}
                      aria-label={`Уведомить по ${item.baseAsset}`}
                      title={`Уведомить по ${item.baseAsset}`}
                      className={`min-h-[34px] min-w-[34px] px-2 sm:px-3 rounded-xl border text-xs font-medium inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                        activeAlertsCount > 0
                          ? 'border-cyan-500/45 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/22'
                          : 'border-white/12 bg-[#0B0F17] text-slate-200 hover:border-cyan-500/40 hover:text-cyan-200'
                      }`}
                    >
                      <BellPlus className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                      <span className="hidden sm:inline">
                        Уведомить{activeAlertsCount > 0 ? ` (${activeAlertsCount})` : ''}
                      </span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
