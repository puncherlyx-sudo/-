import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';
import { usePlan } from '../contexts/PlanContext';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { triggerHaptic } from '../lib/securityDlp';
import { PaywallGate } from './PaywallGate';
import { NonCustodialRiskNotice } from './TradeRiskConfirmModal';

interface MonteCarloSimulatorProps {
  isMax?: boolean;
  onUpgradeMax?: () => void;
}

/** Быстрый и статистически качественный 32-битный PRNG (Mulberry32) */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateFreshEntropySeed(prevSeed?: number): number {
  let next = 0;
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    const buf = new Uint32Array(2);
    window.crypto.getRandomValues(buf);
    next = (buf[0] ^ Math.imul(buf[1] | 1, 2654435761)) >>> 0;
  } else {
    next = ((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0) || 1337;
  }
  if (prevSeed !== undefined && next === prevSeed) {
    next = ((next + 0x9e3779b9) >>> 0) || 424242;
  }
  return next;
}

function formatRunClock(ts: number): string {
  return new Date(ts).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

const MAX_SVG_POINTS = 36;

export const MonteCarloSimulator: React.FC<MonteCarloSimulatorProps> = React.memo(
  ({ isMax: isMaxProp, onUpgradeMax }) => {
    const { isMax: ctxMax, plan, maskValue } = usePlan();
    const isMax = Boolean(isMaxProp) || ctxMax || plan === 'MAX';

    const [deposit, setDeposit] = useState(5000);
    const [winRatePct, setWinRatePct] = useState(54);
    const [rrRatio, setRrRatio] = useState(2.0);
    const [riskPerTradePct, setRiskPerTradePct] = useState(1.5);
    const [tradesCount, setTradesCount] = useState(120);

    // Атомарное состояние прогона: мгновенно обновляется при клике «Новый прогон» без дебаунса
    const [runState, setRunState] = useState<{ id: number; seed: number; updatedAt: number }>(() => ({
      id: 1,
      seed: generateFreshEntropySeed(),
      updatedAt: Date.now(),
    }));
    const [isSpinning, setIsSpinning] = useState(false);
    const [chartPulse, setChartPulse] = useState(false);
    const spinTimerRef = useRef<number | null>(null);
    const pulseTimerRef = useRef<number | null>(null);

    useEffect(() => {
      return () => {
        if (spinTimerRef.current !== null) window.clearTimeout(spinTimerRef.current);
        if (pulseTimerRef.current !== null) window.clearTimeout(pulseTimerRef.current);
      };
    }, []);

    // Дебаунс ползунков (150 мс) для плавных 60 FPS на мобильном Chrome
    const dDeposit = useDebouncedValue(deposit, 150);
    const dWinRatePct = useDebouncedValue(winRatePct, 150);
    const dRrRatio = useDebouncedValue(rrRatio, 150);
    const dRiskPerTradePct = useDebouncedValue(riskPerTradePct, 150);
    const dTradesCount = useDebouncedValue(tradesCount, 150);

    const handleNewRun = useCallback(() => {
      triggerHaptic(10);
      setRunState((prev) => ({
        id: prev.id + 1,
        seed: generateFreshEntropySeed(prev.seed),
        updatedAt: Date.now(),
      }));
      setIsSpinning(true);
      setChartPulse(true);
      if (spinTimerRef.current !== null) window.clearTimeout(spinTimerRef.current);
      if (pulseTimerRef.current !== null) window.clearTimeout(pulseTimerRef.current);
      spinTimerRef.current = window.setTimeout(() => {
        setIsSpinning(false);
        spinTimerRef.current = null;
      }, 360);
      pulseTimerRef.current = window.setTimeout(() => {
        setChartPulse(false);
        pulseTimerRef.current = null;
      }, 420);
    }, []);

    // Критерий Келли: f* = p - (1 - p) / R
    const kelly = useMemo(() => {
      const p = dWinRatePct / 100;
      const q = 1 - p;
      const fullKellyPct = (p - q / Math.max(0.2, dRrRatio)) * 100;
      const halfKellyPct = Math.max(0, fullKellyPct * 0.5);
      return {
        fullKellyPct: Number(Math.max(0, fullKellyPct).toFixed(2)),
        recommendedPct: Number(Math.min(5, Math.max(0.25, halfKellyPct)).toFixed(2)),
        hasPositiveEdge: fullKellyPct > 0,
      };
    }, [dWinRatePct, dRrRatio]);

    // Высокопроизводительный прогон 500 сценариев на Float64Array (обновляется мгновенно при каждом runState)
    const sim = useMemo(() => {
      const runs = 500;
      const rng = mulberry32(
        (runState.seed ^ Math.imul(runState.id, 2654435761) ^ Math.imul(dTradesCount, 1597334677)) >>> 0
      );

      // Прореживание точек полилинии SVG (<= 36 узлов) для мгновенного рендера
      const step = Math.max(1, Math.ceil(dTradesCount / (MAX_SVG_POINTS - 1)));
      const sampledSteps: number[] = [];
      for (let t = 0; t <= dTradesCount; t += step) sampledSteps.push(t);
      if (sampledSteps[sampledSteps.length - 1] !== dTradesCount) sampledSteps.push(dTradesCount);
      const sampleCount = sampledSteps.length;

      const sampledMatrix = new Float64Array(sampleCount * runs);
      const finals = new Float64Array(runs);
      const riskFrac = dRiskPerTradePct / 100;
      const winThreshold = dWinRatePct / 100;

      let ddOver20Count = 0;
      let ruinCount = 0;
      let profitableRuns = 0;
      let sample0MaxDd = 0;
      let sample0MaxLossStreak = 0;
      let sample0Wins = 0;

      for (let r = 0; r < runs; r += 1) {
        let eq = dDeposit;
        let peak = dDeposit;
        let maxDd = 0;
        let curLossStreak = 0;
        let maxLossStreak = 0;
        let wins = 0;
        let nextSamplePtr = 1;

        sampledMatrix[r] = eq;

        for (let t = 1; t <= dTradesCount; t += 1) {
          const riskUsd = eq * riskFrac;
          const isWin = rng() < winThreshold;
          if (isWin) {
            eq = Math.max(1, eq + riskUsd * dRrRatio);
            wins += 1;
            curLossStreak = 0;
          } else {
            eq = Math.max(1, eq - riskUsd);
            curLossStreak += 1;
            if (curLossStreak > maxLossStreak) maxLossStreak = curLossStreak;
          }
          if (eq > peak) peak = eq;
          const dd = peak > 0 ? ((peak - eq) / peak) * 100 : 0;
          if (dd > maxDd) maxDd = dd;

          if (nextSamplePtr < sampleCount && sampledSteps[nextSamplePtr] === t) {
            sampledMatrix[nextSamplePtr * runs + r] = eq;
            nextSamplePtr += 1;
          }
        }

        finals[r] = eq;
        if (r === 0) {
          sample0MaxDd = maxDd;
          sample0MaxLossStreak = maxLossStreak;
          sample0Wins = wins;
        }
        if (eq > dDeposit) profitableRuns += 1;
        if (maxDd >= 20) ddOver20Count += 1;
        if (eq <= dDeposit * 0.5 || maxDd >= 50) ruinCount += 1;
      }

      // 4 живые случайные траектории текущего прогона (run 0 — яркая фокусная линия)
      const samplePaths: number[][] = [0, 1, 2, 3].map((runIdx) => {
        const pts: number[] = [];
        for (let s = 0; s < sampleCount; s += 1) {
          pts.push(sampledMatrix[s * runs + runIdx]);
        }
        return pts;
      });

      const bestCurve = new Float64Array(sampleCount);
      const p75Curve = new Float64Array(sampleCount);
      const medianCurve = new Float64Array(sampleCount);
      const p25Curve = new Float64Array(sampleCount);
      const worstCurve = new Float64Array(sampleCount);
      const colBuf = new Float64Array(runs);

      const p05Idx = Math.floor(0.05 * (runs - 1));
      const p25Idx = Math.floor(0.25 * (runs - 1));
      const p50Idx = Math.floor(0.5 * (runs - 1));
      const p75Idx = Math.floor(0.75 * (runs - 1));
      const p95Idx = Math.floor(0.95 * (runs - 1));

      for (let s = 0; s < sampleCount; s += 1) {
        const offset = s * runs;
        colBuf.set(sampledMatrix.subarray(offset, offset + runs));
        colBuf.sort();
        worstCurve[s] = colBuf[p05Idx];
        p25Curve[s] = colBuf[p25Idx];
        medianCurve[s] = colBuf[p50Idx];
        p75Curve[s] = colBuf[p75Idx];
        bestCurve[s] = colBuf[p95Idx];
      }

      const sortedFinals = Float64Array.from(finals).sort();
      const highlightFinal = Math.round(finals[0]);
      const highlightReturnPct = Number((((highlightFinal - dDeposit) / Math.max(1, dDeposit)) * 100).toFixed(1));

      return {
        runs,
        sampledSteps,
        bestCurve,
        p75Curve,
        medianCurve,
        p25Curve,
        worstCurve,
        samplePaths,
        highlightFinal,
        highlightReturnPct,
        highlightMaxDdPct: Number(sample0MaxDd.toFixed(1)),
        highlightMaxLossStreak: sample0MaxLossStreak,
        highlightActualWrPct: Math.round((sample0Wins / Math.max(1, dTradesCount)) * 100),
        p05Final: Math.round(sortedFinals[p05Idx]),
        p50Final: Math.round(sortedFinals[p50Idx]),
        p95Final: Math.round(sortedFinals[p95Idx]),
        ddOver20ProbPct: Number(((ddOver20Count / runs) * 100).toFixed(1)),
        riskOfRuinPct: Number(((ruinCount / runs) * 100).toFixed(1)),
        profitableProbPct: Math.round((profitableRuns / runs) * 100),
      };
    }, [dDeposit, dWinRatePct, dRrRatio, dRiskPerTradePct, dTradesCount, runState.seed, runState.id]);

    // Построение прореженного SVG-веера кривых + фокусной случайной траектории текущего прогона
    const svgFan = useMemo(() => {
      const W = 560;
      const H = 195;
      const padX = 14;
      const padY = 16;
      let minV = dDeposit;
      let maxV = dDeposit;

      const scan = (arr: ArrayLike<number>) => {
        for (let i = 0; i < arr.length; i += 1) {
          const v = arr[i];
          if (v < minV) minV = v;
          if (v > maxV) maxV = v;
        }
      };
      scan(sim.bestCurve);
      scan(sim.worstCurve);
      for (const path of sim.samplePaths) scan(path);
      if (maxV <= minV) maxV = minV + 1;

      const count = sim.sampledSteps.length;
      const xScale = (W - padX * 2) / Math.max(1, count - 1);
      const yScale = (H - padY * 2) / (maxV - minV);
      const xOf = (idx: number) => padX + idx * xScale;
      const yOf = (val: number) => H - padY - (val - minV) * yScale;

      const toLine = (arr: ArrayLike<number>) => {
        const segs: string[] = [];
        for (let i = 0; i < arr.length; i += 1) {
          segs.push(`${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(arr[i]).toFixed(1)}`);
        }
        return segs.join(' ');
      };

      const fanPolygon = (upper: ArrayLike<number>, lower: ArrayLike<number>) => {
        const pts: string[] = [];
        for (let i = 0; i < upper.length; i += 1) {
          pts.push(`${xOf(i).toFixed(1)},${yOf(upper[i]).toFixed(1)}`);
        }
        for (let i = lower.length - 1; i >= 0; i -= 1) {
          pts.push(`${xOf(i).toFixed(1)},${yOf(lower[i]).toFixed(1)}`);
        }
        return pts.join(' ');
      };

      const primaryPath = sim.samplePaths[0] ?? [];
      const endX = xOf(Math.max(0, primaryPath.length - 1));
      const endY = yOf(primaryPath[primaryPath.length - 1] ?? dDeposit);

      return {
        W,
        H,
        baseY: yOf(dDeposit),
        outerFan: fanPolygon(sim.bestCurve, sim.worstCurve),
        innerFan: fanPolygon(sim.p75Curve, sim.p25Curve),
        bestPath: toLine(sim.bestCurve),
        medianPath: toLine(sim.medianCurve),
        worstPath: toLine(sim.worstCurve),
        sampleLinePaths: sim.samplePaths.map((p) => toLine(p)),
        endX,
        endY,
      };
    }, [sim, dDeposit]);

    return (
      <PaywallGate
        requiredPlan="MAX"
        unlocked={isMax}
        onUpgrade={onUpgradeMax}
        title="Симулятор Монте-Карло (500 прогонов) + критерий Келли"
        description="Веер кривых капитала (лучший / медианный / худший исход), вероятность просадки >20%, Risk of Ruin (%) и оптимальный риск по формуле Келли."
      >
        <section className="rounded-2xl border border-cyan-500/25 bg-[var(--surface-1)] p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm sm:text-base font-semibold text-white flex flex-wrap items-center gap-2">
                <Sparkles className="w-4 h-4 text-cyan-400 shrink-0" />
                <span>Монте-Карло (500 сценариев) + критерий Келли</span>
                <span className="text-[10px] font-mono font-bold text-cyan-200 px-1.5 py-0.5 rounded bg-cyan-500/15 border border-cyan-400/35">
                  MAX
                </span>
              </h3>
              <p className="mt-0.5 text-xs text-slate-400">
                Прямой прогон 500 случайных серий сделок (Float64Array) с расчётом Risk of Ruin, Half-Kelly и живой траекторией.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono tabular-nums text-cyan-300/90 px-2 py-1 rounded-lg border border-cyan-500/25 bg-cyan-500/[0.08]">
                Прогон #{runState.id} · {formatRunClock(runState.updatedAt)}
              </span>
              <button
                type="button"
                onClick={handleNewRun}
                aria-label="Запустить новый прогон Монте-Карло"
                className="min-h-[34px] px-3 rounded-xl border border-cyan-400/45 bg-cyan-500/18 hover:bg-cyan-500/28 active:scale-95 text-xs font-semibold text-cyan-100 inline-flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 transition-transform duration-300 ${isSpinning ? 'animate-spin' : ''}`} />
                <span>Новый прогон</span>
              </button>
            </div>
          </div>

          {/* Ползунки параметров (с дебаунсом 150 мс) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 text-xs">
            <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] p-2.5 space-y-1.5">
              <div className="flex justify-between font-mono tabular-nums">
                <span className="font-sans text-slate-400">Депозит</span>
                <strong className="text-white">{maskValue(`$${deposit.toLocaleString('en-US')}`)}</strong>
              </div>
              <input
                type="range"
                min={500}
                max={50000}
                step={500}
                value={deposit}
                onChange={(e) => setDeposit(Number(e.target.value))}
                className="w-full accent-emerald-400"
              />
            </div>

            <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] p-2.5 space-y-1.5">
              <div className="flex justify-between font-mono tabular-nums">
                <span className="font-sans text-slate-400">Win Rate</span>
                <strong className="text-emerald-300">{winRatePct}%</strong>
              </div>
              <input
                type="range"
                min={25}
                max={80}
                step={1}
                value={winRatePct}
                onChange={(e) => setWinRatePct(Number(e.target.value))}
                className="w-full accent-emerald-400"
              />
            </div>

            <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] p-2.5 space-y-1.5">
              <div className="flex justify-between font-mono tabular-nums">
                <span className="font-sans text-slate-400">Соотношение R:R</span>
                <strong className="text-cyan-300">1 : {rrRatio.toFixed(1)}</strong>
              </div>
              <input
                type="range"
                min={0.8}
                max={5}
                step={0.1}
                value={rrRatio}
                onChange={(e) => setRrRatio(Number(e.target.value))}
                className="w-full accent-cyan-400"
              />
            </div>

            <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] p-2.5 space-y-1.5">
              <div className="flex justify-between font-mono tabular-nums">
                <span className="font-sans text-slate-400">Риск/сделка</span>
                <strong className="text-amber-300">{riskPerTradePct.toFixed(2)}%</strong>
              </div>
              <input
                type="range"
                min={0.25}
                max={6}
                step={0.25}
                value={riskPerTradePct}
                onChange={(e) => setRiskPerTradePct(Number(e.target.value))}
                className="w-full accent-amber-400"
              />
            </div>

            <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] p-2.5 space-y-1.5">
              <div className="flex justify-between font-mono tabular-nums">
                <span className="font-sans text-slate-400">Серия сделок</span>
                <strong className="text-white">{tradesCount}</strong>
              </div>
              <input
                type="range"
                min={50}
                max={300}
                step={10}
                value={tradesCount}
                onChange={(e) => setTradesCount(Number(e.target.value))}
                className="w-full accent-cyan-400"
              />
            </div>
          </div>

          {/* Ключевые метрики: Исходы + DD >20% + Risk of Ruin + Критерий Келли */}
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-2 text-xs font-mono tabular-nums">
            <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] p-2.5">
              <div className="font-sans text-[10px] text-slate-400">Лучший (P95)</div>
              <div className="mt-0.5 text-sm font-bold text-cyan-300 truncate">
                {maskValue(`$${sim.p95Final.toLocaleString('en-US')}`)}
              </div>
            </div>
            <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] p-2.5">
              <div className="font-sans text-[10px] text-slate-400">Медиана (P50)</div>
              <div className="mt-0.5 text-sm font-bold text-emerald-400 truncate">
                {maskValue(`$${sim.p50Final.toLocaleString('en-US')}`)}
              </div>
            </div>
            <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] p-2.5">
              <div className="font-sans text-[10px] text-slate-400">Худший (P5)</div>
              <div className="mt-0.5 text-sm font-bold text-amber-300 truncate">
                {maskValue(`$${sim.p05Final.toLocaleString('en-US')}`)}
              </div>
            </div>
            <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] p-2.5">
              <div className="font-sans text-[10px] text-slate-400">Просадка &gt;20%</div>
              <div className={`mt-0.5 text-sm font-bold ${sim.ddOver20ProbPct > 35 ? 'text-rose-400' : 'text-amber-300'}`}>
                {sim.ddOver20ProbPct}%
              </div>
            </div>
            <div className="rounded-xl border border-rose-500/25 bg-rose-500/[0.06] p-2.5">
              <div className="font-sans text-[10px] text-rose-300">Risk of Ruin</div>
              <div className={`mt-0.5 text-sm font-bold ${sim.riskOfRuinPct > 5 ? 'text-rose-400' : 'text-emerald-300'}`}>
                {sim.riskOfRuinPct}%
              </div>
            </div>
            <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/[0.08] p-2.5">
              <div className="font-sans text-[10px] text-cyan-200">Опт. риск (Келли)</div>
              <div className="mt-0.5 text-sm font-bold text-white">
                {kelly.hasPositiveEdge ? `${kelly.recommendedPct}%` : '0% (нет эджа)'}
              </div>
            </div>
          </div>

          {/* Живой результат случайной траектории текущего прогона (мгновенно меняется на каждом нажатии) */}
          <div
            className={`rounded-xl border px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums transition-colors duration-300 ${
              chartPulse
                ? 'border-cyan-400/60 bg-cyan-500/15'
                : 'border-emerald-500/25 bg-emerald-500/[0.06]'
            }`}
          >
            <span className="font-sans text-slate-200">
              Случайная траектория <strong className="text-white">#{runState.id}</strong> · факт WR{' '}
              <strong className="text-cyan-200">{sim.highlightActualWrPct}%</strong> · макс. серия убытков{' '}
              <strong className="text-amber-300">{sim.highlightMaxLossStreak}</strong>:
            </span>
            <div className="flex flex-wrap items-center gap-3">
              <span className={sim.highlightFinal >= dDeposit ? 'text-emerald-300 font-bold' : 'text-rose-300 font-bold'}>
                Итог: {maskValue(`$${sim.highlightFinal.toLocaleString('en-US')}`)} (
                {sim.highlightReturnPct >= 0 ? '+' : ''}
                {sim.highlightReturnPct}%)
              </span>
              <span className="text-amber-300">Макс. DD: {sim.highlightMaxDdPct}%</span>
            </div>
          </div>

          {/* SVG-веер кривых (лучший / медианный / худший + яркая случайная траектория #N) */}
          <div
            className={`rounded-xl border bg-[var(--surface-0)] p-3 space-y-2 transition-colors duration-300 ${
              chartPulse ? 'border-cyan-400/55' : 'border-white/8'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
              <span>
                Веер кривых ({sim.runs} прогонов · {dTradesCount} сделок · в плюсе {sim.profitableProbPct}%)
              </span>
              <div className="flex flex-wrap items-center gap-3 font-mono text-[10px]">
                <span className="text-cyan-300">━ P95</span>
                <span className="text-emerald-400">━ P50</span>
                <span className="text-amber-400">━ P5</span>
                <span className="text-white font-semibold">━ Траектория #{runState.id}</span>
              </div>
            </div>

            <svg
              key={runState.id}
              viewBox={`0 0 ${svgFan.W} ${svgFan.H}`}
              width={svgFan.W}
              height={svgFan.H}
              className="w-full h-[185px] sm:h-[205px] overflow-visible"
              role="img"
              aria-label={`Веер кривых Монте-Карло, прогон ${runState.id}`}
            >
              <line
                x1={14}
                x2={svgFan.W - 14}
                y1={svgFan.baseY}
                y2={svgFan.baseY}
                stroke="rgba(255,255,255,0.18)"
                strokeDasharray="4 4"
              />
              <polygon points={svgFan.outerFan} fill="rgba(34,211,238,0.10)" />
              <polygon points={svgFan.innerFan} fill="rgba(16,185,129,0.16)" />
              {svgFan.sampleLinePaths.slice(1).map((d, idx) => (
                <path
                  key={`bg-${runState.id}-${idx}`}
                  d={d}
                  fill="none"
                  stroke="rgba(148,163,184,0.34)"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
              ))}
              <path d={svgFan.bestPath} fill="none" stroke="#22D3EE" strokeWidth="1.6" />
              <path d={svgFan.medianPath} fill="none" stroke="#10B981" strokeWidth="2.2" />
              <path d={svgFan.worstPath} fill="none" stroke="#F59E0B" strokeWidth="1.6" />
              {svgFan.sampleLinePaths[0] && (
                <>
                  <path
                    d={svgFan.sampleLinePaths[0]}
                    fill="none"
                    stroke="#F8FAFC"
                    strokeWidth="2.1"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle
                    cx={svgFan.endX}
                    cy={svgFan.endY}
                    r="4"
                    fill="#F8FAFC"
                    stroke="#06B6D4"
                    strokeWidth="2"
                  />
                </>
              )}
            </svg>
          </div>

          <NonCustodialRiskNotice
            text={`Рекомендованный риск рассчитан по формуле Half-Kelly (Full Kelly: ${kelly.fullKellyPct}%). Симуляция Монте-Карло носит информационно-статистический характер, не гарантирует доходность, а VERNIER не оперирует вашими деньгами — ответственность за любые реальные сделки несёте только вы.`}
          />
        </section>
      </PaywallGate>
    );
  }
);
MonteCarloSimulator.displayName = 'MonteCarloSimulator';
