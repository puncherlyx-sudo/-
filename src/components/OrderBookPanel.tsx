import React, { useCallback, useEffect, useState } from 'react';
import { BookOpen, RefreshCw } from 'lucide-react';
import { motion } from 'motion/react';
import type { MarketType, OrderBookSnapshot } from '../types/domain';

interface OrderBookPanelProps {
  symbol: string;
  marketType: MarketType;
}

function formatBookPrice(val: number): string {
  if (val >= 1000) return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (val >= 10) return val.toFixed(3);
  return val.toFixed(4);
}

function formatSize(val: number): string {
  if (val >= 1000) return val.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (val >= 10) return val.toFixed(1);
  return val.toFixed(3);
}

export const OrderBookPanel: React.FC<OrderBookPanelProps> = ({ symbol, marketType }) => {
  const [depth, setDepth] = useState<OrderBookSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'split' | 'bids' | 'asks'>('split');

  const loadDepth = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/market/depth?symbol=${symbol}&marketType=${marketType}`);
      if (res.ok) {
        const data = (await res.json()) as OrderBookSnapshot;
        setDepth(data);
      }
    } catch {
      // Keep previous snapshot on temporary glitch
    } finally {
      setLoading(false);
    }
  }, [symbol, marketType]);

  useEffect(() => {
    void loadDepth();
    const id = setInterval(() => {
      void loadDepth();
    }, 12_000);
    return () => clearInterval(id);
  }, [loadDepth]);

  const askDominancePct = depth ? Number((100 - depth.bidDominancePct).toFixed(1)) : 50;

  return (
    <div className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-cyan-400" />
            <span>Биржевой стакан (Order Book · {symbol})</span>
          </h3>
          <p className="mt-0.5 text-xs text-slate-400">
            Глубина ликвидности TOP-10 заявок на покупку и продажу ({marketType === 'futures' ? 'Фьючерсы' : 'Спот'}).
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex items-center p-0.5 rounded-lg bg-[#0B0F17] border border-white/8 text-[11px]">
            {(
              [
                { id: 'split', label: 'Стакан' },
                { id: 'bids', label: 'Покупки' },
                { id: 'asks', label: 'Продажи' },
              ] as const
            ).map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => setViewMode(mode.id)}
                className={`min-h-[32px] px-2.5 rounded-md font-medium transition-colors whitespace-nowrap ${
                  viewMode === mode.id ? 'bg-white/12 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>

          <motion.button
            type="button"
            whileTap={{ scale: 0.94 }}
            onClick={() => void loadDepth()}
            disabled={loading}
            aria-label="Обновить стакан ордеров"
            className="min-h-[36px] min-w-[36px] rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 flex items-center justify-center transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </motion.button>
        </div>
      </div>

      {/* Buyer vs Seller Dominance Imbalance Bar */}
      {depth && (
        <div className="space-y-2 rounded-xl bg-[#0B0F17] border border-white/8 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums">
            <span className="text-emerald-400 font-semibold">Покупатели (Bid) {depth.bidDominancePct}%</span>
            <span className="text-slate-400">
              Спред: <strong className="text-slate-200">${depth.spreadUsdt.toFixed(4)}</strong> ({depth.spreadPct}%)
            </span>
            <span className="text-rose-400 font-semibold">Продавцы (Ask) {askDominancePct}%</span>
          </div>
          <div className="h-2 w-full rounded-full overflow-hidden bg-rose-500/35 flex">
            <motion.div
              initial={false}
              animate={{ width: `${depth.bidDominancePct}%` }}
              transition={{ type: 'spring', stiffness: 280, damping: 30 }}
              className="h-full bg-gradient-to-r from-emerald-500 to-cyan-400"
            />
          </div>
        </div>
      )}

      {/* Depth Tables */}
      {depth ? (
        <div className={`grid gap-4 ${viewMode === 'split' ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
          {viewMode !== 'asks' && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] text-slate-400 px-2 pb-1 border-b border-white/8">
                <span>Цена покупки (Bid)</span>
                <span>Объем · Сумма $</span>
              </div>
              {depth.bids.slice(0, viewMode === 'bids' ? 10 : 8).map((row, idx) => (
                <div
                  key={`bid-${idx}-${row.price}`}
                  className="relative flex items-center justify-between px-2 py-1.5 rounded-md overflow-hidden text-xs font-mono tabular-nums"
                >
                  <div
                    aria-hidden="true"
                    style={{ width: `${row.depthPct}%` }}
                    className="absolute inset-y-0 right-0 bg-emerald-500/14 transition-all duration-300"
                  />
                  <span className="relative z-10 text-emerald-400 font-semibold">{formatBookPrice(row.price)}</span>
                  <span className="relative z-10 text-slate-200">
                    {formatSize(row.size)}{' '}
                    <span className="text-slate-500">· ${Math.round(row.notionalUsdt).toLocaleString('en-US')}</span>
                  </span>
                </div>
              ))}
            </div>
          )}

          {viewMode !== 'bids' && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] text-slate-400 px-2 pb-1 border-b border-white/8">
                <span>Цена продажи (Ask)</span>
                <span>Объем · Сумма $</span>
              </div>
              {depth.asks.slice(0, viewMode === 'asks' ? 10 : 8).map((row, idx) => (
                <div
                  key={`ask-${idx}-${row.price}`}
                  className="relative flex items-center justify-between px-2 py-1.5 rounded-md overflow-hidden text-xs font-mono tabular-nums"
                >
                  <div
                    aria-hidden="true"
                    style={{ width: `${row.depthPct}%` }}
                    className="absolute inset-y-0 right-0 bg-rose-500/14 transition-all duration-300"
                  />
                  <span className="relative z-10 text-rose-400 font-semibold">{formatBookPrice(row.price)}</span>
                  <span className="relative z-10 text-slate-200">
                    {formatSize(row.size)}{' '}
                    <span className="text-slate-500">· ${Math.round(row.notionalUsdt).toLocaleString('en-US')}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="py-8 text-center text-xs text-slate-400">Загрузка стакана ликвидности {symbol}...</div>
      )}
    </div>
  );
};
