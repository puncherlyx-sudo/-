import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Calculator,
  Check,
  Copy,
  RefreshCw,
} from 'lucide-react';
import { motion } from 'motion/react';
import { STRATEGY_CATALOG, TRADING_PAIRS } from '../data/strategies';
import type { MarketType, StrategyConfig, TickerOverview } from '../types/domain';

interface PositionSizeCalculatorProps {
  strategies: StrategyConfig[];
}

type SlMode = 'percent' | 'price';
type TradeSide = 'LONG' | 'SHORT';

function formatPriceSmart(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0.00';
  if (value >= 1000) return value.toFixed(2);
  if (value >= 10) return value.toFixed(3);
  if (value >= 1) return value.toFixed(4);
  return value.toFixed(5);
}

function formatLotSmart(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value >= 1000) return value.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
  if (value >= 10) return value.toLocaleString('ru-RU', { maximumFractionDigits: 3 });
  if (value >= 1) return value.toLocaleString('ru-RU', { maximumFractionDigits: 4 });
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 5 });
}

function formatUsdt(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '$0.00';
  return `$${value.toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export const PositionSizeCalculator: React.FC<PositionSizeCalculatorProps> = ({ strategies }) => {
  const strategyPresets = useMemo(() => {
    return STRATEGY_CATALOG.map((tpl) => {
      const userCfg = strategies.find((s) => s.strategyKey === tpl.key);
      return {
        key: tpl.key,
        name: tpl.name,
        marketType: tpl.marketType,
        riskPct: userCfg?.riskPerTradePct ?? tpl.defaultRiskPct,
        leverage: tpl.marketType === 'spot' ? 1 : (userCfg?.leverage ?? tpl.defaultLeverage),
        enabled: Boolean(userCfg?.enabled),
      };
    });
  }, [strategies]);

  const initialPreset = useMemo(() => {
    return (
      strategyPresets.find((s) => s.enabled) ??
      strategyPresets.find((s) => s.key === 'futures_momentum_atr') ??
      strategyPresets[0]
    );
  }, [strategyPresets]);

  const [selectedStrategyKey, setSelectedStrategyKey] = useState<string>(initialPreset.key);
  const [marketType, setMarketType] = useState<MarketType>(initialPreset.marketType);
  const [side, setSide] = useState<TradeSide>('LONG');
  const [symbol, setSymbol] = useState<string>('BTCUSDT');
  const [depositUsdt, setDepositUsdt] = useState<number>(10000);
  const [riskPct, setRiskPct] = useState<number>(initialPreset.riskPct);
  const [leverage, setLeverage] = useState<number>(initialPreset.leverage);
  const [slMode, setSlMode] = useState<SlMode>('percent');
  const [slPct, setSlPct] = useState<number>(2.0);
  const [tpPct, setTpPct] = useState<number>(4.5);

  const [entryPrice, setEntryPrice] = useState<number>(95000);
  const [stopPrice, setStopPrice] = useState<number>(93100);
  const [takeProfitPrice, setTakeProfitPrice] = useState<number>(99275);
  const [priceLoading, setPriceLoading] = useState<boolean>(false);
  const [priceSourceLabel, setPriceSourceLabel] = useState<string>('Ориентир');
  const [copied, setCopied] = useState<boolean>(false);

  const initializedPresetRef = useRef<boolean>(false);

  // Sync initial user strategy config once Firestore strategies arrive
  useEffect(() => {
    if (initializedPresetRef.current || strategies.length === 0) return;
    const preferred =
      strategyPresets.find((s) => s.enabled) ?? strategyPresets[0];
    if (preferred) {
      initializedPresetRef.current = true;
      setSelectedStrategyKey(preferred.key);
      setMarketType(preferred.marketType);
      setRiskPct(preferred.riskPct);
      setLeverage(preferred.leverage);
      if (preferred.marketType === 'spot') {
        setSide('LONG');
      }
    }
  }, [strategies, strategyPresets]);

  const syncSlTpPricesAroundEntry = useCallback(
    (baseEntry: number, targetSide: TradeSide, stopPercent: number, tpPercent: number) => {
      if (!Number.isFinite(baseEntry) || baseEntry <= 0) return;
      const slFactor = targetSide === 'LONG' ? 1 - stopPercent / 100 : 1 + stopPercent / 100;
      const tpFactor = targetSide === 'LONG' ? 1 + tpPercent / 100 : 1 - tpPercent / 100;
      setStopPrice(Number(formatPriceSmart(baseEntry * slFactor)));
      setTakeProfitPrice(Number(formatPriceSmart(baseEntry * tpFactor)));
    },
    []
  );

  const fetchLivePrice = useCallback(
    async (targetSymbol: string, targetMarket: MarketType) => {
      setPriceLoading(true);
      try {
        const res = await fetch(`/api/market/overview?marketType=${targetMarket}`);
        if (!res.ok) throw new Error('Не удалось получить цену');
        const data = (await res.json()) as { tickers?: TickerOverview[] };
        const matched = data.tickers?.find((t) => t.symbol === targetSymbol);
        if (matched && matched.price > 0) {
          const rounded = Number(formatPriceSmart(matched.price));
          setEntryPrice(rounded);
          syncSlTpPricesAroundEntry(rounded, side, slPct, tpPct);
          setPriceSourceLabel(matched.source === 'live' ? 'Биржевая цена' : 'Кэш рынка');
        }
      } catch {
        setPriceSourceLabel('Ручной ввод');
      } finally {
        setPriceLoading(false);
      }
    },
    [side, slPct, tpPct, syncSlTpPricesAroundEntry]
  );

  useEffect(() => {
    void fetchLivePrice(symbol, marketType);
  }, [symbol, marketType]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectPreset = (key: string) => {
    setSelectedStrategyKey(key);
    const preset = strategyPresets.find((s) => s.key === key);
    if (!preset) return;
    setMarketType(preset.marketType);
    setRiskPct(preset.riskPct);
    setLeverage(preset.marketType === 'spot' ? 1 : preset.leverage);
    if (preset.marketType === 'spot') {
      setSide('LONG');
    }
  };

  const handleChangeMarket = (nextMarket: MarketType) => {
    setMarketType(nextMarket);
    if (nextMarket === 'spot') {
      setLeverage(1);
      setSide('LONG');
    } else if (leverage <= 1) {
      setLeverage(5);
    }
  };

  const handleChangeSide = (nextSide: TradeSide) => {
    setSide(nextSide);
    syncSlTpPricesAroundEntry(entryPrice, nextSide, slPct, tpPct);
  };

  const baseAsset = symbol.replace('USDT', '');

  const calc = useMemo(() => {
    const safeDeposit = Number.isFinite(depositUsdt) && depositUsdt > 0 ? depositUsdt : 0;
    const safeRiskPct = Number.isFinite(riskPct) ? Math.min(25, Math.max(0.1, riskPct)) : 1;
    const safeEntry = Number.isFinite(entryPrice) && entryPrice > 0 ? entryPrice : 0;
    const effLeverage = marketType === 'spot' ? 1 : Math.min(50, Math.max(1, leverage || 1));

    const riskAmountUsdt = safeDeposit * (safeRiskPct / 100);

    let stopDistanceRatio = 0;
    let stopValidationError: string | null = null;

    if (slMode === 'percent') {
      const safeSlPct = Number.isFinite(slPct) && slPct > 0 ? slPct : 0;
      if (safeSlPct <= 0) {
        stopValidationError = 'Укажите процент Stop-Loss больше 0%.';
      } else {
        stopDistanceRatio = safeSlPct / 100;
      }
    } else {
      if (safeEntry <= 0 || !Number.isFinite(stopPrice) || stopPrice <= 0) {
        stopValidationError = 'Укажите корректные цены входа и Stop-Loss.';
      } else if (side === 'LONG' && stopPrice >= safeEntry) {
        stopValidationError = 'Для LONG цена Stop-Loss должна быть ниже цены входа.';
      } else if (side === 'SHORT' && stopPrice <= safeEntry) {
        stopValidationError = 'Для SHORT цена Stop-Loss должна быть выше цены входа.';
      } else {
        stopDistanceRatio = Math.abs(safeEntry - stopPrice) / safeEntry;
      }
    }

    const isValid = !stopValidationError && safeDeposit > 0 && safeEntry > 0 && stopDistanceRatio > 0;

    const positionNotionalUsdt = isValid ? riskAmountUsdt / stopDistanceRatio : 0;
    const lotSizeCoins = isValid ? positionNotionalUsdt / safeEntry : 0;
    const requiredMarginUsdt = isValid ? positionNotionalUsdt / effLeverage : 0;
    const marginUsagePct = safeDeposit > 0 ? (requiredMarginUsdt / safeDeposit) * 100 : 0;

    // Reward-to-Risk & Potential Profit at TP
    let tpDistanceRatio = 0;
    if (slMode === 'percent') {
      tpDistanceRatio = Number.isFinite(tpPct) && tpPct > 0 ? tpPct / 100 : 0;
    } else if (safeEntry > 0 && Number.isFinite(takeProfitPrice) && takeProfitPrice > 0) {
      const tpOnCorrectSide =
        side === 'LONG' ? takeProfitPrice > safeEntry : takeProfitPrice < safeEntry;
      if (tpOnCorrectSide) {
        tpDistanceRatio = Math.abs(takeProfitPrice - safeEntry) / safeEntry;
      }
    }

    const potentialProfitUsdt = isValid && tpDistanceRatio > 0 ? positionNotionalUsdt * tpDistanceRatio : 0;
    const rewardRiskRatio =
      isValid && stopDistanceRatio > 0 && tpDistanceRatio > 0
        ? tpDistanceRatio / stopDistanceRatio
        : 0;

    // Isolated margin liquidation approximation (0.5% maintenance buffer)
    const maintBuffer = 0.005;
    const liqDistanceRatio = Math.max(0.005, 1 / effLeverage - maintBuffer);
    const estimatedLiqPrice =
      marketType === 'futures' && safeEntry > 0
        ? side === 'LONG'
          ? Math.max(0, safeEntry * (1 - liqDistanceRatio))
          : safeEntry * (1 + liqDistanceRatio)
        : null;

    const marginExceedsDeposit = isValid && requiredMarginUsdt > safeDeposit;
    const liqBeforeStop =
      marketType === 'futures' && isValid && stopDistanceRatio >= liqDistanceRatio;

    return {
      safeDeposit,
      safeRiskPct,
      effLeverage,
      riskAmountUsdt,
      stopDistancePct: stopDistanceRatio * 100,
      positionNotionalUsdt,
      lotSizeCoins,
      requiredMarginUsdt,
      marginUsagePct,
      potentialProfitUsdt,
      rewardRiskRatio,
      estimatedLiqPrice,
      stopValidationError,
      marginExceedsDeposit,
      liqBeforeStop,
      isValid,
    };
  }, [
    depositUsdt,
    riskPct,
    entryPrice,
    marketType,
    leverage,
    slMode,
    slPct,
    tpPct,
    stopPrice,
    takeProfitPrice,
    side,
  ]);

  const handleCopySummary = async () => {
    if (!calc.isValid) return;
    const lines = [
      `AegisQuant · Расчёт позиции (${symbol}, ${marketType === 'futures' ? `Фьючерсы ${calc.effLeverage}x` : 'Спот'} · ${side})`,
      `Депозит: ${formatUsdt(calc.safeDeposit)} | Риск: ${calc.safeRiskPct}% (${formatUsdt(calc.riskAmountUsdt)})`,
      `Вход: $${formatPriceSmart(entryPrice)} | Стоп: ${calc.stopDistancePct.toFixed(2)}%`,
      `Объём лота: ${formatLotSmart(calc.lotSizeCoins)} ${baseAsset}`,
      `Объём позиции: ${formatUsdt(calc.positionNotionalUsdt)} | Маржа: ${formatUsdt(calc.requiredMarginUsdt)}`,
    ];
    if (calc.rewardRiskRatio > 0) {
      lines.push(`Потенциал TP: +${formatUsdt(calc.potentialProfitUsdt)} (R:R 1:${calc.rewardRiskRatio.toFixed(2)})`);
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked in restricted iframe
    }
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.1 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      aria-labelledby="position-calculator-heading"
      className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-5 sm:p-6 space-y-5"
    >
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-white/8">
        <div>
          <div className="text-xs text-slate-400">
            Риск-менеджмент · Авторасчёт по выбранной стратегии и Stop-Loss
          </div>
          <h2 id="position-calculator-heading" className="mt-1 text-lg font-semibold text-white flex items-center gap-2">
            <Calculator className="w-5 h-5 text-emerald-400 shrink-0" />
            <span>Калькулятор позиции</span>
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Точный расчёт объёма лота в монетах и USDT так, чтобы при срабатывании Stop-Loss убыток не превысил заданный процент депозита.
          </p>
        </div>

        {/* Market & Mode Quick Controls */}
        <div className="flex flex-wrap items-center gap-2 self-start lg:self-auto">
          <div className="inline-flex items-center p-1 rounded-xl bg-[#0B0F17] border border-white/8">
            {(['spot', 'futures'] as const).map((m) => {
              const active = marketType === m;
              return (
                <motion.button
                  key={m}
                  type="button"
                  whileTap={{ scale: 0.96 }}
                  onClick={() => handleChangeMarket(m)}
                  className={`relative min-h-[38px] px-3.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                    active ? 'text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="calc-market-tab"
                      transition={{ type: 'spring', stiffness: 450, damping: 34 }}
                      className="absolute inset-0 rounded-lg bg-emerald-600"
                    />
                  )}
                  <span className="relative z-10">{m === 'spot' ? 'Спот (1x)' : 'Фьючерсы'}</span>
                </motion.button>
              );
            })}
          </div>

          <div className="inline-flex items-center p-1 rounded-xl bg-[#0B0F17] border border-white/8">
            {(
              [
                { id: 'percent', label: 'Стоп в %' },
                { id: 'price', label: 'По ценам' },
              ] as const
            ).map((mode) => {
              const active = slMode === mode.id;
              return (
                <motion.button
                  key={mode.id}
                  type="button"
                  whileTap={{ scale: 0.96 }}
                  onClick={() => setSlMode(mode.id)}
                  className={`relative min-h-[38px] px-3 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                    active ? 'text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="calc-sl-mode"
                      transition={{ type: 'spring', stiffness: 450, damping: 34 }}
                      className="absolute inset-0 rounded-lg bg-white/12"
                    />
                  )}
                  <span className="relative z-10">{mode.label}</span>
                </motion.button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main 2-Column Split (Inputs | Results) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Risk & Strategy Parameters */}
        <div className="lg:col-span-7 space-y-4">
          {/* Strategy Preset + Pair */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="calc-strategy-preset" className="block text-xs text-slate-400 mb-1.5">
                Пресет стратегии (риск и плечо)
              </label>
              <select
                id="calc-strategy-preset"
                value={selectedStrategyKey}
                onChange={(e) => handleSelectPreset(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border border-white/10 bg-[#0B0F17] px-3 text-xs sm:text-sm text-white focus:border-emerald-500 focus:outline-none"
              >
                {strategyPresets.map((preset) => (
                  <option key={preset.key} value={preset.key}>
                    {preset.name} ({preset.riskPct}% · {preset.marketType === 'futures' ? `${preset.leverage}x` : 'Спот'})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="calc-pair-select" className="block text-xs text-slate-400 mb-1.5">
                Торговая пара
              </label>
              <div className="flex items-center gap-2">
                <select
                  id="calc-pair-select"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  className="flex-1 min-h-[42px] rounded-xl border border-white/10 bg-[#0B0F17] px-3 text-xs sm:text-sm font-mono text-white focus:border-emerald-500 focus:outline-none"
                >
                  {TRADING_PAIRS.map((p) => (
                    <option key={p.symbol} value={p.symbol}>
                      {p.label} — {p.name}
                    </option>
                  ))}
                </select>
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.94 }}
                  disabled={priceLoading}
                  onClick={() => void fetchLivePrice(symbol, marketType)}
                  title="Обновить текущую рыночную цену"
                  aria-label="Обновить текущую рыночную цену"
                  className="min-h-[42px] min-w-[42px] rounded-xl border border-white/10 bg-[#0B0F17] hover:bg-white/5 text-slate-300 hover:text-white flex items-center justify-center transition-colors shrink-0"
                >
                  <RefreshCw className={`w-4 h-4 ${priceLoading ? 'animate-spin text-emerald-400' : ''}`} />
                </motion.button>
              </div>
            </div>
          </div>

          {/* Deposit & Risk % */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <label htmlFor="calc-deposit" className="text-slate-400">
                  Депозит (USDT)
                </label>
                <div className="flex items-center gap-1.5">
                  {[1000, 5000, 10000, 25000].map((presetAmt) => (
                    <button
                      key={presetAmt}
                      type="button"
                      onClick={() => setDepositUsdt(presetAmt)}
                      className={`px-1.5 py-0.5 rounded text-[11px] font-mono tabular-nums transition-colors ${
                        depositUsdt === presetAmt
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      ${presetAmt / 1000}k
                    </button>
                  ))}
                </div>
              </div>
              <input
                id="calc-deposit"
                type="number"
                min={10}
                step={100}
                value={depositUsdt}
                onChange={(e) => setDepositUsdt(Number(e.target.value))}
                className="w-full min-h-[42px] rounded-xl border border-white/10 bg-[#0B0F17] px-3 font-mono tabular-nums text-sm text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <label htmlFor="calc-risk-pct" className="text-slate-400">
                  Риск на сделку (%)
                </label>
                <span className="font-mono tabular-nums text-amber-300 font-semibold">
                  {formatUsdt(calc.riskAmountUsdt)}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <input
                  id="calc-risk-pct"
                  type="number"
                  min={0.1}
                  max={25}
                  step={0.25}
                  value={riskPct}
                  onChange={(e) => setRiskPct(Number(e.target.value))}
                  className="w-24 min-h-[42px] rounded-xl border border-white/10 bg-[#0B0F17] px-3 font-mono tabular-nums text-sm text-white focus:border-emerald-500 focus:outline-none shrink-0"
                />
                <input
                  type="range"
                  aria-label="Слайдер процента риска"
                  min={0.25}
                  max={10}
                  step={0.25}
                  value={Math.min(10, Math.max(0.25, riskPct || 0.25))}
                  onChange={(e) => setRiskPct(Number(e.target.value))}
                  className="w-full accent-emerald-500"
                />
              </div>
            </div>
          </div>

          {/* Entry Price + Stop-Loss / Take-Profit Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <label htmlFor="calc-entry-price" className="text-slate-400">
                  Цена входа ($)
                </label>
                <span className="text-[11px] text-slate-500">{priceSourceLabel}</span>
              </div>
              <input
                id="calc-entry-price"
                type="number"
                min={0}
                step="any"
                value={entryPrice}
                onChange={(e) => setEntryPrice(Number(e.target.value))}
                className="w-full min-h-[42px] rounded-xl border border-white/10 bg-[#0B0F17] px-3 font-mono tabular-nums text-sm text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>

            {slMode === 'percent' ? (
              <>
                <div>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <label htmlFor="calc-sl-pct" className="text-slate-400">
                      Stop-Loss (%)
                    </label>
                    <div className="flex items-center gap-1">
                      {[1, 2, 3, 5].map((pct) => (
                        <button
                          key={pct}
                          type="button"
                          onClick={() => setSlPct(pct)}
                          className={`px-1 rounded text-[11px] font-mono tabular-nums ${
                            slPct === pct ? 'text-rose-300 font-semibold' : 'text-slate-500 hover:text-slate-300'
                          }`}
                        >
                          {pct}%
                        </button>
                      ))}
                    </div>
                  </div>
                  <input
                    id="calc-sl-pct"
                    type="number"
                    min={0.1}
                    max={50}
                    step={0.1}
                    value={slPct}
                    onChange={(e) => setSlPct(Number(e.target.value))}
                    className="w-full min-h-[42px] rounded-xl border border-white/10 bg-[#0B0F17] px-3 font-mono tabular-nums text-sm text-rose-300 focus:border-rose-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="calc-tp-pct" className="block text-xs text-slate-400 mb-1.5">
                    Take-Profit (%)
                  </label>
                  <input
                    id="calc-tp-pct"
                    type="number"
                    min={0}
                    max={200}
                    step={0.5}
                    value={tpPct}
                    onChange={(e) => setTpPct(Number(e.target.value))}
                    className="w-full min-h-[42px] rounded-xl border border-white/10 bg-[#0B0F17] px-3 font-mono tabular-nums text-sm text-emerald-300 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </>
            ) : (
              <>
                <div>
                  <label htmlFor="calc-stop-price" className="block text-xs text-slate-400 mb-1.5">
                    Цена Stop-Loss ($)
                  </label>
                  <input
                    id="calc-stop-price"
                    type="number"
                    min={0}
                    step="any"
                    value={stopPrice}
                    onChange={(e) => setStopPrice(Number(e.target.value))}
                    className="w-full min-h-[42px] rounded-xl border border-white/10 bg-[#0B0F17] px-3 font-mono tabular-nums text-sm text-rose-300 focus:border-rose-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="calc-tp-price" className="block text-xs text-slate-400 mb-1.5">
                    Цена Take-Profit ($)
                  </label>
                  <input
                    id="calc-tp-price"
                    type="number"
                    min={0}
                    step="any"
                    value={takeProfitPrice}
                    onChange={(e) => setTakeProfitPrice(Number(e.target.value))}
                    className="w-full min-h-[42px] rounded-xl border border-white/10 bg-[#0B0F17] px-3 font-mono tabular-nums text-sm text-emerald-300 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </>
            )}
          </div>

          {/* Futures Direction & Leverage Controls */}
          {marketType === 'futures' && (
            <div className="pt-2 border-t border-white/8 grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
              <div>
                <div className="text-xs text-slate-400 mb-1.5">Направление сделки</div>
                <div className="inline-flex items-center p-1 rounded-xl bg-[#0B0F17] border border-white/8">
                  {(['LONG', 'SHORT'] as const).map((dir) => {
                    const active = side === dir;
                    return (
                      <button
                        key={dir}
                        type="button"
                        onClick={() => handleChangeSide(dir)}
                        className={`min-h-[36px] px-4 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                          active
                            ? dir === 'LONG'
                              ? 'bg-emerald-600 text-white'
                              : 'bg-rose-600 text-white'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {dir}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-slate-400">Кредитное плечо</span>
                  <span className="font-mono tabular-nums font-semibold text-amber-400">{calc.effLeverage}x</span>
                </div>
                <input
                  type="range"
                  aria-label="Кредитное плечо"
                  min={1}
                  max={20}
                  step={1}
                  value={calc.effLeverage}
                  onChange={(e) => setLeverage(Number(e.target.value))}
                  className="w-full accent-amber-500"
                />
              </div>
            </div>
          )}

          {/* Validation / Margin / Liquidation Warnings (Explicit text + icons, no hue-only) */}
          {(calc.stopValidationError || calc.marginExceedsDeposit || calc.liqBeforeStop) && (
            <div className="pt-2 space-y-2 text-xs">
              {calc.stopValidationError && (
                <div className="flex items-start gap-2 text-rose-300">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{calc.stopValidationError}</span>
                </div>
              )}
              {calc.marginExceedsDeposit && (
                <div className="flex items-start gap-2 text-amber-300">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    Недостаточно депозита: требуемая маржа ({formatUsdt(calc.requiredMarginUsdt)}) превышает баланс. Увеличьте Stop-Loss, снизьте % риска или скорректируйте плечо.
                  </span>
                </div>
              )}
              {calc.liqBeforeStop && (
                <div className="flex items-start gap-2 text-rose-300">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    Риск ликвидации: дистанция Stop-Loss ({calc.stopDistancePct.toFixed(2)}%) больше порога ликвидации для {calc.effLeverage}x. Снизьте плечо или уменьшите стоп.
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: Real-Time Calculated Output Readout */}
        <div className="lg:col-span-5 lg:border-l lg:border-white/8 lg:pl-6 pt-4 lg:pt-0 border-t lg:border-t-0 border-white/8 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs text-slate-400">
                Рекомендуемый объём лота · {symbol}
              </div>
              <div className="mt-1.5 text-2xl sm:text-3xl font-bold font-mono tabular-nums text-emerald-400">
                {calc.isValid ? `${formatLotSmart(calc.lotSizeCoins)} ${baseAsset}` : '—'}
              </div>
              <div className="mt-1 text-xs text-slate-400 font-mono tabular-nums">
                Полный объём позиции: {calc.isValid ? formatUsdt(calc.positionNotionalUsdt) : '—'}
              </div>
            </div>

            <motion.button
              type="button"
              whileTap={{ scale: 0.95 }}
              disabled={!calc.isValid}
              onClick={() => void handleCopySummary()}
              className="min-h-[38px] px-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 disabled:opacity-40 text-xs font-medium text-slate-200 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-300">Скопировано</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Копировать</span>
                </>
              )}
            </motion.button>
          </div>

          {/* Hairline-divided Metrics Grid (zero nested boxes) */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-3.5 pt-4 border-t border-white/8 text-xs">
            <div>
              <div className="text-slate-400">Риск при Stop-Loss</div>
              <div className="mt-0.5 font-mono tabular-nums text-sm font-semibold text-rose-300">
                -{formatUsdt(calc.riskAmountUsdt)} ({calc.safeRiskPct.toFixed(2)}%)
              </div>
            </div>

            <div>
              <div className="text-slate-400">Требуемая маржа</div>
              <div
                className={`mt-0.5 font-mono tabular-nums text-sm font-semibold ${
                  calc.marginExceedsDeposit ? 'text-amber-300' : 'text-white'
                }`}
              >
                {calc.isValid ? formatUsdt(calc.requiredMarginUsdt) : '—'}
                {calc.isValid && (
                  <span className="ml-1.5 text-[11px] font-normal text-slate-400">
                    ({calc.marginUsagePct.toFixed(1)}%)
                  </span>
                )}
              </div>
            </div>

            <div>
              <div className="text-slate-400">Дистанция Stop-Loss</div>
              <div className="mt-0.5 font-mono tabular-nums text-sm font-semibold text-slate-200">
                {calc.isValid ? `${calc.stopDistancePct.toFixed(2)}%` : '—'}
              </div>
            </div>

            <div>
              <div className="text-slate-400">Потенциал TP и R:R</div>
              <div className="mt-0.5 font-mono tabular-nums text-sm font-semibold text-emerald-300">
                {calc.isValid && calc.rewardRiskRatio > 0
                  ? `+${formatUsdt(calc.potentialProfitUsdt)} · 1:${calc.rewardRiskRatio.toFixed(2)}`
                  : 'Не задан TP'}
              </div>
            </div>

            <div>
              <div className="text-slate-400">
                {marketType === 'futures' ? 'Ориентир ликвидации' : 'Тип исполнения'}
              </div>
              <div className="mt-0.5 font-mono tabular-nums text-sm font-semibold text-slate-200">
                {marketType === 'futures'
                  ? calc.estimatedLiqPrice !== null
                    ? `$${formatPriceSmart(calc.estimatedLiqPrice)}`
                    : '—'
                  : 'Спот без плеча (1x)'}
              </div>
            </div>

            <div>
              <div className="text-slate-400">Цена расчётного SL</div>
              <div className="mt-0.5 font-mono tabular-nums text-sm font-semibold text-rose-300">
                {calc.isValid
                  ? slMode === 'percent'
                    ? `$${formatPriceSmart(
                        entryPrice *
                          (side === 'LONG' ? 1 - calc.stopDistancePct / 100 : 1 + calc.stopDistancePct / 100)
                      )}`
                    : `$${formatPriceSmart(stopPrice)}`
                  : '—'}
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-white/8 text-[11px] text-slate-500 leading-relaxed font-mono tabular-nums">
            Формула: Лот = (Депозит × Риск%) / |Вход − Stop-Loss| · Без учёта биржевых комиссий и проскальзывания.
          </div>
        </div>
      </div>
    </motion.section>
  );
};
