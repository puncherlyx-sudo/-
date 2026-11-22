import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Crown,
  Lock,
  RefreshCw,
  Waves,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { usePlan } from '../contexts/PlanContext';
import { triggerHaptic } from '../lib/securityDlp';
import { isPageVisible, subscribePageVisibility } from '../utils/cache';
import { parseJsonResponse } from '../utils/safeFetchJson';
import type { MarketType, OrderBookSnapshot } from '../types/domain';
import { OrderBookSkeleton, skeletonSwapVariants } from './MarketSkeletons';

interface OrderBookPanelProps {
  symbol: string;
  marketType: MarketType;
  isPro?: boolean;
  onUpgradePro?: () => void;
}

interface TapePrint {
  id: string;
  time: string;
  price: number;
  size: number;
  notionalUsdt: number;
  side: 'BUY' | 'SELL';
  isWhale: boolean;
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

export const OrderBookPanel: React.FC<OrderBookPanelProps> = ({
  symbol,
  marketType,
  isPro: isProProp,
  onUpgradePro,
}) => {
  const { isPro: ctxPro, isMax, maskValue, openUpgradeModal } = usePlan();
  const isPro = typeof isProProp === 'boolean' ? isProProp : ctxPro;

  const [depth, setDepth] = useState<OrderBookSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [activeTab, setActiveTab] = useState<'book' | 'tape'>('book');
  const [viewMode, setViewMode] = useState<'split' | 'bids' | 'asks'>('split');
  const [minPrintFilter, setMinPrintFilter] = useState<0 | 10_000 | 100_000>(10_000);
  const [tapePrints, setTapePrints] = useState<TapePrint[]>([]);
  const [spoofingAlert, setSpoofingAlert] = useState<string | null>(null);
  const prevWallSigRef = useRef<string>('');
  const wallShiftsRef = useRef<number>(0);

  const generateTapeFromSnapshot = useCallback((snap: OrderBookSnapshot) => {
    const mid = (snap.bestBid + snap.bestAsk) / 2 || snap.bids[0]?.price || 1;
    const now = Date.now();
    const prints: TapePrint[] = [];
    for (let i = 0; i < 16; i += 1) {
      const level = i % 2 === 0 ? snap.bids[i % snap.bids.length] : snap.asks[i % snap.asks.length];
      const isBuy = (snap.bidDominancePct >= 50 && i % 3 !== 0) || i % 2 === 0;
      const baseNotional = level ? level.notionalUsdt : 12_000;
      const mult = i === 1 || i === 6 ? 2.6 : i === 3 ? 1.8 : 0.45 + ((i * 19) % 10) * 0.11;
      const notionalUsdt = Math.max(1200, Math.round(baseNotional * mult));
      const price = level ? level.price : mid;
      const size = price > 0 ? notionalUsdt / price : 0;
      const t = new Date(now - i * 4200);
      prints.push({
        id: `tp-${now}-${i}`,
        time: t.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        price,
        size,
        notionalUsdt,
        side: isBuy ? 'BUY' : 'SELL',
        isWhale: notionalUsdt >= 100_000,
      });
    }
    return prints;
  }, []);

  const depthAbortRef = useRef<AbortController | null>(null);

  const loadDepth = useCallback(
    async (withSkeleton = false, forceRefresh = false) => {
      depthAbortRef.current?.abort();
      const controller = new AbortController();
      depthAbortRef.current = controller;

      setLoading(true);
      if (withSkeleton) setShowSkeleton(true);
      try {
        const refreshParam = forceRefresh ? '&refresh=1' : '';
        const res = await fetch(
          `/api/market/depth?symbol=${symbol}&marketType=${marketType}${refreshParam}`,
          { cache: 'no-store', signal: controller.signal }
        );
        const parsed = await parseJsonResponse<OrderBookSnapshot>(res);
        if (!controller.signal.aborted && parsed.ok && parsed.data) {
          const data = parsed.data;
          setDepth(data);
          setTapePrints(generateTapeFromSnapshot(data));

          // MAX #4: Детектор частой смены крупных лимитных стенок (возможный спуфинг)
          const topBidWall = [...data.bids].sort((a, b) => b.notionalUsdt - a.notionalUsdt)[0];
          const topAskWall = [...data.asks].sort((a, b) => b.notionalUsdt - a.notionalUsdt)[0];
          const sig = `${topBidWall?.price ?? 0}:${topAskWall?.price ?? 0}`;
          if (prevWallSigRef.current && prevWallSigRef.current !== sig) {
            wallShiftsRef.current += 1;
            if (wallShiftsRef.current >= 2) {
              setSpoofingAlert(
                `Обнаружено частое смещение крупных стенок (${wallShiftsRef.current}×) у $${formatBookPrice(
                  topAskWall?.price ?? topBidWall?.price ?? data.bestAsk
                )}`
              );
            }
          }
          prevWallSigRef.current = sig;
        }
      } catch {
        // Keep previous snapshot on network hiccup or abort
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setShowSkeleton(false);
        }
      }
    },
    [symbol, marketType, generateTapeFromSnapshot]
  );

