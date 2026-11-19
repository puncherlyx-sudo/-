import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  BellRing,
  BookOpen,
  Calculator,
  Check,
  CheckCircle2,
  CircleOff,
  Crown,
  Gauge,
  Layers,
  Lock,
  Plus,
  Radar,
  RefreshCw,
  ShieldCheck,
  Sliders,
  Sparkles,
  Trash2,
  TrendingUp,
  Webhook,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  FREE_DAILY_SIGNAL_LIMIT,
  FREE_MAX_LEVERAGE,
  FREE_WEEKLY_QUOTA,
  FUTURES_STRATEGIES_COUNT,
  MAX_EXCLUSIVE_STRATEGIES_COUNT,
  MAX_X10_MONTHLY_QUOTA,
  MAX_X20_MONTHLY_QUOTA,
  PRO_AND_FREE_STRATEGIES_COUNT,
  PRO_MONTHLY_QUOTA,
  SPOT_STRATEGIES_COUNT,
  STRATEGY_CATALOG,
  TRADING_PAIRS,
  canAccessStrategy,
  countTodayStrategySignals,
  formatProUntilDate,
  getActivePlanTier,
  getCreditQuotaForProfile,
  getTierDisplayName,
  isMaxSubscriptionActive,
  isProSubscriptionActive,
  isProSubscriptionExpired,
} from '../data/strategies';
import { authFetch } from '../lib/authFetch';
import { triggerHaptic } from '../lib/securityDlp';
import type {
  AnalysisRecord,
  LiveScannerReport,
  MarketType,
  PlanTier,
  StrategyBreakdownResult,
  StrategyConfig,
  StrategyPerformanceReport,
  UserProfile,
} from '../types/domain';
import {
  deleteCustomNoCodeStrategy,
  readCustomNoCodeStrategies,
  VERNIER_PRO_MAX_EVENT,
  type CustomNoCodeStrategy,
} from '../lib/proMaxStore';
import { AdvancedMarketSentiment } from './AdvancedMarketSentiment';
import { FeatureGuide } from './FeatureGuide';
import { MonteCarloSimulator } from './MonteCarloSimulator';
import { StaggerDeck, WorkspaceShell } from './MotionPrimitives';
import { PositionSizeCalculator } from './PositionSizeCalculator';
import { StrategyPnlChart } from './StrategyPnlChart';
import { NoCodeStrategyBuilderModal, StrategyComparisonPanel } from './StrategyProMaxTools';
import { TradeJournal } from './TradeJournal';
import { NonCustodialRiskNotice } from './TradeRiskConfirmModal';
import { WebhookBuilderModal } from './WebhookBuilderModal';

export type StrategiesSection = 'catalog' | 'scanner' | 'sentiment' | 'analytics' | 'calculator' | 'journal' | 'plans';

interface StrategiesViewProps {
  profile: UserProfile | null;
  strategies: StrategyConfig[];
  analyses?: AnalysisRecord[];
  isSignedIn: boolean;
  uid?: string | null;
  privacyMode?: boolean;
  pushSubscribed?: boolean;
  portfolioBalanceUsdt?: number;
  onOpenPushSettings?: () => void;
  onRequireLogin: () => void;
  onSwitchPlan: (target: PlanTier, maxMultiplier?: 10 | 20) => Promise<void> | void;
  onConsumeCredits?: (amount: number, auditReason?: string) => Promise<boolean>;
  onOpenPairOnMarket?: (symbol: string, marketType: MarketType) => void;
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
  externalSection?: { section: StrategiesSection; nonce: number } | null;
}

