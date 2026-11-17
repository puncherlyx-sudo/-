import React, { useEffect, useMemo, useState } from 'react';
import {
  BellRing,
  BookOpen,
  Calculator,
  Check,
  CheckCircle2,
  CircleOff,
  Crown,
  Layers,
  Lock,
  ShieldCheck,
  Sliders,
  TrendingUp,
} from 'lucide-react';
import { motion } from 'motion/react';
import {
  CREDIT_COSTS,
  FREE_DAILY_SIGNAL_LIMIT,
  FREE_MAX_LEVERAGE,
  FREE_WEEKLY_QUOTA,
  PRO_MONTHLY_QUOTA,
  STRATEGY_CATALOG,
  TRADING_PAIRS,
  countTodayStrategySignals,
  formatProUntilDate,
  getCreditQuotaForProfile,
  isProSubscriptionActive,
  isProSubscriptionExpired,
} from '../data/strategies';
import type { AnalysisRecord, MarketType, PlanTier, StrategyConfig, UserProfile } from '../types/domain';
import { StaggerDeck, WorkspaceShell } from './MotionPrimitives';
import { PositionSizeCalculator } from './PositionSizeCalculator';
import { StrategyPnlChart } from './StrategyPnlChart';
import { TradeJournal } from './TradeJournal';

type StrategiesSection = 'catalog' | 'analytics' | 'calculator' | 'journal' | 'plans';

interface StrategiesViewProps {
  profile: UserProfile | null;
  strategies: StrategyConfig[];
  analyses?: AnalysisRecord[];
  isSignedIn: boolean;
  uid?: string | null;
  pushSubscribed?: boolean;
  onOpenPushSettings?: () => void;
  onRequireLogin: () => void;
  onSwitchPlan: (target: PlanTier) => Promise<void>;
  onConsumeCredits?: (amount: number, auditReason?: string) => Promise<boolean>;
  onSaveStrategy: (
    strategyId: string,
    updates: {
      enabled: boolean;
      dailySignalLimit: number;
      minConfidence: number;
      riskPerTradePct: number;
      leverage: number;
      pairs: string[];
    }
  ) => Promise<void>;
}

