import React, { useEffect, useState } from 'react';
import {
  Check,
  CreditCard,
  Crown,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Star,
  X,
  Zap,
} from 'lucide-react';
import {
  CREDIT_COSTS,
  FREE_WEEKLY_QUOTA,
  MAX_EXCLUSIVE_STRATEGIES_COUNT,
  MAX_X10_MONTHLY_QUOTA,
  MAX_X20_MONTHLY_QUOTA,
  PRO_AND_FREE_STRATEGIES_COUNT,
  PRO_MONTHLY_QUOTA,
  STRATEGY_CATALOG,
} from '../data/strategies';
import type { PlanTier } from '../types/domain';
import { authFetch } from '../lib/authFetch';
import { triggerHaptic } from '../lib/securityDlp';
import { parseJsonResponse } from '../utils/safeFetchJson';

type Period = 'month' | 'year';
type CheckoutTier = 'pro' | 'max';
type MaxMultiplier = 10 | 20;

interface PlanEntry {
  priceUsd: number;
  days: number;
  credits?: number;
}

interface PlansResponse {
  enabled: boolean;
  plans: Record<Period, { priceUsd: number; days: number }>;
  tiers?: Record<CheckoutTier, Record<Period, PlanEntry>>;
  maxMultipliers?: Record<'10' | '20', Record<Period, PlanEntry>>;
}

interface PricingModalProps {
  open: boolean;
  onClose: () => void;
  proUntil?: number;
  currentPlan?: PlanTier;
  initialTier?: CheckoutTier;
  initialMaxMultiplier?: MaxMultiplier;
  /** Позволяет мгновенно переключить тестовый тариф для проверки функций до релиза Google Play Billing. */
  onActivateDemoTier?: (tier: PlanTier, maxMultiplier?: MaxMultiplier) => void;
  /** Открывает чат поддержки / справку для запроса доступа к подписке. */
  onOpenSupport?: () => void;
}

const FREE_FEATURES = [
  `Базовый скринер рынка и ${FREE_WEEKLY_QUOTA} AI-кредитов на 7 дней (до 3 AI-анализов/день)`,
  '5 базовых стратегий: 4 спотовых (DCA, Пробой, Золотой крест, Отскок) + 1 фьючерсная',
  'Базовый калькулятор риска и локальный дневник сделок',
];

const PRO_FEATURES = [
  `${PRO_MONTHLY_QUOTA} AI-кредитов/мес + ${PRO_AND_FREE_STRATEGIES_COUNT} стратегий (12 спот + 6 фьючерсов: SMC, Дончиан, ATR-откат, Sentiment)`,
  '1. Smart Alerts по индикаторам (RSI, EMA50/200, объём >2x, BB Squeeze, Funding) + история',
  '2. Smart Money слои на графике: S/R уровни, Order Blocks, FVG и BOS/CHoCH',
  '3. Профиль объёма (VPVR) на графике: POC, VAH и VAL зоны',
  '4. Live-сканер паттернов TOP-16 (поглощение, пин-бар, треугольник, двойное дно)',
  '5. PRO-лесенка входа (DCA): 2–3 лимита, каскадные TP1–TP3, цена ликвидации и безубыток',
  '6. Продвинутый дневник: Equity Curve, PnL-календарь, сессии, CSV и AI-разбор ошибок',
  '7. Тепловая карта секторов (L1/L2/DeFi/AI/Meme) + матрица корреляций к BTC',
  '8. Стакан TOP-10, дисбаланс Bid/Ask и лента крупных принтов от $10k+',
  '9. Сравнение стратегий с учётом комиссии (0.04%–0.1%), проскальзывания и 4H-бэктестов',
  '10. До 5 кастомных вотчлистов + «AI-дайджест за 24ч» (драйверы рынка и потоки ETF)',
];

