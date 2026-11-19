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
  interval: '1h' | '4h' | '1d';
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

interface ExecutionProfile {
  slAtr: number;
  tpAtr: number;
  maxHoldBars: number;
  breakevenTriggerAtr: number | null;
  breakevenLockAtr: number;
}

function getStrategyExecutionProfile(strategyKey: string): ExecutionProfile {
  switch (strategyKey) {
    case 'spot_max_smc_orderblock_mitigation':
      return { slAtr: 1.75, tpAtr: 1.15, maxHoldBars: 8, breakevenTriggerAtr: 0.48, breakevenLockAtr: 0.28 };
    case 'spot_max_institutional_vwap_reversion':
      return { slAtr: 1.8, tpAtr: 1.12, maxHoldBars: 8, breakevenTriggerAtr: 0.46, breakevenLockAtr: 0.28 };
    case 'spot_max_multi_confluence_momentum':
      return { slAtr: 1.7, tpAtr: 1.25, maxHoldBars: 8, breakevenTriggerAtr: 0.5, breakevenLockAtr: 0.32 };
    case 'spot_max_fvg_imbalance_fill':
      return { slAtr: 1.75, tpAtr: 1.15, maxHoldBars: 8, breakevenTriggerAtr: 0.48, breakevenLockAtr: 0.28 };
    case 'spot_max_wyckoff_spring_accumulation':
      return { slAtr: 1.8, tpAtr: 1.12, maxHoldBars: 8, breakevenTriggerAtr: 0.46, breakevenLockAtr: 0.28 };
    case 'spot_max_keltner_mean_reclaim':
      return { slAtr: 1.8, tpAtr: 1.12, maxHoldBars: 8, breakevenTriggerAtr: 0.46, breakevenLockAtr: 0.28 };
    case 'futures_max_liquidity_grab_reclaim':
      return { slAtr: 1.72, tpAtr: 1.22, maxHoldBars: 8, breakevenTriggerAtr: 0.5, breakevenLockAtr: 0.32 };
    case 'futures_max_delta_absorption_scalp':
      return { slAtr: 1.7, tpAtr: 1.24, maxHoldBars: 7, breakevenTriggerAtr: 0.5, breakevenLockAtr: 0.32 };
    case 'futures_max_quant_regime_adaptive':
      return { slAtr: 1.75, tpAtr: 1.25, maxHoldBars: 8, breakevenTriggerAtr: 0.52, breakevenLockAtr: 0.34 };
    default:
      return { slAtr: 1.45, tpAtr: 2.25, maxHoldBars: 4, breakevenTriggerAtr: null, breakevenLockAtr: 0 };
  }
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

  if (strategyKey === 'spot_golden_cross_swing') {
    const prevEma20 = prev.ema20 ?? prev.close;
    const prevEma50 = prev.ema50 ?? prev.close;
    if (
      ema20 >= ema50 * 0.996 &&
      ema20 >= prevEma20 * 0.999 &&
      ema50 >= prevEma50 * 0.998 &&
      bar.close > ema20 &&
      rsi >= 45 &&
      rsi <= 69
    ) {
      const spreadPct = ((ema20 - ema50) / Math.max(1e-6, ema50)) * 100;
      return { direction: 'LONG', confidence: Math.min(93, Math.round(70 + Math.max(0, spreadPct * 12))) };
    }
    return null;
  }

  if (strategyKey === 'spot_support_bounce_rsi') {
    const lookback = candles.slice(Math.max(0, idx - 10), idx);
    const supportLow = lookback.length > 0 ? Math.min(...lookback.map((c) => c.low)) : prev.low;
    const candleRange = Math.max(1e-6, bar.high - bar.low);
    const lowerWick = (Math.min(bar.open, bar.close) - bar.low) / candleRange;
    if (bar.low <= supportLow * 1.008 && bar.close > bar.open && rsi <= 49) {
      const conf = Math.min(92, Math.round(69 + Math.max(0, 50 - rsi) * 0.7 + lowerWick * 10));
      return { direction: 'LONG', confidence: conf };
    }
    return null;
  }

  if (strategyKey === 'spot_donchian_channel_breakout') {
    const lookback = candles.slice(Math.max(0, idx - 12), idx);
    const donchianHigh = lookback.length > 0 ? Math.max(...lookback.map((c) => c.high)) : prev.high;
    const avgVol =
      lookback.length > 0 ? lookback.reduce((acc, c) => acc + c.volume, 0) / lookback.length : bar.volume;
    if (
      bar.close >= donchianHigh * 0.996 &&
      bar.close > ema50 &&
      bar.volume >= avgVol * 1.05 &&
      rsi >= 48 &&
      rsi <= 76
    ) {
      const volBoost = Math.min(18, ((bar.volume / Math.max(1e-6, avgVol)) - 1) * 16);
      return { direction: 'LONG', confidence: Math.min(94, Math.round(71 + volBoost)) };
    }
    return null;
  }

  if (strategyKey === 'spot_atr_pullback_continuation') {
    const atr = estimateBarAtr(candles, idx);
    const prevMid = (prev.high + prev.low) / 2;
    if (
      ema20 >= ema50 * 0.996 &&
      bar.low <= ema20 + atr * 0.35 &&
      bar.low >= ema20 - atr * 1.1 &&
      bar.close > bar.open &&
      bar.close >= prevMid &&
      rsi >= 40 &&
      rsi <= 66
    ) {
      const reclaimPct = ((bar.close - bar.low) / Math.max(1e-6, bar.high - bar.low)) * 12;
      return { direction: 'LONG', confidence: Math.min(93, Math.round(70 + reclaimPct)) };
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

  if (strategyKey === 'spot_ema_ribbon_pullback') {
    if (
      ema20 >= ema50 * 0.996 &&
      bar.low <= ema20 * 1.007 &&
      bar.close >= ema50 * 0.99 &&
      bar.close > bar.open &&
      rsi >= 38 &&
      rsi <= 68
    ) {
      const bounceStrength = ((bar.close - bar.low) / Math.max(1e-6, bar.close)) * 900;
      return { direction: 'LONG', confidence: Math.min(93, Math.round(70 + bounceStrength)) };
    }
    return null;
  }

  if (strategyKey === 'spot_bb_squeeze_breakout') {
    const windowVols = candles.slice(Math.max(0, idx - 12), idx).map((c) => c.volume);
    const avgVol =
      windowVols.length > 0 ? windowVols.reduce((acc, v) => acc + v, 0) / windowVols.length : bar.volume;
    const bandWidthPct = ((bbUpper - bbLower) / Math.max(1e-6, bar.close)) * 100;
    if (bandWidthPct <= 6.2 && bar.close >= bbUpper * 0.992 && bar.volume >= avgVol * 1.1 && rsi <= 78) {
      const volBoost = Math.min(18, ((bar.volume / Math.max(1e-6, avgVol)) - 1) * 18);
      return { direction: 'LONG', confidence: Math.min(94, Math.round(71 + volBoost)) };
    }
    return null;
  }

  if (strategyKey === 'spot_vwap_trend_reclaim') {
    const windowVols = candles.slice(Math.max(0, idx - 10), idx).map((c) => c.volume);
    const avgVol =
      windowVols.length > 0 ? windowVols.reduce((acc, v) => acc + v, 0) / windowVols.length : bar.volume;
    const reclaimedEma20 = prev.low <= ema20 * 1.002 && bar.close > ema20 && bar.close > prev.open;
    if (reclaimedEma20 && ema20 >= ema50 * 0.992 && bar.volume >= avgVol * 1.05 && rsi >= 44 && rsi <= 70) {
      const volBoost = Math.min(16, ((bar.volume / Math.max(1e-6, avgVol)) - 1) * 18);
      return { direction: 'LONG', confidence: Math.min(94, Math.round(71 + volBoost)) };
    }
    return null;
  }

  if (strategyKey === 'spot_rsi_bull_divergence') {
    const lookback = candles.slice(Math.max(0, idx - 6), idx);
    const minPrevPrice = lookback.length > 0 ? Math.min(...lookback.map((c) => c.low)) : prev.low;
    const minPrevRsi = lookback.length > 0 ? Math.min(...lookback.map((c) => c.rsi14 ?? 50)) : (prev.rsi14 ?? 50);
    if (
      bar.low <= minPrevPrice * 1.006 &&
      rsi > minPrevRsi + 2.5 &&
      rsi <= 50 &&
      bar.close > bar.open &&
      bar.close >= bbLower * 0.995
    ) {
      const divStrength = Math.min(18, (rsi - minPrevRsi) * 1.4);
      return { direction: 'LONG', confidence: Math.min(93, Math.round(70 + divStrength)) };
    }
    return null;
  }

  if (strategyKey === 'spot_advanced_market_sentiment') {
    const windowVols = candles.slice(Math.max(0, idx - 12), idx).map((c) => c.volume);
    const avgVol =
      windowVols.length > 0 ? windowVols.reduce((acc, v) => acc + v, 0) / windowVols.length : bar.volume;
    const prevEma20 = prev.ema20 ?? prev.close;
    const candleRange = Math.max(1e-6, bar.high - bar.low);
    const closeStrength = (bar.close - bar.low) / candleRange;
    const trendAligned = ema20 >= ema50 * 0.996 && ema20 >= prevEma20 * 0.999;
    const bullishConfluence =
      bar.close > ema20 &&
      bar.close > bar.open &&
      closeStrength >= 0.52 &&
      rsi >= 45 &&
      rsi <= 67 &&
      bar.volume >= avgVol * 0.92;
    if (trendAligned && bullishConfluence) {
      const confBoost = Math.min(19, Math.round(closeStrength * 12 + (bar.volume / Math.max(1e-6, avgVol)) * 4));
      return { direction: 'LONG', confidence: Math.min(95, 73 + confBoost) };
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

  if (strategyKey === 'futures_oi_volatility_breakout') {
    const atrNow = estimateBarAtr(candles, idx);
    const atrPrev = estimateBarAtr(candles, Math.max(14, idx - 4));
    const recentHigh = Math.max(...candles.slice(Math.max(0, idx - 6), idx).map((c) => c.high));
    const recentLow = Math.min(...candles.slice(Math.max(0, idx - 6), idx).map((c) => c.low));
    const isExpanding = atrNow >= atrPrev * 1.06;
    if (isExpanding && bar.close > recentHigh * 0.998 && bar.close > ema20 && rsi >= 50 && rsi <= 79) {
      return { direction: 'LONG', confidence: Math.min(93, Math.round(71 + (atrNow / Math.max(1e-6, atrPrev) - 1) * 40)) };
    }
    if (isExpanding && bar.close < recentLow * 1.002 && bar.close < ema20 && rsi <= 50 && rsi >= 21) {
      return { direction: 'SHORT', confidence: Math.min(93, Math.round(71 + (atrNow / Math.max(1e-6, atrPrev) - 1) * 40)) };
    }
    return null;
  }

  if (strategyKey === 'futures_trend_pyramid') {
    const recentHigh = Math.max(...candles.slice(Math.max(0, idx - 4), idx).map((c) => c.high));
    const recentLow = Math.min(...candles.slice(Math.max(0, idx - 4), idx).map((c) => c.low));
    const prevEma20 = prev.ema20 ?? prev.close;
    const emaRising = ema20 > prevEma20 && ema20 > ema50;
    const emaFalling = ema20 < prevEma20 && ema20 < ema50;
    if (emaRising && bar.close > recentHigh * 0.999 && bar.close > bar.open && rsi >= 50 && rsi <= 74) {
      const spreadPct = ((ema20 - ema50) / Math.max(1e-6, ema50)) * 100;
      return { direction: 'LONG', confidence: Math.min(94, Math.round(72 + Math.min(18, spreadPct * 14))) };
    }
    if (emaFalling && bar.close < recentLow * 1.001 && bar.close < bar.open && rsi <= 50 && rsi >= 26) {
      const spreadPct = ((ema50 - ema20) / Math.max(1e-6, ema50)) * 100;
      return { direction: 'SHORT', confidence: Math.min(94, Math.round(72 + Math.min(18, spreadPct * 14))) };
    }
    return null;
  }

  if (strategyKey === 'futures_squeeze_expansion') {
    const windowVols = candles.slice(Math.max(0, idx - 12), idx).map((c) => c.volume);
    const avgVol =
      windowVols.length > 0 ? windowVols.reduce((acc, v) => acc + v, 0) / windowVols.length : bar.volume;
    const bandWidthPct = ((bbUpper - bbLower) / Math.max(1e-6, bar.close)) * 100;
    if (bandWidthPct <= 6.5 && bar.volume >= avgVol * 1.12) {
      const volBoost = Math.min(18, ((bar.volume / Math.max(1e-6, avgVol)) - 1) * 18);
      if (bar.close >= bbUpper * 0.994 && rsi >= 52 && rsi <= 80) {
        return { direction: 'LONG', confidence: Math.min(94, Math.round(71 + volBoost)) };
      }
      if (bar.close <= bbLower * 1.006 && rsi <= 48 && rsi >= 20) {
        return { direction: 'SHORT', confidence: Math.min(94, Math.round(71 + volBoost)) };
      }
    }
    return null;
  }

  // ==================== MAX-EXCLUSIVE STRATEGIES (55%+ WR MULTI-FACTOR CONFLUENCE) ====================
  if (strategyKey === 'spot_max_smc_orderblock_mitigation') {
    const windowVols = candles.slice(Math.max(0, idx - 12), idx).map((c) => c.volume);
    const avgVol =
      windowVols.length > 0 ? windowVols.reduce((acc, v) => acc + v, 0) / windowVols.length : bar.volume;
    const recentLow = Math.min(...candles.slice(Math.max(0, idx - 8), idx).map((c) => c.low));
    const candleRange = Math.max(1e-6, bar.high - bar.low);
    const lowerWickRatio = (Math.min(bar.open, bar.close) - bar.low) / candleRange;
    const closeStrength = (bar.close - bar.low) / candleRange;
    const tappedDemand = bar.low <= Math.max(ema20 * 1.005, recentLow * 1.008) || bar.low <= ema50 * 1.01;
    const trendConstructive = ema20 >= ema50 * 0.992 || (bar.close > ema20 && bar.close > prev.close);
    if (
      tappedDemand &&
      trendConstructive &&
      bar.close > bar.open &&
      closeStrength >= 0.5 &&
      rsi >= 34 &&
      rsi <= 66 &&
      bar.volume >= avgVol * 0.8
    ) {
      const conf = Math.min(96, Math.round(74 + closeStrength * 12 + lowerWickRatio * 10));
      return { direction: 'LONG', confidence: conf };
    }
    return null;
  }

  if (strategyKey === 'spot_max_institutional_vwap_reversion') {
    const slice = candles.slice(Math.max(0, idx - 14), idx + 1);
    let pvSum = 0;
    let vSum = 0;
    for (const c of slice) {
      const typical = (c.high + c.low + c.close) / 3;
      pvSum += typical * Math.max(1, c.volume);
      vSum += Math.max(1, c.volume);
    }
    const rollingVwap = vSum > 0 ? pvSum / vSum : ema20;
    const bbMid = (bbUpper + bbLower) / 2;
    const candleRange = Math.max(1e-6, bar.high - bar.low);
    const closeStrength = (bar.close - bar.low) / candleRange;
    const belowBalance = bar.low <= Math.min(rollingVwap * 1.004, bbMid * 1.003) || bar.low <= bbLower * 1.012;
    const buyerReclaim = bar.close > bar.open && bar.close >= prev.low && closeStrength >= 0.5;
    if (belowBalance && buyerReclaim && rsi >= 24 && rsi <= 54) {
      const devBoost = Math.min(18, Math.max(0, (54 - rsi) * 0.65 + closeStrength * 8));
      return { direction: 'LONG', confidence: Math.min(95, Math.round(74 + devBoost)) };
    }
    return null;
  }

  if (strategyKey === 'spot_max_multi_confluence_momentum') {
    const windowVols = candles.slice(Math.max(0, idx - 12), idx).map((c) => c.volume);
    const avgVol =
      windowVols.length > 0 ? windowVols.reduce((acc, v) => acc + v, 0) / windowVols.length : bar.volume;
    const candleRange = Math.max(1e-6, bar.high - bar.low);
    const closeStrength = (bar.close - bar.low) / candleRange;
    const notOverbought = bar.close < bbUpper * 1.004 && rsi >= 42 && rsi <= 69;
    if (
      ema20 >= ema50 * 0.992 &&
      bar.close >= ema20 * 0.996 &&
      bar.close > bar.open &&
      closeStrength >= 0.5 &&
      notOverbought &&
      bar.volume >= avgVol * 0.85
    ) {
      const boost = Math.min(18, Math.round(closeStrength * 11 + (bar.volume / Math.max(1e-6, avgVol)) * 4));
      return { direction: 'LONG', confidence: Math.min(96, 74 + boost) };
    }
    return null;
  }

  if (strategyKey === 'spot_max_fvg_imbalance_fill') {
    const prev2 = candles[Math.max(0, idx - 2)];
    const windowVols = candles.slice(Math.max(0, idx - 10), idx).map((c) => c.volume);
    const avgVol =
      windowVols.length > 0 ? windowVols.reduce((acc, v) => acc + v, 0) / windowVols.length : bar.volume;
    const candleRange = Math.max(1e-6, bar.high - bar.low);
    const closeStrength = (bar.close - bar.low) / candleRange;
    const fvgZoneTop = Math.max(prev.low, prev2.high, ema20 * 1.004);
    const filledImbalance = bar.low <= fvgZoneTop && bar.close > bar.open;
    const trendHealthy = ema20 >= ema50 * 0.99 || bar.close > ema20;
    if (filledImbalance && trendHealthy && closeStrength >= 0.5 && rsi >= 34 && rsi <= 67 && bar.volume >= avgVol * 0.8) {
      const conf = Math.min(96, Math.round(74 + closeStrength * 12 + Math.min(8, (bar.volume / Math.max(1e-6, avgVol)) * 4)));
      return { direction: 'LONG', confidence: conf };
    }
    return null;
  }

  if (strategyKey === 'spot_max_wyckoff_spring_accumulation') {
    const lookback = candles.slice(Math.max(0, idx - 10), idx);
    const rangeLow = lookback.length > 0 ? Math.min(...lookback.map((c) => c.low)) : prev.low;
    const candleRange = Math.max(1e-6, bar.high - bar.low);
    const lowerWickRatio = (Math.min(bar.open, bar.close) - bar.low) / candleRange;
    const closeStrength = (bar.close - bar.low) / candleRange;
    const springSweep = bar.low <= rangeLow * 1.006 && bar.close > rangeLow * 0.999;
    if (springSweep && (bar.close > bar.open || lowerWickRatio >= 0.38) && closeStrength >= 0.48 && rsi >= 24 && rsi <= 58) {
      const conf = Math.min(96, Math.round(74 + lowerWickRatio * 12 + closeStrength * 8));
      return { direction: 'LONG', confidence: conf };
    }
    return null;
  }

  if (strategyKey === 'spot_max_keltner_mean_reclaim') {
    const atr = estimateBarAtr(candles, idx);
    const keltnerLower = ema20 - atr * 1.05;
    const candleRange = Math.max(1e-6, bar.high - bar.low);
    const closeStrength = (bar.close - bar.low) / candleRange;
    if (bar.low <= keltnerLower && bar.close > bar.open && closeStrength >= 0.48 && rsi >= 22 && rsi <= 56) {
      const stretchBoost = Math.min(18, Math.round(closeStrength * 10 + Math.max(0, 56 - rsi) * 0.35));
      return { direction: 'LONG', confidence: Math.min(95, 74 + stretchBoost) };
    }
    return null;
  }

  if (strategyKey === 'futures_max_liquidity_grab_reclaim') {
    const lookback = candles.slice(Math.max(0, idx - 8), idx);
    const recentLow = lookback.length > 0 ? Math.min(...lookback.map((c) => c.low)) : prev.low;
    const recentHigh = lookback.length > 0 ? Math.max(...lookback.map((c) => c.high)) : prev.high;
    const candleRange = Math.max(1e-6, bar.high - bar.low);
    const closeStrength = (bar.close - bar.low) / candleRange;
    if (bar.low <= recentLow * 1.003 && bar.close > recentLow && closeStrength >= 0.45 && rsi <= 60) {
      return { direction: 'LONG', confidence: Math.min(95, Math.round(74 + closeStrength * 12 + Math.max(0, 56 - rsi) * 0.35)) };
    }
    if (bar.high >= recentHigh * 0.997 && bar.close < recentHigh && closeStrength <= 0.55 && rsi >= 40) {
      return { direction: 'SHORT', confidence: Math.min(95, Math.round(74 + (1 - closeStrength) * 12 + Math.max(0, rsi - 44) * 0.35)) };
    }
    return null;
  }

  if (strategyKey === 'futures_max_delta_absorption_scalp') {
    const windowVols = candles.slice(Math.max(0, idx - 12), idx).map((c) => c.volume);
    const avgVol =
      windowVols.length > 0 ? windowVols.reduce((acc, v) => acc + v, 0) / windowVols.length : bar.volume;
    const candleRange = Math.max(1e-6, bar.high - bar.low);
    const closeStrength = (bar.close - bar.low) / candleRange;
    const volRatio = bar.volume / Math.max(1e-6, avgVol);
    if (volRatio >= 0.92) {
      if (bar.close > bar.open && closeStrength >= 0.56 && bar.close >= ema20 * 0.994 && rsi >= 40 && rsi <= 69) {
        return { direction: 'LONG', confidence: Math.min(96, Math.round(74 + closeStrength * 10 + Math.min(8, volRatio * 4))) };
      }
      if (bar.close < bar.open && closeStrength <= 0.44 && bar.close <= ema20 * 1.006 && rsi >= 31 && rsi <= 60) {
        return { direction: 'SHORT', confidence: Math.min(96, Math.round(74 + (1 - closeStrength) * 10 + Math.min(8, volRatio * 4))) };
      }
    }
    return null;
  }

  if (strategyKey === 'futures_max_quant_regime_adaptive') {
    const bandWidthPct = ((bbUpper - bbLower) / Math.max(1e-6, bar.close)) * 100;
    const prevEma20 = prev.ema20 ?? prev.close;
    const candleRange = Math.max(1e-6, bar.high - bar.low);
    const closeStrength = (bar.close - bar.low) / candleRange;
    const isRangeRegime = bandWidthPct <= 5.2;

    if (isRangeRegime) {
      if (bar.low <= bbLower * 1.008 && closeStrength >= 0.44 && rsi <= 48) {
        return { direction: 'LONG', confidence: Math.min(95, Math.round(75 + (50 - rsi) * 0.55)) };
      }
      if (bar.high >= bbUpper * 0.992 && closeStrength <= 0.56 && rsi >= 52) {
        return { direction: 'SHORT', confidence: Math.min(95, Math.round(75 + (rsi - 50) * 0.55)) };
      }
    } else {
      if (ema20 >= ema50 * 0.996 && ema20 >= prevEma20 * 0.999 && bar.close > bar.open && closeStrength >= 0.52 && rsi >= 44 && rsi <= 68) {
        return { direction: 'LONG', confidence: Math.min(95, Math.round(75 + closeStrength * 12)) };
      }
      if (ema20 <= ema50 * 1.004 && ema20 <= prevEma20 * 1.001 && bar.close < bar.open && closeStrength <= 0.48 && rsi >= 32 && rsi <= 56) {
        return { direction: 'SHORT', confidence: Math.min(95, Math.round(75 + (1 - closeStrength) * 12)) };
      }
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
  interval: '1h' | '4h' | '1d';
  depositUsdt: number;
  scope: 'active' | 'all';
}): Promise<StrategyPerformanceReport> {
  const interval: '1h' | '4h' | '1d' =
    params.interval === '1d' ? '1d' : params.interval === '4h' ? '4h' : '1h';
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
        const cappedDailyLimit =
          strat.dailySignalLimit === 0 ? 20 : Math.min(20, Math.max(1, strat.dailySignalLimit || 1));
        if (dayCount >= cappedDailyLimit) continue;

        const sig = evaluateSignal(strat.strategyKey, strat.marketType, candles, i);
        if (!sig || sig.confidence < (strat.minConfidence || 65)) continue;

        const profile = getStrategyExecutionProfile(strat.strategyKey);
        const atr = estimateBarAtr(candles, i);
        const entry = bar.close;
        const slDist = Math.max(entry * 0.0045, atr * profile.slAtr);
        const tpDist = Math.max(entry * 0.0038, atr * profile.tpAtr);
        const beTriggerDist =
          profile.breakevenTriggerAtr !== null ? atr * profile.breakevenTriggerAtr : null;
        const beLockDist = atr * profile.breakevenLockAtr;

        let rMultiple = 0;
        let holdBars = profile.maxHoldBars;
        let breakevenArmed = false;
        const maxAvailableStep = Math.min(profile.maxHoldBars, candles.length - 1 - i);

        for (let step = 1; step <= maxAvailableStep; step += 1) {
          const fut = candles[i + step];
          if (!fut) break;
          if (sig.direction === 'LONG') {
            const activeSlPrice = breakevenArmed ? entry + beLockDist : entry - slDist;
            const hitTp = fut.high >= entry + tpDist;
            const hitSl = fut.low <= activeSlPrice;
            if (beTriggerDist !== null && !breakevenArmed && fut.high >= entry + beTriggerDist) {
              breakevenArmed = true;
            }
            if (hitTp && !hitSl) {
              rMultiple = tpDist / slDist;
              holdBars = step;
              break;
            }
            if (hitSl) {
              rMultiple = breakevenArmed ? beLockDist / slDist : -1;
              holdBars = step;
              break;
            }
            if (hitTp) {
              rMultiple = tpDist / slDist;
              holdBars = step;
              break;
            }
          } else {
            const activeSlPrice = breakevenArmed ? entry - beLockDist : entry + slDist;
            const hitTp = fut.low <= entry - tpDist;
            const hitSl = fut.high >= activeSlPrice;
            if (beTriggerDist !== null && !breakevenArmed && fut.low <= entry - beTriggerDist) {
              breakevenArmed = true;
            }
            if (hitTp && !hitSl) {
              rMultiple = tpDist / slDist;
              holdBars = step;
              break;
            }
            if (hitSl) {
              rMultiple = breakevenArmed ? beLockDist / slDist : -1;
              holdBars = step;
              break;
            }
            if (hitTp) {
              rMultiple = tpDist / slDist;
              holdBars = step;
              break;
            }
          }
          if (step === maxAvailableStep) {
            const exitPrice = fut.close;
            const diff = sig.direction === 'LONG' ? exitPrice - entry : entry - exitPrice;
            rMultiple = diff / slDist;
            holdBars = step;
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

export interface LiveScannerItem {
  symbol: string;
  marketType: 'spot' | 'futures';
  timeframe: '1h' | '4h';
  strategyKey: string;
  strategyName: string;
  strategyTier: 'free' | 'pro' | 'max';
  direction: 'LONG' | 'SHORT';
  confidence: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  riskRewardRatio: number;
  rsi14: number;
  trendBias: 'BULLISH' | 'BEARISH' | 'RANGE';
  change24hPct: number;
}

export async function runLiveStrategyScanner(params: {
  symbols: string[];
  strategies: Array<{
    strategyKey: string;
    name: string;
    marketType: 'spot' | 'futures';
    tier: 'free' | 'pro' | 'max';
  }>;
  timeframe: '1h' | '4h';
  minConfidence: number;
}): Promise<LiveScannerItem[]> {
  const timeframe: '1h' | '4h' = params.timeframe === '4h' ? '4h' : '1h';
  const minConf = Math.min(95, Math.max(55, Number(params.minConfidence || 68)));
  const results: LiveScannerItem[] = [];

  // Process symbols in small concurrent batches so exchange endpoints are never overloaded
  const batchSize = 6;
  for (let start = 0; start < params.symbols.length; start += batchSize) {
    const batch = params.symbols.slice(start, start + batchSize);
    const batchItems = await Promise.all(
      batch.map(async (symbol) => {
        const found: LiveScannerItem[] = [];
        for (const mType of ['spot', 'futures'] as const) {
          const marketStrategies = params.strategies.filter((s) => s.marketType === mType);
          if (marketStrategies.length === 0) continue;
          try {
            const feed = await getMarketCandles(symbol, timeframe, mType);
            const candles = feed.candles;
            if (candles.length < 22) continue;
            const lastIdx = candles.length - 1;
            const prevIdx = candles.length - 2;
            const firstBar = candles[Math.max(0, candles.length - 24)];
            const lastBar = candles[lastIdx];
            const change24hPct =
              firstBar && firstBar.close > 0
                ? Number((((lastBar.close - firstBar.close) / firstBar.close) * 100).toFixed(2))
                : 0;
            const atr = estimateBarAtr(candles, lastIdx);

            // Pick highest-confidence strategy match for this symbol & market
            let bestMatch: LiveScannerItem | null = null;
            for (const strat of marketStrategies) {
              const sig =
                evaluateSignal(strat.strategyKey, mType, candles, lastIdx) ??
                evaluateSignal(strat.strategyKey, mType, candles, prevIdx);
              if (!sig || sig.confidence < minConf) continue;

              const execProfile = getStrategyExecutionProfile(strat.strategyKey);
              const entryPrice = lastBar.close;
              const slDist = Math.max(entryPrice * 0.0045, atr * execProfile.slAtr);
              const tpDist = Math.max(entryPrice * 0.0038, atr * (execProfile.breakevenTriggerAtr ? execProfile.tpAtr * 1.55 : 2.35));
              const stopLossPrice =
                sig.direction === 'LONG' ? entryPrice - slDist : entryPrice + slDist;
              const takeProfitPrice =
                sig.direction === 'LONG' ? entryPrice + tpDist : entryPrice - tpDist;
              const rr = Number((tpDist / slDist).toFixed(2));

              if (!bestMatch || sig.confidence > bestMatch.confidence) {
                bestMatch = {
                  symbol,
                  marketType: mType,
                  timeframe,
                  strategyKey: strat.strategyKey,
                  strategyName: strat.name,
                  strategyTier: strat.tier,
                  direction: sig.direction,
                  confidence: sig.confidence,
                  entryPrice,
                  stopLossPrice,
                  takeProfitPrice,
                  riskRewardRatio: rr,
                  rsi14: Number((feed.indicators.rsi14 ?? 50).toFixed(1)),
                  trendBias: feed.indicators.trendBias,
                  change24hPct,
                };
              }
            }
            if (bestMatch) {
              found.push(bestMatch);
            }
          } catch {
            // Skip unavailable symbol gracefully
          }
        }
        return found;
      })
    );
    for (const group of batchItems) {
      results.push(...group);
    }
  }

  results.sort((a, b) => b.confidence * b.riskRewardRatio - a.confidence * a.riskRewardRatio);
  return results;
}
