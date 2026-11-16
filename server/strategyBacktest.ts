import { getMarketCandles, type CandlePoint } from './market.ts';

export interface StrategySimulationInput {
  strategyKey: string;
  name: string;
  shortTag?: string;
  marketType: 'spot' | 'futures';
  enabled: boolean;
  dailySignalLimit: number;
  minConfidence: number;
  riskPerTradePct: number;
  leverage: number;
  pairs: string[];
}

export interface StrategyBreakdownResult {
  strategyKey: string;
  name: string;
  shortTag: string;
  marketType: 'spot' | 'futures';
  enabled: boolean;
  totalPnlPct: number;
  totalPnlUsdt: number;
  winRatePct: number;
  tradesCount: number;
  profitFactor: number;
  maxDrawdownPct: number;
  avgRiskReward: string;
}

export interface EquityCurvePoint {
  label: string;
  timestamp: number;
  portfolioPnlPct: number;
  portfolioPnlUsdt: number;
  spotPnlPct: number;
  futuresPnlPct: number;
  drawdownPct: number;
}

export interface StrategyPerformanceReport {
  interval: '1h' | '4h';
  depositUsdt: number;
  scope: 'active' | 'all';
  dataSource: 'live' | 'cached';
  summary: {
    totalPnlPct: number;
    totalPnlUsdt: number;
    winRatePct: number;
    profitFactor: number;
    maxDrawdownPct: number;
    totalTrades: number;
    activeStrategiesCount: number;
  };
  equityCurve: EquityCurvePoint[];
  breakdown: StrategyBreakdownResult[];
}

function estimateBarAtr(candles: CandlePoint[], idx: number): number {
  const start = Math.max(1, idx - 13);
  let sum = 0;
  let count = 0;
  for (let j = start; j <= idx; j += 1) {
    const cur = candles[j];
    const prev = candles[j - 1];
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close)
    );
    sum += tr;
    count += 1;
  }
  return count > 0 ? sum / count : candles[idx].close * 0.015;
}

function evaluateSignal(
  strategyKey: string,
  marketType: 'spot' | 'futures',
  candles: CandlePoint[],
  idx: number
): { direction: 'LONG' | 'SHORT'; confidence: number } | null {
  const bar = candles[idx];
  const prev = candles[idx - 1];
  const ema20 = bar.ema20 ?? bar.close;
  const ema50 = bar.ema50 ?? bar.close;
  const rsi = bar.rsi14 ?? 50;
  const bbUpper = bar.bbUpper ?? bar.close * 1.025;
  const bbLower = bar.bbLower ?? bar.close * 0.975;

  if (strategyKey === 'spot_dca_accumulation') {
    if (rsi < 50 || bar.close <= ema50 * 1.008) {
      const conf = Math.min(92, Math.round(69 + Math.max(0, 52 - rsi) * 0.9));
      return { direction: 'LONG', confidence: conf };
    }
    return null;
  }

  if (strategyKey === 'spot_trend_breakout') {
    if (bar.close > ema20 && ema20 >= ema50 * 0.985 && bar.close > prev.close && rsi >= 42 && rsi <= 76) {
      const momentumBoost = ((bar.close - ema20) / Math.max(1e-6, bar.close)) * 1400;
      const conf = Math.min(94, Math.round(70 + Math.max(0, momentumBoost)));
      return { direction: 'LONG', confidence: conf };
    }
    return null;
  }

  if (strategyKey === 'spot_mean_reversion') {
    if (bar.low <= bbLower * 1.01 || rsi < 44) {
      const conf = Math.min(91, Math.round(69 + Math.max(0, 46 - rsi) * 1.1));
      return { direction: 'LONG', confidence: conf };
    }
    return null;
  }

  if (strategyKey === 'futures_momentum_atr') {
    if (bar.close > ema20 && ema20 >= ema50 * 0.998 && rsi >= 48 && rsi <= 75) {
      const spreadPct = Math.abs((ema20 - ema50) / Math.max(1e-6, ema50)) * 100;
      return { direction: 'LONG', confidence: Math.min(93, Math.round(70 + spreadPct * 12)) };
    }
    if (bar.close < ema20 && ema20 <= ema50 * 1.002 && rsi <= 52 && rsi >= 25) {
      const spreadPct = Math.abs((ema50 - ema20) / Math.max(1e-6, ema50)) * 100;
      return { direction: 'SHORT', confidence: Math.min(93, Math.round(70 + spreadPct * 12)) };
    }
    return null;
  }

  if (strategyKey === 'futures_liquidity_sweep') {
    const recentLow = Math.min(...candles.slice(Math.max(0, idx - 6), idx).map((c) => c.low));
    const recentHigh = Math.max(...candles.slice(Math.max(0, idx - 6), idx).map((c) => c.high));
    if (bar.low <= recentLow * 1.001 && bar.close > recentLow && rsi < 54) {
      return { direction: 'LONG', confidence: Math.min(91, Math.round(69 + Math.max(0, 55 - rsi) * 0.8)) };
    }
    if (bar.high >= recentHigh * 0.999 && bar.close < recentHigh && rsi > 46) {
      return { direction: 'SHORT', confidence: Math.min(91, Math.round(69 + Math.max(0, rsi - 45) * 0.8)) };
    }
    return null;
  }

  if (strategyKey === 'futures_funding_reversal') {
    if (bar.high >= bbUpper * 0.994 && rsi > 58) {
      return { direction: 'SHORT', confidence: Math.min(92, Math.round(69 + (rsi - 56) * 1.1)) };
    }
    if (bar.low <= bbLower * 1.006 && rsi < 42) {
      return { direction: 'LONG', confidence: Math.min(92, Math.round(69 + (44 - rsi) * 1.1)) };
    }
    return null;
  }

  // Generic directional fallback
  if (bar.close > ema20) {
    return { direction: 'LONG', confidence: 68 };
  }
  if (marketType === 'futures' && bar.close < ema20) {
    return { direction: 'SHORT', confidence: 68 };
  }
  return null;
}