function getMaxFeatures(mult: MaxMultiplier, quota: number): string[] {
  return [
    `${quota.toLocaleString('ru-RU')} AI-кредитов/мес (в ${mult}× больше PRO) + всё из VERNIER PRO и 0 кр. за бэктест/сентимент`,
    `0. +${MAX_EXCLUSIVE_STRATEGIES_COUNT} эксклюзивных MAX-стратегий (всего ${STRATEGY_CATALOG.length}: 6 спот + 3 фьючерса) с Win Rate 55%+: Order Block, FVG, Wyckoff Spring, Keltner, VWAP и Quant Regime`,
    '1. «AI-Консилиум» (3 агента: Теханалитик + Деривативы/Фандинг + Риск-менеджер)',
    '2. Карта ликвидаций (Liquidation Heatmap) — кластеры стопов лонгов и шортов',
    '3. Радар деривативов по 44 парам: экстремальный Funding, аномалии OI и база',
    '4. Радар «Китов» ($100k+ в ленте) + детектор спуфинга и крупных стен в стакане',
    '5. Симулятор Paper Trading ($10,000 виртуальных) с автозаписью сделок в дневник',
    '6. «Анти-FOMO / Tilt-Guard»: защита от тильта, таймер охлаждения и Индекс дисциплины',
    '7. Симулятор Монте-Карло (500 сценариев) + вероятность DD >20% и критерий Келли',
    '8. No-Code конструктор своих стратегий (Если → И → То) + автооптимизатор параметров',
    '9. Стресс-тест портфеля («BTC -20%», «Альтсезон», «Крах -40%») + диверсификация',
    '10. Сканер арбитража Funding Rate (спот + фьючерс) с расчётом годового APR%',
    '11. Персональный AI-коуч по дневнику: аудит тильта и план коррекции на 7 дней',
    '12. Конструктор Webhook (JSON) и форматированных алертов для Telegram-ботов',
  ];
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

export const PricingModal: React.FC<PricingModalProps> = ({
  open,
  onClose,
  proUntil,
  currentPlan = 'free',
  initialTier = 'pro',
  initialMaxMultiplier = 10,
  onActivateDemoTier,
  onOpenSupport,
}) => {
  const [data, setData] = useState<PlansResponse | null>(null);
  const [selectedTier, setSelectedTier] = useState<CheckoutTier>(initialTier);
  const [maxMultiplier, setMaxMultiplier] = useState<MaxMultiplier>(initialMaxMultiplier);
  const [period, setPeriod] = useState<Period>('year');
  const [busyAction, setBusyAction] = useState<'restore' | null>(null);
  const [statusNotice, setStatusNotice] = useState<{ tone: 'ok' | 'info' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (open) {
      setSelectedTier(initialTier);
      setMaxMultiplier(initialMaxMultiplier);
      setStatusNotice(null);
    }
  }, [open, initialTier, initialMaxMultiplier]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch('/api/billing/plans', { cache: 'no-store' })
      .then((r) => parseJsonResponse<PlansResponse>(r))
      .then((parsed) => {
        if (!cancelled && parsed.ok && parsed.data) setData(parsed.data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const proPricing: Record<Period, PlanEntry> = data?.tiers?.pro ?? {
    month: data?.plans?.month ?? { priceUsd: 29, days: 30, credits: PRO_MONTHLY_QUOTA },
    year: data?.plans?.year ?? { priceUsd: 264, days: 365, credits: PRO_MONTHLY_QUOTA },
  };

  const maxPricingByMult: Record<'10' | '20', Record<Period, PlanEntry>> = {
    '10': data?.maxMultipliers?.['10'] ?? {
      month: { priceUsd: 79, days: 30, credits: MAX_X10_MONTHLY_QUOTA },
      year: { priceUsd: 744, days: 365, credits: MAX_X10_MONTHLY_QUOTA },
    },
    '20': data?.maxMultipliers?.['20'] ?? {
      month: { priceUsd: 129, days: 30, credits: MAX_X20_MONTHLY_QUOTA },
      year: { priceUsd: 1188, days: 365, credits: MAX_X20_MONTHLY_QUOTA },
    },
  };

  const multKey: '10' | '20' = maxMultiplier === 20 ? '20' : '10';
  const isMaxSelected = selectedTier === 'max';
  const maxQuota = maxMultiplier === 20 ? MAX_X20_MONTHLY_QUOTA : MAX_X10_MONTHLY_QUOTA;
  const maxSpotSignals = Math.floor(maxQuota / CREDIT_COSTS.spotAnalysis);
  const maxFuturesSignals = Math.floor(maxQuota / CREDIT_COSTS.futuresAnalysis);
  const activePricing = isMaxSelected ? maxPricingByMult[multKey] : proPricing;
  const activePrice = period === 'year' ? activePricing.year.priceUsd : activePricing.month.priceUsd;

  const proYearSavingPct = Math.max(
    0,
    Math.round((1 - proPricing.year.priceUsd / (proPricing.month.priceUsd * 12)) * 100)
  );
  const maxYearSavingPct = Math.max(
    0,
    Math.round((1 - maxPricingByMult[multKey].year.priceUsd / (maxPricingByMult[multKey].month.priceUsd * 12)) * 100)
  );
  // Стабильный бейдж на переключателе «Год», чтобы процент не скакал при выборе PRO ↔ MAX
  const yearBadgeSavingPct = Math.max(proYearSavingPct, 24);

  const selectedQuota = isMaxSelected ? maxQuota : PRO_MONTHLY_QUOTA;

  const handleCheckout = () => {
    triggerHaptic(12);
    setStatusNotice(null);

    // В DEV-превью допускаем локальный тест тарифа для проверки функций до релиза Google Play Billing
    if (import.meta.env.DEV && onActivateDemoTier) {
      onActivateDemoTier(selectedTier, maxMultiplier);
      setStatusNotice({
        tone: 'ok',
        text: `Локальный DEV-тест: включён тариф ${isMaxSelected ? `MAX ×${maxMultiplier}` : 'PRO'} (${selectedQuota.toLocaleString('ru-RU')} кр./мес). В production активация выполняется через Google Play Billing.`,
      });
      return;
    }

    setStatusNotice({
      tone: 'info',
      text: `Оформление подписки ${isMaxSelected ? `MAX ×${maxMultiplier}` : 'PRO'} ($${activePrice} / ${period === 'year' ? 'год' : 'мес'}) выполняется через Google Play Billing после публикации в Google Play. Если у вас уже есть активная подписка — нажмите «Восстановить покупки» или свяжитесь с поддержкой.`,
    });
  };

  const handleRestorePurchases = async () => {
    triggerHaptic(8);
    setBusyAction('restore');
    setStatusNotice(null);
    try {
      const res = await authFetch('/api/entitlements/me', {
        method: 'GET',
        cache: 'no-store',
      });
      const parsed = await parseJsonResponse<{
        plan?: PlanTier;
        proUntil?: number | null;
        creditsRemaining?: number;
        error?: string;
      }>(res);

      if (parsed.ok && parsed.data) {
        const livePlan = parsed.data.plan ?? 'free';
        const liveUntil = typeof parsed.data.proUntil === 'number' ? parsed.data.proUntil : null;
        if (livePlan !== 'free' && liveUntil && liveUntil > Date.now()) {
          setStatusNotice({
            tone: 'ok',
            text: `Подписка синхронизирована с сервером: активен ${livePlan.toUpperCase()} до ${formatDate(liveUntil)} (остаток: ${parsed.data.creditsRemaining ?? 0} кр.).`,
          });
        } else {
          setStatusNotice({
            tone: 'info',
            text: 'Синхронизация с сервером завершена. Активных оплаченных подписок на этом аккаунте не найдено.',
          });
        }
      } else if (res.status === 401) {
        setStatusNotice({
          tone: 'info',
          text: 'Войдите в аккаунт, чтобы синхронизировать статус оплаченной подписки.',
        });
      } else {
        setStatusNotice({
          tone: 'err',
          text: parsed.data?.error || parsed.errorMessage || 'Не удалось проверить статус подписки.',
        });
      }
    } catch {
      setStatusNotice({
        tone: 'err',
        text: 'Ошибка сети при синхронизации статуса подписки.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Подписки VERNIER — Free, PRO и MAX (Google Play Billing)"
    >
      <div className="w-full max-w-3xl max-h-[93dvh] overflow-y-auto rounded-2xl border border-emerald-500/25 bg-[var(--surface-1)] p-4 sm:p-6 shadow-2xl space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base sm:text-lg font-bold text-white">Подписки VERNIER</h3>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                Google Play Billing · Карта / Google Pay
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              {proUntil && proUntil > Date.now()
                ? `Активен ${currentPlan.toUpperCase()} до ${formatDate(proUntil)}. Вы можете сменить план или восстановить покупки.`
                : 'Прозрачные тарифы в фиатной валюте через Google Play. Отмена автопродления в любой момент.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть окно тарифов"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-white/5 shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Billing Period Toggle: Месяц / Год */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-[var(--surface-0)] p-2">
          <div className="inline-flex items-center gap-1" role="radiogroup" aria-label="Период оплаты">
            <button
              type="button"
              role="radio"
              aria-checked={period === 'month'}
              onClick={() => {
                triggerHaptic(8);
                setPeriod('month');
              }}
              className={`min-h-[36px] px-3.5 rounded-lg text-xs font-semibold transition-colors ${
                period === 'month' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Месяц
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={period === 'year'}
              onClick={() => {
                triggerHaptic(8);
                setPeriod('year');
              }}
              className={`min-h-[36px] px-3.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
                period === 'year' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              <span>Год</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-400 text-slate-950 font-bold whitespace-nowrap">
                до -{yearBadgeSavingPct}%
              </span>
            </button>
          </div>

          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => void handleRestorePurchases()}
            className="min-h-[36px] px-3 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-medium text-slate-200 inline-flex items-center gap-1.5 transition-colors"
          >
            {busyAction === 'restore' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RotateCcw className="w-3.5 h-3.5 text-emerald-400" />
            )}
            <span>Восстановить покупки</span>
          </button>
        </div>

        {/* 3-Tier Visual Cards: FREE / PRO (Highlighted Gold-Emerald) / MAX (Prominent with X10 & X20) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
          {/* FREE Card */}
          <div className="rounded-2xl border border-white/10 bg-[var(--surface-0)] p-4 flex flex-col justify-between gap-3">
            <div className="space-y-3">
              <div>
                <div className="text-xs font-mono text-slate-400 uppercase tracking-wider">FREE</div>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-2xl font-bold font-mono text-white">$0</span>
                  <span className="text-xs text-slate-400">/ навсегда</span>
                </div>
              </div>
              <ul className="space-y-2 text-xs text-slate-300">
                {FREE_FEATURES.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <span className="leading-snug">{f}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="pt-2">
              {import.meta.env.DEV && onActivateDemoTier && currentPlan !== 'free' ? (
                <button
                  type="button"
                  onClick={() => {
                    onActivateDemoTier('free');
                    setStatusNotice({ tone: 'info', text: 'Включён базовый тариф FREE (DEV).' });
                  }}
                  className="w-full min-h-[38px] rounded-xl border border-white/12 bg-white/5 hover:bg-white/10 text-xs font-medium text-slate-300"
                >
                  Тестировать Free
                </button>
              ) : (
                <div className="w-full min-h-[38px] rounded-xl border border-white/8 bg-white/[0.03] text-slate-400 text-xs font-medium flex items-center justify-center">
                  {currentPlan === 'free' ? 'Текущий план' : 'Базовый доступ'}
                </div>
              )}
            </div>
          </div>

          {/* PRO Card — Strict Single-Select Highlight */}
          <div
            onClick={() => {
              triggerHaptic(8);
              setSelectedTier('pro');
            }}
            className={`relative rounded-2xl p-[1.5px] cursor-pointer transition-all ${
              selectedTier === 'pro'
                ? 'bg-gradient-to-br from-amber-400 via-emerald-400 to-teal-500 shadow-[0_0_28px_-6px_rgba(16,185,129,0.45)]'
                : 'bg-white/10 hover:bg-white/20 opacity-90 hover:opacity-100'
            }`}
          >
            <div
              className={`h-full rounded-[15px] p-4 flex flex-col justify-between gap-3 transition-colors ${
                selectedTier === 'pro' ? 'bg-[var(--surface-1)]' : 'bg-[var(--surface-0)]'
              }`}
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-300">
                    <Crown className="w-4 h-4" />
                    <span>VERNIER PRO</span>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-amber-400 to-emerald-400 px-2 py-0.5 text-[10px] font-bold text-slate-950 tracking-wide">
                    <Star className="w-2.5 h-2.5 fill-slate-950" />
                    ХИТ / РЕКОМЕНДУЕМ
                  </span>
                </div>

                <div>
                  <div className="flex items-baseline gap-1 font-mono tabular-nums">
                    <span className="text-2xl font-bold text-white">
                      ${period === 'year' ? Math.round(proPricing.year.priceUsd / 12) : proPricing.month.priceUsd}
                    </span>
                    <span className="text-xs text-slate-400">/ мес</span>
                  </div>
                  <div className="text-[11px] text-emerald-300 font-mono">
                    {period === 'year'
                      ? `$${proPricing.year.priceUsd} при оплате за год (-${proYearSavingPct}%)`
                      : `${PRO_MONTHLY_QUOTA} AI-кредитов ежемесячно`}
                  </div>
                </div>

                <ul className="space-y-2 text-xs text-slate-200">
                  {PRO_FEATURES.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                      <span className="leading-snug">{f}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedTier('pro');
                }}
                className={`w-full min-h-[40px] rounded-xl text-xs font-semibold transition-colors ${
                  selectedTier === 'pro'
                    ? 'bg-gradient-to-r from-amber-400 to-emerald-400 text-slate-950'
                    : 'border border-amber-400/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20'
                }`}
              >
                {selectedTier === 'pro' ? 'Выбран PRO' : 'Выбрать PRO'}
              </button>
            </div>
          </div>

          {/* MAX Card — Strict Single-Select Institutional Tier with Interactive X10 / X20 Toggles */}
          <div
            onClick={() => {
              triggerHaptic(8);
              setSelectedTier('max');
            }}
            className={`relative rounded-2xl p-[1.5px] cursor-pointer transition-all ${
              selectedTier === 'max'
                ? 'bg-gradient-to-br from-cyan-400 via-teal-300 to-emerald-400 shadow-[0_0_28px_-6px_rgba(34,211,238,0.45)]'
                : 'bg-white/10 hover:bg-white/20 opacity-90 hover:opacity-100'
            }`}
          >
            <div
              className={`h-full rounded-[15px] p-4 flex flex-col justify-between gap-3 transition-colors ${
                selectedTier === 'max' ? 'bg-[var(--surface-1)]' : 'bg-[var(--surface-0)]'
              }`}
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="inline-flex items-center gap-1.5 text-xs font-bold text-cyan-300">
                    <Sparkles className="w-4 h-4" />
                    <span>VERNIER MAX</span>
                  </div>
                  <span className="text-[10px] font-mono font-bold text-cyan-200 px-2 py-0.5 rounded-full border border-cyan-400/40 bg-cyan-500/15 whitespace-nowrap">
                    ×{maxMultiplier} КРЕДИТОВ
                  </span>
                </div>

                {/* Interactive ×10 / ×20 Multiplier Toggles inside MAX */}
                <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
                  <div
                    className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-[var(--surface-0)] border border-cyan-500/25"
                    role="radiogroup"
                    aria-label="Множитель кредитов MAX"
                  >
                    {(
                      [
                        { mult: 10 as const, quota: MAX_X10_MONTHLY_QUOTA },
                        { mult: 20 as const, quota: MAX_X20_MONTHLY_QUOTA },
                      ] as const
                    ).map(({ mult, quota }) => {
                      const isActiveMult = maxMultiplier === mult;
                      return (
                        <button
                          key={mult}
                          type="button"
                          role="radio"
                          aria-checked={isActiveMult}
                          onClick={() => {
                            triggerHaptic(10);
                            setSelectedTier('max');
                            setMaxMultiplier(mult);
                          }}
                          className={`min-h-[44px] rounded-lg px-2 py-1 text-center transition-all ${
                            isActiveMult
                              ? isMaxSelected
                                ? mult === 20
                                  ? 'bg-gradient-to-r from-cyan-400 to-emerald-300 text-slate-950 font-bold shadow-sm'
                                  : 'bg-gradient-to-r from-cyan-400 to-teal-300 text-slate-950 font-bold shadow-sm'
                                : 'bg-cyan-500/20 border border-cyan-400/50 text-cyan-100 font-bold'
                              : 'text-slate-300 hover:bg-white/5 border border-transparent'
                          }`}
                        >
                          <div className="text-xs font-mono font-bold flex items-center justify-center gap-1">
                            <Zap className="w-3 h-3" />
                            <span>×{mult}</span>
                          </div>
                          <div
                            className={`text-[10px] font-mono tabular-nums ${
                              isActiveMult
                                ? isMaxSelected
                                  ? 'text-slate-900 font-semibold'
                                  : 'text-cyan-200'
                                : 'text-slate-400'
                            }`}
                          >
                            {quota.toLocaleString('ru-RU')} кр./мес
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Live Monthly Quota & Signal Capacity Readout (flex-wrap prevents truncation) */}
                  <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/[0.06] px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[10px] font-mono tabular-nums">
                    <span className="text-cyan-200 font-semibold whitespace-nowrap">
                      Квота ×{maxMultiplier}: {maxQuota.toLocaleString('ru-RU')} кр./мес
                    </span>
                    <span className="text-slate-300 whitespace-nowrap">
                      до {maxSpotSignals.toLocaleString('ru-RU')} спот / {maxFuturesSignals.toLocaleString('ru-RU')} фьючерсов
                    </span>
                  </div>
                </div>

                <div>
                  <div className="flex items-baseline gap-1 font-mono tabular-nums">
                    <span className="text-2xl font-bold text-white">
                      $
                      {period === 'year'
                        ? Math.round(maxPricingByMult[multKey].year.priceUsd / 12)
                        : maxPricingByMult[multKey].month.priceUsd}
                    </span>
                    <span className="text-xs text-slate-400">/ мес</span>
                  </div>
                  <div className="text-[11px] text-cyan-300 font-mono tabular-nums">
                    {period === 'year'
                      ? `$${maxPricingByMult[multKey].year.priceUsd}/год (-${maxYearSavingPct}%) · ${maxQuota.toLocaleString('ru-RU')} кр./мес`
                      : `${maxQuota.toLocaleString('ru-RU')} AI-кредитов/мес (×${maxMultiplier} PRO)`}
                  </div>
                </div>

                <ul className="space-y-2 text-xs text-slate-100">
                  {getMaxFeatures(maxMultiplier, maxQuota).map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="w-3.5 h-3.5 text-cyan-300 shrink-0 mt-0.5" />
                      <span className="leading-snug">{f}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  triggerHaptic(8);
                  setSelectedTier('max');
                }}
                className={`w-full min-h-[40px] rounded-xl text-xs font-semibold transition-colors ${
                  selectedTier === 'max'
                    ? 'bg-gradient-to-r from-cyan-400 to-teal-300 text-slate-950'
                    : 'border border-cyan-400/40 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20'
                }`}
              >
                {selectedTier === 'max' ? `Выбран MAX ×${maxMultiplier}` : `Выбрать MAX ×${maxMultiplier}`}
              </button>
            </div>
          </div>
        </div>

        {/* Credit Spend Summary */}
        <div className="rounded-xl border border-white/8 bg-[var(--surface-0)] px-3.5 py-2 text-[11px] text-slate-400 font-mono">
          Списание кредитов: AI-анализ пары (Спот / Фьючерсы) {CREDIT_COSTS.spotAnalysis} кр. ·
          Бэктест, Сентимент, Графики, Дневник и Алерты — 0 кр.
        </div>

        {/* H1: Прозрачное уведомление о пропорциональном пересчёте остатка дней при смене тарифа */}
        {proUntil && proUntil > Date.now() && currentPlan !== 'free' && (
          <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/[0.07] px-3.5 py-2.5 text-[11px] leading-relaxed text-cyan-100">
            <strong className="text-cyan-200">Сохранение оплаченных дней:</strong> при продлении текущего тарифа
            новый период добавляется к дате окончания ({formatDate(proUntil)}). При переходе между тарифами
            (PRO ↔ MAX ×10 ↔ MAX ×20) оставшиеся оплаченные дни не сгорают — сервер автоматически
            пересчитывает их стоимость в эквивалентные дни нового тарифа.
          </div>
        )}

        {statusNotice && (
          <div
            className={`rounded-xl border px-3.5 py-2.5 text-xs space-y-2 ${
              statusNotice.tone === 'ok'
                ? 'border-emerald-500/35 bg-emerald-500/12 text-emerald-200'
                : statusNotice.tone === 'err'
                  ? 'border-rose-500/35 bg-rose-500/12 text-rose-200'
                  : 'border-cyan-500/35 bg-cyan-500/10 text-cyan-200'
            }`}
          >
            <div>{statusNotice.text}</div>
            {statusNotice.tone === 'info' && onOpenSupport && (
              <button
                type="button"
                onClick={onOpenSupport}
                className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/35 bg-cyan-500/15 hover:bg-cyan-500/25 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 transition-colors"
              >
                Связаться с поддержкой
              </button>
            )}
          </div>
        )}

        {/* Primary Checkout CTA */}
        <button
          type="button"
          disabled={busyAction !== null}
          onClick={handleCheckout}
          className={`cta-shimmer min-h-[50px] w-full rounded-xl disabled:opacity-50 text-slate-950 text-sm font-bold transition-all flex items-center justify-center gap-2 shadow-lg ${
            isMaxSelected
              ? 'bg-gradient-to-r from-cyan-400 via-teal-300 to-emerald-400 hover:brightness-105'
              : 'bg-gradient-to-r from-amber-400 via-emerald-400 to-teal-400 hover:brightness-105'
          }`}
        >
          <CreditCard className="w-4 h-4" />
          <span>
            {`Оформить ${isMaxSelected ? `MAX ×${maxMultiplier} (${selectedQuota.toLocaleString('ru-RU')} кр./мес)` : `PRO (${selectedQuota.toLocaleString('ru-RU')} кр./мес)`} — $${activePrice}`}
          </span>
        </button>

        {/* Transparent Auto-Renewal & Billing Compliance Notice */}
        <div className="flex items-start gap-2 text-[11px] leading-relaxed text-slate-400 border-t border-white/8 pt-3">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <p>
            Активация тарифа выполняется строго сервером после верификации подписки (Google Play Billing). Средства клиентов в терминале не хранятся — вы можете проверить актуальный статус подписки в любой момент кнопкой «Восстановить покупки».
          </p>
        </div>
      </div>
    </div>
  );
};
