import React, { useEffect, useState } from 'react';
import {
  Activity,
  BellPlus,
  BellRing,
  CheckCircle2,
  Crosshair,
  History,
  Pause,
  Play,
  Sliders,
  Trash2,
  TrendingDown,
  TrendingUp,
  Webhook,
} from 'lucide-react';
import { motion } from 'motion/react';
import { usePlan } from '../contexts/PlanContext';
import {
  appendSmartAlertHistory,
  readSmartAlertHistory,
  readSmartAlerts,
  SMART_CONDITION_META,
  writeSmartAlerts,
  type SmartAlertConditionType,
  type SmartAlertHistoryEntry,
  type SmartAlertRule,
} from '../lib/proMaxStore';
import { triggerHaptic } from '../lib/securityDlp';
import type {
  MarketType,
  PriceAlertCondition,
  PriceAlertRecord,
} from '../types/domain';
import { PaywallGate } from './PaywallGate';
import { WebhookBuilderModal } from './WebhookBuilderModal';

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
  onOpenPushSettings,
  onCreateAlert,
  onToggleAlert,
  onDeleteAlert,
  onCheckNow,
}) => {
  const { isPro } = usePlan();
  const [alertTab, setAlertTab] = useState<'price' | 'smart' | 'history'>('price');
  const [priceInput, setPriceInput] = useState<string>('');
  const [condition, setCondition] = useState<PriceAlertCondition>('above');
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // PRO #1: Smart Indicator Alerts + History
  const [smartCondition, setSmartCondition] = useState<SmartAlertConditionType>('rsi_below_30');
  const [smartTf, setSmartTf] = useState<'15m' | '1h' | '4h'>('1h');
  const [smartRules, setSmartRules] = useState<SmartAlertRule[]>(() => readSmartAlerts());
  const [historyList, setHistoryList] = useState<SmartAlertHistoryEntry[]>(() => readSmartAlertHistory());
  const [webhookOpen, setWebhookOpen] = useState(false);

  useEffect(() => {
    if (draftPrice && Number.isFinite(draftPrice) && draftPrice > 0) {
      setPriceInput(formatSmart(draftPrice));
      if (currentPrice > 0) {
        setCondition(draftPrice >= currentPrice ? 'above' : 'below');
      }
      setError(null);
    }
  }, [draftPrice, currentPrice]);

  useEffect(() => {
    if (currentPrice > 0 && draftPrice === null) {
      setPriceInput(formatSmart(currentPrice * 1.02));
      setCondition('above');
    }
  }, [symbol, marketType, currentPrice, draftPrice]);

  const pairAlerts = alerts.filter((a) => a.symbol === symbol && a.marketType === marketType);
  const activePairCount = pairAlerts.filter((a) => a.active).length;
  const pairSmartRules = smartRules.filter((r) => r.symbol === symbol);

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

  const handleCreateSmartRule = () => {
    triggerHaptic(10);
    const meta = SMART_CONDITION_META[smartCondition];
    const nextRule: SmartAlertRule = {
      id: `smart-${Date.now()}`,
      symbol,
      timeframe: smartTf,
      conditionType: smartCondition,
      thresholdLabel: meta.defaultThreshold,
      active: true,
      createdAt: new Date().toISOString(),
    };
    const nextList = [nextRule, ...smartRules];
    setSmartRules(nextList);
    writeSmartAlerts(nextList);
    setFeedback(`Smart-алерт PRO добавлен: ${symbol} · ${meta.shortLabel} (${smartTf}).`);
  };

  const handleSimulateSmartTrigger = (rule: SmartAlertRule) => {
    triggerHaptic(10);
    const meta = SMART_CONDITION_META[rule.conditionType];
    appendSmartAlertHistory({
      symbol: rule.symbol,
      title: `${meta.label} (${rule.timeframe})`,
      price: currentPrice > 0 ? currentPrice : 94000,
      triggeredAt: new Date().toISOString(),
      kind: 'indicator',
    });
    setHistoryList(readSmartAlertHistory());
    setFeedback(`Срабатывание записано в историю: ${rule.symbol} · ${meta.shortLabel}.`);
  };

  const handleDeleteSmartRule = (id: string) => {
    const next = smartRules.filter((r) => r.id !== id);
    setSmartRules(next);
    writeSmartAlerts(next);
  };

  const handleCheck = async () => {
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
      {/* Шапка + вкладки Ценовой / Smart PRO / История + Webhook MAX */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <BellRing className="w-4 h-4 text-cyan-400 shrink-0" />
          <span className="font-semibold text-white">Алерты графика</span>
          <span className="text-slate-400 hidden sm:inline-flex items-center gap-1">
            <Crosshair className="w-3.5 h-3.5 text-cyan-400" />
            <span>Клик по графику подставит цену</span>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <div className="inline-flex p-0.5 rounded-lg bg-[var(--surface-0)] border border-white/10 text-[11px]">
            <button
              type="button"
              onClick={() => setAlertTab('price')}
              className={`min-h-[30px] px-2.5 rounded-md font-semibold transition-colors ${
                alertTab === 'price' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Ценовой ({activePairCount})
            </button>
            <button
              type="button"
              onClick={() => setAlertTab('smart')}
              className={`min-h-[30px] px-2.5 rounded-md font-semibold inline-flex items-center gap-1 transition-colors ${
                alertTab === 'smart' ? 'bg-amber-400 text-slate-950' : 'text-amber-300 hover:text-amber-200'
              }`}
            >
              <Sliders className="w-3 h-3" />
              <span>Smart PRO</span>
            </button>
            <button
              type="button"
              onClick={() => setAlertTab('history')}
              className={`min-h-[30px] px-2.5 rounded-md font-semibold inline-flex items-center gap-1 transition-colors ${
                alertTab === 'history' ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              <History className="w-3 h-3" />
              <span>История</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              triggerHaptic(8);
              setWebhookOpen(true);
            }}
            className="min-h-[32px] px-2.5 rounded-lg border border-cyan-500/35 bg-cyan-500/12 hover:bg-cyan-500/20 text-[11px] font-semibold text-cyan-200 inline-flex items-center gap-1"
          >
            <Webhook className="w-3 h-3" />
            <span>Webhook / TG</span>
          </button>
        </div>
      </div>

      {alertTab === 'price' && (
        <>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-2.5 items-center">
            <div className="lg:col-span-3 grid grid-cols-2 p-1 rounded-xl bg-[var(--surface-0)] border border-white/8">
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
                className="w-full min-h-[42px] rounded-xl border border-white/10 bg-[var(--surface-0)] pl-7 pr-3 font-mono tabular-nums text-sm text-white focus:border-cyan-400 focus:outline-none"
              />
            </div>

            <div className="lg:col-span-3 flex flex-wrap items-center gap-1.5 font-mono tabular-nums text-[11px]">
              {[-3, -1, 1, 3].map((pct) => (
                <motion.button
                  key={pct}
                  type="button"
                  whileTap={{ scale: 0.94 }}
                  disabled={currentPrice <= 0}
                  onClick={() => applyPctPreset(pct)}
                  className={`flex-1 min-h-[38px] px-2 rounded-lg border border-white/10 bg-[var(--surface-0)] hover:bg-white/5 disabled:opacity-40 transition-colors whitespace-nowrap ${
                    pct > 0 ? 'text-emerald-300' : 'text-rose-300'
                  }`}
                >
                  {pct > 0 ? `+${pct}%` : `${pct}%`}
                </motion.button>
              ))}
            </div>

            <div className="lg:col-span-3">
              <motion.button
                type="submit"
                whileTap={{ scale: 0.96 }}
                disabled={submitting}
                className="w-full min-h-[42px] px-4 rounded-xl bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 disabled:opacity-50 text-xs font-semibold text-white inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-all"
              >
                <BellPlus className="w-4 h-4 shrink-0" />
                <span>{submitting ? 'Сохранение...' : 'Поставить алерт'}</span>
              </motion.button>
            </div>
          </form>

          {pairAlerts.length > 0 && (
            <div className="rounded-xl bg-[var(--surface-0)] border border-white/8 px-3.5 py-2.5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <span className="text-slate-400">
                  Ценовые уровни по {symbol} ({marketType === 'futures' ? 'Фьючерсы' : 'Спот'})
                </span>
                <div className="flex items-center gap-3">
                  {!pushSubscribed && isSignedIn && (
                    <button
                      type="button"
                      onClick={onOpenPushSettings}
                      className="text-amber-300 hover:text-amber-200 underline underline-offset-4"
                    >
                      Включить Push
                    </button>
                  )}
                  {activePairCount > 0 && (
                    <button
                      type="button"
                      disabled={checking}
                      onClick={() => void handleCheck()}
                      className="inline-flex items-center gap-1 text-emerald-300 hover:text-emerald-200 font-medium disabled:opacity-50"
                    >
                      <Activity className={`w-3 h-3 ${checking ? 'animate-spin' : ''}`} />
                      <span>{checking ? 'Проверка...' : 'Проверить'}</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="divide-y divide-white/6">
                {pairAlerts.slice(0, 5).map((alert) => {
                  const isTriggered = !alert.active && Boolean(alert.triggeredAt);
                  return (
                    <div key={alert.id} className="py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2 font-mono tabular-nums">
                        <span className={`font-semibold ${alert.condition === 'above' ? 'text-cyan-300' : 'text-rose-400'}`}>
                          {alert.condition === 'above' ? '≥' : '≤'} ${formatSmart(alert.targetPrice)}
                        </span>
                        {alert.active ? (
                          <span className="font-sans text-[11px] text-emerald-400">Активен</span>
                        ) : isTriggered ? (
                          <span className="font-sans text-[11px] text-amber-300 inline-flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Сработал</span>
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
                          className="min-h-[30px] px-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-[11px] text-slate-200 inline-flex items-center gap-1"
                        >
                          {alert.active ? <Pause className="w-3 h-3 text-slate-400" /> : <Play className="w-3 h-3 text-emerald-400" />}
                          <span>{alert.active ? 'Пауза' : 'Вкл.'}</span>
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
        </>
      )}

      {/* PRO #1: Конструктор условий по индикаторам */}
      {alertTab === 'smart' && (
        <PaywallGate
          requiredPlan="PRO"
          unlocked={isPro}
          compact
          title="Smart Alerts по индикаторам"
          description="Создавайте алерты по RSI > 70 / < 30, пересечению EMA50/200, всплеску объёма > 2x, Bollinger Squeeze и Funding Rate."
        >
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 text-xs">
              <select
                value={smartCondition}
                onChange={(e) => setSmartCondition(e.target.value as SmartAlertConditionType)}
                className="sm:col-span-6 min-h-[40px] rounded-xl border border-white/10 bg-[var(--surface-0)] px-3 text-white"
              >
                {(Object.keys(SMART_CONDITION_META) as SmartAlertConditionType[]).map((key) => (
                  <option key={key} value={key}>
                    {SMART_CONDITION_META[key].label}
                  </option>
                ))}
              </select>

              <select
                value={smartTf}
                onChange={(e) => setSmartTf(e.target.value as '15m' | '1h' | '4h')}
                className="sm:col-span-2 min-h-[40px] rounded-xl border border-white/10 bg-[var(--surface-0)] px-2.5 font-mono text-white"
              >
                <option value="15m">15m</option>
                <option value="1h">1H</option>
                <option value="4h">4H</option>
              </select>

              <button
                type="button"
                onClick={handleCreateSmartRule}
                className="sm:col-span-4 min-h-[40px] rounded-xl bg-gradient-to-r from-amber-400 to-emerald-400 text-slate-950 font-bold inline-flex items-center justify-center gap-1.5"
              >
                <BellPlus className="w-4 h-4" />
                <span>Добавить Smart-алерт</span>
              </button>
            </div>

            {pairSmartRules.length > 0 && (
              <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] divide-y divide-white/6 text-xs">
                {pairSmartRules.map((rule) => (
                  <div key={rule.id} className="px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-semibold text-amber-200">
                        {SMART_CONDITION_META[rule.conditionType].shortLabel}
                      </span>{' '}
                      <span className="font-mono text-[11px] text-slate-400">
                        · {rule.timeframe} · {rule.thresholdLabel}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleSimulateSmartTrigger(rule)}
                        className="min-h-[28px] px-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-[11px] text-emerald-300"
                      >
                        Тест сработки
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteSmartRule(rule.id)}
                        aria-label="Удалить Smart-алерт"
                        className="min-h-[28px] min-w-[28px] rounded-lg border border-rose-500/25 bg-rose-500/10 text-rose-300 flex items-center justify-center"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </PaywallGate>
      )}

      {/* PRO #1: Вкладка «История срабатываний» */}
      {alertTab === 'history' && (
        <PaywallGate
          requiredPlan="PRO"
          unlocked={isPro}
          compact
          title="История срабатываний алертов"
          description="Полный журнал всех сработавших ценовых и индикаторных алертов с точным временем и ценой."
        >
          <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] divide-y divide-white/6 text-xs max-h-[220px] overflow-y-auto">
            {historyList.map((h) => (
              <div key={h.id} className="px-3 py-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-white truncate">
                    <span className="font-mono text-emerald-300 mr-1.5">{h.symbol}</span>
                    {h.title}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {new Date(h.triggeredAt).toLocaleString('ru-RU', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                </div>
                <span className="font-mono tabular-nums text-cyan-300 shrink-0">${formatSmart(h.price)}</span>
              </div>
            ))}
          </div>
        </PaywallGate>
      )}

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

      <WebhookBuilderModal
        open={webhookOpen}
        onClose={() => setWebhookOpen(false)}
        sampleSymbol={symbol}
        samplePrice={currentPrice > 0 ? currentPrice : 94000}
      />
    </div>
  );
};
