import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Calculator,
  CheckCircle2,
  Crown,
  Lock,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { FREE_MAX_LEVERAGE, TRADING_PAIRS } from '../data/strategies';
import type { MarketType, StrategyConfig } from '../types/domain';
import { OrderTransferCard, PreTradeChecklist } from './OrderTransferCard';
import { FeatureGuide } from './FeatureGuide';
import { NonCustodialRiskNotice } from './TradeRiskConfirmModal';
import {
  addLocalTrade,
  hasThreeConsecutiveLosses24h,
  readLocalTrades,
  VERNIER_TRADES_EVENT,
} from '../lib/localDemoStore';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { parseLocalePositiveNumber, triggerHaptic } from '../lib/securityDlp';

interface PositionSizeCalculatorProps {
  strategies: StrategyConfig[];
  isPro: boolean;
  isMax?: boolean;
  portfolioBalanceUsdt?: number;
  onUpgradePro?: () => void;
  onSavedToJournal?: () => void;
}

function formatPriceSmart(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '0.00';
  if (v >= 1000) return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (v >= 10) return v.toFixed(3);
  if (v >= 1) return v.toFixed(4);
  return v.toFixed(5);
}

export const PositionSizeCalculator: React.FC<PositionSizeCalculatorProps> = ({
  strategies,
  isPro,
  isMax = false,
  portfolioBalanceUsdt,
  onUpgradePro,
  onSavedToJournal,
}) => {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [marketType, setMarketType] = useState<MarketType>('futures');
  const [direction, setDirection] = useState<'LONG' | 'SHORT'>('LONG');
  const [depositStr, setDepositStr] = useState('1500');
  const [riskPctStr, setRiskPctStr] = useState('1.5');
  const [leverage, setLeverage] = useState(isPro ? 5 : FREE_MAX_LEVERAGE);
  const [entryStr, setEntryStr] = useState('64000');
  const [stopStr, setStopStr] = useState('62800');
  const [tpStr, setTpStr] = useState('66800');
  const [feePctStr, setFeePctStr] = useState('0.05');

  const [checkedChecklist, setCheckedChecklist] = useState<string[]>([]);
  const [antiFomoActive, setAntiFomoActive] = useState<boolean>(() =>
    hasThreeConsecutiveLosses24h(readLocalTrades())
  );
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  useEffect(() => {
    const syncFomo = () => setAntiFomoActive(hasThreeConsecutiveLosses24h(readLocalTrades()));
    window.addEventListener(VERNIER_TRADES_EVENT, syncFomo);
    return () => window.removeEventListener(VERNIER_TRADES_EVENT, syncFomo);
  }, []);

  const maxAllowedLev = isPro ? 20 : FREE_MAX_LEVERAGE;
  const effectiveLev = marketType === 'spot' ? 1 : Math.min(maxAllowedLev, Math.max(1, leverage));
  const debouncedLev = useDebouncedValue(effectiveLev, 150);

  const deposit = parseLocalePositiveNumber(depositStr, 0);
  const riskPct = Math.min(25, parseLocalePositiveNumber(riskPctStr, 0));
  const entry = parseLocalePositiveNumber(entryStr, 0);
  const stop = parseLocalePositiveNumber(stopStr, 0);
  const tp = parseLocalePositiveNumber(tpStr, 0);
  const feePct = Math.min(1, parseLocalePositiveNumber(feePctStr, 0.05));

  const calc = useMemo(() => {
    const valid = deposit > 0 && riskPct > 0 && entry > 0 && stop > 0 && entry !== stop;
    if (!valid) return null;

    const riskAmountUsdt = (deposit * riskPct) / 100;
    const stopDistance = Math.abs(entry - stop);
    const stopDistancePct = (stopDistance / entry) * 100;
    const invalidStopSide =
      (direction === 'LONG' && stop >= entry) || (direction === 'SHORT' && stop <= entry);
    const invalidTpSide =
      tp > 0 && ((direction === 'LONG' && tp <= entry) || (direction === 'SHORT' && tp >= entry));
    const hasInvalidLevels = invalidStopSide || invalidTpSide;

    const qtyCoins = riskAmountUsdt / stopDistance;
    const positionSizeUsdt = qtyCoins * entry;
    const marginRequiredUsdt = positionSizeUsdt / debouncedLev;
    const marginExceedsDeposit = marginRequiredUsdt > deposit;

    const roundTripFeeUsdt = positionSizeUsdt * ((feePct * 2) / 100);
    const tpDistance = tp > 0 ? Math.abs(tp - entry) : stopDistance * 2;
    const grossProfitUsdt = qtyCoins * tpDistance;
    const netProfitUsdt = grossProfitUsdt - roundTripFeeUsdt;
    const rrRatio = stopDistance > 0 ? tpDistance / stopDistance : 0;

    // Ориентировочная цена ликвидации для фьючерсов (с учётом maintenance margin ~0.5%)
    const liqMoveFrac = Math.max(0.005, 1 / debouncedLev - 0.005);
    const liquidationPrice =
      marketType === 'futures' && debouncedLev > 1
        ? direction === 'LONG'
          ? Math.max(0, entry * (1 - liqMoveFrac))
          : entry * (1 + liqMoveFrac)
        : null;

    const tp1 =
      direction === 'LONG'
        ? entry + stopDistance * 1.5
        : Math.max(0, entry - stopDistance * 1.5);
    const tp2 =
      direction === 'LONG'
        ? entry + stopDistance * 2.5
        : Math.max(0, entry - stopDistance * 2.5);
    const tp3 =
      direction === 'LONG'
        ? entry + stopDistance * 3.8
        : Math.max(0, entry - stopDistance * 3.8);

    return {
      riskAmountUsdt,
      stopDistancePct,
      invalidStopSide,
      invalidTpSide,
      hasInvalidLevels,
      qtyCoins,
      positionSizeUsdt,
      marginRequiredUsdt,
      marginExceedsDeposit,
      roundTripFeeUsdt,
      netProfitUsdt,
      rrRatio,
      liquidationPrice,
      tp1,
      tp2,
      tp3,
    };
  }, [deposit, riskPct, entry, stop, tp, feePct, direction, debouncedLev, marketType]);

  const formatInputPrice = (val: number): string => {
    if (!Number.isFinite(val) || val <= 0) return '';
    if (val >= 1000) return String(Number(val.toFixed(2)));
    if (val >= 10) return String(Number(val.toFixed(3)));
    if (val >= 1) return String(Number(val.toFixed(4)));
    return String(Number(val.toFixed(5)));
  };

  const handleChangeDirection = (nextDir: 'LONG' | 'SHORT') => {
    if (nextDir === direction) return;
    triggerHaptic(8);
    setDirection(nextDir);

    if (entry > 0) {
      const currentSlDist = stop > 0 && stop !== entry ? Math.abs(entry - stop) : entry * 0.02;
      const currentTpDist = tp > 0 && tp !== entry ? Math.abs(tp - entry) : currentSlDist * 2.2;
      const mirroredSl =
        nextDir === 'LONG'
          ? Math.max(entry * 0.05, entry - currentSlDist)
          : entry + currentSlDist;
      const mirroredTp =
        nextDir === 'LONG'
          ? entry + currentTpDist
          : Math.max(entry * 0.05, entry - currentTpDist);

      setStopStr(formatInputPrice(mirroredSl));
      setTpStr(formatInputPrice(mirroredTp));
    }
  };

  const applyStrategyPreset = (cfg: StrategyConfig) => {
    setMarketType(cfg.marketType);
    setRiskPctStr(String(cfg.riskPerTradePct));
    if (cfg.marketType === 'futures') {
      setLeverage(isPro ? cfg.leverage : Math.min(FREE_MAX_LEVERAGE, cfg.leverage));
    }
    triggerHaptic(8);
  };

  const handleSaveToJournal = () => {
    if (!calc || calc.hasInvalidLevels) return;
    triggerHaptic(12);
    addLocalTrade({
      symbol,
      marketType,
      direction,
      status: 'OPEN',
      entryPrice: entry,
      stopLoss: stop,
      takeProfit: tp > 0 ? tp : Number(calc.tp2.toFixed(4)),
      positionSizeUsdt: Number(calc.positionSizeUsdt.toFixed(2)),
      leverage: effectiveLev,
      strategyName: 'Калькулятор риска VERNIER',
      note: `Чек-лист: ${checkedChecklist.length}/4 · Риск ${riskPct}% ($${calc.riskAmountUsdt.toFixed(2)}) · R:R 1:${calc.rrRatio.toFixed(2)}`,
    });
    setSavedNotice(`Сетап ${symbol} (${direction}) записан в Дневник сделок!`);
    onSavedToJournal?.();
    window.setTimeout(() => setSavedNotice(null), 4000);
  };

  return (
    <section className="rounded-2xl border border-white/8 bg-[var(--surface-1)] card-surface-glow p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <Calculator className="w-4 h-4 text-amber-400 shrink-0" />
            <span>Калькулятор размера позиции и риска</span>
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Мгновенный расчёт объёма (USDT и монеты), суммы риска, ликвидации и 1-клик перенос ордера на биржу.
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          {(['spot', 'futures'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMarketType(m)}
              className={`min-h-[34px] px-3 rounded-xl text-xs font-semibold transition-colors ${
                marketType === m
                  ? m === 'spot'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-amber-500 text-slate-950'
                  : 'border border-white/10 bg-[var(--surface-0)] text-slate-400 hover:text-white'
              }`}
            >
              {m === 'spot' ? 'Спот' : 'Фьючерсы'}
            </button>
          ))}
        </div>
      </div>

      {/* Быстрые пресеты из стратегий */}
      {strategies.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-slate-500 shrink-0">Пресет:</span>
          {strategies.slice(0, 4).map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => applyStrategyPreset(s)}
              className="min-h-[30px] px-2.5 rounded-lg border border-white/10 bg-[var(--surface-0)] hover:border-emerald-500/35 text-[11px] text-slate-300 transition-colors"
            >
              {s.name} ({s.riskPerTradePct}%)
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Левая колонка: Параметры сделки */}
        <div className="lg:col-span-6 space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-slate-400 mb-1">Торговая пара</label>
              <select
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="w-full min-h-[40px] rounded-xl border border-white/10 bg-[var(--surface-0)] px-3 font-mono text-white focus:border-emerald-500 focus:outline-none"
              >
                {TRADING_PAIRS.map((p) => (
                  <option key={p.symbol} value={p.symbol}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <span className="block text-slate-400 mb-1">Направление</span>
              <div className="grid grid-cols-2 p-1 rounded-xl bg-[var(--surface-0)] border border-white/10">
                <button
                  type="button"
                  onClick={() => handleChangeDirection('LONG')}
                  className={`min-h-[32px] rounded-lg font-semibold inline-flex items-center justify-center gap-1 ${
                    direction === 'LONG' ? 'bg-emerald-600 text-white' : 'text-slate-400'
                  }`}
                >
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span>LONG</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleChangeDirection('SHORT')}
                  className={`min-h-[32px] rounded-lg font-semibold inline-flex items-center justify-center gap-1 ${
                    direction === 'SHORT' ? 'bg-rose-600 text-white' : 'text-slate-400'
                  }`}
                >
                  <TrendingDown className="w-3.5 h-3.5" />
                  <span>SHORT</span>
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <div className="flex items-center justify-between gap-1 mb-1">
                <label className="text-slate-400 truncate">Депозит (USDT)</label>
                {typeof portfolioBalanceUsdt === 'number' && portfolioBalanceUsdt > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic(8);
                      setDepositStr(String(Math.round(portfolioBalanceUsdt)));
                    }}
                    className="text-[10px] font-semibold text-emerald-400 hover:text-emerald-300 whitespace-nowrap shrink-0"
                  >
                    Из портфеля
                  </button>
                )}
              </div>
              <input
                type="text"
                inputMode="decimal"
                value={depositStr}
                onChange={(e) => setDepositStr(e.target.value)}
                className="w-full min-h-[40px] rounded-xl border border-white/10 bg-[var(--surface-0)] px-3 font-mono tabular-nums text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Риск на сделку (%)</label>
              <input
                type="text"
                inputMode="decimal"
                value={riskPctStr}
                onChange={(e) => setRiskPctStr(e.target.value)}
                className="w-full min-h-[40px] rounded-xl border border-white/10 bg-[var(--surface-0)] px-3 font-mono tabular-nums text-white focus:border-emerald-500 focus:outline-none"
              />
              <div className="mt-1.5 flex items-center gap-1">
                {(['0.5', '1', '1.5', '2'] as const).map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      triggerHaptic(6);
                      setRiskPctStr(preset);
                    }}
                    className={`flex-1 min-h-[24px] rounded-md text-[10px] font-mono font-semibold transition-colors ${
                      riskPctStr === preset
                        ? 'bg-emerald-500/20 border border-emerald-400/45 text-emerald-200'
                        : 'border border-white/10 bg-[var(--surface-0)] text-slate-400 hover:text-white'
                    }`}
                  >
                    {preset}%
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-slate-400 mb-1">Цена входа ($)</label>
              <input
                type="text"
                inputMode="decimal"
                value={entryStr}
                onChange={(e) => setEntryStr(e.target.value)}
                className="w-full min-h-[40px] rounded-xl border border-white/10 bg-[var(--surface-0)] px-2.5 font-mono tabular-nums text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-rose-300/90 mb-1">Stop-Loss ($)</label>
              <input
                type="text"
                inputMode="decimal"
                value={stopStr}
                onChange={(e) => setStopStr(e.target.value)}
                className="w-full min-h-[40px] rounded-xl border border-rose-500/25 bg-[var(--surface-0)] px-2.5 font-mono tabular-nums text-white focus:border-rose-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-emerald-300/90 mb-1">Take-Profit ($)</label>
              <input
                type="text"
                inputMode="decimal"
                value={tpStr}
                onChange={(e) => setTpStr(e.target.value)}
                className="w-full min-h-[40px] rounded-xl border border-emerald-500/25 bg-[var(--surface-0)] px-2.5 font-mono tabular-nums text-white focus:border-emerald-400 focus:outline-none"
              />
            </div>
          </div>

          {marketType === 'futures' && (
            <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">
                  Плечо (Futures){!isPro ? ` · Free до ${FREE_MAX_LEVERAGE}x` : ''}
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-amber-300">{effectiveLev}x</span>
                  {!isPro && onUpgradePro && (
                    <button
                      type="button"
                      onClick={onUpgradePro}
                      className="text-[11px] font-semibold text-amber-300 hover:underline inline-flex items-center gap-0.5"
                    >
                      <Lock className="w-3 h-3" />
                      <span>PRO до 20x</span>
                    </button>
                  )}
                </div>
              </div>
              <input
                type="range"
                min={1}
                max={maxAllowedLev}
                value={effectiveLev}
                onChange={(e) => setLeverage(Number(e.target.value))}
                className="w-full accent-amber-500"
              />
            </div>
          )}

          <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
            <span>Комиссия биржи (Taker %):</span>
            <input
              type="text"
              inputMode="decimal"
              value={feePctStr}
              onChange={(e) => setFeePctStr(e.target.value)}
              className="w-20 min-h-[30px] rounded-lg border border-white/10 bg-[var(--surface-0)] px-2 text-right font-mono text-white"
            />
          </div>

          {/* Pre-Trade Чек-лист и Анти-FOMO */}
          <PreTradeChecklist
            checkedIds={checkedChecklist}
            onToggle={(id) =>
              setCheckedChecklist((prev) =>
                prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
              )
            }
            antiFomoTriggered={antiFomoActive}
            isMax={isMax}
          />
        </div>

        {/* Правая колонка: Итоговый расчёт в реальном времени + Перенос ордера + Дневник */}
        <div className="lg:col-span-6 space-y-3">
          {!calc ? (
            <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] p-6 text-center text-xs text-slate-400">
              Введите корректные положительные значения депозита, входа и стоп-лосса.
            </div>
          ) : calc.hasInvalidLevels ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-rose-500/40 bg-rose-500/12 p-4 text-xs text-rose-200 space-y-2.5">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    {calc.invalidStopSide && (
                      <div className="font-semibold text-rose-100">
                        Для {direction} Stop-Loss должен быть {direction === 'LONG' ? 'ниже' : 'выше'} цены входа.
                      </div>
                    )}
                    {calc.invalidTpSide && (
                      <div className="font-semibold text-rose-100">
                        Для {direction} Take-Profit должен быть {direction === 'LONG' ? 'выше' : 'ниже'} цены входа.
                      </div>
                    )}
                    <p className="text-[11px] text-rose-200/80 leading-relaxed">
                      Расчёт объёма, копирование параметров и запись в дневник заблокированы до исправления уровней ордера.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(8);
                    const distSl = stop > 0 && stop !== entry ? Math.abs(entry - stop) : entry * 0.02;
                    const distTp = tp > 0 && tp !== entry ? Math.abs(tp - entry) : distSl * 2.2;
                    setStopStr(
                      formatInputPrice(
                        direction === 'LONG' ? Math.max(entry * 0.05, entry - distSl) : entry + distSl
                      )
                    );
                    setTpStr(
                      formatInputPrice(
                        direction === 'LONG' ? entry + distTp : Math.max(entry * 0.05, entry - distTp)
                      )
                    );
                  }}
                  className="min-h-[36px] px-3.5 rounded-lg border border-rose-400/40 bg-rose-500/20 hover:bg-rose-500/30 text-white text-xs font-semibold transition-colors"
                >
                  Автоисправить уровни под {direction}
                </button>
              </div>

              <button
                type="button"
                disabled
                className="w-full min-h-[44px] rounded-xl bg-slate-800 text-slate-400 opacity-55 cursor-not-allowed text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-2"
              >
                <BookOpen className="w-4 h-4" />
                <span>Записать сетап в дневник сделок (исправьте уровни)</span>
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2.5 text-xs font-mono tabular-nums">
                <div className="rounded-xl border border-emerald-500/25 bg-[var(--surface-0)] p-3">
                  <div className="font-sans text-slate-400">Объём позиции (USDT)</div>
                  <div className="mt-1 text-base font-bold text-white">
                    ${calc.positionSizeUsdt.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-[11px] text-cyan-300 mt-0.5">
                    ≈ {calc.qtyCoins.toFixed(entry >= 1000 ? 4 : 2)} {symbol.replace('USDT', '')}
                  </div>
                </div>

                <div className="rounded-xl border border-rose-500/25 bg-[var(--surface-0)] p-3">
                  <div className="font-sans text-slate-400">Сумма риска ({riskPct}%)</div>
                  <div className="mt-1 text-base font-bold text-rose-400">
                    -${calc.riskAmountUsdt.toFixed(2)}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    Стоп: {calc.stopDistancePct.toFixed(2)}%
                  </div>
                </div>

                <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] p-3">
                  <div className="font-sans text-slate-400">Требуемая маржа</div>
                  <div className={`mt-1 text-sm font-bold ${calc.marginExceedsDeposit ? 'text-rose-400' : 'text-white'}`}>
                    ${calc.marginRequiredUsdt.toFixed(2)}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Комиссия ~${calc.roundTripFeeUsdt.toFixed(2)}
                  </div>
                </div>

                <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] p-3">
                  <div className="font-sans text-slate-400">Ожид. чистый профит</div>
                  <div className="mt-1 text-sm font-bold text-emerald-400">
                    +${Math.max(0, calc.netProfitUsdt).toFixed(2)}
                  </div>
                  <div className="text-[11px] text-amber-300 mt-0.5">R:R 1 : {calc.rrRatio.toFixed(2)}</div>
                </div>
              </div>

              {calc.liquidationPrice !== null && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs">
                  <span className="inline-flex items-center gap-1.5 text-amber-200 font-medium">
                    <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>Ориент. цена ликвидации ({effectiveLev}x)</span>
                  </span>
                  <strong className="font-mono tabular-nums text-amber-300">
                    ${formatPriceSmart(calc.liquidationPrice)}
                  </strong>
                </div>
              )}

              {/* PRO Multi-TP Матрица */}
              <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] p-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-200">Лестница Take-Profit (30% / 40% / 30%)</span>
                  {!isPro && onUpgradePro && (
                    <button
                      type="button"
                      onClick={onUpgradePro}
                      className="text-[11px] font-semibold text-amber-300 inline-flex items-center gap-1"
                    >
                      <Crown className="w-3 h-3" />
                      <span>PRO</span>
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2 text-[11px] font-mono tabular-nums">
                  <div className="rounded-lg bg-[var(--surface-1)] border border-white/8 p-2">
                    <div className="font-sans text-slate-400">TP1 (1.5R)</div>
                    <div className="text-emerald-400 font-semibold mt-0.5">${formatPriceSmart(calc.tp1)}</div>
                  </div>
                  <div className="rounded-lg bg-[var(--surface-1)] border border-white/8 p-2">
                    <div className="font-sans text-slate-400">TP2 (2.5R)</div>
                    <div className="text-emerald-400 font-semibold mt-0.5">${formatPriceSmart(calc.tp2)}</div>
                  </div>
                  <div className="rounded-lg bg-[var(--surface-1)] border border-white/8 p-2">
                    <div className="font-sans text-slate-400">TP3 (3.8R)</div>
                    <div className="text-emerald-400 font-semibold mt-0.5">${formatPriceSmart(calc.tp3)}</div>
                  </div>
                </div>
              </div>

              {/* Карточка переноса ордера на биржу (1-клик копирование) */}
              <OrderTransferCard
                symbol={symbol}
                direction={direction}
                entryText={`$${formatPriceSmart(entry)}`}
                stopLossText={`$${formatPriceSmart(stop)}`}
                tp1Text={`$${formatPriceSmart(tp > 0 ? tp : calc.tp1)}`}
                volumeUsdtText={calc.positionSizeUsdt.toFixed(2)}
                leverage={effectiveLev}
                compact
              />

              {savedNotice && (
                <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/12 px-3 py-2 text-xs text-emerald-200 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{savedNotice}</span>
                </div>
              )}

              <button
                type="button"
                disabled={calc.hasInvalidLevels}
                onClick={handleSaveToJournal}
                className="w-full min-h-[44px] rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-45 text-white text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-2 transition-all active:scale-[0.99]"
              >
                <BookOpen className="w-4 h-4" />
                <span>Записать сетап в дневник сделок</span>
              </button>

              <NonCustodialRiskNotice
                text="Калькулятор носит исключительно справочный характер. VERNIER не оперирует вашими деньгами. Торговля с плечом несёт высокий риск ликвидации и полной потери капитала — ответственность за сделки полностью на вас."
              />
            </>
          )}
        </div>
      </div>

      <FeatureGuide
        title="Как работает Калькулятор риска"
        summary="Рассчитывает точный объём позиции в USDT и монетах так, чтобы при срабатывании Stop-Loss убыток не превысил заданный процент депозита."
        steps={[
          'Нажмите «Из портфеля», чтобы подставить текущий баланс, и выберите риск 0.5–2% одной кнопкой.',
          'Укажите цену входа, Stop-Loss и Take-Profit — модуль покажет объём, маржу, комиссию, R:R и цену ликвидации.',
          'Скопируйте готовые параметры на биржу в 1 клик или сохраните план прямо в Дневник сделок.',
        ]}
        compact
      />
    </section>
  );
};
