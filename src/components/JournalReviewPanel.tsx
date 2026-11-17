import React from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, CircleCheck, Info, OctagonAlert } from 'lucide-react';
import type { InsightTone, JournalReview } from '../lib/journalReview';

const TONE: Record<InsightTone, { box: string; icon: React.ReactNode; title: string }> = {
  good: {
    box: 'border-emerald-500/30 bg-emerald-500/10',
    icon: <CircleCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />,
    title: 'text-emerald-300',
  },
  warn: {
    box: 'border-amber-500/30 bg-amber-500/10',
    icon: <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />,
    title: 'text-amber-300',
  },
  bad: {
    box: 'border-rose-500/30 bg-rose-500/10',
    icon: <OctagonAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />,
    title: 'text-rose-300',
  },
  neutral: {
    box: 'border-white/10 bg-white/5',
    icon: <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />,
    title: 'text-slate-200',
  },
};

const fmtPct = (n: number | null, digits = 1): string =>
  n === null || !Number.isFinite(n) ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;

export const JournalReviewPanel: React.FC<{ review: JournalReview }> = ({ review }) => {
  const m = review.metrics;
  const tiles: Array<{ label: string; value: string; tone?: string }> = [
    { label: 'Винрейт', value: m.winRatePct === null ? '—' : `${Math.round(m.winRatePct)}%` },
    {
      label: 'Ожидание на сделку',
      value: fmtPct(m.expectancyPct, 2),
      tone: (m.expectancyPct ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400',
    },
    { label: 'Прибыль / убыток', value: m.payoffRatio === null ? '—' : m.payoffRatio.toFixed(2) },
    {
      label: 'Profit factor',
      value: m.profitFactor === null ? '—' : m.profitFactor === Infinity ? '∞' : m.profitFactor.toFixed(2),
    },
    { label: 'Макс. серия убытков', value: String(m.maxLossStreak) },
    { label: 'Без стопа', value: `${Math.round(review.stops.withoutStopPct)}%` },
  ];

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-4 sm:p-5 space-y-4"
      aria-label="Разбор дневника"
    >
      <div>
        <h3 className="text-base font-semibold text-white">Разбор дневника</h3>
        <p
          className={`mt-1 text-xs font-medium ${
            review.headline.tone === 'good'
              ? 'text-emerald-400'
              : review.headline.tone === 'bad'
                ? 'text-rose-400'
                : 'text-slate-400'
          }`}
        >
          {review.headline.text}
        </p>
      </div>

      {review.sample.closed > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-xl border border-white/8 bg-[#0B0F17] p-3">
              <div className="text-[10px] text-slate-500">{t.label}</div>
              <div className={`mt-0.5 text-base font-bold font-mono tabular-nums ${t.tone ?? 'text-white'}`}>{t.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {review.insights.map((i) => (
          <div key={i.title} className={`rounded-xl border p-3 flex gap-2.5 ${TONE[i.tone].box}`}>
            {TONE[i.tone].icon}
            <div>
              <div className={`text-xs font-semibold ${TONE[i.tone].title}`}>{i.title}</div>
              <p className="mt-0.5 text-xs text-slate-300 leading-relaxed">{i.text}</p>
            </div>
          </div>
        ))}
      </div>

      {(review.bySide.length > 0 || review.bySymbol.length > 0) && (
        <div className="grid sm:grid-cols-2 gap-3 text-xs">
          {review.bySide.length > 0 && (
            <div className="rounded-xl border border-white/8 bg-[#0B0F17] p-3 space-y-1.5">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">По направлениям</div>
              {review.bySide.map((s) => (
                <div key={s.side} className="flex items-center justify-between font-mono tabular-nums">
                  <span className={s.side === 'LONG' ? 'text-emerald-300' : 'text-rose-300'}>
                    {s.side === 'LONG' ? 'Лонг' : 'Шорт'} · {s.count}
                  </span>
                  <span className="text-slate-300">
                    {Math.round(s.winRatePct)}% · {fmtPct(s.avgPnlPct, 2)}
                  </span>
                </div>
              ))}
            </div>
          )}
          {review.bySymbol.length > 0 && (
            <div className="rounded-xl border border-white/8 bg-[#0B0F17] p-3 space-y-1.5">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">По парам (итог)</div>
              {review.bySymbol.slice(0, 5).map((s) => (
                <div key={s.symbol} className="flex items-center justify-between font-mono tabular-nums">
                  <span className="text-slate-300">
                    {s.symbol.replace('USDT', '')} · {s.count}
                  </span>
                  <span className={s.totalPnlPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{fmtPct(s.totalPnlPct)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-slate-500">
        Разбор считается по вашим записям, по явным правилам и без ИИ. Результат в % от цены входа, без плеча и комиссий. Это
        не инвестиционная рекомендация.
      </p>
    </motion.section>
  );
};
