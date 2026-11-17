import React, { useState } from 'react';
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Trash2,
  Wallet,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { PaperPortfolioReport } from '../hooks/usePaperPortfolio';
import { AnimatedNumber } from './MotionExtras';

interface MiniPortfolioWidgetProps {
  holdingsCount: number;
  report: PaperPortfolioReport;
  onManageInScreener: () => void;
  onClearPortfolio: () => void;
  onResetDemo: () => void;
  rightActions?: React.ReactNode;
}

export const MiniPortfolioWidget: React.FC<MiniPortfolioWidgetProps> = ({
  holdingsCount,
  report,
  onManageInScreener,
  onClearPortfolio,
  onResetDemo,
  rightActions,
}) => {
  const [expanded, setExpanded] = useState(false);

  if (holdingsCount === 0 || report.allocations.length === 0) {
    return (
      <div className="mb-3 rounded-xl border border-white/8 bg-[#111827]/90 px-3 py-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Wallet className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <span>Портфель пуст</span>
          <button
            type="button"
            onClick={onResetDemo}
            className="text-cyan-400 hover:text-cyan-300 font-medium inline-flex items-center gap-1 ml-1"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Демо</span>
          </button>
          <span className="text-slate-600">·</span>
          <button
            type="button"
            onClick={onManageInScreener}
            className="text-emerald-400 hover:text-emerald-300 font-medium inline-flex items-center gap-0.5"
          >
            <span>Добавить</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>

        {rightActions && <div className="flex items-center gap-1.5 shrink-0">{rightActions}</div>}
      </div>
    );
  }

  const isPositive = report.totalPnl >= 0;

  return (
    <section
      aria-label="Мини-виджет портфеля"
      className="mb-3 rounded-xl border border-white/8 bg-[#111827]/95 card-surface-glow overflow-hidden"
    >
      {/* Ultra-compact Single Row Summary Bar */}
      <div className="px-3 py-1.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 shrink-0" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={report.allocations}
                  dataKey="valueUsdt"
                  nameKey="baseAsset"
                  cx="50%"
                  cy="50%"
                  innerRadius={8}
                  outerRadius={13}
                  paddingAngle={2}
                  stroke="none"
                  isAnimationActive={false}
                >
                  {report.allocations.map((item) => (
                    <Cell key={`mini-${item.symbol}`} fill={item.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>

          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-left hover:opacity-90 transition-opacity"
          >
            <span className="text-xs font-bold font-mono tabular-nums text-white">
              <AnimatedNumber
                value={report.totalValue}
                format={(n) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
              />
            </span>
            <span
              className={`text-[11px] font-mono font-semibold tabular-nums ${
                isPositive ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {isPositive ? '+' : ''}
              {report.totalPnlPct.toFixed(1)}%
            </span>
            <span className="hidden xl:inline-flex items-center gap-1.5 text-[11px] font-mono text-slate-400">
              {report.allocations.slice(0, 3).map((item, idx) => (
                <span key={item.symbol}>
                  {idx > 0 && <span className="text-slate-600 mr-1.5">·</span>}
                  {item.baseAsset} {item.sharePct.toFixed(0)}%
                </span>
              ))}
            </span>
            <span className="text-slate-400 inline-flex items-center">
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </span>
          </button>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {rightActions}
        </div>
      </div>

      {/* Expandable Recharts Distribution Chart + Holdings Summary */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden border-t border-white/8 bg-[#0B0F17]/75"
          >
            <div className="p-4 grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
              <div className="md:col-span-4 h-[155px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={report.allocations}
                      dataKey="valueUsdt"
                      nameKey="baseAsset"
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={64}
                      paddingAngle={3}
                      stroke="none"
                    >
                      {report.allocations.map((entry) => (
                        <Cell key={`exp-${entry.symbol}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0E1420',
                        borderColor: 'rgba(255,255,255,0.12)',
                        borderRadius: '10px',
                        fontSize: '12px',
                        color: '#F1F5F9',
                      }}
                      formatter={(value) => [`$${Number(value ?? 0).toFixed(2)}`, 'Стоимость']}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="md:col-span-8 space-y-2.5">
                <div className="divide-y divide-white/8 text-xs font-mono tabular-nums">
                  {report.allocations.map((item) => (
                    <div key={item.symbol} className="py-1.5 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 font-sans">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: item.color }}
                        />
                        <span className="font-semibold text-white">{item.baseAsset}</span>
                        <span className="text-slate-500">·</span>
                        <span className="font-mono text-slate-400">{item.sharePct.toFixed(1)}%</span>
                      </div>

                      <div className="flex items-center gap-4">
                        <span className="text-slate-100">${item.valueUsdt.toFixed(2)}</span>
                        <span
                          className={`w-16 text-right font-semibold ${
                            item.pnlPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {item.pnlPct >= 0 ? '+' : ''}
                          {item.pnlPct.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/8 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setExpanded(false);
                      onManageInScreener();
                    }}
                    className="min-h-[32px] px-3 rounded-lg border border-emerald-500/35 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 font-medium inline-flex items-center gap-1 transition-colors"
                  >
                    <span>Редактировать состав</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={onClearPortfolio}
                    className="min-h-[32px] px-2.5 rounded-lg border border-rose-500/25 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 inline-flex items-center gap-1.5 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Очистить</span>
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
};
