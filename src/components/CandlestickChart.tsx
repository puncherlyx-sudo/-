import React, { useMemo, useRef, useState } from 'react';
import type { ChartSignalMarker } from '../lib/strategyEngine';
import type { CandlePoint, PriceAlertRecord, RibbonPeriods, RibbonType } from '../types/domain';

interface CandlestickChartProps {
  candles: CandlePoint[];
  symbol: string;
  showEma: boolean;
  showBollinger: boolean;
  showRibbon?: boolean;
  ribbonType?: RibbonType;
  ribbonPeriods?: RibbonPeriods;
  entryLevel?: number | null;
  stopLossLevel?: number | null;
  takeProfit1Level?: number | null;
  takeProfitLevel?: number | null;
  signalDirection?: 'LONG' | 'SHORT' | null;
  activeSignalEmittedAt?: string | null;
  signalMarkers?: ChartSignalMarker[];
  selectedSignalId?: string | null;
  onSelectSignalMarker?: (marker: ChartSignalMarker) => void;
  priceAlerts?: PriceAlertRecord[];
  draftAlertPrice?: number | null;
  onPickPriceFromChart?: (price: number) => void;
  /** PRO #2 Smart Money оверлеи */
  showSR?: boolean;
  showOrderBlocks?: boolean;
  showFvg?: boolean;
  showBosChoch?: boolean;
  /** PRO #3 Профиль объёма (VPVR) */
  showVpvr?: boolean;
}

const RIBBON_COLORS = ['#34D399', '#22D3EE', '#FBBF24', '#FB7185'] as const;

function formatPrice(val: number): string {
  if (val >= 1000) return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (val >= 10) return val.toFixed(3);
  return val.toFixed(4);
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function computeClientEMA(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const safePeriod = Math.max(2, Math.min(200, Math.round(period)));
  const k = 2 / (safePeriod + 1);
  const res: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    res.push(values[i] * k + res[i - 1] * (1 - k));
  }
  return res;
}

function computeClientSMA(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const safePeriod = Math.max(2, Math.min(200, Math.round(period)));
  const res: number[] = [];
  let rollingSum = 0;
  for (let i = 0; i < values.length; i++) {
    rollingSum += values[i];
    if (i >= safePeriod) {
      rollingSum -= values[i - safePeriod];
      res.push(rollingSum / safePeriod);
    } else {
      res.push(rollingSum / (i + 1));
    }
  }
  return res;
}