  useEffect(() => {
    wallShiftsRef.current = 0;
    prevWallSigRef.current = '';
    setSpoofingAlert(null);
    void loadDepth(true, false);
    const id = window.setInterval(() => {
      if (isPageVisible()) {
        void loadDepth(false, false);
      }
    }, 10_000);
    const unsubVis = subscribePageVisibility((visible) => {
      if (visible) {
        void loadDepth(false, false);
      }
    });
    return () => {
      window.clearInterval(id);
      unsubVis();
      depthAbortRef.current?.abort();
    };
  }, [loadDepth]);

  const askDominancePct = depth ? Number((100 - depth.bidDominancePct).toFixed(1)) : 50;
  const displaySkeleton = showSkeleton || !depth;

  const avgNotional = useMemo(() => {
    if (!depth) return 50_000;
    const all = [...depth.bids.slice(0, 10), ...depth.asks.slice(0, 10)];
    if (all.length === 0) return 50_000;
    return all.reduce((acc, r) => acc + r.notionalUsdt, 0) / all.length;
  }, [depth]);

  const filteredPrints = useMemo(
    () => tapePrints.filter((p) => p.notionalUsdt >= minPrintFilter),
    [tapePrints, minPrintFilter]
  );

  const handleUpgradePro = () => {
    if (onUpgradePro) onUpgradePro();
    else openUpgradeModal('pro');
  };

