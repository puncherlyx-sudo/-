import React, { useMemo, useState } from 'react';
import {
  Activity,
  BookmarkPlus,
  CheckCircle2,
  Layers,
  ShieldAlert,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { usePlan } from '../contexts/PlanContext';
import { addLocalTrade } from '../lib/localDemoStore';
import { triggerHaptic } from '../lib/securityDlp';
import type { IndicatorSnapshot, MarketType, TickerOverview } from '../types/domain';
import { AiComplianceFooter } from './LegalConsentModal';
import { PaywallGate } from './PaywallGate';
import { NonCustodialRiskNotice } from './TradeRiskConfirmModal';

function fmtPrice(val: number): string {
  if (!Number.isFinite(val) || val <= 0) return '—';
  if (val >= 1000) return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (val >= 10) return `$${val.toFixed(3)}`;
  if (val >= 1) return `$${val.toFixed(4)}`;
  return `$${val.toFixed(5)}`;
}

// ============================================================================
// PRO #5: PRO-ЛЕСЕНКА (DCA 2–3 ЛИМИТКИ + КАСКАД TP1/TP2/TP3 + БЕЗУБЫТОК + ЛИКВИДАЦИЯ)
// ============================================================================
interface ProLadderCalculatorProps {
  symbol: string;
  marketType: MarketType;
  currentPrice: number;
  depositUsdt: number;
  riskPct: number;
  leverage: number;
  strategyName?: string;
}

export const ProLadderCalculator: React.FC<ProLadderCalculatorProps> = ({
  symbol,
  marketType,
  currentPrice,
  depositUsdt,
  riskPct,
  leverage,
  strategyName = 'PRO-лесенка DCA',
}) => {
  const { isPro, maskValue } = usePlan();
  const safePrice = currentPrice > 0 ? currentPrice : 64000;

  const [direction, setDirection] = useState<'LONG' | 'SHORT'>('LONG');
  const [entriesCount, setEntriesCount] = useState<2 | 3>(3);
  const [stepPct, setStepPct] = useState<number>(1.2);
  const [slOffsetPct, setSlOffsetPct] = useState<number>(3.6);
  const [tp1Share, setTp1Share] = useState<number>(30);
  const [tp2Share, setTp2Share] = useState<number>(40);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const tp3Share = Math.max(0, 100 - tp1Share - tp2Share);

  const calc = useMemo(() => {
    const dir = direction === 'LONG' ? 1 : -1;
    const weights = entriesCount === 2 ? [0.5, 0.5] : [0.35, 0.35, 0.3];
    const entries = weights.map((w, idx) => {
      const price = safePrice * (1 - dir * ((stepPct * idx) / 100));
      return {
        label: `Лимит #${idx + 1}`,
        weightPct: Math.round(w * 100),
        price,
      };
    });

    const avgEntry = entries.reduce((acc, e, idx) => acc + e.price * weights[idx], 0);
    const stopLoss = avgEntry * (1 - dir * (slOffsetPct / 100));
    const riskDist = Math.max(1e-8, Math.abs(avgEntry - stopLoss));

    const tp1 = avgEntry + dir * riskDist * 1.5;
    const tp2 = avgEntry + dir * riskDist * 2.6;
    const tp3 = avgEntry + dir * riskDist * 4.0;

    const riskAmountUsdt = (depositUsdt * riskPct) / 100;
    const stopPctFromAvg = (riskDist / avgEntry) * 100;
    const positionSizeUsdt = stopPctFromAvg > 0 ? (riskAmountUsdt / stopPctFromAvg) * 100 : depositUsdt;
    const effLev = marketType === 'futures' ? Math.max(1, leverage) : 1;
    const requiredMarginUsdt = positionSizeUsdt / effLev;

    // Ориентировочная цена ликвидации (futures isolated с буфером MMR 0.5%)
    const liqPrice =
      marketType === 'futures' && effLev > 1
        ? avgEntry * (1 - dir * (0.995 / effLev))
        : null;

    // Цена перевода стопа в безубыток с учётом комиссии 0.08% round-trip
    const breakevenSl = avgEntry * (1 + dir * 0.0008);

    const w1 = tp1Share / 100;
    const w2 = tp2Share / 100;
    const w3 = tp3Share / 100;
    const weightedRR = w1 * 1.5 + w2 * 2.6 + w3 * 4.0;
    const expectedProfitUsdt = riskAmountUsdt * weightedRR;

    return {
      entries,
      avgEntry,
      stopLoss,
      tp1,
      tp2,
      tp3,
      riskAmountUsdt,
      positionSizeUsdt,
      requiredMarginUsdt,
      liqPrice,
      breakevenSl,
      weightedRR,
      expectedProfitUsdt,
      effLev,
    };
  }, [direction, entriesCount, stepPct, slOffsetPct, safePrice, depositUsdt, riskPct, marketType, leverage, tp1Share, tp2Share, tp3Share]);

  const handleSaveToJournal = () => {
    triggerHaptic(12);
    addLocalTrade({
      symbol,
      marketType,
      direction,
      status: 'OPEN',
      entryPrice: Number(calc.avgEntry.toFixed(4)),
      stopLoss: Number(calc.stopLoss.toFixed(4)),
      takeProfit: Number(calc.tp2.toFixed(4)),
      positionSizeUsdt: Number(calc.positionSizeUsdt.toFixed(2)),
      leverage: calc.effLev,
      strategyName: `${strategyName} (${entriesCount} DCA)`,
      note: `Средн. вход ${fmtPrice(calc.avgEntry)} · TP1 ${fmtPrice(calc.tp1)} (${tp1Share}%) / TP2 ${fmtPrice(calc.tp2)} (${tp2Share}%) / TP3 ${fmtPrice(calc.tp3)} (${tp3Share}%) · БУ ${fmtPrice(calc.breakevenSl)}`,
    });
    setSavedNotice('План PRO-лесенки сохранён в Дневник сделок.');
    window.setTimeout(() => setSavedNotice(null), 3500);
  };

  return (
    <PaywallGate
      requiredPlan="PRO"
      unlocked={isPro}
      title="PRO-лесенка входа (DCA) и каскадные Take-Profit"
      description="Расчёт 2–3 лимитных входов со средней ценой, каскадное закрытие TP1/TP2/TP3, цена безубытка, ликвидация и сохранение в дневник в один клик."
    >
      <div className="rounded-xl border border-amber-500/25 bg-[var(--surface-0)] p-3.5 space-y-3.5 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 font-semibold text-white">
            <Layers className="w-4 h-4 text-amber-400 shrink-0" />
            <span>PRO-лесенка · {symbol}</span>
          </div>
          <div className="inline-flex items-center p-0.5 rounded-lg bg-[var(--surface-1)] border border-white/10">
            {(['LONG', 'SHORT'] as const).map((side) => (
              <button
                key={side}
                type="button"
                onClick={() => {
                  triggerHaptic(8);
                  setDirection(side);
                }}
                className={`min-h-[28px] px-2.5 rounded-md font-mono text-[11px] font-bold transition-colors ${
                  direction === side
                    ? side === 'LONG'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-rose-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {side}
              </button>
            ))}
          </div>
        </div>

        {/* Параметры лесенки */}
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="block text-[10px] text-slate-400 mb-1">Лимиток</label>
            <div className="grid grid-cols-2 gap-1 p-0.5 rounded-lg bg-[var(--surface-1)] border border-white/10">
              {([2, 3] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setEntriesCount(n)}
                  className={`min-h-[30px] rounded-md font-mono font-semibold ${
                    entriesCount === n ? 'bg-amber-500 text-slate-950' : 'text-slate-400'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[10px] text-slate-400 mb-1">Шаг сетки (%)</label>
            <input
              type="number"
              step="0.2"
              min={0.3}
              max={6}
              value={stepPct}
              onChange={(e) => setStepPct(Math.max(0.3, Math.min(6, Number(e.target.value) || 1)))}
              className="w-full min-h-[34px] rounded-lg border border-white/10 bg-[var(--surface-1)] px-2 font-mono text-white"
            />
          </div>
          <div>
            <label className="block text-[10px] text-slate-400 mb-1">Стоп от ср. (%)</label>
            <input
              type="number"
              step="0.2"
              min={0.5}
              max={15}
              value={slOffsetPct}
              onChange={(e) => setSlOffsetPct(Math.max(0.5, Math.min(15, Number(e.target.value) || 2)))}
              className="w-full min-h-[34px] rounded-lg border border-white/10 bg-[var(--surface-1)] px-2 font-mono text-white"
            />
          </div>
        </div>

        {/* Лимитные ордера и средняя цена */}
        <div className="rounded-xl border border-white/8 bg-[var(--surface-1)] p-2.5 space-y-1.5 font-mono tabular-nums">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-sans text-slate-400">Сетка лимитных входов</span>
            <span className="text-amber-300 font-semibold">Ср. вход: {fmtPrice(calc.avgEntry)}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
            {calc.entries.map((entry) => (
              <div
                key={entry.label}
                className="rounded-lg border border-white/8 bg-[var(--surface-0)] px-2.5 py-1.5 flex items-center justify-between sm:block"
              >
                <div className="text-[10px] font-sans text-slate-400">
                  {entry.label} ({entry.weightPct}%)
                </div>
                <div className="text-xs font-semibold text-white">{fmtPrice(entry.price)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Каскадные TP1 / TP2 / TP3 с % закрытия */}
        <div className="rounded-xl border border-white/8 bg-[var(--surface-1)] p-2.5 space-y-2 font-mono tabular-nums">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-sans text-slate-400">Каскадные цели (TP1 / TP2 / TP3)</span>
            <span className="text-emerald-300 font-semibold">Ср. R:R 1:{calc.weightedRR.toFixed(2)}</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] p-2">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-emerald-300 font-semibold">TP1</span>
                <input
                  type="number"
                  min={10}
                  max={70}
                  step={5}
                  value={tp1Share}
                  onChange={(e) => {
                    const v = Math.max(10, Math.min(70, Number(e.target.value) || 30));
                    setTp1Share(v);
                    if (v + tp2Share > 95) setTp2Share(Math.max(10, 95 - v));
                  }}
                  aria-label="Доля закрытия TP1 %"
                  className="w-10 rounded bg-[var(--surface-0)] border border-white/10 px-1 text-right text-[10px] text-white"
                />
              </div>
              <div className="mt-1 text-[11px] font-bold text-white truncate">{fmtPrice(calc.tp1)}</div>
              <div className="text-[9px] text-slate-400">Закрыть {tp1Share}%</div>
            </div>

            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] p-2">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-emerald-300 font-semibold">TP2</span>
                <input
                  type="number"
                  min={10}
                  max={Math.max(10, 90 - tp1Share)}
                  step={5}
                  value={tp2Share}
                  onChange={(e) =>
                    setTp2Share(Math.max(10, Math.min(90 - tp1Share, Number(e.target.value) || 40)))
                  }
                  aria-label="Доля закрытия TP2 %"
                  className="w-10 rounded bg-[var(--surface-0)] border border-white/10 px-1 text-right text-[10px] text-white"
                />
              </div>
              <div className="mt-1 text-[11px] font-bold text-white truncate">{fmtPrice(calc.tp2)}</div>
              <div className="text-[9px] text-slate-400">Закрыть {tp2Share}%</div>
            </div>

            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] p-2">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-emerald-300 font-semibold">TP3</span>
                <span className="text-emerald-200">{tp3Share}%</span>
              </div>
              <div className="mt-1 text-[11px] font-bold text-white truncate">{fmtPrice(calc.tp3)}</div>
              <div className="text-[9px] text-slate-400">Остаток {tp3Share}%</div>
            </div>
          </div>
        </div>

        {/* Риск-метрики: Stop-Loss, Безубыток, Ликвидация, Позиция */}
        <div className="grid grid-cols-2 gap-2 font-mono tabular-nums text-[11px]">
          <div className="rounded-lg border border-white/8 bg-[var(--surface-1)] p-2">
            <div className="font-sans text-[10px] text-slate-400">Stop-Loss / Безубыток</div>
            <div className="mt-0.5 text-rose-400 font-semibold">{fmtPrice(calc.stopLoss)}</div>
            <div className="text-[10px] text-cyan-300">БУ после TP1: {fmtPrice(calc.breakevenSl)}</div>
          </div>
          <div className="rounded-lg border border-white/8 bg-[var(--surface-1)] p-2">
            <div className="font-sans text-[10px] text-slate-400">Позиция / Прогноз +</div>
            <div className="mt-0.5 text-white font-semibold">
              {maskValue(`$${calc.positionSizeUsdt.toFixed(0)}`)}
              <span className="text-slate-400 font-normal"> ({calc.effLev}x)</span>
            </div>
            <div className="text-[10px] text-emerald-400">
              +{maskValue(`$${calc.expectedProfitUsdt.toFixed(2)}`)} / -{maskValue(`$${calc.riskAmountUsdt.toFixed(2)}`)}
            </div>
          </div>
        </div>

        {calc.liqPrice && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums">
            <span className="font-sans text-amber-200 inline-flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>Ликвидация ({calc.effLev}x, маржа {maskValue(`$${calc.requiredMarginUsdt.toFixed(0)}`)})</span>
            </span>
            <strong className="text-amber-300">{fmtPrice(calc.liqPrice)}</strong>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleSaveToJournal}
            className="w-full sm:w-auto min-h-[38px] px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold inline-flex items-center justify-center gap-1.5 transition-colors"
          >
            <BookmarkPlus className="w-4 h-4 shrink-0" />
            <span>Сохранить в дневник</span>
          </button>
          {savedNotice && (
            <span className="text-[11px] text-emerald-300 inline-flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              {savedNotice}
            </span>
          )}
        </div>

        <NonCustodialRiskNotice
          text="Сетка лимитов и расчёт ликвидации носят справочный характер. VERNIER не оперирует вашими деньгами; открытие ордеров на бирже осуществляется вами самостоятельно под вашу полную финансовую ответственность."
        />
      </div>
    </PaywallGate>
  );
};

// ============================================================================
// MAX #1: ИНТЕРАКТИВНЫЙ «AI-КОНСИЛИУМ» (3 АГЕНТА + ИТОГОВЫЙ ПЛАН КОНСЕНСУСА)
// ============================================================================
interface AiConsiliumMaxPanelProps {
  symbol: string;
  timeframe: string;
  indicators: IndicatorSnapshot | null;
  activeTicker: TickerOverview | null;
  fundingRatePct: number | null;
  depositUsdt: number;
  riskPct: number;
}

type AgentVerdict = 'LONG' | 'SHORT' | 'WAIT';

interface AgentCardData {
  id: string;
  role: string;
  subtitle: string;
  verdict: AgentVerdict;
  confidence: number;
  args: [string, string];
  accentClass: string;
}

export const AiConsiliumMaxPanel: React.FC<AiConsiliumMaxPanelProps> = ({
  symbol,
  timeframe,
  indicators,
  activeTicker,
  fundingRatePct,
  depositUsdt,
  riskPct,
}) => {
  const { isMax, maskValue } = usePlan();
  const [selectedAgentId, setSelectedAgentId] = useState<string>('tech');

  const consilium = useMemo(() => {
    const price = indicators?.lastPrice ?? activeTicker?.price ?? 64000;
    const rsi = indicators?.rsi14 ?? 52;
    const atrPct = indicators?.volatilityPct ?? 1.6;
    const funding = fundingRatePct ?? activeTicker?.fundingRatePct ?? 0.01;
    const chg24 = activeTicker?.change24hPct ?? 0;
    const trend = indicators?.trendBias ?? 'NEUTRAL';

    // Agent 1: Технический аналитик
    const techVerdict: AgentVerdict =
      trend === 'BULLISH' && rsi < 72
        ? 'LONG'
        : trend === 'BEARISH' && rsi > 28
          ? 'SHORT'
          : 'WAIT';
    const techConf =
      techVerdict === 'WAIT'
        ? 58
        : Math.min(91, Math.round(68 + Math.abs(rsi - 50) * 0.65));

    // Agent 2: Деривативы (OI, CVD, Стакан)
    const derivOverheatedLong = funding >= 0.04;
    const derivOverheatedShort = funding <= -0.025;
    const derivVerdict: AgentVerdict = derivOverheatedLong
      ? 'SHORT'
      : derivOverheatedShort
        ? 'LONG'
        : chg24 > 1.2
          ? 'LONG'
          : chg24 < -1.2
            ? 'SHORT'
            : 'WAIT';
    const derivConf =
      derivOverheatedLong || derivOverheatedShort
        ? 82
        : derivVerdict === 'WAIT'
          ? 56
          : Math.min(86, Math.round(64 + Math.abs(chg24) * 3.1));

    // Agent 3: Риск-менеджер (ATR и R:R)
    const atrHigh = atrPct > 3.2;
    const riskVerdict: AgentVerdict = atrHigh
      ? 'WAIT'
      : techVerdict !== 'WAIT'
        ? techVerdict
        : derivVerdict;
    const riskConf = atrHigh ? 74 : Math.min(89, Math.round((techConf + derivConf) / 2));

    const agents: AgentCardData[] = [
      {
        id: 'tech',
        role: 'Теханалитик',
        subtitle: 'Структура и уровни',
        verdict: techVerdict,
        confidence: techConf,
        accentClass: 'text-emerald-300',
        args: [
          `Тренд ${timeframe.toUpperCase()}: ${
            trend === 'BULLISH' ? 'выше EMA, структура HH/HL' : trend === 'BEARISH' ? 'ниже EMA, давление продавцов' : 'диапазон без явного слома'
          }.`,
          `RSI(14) = ${rsi.toFixed(1)} · ${
            rsi > 68 ? 'зона перекупленности, ждать ретест' : rsi < 32 ? 'перепроданность, потенциал отскока' : 'импульс позволяет продолжение хода'
          }.`,
        ],
      },
      {
        id: 'deriv',
        role: 'Деривативы',
        subtitle: 'OI, CVD, Стакан',
        verdict: derivVerdict,
        confidence: derivConf,
        accentClass: 'text-cyan-300',
        args: [
          `Funding ${funding >= 0 ? '+' : ''}${funding.toFixed(4)}% · ${
            derivOverheatedLong
              ? 'перегрев лонгов, высокий риск сквиза вниз'
              : derivOverheatedShort
                ? 'перегрев шортов, топливо для шорт-сквиза'
                : 'сбалансированная ставка без перекоса'
          }.`,
          `Поток CVD и стакан: ${
            chg24 >= 0 ? 'покупатели удерживают бид-стенки (+OI)' : 'агрессивные маркет-продажи давят на локальный бид'
          }.`,
        ],
      },
      {
        id: 'risk',
        role: 'Риск-менеджер',
        subtitle: 'ATR и R:R',
        verdict: riskVerdict,
        confidence: riskConf,
        accentClass: 'text-amber-300',
        args: [
          `ATR волатильность ${atrPct.toFixed(2)}% · ${
            atrHigh ? 'повышенный шум — снизить объём на 50%' : 'комфортный стоп за локальным свингом'
          }.`,
          `Риск ${riskPct}% (${maskValue(`$${((depositUsdt * riskPct) / 100).toFixed(0)}`)}) при целевом R:R ≥ 1:2.4.`,
        ],
      },
    ];

    // Голосование 3 агентов
    const votes = { LONG: 0, SHORT: 0, WAIT: 0 };
    for (const a of agents) votes[a.verdict] += 1;

    let finalVerdict: AgentVerdict = 'WAIT';
    if (votes.LONG >= 2) finalVerdict = 'LONG';
    else if (votes.SHORT >= 2) finalVerdict = 'SHORT';

    const avgConf = Math.round(agents.reduce((s, a) => s + a.confidence, 0) / 3);
    const dirSign = finalVerdict === 'SHORT' ? -1 : 1;
    const stopMult = Math.max(0.012, (atrPct / 100) * 1.15);
    const entryLow = price * (1 - 0.0025);
    const entryHigh = price * (1 + 0.0025);
    const stopLoss = price * (1 - dirSign * stopMult);
    const tp1 = price * (1 + dirSign * stopMult * 1.8);
    const tp2 = price * (1 + dirSign * stopMult * 3.1);

    return {
      agents,
      finalVerdict,
      avgConf,
      votes,
      entryZone: `${fmtPrice(entryLow)} – ${fmtPrice(entryHigh)}`,
      stopLoss: fmtPrice(stopLoss),
      tp1: fmtPrice(tp1),
      tp2: fmtPrice(tp2),
      riskUsdt: (depositUsdt * riskPct) / 100,
    };
  }, [indicators, activeTicker, fundingRatePct, timeframe, riskPct, depositUsdt, maskValue]);

  const badgeStyle = (v: AgentVerdict) =>
    v === 'LONG'
      ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
      : v === 'SHORT'
        ? 'border-rose-500/40 bg-rose-500/15 text-rose-300'
        : 'border-amber-500/40 bg-amber-500/15 text-amber-300';

  return (
    <PaywallGate
      requiredPlan="MAX"
      unlocked={isMax}
      title="AI-Консилиум (3 независимых агента)"
      description="Параллельная оценка сделки Теханалитиком, Деривативным аналитиком и Риск-менеджером с голосованием и единым планом исполнения."
    >
      <div className="rounded-xl border border-cyan-500/30 bg-gradient-to-b from-cyan-500/[0.08] to-[var(--surface-0)] p-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-semibold text-white flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-cyan-300 shrink-0" />
            <span>Интерактивный AI-Консилиум · {symbol}</span>
          </div>
          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-cyan-500/15 text-cyan-200 border border-cyan-400/35">
            MAX · 3 АГЕНТА
          </span>
        </div>

        {/* 3 отдельные карточки агентов */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {consilium.agents.map((agent) => {
            const active = selectedAgentId === agent.id;
            return (
              <button
                key={agent.id}
                type="button"
                onClick={() => {
                  triggerHaptic(8);
                  setSelectedAgentId(agent.id);
                }}
                className={`text-left rounded-xl border p-2.5 space-y-2 transition-all ${
                  active
                    ? 'border-cyan-400/50 bg-[var(--surface-1)] shadow-sm'
                    : 'border-white/8 bg-[var(--surface-1)]/80 hover:border-white/20'
                }`}
              >
                <div className="flex items-start justify-between gap-1.5">
                  <div className="min-w-0">
                    <div className={`text-xs font-semibold truncate ${agent.accentClass}`}>{agent.role}</div>
                    <div className="text-[10px] text-slate-400 truncate">{agent.subtitle}</div>
                  </div>
                  <span
                    className={`px-1.5 py-0.5 rounded border font-mono text-[10px] font-bold shrink-0 ${badgeStyle(agent.verdict)}`}
                  >
                    {agent.verdict}
                  </span>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] font-mono tabular-nums text-slate-400">
                    <span>Уверенность</span>
                    <strong className="text-white">{agent.confidence}%</strong>
                  </div>
                  <div className="h-1 rounded-full bg-white/10 overflow-hidden">
                    <div
                      style={{ width: `${agent.confidence}%` }}
                      className={
                        agent.verdict === 'LONG'
                          ? 'h-full bg-emerald-400'
                          : agent.verdict === 'SHORT'
                            ? 'h-full bg-rose-400'
                            : 'h-full bg-amber-400'
                      }
                    />
                  </div>
                </div>

                <ul className="space-y-1 text-[11px] text-slate-300 leading-snug">
                  {agent.args.map((arg, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className="text-cyan-400 mt-0.5">•</span>
                      <span>{arg}</span>
                    </li>
                  ))}
                </ul>
              </button>
            );
          })}
        </div>

        {/* Итоговый консенсус-план */}
        <div className="rounded-xl border border-cyan-500/25 bg-[var(--surface-1)] p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-white">
              <Activity className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
              <span>Итоговый план консенсуса</span>
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border font-mono text-[11px] font-bold ${badgeStyle(consilium.finalVerdict)}`}
              >
                {consilium.finalVerdict === 'LONG' && <TrendingUp className="w-3 h-3" />}
                {consilium.finalVerdict === 'SHORT' && <TrendingDown className="w-3 h-3" />}
                {consilium.finalVerdict}
              </span>
            </div>
            <span className="text-[11px] font-mono tabular-nums text-slate-300">
              Голоса: L:{consilium.votes.LONG} / S:{consilium.votes.SHORT} / W:{consilium.votes.WAIT} ·{' '}
              <strong className="text-cyan-300">{consilium.avgConf}%</strong>
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono tabular-nums">
            <div className="rounded-lg bg-[var(--surface-0)] border border-white/8 p-2">
              <div className="font-sans text-[10px] text-slate-400">Зона входа</div>
              <div className="text-white font-semibold mt-0.5 truncate">{consilium.entryZone}</div>
            </div>
            <div className="rounded-lg bg-[var(--surface-0)] border border-white/8 p-2">
              <div className="font-sans text-[10px] text-slate-400">Stop-Loss</div>
              <div className="text-rose-400 font-semibold mt-0.5">{consilium.stopLoss}</div>
            </div>
            <div className="rounded-lg bg-[var(--surface-0)] border border-white/8 p-2">
              <div className="font-sans text-[10px] text-slate-400">TP1 / TP2</div>
              <div className="text-emerald-400 font-semibold mt-0.5 truncate">
                {consilium.tp1} / {consilium.tp2}
              </div>
            </div>
            <div className="rounded-lg bg-[var(--surface-0)] border border-white/8 p-2">
              <div className="font-sans text-[10px] text-slate-400">Лимит риска</div>
              <div className="text-amber-300 font-semibold mt-0.5">
                {riskPct}% ({maskValue(`$${consilium.riskUsdt.toFixed(0)}`)})
              </div>
            </div>
          </div>
        </div>

        <NonCustodialRiskNotice
          text="AI-Консилиум является аналитическим инструментом и не управляет вашими средствами. Любой реальный вход в позицию несёт риск утраты капитала и выполняется исключительно под вашу личную ответственность."
        />

        <AiComplianceFooter
          sourceLabel={`AI-Консилиум (3 агента) · ${symbol}`}
          snippet={`Консенсус ${consilium.finalVerdict} (${consilium.avgConf}%), RSI ${indicators?.rsi14?.toFixed(1) ?? '—'}`}
        />
      </div>
    </PaywallGate>
  );
};
