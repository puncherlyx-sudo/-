import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  BellRing,
  CheckCircle2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  TrendingDown,
  TrendingUp,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { motion } from 'motion/react';
import { PRO_MAX_ACTIVE_ALERTS, TRADING_PAIRS } from '../data/strategies';
import { maxActiveAlertsFor } from '../lib/alertLimits';
import { UpgradeNudge } from './UpgradeNudge';
import { isAlertSoundEnabled, playAlertChime, setAlertSoundEnabled } from '../lib/alertSound';
import type {
  MarketType,
  PriceAlertCondition,
  PriceAlertRecord,
  TickerOverview,
} from '../types/domain';

interface PriceAlertsPanelProps {
  isPro?: boolean;
  onUpgradePro?: () => void;
  alerts: PriceAlertRecord[];
  pushSubscribed: boolean;
  onJumpToPushSettings: () => void;
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

function formatPriceSmart(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0.00';
  if (value >= 1000) return value.toFixed(2);
  if (value >= 10) return value.toFixed(3);
  if (value >= 1) return value.toFixed(4);
  return value.toFixed(5);
}

function formatTriggerTime(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const PriceAlertsPanel: React.FC<PriceAlertsPanelProps> = ({
  isPro = false,
  onUpgradePro,
  alerts,
  pushSubscribed,
  onJumpToPushSettings,
  onCreateAlert,
  onToggleAlert,
  onDeleteAlert,
  onCheckNow,
}) => {
  const [soundOn, setSoundOn] = useState<boolean>(() => isAlertSoundEnabled());
  const [symbol, setSymbol] = useState<string>('BTCUSDT');
  const [marketType, setMarketType] = useState<MarketType>('spot');
  const [condition, setCondition] = useState<PriceAlertCondition>('above');
  const [targetPriceInput, setTargetPriceInput] = useState<string>('98000');

  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const [loadingPrices, setLoadingPrices] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadMarketPrices = useCallback(async (targetMarket: MarketType, autoFillSymbol?: string) => {
    setLoadingPrices(true);
    try {
      const res = await fetch(`/api/market/overview?marketType=${targetMarket}`);
      if (!res.ok) return;
      const data = (await res.json()) as { tickers?: TickerOverview[] };
      if (!data.tickers) return;
      const map: Record<string, number> = {};
      for (const t of data.tickers) {
        map[t.symbol] = t.price;
      }
      setLivePrices(map);
      if (autoFillSymbol && map[autoFillSymbol] > 0) {
        const suggested = map[autoFillSymbol] * 1.03;
        setTargetPriceInput(formatPriceSmart(suggested));
      }
    } catch {
      // Non-blocking live price reference
    } finally {
      setLoadingPrices(false);
    }
  }, []);

  useEffect(() => {
    void loadMarketPrices(marketType, symbol);
  }, [marketType]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentPrice = livePrices[symbol] ?? 0;

  const handleSymbolChange = (nextSymbol: string) => {
    setSymbol(nextSymbol);
    const p = livePrices[nextSymbol];
    if (p && p > 0) {
      const factor = condition === 'above' ? 1.03 : 0.97;
      setTargetPriceInput(formatPriceSmart(p * factor));
    }
  };

  const applyPercentOffset = (pct: number) => {
    if (!currentPrice || currentPrice <= 0) return;
    const nextCond: PriceAlertCondition = pct >= 0 ? 'above' : 'below';
    setCondition(nextCond);
    setTargetPriceInput(formatPriceSmart(currentPrice * (1 + pct / 100)));
  };

  const activeCount = alerts.filter((a) => a.active).length;
  const maxActive = maxActiveAlertsFor(isPro);
  const atLimit = activeCount >= maxActive;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFeedback(null);
    const parsed = Number(targetPriceInput.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('Укажите корректную целевую цену больше 0.');
      return;
    }
    if (activeCount >= maxActive) {
      setError(
        isPro
          ? `Достигнут лимит ${maxActive} активных алертов. Удалите ненужные.`
          : `На бесплатном тарифе можно держать до ${maxActive} активных алертов. PRO даёт до ${PRO_MAX_ACTIVE_ALERTS}.`
      );
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
        `Алерт создан: ${symbol} ${condition === 'above' ? '≥' : '≤'} $${parsed.toLocaleString('ru-RU')}.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить ценовой алерт.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCheckNow = async () => {
    setChecking(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await onCheckNow();
      setFeedback(
        res.triggeredCount > 0
          ? `Сработало ценовых алертов: ${res.triggeredCount} (отправлено Push: ${res.alertsSent}).`
          : `Проверено активных алертов: ${res.checkedAlerts} · Пороги ещё не достигнуты.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка проверки ценовых порогов.');
    } finally {
      setChecking(false);
    }
  };

  const handleToggle = async (alert: PriceAlertRecord) => {
    if (!alert.active && activeCount >= maxActive) {
      setError(
        isPro
          ? `Достигнут лимит ${maxActive} активных алертов.`
          : `На бесплатном тарифе можно держать до ${maxActive} активных алертов. PRO даёт до ${PRO_MAX_ACTIVE_ALERTS}.`
      );
      return;
    }
    setBusyId(alert.id);
    setError(null);
    try {
      await onToggleAlert(alert.id, !alert.active);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось изменить статус алерта.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (alertId: string) => {
    setBusyId(alertId);
    setError(null);
    try {
      await onDeleteAlert(alertId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось удалить алерт.');
    } finally {
      setBusyId(null);
    }
  };

  const triggeredCount = alerts.filter((a) => !a.active && Boolean(a.triggeredAt)).length;

  return (
    <motion.section
      id="sec-price-alerts-panel"
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.1 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      aria-labelledby="price-alerts-heading"
      className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-6 space-y-4"
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="price-alerts-heading" className="text-base font-semibold text-white flex items-center gap-2">
            <BellRing className="w-4 h-4 text-amber-400 shrink-0" />
            <span>Ценовые алерты (Push)</span>
          </h3>
          <p className="mt-1 text-xs text-slate-400 leading-relaxed">
            Задайте пороговую цену для любой пары — сервер отправит Push-уведомление при пересечении уровня даже при закрытом терминале.
          </p>
        </div>

        <div className="text-xs font-mono tabular-nums text-slate-400 shrink-0 flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={soundOn}
            aria-label={soundOn ? 'Выключить звук алертов' : 'Включить звук алертов'}
            title={soundOn ? 'Звук алертов включён' : 'Звук алертов выключен'}
            onClick={() => {
              const next = !soundOn;
              setSoundOn(next);
              setAlertSoundEnabled(next);
              if (next) playAlertChime(true);
            }}
            className={`min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg border transition-colors ${
              soundOn
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                : 'border-white/10 bg-white/5 text-slate-500'
            }`}
          >
            {soundOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
          <span>
          Активных: <span className={atLimit ? 'text-amber-300 font-semibold' : 'text-emerald-400 font-semibold'}>{activeCount}/{maxActive}</span>
          <span aria-hidden="true" className="mx-1.5 text-slate-600">
            ·
          </span>
          Сработало: <span className="text-amber-300 font-semibold">{triggeredCount}</span>
          </span>
        </div>
      </div>

      {atLimit && !isPro && (
        <UpgradeNudge
          title={`Лимит бесплатного тарифа: ${maxActive} активных алерта`}
          text={`PRO позволяет держать до ${PRO_MAX_ACTIVE_ALERTS} алертов одновременно. Сервер отслеживает только активные алерты в пределах лимита.`}
          onUpgrade={() => onUpgradePro?.()}
        />
      )}

      {!pushSubscribed && (
        <div className="pt-3 border-t border-white/8 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-200">
          <span>Для фоновой доставки ценовых алертов включите Push-уведомления на этом устройстве.</span>
          <button
            type="button"
            onClick={onJumpToPushSettings}
            className="text-amber-300 hover:text-amber-200 font-semibold whitespace-nowrap shrink-0 underline underline-offset-4"
          >
            Перейти к Push-каналу
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
          {error}
        </div>
      )}

      {feedback && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200">
          {feedback}
        </div>
      )}

      {/* Creation Form */}
      <form onSubmit={handleSubmit} className="pt-3 border-t border-white/8 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="pa-symbol" className="block text-xs text-slate-400 mb-1.5">
              Торговая пара
            </label>
            <select
              id="pa-symbol"
              value={symbol}
              onChange={(e) => handleSymbolChange(e.target.value)}
              className="w-full min-h-[42px] rounded-xl border border-white/10 bg-[#0B0F17] px-3 text-xs sm:text-sm font-mono text-white focus:border-emerald-500 focus:outline-none"
            >
              {TRADING_PAIRS.map((p) => (
                <option key={p.symbol} value={p.symbol}>
                  {p.label} — {p.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <span className="block text-xs text-slate-400 mb-1.5">Рынок</span>
            <div className="grid grid-cols-2 p-1 rounded-xl bg-[#0B0F17] border border-white/8">
              {(['spot', 'futures'] as const).map((m) => {
                const isActive = marketType === m;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMarketType(m)}
                    className={`min-h-[34px] rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                      isActive ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {m === 'spot' ? 'Спот' : 'Фьючерсы'}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <span className="block text-xs text-slate-400 mb-1.5">Условие срабатывания</span>
            <div className="grid grid-cols-2 p-1 rounded-xl bg-[#0B0F17] border border-white/8">
              <button
                type="button"
                onClick={() => setCondition('above')}
                className={`min-h-[36px] px-2 rounded-lg text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap ${
                  condition === 'above' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                <TrendingUp className="w-3.5 h-3.5 shrink-0" />
                <span>Выше ≥</span>
              </button>
              <button
                type="button"
                onClick={() => setCondition('below')}
                className={`min-h-[36px] px-2 rounded-lg text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap ${
                  condition === 'below' ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                <TrendingDown className="w-3.5 h-3.5 shrink-0" />
                <span>Ниже ≤</span>
              </button>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <label htmlFor="pa-target-price" className="text-slate-400">
                Пороговая цена ($)
              </label>
              <button
                type="button"
                onClick={() => void loadMarketPrices(marketType)}
                className="inline-flex items-center gap-1 text-[11px] font-mono tabular-nums text-slate-400 hover:text-emerald-300"
              >
                <RefreshCw className={`w-3 h-3 ${loadingPrices ? 'animate-spin' : ''}`} />
                <span>
                  {currentPrice > 0 ? `$${formatPriceSmart(currentPrice)}` : 'Обновить'}
                </span>
              </button>
            </div>
            <input
              id="pa-target-price"
              type="number"
              min={0}
              step="any"
              value={targetPriceInput}
              onChange={(e) => setTargetPriceInput(e.target.value)}
              placeholder="Например, 98000"
              className="w-full min-h-[42px] rounded-xl border border-white/10 bg-[#0B0F17] px-3 font-mono tabular-nums text-sm text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Quick Offset Presets & Submit */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono tabular-nums">
            <span className="font-sans text-slate-500 mr-1">От текущей:</span>
            {[-5, -2, 2, 5].map((pct) => (
              <button
                key={pct}
                type="button"
                disabled={currentPrice <= 0}
                onClick={() => applyPercentOffset(pct)}
                className={`min-h-[30px] px-2 rounded-lg border border-white/10 bg-[#0B0F17] hover:bg-white/5 disabled:opacity-40 transition-colors ${
                  pct > 0 ? 'text-emerald-300' : 'text-rose-300'
                }`}
              >
                {pct > 0 ? `+${pct}%` : `${pct}%`}
              </button>
            ))}
          </div>

          <motion.button
            type="submit"
            whileTap={{ scale: 0.96 }}
            disabled={submitting}
            className="min-h-[42px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-semibold text-white inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span>{submitting ? 'Сохранение...' : 'Добавить алерт'}</span>
          </motion.button>
        </div>
      </form>

      {/* Configured Price Alerts List */}
      <div className="pt-3 border-t border-white/8">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <span className="text-xs font-medium text-slate-300">Настроенные уровни</span>
          {activeCount > 0 && (
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              disabled={checking}
              onClick={() => void handleCheckNow()}
              className="min-h-[34px] px-3 rounded-lg border border-amber-500/35 bg-amber-500/10 hover:bg-amber-500/20 disabled:opacity-50 text-xs font-medium text-amber-300 inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
            >
              <Activity className="w-3.5 h-3.5" />
              <span>{checking ? 'Проверка...' : 'Проверить пороги сейчас'}</span>
            </motion.button>
          )}
        </div>

        {alerts.length === 0 ? (
          <p className="py-4 text-xs text-slate-400">
            У вас пока нет ценовых алертов. Добавьте целевую цену выше, чтобы получать Push при пробое или откате уровня.
          </p>
        ) : (
          <div className="divide-y divide-white/8">
            {alerts.map((alert) => {
              const isTriggered = !alert.active && Boolean(alert.triggeredAt);
              const marketLabel = alert.marketType === 'futures' ? 'Фьючерсы' : 'Спот';
              const condSymbol = alert.condition === 'above' ? '≥' : '≤';
              return (
                <div
                  key={alert.id}
                  className="py-3 flex flex-wrap items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 font-medium text-white">
                      <span className="font-mono">{alert.symbol}</span>
                      <span aria-hidden="true" className="text-slate-600">
                        ·
                      </span>
                      <span className="text-slate-400 font-normal">{marketLabel}</span>
                      <span aria-hidden="true" className="text-slate-600">
                        ·
                      </span>
                      <span
                        className={`font-mono tabular-nums font-semibold ${
                          alert.condition === 'above' ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {condSymbol} ${formatPriceSmart(alert.targetPrice)}
                      </span>
                    </div>

                    <div className="mt-1 text-[11px] font-mono tabular-nums">
                      {alert.active ? (
                        <span className="text-emerald-400">Мониторинг активен</span>
                      ) : isTriggered ? (
                        <span className="text-amber-300 inline-flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            Сработал по ${formatPriceSmart(alert.triggeredPrice)} ({formatTriggerTime(alert.triggeredAt)})
                          </span>
                        </span>
                      ) : (
                        <span className="text-slate-500">Приостановлен</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      disabled={busyId === alert.id}
                      onClick={() => void handleToggle(alert)}
                      title={alert.active ? 'Приостановить алерт' : 'Активировать повторно'}
                      className="min-h-[36px] px-2.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-xs text-slate-200 inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
                    >
                      {alert.active ? (
                        <>
                          <Pause className="w-3.5 h-3.5 text-slate-400" />
                          <span>Пауза</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5 text-emerald-400" />
                          <span>{isTriggered ? 'Повторить' : 'Включить'}</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      disabled={busyId === alert.id}
                      onClick={() => void handleDelete(alert.id)}
                      aria-label={`Удалить алерт ${alert.symbol}`}
                      className="min-h-[36px] min-w-[36px] rounded-lg border border-rose-500/25 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 flex items-center justify-center transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </motion.section>
  );
};
