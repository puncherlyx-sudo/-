import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  Compass,
  Crown,
  Layers,
  LayoutGrid,
  LogIn,
  LogOut,
  Newspaper,
  Radar,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { AnimatePresence, LayoutGroup, MotionConfig, motion, useScroll, useSpring } from 'framer-motion';
import { BottomSheet, BottomSheetItem } from './components/BottomSheet';
import { InterfaceTour, TOUR_STORAGE_KEY } from './components/InterfaceTour';
import { LegalConsentModal, LegalDocumentModal, type LegalDocKind } from './components/LegalConsentModal';
import { LockScreenOverlay } from './components/LockScreenOverlay';
import type { ScreenerSection } from './components/MarketScreenerView';
import type { StrategiesSection } from './components/StrategiesView';
import { MarketTerminalView } from './components/MarketTerminalView';
import { MiniPortfolioWidget } from './components/MiniPortfolioWidget';
import { NATIVE_PILL_SPRING, tabSlideBlurVariants } from './components/MotionPrimitives';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PinLockOverlay } from './components/PinLockOverlay';
import { PWAInstallButton } from './components/PWAInstallButton';
import { QuickAnswersCard } from './components/QuickAnswersCard';
import type { SecuritySection } from './components/SecurityCenterView';
import { SplashIntro } from './components/MotionExtras';
import { TickerTape } from './components/TickerTape';
import { PricingModal } from './components/PricingModal';
import {
  TradeRiskConfirmModal,
  type PendingApiOrderConfirm,
} from './components/TradeRiskConfirmModal';
import { TwoFactorModal } from './components/TwoFactorModal';
import { ViewFallback } from './components/ViewFallback';
import {
  AndroidWidgetsModal,
  MarketScreenerView,
  NewsFeedView,
  PortfolioDetailsModal,
  prefetchViews,
  SecurityCenterView,
  StandaloneWidgetView,
  StrategiesView,
} from './lazyViews';
import { useAuthAndVault } from './hooks/useAuthAndVault';
import { usePaperPortfolio } from './hooks/usePaperPortfolio';
import { usePushNotifications } from './hooks/usePushNotifications';
import { FearGreedProvider } from './contexts/FearGreedContext';
import {
  PlanProvider,
  accessPlanToPlanTier,
  planTierToAccessPlan,
  type PlanContextValue,
} from './contexts/PlanContext';
import type {
  AnalysisResultPayload,
  AndroidWidgetKind,
  AppTab,
  ExchangeId,
  ExchangeKeyPermissions,
  ExchangeKeyRecord,
  ExchangeOrderResult,
  ExchangeSyncResult,
  MarketType,
  PlanTier,
  PortfolioTargetRecord,
  PriceAlertCondition,
  PriceAlertRecord,
  StrategyConfig,
  Timeframe,
  UserProfile,
} from './types/domain';
import {
  countTodayStrategySignals,
  FREE_DAILY_SIGNAL_LIMIT,
  FREE_MAX_LEVERAGE,
  FREE_WEEKLY_QUOTA,
  getActivePlanTier,
  isProSubscriptionActive,
  MAX_X10_MONTHLY_QUOTA,
  MAX_X20_MONTHLY_QUOTA,
  PRO_MONTHLY_QUOTA,
  STRATEGY_CATALOG,
} from './data/strategies';
import { playAlertChime } from './lib/alertSound';
import { authFetch } from './lib/authFetch';
import {
  appendExchangeSyncErrorLog,
  appendExchangeSyncSuccessLog,
  clearExchangeSyncErrorLogs,
  readExchangeSyncErrorLogs,
  type ExchangeSyncErrorLogEntry,
} from './lib/exchangeSyncErrorLog';
import {
  clearDemoStrategyOverrides,
  createOAuthCsrfState,
  getAntiPhishingCode,
  getDemoPlanOverride,
  getLegalConsent,
  getPinHash,
  getPinTimeoutMinutes,
  getPrivacyMode,
  getThemeMode,
  readDemoStrategyOverrides,
  readLocalPriceAlerts,
  revokeLegalConsent,
  saveDemoStrategyOverride,
  setAntiPhishingCode,
  setDemoPlanOverride,
  setPinHash,
  setPinTimeoutMinutes,
  setPrivacyMode,
  setThemeMode,
  verifyOAuthCsrfState,
  wipeAllLocalAppData,
  writeLocalPriceAlerts,
  type DemoPlanOverride,
  type DemoStrategyOverride,
  type LegalConsentRecord,
  type ThemeMode,
} from './lib/localDemoStore';
import { clearMemoryCache } from './lib/marketCache';
import { hashPinSha256, triggerHaptic } from './lib/securityDlp';

function formatBannerErrorMessage(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') && trimmed.includes('"error"')) {
    try {
      const parsed = JSON.parse(trimmed) as { error?: string; path?: string };
      const errText = String(parsed.error || '');
      if (/permission|insufficient/i.test(errText)) {
        return 'Недостаточно прав Firestore для этой операции. Для тестирования тарифов PRO/MAX используйте Demo Tier Switcher — настройки в демо сохраняются локально.';
      }
      if (errText) return errText.slice(0, 220);
    } catch {
      // Fallback to compact truncated text
    }
  }
  return trimmed.length > 240 ? `${trimmed.slice(0, 240)}…` : trimmed;
}

const LOCAL_PORTFOLIO_TARGETS_KEY = 'aegisquant_portfolio_targets_v1';

interface PendingStepUpAction {
  title: string;
  description: string;
  execute: () => Promise<void>;
  onCancel?: () => void;
}

function getInitialTabFromUrl(): AppTab {
  if (typeof window === 'undefined') return 'market';
  const param = new URLSearchParams(window.location.search).get('tab');
  if (
    param === 'market' ||
    param === 'screener' ||
    param === 'strategies' ||
    param === 'news' ||
    param === 'security'
  ) {
    return param;
  }
  return 'market';
}

function getInitialWidgetFromUrl(): {
  kind: AndroidWidgetKind;
  symbol: string;
  tf: Timeframe;
} | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const w = params.get('widget');
  if (
    w === 'chart' ||
    w === 'price' ||
    w === 'position' ||
    w === 'pnl' ||
    w === 'strategies'
  ) {
    const rawTf = params.get('tf');
    const tf: Timeframe = rawTf === '15m' || rawTf === '4h' || rawTf === '1d' ? rawTf : '1h';
    const symbol = (params.get('symbol') || 'BTCUSDT').toUpperCase();
    return { kind: w, symbol, tf };
  }
  return null;
}

