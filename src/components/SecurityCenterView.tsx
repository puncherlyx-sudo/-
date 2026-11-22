import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Bell,
  BellOff,
  BellRing,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Clock,
  Copy,
  Crown,
  Download,
  Eye,
  EyeOff,
  FileClock,
  FileText,
  Flame,
  Globe2,
  KeyRound,
  Link2,
  Lock,
  Moon,
  Palette,
  RefreshCw,
  Scale,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Trash2,
  TrendingUp,
  Webhook,
} from 'lucide-react';
import { motion } from 'motion/react';
import type { PortfolioSourceMeta } from '../hooks/usePaperPortfolio';
import { ApiFieldTooltip } from './ApiFieldTooltip';
import type { PushPreferences } from '../hooks/usePushNotifications';
import type {
  ExchangeId,
  ExchangeKeyPermissions,
  ExchangeKeyRecord,
  ExchangeOrderResult,
  ExchangeSyncResult,
  MarketType,
  PriceAlertCondition,
  PriceAlertRecord,
  SecurityAuditLog,
  UserPrivateSecurity,
  UserProfile,
  UserSessionRecord,
} from '../types/domain';
import { ActiveSessionsPanel } from './ActiveSessionsPanel';
import { EditExchangeKeyModal } from './EditExchangeKeyModal';
import { ExchangeIntegrationPanel } from './ExchangeIntegrationPanel';
import { FeatureGuide } from './FeatureGuide';
import { StaggerDeck } from './MotionPrimitives';
import { PriceAlertsPanel } from './PriceAlertsPanel';
import { SecurityAuditActivityChart } from './SecurityAuditActivityChart';
import { SecurityStrengthIndicator } from './SecurityStrengthIndicator';
import { SyncErrorIntensityChart } from './SyncErrorIntensityChart';
import {
  VirtualizedAuditLogList,
  VirtualizedExchangeSyncLogList,
} from './VirtualizedSecurityLogs';

const LazyExchangeApiGuide = React.lazy(() =>
  import('./ExchangeApiGuide').then((m) => ({ default: m.ExchangeApiGuide }))
);
const LazySecurityFaqSection = React.lazy(() =>
  import('./SecurityFaqSection').then((m) => ({ default: m.SecurityFaqSection }))
);
const LazySessionGeoMapPanel = React.lazy(() =>
  import('./SessionGeoMapPanel').then((m) => ({ default: m.SessionGeoMapPanel }))
);
import { TiltGuardPanel } from './TiltGuardPanel';
import { WebhookBuilderModal } from './WebhookBuilderModal';
import { authFetch } from '../lib/authFetch';
import type { ExchangeSyncCacheMap } from '../lib/exchangeSyncCache';
import {
  countExchangeSyncLogsOlderThan,
  estimateExchangeSyncLogsBytes,
  groupConsecutiveBackgroundSyncErrors,
  SYNC_LOG_AUTO_CLEANUP_DAYS,
  type ExchangeSyncErrorLogEntry,
  type ExchangeSyncSeverity,
} from '../lib/exchangeSyncErrorLog';
import {
  exportAllUserDataJson,
  readLocalReadOnlyKeys,
  writeLocalReadOnlyKeys,
  type DemoPlanOverride,
  type LegalConsentRecord,
  type LocalReadOnlyExchangeKey,
  type ThemeMode,
} from '../lib/localDemoStore';
import {
  DLP_WARNING_MESSAGE,
  detectSensitiveWalletInput,
  encryptLocalSecret,
  sanitizePlainText,
  triggerHaptic,
} from '../lib/securityDlp';
import type { LegalDocKind } from './LegalConsentModal';

export type SecuritySection =
  | 'meter'
  | 'settings'
  | '2fa'
  | 'exchanges'
  | 'api-guide'
  | 'push'
  | 'alerts'
  | 'sessions'
  | 'legal'
  | 'audit'
  | 'tilt';

export interface PushControlState {
  isSupported: boolean;
  permission: NotificationPermission;
  isSubscribed: boolean;
  preferences: PushPreferences;
  loading: boolean;
  statusMessage: string | null;
  error: string | null;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
  updatePreferences: (next: PushPreferences) => Promise<void>;
  sendTestPush: () => Promise<void>;
  scanMarketNow: () => Promise<void>;
}

interface SecurityCenterViewProps {
  profile: UserProfile | null;
  privateSecurity: UserPrivateSecurity | null;
  auditLogs: SecurityAuditLog[];
  sessions: UserSessionRecord[];
  priceAlerts: PriceAlertRecord[];
  currentSessionId: string;
  isSignedIn: boolean;
  pushState: PushControlState;
  externalSection?: {
    section: SecuritySection;
    sub?: 'chart' | 'log' | 'faq';
    nonce: number;
  } | null;
  onRequireLogin: () => void;
  onSavePendingTotp: (encryptedPending: string) => Promise<void>;
  onActivateTotp: (encryptedSecret: string, backupCodeHashes: string[]) => Promise<void>;
  onDisableTotpWithPrompt: () => void;
  onUpdateAutoLock: (minutes: number) => Promise<void>;
  onLockNow: () => void;
  onRevokeOtherSessions: () => Promise<number>;
  onRevokeSession: (sessionId: string) => Promise<void>;
  onToggleSessionSuspicious: (sessionId: string, nextSuspicious: boolean) => Promise<void>;
  onCreatePriceAlert: (params: {
    symbol: string;
    marketType: MarketType;
    condition: PriceAlertCondition;
    targetPrice: number;
  }) => Promise<void>;
  onTogglePriceAlert: (alertId: string, nextActive: boolean) => Promise<void>;
  onDeletePriceAlert: (alertId: string) => Promise<void>;
  onCheckPriceAlertsNow: () => Promise<{
    checkedAlerts: number;
    alertsSent: number;
    triggeredCount: number;
  }>;
  exchangeKeys: ExchangeKeyRecord[];
  exchangeSyncCache?: ExchangeSyncCacheMap;
  backgroundSyncingKeyIds?: string[];
  exchangeSyncErrorLogs?: ExchangeSyncErrorLogEntry[];
  onClearExchangeSyncErrorLogs?: () => void;
  syncLogAutoCleanup30d?: boolean;
  onToggleSyncLogAutoCleanup30d?: (enabled: boolean) => { removedCount: number };
  portfolioSource: PortfolioSourceMeta;
  onConnectExchange: (params: {
    exchange: ExchangeId;
    label: string;
    apiKey: string;
    apiSecret: string;
    passphrase?: string;
    permissions: ExchangeKeyPermissions;
    testnet: boolean;
  }) => Promise<{ key: ExchangeKeyRecord; sync: ExchangeSyncResult }>;
  onSyncExchange: (key: ExchangeKeyRecord, applyToPortfolio: boolean) => Promise<ExchangeSyncResult>;
  onUpdateExchange: (
    existingKey: ExchangeKeyRecord,
    params: {
      label: string;
      apiKey: string;
      apiSecret: string;
      passphrase?: string;
      permissions: ExchangeKeyPermissions;
      testnet: boolean;
    }
  ) => Promise<{ key: ExchangeKeyRecord; sync: ExchangeSyncResult }>;
  onToggleExchange: (keyId: string, nextEnabled: boolean) => Promise<void>;
  onDeleteExchange: (keyId: string) => Promise<void>;
  onPlaceExchangeOrder: (
    key: ExchangeKeyRecord,
    orderParams: {
      symbol: string;
      marketType: MarketType;
      side: 'BUY' | 'SELL';
      orderType: 'MARKET' | 'LIMIT';
      quantity: number;
      limitPrice?: number;
    }
  ) => Promise<ExchangeOrderResult>;
  onStartTour?: () => void;
  themeMode?: ThemeMode;
  onChangeThemeMode?: (mode: ThemeMode) => void;
  privacyMode?: boolean;
  onTogglePrivacyMode?: () => void;
  demoPlanOverride?: DemoPlanOverride | null;
  onChangeDemoPlan?: (override: DemoPlanOverride | null) => void;
  pinEnabled?: boolean;
  pinTimeoutMin?: 0 | 1 | 5 | 15;
  onSavePin?: (pin: string) => Promise<void>;
  onDisablePin?: () => void;
  onChangePinTimeout?: (mins: 0 | 1 | 5 | 15) => void;
  antiPhishingCode?: string;
  onSaveAntiPhishingCode?: (code: string) => void;
  legalConsent?: LegalConsentRecord | null;
  onRevokeConsent?: () => void;
  onOpenLegalDoc?: (doc: LegalDocKind) => void;
  onDeleteAccountAndAllData?: () => Promise<void>;
}

