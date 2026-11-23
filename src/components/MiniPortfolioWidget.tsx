import React, { useMemo, useState } from 'react';
import {
  ChevronRight,
  Eye,
  EyeOff,
  HelpCircle,
  Link2,
  RefreshCw,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import type { DailyPnlSummary, PaperPortfolioReport } from '../hooks/usePaperPortfolio';
import type { ExchangeSyncCacheMap } from '../lib/exchangeSyncCache';
import type { ExchangeSyncErrorLogEntry } from '../lib/exchangeSyncErrorLog';
import type { ExchangeKeyRecord, PortfolioTargetRecord } from '../types/domain';
import { getPnlIntensityStyles } from '../lib/pnlIntensity';
import { triggerHaptic } from '../lib/securityDlp';

interface MiniPortfolioWidgetProps {
  holdingsCount: number;
  report: PaperPortfolioReport;
  dailyPnl: DailyPnlSummary;
  activeTarget?: PortfolioTargetRecord | null;
  isBackgroundSyncingExchange?: boolean;
  connectedExchangesCount?: number;
  connectedExchangesLabel?: string;
  exchangeKeys?: ExchangeKeyRecord[];
  exchangeSyncCache?: ExchangeSyncCacheMap;
  exchangeSyncErrorLogs?: ExchangeSyncErrorLogEntry[];
  onOpenExchangeIntegrations?: () => void;
  onOpenKnowledgeBase?: () => void;
  privacyMode?: boolean;
  onTogglePrivacyMode?: () => void;
  onOpenDetails: () => void;
  onManageInScreener: () => void;
  onClearPortfolio?: () => void;
  onResetDemo?: () => void;
  rightActions?: React.ReactNode;
  bottomSlot?: React.ReactNode;
}

function formatUsdCompact(value: number): string {
  const abs = Math.abs(value);
  return `$${abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatSyncTimeShort(iso?: string): string {
  if (!iso) return 'не синхр.';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'не синхр.';
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export const MiniPortfolioWidget: React.FC<MiniPortfolioWidgetProps> = React.memo(({
  holdingsCount,
  report,
  dailyPnl,
  activeTarget = null,
  isBackgroundSyncingExchange = false,
  connectedExchangesCount = 0,
  connectedExchangesLabel,
  exchangeKeys = [],
  exchangeSyncCache = {},
  exchangeSyncErrorLogs = [],
  onOpenExchangeIntegrations,
  onOpenKnowledgeBase,
  privacyMode = false,
  onTogglePrivacyMode,
  onOpenDetails,
  onManageInScreener,
  rightActions,
  bottomSlot,
}) => {
  const [statusPanelOpen, setStatusPanelOpen] = useState(false);

  const isPositive = report.totalPnl >= 0;
  const isDailyPositive = dailyPnl.dailyPnlUsdt >= 0;
  const totalPnlStyle = getPnlIntensityStyles(report.totalPnlPct, {
    isNeutral: privacyMode || holdingsCount === 0,
  });
  const dailyPnlStyle = getPnlIntensityStyles(dailyPnl.dailyPnlPct, {
    isNeutral: privacyMode || !dailyPnl.hasLive24hData || holdingsCount === 0,
  });
  const mask = (text: string) => (privacyMode ? '•••••' : text);
  const hasExchangeApi = connectedExchangesCount > 0 || exchangeKeys.length > 0;

  // Real-time Exchange API connection health summary (green/yellow/red + last sync time)
  const exchangeHealth = useMemo(() => {
    if (exchangeKeys.length === 0) {
      return {
        tone: 'idle' as const,
        dotClass: 'bg-amber-400/70',
        label: 'API не подключён',
        lastSuccessText: 'нет синхронизации',
        items: [] as Array<{
          id: string;
          name: string;
          label: string;
          statusText: string;
          tone: 'synced' | 'active' | 'error';
          lastSyncText: string;
        }>,
      };
    }

    const recentErrorKeyIds = new Set(
      exchangeSyncErrorLogs
        .filter((e) => e.severity !== 'success' && Date.now() - e.occurredAtMs < 30 * 60_000)
        .map((e) => e.keyId)
    );

    const items = exchangeKeys.map((k) => {
      const cached = exchangeSyncCache[k.id];
      const hasErr = Boolean(k.lastSyncError) || recentErrorKeyIds.has(k.id);
      const lastSyncIso = cached?.syncedAt || k.lastSyncedAt;
      if (hasErr) {
        return {
          id: k.id,
          name: k.exchange.toUpperCase(),
          label: k.label,
          statusText: 'Ошибка ключа / API',
          tone: 'error' as const,
          lastSyncText: formatSyncTimeShort(lastSyncIso),
        };
      }
      if (!k.enabled) {
        return {
          id: k.id,
          name: k.exchange.toUpperCase(),
          label: k.label,
          statusText: 'На паузе',
          tone: 'active' as const,
          lastSyncText: formatSyncTimeShort(lastSyncIso),
        };
      }
      if (lastSyncIso) {
        return {
          id: k.id,
          name: k.exchange.toUpperCase(),
          label: k.label,
          statusText: 'Синхронизирован',
          tone: 'synced' as const,
          lastSyncText: formatSyncTimeShort(lastSyncIso),
        };
      }
      return {
        id: k.id,
        name: k.exchange.toUpperCase(),
        label: k.label,
        statusText: 'Активен · ждёт синхр.',
        tone: 'active' as const,
        lastSyncText: '—',
      };
    });

    const syncedTimestamps = exchangeKeys
      .map((k) => exchangeSyncCache[k.id]?.syncedAt || k.lastSyncedAt)
      .filter((iso): iso is string => Boolean(iso))
      .map((iso) => ({ iso, ms: new Date(iso).getTime() }))
      .filter((entry) => Number.isFinite(entry.ms))
      .sort((a, b) => b.ms - a.ms);
    const lastSuccessText =
      syncedTimestamps.length > 0
        ? formatSyncTimeShort(syncedTimestamps[0].iso)
        : 'ожидает синхр.';

    const hasError = items.some((i) => i.tone === 'error');
    const hasSynced = items.some((i) => i.tone === 'synced');
    if (hasError) {
      return {
        tone: 'error' as const,
        dotClass: 'bg-rose-400',
        label: 'Ошибка API',
        lastSuccessText,
        items,
      };
    }
    if (hasSynced) {
      return {
        tone: 'synced' as const,
        dotClass: 'bg-emerald-400',
        label: 'API Онлайн',
        lastSuccessText,
        items,
      };
    }
    return {
      tone: 'active' as const,
      dotClass: 'bg-amber-400',
      label: 'API Активен',
      lastSuccessText,
      items,
    };
  }, [exchangeKeys, exchangeSyncCache, exchangeSyncErrorLogs]);

  return (
    <motion.section
      data-tour-id="tour-mini-portfolio"
      aria-label="Сводка портфеля, котировки и быстрые действия"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      className={`mb-3 rounded-2xl border bg-[var(--surface-1)] overflow-visible transition-colors duration-300 ${totalPnlStyle.widgetBorderClass}`}
    >
      {/* Unified single-row balance + API status + utility bar (fits 360px–430px cleanly) */}
      <div className="px-2.5 sm:px-3.5 py-1.5 flex items-center justify-between gap-1.5 sm:gap-2 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() => {
              triggerHaptic(8);
              onOpenDetails();
            }}
            className="min-h-[36px] text-left inline-flex items-center gap-1.5 sm:gap-2 rounded-xl hover:bg-white/[0.04] px-1.5 py-0.5 transition-colors group whitespace-nowrap shrink-0"
            aria-label="Открыть сводку портфеля и стресс-тест"
          >
            <span className="inline-flex items-center gap-1.5 shrink-0">
              <Wallet className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="text-sm sm:text-base font-bold font-mono tabular-nums text-white">
                {mask(formatUsdCompact(report.totalValue))}
              </span>
            </span>

            {holdingsCount > 0 && (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-mono tabular-nums shrink-0">
                <span
                  className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-semibold transition-all duration-300 ${totalPnlStyle.badgeClass}`}
                >
                  {isPositive ? (
                    <TrendingUp className="w-3 h-3 shrink-0" />
                  ) : (
                    <TrendingDown className="w-3 h-3 shrink-0" />
                  )}
                  <span>
                    {mask(`${isPositive ? '+' : ''}${report.totalPnlPct.toFixed(1)}%`)}
                  </span>
                  <span className="font-sans text-[10px] font-medium opacity-75">Всего</span>
                </span>

                {dailyPnl.hasLive24hData && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-medium transition-all duration-300 ${dailyPnlStyle.badgeClass}`}
                  >
                    <span>
                      {mask(`${isDailyPositive ? '+' : ''}${dailyPnl.dailyPnlPct.toFixed(1)}%`)}
                    </span>
                    <span className="font-sans text-[10px] opacity-75">24ч</span>
                  </span>
                )}

                {activeTarget && (
                  <span className="inline-flex items-center gap-1 text-cyan-300">
                    <span className="text-slate-600" aria-hidden="true">·</span>
                    <Target className="w-3 h-3 shrink-0" />
                    <span>
                      Цель {activeTarget.targetPnlPct >= 0 ? '+' : ''}
                      {activeTarget.targetPnlPct}%
                    </span>
                  </span>
                )}

                {isBackgroundSyncingExchange && (
                  <RefreshCw
                    className="w-3 h-3 text-cyan-400 animate-spin shrink-0"
                    aria-label="Синхронизация с биржей"
                  />
                )}
              </span>
            )}

            <ChevronRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-emerald-300 transition-colors shrink-0" />
          </button>
        </div>

        {/* Compact Exchange Connection Status Indicator (green/yellow/red + hover tooltip with last sync time) */}
        {onOpenExchangeIntegrations && (
          <div className="relative group/api shrink-0">
            <button
              type="button"
              onClick={() => {
                triggerHaptic(8);
                if (hasExchangeApi) {
                  setStatusPanelOpen((v) => !v);
                } else {
                  onOpenExchangeIntegrations();
                }
              }}
              aria-expanded={hasExchangeApi ? statusPanelOpen : undefined}
              aria-label={
                hasExchangeApi
                  ? `Статус подключения бирж: ${exchangeHealth.label}. Последняя синхронизация: ${exchangeHealth.lastSuccessText}`
                  : 'Подключить биржу по Read-Only API'
              }
              title={
                hasExchangeApi
                  ? `${exchangeHealth.label} · Последняя синхр.: ${exchangeHealth.lastSuccessText}`
                  : 'Подключить биржу (Read-Only API)'
              }
              className={`min-h-[30px] px-2.5 rounded-lg border text-[11px] font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                exchangeHealth.tone === 'error'
                  ? 'border-rose-500/40 bg-rose-500/12 text-rose-200 hover:bg-rose-500/20'
                  : exchangeHealth.tone === 'active'
                    ? 'border-amber-500/35 bg-amber-500/12 text-amber-200 hover:bg-amber-500/20'
                    : 'border-emerald-500/35 bg-emerald-500/12 text-emerald-300 hover:bg-emerald-500/20'
              }`}
            >
              {isBackgroundSyncingExchange ? (
                <RefreshCw className="w-3 h-3 text-cyan-300 animate-spin shrink-0" />
              ) : hasExchangeApi ? (
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${exchangeHealth.dotClass}`}
                  aria-hidden="true"
                />
              ) : (
                <Link2 className="w-3 h-3 text-emerald-400 shrink-0" />
              )}
              <span>
                {hasExchangeApi
                  ? connectedExchangesLabel || `API · ${connectedExchangesCount}`
                  : '+ Биржа'}
              </span>
            </button>

            {hasExchangeApi && (
              <div
                role="tooltip"
                className="pointer-events-none opacity-0 group-hover/api:opacity-100 transition-opacity duration-150 absolute right-0 top-full mt-1.5 z-50 w-max max-w-[240px] rounded-xl border border-white/15 bg-[#090E17] px-2.5 py-2 text-[11px] text-slate-200 shadow-xl"
              >
                <div className="flex items-center gap-1.5 font-semibold text-white">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${exchangeHealth.dotClass}`} />
                  <span>{exchangeHealth.label}</span>
                </div>
                <div className="mt-0.5 text-[10px] text-slate-400 font-mono tabular-nums">
                  Посл. синхр.: <span className="text-emerald-300">{exchangeHealth.lastSuccessText}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Compact pinned-right action strip (Privacy Eye + Widgets/Tour) */}
        <div className="flex items-center gap-1 shrink-0 pl-1 border-l border-white/8">
          {onTogglePrivacyMode && (
            <button
              type="button"
              onClick={() => {
                triggerHaptic(8);
                onTogglePrivacyMode();
              }}
              aria-label={privacyMode ? 'Показать балансы и PnL' : 'Скрыть балансы и PnL (Режим приватности)'}
              title={privacyMode ? 'Показать суммы' : 'Скрыть суммы (Приватность)'}
              className={`min-h-[34px] min-w-[34px] rounded-lg border flex items-center justify-center shrink-0 transition-colors ${
                privacyMode
                  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                  : 'border-white/10 bg-white/5 text-slate-400 hover:text-white'
              }`}
            >
              {privacyMode ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          )}
          {rightActions}
        </div>
      </div>

      {/* Expandable Real-Time Exchange API Connection Status Popover Bar */}
      {statusPanelOpen && hasExchangeApi && (
        <div className="px-3 py-2.5 border-t border-white/8 bg-[#0B0F17] space-y-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="inline-flex items-center gap-2 font-semibold text-white">
              <span className={`w-2 h-2 rounded-full ${exchangeHealth.dotClass}`} aria-hidden="true" />
              <span>Статус API-подключений ({exchangeHealth.items.length})</span>
            </div>
            <div className="flex items-center gap-2">
              {onOpenExchangeIntegrations && (
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(8);
                    setStatusPanelOpen(false);
                    onOpenExchangeIntegrations();
                  }}
                  className="text-[11px] font-semibold text-emerald-300 hover:text-emerald-200 whitespace-nowrap"
                >
                  Настроить API →
                </button>
              )}
              <button
                type="button"
                onClick={() => setStatusPanelOpen(false)}
                aria-label="Скрыть статус подключений"
                className="text-slate-400 hover:text-white p-0.5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {exchangeHealth.items.map((item) => (
              <div
                key={item.id}
                className="rounded-lg border border-white/8 bg-[#111827] px-2.5 py-1.5 flex items-center justify-between gap-2"
              >
                <div className="min-w-0 flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      item.tone === 'synced'
                        ? 'bg-emerald-400'
                        : item.tone === 'error'
                          ? 'bg-rose-400'
                          : 'bg-amber-400'
                    }`}
                  />
                  <div className="min-w-0">
                    <div className="font-mono text-[11px] font-semibold text-white truncate">
                      {item.name} · <span className="font-sans font-normal text-slate-300">{item.label}</span>
                    </div>
                    <div
                      className={`text-[10px] ${
                        item.tone === 'synced'
                          ? 'text-emerald-300'
                          : item.tone === 'error'
                            ? 'text-rose-300'
                            : 'text-amber-300'
                      }`}
                    >
                      {item.statusText}
                    </div>
                  </div>
                </div>
                <span className="font-mono tabular-nums text-[10px] text-slate-400 whitespace-nowrap shrink-0">
                  {item.lastSyncText}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Seamlessly embedded live market ticker tape */}
      {bottomSlot}

      {/* Компактная ссылка «База знаний» (открывает SecurityCenterView > FAQ по требованию) */}
      {onOpenKnowledgeBase && (
        <div className="px-3 py-1 border-t border-white/6 bg-[var(--surface-0)]/55 flex items-center justify-between gap-2 text-[10.5px] text-slate-400">
          <span className="truncate">Non-custodial · балансы только с ваших бирж по API</span>
          <button
            type="button"
            onClick={() => {
              triggerHaptic(8);
              onOpenKnowledgeBase();
            }}
            className="inline-flex items-center gap-1 text-emerald-300 hover:text-emerald-200 font-medium whitespace-nowrap shrink-0 transition-colors"
          >
            <HelpCircle className="w-3 h-3 shrink-0" />
            <span>База знаний</span>
          </button>
        </div>
      )}
    </motion.section>
  );
});
MiniPortfolioWidget.displayName = 'MiniPortfolioWidget';

