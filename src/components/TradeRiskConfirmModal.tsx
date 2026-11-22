import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, CheckSquare, ShieldAlert, ShieldCheck, Square, X } from 'lucide-react';
import { triggerHaptic } from '../lib/securityDlp';
import type { ExchangeId, MarketType } from '../types/domain';

interface NonCustodialRiskNoticeProps {
  /** Context-specific explanation of the indirect risk */
  text?: string;
  /** Compact inline notice vs fuller card banner */
  variant?: 'compact' | 'card';
  className?: string;
}

/**
 * Reusable Non-Custodial & Personal Financial Responsibility Notice.
 * Displayed across all features that directly or indirectly involve trading,
 * signals, order transfer, webhooks, calculators, simulations, or API keys.
 */
export const NonCustodialRiskNotice: React.FC<NonCustodialRiskNoticeProps> = ({
  text,
  variant = 'compact',
  className = '',
}) => {
  const defaultText =
    'VERNIER не принимает, не хранит и не оперирует вашими деньгами напрямую. Любые торговые решения, расчёты, сигналы и операции через API биржи выполняются исключительно по вашей инициативе под вашу полную финансовую ответственность, включая риск частичной или полной утраты средств.';

  if (variant === 'card') {
    return (
      <div
        className={`rounded-xl border border-amber-500/30 bg-amber-500/[0.07] p-3.5 flex items-start gap-2.5 text-xs text-slate-200 leading-relaxed ${className}`}
      >
        <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-semibold text-amber-200">
            Non-Custodial · Личная финансовая ответственность
          </div>
          <p className="text-[11px] text-slate-300 leading-relaxed">{text || defaultText}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-2.5 py-2 flex items-start gap-2 text-[11px] text-slate-300 leading-snug ${className}`}
    >
      <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
      <span>{text || defaultText}</span>
    </div>
  );
};

export interface PendingApiOrderConfirm {
  exchange: ExchangeId;
  keyLabel: string;
  testnet: boolean;
  symbol: string;
  marketType: MarketType;
  side: 'BUY' | 'SELL';
  orderType: 'MARKET' | 'LIMIT';
  quantity: number;
  limitPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
}

interface TradeRiskConfirmModalProps {
  pending: PendingApiOrderConfirm | null;
  onConfirm: () => void;
  onCancel: () => void;
}

const EXCHANGE_TITLES: Record<ExchangeId, string> = {
  binance: 'Binance',
  bybit: 'Bybit',
  okx: 'OKX',
};

/**
 * Mandatory per-launch Risk & Responsibility Confirmation Modal.
 * Triggered EVERY time a user launches a signal or sends an order via their Exchange API.
 * Checkboxes always reset on open so consent cannot be accidentally bypassed.
 */
export const TradeRiskConfirmModal: React.FC<TradeRiskConfirmModalProps> = ({
  pending,
  onConfirm,
  onCancel,
}) => {
  const [mounted, setMounted] = useState(false);
  const [confirmAction, setConfirmAction] = useState(false);
  const [confirmResponsibility, setConfirmResponsibility] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Reset checkboxes on EVERY launch so the user consciously confirms each time
  useEffect(() => {
    if (pending) {
      setConfirmAction(false);
      setConfirmResponsibility(false);
    }
  }, [pending]);

  useEffect(() => {
    if (!pending) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [pending, onCancel]);

  if (!mounted || typeof document === 'undefined') return null;

  const canProceed = confirmAction && confirmResponsibility;

  return createPortal(
    <AnimatePresence>
      {pending && (
        <div
          className="fixed inset-0 z-[10010] flex items-end sm:items-center justify-center p-3 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Подтверждение запуска сигнала через API биржи"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onCancel}
            className="fixed inset-0 bg-black/82 backdrop-blur-md"
            aria-hidden="true"
          />

          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            className="relative z-10 w-full max-w-lg max-h-[92dvh] overflow-y-auto rounded-2xl border border-amber-500/40 bg-[var(--surface-1)] p-4 sm:p-5 shadow-2xl shadow-black/80 space-y-4"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5 min-w-0">
                <div className="w-10 h-10 rounded-xl border border-amber-500/35 bg-amber-500/15 text-amber-300 flex items-center justify-center shrink-0">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm sm:text-base font-bold text-white leading-snug">
                    Подтвердите вход в позицию через API
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-400">
                    Проверьте параметры сделки перед отправкой на вашу биржу
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onCancel}
                aria-label="Отменить отправку ордера"
                className="min-h-[36px] min-w-[36px] rounded-lg text-slate-400 hover:text-white hover:bg-white/5 flex items-center justify-center shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Order Parameters Summary */}
            <div className="rounded-xl border border-white/10 bg-[var(--surface-0)] p-3.5 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-white">
                    {EXCHANGE_TITLES[pending.exchange]} · {pending.keyLabel}
                  </span>
                </div>
                <span
                  className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold border ${
                    pending.testnet
                      ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-200'
                      : 'border-rose-500/45 bg-rose-500/15 text-rose-200'
                  }`}
                >
                  {pending.testnet ? 'TESTNET / DEMO' : 'MAINNET · РЕАЛЬНЫЙ СЧЁТ'}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs font-mono tabular-nums">
                <div className="rounded-lg border border-white/8 bg-[var(--surface-1)] p-2">
                  <div className="font-sans text-[10px] text-slate-400">Пара / Рынок</div>
                  <div className="mt-0.5 font-semibold text-white">
                    {pending.symbol} · {pending.marketType === 'futures' ? 'Futures' : 'Spot'}
                  </div>
                </div>
                <div className="rounded-lg border border-white/8 bg-[var(--surface-1)] p-2">
                  <div className="font-sans text-[10px] text-slate-400">Направление</div>
                  <div
                    className={`mt-0.5 font-bold ${
                      pending.side === 'BUY' ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {pending.side === 'BUY' ? 'BUY / LONG' : 'SELL / SHORT'} ({pending.orderType})
                  </div>
                </div>
                <div className="rounded-lg border border-white/8 bg-[var(--surface-1)] p-2 col-span-2 sm:col-span-1">
                  <div className="font-sans text-[10px] text-slate-400">Объём</div>
                  <div className="mt-0.5 font-semibold text-cyan-200">{pending.quantity}</div>
                </div>
              </div>

              {(pending.limitPrice || pending.stopLoss || pending.takeProfit) && (
                <div className="flex flex-wrap gap-2 pt-1 text-[11px] font-mono tabular-nums text-slate-300">
                  {pending.limitPrice ? (
                    <span className="px-2 py-0.5 rounded bg-white/5 border border-white/10">
                      Limit: ${pending.limitPrice}
                    </span>
                  ) : null}
                  {pending.stopLoss ? (
                    <span className="px-2 py-0.5 rounded bg-rose-500/10 border border-rose-500/25 text-rose-300">
                      SL: ${pending.stopLoss}
                    </span>
                  ) : null}
                  {pending.takeProfit ? (
                    <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/25 text-emerald-300">
                      TP: ${pending.takeProfit}
                    </span>
                  ) : null}
                </div>
              )}
            </div>

            {/* Explicit Non-Custodial Warning */}
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/[0.08] p-3 text-xs text-rose-100 leading-relaxed space-y-1">
              <div className="font-semibold flex items-center gap-1.5 text-rose-200">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>Важное предупреждение о рисках (Non-Custodial)</span>
              </div>
              <p className="text-[11px] text-slate-200 leading-relaxed">
                VERNIER <strong>не принимает, не хранит и не оперирует вашими деньгами напрямую</strong>. Команда входа в позицию отправляется напрямую на ваш биржевой аккаунт через ваш API-ключ строго по вашему согласию. Торговля криптовалютами и фьючерсами несёт риск частичной или полной потери капитала.
              </p>
            </div>

            {/* Mandatory Per-Launch Checkboxes */}
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => {
                  triggerHaptic(8);
                  setConfirmAction((v) => !v);
                }}
                aria-pressed={confirmAction}
                className={`w-full p-3 rounded-xl border text-left text-xs flex items-start gap-2.5 transition-colors ${
                  confirmAction
                    ? 'border-emerald-500/45 bg-emerald-500/12 text-white'
                    : 'border-white/10 bg-[var(--surface-0)] text-slate-300 hover:border-white/20'
                }`}
              >
                {confirmAction ? (
                  <CheckSquare className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <Square className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                )}
                <span className="leading-relaxed">
                  <strong>Я уверен(а) в запуске этого сигнала/ордера</strong> и даю явное согласие на отправку команды входа в позицию через API на мою биржу.
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  triggerHaptic(8);
                  setConfirmResponsibility((v) => !v);
                }}
                aria-pressed={confirmResponsibility}
                className={`w-full p-3 rounded-xl border text-left text-xs flex items-start gap-2.5 transition-colors ${
                  confirmResponsibility
                    ? 'border-emerald-500/45 bg-emerald-500/12 text-white'
                    : 'border-white/10 bg-[var(--surface-0)] text-slate-300 hover:border-white/20'
                }`}
              >
                {confirmResponsibility ? (
                  <CheckSquare className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <Square className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                )}
                <span className="leading-relaxed space-y-1 block">
                  <span className="block">
                    <strong>Я подтверждаю, что самостоятельно несу полную ответственность за свои финансы</strong>, возможные убытки, проскальзывание, комиссии и риск ликвидации позиции.
                  </span>
                  <span className="block text-[11px] text-amber-200/90 font-medium">
                    I understand that Vernier is an analytical tool and I bear full responsibility for my financial decisions.
                  </span>
                </span>
              </button>
            </div>

            {/* Actions */}
            <div className="flex flex-col-reverse sm:flex-row gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  triggerHaptic(6);
                  onCancel();
                }}
                className="min-h-[44px] sm:w-36 rounded-xl border border-white/12 bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-300 transition-colors"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={!canProceed}
                onClick={() => {
                  if (!canProceed) return;
                  triggerHaptic(14);
                  onConfirm();
                }}
                className={`flex-1 min-h-[44px] px-4 rounded-xl text-xs sm:text-sm font-bold text-white inline-flex items-center justify-center gap-2 transition-all disabled:opacity-35 disabled:cursor-not-allowed ${
                  pending.side === 'BUY'
                    ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500'
                    : 'bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500'
                }`}
              >
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>Подтверждаю — отправить через API</span>
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
};

export interface PendingPaperFundsConfirm {
  title: string;
  actionLabel: string;
  summary: string;
  tone?: 'emerald' | 'rose' | 'amber';
}

interface PaperFundsConfirmModalProps {
  pending: PendingPaperFundsConfirm | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Mandatory "Confirm Responsibility" checkbox modal for paper funds / simulated balance actions.
 * Always resets checkbox on open so confirmation is explicit every time.
 */
export const PaperFundsConfirmModal: React.FC<PaperFundsConfirmModalProps> = ({
  pending,
  onConfirm,
  onCancel,
}) => {
  const [mounted, setMounted] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (pending) setConfirmed(false);
  }, [pending]);

  useEffect(() => {
    if (!pending) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [pending, onCancel]);

  if (!mounted || typeof document === 'undefined') return null;

  const btnStyle =
    pending?.tone === 'rose'
      ? 'bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white'
      : pending?.tone === 'amber'
        ? 'bg-amber-400 hover:bg-amber-300 text-slate-950'
        : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white';

  return createPortal(
    <AnimatePresence>
      {pending && (
        <div
          className="fixed inset-0 z-[10010] flex items-end sm:items-center justify-center p-3 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Подтверждение ответственности"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onCancel}
            className="fixed inset-0 bg-black/82 backdrop-blur-md"
            aria-hidden="true"
          />

          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            className="relative z-10 w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-2xl border border-amber-500/40 bg-[var(--surface-1)] p-4 sm:p-5 shadow-2xl shadow-black/80 space-y-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-xl border border-amber-500/35 bg-amber-500/15 text-amber-300 flex items-center justify-center shrink-0">
                  <ShieldAlert className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm sm:text-base font-bold text-white leading-snug">
                    {pending.title}
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-400">
                    Confirm Responsibility · Подтверждение ответственности
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onCancel}
                aria-label="Отменить"
                className="min-h-[34px] min-w-[34px] rounded-lg text-slate-400 hover:text-white hover:bg-white/5 flex items-center justify-center shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="rounded-xl border border-white/10 bg-[var(--surface-0)] p-3 text-xs text-slate-200 leading-relaxed">
              {pending.summary}
            </div>

            <button
              type="button"
              onClick={() => {
                triggerHaptic(8);
                setConfirmed((v) => !v);
              }}
              aria-pressed={confirmed}
              className={`w-full p-3 rounded-xl border text-left text-xs flex items-start gap-2.5 transition-colors ${
                confirmed
                  ? 'border-emerald-500/45 bg-emerald-500/12 text-white'
                  : 'border-white/10 bg-[var(--surface-0)] text-slate-300 hover:border-white/20'
              }`}
            >
              {confirmed ? (
                <CheckSquare className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <Square className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
              )}
              <span className="leading-relaxed space-y-1 block">
                <span className="block font-semibold text-white">
                  I understand that Vernier is an analytical tool and I bear full responsibility for my financial decisions.
                </span>
                <span className="block text-[11px] text-slate-300">
                  Я понимаю, что это аналитический инструмент (без приёма и хранения средств клиентов), и самостоятельно несу полную ответственность за свои финансовые решения.
                </span>
              </span>
            </button>

            <div className="flex flex-col-reverse sm:flex-row gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="min-h-[42px] sm:w-32 rounded-xl border border-white/12 bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-300 transition-colors"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={!confirmed}
                onClick={() => {
                  if (!confirmed) return;
                  triggerHaptic(14);
                  onConfirm();
                }}
                className={`flex-1 min-h-[42px] px-4 rounded-xl text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 transition-all disabled:opacity-35 disabled:cursor-not-allowed ${btnStyle}`}
              >
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>{pending.actionLabel}</span>
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
};