function formatScannerPrice(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—';
  if (value >= 1000) return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (value >= 10) return `$${value.toFixed(3)}`;
  if (value >= 1) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(5)}`;
}

export const StrategiesView: React.FC<StrategiesViewProps> = ({
  profile,
  strategies,
  analyses = [],
  isSignedIn,
  uid = null,
  privacyMode = false,
  pushSubscribed = false,
  portfolioBalanceUsdt,
  onOpenPushSettings,
  onRequireLogin,
  onSwitchPlan,
  onConsumeCredits,
  onOpenPairOnMarket,
  onSaveStrategy,
  externalSection,
}) => {
  const [section, setSection] = useState<StrategiesSection>('catalog');
  const [selectedMaxMultiplier, setSelectedMaxMultiplier] = useState<10 | 20>(() =>
    profile?.maxMultiplier === 20 ? 20 : 10
  );

  useEffect(() => {
    if (externalSection?.section) {
      setSection(externalSection.section);
    }
  }, [externalSection]);

  const [proMonthPrice, setProMonthPrice] = useState<number | null>(null);
  const [maxMonthPrice, setMaxMonthPrice] = useState<number | null>(null);
  const selectedMaxQuota = selectedMaxMultiplier === 20 ? MAX_X20_MONTHLY_QUOTA : MAX_X10_MONTHLY_QUOTA;
  const activeMaxQuota = profile?.maxMultiplier === 20 ? MAX_X20_MONTHLY_QUOTA : MAX_X10_MONTHLY_QUOTA;
  useEffect(() => {
    let cancelled = false;
    fetch('/api/billing/plans')
      .then(
        (r) =>
          r.json() as Promise<{
            plans?: { month?: { priceUsd?: number } };
            tiers?: {
              pro?: { month?: { priceUsd?: number } };
              max?: { month?: { priceUsd?: number } };
            };
          }>
      )
      .then((d) => {
        if (cancelled) return;
        const pPrice = d.tiers?.pro?.month?.priceUsd ?? d.plans?.month?.priceUsd;
        const mPrice = d.tiers?.max?.month?.priceUsd;
        if (typeof pPrice === 'number') setProMonthPrice(pPrice);
        if (typeof mPrice === 'number') setMaxMonthPrice(mPrice);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const [marketFilter, setMarketFilter] = useState<'all' | MarketType>('all');
  const [tierFilter, setTierFilter] = useState<'all' | PlanTier>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLimit, setDraftLimit] = useState<number>(0);
  const [draftConfidence, setDraftConfidence] = useState<number>(72);
  const [draftRisk, setDraftRisk] = useState<number>(1.5);
  const [draftLeverage, setDraftLeverage] = useState<number>(5);
  const [draftPairs, setDraftPairs] = useState<string[]>(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  // MAX #8 & #12: No-Code конструктор стратегий + Webhook / Telegram
  const [customStrategies, setCustomStrategies] = useState<CustomNoCodeStrategy[]>(() =>
    readCustomNoCodeStrategies()
  );
  const [builderOpen, setBuilderOpen] = useState(false);
  const [webhookOpen, setWebhookOpen] = useState(false);

  useEffect(() => {
    const sync = () => setCustomStrategies(readCustomNoCodeStrategies());
    window.addEventListener(VERNIER_PRO_MAX_EVENT, sync);
    return () => window.removeEventListener(VERNIER_PRO_MAX_EVENT, sync);
  }, []);

  // Real OHLCV backtest breakdown for catalog comparison badges (never fabricated)
  const [catalogBacktest, setCatalogBacktest] = useState<Record<string, StrategyBreakdownResult>>({});
  useEffect(() => {
    let cancelled = false;
    const payload = {
      interval: '1h',
      depositUsdt: 2500,
      scope: 'all',
      strategies: STRATEGY_CATALOG.map((tpl) => ({
        strategyKey: tpl.key,
        name: tpl.name,
        shortTag: tpl.shortTag,
        marketType: tpl.marketType,
        enabled: true,
        riskPerTradePct: tpl.defaultRiskPct,
        leverage: tpl.marketType === 'futures' ? tpl.defaultLeverage : 1,
        pairs: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'],
      })),
    };
    authFetch('/api/strategies/pnl', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then((res) => (res.ok ? (res.json() as Promise<StrategyPerformanceReport>) : null))
      .then((report) => {
        if (cancelled || !report?.breakdown) return;
        const map: Record<string, StrategyBreakdownResult> = {};
        for (const item of report.breakdown) {
          map[item.strategyKey] = item;
        }
        setCatalogBacktest(map);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const freeBaselineAvgPnlPct = useMemo(() => {
    const freeKeys = STRATEGY_CATALOG.filter((t) => t.tier === 'free').map((t) => t.key);
    const values = freeKeys
      .map((k) => catalogBacktest[k]?.totalPnlPct)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (values.length === 0) return null;
    return values.reduce((acc, v) => acc + v, 0) / values.length;
  }, [catalogBacktest]);

  const freeBaselineAvgWinRatePct = useMemo(() => {
    const freeKeys = STRATEGY_CATALOG.filter((t) => t.tier === 'free').map((t) => t.key);
    const values = freeKeys
      .map((k) => catalogBacktest[k]?.winRatePct)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
    if (values.length === 0) return null;
    return values.reduce((acc, v) => acc + v, 0) / values.length;
  }, [catalogBacktest]);

  const maxStrategiesAvgWinRatePct = useMemo(() => {
    const maxKeys = STRATEGY_CATALOG.filter((t) => t.tier === 'max').map((t) => t.key);
    const values = maxKeys
      .map((k) => catalogBacktest[k]?.winRatePct)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
    if (values.length === 0) return null;
    return values.reduce((acc, v) => acc + v, 0) / values.length;
  }, [catalogBacktest]);

  const activePlanTier = getActivePlanTier(profile);
  const isPro = isProSubscriptionActive(profile);
  const isMax = isMaxSubscriptionActive(profile);
  const isExpiredPro = isProSubscriptionExpired(profile);
  const totalCreditQuota = getCreditQuotaForProfile(profile);
  const tierLabel = getTierDisplayName(activePlanTier);
  const isCreditsExhausted = Boolean(isSignedIn && profile && profile.creditsRemaining <= 0);

  // Live Multi-Pair Setup Scanner state (PRO: TOP-16, MAX: ALL 44 + 4H)
  const [scannerTf, setScannerTf] = useState<'1h' | '4h'>('1h');
  const [scannerMarket, setScannerMarket] = useState<'all' | MarketType>('all');
  const [scannerMinConf, setScannerMinConf] = useState<number>(72);
  const [scannerReport, setScannerReport] = useState<LiveScannerReport | null>(null);
  const [scannerLoading, setScannerLoading] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);

  const runLiveScanner = useCallback(
    async (tfOverride?: '1h' | '4h') => {
      const targetTf = tfOverride ?? (isMax ? scannerTf : '1h');
      setScannerLoading(true);
      setScannerError(null);
      try {
        const res = await authFetch('/api/strategies/scanner', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            timeframe: targetTf,
            minConfidence: scannerMinConf,
            marketFilter: scannerMarket,
          }),
        });
        const data = (await res.json()) as LiveScannerReport & { error?: string };
        if (!res.ok) {
          throw new Error(data.error || 'Не удалось выполнить сканирование рынка');
        }
        setScannerReport(data);
      } catch (err) {
        setScannerError(err instanceof Error ? err.message : 'Ошибка сканера торговых сетапов');
      } finally {
        setScannerLoading(false);
      }
    },
    [isMax, scannerTf, scannerMinConf, scannerMarket]
  );

  useEffect(() => {
    if (section === 'scanner' && !scannerReport && !scannerLoading) {
      void runLiveScanner();
    }
  }, [section, scannerReport, scannerLoading, runLiveScanner]);

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
      setFeedback({ text: `Параметры стратегии «${cfg.name}» сохранены.`, tone: 'success' });
    } catch (err) {
      setFeedback({
        text: err instanceof Error ? err.message : 'Ошибка сохранения стратегии',
        tone: 'error',
      });
    } finally {
      setSavingId(null);
    }
  };

  const handleToggle = async (cfg: StrategyConfig) => {
    setSavingId(cfg.id);
    setFeedback(null);
    try {
      const nextEnabled = !cfg.enabled;
      await onSaveStrategy(cfg.id, {
        enabled: nextEnabled,
        dailySignalLimit: isPro ? cfg.dailySignalLimit : FREE_DAILY_SIGNAL_LIMIT,
        minConfidence: cfg.minConfidence,
        riskPerTradePct: cfg.riskPerTradePct,
        leverage: cfg.marketType === 'spot' ? 1 : isPro ? cfg.leverage : Math.min(FREE_MAX_LEVERAGE, cfg.leverage),
        pairs: cfg.pairs.length > 0 ? cfg.pairs : ['BTCUSDT'],
      });
      setFeedback({
        text: `Стратегия «${cfg.name}» ${nextEnabled ? 'активирована' : 'приостановлена'}.`,
        tone: 'success',
      });
    } catch (err) {
      setFeedback({
        text: err instanceof Error ? err.message : 'Не удалось изменить статус стратегии',
        tone: 'error',
      });
    } finally {
      setSavingId(null);
    }
  };

  const displayList = STRATEGY_CATALOG.filter(
    (tpl) =>
      (marketFilter === 'all' || tpl.marketType === marketFilter) &&
      (tierFilter === 'all' || tpl.tier === tierFilter)
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
    (s) => s.enabled && canAccessStrategy(s.strategyKey, activePlanTier)
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
        label: 'Каталог',
        icon: <Layers className="w-3.5 h-3.5 text-emerald-400" />,
        meta: `${activeCount}/${STRATEGY_CATALOG.length}`,
      },
      {
        id: 'scanner' as const,
        label: 'AI-сканер',
        icon: <Radar className="w-3.5 h-3.5 text-cyan-400" />,
        meta: isMax ? '44' : isPro ? 'PRO' : undefined,
      },
      {
        id: 'sentiment' as const,
        label: 'Sentiment',
        icon: <Gauge className="w-3.5 h-3.5 text-emerald-400" />,
        meta: isPro ? 'LIVE' : 'PRO',
      },
      {
        id: 'analytics' as const,
        label: 'Доходность PnL',
        icon: <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />,
      },
      {
        id: 'calculator' as const,
        label: 'Калькулятор',
        icon: <Calculator className="w-3.5 h-3.5 text-amber-400" />,
      },
      {
        id: 'journal' as const,
        label: 'Дневник',
        icon: <BookOpen className="w-3.5 h-3.5 text-emerald-400" />,
      },
    ],
    [activeCount, isMax, isPro]
  );

  const dailySignalsLabel = isPro
    ? hasUnlimitedProSignals || activeCount > 0
      ? `Без ограничений (${tierLabel})`
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
        <span
          className={
            isMax
              ? 'text-cyan-300 font-semibold'
              : isPro
                ? 'text-amber-400 font-semibold'
                : isExpiredPro
                  ? 'text-rose-400 font-semibold'
                  : 'text-slate-200'
          }
        >
          {isPro
            ? `${tierLabel} · до ${formatProUntilDate(profile?.proUntil)}`
            : isExpiredPro
              ? 'Подписка истекла'
              : 'Бесплатный'}
        </span>
      </div>
      {(!isMax || isCreditsExhausted) && (
        <button
          type="button"
          onClick={() => void onSwitchPlan(isPro && !isCreditsExhausted ? 'max' : isMax ? 'max' : 'pro', selectedMaxMultiplier)}
          className={`pt-1 font-sans text-left font-semibold transition-colors ${
            isPro ? 'text-cyan-300 hover:text-cyan-200' : 'text-amber-300 hover:text-amber-200'
          }`}
        >
          {isCreditsExhausted && isMax
            ? `Продлить MAX (+${activeMaxQuota.toLocaleString('ru-RU')} кр.) →`
            : isCreditsExhausted && isPro
              ? `Продлить PRO (+${PRO_MONTHLY_QUOTA} кр.) →`
              : isPro
                ? `Перейти на MAX (до ${MAX_X20_MONTHLY_QUOTA.toLocaleString('ru-RU')} кр.) →`
                : isExpiredPro
                  ? 'Продлить подписку →'
                  : 'Перейти на PRO / MAX →'}
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
        subtitle={`${activeCount} активных · ${isPro ? `${tierLabel} ∞/день` : `${totalConfiguredSignals}/день`}`}
        icon={
          <img
            src="/src/assets/images/terminal_icon_strategy_1794855842754.jpg"
            alt="Стратегии Vernier"
            referrerPolicy="no-referrer"
            className="w-8 h-8 rounded-lg object-cover border border-amber-500/25"
          />
        }
        items={sectionTabs}
        activeId={section}
        onChange={setSection}
        layoutId="strategies-workspace-nav"
        accent="amber"
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
                        ? `Срок действия подписки истёк (${formatProUntilDate(profile?.proUntil)})`
                        : isMax
                          ? `Месячные кредиты MAX исчерпаны (0/${activeMaxQuota.toLocaleString('ru-RU')})`
                          : isPro
                            ? `Месячные кредиты PRO исчерпаны (0/${PRO_MONTHLY_QUOTA})`
                            : `Лимит бесплатных кредитов достигнут (0/${totalCreditQuota})`}
                    </div>
                    <p className="text-amber-200/80 leading-relaxed">
                      {isMax
                        ? `Продлите тариф MAX, чтобы сразу пополнить +${activeMaxQuota.toLocaleString('ru-RU')} кредитов для анализа, сканера и 1D-бэктеста.`
                        : isPro
                          ? `Продлите PRO (+${PRO_MONTHLY_QUOTA} кр.) или перейдите на MAX X10 / X20 (1 000–2 000 кредитов в месяц).`
                          : `Перейдите на PRO (${PRO_MONTHLY_QUOTA} кр./мес) или MAX (1 000–2 000 кр./мес): доступ ко всем ${STRATEGY_CATALOG.length} стратегиям, плечу до 20x и снятие лимита сигналов.`}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void onSwitchPlan(isMax ? 'max' : 'pro', selectedMaxMultiplier)}
                  className="cta-shimmer min-h-[40px] px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                >
                  <Crown className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {isMax
                      ? `Продлить MAX (+${activeMaxQuota.toLocaleString('ru-RU')} кр.)`
                      : isPro
                        ? `Продлить PRO (+${PRO_MONTHLY_QUOTA} кр.)`
                        : isExpiredPro
                          ? 'Продлить подписку'
                          : 'Перейти на PRO / MAX'}
                  </span>
                </button>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex items-center p-1 rounded-xl bg-[#111827] border border-white/8">
                  {(
                    [
                      { id: 'all', label: `Все (${STRATEGY_CATALOG.length})` },
                      { id: 'spot', label: `Спот (${SPOT_STRATEGIES_COUNT})` },
                      { id: 'futures', label: `Фьючерсы (${FUTURES_STRATEGIES_COUNT})` },
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
                      { id: 'all', label: 'Все тарифы' },
                      { id: 'free', label: 'Free' },
                      { id: 'pro', label: 'PRO' },
                      { id: 'max', label: `MAX (${MAX_EXCLUSIVE_STRATEGIES_COUNT})` },
                    ] as const
                  ).map((tr) => {
                    const active = tierFilter === tr.id;
                    return (
                      <button
                        key={tr.id}
                        type="button"
                        onClick={() => setTierFilter(tr.id)}
                        className={`min-h-[34px] px-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                          active
                            ? tr.id === 'max'
                              ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-400/40'
                              : tr.id === 'pro'
                                ? 'bg-amber-500/25 text-amber-200 border border-amber-400/40'
                                : 'bg-white/12 text-white'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {tr.label}
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

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(10);
                    setBuilderOpen(true);
                  }}
                  className="min-h-[36px] px-3 rounded-xl border border-cyan-500/40 bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-200 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
                >
                  <Plus className="w-3.5 h-3.5 shrink-0" />
                  <span>Создать стратегию</span>
                  <span className="text-[9px] font-mono px-1 rounded bg-cyan-400/20">MAX</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(10);
                    setWebhookOpen(true);
                  }}
                  className="min-h-[36px] px-3 rounded-xl border border-white/12 bg-white/5 hover:bg-white/10 text-slate-200 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
                >
                  <Webhook className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
                  <span>Webhook / TG</span>
                </button>
              </div>
              {feedback && (
                <div
                  className={`w-full rounded-xl border px-3 py-2 text-xs ${
                    feedback.tone === 'error'
                      ? 'border-rose-500/35 bg-rose-500/10 text-rose-200'
                      : 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200'
                  }`}
                >
                  {feedback.text}
                </div>
              )}
            </div>

            <FeatureGuide
              title="Как работает Каталог стратегий (Спот + Фьючерсы)"
              summary="Включайте и настраивайте 27 алгоритмических стратегий под свой риск, плечо и список пар. Бейдж Win Rate рассчитывается на реальных исторических свечах 1H."
              steps={[
                'Фильтруйте стратегии по рынку (Спот / Фьючерсы), тарифу (Free / PRO / MAX) и статусу.',
                'Нажмите «Настроить», чтобы изменить риск на сделку, плечо, порог уверенности и пары.',
                'В Demo-режиме (вкладка «Защита» или бейдж тарифа сверху) можно свободно тестировать все PRO и MAX стратегии с локальным сохранением.',
              ]}
              compact
            />

            {/* MAX #8: Пользовательские No-Code стратегии */}
            {customStrategies.length > 0 && (
              <div className="rounded-2xl border border-cyan-500/25 bg-cyan-500/[0.05] p-3.5 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-cyan-200 inline-flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-cyan-300" />
                    <span>Ваши No-Code стратегии ({customStrategies.length})</span>
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">Сохранено локально</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {customStrategies.map((cs) => (
                    <div
                      key={cs.id}
                      className="rounded-xl border border-white/10 bg-[#0B0F17] p-3 flex items-start justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold text-white truncate">{cs.name}</span>
                          <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-200 font-mono text-[10px]">
                            {cs.marketType === 'futures' ? 'Futures' : 'Spot'} · {cs.logic === 'AND' ? 'И' : 'ИЛИ'}
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-slate-400 flex flex-wrap gap-x-2">
                          {cs.rules.map((r) => (
                            <span key={r.id}>
                              {r.indicator} {r.operator} {r.value}
                            </span>
                          ))}
                        </div>
                        <div className="text-[11px] font-mono tabular-nums text-emerald-400">
                          Оценка: +{cs.backtestRoiPct}% ROI · WR {cs.backtestWinRatePct}%
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          deleteCustomNoCodeStrategy(cs.id);
                          setCustomStrategies(readCustomNoCodeStrategies());
                        }}
                        aria-label={`Удалить стратегию ${cs.name}`}
                        className="p-1.5 rounded-lg border border-rose-500/25 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(tierFilter === 'all' || tierFilter === 'max') && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                className="rounded-2xl border border-cyan-400/25 bg-gradient-to-r from-cyan-500/[0.08] via-[#111827] to-emerald-500/[0.06] px-4 py-3 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-white">
                    <span
                      className={`badge-shimmer-max inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-cyan-400/45 bg-cyan-500/20 text-cyan-200 font-mono text-[10px] font-bold tracking-wide ${
                        maxStrategiesAvgWinRatePct !== null && maxStrategiesAvgWinRatePct > 55
                          ? 'max-badge-wr-pulse'
                          : ''
                      }`}
                    >
                      <Sparkles className="w-3 h-3 shrink-0" />
                      <span>MAX EXCLUSIVE</span>
                    </span>
                    <span>{MAX_EXCLUSIVE_STRATEGIES_COUNT} институциональных стратегий (Спот + Фьючерсы) с Win Rate 55%+</span>
                  </div>
                  <div className="text-[11px] text-slate-300 font-mono tabular-nums flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    {maxStrategiesAvgWinRatePct !== null ? (
                      <>
                        <span>
                          Ср. Win Rate (1H бэктест):{' '}
                          <strong className="text-emerald-300">{maxStrategiesAvgWinRatePct.toFixed(1)}%</strong>
                        </span>
                        {freeBaselineAvgWinRatePct !== null &&
                          maxStrategiesAvgWinRatePct > freeBaselineAvgWinRatePct && (
                            <>
                              <span className="text-slate-600" aria-hidden="true">·</span>
                              <span className="text-cyan-300">
                                +{(maxStrategiesAvgWinRatePct - freeBaselineAvgWinRatePct).toFixed(1)} п.п. к ср. Free
                              </span>
                            </>
                          )}
                      </>
                    ) : (
                      <span className="font-sans text-slate-400">
                        SMC Order Block · FVG Fill · Wyckoff Spring · Keltner · VWAP · Quant Regime
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.96 }}
                    onClick={() => setTierFilter(tierFilter === 'max' ? 'all' : 'max')}
                    className="min-h-[34px] px-3 rounded-lg border border-cyan-400/35 bg-cyan-500/12 hover:bg-cyan-500/22 text-cyan-200 text-xs font-semibold whitespace-nowrap transition-colors"
                  >
                    {tierFilter === 'max' ? 'Показать все тарифы' : `Только MAX (${MAX_EXCLUSIVE_STRATEGIES_COUNT})`}
                  </motion.button>
                  {!isMax && (
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.96 }}
                      onClick={() => void onSwitchPlan('max')}
                      className="cta-shimmer min-h-[34px] px-3 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-slate-950 text-xs font-bold whitespace-nowrap transition-colors"
                    >
                      Открыть MAX
                    </motion.button>
                  )}
                </div>
              </motion.div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <AnimatePresence mode="popLayout" initial={false}>
                {displayList.map(({ tpl, cfg }, idx) => {
                  const isEditing = cfg && editingId === cfg.id;
                  const isMaxStrategy = tpl.tier === 'max';
                  const isProStrategy = tpl.tier === 'pro';
                  const isLockedForUser = !canAccessStrategy(tpl.key, activePlanTier);
                  const isActive = Boolean(cfg?.enabled) && !isLockedForUser;
                  const usedSignalsToday = isSignedIn ? countTodayStrategySignals(analyses, tpl.key) : 0;
                  const isDailyFreeLimitHit = !isPro && isSignedIn && usedSignalsToday >= FREE_DAILY_SIGNAL_LIMIT;
                  const isProUnlimitedLimit = isPro && (cfg?.dailySignalLimit ?? 0) === 0;
                  const bt = catalogBacktest[tpl.key];
                  const isHighWinRate = Boolean(bt && bt.winRatePct >= 55);
                  const isMaxWinRatePulse = Boolean(isMaxStrategy && bt && bt.winRatePct > 55);
                  const wrDeltaVsFree =
                    bt && freeBaselineAvgWinRatePct !== null
                      ? Number((bt.winRatePct - freeBaselineAvgWinRatePct).toFixed(1))
                      : null;
                  const isRealOutperformer = Boolean(
                    bt &&
                      bt.totalPnlPct > 0 &&
                      freeBaselineAvgPnlPct !== null &&
                      bt.totalPnlPct > freeBaselineAvgPnlPct
                  );

                  return (
                    <motion.div
                      key={tpl.key}
                      layout="position"
                      initial={{ opacity: 0, y: 12, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -10, scale: 0.96 }}
                      whileHover={{ y: -2 }}
                      transition={{ duration: 0.22, delay: Math.min(idx * 0.02, 0.14), ease: [0.22, 1, 0.36, 1] }}
                      className={`relative overflow-hidden rounded-2xl border card-surface-glow p-4 flex flex-col justify-between gap-3.5 transition-colors ${
                        isMaxStrategy
                          ? 'bg-gradient-to-br from-cyan-500/[0.06] via-[#111827] to-emerald-500/[0.04]'
                          : 'bg-[#111827]'
                      } ${
                        isLockedForUser
                          ? isMaxStrategy
                            ? 'border-cyan-400/35'
                            : 'border-amber-500/20'
                          : isActive
                            ? isMaxStrategy
                              ? 'border-cyan-400/45 shadow-[0_0_24px_-12px_rgba(34,211,238,0.4)]'
                              : 'border-emerald-500/30'
                            : isMaxStrategy
                              ? 'border-cyan-500/25'
                              : 'border-white/8'
                      }`}
                    >
                      {isMaxStrategy && (
                        <div
                          aria-hidden="true"
                          className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-cyan-400 via-emerald-400 to-cyan-400/20"
                        />
                      )}
                      <div>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                              {isMaxStrategy && (
                                <span
                                  className={`badge-shimmer-max px-1.5 py-0.5 rounded-md border border-cyan-400/45 bg-gradient-to-r from-cyan-500/20 to-emerald-500/15 font-mono text-[10px] font-bold text-cyan-200 tracking-wide inline-flex items-center gap-1 shrink-0 ${
                                    isMaxWinRatePulse ? 'max-badge-wr-pulse' : ''
                                  }`}
                                  title={
                                    isMaxWinRatePulse && bt
                                      ? `MAX стратегия · Win Rate ${bt.winRatePct}% (> 55%)`
                                      : 'Эксклюзивная стратегия тарифа MAX'
                                  }
                                >
                                  <Sparkles className="w-3 h-3 text-cyan-300 shrink-0" />
                                  <span>MAX</span>
                                </span>
                              )}
                            {isProStrategy && (
                              <span className="px-1.5 py-0.5 rounded-md border border-amber-400/35 bg-amber-500/12 font-mono text-[10px] font-semibold text-amber-300 inline-flex items-center gap-1 shrink-0">
                                <Crown className="w-3 h-3 shrink-0" />
                                <span>PRO</span>
                              </span>
                            )}
                            <span>{tpl.shortTag}</span>
                            <span aria-hidden="true">·</span>
                            <span>{tpl.riskProfile}</span>
                            <span aria-hidden="true">·</span>
                            <span>ТФ {tpl.timeframeDefault.toUpperCase()}</span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono text-slate-300">{`${tpl.creditCost} кр.`}</span>
                          </div>
                          <h3 className="mt-1.5 text-sm font-semibold text-white leading-snug">{tpl.name}</h3>
                        </div>

                        {isLockedForUser ? (
                          <button
                            type="button"
                            onClick={() => void onSwitchPlan(isMaxStrategy ? 'max' : 'pro')}
                            className={`min-h-[34px] px-2.5 rounded-lg text-xs font-semibold border inline-flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors ${
                              isMaxStrategy
                                ? 'border-cyan-400/50 bg-cyan-500/20 text-cyan-100 hover:bg-cyan-500/30'
                                : 'border-amber-500/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25'
                            }`}
                          >
                            <Lock className="w-3.5 h-3.5 shrink-0" />
                            <span>{isMaxStrategy ? 'MAX' : 'PRO'}</span>
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
                      <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px] text-slate-400 min-w-0">
                        <div className="min-w-0 leading-snug">
                          <span className="text-slate-500">Осцилляторы: </span>
                          <span className="text-slate-300 font-mono tabular-nums break-words">
                            {tpl.indicatorsUsed.join(' · ')}
                          </span>
                        </div>
                        <div className="min-w-0 sm:text-right text-slate-400 leading-snug truncate">
                          {tpl.marketCondition}
                        </div>
                      </div>

                      {bt ? (
                        <div
                          className={`mt-2.5 rounded-xl border p-2.5 space-y-2 ${
                            isMaxStrategy
                              ? 'border-cyan-400/30 bg-gradient-to-r from-cyan-500/[0.08] via-[#0B0F17] to-emerald-500/[0.07]'
                              : 'border-white/8 bg-[#0B0F17]'
                          }`}
                        >
                          <div className="grid grid-cols-3 gap-1.5 text-[11px] font-mono tabular-nums min-w-0 items-end">
                            <div className="min-w-0">
                              <div className="font-sans text-[10px] text-slate-500 leading-none">Бэктест 1H</div>
                              <div
                                className={`mt-1 font-semibold whitespace-nowrap ${
                                  bt.totalPnlPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                                }`}
                              >
                                {bt.totalPnlPct >= 0 ? '+' : ''}
                                {bt.totalPnlPct.toFixed(2)}%
                              </div>
                            </div>
                            <div className="min-w-0 text-center">
                              <div className="font-sans text-[10px] text-slate-400 leading-none flex items-center justify-center gap-1">
                                <span>Win Rate</span>
                                {isHighWinRate && (
                                  <span className="font-mono text-[9px] font-bold text-emerald-300">
                                    55%+
                                  </span>
                                )}
                              </div>
                              <div
                                className={`mt-1 whitespace-nowrap ${
                                  isMaxStrategy && isHighWinRate
                                    ? 'text-sm font-bold text-emerald-300'
                                    : isHighWinRate
                                      ? 'font-bold text-emerald-300'
                                      : 'font-semibold text-slate-200'
                                }`}
                              >
                                {bt.winRatePct}%
                              </div>
                            </div>
                            <div className="min-w-0 text-right">
                              <div className="font-sans text-[10px] text-slate-500 leading-none">Сделок</div>
                              <div className="mt-1 text-slate-300 whitespace-nowrap">{bt.tradesCount}</div>
                            </div>
                          </div>

                          {(isMaxStrategy || isHighWinRate) && (
                            <div className="space-y-1">
                              <div className="relative h-1.5 w-full rounded-full bg-white/8 overflow-hidden">
                                <div
                                  className={`progress-bar-shine h-full rounded-full transition-all duration-500 ${
                                    isMaxStrategy
                                      ? 'bg-gradient-to-r from-cyan-400 to-emerald-400'
                                      : 'bg-emerald-400'
                                  }`}
                                  style={{ width: `${Math.min(100, Math.max(6, bt.winRatePct))}%` }}
                                />
                                {/* 55% Win Rate benchmark marker */}
                                <span
                                  aria-hidden="true"
                                  title="Порог 55% Win Rate"
                                  className="absolute top-0 bottom-0 w-[1.5px] bg-white/70"
                                  style={{ left: '55%' }}
                                />
                              </div>
                              <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] font-mono tabular-nums">
                                <span className={isMaxStrategy ? 'text-cyan-300 font-semibold' : 'text-emerald-300'}>
                                  {isMaxStrategy
                                    ? `MAX High-WR · ${bt.winRatePct}% (порог 55%)`
                                    : `Повышенный WR · ${bt.winRatePct}%`}
                                </span>
                                {wrDeltaVsFree !== null && wrDeltaVsFree > 0 && (
                                  <span className="text-emerald-300 font-semibold">
                                    +{wrDeltaVsFree} п.п. к Free
                                  </span>
                                )}
                              </div>
                            </div>
                          )}

                          {!isMaxStrategy && isRealOutperformer && isProStrategy && (
                            <div className="pt-1 border-t border-white/6 text-[11px] font-sans font-semibold text-emerald-300 tabular-nums">
                              Выше ср. Free ({freeBaselineAvgPnlPct! >= 0 ? '+' : ''}
                              {freeBaselineAvgPnlPct!.toFixed(2)}%)
                            </div>
                          )}
                        </div>
                      ) : isMaxStrategy ? (
                        <div className="mt-2.5 rounded-xl border border-cyan-400/20 bg-cyan-500/[0.05] px-2.5 py-2 flex items-center justify-between gap-2 text-[11px]">
                          <span className="text-cyan-200 font-medium">Профиль высокой точности MAX (WR 55%+)</span>
                          <span className="font-mono text-[10px] text-slate-400">Бэктест 1H…</span>
                        </div>
                      ) : null}
                    </div>

                    {isLockedForUser ? (
                      <div className="pt-3 border-t border-white/8 flex items-center justify-between gap-2">
                        <span className="text-xs text-slate-400 inline-flex items-center gap-1.5">
                          <Lock className={`w-3.5 h-3.5 shrink-0 ${isMaxStrategy ? 'text-cyan-400' : 'text-amber-400'}`} />
                          <span>{isMaxStrategy ? 'Эксклюзив тарифа MAX' : 'Доступно в PRO и MAX'}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => void onSwitchPlan(isMaxStrategy ? 'max' : 'pro')}
                          className={`min-h-[34px] px-3 rounded-lg text-slate-950 text-xs font-semibold whitespace-nowrap transition-colors ${
                            isMaxStrategy
                              ? 'bg-cyan-400 hover:bg-cyan-300'
                              : 'bg-amber-500 hover:bg-amber-400'
                          }`}
                        >
                          {isMaxStrategy ? 'Открыть MAX' : 'Открыть'}
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
                                    ? `Без ограничений (${tierLabel})`
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
              </AnimatePresence>
            </div>

            <NonCustodialRiskNotice
              variant="card"
              text="VERNIER не принимает, не хранит и не управляет средствами клиентов. Исторические бэктесты и Win Rate не гарантируют будущую доходность. Вход в позицию на вашей бирже через API или вручную выполняется исключительно по вашему согласию под вашу полную финансовую ответственность."
            />

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

        {section === 'scanner' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-4 sm:p-5 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-white flex items-center gap-2">
                    <Radar className="w-4 h-4 text-cyan-400" />
                    <span>AI-сканер живых торговых сетапов</span>
                  </h2>
                  <p className="mt-1 text-xs text-slate-400 max-w-2xl">
                    Автоматический отбор активных точек входа по реальным свечным индикаторам (EMA, RSI, MACD, Bollinger, ATR) сразу по десяткам пар.
                  </p>
                </div>

                <button
                  type="button"
                  disabled={scannerLoading}
                  onClick={() => void runLiveScanner()}
                  className="min-h-[38px] px-3.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-60 text-slate-950 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${scannerLoading ? 'animate-spin' : ''}`} />
                  <span>{scannerLoading ? 'Сканируем пары...' : 'Сканировать рынок'}</span>
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 text-xs">
                <div className="inline-flex items-center p-1 rounded-xl bg-[#0B0F17] border border-white/8">
                  <button
                    type="button"
                    onClick={() => {
                      setScannerTf('1h');
                      void runLiveScanner('1h');
                    }}
                    className={`min-h-[32px] px-3 rounded-lg font-mono font-medium transition-colors ${
                      scannerTf === '1h' ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/35' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    1H
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!isMax) {
                        void onSwitchPlan('max');
                        return;
                      }
                      setScannerTf('4h');
                      void runLiveScanner('4h');
                    }}
                    className={`min-h-[32px] px-3 rounded-lg font-mono font-medium inline-flex items-center gap-1 transition-colors ${
                      scannerTf === '4h' && isMax
                        ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/35'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {!isMax && <Lock className="w-3 h-3 text-cyan-300" />}
                    <span>4H · MAX</span>
                  </button>
                </div>

                <div className="inline-flex items-center p-1 rounded-xl bg-[#0B0F17] border border-white/8">
                  {(
                    [
                      { id: 'all', label: 'Все рынки' },
                      { id: 'spot', label: 'Спот' },
                      { id: 'futures', label: 'Фьючерсы' },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setScannerMarket(m.id)}
                      className={`min-h-[32px] px-3 rounded-lg font-medium transition-colors ${
                        scannerMarket === m.id ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2 rounded-xl border border-white/8 bg-[#0B0F17] px-3 py-1.5">
                  <span className="text-slate-400">Мин. уверенность:</span>
                  <input
                    type="range"
                    min={65}
                    max={85}
                    value={scannerMinConf}
                    onChange={(e) => setScannerMinConf(Number(e.target.value))}
                    className="w-24 accent-cyan-400"
                  />
                  <span className="font-mono font-semibold text-cyan-300">{scannerMinConf}%</span>
                </div>

                {scannerReport && (
                  <span className="ml-auto font-mono text-[11px] text-slate-400">
                    Охват: {scannerReport.scannedPairsCount}/{scannerReport.totalPairsAvailable} пар · Найдено:{' '}
                    <strong className="text-white">{scannerReport.opportunities.length}</strong>
                  </span>
                )}
              </div>

              {!isMax && (
                <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/[0.07] px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-cyan-100">
                    {!isPro
                      ? `На Free сканируются только 3 пары (3 базовые стратегии). В PRO доступны TOP-16 пар и ${PRO_AND_FREE_STRATEGIES_COUNT} стратегий, а в MAX — все ${TRADING_PAIRS.length} пар + ${MAX_EXCLUSIVE_STRATEGIES_COUNT} MAX-алгоритмов (WR 55%+) + 4H.`
                      : `Тариф PRO сканирует TOP-16 пар на 1H. Тариф MAX открывает все ${TRADING_PAIRS.length} пар, 4H и ${MAX_EXCLUSIVE_STRATEGIES_COUNT} эксклюзивных MAX-стратегий (WR 55%+).`}
                  </span>
                  <button
                    type="button"
                    onClick={() => void onSwitchPlan(isPro ? 'max' : 'pro')}
                    className="font-semibold text-cyan-300 hover:text-cyan-200 whitespace-nowrap"
                  >
                    {isPro ? 'Открыть 44 пары в MAX →' : 'Открыть сканер PRO →'}
                  </button>
                </div>
              )}

              {scannerError && (
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">
                  {scannerError}
                </div>
              )}
            </div>

            {scannerReport && scannerReport.opportunities.length === 0 && !scannerLoading && (
              <div className="rounded-2xl border border-white/8 bg-[#111827] p-8 text-center space-y-2">
                <p className="text-sm text-slate-300">
                  При пороге уверенности {scannerMinConf}% активных сетапов по выбранным парам сейчас нет.
                </p>
                <p className="text-xs text-slate-500">
                  Понизьте порог уверенности или обновите сканер после закрытия следующей свечи.
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {(scannerReport?.opportunities ?? []).map((opp, idx) => (
                <motion.div
                  key={`${opp.symbol}-${opp.strategyKey}-${opp.direction}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.24, delay: Math.min(idx * 0.035, 0.28), ease: [0.22, 1, 0.36, 1] }}
                  whileHover={{ y: -2 }}
                  className={`rounded-2xl border bg-[#111827] p-4 space-y-3 transition-[border-color,box-shadow] hover:shadow-[0_10px_28px_-14px_rgba(16,185,129,0.28)] ${
                    opp.direction === 'LONG' ? 'border-emerald-500/25 hover:border-emerald-500/45' : 'border-rose-500/25 hover:border-rose-500/45'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold font-mono text-white">{opp.symbol}</span>
                        <span
                          className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded-md ${
                            opp.direction === 'LONG'
                              ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                              : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                          }`}
                        >
                          {opp.direction}
                        </span>
                        <span className="text-[11px] font-mono text-slate-400 uppercase">
                          {opp.marketType === 'futures' ? 'Futures' : 'Spot'} · {opp.timeframe}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-slate-300">{opp.strategyName}</div>
                    </div>

                    <div className="text-right font-mono tabular-nums">
                      <div className="text-[11px] text-slate-400">Уверенность</div>
                      <div className="text-sm font-bold text-cyan-300">{opp.confidence}%</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-1.5 sm:gap-2 text-[11px] font-mono tabular-nums min-w-0">
                    <div className="rounded-xl border border-white/8 bg-[#0B0F17] p-2 min-w-0 overflow-hidden">
                      <div className="font-sans text-[10px] text-slate-500 truncate">Вход</div>
                      <div className="mt-0.5 text-white font-semibold truncate">{formatScannerPrice(opp.entryPrice)}</div>
                    </div>
                    <div className="rounded-xl border border-white/8 bg-[#0B0F17] p-2 min-w-0 overflow-hidden">
                      <div className="font-sans text-[10px] text-slate-500 truncate">Stop-Loss</div>
                      <div className="mt-0.5 text-rose-400 font-semibold truncate">{formatScannerPrice(opp.stopLossPrice)}</div>
                    </div>
                    <div className="rounded-xl border border-white/8 bg-[#0B0F17] p-2 min-w-0 overflow-hidden">
                      <div className="font-sans text-[10px] text-slate-500 truncate">Take-Profit</div>
                      <div className="mt-0.5 text-emerald-400 font-semibold truncate">{formatScannerPrice(opp.takeProfitPrice)}</div>
                    </div>
                  </div>

                  <div className="flex flex-col min-[380px]:flex-row min-[380px]:items-center justify-between gap-2 pt-1 text-[11px] font-mono tabular-nums text-slate-400">
                    <div className="grid grid-cols-3 gap-1.5 min-w-0 flex-1">
                      <span className="text-amber-300 font-semibold whitespace-nowrap truncate">
                        R:R 1:{opp.riskRewardRatio}
                      </span>
                      <span className="text-slate-300 whitespace-nowrap truncate text-center">
                        RSI {opp.rsi14}
                      </span>
                      <span
                        className={`whitespace-nowrap truncate text-right font-semibold ${
                          opp.change24hPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        24ч {opp.change24hPct >= 0 ? '+' : ''}
                        {opp.change24hPct.toFixed(1)}%
                      </span>
                    </div>
                    {onOpenPairOnMarket && (
                      <motion.button
                        whileTap={{ scale: 0.96 }}
                        type="button"
                        onClick={() => onOpenPairOnMarket(opp.symbol, opp.marketType)}
                        className="font-sans min-h-[32px] px-2.5 rounded-lg border border-cyan-500/35 bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-200 font-semibold inline-flex items-center justify-center gap-1 whitespace-nowrap shrink-0 transition-colors"
                      >
                        <span>На график</span>
                        <ArrowUpRight className="w-3.5 h-3.5 shrink-0" />
                      </motion.button>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>

            <NonCustodialRiskNotice
              text="Сигналы Live-сканера носят аналитический характер. VERNIER не принимает и не хранит ваши деньги; любые реальные сделки на бирже (вручную или через API) открываются исключительно по вашему решению и под вашу финансовую ответственность."
            />
          </div>
        )}

        {section === 'sentiment' && (
          <AdvancedMarketSentiment
            isPro={isPro}
            isMax={isMax}
            isSignedIn={isSignedIn}
            creditsRemaining={profile?.creditsRemaining}
            onUpgradePro={() => void onSwitchPlan('pro')}
            onUpgradeMax={(mult) => void onSwitchPlan('max', mult ?? selectedMaxMultiplier)}
            onConsumeCredits={onConsumeCredits}
            onOpenPairOnMarket={onOpenPairOnMarket}
          />
        )}

        {section === 'analytics' && (
          <div data-tour-id="tour-strategies-pnl" className="space-y-4">
            <StrategyPnlChart
              strategies={strategies}
              isPro={isPro}
              isMax={isMax}
              isSignedIn={isSignedIn}
              creditsRemaining={profile?.creditsRemaining}
              creditQuota={totalCreditQuota}
              onUpgradePro={() => void onSwitchPlan('pro')}
              onUpgradeMax={() => void onSwitchPlan('max', selectedMaxMultiplier)}
              onConsumeCredits={onConsumeCredits}
            />
            {/* PRO #9: Сравнение 2 стратегий бок о бок с комиссией и проскальзыванием */}
            <StrategyComparisonPanel breakdown={Object.values(catalogBacktest)} />
            {/* MAX #7: Симулятор Монте-Карло (500 прогонов) + Критерий Келли */}
            <MonteCarloSimulator
              isMax={isMax}
              onUpgradeMax={() => void onSwitchPlan('max', selectedMaxMultiplier)}
            />
          </div>
        )}

        {section === 'calculator' && (
          <PositionSizeCalculator
            strategies={strategies}
            isPro={isPro}
            isMax={isMax}
            portfolioBalanceUsdt={portfolioBalanceUsdt}
            onUpgradePro={() => void onSwitchPlan('pro')}
            onSavedToJournal={() => setSection('journal')}
          />
        )}

        {section === 'journal' && (
          <TradeJournal
            uid={isSignedIn ? uid : null}
            isPro={isPro}
            isMax={isMax}
            privacyMode={privacyMode}
            onUpgradePro={() => void onSwitchPlan('pro')}
            onRequireLogin={onRequireLogin}
          />
        )}

        {section === 'plans' && (
          <div className="space-y-4">
            <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Free */}
              <div className="rounded-2xl border border-white/8 bg-[#111827] p-5 flex flex-col justify-between gap-4">
                <div>
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-semibold text-white">Базовый (Free)</h2>
                    <span className="font-mono text-sm font-semibold text-slate-300">$0 / мес</span>
                  </div>
                  <p className="mt-1.5 text-xs text-slate-400">
                    Для знакомства с терминалом на базовом скринере, классических стратегиях и локальном дневнике.
                  </p>
                  <ul className="mt-3.5 space-y-2 text-xs sm:text-sm text-slate-300">
                    <li className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <span>
                        {FREE_WEEKLY_QUOTA} кредитов каждые 7 дней (до 3 AI-анализов в день)
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <span>Классические базовые стратегии, плечо до {FREE_MAX_LEVERAGE}x и 1 сигнал/день</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <span>Базовый скринер, калькулятор риска, локальный дневник сделок и PIN-блокировка</span>
                    </li>
                  </ul>
                </div>
                <div className="min-h-[40px] rounded-xl border border-white/10 bg-[#0B0F17] text-slate-400 text-xs font-medium flex items-center justify-center">
                  {activePlanTier === 'free' ? 'Текущий базовый тариф' : 'Базовый функционал включён'}
                </div>
              </div>

              {/* PRO — gold-emerald highlight */}
              <div className="relative rounded-2xl border-2 border-amber-400/60 bg-gradient-to-b from-emerald-500/[0.11] via-[#111827] to-[#111827] p-5 flex flex-col justify-between gap-4 shadow-lg shadow-amber-500/10">
                <div className="absolute -top-3 left-5 px-2.5 py-0.5 rounded-full bg-gradient-to-r from-amber-400 to-emerald-400 text-slate-950 text-[10px] font-bold tracking-wider uppercase">
                  ХИТ · РЕКОМЕНДУЕМ
                </div>
                <div>
                  <div className="flex items-center justify-between pt-1">
                    <h2 className="text-base font-semibold text-white flex items-center gap-2">
                      <Crown className="w-5 h-5 text-amber-400" />
                      <span>PRO Терминал</span>
                    </h2>
                    <span className="font-mono text-sm font-semibold text-amber-400">
                      {proMonthPrice !== null ? `$${proMonthPrice} / мес` : '$19 / мес'}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-slate-300">
                    {PRO_MONTHLY_QUOTA} кредитов в месяц и полный набор рабочих инструментов активного трейдера.
                  </p>
                  <ul className="mt-3.5 space-y-2 text-xs sm:text-sm text-slate-200">
                    <li className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <span>{PRO_MONTHLY_QUOTA} кредитов/мес + безлимитный AI-перевод и разбор новостей</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <span>Все {STRATEGY_CATALOG.length} стратегий (Smart Money / Order Blocks, RSI дивергенции, BB Squeeze)</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <span>Мульти-таймфрейм консенсус (15m + 1H + 4H), Sentiment PRO и сканер TOP-16 пар</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <span>Multi-TP 30/40/30% матрица, 4H-бэктест, экспорт дневника и скринера в CSV</span>
                    </li>
                  </ul>
                </div>

                {isMax ? (
                  <div className="min-h-[40px] w-full rounded-xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-200 text-xs font-semibold flex items-center justify-center">
                    Все возможности PRO включены в MAX
                  </div>
                ) : isPro ? (
                  <div className="space-y-2">
                    <div className="min-h-[40px] w-full rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-xs font-semibold flex items-center justify-center gap-2">
                      <ShieldCheck className="w-4 h-4" />
                      <span>
                        PRO до {formatProUntilDate(profile?.proUntil)} · {profile?.creditsRemaining ?? 0}/{PRO_MONTHLY_QUOTA} кр.
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void onSwitchPlan('pro')}
                      className="min-h-[40px] w-full rounded-xl border border-amber-500/40 bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 text-xs font-semibold transition-colors"
                    >
                      Продлить PRO в Google Play
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => void onSwitchPlan('pro')}
                    className="cta-shimmer min-h-[42px] w-full rounded-xl bg-gradient-to-r from-amber-400 to-emerald-400 hover:brightness-105 text-slate-950 text-sm font-bold transition-all"
                  >
                    {isExpiredPro ? 'Продлить PRO · Google Play' : 'Оформить PRO · Google Play'}
                  </button>
                )}
              </div>

              {/* MAX with interactive X10 / X20 toggles */}
              <div className="rounded-2xl border-2 border-cyan-400/55 bg-gradient-to-b from-cyan-500/[0.12] to-[#111827] p-5 flex flex-col justify-between gap-4">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-base font-semibold text-white flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-cyan-300" />
                      <span>MAX ×{selectedMaxMultiplier}</span>
                    </h2>
                    <span className="font-mono text-sm font-semibold text-cyan-300">
                      {selectedMaxMultiplier === 20
                        ? `$${maxMonthPrice ? Math.round(maxMonthPrice * 1.65) : 79} / мес`
                        : `$${maxMonthPrice ?? 49} / мес`}
                    </span>
                  </div>

                  {/* Interactive X10 / X20 Toggle */}
                  <div className="mt-3 p-1 rounded-xl bg-[#071010] border border-cyan-500/30 grid grid-cols-2 gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic(10);
                        setSelectedMaxMultiplier(10);
                      }}
                      className={`min-h-[34px] rounded-lg text-xs font-mono font-bold transition-all ${
                        selectedMaxMultiplier === 10
                          ? 'bg-cyan-400 text-slate-950 shadow-sm'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      X10 · 1 000 кр.
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic(10);
                        setSelectedMaxMultiplier(20);
                      }}
                      className={`min-h-[34px] rounded-lg text-xs font-mono font-bold transition-all ${
                        selectedMaxMultiplier === 20
                          ? 'bg-gradient-to-r from-cyan-400 to-emerald-400 text-slate-950 shadow-sm'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      X20 · 2 000 кр.
                    </button>
                  </div>

                  <p className="mt-2.5 text-xs text-cyan-100/85">
                    Всё из PRO + <strong>{selectedMaxQuota.toLocaleString('ru-RU')} кредитов/мес (×{selectedMaxMultiplier} квоты PRO)</strong> и институциональные модули.
                  </p>
                  <ul className="mt-3 space-y-2 text-xs sm:text-sm text-slate-100">
                    <li className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-cyan-300 shrink-0 mt-0.5" />
                      <span>«AI-Консилиум» (3 оценки: Тех. анализ, Деривативы/Фандинг, Риск-менеджмент)</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-cyan-300 shrink-0 mt-0.5" />
                      <span>Радар аномалий фандинга и ликвидаций + сканер всех {TRADING_PAIRS.length} пар (1H/4H)</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-cyan-300 shrink-0 mt-0.5" />
                      <span>«Анти-FOMO защита», симулятор Монте-Карло и 1D-бэктест без списания кредитов (0 кр.)</span>
                    </li>
                  </ul>
                </div>

                {isMax ? (
                  <div className="space-y-2">
                    <div className="min-h-[40px] w-full rounded-xl border border-cyan-500/35 bg-cyan-500/15 text-cyan-200 text-xs font-semibold flex items-center justify-center gap-2">
                      <ShieldCheck className="w-4 h-4" />
                      <span>
                        MAX до {formatProUntilDate(profile?.proUntil)} · {profile?.creditsRemaining ?? 0}/
                        {activeMaxQuota.toLocaleString('ru-RU')} кр.
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void onSwitchPlan('max', selectedMaxMultiplier)}
                      className="min-h-[40px] w-full rounded-xl border border-cyan-500/45 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-100 text-xs font-semibold transition-colors"
                    >
                      Управлять MAX ×{selectedMaxMultiplier} · Google Play
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => void onSwitchPlan('max', selectedMaxMultiplier)}
                    className="cta-shimmer min-h-[42px] w-full rounded-xl bg-cyan-400 hover:bg-cyan-300 text-slate-950 text-sm font-bold transition-colors"
                  >
                    Оформить MAX ×{selectedMaxMultiplier} ({selectedMaxQuota.toLocaleString('ru-RU')} кр.)
                  </button>
                )}
              </div>
            </section>

            <div className="rounded-xl border border-white/8 bg-[#0B0F17] px-4 py-2.5 text-[11px] text-slate-400 leading-relaxed">
              Оплата подписок осуществляется в фиатной валюте через <strong className="text-slate-200">Google Play Billing</strong> (Google Pay / банковская карта). Автопродление можно отменить в любой момент в настройках Google Play.
            </div>
          </div>
        )}
      </WorkspaceShell>

      <NoCodeStrategyBuilderModal
        open={builderOpen}
        onClose={() => setBuilderOpen(false)}
        onSaved={(nextList) => {
          setCustomStrategies(nextList);
          setFeedback({
            text: `Пользовательская стратегия «${nextList[0]?.name ?? 'Новая'}» добавлена в каталог.`,
            tone: 'success',
          });
        }}
      />

      <WebhookBuilderModal
        open={webhookOpen}
        onClose={() => setWebhookOpen(false)}
        sampleSymbol="BTCUSDT"
        samplePrice={94250}
      />
    </StaggerDeck>
  );
};

