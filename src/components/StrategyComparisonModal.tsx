import React, { useEffect, useMemo, useState } from 'react';
import {
  Award,
  BarChart3,
  Check,
  Crown,
  Scale,
  Search,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  X,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { STRATEGY_CATALOG } from '../data/strategies';
import type { StrategyBreakdownResult, StrategyConfig, StrategyTemplate } from '../types/domain';
import { triggerHaptic } from '../lib/securityDlp';
import { TERMINAL_EASE } from './MotionPrimitives';

const MAX_COMPARE_STRATEGIES = 4;

interface StrategyComparisonModalProps {
  open: boolean;
  onClose: () => void;
  selectedKeys: string[];
  onChangeSelectedKeys: (nextKeys: string[]) => void;
  strategies: StrategyConfig[];
  catalogBacktest: Record<string, StrategyBreakdownResult>;
}

const RISK_SCORE: Record<StrategyTemplate['riskProfile'], number> = {
  Консервативная: 1,
  Сбалансированная: 2,
  Агрессивная: 3,
};

function getRiskBadgeClass(profile: StrategyTemplate['riskProfile']): string {
  if (profile === 'Консервативная') {
    return 'border-emerald-500/35 bg-emerald-500/12 text-emerald-300';
  }
  if (profile === 'Агрессивная') {
    return 'border-rose-500/35 bg-rose-500/12 text-rose-300';
  }
  return 'border-amber-500/35 bg-amber-500/12 text-amber-200';
}

function getTierBadge(tier: StrategyTemplate['tier']) {
  if (tier === 'max') {
    return (
      <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 border border-cyan-400/40 bg-cyan-500/15 font-mono text-[9px] font-bold text-cyan-200">
        <Sparkles className="w-2.5 h-2.5" />
        MAX
      </span>
    );
  }
  if (tier === 'pro') {
    return (
      <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 border border-amber-400/35 bg-amber-500/15 font-mono text-[9px] font-bold text-amber-200">
        <Crown className="w-2.5 h-2.5" />
        PRO
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded px-1.5 py-0.5 border border-white/12 bg-white/5 font-mono text-[9px] font-semibold text-slate-300">
      FREE
    </span>
  );
}

export const StrategyComparisonModal: React.FC<StrategyComparisonModalProps> = ({
  open,
  onClose,
  selectedKeys,
  onChangeSelectedKeys,
  strategies,
  catalogBacktest,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const [searchQuery, setSearchQuery] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  const configByKey = useMemo(() => {
    const map = new Map<string, StrategyConfig>();
    for (const s of strategies) map.set(s.strategyKey, s);
    return map;
  }, [strategies]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const selectedItems = useMemo(() => {
    return selectedKeys
      .map((key) => STRATEGY_CATALOG.find((t) => t.key === key))
      .filter((t): t is StrategyTemplate => Boolean(t))
      .map((tpl) => {
        const cfg = configByKey.get(tpl.key);
        const bt = catalogBacktest[tpl.key];
        const riskPerTradePct = cfg?.riskPerTradePct ?? tpl.defaultRiskPct;
        const leverage = tpl.marketType === 'futures' ? cfg?.leverage ?? tpl.defaultLeverage : 1;
        const minConfidence = cfg?.minConfidence ?? 72;
        const returnToDd =
          bt && bt.maxDrawdownPct > 0
            ? Number((bt.totalPnlPct / bt.maxDrawdownPct).toFixed(2))
            : null;
        return {
          tpl,
          cfg,
          bt,
          riskPerTradePct,
          leverage,
          minConfidence,
          returnToDd,
        };
      });
  }, [selectedKeys, configByKey, catalogBacktest]);

  const filteredCatalog = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return STRATEGY_CATALOG;
    return STRATEGY_CATALOG.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.shortTag.toLowerCase().includes(q) ||
        t.riskProfile.toLowerCase().includes(q) ||
        t.marketType.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  // Лучшие показатели среди выбранных для наглядной подсветки
  const bestMetrics = useMemo(() => {
    const withBt = selectedItems.filter((item) => Boolean(item.bt));
    const maxRoi =
      withBt.length > 0 ? Math.max(...withBt.map((i) => i.bt!.totalPnlPct)) : null;
    const maxWinRate =
      withBt.length > 0 ? Math.max(...withBt.map((i) => i.bt!.winRatePct)) : null;
    const maxPf =
      withBt.length > 0 ? Math.max(...withBt.map((i) => i.bt!.profitFactor)) : null;
    const minDrawdown =
      withBt.length > 0 ? Math.min(...withBt.map((i) => i.bt!.maxDrawdownPct)) : null;
    const minRiskPct =
      selectedItems.length > 0 ? Math.min(...selectedItems.map((i) => i.riskPerTradePct)) : null;

    const roiLeader =
      withBt.length > 0
        ? withBt.reduce((best, cur) => (cur.bt!.totalPnlPct > best.bt!.totalPnlPct ? cur : best))
        : null;
    const riskLeader =
      withBt.length > 0
        ? withBt.reduce((best, cur) => (cur.bt!.maxDrawdownPct < best.bt!.maxDrawdownPct ? cur : best))
        : selectedItems.length > 0
          ? selectedItems.reduce((best, cur) =>
              RISK_SCORE[cur.tpl.riskProfile] < RISK_SCORE[best.tpl.riskProfile] ? cur : best
            )
          : null;
    const wrLeader =
      withBt.length > 0
        ? withBt.reduce((best, cur) => (cur.bt!.winRatePct > best.bt!.winRatePct ? cur : best))
        : null;

    return {
      maxRoi,
      maxWinRate,
      maxPf,
      minDrawdown,
      minRiskPct,
      roiLeader,
      riskLeader,
      wrLeader,
      hasBacktest: withBt.length > 0,
    };
  }, [selectedItems]);

  const chartData = useMemo(
    () =>
      selectedItems.map((item) => ({
        name:
          item.tpl.name.length > 18
            ? `${item.tpl.name.slice(0, 17)}…`
            : item.tpl.name,
        fullName: item.tpl.name,
        roiPct: item.bt ? Number(item.bt.totalPnlPct.toFixed(2)) : 0,
        winRatePct: item.bt ? Number(item.bt.winRatePct.toFixed(1)) : 0,
        maxDrawdownPct: item.bt ? Number(item.bt.maxDrawdownPct.toFixed(2)) : 0,
      })),
    [selectedItems]
  );

  const toggleStrategyKey = (key: string) => {
    triggerHaptic(8);
    if (selectedKeys.includes(key)) {
      if (selectedKeys.length <= 2) return;
      onChangeSelectedKeys(selectedKeys.filter((k) => k !== key));
      return;
    }
    if (selectedKeys.length >= MAX_COMPARE_STRATEGIES) {
      onChangeSelectedKeys([...selectedKeys.slice(1), key]);
    } else {
      onChangeSelectedKeys([...selectedKeys, key]);
    }
  };

  const applyPreset = (preset: 'active' | 'top_roi' | 'risk_spectrum') => {
    triggerHaptic(10);
    if (preset === 'active') {
      const enabledKeys = strategies.filter((s) => s.enabled).map((s) => s.strategyKey);
      const unique = Array.from(new Set(enabledKeys)).slice(0, MAX_COMPARE_STRATEGIES);
      if (unique.length >= 2) {
        onChangeSelectedKeys(unique);
        return;
      }
    }
    if (preset === 'top_roi') {
      const ranked = STRATEGY_CATALOG.slice()
        .sort(
          (a, b) =>
            (catalogBacktest[b.key]?.totalPnlPct ?? -999) -
            (catalogBacktest[a.key]?.totalPnlPct ?? -999)
        )
        .slice(0, 3)
        .map((t) => t.key);
      if (ranked.length >= 2) {
        onChangeSelectedKeys(ranked);
        return;
      }
    }
    // Консервативная vs Сбалансированная vs Агрессивная
    const cons = STRATEGY_CATALOG.find((t) => t.riskProfile === 'Консервативная');
    const bal = STRATEGY_CATALOG.find((t) => t.riskProfile === 'Сбалансированная');
    const agg = STRATEGY_CATALOG.find((t) => t.riskProfile === 'Агрессивная');
    const spectrum = [cons?.key, bal?.key, agg?.key].filter((k): k is string => Boolean(k));
    if (spectrum.length >= 2) onChangeSelectedKeys(spectrum);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16, ease: TERMINAL_EASE }}
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-md p-2 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Сравнение параметров риска и исторической доходности стратегий"
        >
          <motion.div
            initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.985 }}
            animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.985 }}
            transition={{ duration: 0.2, ease: TERMINAL_EASE }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-5xl max-h-[93dvh] flex flex-col overflow-hidden rounded-2xl border border-emerald-500/30 bg-[#0E1522] shadow-2xl"
          >
            {/* Header */}
            <div className="px-4 sm:px-5 py-3.5 border-b border-white/8 bg-[#0B0F17] flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                    <Scale className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Сравнение стратегий: риск и историческая доходность</span>
                  </h3>
                  <span className="px-2 py-0.5 rounded-md border border-emerald-500/30 bg-emerald-500/12 font-mono text-[10px] text-emerald-300 tabular-nums">
                    Выбрано {selectedItems.length} / {MAX_COMPARE_STRATEGIES}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  Реальные метрики 1H OHLCV-бэктеста (депозит $2,500) и настроенные параметры риск-менеджмента.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Закрыть окно сравнения стратегий"
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-white/5 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
              {/* Панель выбора стратегий и быстрых пресетов */}
              <div className="rounded-xl border border-white/10 bg-[#0B0F17] p-3 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-slate-400 mr-1">Быстрый набор:</span>
                    <button
                      type="button"
                      onClick={() => applyPreset('top_roi')}
                      className="min-h-[28px] px-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-[11px] font-medium text-emerald-200 transition-colors"
                    >
                      Топ по доходности
                    </button>
                    <button
                      type="button"
                      onClick={() => applyPreset('risk_spectrum')}
                      className="min-h-[28px] px-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-[11px] font-medium text-amber-200 transition-colors"
                    >
                      Спектр риска (Конс. ↔ Агр.)
                    </button>
                    <button
                      type="button"
                      onClick={() => applyPreset('active')}
                      className="min-h-[28px] px-2.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20 text-[11px] font-medium text-cyan-200 transition-colors"
                    >
                      Мои активные
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => setPickerOpen((prev) => !prev)}
                    className="min-h-[30px] px-3 rounded-lg border border-white/12 bg-white/5 hover:bg-white/10 text-xs font-semibold text-white transition-colors"
                  >
                    {pickerOpen ? 'Скрыть список стратегий' : 'Изменить набор стратегий'}
                  </button>
                </div>

                {/* Чипы выбранных стратегий */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {selectedItems.map(({ tpl }) => (
                    <span
                      key={tpl.key}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs text-white"
                    >
                      {getTierBadge(tpl.tier)}
                      <span className="font-medium">{tpl.name}</span>
                      {selectedItems.length > 2 && (
                        <button
                          type="button"
                          onClick={() => toggleStrategyKey(tpl.key)}
                          aria-label={`Убрать ${tpl.name} из сравнения`}
                          className="text-slate-400 hover:text-rose-300"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </span>
                  ))}
                </div>

                {pickerOpen && (
                  <div className="pt-2 border-t border-white/8 space-y-2">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Поиск по названию, тегу, риску или рынку (spot / futures)…"
                        className="w-full min-h-[34px] pl-8 pr-3 rounded-lg border border-white/10 bg-[#0E1522] text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-400/50"
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1.5 max-h-48 overflow-y-auto pr-1">
                      {filteredCatalog.map((tpl) => {
                        const isSelected = selectedKeys.includes(tpl.key);
                        const bt = catalogBacktest[tpl.key];
                        return (
                          <button
                            key={tpl.key}
                            type="button"
                            onClick={() => toggleStrategyKey(tpl.key)}
                            className={`text-left rounded-lg border px-2.5 py-2 text-xs transition-colors flex items-start justify-between gap-2 ${
                              isSelected
                                ? 'border-emerald-400/50 bg-emerald-500/15 text-white'
                                : 'border-white/8 bg-white/[0.02] hover:bg-white/[0.06] text-slate-300'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="font-medium truncate">{tpl.name}</div>
                              <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] font-mono text-slate-400">
                                <span>{tpl.marketType === 'futures' ? 'Futures' : 'Spot'}</span>
                                <span>·</span>
                                <span>{tpl.riskProfile}</span>
                                {bt && (
                                  <>
                                    <span>·</span>
                                    <span className={bt.totalPnlPct >= 0 ? 'text-emerald-300' : 'text-rose-300'}>
                                      {bt.totalPnlPct >= 0 ? '+' : ''}
                                      {bt.totalPnlPct.toFixed(1)}%
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                            <span
                              className={`mt-0.5 h-4 w-4 rounded border flex items-center justify-center shrink-0 ${
                                isSelected
                                  ? 'border-emerald-400 bg-emerald-500 text-slate-950'
                                  : 'border-white/20'
                              }`}
                            >
                              {isSelected && <Check className="w-3 h-3" />}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Сводка лидеров сравнения */}
              {selectedItems.length >= 2 && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                  <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] px-3.5 py-2.5">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-300">
                      <TrendingUp className="w-3.5 h-3.5 shrink-0" />
                      <span>Лидер доходности (ROI)</span>
                    </div>
                    <div className="mt-1 text-xs font-bold text-white truncate">
                      {bestMetrics.roiLeader ? bestMetrics.roiLeader.tpl.name : 'Расчёт бэктеста…'}
                    </div>
                    {bestMetrics.roiLeader?.bt && (
                      <div className="text-[11px] font-mono tabular-nums text-emerald-300">
                        {bestMetrics.roiLeader.bt.totalPnlPct >= 0 ? '+' : ''}
                        {bestMetrics.roiLeader.bt.totalPnlPct.toFixed(2)}% ($
                        {bestMetrics.roiLeader.bt.totalPnlUsdt.toFixed(0)})
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/[0.06] px-3.5 py-2.5">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-cyan-300">
                      <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                      <span>Минимальный риск / просадка</span>
                    </div>
                    <div className="mt-1 text-xs font-bold text-white truncate">
                      {bestMetrics.riskLeader ? bestMetrics.riskLeader.tpl.name : '—'}
                    </div>
                    {bestMetrics.riskLeader && (
                      <div className="text-[11px] font-mono tabular-nums text-cyan-200">
                        {bestMetrics.riskLeader.bt
                          ? `Max DD: -${bestMetrics.riskLeader.bt.maxDrawdownPct.toFixed(2)}%`
                          : bestMetrics.riskLeader.tpl.riskProfile}
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-3.5 py-2.5">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-300">
                      <Award className="w-3.5 h-3.5 shrink-0" />
                      <span>Лучший Win Rate</span>
                    </div>
                    <div className="mt-1 text-xs font-bold text-white truncate">
                      {bestMetrics.wrLeader ? bestMetrics.wrLeader.tpl.name : 'Расчёт бэктеста…'}
                    </div>
                    {bestMetrics.wrLeader?.bt && (
                      <div className="text-[11px] font-mono tabular-nums text-amber-200">
                        {bestMetrics.wrLeader.bt.winRatePct.toFixed(1)}% · PF{' '}
                        {bestMetrics.wrLeader.bt.profitFactor.toFixed(2)}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Визуальное сопоставление на графике (Recharts) */}
              <div className="rounded-xl border border-white/10 bg-[#0B0F17] p-3.5 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
                    <BarChart3 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Визуальное сравнение: ROI %, Win Rate % и Max Drawdown %</span>
                  </div>
                  <span className="text-[10px] font-mono text-slate-400">1H исторический бэктест</span>
                </div>

                {bestMetrics.hasBacktest ? (
                  <div className="h-56 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} margin={{ top: 8, right: 12, left: -12, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" />
                        <XAxis
                          dataKey="name"
                          tick={{ fill: '#94a3b8', fontSize: 11 }}
                          axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                          tickLine={false}
                        />
                        <YAxis
                          tick={{ fill: '#94a3b8', fontSize: 11 }}
                          axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                          tickLine={false}
                          unit="%"
                        />
                        <Tooltip
                          cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                          contentStyle={{
                            backgroundColor: '#0B0F17',
                            border: '1px solid rgba(255,255,255,0.14)',
                            borderRadius: '12px',
                            fontSize: '12px',
                            color: '#f8fafc',
                          }}
                          formatter={(value: unknown, name: unknown) => {
                            const num = typeof value === 'number' ? value : Number(value);
                            const label =
                              name === 'roiPct'
                                ? 'Доходность (ROI)'
                                : name === 'winRatePct'
                                  ? 'Win Rate'
                                  : 'Макс. просадка';
                            return [`${Number.isFinite(num) ? num.toFixed(2) : '0'}%`, label];
                          }}
                        />
                        <Legend
                          wrapperStyle={{ fontSize: '11px', paddingTop: '4px' }}
                          formatter={(value) =>
                            value === 'roiPct'
                              ? 'ROI %'
                              : value === 'winRatePct'
                                ? 'Win Rate %'
                                : 'Max DD %'
                          }
                        />
                        <Bar dataKey="roiPct" fill="#10b981" radius={[6, 6, 0, 0]} maxBarSize={36} />
                        <Bar dataKey="winRatePct" fill="#22d3ee" radius={[6, 6, 0, 0]} maxBarSize={36} />
                        <Bar dataKey="maxDrawdownPct" fill="#f43f5e" radius={[6, 6, 0, 0]} maxBarSize={36} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="h-36 rounded-xl border border-white/8 bg-[#0E1522] flex items-center justify-center text-xs text-slate-400">
                    Загружаем исторические метрики бэктеста 1H для выбранных стратегий…
                  </div>
                )}
              </div>

              {/* Детальная матрица сравнения параметров риска и доходности */}
              <div className="rounded-xl border border-white/10 bg-[#0B0F17] overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-white/10 bg-white/[0.02]">
                        <th className="py-3 px-3.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider w-44">
                          Параметр
                        </th>
                        {selectedItems.map(({ tpl, cfg }) => (
                          <th key={tpl.key} className="py-3 px-3.5 min-w-[165px]">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {getTierBadge(tpl.tier)}
                              <span className="text-[10px] font-mono uppercase text-slate-400">
                                {tpl.marketType === 'futures' ? 'Futures' : 'Spot'}
                              </span>
                              {cfg?.enabled && (
                                <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 font-mono text-[9px]">
                                  АКТ
                                </span>
                              )}
                            </div>
                            <div className="mt-1 font-bold text-white leading-snug">{tpl.name}</div>
                          </th>
                        ))}
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-white/[0.06]">
                      {/* Группа: Параметры риска */}
                      <tr className="bg-white/[0.02]">
                        <td
                          colSpan={selectedItems.length + 1}
                          className="py-2 px-3.5 text-[10px] font-mono font-bold uppercase tracking-wider text-amber-300"
                        >
                          Параметры риска
                        </td>
                      </tr>

                      <tr>
                        <td className="py-2.5 px-3.5 text-slate-400">Профиль риска</td>
                        {selectedItems.map(({ tpl }) => (
                          <td key={tpl.key} className="py-2.5 px-3.5">
                            <span
                              className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-medium ${getRiskBadgeClass(
                                tpl.riskProfile
                              )}`}
                            >
                              {tpl.riskProfile}
                            </span>
                          </td>
                        ))}
                      </tr>

                      <tr>
                        <td className="py-2.5 px-3.5 text-slate-400">Риск на сделку</td>
                        {selectedItems.map(({ tpl, riskPerTradePct }) => {
                          const isLowest =
                            bestMetrics.minRiskPct !== null && riskPerTradePct === bestMetrics.minRiskPct;
                          return (
                            <td
                              key={tpl.key}
                              className={`py-2.5 px-3.5 font-mono tabular-nums ${
                                isLowest ? 'text-emerald-300 font-semibold' : 'text-slate-200'
                              }`}
                            >
                              {riskPerTradePct.toFixed(1)}%
                            </td>
                          );
                        })}
                      </tr>

                      <tr>
                        <td className="py-2.5 px-3.5 text-slate-400">Плечо (Leverage)</td>
                        {selectedItems.map(({ tpl, leverage }) => (
                          <td key={tpl.key} className="py-2.5 px-3.5 font-mono tabular-nums text-slate-200">
                            {tpl.marketType === 'futures' ? `${leverage}x` : '1x (Спот)'}
                          </td>
                        ))}
                      </tr>

                      <tr>
                        <td className="py-2.5 px-3.5 text-slate-400">Мин. уверенность сигнала</td>
                        {selectedItems.map(({ tpl, minConfidence }) => (
                          <td key={tpl.key} className="py-2.5 px-3.5 font-mono tabular-nums text-slate-200">
                            {minConfidence}%
                          </td>
                        ))}
                      </tr>

                      <tr>
                        <td className="py-2.5 px-3.5 text-slate-400">Макс. просадка (Max DD)</td>
                        {selectedItems.map(({ tpl, bt }) => {
                          const isBest =
                            bt &&
                            bestMetrics.minDrawdown !== null &&
                            bt.maxDrawdownPct === bestMetrics.minDrawdown;
                          return (
                            <td
                              key={tpl.key}
                              className={`py-2.5 px-3.5 font-mono tabular-nums ${
                                !bt
                                  ? 'text-slate-500'
                                  : isBest
                                    ? 'text-emerald-300 font-bold'
                                    : 'text-rose-300'
                              }`}
                            >
                              {bt ? `-${bt.maxDrawdownPct.toFixed(2)}%` : '—'}
                            </td>
                          );
                        })}
                      </tr>

                      <tr>
                        <td className="py-2.5 px-3.5 text-slate-400">Таймфрейм и горизонт</td>
                        {selectedItems.map(({ tpl }) => (
                          <td key={tpl.key} className="py-2.5 px-3.5 text-slate-300">
                            <span className="font-mono text-white">{tpl.timeframeDefault.toUpperCase()}</span> ·{' '}
                            {tpl.expectedHorizon}
                          </td>
                        ))}
                      </tr>

                      {/* Группа: Историческая доходность */}
                      <tr className="bg-white/[0.02]">
                        <td
                          colSpan={selectedItems.length + 1}
                          className="py-2 px-3.5 text-[10px] font-mono font-bold uppercase tracking-wider text-emerald-300"
                        >
                          Историческая доходность (бэктест 1H · $2,500)
                        </td>
                      </tr>

                      <tr>
                        <td className="py-2.5 px-3.5 text-slate-400">Доходность (ROI %)</td>
                        {selectedItems.map(({ tpl, bt }) => {
                          const isBest =
                            bt && bestMetrics.maxRoi !== null && bt.totalPnlPct === bestMetrics.maxRoi;
                          return (
                            <td
                              key={tpl.key}
                              className={`py-2.5 px-3.5 font-mono tabular-nums ${
                                !bt
                                  ? 'text-slate-500'
                                  : isBest
                                    ? 'text-emerald-300 font-bold'
                                    : bt.totalPnlPct >= 0
                                      ? 'text-emerald-200'
                                      : 'text-rose-300'
                              }`}
                            >
                              {bt
                                ? `${bt.totalPnlPct >= 0 ? '+' : ''}${bt.totalPnlPct.toFixed(2)}% (${
                                    bt.totalPnlUsdt >= 0 ? '+' : ''
                                  }$${bt.totalPnlUsdt.toFixed(0)})`
                                : '—'}
                            </td>
                          );
                        })}
                      </tr>

                      <tr>
                        <td className="py-2.5 px-3.5 text-slate-400">Win Rate</td>
                        {selectedItems.map(({ tpl, bt }) => {
                          const isBest =
                            bt && bestMetrics.maxWinRate !== null && bt.winRatePct === bestMetrics.maxWinRate;
                          return (
                            <td
                              key={tpl.key}
                              className={`py-2.5 px-3.5 font-mono tabular-nums ${
                                !bt ? 'text-slate-500' : isBest ? 'text-cyan-300 font-bold' : 'text-slate-200'
                              }`}
                            >
                              {bt ? `${bt.winRatePct.toFixed(1)}%` : '—'}
                            </td>
                          );
                        })}
                      </tr>

                      <tr>
                        <td className="py-2.5 px-3.5 text-slate-400">Profit Factor</td>
                        {selectedItems.map(({ tpl, bt }) => {
                          const isBest =
                            bt && bestMetrics.maxPf !== null && bt.profitFactor === bestMetrics.maxPf;
                          return (
                            <td
                              key={tpl.key}
                              className={`py-2.5 px-3.5 font-mono tabular-nums ${
                                !bt ? 'text-slate-500' : isBest ? 'text-emerald-300 font-bold' : 'text-slate-200'
                              }`}
                            >
                              {bt ? bt.profitFactor.toFixed(2) : '—'}
                            </td>
                          );
                        })}
                      </tr>

                      <tr>
                        <td className="py-2.5 px-3.5 text-slate-400">Средний Risk / Reward</td>
                        {selectedItems.map(({ tpl, bt }) => (
                          <td key={tpl.key} className="py-2.5 px-3.5 font-mono tabular-nums text-slate-200">
                            {bt ? bt.avgRiskReward : '—'}
                          </td>
                        ))}
                      </tr>

                      <tr>
                        <td className="py-2.5 px-3.5 text-slate-400">Доходность / Просадка</td>
                        {selectedItems.map(({ tpl, returnToDd }) => (
                          <td key={tpl.key} className="py-2.5 px-3.5 font-mono tabular-nums text-slate-200">
                            {returnToDd !== null ? `${returnToDd.toFixed(2)}×` : '—'}
                          </td>
                        ))}
                      </tr>

                      <tr>
                        <td className="py-2.5 px-3.5 text-slate-400">Сделок в бэктесте</td>
                        {selectedItems.map(({ tpl, bt }) => (
                          <td key={tpl.key} className="py-2.5 px-3.5 font-mono tabular-nums text-slate-300">
                            {bt ? bt.tradesCount : '—'}
                          </td>
                        ))}
                      </tr>

                      <tr>
                        <td className="py-2.5 px-3.5 text-slate-400">Индикаторы</td>
                        {selectedItems.map(({ tpl }) => (
                          <td key={tpl.key} className="py-2.5 px-3.5 text-[11px] text-slate-300 leading-snug">
                            {tpl.indicatorsUsed.join(' · ')}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-4 sm:px-5 py-3 border-t border-white/8 bg-[#0B0F17] flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
              <span>Исторические результаты не гарантируют будущую доходность.</span>
              <button
                type="button"
                onClick={onClose}
                className="min-h-[36px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white transition-colors"
              >
                Закрыть
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