export const CandlestickChart: React.FC<CandlestickChartProps> = ({
  candles,
  symbol,
  showEma,
  showBollinger,
  showRibbon = true,
  ribbonType = 'EMA',
  ribbonPeriods = [8, 13, 21, 55],
  entryLevel,
  stopLossLevel,
  takeProfit1Level,
  takeProfitLevel,
  signalDirection = null,
  activeSignalEmittedAt = null,
  signalMarkers = [],
  selectedSignalId = null,
  onSelectSignalMarker,
  priceAlerts = [],
  draftAlertPrice,
  onPickPriceFromChart,
  showSR = false,
  showOrderBlocks = false,
  showFvg = false,
  showBosChoch = false,
  showVpvr = false,
}) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [hoverPrice, setHoverPrice] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const visibleCandles = useMemo(() => candles.slice(-64), [candles]);
  const sortedPeriods = useMemo(
    () => [...ribbonPeriods].sort((a, b) => a - b) as RibbonPeriods,
    [ribbonPeriods]
  );

  // Compute Moving Average Ribbon on full candle history, then slice trailing visible window
  const ribbonSeries = useMemo(() => {
    if (!showRibbon || candles.length === 0) return [];
    const closes = candles.map((c) => c.close);
    const offset = Math.max(0, candles.length - visibleCandles.length);
    return sortedPeriods.map((period, idx) => {
      const fullSeries =
        ribbonType === 'SMA' ? computeClientSMA(closes, period) : computeClientEMA(closes, period);
      return {
        period,
        color: RIBBON_COLORS[idx % RIBBON_COLORS.length],
        values: fullSeries.slice(offset),
      };
    });
  }, [candles, visibleCandles.length, showRibbon, ribbonType, sortedPeriods]);

  const metrics = useMemo(() => {
    if (visibleCandles.length === 0) return null;
    const highs = visibleCandles.map((c) => Math.max(c.high, c.bbUpper ?? c.high));
    const lows = visibleCandles.map((c) => Math.min(c.low, c.bbLower ?? c.low));
    let minPrice = Math.min(...lows);
    let maxPrice = Math.max(...highs);

    if (showRibbon && ribbonSeries.length > 0) {
      for (const line of ribbonSeries) {
        for (const v of line.values) {
          if (Number.isFinite(v)) {
            minPrice = Math.min(minPrice, v);
            maxPrice = Math.max(maxPrice, v);
          }
        }
      }
    }

    for (const lvl of [entryLevel, stopLossLevel, takeProfit1Level, takeProfitLevel]) {
      if (lvl && Number.isFinite(lvl) && lvl > 0) {
        minPrice = Math.min(minPrice, lvl);
        maxPrice = Math.max(maxPrice, lvl);
      }
    }

    const pad = (maxPrice - minPrice) * 0.08 || maxPrice * 0.01;
    minPrice -= pad;
    maxPrice += pad;
    const maxVol = Math.max(...visibleCandles.map((c) => c.volume), 1);

    return { minPrice, maxPrice, maxVol };
  }, [visibleCandles, showRibbon, ribbonSeries, entryLevel, stopLossLevel, takeProfit1Level, takeProfitLevel]);

  const activeIdx =
    hoverIdx !== null && visibleCandles[hoverIdx] ? hoverIdx : Math.max(0, visibleCandles.length - 1);

  const ribbonSummary = useMemo(() => {
    if (!showRibbon || ribbonSeries.length < 4 || visibleCandles.length === 0) return null;
    const vals = ribbonSeries.map((s) => s.values[activeIdx] ?? visibleCandles[activeIdx].close);
    const [fast, m1, m2, slow] = vals;
    const isFullBull = fast > m1 && m1 > m2 && m2 > slow;
    const isFullBear = fast < m1 && m1 < m2 && m2 < slow;
    const bullPairs = (fast > m1 ? 1 : 0) + (m1 > m2 ? 1 : 0) + (m2 > slow ? 1 : 0) + (fast > slow ? 1 : 0);
    const spreadPct = slow > 0 ? ((fast - slow) / slow) * 100 : 0;

    let label = 'Консолидация / Переплетение';
    let tone: 'bull' | 'bear' | 'neutral' = 'neutral';
    if (isFullBull) {
      label = 'Уверенный восходящий тренд (4/4)';
      tone = 'bull';
    } else if (isFullBear) {
      label = 'Уверенный нисходящий тренд (4/4)';
      tone = 'bear';
    } else if (bullPairs >= 3) {
      label = 'Умеренный бычий импульс';
      tone = 'bull';
    } else if (bullPairs <= 1) {
      label = 'Умеренный медвежий импульс';
      tone = 'bear';
    }

    return {
      vals,
      label,
      tone,
      spreadPct,
      isBullCloud: fast >= slow,
    };
  }, [showRibbon, ribbonSeries, visibleCandles, activeIdx]);

  // PRO #2: Автоматический расчёт Smart Money зон (S/R, Order Blocks, FVG, BOS/CHoCH)
  const smcOverlays = useMemo(() => {
    if (visibleCandles.length < 10) {
      return {
        support: null as number | null,
        resistance: null as number | null,
        orderBlocks: [] as Array<{ startIdx: number; top: number; bottom: number; type: 'BULL' | 'BEAR' }>,
        fvgs: [] as Array<{ startIdx: number; top: number; bottom: number; type: 'BULL' | 'BEAR' }>,
        structures: [] as Array<{ idx: number; price: number; label: 'BOS' | 'CHoCH'; bull: boolean }>,
      };
    }

    const lows = visibleCandles.map((c) => c.low);
    const highs = visibleCandles.map((c) => c.high);
    const sortedLows = [...lows].sort((a, b) => a - b);
    const sortedHighs = [...highs].sort((a, b) => b - a);
    const support = sortedLows[Math.min(2, sortedLows.length - 1)];
    const resistance = sortedHighs[Math.min(2, sortedHighs.length - 1)];

    // Order Blocks: последняя противоположная свеча перед сильным импульсом
    const orderBlocks: Array<{ startIdx: number; top: number; bottom: number; type: 'BULL' | 'BEAR' }> = [];
    for (let i = visibleCandles.length - 3; i >= 4 && orderBlocks.length < 2; i -= 1) {
      const prev = visibleCandles[i - 1];
      const cur = visibleCandles[i];
      const body = Math.abs(cur.close - cur.open);
      const prevBody = Math.abs(prev.close - prev.open) || cur.close * 0.002;
      if (cur.close > cur.open && prev.close < prev.open && body > prevBody * 1.45) {
        if (!orderBlocks.some((b) => b.type === 'BULL')) {
          orderBlocks.push({ startIdx: i - 1, top: prev.open, bottom: prev.low, type: 'BULL' });
        }
      } else if (cur.close < cur.open && prev.close > prev.open && body > prevBody * 1.45) {
        if (!orderBlocks.some((b) => b.type === 'BEAR')) {
          orderBlocks.push({ startIdx: i - 1, top: prev.high, bottom: prev.open, type: 'BEAR' });
        }
      }
    }

    // Fair Value Gaps (FVG): 3-свечный дисбаланс
    const fvgs: Array<{ startIdx: number; top: number; bottom: number; type: 'BULL' | 'BEAR' }> = [];
    for (let i = visibleCandles.length - 1; i >= 2 && fvgs.length < 3; i -= 1) {
      const c0 = visibleCandles[i - 2];
      const c2 = visibleCandles[i];
      if (c2.low > c0.high) {
        fvgs.push({ startIdx: i - 1, top: c2.low, bottom: c0.high, type: 'BULL' });
      } else if (c2.high < c0.low) {
        fvgs.push({ startIdx: i - 1, top: c0.low, bottom: c2.high, type: 'BEAR' });
      }
    }

    // BOS / CHoCH структурные пробои свингов
    const structures: Array<{ idx: number; price: number; label: 'BOS' | 'CHoCH'; bull: boolean }> = [];
    let runningHigh = visibleCandles[0].high;
    let runningLow = visibleCandles[0].low;
    let trend: 'up' | 'down' = visibleCandles[5].close >= visibleCandles[0].open ? 'up' : 'down';
    for (let i = 6; i < visibleCandles.length; i += 1) {
      const c = visibleCandles[i];
      if (c.close > runningHigh) {
        structures.push({
          idx: i,
          price: runningHigh,
          label: trend === 'down' ? 'CHoCH' : 'BOS',
          bull: true,
        });
        trend = 'up';
        runningHigh = c.high;
      } else if (c.close < runningLow) {
        structures.push({
          idx: i,
          price: runningLow,
          label: trend === 'up' ? 'CHoCH' : 'BOS',
          bull: false,
        });
        trend = 'down';
        runningLow = c.low;
      }
    }

    return {
      support,
      resistance,
      orderBlocks,
      fvgs,
      structures: structures.slice(-3),
    };
  }, [visibleCandles]);

  // PRO #3: VPVR (Volume Profile Visible Range) — гистограмма по правому краю + POC / VAH / VAL
  const vpvrData = useMemo(() => {
    if (!showVpvr || visibleCandles.length < 4 || !metrics) return null;
    const binsCount = 20;
    const range = metrics.maxPrice - metrics.minPrice || 1;
    const binSize = range / binsCount;
    const bins = Array.from({ length: binsCount }, (_, idx) => ({
      priceMid: metrics.minPrice + (idx + 0.5) * binSize,
      low: metrics.minPrice + idx * binSize,
      high: metrics.minPrice + (idx + 1) * binSize,
      buyVol: 0,
      sellVol: 0,
      totalVol: 0,
    }));

    for (const c of visibleCandles) {
      const mid = (c.high + c.low + c.close) / 3;
      const bIdx = Math.min(binsCount - 1, Math.max(0, Math.floor((mid - metrics.minPrice) / binSize)));
      if (c.close >= c.open) {
        bins[bIdx].buyVol += c.volume;
      } else {
        bins[bIdx].sellVol += c.volume;
      }
      bins[bIdx].totalVol += c.volume;
    }

    const maxBinVol = Math.max(...bins.map((b) => b.totalVol), 1);
    const totalVol = bins.reduce((acc, b) => acc + b.totalVol, 0) || 1;
    let pocIdx = 0;
    for (let i = 1; i < bins.length; i += 1) {
      if (bins[i].totalVol > bins[pocIdx].totalVol) pocIdx = i;
    }

    // 70% Value Area (VAH / VAL) расширяется от POC
    let vaVol = bins[pocIdx].totalVol;
    let lo = pocIdx;
    let hi = pocIdx;
    while (vaVol < totalVol * 0.7 && (lo > 0 || hi < binsCount - 1)) {
      const nextLo = lo > 0 ? bins[lo - 1].totalVol : -1;
      const nextHi = hi < binsCount - 1 ? bins[hi + 1].totalVol : -1;
      if (nextHi >= nextLo && hi < binsCount - 1) {
        hi += 1;
        vaVol += bins[hi].totalVol;
      } else if (lo > 0) {
        lo -= 1;
        vaVol += bins[lo].totalVol;
      } else {
        break;
      }
    }

    return {
      bins,
      maxBinVol,
      pocPrice: bins[pocIdx].priceMid,
      vahPrice: bins[hi].high,
      valPrice: bins[lo].low,
    };
  }, [showVpvr, visibleCandles, metrics]);

  // Сопоставление маркеров исторических и входящих сигналов с ближайшей свечой на экране
  const plottedSignalMarkers = useMemo(() => {
    if (visibleCandles.length === 0 || signalMarkers.length === 0) return [];
    const firstTs = visibleCandles[0].time;
    const lastTs = visibleCandles[visibleCandles.length - 1].time;

    const findNearestCandleIdx = (iso: string): number => {
      const ts = Date.parse(iso);
      if (!Number.isFinite(ts)) return visibleCandles.length - 1;
      if (ts >= lastTs) return visibleCandles.length - 1;
      if (ts <= firstTs) return 0;
      let bestIdx = visibleCandles.length - 1;
      let bestDiff = Infinity;
      for (let i = 0; i < visibleCandles.length; i += 1) {
        const diff = Math.abs(visibleCandles[i].time - ts);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestIdx = i;
        }
      }
      return bestIdx;
    };

    // Распределяем маркеры на одной свече, чтобы они не перекрывали друг друга
    const usedSlots = new Map<number, number>();
    return signalMarkers.map((marker) => {
      let candleIdx = findNearestCandleIdx(marker.emittedAt);
      const slot = usedSlots.get(candleIdx) ?? 0;
      usedSlots.set(candleIdx, slot + 1);
      if (slot > 0 && candleIdx >= slot) {
        candleIdx = Math.max(0, candleIdx - slot * 2);
      }
      return {
        marker,
        candleIdx,
        stackOffset: slot,
      };
    });
  }, [visibleCandles, signalMarkers]);

  const activeAnchorIdx = useMemo(() => {
    if (visibleCandles.length === 0) return 0;
    if (!activeSignalEmittedAt) return Math.max(0, visibleCandles.length - 4);
    const ts = Date.parse(activeSignalEmittedAt);
    if (!Number.isFinite(ts)) return Math.max(0, visibleCandles.length - 4);
    if (ts >= visibleCandles[visibleCandles.length - 1].time) {
      return Math.max(0, visibleCandles.length - 3);
    }
    let bestIdx = visibleCandles.length - 3;
    let bestDiff = Infinity;
    for (let i = 0; i < visibleCandles.length; i += 1) {
      const diff = Math.abs(visibleCandles[i].time - ts);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    }
    return bestIdx;
  }, [visibleCandles, activeSignalEmittedAt]);

  if (!metrics || visibleCandles.length === 0) {
    return (
      <div className="h-[360px] flex items-center justify-center rounded-xl border border-white/8 bg-[#0B0F17] text-sm text-slate-400">
        Загрузка свечного графика {symbol}...
      </div>
    );
  }

  const W = 900;
  const H_MAIN = 264;
  const H_VOL = 52;
  const H_RSI = 68;
  const PAD_L = 12;
  const PAD_R = 76;
  const chartW = W - PAD_L - PAD_R;
  const count = visibleCandles.length;
  const stepX = chartW / count;
  const bodyW = Math.max(3, Math.min(10, stepX * 0.62));

  const priceToY = (p: number) => {
    const ratio = (p - metrics.minPrice) / (metrics.maxPrice - metrics.minPrice || 1);
    return H_MAIN - ratio * (H_MAIN - 20) - 10;
  };

  const yToPrice = (svgY: number) => {
    const ratio = (H_MAIN - 10 - svgY) / (H_MAIN - 20);
    const raw = metrics.minPrice + ratio * (metrics.maxPrice - metrics.minPrice);
    if (raw >= 1000) return Number(raw.toFixed(2));
    if (raw >= 10) return Number(raw.toFixed(3));
    return Number(Math.max(0.0001, raw).toFixed(4));
  };

  const totalSvgHeight = H_MAIN + H_VOL + H_RSI + 18;

  const handleSvgMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const rect = svgEl.getBoundingClientRect();
    if (rect.height <= 0) return;
    const svgY = ((e.clientY - rect.top) / rect.height) * totalSvgHeight;
    if (svgY >= 8 && svgY <= H_MAIN - 6) {
      setHoverPrice(yToPrice(svgY));
    } else {
      setHoverPrice(null);
    }
  };

  const handleSvgClick = () => {
    if (hoverPrice !== null && onPickPriceFromChart) {
      onPickPriceFromChart(hoverPrice);
    }
  };

  const buildPolyline = (getter: (c: CandlePoint) => number | undefined) => {
    const pts: string[] = [];
    visibleCandles.forEach((c, idx) => {
      const val = getter(c);
      if (val !== undefined) {
        const x = PAD_L + idx * stepX + stepX / 2;
        pts.push(`${x.toFixed(1)},${priceToY(val).toFixed(1)}`);
      }
    });
    return pts.join(' ');
  };

  const buildArrayPolyline = (values: number[]) =>
    values
      .map((val, idx) => {
        const x = PAD_L + idx * stepX + stepX / 2;
        return `${x.toFixed(1)},${priceToY(val).toFixed(1)}`;
      })
      .join(' ');

  // Shaded cloud polygon between fastest MA (index 0) and slowest MA (index 3)
  const ribbonCloudPoints =
    showRibbon && ribbonSeries.length >= 2
      ? (() => {
          const fastVals = ribbonSeries[0].values;
          const slowVals = ribbonSeries[ribbonSeries.length - 1].values;
          const topPts = fastVals.map((val, idx) => {
            const x = PAD_L + idx * stepX + stepX / 2;
            return `${x.toFixed(1)},${priceToY(val).toFixed(1)}`;
          });
          const botPts = [...slowVals]
            .reverse()
            .map((val, revIdx) => {
              const idx = slowVals.length - 1 - revIdx;
              const x = PAD_L + idx * stepX + stepX / 2;
              return `${x.toFixed(1)},${priceToY(val).toFixed(1)}`;
            });
          return [...topPts, ...botPts].join(' ');
        })()
      : '';

  const activeCandle = visibleCandles[activeIdx];

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const p = metrics.minPrice + t * (metrics.maxPrice - metrics.minPrice);
    return { price: p, y: priceToY(p) };
  });

  const rsiPoints = visibleCandles
    .map((c, idx) => {
      const x = PAD_L + idx * stepX + stepX / 2;
      const rsi = Math.min(100, Math.max(0, c.rsi14 ?? 50));
      const y = H_MAIN + H_VOL + 12 + ((100 - rsi) / 100) * (H_RSI - 18);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const rsiTop = H_MAIN + H_VOL + 12;
  const rsi70Y = rsiTop + (30 / 100) * (H_RSI - 18);
  const rsi30Y = rsiTop + (70 / 100) * (H_RSI - 18);

  return (
    <div className="relative select-none">
      {/* Live OHLCV Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-xs border-b border-white/8 bg-[#0E1420] rounded-t-xl font-mono tabular-nums">
        <div className="flex flex-wrap items-center gap-3 text-slate-300">
          <span className="text-slate-400">{formatTime(activeCandle.time)}</span>
          <span>
            O <strong className="text-slate-100">{formatPrice(activeCandle.open)}</strong>
          </span>
          <span>
            H <strong className="text-emerald-400">{formatPrice(activeCandle.high)}</strong>
          </span>
          <span>
            L <strong className="text-rose-400">{formatPrice(activeCandle.low)}</strong>
          </span>
          <span>
            C{' '}
            <strong className={activeCandle.close >= activeCandle.open ? 'text-emerald-400' : 'text-rose-400'}>
              {formatPrice(activeCandle.close)}
            </strong>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-slate-400">
          {showEma && activeCandle.ema20 && (
            <span className="text-amber-400">EMA20 {formatPrice(activeCandle.ema20)}</span>
          )}
          {showEma && activeCandle.ema50 && (
            <span className="text-sky-400">EMA50 {formatPrice(activeCandle.ema50)}</span>
          )}
          <span>RSI(14) {(activeCandle.rsi14 ?? 50).toFixed(1)}</span>
        </div>
      </div>

      {/* Moving Average Ribbon Trend Direction Strip */}
      {showRibbon && ribbonSummary && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-[11px] border-b border-white/8 bg-[#0A0E16]">
          <div className="flex items-center gap-2">
            <span className="text-slate-400">Направление тренда (MA Ribbon):</span>
            <span
              className={`font-semibold ${
                ribbonSummary.tone === 'bull'
                  ? 'text-emerald-400'
                  : ribbonSummary.tone === 'bear'
                    ? 'text-rose-400'
                    : 'text-amber-300'
              }`}
            >
              {ribbonSummary.label}
            </span>
            <span className="text-slate-600" aria-hidden="true">
              ·
            </span>
            <span className="font-mono tabular-nums text-slate-400">
              Спред {ribbonSummary.spreadPct >= 0 ? '+' : ''}
              {ribbonSummary.spreadPct.toFixed(2)}%
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 font-mono tabular-nums">
            {ribbonSeries.map((line, i) => (
              <span key={`${line.period}-${i}`} style={{ color: line.color }}>
                {ribbonType}({line.period}) {formatPrice(ribbonSummary.vals[i])}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Interactive SVG Candlestick + Ribbon + Volume + RSI */}
      <div className="w-full overflow-hidden rounded-b-xl bg-[#0B0F17]">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${totalSvgHeight}`}
          className={`w-full h-auto block touch-pan-y ${onPickPriceFromChart ? 'cursor-crosshair' : ''}`}
          onMouseMove={handleSvgMouseMove}
          onClick={handleSvgClick}
          onMouseLeave={() => {
            setHoverIdx(null);
            setHoverPrice(null);
          }}
        >
          {/* Grid lines */}
          {yTicks.map((tick, idx) => (
            <g key={idx}>
              <line
                x1={PAD_L}
                y1={tick.y}
                x2={W - PAD_R}
                y2={tick.y}
                stroke="rgba(255,255,255,0.05)"
                strokeDasharray="3 4"
              />
              <text
                x={W - PAD_R + 6}
                y={tick.y + 4}
                fill="#64748B"
                fontSize="10"
                fontFamily="JetBrains Mono, monospace"
              >
                {formatPrice(tick.price)}
              </text>
            </g>
          ))}

          {/* Moving Average Ribbon Cloud & 4 Graded Trend Lines */}
          {showRibbon && ribbonCloudPoints && (
            <polygon
              points={ribbonCloudPoints}
              fill={ribbonSummary?.isBullCloud ? 'rgba(16, 185, 129, 0.09)' : 'rgba(244, 63, 94, 0.09)'}
            />
          )}

          {showRibbon &&
            ribbonSeries.map((line, idx) => (
              <polyline
                key={`ribbon-${line.period}-${idx}`}
                fill="none"
                stroke={line.color}
                strokeOpacity={idx === 0 ? 0.95 : idx === 3 ? 0.85 : 0.78}
                strokeWidth={idx === 0 || idx === 3 ? '1.6' : '1.25'}
                points={buildArrayPolyline(line.values)}
              />
            ))}

          {/* Bollinger Bands */}
          {showBollinger && (
            <>
              <polyline
                fill="none"
                stroke="rgba(148, 163, 184, 0.35)"
                strokeWidth="1"
                strokeDasharray="4 3"
                points={buildPolyline((c) => c.bbUpper)}
              />
              <polyline
                fill="none"
                stroke="rgba(148, 163, 184, 0.35)"
                strokeWidth="1"
                strokeDasharray="4 3"
                points={buildPolyline((c) => c.bbLower)}
              />
            </>
          )}

          {/* PRO #2: Smart Money Overlays (S/R, Order Blocks, FVG, BOS/CHoCH) */}
          {showSR && smcOverlays.support && smcOverlays.resistance && (
            <g>
              <rect
                x={PAD_L}
                y={priceToY(smcOverlays.resistance) - 5}
                width={chartW}
                height={10}
                fill="rgba(244, 63, 94, 0.14)"
              />
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={priceToY(smcOverlays.resistance)}
                y2={priceToY(smcOverlays.resistance)}
                stroke="rgba(251, 113, 133, 0.65)"
                strokeDasharray="4 4"
              />
              <text
                x={PAD_L + 6}
                y={priceToY(smcOverlays.resistance) - 7}
                fill="#FDA4AF"
                fontSize="9.5"
                fontFamily="JetBrains Mono, monospace"
              >
                R (Сопротивление) {formatPrice(smcOverlays.resistance)}
              </text>

              <rect
                x={PAD_L}
                y={priceToY(smcOverlays.support) - 5}
                width={chartW}
                height={10}
                fill="rgba(16, 185, 129, 0.14)"
              />
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={priceToY(smcOverlays.support)}
                y2={priceToY(smcOverlays.support)}
                stroke="rgba(52, 211, 153, 0.65)"
                strokeDasharray="4 4"
              />
              <text
                x={PAD_L + 6}
                y={priceToY(smcOverlays.support) + 12}
                fill="#6EE7B7"
                fontSize="9.5"
                fontFamily="JetBrains Mono, monospace"
              >
                S (Поддержка) {formatPrice(smcOverlays.support)}
              </text>
            </g>
          )}

          {showOrderBlocks &&
            smcOverlays.orderBlocks.map((ob, idx) => {
              const x = PAD_L + ob.startIdx * stepX;
              const yTop = priceToY(ob.top);
              const yBot = priceToY(ob.bottom);
              const h = Math.max(8, Math.abs(yBot - yTop));
              return (
                <g key={`ob-${idx}`}>
                  <rect
                    x={x}
                    y={Math.min(yTop, yBot)}
                    width={Math.max(24, W - PAD_R - x)}
                    height={h}
                    fill={ob.type === 'BULL' ? 'rgba(16, 185, 129, 0.18)' : 'rgba(244, 63, 94, 0.18)'}
                    stroke={ob.type === 'BULL' ? 'rgba(52, 211, 153, 0.5)' : 'rgba(251, 113, 133, 0.5)'}
                    strokeWidth="0.9"
                    rx="2"
                  />
                  <text
                    x={x + 4}
                    y={Math.min(yTop, yBot) + 10}
                    fill={ob.type === 'BULL' ? '#6EE7B7' : '#FDA4AF'}
                    fontSize="9"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    {ob.type === 'BULL' ? 'Bull OB' : 'Bear OB'}
                  </text>
                </g>
              );
            })}

          {showFvg &&
            smcOverlays.fvgs.map((gap, idx) => {
              const x = PAD_L + gap.startIdx * stepX;
              const yTop = priceToY(gap.top);
              const yBot = priceToY(gap.bottom);
              return (
                <g key={`fvg-${idx}`}>
                  <rect
                    x={x}
                    y={Math.min(yTop, yBot)}
                    width={Math.max(28, W - PAD_R - x)}
                    height={Math.max(5, Math.abs(yBot - yTop))}
                    fill={gap.type === 'BULL' ? 'rgba(34, 211, 238, 0.16)' : 'rgba(251, 191, 36, 0.16)'}
                    stroke={gap.type === 'BULL' ? 'rgba(34, 211, 238, 0.45)' : 'rgba(251, 191, 36, 0.45)'}
                    strokeDasharray="2 2"
                  />
                  <text
                    x={W - PAD_R - 42}
                    y={Math.min(yTop, yBot) + 9}
                    fill={gap.type === 'BULL' ? '#67E8F9' : '#FDE68A'}
                    fontSize="8.5"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    FVG
                  </text>
                </g>
              );
            })}

          {showBosChoch &&
            smcOverlays.structures.map((st, idx) => {
              const xEnd = PAD_L + st.idx * stepX + stepX / 2;
              const xStart = Math.max(PAD_L, xEnd - stepX * 9);
              const y = priceToY(st.price);
              const color = st.bull ? '#34D399' : '#FB7185';
              return (
                <g key={`st-${idx}`}>
                  <line x1={xStart} x2={xEnd} y1={y} y2={y} stroke={color} strokeWidth="1.2" strokeDasharray="3 2" />
                  <rect x={xEnd - 28} y={y - 13} width={34} height={12} rx="3" fill="#0B0F17" stroke={color} strokeWidth="0.8" />
                  <text
                    x={xEnd - 11}
                    y={y - 4.5}
                    textAnchor="middle"
                    fill={color}
                    fontSize="8"
                    fontFamily="JetBrains Mono, monospace"
                    fontWeight="700"
                  >
                    {st.label}
                  </text>
                </g>
              );
            })}

          {/* PRO #3: Volume Profile (VPVR) горизонтальная гистограмма справа + POC / VAH / VAL */}
          {showVpvr && vpvrData && (
            <g>
              {vpvrData.bins.map((b, idx) => {
                const maxBarW = 86;
                const barW = (b.totalVol / vpvrData.maxBinVol) * maxBarW;
                const y1 = priceToY(b.high);
                const y2 = priceToY(b.low);
                const h = Math.max(2, Math.abs(y2 - y1) - 1);
                const buyRatio = b.totalVol > 0 ? b.buyVol / b.totalVol : 0.5;
                const buyW = barW * buyRatio;
                const sellW = barW - buyW;
                const rightX = W - PAD_R;
                return (
                  <g key={`vpvr-${idx}`}>
                    <rect x={rightX - barW} y={Math.min(y1, y2)} width={sellW} height={h} fill="rgba(244, 63, 94, 0.28)" />
                    <rect x={rightX - buyW} y={Math.min(y1, y2)} width={buyW} height={h} fill="rgba(16, 185, 129, 0.34)" />
                  </g>
                );
              })}

              {/* POC пунктирная линия */}
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={priceToY(vpvrData.pocPrice)}
                y2={priceToY(vpvrData.pocPrice)}
                stroke="#F59E0B"
                strokeWidth="1.3"
                strokeDasharray="5 3"
              />
              <text
                x={W - PAD_R - 72}
                y={priceToY(vpvrData.pocPrice) - 3}
                fill="#FBBF24"
                fontSize="9"
                fontFamily="JetBrains Mono, monospace"
                fontWeight="700"
              >
                POC {formatPrice(vpvrData.pocPrice)}
              </text>

              {/* VAH / VAL */}
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={priceToY(vpvrData.vahPrice)}
                y2={priceToY(vpvrData.vahPrice)}
                stroke="rgba(34, 211, 238, 0.5)"
                strokeWidth="0.9"
                strokeDasharray="2 4"
              />
              <text
                x={W - PAD_R - 30}
                y={priceToY(vpvrData.vahPrice) - 2}
                fill="#67E8F9"
                fontSize="8.5"
                fontFamily="JetBrains Mono, monospace"
              >
                VAH
              </text>

              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={priceToY(vpvrData.valPrice)}
                y2={priceToY(vpvrData.valPrice)}
                stroke="rgba(34, 211, 238, 0.5)"
                strokeWidth="0.9"
                strokeDasharray="2 4"
              />
              <text
                x={W - PAD_R - 30}
                y={priceToY(vpvrData.valPrice) + 9}
                fill="#67E8F9"
                fontSize="8.5"
                fontFamily="JetBrains Mono, monospace"
              >
                VAL
              </text>
            </g>
          )}

          {/* Strategy Price Zones & Levels (Entry / Stop-Loss / TP1 / TP2) */}
          {entryLevel &&
            stopLossLevel &&
            entryLevel >= metrics.minPrice &&
            entryLevel <= metrics.maxPrice &&
            stopLossLevel >= metrics.minPrice &&
            stopLossLevel <= metrics.maxPrice && (
              <rect
                x={PAD_L}
                y={Math.min(priceToY(entryLevel), priceToY(stopLossLevel))}
                width={W - PAD_L - PAD_R}
                height={Math.max(2, Math.abs(priceToY(stopLossLevel) - priceToY(entryLevel)))}
                fill="rgba(239, 68, 68, 0.08)"
              />
            )}
          {entryLevel &&
            takeProfitLevel &&
            entryLevel >= metrics.minPrice &&
            entryLevel <= metrics.maxPrice &&
            takeProfitLevel >= metrics.minPrice &&
            takeProfitLevel <= metrics.maxPrice && (
              <rect
                x={PAD_L}
                y={Math.min(priceToY(entryLevel), priceToY(takeProfitLevel))}
                width={W - PAD_L - PAD_R}
                height={Math.max(2, Math.abs(priceToY(takeProfitLevel) - priceToY(entryLevel)))}
                fill="rgba(16, 185, 129, 0.09)"
              />
            )}
          {entryLevel && entryLevel >= metrics.minPrice && entryLevel <= metrics.maxPrice && (
            <g>
              <line
                x1={PAD_L}
                y1={priceToY(entryLevel)}
                x2={W - PAD_R}
                y2={priceToY(entryLevel)}
                stroke="#F59E0B"
                strokeWidth="1.4"
                strokeDasharray="5 4"
              />
              <rect
                x={PAD_L + 3}
                y={priceToY(entryLevel) - 14}
                width={106}
                height={13}
                rx="3"
                fill="rgba(11, 15, 23, 0.9)"
                stroke="rgba(245, 158, 11, 0.55)"
                strokeWidth="0.7"
              />
              <text
                x={PAD_L + 7}
                y={priceToY(entryLevel) - 4.5}
                fill="#FBBF24"
                fontSize="9.5"
                fontWeight="700"
                fontFamily="JetBrains Mono, monospace"
              >
                ВХОД {formatPrice(entryLevel)}
              </text>
            </g>
          )}
          {stopLossLevel && stopLossLevel >= metrics.minPrice && stopLossLevel <= metrics.maxPrice && (
            <g>
              <line
                x1={PAD_L}
                y1={priceToY(stopLossLevel)}
                x2={W - PAD_R}
                y2={priceToY(stopLossLevel)}
                stroke="#EF4444"
                strokeWidth="1.4"
                strokeDasharray="4 4"
              />
              <rect
                x={PAD_L + 3}
                y={priceToY(stopLossLevel) - 14}
                width={98}
                height={13}
                rx="3"
                fill="rgba(11, 15, 23, 0.9)"
                stroke="rgba(239, 68, 68, 0.55)"
                strokeWidth="0.7"
              />
              <text
                x={PAD_L + 7}
                y={priceToY(stopLossLevel) - 4.5}
                fill="#F87171"
                fontSize="9.5"
                fontWeight="700"
                fontFamily="JetBrains Mono, monospace"
              >
                SL {formatPrice(stopLossLevel)}
              </text>
            </g>
          )}
          {takeProfit1Level && takeProfit1Level >= metrics.minPrice && takeProfit1Level <= metrics.maxPrice && (
            <g>
              <line
                x1={PAD_L}
                y1={priceToY(takeProfit1Level)}
                x2={W - PAD_R}
                y2={priceToY(takeProfit1Level)}
                stroke="#22D3EE"
                strokeWidth="1.2"
                strokeDasharray="3 4"
              />
              <rect
                x={PAD_L + 3}
                y={priceToY(takeProfit1Level) - 14}
                width={102}
                height={13}
                rx="3"
                fill="rgba(11, 15, 23, 0.9)"
                stroke="rgba(34, 211, 238, 0.55)"
                strokeWidth="0.7"
              />
              <text
                x={PAD_L + 7}
                y={priceToY(takeProfit1Level) - 4.5}
                fill="#67E8F9"
                fontSize="9.5"
                fontWeight="700"
                fontFamily="JetBrains Mono, monospace"
              >
                TP1 {formatPrice(takeProfit1Level)}
              </text>
            </g>
          )}
          {takeProfitLevel && takeProfitLevel >= metrics.minPrice && takeProfitLevel <= metrics.maxPrice && (
            <g>
              <line
                x1={PAD_L}
                y1={priceToY(takeProfitLevel)}
                x2={W - PAD_R}
                y2={priceToY(takeProfitLevel)}
                stroke="#10B981"
                strokeWidth="1.4"
                strokeDasharray="4 4"
              />
              <rect
                x={PAD_L + 3}
                y={priceToY(takeProfitLevel) - 14}
                width={104}
                height={13}
                rx="3"
                fill="rgba(11, 15, 23, 0.9)"
                stroke="rgba(16, 185, 129, 0.55)"
                strokeWidth="0.7"
              />
              <text
                x={PAD_L + 7}
                y={priceToY(takeProfitLevel) - 4.5}
                fill="#34D399"
                fontSize="9.5"
                fontWeight="700"
                fontFamily="JetBrains Mono, monospace"
              >
                {takeProfit1Level ? 'TP2' : 'TP'} {formatPrice(takeProfitLevel)}
              </text>
            </g>
          )}

          {/* Candlesticks & Volume Bars */}
          {visibleCandles.map((c, idx) => {
            const xCenter = PAD_L + idx * stepX + stepX / 2;
            const isBull = c.close >= c.open;
            const color = isBull ? '#10B981' : '#EF4444';
            const yHigh = priceToY(c.high);
            const yLow = priceToY(c.low);
            const yOpen = priceToY(c.open);
            const yClose = priceToY(c.close);
            const rectTop = Math.min(yOpen, yClose);
            const rectH = Math.max(1.5, Math.abs(yOpen - yClose));

            const volH = (c.volume / metrics.maxVol) * (H_VOL - 8);
            const volY = H_MAIN + H_VOL - volH;

            return (
              <g key={c.time}>
                <line x1={xCenter} y1={yHigh} x2={xCenter} y2={yLow} stroke={color} strokeWidth="1.2" />
                <rect
                  x={xCenter - bodyW / 2}
                  y={rectTop}
                  width={bodyW}
                  height={rectH}
                  fill={color}
                  rx="1"
                />
                <rect
                  x={xCenter - bodyW / 2}
                  y={volY}
                  width={bodyW}
                  height={Math.max(1, volH)}
                  fill={isBull ? 'rgba(16,185,129,0.28)' : 'rgba(239,68,68,0.28)'}
                />
                {/* Invisible hover hitbox */}
                <rect
                  x={PAD_L + idx * stepX}
                  y={0}
                  width={stepX}
                  height={H_MAIN + H_VOL + H_RSI}
                  fill="transparent"
                  onMouseEnter={() => setHoverIdx(idx)}
                  onTouchStart={() => setHoverIdx(idx)}
                />
              </g>
            );
          })}

          {/* Standard EMA 20/50 Overlays */}
          {showEma && (
            <>
              <polyline fill="none" stroke="#F59E0B" strokeWidth="1.4" strokeDasharray="3 2" points={buildPolyline((c) => c.ema20)} />
              <polyline fill="none" stroke="#38BDF8" strokeWidth="1.4" strokeDasharray="3 2" points={buildPolyline((c) => c.ema50)} />
            </>
          )}

          {/* Active Signal Visual Point Markers (Entry / Take-Profit / Stop-Loss) */}
          {entryLevel && entryLevel >= metrics.minPrice && entryLevel <= metrics.maxPrice && (() => {
            const anchorX = PAD_L + activeAnchorIdx * stepX + stepX / 2;
            const entryY = priceToY(entryLevel);
            const hasSl = Boolean(stopLossLevel && stopLossLevel >= metrics.minPrice && stopLossLevel <= metrics.maxPrice);
            const hasTp1 = Boolean(takeProfit1Level && takeProfit1Level >= metrics.minPrice && takeProfit1Level <= metrics.maxPrice);
            const hasTp = Boolean(takeProfitLevel && takeProfitLevel >= metrics.minPrice && takeProfitLevel <= metrics.maxPrice);
            const slY = hasSl && stopLossLevel ? priceToY(stopLossLevel) : entryY;
            const tpY = hasTp && takeProfitLevel ? priceToY(takeProfitLevel) : entryY;
            const tp1Y = hasTp1 && takeProfit1Level ? priceToY(takeProfit1Level) : entryY;
            const isShort = signalDirection === 'SHORT';
            const markerRightX = Math.min(W - PAD_R - 18, Math.max(anchorX + 26, W - PAD_R - 36));
            return (
              <g className="pointer-events-none">
                {/* Вертикальная направляющая от Stop-Loss к Take-Profit в точке входа */}
                {(hasSl || hasTp) && (
                  <line
                    x1={anchorX}
                    y1={Math.min(slY, tpY, entryY)}
                    x2={anchorX}
                    y2={Math.max(slY, tpY, entryY)}
                    stroke="rgba(248, 250, 252, 0.28)"
                    strokeWidth="1.2"
                    strokeDasharray="2 3"
                  />
                )}

                {/* Точка ENTRY (Вход) */}
                <circle cx={anchorX} cy={entryY} r="8" fill="rgba(245, 158, 11, 0.22)" />
                <circle
                  cx={anchorX}
                  cy={entryY}
                  r="4.2"
                  fill="#F59E0B"
                  stroke="#0B0F17"
                  strokeWidth="1.5"
                />
                <polygon
                  points={
                    isShort
                      ? `${anchorX},${entryY + 13} ${anchorX - 5},${entryY + 6} ${anchorX + 5},${entryY + 6}`
                      : `${anchorX},${entryY - 13} ${anchorX - 5},${entryY - 6} ${anchorX + 5},${entryY - 6}`
                  }
                  fill={isShort ? '#FB7185' : '#34D399'}
                />
                <rect
                  x={Math.min(W - PAD_R - 62, Math.max(PAD_L + 4, anchorX - 28))}
                  y={isShort ? entryY + 15 : Math.max(4, entryY - 26)}
                  width={56}
                  height={12}
                  rx="3"
                  fill="rgba(11, 15, 23, 0.94)"
                  stroke="#F59E0B"
                  strokeWidth="0.8"
                />
                <text
                  x={Math.min(W - PAD_R - 34, Math.max(PAD_L + 32, anchorX))}
                  y={isShort ? entryY + 23.5 : Math.max(12.5, entryY - 17.5)}
                  textAnchor="middle"
                  fill="#FDE68A"
                  fontSize="8"
                  fontWeight="700"
                  fontFamily="JetBrains Mono, monospace"
                >
                  ENTRY
                </text>

                {/* Точка Take-Profit 1 (TP1) */}
                {hasTp1 && (
                  <g>
                    <circle cx={markerRightX - 28} cy={tp1Y} r="3.6" fill="#22D3EE" stroke="#0B0F17" strokeWidth="1.2" />
                    <text
                      x={markerRightX - 21}
                      y={tp1Y + 3}
                      fill="#67E8F9"
                      fontSize="8"
                      fontWeight="700"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      TP1
                    </text>
                  </g>
                )}

                {/* Точка Take-Profit (TP / TP2) */}
                {hasTp && (
                  <g>
                    <circle cx={markerRightX} cy={tpY} r="7.5" fill="rgba(16, 185, 129, 0.22)" />
                    <circle cx={markerRightX} cy={tpY} r="4.2" fill="#10B981" stroke="#0B0F17" strokeWidth="1.4" />
                    <rect
                      x={markerRightX - 18}
                      y={Math.max(4, tpY - 18)}
                      width={36}
                      height={12}
                      rx="3"
                      fill="rgba(6, 78, 59, 0.92)"
                      stroke="#34D399"
                      strokeWidth="0.8"
                    />
                    <text
                      x={markerRightX}
                      y={Math.max(12.5, tpY - 9.5)}
                      textAnchor="middle"
                      fill="#A7F3D0"
                      fontSize="8"
                      fontWeight="700"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {hasTp1 ? 'TP2' : 'TP'}
                    </text>
                  </g>
                )}

                {/* Точка Stop-Loss (SL) */}
                {hasSl && (
                  <g>
                    <circle cx={markerRightX} cy={slY} r="7.5" fill="rgba(239, 68, 68, 0.22)" />
                    <circle cx={markerRightX} cy={slY} r="4.2" fill="#EF4444" stroke="#0B0F17" strokeWidth="1.4" />
                    <rect
                      x={markerRightX - 16}
                      y={Math.min(H_MAIN - 14, slY + 6)}
                      width={32}
                      height={12}
                      rx="3"
                      fill="rgba(127, 29, 29, 0.92)"
                      stroke="#F87171"
                      strokeWidth="0.8"
                    />
                    <text
                      x={markerRightX}
                      y={Math.min(H_MAIN - 5.5, slY + 14.5)}
                      textAnchor="middle"
                      fill="#FECACA"
                      fontSize="8"
                      fontWeight="700"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      SL
                    </text>
                  </g>
                )}
              </g>
            );
          })()}

          {/* Historical & Incoming Strategy Signal Markers on Candles */}
          {plottedSignalMarkers.map(({ marker, candleIdx, stackOffset }) => {
            const c = visibleCandles[candleIdx];
            if (!c) return null;
            const cx = PAD_L + candleIdx * stepX + stepX / 2;
            const isLong = marker.direction === 'LONG';
            const isSelected = selectedSignalId === marker.id || marker.source === 'active';
            const isIncoming = marker.source === 'incoming' || marker.source === 'active';
            const baseY = isLong
              ? Math.min(H_MAIN - 12, priceToY(c.low) + 12 + stackOffset * 13)
              : Math.max(14, priceToY(c.high) - 12 - stackOffset * 13);
            const fill = isLong ? '#10B981' : '#F43F5E';
            const stroke = isSelected ? '#FBBF24' : isIncoming ? '#FFFFFF' : 'rgba(255,255,255,0.45)';
            const markerEntryY =
              marker.entryPrice >= metrics.minPrice && marker.entryPrice <= metrics.maxPrice
                ? priceToY(marker.entryPrice)
                : null;

            return (
              <g
                key={`sig-marker-${marker.id}`}
                className={onSelectSignalMarker ? 'cursor-pointer' : undefined}
                onClick={(e) => {
                  if (!onSelectSignalMarker) return;
                  e.stopPropagation();
                  onSelectSignalMarker(marker);
                }}
              >
                <title>
                  {`${marker.source === 'historical' ? 'История' : 'Входящий'} ${marker.direction} · ${marker.strategyName} · Entry ${formatPrice(marker.entryPrice)} · SL ${formatPrice(marker.stopLossPrice)} · TP ${formatPrice(marker.takeProfitPrice)}`}
                </title>
                {markerEntryY !== null && !isSelected && (
                  <circle
                    cx={cx}
                    cy={markerEntryY}
                    r="2.8"
                    fill={fill}
                    fillOpacity="0.8"
                    stroke="#0B0F17"
                    strokeWidth="0.9"
                  />
                )}
                {isIncoming && (
                  <circle cx={cx} cy={baseY} r="9" fill={fill} fillOpacity="0.2" />
                )}
                <polygon
                  points={
                    isLong
                      ? `${cx},${baseY - 6} ${cx - 5.5},${baseY + 4} ${cx + 5.5},${baseY + 4}`
                      : `${cx},${baseY + 6} ${cx - 5.5},${baseY - 4} ${cx + 5.5},${baseY - 4}`
                  }
                  fill={fill}
                  fillOpacity={marker.source === 'historical' && !isSelected ? 0.72 : 1}
                  stroke={stroke}
                  strokeWidth={isSelected ? '1.3' : '0.8'}
                />
                {marker.isLiveOrder && (
                  <circle cx={cx + 5} cy={baseY - 5} r="2.3" fill="#22D3EE" stroke="#0B0F17" strokeWidth="0.7" />
                )}
              </g>
            );
          })}

          {/* Active Push Price Alert Overlays */}
          {priceAlerts
            .filter((a) => a.active && a.targetPrice >= metrics.minPrice && a.targetPrice <= metrics.maxPrice)
            .map((alert) => {
              const ay = priceToY(alert.targetPrice);
              const color = alert.condition === 'above' ? '#22D3EE' : '#FB7185';
              return (
                <g key={`chart-alert-${alert.id}`}>
                  <line
                    x1={PAD_L}
                    y1={ay}
                    x2={W - PAD_R}
                    y2={ay}
                    stroke={color}
                    strokeWidth="1.4"
                    strokeDasharray="6 3"
                  />
                  <rect
                    x={W - PAD_R + 2}
                    y={ay - 9}
                    width={70}
                    height={16}
                    rx="4"
                    fill={alert.condition === 'above' ? 'rgba(34, 211, 238, 0.16)' : 'rgba(251, 113, 133, 0.16)'}
                    stroke={color}
                    strokeWidth="0.7"
                  />
                  <text
                    x={W - PAD_R + 6}
                    y={ay + 2.5}
                    fill={color}
                    fontSize="9"
                    fontFamily="JetBrains Mono, monospace"
                    fontWeight="600"
                  >
                    {alert.condition === 'above' ? '≥' : '≤'} {formatPrice(alert.targetPrice)}
                  </text>
                </g>
              );
            })}

          {/* Draft Quick Alert Preview Line */}
          {draftAlertPrice &&
            Number.isFinite(draftAlertPrice) &&
            draftAlertPrice >= metrics.minPrice &&
            draftAlertPrice <= metrics.maxPrice && (
              <g>
                <line
                  x1={PAD_L}
                  y1={priceToY(draftAlertPrice)}
                  x2={W - PAD_R}
                  y2={priceToY(draftAlertPrice)}
                  stroke="#FBBF24"
                  strokeWidth="1.3"
                  strokeDasharray="2 3"
                />
                <text
                  x={PAD_L + 4}
                  y={priceToY(draftAlertPrice) - 5}
                  fill="#FBBF24"
                  fontSize="10"
                  fontFamily="JetBrains Mono, monospace"
                >
                  ЦЕЛЬ PUSH {formatPrice(draftAlertPrice)}
                </text>
              </g>
            )}

          {/* Vertical & Horizontal Crosshair */}
          {hoverIdx !== null && (
            <line
              x1={PAD_L + hoverIdx * stepX + stepX / 2}
              y1={4}
              x2={PAD_L + hoverIdx * stepX + stepX / 2}
              y2={H_MAIN + H_VOL + H_RSI + 10}
              stroke="rgba(255,255,255,0.22)"
              strokeDasharray="3 3"
            />
          )}
          {hoverPrice !== null && (
            <g className="pointer-events-none">
              <line
                x1={PAD_L}
                y1={priceToY(hoverPrice)}
                x2={W - PAD_R}
                y2={priceToY(hoverPrice)}
                stroke="rgba(34, 211, 238, 0.45)"
                strokeDasharray="3 3"
              />
              <rect
                x={W - PAD_R + 2}
                y={priceToY(hoverPrice) - 9}
                width={70}
                height={17}
                rx="4"
                fill="#0E1420"
                stroke="rgba(34, 211, 238, 0.65)"
                strokeWidth="0.8"
              />
              <text
                x={W - PAD_R + 6}
                y={priceToY(hoverPrice) + 2.5}
                fill="#67E8F9"
                fontSize="9.5"
                fontFamily="JetBrains Mono, monospace"
              >
                {formatPrice(hoverPrice)}
              </text>
            </g>
          )}

          {/* Divider before RSI */}
          <line
            x1={PAD_L}
            y1={H_MAIN + H_VOL + 4}
            x2={W - PAD_R}
            y2={H_MAIN + H_VOL + 4}
            stroke="rgba(255,255,255,0.08)"
          />

          {/* RSI(14) Subchart */}
          <line x1={PAD_L} y1={rsi70Y} x2={W - PAD_R} y2={rsi70Y} stroke="rgba(239,68,68,0.25)" strokeDasharray="3 3" />
          <line x1={PAD_L} y1={rsi30Y} x2={W - PAD_R} y2={rsi30Y} stroke="rgba(16,185,129,0.25)" strokeDasharray="3 3" />
          <text x={W - PAD_R + 6} y={rsi70Y + 3} fill="#64748B" fontSize="9" fontFamily="JetBrains Mono">
            RSI 70
          </text>
          <text x={W - PAD_R + 6} y={rsi30Y + 3} fill="#64748B" fontSize="9" fontFamily="JetBrains Mono">
            RSI 30
          </text>
          <polyline fill="none" stroke="#A78BFA" strokeWidth="1.5" points={rsiPoints} />
        </svg>
      </div>
    </div>
  );
};
