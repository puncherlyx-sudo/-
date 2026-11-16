import React, { useMemo } from 'react';
import { ArrowUpRight, CheckCircle2, Shield, ShieldAlert, ShieldCheck } from 'lucide-react';
import { motion } from 'motion/react';
import type { PushPreferences } from '../hooks/usePushNotifications';
import type { UserPrivateSecurity, UserProfile } from '../types/domain';

interface SecurityStrengthIndicatorProps {
  isSignedIn: boolean;
  profile: UserProfile | null;
  privateSecurity: UserPrivateSecurity | null;
  pushSubscribed: boolean;
  pushPreferences: PushPreferences;
  onRequireLogin: () => void;
  onJumpToSection: (sectionId: string) => void;
}

interface SecurityCheckItem {
  id: string;
  label: string;
  detail: string;
  weight: number;
  earned: number;
  status: 'done' | 'partial' | 'missing';
  actionLabel: string;
  targetSectionId?: string;
}

export const SecurityStrengthIndicator: React.FC<SecurityStrengthIndicatorProps> = ({
  isSignedIn,
  profile,
  privateSecurity,
  pushSubscribed,
  pushPreferences,
  onRequireLogin,
  onJumpToSection,
}) => {
  const { score, completedCount, checks, tier } = useMemo(() => {
    const backupCount = privateSecurity?.backupCodeHashes?.length ?? 0;
    const is2faOn = Boolean(isSignedIn && profile?.twoFactorEnabled);
    const autoLockMins = profile?.autoLockMinutes ?? 15;
    const criticalPushCount = [
      pushPreferences.notifyAuthLogins,
      pushPreferences.notifyStrategyChanges,
      pushPreferences.notifySignalLimits,
    ].filter(Boolean).length;

    let pushEarned = 0;
    let pushStatus: 'done' | 'partial' | 'missing' = 'missing';
    let pushDetail = 'Включите фоновые уведомления и 3 критических оповещения';
    if (isSignedIn && pushSubscribed) {
      if (criticalPushCount === 3) {
        pushEarned = 20;
        pushStatus = 'done';
        pushDetail = 'Включены все 3 канала: вход, стратегии и лимиты сигналов';
      } else if (criticalPushCount > 0) {
        pushEarned = 12;
        pushStatus = 'partial';
        pushDetail = `Активно ${criticalPushCount} из 3 критических каналов безопасности`;
      } else {
        pushEarned = 6;
        pushStatus = 'partial';
        pushDetail = 'Push включен, но критические оповещения безопасности отключены';
      }
    }

    const items: SecurityCheckItem[] = [
      {
        id: 'auth',
        label: 'Авторизация Google OAuth',
        detail: isSignedIn
          ? 'Аккаунт подтверждён · Non-Custodial режим без ключей вывода'
          : 'Войдите через Google, чтобы включить облачный сейф и защиту',
        weight: 20,
        earned: isSignedIn ? 20 : 0,
        status: isSignedIn ? 'done' : 'missing',
        actionLabel: isSignedIn ? 'Активно' : 'Войти',
      },
      {
        id: 'totp',
        label: 'Двухфакторная защита (TOTP 2FA)',
        detail: is2faOn
          ? 'Одноразовые 6-значные коды защищают стратегии и тариф'
          : 'Подключите Google Authenticator или Authy по QR-коду',
        weight: 30,
        earned: is2faOn ? 30 : 0,
        status: is2faOn ? 'done' : 'missing',
        actionLabel: is2faOn ? 'Активно' : 'Настроить 2FA',
        targetSectionId: 'sec-2fa-panel',
      },
      {
        id: 'backup',
        label: 'Резервные коды восстановления',
        detail:
          is2faOn && backupCount > 0
            ? `Доступно ${backupCount} из 8 одноразовых SHA-256 кодов`
            : is2faOn
              ? 'Резервные коды израсходованы — перевыпустите 2FA'
              : 'Выдаются автоматически при подключении 2FA',
        weight: 15,
        earned: is2faOn && backupCount > 0 ? 15 : 0,
        status: is2faOn && backupCount > 0 ? 'done' : 'missing',
        actionLabel: is2faOn && backupCount > 0 ? `${backupCount} / 8` : 'Получить коды',
        targetSectionId: 'sec-2fa-panel',
      },
      {
        id: 'autolock',
        label: 'Таймер автоблокировки (≤ 15 мин)',
        detail: !is2faOn
          ? 'Работает после включения 2FA для защиты при простое'
          : autoLockMins <= 15
            ? `Установлен строгий интервал: ${autoLockMins} мин`
            : `Текущий интервал ${autoLockMins} мин · Рекомендуется 5 или 15 мин`,
        weight: 15,
        earned: is2faOn ? (autoLockMins <= 15 ? 15 : 7) : 0,
        status: is2faOn ? (autoLockMins <= 15 ? 'done' : 'partial') : 'missing',
        actionLabel: is2faOn && autoLockMins <= 15 ? `${autoLockMins} мин` : 'Уменьшить',
        targetSectionId: 'sec-autolock-panel',
      },
      {
        id: 'push',
        label: 'Критические Push-оповещения',
        detail: pushDetail,
        weight: 20,
        earned: pushEarned,
        status: pushStatus,
        actionLabel: pushStatus === 'done' ? '3 / 3 вкл' : 'Настроить Push',
        targetSectionId: 'sec-push-panel',
      },
    ];

    const totalScore = items.reduce((acc, item) => acc + item.earned, 0);
    const doneCount = items.filter((item) => item.status === 'done').length;

    let computedTier: {
      title: string;
      summary: string;
      textClass: string;
      barClass: string;
      icon: React.ReactNode;
    };

    if (totalScore >= 90) {
      computedTier = {
        title: 'Максимальная защита',
        summary: 'Все криптографические барьеры, резервные ключи и push-мониторинг включены.',
        textClass: 'text-emerald-400',
        barClass: 'bg-emerald-500',
        icon: <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />,
      };
    } else if (totalScore >= 65) {
      computedTier = {
        title: 'Высокий уровень',
        summary: 'Ключевая защита активна. Выполните оставшиеся пункты для 100% контроля.',
        textClass: 'text-emerald-400',
        barClass: 'bg-emerald-500',
        icon: <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />,
      };
    } else if (totalScore >= 35) {
      computedTier = {
        title: 'Средний уровень',
        summary: 'Аккаунт уязвим без 2FA и оповещений безопасности — усильте защиту ниже.',
        textClass: 'text-amber-300',
        barClass: 'bg-amber-400',
        icon: <Shield className="w-5 h-5 text-amber-300 shrink-0" />,
      };
    } else {
      computedTier = {
        title: 'Базовый уровень',
        summary: 'Войдите в аккаунт и подключите двухфакторную защиту TOTP 2FA.',
        textClass: 'text-rose-400',
        barClass: 'bg-rose-500',
        icon: <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0" />,
      };
    }

    return {
      score: totalScore,
      completedCount: doneCount,
      checks: items,
      tier: computedTier,
    };
  }, [isSignedIn, profile, privateSecurity, pushSubscribed, pushPreferences]);

  const handleCriterionClick = (item: SecurityCheckItem) => {
    if (!isSignedIn) {
      onRequireLogin();
      return;
    }
    if (item.targetSectionId) {
      onJumpToSection(item.targetSectionId);
    }
  };

  return (
    <section
      data-tour-id="tour-security-meter"
      aria-labelledby="profile-security-meter-heading"
      className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-6 space-y-5"
    >
      {/* Top Score Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="text-xs text-slate-400 tabular-nums">
            Индекс защиты профиля · Выполнено {completedCount} из {checks.length} уровней
          </div>
          <div className="flex items-center gap-2.5">
            {tier.icon}
            <h2
              id="profile-security-meter-heading"
              className="text-lg font-semibold text-white"
            >
              Уровень безопасности: <span className={tier.textClass}>{tier.title}</span>
            </h2>
          </div>
          <p className="text-xs text-slate-400 max-w-2xl">{tier.summary}</p>
        </div>

        <div className="flex items-baseline gap-2 shrink-0 self-start lg:self-auto">
          <span className={`text-3xl font-bold font-mono tabular-nums ${tier.textClass}`}>
            {score}%
          </span>
          <span className="text-xs text-slate-500 font-mono tabular-nums">/ 100%</span>
        </div>
      </div>

      {/* Segmented 5-Tier Visual Meter */}
      <div className="space-y-2">
        <div
          role="progressbar"
          aria-valuenow={score}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Уровень безопасности профиля: ${score}%`}
          className="grid grid-cols-5 gap-1.5 h-2.5"
        >
          {checks.map((item) => {
            const pctInsideSegment = Math.round((item.earned / item.weight) * 100);
            const segmentColor =
              item.status === 'done'
                ? tier.barClass
                : item.status === 'partial'
                  ? 'bg-amber-400'
                  : 'bg-transparent';
            return (
              <div
                key={item.id}
                title={`${item.label}: ${item.earned}/${item.weight}%`}
                className="h-full rounded-sm bg-[#0B0F17] border border-white/8 overflow-hidden"
              >
                <motion.div
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: pctInsideSegment / 100 }}
                  transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                  className={`h-full w-full origin-left ${segmentColor}`}
                />
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-between text-[11px] text-slate-500 tabular-nums">
          <span>Базовый (0–34%)</span>
          <span className="hidden sm:inline">Средний (35–64%)</span>
          <span className="hidden sm:inline">Высокий (65–89%)</span>
          <span>Максимальный (90–100%)</span>
        </div>
      </div>

      {/* Actionable Checklist (hairline rows, zero nested cards) */}
      <div className="divide-y divide-white/8 border-t border-white/8">
        {checks.map((item) => {
          const isInteractive = !isSignedIn || (item.status !== 'done' && Boolean(item.targetSectionId));
          const statusColor =
            item.status === 'done'
              ? 'text-emerald-400'
              : item.status === 'partial'
                ? 'text-amber-300'
                : 'text-slate-400';

          const content = (
            <>
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs sm:text-sm font-medium text-white">
                  <span
                    className={`font-mono text-xs tabular-nums ${
                      item.status === 'done'
                        ? 'text-emerald-400'
                        : item.status === 'partial'
                          ? 'text-amber-300'
                          : 'text-slate-500'
                    }`}
                  >
                    +{item.weight}%
                  </span>
                  <span className="truncate">{item.label}</span>
                </div>
                <div className="mt-0.5 text-xs text-slate-400">{item.detail}</div>
              </div>

              <div className={`text-xs font-semibold whitespace-nowrap shrink-0 inline-flex items-center gap-1 ${statusColor}`}>
                <span>{item.actionLabel}</span>
                {isInteractive && <ArrowUpRight className="w-3.5 h-3.5" />}
              </div>
            </>
          );

          if (isInteractive) {
            return (
              <motion.button
                key={item.id}
                type="button"
                whileTap={{ scale: 0.99 }}
                onClick={() => handleCriterionClick(item)}
                className="w-full min-h-[48px] py-3 px-2 -mx-2 text-left flex items-center justify-between gap-4 hover:bg-white/[0.03] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 rounded-lg"
              >
                {content}
              </motion.button>
            );
          }

          return (
            <div
              key={item.id}
              className="min-h-[48px] py-3 flex items-center justify-between gap-4"
            >
              {content}
            </div>
          );
        })}
      </div>
    </section>
  );
};
