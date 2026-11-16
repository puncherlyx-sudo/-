import React, { useMemo, useRef, useState } from 'react';
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
  takeProfitLevel?: number | null;
  priceAlerts?: PriceAlertRecord[];
  draftAlertPrice?: number | null;
  onPickPriceFromChart?: (price: number) => void;
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
  takeProfitLevel,
  priceAlerts = [],
  draftAlertPrice,
  onPickPriceFromChart,
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

    if (stopLossLevel && Number.isFinite(stopLossLevel)) minPrice = Math.min(minPrice, stopLossLevel);
    if (takeProfitLevel && Number.isFinite(takeProfitLevel)) maxPrice = Math.max(maxPrice, takeProfitLevel);

    const pad = (maxPrice - minPrice) * 0.08 || maxPrice * 0.01;
    minPrice -= pad;
    maxPrice += pad;
    const maxVol = Math.max(...visibleCandles.map((c) => c.volume), 1);

    return { minPrice, maxPrice, maxVol };
  }, [visibleCandles, showRibbon, ribbonSeries, stopLossLevel, takeProfitLevel]);

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

          {/* Strategy Price Levels (Entry / SL / TP) */}
          {entryLevel && entryLevel >= metrics.minPrice && entryLevel <= metrics.maxPrice && (
            <g>
              <line
                x1={PAD_L}
                y1={priceToY(entryLevel)}
                x2={W - PAD_R}
                y2={priceToY(entryLevel)}
                stroke="#F59E0B"
                strokeWidth="1.2"
                strokeDasharray="5 4"
              />
              <text x={PAD_L + 4} y={priceToY(entryLevel) - 4} fill="#F59E0B" fontSize="10" fontFamily="JetBrains Mono">
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
                strokeWidth="1.2"
                strokeDasharray="4 4"
              />
              <text x={PAD_L + 4} y={priceToY(stopLossLevel) - 4} fill="#EF4444" fontSize="10" fontFamily="JetBrains Mono">
                SL {formatPrice(stopLossLevel)}
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
                strokeWidth="1.2"
                strokeDasharray="4 4"
              />
              <text x={PAD_L + 4} y={priceToY(takeProfitLevel) - 4} fill="#10B981" fontSize="10" fontFamily="JetBrains Mono">
                TP {formatPrice(takeProfitLevel)}
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
