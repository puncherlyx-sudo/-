import React from 'react';
import { Crown } from 'lucide-react';

interface UpgradeNudgeProps {
  title: string;
  text: string;
  ctaLabel?: string;
  onUpgrade: () => void;
}

/** Единый блок «функция упирается в лимит — вот что даёт PRO». Показывается, когда кредиты закончились или функция только для PRO. */
export const UpgradeNudge: React.FC<UpgradeNudgeProps> = ({ title, text, ctaLabel = 'Открыть PRO', onUpgrade }) => (
  <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
    <div className="flex items-start gap-2.5 text-amber-100 min-w-0">
      <Crown className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
      <div className="min-w-0">
        <div className="font-semibold text-amber-200">{title}</div>
        <p className="mt-0.5 text-amber-200/80 leading-relaxed">{text}</p>
      </div>
    </div>
    <button
      type="button"
      onClick={onUpgrade}
      className="cta-shimmer min-h-[40px] px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold whitespace-nowrap"
    >
      {ctaLabel}
    </button>
  </div>
);
