import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowUp,
  BarChart3,
  Compass,
  Layers,
  LayoutGrid,
  LogIn,
  LogOut,
  Newspaper,
  Radar,
  ShieldCheck,
} from 'lucide-react';
import { AnimatePresence, MotionConfig, motion, useScroll, useSpring } from 'motion/react';
import { AndroidWidgetsModal } from './components/AndroidWidgetsModal';
import { InterfaceTour, TOUR_STORAGE_KEY } from './components/InterfaceTour';
import { LockScreenOverlay } from './components/LockScreenOverlay';
import { MarketScreenerView, type ScreenerSection } from './components/MarketScreenerView';
import { MarketTerminalView } from './components/MarketTerminalView';
import { MiniPortfolioWidget } from './components/MiniPortfolioWidget';
import { tabSlideBlurVariants } from './components/MotionPrimitives';
import { NewsFeedView } from './components/NewsFeedView';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PWAInstallButton } from './components/PWAInstallButton';
import { SecurityCenterView, type SecuritySection } from './components/SecurityCenterView';
import { StandaloneWidgetView } from './components/StandaloneWidgetView';
import { StrategiesView } from './components/StrategiesView';
import { TwoFactorModal } from './components/TwoFactorModal';
import { useAuthAndVault } from './hooks/useAuthAndVault';
import { usePaperPortfolio } from './hooks/usePaperPortfolio';
import { usePushNotifications } from './hooks/usePushNotifications';
import type {
  AnalysisResultPayload,
  AndroidWidgetKind,
  AppTab,
  MarketType,
  PlanTier,
  Timeframe,
} from './types/domain';

