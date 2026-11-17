import type { IndicatorSnapshot, MarketType, Timeframe } from '../src/types/domain.ts';
import { getMarketCandles, SUPPORTED_SYMBOLS } from './market.ts';

/**
 * Сканер сетапов: по каждой паре смотрит тренд на 15м / 1ч / 4ч / 1д и ищет самое согласованное направление
 * рядом с уровнем поддержки/сопротивления. Расчёт по явным правилам (без ИИ), поэтому результат воспроизводим.
 * Это идея для проверки, а не торговая рекомендация.
 */

export const SCAN_TIMEFRAMES: Timeframe[] = ['15m', '1h', '4h', '1d'];
const TF_WEIGHT: Record<Timeframe, number> = { '15m': 1, '1h': 1.5, '4h': 2, '1d': 2 };
const TOTAL_WEIGHT = Object.values(TF_WEIGHT).reduce((a, b) => a + b, 0);

export interface ScanFrame {
  tf: Timeframe;
  bias: IndicatorSnapshot['trendBias'];
  rsi: number;
}

export interface SetupInput {
  symbol: string;
  price: number;
  support: number;
  resistance: number;
  /** ATR 1ч в процентах от цены (волатильность). */
  atrPct: number;
  frames: ScanFrame[];
}

export type SetupGrade = 'A' | 'B' | 'C' | 'D';

export interface SetupCandidate {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  score: number;
  grade: SetupGrade;
  price: number;
  support: number;
  resistance: number;
  /** Отношение потенциала до ближайшего уровня к расстоянию до стопа (по поддержке/сопротивлению). */
  riskReward: number | null;
  frames: ScanFrame[];
  reasons: string[];
  warnings: string[];
}

const biasOf = (frames: ScanFrame[], tf: Timeframe) => frames.find((f) => f.tf === tf)?.bias;

export function gradeOf(score: number): SetupGrade {
  if (score >= 75) return 'A';
  if (score >= 60) return 'B';
  if (score >= 45) return 'C';
  return 'D';
}