export const StrategiesView: React.FC<StrategiesViewProps> = ({
  profile,
  strategies,
  analyses = [],
  isSignedIn,
  uid = null,
  pushSubscribed = false,
  onOpenPushSettings,
  onRequireLogin,
  onSwitchPlan,
  onConsumeCredits,
  onSaveStrategy,
}) => {
  const [section, setSection] = useState<StrategiesSection>('catalog');
  const [proMonthPrice, setProMonthPrice] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/billing/plans')
      .then((r) => r.json() as Promise<{ plans?: { month?: { priceUsd?: number } } }>)
      .then((d) => {
        if (!cancelled && typeof d.plans?.month?.priceUsd === 'number') setProMonthPrice(d.plans.month.priceUsd);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  const [marketFilter, setMarketFilter] = useState<'all' | MarketType>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLimit, setDraftLimit] = useState<number>(0);
  const [draftConfidence, setDraftConfidence] = useState<number>(72);
  const [draftRisk, setDraftRisk] = useState<number>(1.5);
  const [draftLeverage, setDraftLeverage] = useState<number>(5);
  const [draftPairs, setDraftPairs] = useState<string[]>(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const isPro = isProSubscriptionActive(profile);
  const isExpiredPro = isProSubscriptionExpired(profile);
  const totalCreditQuota = getCreditQuotaForProfile(profile);
  const isCreditsExhausted = Boolean(isSignedIn && profile && profile.creditsRemaining <= 0);

  useEffect(() => {
    const handleTourFocus = (evt: Event) => {
      const targetId = (evt as CustomEvent<string>).detail;
      if (targetId === 'tour-strategies-pnl') {
        setSection('analytics');
      }
    };
    window.addEventListener('aegis:tour-focus', handleTourFocus);
    return () => window.removeEventListener('aegis:tour-focus', handleTourFocus);
  }, []);

  const startEdit = (cfg: StrategyConfig) => {
    setEditingId(cfg.id);
    setDraftLimit(isPro ? (cfg.dailySignalLimit === 1 ? 0 : cfg.dailySignalLimit) : FREE_DAILY_SIGNAL_LIMIT);
    setDraftConfidence(cfg.minConfidence);
    setDraftRisk(cfg.riskPerTradePct);
    setDraftLeverage(isPro ? cfg.leverage : Math.min(FREE_MAX_LEVERAGE, cfg.leverage));
    setDraftPairs(cfg.pairs);
    setFeedback(null);
  };

  const handleSave = async (cfg: StrategyConfig) => {
    setSavingId(cfg.id);
    setFeedback(null);
    try {
      await onSaveStrategy(cfg.id, {
        enabled: cfg.enabled,
        dailySignalLimit: isPro ? draftLimit : FREE_DAILY_SIGNAL_LIMIT,
        minConfidence: draftConfidence,
        riskPerTradePct: draftRisk,
        leverage: cfg.marketType === 'spot' ? 1 : isPro ? draftLeverage : Math.min(FREE_MAX_LEVERAGE, draftLeverage),
        pairs: draftPairs.length > 0 ? draftPairs : ['BTCUSDT'],
      });
      setEditingId(null);
      setFeedback(`Параметры стратегии «${cfg.name}» сохранены.`);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Ошибка сохранения стратегии');
    } finally {
      setSavingId(null);
    }
  };

  const handleToggle = async (cfg: StrategyConfig) => {
    setSavingId(cfg.id);
    try {
      await onSaveStrategy(cfg.id, {
        enabled: !cfg.enabled,
        dailySignalLimit: isPro ? cfg.dailySignalLimit : FREE_DAILY_SIGNAL_LIMIT,
        minConfidence: cfg.minConfidence,
        riskPerTradePct: cfg.riskPerTradePct,
        leverage: isPro ? cfg.leverage : Math.min(FREE_MAX_LEVERAGE, cfg.leverage),
        pairs: cfg.pairs,
      });
    } finally {
      setSavingId(null);
    }
  };

  const displayList = STRATEGY_CATALOG.filter(
    (tpl) => marketFilter === 'all' || tpl.marketType === marketFilter
  )
    .map((tpl) => {
      const existing = strategies.find((s) => s.strategyKey === tpl.key);
      return { tpl, cfg: existing };
    })
    .filter(({ cfg }) => {
      if (statusFilter === 'all') return true;
      const isEnabled = Boolean(cfg?.enabled);
      return statusFilter === 'active' ? isEnabled : !isEnabled;
    });

  const activeStrategies = strategies.filter(
    (s) => s.enabled && (isPro || !STRATEGY_CATALOG.some((t) => t.key === s.strategyKey && t.tier === 'pro'))
  );
  const activeCount = activeStrategies.length;
  const hasUnlimitedProSignals = isPro && activeStrategies.some((s) => s.dailySignalLimit === 0);
  const totalConfiguredSignals = activeStrategies.reduce(
    (acc, s) => acc + (isPro ? s.dailySignalLimit : FREE_DAILY_SIGNAL_LIMIT),
    0
  );

  const sectionTabs = useMemo(
    () => [
      {
        id: 'catalog' as const,
        label: 'Каталог стратегий',
        icon: <Layers className="w-3.5 h-3.5 text-emerald-400" />,
        meta: `${activeCount}/${STRATEGY_CATALOG.length}`,
      },
      {
        id: 'analytics' as const,
        label: 'Доходность PnL',
        icon: <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />,
      },
      {
        id: 'calculator' as const,
        label: 'Калькулятор риска',
        icon: <Calculator className="w-3.5 h-3.5 text-amber-400" />,
      },
      {
        id: 'journal' as const,
        label: 'Дневник сделок',
        icon: <BookOpen className="w-3.5 h-3.5 text-emerald-400" />,
      },
      {
        id: 'plans' as const,
        label: 'Тариф Free / PRO',
        icon: <Crown className="w-3.5 h-3.5 text-amber-400" />,
      },
    ],
    [activeCount]
  );

  const dailySignalsLabel = isPro
    ? hasUnlimitedProSignals || activeCount > 0
      ? 'Без ограничений (PRO)'
      : '0'
    : `${totalConfiguredSignals} / день (Free)`;

  const sidebarBottom = (
    <div className="space-y-1.5 text-xs font-mono tabular-nums">
      {profile && (
        <div className="flex items-center justify-between">
          <span className="font-sans text-slate-400">Кредиты</span>
          <span className={profile.creditsRemaining > 0 ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>
            {profile.creditsRemaining} / {totalCreditQuota}
          </span>
        </div>
      )}
      <div className="flex items-center justify-between">
        <span className="font-sans text-slate-400">Сигналов/день</span>
        <span className="text-emerald-400 font-semibold">{dailySignalsLabel}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="font-sans text-slate-400">Тариф</span>
        <span className={isPro ? 'text-amber-400 font-semibold' : isExpiredPro ? 'text-rose-400 font-semibold' : 'text-slate-200'}>
          {isPro
            ? `PRO · до ${formatProUntilDate(profile?.proUntil)}`
            : isExpiredPro
              ? 'PRO истёк'
              : 'Бесплатный'}
        </span>
      </div>
      {(!isPro || isCreditsExhausted) && (
        <button
          type="button"
          onClick={() => void onSwitchPlan('pro')}
          className="pt-1 font-sans text-left font-semibold text-amber-300 hover:text-amber-200 transition-colors"
        >
          {isCreditsExhausted && isPro
            ? `Продлить PRO (+${PRO_MONTHLY_QUOTA} кр.) →`
            : isExpiredPro
              ? 'Продлить подписку PRO →'
              : 'Перейти на PRO →'}
        </button>
      )}
      {onOpenPushSettings && (
        <button
          type="button"
          onClick={onOpenPushSettings}
          className={`pt-1 font-sans text-left font-medium transition-colors block ${
            pushSubscribed ? 'text-emerald-400 hover:text-emerald-300' : 'text-amber-300 hover:text-amber-200'
          }`}
        >
          {pushSubscribed ? 'Push-оповещения активны' : 'Включить Push-сигналы →'}
        </button>
      )}
    </div>
  );

  return (
    <StaggerDeck>
      <WorkspaceShell
        title="Стратегии"
        subtitle={`${activeCount} активных · ${isPro ? 'PRO ∞/день' : `${totalConfiguredSignals}/день`}`}
        icon={
          <img
            src="/src/assets/images/terminal_icon_strategy_1794855842754.jpg"
            alt="Стратегии AegisQuant"
            referrerPolicy="no-referrer"
            className="w-8 h-8 rounded-lg object-cover border border-emerald-500/25"
          />
        }
        items={sectionTabs}
        activeId={section}
        onChange={setSection}
        layoutId="strategies-workspace-nav"
        accent="emerald"
        sidebarBottomSlot={sidebarBottom}
      >
        {section === 'catalog' && (
          <div className="space-y-4">
            {(isCreditsExhausted || isExpiredPro) && (
              <div className="rounded-2xl border border-amber-500/35 bg-amber-500/10 p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-start gap-2.5 text-xs text-amber-100 max-w-2xl">
                  <Crown className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <div className="font-semibold text-amber-200">
                      {isExpiredPro
                        ? `Срок действия подписки PRO истёк (${formatProUntilDate(profile?.proUntil)})`
                        : isPro
                          ? `Месячные кредиты PRO исчерпаны (0/${PRO_MONTHLY_QUOTA})`
                          : `Лимит бесплатных кредитов достигнут (0/${totalCreditQuota})`}
                    </div>
                    <p className="text-amber-200/80 leading-relaxed">
                      {isPro
                        ? `Продлите подписку PRO, чтобы сразу пополнить +${PRO_MONTHLY_QUOTA} кредитов для анализа и бэктеста.`
                        : `Перейдите на тариф PRO: получите ${PRO_MONTHLY_QUOTA} кредитов в месяц, доступ ко всем ${STRATEGY_CATALOG.length} стратегиям, плечу до 20x и снятию ограничений на количество сигналов в день.`}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void onSwitchPlan('pro')}
                  className="cta-shimmer min-h-[40px] px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                >
                  <Crown className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {isPro ? `Продлить PRO (+${PRO_MONTHLY_QUOTA} кр.)` : isExpiredPro ? 'Продлить PRO' : 'Перейти на PRO'}
                  </span>
                </button>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex items-center p-1 rounded-xl bg-[#111827] border border-white/8">
                  {(
                    [
                      { id: 'all', label: 'Все' },
                      { id: 'spot', label: 'Спот' },
                      { id: 'futures', label: 'Фьючерсы' },
                    ] as const
                  ).map((tab) => {
                    const active = marketFilter === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setMarketFilter(tab.id)}
                        className={`min-h-[34px] px-3 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                          active ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>

                <div className="inline-flex items-center p-1 rounded-xl bg-[#111827] border border-white/8">
                  {(
                    [
                      { id: 'all', label: 'Все статусы' },
                      { id: 'active', label: 'Активные' },
                      { id: 'inactive', label: 'Неактивные' },
                    ] as const
                  ).map((st) => {
                    const active = statusFilter === st.id;
                    return (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() => setStatusFilter(st.id)}
                        className={`min-h-[34px] px-3 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                          active ? 'bg-white/12 text-white' : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {st.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {feedback && <span className="text-xs text-emerald-400">{feedback}</span>}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {displayList.map(({ tpl, cfg }, idx) => {
                const isEditing = cfg && editingId === cfg.id;
                const isProStrategy = tpl.tier === 'pro';
                const isLockedForUser = isProStrategy && !isPro;
                const isActive = Boolean(cfg?.enabled) && !isLockedForUser;
                const usedSignalsToday = isSignedIn ? countTodayStrategySignals(analyses, tpl.key) : 0;
                const isDailyFreeLimitHit = !isPro && isSignedIn && usedSignalsToday >= FREE_DAILY_SIGNAL_LIMIT;
                const isProUnlimitedLimit = isPro && (cfg?.dailySignalLimit ?? 0) === 0;
                return (
                  <motion.div
                    key={tpl.key}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, delay: Math.min(idx * 0.03, 0.15) }}
                    className={`rounded-2xl border bg-[#111827] card-surface-glow p-4 flex flex-col justify-between gap-3.5 transition-colors ${
                      isLockedForUser
                        ? 'border-amber-500/20'
                        : isActive
                          ? 'border-emerald-500/30'
                          : 'border-white/8'
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                            {isProStrategy && (
                              <span className="font-mono font-semibold text-amber-400 inline-flex items-center gap-1">
                                <Crown className="w-3 h-3" />
                                <span>PRO</span>
                              </span>
                            )}
                            {isProStrategy && <span aria-hidden="true">·</span>}
                            <span>{tpl.shortTag}</span>
                            <span aria-hidden="true">·</span>
                            <span>{tpl.riskProfile}</span>
                            <span aria-hidden="true">·</span>
                            <span>ТФ {tpl.timeframeDefault.toUpperCase()}</span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono text-slate-300">
                              {`${tpl.creditCost} кр.`}
                            </span>
                          </div>
                          <h3 className="mt-1 text-sm font-semibold text-white">{tpl.name}</h3>
                        </div>

                        {isLockedForUser ? (
                          <button
                            type="button"
                            onClick={() => void onSwitchPlan('pro')}
                            className="min-h-[34px] px-2.5 rounded-lg text-xs font-semibold border border-amber-500/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 inline-flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors"
                          >
                            <Lock className="w-3.5 h-3.5 shrink-0" />
                            <span>PRO</span>
                          </button>
                        ) : (
                          cfg && (
                            <button
                              type="button"
                              disabled={savingId === cfg.id}
                              onClick={() => void handleToggle(cfg)}
                              aria-pressed={cfg.enabled}
                              className={`min-h-[34px] px-2.5 rounded-lg text-xs font-semibold border inline-flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                                cfg.enabled
                                  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                                  : 'border-white/10 bg-white/5 text-slate-400 hover:text-white hover:bg-white/10'
                              }`}
                            >
                              {cfg.enabled ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                              ) : (
                                <CircleOff className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                              )}
                              <span>{cfg.enabled ? 'Активен' : 'Выкл'}</span>
                            </button>
                          )
                        )}
                      </div>

                      <p className="mt-2 text-xs text-slate-300 leading-relaxed">{tpl.description}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
                        <span>Индикаторы: {tpl.indicatorsUsed.join(' · ')}</span>
                        <span className="text-slate-500">· {tpl.marketCondition}</span>
                      </div>
                    </div>

                    {isLockedForUser ? (
                      <div className="pt-3 border-t border-white/8 flex items-center justify-between gap-2">
                        <span className="text-xs text-slate-400 inline-flex items-center gap-1.5">
                          <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          <span>Доступно только в подписке PRO</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => void onSwitchPlan('pro')}
                          className="min-h-[34px] px-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold whitespace-nowrap transition-colors"
                        >
                          Открыть
                        </button>
                      </div>
                    ) : cfg ? (
                      isEditing ? (
                        <div className="pt-3 border-t border-white/10 space-y-3">
                          <div>
                            <div className="flex items-center justify-between text-xs mb-1.5">
                              <span className="text-slate-300 flex items-center gap-1.5">
                                <BellRing className="w-3.5 h-3.5 text-amber-400" />
                                <span>Сигналов в день</span>
                              </span>
                              <span className="font-mono font-bold text-amber-400">
                                {isPro
                                  ? draftLimit === 0
                                    ? 'Без ограничений (PRO)'
                                    : `${draftLimit} / день`
                                  : `${FREE_DAILY_SIGNAL_LIMIT} / день (Free)`}
                              </span>
                            </div>
                            {isPro ? (
                              <div className="space-y-2">
                                <div className="grid grid-cols-2 p-1 rounded-xl bg-[#0B0F17] border border-white/8 text-xs">
                                  <button
                                    type="button"
                                    onClick={() => setDraftLimit(0)}
                                    className={`min-h-[32px] rounded-lg font-medium transition-colors ${
                                      draftLimit === 0
                                        ? 'bg-emerald-600 text-white'
                                        : 'text-slate-400 hover:text-slate-200'
                                    }`}
                                  >
                                    Без ограничений
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setDraftLimit((prev) => (prev > 0 ? prev : 10))}
                                    className={`min-h-[32px] rounded-lg font-medium transition-colors ${
                                      draftLimit > 0
                                        ? 'bg-amber-500 text-slate-950 font-semibold'
                                        : 'text-slate-400 hover:text-slate-200'
                                    }`}
                                  >
                                    Свой порог
                                  </button>
                                </div>
                                {draftLimit > 0 && (
                                  <input
                                    type="range"
                                    min={1}
                                    max={100}
                                    value={draftLimit}
                                    onChange={(e) => setDraftLimit(Number(e.target.value))}
                                    className="w-full accent-amber-500"
                                  />
                                )}
                              </div>
                            ) : (
                              <div className="flex items-center justify-between rounded-xl bg-[#0B0F17] border border-white/8 px-3 py-2 text-xs text-slate-400">
                                <span className="flex items-center gap-1.5">
                                  <Lock className="w-3.5 h-3.5 text-amber-400" />
                                  Снятие дневного лимита в PRO
                                </span>
                                <button
                                  type="button"
                                  onClick={() => void onSwitchPlan('pro')}
                                  className="text-amber-400 hover:underline font-medium"
                                >
                                  PRO
                                </button>
                              </div>
                            )}
                          </div>

                          <div className="grid grid-cols-2 gap-2.5 text-xs">
                            <div>
                              <label className="block text-slate-400 mb-1">Уверенность (%)</label>
                              <input
                                type="number"
                                min={50}
                                max={95}
                                value={draftConfidence}
                                onChange={(e) => setDraftConfidence(Number(e.target.value))}
                                className="w-full min-h-[36px] rounded-xl border border-white/10 bg-[#0B0F17] px-2.5 font-mono text-white"
                              />
                            </div>
                            <div>
                              <label className="block text-slate-400 mb-1">Риск (%)</label>
                              <input
                                type="number"
                                step="0.25"
                                min={0.25}
                                max={10}
                                value={draftRisk}
                                onChange={(e) => setDraftRisk(Number(e.target.value))}
                                className="w-full min-h-[36px] rounded-xl border border-white/10 bg-[#0B0F17] px-2.5 font-mono text-white"
                              />
                            </div>
                          </div>

                          {cfg.marketType === 'futures' && (
                            <div>
                              <div className="flex items-center justify-between text-xs mb-1">
                                <span className="text-slate-400">
                                  Макс. плечо{!isPro ? ` (Free до ${FREE_MAX_LEVERAGE}x)` : ''}
                                </span>
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-amber-300">{draftLeverage}x</span>
                                  {!isPro && (
                                    <button
                                      type="button"
                                      onClick={() => void onSwitchPlan('pro')}
                                      className="text-[11px] font-medium text-amber-400 hover:underline"
                                    >
                                      PRO до 20x
                                    </button>
                                  )}
                                </div>
                              </div>
                              <input
                                type="range"
                                min={1}
                                max={isPro ? 20 : FREE_MAX_LEVERAGE}
                                value={Math.min(isPro ? 20 : FREE_MAX_LEVERAGE, draftLeverage)}
                                onChange={(e) => setDraftLeverage(Number(e.target.value))}
                                className="w-full accent-amber-500"
                              />
                            </div>
                          )}

                          <div>
                            <div className="text-xs text-slate-400 mb-1">Пары</div>
                            <div className="flex flex-wrap gap-1.5">
                              {TRADING_PAIRS.slice(0, 6).map((p) => {
                                const selected = draftPairs.includes(p.symbol);
                                return (
                                  <button
                                    key={p.symbol}
                                    type="button"
                                    onClick={() =>
                                      setDraftPairs((prev) =>
                                        selected ? prev.filter((x) => x !== p.symbol) : [...prev, p.symbol]
                                      )
                                    }
                                    className={`min-h-[30px] px-2 rounded-lg text-xs font-mono border transition-colors ${
                                      selected
                                        ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                                        : 'border-white/10 bg-[#0B0F17] text-slate-400'
                                    }`}
                                  >
                                    {p.symbol.replace('USDT', '')}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="flex-1 min-h-[38px] rounded-xl border border-white/10 bg-white/5 text-xs font-medium text-slate-300"
                            >
                              Отмена
                            </button>
                            <button
                              type="button"
                              disabled={savingId === cfg.id}
                              onClick={() => void handleSave(cfg)}
                              className="flex-1 min-h-[38px] rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white"
                            >
                              {savingId === cfg.id ? 'Сохранение...' : 'Сохранить'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="pt-3 border-t border-white/8 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2.5 text-xs font-mono tabular-nums text-slate-300">
                            <span>
                              {isPro
                                ? isProUnlimitedLimit
                                  ? '∞/день'
                                  : `${cfg.dailySignalLimit}/день`
                                : `${usedSignalsToday}/${FREE_DAILY_SIGNAL_LIMIT} сегодня`}
                            </span>
                            <span>{cfg.minConfidence}%</span>
                            {cfg.marketType === 'futures' && <span>{cfg.leverage}x</span>}
                            {isDailyFreeLimitHit && (
                              <button
                                type="button"
                                onClick={() => void onSwitchPlan('pro')}
                                className="font-sans text-[11px] font-semibold text-amber-300 hover:underline"
                              >
                                Лимит Free · PRO →
                              </button>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => startEdit(cfg)}
                            className="min-h-[34px] px-3 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-medium text-white inline-flex items-center gap-1.5 transition-colors"
                          >
                            <Sliders className="w-3.5 h-3.5" />
                            <span>Настроить</span>
                          </button>
                        </div>
                      )
                    ) : (
                      <div className="pt-3 border-t border-white/8 flex items-center justify-between">
                        <span className="text-xs text-slate-500">Войдите для настройки</span>
                        <button
                          type="button"
                          onClick={onRequireLogin}
                          className="min-h-[34px] px-3 rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 text-xs font-medium"
                        >
                          Войти
                        </button>
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </div>

            {displayList.length === 0 && (
              <div className="rounded-2xl border border-white/8 bg-[#111827] p-8 text-center space-y-3">
                <p className="text-sm text-slate-300">По выбранным фильтрам стратегии не найдены.</p>
                <button
                  type="button"
                  onClick={() => {
                    setMarketFilter('all');
                    setStatusFilter('all');
                  }}
                  className="min-h-[38px] px-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-medium text-white transition-colors"
                >
                  Сбросить фильтры
                </button>
              </div>
            )}
          </div>
        )}

        {section === 'analytics' && (
          <div data-tour-id="tour-strategies-pnl">
            <StrategyPnlChart
              strategies={strategies}
              isPro={isPro}
              isSignedIn={isSignedIn}
              creditsRemaining={profile?.creditsRemaining}
              creditQuota={totalCreditQuota}
              onUpgradePro={() => void onSwitchPlan('pro')}
              onConsumeCredits={onConsumeCredits}
            />
          </div>
        )}

        {section === 'calculator' && <PositionSizeCalculator strategies={strategies} />}

        {section === 'journal' && <TradeJournal uid={isSignedIn ? uid : null} onRequireLogin={onRequireLogin} />}

        {section === 'plans' && (
          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-white/8 bg-[#111827] p-5 flex flex-col justify-between gap-4">
              <div>
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-white">Базовый (Бесплатный)</h2>
                  <span className="font-mono text-sm font-semibold text-slate-300">$0 / мес</span>
                </div>
                <p className="mt-1.5 text-xs text-slate-400">
                  Для старта: оценка рынка на 4 базовых стратегиях и тестирование сигналов по недельной квоте.
                </p>
                <ul className="mt-3.5 space-y-2 text-xs sm:text-sm text-slate-300">
                  <li className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span>
                      {FREE_WEEKLY_QUOTA} кредитов каждые 7 дней: Спот-анализ — 1 кр., Фьючерсы — 2 кр., ручной пересчёт PnL — 1 кр.
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span>4 базовые стратегии (3 Спот + 1 Фьючерсы), плечо до {FREE_MAX_LEVERAGE}x и 1 сигнал/день</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span>Свечной график, стандартная EMA Ribbon (8·13·21·55), алерты и 2FA-защита</span>
                  </li>
                </ul>
              </div>
            </div>

            <div className="rounded-2xl border border-amber-500/30 bg-[#111827] p-5 flex flex-col justify-between gap-4">
              <div>
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-white flex items-center gap-2">
                    <Crown className="w-5 h-5 text-amber-400" />
                    <span>PRO Терминал</span>
                  </h2>
                  <span className="font-mono text-sm font-semibold text-amber-400">
                    {proMonthPrice !== null ? `$${proMonthPrice} / мес` : 'PRO'}
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-slate-400">
                  {PRO_MONTHLY_QUOTA} кредитов в месяц и полный доступ ко всем закрытым инструментам и PRO-стратегиям.
                </p>
                <ul className="mt-3.5 space-y-2 text-xs sm:text-sm text-slate-200">
                  <li className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <span>{PRO_MONTHLY_QUOTA} кредитов в месяц для AI-анализа (Спот — 1 кр., Фьючерсы — 2 кр., бэктест — 1 кр.)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <span>Снятие ограничений на количество сигналов в день, все {STRATEGY_CATALOG.length} стратегий и плечо до 20x</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <span>Биржевой стакан TOP-10, конструктор периодов MA Ribbon (EMA/SMA), 4H-бэктесты и экспорт CSV</span>
                  </li>
                </ul>
              </div>

              {!isSignedIn ? (
                <button
                  type="button"
                  onClick={onRequireLogin}
                  className="min-h-[42px] w-full rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-semibold transition-colors"
                >
                  Войти и активировать PRO
                </button>
              ) : isPro ? (
                <div className="space-y-2">
                  <div className="min-h-[40px] w-full rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-xs font-semibold flex items-center justify-center gap-2">
                    <ShieldCheck className="w-4 h-4" />
                    <span>
                      PRO активен до {formatProUntilDate(profile?.proUntil)} · Остаток {profile?.creditsRemaining ?? 0}/{PRO_MONTHLY_QUOTA} кр.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void onSwitchPlan('pro')}
                    className="min-h-[40px] w-full rounded-xl border border-amber-500/40 bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 text-xs font-semibold transition-colors"
                  >
                    Продлить PRO и пополнить +{PRO_MONTHLY_QUOTA} кредитов
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void onSwitchPlan('pro')}
                  className="cta-shimmer min-h-[42px] w-full rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-semibold transition-colors"
                >
                  {isExpiredPro ? 'Продлить PRO доступ' : 'Активировать PRO доступ'}
                </button>
              )}
            </div>
          </section>
        )}
      </WorkspaceShell>
    </StaggerDeck>
  );
};
