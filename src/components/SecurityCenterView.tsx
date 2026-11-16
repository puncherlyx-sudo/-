import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Bell,
  BellOff,
  BellRing,
  CheckCircle2,
  Copy,
  FileClock,
  Globe2,
  KeyRound,
  Lock,
  Send,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { motion } from 'motion/react';
import type { PushPreferences } from '../hooks/usePushNotifications';
import type {
  MarketType,
  PriceAlertCondition,
  PriceAlertRecord,
  SecurityAuditLog,
  UserPrivateSecurity,
  UserProfile,
  UserSessionRecord,
} from '../types/domain';
import { ActiveSessionsPanel } from './ActiveSessionsPanel';
import { StaggerDeck, WorkspaceShell } from './MotionPrimitives';
import { PriceAlertsPanel } from './PriceAlertsPanel';
import { SecurityAuditActivityChart } from './SecurityAuditActivityChart';
import { SecurityFaqSection } from './SecurityFaqSection';
import { SecurityStrengthIndicator } from './SecurityStrengthIndicator';
import { SessionGeoMapPanel } from './SessionGeoMapPanel';
import { authFetch } from '../lib/authFetch';

export type SecuritySection = 'meter' | '2fa' | 'push' | 'alerts' | 'sessions' | 'audit';

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
  externalSection?: { section: SecuritySection; nonce: number } | null;
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
  onStartTour?: () => void;
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
  onStartTour,
}) => {
  const [section, setSection] = useState<SecuritySection>('meter');
  const [sessionsSub, setSessionsSub] = useState<'map' | 'list'>('map');
  const [auditSub, setAuditSub] = useState<'chart' | 'log' | 'faq'>('chart');

  const [setupQr, setSetupQr] = useState<string | null>(null);
  const [manualKey, setManualKey] = useState<string | null>(null);
  const [pendingEncrypted, setPendingEncrypted] = useState<string | null>(null);
  const [confirmCode, setConfirmCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [copiedCodes, setCopiedCodes] = useState(false);
  const [loadingSetup, setLoadingSetup] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (externalSection) {
      setSection(externalSection.section);
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

  const sectionTabs = useMemo(
    () => [
      { id: 'meter' as const, label: 'Индекс защиты', icon: <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> },
      { id: '2fa' as const, label: '2FA и блокировка', icon: <KeyRound className="w-3.5 h-3.5 text-amber-400" /> },
      { id: 'push' as const, label: 'Push-уведомления', icon: <Bell className="w-3.5 h-3.5 text-cyan-400" /> },
      {
        id: 'alerts' as const,
        label: 'Ценовые алерты',
        icon: <BellRing className="w-3.5 h-3.5 text-emerald-400" />,
        meta: priceAlerts.filter((a) => a.active).length || undefined,
      },
      {
        id: 'sessions' as const,
        label: 'Сессии и карта',
        icon: <Globe2 className="w-3.5 h-3.5 text-cyan-400" />,
        meta: sessions.length || undefined,
      },
      {
        id: 'audit' as const,
        label: 'Журнал и справка',
        icon: <FileClock className="w-3.5 h-3.5 text-slate-300" />,
      },
    ],
    [priceAlerts, sessions.length]
  );

  const sidebarBottom = (
    <div className="space-y-1.5 text-xs font-mono tabular-nums">
      <div className="flex items-center justify-between">
        <span className="font-sans text-slate-400">2FA защита</span>
        <span className={profile?.twoFactorEnabled ? 'text-emerald-400' : 'text-amber-300'}>
          {profile?.twoFactorEnabled ? 'Вкл' : 'Выкл'}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className="font-sans text-slate-400">Резерв. коды</span>
        <span className="text-white">{privateSecurity?.backupCodeHashes?.length ?? 0} / 8</span>
      </div>
    </div>
  );

  const requireLoginCard = (title: string, desc: string) => (
    <div className="rounded-2xl border border-white/8 bg-[#111827] p-8 text-center space-y-4">
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

  return (
    <StaggerDeck>
      <WorkspaceShell
        title="Безопасность"
        subtitle={profile?.twoFactorEnabled ? 'TOTP 2FA активна' : 'Non-Custodial сейф'}
        icon={
          <img
            src="/src/assets/images/terminal_icon_vault_1794855844198.jpg"
            alt="Безопасность AegisQuant"
            referrerPolicy="no-referrer"
            className="w-8 h-8 rounded-lg object-cover border border-emerald-500/25"
          />
        }
        items={sectionTabs}
        activeId={section}
        onChange={setSection}
        layoutId="security-workspace-nav"
        accent="emerald"
        sidebarBottomSlot={sidebarBottom}
      >
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
          !isSignedIn || !profile
            ? requireLoginCard(
                'Авторизуйтесь для настройки ценовых алертов',
                'Задавайте целевые уровни цены и получайте Push-оповещения при достижении цели.'
              )
            : (
              <PriceAlertsPanel
                alerts={priceAlerts}
                pushSubscribed={pushState.isSubscribed}
                onJumpToPushSettings={() => setSection('push')}
                onCreateAlert={onCreatePriceAlert}
                onToggleAlert={onTogglePriceAlert}
                onDeleteAlert={onDeletePriceAlert}
                onCheckNow={onCheckPriceAlertsNow}
              />
            )
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
                  <SessionGeoMapPanel
                    sessions={sessions}
                    currentSessionId={currentSessionId}
                    onRevokeSession={onRevokeSession}
                    onToggleSuspicious={onToggleSessionSuspicious}
                  />
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
                Журнал ({auditLogs.length})
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
              <SecurityFaqSection onStartTour={onStartTour} />
            ) : !isSignedIn || !profile ? (
              requireLoginCard(
                'Авторизуйтесь для доступа к журналу аудита',
                'Все входы, проверки 2FA и изменения параметров фиксируются автоматически.'
              )
            ) : auditSub === 'chart' ? (
              <SecurityAuditActivityChart auditLogs={auditLogs} />
            ) : (
              <div className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-base font-semibold text-white">Журнал аудита безопасности</h2>
                  <span className="text-xs text-slate-500">Последние 20 событий</span>
                </div>

                {auditLogs.length === 0 ? (
                  <p className="text-xs text-slate-400">События безопасности будут фиксироваться здесь автоматически.</p>
                ) : (
                  <div className="divide-y divide-white/8">
                    {auditLogs.slice(0, 20).map((log) => {
                      const ts = (log.createdAt as { seconds?: number } | undefined)?.seconds;
                      const dateLabel = ts
                        ? new Date(ts * 1000).toLocaleString('ru-RU', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : 'Сейчас';
                      return (
                        <div key={log.id} className="py-2.5 flex items-start justify-between gap-4 text-xs">
                          <div>
                            <div className="font-medium text-white">{log.description}</div>
                            <div className="mt-0.5 text-slate-400 font-mono">
                              {log.eventType} · {log.deviceLabel}
                            </div>
                          </div>
                          <div className="text-right shrink-0 font-mono tabular-nums">
                            <div
                              className={
                                log.status === 'SUCCESS'
                                  ? 'text-emerald-400'
                                  : log.status === 'BLOCKED'
                                    ? 'text-rose-400'
                                    : 'text-amber-300'
                              }
                            >
                              {log.status}
                            </div>
                            <div className="mt-0.5 text-slate-500">{dateLabel}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </WorkspaceShell>
    </StaggerDeck>
  );
};
