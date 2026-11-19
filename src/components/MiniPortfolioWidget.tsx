import React from 'react';
import {
  ChevronRight,
  Eye,
  EyeOff,
  Link2,
  RefreshCw,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { motion } from 'motion/react';
import type { DailyPnlSummary, PaperPortfolioReport } from '../hooks/usePaperPortfolio';
import type { PortfolioTargetRecord } from '../types/domain';
import { triggerHaptic } from '../lib/securityDlp';

interface MiniPortfolioWidgetProps {
  holdingsCount: number;
  report: PaperPortfolioReport;
  dailyPnl: DailyPnlSummary;
  activeTarget?: PortfolioTargetRecord | null;
  isBackgroundSyncingExchange?: boolean;
  connectedExchangesCount?: number;
  connectedExchangesLabel?: string;
  onOpenExchangeIntegrations?: () => void;
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

export const MiniPortfolioWidget: React.FC<MiniPortfolioWidgetProps> = React.memo(({
  holdingsCount,
  report,
  dailyPnl,
  activeTarget = null,
  isBackgroundSyncingExchange = false,
  connectedExchangesCount = 0,
  connectedExchangesLabel,
  onOpenExchangeIntegrations,
  privacyMode = false,
  onTogglePrivacyMode,
  onOpenDetails,
  onManageInScreener,
  rightActions,
  bottomSlot,
}) => {
  const isPositive = report.totalPnl >= 0;
  const isDailyPositive = dailyPnl.dailyPnlUsdt >= 0;
  const mask = (text: string) => (privacyMode ? '•••••' : text);
  const hasExchangeApi = connectedExchangesCount > 0;

  return (
    <motion.section
      data-tour-id="tour-mini-portfolio"
      aria-label="Сводка портфеля, котировки и быстрые действия"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      className="mb-3 rounded-2xl border border-emerald-500/18 bg-[var(--surface-1)]/92 backdrop-blur-md overflow-hidden"
    >
      {/* Unified single-row horizontally scrollable balance + API status + utility bar */}
      <div className="px-2.5 sm:px-3.5 py-1.5 flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() => {
              triggerHaptic(8);
              onOpenDetails();
            }}
            className="min-h-[36px] text-left inline-flex items-center gap-2 rounded-xl hover:bg-white/[0.04] px-1.5 py-0.5 transition-colors group whitespace-nowrap shrink-0"
            aria-label="Открыть быструю сводку активов и PnL"
          >
            <span className="inline-flex items-center gap-1.5 shrink-0">
              <Wallet className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="text-sm sm:text-base font-bold font-mono tabular-nums text-white">
                {mask(formatUsdCompact(report.totalValue))}
              </span>
            </span>

            {holdingsCount > 0 ? (
              <span className="inline-flex items-center gap-2 text-[11px] font-mono tabular-nums shrink-0">
                {/* Общий PnL с компактной подписью «Всего» */}
                <span
                  className={`inline-flex items-center gap-1 font-semibold ${
                    isPositive ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {isPositive ? (
                    <TrendingUp className="w-3 h-3 shrink-0" />
                  ) : (
                    <TrendingDown className="w-3 h-3 shrink-0" />
                  )}
                  <span>
                    {mask(`${isPositive ? '+' : ''}${report.totalPnlPct.toFixed(1)}%`)}
                  </span>
                  <span className="font-sans text-[10px] font-medium text-slate-400">Всего</span>
                </span>

                {/* Дневной PnL 24ч */}
                {dailyPnl.hasLive24hData && (
                  <span
                    className={`inline-flex items-center gap-1 ${
                      isDailyPositive ? 'text-emerald-300/90' : 'text-rose-300/90'
                    }`}
                  >
                    <span className="text-slate-600" aria-hidden="true">·</span>
                    <span>
                      {mask(`${isDailyPositive ? '+' : ''}${dailyPnl.dailyPnlPct.toFixed(1)}%`)}
                    </span>
                    <span className="font-sans text-[10px] text-slate-500">24ч</span>
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
            ) : (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  onManageInScreener();
                }}
                className="text-xs text-emerald-400 hover:text-emerald-300 font-medium"
              >
                + Добавить активы
              </span>
            )}

            <ChevronRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-emerald-300 transition-colors shrink-0" />
          </button>

          {/* Clickable API Exchange Status Mini-Badge -> jumps straight to Security > Exchange Integrations */}
          {onOpenExchangeIntegrations && (
            <button
              type="button"
              onClick={() => {
                triggerHaptic(8);
                onOpenExchangeIntegrations();
              }}
              aria-label={
                hasExchangeApi
                  ? `Подключено бирж по API: ${connectedExchangesCount}. Открыть настройки бирж`
                  : 'Подключить биржу по Read-Only API'
              }
              title={
                hasExchangeApi
                  ? `API бирж: ${connectedExchangesLabel || `${connectedExchangesCount} подкл.`}`
                  : 'Подключить биржу (Read-Only API)'
              }
              className={`min-h-[28px] px-2 rounded-lg border text-[11px] font-medium inline-flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors ${
                hasExchangeApi
                  ? 'border-emerald-500/35 bg-emerald-500/12 text-emerald-300 hover:bg-emerald-500/20'
                  : 'border-white/10 bg-white/[0.04] text-slate-300 hover:border-emerald-500/35 hover:text-emerald-200'
              }`}
            >
              <Link2 className={`w-3 h-3 shrink-0 ${hasExchangeApi ? 'text-emerald-400' : 'text-slate-400'}`} />
              <span>
                {hasExchangeApi
                  ? connectedExchangesLabel || `API · ${connectedExchangesCount}`
                  : 'API Биржи'}
              </span>
            </button>
          )}
        </div>

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

      {/* Seamlessly embedded live market ticker tape */}
      {bottomSlot}
    </motion.section>
  );
});
MiniPortfolioWidget.displayName = 'MiniPortfolioWidget';
