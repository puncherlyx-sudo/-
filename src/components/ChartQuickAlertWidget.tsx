import React, { useEffect, useState } from 'react';
import {
  Activity,
  BellPlus,
  BellRing,
  CheckCircle2,
  Crosshair,
  Pause,
  Play,
  Trash2,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { motion } from 'motion/react';
import type {
  MarketType,
  PriceAlertCondition,
  PriceAlertRecord,
} from '../types/domain';

interface ChartQuickAlertWidgetProps {
  symbol: string;
  marketType: MarketType;
  currentPrice: number;
  draftPrice: number | null;
  onDraftPriceChange: (price: number | null) => void;
  alerts: PriceAlertRecord[];
  isSignedIn: boolean;
  pushSubscribed: boolean;
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
  onCheckNow: () => Promise<{
    checkedAlerts: number;
    alertsSent: number;
    triggeredCount: number;
  }>;
}

function formatSmart(val: number): string {
  if (!Number.isFinite(val) || val <= 0) return '0.00';
  if (val >= 1000) return val.toFixed(2);
  if (val >= 10) return val.toFixed(3);
  if (val >= 1) return val.toFixed(4);
  return val.toFixed(5);
}

export const ChartQuickAlertWidget: React.FC<ChartQuickAlertWidgetProps> = ({
  symbol,
  marketType,
  currentPrice,
  draftPrice,
  onDraftPriceChange,
  alerts,
  isSignedIn,
  pushSubscribed,
  onRequireLogin,
  onOpenPushSettings,
  onCreateAlert,
  onToggleAlert,
  onDeleteAlert,
  onCheckNow,
}) => {
  const [priceInput, setPriceInput] = useState<string>('');
  const [condition, setCondition] = useState<PriceAlertCondition>('above');
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Sync draft price picked from chart click into the input & auto-infer direction
  useEffect(() => {
    if (draftPrice && Number.isFinite(draftPrice) && draftPrice > 0) {
      setPriceInput(formatSmart(draftPrice));
      if (currentPrice > 0) {
        setCondition(draftPrice >= currentPrice ? 'above' : 'below');
      }
      setError(null);
    }
  }, [draftPrice, currentPrice]);

  // Reset default suggestion when switching symbol
  useEffect(() => {
    if (currentPrice > 0 && draftPrice === null) {
      setPriceInput(formatSmart(currentPrice * 1.02));
      setCondition('above');
    }
  }, [symbol, marketType, currentPrice, draftPrice]);

  const pairAlerts = alerts.filter(
    (a) => a.symbol === symbol && a.marketType === marketType
  );
  const activePairCount = pairAlerts.filter((a) => a.active).length;

  const handleInputChange = (val: string) => {
    setPriceInput(val);
    const num = Number(val.replace(',', '.'));
    if (Number.isFinite(num) && num > 0) {
      onDraftPriceChange(num);
      if (currentPrice > 0) {
        setCondition(num >= currentPrice ? 'above' : 'below');
      }
    } else {
      onDraftPriceChange(null);
    }
  };

  const applyPctPreset = (pct: number) => {
    if (currentPrice <= 0) return;
    const nextPrice = currentPrice * (1 + pct / 100);
    setPriceInput(formatSmart(nextPrice));
    setCondition(pct >= 0 ? 'above' : 'below');
    onDraftPriceChange(nextPrice);
    setFeedback(null);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFeedback(null);

    if (!isSignedIn) {
      onRequireLogin();
      return;
    }

    const parsed = Number(priceInput.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('Укажите корректный ценовой уровень больше 0 или выберите его кликом по графику.');
      return;
    }

    setSubmitting(true);
    try {
      await onCreateAlert({
        symbol,
        marketType,
        condition,
        targetPrice: parsed,
      });
      setFeedback(
        `Уровень сохранён: ${symbol} ${condition === 'above' ? '≥' : '≤'} $${formatSmart(parsed)}.`
      );
      onDraftPriceChange(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось создать ценовой алерт.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCheck = async () => {
    if (!isSignedIn) {
      onRequireLogin();
      return;
    }
    setChecking(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await onCheckNow();
      setFeedback(
        res.triggeredCount > 0
          ? `Сработало уровней: ${res.triggeredCount} (отправлено Push: ${res.alertsSent}).`
          : `Проверено алертов: ${res.checkedAlerts} · Цели ещё не достигнуты.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка проверки уровней.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="mt-4 pt-4 border-t border-white/8 space-y-3">
      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <BellRing className="w-4 h-4 text-cyan-400 shrink-0" />
          <span className="font-semibold text-white">Быстрый Push-алерт с графика</span>
          <span className="text-slate-600" aria-hidden="true">
            ·
          </span>
          <span className="text-slate-400 inline-flex items-center gap-1">
            <Crosshair className="w-3.5 h-3.5 text-cyan-400" />
            <span>Нажмите на любую цену на графике</span>
          </span>
        </div>

        <div className="flex items-center gap-3 text-xs font-mono tabular-nums">
          <span className="text-slate-400">
            На графике: <strong className="text-cyan-300">{activePairCount}</strong>
          </span>
          {!pushSubscribed && isSignedIn && (
            <button
              type="button"
              onClick={onOpenPushSettings}
              className="font-sans text-amber-300 hover:text-amber-200 underline underline-offset-4 whitespace-nowrap"
            >
              Включить Push
            </button>
          )}
        </div>
      </div>

      {/* Quick Form */}
      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-2.5 items-center">
        {/* Condition Toggle */}
        <div className="lg:col-span-3 grid grid-cols-2 p-1 rounded-xl bg-[#0B0F17] border border-white/8">
          <button
            type="button"
            onClick={() => setCondition('above')}
            className={`min-h-[36px] px-2 rounded-lg text-xs font-medium inline-flex items-center justify-center gap-1 transition-colors whitespace-nowrap ${
              condition === 'above'
                ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/35'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5 shrink-0" />
            <span>Выше ≥</span>
          </button>
          <button
            type="button"
            onClick={() => setCondition('below')}
            className={`min-h-[36px] px-2 rounded-lg text-xs font-medium inline-flex items-center justify-center gap-1 transition-colors whitespace-nowrap ${
              condition === 'below'
                ? 'bg-rose-500/20 text-rose-200 border border-rose-500/35'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <TrendingDown className="w-3.5 h-3.5 shrink-0" />
            <span>Ниже ≤</span>
          </button>
        </div>

        {/* Target Price Input */}
        <div className="lg:col-span-3 relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-mono text-slate-500">$</span>
          <input
            type="number"
            step="any"
            min="0"
            aria-label={`Целевая цена уведомления для ${symbol}`}
            value={priceInput}
            onChange={(e) => handleInputChange(e.target.value)}
            placeholder="Цена цели..."
            className="w-full min-h-[42px] rounded-xl border border-white/10 bg-[#0B0F17] pl-7 pr-3 font-mono tabular-nums text-sm text-white focus:border-cyan-400 focus:outline-none"
          />
        </div>

        {/* Percentage Presets */}
        <div className="lg:col-span-3 flex flex-wrap items-center gap-1.5 font-mono tabular-nums text-[11px]">
          {[-3, -1, 1, 3].map((pct) => (
            <motion.button
              key={pct}
              type="button"
              whileTap={{ scale: 0.94 }}
              disabled={currentPrice <= 0}
              onClick={() => applyPctPreset(pct)}
              className={`flex-1 min-h-[38px] px-2 rounded-lg border border-white/10 bg-[#0B0F17] hover:bg-white/5 disabled:opacity-40 transition-colors whitespace-nowrap ${
                pct > 0 ? 'text-emerald-300' : 'text-rose-300'
              }`}
            >
              {pct > 0 ? `+${pct}%` : `${pct}%`}
            </motion.button>
          ))}
        </div>

        {/* Submit Button */}
        <div className="lg:col-span-3">
          <motion.button
            type="submit"
            whileTap={{ scale: 0.96 }}
            disabled={submitting}
            className="w-full min-h-[42px] px-4 rounded-xl bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 disabled:opacity-50 text-xs font-semibold text-white inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-all"
          >
            <BellPlus className="w-4 h-4 shrink-0" />
            <span>
              {!isSignedIn
                ? 'Войти для алерта'
                : submitting
                  ? 'Сохранение...'
                  : 'Поставить Push'}
            </span>
          </motion.button>
        </div>
      </form>

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

      {/* Active Alerts List for Active Pair */}
      {isSignedIn && pairAlerts.length > 0 && (
        <div className="rounded-xl bg-[#0B0F17]/80 border border-white/8 px-3.5 py-2.5 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <span className="text-slate-400">
              Алерты по {symbol} ({marketType === 'futures' ? 'Фьючерсы' : 'Спот'})
            </span>
            {activePairCount > 0 && (
              <button
                type="button"
                disabled={checking}
                onClick={() => void handleCheck()}
                className="inline-flex items-center gap-1 text-amber-300 hover:text-amber-200 font-medium disabled:opacity-50"
              >
                <Activity className={`w-3 h-3 ${checking ? 'animate-spin' : ''}`} />
                <span>{checking ? 'Проверка...' : 'Проверить уровни сейчас'}</span>
              </button>
            )}
          </div>

          <div className="divide-y divide-white/6">
            {pairAlerts.slice(0, 5).map((alert) => {
              const isTriggered = !alert.active && Boolean(alert.triggeredAt);
              return (
                <div
                  key={alert.id}
                  className="py-2 flex flex-wrap items-center justify-between gap-2 text-xs"
                >
                  <div className="flex flex-wrap items-center gap-2 font-mono tabular-nums">
                    <span
                      className={`font-semibold ${
                        alert.condition === 'above' ? 'text-cyan-300' : 'text-rose-400'
                      }`}
                    >
                      {alert.condition === 'above' ? '≥' : '≤'} ${formatSmart(alert.targetPrice)}
                    </span>
                    <span className="text-slate-600" aria-hidden="true">
                      ·
                    </span>
                    {alert.active ? (
                      <span className="font-sans text-[11px] text-emerald-400">Активен на графике</span>
                    ) : isTriggered ? (
                      <span className="font-sans text-[11px] text-amber-300 inline-flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Сработал (${formatSmart(alert.triggeredPrice)})</span>
                      </span>
                    ) : (
                      <span className="font-sans text-[11px] text-slate-500">На паузе</span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
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
                      aria-label={alert.active ? 'Приостановить алерт' : 'Включить алерт'}
                      className="min-h-[30px] px-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-[11px] text-slate-200 inline-flex items-center gap-1 transition-colors"
                    >
                      {alert.active ? (
                        <>
                          <Pause className="w-3 h-3 text-slate-400" />
                          <span>Пауза</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3 h-3 text-emerald-400" />
                          <span>{isTriggered ? 'Повторить' : 'Вкл.'}</span>
                        </>
                      )}
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
                      aria-label={`Удалить алерт ${alert.targetPrice}`}
                      className="min-h-[30px] min-w-[30px] rounded-lg border border-rose-500/25 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 flex items-center justify-center transition-colors"
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
    </div>
  );
};