interface PendingStepUpAction {
  title: string;
  description: string;
  execute: () => Promise<void>;
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
  const [pendingStepUp, setPendingStepUp] = useState<PendingStepUpAction | null>(null);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [pendingLoginPushUid, setPendingLoginPushUid] = useState<string | null>(null);
  const [tourOpen, setTourOpen] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [marketSelection, setMarketSelection] = useState<{
    symbol: string;
    marketType: MarketType;
    nonce: number;
  } | null>(null);
  const [screenerSectionSelection, setScreenerSectionSelection] = useState<{
    section: ScreenerSection;
    nonce: number;
  } | null>(null);
  const [securitySectionSelection, setSecuritySectionSelection] = useState<{
    section: SecuritySection;
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
    const onScroll = () => {
      setShowScrollTop(window.scrollY > 340);
    };
    const onPopState = () => {
      setStandaloneWidget(getInitialWidgetFromUrl());
      setActiveTab(getInitialTabFromUrl());
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  const handleSwitchTab = useCallback((tab: AppTab) => {
    setActiveTab((prev) => {
      const prevIdx = TAB_ORDER.indexOf(prev);
      const nextIdx = TAB_ORDER.indexOf(tab);
      if (prevIdx !== -1 && nextIdx !== -1 && nextIdx !== prevIdx) {
        setTabDirection(nextIdx > prevIdx ? 1 : -1);
      }
      return tab;
    });
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
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
        window.scrollTo({ top: 0, behavior: 'smooth' });
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
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    },
    [handleSwitchTab]
  );

  const {
    firebaseUser,
    authReady,
    authError,
    profile,
    privateSecurity,
    strategies,
    analyses,
    auditLogs,
    pushSubscriptions,
    sessions,
    priceAlerts,
    currentSessionId,
    isLocked,
    setIsLocked,
    loginWithGoogle,
    logout,
    consumeCreditAndSaveAnalysis,
    updatePlan,
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
  } = useAuthAndVault();

  const isSignedIn = Boolean(authReady && firebaseUser);
  const paperPortfolio = usePaperPortfolio();

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

  useEffect(() => {
    if (!pendingLoginPushUid || firebaseUser?.uid !== pendingLoginPushUid) return;
    const timer = setTimeout(() => {
      setPendingLoginPushUid(null);
      void pushState.triggerSecurityPush({
        overrideUid: pendingLoginPushUid,
        category: 'auth_login',
        title: 'AegisQuant · Выполнен вход в аккаунт',
        body: 'Зафиксирована новая авторизация через Google OAuth.',
        url: '/?tab=security',
      });
    }, 1200);
    return () => clearTimeout(timer);
  }, [pendingLoginPushUid, firebaseUser?.uid, pushState]);

  const handleLoginWithPush = async () => {
    const loggedUid = await loginWithGoogle();
    if (loggedUid) {
      setPendingLoginPushUid(loggedUid);
    }
  };

  const handle2faUnlockWithPush = async (consumedBackupHash: string | null) => {
    await record2faVerification(consumedBackupHash);
    void pushState.triggerSecurityPush({
      category: 'auth_login',
      title: 'AegisQuant · Терминал разблокирован (2FA)',
      body: 'Выполнена успешная проверка кода 2FA после блокировки сессии.',
      url: '/?tab=security',
    });
  };

  const handleConsumeAndSaveWithPush = async (params: {
    symbol: string;
    marketType: MarketType;
    timeframe: string;
    strategyKey: string;
    strategyName: string;
    result: AnalysisResultPayload;
  }) => {
    await consumeCreditAndSaveAnalysis(params);

    if (profile?.plan === 'free' && profile.creditsRemaining <= 1) {
      void pushState.triggerSecurityPush({
        category: 'signal_limit',
        title: 'AegisQuant · Недельные кредиты исчерпаны',
        body: 'Использованы все 10 бесплатных кредитов недели. Перейдите на PRO для безлимитного анализа.',
        url: '/?tab=strategies',
      });
    }

    const matchedStrategy = strategies.find((s) => s.strategyKey === params.strategyKey);
    const effectiveDailyLimit =
      profile?.plan === 'pro' ? matchedStrategy?.dailySignalLimit ?? 1 : 1;
    const now = new Date();
    const startOfTodaySec =
      new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
    const todayCountBefore = analyses.filter((a) => {
      if (a.strategyKey !== params.strategyKey) return false;
      const sec = (a.createdAt as { seconds?: number } | undefined)?.seconds ?? 0;
      return sec >= startOfTodaySec;
    }).length;

    if (todayCountBefore + 1 >= effectiveDailyLimit) {
      void pushState.triggerSecurityPush({
        category: 'signal_limit',
        title: `AegisQuant · Лимит сигналов: ${params.strategyName}`,
        body: `Достигнут дневной лимит сигналов по стратегии (${effectiveDailyLimit} / ${effectiveDailyLimit} в сутки).`,
        url: '/?tab=strategies',
      });
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
      await fetch('/api/push/trigger-signal', {
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
      return new Promise((resolve) => {
        setPendingStepUp({
          title,
          description,
          execute: async () => {
            await action();
            resolve();
          },
        });
      });
    }
    return action();
  };

  const handleProtectedPlanSwitch = async (target: PlanTier) => {
    try {
      setBannerError(null);
      await runWith2faGuard(
        'Подтверждение смены тарифа',
        `Введите код аутентификатора для переключения тарифа на ${target === 'pro' ? 'PRO' : 'Бесплатный'}.`,
        () => updatePlan(target)
      );
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Ошибка обновления подписки');
    }
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
    const stratName = strategies.find((s) => s.id === strategyId)?.name || 'Стратегия';
    await runWith2faGuard(
      'Подтверждение изменения стратегии',
      'Для защиты торговых правил и лимитов сигналов подтвердите действие кодом 2FA.',
      async () => {
        await updateStrategySettings(strategyId, updates);
        const effectiveDailyLimit = profile?.plan === 'pro' ? updates.dailySignalLimit : 1;
        void pushState.triggerSecurityPush({
          category: 'strategy_change',
          title: 'AegisQuant · Изменены настройки стратегии',
          body: `«${stratName}»: ${updates.enabled ? 'Активна' : 'Неактивна'}, лимит ${effectiveDailyLimit} сигн./день, риск ${updates.riskPerTradePct}%.`,
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
      <MotionConfig reducedMotion="user">
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
        <OfflineIndicator />
      </MotionConfig>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-dvh text-slate-100 flex flex-col">
        {/* Desktop 3-Zone Top Bar Contract */}
        <header className="hidden md:block sticky top-0 z-30 border-b border-white/8 bg-[#0B0F17]/88 backdrop-blur-md">
          <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-8">
            {/* Zone 1: Brand Wordmark */}
            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              onClick={() => handleSwitchTab('market')}
              className="flex items-center gap-2.5 text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0 font-display"
            >
              <img
                src="/src/assets/images/aegis_terminal_emblem_1794855840828.jpg"
                alt="AegisQuant"
                referrerPolicy="no-referrer"
                className="w-7 h-7 rounded-lg object-cover border border-white/15"
              />
              <span>AegisQuant</span>
            </motion.button>

            {/* Zone 2: 4 Single-line Nav Links with Sliding Active Indicator */}
            <nav className="flex items-center gap-7 text-sm font-medium">
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
                    className={`relative py-2 whitespace-nowrap shrink-0 transition-colors ${
                      isActive ? 'text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <span>{item.label}</span>
                    {isActive && (
                      <motion.span
                        layoutId="desktop-nav-underline"
                        transition={{ type: 'spring', stiffness: 460, damping: 35 }}
                        className="absolute left-0 right-0 -bottom-px h-0.5 rounded-full bg-gradient-to-r from-emerald-400 to-amber-400"
                      />
                    )}
                  </motion.button>
                );
              })}
            </nav>

            {/* Zone 3: 1 Primary Action */}
            <div className="shrink-0">
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

        {/* Mobile Compact Top Bar (<= 52px) */}
        <header className="md:hidden sticky top-0 z-30 border-b border-white/8 bg-[#0B0F17]/92 backdrop-blur-md">
          <div className="h-[50px] px-4 flex items-center justify-between gap-3">
            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              onClick={() => handleSwitchTab('market')}
              className="flex items-center gap-2 text-base font-bold text-white whitespace-nowrap shrink-0 font-display"
            >
              <img
                src="/src/assets/images/aegis_terminal_emblem_1794855840828.jpg"
                alt="AegisQuant"
                referrerPolicy="no-referrer"
                className="w-6 h-6 rounded-md object-cover border border-white/15"
              />
              <span>AegisQuant</span>
            </motion.button>

            <div className="flex items-center gap-2 shrink-0">
              <PWAInstallButton compact onOpenWidgets={() => setWidgetsModalOpen(true)} />
              {!isSignedIn ? (
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.95 }}
                  onClick={() => void handleLoginWithPush()}
                  className="min-h-[38px] px-3 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 text-xs font-semibold text-white whitespace-nowrap shrink-0"
                >
                  Войти
                </motion.button>
              ) : (
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.95 }}
                  onClick={() => void logout()}
                  aria-label="Выйти"
                  className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-300"
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
      <main className="flex-1 w-full max-w-7xl mx-auto px-3 sm:px-6 py-3 sm:py-4 pb-24 md:pb-8 overflow-x-hidden">
        {/* Compact Single-Row Top Bar: Mini Portfolio + Widgets + Tour + PWA */}
        <MiniPortfolioWidget
          holdingsCount={paperPortfolio.holdings.length}
          report={paperPortfolio.report}
          onManageInScreener={() => {
            setScreenerSectionSelection({ section: 'portfolio', nonce: Date.now() });
            handleSwitchTab('screener');
          }}
          onClearPortfolio={paperPortfolio.clearHoldings}
          onResetDemo={paperPortfolio.resetDemoPortfolio}
          rightActions={
            <>
              <motion.button
                type="button"
                whileTap={{ scale: 0.96 }}
                onClick={() => setWidgetsModalOpen(true)}
                className="min-h-[34px] px-2.5 sm:px-3 rounded-lg border border-cyan-500/35 bg-cyan-500/10 hover:bg-cyan-500/20 text-xs font-medium text-cyan-200 inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
              >
                <LayoutGrid className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span className="hidden sm:inline">Виджеты Android</span>
                <span className="sm:hidden">Виджеты</span>
              </motion.button>
              <motion.button
                type="button"
                whileTap={{ scale: 0.96 }}
                onClick={handleStartTour}
                className="min-h-[34px] px-2.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-medium text-slate-200 inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
              >
                <Compass className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Тур</span>
              </motion.button>
              <div className="hidden md:block">
                <PWAInstallButton compact onOpenWidgets={() => setWidgetsModalOpen(true)} />
              </div>
            </>
          }
        />

        {(authError || bannerError) && (
          <div className="mb-5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-200 flex items-center justify-between gap-3">
            <span>{authError || bannerError}</span>
            <button
              type="button"
              onClick={() => setBannerError(null)}
              className="text-rose-300 hover:text-white font-medium"
            >
              Скрыть
            </button>
          </div>
        )}

        <AnimatePresence mode="wait" custom={tabDirection}>
          <motion.div
            key={activeTab}
            custom={tabDirection}
            variants={tabSlideBlurVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="will-change-transform"
          >
            {activeTab === 'market' && (
              <MarketTerminalView
                profile={profile}
                isSignedIn={isSignedIn}
                analyses={analyses}
                priceAlerts={priceAlerts}
                pushSubscribed={pushState.isSubscribed}
                externalSelection={marketSelection}
                onRequireLogin={() => void handleLoginWithPush()}
                onUpgradePro={() => handleSwitchTab('strategies')}
                onOpenPushSettings={() => {
                  setSecuritySectionSelection({ section: 'push', nonce: Date.now() });
                  handleSwitchTab('security');
                }}
                onCreatePriceAlert={createPriceAlert}
                onTogglePriceAlert={togglePriceAlert}
                onDeletePriceAlert={deletePriceAlert}
                onCheckPriceAlertsNow={checkPriceAlertsNow}
                onConsumeAndSave={handleConsumeAndSaveWithPush}
                onSignalEmitted={handleSignalEmitted}
              />
            )}

            {activeTab === 'screener' && (
              <MarketScreenerView
                onOpenPairOnMarket={handleOpenPairOnMarket}
                holdings={paperPortfolio.holdings}
                portfolioReport={paperPortfolio.report}
                onAddHolding={paperPortfolio.addHolding}
                onRemoveHolding={paperPortfolio.removeHolding}
                externalSection={screenerSectionSelection}
              />
            )}

            {activeTab === 'strategies' && (
              <StrategiesView
                profile={profile}
                strategies={strategies}
                isSignedIn={isSignedIn}
                pushSubscribed={pushState.isSubscribed}
                onOpenPushSettings={() => {
                  setSecuritySectionSelection({ section: 'push', nonce: Date.now() });
                  handleSwitchTab('security');
                }}
                onRequireLogin={() => void handleLoginWithPush()}
                onSwitchPlan={handleProtectedPlanSwitch}
                onSaveStrategy={handleProtectedStrategySave}
              />
            )}

            {activeTab === 'news' && <NewsFeedView />}

            {activeTab === 'security' && (
              <SecurityCenterView
                profile={profile}
                privateSecurity={privateSecurity}
                auditLogs={auditLogs}
                sessions={sessions}
                priceAlerts={priceAlerts}
                currentSessionId={currentSessionId}
                isSignedIn={isSignedIn}
                pushState={pushState}
                externalSection={securitySectionSelection}
                onRequireLogin={() => void handleLoginWithPush()}
                onSavePendingTotp={savePendingTotp}
                onActivateTotp={activateTotp}
                onDisableTotpWithPrompt={handleDisable2faPrompt}
                onUpdateAutoLock={updateAutoLockMinutes}
                onLockNow={() => setIsLocked(true)}
                onRevokeOtherSessions={revokeOtherSessions}
                onRevokeSession={revokeSessionById}
                onToggleSessionSuspicious={toggleSessionSuspicious}
                onCreatePriceAlert={createPriceAlert}
                onTogglePriceAlert={togglePriceAlert}
                onDeletePriceAlert={deletePriceAlert}
                onCheckPriceAlertsNow={checkPriceAlertsNow}
                onStartTour={handleStartTour}
              />
            )}
          </motion.div>
        </AnimatePresence>
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
                  layoutId="mobile-nav-indicator"
                  transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                  className="absolute top-0 left-4 right-4 h-0.5 rounded-full bg-gradient-to-r from-emerald-400 to-amber-400"
                />
              )}
              <motion.span
                animate={{ y: isActive ? -1.5 : 0, scale: isActive ? 1.08 : 1 }}
                transition={{ type: 'spring', stiffness: 420, damping: 28 }}
                className="inline-flex"
              >
                {item.icon}
              </motion.span>
              <span className="text-[11px] font-medium tracking-tight">{item.mobileLabel}</span>
            </motion.button>
          );
        })}
      </nav>

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
          onClose={() => setPendingStepUp(null)}
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

      {/* Floating Smooth Scroll-to-Top Action */}
      <AnimatePresence>
        {showScrollTop && (
          <motion.button
            type="button"
            initial={{ opacity: 0, y: 16, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.9 }}
            whileTap={{ scale: 0.92 }}
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            aria-label="Прокрутить наверх"
            className="fixed right-4 bottom-20 md:bottom-6 z-30 min-h-[44px] min-w-[44px] px-3 rounded-xl border border-cyan-500/35 bg-[#111827]/95 backdrop-blur-md text-cyan-200 hover:bg-cyan-500/15 shadow-xl inline-flex items-center justify-center gap-1.5 text-xs font-medium transition-colors"
          >
            <ArrowUp className="w-4 h-4" />
            <span className="hidden sm:inline">Наверх</span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* First-Visit Interactive Interface Tour */}
      <InterfaceTour
        open={tourOpen && !isLocked}
        activeTab={activeTab}
        onSelectTab={handleSwitchTab}
        onClose={handleCloseTour}
      />

      {/* Android Home Screen & Widgets Hub */}
      <AndroidWidgetsModal
        open={widgetsModalOpen}
        onClose={() => setWidgetsModalOpen(false)}
        portfolioReport={paperPortfolio.report}
        holdingsCount={paperPortfolio.holdings.length}
        strategies={strategies}
        onLaunchStandaloneWidget={launchStandaloneWidget}
      />
      </div>
    </MotionConfig>
  );
}