export async function runStrategyPortfolioBacktest(params: {
  strategies: StrategySimulationInput[];
  interval: '1h' | '4h';
  depositUsdt: number;
  scope: 'active' | 'all';
}): Promise<StrategyPerformanceReport> {
  const interval = params.interval === '4h' ? '4h' : '1h';
  const depositUsdt = Math.min(10_000_000, Math.max(100, Number(params.depositUsdt || 2500)));
  const scope = params.scope === 'all' ? 'all' : 'active';

  const marketCache = new Map<string, Awaited<ReturnType<typeof getMarketCandles>>>();
  const fetchPair = async (symbol: string, marketType: 'spot' | 'futures') => {
    const key = `${marketType}:${symbol}`;
    const cached = marketCache.get(key);
    if (cached) return cached;
    const data = await getMarketCandles(symbol, interval, marketType);
    marketCache.set(key, data);
    return data;
  };

  // Preload required pair candles concurrently
  const preloadJobs: Promise<unknown>[] = [];
  for (const s of params.strategies) {
    const pairList = (s.pairs && s.pairs.length > 0 ? s.pairs : ['BTCUSDT']).slice(0, 2);
    for (const sym of pairList) {
      preloadJobs.push(fetchPair(sym, s.marketType));
    }
  }
  await Promise.all(preloadJobs);

  let anyCached = false;
  for (const data of marketCache.values()) {
    if (data.source === 'cached') {
      anyCached = true;
      break;
    }
  }

  // Reference timeline taken from BTCUSDT spot/futures 90-bar grid
  const refFeed = await fetchPair('BTCUSDT', 'spot');
  const timelineCandles = refFeed.candles.slice(20, -4);
  const spotDeltaByIdx = new Array<number>(timelineCandles.length).fill(0);
  const futuresDeltaByIdx = new Array<number>(timelineCandles.length).fill(0);

  const breakdown: StrategyBreakdownResult[] = [];
  let portfolioWins = 0;
  let portfolioTrades = 0;
  let portfolioGrossProfit = 0;
  let portfolioGrossLoss = 0;

  for (const strat of params.strategies) {
    const pairList = (strat.pairs && strat.pairs.length > 0 ? strat.pairs : ['BTCUSDT']).slice(0, 2);
    const includeInPortfolio = scope === 'all' ? true : strat.enabled;

    let stratTrades = 0;
    let stratWins = 0;
    let stratGrossProfit = 0;
    let stratGrossLoss = 0;
    let stratCumPct = 0;
    let stratPeak = 0;
    let stratMaxDd = 0;
    let rRewardSum = 0;

    for (const sym of pairList) {
      const feed = await fetchPair(sym, strat.marketType);
      const candles = feed.candles;
      const dailyBuckets = new Map<number, number>();
      let cooldownUntilIdx = 0;

      for (let i = 20; i < candles.length - 4; i += 1) {
        if (i < cooldownUntilIdx) continue;
        const bar = candles[i];
        const dayKey = Math.floor(bar.time / 86_400_000);
        const dayCount = dailyBuckets.get(dayKey) ?? 0;
        const cappedDailyLimit = Math.min(20, Math.max(1, strat.dailySignalLimit || 1));
        if (dayCount >= cappedDailyLimit) continue;

        const sig = evaluateSignal(strat.strategyKey, strat.marketType, candles, i);
        if (!sig || sig.confidence < (strat.minConfidence || 65)) continue;

        const atr = estimateBarAtr(candles, i);
        const entry = bar.close;
        const slDist = Math.max(entry * 0.0045, atr * 1.45);
        const tpDist = atr * 2.25;

        let rMultiple = 0;
        let holdBars = 4;
        for (let step = 1; step <= 4; step += 1) {
          const fut = candles[i + step];
          if (!fut) break;
          if (sig.direction === 'LONG') {
            const hitSl = fut.low <= entry - slDist;
            const hitTp = fut.high >= entry + tpDist;
            if (hitSl) {
              rMultiple = -1;
              holdBars = step;
              break;
            }
            if (hitTp) {
              rMultiple = tpDist / slDist;
              holdBars = step;
              break;
            }
          } else {
            const hitSl = fut.high >= entry + slDist;
            const hitTp = fut.low <= entry - tpDist;
            if (hitSl) {
              rMultiple = -1;
              holdBars = step;
              break;
            }
            if (hitTp) {
              rMultiple = tpDist / slDist;
              holdBars = step;
              break;
            }
          }
          if (step === 4) {
            const exitPrice = fut.close;
            const diff = sig.direction === 'LONG' ? exitPrice - entry : entry - exitPrice;
            rMultiple = diff / slDist;
          }
        }

        const slPct = Math.max(0.0045, slDist / entry);
        const riskPct = Math.min(10, Math.max(0.25, Number(strat.riskPerTradePct || 1.5)));
        const maxLev = strat.marketType === 'spot' ? 1 : Math.min(20, Math.max(1, Number(strat.leverage || 5)));
        const desiredNotional = riskPct / 100 / slPct;
        const effectiveNotional = Math.min(desiredNotional, maxLev);
        const effectiveRiskPct = effectiveNotional * slPct * 100;
        const feeDragPct = effectiveNotional * 0.08;
        const tradePnlPct = (effectiveRiskPct * rMultiple - feeDragPct) / pairList.length;

        dailyBuckets.set(dayKey, dayCount + 1);
        cooldownUntilIdx = i + holdBars;

        stratTrades += 1;
        if (tradePnlPct > 0) {
          stratWins += 1;
          stratGrossProfit += tradePnlPct;
        } else {
          stratGrossLoss += Math.abs(tradePnlPct);
        }
        rRewardSum += Math.max(-1, rMultiple);

        stratCumPct += tradePnlPct;
        if (stratCumPct > stratPeak) stratPeak = stratCumPct;
        const dd = stratPeak - stratCumPct;
        if (dd > stratMaxDd) stratMaxDd = dd;

        if (includeInPortfolio) {
          const timelineIdx = Math.min(timelineCandles.length - 1, Math.max(0, i + holdBars - 20));
          if (strat.marketType === 'spot') {
            spotDeltaByIdx[timelineIdx] += tradePnlPct;
          } else {
            futuresDeltaByIdx[timelineIdx] += tradePnlPct;
          }
        }
      }
    }

    if (includeInPortfolio) {
      portfolioTrades += stratTrades;
      portfolioWins += stratWins;
      portfolioGrossProfit += stratGrossProfit;
      portfolioGrossLoss += stratGrossLoss;
    }

    const profitFactor =
      stratGrossLoss > 0.001
        ? Number((stratGrossProfit / stratGrossLoss).toFixed(2))
        : stratGrossProfit > 0
          ? 3.0
          : 0;

    const avgRr =
      stratTrades > 0
        ? `1 : ${Math.max(0.4, Number((Math.abs(rRewardSum / stratTrades) + 1.1).toFixed(1)))}`
        : '—';

    breakdown.push({
      strategyKey: strat.strategyKey,
      name: strat.name,
      shortTag: strat.shortTag || (strat.marketType === 'futures' ? 'Фьючерсы' : 'Спот'),
      marketType: strat.marketType,
      enabled: strat.enabled,
      totalPnlPct: Number(stratCumPct.toFixed(2)),
      totalPnlUsdt: Number(((depositUsdt * stratCumPct) / 100).toFixed(2)),
      winRatePct: stratTrades > 0 ? Number(((stratWins / stratTrades) * 100).toFixed(1)) : 0,
      tradesCount: stratTrades,
      profitFactor,
      maxDrawdownPct: Number((-stratMaxDd).toFixed(2)),
      avgRiskReward: avgRr,
    });
  }

  // Build cumulative timeline points
  const activeCount = params.strategies.filter((s) => (scope === 'all' ? true : s.enabled)).length;
  const weightDivisor = Math.max(1, Math.sqrt(activeCount));
  let cumSpot = 0;
  let cumFutures = 0;
  let peakPortfolio = 0;
  let maxPortfolioDd = 0;

  const equityCurve: EquityCurvePoint[] = timelineCandles.map((c, idx) => {
    cumSpot += spotDeltaByIdx[idx] / weightDivisor;
    cumFutures += futuresDeltaByIdx[idx] / weightDivisor;
    const totalPct = cumSpot + cumFutures;
    if (totalPct > peakPortfolio) peakPortfolio = totalPct;
    const dd = peakPortfolio - totalPct;
    if (dd > maxPortfolioDd) maxPortfolioDd = dd;

    const d = new Date(c.time);
    const label = d.toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
    }) + (interval === '1h' ? ` ${String(d.getHours()).padStart(2, '0')}:00` : '');

    return {
      label,
      timestamp: c.time,
      portfolioPnlPct: Number(totalPct.toFixed(2)),
      portfolioPnlUsdt: Number(((depositUsdt * totalPct) / 100).toFixed(2)),
      spotPnlPct: Number(cumSpot.toFixed(2)),
      futuresPnlPct: Number(cumFutures.toFixed(2)),
      drawdownPct: Number((-dd).toFixed(2)),
    };
  });

  const finalPoint = equityCurve[equityCurve.length - 1];
  const totalPnlPct = finalPoint ? finalPoint.portfolioPnlPct : 0;
  const totalPnlUsdt = finalPoint ? finalPoint.portfolioPnlUsdt : 0;
  const portfolioPf =
    portfolioGrossLoss > 0.001
      ? Number((portfolioGrossProfit / portfolioGrossLoss).toFixed(2))
      : portfolioGrossProfit > 0
        ? 3.0
        : 0;

  return {
    interval,
    depositUsdt,
    scope,
    dataSource: anyCached ? 'cached' : 'live',
    summary: {
      totalPnlPct,
      totalPnlUsdt,
      winRatePct: portfolioTrades > 0 ? Number(((portfolioWins / portfolioTrades) * 100).toFixed(1)) : 0,
      profitFactor: portfolioPf,
      maxDrawdownPct: Number((-maxPortfolioDd).toFixed(2)),
      totalTrades: portfolioTrades,
      activeStrategiesCount: params.strategies.filter((s) => s.enabled).length,
    },
    equityCurve,
    breakdown,
  };
}
