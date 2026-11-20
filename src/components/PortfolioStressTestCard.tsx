import React, { useMemo, useState } from 'react';
import { AlertTriangle, ShieldAlert, Sliders } from 'lucide-react';
import { usePlan } from '../contexts/PlanContext';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { triggerHaptic } from '../lib/securityDlp';
import { PaywallGate } from './PaywallGate';
import { NonCustodialRiskNotice } from './TradeRiskConfirmModal';

export interface StressTestHoldingInput {
  symbol: string;
  valueUsdt: number;
}

interface PortfolioStressTestCardProps {
  holdings: StressTestHoldingInput[];
  totalValueUsdt: number;
}

type ScenarioId = 'custom' | 'btc_crash' | 'btc_rally' | 'usdt_d_spike' | 'alt_crash';

const STABLES = new Set(['USDT', 'USDC', 'FDUSD', 'DAI', 'USDE', 'USDTUSDT', 'USDCUSDT']);

function getBetaToBtc(symbol: string): number {
  const clean = symbol.replace(/USDT$/i, '').toUpperCase();
  if (STABLES.has(clean)) return 0;
  if (clean === 'BTC') return 1.0;
  if (clean === 'ETH') return 1.18;
  if (clean === 'BNB' || clean === 'TRX') return 0.92;
  if (clean === 'SOL' || clean === 'AVAX' || clean === 'SUI' || clean === 'LINK') return 1.48;
  if (clean === 'PEPE' || clean === 'DOGE' || clean === 'WIF' || clean === 'SHIB' || clean === 'BONK') return 2.05;
  return 1.6;
}