const TAB_ORDER: AppTab[] = ['market', 'screener', 'strategies', 'news', 'security'];

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>(getInitialTabFromUrl);
  const [tabDirection, setTabDirection] = useState<number>(1);
  const [standaloneWidget, setStandaloneWidget] = useState<{
    kind: AndroidWidgetKind;
    symbol: string;
    tf: Timeframe;
  } | null>(getInitialWidgetFromUrl);
  const [widgetsModalOpen, setWidgetsModalOpen] = useState(false);
  const [portfolioModalOpen, setPortfolioModalOpen] = useState(false);
  const [assistantSheetOpen, setAssistantSheetOpen] = useState(false);
  const [pendingStepUp, setPendingStepUp] = useState<PendingStepUpAction | null>(null);
  const [pendingApiOrderConfirm, setPendingApiOrderConfirm] = useState<{
    payload: PendingApiOrderConfirm;
    resolve: (confirmed: boolean) => void;
  } | null>(null);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [pricingOpen, setPricingOpen] = useState(false);
  const [pricingTier, setPricingTier] = useState<'pro' | 'max'>('pro');
  const [pricingMaxMultiplier, setPricingMaxMultiplier] = useState<10 | 20>(10);

  // Vernier Upgrade States: Theme, Privacy, PIN App Lock, Anti-Phishing, Demo Tier, Legal Consent, Local Alerts
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => getThemeMode());
  const [privacyMode, setPrivacyModeState] = useState<boolean>(() => getPrivacyMode());
  const [pinHash, setPinHashState] = useState<string | null>(() => getPinHash());
  const [pinTimeoutMin, setPinTimeoutMinState] = useState<0 | 1 | 5 | 15>(() => getPinTimeoutMinutes());
  const [isPinLocked, setIsPinLocked] = useState<boolean>(() => Boolean(getPinHash()));
  const [antiPhishingCode, setAntiPhishingCodeState] = useState<string>(() => getAntiPhishingCode());
  const [demoPlanOverride, setDemoPlanOverrideState] = useState<DemoPlanOverride | null>(() =>
    getDemoPlanOverride()
  );
  const [legalConsent, setLegalConsent] = useState<LegalConsentRecord | null>(() => getLegalConsent());
  const [legalConsentOpen, setLegalConsentOpen] = useState<boolean>(() => !getLegalConsent());
  const [legalConsentMode, setLegalConsentMode] = useState<'onboarding' | 'auth'>('onboarding');
  const [pendingLoginAfterConsent, setPendingLoginAfterConsent] = useState<boolean>(false);
  const [openLegalDoc, setOpenLegalDoc] = useState<LegalDocKind | null>(null);
  const [localAlerts, setLocalAlerts] = useState<PriceAlertRecord[]>(() => readLocalPriceAlerts());
  const [demoStrategyOverrides, setDemoStrategyOverrides] = useState<
    Record<string, DemoStrategyOverride>
  >(() => readDemoStrategyOverrides());

  useEffect(() => {
    setThemeMode(themeMode);
  }, [themeMode]);

  useEffect(() => {
    if (!pinHash || pinTimeoutMin <= 0 || isPinLocked) return;
    let timerId = window.setTimeout(() => setIsPinLocked(true), pinTimeoutMin * 60_000);
    const resetTimer = () => {
      window.clearTimeout(timerId);
      timerId = window.setTimeout(() => setIsPinLocked(true), pinTimeoutMin * 60_000);
    };
    const events = ['pointerdown', 'keydown', 'touchstart'] as const;
    events.forEach((ev) => window.addEventListener(ev, resetTimer, { passive: true }));
    return () => {
      window.clearTimeout(timerId);
      events.forEach((ev) => window.removeEventListener(ev, resetTimer));
    };
  }, [pinHash, pinTimeoutMin, isPinLocked]);

  const handleChangeThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
    setThemeMode(mode);
  }, []);

  const handleTogglePrivacyMode = useCallback(() => {
    setPrivacyModeState((prev) => {
      const next = !prev;
      setPrivacyMode(next);
      return next;
    });
  }, []);

  const handleSavePin = useCallback(async (pin: string) => {
    const hashed = await hashPinSha256(pin);
    setPinHash(hashed);
    setPinHashState(hashed);
  }, []);

  const handleDisablePin = useCallback(() => {
    setPinHash(null);
    setPinHashState(null);
    setIsPinLocked(false);
  }, []);

  const handleChangePinTimeout = useCallback((mins: 0 | 1 | 5 | 15) => {
    setPinTimeoutMinutes(mins);
    setPinTimeoutMinState(mins);
  }, []);

  const handleSaveAntiPhishing = useCallback((code: string) => {
    setAntiPhishingCode(code);
    setAntiPhishingCodeState(code);
  }, []);

  const handleChangeDemoPlan = useCallback((override: DemoPlanOverride | null) => {
    setDemoPlanOverride(override);
    setDemoPlanOverrideState(override);
  }, []);

  const [paymentNotice, setPaymentNotice] = useState<string | null>(() => {
    const status = new URLSearchParams(window.location.search).get('payment');
    if (status === 'success') {
      return 'Подписка Google Play подтверждена. Тариф обновится автоматически в течение минуты.';
    }
    if (status === 'cancel') return 'Оплата отменена. Деньги не списаны.';
    return null;
  });
  const [pendingLoginPushUid, setPendingLoginPushUid] = useState<string | null>(null);
  const [targetReachedNotice, setTargetReachedNotice] = useState<string | null>(null);
  const [localPortfolioTargets, setLocalPortfolioTargets] = useState<PortfolioTargetRecord[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(LOCAL_PORTFOLIO_TARGETS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) return parsed as PortfolioTargetRecord[];
      }
    } catch {
      // Ignore storage read errors
    }
    return [];
  });
  const [tourOpen, setTourOpen] = useState(false);
  const [upgradeBarDismissed, setUpgradeBarDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.sessionStorage.getItem('vernier_upgrade_bar_dismissed_v1') === '1';
    } catch {
      return false;
    }
  });
  const [marketSelection, setMarketSelection] = useState<{
    symbol: string;
    marketType: MarketType;
    nonce: number;
  } | null>(null);
  const [screenerSectionSelection, setScreenerSectionSelection] = useState<{
    section: ScreenerSection;
    nonce: number;
  } | null>(null);
  const [strategiesSectionSelection, setStrategiesSectionSelection] = useState<{
    section: StrategiesSection;
    nonce: number;
  } | null>(null);
  const [securitySectionSelection, setSecuritySectionSelection] = useState<{
    section: SecuritySection;
    sub?: 'chart' | 'log' | 'faq';
    nonce: number;
  } | null>(null);

  const { scrollYProgress } = useScroll();
  const smoothScrollProgress = useSpring(scrollYProgress, {
    stiffness: 260,
    damping: 32,
    restDelta: 0.001,
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPopState = () => {
      setStandaloneWidget(getInitialWidgetFromUrl());
      setActiveTab(getInitialTabFromUrl());
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  // Остальные экраны подгружаются в простое, чтобы переключение вкладок оставалось мгновенным
  useEffect(() => {
    prefetchViews();
  }, []);

  const handleSwitchTab = useCallback((tab: AppTab) => {
    let isSameTab = false;
    setActiveTab((prev) => {
      if (prev === tab) {
        isSameTab = true;
        return prev;
      }
      const prevIdx = TAB_ORDER.indexOf(prev);
      const nextIdx = TAB_ORDER.indexOf(tab);
      if (prevIdx !== -1 && nextIdx !== -1 && nextIdx !== prevIdx) {
        setTabDirection(nextIdx > prevIdx ? 1 : -1);
      }
      return tab;
    });
    if (typeof window !== 'undefined') {
      // Smooth scroll to top when re-tapping active tab; snap when switching tabs
      window.scrollTo({ top: 0, behavior: isSameTab ? 'smooth' : 'auto' });
    }
  }, []);

  const launchStandaloneWidget = useCallback(
    (kind: AndroidWidgetKind, symbol: string, tf: Timeframe) => {
      setStandaloneWidget({ kind, symbol, tf });
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams({
          widget: kind,
          symbol,
          tf,
        });
        window.history.pushState({}, '', `/?${params.toString()}`);
        window.scrollTo({ top: 0, behavior: 'auto' });
      }
    },
    []
  );

  const exitStandaloneWidget = useCallback(
    (targetTab: AppTab, symbol?: string) => {
      setStandaloneWidget(null);
      handleSwitchTab(targetTab);
      if (symbol) {
        setMarketSelection({ symbol, marketType: 'spot', nonce: Date.now() });
      }
      if (typeof window !== 'undefined') {
        window.history.pushState({}, '', `/?tab=${targetTab}`);
        window.scrollTo({ top: 0, behavior: 'auto' });
      }
    },
    [handleSwitchTab]
  );

  const {
    firebaseUser,
    authReady,
    authError,
    clearAuthError,
    profile,
    privateSecurity,
    strategies,
    analyses,
    auditLogs,
    pushSubscriptions,
    sessions,
    priceAlerts,
    supportTickets,
    exchangeKeys,
    exchangeSyncCache,
    backgroundSyncingKeyIds,
    portfolioTargets,
    currentSessionId,
    isLocked,
    setIsLocked,
    loginWithGoogle,
    logout,
    consumeCredits,
    consumeCreditAndSaveAnalysis,
    updateStrategySettings,
    savePendingTotp,
    activateTotp,
    disableTotp,
    updateAutoLockMinutes,
    record2faVerification,
    savePushSubscriptionRecord,
    deletePushSubscriptionRecord,
    revokeOtherSessions,
    revokeSessionById,
    toggleSessionSuspicious,
    createPriceAlert,
    togglePriceAlert,
    deletePriceAlert,
    checkPriceAlertsNow,
    createSupportTicket,
    connectExchangeKey,
    updateExchangeKey,
    syncExchangeKey,
    toggleExchangeKey,
    deleteExchangeKey,
    placeExchangeOrder,
    upsertPortfolioTarget,
    markPortfolioTargetTriggered,
    deletePortfolioTarget,
  } = useAuthAndVault();

  const isSignedIn = Boolean(authReady && firebaseUser);
  const paperPortfolio = usePaperPortfolio();
  const portfolioSourceRef = useRef(paperPortfolio.portfolioSource);
  portfolioSourceRef.current = paperPortfolio.portfolioSource;
  const syncPortfolioFromExchange = paperPortfolio.syncFromExchange;

  const bgSyncedKeyIdsRef = useRef<Set<string>>(new Set());
  const bgSyncUidRef = useRef<string | null>(null);
  const [exchangeSyncErrorLogs, setExchangeSyncErrorLogs] = useState<ExchangeSyncErrorLogEntry[]>([]);

  useEffect(() => {
    const uid = firebaseUser?.uid ?? null;
    if (bgSyncUidRef.current !== uid) {
      bgSyncUidRef.current = uid;
      bgSyncedKeyIdsRef.current.clear();
    }
    setExchangeSyncErrorLogs(uid ? readExchangeSyncErrorLogs(uid) : []);
  }, [firebaseUser?.uid]);

  const handleClearExchangeSyncErrorLogs = useCallback(() => {
    const uid = firebaseUser?.uid;
    if (!uid) {
      setExchangeSyncErrorLogs([]);
      return;
    }
    setExchangeSyncErrorLogs(clearExchangeSyncErrorLogs(uid));
  }, [firebaseUser?.uid]);

  // Если в локальном кэше биржи есть более свежий снимок для активного биржевого портфеля — применяем мгновенно
  useEffect(() => {
    const src = portfolioSourceRef.current;
    if (src.mode !== 'exchange' || !src.exchange) return;
    const matchingEntries = Object.values(exchangeSyncCache).filter(
      (entry) =>
        entry.exchange === src.exchange &&
        (!src.label || entry.label === src.label) &&
        entry.assets.length > 0
    );
    if (matchingEntries.length === 0) return;
    const latest = matchingEntries.sort((a, b) => b.cachedAtMs - a.cachedAtMs)[0];
    if (latest && latest.syncedAt && latest.syncedAt !== src.syncedAt) {
      const currentMs = src.syncedAt ? Date.parse(src.syncedAt) : 0;
      const cachedMs = Date.parse(latest.syncedAt);
      if (Number.isFinite(cachedMs) && cachedMs > (Number.isFinite(currentMs) ? currentMs : 0)) {
        syncPortfolioFromExchange(latest.exchange, latest.label, latest.assets, latest.syncedAt);
      }
    }
  }, [exchangeSyncCache, syncPortfolioFromExchange]);

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Фоновое обновление биржевых балансов (Stale-While-Revalidate) при открытии приложения
  useEffect(() => {
    if (!authReady || !firebaseUser || exchangeKeys.length === 0) return;

    const activeUid = firebaseUser.uid;
    const pendingKeys = exchangeKeys.filter(
      (k) => k.enabled && !bgSyncedKeyIdsRef.current.has(k.id)
    );
    if (pendingKeys.length === 0) return;

    for (const key of pendingKeys) {
      bgSyncedKeyIdsRef.current.add(key.id);
    }

    void Promise.allSettled(
      pendingKeys.map(async (key) => {
        try {
          const sync = await syncExchangeKey(key, { silent: true, background: true });
          const nextLogs = appendExchangeSyncSuccessLog(activeUid, {
            keyId: key.id,
            exchange: key.exchange,
            label: key.label,
            testnet: key.testnet,
            totalBalanceUsdt: sync.totalBalanceUsdt,
            assetsCount: sync.assets.length,
            source: 'background',
          });
          if (!isMountedRef.current || bgSyncUidRef.current !== activeUid) return;
          setExchangeSyncErrorLogs(nextLogs);
          const src = portfolioSourceRef.current;
          if (
            src.mode === 'exchange' &&
            src.exchange === key.exchange &&
            (!src.label || src.label === key.label)
          ) {
            syncPortfolioFromExchange(key.exchange, key.label, sync.assets, sync.syncedAt);
          }
        } catch (err) {
          // Сохраняем закэшированные данные в UI и логируем сбой фоновой синхронизации в localStorage
          const errorMessage =
            err instanceof Error && err.message.trim()
              ? err.message.trim()
              : 'Не удалось выполнить фоновую синхронизацию биржи.';
          const nextLogs = appendExchangeSyncErrorLog(activeUid, {
            keyId: key.id,
            exchange: key.exchange,
            label: key.label,
            testnet: key.testnet,
            errorMessage,
            source: 'background',
          });
          if (isMountedRef.current && bgSyncUidRef.current === activeUid) {
            setExchangeSyncErrorLogs(nextLogs);
          }
        }
      })
    );
  }, [authReady, firebaseUser, exchangeKeys, syncExchangeKey, syncPortfolioFromExchange]);

  const isBackgroundSyncingActiveExchange = useMemo(() => {
    if (paperPortfolio.portfolioSource.mode !== 'exchange' || !paperPortfolio.portfolioSource.exchange) {
      return false;
    }
    return exchangeKeys.some(
      (k) =>
        k.exchange === paperPortfolio.portfolioSource.exchange &&
        (!paperPortfolio.portfolioSource.label || k.label === paperPortfolio.portfolioSource.label) &&
        backgroundSyncingKeyIds.includes(k.id)
    );
  }, [
    paperPortfolio.portfolioSource.mode,
    paperPortfolio.portfolioSource.exchange,
    paperPortfolio.portfolioSource.label,
    exchangeKeys,
    backgroundSyncingKeyIds,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(LOCAL_PORTFOLIO_TARGETS_KEY, JSON.stringify(localPortfolioTargets));
    } catch {
      // Ignore storage write errors
    }
  }, [localPortfolioTargets]);

  const effectivePortfolioTargets = isSignedIn ? portfolioTargets : localPortfolioTargets;

  const activePortfolioTarget = useMemo(
    () =>
      effectivePortfolioTargets.find(
        (t) => t.portfolioId === paperPortfolio.portfolioIdentity.portfolioId
      ) ?? null,
    [effectivePortfolioTargets, paperPortfolio.portfolioIdentity.portfolioId]
  );

  const handleSavePortfolioTarget = useCallback(
    async (params: {
      portfolioId: string;
      portfolioLabel: string;
      targetBalanceUsdt: number;
      baselineBalanceUsdt: number;
      targetPnlPct: number;
    }) => {
      if (isSignedIn) {
        await upsertPortfolioTarget(params);
        return;
      }
      setLocalPortfolioTargets((prev) => {
        const nextRecord: PortfolioTargetRecord = {
          id: params.portfolioId,
          userId: 'local',
          portfolioId: params.portfolioId,
          portfolioLabel: params.portfolioLabel,
          targetBalanceUsdt: params.targetBalanceUsdt,
          baselineBalanceUsdt: params.baselineBalanceUsdt,
          targetPnlPct: params.targetPnlPct,
          active: true,
          triggeredAt: '',
          triggeredBalanceUsdt: 0,
        };
        const idx = prev.findIndex((item) => item.portfolioId === params.portfolioId);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = nextRecord;
          return copy;
        }
        return [nextRecord, ...prev];
      });
    },
    [isSignedIn, upsertPortfolioTarget]
  );

  const handleDeletePortfolioTarget = useCallback(
    async (targetId: string) => {
      if (isSignedIn) {
        await deletePortfolioTarget(targetId);
        return;
      }
      setLocalPortfolioTargets((prev) => prev.filter((item) => item.id !== targetId));
    },
    [isSignedIn, deletePortfolioTarget]
  );

  // Auto-start interface tour on first visit once auth resolves and terminal isn't 2FA-locked
  useEffect(() => {
    if (!authReady || isLocked || typeof window === 'undefined') return;
    let alreadySeen = false;
    try {
      alreadySeen = window.localStorage.getItem(TOUR_STORAGE_KEY) === '1';
    } catch {
      alreadySeen = false;
    }
    if (alreadySeen) return;

    const timer = setTimeout(() => {
      setTourOpen(true);
    }, 900);
    return () => clearTimeout(timer);
  }, [authReady, isLocked]);

  const handleCloseTour = () => {
    setTourOpen(false);
    try {
      window.localStorage.setItem(TOUR_STORAGE_KEY, '1');
    } catch {
      // Ignore storage write failures in private contexts
    }
  };

  const handleStartTour = () => {
    setTourOpen(true);
  };

  const pushState = usePushNotifications({
    uid: firebaseUser?.uid,
    isSignedIn,
    pushSubscriptions,
    onSaveSubscription: savePushSubscriptionRecord,
    onDeleteSubscription: deletePushSubscriptionRecord,
  });

  const { checkAndNotifyPortfolioPnl, checkAndNotifyPortfolioTarget } = pushState;

  useEffect(() => {
    if (paperPortfolio.holdings.length === 0 || !paperPortfolio.dailyPnl.hasLive24hData) return;
    void checkAndNotifyPortfolioPnl({
      dailyPnlPct: paperPortfolio.dailyPnl.dailyPnlPct,
      dailyPnlUsdt: paperPortfolio.dailyPnl.dailyPnlUsdt,
      totalValue: paperPortfolio.report.totalValue,
      hasLive24hData: paperPortfolio.dailyPnl.hasLive24hData,
    });
  }, [
    paperPortfolio.holdings.length,
    paperPortfolio.dailyPnl.dailyPnlPct,
    paperPortfolio.dailyPnl.dailyPnlUsdt,
    paperPortfolio.dailyPnl.hasLive24hData,
    paperPortfolio.report.totalValue,
    checkAndNotifyPortfolioPnl,
  ]);

  // Monitor active portfolio against its configured Target PnL / target balance
  useEffect(() => {
    if (
      !activePortfolioTarget ||
      !activePortfolioTarget.active ||
      paperPortfolio.holdings.length === 0 ||
      !paperPortfolio.dailyPnl.hasLive24hData ||
      paperPortfolio.report.totalValue < activePortfolioTarget.targetBalanceUsdt
    ) {
      return;
    }

    let cancelled = false;
    const currentValue = paperPortfolio.report.totalValue;

    const triggerGoal = async () => {
      const result = await checkAndNotifyPortfolioTarget({
        targetId: activePortfolioTarget.id,
        portfolioId: activePortfolioTarget.portfolioId,
        portfolioLabel: activePortfolioTarget.portfolioLabel,
        targetBalanceUsdt: activePortfolioTarget.targetBalanceUsdt,
        baselineBalanceUsdt: activePortfolioTarget.baselineBalanceUsdt,
        targetPnlPct: activePortfolioTarget.targetPnlPct,
        currentBalanceUsdt: currentValue,
        hasLive24hData: paperPortfolio.dailyPnl.hasLive24hData,
      });
      if (cancelled || !result.triggered) return;

      playAlertChime();
      setTargetReachedNotice(
        `Цель достигнута! Портфель «${activePortfolioTarget.portfolioLabel}» достиг $${currentValue.toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })} (цель $${activePortfolioTarget.targetBalanceUsdt.toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })})${result.notified ? ' · Push-уведомление отправлено.' : '.'}`
      );

      if (isSignedIn) {
        await markPortfolioTargetTriggered(
          activePortfolioTarget.id,
          activePortfolioTarget.portfolioLabel,
          currentValue
        );
      } else {
        setLocalPortfolioTargets((prev) =>
          prev.map((t) =>
            t.id === activePortfolioTarget.id
              ? {
                  ...t,
                  active: false,
                  triggeredAt: new Date().toISOString(),
                  triggeredBalanceUsdt: currentValue,
                }
              : t
          )
        );
      }
    };

    void triggerGoal();
    return () => {
      cancelled = true;
    };
  }, [
    activePortfolioTarget,
    paperPortfolio.holdings.length,
    paperPortfolio.dailyPnl.hasLive24hData,
    paperPortfolio.report.totalValue,
    checkAndNotifyPortfolioTarget,
    isSignedIn,
    markPortfolioTargetTriggered,
  ]);

  useEffect(() => {
    if (!pendingLoginPushUid || firebaseUser?.uid !== pendingLoginPushUid) return;
    const timer = setTimeout(() => {
      setPendingLoginPushUid(null);
      void pushState.triggerSecurityPush({
        overrideUid: pendingLoginPushUid,
        category: 'auth_login',
        title: 'Vernier · Выполнен вход в аккаунт',
        body: 'Зафиксирована новая авторизация через Google OAuth.',
        url: '/?tab=security',
      });
    }, 1200);
    return () => clearTimeout(timer);
  }, [pendingLoginPushUid, firebaseUser?.uid, pushState]);

  // Overlay Demo Tier Switcher cleanly on top of real profile for live testing across all tabs
  const effectiveProfile = useMemo<UserProfile | null>(() => {
    if (!demoPlanOverride) return profile;
    const demoCredits =
      demoPlanOverride.tier === 'max'
        ? demoPlanOverride.maxMultiplier === 20
          ? MAX_X20_MONTHLY_QUOTA
          : MAX_X10_MONTHLY_QUOTA
        : demoPlanOverride.tier === 'pro'
          ? PRO_MONTHLY_QUOTA
          : FREE_WEEKLY_QUOTA;
    const futureExpiry = Date.now() + 30 * 24 * 3600_000;
    const base: UserProfile = profile ?? {
      uid: 'local-demo-user',
      displayName: 'Demo Trader',
      plan: 'free',
      creditsRemaining: demoCredits,
      weeklyQuota: demoCredits,
      nextResetAt: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
      twoFactorEnabled: false,
      autoLockMinutes: 15,
    };
    return {
      ...base,
      plan: demoPlanOverride.tier,
      maxMultiplier: demoPlanOverride.tier === 'max' ? demoPlanOverride.maxMultiplier : undefined,
      proUntil: demoPlanOverride.tier === 'free' ? undefined : futureExpiry,
      creditsRemaining: demoCredits,
      weeklyQuota: demoCredits,
    };
  }, [profile, demoPlanOverride]);

  const planContextValue = useMemo<PlanContextValue>(() => {
    const planTier = getActivePlanTier(effectiveProfile);
    const plan = planTierToAccessPlan(planTier);
    const maxMultiplier: 10 | 20 = effectiveProfile?.maxMultiplier === 20 ? 20 : 10;
    return {
      plan,
      planTier,
      maxMultiplier,
      isPro: plan === 'PRO' || plan === 'MAX',
      isMax: plan === 'MAX',
      isDemoOverride: Boolean(demoPlanOverride),
      privacyMode,
      maskValue: (formatted: string) => (privacyMode ? '•••••' : formatted),
      setDemoPlan: (nextPlan, mult = 10) => {
        if (nextPlan === null) {
          handleChangeDemoPlan(null);
          return;
        }
        handleChangeDemoPlan({
          tier: accessPlanToPlanTier(nextPlan),
          maxMultiplier: mult,
        });
      },
      openUpgradeModal: (targetTier = 'pro', mult) => {
        setPricingTier(targetTier);
        if (mult) setPricingMaxMultiplier(mult);
        setPricingOpen(true);
      },
    };
  }, [effectiveProfile, demoPlanOverride, privacyMode, handleChangeDemoPlan]);

  const effectivePriceAlerts = isSignedIn ? priceAlerts : localAlerts;

  // Unified 27-strategy list: merges Firestore records with catalog defaults + local Demo overrides
  const effectiveStrategies = useMemo<StrategyConfig[]>(() => {
    const byKey = new Map<string, StrategyConfig>();
    for (const s of strategies) {
      byKey.set(s.strategyKey, s);
    }
    const useLocalDemo = demoPlanOverride !== null || !isSignedIn;
    const isEffPro = isProSubscriptionActive(effectiveProfile);
    const uidFallback = firebaseUser?.uid || 'local-demo-user';

    return STRATEGY_CATALOG.map((tpl) => {
      const stratId = `strat_${tpl.key}`;
      const existing = byKey.get(tpl.key);
      const base: StrategyConfig = existing ?? {
        id: stratId,
        userId: uidFallback,
        marketType: tpl.marketType,
        strategyKey: tpl.key,
        name: tpl.name,
        enabled: tpl.key === 'spot_trend_breakout' || tpl.key === 'futures_momentum_atr',
        dailySignalLimit: isEffPro ? 0 : FREE_DAILY_SIGNAL_LIMIT,
        minConfidence: 70,
        riskPerTradePct: tpl.defaultRiskPct,
        leverage:
          tpl.marketType === 'spot'
            ? 1
            : isEffPro
              ? tpl.defaultLeverage
              : Math.min(FREE_MAX_LEVERAGE, tpl.defaultLeverage),
        pairs: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
      };
      if (useLocalDemo) {
        const override = demoStrategyOverrides[base.id] ?? demoStrategyOverrides[stratId];
        if (override) {
          return {
            ...base,
            enabled: override.enabled,
            dailySignalLimit: override.dailySignalLimit,
            minConfidence: override.minConfidence,
            riskPerTradePct: override.riskPerTradePct,
            leverage: tpl.marketType === 'spot' ? 1 : override.leverage,
            pairs: override.pairs.length > 0 ? override.pairs : base.pairs,
          };
        }
      }
      return base;
    });
  }, [strategies, demoPlanOverride, isSignedIn, effectiveProfile, firebaseUser?.uid, demoStrategyOverrides]);

  const handleCreatePriceAlertUnified = async (params: {
    symbol: string;
    marketType: MarketType;
    condition: PriceAlertCondition;
    targetPrice: number;
  }) => {
    if (isSignedIn) {
      await createPriceAlert(params);
      return;
    }
    const created: PriceAlertRecord = {
      id: `local_alert_${Date.now()}`,
      userId: 'local-demo',
      symbol: params.symbol,
      marketType: params.marketType,
      condition: params.condition,
      targetPrice: params.targetPrice,
      active: true,
      triggeredAt: '',
      triggeredPrice: 0,
      createdAt: new Date().toISOString(),
    };
    const next = [created, ...localAlerts];
    setLocalAlerts(next);
    writeLocalPriceAlerts(next);
  };

  const handleTogglePriceAlertUnified = async (alertId: string, nextActive: boolean) => {
    if (isSignedIn) {
      await togglePriceAlert(alertId, nextActive);
      return;
    }
    const next = localAlerts.map((a) => (a.id === alertId ? { ...a, active: nextActive } : a));
    setLocalAlerts(next);
    writeLocalPriceAlerts(next);
  };

  const handleDeletePriceAlertUnified = async (alertId: string) => {
    if (isSignedIn) {
      await deletePriceAlert(alertId);
      return;
    }
    const next = localAlerts.filter((a) => a.id !== alertId);
    setLocalAlerts(next);
    writeLocalPriceAlerts(next);
  };

  const handleCheckPriceAlertsUnified = async () => {
    if (isSignedIn) {
      return checkPriceAlertsNow();
    }
    return {
      checkedAlerts: localAlerts.filter((a) => a.active).length,
      alertsSent: 0,
      triggeredCount: 0,
    };
  };

  const runGoogleOAuthWithCsrf = async () => {
    const csrfState = createOAuthCsrfState();
    const loggedUid = await loginWithGoogle();
    if (!verifyOAuthCsrfState(csrfState)) {
      setBannerError('Не пройдена проверка OAuth CSRF state. Повторите вход.');
      return;
    }
    if (loggedUid) {
      setPendingLoginPushUid(loggedUid);
    }
  };

  const handleLoginWithPush = async () => {
    if (!legalConsent) {
      setLegalConsentMode('auth');
      setPendingLoginAfterConsent(true);
      setLegalConsentOpen(true);
      return;
    }
    await runGoogleOAuthWithCsrf();
  };

  const handleDeleteAccountAndAllData = async () => {
    clearMemoryCache();
    wipeAllLocalAppData();
    clearDemoStrategyOverrides();
    setDemoStrategyOverrides({});
    if (isSignedIn) {
      await logout();
    }
    setLocalAlerts([]);
    setLocalPortfolioTargets([]);
    setPinHashState(null);
    setIsPinLocked(false);
    setAntiPhishingCodeState('');
    setDemoPlanOverrideState(null);
    setLegalConsent(null);
    setLegalConsentMode('onboarding');
    setLegalConsentOpen(true);
    setPaymentNotice('Все локальные данные, ключи, алерты и сессия удалены.');
  };

  const handle2faUnlockWithPush = async (consumedBackupHash: string | null) => {
    await record2faVerification(consumedBackupHash);
    void pushState.triggerSecurityPush({
      category: 'auth_login',
      title: 'Vernier · Терминал разблокирован (2FA)',
      body: 'Выполнена успешная проверка кода 2FA после блокировки сессии.',
      url: '/?tab=security',
    });
  };

  const handleConsumeCreditsUnified = useCallback(
    async (amount: number, auditReason?: string): Promise<boolean> => {
      if (demoPlanOverride !== null) {
        return true;
      }
      return consumeCredits(amount, auditReason);
    },
    [demoPlanOverride, consumeCredits]
  );

  const handleConsumeAndSaveWithPush = async (params: {
    symbol: string;
    marketType: MarketType;
    timeframe: string;
    strategyKey: string;
    strategyName: string;
    creditCost?: number;
    result: AnalysisResultPayload;
  }) => {
    if (demoPlanOverride !== null) {
      // In Demo Tier mode, allow running PRO/MAX AI analyses without colliding with real Free-tier Firestore limits
      return;
    }
    const cost = Math.max(1, Math.round(params.creditCost ?? (params.marketType === 'futures' ? 2 : 1)));
    const wasProActive = isProSubscriptionActive(profile);
    const remainingAfter = Math.max(0, (profile?.creditsRemaining ?? 0) - cost);
    await consumeCreditAndSaveAnalysis(params);

    if (remainingAfter <= 0) {
      void pushState.triggerSecurityPush({
        category: 'signal_limit',
        title: wasProActive
          ? 'Vernier · Месячные кредиты PRO исчерпаны'
          : 'Vernier · Недельные кредиты исчерпаны',
        body: wasProActive
          ? 'Использованы все 100 кредитов текущего месяца PRO. Продлите подписку для пополнения баланса.'
          : 'Использованы все 15 бесплатных кредитов недели. Перейдите на PRO (+100 кр./мес. и безлимит сигналов).',
        url: '/?tab=strategies',
      });
    }

    const matchedStrategy = strategies.find((s) => s.strategyKey === params.strategyKey);
    const todayCountBefore = countTodayStrategySignals(analyses, params.strategyKey);

    if (!wasProActive) {
      if (todayCountBefore + 1 >= FREE_DAILY_SIGNAL_LIMIT) {
        void pushState.triggerSecurityPush({
          category: 'signal_limit',
          title: `Vernier · Дневной лимит Free: ${params.strategyName}`,
          body: `Достигнут дневной лимит на Free (${FREE_DAILY_SIGNAL_LIMIT} / ${FREE_DAILY_SIGNAL_LIMIT} в сутки). На PRO лимит сигналов снят.`,
          url: '/?tab=strategies',
        });
      }
    } else if (matchedStrategy && matchedStrategy.dailySignalLimit > 0) {
      if (todayCountBefore + 1 >= matchedStrategy.dailySignalLimit) {
        void pushState.triggerSecurityPush({
          category: 'signal_limit',
          title: `Vernier · Порог сигналов: ${params.strategyName}`,
          body: `Достигнут настроенный вами порог сигналов (${matchedStrategy.dailySignalLimit} / ${matchedStrategy.dailySignalLimit} в сутки).`,
          url: '/?tab=strategies',
        });
      }
    }
  };

  const handleSignalEmitted = async (params: {
    symbol: string;
    marketType: MarketType;
    direction: 'LONG' | 'SHORT' | 'WAIT';
    confidence: number;
    strategyName: string;
    entryZone: string;
  }) => {
    if (!firebaseUser || !pushState.isSubscribed || !pushState.preferences.notifySignals) return;
    try {
      await authFetch('/api/push/trigger-signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: firebaseUser.uid,
          ...params,
        }),
      });
    } catch {
      // Non-blocking background push trigger
    }
  };

  const runWith2faGuard = (
    title: string,
    description: string,
    action: () => Promise<void>
  ): Promise<void> => {
    if (profile?.twoFactorEnabled && privateSecurity?.totpEncryptedSecret) {
      return new Promise((resolve, reject) => {
        setPendingStepUp({
          title,
          description,
          execute: async () => {
            try {
              await action();
              resolve();
            } catch (err) {
              reject(err);
            }
          },
          onCancel: () => reject(new Error('Подтверждение 2FA отменено.')),
        });
      });
    }
    return action();
  };

  const runTypedWith2faGuard = <T,>(
    title: string,
    description: string,
    action: () => Promise<T>
  ): Promise<T> => {
    if (profile?.twoFactorEnabled && privateSecurity?.totpEncryptedSecret) {
      return new Promise<T>((resolve, reject) => {
        setPendingStepUp({
          title,
          description,
          execute: async () => {
            try {
              const res = await action();
              resolve(res);
            } catch (err) {
              reject(err);
            }
          },
          onCancel: () => reject(new Error('Подтверждение 2FA отменено.')),
        });
      });
    }
    return action();
  };

  const handleConnectExchangeWithSync = async (params: {
    exchange: ExchangeId;
    label: string;
    apiKey: string;
    apiSecret: string;
    passphrase?: string;
    permissions: ExchangeKeyPermissions;
    testnet: boolean;
  }): Promise<{ key: ExchangeKeyRecord; sync: ExchangeSyncResult }> => {
    return runTypedWith2faGuard(
      'Подключение API-ключа биржи',
      'Для защиты торгового сейфа подтвердите добавление внешнего API-ключа кодом 2FA.',
      async () => {
        const res = await connectExchangeKey(params);
        if (firebaseUser?.uid) {
          setExchangeSyncErrorLogs(
            appendExchangeSyncSuccessLog(firebaseUser.uid, {
              keyId: res.key.id,
              exchange: res.key.exchange,
              label: res.key.label,
              testnet: res.key.testnet,
              totalBalanceUsdt: res.sync.totalBalanceUsdt,
              assetsCount: res.sync.assets.length,
              source: 'manual',
            })
          );
        }
        if (res.sync.assets.length > 0) {
          paperPortfolio.syncFromExchange(
            res.key.exchange,
            res.key.label,
            res.sync.assets,
            res.sync.syncedAt
          );
        }
        return res;
      }
    );
  };

  const handleSyncExchangeToPortfolio = async (
    key: ExchangeKeyRecord,
    applyToPortfolio: boolean
  ): Promise<ExchangeSyncResult> => {
    const uid = firebaseUser?.uid;
    try {
      const sync = await syncExchangeKey(key);
      if (uid) {
        setExchangeSyncErrorLogs(
          appendExchangeSyncSuccessLog(uid, {
            keyId: key.id,
            exchange: key.exchange,
            label: key.label,
            testnet: key.testnet,
            totalBalanceUsdt: sync.totalBalanceUsdt,
            assetsCount: sync.assets.length,
            source: 'manual',
          })
        );
      }
      if (applyToPortfolio) {
        paperPortfolio.syncFromExchange(key.exchange, key.label, sync.assets, sync.syncedAt);
      }
      return sync;
    } catch (err) {
      if (uid) {
        const errorMessage =
          err instanceof Error && err.message.trim()
            ? err.message.trim()
            : 'Ошибка ручной синхронизации биржи.';
        setExchangeSyncErrorLogs(
          appendExchangeSyncErrorLog(uid, {
            keyId: key.id,
            exchange: key.exchange,
            label: key.label,
            testnet: key.testnet,
            errorMessage,
            source: 'manual',
          })
        );
      }
      throw err;
    }
  };

  const handleUpdateExchangeWithSync = async (
    existingKey: ExchangeKeyRecord,
    params: {
      label: string;
      apiKey: string;
      apiSecret: string;
      passphrase?: string;
      permissions: ExchangeKeyPermissions;
      testnet: boolean;
    }
  ): Promise<{ key: ExchangeKeyRecord; sync: ExchangeSyncResult }> => {
    return runTypedWith2faGuard(
      'Обновление API-ключа биржи',
      'Для замены реквизитов биржевого API-ключа подтвердите действие кодом 2FA.',
      async () => {
        const uid = firebaseUser?.uid;
        try {
          const res = await updateExchangeKey(existingKey, params);
          if (uid) {
            setExchangeSyncErrorLogs(
              appendExchangeSyncSuccessLog(uid, {
                keyId: res.key.id,
                exchange: res.key.exchange,
                label: res.key.label,
                testnet: res.key.testnet,
                totalBalanceUsdt: res.sync.totalBalanceUsdt,
                assetsCount: res.sync.assets.length,
                source: 'manual',
              })
            );
          }
          const src = portfolioSourceRef.current;
          if (
            res.sync.assets.length > 0 &&
            (src.mode !== 'exchange' || src.exchange === res.key.exchange)
          ) {
            paperPortfolio.syncFromExchange(
              res.key.exchange,
              res.key.label,
              res.sync.assets,
              res.sync.syncedAt
            );
          }
          return res;
        } catch (err) {
          if (uid) {
            const errorMessage =
              err instanceof Error && err.message.trim()
                ? err.message.trim()
                : 'Не удалось обновить API-ключ биржи.';
            setExchangeSyncErrorLogs(
              appendExchangeSyncErrorLog(uid, {
                keyId: existingKey.id,
                exchange: existingKey.exchange,
                label: params.label.trim() || existingKey.label,
                testnet: params.testnet,
                errorMessage,
                source: 'manual',
              })
            );
          }
          throw err;
        }
      }
    );
  };

  const handleDeleteExchangeProtected = async (keyId: string) => {
    await runWith2faGuard(
      'Удаление API-ключа биржи',
      'Подтвердите отвязку биржевого API-ключа кодом 2FA.',
      () => deleteExchangeKey(keyId)
    );
  };

  const requestApiOrderConfirmation = useCallback(
    (payload: PendingApiOrderConfirm): Promise<boolean> =>
      new Promise((resolve) => {
        setPendingApiOrderConfirm((prev) => {
          if (prev) prev.resolve(false);
          return { payload, resolve };
        });
      }),
    []
  );

  const handlePlaceExchangeOrderProtected = async (
    key: ExchangeKeyRecord,
    orderParams: {
      symbol: string;
      marketType: MarketType;
      side: 'BUY' | 'SELL';
      orderType: 'MARKET' | 'LIMIT';
      quantity: number;
      limitPrice?: number;
      stopLoss?: number;
      takeProfit?: number;
    }
  ): Promise<ExchangeOrderResult> => {
    const confirmed = await requestApiOrderConfirmation({
      exchange: key.exchange,
      keyLabel: key.label,
      testnet: Boolean(key.testnet),
      symbol: orderParams.symbol,
      marketType: orderParams.marketType,
      side: orderParams.side,
      orderType: orderParams.orderType,
      quantity: orderParams.quantity,
      limitPrice: orderParams.limitPrice,
      stopLoss: orderParams.stopLoss,
      takeProfit: orderParams.takeProfit,
    });
    if (!confirmed) {
      throw new Error('Отправка ордера через API отменена пользователем.');
    }
    return runTypedWith2faGuard(
      `Подтверждение ордера ${orderParams.side} ${orderParams.symbol}`,
      `Перед отправкой ордера на ${key.exchange.toUpperCase()} (${key.label}) подтвердите действие кодом 2FA.`,
      () => placeExchangeOrder(key, orderParams)
    );
  };

  // Тариф меняется через Google Play Billing или Demo Tier Switcher.
  const handleProtectedPlanSwitch = async (target: PlanTier, maxMultiplier?: 10 | 20) => {
    setBannerError(null);
    if (target !== 'pro' && target !== 'max') return;
    setPricingTier(target);
    if (maxMultiplier) {
      setPricingMaxMultiplier(maxMultiplier);
    }
    setPricingOpen(true);
  };

  const handleProtectedStrategySave = async (
    strategyId: string,
    updates: {
      enabled: boolean;
      dailySignalLimit: number;
      minConfidence: number;
      riskPerTradePct: number;
      leverage: number;
      pairs: string[];
    }
  ) => {
    const stratObj = effectiveStrategies.find((s) => s.id === strategyId);
    const stratName = stratObj?.name || 'Стратегия';

    // When Demo Tier Switcher is active (or guest mode), persist locally without hitting real Free Firestore rules
    if (demoPlanOverride !== null || !isSignedIn) {
      const nextMap = saveDemoStrategyOverride(strategyId, {
        enabled: updates.enabled,
        dailySignalLimit: updates.dailySignalLimit,
        minConfidence: updates.minConfidence,
        riskPerTradePct: updates.riskPerTradePct,
        leverage: stratObj?.marketType === 'spot' ? 1 : updates.leverage,
        pairs: updates.pairs.length > 0 ? updates.pairs : ['BTCUSDT'],
      });
      setDemoStrategyOverrides(nextMap);
      return;
    }

    await runWith2faGuard(
      'Подтверждение изменения стратегии',
      'Для защиты торговых правил и лимитов сигналов подтвердите действие кодом 2FA.',
      async () => {
        await updateStrategySettings(strategyId, updates);
        const effectiveDailyLimit = isProSubscriptionActive(profile)
          ? updates.dailySignalLimit
          : FREE_DAILY_SIGNAL_LIMIT;
        const limitLabel =
          effectiveDailyLimit === 0
            ? 'без ограничений/день'
            : `лимит ${effectiveDailyLimit} сигн./день`;
        void pushState.triggerSecurityPush({
          category: 'strategy_change',
          title: 'Vernier · Изменены настройки стратегии',
          body: `«${stratName}»: ${updates.enabled ? 'Активна' : 'Неактивна'}, ${limitLabel}, риск ${updates.riskPerTradePct}%.`,
          url: '/?tab=strategies',
        });
      }
    );
  };

  const handleDisable2faPrompt = () => {
    void runWith2faGuard(
      'Отключение двухфакторной защиты',
      'Подтвердите отключение TOTP 2FA текущим кодом из аутентификатора или резервным кодом.',
      () => disableTotp()
    );
  };

  const handleOpenPairOnMarket = useCallback(
    (symbol: string, marketType: MarketType) => {
      setMarketSelection({ symbol, marketType, nonce: Date.now() });
      handleSwitchTab('market');
    },
    [handleSwitchTab]
  );

  const navItems: Array<{ id: AppTab; label: string; mobileLabel: string; icon: React.ReactNode }> = [
    { id: 'market', label: 'Рынок', mobileLabel: 'Рынок', icon: <BarChart3 className="w-5 h-5" /> },
    { id: 'screener', label: 'Скринер', mobileLabel: 'Скринер', icon: <Radar className="w-5 h-5" /> },
    { id: 'strategies', label: 'Стратегии', mobileLabel: 'Стратегии', icon: <Layers className="w-5 h-5" /> },
    { id: 'news', label: 'Новости', mobileLabel: 'Новости', icon: <Newspaper className="w-5 h-5" /> },
    { id: 'security', label: 'Безопасность', mobileLabel: 'Защита', icon: <ShieldCheck className="w-5 h-5" /> },
  ];

  if (standaloneWidget) {
    return (
      <PlanProvider value={planContextValue}>
        <MotionConfig reducedMotion="user">
          <Suspense fallback={<ViewFallback />}>
          <StandaloneWidgetView
            widgetKind={standaloneWidget.kind}
            initialSymbol={standaloneWidget.symbol}
            initialTimeframe={standaloneWidget.tf}
            portfolioReport={paperPortfolio.report}
            holdingsCount={paperPortfolio.holdings.length}
            strategies={strategies}
            onChangeWidget={launchStandaloneWidget}
            onExitToTerminal={exitStandaloneWidget}
          />
          </Suspense>
          <OfflineIndicator />
        </MotionConfig>
      </PlanProvider>
    );
  }

  return (
    <PlanProvider value={planContextValue}>
      <FearGreedProvider>
      <MotionConfig reducedMotion="user">
        <SplashIntro imageSrc="/brand/vernier-app-icon.svg" />
        <LayoutGroup id="aegis-app-shell">
        <div className="min-h-dvh text-slate-100 flex flex-col">
        {/* Desktop 3-Zone Top Bar Contract */}
        <header className="hidden md:block sticky top-0 z-30 border-b border-white/8 bg-[#0B0F17]/88 backdrop-blur-md">
          <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-8">
            {/* Zone 1: Brand Wordmark */}
            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              onClick={() => handleSwitchTab('market')}
              aria-label="Vernier — на главный экран"
              className="flex items-center gap-2.5 whitespace-nowrap shrink-0"
            >
              <img
                src="/brand/vernier-lockup.svg"
                alt="Vernier"
                className="h-7 w-auto shrink-0"
              />
            </motion.button>

            {/* Zone 2: Single-line Nav Links with Shared Frosted Pill & Gradient Underline */}
            <nav className="flex items-center gap-2 text-sm font-medium">
              {navItems.map((item) => {
                const isActive = activeTab === item.id;
                return (
                  <motion.button
                    key={item.id}
                    type="button"
                    whileHover={{ y: -1 }}
                    whileTap={{ scale: 0.96 }}
                    transition={{ duration: 0.14 }}
                    onClick={() => handleSwitchTab(item.id)}
                    className={`relative px-3 py-2 rounded-lg whitespace-nowrap shrink-0 transition-colors ${
                      isActive ? 'text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="desktop-nav-active-pill"
                        transition={NATIVE_PILL_SPRING}
                        className="absolute inset-0 rounded-lg bg-white/[0.06] border border-white/[0.08]"
                      />
                    )}
                    <span className="relative z-10">{item.label}</span>
                    {isActive && (
                      <motion.span
                        layoutId="desktop-nav-underline"
                        transition={NATIVE_PILL_SPRING}
                        className="absolute left-2.5 right-2.5 -bottom-px h-0.5 rounded-full bg-gradient-to-r from-emerald-400 via-cyan-400 to-amber-400"
                      />
                    )}
                  </motion.button>
                );
              })}
            </nav>

            {/* Zone 3: Anti-Phishing + Demo Tier Badge + Auth */}
            <div className="flex items-center gap-2 shrink-0">
              {antiPhishingCode && (
                <span
                  title="Ваш персональный антифишинговый код"
                  className="hidden xl:inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-[11px] font-mono text-emerald-300"
                >
                  <ShieldCheck className="w-3 h-3" />
                  <span>{antiPhishingCode}</span>
                </span>
              )}
              <motion.button
                type="button"
                whileTap={{ scale: 0.96 }}
                onClick={() => {
                  triggerHaptic(8);
                  setPricingTier(getActivePlanTier(effectiveProfile) === 'max' ? 'max' : 'pro');
                  setPricingOpen(true);
                }}
                title="Тариф и Demo Tier Switcher"
                className={`min-h-[36px] px-2.5 rounded-lg border text-[11px] font-mono font-bold inline-flex items-center gap-1 whitespace-nowrap transition-colors ${
                  demoPlanOverride
                    ? 'border-amber-400/50 bg-amber-500/15 text-amber-200'
                    : getActivePlanTier(effectiveProfile) === 'max'
                      ? 'border-cyan-400/40 bg-cyan-500/12 text-cyan-200'
                      : getActivePlanTier(effectiveProfile) === 'pro'
                        ? 'border-amber-400/40 bg-amber-500/12 text-amber-200'
                        : 'border-white/10 bg-white/5 text-slate-300 hover:text-white'
                }`}
              >
                <Crown className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {demoPlanOverride ? 'DEMO ' : ''}
                  {getActivePlanTier(effectiveProfile).toUpperCase()}
                  {getActivePlanTier(effectiveProfile) === 'max'
                    ? ` ×${effectiveProfile?.maxMultiplier ?? 10}`
                    : ''}
                </span>
              </motion.button>
              {isSignedIn ? (
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.96 }}
                  onClick={() => void logout()}
                  className="min-h-[40px] px-4 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-medium text-slate-200 inline-flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>{profile?.displayName ? `${profile.displayName} · Выйти` : 'Выйти'}</span>
                </motion.button>
              ) : (
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.96 }}
                  onClick={() => void handleLoginWithPush()}
                  className="min-h-[40px] px-4 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-xs font-semibold text-white inline-flex items-center gap-2 whitespace-nowrap shrink-0 transition-all shadow-sm shadow-emerald-950/50"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span>Войти</span>
                </motion.button>
              )}
            </div>
          </div>
          {/* Scroll Progress Hairline */}
          <motion.div
            aria-hidden="true"
            style={{ scaleX: smoothScrollProgress }}
            className="h-[2px] w-full origin-left bg-gradient-to-r from-emerald-500 via-teal-400 to-amber-400"
          />
        </header>

        {/* Mobile Compact Top Bar (48px, single sticky surface <=15% viewport cap) */}
        <header className="md:hidden sticky top-0 z-30 border-b border-white/8 bg-[#0B0F17]/92 backdrop-blur-md">
          <div className="h-[48px] px-3 flex items-center justify-between gap-2 min-w-0">
            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              onClick={() => handleSwitchTab('market')}
              aria-label="Vernier — на главный экран"
              className="flex items-center gap-2 whitespace-nowrap shrink-0"
            >
              <img
                src="/brand/vernier-lockup.svg"
                alt="Vernier"
                className="h-5.5 w-auto shrink-0"
              />
            </motion.button>

            <div className="flex items-center gap-1.5 min-w-0 overflow-x-auto no-scrollbar py-1">
              <motion.button
                type="button"
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  triggerHaptic(8);
                  setPricingTier(getActivePlanTier(effectiveProfile) === 'max' ? 'max' : 'pro');
                  setPricingOpen(true);
                }}
                aria-label="Выбор тарифа и демо-режим"
                className={`min-h-[34px] px-2 rounded-lg border text-[10px] font-mono font-bold inline-flex items-center gap-1 whitespace-nowrap shrink-0 ${
                  demoPlanOverride
                    ? 'border-amber-400/50 bg-amber-500/15 text-amber-200'
                    : getActivePlanTier(effectiveProfile) === 'max'
                      ? 'border-cyan-400/40 bg-cyan-500/12 text-cyan-200'
                      : getActivePlanTier(effectiveProfile) === 'pro'
                        ? 'border-amber-400/40 bg-amber-500/12 text-amber-200'
                        : 'border-white/10 bg-white/5 text-slate-300'
                }`}
              >
                <Crown className="w-3 h-3 shrink-0" />
                <span>{getActivePlanTier(effectiveProfile).toUpperCase()}</span>
              </motion.button>
              <div className="shrink-0">
                <PWAInstallButton compact onOpenWidgets={() => setWidgetsModalOpen(true)} />
              </div>
              {!isSignedIn ? (
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.95 }}
                  onClick={() => void handleLoginWithPush()}
                  className="min-h-[34px] px-2.5 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 text-xs font-semibold text-white whitespace-nowrap shrink-0"
                >
                  Войти
                </motion.button>
              ) : (
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.95 }}
                  onClick={() => void logout()}
                  aria-label="Выйти"
                  className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-300 shrink-0"
                >
                  <LogOut className="w-4 h-4" />
                </motion.button>
              )}
            </div>
          </div>
          <motion.div
            aria-hidden="true"
            style={{ scaleX: smoothScrollProgress }}
            className="h-[2px] w-full origin-left bg-gradient-to-r from-emerald-500 via-teal-400 to-amber-400"
          />
        </header>

      {/* Main Content Container */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-3 sm:px-6 py-2.5 sm:py-4 pb-24 md:pb-8 overflow-x-hidden">
        {/* Unified Space-Efficient Scrollable Header Strip: Portfolio Summary + API Exchange Badge + Quick Actions + Live Ticker Tape */}
        <MiniPortfolioWidget
          holdingsCount={paperPortfolio.holdings.length}
          report={paperPortfolio.report}
          dailyPnl={paperPortfolio.dailyPnl}
          activeTarget={activePortfolioTarget}
          isBackgroundSyncingExchange={isBackgroundSyncingActiveExchange}
          connectedExchangesCount={exchangeKeys.length}
          connectedExchangesLabel={
            exchangeKeys.length > 0
              ? Array.from(new Set(exchangeKeys.map((k) => k.exchange.toUpperCase())))
                  .slice(0, 2)
                  .join(' · ')
              : undefined
          }
          onOpenExchangeIntegrations={() => {
            setSecuritySectionSelection({ section: 'exchanges', nonce: Date.now() });
            handleSwitchTab('security');
          }}
          privacyMode={privacyMode}
          onTogglePrivacyMode={handleTogglePrivacyMode}
          onOpenDetails={() => setPortfolioModalOpen(true)}
          onManageInScreener={() => {
            setScreenerSectionSelection({ section: 'portfolio', nonce: Date.now() });
            handleSwitchTab('screener');
          }}
          onClearPortfolio={paperPortfolio.clearHoldings}
          onResetDemo={paperPortfolio.resetDemoPortfolio}
          bottomSlot={<TickerTape embedded />}
          rightActions={
            <>
              <motion.button
                type="button"
                whileTap={{ scale: 0.94 }}
                onClick={() => {
                  triggerHaptic(8);
                  setAssistantSheetOpen(true);
                }}
                aria-label="Справочник функций и Помощник VERNIER"
                title="Справочник функций и AI-помощник"
                className="min-h-[34px] min-w-[34px] px-2 rounded-lg border border-emerald-500/35 bg-emerald-500/12 hover:bg-emerald-500/20 text-emerald-300 inline-flex items-center justify-center transition-colors shrink-0"
              >
                <BookOpen className="w-4 h-4 shrink-0" />
              </motion.button>
              <motion.button
                type="button"
                whileTap={{ scale: 0.94 }}
                onClick={() => {
                  triggerHaptic(8);
                  setWidgetsModalOpen(true);
                }}
                aria-label="Виджеты Android"
                title="Виджеты Android"
                className="min-h-[34px] min-w-[34px] px-2 rounded-lg border border-cyan-500/35 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 inline-flex items-center justify-center transition-colors shrink-0"
              >
                <LayoutGrid className="w-4 h-4 shrink-0" />
              </motion.button>
              <motion.button
                type="button"
                whileTap={{ scale: 0.94 }}
                onClick={() => {
                  triggerHaptic(8);
                  handleStartTour();
                }}
                aria-label="Интерактивный тур по терминалу"
                title="Интерактивный тур"
                className="min-h-[34px] min-w-[34px] px-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-emerald-400 inline-flex items-center justify-center transition-colors shrink-0"
              >
                <Compass className="w-4 h-4 shrink-0" />
              </motion.button>
              <div className="hidden md:block shrink-0">
                <PWAInstallButton compact onOpenWidgets={() => setWidgetsModalOpen(true)} />
              </div>
            </>
          }
        />

        {targetReachedNotice && (
          <div className="mb-4 rounded-xl border border-cyan-500/35 bg-cyan-500/12 px-4 py-3 text-xs text-cyan-100 flex items-center justify-between gap-3">
            <span className="min-w-0 break-words">{targetReachedNotice}</span>
            <button
              type="button"
              onClick={() => setTargetReachedNotice(null)}
              className="text-cyan-300 hover:text-white font-medium shrink-0"
            >
              Скрыть
            </button>
          </div>
        )}

        {paymentNotice && (
          <div className="mb-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-200 flex items-center justify-between gap-3">
            <span className="min-w-0 break-words">{paymentNotice}</span>
            <button
              type="button"
              onClick={() => {
                setPaymentNotice(null);
                window.history.replaceState(null, '', window.location.pathname);
              }}
              className="text-emerald-300 hover:text-white font-medium shrink-0"
            >
              Скрыть
            </button>
          </div>
        )}

        {(authError || bannerError) && (
          <div className="mb-5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-200 flex items-start justify-between gap-3 overflow-hidden">
            <span className="min-w-0 flex-1 break-words leading-relaxed">
              {formatBannerErrorMessage(authError || bannerError || '')}
            </span>
            <button
              type="button"
              onClick={() => {
                setBannerError(null);
                clearAuthError();
              }}
              className="text-rose-300 hover:text-white font-medium shrink-0"
            >
              Скрыть
            </button>
          </div>
        )}

        <div className="relative w-full">
          <AnimatePresence mode="popLayout" initial={false} custom={tabDirection}>
            <motion.div
              key={activeTab}
              custom={tabDirection}
              variants={tabSlideBlurVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="w-full will-change-transform"
            >
            <Suspense fallback={<ViewFallback />}>
            {activeTab === 'market' && (
              <MarketTerminalView
                profile={effectiveProfile}
                isSignedIn={isSignedIn}
                userEmail={firebaseUser?.email || privateSecurity?.email || ''}
                analyses={analyses}
                priceAlerts={effectivePriceAlerts}
                supportTickets={supportTickets}
                pushSubscribed={pushState.isSubscribed}
                externalSelection={marketSelection}
                onRequireLogin={() => void handleLoginWithPush()}
                onUpgradePro={() => {
                  setPricingTier('pro');
                  setPricingOpen(true);
                }}
                onUpgradeMax={() => {
                  setPricingTier('max');
                  setPricingOpen(true);
                }}
                onOpenPushSettings={() => {
                  setSecuritySectionSelection({ section: 'push', nonce: Date.now() });
                  handleSwitchTab('security');
                }}
                onOpenFullFaq={() => {
                  setSecuritySectionSelection({ section: 'audit', sub: 'faq', nonce: Date.now() });
                  handleSwitchTab('security');
                }}
                onStartTour={handleStartTour}
                onCreateSupportTicket={createSupportTicket}
                onCreatePriceAlert={handleCreatePriceAlertUnified}
                onTogglePriceAlert={handleTogglePriceAlertUnified}
                onDeletePriceAlert={handleDeletePriceAlertUnified}
                onCheckPriceAlertsNow={handleCheckPriceAlertsUnified}
                onConsumeAndSave={handleConsumeAndSaveWithPush}
                onSignalEmitted={handleSignalEmitted}
                exchangeKeys={exchangeKeys}
                onOpenExchangeIntegrations={() => {
                  setSecuritySectionSelection({ section: 'exchanges', nonce: Date.now() });
                  handleSwitchTab('security');
                }}
                onPlaceExchangeOrder={handlePlaceExchangeOrderProtected}
              />
            )}

            {activeTab === 'screener' && (
              <MarketScreenerView
                isPro={isProSubscriptionActive(effectiveProfile)}
                privacyMode={privacyMode}
                onUpgradePro={() => {
                  setPricingTier('pro');
                  setPricingOpen(true);
                }}
                onOpenPairOnMarket={handleOpenPairOnMarket}
                holdings={paperPortfolio.holdings}
                portfolioReport={paperPortfolio.report}
                activeTarget={activePortfolioTarget}
                onOpenPortfolioDetails={() => setPortfolioModalOpen(true)}
                onAddHolding={paperPortfolio.addHolding}
                onUpdateHolding={paperPortfolio.updateHolding}
                onRemoveHolding={paperPortfolio.removeHolding}
                externalSection={screenerSectionSelection}
              />
            )}

            {activeTab === 'strategies' && (
              <StrategiesView
                profile={effectiveProfile}
                strategies={effectiveStrategies}
                analyses={analyses}
                isSignedIn={isSignedIn}
                uid={firebaseUser?.uid ?? null}
                privacyMode={privacyMode}
                pushSubscribed={pushState.isSubscribed}
                portfolioBalanceUsdt={paperPortfolio.report.totalValue}
                onOpenPushSettings={() => {
                  setSecuritySectionSelection({ section: 'push', nonce: Date.now() });
                  handleSwitchTab('security');
                }}
                onRequireLogin={() => void handleLoginWithPush()}
                onSwitchPlan={handleProtectedPlanSwitch}
                onConsumeCredits={handleConsumeCreditsUnified}
                onOpenPairOnMarket={handleOpenPairOnMarket}
                onSaveStrategy={handleProtectedStrategySave}
                externalSection={strategiesSectionSelection}
              />
            )}

            {activeTab === 'news' && (
              <NewsFeedView
                isPro={isProSubscriptionActive(effectiveProfile)}
                onUpgradePro={() => {
                  setPricingTier('pro');
                  setPricingOpen(true);
                }}
              />
            )}

            {activeTab === 'security' && (
              <SecurityCenterView
                profile={effectiveProfile}
                privateSecurity={privateSecurity}
                auditLogs={auditLogs}
                sessions={sessions}
                priceAlerts={effectivePriceAlerts}
                currentSessionId={currentSessionId}
                isSignedIn={isSignedIn}
                pushState={pushState}
                externalSection={securitySectionSelection}
                onRequireLogin={() => void handleLoginWithPush()}
                onSavePendingTotp={savePendingTotp}
                onActivateTotp={activateTotp}
                onDisableTotpWithPrompt={handleDisable2faPrompt}
                onUpdateAutoLock={updateAutoLockMinutes}
                onLockNow={() => {
                  if (pinHash) {
                    setIsPinLocked(true);
                  } else {
                    setIsLocked(true);
                  }
                }}
                onRevokeOtherSessions={revokeOtherSessions}
                onRevokeSession={revokeSessionById}
                onToggleSessionSuspicious={toggleSessionSuspicious}
                onCreatePriceAlert={handleCreatePriceAlertUnified}
                onTogglePriceAlert={handleTogglePriceAlertUnified}
                onDeletePriceAlert={handleDeletePriceAlertUnified}
                onCheckPriceAlertsNow={handleCheckPriceAlertsUnified}
                exchangeKeys={exchangeKeys}
                exchangeSyncCache={exchangeSyncCache}
                backgroundSyncingKeyIds={backgroundSyncingKeyIds}
                exchangeSyncErrorLogs={exchangeSyncErrorLogs}
                onClearExchangeSyncErrorLogs={handleClearExchangeSyncErrorLogs}
                portfolioSource={paperPortfolio.portfolioSource}
                onConnectExchange={handleConnectExchangeWithSync}
                onSyncExchange={handleSyncExchangeToPortfolio}
                onUpdateExchange={handleUpdateExchangeWithSync}
                onToggleExchange={toggleExchangeKey}
                onDeleteExchange={handleDeleteExchangeProtected}
                onPlaceExchangeOrder={handlePlaceExchangeOrderProtected}
                onStartTour={handleStartTour}
                themeMode={themeMode}
                onChangeThemeMode={handleChangeThemeMode}
                privacyMode={privacyMode}
                onTogglePrivacyMode={handleTogglePrivacyMode}
                demoPlanOverride={demoPlanOverride}
                onChangeDemoPlan={handleChangeDemoPlan}
                pinEnabled={Boolean(pinHash)}
                pinTimeoutMin={pinTimeoutMin}
                onSavePin={handleSavePin}
                onDisablePin={handleDisablePin}
                onChangePinTimeout={handleChangePinTimeout}
                antiPhishingCode={antiPhishingCode}
                onSaveAntiPhishingCode={handleSaveAntiPhishing}
                legalConsent={legalConsent}
                onRevokeConsent={() => {
                  revokeLegalConsent();
                  setLegalConsent(null);
                  setLegalConsentMode('onboarding');
                  setLegalConsentOpen(true);
                }}
                onOpenLegalDoc={setOpenLegalDoc}
                onDeleteAccountAndAllData={handleDeleteAccountAndAllData}
              />
            )}
            </Suspense>
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* Mobile Fixed Thumb-Zone Bottom Tab Bar */}
      <nav
        aria-label="Мобильная навигация"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-16 pb-safe border-t border-white/10 bg-[#0B0F17]/95 backdrop-blur-md grid grid-cols-5 items-center"
      >
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <motion.button
              key={item.id}
              type="button"
              whileTap={{ scale: 0.92 }}
              onClick={() => handleSwitchTab(item.id)}
              className={`relative min-h-[44px] flex flex-col items-center justify-center gap-0.5 transition-colors ${
                isActive ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {isActive && (
                <motion.span
                  layoutId="mobile-nav-pill-bg"
                  transition={NATIVE_PILL_SPRING}
                  className="absolute inset-x-1.5 inset-y-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20"
                />
              )}
              {isActive && (
                <motion.span
                  layoutId="mobile-nav-indicator"
                  transition={NATIVE_PILL_SPRING}
                  className="absolute top-0 left-4 right-4 h-0.5 rounded-full bg-gradient-to-r from-emerald-400 via-cyan-400 to-amber-400"
                />
              )}
              <motion.span
                animate={{ y: isActive ? -1.5 : 0, scale: isActive ? 1.08 : 1 }}
                transition={NATIVE_PILL_SPRING}
                className="relative z-10 inline-flex"
              >
                {item.icon}
              </motion.span>
              <span className="relative z-10 text-[11px] font-medium tracking-tight">{item.mobileLabel}</span>
            </motion.button>
          );
        })}
      </nav>

      <PricingModal
        open={pricingOpen}
        onClose={() => setPricingOpen(false)}
        proUntil={effectiveProfile?.proUntil}
        currentPlan={getActivePlanTier(effectiveProfile)}
        initialTier={pricingTier}
        initialMaxMultiplier={pricingMaxMultiplier}
        onActivateDemoTier={(tier, maxMult) => {
          handleChangeDemoPlan({ tier, maxMultiplier: maxMult ?? 10 });
          setPaymentNotice(
            `Демо-режим переключён на тариф ${tier.toUpperCase()}${
              tier === 'max' ? ` ×${maxMult ?? 10}` : ''
            }. Все функции этого уровня разблокированы.`
          );
          setPricingOpen(false);
        }}
      />

      {/* Mandatory Onboarding / Auth 4-Checkbox Legal Consent Gate (UA Law / GDPR / Google Play) */}
      <LegalConsentModal
        open={legalConsentOpen}
        mode={legalConsentMode}
        onAccepted={(record) => {
          setLegalConsent(record);
          setLegalConsentOpen(false);
          if (pendingLoginAfterConsent) {
            setPendingLoginAfterConsent(false);
            void runGoogleOAuthWithCsrf();
          }
        }}
        onCancel={
          legalConsentMode === 'auth'
            ? () => {
                setLegalConsentOpen(false);
                setPendingLoginAfterConsent(false);
              }
            : undefined
        }
      />

      {/* Full Legal Document Viewer (Privacy Policy / Terms / Disclaimer) */}
      <LegalDocumentModal doc={openLegalDoc} onClose={() => setOpenLegalDoc(null)} />

      {/* 4-Digit PIN App Lock Screen */}
      {isPinLocked && pinHash && (
        <PinLockOverlay
          expectedPinHash={pinHash}
          antiPhishingCode={antiPhishingCode}
          onUnlocked={() => setIsPinLocked(false)}
        />
      )}

      {/* 2FA Step-Up Verification Dialog */}
      {pendingStepUp && firebaseUser && privateSecurity?.totpEncryptedSecret && (
        <TwoFactorModal
          open={Boolean(pendingStepUp)}
          title={pendingStepUp.title}
          description={pendingStepUp.description}
          uid={firebaseUser.uid}
          encryptedSecret={privateSecurity.totpEncryptedSecret}
          backupCodeHashes={privateSecurity.backupCodeHashes}
          onVerified={async (consumedBackupHash) => {
            await record2faVerification(consumedBackupHash);
            const exec = pendingStepUp.execute;
            setPendingStepUp(null);
            await exec();
          }}
          onClose={() => {
            const cancelCb = pendingStepUp.onCancel;
            setPendingStepUp(null);
            cancelCb?.();
          }}
        />
      )}

      {/* 2FA Session Lock Screen */}
      {isLocked && firebaseUser && profile?.twoFactorEnabled && privateSecurity?.totpEncryptedSecret && (
        <LockScreenOverlay
          uid={firebaseUser.uid}
          email={privateSecurity.email}
          encryptedSecret={privateSecurity.totpEncryptedSecret}
          backupCodeHashes={privateSecurity.backupCodeHashes}
          onUnlocked={handle2faUnlockWithPush}
          onLogout={logout}
        />
      )}

      {/* Offline PWA Connectivity Indicator */}
      <OfflineIndicator />

      {/* Non-Intrusive Floating Upgrade Bar (Free users only) */}
      {(() => {
        const showFloatingUpgradeBar =
          planContextValue.plan === 'FREE' &&
          !upgradeBarDismissed &&
          !pricingOpen &&
          !widgetsModalOpen &&
          !portfolioModalOpen &&
          !assistantSheetOpen &&
          !tourOpen &&
          !isLocked &&
          !isPinLocked &&
          !legalConsentOpen;

        return (
          <>
            <AnimatePresence>
              {showFloatingUpgradeBar && (
                <motion.aside
                  key="free-upgrade-floating-bar"
                  role="region"
                  aria-label="Переход на VERNIER PRO и MAX"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 16 }}
                  transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                  className="upgrade-bar-breathe breathe-pulse fixed inset-x-3 bottom-[72px] md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:bottom-5 z-30 md:w-[min(560px,calc(100vw-2rem))] rounded-2xl border border-emerald-500/25 bg-[#0B1219]/92 backdrop-blur-md shadow-xl shadow-black/45 px-3 py-2 flex items-center justify-between gap-2.5"
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <span className="upgrade-bar-icon-breathe w-8 h-8 rounded-xl border border-amber-400/30 bg-gradient-to-br from-amber-500/18 to-cyan-500/18 flex items-center justify-center shrink-0">
                      <Sparkles className="w-4 h-4 text-cyan-300" />
                    </span>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-white truncate">
                        Откройте PRO / MAX
                      </div>
                      <div className="text-[11px] text-slate-300 truncate">
                        <span className="text-cyan-300 font-medium">AI-Консилиум</span>
                        <span className="text-slate-500 mx-1" aria-hidden="true">·</span>
                        <span className="text-emerald-300 font-medium">Монте-Карло</span>
                        <span className="hidden sm:inline text-slate-400"> · 9 MAX-стратегий WR 55%+</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.95 }}
                      onClick={() => {
                        triggerHaptic(10);
                        setPricingTier('max');
                        setPricingOpen(true);
                      }}
                      className="cta-shimmer min-h-[34px] px-3 rounded-xl bg-gradient-to-r from-amber-400 via-emerald-400 to-cyan-400 hover:brightness-105 text-slate-950 text-xs font-bold whitespace-nowrap inline-flex items-center gap-1 transition-all shrink-0"
                    >
                      <Crown className="w-3.5 h-3.5 shrink-0" />
                      <span>PRO / MAX</span>
                    </motion.button>
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic(6);
                        setUpgradeBarDismissed(true);
                        try {
                          window.sessionStorage.setItem('vernier_upgrade_bar_dismissed_v1', '1');
                        } catch {
                          // Ignore storage errors
                        }
                      }}
                      aria-label="Скрыть предложение PRO и MAX"
                      title="Скрыть"
                      className="min-h-[34px] min-w-[34px] rounded-lg text-slate-400 hover:text-white hover:bg-white/8 inline-flex items-center justify-center shrink-0 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </motion.aside>
              )}
            </AnimatePresence>

            {/* Global Assistant & Permanent Feature Manual BottomSheet (triggered from header strip — no overlapping floating FABs) */}
            <BottomSheet
              open={assistantSheetOpen}
              onClose={() => setAssistantSheetOpen(false)}
              title="Помощник и Справочник VERNIER"
              subtitle="Инструкция по функциям · Чат Gemini · FAQ и тур"
              maxWidthClass="sm:max-w-2xl"
              bodyClassName="p-3.5 sm:p-4"
            >
              <BottomSheetItem index={0}>
                <QuickAnswersCard
                  inSheet
                  isSignedIn={isSignedIn}
                  userEmail={firebaseUser?.email || privateSecurity?.email || ''}
                  supportTickets={supportTickets}
                  onRequireLogin={() => {
                    setAssistantSheetOpen(false);
                    void handleLoginWithPush();
                  }}
                  onCreateSupportTicket={createSupportTicket}
                  onOpenPushSettings={() => {
                    setAssistantSheetOpen(false);
                    setSecuritySectionSelection({ section: 'push', nonce: Date.now() });
                    handleSwitchTab('security');
                  }}
                  onOpenAiSection={() => {
                    setAssistantSheetOpen(false);
                    handleSwitchTab('market');
                  }}
                  onUpgradePro={() => {
                    setAssistantSheetOpen(false);
                    setPricingTier('pro');
                    setPricingOpen(true);
                  }}
                  onOpenFullFaq={() => {
                    setAssistantSheetOpen(false);
                    setSecuritySectionSelection({ section: 'audit', sub: 'faq', nonce: Date.now() });
                    handleSwitchTab('security');
                  }}
                  onStartTour={() => {
                    setAssistantSheetOpen(false);
                    handleStartTour();
                  }}
                />
              </BottomSheetItem>
            </BottomSheet>
          </>
        );
      })()}

      {/* First-Visit Interactive Interface Tour */}
      <InterfaceTour
        open={tourOpen && !isLocked && !isPinLocked && !legalConsentOpen}
        activeTab={activeTab}
        onSelectTab={handleSwitchTab}
        onClose={handleCloseTour}
      />

      {/* Android Home Screen & Widgets Hub */}
      <Suspense fallback={null}>
        <AndroidWidgetsModal
          open={widgetsModalOpen}
          onClose={() => setWidgetsModalOpen(false)}
          portfolioReport={paperPortfolio.report}
          holdingsCount={paperPortfolio.holdings.length}
          strategies={strategies}
          onLaunchStandaloneWidget={launchStandaloneWidget}
        />
      </Suspense>

      {/* Expanded Portfolio PnL Breakdown & Trade History Modal */}
      <Suspense fallback={null}>
        <PortfolioDetailsModal
          open={portfolioModalOpen}
          onClose={() => setPortfolioModalOpen(false)}
          uid={firebaseUser?.uid ?? null}
          isSignedIn={isSignedIn}
          report={paperPortfolio.report}
          dailyPnl={paperPortfolio.dailyPnl}
          portfolioSource={paperPortfolio.portfolioSource}
          portfolioIdentity={paperPortfolio.portfolioIdentity}
          portfolioTargets={effectivePortfolioTargets}
          pushSubscribed={pushState.isSubscribed}
          notifyPortfolioPnlEnabled={pushState.preferences.notifyPortfolioPnl}
          spotTickers={paperPortfolio.spotTickers}
          analyses={analyses}
          onRequireLogin={() => void handleLoginWithPush()}
          onOpenPairOnMarket={handleOpenPairOnMarket}
          onManageInScreener={() => {
            setScreenerSectionSelection({ section: 'portfolio', nonce: Date.now() });
            handleSwitchTab('screener');
          }}
          onOpenTradeJournal={() => {
            setStrategiesSectionSelection({ section: 'journal', nonce: Date.now() });
            handleSwitchTab('strategies');
          }}
          onOpenExchangeIntegrations={() => {
            setSecuritySectionSelection({ section: 'exchanges', nonce: Date.now() });
            handleSwitchTab('security');
          }}
          onOpenPushSettings={() => {
            setSecuritySectionSelection({ section: 'push', nonce: Date.now() });
            handleSwitchTab('security');
          }}
          onSavePortfolioTarget={handleSavePortfolioTarget}
          onDeletePortfolioTarget={handleDeletePortfolioTarget}
          onRemoveHolding={paperPortfolio.removeHolding}
          onClearPortfolio={paperPortfolio.clearHoldings}
          onResetDemo={paperPortfolio.resetDemoPortfolio}
        />
      </Suspense>

      {/* Mandatory Per-Launch Non-Custodial API Trade Confirmation Modal */}
      <TradeRiskConfirmModal
        pending={pendingApiOrderConfirm?.payload ?? null}
        onConfirm={() => {
          const current = pendingApiOrderConfirm;
          setPendingApiOrderConfirm(null);
          current?.resolve(true);
        }}
        onCancel={() => {
          const current = pendingApiOrderConfirm;
          setPendingApiOrderConfirm(null);
          current?.resolve(false);
        }}
      />
      </div>
      </LayoutGroup>
      </MotionConfig>
      </FearGreedProvider>
    </PlanProvider>
  );
}
