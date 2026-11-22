import React, { useEffect, useState } from 'react';
import {
  BellPlus,
  BellRing,
  CheckCircle2,
  Pause,
  Play,
  Trash2,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import type {
  MarketType,
  PriceAlertCondition,
  PriceAlertRecord,
} from '../types/domain';
import { NATIVE_PILL_SPRING, NATIVE_SPRING } from './MotionPrimitives';

export interface QuickAlertTargetAsset {
  symbol: string;
  baseAsset: string;
  name: string;
  price: number;
}

interface QuickAssetAlertModalProps {
  open: boolean;
  target: QuickAlertTargetAsset | null;
  marketType: MarketType;
  alerts: PriceAlertRecord[];
  isSignedIn: boolean;
  pushSubscribed: boolean;
  onClose: () => void;
  onRequireLogin: () => void;
  onOpenPushSettings: () => void;
  onCreateAlert: (params: {
    symbol: string;
    marketType: MarketType;
    condition: PriceAlertCondition;
    targetPrice: number;
  }) => Promise<void>;
  onToggleAlert: (alertId: string, nextActive: boolean) => Promise<void>;
  onDeleteAlert: (alertId: string) => Promise<void>;
}

function formatPriceValue(val: number): string {
  if (!Number.isFinite(val) || val <= 0) return '0.00';
  if (val >= 1000) return val.toFixed(2);
  if (val >= 10) return val.toFixed(3);
  if (val >= 1) return val.toFixed(4);
  return val.toFixed(5);
}

export const QuickAssetAlertModal: React.FC<QuickAssetAlertModalProps> = ({
  open,
  target,
  marketType,
  alerts,
  isSignedIn,
  pushSubscribed,
  onClose,
  onRequireLogin,
  onOpenPushSettings,
  onCreateAlert,
  onToggleAlert,
  onDeleteAlert,
}) => {
  const [condition, setCondition] = useState<PriceAlertCondition>('above');
  const [priceInput, setPriceInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !target) return;
    const basePrice = target.price > 0 ? target.price : 100;
    setCondition('above');
    setPriceInput(formatPriceValue(basePrice * 1.02));
    setFeedback(null);
    setError(null);
  }, [open, target?.symbol, target?.price]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const assetAlerts = target
    ? alerts.filter((a) => a.symbol === target.symbol && a.marketType === marketType)
    : [];

  const applyOffset = (pct: number) => {
    if (!target || target.price <= 0) return;
    const nextPrice = target.price * (1 + pct / 100);
    setPriceInput(formatPriceValue(nextPrice));
    setCondition(pct >= 0 ? 'above' : 'below');
    setError(null);
    setFeedback(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!target) return;
    setError(null);
    setFeedback(null);

    if (!isSignedIn) {
      onRequireLogin();
      return;
    }

    const parsed = Number(priceInput.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('Укажите корректную целевую цену больше 0.');
      return;
    }

    setSubmitting(true);
    try {
      await onCreateAlert({
        symbol: target.symbol,
        marketType,
        condition,
        targetPrice: parsed,
      });
      setFeedback(
        `Алерт установлен: ${target.baseAsset} ${condition === 'above' ? '≥' : '≤'} $${formatPriceValue(parsed)}.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось создать уведомление.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {open && target && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="quick-alert-modal-title"
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
          />

          {/* Native Mobile Bottom Sheet / Desktop Center Card */}
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 28, scale: 0.98 }}
            transition={NATIVE_SPRING}
            className="relative z-10 w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl border border-white/12 bg-[#111827] shadow-2xl p-5 pb-6 space-y-4 max-h-[88dvh] overflow-y-auto"
          >
            {/* Mobile Drag Handle */}
            <div className="sm:hidden w-10 h-1 rounded-full bg-slate-700 mx-auto -mt-1 mb-2" />

            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-cyan-500/15 border border-cyan-500/35 flex items-center justify-center shrink-0">
                  <BellRing className="w-4 h-4 text-cyan-300" />
                </div>
                <div className="min-w-0">
                  <h3 id="quick-alert-modal-title" className="text-sm font-bold text-white truncate">
                    Уведомить по {target.baseAsset} / USDT
                  </h3>
                  <div className="text-xs text-slate-400 flex items-center gap-1.5 font-mono tabular-nums">
                    <span className="font-sans">{target.name}</span>
                    <span aria-hidden="true">·</span>
                    <span className="text-slate-200">
                      {target.price > 0 ? `$${formatPriceValue(target.price)}` : 'Цена загружается'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-sans">{marketType === 'futures' ? 'Фьючерсы' : 'Спот'}</span>
                  </div>
                </div>
              </div>

              <motion.button
                type="button"
                whileTap={{ scale: 0.92 }}
                onClick={onClose}
                aria-label="Закрыть форму уведомления"
                className="min-h-[36px] min-w-[36px] rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white flex items-center justify-center shrink-0 transition-colors"
              >
                <X className="w-4 h-4" />
              </motion.button>
            </div>

            {!pushSubscribed && isSignedIn && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 flex items-center justify-between gap-2">
                <span>Push-канал ещё не активирован на этом устройстве.</span>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenPushSettings();
                  }}
                  className="text-amber-300 hover:text-white font-semibold whitespace-nowrap underline underline-offset-4"
                >
                  Включить →
                </button>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3.5">
              {/* Condition Switch */}
              <LayoutGroup id="quick-alert-condition-group">
                <div className="grid grid-cols-2 p-1 rounded-xl bg-[#0B0F17] border border-white/10">
                  <button
                    type="button"
                    onClick={() => setCondition('above')}
                    className={`relative min-h-[38px] rounded-lg text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors ${
                      condition === 'above' ? 'text-cyan-200' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {condition === 'above' && (
                      <motion.span
                        layoutId="quick-alert-cond-bg"
                        transition={NATIVE_PILL_SPRING}
                        className="absolute inset-0 rounded-lg bg-cyan-500/20 border border-cyan-500/35"
                      />
                    )}
                    <TrendingUp className="relative z-10 w-3.5 h-3.5" />
                    <span className="relative z-10">Выше или равно ≥</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCondition('below')}
                    className={`relative min-h-[38px] rounded-lg text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors ${
                      condition === 'below' ? 'text-rose-200' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {condition === 'below' && (
                      <motion.span
                        layoutId="quick-alert-cond-bg"
                        transition={NATIVE_PILL_SPRING}
                        className="absolute inset-0 rounded-lg bg-rose-500/20 border border-rose-500/35"
                      />
                    )}
                    <TrendingDown className="relative z-10 w-3.5 h-3.5" />
                    <span className="relative z-10">Ниже или равно ≤</span>
                  </button>
                </div>
              </LayoutGroup>

              {/* Price Input */}
              <div className="space-y-1.5">
                <label htmlFor="quick-alert-price" className="block text-xs text-slate-400">
                  Целевой уровень (USDT)
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-mono text-slate-500">
                    $
                  </span>
                  <input
                    id="quick-alert-price"
                    type="number"
                    step="any"
                    min="0"
                    autoFocus
                    value={priceInput}
                    onChange={(e) => {
                      const val = e.target.value;
                      setPriceInput(val);
                      const num = Number(val.replace(',', '.'));
                      if (Number.isFinite(num) && num > 0 && target.price > 0) {
                        setCondition(num >= target.price ? 'above' : 'below');
                      }
                    }}
                    className="w-full min-h-[44px] rounded-xl border border-white/12 bg-[#0B0F17] pl-8 pr-3 font-mono tabular-nums text-sm text-white focus:border-cyan-400 focus:outline-none"
                  />
                </div>
              </div>

              {/* Percentage Quick Chips */}
              <div className="grid grid-cols-4 gap-1.5 font-mono tabular-nums text-xs">
                {[-5, -2, 2, 5].map((pct) => (
                  <motion.button
                    key={pct}
                    type="button"
                    whileTap={{ scale: 0.94 }}
                    disabled={target.price <= 0}
                    onClick={() => applyOffset(pct)}
                    className={`min-h-[38px] rounded-xl border border-white/10 bg-[#0B0F17] hover:bg-white/5 disabled:opacity-40 transition-colors ${
                      pct > 0 ? 'text-emerald-300' : 'text-rose-300'
                    }`}
                  >
                    {pct > 0 ? `+${pct}%` : `${pct}%`}
                  </motion.button>
                ))}
              </div>

              {error && (
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                  {error}
                </div>
              )}
              {feedback && (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                  {feedback}
                </div>
              )}

              <motion.button
                type="submit"
                whileTap={{ scale: 0.97 }}
                disabled={submitting}
                className="w-full min-h-[44px] rounded-xl bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 disabled:opacity-50 text-xs font-semibold text-white inline-flex items-center justify-center gap-2 transition-all"
              >
                <BellPlus className="w-4 h-4" />
                <span>
                  {!isSignedIn
                    ? 'Войти, чтобы поставить алерт'
                    : submitting
                      ? 'Сохраняем уровень...'
                      : 'Поставить Push-уведомление'}
                </span>
              </motion.button>
            </form>

            {/* Existing Alerts for this Asset */}
            {isSignedIn && assetAlerts.length > 0 && (
              <div className="pt-3 border-t border-white/8 space-y-2">
                <div className="text-xs text-slate-400">
                  Активные и недавние уровни по {target.baseAsset} ({assetAlerts.length})
                </div>
                <div className="divide-y divide-white/6 max-h-40 overflow-y-auto">
                  {assetAlerts.map((alert) => {
                    const isTriggered = !alert.active && Boolean(alert.triggeredAt);
                    return (
                      <div
                        key={alert.id}
                        className="py-2 flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="flex items-center gap-2 font-mono tabular-nums min-w-0">
                          <span
                            className={`font-semibold ${
                              alert.condition === 'above' ? 'text-cyan-300' : 'text-rose-400'
                            }`}
                          >
                            {alert.condition === 'above' ? '≥' : '≤'} ${formatPriceValue(alert.targetPrice)}
                          </span>
                          <span className="text-slate-600" aria-hidden="true">·</span>
                          {alert.active ? (
                            <span className="font-sans text-[11px] text-emerald-400">Активен</span>
                          ) : isTriggered ? (
                            <span className="font-sans text-[11px] text-amber-300 inline-flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" />
                              <span>Сработал</span>
                            </span>
                          ) : (
                            <span className="font-sans text-[11px] text-slate-500">Пауза</span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            disabled={busyId === alert.id}
                            onClick={async () => {
                              setBusyId(alert.id);
                              try {
                                await onToggleAlert(alert.id, !alert.active);
                              } finally {
                                setBusyId(null);
                              }
                            }}
                            aria-label={alert.active ? 'Пауза' : 'Включить'}
                            className="min-h-[30px] px-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-[11px] text-slate-200 inline-flex items-center gap-1"
                          >
                            {alert.active ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3 text-emerald-400" />}
                          </button>
                          <button
                            type="button"
                            disabled={busyId === alert.id}
                            onClick={async () => {
                              setBusyId(alert.id);
                              try {
                                await onDeleteAlert(alert.id);
                              } finally {
                                setBusyId(null);
                              }
                            }}
                            aria-label="Удалить алерт"
                            className="min-h-[30px] min-w-[30px] rounded-lg border border-rose-500/25 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 flex items-center justify-center"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
