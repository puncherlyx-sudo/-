import React, { useMemo, useState } from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';
import { usePlan } from '../contexts/PlanContext';
import { triggerHaptic } from '../lib/securityDlp';
import { PaywallGate } from './PaywallGate';
import { NonCustodialRiskNotice } from './TradeRiskConfirmModal';

interface MonteCarloSimulatorProps {
  isMax?: boolean;
  onUpgradeMax?: () => void;
}

function seededRandom(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export const MonteCarloSimulator: React.FC<MonteCarloSimulatorProps> = ({
  isMax: isMaxProp,
  onUpgradeMax,
}) => {
  const { isMax: ctxMax, maskValue } = usePlan();
  const isMax = typeof isMaxProp === 'boolean' ? isMaxProp : ctxMax;

  const [deposit, setDeposit] = useState(5000);
  const [winRatePct, setWinRatePct] = useState(54);
  const [rrRatio, setRrRatio] = useState(2.0);
  const [riskPerTradePct, setRiskPerTradePct] = useState(1.5);
  const [tradesCount, setTradesCount] = useState(120);
  const [seedNonce, setSeedNonce] = useState(1);

  // Критерий Келли: f* = p - (1 - p) / R
  const kelly = useMemo(() => {
    const p = winRatePct / 100;
    const q = 1 - p;
    const fullKellyPct = (p - q / Math.max(0.2, rrRatio)) * 100;
    const halfKellyPct = Math.max(0, fullKellyPct * 0.5);
    return {
      fullKellyPct: Number(Math.max(0, fullKellyPct).toFixed(2)),
      recommendedPct: Number(Math.min(5, Math.max(0.25, halfKellyPct)).toFixed(2)),
      hasPositiveEdge: fullKellyPct > 0,
    };
  }, [winRatePct, rrRatio]);

  const sim = useMemo(() => {
    const runs = 500;
    const rng = seededRandom(71231 + seedNonce * 997 + Math.round(winRatePct * 17) + tradesCount * 7);
    const paths: number[][] = [];
    let ddOver20Count = 0;
    let ruinCount = 0;
    let profitableRuns = 0;

    for (let r = 0; r < runs; r += 1) {
      let eq = deposit;
      let peak = deposit;
      let maxDd = 0;
      const series: number[] = [eq];

      for (let t = 1; t <= tradesCount; t += 1) {
        const riskUsd = eq * (riskPerTradePct / 100);
        const win = rng() * 100 < winRatePct;
        eq = Math.max(1, eq + (win ? riskUsd * rrRatio : -riskUsd));
        if (eq > peak) peak = eq;
        const dd = peak > 0 ? ((peak - eq) / peak) * 100 : 0;
        if (dd > maxDd) maxDd = dd;
        series.push(eq);
      }

      if (eq > deposit) profitableRuns += 1;
      if (maxDd >= 20) ddOver20Count += 1;
      // Risk of Ruin: потеря ≥ 50% стартового капитала
      if (eq <= deposit * 0.5 || maxDd >= 50) ruinCount += 1;
      paths.push(series);
    }

    const percentile = (arr: number[], p: number) => {
      const sorted = [...arr].sort((a, b) => a - b);
      const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
      return sorted[idx];
    };

    const step = Math.max(1, Math.floor(tradesCount / 40));
    const sampledSteps: number[] = [];
    for (let t = 0; t <= tradesCount; t += step) sampledSteps.push(t);
    if (sampledSteps[sampledSteps.length - 1] !== tradesCount) sampledSteps.push(tradesCount);

    const bestCurve: number[] = [];
    const medianCurve: number[] = [];
    const worstCurve: number[] = [];
    const p75Curve: number[] = [];
    const p25Curve: number[] = [];

    for (const t of sampledSteps) {
      const col = paths.map((p) => p[t]);
      bestCurve.push(percentile(col, 95));
      p75Curve.push(percentile(col, 75));
      medianCurve.push(percentile(col, 50));
      p25Curve.push(percentile(col, 25));
      worstCurve.push(percentile(col, 5));
    }

    const finals = paths.map((p) => p[p.length - 1]);
    return {
      runs,
      sampledSteps,
      bestCurve,
      p75Curve,
      medianCurve,
      p25Curve,
      worstCurve,
      p05Final: Math.round(percentile(finals, 5)),
      p50Final: Math.round(percentile(finals, 50)),
      p95Final: Math.round(percentile(finals, 95)),
      ddOver20ProbPct: Number(((ddOver20Count / runs) * 100).toFixed(1)),
      riskOfRuinPct: Number(((ruinCount / runs) * 100).toFixed(1)),
      profitableProbPct: Math.round((profitableRuns / runs) * 100),
    };
  }, [deposit, winRatePct, rrRatio, riskPerTradePct, tradesCount, seedNonce]);

  // Построение чистого SVG-веера кривых
  const svgFan = useMemo(() => {
    const W = 560;
    const H = 190;
    const padX = 12;
    const padY = 14;
    const allVals = [...sim.bestCurve, ...sim.worstCurve, deposit];
    const minV = Math.min(...allVals);
    const maxV = Math.max(...allVals, minV + 1);
    const xOf = (idx: number) =>
      padX + (idx / Math.max(1, sim.sampledSteps.length - 1)) * (W - padX * 2);
    const yOf = (val: number) =>
      H - padY - ((val - minV) / (maxV - minV)) * (H - padY * 2);

    const toLine = (arr: number[]) =>
      arr.map((v, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ');

    const fanPolygon = (upper: number[], lower: number[]) => {
      const top = upper.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ');
      const bot = [...lower]
        .reverse()
        .map((v, i) => `${xOf(lower.length - 1 - i).toFixed(1)},${yOf(v).toFixed(1)}`)
        .join(' ');
      return `${top} ${bot}`;
    };

    return {
      W,
      H,
      baseY: yOf(deposit),
      outerFan: fanPolygon(sim.bestCurve, sim.worstCurve),
      innerFan: fanPolygon(sim.p75Curve, sim.p25Curve),
      bestPath: toLine(sim.bestCurve),
      medianPath: toLine(sim.medianCurve),
      worstPath: toLine(sim.worstCurve),
    };
  }, [sim, deposit]);

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
            <h3 className="text-sm sm:text-base font-semibold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>Монте-Карло (500 сценариев) + критерий Келли</span>
              <span className="text-[10px] font-mono font-bold text-cyan-200 px-1.5 py-0.5 rounded bg-cyan-500/15 border border-cyan-400/35">
                MAX
              </span>
            </h3>
            <p className="mt-0.5 text-xs text-slate-400">
              Прямой прогон 500 случайных серий сделок в браузере с расчётом Risk of Ruin и Half-Kelly.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              triggerHaptic(8);
              setSeedNonce((n) => n + 1);
            }}
            className="min-h-[34px] px-3 rounded-xl border border-cyan-500/35 bg-cyan-500/12 hover:bg-cyan-500/20 text-xs font-medium text-cyan-200 inline-flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Новый прогон</span>
          </button>
        </div>

        {/* Ползунки параметров */}
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

        {/* SVG-веер кривых (лучший / медианный / худший исход) */}
        <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
            <span>Веер кривых капитала ({sim.runs} прогонов · {tradesCount} сделок)</span>
            <div className="flex items-center gap-3 font-mono text-[10px]">
              <span className="text-cyan-300">━ Лучший</span>
              <span className="text-emerald-400">━ Медиана</span>
              <span className="text-amber-400">━ Худший</span>
            </div>
          </div>

          <svg
            viewBox={`0 0 ${svgFan.W} ${svgFan.H}`}
            className="w-full h-[180px] sm:h-[200px] overflow-visible"
            role="img"
            aria-label="Веер кривых Монте-Карло"
          >
            <line
              x1={12}
              x2={svgFan.W - 12}
              y1={svgFan.baseY}
              y2={svgFan.baseY}
              stroke="rgba(255,255,255,0.18)"
              strokeDasharray="4 4"
            />
            <polygon points={svgFan.outerFan} fill="rgba(34,211,238,0.10)" />
            <polygon points={svgFan.innerFan} fill="rgba(16,185,129,0.16)" />
            <path d={svgFan.bestPath} fill="none" stroke="#22D3EE" strokeWidth="1.8" />
            <path d={svgFan.medianPath} fill="none" stroke="#10B981" strokeWidth="2.4" />
            <path d={svgFan.worstPath} fill="none" stroke="#F59E0B" strokeWidth="1.8" />
          </svg>
        </div>

        <NonCustodialRiskNotice
          text={`Рекомендованный риск рассчитан по формуле Half-Kelly (Full Kelly: ${kelly.fullKellyPct}%). Симуляция Монте-Карло носит информационно-статистический характер, не гарантирует доходность, а VERNIER не оперирует вашими деньгами — ответственность за любые реальные сделки несёте только вы.`}
        />
      </section>
    </PaywallGate>
  );
};