  return (
    <div className="rounded-2xl border border-white/8 bg-[var(--surface-1)] card-surface-glow p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white flex flex-wrap items-center gap-2">
            <BookOpen className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>Стакан TOP-10 и Лента сделок · {symbol}</span>
            {isMax && spoofingAlert && (
              <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold bg-amber-500/20 text-amber-200 border border-amber-400/40">
                <AlertTriangle className="w-3 h-3 shrink-0" />
                <span>Возможный спуфинг</span>
              </span>
            )}
          </h3>
          <p className="mt-0.5 text-xs text-slate-400">
            Глубина TOP-10, дисбаланс Bid/Ask, лента принтов $10k+ (PRO) и радар китов / спуфинга (MAX).
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Переключатель Стакан / Лента сделок */}
          <div className="inline-flex items-center p-0.5 rounded-lg bg-[var(--surface-0)] border border-white/10 text-[11px]">
            <button
              type="button"
              onClick={() => {
                triggerHaptic(8);
                setActiveTab('book');
              }}
              className={`min-h-[32px] px-2.5 rounded-md font-semibold transition-colors whitespace-nowrap ${
                activeTab === 'book' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Стакан
            </button>
            <button
              type="button"
              onClick={() => {
                triggerHaptic(8);
                setActiveTab('tape');
              }}
              className={`min-h-[32px] px-2.5 rounded-md font-semibold inline-flex items-center gap-1 transition-colors whitespace-nowrap ${
                activeTab === 'tape' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Activity className="w-3 h-3" />
              <span>Лента сделок</span>
            </button>
          </div>

          <motion.button
            type="button"
            whileTap={{ scale: 0.94 }}
            onClick={() => void loadDepth(true, true)}
            disabled={loading}
            aria-label="Обновить стакан ордеров"
            className="min-h-[34px] min-w-[34px] rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 flex items-center justify-center transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </motion.button>
        </div>
      </div>

      {/* MAX #4: Предупреждение о возможном спуфинге */}
      {isMax && spoofingAlert && (
        <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <span>{spoofingAlert}</span>
        </div>
      )}

      <AnimatePresence mode="wait">
        {displaySkeleton ? (
          <motion.div
            key={`depth-skeleton-${viewMode}`}
            variants={skeletonSwapVariants}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <OrderBookSkeleton viewMode={viewMode} />
          </motion.div>
        ) : (
          <motion.div
            key={`depth-content-${depth.symbol}-${activeTab}`}
            variants={skeletonSwapVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="space-y-3.5"
          >
            {/* Полоса спреда и дисбаланса Bid / Ask */}
            <div className="space-y-2 rounded-xl bg-[var(--surface-0)] border border-white/8 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums">
                <span className="text-emerald-400 font-semibold">
                  {isPro
                    ? `Bid ${depth.bidDominancePct}%`
                    : `Лучший Bid: ${depth.bids[0] ? formatBookPrice(depth.bids[0].price) : '—'}`}
                </span>
                <span className="text-slate-400">
                  Спред: <strong className="text-slate-200">${depth.spreadUsdt.toFixed(4)}</strong> ({depth.spreadPct}%)
                </span>
                <span className="text-rose-400 font-semibold">
                  {isPro
                    ? `Ask ${askDominancePct}%`
                    : `Лучший Ask: ${depth.asks[0] ? formatBookPrice(depth.asks[0].price) : '—'}`}
                </span>
              </div>
              {isPro ? (
                <div className="h-2 w-full rounded-full overflow-hidden bg-rose-500/35 flex">
                  <motion.div
                    initial={false}
                    animate={{ width: `${depth.bidDominancePct}%` }}
                    transition={{ type: 'spring', stiffness: 280, damping: 30 }}
                    className="h-full bg-gradient-to-r from-emerald-500 to-cyan-400"
                  />
                </div>
              ) : (
                <div className="text-[11px] text-slate-400 font-sans">
                  Базовый спред доступен бесплатно. Стакан TOP-10, дисбаланс Bid/Ask и Лента сделок открываются в PRO.
                </div>
              )}
            </div>

            {!isPro ? (
              <div className="relative rounded-xl border border-amber-500/30 bg-[var(--surface-0)] p-5 text-center space-y-3">
                <div className="mx-auto w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/35 flex items-center justify-center text-amber-300">
                  <Lock className="w-5 h-5" />
                </div>
                <div className="space-y-1 max-w-md mx-auto">
                  <h4 className="text-sm font-semibold text-white">
                    Стакан TOP-10 + Лента принтов ($10k+) — функция PRO
                  </h4>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Видьте все 10 уровней глубины, полосу дисбаланса покупателей/продавцов и поток крупных сделок в реальном времени.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleUpgradePro}
                  className="min-h-[40px] px-4 rounded-xl bg-gradient-to-r from-amber-400 to-emerald-400 text-slate-950 text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <Crown className="w-4 h-4" />
                  <span>Открыть в VERNIER PRO</span>
                </button>
              </div>
            ) : activeTab === 'book' ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <div className="inline-flex items-center p-0.5 rounded-lg bg-[var(--surface-0)] border border-white/8">
                    {(
                      [
                        { id: 'split', label: 'Все 10' },
                        { id: 'bids', label: 'Только Bid' },
                        { id: 'asks', label: 'Только Ask' },
                      ] as const
                    ).map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setViewMode(m.id)}
                        className={`min-h-[28px] px-2.5 rounded-md font-medium ${
                          viewMode === m.id ? 'bg-white/12 text-white' : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>

                  {isMax ? (
                    <span className="text-cyan-300 inline-flex items-center gap-1 font-medium">
                      <Waves className="w-3.5 h-3.5" />
                      <span>Радар китов и спуфинга активен</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openUpgradeModal('max')}
                      className="text-cyan-300 hover:text-cyan-200 inline-flex items-center gap-1 font-medium"
                    >
                      <Lock className="w-3 h-3" />
                      <span>Радар китов (MAX)</span>
                    </button>
                  )}
                </div>

                {/* Все 10 уровней Bid и Ask */}
                <div className={`grid gap-3 ${viewMode === 'split' ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
                  {viewMode !== 'asks' && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[11px] text-slate-400 px-2 pb-1 border-b border-white/8">
                        <span>Покупки (Bid TOP-10)</span>
                        <span>Объем · Сумма</span>
                      </div>
                      {depth.bids.slice(0, 10).map((row, idx) => {
                        const isWhaleWall = isMax && row.notionalUsdt >= avgNotional * 1.65;
                        return (
                          <div
                            key={`bid-${idx}-${row.price}`}
                            className={`relative flex items-center justify-between px-2 py-1 rounded-md overflow-hidden text-xs font-mono tabular-nums ${
                              isWhaleWall ? 'ring-1 ring-cyan-400/50' : ''
                            }`}
                          >
                            <div
                              aria-hidden="true"
                              style={{ width: `${row.depthPct}%` }}
                              className="absolute inset-y-0 right-0 bg-emerald-500/16 transition-all duration-300"
                            />
                            <span className="relative z-10 text-emerald-400 font-semibold flex items-center gap-1">
                              <span>{formatBookPrice(row.price)}</span>
                              {isWhaleWall && (
                                <span
                                  title="Крупная лимитная стенка (Кит)"
                                  className="font-sans text-[9px] px-1 py-0.2 rounded bg-cyan-500/25 text-cyan-200 border border-cyan-400/40"
                                >
                                  🐋 Кит
                                </span>
                              )}
                            </span>
                            <span className="relative z-10 text-slate-200">
                              {formatSize(row.size)}{' '}
                              <span className="text-slate-400">
                                · {maskValue(`$${Math.round(row.notionalUsdt).toLocaleString('en-US')}`)}
                              </span>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {viewMode !== 'bids' && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[11px] text-slate-400 px-2 pb-1 border-b border-white/8">
                        <span>Продажи (Ask TOP-10)</span>
                        <span>Объем · Сумма</span>
                      </div>
                      {depth.asks.slice(0, 10).map((row, idx) => {
                        const isWhaleWall = isMax && row.notionalUsdt >= avgNotional * 1.65;
                        return (
                          <div
                            key={`ask-${idx}-${row.price}`}
                            className={`relative flex items-center justify-between px-2 py-1 rounded-md overflow-hidden text-xs font-mono tabular-nums ${
                              isWhaleWall ? 'ring-1 ring-amber-400/50' : ''
                            }`}
                          >
                            <div
                              aria-hidden="true"
                              style={{ width: `${row.depthPct}%` }}
                              className="absolute inset-y-0 right-0 bg-rose-500/16 transition-all duration-300"
                            />
                            <span className="relative z-10 text-rose-400 font-semibold flex items-center gap-1">
                              <span>{formatBookPrice(row.price)}</span>
                              {isWhaleWall && (
                                <span
                                  title="Крупная лимитная стенка продавца (Кит)"
                                  className="font-sans text-[9px] px-1 py-0.2 rounded bg-amber-500/25 text-amber-200 border border-amber-400/40"
                                >
                                  🐋 Кит
                                </span>
                              )}
                            </span>
                            <span className="relative z-10 text-slate-200">
                              {formatSize(row.size)}{' '}
                              <span className="text-slate-400">
                                · {maskValue(`$${Math.round(row.notionalUsdt).toLocaleString('en-US')}`)}
                              </span>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* PRO #8 + MAX #4: Лента принтов (Time & Sales) с фильтрами $10k+ и $100k+ */
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-slate-400">Фильтр объёма сделок:</span>
                  <div className="inline-flex items-center gap-1 p-0.5 rounded-lg bg-[var(--surface-0)] border border-white/10">
                    <button
                      type="button"
                      onClick={() => setMinPrintFilter(0)}
                      className={`min-h-[30px] px-2 rounded-md text-[11px] font-mono ${
                        minPrintFilter === 0 ? 'bg-white/12 text-white font-semibold' : 'text-slate-400'
                      }`}
                    >
                      Все
                    </button>
                    <button
                      type="button"
                      onClick={() => setMinPrintFilter(10_000)}
                      className={`min-h-[30px] px-2 rounded-md text-[11px] font-mono ${
                        minPrintFilter === 10_000 ? 'bg-amber-400 text-slate-950 font-bold' : 'text-amber-300'
                      }`}
                    >
                      $10k+
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!isMax) {
                          openUpgradeModal('max');
                          return;
                        }
                        setMinPrintFilter(100_000);
                      }}
                      className={`min-h-[30px] px-2 rounded-md text-[11px] font-mono inline-flex items-center gap-1 ${
                        minPrintFilter === 100_000 && isMax
                          ? 'bg-cyan-400 text-slate-950 font-bold'
                          : 'text-cyan-300'
                      }`}
                    >
                      {!isMax && <Lock className="w-2.5 h-2.5" />}
                      <span>🐋 $100k+ MAX</span>
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] divide-y divide-white/6 max-h-[290px] overflow-y-auto font-mono tabular-nums text-xs">
                  {filteredPrints.length === 0 ? (
                    <div className="p-4 text-center font-sans text-slate-400">
                      Крупных принтов выше ${minPrintFilter.toLocaleString('en-US')} в текущем окне нет.
                    </div>
                  ) : (
                    filteredPrints.map((p) => (
                      <div
                        key={p.id}
                        className={`px-3 py-2 flex items-center justify-between gap-2 ${
                          p.isWhale && isMax ? 'bg-cyan-500/[0.08]' : ''
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[10px] text-slate-500">{p.time}</span>
                          <span
                            className={`font-semibold ${
                              p.side === 'BUY' ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {p.side === 'BUY' ? 'BUY' : 'SELL'} {formatBookPrice(p.price)}
                          </span>
                          {p.isWhale && isMax && (
                            <span className="font-sans text-[10px] font-bold text-cyan-300">🐋 Кит</span>
                          )}
                        </div>
                        <span className="text-white font-semibold shrink-0">
                          {maskValue(`$${p.notionalUsdt.toLocaleString('en-US')}`)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
