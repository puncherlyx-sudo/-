import React, { useMemo, useState } from 'react';
import { CheckCircle2, LogOut, Monitor, Smartphone } from 'lucide-react';
import { motion } from 'motion/react';
import type { SessionDeviceType, UserSessionRecord } from '../types/domain';

interface ActiveSessionsPanelProps {
  sessions: UserSessionRecord[];
  currentSessionId: string;
  onRevokeOtherSessions: () => Promise<number>;
}

function formatSessionTimestamp(ts: unknown): string {
  const sec = (ts as { seconds?: number } | undefined)?.seconds;
  if (!sec) return 'Только что';
  return new Date(sec * 1000).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getDeviceTypeLabel(type: SessionDeviceType): string {
  if (type === 'pwa') return 'Android / PWA';
  if (type === 'mobile') return 'Мобильный браузер';
  return 'Десктоп-браузер';
}

export const ActiveSessionsPanel: React.FC<ActiveSessionsPanelProps> = ({
  sessions,
  currentSessionId,
  onRevokeOtherSessions,
}) => {
  const [revoking, setRevoking] = useState(false);
  const [showRevoked, setShowRevoked] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { activeSessions, revokedSessions, otherActiveCount } = useMemo(() => {
    const active = sessions.filter((s) => s.status === 'active');
    const revoked = sessions.filter((s) => s.status === 'revoked');
    const others = active.filter((s) => s.id !== currentSessionId).length;
    return {
      activeSessions: active,
      revokedSessions: revoked,
      otherActiveCount: others,
    };
  }, [sessions, currentSessionId]);

  const handleRevokeOthers = async () => {
    if (otherActiveCount === 0 || revoking) return;
    setRevoking(true);
    setFeedback(null);
    setError(null);
    try {
      const revokedCount = await onRevokeOtherSessions();
      setFeedback(
        revokedCount > 0
          ? `Завершено других сессий: ${revokedCount}. Удалённые устройства будут автоматически разлогинены.`
          : 'Других активных сессий не обнаружено.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось завершить остальные сессии.');
    } finally {
      setRevoking(false);
    }
  };

  const visibleSessions = showRevoked ? sessions : activeSessions;

  return (
    <section
      id="sec-sessions-panel"
      aria-labelledby="active-sessions-heading"
      className="rounded-2xl border border-white/8 bg-[#111827] card-surface-glow p-6 space-y-4"
    >
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h2 id="active-sessions-heading" className="text-base font-semibold text-white">
            Активные сессии устройств
          </h2>
          <p className="mt-1 text-xs text-slate-400 tabular-nums">
            Активных устройств: {activeSessions.length}
            <span aria-hidden="true" className="mx-1.5 text-slate-600">
              ·
            </span>
            Завершённых: {revokedSessions.length}
          </p>
        </div>

        <motion.button
          type="button"
          whileTap={{ scale: 0.96 }}
          disabled={otherActiveCount === 0 || revoking}
          onClick={() => void handleRevokeOthers()}
          className="min-h-[44px] px-4 rounded-xl border border-rose-500/35 bg-rose-500/12 hover:bg-rose-500/20 disabled:opacity-45 disabled:hover:bg-rose-500/12 text-xs font-semibold text-rose-200 inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 transition-colors"
        >
          <LogOut className="w-3.5 h-3.5 shrink-0" />
          <span>
            {revoking
              ? 'Завершение...'
              : otherActiveCount > 0
                ? `Завершить все остальные сессии (${otherActiveCount})`
                : 'Завершить все остальные сессии'}
          </span>
        </motion.button>
      </div>

      {feedback && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-300">
          {error}
        </div>
      )}

      {visibleSessions.length === 0 ? (
        <p className="text-xs text-slate-400 py-2">
          Информация о текущей сессии устройства появится автоматически после синхронизации.
        </p>
      ) : (
        <div className="divide-y divide-white/8 border-t border-white/8">
          {visibleSessions.map((session) => {
            const isCurrent = session.id === currentSessionId;
            const isRevoked = session.status === 'revoked';
            const isMobileOrPwa = session.deviceType === 'mobile' || session.deviceType === 'pwa';
            return (
              <div
                key={session.id}
                className="py-3.5 flex items-start justify-between gap-4 text-xs"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className="mt-0.5 text-slate-400 shrink-0">
                    {isMobileOrPwa ? (
                      <Smartphone className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Monitor className="w-4 h-4 text-slate-300" />
                    )}
                  </div>
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="font-semibold text-white">{session.deviceLabel}</span>
                      <span aria-hidden="true" className="text-slate-600">
                        ·
                      </span>
                      <span className="text-slate-300">{session.browserLabel}</span>
                      {isCurrent && (
                        <>
                          <span aria-hidden="true" className="text-slate-600">
                            ·
                          </span>
                          <span className="font-semibold text-emerald-400">Текущее устройство</span>
                        </>
                      )}
                    </div>
                    <div className="text-slate-400 tabular-nums">
                      <span>Тип: {getDeviceTypeLabel(session.deviceType)}</span>
                      <span aria-hidden="true" className="mx-1.5 text-slate-600">
                        ·
                      </span>
                      <span>Последний вход: {formatSessionTimestamp(session.lastLoginAt)}</span>
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                      <span>Активность: {formatSessionTimestamp(session.lastActiveAt)}</span>
                      {session.ipAddress && (
                        <>
                          <span aria-hidden="true" className="mx-1.5 text-slate-600">
                            ·
                          </span>
                          <span className="text-slate-400">
                            IP {session.ipAddress}
                            {session.city ? ` (${session.city}${session.countryCode ? `, ${session.countryCode}` : ''})` : ''}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="text-right shrink-0 font-semibold">
                  {isRevoked ? (
                    <span className="text-slate-500">Завершена</span>
                  ) : (
                    <span className="text-emerald-400">Активна</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {revokedSessions.length > 0 && (
        <div className="pt-1 border-t border-white/8 flex items-center justify-between text-xs">
          <span className="text-slate-500">
            История завершённых входов: <span className="tabular-nums">{revokedSessions.length}</span>
          </span>
          <button
            type="button"
            onClick={() => setShowRevoked((prev) => !prev)}
            className="min-h-[36px] px-2.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/5 font-medium transition-colors"
          >
            {showRevoked ? 'Скрыть завершённые' : 'Показать завершённые'}
          </button>
        </div>
      )}
    </section>
  );
};