export const SecurityCenterView: React.FC<SecurityCenterViewProps> = ({
  profile,
  privateSecurity,
  auditLogs,
  sessions,
  priceAlerts,
  currentSessionId,
  isSignedIn,
  pushState,
  externalSection,
  onRequireLogin,
  onSavePendingTotp,
  onActivateTotp,
  onDisableTotpWithPrompt,
  onUpdateAutoLock,
  onLockNow,
  onRevokeOtherSessions,
  onRevokeSession,
  onToggleSessionSuspicious,
  onCreatePriceAlert,
  onTogglePriceAlert,
  onDeletePriceAlert,
  onCheckPriceAlertsNow,
  exchangeKeys,
  exchangeSyncCache,
  backgroundSyncingKeyIds,
  exchangeSyncErrorLogs = [],
  onClearExchangeSyncErrorLogs,
  syncLogAutoCleanup30d = true,
  onToggleSyncLogAutoCleanup30d,
  portfolioSource,
  onConnectExchange,
  onSyncExchange,
  onUpdateExchange,
  onToggleExchange,
  onDeleteExchange,
  onPlaceExchangeOrder,
  onStartTour,
  themeMode = 'emerald',
  onChangeThemeMode,
  privacyMode = false,
  onTogglePrivacyMode,
  demoPlanOverride = null,
  onChangeDemoPlan,
  pinEnabled = false,
  pinTimeoutMin = 5,
  onSavePin,
  onDisablePin,
  onChangePinTimeout,
  antiPhishingCode = '',
  onSaveAntiPhishingCode,
  legalConsent = null,
  onRevokeConsent,
  onOpenLegalDoc,
  onDeleteAccountAndAllData,
}) => {
  const [section, setSection] = useState<'hub' | SecuritySection>('hub');
  const [sessionsSub, setSessionsSub] = useState<'map' | 'list'>('map');
  const [auditSub, setAuditSub] = useState<'chart' | 'log' | 'faq'>('chart');
  const [syncLogFilter, setSyncLogFilter] = useState<'all' | ExchangeSyncSeverity>('all');
  const [syncExchangeFilter, setSyncExchangeFilter] = useState<'all' | ExchangeId>('all');
  const [editingExchangeKey, setEditingExchangeKey] = useState<ExchangeKeyRecord | null>(null);
  const [quickFixBusyId, setQuickFixBusyId] = useState<string | null>(null);
  const [quickFixNotice, setQuickFixNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [nowTickMs, setNowTickMs] = useState<number>(() => Date.now());

  // Local PIN, Anti-Phishing, Local AES-GCM Read-Only Keys & 2-Step Account Deletion state
  const [newPinInput, setNewPinInput] = useState('');
  const [pinConfirmInput, setPinConfirmInput] = useState('');
  const [pinStatusMsg, setPinStatusMsg] = useState<string | null>(null);
  const [antiPhishingDraft, setAntiPhishingDraft] = useState(antiPhishingCode);
  const [antiPhishingMsg, setAntiPhishingMsg] = useState<string | null>(null);
  const [localKeys, setLocalKeys] = useState<LocalReadOnlyExchangeKey[]>(() => readLocalReadOnlyKeys());
  const [localExch, setLocalExch] = useState<'binance' | 'bybit' | 'okx'>('binance');
  const [localKeyLabel, setLocalKeyLabel] = useState('');
  const [localApiKey, setLocalApiKey] = useState('');
  const [localApiSecret, setLocalApiSecret] = useState('');
  const [localVaultPassphrase, setLocalVaultPassphrase] = useState('');
  const [localKeyDlpError, setLocalKeyDlpError] = useState<string | null>(null);
  const [localKeySavedNotice, setLocalKeySavedNotice] = useState<string | null>(null);
  const [deleteStepOpen, setDeleteStepOpen] = useState(false);
  const [deleteConfirmWord, setDeleteConfirmWord] = useState('');
  const [deletingAll, setDeletingAll] = useState(false);
  const [dataExportMsg, setDataExportMsg] = useState<string | null>(null);
  const [webhookModalOpen, setWebhookModalOpen] = useState(false);

  useEffect(() => {
    setAntiPhishingDraft(antiPhishingCode);
  }, [antiPhishingCode]);

  const [setupQr, setSetupQr] = useState<string | null>(null);
  const [manualKey, setManualKey] = useState<string | null>(null);
  const [pendingEncrypted, setPendingEncrypted] = useState<string | null>(null);
  const [confirmCode, setConfirmCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [copiedCodes, setCopiedCodes] = useState(false);
  const [loadingSetup, setLoadingSetup] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (section !== 'audit' || auditSub !== 'log') return;
    setNowTickMs(Date.now());
    const id = window.setInterval(() => setNowTickMs(Date.now()), 15000);
    return () => window.clearInterval(id);
  }, [section, auditSub]);

  useEffect(() => {
    if (externalSection) {
      setSection(externalSection.section);
      if (externalSection.section === 'audit' && externalSection.sub) {
        setAuditSub(externalSection.sub);
      }
    }
  }, [externalSection]);

  useEffect(() => {
    const handleTourFocus = (evt: Event) => {
      const targetId = (evt as CustomEvent<string>).detail;
      if (targetId === 'tour-security-meter') {
        setSection('meter');
      }
    };
    window.addEventListener('aegis:tour-focus', handleTourFocus);
    return () => window.removeEventListener('aegis:tour-focus', handleTourFocus);
  }, []);

  const handleStart2faSetup = async () => {
    if (!profile || !privateSecurity) {
      onRequireLogin();
      return;
    }
    setLoadingSetup(true);
    setError(null);
    setBackupCodes(null);
    try {
      const res = await authFetch('/api/security/totp/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: profile.uid,
          email: privateSecurity.email,
        }),
      });
      const data = (await res.json()) as {
        qrDataUrl?: string;
        manualKey?: string;
        encryptedPendingSecret?: string;
        error?: string;
      };
      if (!res.ok || !data.qrDataUrl || !data.encryptedPendingSecret) {
        throw new Error(data.error || 'Не удалось инициировать 2FA.');
      }
      await onSavePendingTotp(data.encryptedPendingSecret);
      setSetupQr(data.qrDataUrl);
      setManualKey(data.manualKey || null);
      setPendingEncrypted(data.encryptedPendingSecret);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка настройки 2FA');
    } finally {
      setLoadingSetup(false);
    }
  };

  const handleConfirm2fa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !pendingEncrypted || !confirmCode.trim()) return;
    setLoadingSetup(true);
    setError(null);
    try {
      const res = await authFetch('/api/security/totp/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: profile.uid,
          encryptedPendingSecret: pendingEncrypted,
          code: confirmCode.trim(),
        }),
      });
      const data = (await res.json()) as {
        verified?: boolean;
        encryptedSecret?: string;
        backupCodes?: string[];
        backupCodeHashes?: string[];
        error?: string;
      };
      if (!res.ok || !data.verified || !data.encryptedSecret || !data.backupCodeHashes) {
        throw new Error(data.error || 'Неверный 6-значный код.');
      }
      await onActivateTotp(data.encryptedSecret, data.backupCodeHashes);
      setBackupCodes(data.backupCodes || []);
      setSetupQr(null);
      setManualKey(null);
      setPendingEncrypted(null);
      setConfirmCode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка активации 2FA');
    } finally {
      setLoadingSetup(false);
    }
  };

  const copyBackupCodes = async () => {
    if (!backupCodes) return;
    await navigator.clipboard.writeText(backupCodes.join('\n'));
    setCopiedCodes(true);
    setTimeout(() => setCopiedCodes(false), 2500);
  };

  const handleJumpToSection = (sectionId: string) => {
    if (sectionId === 'sec-push-panel') {
      setSection('push');
      return;
    }
    setSection('2fa');
  };

  const syncLogStats = useMemo(() => {
    const categoryLabels: Record<string, string> = {
      rate_limit: 'Лимит API',
      auth: 'Ключ / права',
      network: 'Сбой сети',
      exchange_api: 'Ошибка API',
      unknown: 'Сбой синхр.',
    };

    let success = 0;
    let warning = 0;
    let critical = 0;

    const exchangeTotals = new Map<ExchangeId, number>();
    const exchangeErrorMap = new Map<
      ExchangeId,
      {
        exchange: ExchangeId;
        errorCount: number;
        criticalCount: number;
        warningCount: number;
        lastErrorAtMs: number;
        categories: Map<string, number>;
      }
    >();
    const globalCategories = new Map<string, number>();

    for (const entry of exchangeSyncErrorLogs) {
      exchangeTotals.set(entry.exchange, (exchangeTotals.get(entry.exchange) ?? 0) + 1);
      if (entry.severity === 'success') {
        success += 1;
      } else {
        if (entry.severity === 'warning') warning += 1;
        else critical += 1;

        globalCategories.set(entry.category, (globalCategories.get(entry.category) ?? 0) + 1);

        const bucket = exchangeErrorMap.get(entry.exchange) ?? {
          exchange: entry.exchange,
          errorCount: 0,
          criticalCount: 0,
          warningCount: 0,
          lastErrorAtMs: 0,
          categories: new Map<string, number>(),
        };
        bucket.errorCount += 1;
        if (entry.severity === 'critical') bucket.criticalCount += 1;
        else bucket.warningCount += 1;
        if (entry.occurredAtMs > bucket.lastErrorAtMs) {
          bucket.lastErrorAtMs = entry.occurredAtMs;
        }
        bucket.categories.set(entry.category, (bucket.categories.get(entry.category) ?? 0) + 1);
        exchangeErrorMap.set(entry.exchange, bucket);
      }
    }

    const issues = warning + critical;
    const topErrorExchanges = Array.from(exchangeErrorMap.values())
      .sort(
        (a, b) =>
          b.errorCount - a.errorCount ||
          b.criticalCount - a.criticalCount ||
          b.lastErrorAtMs - a.lastErrorAtMs
      )
      .slice(0, 3)
      .map((item) => {
        let topCatKey = 'unknown';
        let topCatCount = 0;
        for (const [cat, cnt] of item.categories.entries()) {
          if (cnt > topCatCount) {
            topCatCount = cnt;
            topCatKey = cat;
          }
        }
        const totalForExchange = exchangeTotals.get(item.exchange) ?? item.errorCount;
        return {
          exchange: item.exchange,
          errorCount: item.errorCount,
          criticalCount: item.criticalCount,
          warningCount: item.warningCount,
          totalForExchange,
          errorRatePct: totalForExchange > 0 ? (item.errorCount / totalForExchange) * 100 : 0,
          shareOfErrorsPct: issues > 0 ? (item.errorCount / issues) * 100 : 0,
          topCategoryLabel: categoryLabels[topCatKey] ?? 'Сбой синхр.',
        };
      });

    let dominantCategoryKey: string | null = null;
    let dominantCategoryCount = 0;
    for (const [cat, cnt] of globalCategories.entries()) {
      if (cnt > dominantCategoryCount) {
        dominantCategoryCount = cnt;
        dominantCategoryKey = cat;
      }
    }
    const topErrorCategoryLabel = dominantCategoryKey
      ? categoryLabels[dominantCategoryKey] ?? 'Сбой синхр.'
      : null;

    const groupedAll = groupConsecutiveBackgroundSyncErrors(exchangeSyncErrorLogs);
    const total = exchangeSyncErrorLogs.length;
    const groupedTotal = groupedAll.length;
    const successPct = total > 0 ? (success / total) * 100 : 0;
    const warningPct = total > 0 ? (warning / total) * 100 : 0;
    const criticalPct = total > 0 ? (critical / total) * 100 : 0;
    const filtered = groupedAll.filter((group) => {
      if (syncLogFilter !== 'all' && group.entry.severity !== syncLogFilter) return false;
      if (syncExchangeFilter !== 'all' && group.entry.exchange !== syncExchangeFilter) return false;
      return true;
    });
    const timeline = exchangeSyncErrorLogs.slice(0, 24).reverse();
    const storageBytes = estimateExchangeSyncLogsBytes(exchangeSyncErrorLogs);
    const expiredOlderThan30d = countExchangeSyncLogsOlderThan(
      exchangeSyncErrorLogs,
      SYNC_LOG_AUTO_CLEANUP_DAYS
    );

    return {
      total,
      groupedTotal,
      success,
      warning,
      critical,
      issues,
      successPct,
      warningPct,
      criticalPct,
      topErrorExchanges,
      topErrorCategoryLabel,
      filtered,
      timeline,
      storageBytes,
      expiredOlderThan30d,
    };
  }, [exchangeSyncErrorLogs, syncLogFilter, syncExchangeFilter]);

  // Компактный расчёт Индекса защиты (0–100%) и первого невыполненного шага для Hero-карточки
  const securityHeroSummary = useMemo(() => {
    const backupCount = privateSecurity?.backupCodeHashes?.length ?? 0;
    const is2faOn = Boolean(isSignedIn && profile?.twoFactorEnabled);
    const autoLockMins = profile?.autoLockMinutes ?? 15;
    const criticalPushCount = [
      pushState.preferences.notifyAuthLogins,
      pushState.preferences.notifyStrategyChanges,
      pushState.preferences.notifySignalLimits,
    ].filter(Boolean).length;

    let score = 0;
    if (isSignedIn) score += 20;
    if (is2faOn) score += 30;
    if (is2faOn && backupCount > 0) score += 15;
    if (is2faOn) score += autoLockMins <= 15 ? 15 : 7;
    if (isSignedIn && pushState.isSubscribed) {
      if (criticalPushCount === 3) score += 20;
      else if (criticalPushCount > 0) score += 12;
      else score += 6;
    }

    let nextActionLabel = 'Проверить индекс';
    let nextSection: SecuritySection = 'meter';
    let needsLogin = false;

    if (!isSignedIn) {
      nextActionLabel = 'Войти через Google';
      needsLogin = true;
    } else if (!is2faOn) {
      nextActionLabel = 'Усилить защиту: 2FA';
      nextSection = '2fa';
    } else if (backupCount === 0) {
      nextActionLabel = 'Усилить защиту: Коды';
      nextSection = '2fa';
    } else if (!pushState.isSubscribed || criticalPushCount < 3) {
      nextActionLabel = 'Усилить защиту: Push';
      nextSection = 'push';
    } else if (!pinEnabled) {
      nextActionLabel = 'Усилить защиту: PIN';
      nextSection = 'settings';
    } else {
      nextActionLabel = 'Индекс защиты 100%';
      nextSection = 'meter';
    }

    const levelLabel =
      score >= 90
        ? 'Максимальный'
        : score >= 65
          ? 'Высокий'
          : score >= 35
            ? 'Средний'
            : 'Базовый';

    const barClass =
      score >= 65 ? 'bg-emerald-500' : score >= 35 ? 'bg-amber-400' : 'bg-rose-500';
    const textClass =
      score >= 65 ? 'text-emerald-400' : score >= 35 ? 'text-amber-300' : 'text-rose-400';

    return { score, levelLabel, barClass, textClass, nextActionLabel, nextSection, needsLogin };
  }, [isSignedIn, pinEnabled, privateSecurity, profile, pushState.isSubscribed, pushState.preferences]);

  const connectedExchangeMeta = useMemo(() => {
    const activeCloud = isSignedIn ? exchangeKeys.filter((k) => k.enabled) : [];
    const totalCount = isSignedIn ? exchangeKeys.length : localKeys.length;
    if (totalCount === 0) {
      return { connected: false, label: 'Не подключено' };
    }
    const names = Array.from(
      new Set(
        isSignedIn
          ? (activeCloud.length > 0 ? activeCloud : exchangeKeys).map((k) =>
              k.exchange.toUpperCase()
            )
          : localKeys.map((k) => k.exchange.toUpperCase())
      )
    );
    return {
      connected: true,
      label: names.slice(0, 2).join(' · ') + (names.length > 2 ? ` +${names.length - 2}` : ''),
    };
  }, [exchangeKeys, isSignedIn, localKeys]);

  const activeAlertsCount = useMemo(
    () => priceAlerts.filter((a) => a.active).length,
    [priceAlerts]
  );

  const sectionMetaMap: Record<SecuritySection, { title: string; subtitle: string }> = {
    meter: { title: 'Индекс защиты', subtitle: 'Детальный чек-лист безопасности профиля' },
    exchanges: { title: 'Интеграция бирж', subtitle: 'Read-Only API · Шифрование AES-GCM' },
    'api-guide': {
      title: 'Руководство по подключению API',
      subtitle: 'Binance, Bybit, OKX · Права Read-Only без вывода',
    },
    alerts: { title: 'Ценовые алерты и Webhook', subtitle: 'Триггеры цены, индикаторов и Telegram' },
    tilt: { title: 'Анти-FOMO / Tilt-Guard', subtitle: 'Контроль лимитов потерь и дисциплины (MAX)' },
    '2fa': { title: '2FA и резервные коды', subtitle: 'TOTP Google Authenticator и автоблокировка' },
    settings: { title: 'PIN-код и антифишинг', subtitle: 'PIN-код (PBKDF2), таймер и антифишинг' },
    sessions: { title: 'Сессии и карта входов', subtitle: 'Активные устройства и геолокация' },
    push: { title: 'Push-уведомления PWA', subtitle: 'Критические оповещения в реальном времени' },
    legal: { title: 'Данные и Закон', subtitle: 'GDPR · Google Play · Закон Украины № 2297-VI' },
    audit: { title: 'Логи, FAQ и обучение', subtitle: 'Журнал синхронизации, справка и тур' },
  };

  const requireLoginCard = (title: string, desc: string) => (
    <div className="rounded-2xl border border-white/8 bg-[#111827] p-6 sm:p-8 text-center space-y-4">
      <ShieldAlert className="w-10 h-10 text-amber-400 mx-auto" />
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <p className="text-sm text-slate-400 max-w-md mx-auto">{desc}</p>
      <button
        type="button"
        onClick={onRequireLogin}
        className="min-h-[44px] px-6 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold"
      >
        Войти через Google
      </button>
    </div>
  );

  const openInnerSection = (target: SecuritySection) => {
    triggerHaptic(8);
    setSection(target);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <StaggerDeck>
      {section === 'hub' ? (
        <div className="max-w-3xl mx-auto space-y-4">
          <FeatureGuide
            title="Как работает Центр защиты (Non-Custodial)"
            summary="VERNIER не принимает и не хранит ваши деньги. Здесь вы подключаете Read-Only/торговые API-ключи с шифрованием AES-GCM, настраиваете 2FA, PIN, Tilt-Guard и переключаете Demo Tier Switcher."
            steps={[
              'Интеграция бирж: добавляйте ключи строго без права вывода (No Withdraw). Каждая сделка через API требует ручного подтверждения ответственности.',
              'Demo Tier Switcher: переключайте Free / PRO / MAX ×10 / MAX ×20 для бесплатного тестирования всех стратегий и модулей.',
              'Безопасность доступа: включите 2FA, PIN-код и антифишинговый код для защиты вашего профиля.',
            ]}
            compact
          />
          {/* Top Compact Hero Card — Индекс защиты */}
          <section
            data-tour-id="tour-security-meter"
            className="rounded-2xl border border-emerald-500/25 bg-[var(--surface-1)] card-surface-glow p-4 sm:p-5 space-y-3.5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <img
                  src="/src/assets/images/terminal_icon_vault_1794855844198.jpg"
                  alt="Центр защиты VERNIER"
                  width={44}
                  height={44}
                  referrerPolicy="no-referrer"
                  className="w-11 h-11 rounded-xl object-cover border border-emerald-500/30 shrink-0"
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h2 className="text-base sm:text-lg font-bold text-white leading-tight">
                      Индекс защиты
                    </h2>
                    <span className={`text-xs font-semibold ${securityHeroSummary.textClass}`}>
                      · {securityHeroSummary.levelLabel}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400 flex flex-wrap items-center gap-1.5">
                    <span
                      className={`inline-block w-2 h-2 rounded-full ${
                        isSignedIn ? 'bg-emerald-400' : 'bg-amber-400'
                      }`}
                    />
                    <span className="leading-snug">
                      {isSignedIn ? (
                        <>
                          Google OAuth подключён ·{' '}
                          <span className="whitespace-nowrap">Non-Custodial</span>
                        </>
                      ) : (
                        'Гостевой режим · Войдите через Google OAuth'
                      )}
                    </span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => openInnerSection('meter')}
                className="text-right shrink-0 group"
                aria-label="Открыть подробный чек-лист индекса защиты"
              >
                <div className={`text-2xl sm:text-3xl font-bold font-mono tabular-nums leading-none ${securityHeroSummary.textClass}`}>
                  {securityHeroSummary.score}%
                </div>
                <div className="mt-1 text-[10px] text-slate-400 group-hover:text-emerald-300 transition-colors">
                  Детали →
                </div>
              </button>
            </div>

            {/* Clean Progress Bar 0-100% */}
            <div
              role="progressbar"
              aria-valuenow={securityHeroSummary.score}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Индекс защиты: ${securityHeroSummary.score}%`}
              className="h-2 w-full rounded-full bg-[var(--surface-0)] border border-white/8 overflow-hidden"
            >
              <div
                style={{ width: `${Math.max(4, securityHeroSummary.score)}%` }}
                className={`progress-bar-shine h-full rounded-full transition-all duration-500 ${securityHeroSummary.barClass}`}
              />
            </div>

            {/* Single Primary Action CTA */}
            <motion.button
              type="button"
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => {
                triggerHaptic(10);
                if (securityHeroSummary.needsLogin) {
                  onRequireLogin();
                } else {
                  openInnerSection(securityHeroSummary.nextSection);
                }
              }}
              className="cta-shimmer w-full min-h-[42px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors"
            >
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>{securityHeroSummary.nextActionLabel}</span>
            </motion.button>
          </section>

          {/* SECTION 1 — Торговля и интеграции (самый верхний приоритет) */}
          <section className="space-y-2">
            <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-300/90">
              Торговля и интеграции
            </h3>
            <div className="rounded-2xl border border-emerald-500/20 bg-[var(--surface-1)] divide-y divide-white/8 overflow-hidden">
              {/* 1. Интеграция бирж — заметная карточка с акцентом */}
              <button
                type="button"
                onClick={() => openInnerSection('exchanges')}
                className="w-full min-h-[64px] px-4 py-3.5 text-left flex items-center justify-between gap-3 bg-emerald-500/[0.06] hover:bg-emerald-500/[0.11] transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-10 h-10 rounded-xl border border-emerald-500/35 bg-emerald-500/15 text-emerald-300 flex items-center justify-center shrink-0">
                    <Link2 className="w-5 h-5" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white leading-snug">
                      Интеграция бирж
                    </div>
                    <div className="text-xs text-slate-400 truncate">
                      Read-Only API · AES-GCM · Binance, OKX, Bybit
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`px-2 py-0.5 rounded-lg text-[11px] font-mono font-semibold border whitespace-nowrap ${
                      connectedExchangeMeta.connected
                        ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                        : 'border-white/12 bg-[var(--surface-0)] text-slate-400'
                    }`}
                  >
                    {connectedExchangeMeta.label}
                  </span>
                  <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                </div>
              </button>

              {/* 1b. Руководство по подключению API (Binance, Bybit, OKX + Безопасность) */}
              <button
                type="button"
                onClick={() => openInnerSection('api-guide')}
                className="w-full min-h-[58px] px-4 py-3 text-left flex items-center justify-between gap-3 hover:bg-white/[0.03] transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-9 h-9 rounded-xl border border-cyan-500/25 bg-cyan-500/10 text-cyan-300 flex items-center justify-center shrink-0">
                    <BookOpen className="w-4 h-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white leading-snug">
                      Руководство по подключению API
                    </div>
                    <div className="text-xs text-slate-400 truncate">
                      Пошагово для Binance, Bybit, OKX · Безопасность Read-Only
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="px-2 py-0.5 rounded-lg text-[10px] font-mono font-semibold border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 whitespace-nowrap">
                    Гайд
                  </span>
                  <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                </div>
              </button>

              {/* 2. Ценовые алерты и Webhook / Telegram */}
              <button
                type="button"
                onClick={() => openInnerSection('alerts')}
                className="w-full min-h-[58px] px-4 py-3 text-left flex items-center justify-between gap-3 hover:bg-white/[0.03] transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-9 h-9 rounded-xl border border-cyan-500/25 bg-cyan-500/10 text-cyan-300 flex items-center justify-center shrink-0">
                    <BellRing className="w-4 h-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white leading-snug">
                      Ценовые алерты и Webhook / Telegram
                    </div>
                    <div className="text-xs text-slate-400 truncate">
                      Триггеры цены, Smart Alerts и JSON-вебхуки
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="px-2 py-0.5 rounded-lg text-[11px] font-mono tabular-nums border border-white/10 bg-[var(--surface-0)] text-slate-300">
                    {activeAlertsCount > 0 ? `${activeAlertsCount} акт.` : '0 акт.'}
                  </span>
                  <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                </div>
              </button>

              {/* 3. Анти-FOMO / Tilt-Guard (MAX) */}
              <button
                type="button"
                onClick={() => openInnerSection('tilt')}
                className="w-full min-h-[58px] px-4 py-3 text-left flex items-center justify-between gap-3 hover:bg-white/[0.03] transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-9 h-9 rounded-xl border border-amber-500/25 bg-amber-500/10 text-amber-300 flex items-center justify-center shrink-0">
                    <Flame className="w-4 h-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white leading-snug">
                      Анти-FOMO / Tilt-Guard
                    </div>
                    <div className="text-xs text-slate-400 truncate">
                      Дневной лимит потерь и таймер охлаждения
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="px-2 py-0.5 rounded-lg text-[10px] font-mono font-bold border border-cyan-400/35 bg-cyan-500/12 text-cyan-300">
                    MAX
                  </span>
                  <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                </div>
              </button>
            </div>
          </section>

          {/* SECTION 2 — Безопасность доступа */}
          <section className="space-y-2">
            <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Безопасность доступа
            </h3>
            <div className="rounded-2xl border border-white/10 bg-[var(--surface-1)] divide-y divide-white/8 overflow-hidden">
              {/* 1. 2FA и резервные коды */}
              <button
                type="button"
                onClick={() => openInnerSection('2fa')}
                className="w-full min-h-[58px] px-4 py-3 text-left flex items-center justify-between gap-3 hover:bg-white/[0.03] transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-9 h-9 rounded-xl border border-amber-500/25 bg-amber-500/10 text-amber-300 flex items-center justify-center shrink-0">
                    <KeyRound className="w-4 h-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white leading-snug">
                      2FA и резервные коды
                    </div>
                    <div className="text-xs text-slate-400 truncate">
                      TOTP Google Authenticator · {privateSecurity?.backupCodeHashes?.length ?? 0}/8 кодов
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`px-2 py-0.5 rounded-lg text-[11px] font-mono font-semibold border ${
                      profile?.twoFactorEnabled
                        ? 'border-emerald-500/35 bg-emerald-500/12 text-emerald-300'
                        : 'border-white/10 bg-[var(--surface-0)] text-slate-400'
                    }`}
                  >
                    {profile?.twoFactorEnabled ? 'Вкл' : 'Выкл'}
                  </span>
                  <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                </div>
              </button>

              {/* 2. PIN-код, автоблокировка и антифишинг */}
              <button
                type="button"
                onClick={() => openInnerSection('settings')}
                className="w-full min-h-[58px] px-4 py-3 text-left flex items-center justify-between gap-3 hover:bg-white/[0.03] transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-9 h-9 rounded-xl border border-emerald-500/25 bg-emerald-500/10 text-emerald-300 flex items-center justify-center shrink-0">
                    <Lock className="w-4 h-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white leading-snug">
                      PIN-код, автоблокировка и антифишинг
                    </div>
                    <div className="text-xs text-slate-400 truncate">
                      {antiPhishingCode ? `Код: ${antiPhishingCode}` : 'PIN-код (PBKDF2), таймер и антифишинг'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`px-2 py-0.5 rounded-lg text-[11px] font-mono font-semibold border whitespace-nowrap ${
                      pinEnabled
                        ? 'border-emerald-500/35 bg-emerald-500/12 text-emerald-300'
                        : 'border-white/10 bg-[var(--surface-0)] text-slate-400'
                    }`}
                  >
                    {pinEnabled ? (pinTimeoutMin > 0 ? `${pinTimeoutMin} мин` : 'Вкл') : 'Выкл'}
                  </span>
                  <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                </div>
              </button>

              {/* 3. Сессии и карта входов */}
              <button
                type="button"
                onClick={() => openInnerSection('sessions')}
                className="w-full min-h-[58px] px-4 py-3 text-left flex items-center justify-between gap-3 hover:bg-white/[0.03] transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-9 h-9 rounded-xl border border-cyan-500/25 bg-cyan-500/10 text-cyan-300 flex items-center justify-center shrink-0">
                    <Globe2 className="w-4 h-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white leading-snug">
                      Сессии и карта входов
                    </div>
                    <div className="text-xs text-slate-400 truncate">
                      Контроль устройств и завершение чужих сессий
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="px-2 py-0.5 rounded-lg text-[11px] font-mono tabular-nums border border-white/10 bg-[var(--surface-0)] text-slate-300">
                    {sessions.length || 1} устр.
                  </span>
                  <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                </div>
              </button>

              {/* 4. Push-уведомления PWA */}
              <button
                type="button"
                onClick={() => openInnerSection('push')}
                className="w-full min-h-[58px] px-4 py-3 text-left flex items-center justify-between gap-3 hover:bg-white/[0.03] transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-9 h-9 rounded-xl border border-emerald-500/25 bg-emerald-500/10 text-emerald-300 flex items-center justify-center shrink-0">
                    <Bell className="w-4 h-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white leading-snug">
                      Push-уведомления PWA
                    </div>
                    <div className="text-xs text-slate-400 truncate">
                      Оповещения о входах, сигналах и лимитах
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`px-2 py-0.5 rounded-lg text-[11px] font-mono font-semibold border ${
                      pushState.isSubscribed
                        ? 'border-emerald-500/35 bg-emerald-500/12 text-emerald-300'
                        : 'border-white/10 bg-[var(--surface-0)] text-slate-400'
                    }`}
                  >
                    {pushState.isSubscribed ? 'Вкл' : 'Выкл'}
                  </span>
                  <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                </div>
              </button>
            </div>
          </section>

          {/* SECTION 3 — Интерфейс и демо-режим (прямо в Хабе, без лишних экранов) */}
          <section className="space-y-2">
            <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Интерфейс и демо-режим
            </h3>
            <div className="rounded-2xl border border-white/10 bg-[var(--surface-1)] divide-y divide-white/8 overflow-hidden">
              {/* Quick Toggle: Режим приватности */}
              <div className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-9 h-9 rounded-xl border border-amber-500/25 bg-amber-500/10 text-amber-300 flex items-center justify-center shrink-0">
                    {privacyMode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white leading-snug">
                      Режим приватности
                    </div>
                    <div className="text-xs text-slate-400">
                      Скрывает суммы и PnL маской •••••
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={privacyMode}
                  aria-label="Переключить режим приватности"
                  onClick={() => {
                    triggerHaptic(10);
                    onTogglePrivacyMode?.();
                  }}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors ${
                    privacyMode ? 'border-amber-400/60 bg-amber-500' : 'border-white/15 bg-white/10'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      privacyMode ? 'translate-x-5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* Quick Toggle: Pure OLED Black */}
              <div className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-9 h-9 rounded-xl border border-emerald-500/25 bg-emerald-500/10 text-emerald-300 flex items-center justify-center shrink-0">
                    <Moon className="w-4 h-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white leading-snug">
                      Тема Pure OLED Black
                    </div>
                    <div className="text-xs text-slate-400">
                      {themeMode === 'oled'
                        ? 'Активен #000000 (максимум контраста)'
                        : 'Активна фирменная Emerald Dark'}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={themeMode === 'oled'}
                  aria-label="Переключить тему Pure OLED Black"
                  onClick={() => {
                    triggerHaptic(10);
                    onChangeThemeMode?.(themeMode === 'oled' ? 'emerald' : 'oled');
                  }}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors ${
                    themeMode === 'oled'
                      ? 'border-emerald-400/60 bg-emerald-500'
                      : 'border-white/15 bg-white/10'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      themeMode === 'oled' ? 'translate-x-5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* Inline Demo Tier Switcher */}
              {onChangeDemoPlan && (
                <div className="px-4 py-3.5 space-y-2.5 bg-amber-500/[0.03]">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-white">
                      <Crown className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>Тест-режим тарифа</span>
                    </div>
                    {demoPlanOverride && (
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-amber-500/20 text-amber-200 border border-amber-400/40">
                        ДЕМО: {demoPlanOverride.tier.toUpperCase()}
                        {demoPlanOverride.tier === 'max' ? ` ×${demoPlanOverride.maxMultiplier}` : ''}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                    {(
                      [
                        { id: 'real', label: 'Реальный', override: null as DemoPlanOverride | null },
                        { id: 'free', label: 'Free', override: { tier: 'free', maxMultiplier: 10 } as DemoPlanOverride },
                        { id: 'pro', label: 'PRO', override: { tier: 'pro', maxMultiplier: 10 } as DemoPlanOverride },
                        { id: 'max10', label: 'MAX ×10', override: { tier: 'max', maxMultiplier: 10 } as DemoPlanOverride },
                        { id: 'max20', label: 'MAX ×20', override: { tier: 'max', maxMultiplier: 20 } as DemoPlanOverride },
                      ] as const
                    ).map((opt) => {
                      const isActive =
                        opt.override === null
                          ? demoPlanOverride === null
                          : demoPlanOverride?.tier === opt.override.tier &&
                            (opt.override.tier !== 'max' ||
                              demoPlanOverride.maxMultiplier === opt.override.maxMultiplier);
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => {
                            triggerHaptic(10);
                            onChangeDemoPlan(opt.override);
                          }}
                          className={`min-h-[36px] px-2 rounded-xl border text-[11px] font-semibold transition-all whitespace-nowrap ${
                            isActive
                              ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200'
                              : 'border-white/10 bg-[var(--surface-0)] text-slate-300 hover:text-white'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* SECTION 4 — Данные, закон и логи */}
          <section className="space-y-2">
            <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Данные, закон и логи
            </h3>
            <div className="rounded-2xl border border-white/10 bg-[var(--surface-1)] divide-y divide-white/8 overflow-hidden">
              <button
                type="button"
                onClick={() => openInnerSection('legal')}
                className="w-full min-h-[58px] px-4 py-3 text-left flex items-center justify-between gap-3 hover:bg-white/[0.03] transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-9 h-9 rounded-xl border border-emerald-500/25 bg-emerald-500/10 text-emerald-300 flex items-center justify-center shrink-0">
                    <Scale className="w-4 h-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white leading-snug">
                      Данные и Закон
                    </div>
                    <div className="text-xs text-slate-400 truncate">
                      GDPR · Google Play · Закон Украины № 2297-VI
                    </div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
              </button>

              <button
                type="button"
                onClick={() => openInnerSection('audit')}
                className="w-full min-h-[58px] px-4 py-3 text-left flex items-center justify-between gap-3 hover:bg-white/[0.03] transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-9 h-9 rounded-xl border border-white/12 bg-white/5 text-slate-300 flex items-center justify-center shrink-0">
                    <FileClock className="w-4 h-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white leading-snug">
                      Логи активности, FAQ и обучение
                    </div>
                    <div className="text-xs text-slate-400 truncate">
                      Журнал безопасности, ответы и интерактивный тур
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {syncLogStats.issues > 0 && (
                    <span className="px-2 py-0.5 rounded-lg text-[11px] font-mono tabular-nums border border-amber-500/35 bg-amber-500/15 text-amber-300">
                      {syncLogStats.issues}
                    </span>
                  )}
                  <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                </div>
              </button>
            </div>
          </section>
        </div>
      ) : (
        <div className="max-w-4xl mx-auto space-y-4">
          {/* Sticky Inner Sub-Screen Header */}
          <div className="sticky top-[56px] z-20 -mx-1 px-3 py-2.5 rounded-2xl border border-emerald-500/20 bg-[var(--surface-1)] flex items-center justify-between gap-3 shadow-lg shadow-black/30">
            <button
              type="button"
              onClick={() => {
                triggerHaptic(8);
                setSection('hub');
              }}
              className="min-h-[38px] px-3 rounded-xl border border-white/10 bg-[var(--surface-0)] hover:border-emerald-500/40 text-xs font-semibold text-emerald-300 inline-flex items-center gap-1.5 shrink-0 transition-colors"
            >
              <ArrowLeft className="w-4 h-4 shrink-0" />
              <span>Назад к Защите</span>
            </button>
            <div className="min-w-0 text-right">
              <div className="text-xs sm:text-sm font-bold text-white truncate">
                {sectionMetaMap[section].title}
              </div>
              <div className="text-[11px] text-slate-400 truncate hidden sm:block">
                {sectionMetaMap[section].subtitle}
              </div>
            </div>
          </div>

        {section === 'meter' && (
          <SecurityStrengthIndicator
            isSignedIn={isSignedIn}
            profile={profile}
            privateSecurity={privateSecurity}
            pushSubscribed={pushState.isSubscribed}
            pushPreferences={pushState.preferences}
            onRequireLogin={onRequireLogin}
            onJumpToSection={handleJumpToSection}
          />
        )}

        {section === 'tilt' && <TiltGuardPanel />}

        {section === 'settings' && (
          <div className="space-y-4">
            {/* Theme & Privacy Mode */}
            <div className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-white flex items-center gap-2">
                    <Palette className="w-4 h-4 text-emerald-400" />
                    <span>Оформление и Приватность</span>
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-400">
                    3-уровневая изумрудная палитра или Pure OLED Black для экономии батареи.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(10);
                    onChangeThemeMode?.('emerald');
                  }}
                  className={`min-h-[54px] px-3.5 py-2.5 rounded-xl border text-left flex items-center justify-between transition-colors ${
                    themeMode === 'emerald'
                      ? 'border-emerald-400/50 bg-emerald-500/12 text-white'
                      : 'border-white/10 bg-[#0B0F17] text-slate-300 hover:border-white/20'
                  }`}
                >
                  <div>
                    <div className="text-xs font-semibold">Emerald Dark (Фирменная)</div>
                    <div className="text-[11px] font-mono text-slate-400">#071010 / #0E1C1C / #152828</div>
                  </div>
                  <span className="w-4 h-4 rounded-full bg-emerald-500 border border-emerald-200/40 shrink-0" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(10);
                    onChangeThemeMode?.('oled');
                  }}
                  className={`min-h-[54px] px-3.5 py-2.5 rounded-xl border text-left flex items-center justify-between transition-colors ${
                    themeMode === 'oled'
                      ? 'border-emerald-400/50 bg-black text-white'
                      : 'border-white/10 bg-[#0B0F17] text-slate-300 hover:border-white/20'
                  }`}
                >
                  <div>
                    <div className="text-xs font-semibold flex items-center gap-1.5">
                      <Moon className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Pure OLED Black</span>
                    </div>
                    <div className="text-[11px] font-mono text-slate-400">#000000 · Макс. контраст</div>
                  </div>
                  <span className="w-4 h-4 rounded-full bg-black border border-white/30 shrink-0" />
                </button>
              </div>

              <div className="rounded-xl border border-white/8 bg-[#0B0F17] p-3.5 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                    {privacyMode ? (
                      <EyeOff className="w-3.5 h-3.5 text-amber-400" />
                    ) : (
                      <Eye className="w-3.5 h-3.5 text-emerald-400" />
                    )}
                    <span>Режим приватности (Privacy Mode)</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-400">
                    Мгновенно скрывает баланс портфеля и суммы сделок маской ••••• в общественных местах.
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={privacyMode}
                  onClick={() => {
                    triggerHaptic(10);
                    onTogglePrivacyMode?.();
                  }}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors ${
                    privacyMode ? 'border-amber-400/60 bg-amber-500' : 'border-white/15 bg-white/10'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      privacyMode ? 'translate-x-5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* Demo Tier Switcher */}
            {onChangeDemoPlan && (
              <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-b from-amber-500/[0.06] to-[#111827] p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                      <Crown className="w-4 h-4 text-amber-400" />
                      <span>Тест-режим тарифа (Demo Tier Switcher)</span>
                    </h3>
                    <p className="mt-0.5 text-xs text-slate-400">
                      Мгновенно переключайте уровень подписки для проверки всех функций Free, PRO, MAX X10 и MAX X20 без оплаты.
                    </p>
                  </div>
                  {demoPlanOverride && (
                    <span className="px-2 py-0.5 rounded-md text-[11px] font-mono font-bold bg-amber-500/20 text-amber-200 border border-amber-400/40">
                      ДЕМО: {demoPlanOverride.tier.toUpperCase()}
                      {demoPlanOverride.tier === 'max' ? ` ×${demoPlanOverride.maxMultiplier}` : ''}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {(
                    [
                      { id: 'real', label: 'Реальный', override: null as DemoPlanOverride | null },
                      { id: 'free', label: 'Free', override: { tier: 'free', maxMultiplier: 10 } as DemoPlanOverride },
                      { id: 'pro', label: 'PRO', override: { tier: 'pro', maxMultiplier: 10 } as DemoPlanOverride },
                      { id: 'max10', label: 'MAX X10', override: { tier: 'max', maxMultiplier: 10 } as DemoPlanOverride },
                      { id: 'max20', label: 'MAX X20', override: { tier: 'max', maxMultiplier: 20 } as DemoPlanOverride },
                    ] as const
                  ).map((opt) => {
                    const isActive =
                      opt.override === null
                        ? demoPlanOverride === null
                        : demoPlanOverride?.tier === opt.override.tier &&
                          (opt.override.tier !== 'max' ||
                            demoPlanOverride.maxMultiplier === opt.override.maxMultiplier);
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          triggerHaptic(12);
                          onChangeDemoPlan(opt.override);
                        }}
                        className={`min-h-[38px] px-2.5 rounded-xl border text-xs font-semibold transition-all ${
                          isActive
                            ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200'
                            : 'border-white/10 bg-[#0B0F17] text-slate-300 hover:text-white'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* MAX #6: Анти-FOMO / Tilt-Guard */}
            <TiltGuardPanel />

            {/* 4-Digit PIN App Lock & Anti-Phishing Code */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-2xl border border-white/8 bg-[#111827] p-5 space-y-3.5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Lock className="w-4 h-4 text-emerald-400" />
                    <span>PIN-блокировка терминала (4 цифры)</span>
                  </h3>
                  <span
                    className={`text-[11px] font-mono font-semibold ${
                      pinEnabled ? 'text-emerald-400' : 'text-slate-500'
                    }`}
                  >
                    {pinEnabled ? 'Активен' : 'Выкл'}
                  </span>
                </div>

                <p className="text-xs text-slate-400">
                  Локальный 4-значный PIN-код (PBKDF2) защищает доступ к терминалу при сворачивании или простое.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    value={newPinInput}
                    onChange={(e) => setNewPinInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="Новый PIN (4 цифры)"
                    aria-label="Новый 4-значный PIN"
                    className="w-full min-h-[42px] rounded-xl border border-white/10 bg-[#0B0F17] px-3 text-xs font-mono tracking-widest placeholder:font-sans placeholder:tracking-normal text-white focus:border-emerald-500 focus:outline-none"
                  />
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    value={pinConfirmInput}
                    onChange={(e) => setPinConfirmInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="Повторите PIN"
                    aria-label="Повторите 4-значный PIN"
                    className="w-full min-h-[42px] rounded-xl border border-white/10 bg-[#0B0F17] px-3 text-xs font-mono tracking-widest placeholder:font-sans placeholder:tracking-normal text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>

                {pinStatusMsg && <div className="text-xs text-emerald-300">{pinStatusMsg}</div>}

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      if (newPinInput.length !== 4) {
                        setPinStatusMsg('PIN должен состоять ровно из 4 цифр.');
                        return;
                      }
                      if (newPinInput !== pinConfirmInput) {
                        setPinStatusMsg('Введённые PIN-коды не совпадают.');
                        return;
                      }
                      triggerHaptic(12);
                      await onSavePin?.(newPinInput);
                      setNewPinInput('');
                      setPinConfirmInput('');
                      setPinStatusMsg('PIN-код успешно сохранён (PBKDF2).');
                    }}
                    className="min-h-[36px] px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors"
                  >
                    {pinEnabled ? 'Обновить PIN' : 'Установить PIN'}
                  </button>

                  {pinEnabled && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          triggerHaptic(10);
                          onLockNow();
                        }}
                        className="min-h-[36px] px-3 rounded-xl border border-white/12 bg-white/5 hover:bg-white/10 text-xs text-white"
                      >
                        Заблокировать сейчас
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onDisablePin?.();
                          setPinStatusMsg('PIN-блокировка отключена.');
                        }}
                        className="min-h-[36px] px-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-xs text-rose-300"
                      >
                        Сбросить
                      </button>
                    </>
                  )}
                </div>

                <div className="pt-2 border-t border-white/8 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-slate-400">Таймер автоблокировки:</span>
                  <div className="inline-flex items-center gap-1 rounded-lg bg-[#0B0F17] p-0.5 border border-white/10">
                    {([0, 1, 5, 15] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => onChangePinTimeout?.(m)}
                        className={`min-h-[30px] px-2.5 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors ${
                          pinTimeoutMin === m ? 'bg-emerald-500/25 text-emerald-200' : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {m === 0 ? 'Выкл' : `${m} мин`}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Anti-Phishing Code */}
              <div className="rounded-2xl border border-white/8 bg-[#111827] p-5 space-y-3.5">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-cyan-400" />
                  <span>Антифишинговый код</span>
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Задайте секретное слово — оно отображается в шапке терминала и на экране PIN-блокировки, подтверждая подлинность интерфейса VERNIER.
                </p>

                <div className="flex gap-2">
                  <input
                    type="text"
                    maxLength={24}
                    value={antiPhishingDraft}
                    onChange={(e) => {
                      const val = e.target.value;
                      const dlp = detectSensitiveWalletInput(val);
                      if (dlp.blocked) {
                        setAntiPhishingMsg(DLP_WARNING_MESSAGE);
                        return;
                      }
                      setAntiPhishingMsg(null);
                      setAntiPhishingDraft(val);
                    }}
                    placeholder="Например: KYIV-EMERALD-77"
                    className="flex-1 min-h-[38px] rounded-xl border border-white/10 bg-[#0B0F17] px-3 text-xs font-mono text-white focus:border-cyan-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const clean = sanitizePlainText(antiPhishingDraft, 24);
                      onSaveAntiPhishingCode?.(clean);
                      setAntiPhishingMsg(clean ? `Код «${clean}» активирован.` : 'Антифишинговый код очищен.');
                      triggerHaptic(10);
                    }}
                    className="min-h-[38px] px-3.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold shrink-0"
                  >
                    Сохранить
                  </button>
                </div>

                {antiPhishingMsg && <div className="text-xs text-cyan-300">{antiPhishingMsg}</div>}
              </div>
            </div>
          </div>
        )}

        {section === '2fa' && (
          !isSignedIn || !profile
            ? requireLoginCard(
                'Авторизуйтесь для настройки 2FA',
                'Войдите через Google аккаунт, чтобы привязать приложение-аутентификатор и получить 8 резервных кодов.'
              )
            : (
              <div className="space-y-4">
                <div id="sec-2fa-panel" className="rounded-2xl border border-white/8 bg-[#111827] p-5 space-y-4">
                  <div>
                    <h2 className="text-base font-semibold text-white flex items-center gap-2">
                      <KeyRound className="w-4 h-4 text-emerald-400" />
                      <span>Приложение-аутентификатор (Google Authenticator / Authy)</span>
                    </h2>
                    <p className="mt-1 text-xs text-slate-400">
                      Защищает изменение дневных лимитов сигналов, тарифных настроек и разблокировку экрана.
                    </p>
                  </div>

                  {error && (
                    <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
                      {error}
                    </div>
                  )}

                  {backupCodes && backupCodes.length > 0 && (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-amber-300">Сохраните резервные коды</h3>
                        <button
                          type="button"
                          onClick={() => void copyBackupCodes()}
                          className="min-h-[32px] px-3 rounded-lg bg-amber-500/20 text-amber-200 text-xs font-medium inline-flex items-center gap-1.5"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span>{copiedCodes ? 'Скопировано' : 'Копировать'}</span>
                        </button>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-xs text-white">
                        {backupCodes.map((c) => (
                          <div key={c} className="rounded-lg bg-[#0B0F17] border border-white/10 px-2.5 py-1.5 text-center">
                            {c}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {profile.twoFactorEnabled ? (
                    <div className="space-y-3">
                      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 flex items-center gap-3">
                        <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                        <div className="text-xs text-emerald-100">
                          Двухфакторная защита активна. Критические действия требуют подтверждения 6-значным TOTP-кодом.
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2.5">
                        <button
                          type="button"
                          onClick={onLockNow}
                          className="min-h-[40px] px-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-semibold text-white inline-flex items-center gap-2"
                        >
                          <Lock className="w-4 h-4 text-amber-400" />
                          <span>Заблокировать терминал</span>
                        </button>
                        <button
                          type="button"
                          onClick={onDisableTotpWithPrompt}
                          className="min-h-[40px] px-4 rounded-xl border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-xs font-medium text-rose-300"
                        >
                          Отключить 2FA
                        </button>
                      </div>
                    </div>
                  ) : setupQr ? (
                    <form onSubmit={handleConfirm2fa} className="space-y-4">
                      <div className="flex flex-col sm:flex-row items-center gap-4 rounded-xl bg-[#0B0F17] border border-white/10 p-4">
                        <img
                          src={setupQr}
                          alt="QR-код для Google Authenticator"
                          width={144}
                          height={144}
                          className="w-36 h-36 rounded-lg bg-white p-1.5 shrink-0"
                        />
                        <div className="space-y-2 text-xs text-slate-300">
                          <p className="font-medium text-white">1. Отсканируйте QR-код в приложении 2FA</p>
                          <code className="block rounded-lg bg-white/5 px-2.5 py-1.5 font-mono text-[11px] text-emerald-300 break-all">
                            {manualKey}
                          </code>
                        </div>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2.5">
                        <input
                          id="confirm-2fa-code"
                          type="text"
                          value={confirmCode}
                          onChange={(e) => setConfirmCode(e.target.value)}
                          placeholder="000000"
                          className="flex-1 min-h-[42px] rounded-xl border border-white/10 bg-[#0B0F17] px-4 font-mono text-base tracking-[0.2em] text-white focus:border-emerald-500 focus:outline-none"
                        />
                        <button
                          type="submit"
                          disabled={loadingSetup || confirmCode.trim().length < 6}
                          className="min-h-[42px] px-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-semibold text-white"
                        >
                          {loadingSetup ? 'Проверка...' : 'Активировать'}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <button
                      type="button"
                      disabled={loadingSetup}
                      onClick={() => void handleStart2faSetup()}
                      className="w-full min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-sm font-semibold text-white inline-flex items-center justify-center gap-2 transition-colors"
                    >
                      <ShieldCheck className="w-4 h-4" />
                      <span>{loadingSetup ? 'Генерация ключа...' : 'Подключить 2FA и получить QR-код'}</span>
                    </button>
                  )}
                </div>

                <div id="sec-autolock-panel" className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-5 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-white">Автоблокировка при бездействии</h3>
                    <p className="mt-0.5 text-xs text-slate-400">Блокировка экрана при простое (при активной 2FA).</p>
                  </div>
                  <div className="inline-flex items-center p-1 rounded-xl bg-[#0B0F17] border border-white/8">
                    {[5, 15, 30, 60].map((mins) => {
                      const isActive = profile.autoLockMinutes === mins;
                      return (
                        <motion.button
                          key={mins}
                          type="button"
                          whileTap={{ scale: 0.95 }}
                          onClick={() => void onUpdateAutoLock(mins)}
                          className={`relative min-h-[34px] px-3 rounded-lg text-xs font-mono font-medium transition-colors ${
                            isActive ? 'text-white' : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          {isActive && (
                            <motion.span
                              layoutId="autolock-active-chip"
                              transition={{ type: 'spring', stiffness: 450, damping: 34 }}
                              className="absolute inset-0 rounded-lg bg-emerald-600"
                            />
                          )}
                          <span className="relative z-10">{mins} мин</span>
                        </motion.button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )
        )}

        {section === 'exchanges' && (
          !isSignedIn || !profile ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-emerald-500/30 bg-[#111827] p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/35 text-emerald-300 text-[11px] font-semibold mb-1.5">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>Read-Only · Без прав Trade и Withdraw</span>
                    </div>
                    <h2 className="text-base font-semibold text-white">
                      Локальное хранилище API-ключей (Web Crypto AES-GCM)
                    </h2>
                    <p className="mt-0.5 text-xs text-slate-400">
                      Работает в локальном режиме без входа. Ключи шифруются на устройстве через AES-256-GCM; ввод Seed-фраз и приватных ключей заблокирован DLP-фильтром.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onRequireLogin}
                    className="min-h-[36px] px-3 rounded-xl border border-emerald-500/35 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-200 text-xs font-semibold shrink-0"
                  >
                    Войти для облачной синхронизации
                  </button>
                </div>

                {localKeyDlpError && (
                  <div className="rounded-xl border border-rose-500/45 bg-rose-500/15 p-3 text-xs text-rose-200 flex items-start gap-2">
                    <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <span>{localKeyDlpError}</span>
                  </div>
                )}

                {localKeySavedNotice && (
                  <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/12 p-3 text-xs text-emerald-200">
                    {localKeySavedNotice}
                  </div>
                )}

                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setLocalKeyDlpError(null);
                    setLocalKeySavedNotice(null);
                    const combined = `${localKeyLabel} ${localApiKey} ${localApiSecret}`;
                    if (detectSensitiveWalletInput(combined).blocked) {
                      setLocalKeyDlpError(DLP_WARNING_MESSAGE);
                      setLocalApiKey('');
                      setLocalApiSecret('');
                      return;
                    }
                    if (!localApiKey.trim() || !localApiSecret.trim()) {
                      setLocalKeyDlpError('Заполните API Key и API Secret (только Read-Only).');
                      return;
                    }
                    try {
                      const encryptedPayload = await encryptLocalSecret(
                        JSON.stringify({ apiKey: localApiKey.trim(), apiSecret: localApiSecret.trim() }),
                        localVaultPassphrase.trim() || undefined
                      );
                      const nextItem: LocalReadOnlyExchangeKey = {
                        id: `lkey_${Date.now()}`,
                        exchange: localExch,
                        label: sanitizePlainText(localKeyLabel || `${localExch.toUpperCase()} Read-Only`, 40),
                        maskedKey: `${localApiKey.trim().slice(0, 4)}••••${localApiKey.trim().slice(-4)}`,
                        encryptedPayload,
                        readOnlyVerified: true,
                        createdAt: new Date().toISOString(),
                      };
                      const nextList = [nextItem, ...localKeys];
                      setLocalKeys(nextList);
                      writeLocalReadOnlyKeys(nextList);
                      setLocalKeyLabel('');
                      setLocalApiKey('');
                      setLocalApiSecret('');
                      setLocalVaultPassphrase('');
                      setLocalKeySavedNotice(
                        'Ключ зашифрован PBKDF2 + AES-256-GCM и сохранён локально с меткой Read-Only.'
                      );
                      triggerHaptic(12);
                    } catch (err) {
                      setLocalKeyDlpError(
                        err instanceof Error
                          ? err.message
                          : 'Укажите мастер-фразу сейфа (от 4 символов) или активируйте PIN-код выше.'
                      );
                    }
                  }}
                  className="grid grid-cols-1 sm:grid-cols-2 gap-2.5"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-300">
                      <span>Биржа (только Read-Only)</span>
                      <ApiFieldTooltip
                        title="Почему только Read-Only?"
                        body="Локальный сейф предназначен для безопасного хранения ключей чтения. VERNIER никогда не требует права «Withdraw» (вывод средств)."
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-1 p-1 rounded-xl border border-white/10 bg-[#0B0F17]">
                      {(['binance', 'bybit', 'okx'] as const).map((ex) => (
                        <button
                          key={ex}
                          type="button"
                          onClick={() => setLocalExch(ex)}
                          className={`min-h-[30px] rounded-lg text-[11px] font-semibold uppercase transition-colors ${
                            localExch === ex
                              ? 'bg-emerald-600 text-white'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          {ex}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[11px] text-slate-300 block">Название ключа</span>
                    <input
                      type="text"
                      value={localKeyLabel}
                      onChange={(e) => setLocalKeyLabel(e.target.value)}
                      placeholder="Напр. Спот-аналитика"
                      className="w-full min-h-[38px] rounded-xl border border-white/10 bg-[#0B0F17] px-3 text-xs text-white"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-300">
                      <span>API Key (Read-Only)</span>
                      <ApiFieldTooltip
                        title="Публичный API Key"
                        body="Используется только для чтения баланса. Убедитесь, что в кабинете биржи отключён вывод средств (Withdrawals)."
                      />
                    </div>
                    <input
                      type="password"
                      autoComplete="off"
                      value={localApiKey}
                      onChange={(e) => setLocalApiKey(e.target.value)}
                      placeholder="API Key (маскируется ••••)"
                      className="w-full min-h-[38px] rounded-xl border border-white/10 bg-[#0B0F17] px-3 text-xs font-mono text-white"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-300">
                      <span>API Secret</span>
                      <ApiFieldTooltip
                        title="API Secret (AES-256-GCM)"
                        body="Шифруется локально алгоритмом PBKDF2 + AES-256-GCM. Без включённого флага Withdraw на бирже ключ физически не может вывести средства."
                      />
                    </div>
                    <input
                      type="password"
                      autoComplete="off"
                      value={localApiSecret}
                      onChange={(e) => setLocalApiSecret(e.target.value)}
                      placeholder="API Secret (маскируется ••••)"
                      className="w-full min-h-[38px] rounded-xl border border-white/10 bg-[#0B0F17] px-3 text-xs font-mono text-white"
                    />
                  </div>
                  <div className="sm:col-span-2 space-y-1">
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-300">
                      <span>Мастер-фраза локального сейфа</span>
                      <ApiFieldTooltip
                        title="Только Read-Only · Без вывода средств"
                        body="Мы запрашиваем только права «Read-Only» и никогда не требуем доступ к выводу средств (Withdrawals). Мастер-фраза шифрует ключи локально в вашем браузере (PBKDF2 + AES-256-GCM)."
                      />
                    </div>
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={localVaultPassphrase}
                      onChange={(e) => setLocalVaultPassphrase(e.target.value)}
                      placeholder="Мастер-фраза сейфа (от 4 симв. или ваш PIN-код)"
                      className="w-full min-h-[38px] rounded-xl border border-white/10 bg-[#0B0F17] px-3 text-xs text-white"
                    />
                  </div>
                  <button
                    type="submit"
                    className="sm:col-span-2 min-h-[40px] rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors"
                  >
                    Зашифровать и сохранить локально (PBKDF2 + AES-GCM Read-Only)
                  </button>
                </form>

                {localKeys.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-white/8">
                    {localKeys.map((k) => (
                      <div
                        key={k.id}
                        className="rounded-xl border border-white/8 bg-[#0B0F17] px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-white flex items-center gap-2">
                            <span className="uppercase text-emerald-300">{k.exchange}</span>
                            <span className="truncate">{k.label}</span>
                          </div>
                          <div className="mt-0.5 font-mono text-[11px] text-slate-400">
                            {k.maskedKey} · AES-GCM · Read-Only
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const updated = localKeys.filter((item) => item.id !== k.id);
                            setLocalKeys(updated);
                            writeLocalReadOnlyKeys(updated);
                          }}
                          aria-label="Удалить локальный ключ"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <ExchangeIntegrationPanel
              exchangeKeys={exchangeKeys}
              exchangeSyncCache={exchangeSyncCache}
              backgroundSyncingKeyIds={backgroundSyncingKeyIds}
              activePortfolioMode={portfolioSource.mode}
              activePortfolioExchange={portfolioSource.exchange}
              onConnectExchange={onConnectExchange}
              onSyncExchange={onSyncExchange}
              onEditKey={(key) => setEditingExchangeKey(key)}
              onToggleExchange={onToggleExchange}
              onDeleteExchange={onDeleteExchange}
              onPlaceOrder={onPlaceExchangeOrder}
            />
          )
        )}

        {section === 'api-guide' && (
          <div className="space-y-4">
            {/* Блок «Безопасность» — почему нужны только права Read-Only */}
            <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.06] p-4 sm:p-5 space-y-3">
              <div className="flex items-center gap-2.5">
                <span className="w-9 h-9 rounded-xl border border-emerald-500/35 bg-emerald-500/15 text-emerald-300 flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-5 h-5" />
                </span>
                <div>
                  <h2 className="text-sm sm:text-base font-bold text-white">
                    Безопасность: только права Read-Only
                  </h2>
                  <p className="text-[11px] text-emerald-200/80">
                    Архитектура <span className="whitespace-nowrap">Non-Custodial</span> · Без доступа к выводу средств
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                <div className="rounded-xl border border-emerald-500/25 bg-[#0B0F17] p-3 space-y-1">
                  <div className="font-semibold text-emerald-300">✓ Что разрешаем: Read-Only</div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    Права «Чтение» (Enable Reading / Read-Only) позволяют безопасно синхронизировать балансы, открытые позиции и историю PnL с биржи в аналитику VERNIER.
                  </p>
                </div>
                <div className="rounded-xl border border-rose-500/25 bg-[#0B0F17] p-3 space-y-1">
                  <div className="font-semibold text-rose-300">✕ Что запрещаем: Вывод средств</div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    Мы никогда не требуем права на вывод средств (Enable Withdrawals / Internal Transfer). Даже при компрометации устройства ваши активы физически не могут покинуть биржу.
                  </p>
                </div>
              </div>
            </section>

            {/* Пошаговые инструкции с визуальными схемами для Binance, Bybit и OKX */}
            <React.Suspense
              fallback={
                <div className="h-64 rounded-2xl border border-white/8 bg-[#111827] shimmer-skeleton" />
              }
            >
              <LazyExchangeApiGuide initialExchange="binance" />
            </React.Suspense>

            {/* Переход к подключению API-ключа */}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => openInnerSection('exchanges')}
                className="w-full sm:w-auto min-h-[44px] px-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs sm:text-sm font-semibold text-white inline-flex items-center justify-center gap-2 transition-colors"
              >
                <KeyRound className="w-4 h-4 shrink-0" />
                <span>Перейти к подключению API-ключа</span>
              </button>
            </div>
          </div>
        )}

        {section === 'push' && (
          !isSignedIn || !profile
            ? requireLoginCard(
                'Авторизуйтесь для настройки Push-уведомлений',
                'Войдите в аккаунт, чтобы получать фоновые уведомления Android PWA о сигналах и безопасности.'
              )
            : (
              <div id="sec-push-panel" className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-base font-semibold text-white flex items-center gap-2">
                    {pushState.isSubscribed ? (
                      <Bell className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <BellOff className="w-4 h-4 text-slate-400 shrink-0" />
                    )}
                    <span>Фоновые Push-уведомления (PWA / Android)</span>
                  </h3>
                  <span
                    className={`text-xs font-semibold ${
                      !pushState.isSupported || pushState.permission === 'denied'
                        ? 'text-rose-400'
                        : pushState.isSubscribed
                          ? 'text-emerald-400'
                          : 'text-amber-300'
                    }`}
                  >
                    {!pushState.isSupported
                      ? 'Не поддерживается'
                      : pushState.permission === 'denied'
                        ? 'Заблокированы'
                        : pushState.isSubscribed
                          ? 'Активны в фоне'
                          : 'Не подключены'}
                  </span>
                </div>

                {pushState.error && (
                  <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
                    {pushState.error}
                  </div>
                )}
                {pushState.statusMessage && (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200">
                    {pushState.statusMessage}
                  </div>
                )}

                {/* Dedicated Volatility Spike Alert Toggle */}
                <div
                  className={`rounded-xl border p-3.5 transition-colors space-y-2.5 ${
                    pushState.preferences.notifyVolatilitySpikes
                      ? 'border-cyan-500/40 bg-cyan-500/8'
                      : 'border-white/8 bg-[#0B0F17]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <Flame
                        className={`w-4 h-4 mt-0.5 shrink-0 ${
                          pushState.preferences.notifyVolatilitySpikes ? 'text-cyan-400' : 'text-slate-500'
                        }`}
                      />
                      <div className="min-w-0">
                        <div className="text-xs sm:text-sm font-semibold text-white">
                          Скачки волатильности (&gt;{pushState.preferences.volatilityThresholdPct}% за час)
                        </div>
                        <p className="mt-0.5 text-[11px] text-slate-400 leading-relaxed">
                          Мгновенные оповещения о резких ценовых аномалиях по всем 44 торговым парам.
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={pushState.preferences.notifyVolatilitySpikes}
                      aria-label="Переключить уведомления о резких скачках волатильности"
                      disabled={!pushState.isSupported || pushState.loading}
                      onClick={() =>
                        void pushState.updatePreferences({
                          ...pushState.preferences,
                          notifyVolatilitySpikes: !pushState.preferences.notifyVolatilitySpikes,
                        })
                      }
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors disabled:opacity-50 ${
                        pushState.preferences.notifyVolatilitySpikes
                          ? 'border-cyan-400/60 bg-cyan-500'
                          : 'border-white/15 bg-white/10'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                          pushState.preferences.notifyVolatilitySpikes ? 'translate-x-5' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>

                  {pushState.preferences.notifyVolatilitySpikes && (
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/8">
                      <span className="text-[11px] text-slate-400">Порог аномалии за 1 час:</span>
                      <div className="inline-flex items-center gap-1 rounded-lg bg-[#0B0F17] p-0.5 border border-white/10">
                        {[3, 5, 10].map((pct) => {
                          const active = pushState.preferences.volatilityThresholdPct === pct;
                          return (
                            <button
                              key={pct}
                              type="button"
                              disabled={!pushState.isSupported || pushState.loading}
                              onClick={() =>
                                void pushState.updatePreferences({
                                  ...pushState.preferences,
                                  volatilityThresholdPct: pct,
                                })
                              }
                              className={`min-h-[28px] px-2.5 rounded-md text-[11px] font-mono font-semibold transition-colors whitespace-nowrap ${
                                active
                                  ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/40'
                                  : 'text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              &gt;{pct}% / ч
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Dedicated Portfolio Daily PnL Threshold Toggle */}
                <div
                  className={`rounded-xl border p-3.5 transition-colors space-y-2.5 ${
                    pushState.preferences.notifyPortfolioPnl
                      ? 'border-emerald-500/40 bg-emerald-500/8'
                      : 'border-white/8 bg-[#0B0F17]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <TrendingUp
                        className={`w-4 h-4 mt-0.5 shrink-0 ${
                          pushState.preferences.notifyPortfolioPnl ? 'text-emerald-400' : 'text-slate-500'
                        }`}
                      />
                      <div className="min-w-0">
                        <div className="text-xs sm:text-sm font-semibold text-white">
                          PnL и цели доходности портфеля (±{pushState.preferences.portfolioPnlThresholdPct}% / Target PnL)
                        </div>
                        <p className="mt-0.5 text-[11px] text-slate-400 leading-relaxed">
                          Push-оповещение при изменении баланса за 24 часа сверх порога и при достижении заданной целевой доходности портфеля.
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={pushState.preferences.notifyPortfolioPnl}
                      aria-label="Переключить уведомления о дневном PnL портфеля"
                      disabled={!pushState.isSupported || pushState.loading}
                      onClick={() =>
                        void pushState.updatePreferences({
                          ...pushState.preferences,
                          notifyPortfolioPnl: !pushState.preferences.notifyPortfolioPnl,
                        })
                      }
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors disabled:opacity-50 ${
                        pushState.preferences.notifyPortfolioPnl
                          ? 'border-emerald-400/60 bg-emerald-500'
                          : 'border-white/15 bg-white/10'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                          pushState.preferences.notifyPortfolioPnl ? 'translate-x-5' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>

                  {pushState.preferences.notifyPortfolioPnl && (
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/8">
                      <span className="text-[11px] text-slate-400">Порог дневного PnL:</span>
                      <div className="inline-flex items-center gap-1 rounded-lg bg-[#0B0F17] p-0.5 border border-white/10">
                        {[3, 5, 10].map((pct) => {
                          const active = pushState.preferences.portfolioPnlThresholdPct === pct;
                          return (
                            <button
                              key={pct}
                              type="button"
                              disabled={!pushState.isSupported || pushState.loading}
                              onClick={() =>
                                void pushState.updatePreferences({
                                  ...pushState.preferences,
                                  portfolioPnlThresholdPct: pct,
                                })
                              }
                              className={`min-h-[28px] px-2.5 rounded-md text-[11px] font-mono font-semibold transition-colors whitespace-nowrap ${
                                active
                                  ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/40'
                                  : 'text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              ±{pct}%
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {(
                    [
                      { key: 'notifySignals', title: 'Торговые сигналы (LONG / SHORT)', tone: 'emerald' },
                      { key: 'notifyMarketMoves', title: 'Импульсы ±4.5% и Funding Rate', tone: 'emerald' },
                      { key: 'notifyNews', title: 'Важные новости (HIGH)', tone: 'emerald' },
                      { key: 'notifyAuthLogins', title: 'Входы в аккаунт и 2FA', tone: 'amber' },
                      { key: 'notifyStrategyChanges', title: 'Смена настроек стратегий', tone: 'amber' },
                      { key: 'notifySignalLimits', title: 'Достижение лимитов сигналов', tone: 'amber' },
                    ] as const
                  ).map((item) => {
                    const checked = pushState.preferences[item.key];
                    return (
                      <button
                        key={item.key}
                        type="button"
                        disabled={!pushState.isSupported || pushState.loading}
                        onClick={() =>
                          void pushState.updatePreferences({
                            ...pushState.preferences,
                            [item.key]: !checked,
                          })
                        }
                        aria-pressed={checked}
                        className={`min-h-[44px] px-3.5 py-2 rounded-xl border text-left flex items-center justify-between gap-2 transition-colors ${
                          checked
                            ? item.tone === 'amber'
                              ? 'border-amber-500/35 bg-amber-500/8'
                              : 'border-emerald-500/35 bg-emerald-500/8'
                            : 'border-white/8 bg-[#0B0F17]'
                        }`}
                      >
                        <span className="text-xs font-medium text-white">{item.title}</span>
                        <span
                          className={`text-xs font-semibold shrink-0 ${
                            checked
                              ? item.tone === 'amber'
                                ? 'text-amber-300'
                                : 'text-emerald-400'
                              : 'text-slate-500'
                          }`}
                        >
                          {checked ? 'Вкл' : 'Выкл'}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center gap-2.5 pt-1">
                  {!pushState.isSubscribed ? (
                    <button
                      type="button"
                      disabled={!pushState.isSupported || pushState.loading}
                      onClick={() => void pushState.subscribe()}
                      className="flex-1 min-h-[42px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-semibold text-white inline-flex items-center justify-center gap-2 transition-colors"
                    >
                      <Bell className="w-4 h-4" />
                      <span>{pushState.loading ? 'Подключение...' : 'Включить Push-уведомления'}</span>
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={pushState.loading}
                        onClick={() => void pushState.sendTestPush()}
                        className="flex-1 min-h-[40px] px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-semibold text-white inline-flex items-center justify-center gap-1.5 transition-colors"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>Тест Push</span>
                      </button>
                      <button
                        type="button"
                        disabled={pushState.loading}
                        onClick={() => void pushState.scanMarketNow()}
                        className="flex-1 min-h-[40px] px-3.5 rounded-xl border border-amber-500/35 bg-amber-500/10 hover:bg-amber-500/20 disabled:opacity-50 text-xs font-semibold text-amber-300 inline-flex items-center justify-center gap-1.5 transition-colors"
                      >
                        <Activity className="w-3.5 h-3.5" />
                        <span>Проверить рынок</span>
                      </button>
                      <button
                        type="button"
                        disabled={pushState.loading}
                        onClick={() => void pushState.unsubscribe()}
                        className="min-h-[40px] px-3.5 rounded-xl border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-xs font-medium text-rose-300 transition-colors"
                      >
                        Отключить
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
        )}

        {section === 'alerts' && (
          <div className="space-y-3">
            {(!isSignedIn || !profile) && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-emerald-100">
                <span>
                  <strong>Локальное хранение</strong> • Ценовые алерты работают в демо-режиме прямо в браузере. Войдите для облачной синхронизации и Push.
                </span>
                <button
                  type="button"
                  onClick={onRequireLogin}
                  className="font-semibold text-emerald-300 hover:underline whitespace-nowrap"
                >
                  Войти через Google →
                </button>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-cyan-500/25 bg-cyan-500/[0.06] px-3.5 py-2.5 text-xs">
              <span className="text-slate-200">
                <strong className="text-cyan-200">Webhook / Telegram-сигналы (MAX):</strong> автоматическая отправка JSON-уведомлений в бота при срабатывании алертов.
              </span>
              <button
                type="button"
                onClick={() => {
                  triggerHaptic(10);
                  setWebhookModalOpen(true);
                }}
                className="min-h-[34px] px-3 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/40 text-cyan-200 font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
              >
                <Webhook className="w-3.5 h-3.5 shrink-0" />
                <span>Настроить Webhook / TG</span>
              </button>
            </div>
            <PriceAlertsPanel
              alerts={priceAlerts}
              pushSubscribed={pushState.isSubscribed}
              onJumpToPushSettings={() => setSection('push')}
              onCreateAlert={onCreatePriceAlert}
              onToggleAlert={onTogglePriceAlert}
              onDeleteAlert={onDeletePriceAlert}
              onCheckNow={onCheckPriceAlertsNow}
            />
            <WebhookBuilderModal
              open={webhookModalOpen}
              onClose={() => setWebhookModalOpen(false)}
              sampleSymbol={priceAlerts[0]?.symbol ?? 'BTCUSDT'}
              samplePrice={priceAlerts[0]?.targetPrice ?? 94250}
            />
          </div>
        )}

        {section === 'sessions' && (
          !isSignedIn || !profile
            ? requireLoginCard(
                'Авторизуйтесь для просмотра сессий и карты входов',
                'Отслеживайте географию последних входов и завершайте незнакомые сессии.'
              )
            : (
              <div className="space-y-3">
                <div className="inline-flex items-center p-1 rounded-xl bg-[#111827] border border-white/8">
                  <button
                    type="button"
                    onClick={() => setSessionsSub('map')}
                    className={`min-h-[34px] px-3.5 rounded-lg text-xs font-medium transition-colors ${
                      sessionsSub === 'map' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Карта мира входов
                  </button>
                  <button
                    type="button"
                    onClick={() => setSessionsSub('list')}
                    className={`min-h-[34px] px-3.5 rounded-lg text-xs font-medium transition-colors ${
                      sessionsSub === 'list' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Список устройств ({sessions.length})
                  </button>
                </div>

                {sessionsSub === 'map' ? (
                  <React.Suspense
                    fallback={
                      <div className="h-72 rounded-2xl border border-white/8 bg-[#111827] shimmer-skeleton" />
                    }
                  >
                    <LazySessionGeoMapPanel
                      sessions={sessions}
                      currentSessionId={currentSessionId}
                      onRevokeSession={onRevokeSession}
                      onToggleSuspicious={onToggleSessionSuspicious}
                    />
                  </React.Suspense>
                ) : (
                  <ActiveSessionsPanel
                    sessions={sessions}
                    currentSessionId={currentSessionId}
                    onRevokeOtherSessions={onRevokeOtherSessions}
                  />
                )}
              </div>
            )
        )}

        {section === 'legal' && (
          <div className="space-y-4">
            {/* Legal Documents & UA Law / GDPR Consent Status */}
            <div className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-5 space-y-4">
              <div>
                <h2 className="text-base font-semibold text-white flex items-center gap-2">
                  <Scale className="w-4 h-4 text-emerald-400" />
                  <span>Центр управления данными и комплаенс (Украина / GDPR / Google Play)</span>
                </h2>
                <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                  Обработка персональных данных соответствует Закону Украины «Про захист персональних даних» № 2297-VI, регламенту GDPR и политике Google Play Data Safety.
                </p>
              </div>

              <div className="rounded-xl border border-white/8 bg-[#0B0F17] p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div>
                  <div className="font-semibold text-white">Статус юридических согласий (18+, ПДн, AI, Non-Custodial)</div>
                  <div className="mt-0.5 text-slate-400">
                    {legalConsent
                      ? `Подтверждено ${new Date(legalConsent.acceptedAt).toLocaleString('ru-RU')} · Версия ${legalConsent.version}`
                      : 'Согласие не зафиксировано'}
                  </div>
                </div>
                {legalConsent && onRevokeConsent && (
                  <button
                    type="button"
                    onClick={onRevokeConsent}
                    className="min-h-[34px] px-3 rounded-lg border border-amber-500/35 bg-amber-500/10 hover:bg-amber-500/20 text-amber-200 font-semibold transition-colors"
                  >
                    Отозвать согласие
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {(
                  [
                    { id: 'privacy' as const, label: 'Политика конфиденциальности' },
                    { id: 'terms' as const, label: 'Условия использования' },
                    { id: 'disclaimer' as const, label: 'Отказ от ответственности' },
                  ] as const
                ).map((doc) => (
                  <button
                    key={doc.id}
                    type="button"
                    onClick={() => onOpenLegalDoc?.(doc.id)}
                    className="min-h-[42px] px-3 rounded-xl border border-white/10 bg-[#0B0F17] hover:border-emerald-500/40 text-xs font-medium text-slate-200 hover:text-white inline-flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <FileText className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>{doc.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Export JSON & 2-Step Account Deletion (Google Play Account Deletion Policy) */}
            <div className="rounded-2xl border border-white/8 bg-[#111827] p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-white">Портируемость и удаление данных</h3>
                  <p className="mt-0.5 text-xs text-slate-400">
                    Скачайте полный архив своих данных в JSON или полностью удалите аккаунт и локальные ключи.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const json = exportAllUserDataJson({
                      uid: profile?.uid,
                      email: privateSecurity?.email,
                      plan: profile?.plan,
                    });
                    const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `vernier-user-data-${new Date().toISOString().slice(0, 10)}.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                    setDataExportMsg('Архив данных успешно сформирован и скачан (JSON).');
                    triggerHaptic(10);
                  }}
                  className="min-h-[38px] px-3.5 rounded-xl border border-emerald-500/35 bg-emerald-500/12 hover:bg-emerald-500/20 text-emerald-200 text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Экспортировать мои данные (JSON)</span>
                </button>
              </div>

              {dataExportMsg && <div className="text-xs text-emerald-300">{dataExportMsg}</div>}

              <div className="pt-3 border-t border-white/8 space-y-3">
                {!deleteStepOpen ? (
                  <button
                    type="button"
                    onClick={() => setDeleteStepOpen(true)}
                    className="min-h-[38px] px-4 rounded-xl border border-rose-500/35 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Удалить аккаунт и все данные</span>
                  </button>
                ) : (
                  <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 space-y-3">
                    <div className="text-xs text-rose-100 leading-relaxed">
                      <strong>2-шаговое подтверждение:</strong> будут удалены локальный дневник, алерты, PIN-код, зашифрованные Read-Only ключи, кэш и выполнен выход из аккаунта. Введите слово <code className="font-mono text-white">УДАЛИТЬ</code> для подтверждения.
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={deleteConfirmWord}
                        onChange={(e) => setDeleteConfirmWord(e.target.value)}
                        placeholder="Введите УДАЛИТЬ"
                        className="min-h-[38px] px-3 rounded-xl border border-rose-500/40 bg-[#0B0F17] text-xs font-mono text-white"
                      />
                      <button
                        type="button"
                        disabled={deletingAll || deleteConfirmWord.trim().toUpperCase() !== 'УДАЛИТЬ'}
                        onClick={async () => {
                          setDeletingAll(true);
                          try {
                            await onDeleteAccountAndAllData?.();
                            setDeleteStepOpen(false);
                            setDeleteConfirmWord('');
                          } finally {
                            setDeletingAll(false);
                          }
                        }}
                        className="min-h-[38px] px-4 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-45 text-white text-xs font-semibold"
                      >
                        {deletingAll ? 'Удаление...' : 'Подтвердить удаление'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteStepOpen(false);
                          setDeleteConfirmWord('');
                        }}
                        className="min-h-[38px] px-3 rounded-xl border border-white/10 text-xs text-slate-300"
                      >
                        Отмена
                      </button>
                    </div>
                  </div>
                )}

                <div className="text-[11px] text-slate-500 leading-relaxed">
                  Запрос на удаление данных также можно направить через веб-портал{' '}
                  <span className="font-mono text-slate-400">vernier-terminal.app/data-deletion</span> или на email{' '}
                  <span className="font-mono text-slate-400">privacy@vernier-terminal.app</span> (срок обработки — до 14 календарных дней).
                </div>
              </div>
            </div>

            {/* Exchange Trademarks & Public API Attribution */}
            <div className="rounded-2xl border border-white/8 bg-[#0B0F17] p-4 space-y-1.5 text-[11px] text-slate-400 leading-relaxed">
              <div className="font-semibold text-slate-200">Товарные знаки и источники рыночных данных</div>
              <p>
                Рыночные котировки, свечи и ставки финансирования предоставлены публичными API криптобирж и агрегаторов (Binance, Bybit, OKX, CoinGecko, TradingView).
              </p>
              <p>
                VERNIER является независимым аналитическим Non-Custodial программным обеспечением, не хранит средства пользователей, не выступает финансовым посредником и не аффилирован с указанными торговыми площадками. Все торговые решения принимаются пользователем самостоятельно.
              </p>
            </div>
          </div>
        )}

        {section === 'audit' && (
          <div className="space-y-3">
            <div className="inline-flex items-center p-1 rounded-xl bg-[#111827] border border-white/8">
              <button
                type="button"
                onClick={() => setAuditSub('chart')}
                className={`min-h-[34px] px-3 rounded-lg text-xs font-medium transition-colors ${
                  auditSub === 'chart' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Активность
              </button>
              <button
                type="button"
                onClick={() => setAuditSub('log')}
                className={`min-h-[34px] px-3 rounded-lg text-xs font-medium transition-colors ${
                  auditSub === 'log' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Логи ({auditLogs.length + exchangeSyncErrorLogs.length})
              </button>
              <button
                type="button"
                onClick={() => setAuditSub('faq')}
                className={`min-h-[34px] px-3 rounded-lg text-xs font-medium transition-colors ${
                  auditSub === 'faq' ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Частые вопросы и тур
              </button>
            </div>

            {auditSub === 'faq' ? (
              <React.Suspense
                fallback={
                  <div className="rounded-2xl border border-white/8 bg-[#111827] p-5 space-y-3 min-h-[320px]">
                    <div className="h-5 w-48 rounded-lg bg-white/8 shimmer-skeleton" />
                    <div className="h-14 w-full rounded-xl bg-white/6 shimmer-skeleton" />
                    <div className="h-14 w-full rounded-xl bg-white/6 shimmer-skeleton" />
                    <div className="h-14 w-full rounded-xl bg-white/6 shimmer-skeleton" />
                  </div>
                }
              >
                <LazySecurityFaqSection onStartTour={onStartTour} />
              </React.Suspense>
            ) : !isSignedIn || !profile ? (
              requireLoginCard(
                'Авторизуйтесь для доступа к логам и журналу аудита',
                'Все входы, проверки 2FA, сбои синхронизации бирж и изменения параметров фиксируются автоматически.'
              )
            ) : auditSub === 'chart' ? (
              <div className="space-y-4">
                <SecurityAuditActivityChart auditLogs={auditLogs} />
                <SyncErrorIntensityChart logs={exchangeSyncErrorLogs} />
              </div>
            ) : (
              <div className="space-y-4">
                {/* Визуализация и журнал синхронизации бирж */}
                <div className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-5 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold text-white flex items-center gap-2">
                        {syncLogStats.critical > 0 ? (
                          <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                        ) : syncLogStats.warning > 0 ? (
                          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
                        ) : syncLogStats.success > 0 ? (
                          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                        ) : (
                          <Activity className="w-4 h-4 shrink-0 text-slate-400" />
                        )}
                        <span>Логи синхронизации бирж ({syncLogStats.total})</span>
                      </h2>
                      <p className="mt-0.5 text-xs text-slate-400">
                        Цветовая индикация событий: успешные обновления (мягкий зелёный), предупреждения API/сети (мягкий оранжевый) и критические сбои (мягкий красный).
                      </p>
                    </div>

                    {syncLogStats.total > 0 && onClearExchangeSyncErrorLogs && (
                      <button
                        type="button"
                        onClick={onClearExchangeSyncErrorLogs}
                        className="min-h-[32px] px-2.5 rounded-lg border border-rose-500/25 bg-rose-500/10 hover:bg-rose-500/20 text-xs font-medium text-rose-300 inline-flex items-center gap-1.5 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Очистить</span>
                      </button>
                    )}
                  </div>

                  {/* Настройка авто-очистки логов ошибок старше 30 дней для экономии localStorage */}
                  {onToggleSyncLogAutoCleanup30d && (
                    <div className="rounded-xl border border-white/8 bg-[#0B0F17]/75 px-3.5 py-2.5 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-white">
                          <Clock className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <span>Авто-очистка логов старше {SYNC_LOG_AUTO_CLEANUP_DAYS} дней</span>
                          <span className="font-mono text-[10px] text-slate-400 tabular-nums">
                            ·{' '}
                            {syncLogStats.storageBytes > 0
                              ? `${(syncLogStats.storageBytes / 1024).toFixed(1)} КБ`
                              : '0 КБ'}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-slate-400 leading-snug">
                          {syncLogAutoCleanup30d
                            ? 'Включено: устаревшие записи автоматически удаляются при загрузке и записи для экономии локального хранилища.'
                            : syncLogStats.expiredOlderThan30d > 0
                              ? `Отключено · найдено записей старше ${SYNC_LOG_AUTO_CLEANUP_DAYS} дн.: ${syncLogStats.expiredOlderThan30d}.`
                              : 'Отключено: старые записи хранятся в localStorage до ручной очистки или лимита в 60 событий.'}
                        </p>
                      </div>

                      <button
                        type="button"
                        role="switch"
                        aria-checked={syncLogAutoCleanup30d}
                        aria-label={`Авто-очистка логов ошибок старше ${SYNC_LOG_AUTO_CLEANUP_DAYS} дней`}
                        onClick={() => {
                          triggerHaptic(8);
                          const next = !syncLogAutoCleanup30d;
                          const { removedCount } = onToggleSyncLogAutoCleanup30d(next);
                          if (next) {
                            setQuickFixNotice({
                              tone: 'ok',
                              text:
                                removedCount > 0
                                  ? `Авто-очистка (30 дн.) включена — удалено устаревших записей: ${removedCount}.`
                                  : `Авто-очистка логов старше ${SYNC_LOG_AUTO_CLEANUP_DAYS} дней включена.`,
                            });
                          } else {
                            setQuickFixNotice({
                              tone: 'ok',
                              text: `Авто-очистка логов старше ${SYNC_LOG_AUTO_CLEANUP_DAYS} дней отключена.`,
                            });
                          }
                        }}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors ${
                          syncLogAutoCleanup30d
                            ? 'border-emerald-400/50 bg-emerald-500/35'
                            : 'border-white/15 bg-white/10'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full shadow transition-transform ${
                            syncLogAutoCleanup30d
                              ? 'translate-x-5.5 bg-emerald-300'
                              : 'translate-x-1 bg-slate-400'
                          }`}
                        />
                      </button>
                    </div>
                  )}

                  {/* Сводка 3 уровней + шкала распределения + лента последних событий */}
                  {syncLogStats.total > 0 && (
                    <div className="space-y-3 rounded-xl border border-white/8 bg-[#0B0F17]/80 p-3.5">
                      <div className="grid grid-cols-3 gap-2">
                        <div className="rounded-lg border border-emerald-500/35 bg-emerald-500/[0.11] px-3 py-2">
                          <div className="flex items-center gap-1.5 text-[11px] text-emerald-300">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                            <span>Успешно</span>
                          </div>
                          <div className="mt-0.5 font-mono tabular-nums text-base font-bold text-white">
                            {syncLogStats.success}
                          </div>
                        </div>

                        <div className="rounded-lg border border-orange-500/35 bg-orange-500/[0.12] px-3 py-2">
                          <div className="flex items-center gap-1.5 text-[11px] text-orange-300">
                            <span className="w-2 h-2 rounded-full bg-orange-400 shrink-0" />
                            <span>Предупреждения</span>
                          </div>
                          <div className="mt-0.5 font-mono tabular-nums text-base font-bold text-white">
                            {syncLogStats.warning}
                          </div>
                        </div>

                        <div className="rounded-lg border border-rose-500/40 bg-rose-500/[0.13] px-3 py-2">
                          <div className="flex items-center gap-1.5 text-[11px] text-rose-300">
                            <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
                            <span>Критические</span>
                          </div>
                          <div className="mt-0.5 font-mono tabular-nums text-base font-bold text-white">
                            {syncLogStats.critical}
                          </div>
                        </div>
                      </div>

                      {/* Пропорциональная полоса статуса */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-400">
                          <span>Соотношение событий синхронизации</span>
                          <span className="text-emerald-400">
                            Успешность: {syncLogStats.successPct.toFixed(0)}%
                          </span>
                        </div>
                        <div
                          className="h-2 w-full rounded-full bg-white/5 overflow-hidden flex"
                          role="img"
                          aria-label={`Успешно ${syncLogStats.success}, предупреждений ${syncLogStats.warning}, критических ${syncLogStats.critical}`}
                        >
                          {syncLogStats.successPct > 0 && (
                            <div
                              style={{ width: `${syncLogStats.successPct}%` }}
                              className="h-full bg-emerald-500 transition-all"
                              title={`Успешно: ${syncLogStats.success}`}
                            />
                          )}
                          {syncLogStats.warningPct > 0 && (
                            <div
                              style={{ width: `${syncLogStats.warningPct}%` }}
                              className="h-full bg-orange-400 transition-all"
                              title={`Предупреждения: ${syncLogStats.warning}`}
                            />
                          )}
                          {syncLogStats.criticalPct > 0 && (
                            <div
                              style={{ width: `${syncLogStats.criticalPct}%` }}
                              className="h-full bg-rose-500 transition-all"
                              title={`Критические: ${syncLogStats.critical}`}
                            />
                          )}
                        </div>
                      </div>

                      {/* Хронологическая лента последних событий */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] text-slate-400">
                          <span>Хронология последних проверок ({syncLogStats.timeline.length})</span>
                          <span className="font-mono text-[10px] text-slate-500">Старые → Новые</span>
                        </div>
                        <div className="flex items-center gap-1">
                          {syncLogStats.timeline.map((item) => {
                            const barClass =
                              item.severity === 'success'
                                ? 'bg-emerald-500/85 hover:bg-emerald-400'
                                : item.severity === 'warning'
                                  ? 'bg-orange-400/90 hover:bg-orange-300'
                                  : 'bg-rose-500/90 hover:bg-rose-400';
                            const timeStr = new Date(item.occurredAtMs).toLocaleTimeString('ru-RU', {
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            });
                            return (
                              <div
                                key={`tl-${item.id}`}
                                title={`${timeStr} · ${item.exchange.toUpperCase()} (${item.label}) — ${item.errorMessage}`}
                                className={`h-5 flex-1 max-w-[20px] min-w-[6px] rounded-[3px] transition-colors ${barClass}`}
                              />
                            );
                          })}
                        </div>
                      </div>

                      {/* Линейный график интенсивности ошибок (ошибки/час) и периоды аномальной активности */}
                      <SyncErrorIntensityChart
                        logs={exchangeSyncErrorLogs}
                        exchangeFilter={syncExchangeFilter}
                        compact
                      />

                      {/* Краткая статистика ошибок: Топ-3 биржи по частоте сбоев */}
                      <div className="space-y-2 pt-2 border-t border-white/8">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                          <div className="flex items-center gap-1.5 text-slate-300 font-medium">
                            <AlertTriangle
                              className={`w-3.5 h-3.5 shrink-0 ${
                                syncLogStats.issues > 0 ? 'text-amber-400' : 'text-emerald-400'
                              }`}
                            />
                            <span>Топ-3 биржи по частоте ошибок</span>
                          </div>
                          {syncLogStats.topErrorCategoryLabel ? (
                            <span className="font-mono text-[10px] text-slate-400">
                              Частая причина:{' '}
                              <span className="text-amber-300 font-semibold">
                                {syncLogStats.topErrorCategoryLabel}
                              </span>
                            </span>
                          ) : (
                            <span className="font-mono text-[10px] text-emerald-400">
                              0 сбоев · все биржи стабильны
                            </span>
                          )}
                        </div>

                        {syncLogStats.topErrorExchanges.length > 0 ? (
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            {syncLogStats.topErrorExchanges.map((item, idx) => {
                              const isSelected = syncExchangeFilter === item.exchange;
                              const isCriticalDominant = item.criticalCount >= item.warningCount && item.criticalCount > 0;
                              return (
                                <button
                                  key={`top-err-${item.exchange}`}
                                  type="button"
                                  onClick={() =>
                                    setSyncExchangeFilter((prev) =>
                                      prev === item.exchange ? 'all' : item.exchange
                                    )
                                  }
                                  className={`text-left rounded-lg border px-3 py-2 transition-colors space-y-1.5 ${
                                    isSelected
                                      ? 'border-cyan-400/60 bg-cyan-500/12 ring-1 ring-cyan-400/30'
                                      : isCriticalDominant
                                        ? 'border-rose-500/30 bg-rose-500/[0.08] hover:border-rose-400/45'
                                        : 'border-orange-500/30 bg-orange-500/[0.08] hover:border-orange-400/45'
                                  }`}
                                  title="Нажмите, чтобы отфильтровать журнал по этой бирже"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      <span className="font-mono text-[10px] font-bold text-slate-400">
                                        #{idx + 1}
                                      </span>
                                      <span className="text-xs font-semibold text-white truncate">
                                        {item.exchange.toUpperCase()}
                                      </span>
                                    </div>
                                    <span
                                      className={`font-mono text-xs font-bold tabular-nums shrink-0 ${
                                        isCriticalDominant ? 'text-rose-300' : 'text-orange-300'
                                      }`}
                                    >
                                      {item.errorCount}{' '}
                                      <span className="text-[10px] font-normal text-slate-400">
                                        ({item.shareOfErrorsPct.toFixed(0)}%)
                                      </span>
                                    </span>
                                  </div>

                                  <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                                    <div
                                      style={{ width: `${Math.max(8, Math.min(100, item.shareOfErrorsPct))}%` }}
                                      className={`h-full rounded-full transition-all ${
                                        isCriticalDominant ? 'bg-rose-500' : 'bg-orange-400'
                                      }`}
                                    />
                                  </div>

                                  <div className="flex items-center justify-between gap-2 text-[10px] font-mono tabular-nums text-slate-400">
                                    <span className="truncate text-slate-300">{item.topCategoryLabel}</span>
                                    <span className="shrink-0">
                                      {item.criticalCount > 0 && (
                                        <span className="text-rose-300">{item.criticalCount} крит.</span>
                                      )}
                                      {item.criticalCount > 0 && item.warningCount > 0 && ' · '}
                                      {item.warningCount > 0 && (
                                        <span className="text-orange-300">{item.warningCount} пред.</span>
                                      )}
                                    </span>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.07] px-3 py-2 text-[11px] text-emerald-200 flex items-center gap-2">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            <span>Ошибок синхронизации не зафиксировано — все подключённые биржи отвечают стабильно.</span>
                          </div>
                        )}
                      </div>

                      {/* Фильтр по уровню события */}
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/8">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {(
                            [
                              { id: 'all', label: `Все (${syncLogStats.total})`, activeClass: 'bg-white/15 text-white border-white/25' },
                              { id: 'success', label: `Успешные (${syncLogStats.success})`, activeClass: 'bg-emerald-500/20 text-emerald-200 border-emerald-500/40' },
                              { id: 'warning', label: `Предупреждения (${syncLogStats.warning})`, activeClass: 'bg-orange-500/22 text-orange-200 border-orange-500/45' },
                              { id: 'critical', label: `Критические (${syncLogStats.critical})`, activeClass: 'bg-rose-500/22 text-rose-200 border-rose-500/45' },
                            ] as const
                          ).map((f) => {
                            const active = syncLogFilter === f.id;
                            return (
                              <button
                                key={f.id}
                                type="button"
                                onClick={() => setSyncLogFilter(f.id)}
                                className={`min-h-[28px] px-2.5 rounded-lg border text-[11px] font-medium transition-colors ${
                                  active
                                    ? f.activeClass
                                    : 'border-white/8 bg-[#111827] text-slate-400 hover:text-slate-200'
                                }`}
                              >
                                {f.label}
                              </button>
                            );
                          })}
                          {syncExchangeFilter !== 'all' && (
                            <button
                              type="button"
                              onClick={() => setSyncExchangeFilter('all')}
                              className="min-h-[28px] px-2.5 rounded-lg border border-cyan-400/45 bg-cyan-500/15 text-[11px] font-medium text-cyan-200 hover:bg-cyan-500/25 transition-colors"
                            >
                              Биржа: {syncExchangeFilter.toUpperCase()} ×
                            </button>
                          )}
                        </div>
                        {syncLogStats.groupedTotal < syncLogStats.total && (
                          <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                            Записей в списке: {syncLogStats.groupedTotal} из {syncLogStats.total}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {quickFixNotice && (
                    <div
                      className={`rounded-xl border px-3.5 py-2.5 text-xs flex items-center justify-between gap-2 ${
                        quickFixNotice.tone === 'ok'
                          ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200'
                          : 'border-rose-500/35 bg-rose-500/10 text-rose-200'
                      }`}
                    >
                      <span>{quickFixNotice.text}</span>
                      <button
                        type="button"
                        onClick={() => setQuickFixNotice(null)}
                        className="text-[11px] font-medium opacity-80 hover:opacity-100 shrink-0"
                      >
                        Скрыть
                      </button>
                    </div>
                  )}

                  {syncLogStats.total === 0 ? (
                    <p className="text-xs text-slate-400">
                      Событий синхронизации бирж пока не зафиксировано. При подключении и фоновом обновлении здесь появятся статусы синхронизации.
                    </p>
                  ) : syncLogStats.filtered.length === 0 ? (
                    <p className="text-xs text-slate-400">
                      В выбранной категории событий пока нет.
                    </p>
                  ) : (
                    <VirtualizedExchangeSyncLogList
                      groups={syncLogStats.filtered}
                      exchangeKeys={exchangeKeys}
                      nowTickMs={nowTickMs}
                      quickFixBusyId={quickFixBusyId}
                      onSetQuickFixBusyId={setQuickFixBusyId}
                      onSetQuickFixNotice={setQuickFixNotice}
                      onToggleExchange={onToggleExchange}
                      onSyncExchange={onSyncExchange}
                      onEditExchangeKey={setEditingExchangeKey}
                      onOpenExchangesSection={() => setSection('exchanges')}
                    />
                  )}
                </div>

                {/* Облачный журнал аудита безопасности Firestore (виртуализированный) */}
                <div className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-base font-semibold text-white">Журнал аудита безопасности</h2>
                    <span className="text-xs text-slate-500 font-mono tabular-nums">
                      {auditLogs.length > 0 ? `Событий: ${auditLogs.length}` : 'Все события'}
                    </span>
                  </div>

                  {auditLogs.length === 0 ? (
                    <p className="text-xs text-slate-400">События безопасности будут фиксироваться здесь автоматически.</p>
                  ) : (
                    <VirtualizedAuditLogList auditLogs={auditLogs} />
                  )}
                </div>
              </div>
            )}
          </div>
        )}
        </div>
      )}

      <EditExchangeKeyModal
        keyRecord={editingExchangeKey}
        onClose={() => setEditingExchangeKey(null)}
        onSave={onUpdateExchange}
      />
    </StaggerDeck>
  );
};