function fmtUsd(v: number): string {
  const abs = Math.abs(v);
  const s = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v < 0 ? '-' : ''}$${s}`;
}

export const PortfolioStressTestCard: React.FC<PortfolioStressTestCardProps> = ({
  holdings,
  totalValueUsdt,
}) => {
  const { isMax, maskValue } = usePlan();
  const [scenario, setScenario] = useState<ScenarioId>('btc_crash');
  const [btcShockPct, setBtcShockPct] = useState<number>(-20);
  const debouncedShockPct = useDebouncedValue(btcShockPct, 150);

  const effectiveHoldings = useMemo<StressTestHoldingInput[]>(() => {
    if (holdings.length > 0 && totalValueUsdt > 0) return holdings;
    return [
      { symbol: 'BTCUSDT', valueUsdt: 4500 },
      { symbol: 'ETHUSDT', valueUsdt: 2800 },
      { symbol: 'SOLUSDT', valueUsdt: 1900 },
      { symbol: 'USDT', valueUsdt: 800 },
    ];
  }, [holdings, totalValueUsdt]);

  const effectiveTotal = useMemo(
    () => effectiveHoldings.reduce((acc, h) => acc + Math.max(0, h.valueUsdt), 0),
    [effectiveHoldings]
  );

  const simulation = useMemo(() => {
    let projectedTotal = 0;
    let worstAsset: { symbol: string; pnlUsdt: number; shockPct: number } | null = null;

    for (const item of effectiveHoldings) {
      const clean = item.symbol.replace(/USDT$/i, '').toUpperCase();
      const beta = getBetaToBtc(clean);
      let assetShockPct = debouncedShockPct * beta;

      if (scenario === 'usdt_d_spike') {
        assetShockPct = STABLES.has(clean) ? 0 : clean === 'BTC' ? -14 : -24 * Math.min(1.4, beta / 1.2);
      } else if (scenario === 'alt_crash') {
        assetShockPct = STABLES.has(clean) ? 0 : clean === 'BTC' ? -12 : -35;
      }

      assetShockPct = Math.max(-92, Math.min(180, assetShockPct));
      const newVal = item.valueUsdt * (1 + assetShockPct / 100);
      const pnlUsdt = newVal - item.valueUsdt;
      projectedTotal += newVal;

      if (!worstAsset || pnlUsdt < worstAsset.pnlUsdt) {
        worstAsset = { symbol: clean, pnlUsdt, shockPct: Number(assetShockPct.toFixed(1)) };
      }
    }

    const deltaUsdt = projectedTotal - effectiveTotal;
    const deltaPct = effectiveTotal > 0 ? (deltaUsdt / effectiveTotal) * 100 : 0;
    const extraDrawdownPct = deltaPct < 0 ? Math.abs(deltaPct) : 0;

    return {
      projectedTotal,
      deltaUsdt,
      deltaPct: Number(deltaPct.toFixed(2)),
      extraDrawdownPct: Number(extraDrawdownPct.toFixed(1)),
      worstAsset,
    };
  }, [effectiveHoldings, effectiveTotal, debouncedShockPct, scenario]);

  const applyPreset = (id: ScenarioId, btcPct: number) => {
    triggerHaptic(8);
    setScenario(id);
    setBtcShockPct(btcPct);
  };

  return (
    <PaywallGate
      requiredPlan="MAX"
      unlocked={isMax}
      title="Стресс-тест портфеля («Что если?»)"
      description="Моделирование шок-сценариев BTC -20%, BTC +25%, роста USDT.D и обвала альткоинов -35% с поиском самой уязвимой позиции."
    >
      <div className="rounded-2xl border border-cyan-500/25 bg-[var(--surface-1)] p-4 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs sm:text-sm font-semibold text-white">
            <ShieldAlert className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>Стресс-тест портфеля («Что если?»)</span>
            <span className="text-[10px] font-mono font-bold text-cyan-200 px-1.5 py-0.5 rounded bg-cyan-500/15 border border-cyan-400/35">
              MAX
            </span>
          </div>
          <span className="text-[11px] font-mono tabular-nums text-slate-400">
            База: {maskValue(fmtUsd(effectiveTotal))}
          </span>
        </div>

        {/* Готовые шок-сценарии */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {(
            [
              { id: 'btc_crash', label: 'BTC -20%', pct: -20 },
              { id: 'btc_rally', label: 'BTC +25%', pct: 25 },
              { id: 'usdt_d_spike', label: 'Рост USDT.D', pct: -14 },
              { id: 'alt_crash', label: 'Обвал альтов -35%', pct: -12 },
            ] as const
          ).map((btn) => (
            <button
              key={btn.id}
              type="button"
              onClick={() => applyPreset(btn.id, btn.pct)}
              className={`min-h-[36px] px-2.5 rounded-xl text-[11px] font-semibold transition-colors ${
                scenario === btn.id
                  ? 'bg-cyan-400 text-slate-950 font-bold'
                  : 'border border-white/10 bg-[var(--surface-0)] text-slate-300 hover:text-white'
              }`}
            >
              {btn.label}
            </button>
          ))}
        </div>

        {/* Ползунок изменения цены BTC */}
        <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] p-3 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400 inline-flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-cyan-400" />
              <span>Шок цены BTC</span>
            </span>
            <span
              className={`font-mono font-bold tabular-nums ${
                btcShockPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {btcShockPct >= 0 ? '+' : ''}
              {btcShockPct}%
            </span>
          </div>
          <input
            type="range"
            min={-50}
            max={60}
            step={1}
            value={btcShockPct}
            onChange={(e) => {
              setScenario('custom');
              setBtcShockPct(Number(e.target.value));
            }}
            aria-label="Симуляция изменения цены BTC"
            className="w-full accent-cyan-400"
          />
        </div>

        {/* Итоговые метрики */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 font-mono tabular-nums text-xs">
          <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] p-3">
            <div className="font-sans text-[11px] text-slate-400">Прогноз PnL портфеля</div>
            <div
              className={`mt-1 text-sm font-bold ${
                simulation.deltaUsdt >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {maskValue(`${simulation.deltaUsdt >= 0 ? '+' : ''}${fmtUsd(simulation.deltaUsdt)}`)} (
              {simulation.deltaPct >= 0 ? '+' : ''}
              {simulation.deltaPct}%)
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Итого: {maskValue(fmtUsd(simulation.projectedTotal))}
            </div>
          </div>

          <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] p-3">
            <div className="font-sans text-[11px] text-slate-400">Изменение просадки</div>
            <div
              className={`mt-1 text-sm font-bold ${
                simulation.extraDrawdownPct > 15
                  ? 'text-rose-400'
                  : simulation.extraDrawdownPct > 0
                    ? 'text-amber-300'
                    : 'text-emerald-400'
              }`}
            >
              {simulation.extraDrawdownPct > 0 ? `-${simulation.extraDrawdownPct}%` : '0.0% (профит)'}
            </div>
            <div className="font-sans text-[10px] text-slate-500 mt-0.5">С учётом беты альткоинов</div>
          </div>

          <div className="rounded-xl border border-rose-500/25 bg-rose-500/[0.06] p-3">
            <div className="font-sans text-[11px] text-rose-300 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              <span>Самая уязвимая позиция</span>
            </div>
            {simulation.worstAsset ? (
              <>
                <div className="mt-1 text-sm font-bold text-white">
                  {simulation.worstAsset.symbol}{' '}
                  <span className="text-rose-400 text-xs">({simulation.worstAsset.shockPct}%)</span>
                </div>
                <div className="text-[10px] text-rose-200 mt-0.5">
                  Влияние: {maskValue(fmtUsd(simulation.worstAsset.pnlUsdt))}
                </div>
              </>
            ) : (
              <div className="mt-1 text-xs text-slate-400">—</div>
            )}
          </div>
        </div>

        <NonCustodialRiskNotice
          text="Стресс-тест является оценочной моделью. VERNIER не хранит и не управляет вашими активами; решения по ребалансировке и риск убытков остаются исключительно под вашей финансовой ответственностью."
        />
      </div>
    </PaywallGate>
  );
};