/** Оценка сетапа 0–100. Возвращает null, если явного направления нет (согласие таймфреймов меньше половины). */
export function scoreSetup(input: SetupInput): SetupCandidate | null {
  const { frames, price, support, resistance, atrPct } = input;
  if (!(price > 0) || frames.length === 0) return null;

  const longW = frames.filter((f) => f.bias === 'BULLISH').reduce((a, f) => a + TF_WEIGHT[f.tf], 0);
  const shortW = frames.filter((f) => f.bias === 'BEARISH').reduce((a, f) => a + TF_WEIGHT[f.tf], 0);
  const direction: 'LONG' | 'SHORT' = longW >= shortW ? 'LONG' : 'SHORT';
  const aligned = direction === 'LONG' ? longW : shortW;
  if (aligned / TOTAL_WEIGHT < 0.5) return null;

  const want = direction === 'LONG' ? 'BULLISH' : 'BEARISH';
  const against = direction === 'LONG' ? 'BEARISH' : 'BULLISH';
  const reasons: string[] = [];
  const warnings: string[] = [];
  const dirWord = direction === 'LONG' ? 'вверх' : 'вниз';

  // 1) согласие таймфреймов — до 60 очков
  let score = (aligned / TOTAL_WEIGHT) * 60;
  const alignedCount = frames.filter((f) => f.bias === want).length;
  reasons.push(`Тренд ${dirWord} на ${alignedCount} из ${frames.length} таймфреймов`);

  // 2) старшие таймфреймы
  if (biasOf(frames, '4h') === want && biasOf(frames, '1d') === want) {
    score += 10;
    reasons.push('Старшие таймфреймы (4ч и 1д) совпадают');
  }
  if (biasOf(frames, '1d') === against) {
    score -= 15;
    warnings.push('Против тренда на дневном графике');
  }

  // 3) RSI на 1ч: рабочая зона и перегрев
  const rsi = frames.find((f) => f.tf === '1h')?.rsi ?? frames[0].rsi;
  if (direction === 'LONG') {
    if (rsi >= 45 && rsi <= 65) {
      score += 15;
      reasons.push(`RSI ${Math.round(rsi)}: рабочая зона без перегрева`);
    } else if (rsi > 65 && rsi <= 75) {
      score += 8;
    } else if (rsi > 75) {
      score -= 10;
      warnings.push(`Перегрев: RSI ${Math.round(rsi)}, вход вдогонку рискован`);
    }
  } else {
    if (rsi >= 35 && rsi <= 55) {
      score += 15;
      reasons.push(`RSI ${Math.round(rsi)}: рабочая зона без перегрева`);
    } else if (rsi >= 25 && rsi < 35) {
      score += 8;
    } else if (rsi < 25) {
      score -= 10;
      warnings.push(`Перепроданность: RSI ${Math.round(rsi)}, вход вдогонку рискован`);
    }
  }

  // 4) расположение относительно уровней
  const nearZone = Math.max(1.2 * atrPct, 0.5); // «близко» = в пределах ~1.2 ATR, но не меньше 0.5%
  const toSupportPct = ((price - support) / price) * 100;
  const toResistancePct = ((resistance - price) / price) * 100;
  let riskReward: number | null = null;
  if (direction === 'LONG') {
    if (toSupportPct >= 0 && toSupportPct <= nearZone) {
      score += 15;
      reasons.push(`Цена у поддержки (${toSupportPct.toFixed(1)}%): стоп можно поставить близко`);
    }
    if (toResistancePct >= 0 && toResistancePct <= 0.8 * atrPct) {
      score -= 15;
      warnings.push('Вплотную к сопротивлению: мало места для роста');
    }
    if (toSupportPct > 0 && toResistancePct > 0) riskReward = toResistancePct / toSupportPct;
  } else {
    if (toResistancePct >= 0 && toResistancePct <= nearZone) {
      score += 15;
      reasons.push(`Цена у сопротивления (${toResistancePct.toFixed(1)}%): стоп можно поставить близко`);
    }
    if (toSupportPct >= 0 && toSupportPct <= 0.8 * atrPct) {
      score -= 15;
      warnings.push('Вплотную к поддержке: мало места для падения');
    }
    if (toSupportPct > 0 && toResistancePct > 0) riskReward = toSupportPct / toResistancePct;
  }
  if (riskReward !== null) {
    if (riskReward >= 1.5) {
      score += 5;
      reasons.push(`Потенциал до ближайшего уровня в ${riskReward.toFixed(1)} раза больше расстояния до стопа`);
    } else if (riskReward < 1) {
      warnings.push(`Невыгодное соотношение: потенциал меньше риска (${riskReward.toFixed(1)}:1)`);
    }
  }

  // 5) волатильность
  if (atrPct >= 0.25 && atrPct <= 5) score += 5;
  else if (atrPct > 8) warnings.push('Очень высокая волатильность');

  const finalScore = Math.max(0, Math.min(100, Math.round(score)));
  return {
    symbol: input.symbol,
    direction,
    score: finalScore,
    grade: gradeOf(finalScore),
    price,
    support,
    resistance,
    riskReward: riskReward === null ? null : Math.round(riskReward * 10) / 10,
    frames,
    reasons,
    warnings,
  };
}

export interface ScanReport {
  marketType: MarketType;
  scannedPairs: number;
  /** false — часть данных резервная (нет связи с биржей), результат ненадёжен и не оплачивается. */
  live: boolean;
  generatedAt: string;
  setups: SetupCandidate[];
  skippedNoDirection: number;
}

export async function scanSetups(marketType: MarketType, limit = 5): Promise<ScanReport> {
  let live = true;
  const candidates: SetupCandidate[] = [];
  let skipped = 0;

  await Promise.all(
    SUPPORTED_SYMBOLS.map(async (symbol) => {
      const frames: ScanFrame[] = [];
      let base: IndicatorSnapshot | null = null;
      for (const tf of SCAN_TIMEFRAMES) {
        const data = await getMarketCandles(symbol, tf, marketType);
        if (data.source !== 'live') live = false;
        frames.push({ tf, bias: data.indicators.trendBias, rsi: data.indicators.rsi14 });
        if (tf === '1h') base = data.indicators;
      }
      if (!base) return;
      const setup = scoreSetup({
        symbol,
        price: base.lastPrice,
        support: base.supportLevel,
        resistance: base.resistanceLevel,
        atrPct: base.volatilityPct,
        frames,
      });
      if (setup) candidates.push(setup);
      else skipped += 1;
    })
  );

  candidates.sort((a, b) => b.score - a.score);
  return {
    marketType,
    scannedPairs: SUPPORTED_SYMBOLS.length,
    live,
    generatedAt: new Date().toISOString(),
    setups: candidates.slice(0, limit),
    skippedNoDirection: skipped,
  };
}
