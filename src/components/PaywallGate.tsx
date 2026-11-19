import React from 'react';
import { Crown, Lock, Sparkles } from 'lucide-react';
import { usePlan } from '../contexts/PlanContext';
import { triggerHaptic } from '../lib/securityDlp';

interface PaywallGateProps {
  requiredPlan: 'PRO' | 'MAX';
  title: string;
  description?: string;
  /** Дополнительное переопределение статуса доступа (если прокинут пропом) */
  unlocked?: boolean;
  onUpgrade?: () => void;
  compact?: boolean;
  children: React.ReactNode;
}

export const PaywallGate: React.FC<PaywallGateProps> = ({
  requiredPlan,
  title,
  description,
  unlocked,
  onUpgrade,
  compact = false,
  children,
}) => {
  const { isPro, isMax, openUpgradeModal } = usePlan();
  const hasAccess =
    typeof unlocked === 'boolean'
      ? unlocked
      : requiredPlan === 'MAX'
        ? isMax
        : isPro;

  if (hasAccess) {
    return <>{children}</>;
  }

  const isMaxGate = requiredPlan === 'MAX';
  const handleUpgrade = () => {
    triggerHaptic(10);
    if (onUpgrade) {
      onUpgrade();
    } else {
      openUpgradeModal(isMaxGate ? 'max' : 'pro');
    }
  };

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border ${
        isMaxGate ? 'border-cyan-500/30 bg-[var(--surface-1)]' : 'border-amber-500/30 bg-[var(--surface-1)]'
      }`}
    >
      {/* Интерактивное превью с мягким blur */}
      <div
        aria-hidden="true"
        className="pointer-events-none select-none blur-[3.5px] opacity-45 saturate-75"
      >
        {children}
      </div>

      {/* Аккуратный оверлей Paywall */}
      <div
        className={`absolute inset-0 z-10 flex flex-col items-center justify-center text-center bg-gradient-to-b from-[#071010]/70 via-[#071010]/82 to-[#071010]/92 backdrop-blur-[2px] ${
          compact ? 'p-3.5 gap-2' : 'p-5 gap-3'
        }`}
      >
        <div className="flex items-center gap-2">
          <span
            className={`w-8 h-8 rounded-xl flex items-center justify-center border ${
              isMaxGate
                ? 'border-cyan-400/40 bg-cyan-500/15 text-cyan-300'
                : 'border-amber-400/40 bg-amber-500/15 text-amber-300'
            }`}
          >
            <Lock className="w-4 h-4" />
          </span>
          <span
            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-mono font-bold ${
              isMaxGate
                ? 'bg-cyan-400/20 text-cyan-200 border border-cyan-400/45'
                : 'bg-amber-400/20 text-amber-200 border border-amber-400/45'
            }`}
          >
            {isMaxGate ? <Sparkles className="w-3 h-3" /> : <Crown className="w-3 h-3" />}
            <span>{requiredPlan}</span>
          </span>
        </div>

        <div className="max-w-sm space-y-1">
          <div className="text-sm font-semibold text-white">{title}</div>
          {description && (
            <p className="text-xs text-slate-300 leading-relaxed">{description}</p>
          )}
        </div>

        <button
          type="button"
          onClick={handleUpgrade}
          className={`min-h-[40px] px-4 rounded-xl text-xs font-bold text-slate-950 inline-flex items-center gap-1.5 shadow-lg transition-all hover:brightness-105 ${
            isMaxGate
              ? 'bg-gradient-to-r from-cyan-400 via-teal-300 to-emerald-400'
              : 'bg-gradient-to-r from-amber-400 via-emerald-400 to-teal-400'
          }`}
        >
          {isMaxGate ? <Sparkles className="w-3.5 h-3.5" /> : <Crown className="w-3.5 h-3.5" />}
          <span>Открыть в VERNIER {requiredPlan}</span>
        </button>
      </div>
    </div>
  );
};
